import { executeScopedGraph } from '../lib/authoring/scoped-executor';
import { ports, validatePort } from '../lib/authoring/contracts';
import { compileAuthoringGraph } from '../lib/authoring/compiler';
import { sealCode, isolatedCodeRunner, type CodeResult } from './code/runner';
import { operationSchema } from '../lib/native/model';
import { DBOS, Debouncer } from '@dbos-inc/dbos-sdk';
import { createHash } from 'node:crypto';
import type { AgentFlow, FlowExecutionInput, FlowNodeData, FlowRunEvent } from '../lib/flows/types';
import { bind, evaluate, references, type NativeOperation } from '../lib/native/model';
import { executeNativeGraph, type NativeContext, type OperationResult } from '../lib/native/executor';
import { validateFlow } from '../lib/flows/validation';
import { NodeRegistry } from './registry';
import { StudioStore } from './store';

const stableId = (value: string) => createHash('sha256').update(value).digest('hex');
export function createNativeRuntime(store: StudioStore, registry: NodeRegistry) {
  const executeGraph = async (flow: AgentFlow, input: FlowExecutionInput, runId: string): Promise<unknown> => {
    let sequence = 0;
    const emit = async (event: FlowRunEvent) => {
      const index = sequence++;
      await DBOS.runStep(() => store.appendEvent(runId, index, event), {
        name: `native.event:${index}`,
        retriesAllowed: true,
        maxAttempts: 5,
      });
    };
    async function startChild(
      ref: string,
      childInput: unknown,
      context: NativeContext,
      suffix: string,
      options: { queueRef?: string; partition?: unknown; delaySeconds?: unknown } = {},
    ) {
      const definition = flow.definitions?.[ref];
      if (!definition) throw new Error(`Workflow reference '${ref}' was not captured in the snapshot.`);
      const childId = stableId(`${runId}/${context.nodeId}/${suffix}`);
      const childFlow = {
        ...definition,
        definitions: flow.definitions,
        workspaceId: flow.workspaceId,
        _runtime: flow._runtime,
      };
      const normalized: FlowExecutionInput = {
        variables: (childInput && typeof childInput === 'object' && !Array.isArray(childInput)
          ? childInput
          : { value: childInput }) as Record<string, unknown>,
      };
      if (flow._compiled?.version === 2)
        normalized._scope = {
          captures: structuredClone(context.variables ?? {}),
          item: (childInput as any)?.item,
          index: (childInput as any)?.index,
        };
      await DBOS.runStep(() => store.createRun(childId, childFlow, normalized, runId, context.nodeId), {
        name: `child.record:${context.nodeId}:${suffix}`,
        retriesAllowed: true,
        maxAttempts: 5,
      });
      const queueName = options.queueRef ? queueNameFor(flow, options.queueRef) : undefined;
      if (
        options.delaySeconds !== undefined &&
        (!queueName ||
          typeof options.delaySeconds !== 'number' ||
          !Number.isFinite(options.delaySeconds) ||
          options.delaySeconds < 0)
      )
        throw new Error('Delayed dispatch requires a queue and a non-negative delay in seconds.');
      if (options.partition !== undefined && typeof options.partition !== 'string')
        throw new Error('Queue partition must be a string.');
      return DBOS.startWorkflow(workflowFor(childFlow), {
        workflowID: childId,
        queueName,
        enqueueOptions: {
          ...(options.partition === undefined ? {} : { queuePartitionKey: options.partition as string }),
          ...(options.delaySeconds === undefined ? {} : { delaySeconds: options.delaySeconds as number }),
        },
      })(childFlow, normalized, childId);
    }
    function queueNameFor(graph: AgentFlow, key: string) {
      const queue = graph.queues?.find((queue) => queue.key === key);
      if (!queue) throw new Error(`Unknown queue '${key}'.`);
      return `studio-${stableId(`${graph.id}/${key}`).slice(0, 20)}`;
    }
    async function execute(node: FlowNodeData, context: NativeContext): Promise<OperationResult> {
      if (node.kind === 'trigger')
        return {
          value:
            flow._compiled?.version === 2
              ? {
                  ...(input.userInput !== undefined ? { userInput: input.userInput } : {}),
                  variables: input.variables ?? {},
                }
              : input,
        };
      let op = node.config.operation!;
      if (flow._compiled && node.config.runtimeFields)
        op = operationSchema.parse({
          ...op,
          ...Object.fromEntries(Object.entries(node.config.runtimeFields).map(([key, b]) => [key, bind(b, context)])),
        });
      const value = (binding: Parameters<typeof bind>[0]) => bind(binding, context);
      const numeric = (binding: Parameters<typeof bind>[0], label: string, allowZero = true) => {
        const result = value(binding);
        if (typeof result !== 'number' || !Number.isFinite(result) || result < (allowZero ? 0 : 0.000001))
          throw new Error(`${label} must be ${allowZero ? 'non-negative' : 'positive'} and finite.`);
        return result;
      };
      switch (op.kind) {
        case 'step': {
          const result = await DBOS.runStep(
            async () => {
              const resolvedInput = value(op.input);
              if (flow._compiled?.version === 2)
                validatePort(
                  ports(node).input,
                  node.config.code ? (resolvedInput as any).input : resolvedInput,
                  `Node ${node.name} parameters`,
                );
              const result = await (node.config.code
                ? isolatedCodeRunner.execute(
                    (value(op.input) as { definition: import('../lib/authoring/model').CodeDefinition }).definition,
                    (value(op.input) as { input: unknown }).input,
                    context.variables ?? {},
                    DBOS.stepStatus
                      ? AbortSignal.any([
                          DBOS.stepStatus.cancelSignal,
                          ...(DBOS.stepStatus.timeoutSignal ? [DBOS.stepStatus.timeoutSignal] : []),
                        ])
                      : undefined,
                  )
                : registry.executeStep(op.handler, value(op.input), {
                    ...context,
                    signal: DBOS.stepStatus?.timeoutSignal,
                  }));
              if (flow._compiled?.version === 2)
                validatePort(
                  ports(node).output,
                  node.config.code ? (result as CodeResult).value : result,
                  `Node ${node.name} output`,
                );
              return result;
            },
            {
              name: `native.step:${node.id}:${op.handler}`,
              retriesAllowed: (node.config.execution?.maxAttempts ?? 1) > 1,
              maxAttempts: node.config.execution?.maxAttempts ?? 1,
              intervalSeconds: node.config.execution?.intervalSeconds ?? 1,
              timeoutMS: node.config.execution?.timeoutMS ?? 60000,
            },
          );
          if (node.config.code) {
            const code = result as CodeResult;
            return { value: code.value, metadata: { logs: code.logs, revision: code.revision } };
          }
          return { value: result };
        }
        case 'transaction':
          return { value: await registry.executeTransaction(op.handler, value(op.input), context) };
        case 'assign':
        case 'return':
          return { value: value(op.value) };
        case 'decision': {
          const result = evaluate(op.predicate, context);
          return { value: result, outcome: result ? 'true' : 'false' };
        }
        case 'delay':
          await DBOS.sleep(numeric(op.durationMS, 'Duration'));
          return { value: { elapsed: true } };
        case 'event':
          await DBOS.setEvent(op.key, value(op.value));
          return { value: value(op.value) };
        case 'send': {
          const destination = value(op.workflowID);
          if (typeof destination !== 'string') throw new Error('Destination workflow ID must be a string.');
          await DBOS.send(destination, value(op.value), op.topic);
          return { value: { sent: true } };
        }
        case 'review': {
          const instruction = value(op.instruction);
          if (typeof instruction !== 'string') throw new Error('Review instruction must be a string.');
          await DBOS.runStep(
            () => store.openApproval(runId, { ...node, config: { ...node.config, approvalMessage: instruction } }),
            { name: `review.open:${node.id}`, retriesAllowed: true, maxAttempts: 5 },
          );
          const decision = await DBOS.recv(`approval:${node.id}`, {
            timeoutSeconds: numeric(op.timeoutSeconds, 'Review timeout'),
          });
          if (decision === null)
            await DBOS.runStep(() => store.expireApproval(runId, node.id), { name: `review.expire:${node.id}` });
          return {
            value: decision ?? { approved: false, reason: 'timeout' },
            outcome: decision === null ? 'timeout' : 'success',
          };
        }
        case 'receive': {
          const result = await DBOS.recv(op.topic, { timeoutSeconds: numeric(op.timeoutSeconds, 'Receive timeout') });
          return { value: result, outcome: result === null ? 'timeout' : 'success' };
        }
        case 'waitEvent': {
          const destination = value(op.workflowID);
          if (typeof destination !== 'string') throw new Error('Event workflow ID must be a string.');
          const result = await DBOS.getEvent(destination, op.key, {
            timeoutSeconds: numeric(op.timeoutSeconds, 'Event timeout'),
          });
          return { value: result, outcome: result === null ? 'timeout' : 'success' };
        }
        case 'workflow': {
          const handle = await startChild(op.workflowRef, value(op.input), context, 'call', {
            queueRef: op.queueRef,
            partition: op.partition ? value(op.partition) : undefined,
            delaySeconds: op.delaySeconds ? value(op.delaySeconds) : undefined,
          });
          return { value: op.mode === 'start' ? handle.workflowID : await handle.getResult() };
        }
        case 'await': {
          const handles = value(op.handles);
          const ids = Array.isArray(handles) ? handles : [handles];
          if (ids.some((id) => typeof id !== 'string')) throw new Error('Await expects workflow IDs.');
          const results = [];
          for (const id of ids) results.push(await DBOS.retrieveWorkflow(id).getResult());
          return { value: Array.isArray(handles) ? results : results[0] };
        }
        case 'foreach': {
          const items = value(op.items);
          if (!Array.isArray(items)) throw new Error('For each requires an array.');
          if (items.length > op.maxItems) throw new Error(`Collection exceeds the ${op.maxItems} item limit.`);
          if (flow._compiled?.version === 2 && op.mode === 'parallel') {
            const results: unknown[] = [];
            const concurrency = op.concurrency ?? 4;
            for (let offset = 0; offset < items.length; offset += concurrency) {
              const handles = [];
              for (let index = offset; index < Math.min(items.length, offset + concurrency); index++)
                handles.push(
                  await startChild(op.workflowRef, { item: items[index], index }, context, `item-${index}`, {
                    queueRef: op.queueRef,
                    partition: op.partition ? bind(op.partition, { ...context, item: items[index] }) : undefined,
                  }),
                );
              for (const handle of handles) results.push(await handle.getResult());
            }
            return { value: results };
          }
          const handles = [];
          const results = [];
          for (let index = 0; index < items.length; index++) {
            const handle = await startChild(
              op.workflowRef,
              { ...(flow._compiled?.version === 2 ? {} : input.variables), item: items[index], index },
              context,
              `item-${index}`,
              {
                queueRef: op.queueRef,
                partition: op.partition ? bind(op.partition, { ...context, item: items[index] }) : undefined,
              },
            );
            handles.push(handle);
            if (op.mode === 'sequential') results.push(await handle.getResult());
          }
          if (op.mode === 'start') return { value: handles.map((handle) => handle.workflowID) };
          if (op.mode === 'parallel') for (const handle of handles) results.push(await handle.getResult());
          return { value: results };
        }
        case 'parallel': {
          const handles = [];
          for (let index = 0; index < op.branches.length; index++) {
            const branch = op.branches[index];
            handles.push(
              await startChild(
                branch.workflowRef,
                value(branch.input),
                context,
                `branch-${flow._compiled?.version === 2 ? branch.id : index}`,
              ),
            );
          }
          const results: unknown[] = [];
          for (const handle of handles) results.push(await handle.getResult());
          return {
            value:
              flow._compiled?.version === 2
                ? Object.fromEntries(op.branches.map((branch, index) => [branch.id!, results[index]]))
                : results,
          };
        }
        case 'loop': {
          let state = value(op.initial);
          let iteration = 0;
          while (evaluate(op.while, { ...context, state })) {
            if (iteration >= op.maxIterations)
              throw new Error(`Loop exceeded its ${op.maxIterations} iteration limit.`);
            const handle = await startChild(
              op.workflowRef,
              { ...input.variables, state, iteration },
              context,
              `iteration-${iteration}`,
            );
            state = await handle.getResult();
            iteration++;
          }
          return { value: { state, iterations: iteration } };
        }
      }
    }
    try {
      let result: unknown = null;
      for await (const event of (flow._compiled?.version === 2 ? executeScopedGraph : executeNativeGraph)(
        flow,
        input,
        runId,
        execute,
      )) {
        await emit(event);
        if (event.type === 'run.completed') result = event.output.result;
      }
      return result;
    } catch (error) {
      await emit({
        type: 'run.failed',
        runId,
        flowId: flow.id,
        error: error instanceof Error ? error.message : 'Native execution failed.',
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  };
  const runGraph = DBOS.registerWorkflow(executeGraph, { name: 'studio.executeGraph.v2' });
  const runAuthoredGraph = DBOS.registerWorkflow(
    async (flow: AgentFlow, input: FlowExecutionInput, id: string) => executeGraph(flow, input, id),
    { name: 'studio.executeGraph.v3' },
  );
  const runScopedGraph = DBOS.registerWorkflow(
    async (flow: AgentFlow, input: FlowExecutionInput, id: string) => executeGraph(flow, input, id),
    { name: 'studio.executeGraph.v4' },
  );
  const workflowFor = (flow: AgentFlow) =>
    flow._compiled?.version === 2 ? runScopedGraph : flow._compiled ? runAuthoredGraph : runGraph;

  async function snapshot(root: AgentFlow): Promise<AgentFlow> {
    const definitions: Record<string, AgentFlow> = {};
    let visits = 0;
    root = compileAuthoringGraph(root, sealCode);
    async function visit(graph: AgentFlow, ancestors: string[]) {
      if (++visits > 100 || ancestors.length > 12)
        throw new Error('Workflow reference expansion exceeds the supported limit.');
      validateFlow(graph);
      if (graph.schemaVersion !== 2) throw new Error('Native child workflows must use schemaVersion 2.');
      if (ancestors.includes(graph.id))
        throw new Error('Recursive workflow references are not supported; use a bounded loop.');
      for (const node of graph.nodes) {
        const op = node.config.operation;
        if (!op) continue;
        if (node.config.code && (!graph._compiled || op.kind !== 'step' || op.handler !== 'stackproc.code.v1'))
          throw new Error('Code requires a compiled Stack Proc authoring snapshot.');
        if (op.kind === 'step' && !node.config.code && !registry.hasStep(op.handler))
          throw new Error(`Node ${node.name}: step handler '${op.handler}' is not registered.`);
        if (op.kind === 'transaction' && !registry.hasTransaction(op.handler))
          throw new Error(`Node ${node.name}: transaction handler '${op.handler}' is not registered.`);
        for (const ref of references(op)) {
          let child =
            root.definitions?.[ref] || graph.definitions?.[ref] || (await store.getFlow(ref, root.workspaceId));
          if (!child) throw new Error(`Node ${node.name}: workflow reference '${ref}' is unavailable.`);
          child = compileAuthoringGraph(child, sealCode);
          if (
            definitions[ref] &&
            JSON.stringify(definitions[ref]) !== JSON.stringify({ ...child, definitions: undefined })
          )
            throw new Error(`Conflicting workflow reference '${ref}'.`);
          definitions[ref] = { ...child, definitions: undefined };
          await visit(child, [...ancestors, graph.id]);
        }
      }
    }
    await visit(root, []);
    const queues = [root, ...Object.values(definitions)].flatMap((graph) =>
      (graph.queues ?? []).map(({ key, ...options }) => ({
        name: `studio-${stableId(`${graph.id}/${key}`).slice(0, 20)}`,
        options,
      })),
    );
    return { ...root, definitions, _runtime: { queues } };
  }
  async function configure(flow: AgentFlow) {
    const queues =
      flow._runtime?.queues ??
      [flow, ...Object.values(flow.definitions ?? {})].flatMap((graph) =>
        (graph.queues ?? []).map(({ key, ...options }) => ({
          name: `studio-${stableId(`${graph.id}/${key}`).slice(0, 20)}`,
          options,
        })),
      );
    for (const queue of queues) await DBOS.registerQueue(queue.name, queue.options);
  }
  async function dispatch(runId: string, flow: AgentFlow, input: FlowExecutionInput) {
    await configure(flow);
    const handle = await DBOS.startWorkflow(workflowFor(flow), { workflowID: runId })(flow, input, runId);
    void handle.getResult().catch(() => {});
    return handle;
  }
  const scheduled = DBOS.registerWorkflow(
    async (time: Date, context: unknown) => {
      const saved = context as { flow: AgentFlow; input: FlowExecutionInput };
      const id = stableId(`${DBOS.workflowID}/scheduled-run`);
      const input = { ...saved.input, variables: { ...saved.input.variables, scheduledTime: time.toISOString() } };
      await DBOS.runStep(() => store.createRun(id, saved.flow, input), { name: 'scheduled.record' });
      const handle = await DBOS.startWorkflow(workflowFor(saved.flow), { workflowID: id })(saved.flow, input, id);
      await handle.getResult();
    },
    { name: 'studio.scheduledGraph.v2' },
  );
  const debounced = DBOS.registerWorkflow(
    async (flow: AgentFlow, input: FlowExecutionInput, actorId?: string) => {
      const id = stableId(`${DBOS.workflowID}/debounced-run`);
      await DBOS.runStep(() => store.createRun(id, flow, input, undefined, undefined, actorId), {
        name: 'debounced.record',
      });
      const handle = await DBOS.startWorkflow(workflowFor(flow), { workflowID: id })(flow, input, id);
      return handle.getResult();
    },
    { name: 'studio.debouncedGraph.v2' },
  );
  const debouncer = new Debouncer({ workflow: debounced });
  return {
    async start(flow: AgentFlow, input: FlowExecutionInput = {}, actorId?: string) {
      const captured = await snapshot(flow);
      const id = crypto.randomUUID();
      await configure(captured);
      await store.createRun(id, captured, input, undefined, undefined, actorId);
      await dispatch(id, captured, input);
      return id;
    },
    dispatch,
    validate: snapshot,
    async debounce(flow: AgentFlow, input: FlowExecutionInput, key: string, periodMS: number, actorId?: string) {
      const captured = await snapshot(flow);
      await configure(captured);
      const handle = await debouncer.debounce(`${flow.id}/${key}`, periodMS, captured, input, actorId);
      return {
        dispatchId: handle.workflowID,
        runId: stableId(`${handle.workflowID}/debounced-run`),
        scheduledFor: Date.now() + periodMS,
      };
    },
    async syncSchedule(flow: AgentFlow) {
      if (flow.schemaVersion !== 2) return;
      const scheduleName = `studio-${flow.id}`;
      if (!flow.schedule?.enabled) {
        await DBOS.deleteSchedule(scheduleName);
        return;
      }
      const captured = await snapshot(flow);
      await configure(captured);
      await DBOS.applySchedules([
        {
          scheduleName,
          workflowFn: scheduled,
          schedule: flow.schedule.cron,
          context: { flow: captured, input: flow.defaultInput ?? {} },
          cronTimezone: flow.schedule.timezone,
        },
      ]);
    },
    async restore() {
      for (const flow of await store.listFlows())
        if (flow.schemaVersion === 2) {
          await configure(flow);
          await this.syncSchedule(flow);
        }
      for (const row of await store.activeRuns()) if (row.graph.schemaVersion === 2) await configure(row.graph);
    },
  };
}
