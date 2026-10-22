import { migrateProcess } from '../../lib/processes/model';
import { AgentResponseError } from '../agent/model';
import { setTimeout as delay } from 'node:timers/promises';
import type { AuthoringModelAdapter } from '../intelligence/minimax';
import { knowledgeFixtures } from '../../lib/knowledge/fixtures';
import pg from 'pg';
import type { NodeRegistry } from '../registry';
// Loaded only by the isolated Postgres crash-recovery integration test.
export function register(registry: NodeRegistry) {
  registry.registerTool('integration-counter', 'Integration counter', async (_node, context) => {
    const client = new pg.Client({ connectionString: process.env.STUDIO_DATABASE_URL });
    await client.connect();
    try {
      await client.query('INSERT INTO studio_test_effects(effect_key) VALUES($1)', [
        context.input.variables?.effectKey,
      ]);
      return { recorded: true };
    } finally {
      await client.end();
    }
  });
}

/** Deterministic test-only model; never installed without this fixture module. */
export const authoringModel: AuthoringModelAdapter = {
  id: 'fixture.minimax',
  version: 1,
  async generate(request) {
    const client = new pg.Client({ connectionString: process.env.STUDIO_DATABASE_URL });
    await client.connect();
    try {
      await client.query('INSERT INTO studio_test_effects(effect_key) VALUES($1)', [`model:${request.taskId}`]);
    } finally {
      await client.end();
    }
    if (request.source.blocks.some((b) => b.text.includes('[INTERRUPT]')))
      await delay(30000, undefined, { signal: request.signal });
    const fixture = knowledgeFixtures()[0];
    const evidence = [
      { kind: 'source' as const, revisionId: request.source.revisionId, blockId: request.source.blocks[0].id },
    ];
    fixture.ontology.entities[0].evidence = evidence;
    for (const step of fixture.process.steps) step.evidence = evidence;
    if (request.source.blocks.some((b) => b.text.includes('[ASK]')))
      fixture.process.questions = [
        {
          id: 'owner',
          question: 'Who owns this process?',
          ...(request.answers.owner ? { answer: request.answers.owner } : {}),
        },
      ];
    return {
      analysis: { summary: 'Deterministic test analysis', ontology: fixture.ontology, process: fixture.process },
      model: request.model,
      responseId: `fixture-${request.taskId}`,
      usage: { input: 10, output: 20 },
    };
  },
};

export const agentModel: import('../agent/model').AgentModel = {
  async complete(input) {
    const client = new pg.Client({ connectionString: process.env.STUDIO_DATABASE_URL });
    await client.connect();
    try {
      await client.query("INSERT INTO studio_test_effects(effect_key) VALUES('agent-model')");
    } finally {
      await client.end();
    }
    if (String(input.messages[0]?.content).startsWith('Extract navigation relations only')) {
      const text = JSON.stringify({ summary: 'Approved memory retained.', outcome: 'informational', triples: [] });
      return {
        message: { role: 'assistant', content: text },
        text,
        calls: [],
        usage: { input: 100, output: 30 },
        model: input.model,
        responseId: crypto.randomUUID(),
      };
    }
    if (String(input.messages[0]?.content).startsWith('You condense historical data for Stack Proc.')) {
      const raw = String(input.messages[1]?.content ?? '');
      const text = JSON.stringify({
        items: [
          {
            kind: 'finding',
            text: raw.includes('OLD_FACT')
              ? 'OLD_FACT: original decision.'
              : 'Verified source pages retained; exact coverage is in history receipts.',
          },
        ],
        remainingWork: [],
      });
      return {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'observation', type: 'function', function: { name: 'record_history_observation', arguments: text } },
          ],
        },
        text: '',
        calls: [{ id: 'observation', name: 'record_history_observation', arguments: JSON.parse(text) }],
        usage: { input: Math.ceil(raw.length / 4), output: 60 },
        model: input.model,
        responseId: crypto.randomUUID(),
      };
    }
    const toolMessages = input.messages.filter((m) => m.role === 'tool');
    let currentGoal = String(
      input.messages
        .filter((m) => m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('{'))
        .at(-1)?.content ?? '',
    );
    const activeGoal = input.messages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('{"activeWorkGoal"'),
    );
    if (activeGoal) currentGoal = JSON.parse(String(activeGoal.content)).activeWorkGoal;
    if (currentGoal.startsWith('Workspace setup: [HARNESS_SETUP]'))
      currentGoal = '[HARNESS_SETUP] ' + currentGoal.split('Approved coordinator defaults (data): ')[1];
    if (
      currentGoal.startsWith('Review saved knowledge changes against') ||
      currentGoal.startsWith('Inspect the accepted workspace understanding')
    )
      currentGoal = '[HARNESS_AUTOMATIC_REVIEW]';
    if (currentGoal.startsWith('Agent draft: [HARNESS_DRAFT]'))
      currentGoal = '[HARNESS_DRAFT] ' + currentGoal.split('Approved coordinator defaults (data): ')[1];
    if (input.messages.some((m) => String(m.content).includes('additionalUserGuidance')))
      currentGoal = String(
        input.messages.find((m) => m.role === 'user' && String(m.content).startsWith('[HARNESS_'))?.content ??
          currentGoal,
      );
    const answers = input.messages.some((m) => typeof m.content === 'string' && m.content.includes('userAnswers'));
    // Feature scenarios use real host dispatch; only provider replies are deterministic.
    if (currentGoal === '[HARNESS_LENGTH]')
      throw new AgentResponseError(
        'length',
        { input: 50, output: input.outputTokens },
        'fixture-limit',
        input.outputTokens,
      );
    if (currentGoal.startsWith('[HARNESS_') || input.tools.length === 0) {
      const make = async (
        calls: { id: string; name: string; arguments: unknown }[],
        text = 'Feature scenario completed.',
      ) => {
        if (!calls.length) await input.onText?.(text);
        return {
          message: {
            role: 'assistant',
            content: calls.length ? null : text,
            reasoning_content: 'private fixture reasoning',
            ...(calls.length
              ? {
                  tool_calls: calls.map((c) => ({
                    id: c.id,
                    type: 'function',
                    function: { name: c.name, arguments: JSON.stringify(c.arguments) },
                  })),
                }
              : {}),
          },
          text: calls.length ? '' : text,
          calls,
          usage: { input: 20, output: 30 },
          model: input.model,
          responseId: crypto.randomUUID(),
        };
      };
      if (currentGoal.startsWith('[HARNESS_MEMORY_RECEIPT] ')) {
        const [, id, revisionId] = currentGoal.split(' ');
        const references = input.messages.find(
          (m) => typeof m.content === 'string' && m.content.includes('"availableEvidenceReceipts":'),
        );
        const receipts = references ? JSON.parse(String(references.content)).availableEvidenceReceipts : [];
        if (!receipts.length)
          return make([
            {
              id: 'read-source',
              name: 'artifact_read_v1',
              arguments: { id, revisionId, view: 'text', offset: 0, limit: 1000 },
            },
          ]);
        if (toolMessages.some((m) => String(m.content).includes('"sourceWorkId"')))
          return make([], 'Retrieved current-activity receipt without inventing an activity identifier.');
        return make([
          { id: 'read-receipt', name: 'agent_result_read_v2', arguments: { receiptId: receipts[0].receiptId } },
        ]);
      }
      if (currentGoal.startsWith('[HARNESS_WORKING_MEMORY] ')) {
        if (
          currentGoal.endsWith('history') &&
          toolMessages.some((m) => String(m.content).includes('nextBeforeGeneration'))
        )
          return make([], 'History lineage and original evidence retained.');
        const [, id, revisionId] = currentGoal.split(' ');
        const receipts = input.messages.find(
          (m) => typeof m.content === 'string' && m.content.includes('"availableEvidenceReceipts":'),
        );
        const count = receipts
          ? (JSON.parse(String(receipts.content)).receiptCount ??
            JSON.parse(String(receipts.content)).availableEvidenceReceipts.length)
          : 0;
        const reply =
          count >= 10 && currentGoal.endsWith('history')
            ? await make([{ id: 'read-history', name: 'agent_history_read_v1', arguments: { stream: 'work' } }])
            : count >= 10
              ? await make([], 'Inspected ten pinned source pages; completed with durable working context.')
              : await make([
                  {
                    id: `memory-read-${count}`,
                    name: 'artifact_read_v1',
                    arguments: { id, revisionId, view: 'text', offset: count * 8000, limit: 8000 },
                  },
                ]);
        reply.usage = { input: Math.ceil(Buffer.byteLength(JSON.stringify(input.messages)) / 4), output: 30 };
        return reply;
      }
      if (currentGoal.startsWith('[HARNESS_MEMORY_RESUME]'))
        return make([], 'Resumed within the approved memory budget.');
      if (currentGoal === '[HARNESS_TOKEN_BUDGET]') {
        const reply = await make([{ id: 'budget-inspect', name: 'workspace_describe_v1', arguments: {} }]);
        reply.usage = { input: 1100, output: 30 };
        return reply;
      }
      if (currentGoal.startsWith('[HARNESS_PROCESS_PROPOSAL]')) {
        if (!toolMessages.length) {
          const attached = input.messages.find(
            (m) => typeof m.content === 'string' && m.content.startsWith('{"attachedResources"'),
          );
          const item = JSON.parse(String(attached?.content)).attachedResources[0];
          const content = migrateProcess(item.revision.content);
          content.purpose = 'Reviewed visual process purpose';
          return make([
            {
              id: 'process-proposal',
              name: 'process_propose_v1',
              arguments: {
                id: item.artifact.id,
                expectedVersion: item.artifact.editVersion,
                summary: 'Clarify process purpose',
                content,
              },
            },
          ]);
        }
        return make([], 'Process proposal is ready for review.');
      }
      if (currentGoal.startsWith('[HARNESS_PROCESS_ACTIVITY]')) {
        if (!toolMessages.length)
          return make([{ id: 'process-inspect', name: 'workspace_describe_v1', arguments: {} }]);
        return make([], '{"ok":true}');
      }
      if (!input.tools.length) return make([], 'Historical fact retained: OLD_FACT. Prior actions remain recorded.');
      const called = (name: string) =>
        toolMessages.filter((m) => {
          try {
            return JSON.parse(String(m.content)).fixtureName === name;
          } catch {
            return false;
          }
        });
      const n = toolMessages.length;
      const one = (name: string, args: unknown) => make([{ id: `feature-${n}`, name, arguments: args }]);
      if (currentGoal.startsWith('[HARNESS_DRAFT] ')) {
        const definition = JSON.parse(currentGoal.slice('[HARNESS_DRAFT] '.length));
        return make(
          [],
          JSON.stringify({
            ...definition,
            name: 'Assignment reviewer',
            instructions: 'DEFINITION_MARKER: inspect assigned context only.',
            tools: ['workspace_describe_v1'],
          }),
        );
      }
      if (currentGoal === '[HARNESS_AUTOMATIC_REVIEW]') {
        if (!n) return one('workspace_describe_v1', {});
        return make([], 'Saved knowledge reviewed; no assignment dispatched.');
      }
      if (currentGoal === '[HARNESS_COORDINATE]') {
        if (!n) return one('agent_definition_search_v1', { query: 'Assignment reviewer' });
        if (n === 1) {
          const executor = JSON.parse(String(toolMessages[0].content)).items[0];
          if (!executor) throw Error('No published specialist found.');
          return one('workspace_suggestion_propose_v1', {
            key: 'inspect_empty_scope',
            goal: '[HARNESS_DEFINED]',
            rationale: 'Review the selected context before expanding scope.',
            successCriteria: 'Return evidence-backed findings or an explicit empty-context result.',
            executor: { agentId: executor.agentId, revision: executor.revision, hash: executor.hash },
            context: [],
          });
        }
        return make([], 'A specialist assignment is ready for user review.');
      }
      if (currentGoal.startsWith('[HARNESS_SETUP] ')) {
        const coordinator = JSON.parse(currentGoal.slice('[HARNESS_SETUP] '.length));
        if (!n) return one('workspace_describe_v1', {});
        return make(
          [],
          JSON.stringify({
            schemaVersion: 1,
            purpose: 'Operations workspace',
            goals: ['Review process and ontology gaps'],
            gaps: [
              coordinator.context.resources.length
                ? 'Sources require deeper inspection.'
                : 'No sources have been supplied.',
            ],
            evidenceReceiptIds: [],
            coordinator,
          }),
        );
      }
      if (currentGoal === '[HARNESS_DEFINED_CONTINUE]') {
        if (
          !input.messages.some(
            (m) => m.role === 'assistant' && String(m.content).includes('Named agent completed with scoped context.'),
          )
        )
          throw Error('Same-agent session history missing.');
        return make([], 'Continued with the previous agent result.');
      }
      if (currentGoal.startsWith('[HARNESS_DEFINED]')) {
        if (!String(input.messages[0].content).includes('DEFINITION_MARKER'))
          throw Error('Published instructions missing.');
        if (!n) return one('workspace_describe_v1', {});
        const found = JSON.parse(String(toolMessages[0].content));
        if (found.knowledge.length || found.workflows.length)
          throw Error('Selected-context inventory leaked resources.');
        return make([], 'Named agent completed with scoped context.');
      }
      if (currentGoal === '[HARNESS_DEFINED_FORGED]') return one('memory_search_v1', { query: '' });
      if (currentGoal === '[HARNESS_CHOICE_FORM]') {
        if (
          !input.messages.some(
            (message) => message.role === 'system' && String(message.content).includes('MUST call ask_user_v2'),
          )
        )
          throw Error('Structured question guidance did not reach the provider.');
        if (input.tools.some((tool) => (tool as { function: { name: string } }).function.name === 'ask_user_v1'))
          throw Error('Legacy question tool was advertised.');
        if (!answers)
          return one('ask_user_v2', {
            question: 'Which direction should the ontology proposal take?',
            fields: [
              {
                id: 'direction',
                label: 'Direction',
                type: 'select',
                required: true,
                options: [
                  { id: 'properties', label: 'Add properties' },
                  { id: 'subclasses', label: 'Create subclasses' },
                  { id: 'both', label: 'Both' },
                  { id: 'other', label: 'Another direction' },
                ],
              },
              { id: 'details', label: 'Additional details', type: 'text', required: false },
            ],
          });
        return make([], 'Recorded the proposal direction.');
      }
      if (currentGoal.startsWith('[HARNESS_LARGE_SOURCE]')) {
        const id = currentGoal.split(' ')[1];
        if (!n) return one('artifact_read_v1', { id });
        const first = JSON.parse(String(toolMessages[0].content));
        if (first.error || first.page?.view !== 'summary') throw Error('Large source index unavailable.');
        const revisionId = first.revision.id;
        if (n === 1) return one('artifact_read_v1', { id, revisionId, view: 'entities', limit: 8000 });
        if (n === 2)
          return one('artifact_read_v1', { id, revisionId, view: 'entity', entityId: 'organization', limit: 8000 });
        if (n === 3)
          return one('artifact_read_v1', { id, revisionId, view: 'search', query: 'identifier', limit: 1000 });
        const last = JSON.parse(String(toolMessages.at(-1)!.content));
        if (!last.page?.text.includes('identifier') || !last.evidence?.length)
          throw Error('Source evidence was not retrieved.');
        return make(
          [],
          'Inspected the stored ORG entity and retrieved identifier source evidence. Other source sections remain uninspected.',
        );
      }
      if (currentGoal === '[HARNESS_CONTEXT_UPLOAD]') {
        const received = input.messages.some(
          (message) =>
            typeof message.content === 'string' &&
            message.content.includes('attachedResources') &&
            message.content.includes('UploadReceiptMarker'),
        );
        if (!received) throw Error('Uploaded context did not reach the provider input.');
        return make([], 'Uploaded context reached the provider.');
      }
      if (currentGoal.includes('[HARNESS_AUTHORED]')) {
        if (!n) return one('agent_tool_search_v1', { query: 'numeric', limit: 5 });
        if (n === 1) {
          const found = (input.tools as any[]).find((t) => t.function.name.startsWith('workspace_tools__'));
          if (!found) throw Error('Authored tool schema was not loaded.');
          return one(found.function.name, { values: [9, 18, 27] });
        }
        return make([], 'Authored tool returned total 54.');
      }
      if (currentGoal.includes('[HARNESS_PARALLEL]') || currentGoal.includes('[HARNESS_APPROVAL]')) {
        if (!n) return one('agent_tool_search_v1', { query: 'fixture', limit: 5 });
        if (currentGoal.includes('PARALLEL') && n === 1)
          return make(['a', 'b'].map((id) => ({ id, name: 'fixture__read', arguments: { key: id } })));
        if (currentGoal.includes('APPROVAL') && n < (currentGoal.includes('replay') ? 4 : 3))
          return one('fixture__write', { key: 'approved-effect' });
        return make([]);
      }
      if (currentGoal.includes('[HARNESS_MCP]')) {
        if (!n) return one('agent_tool_search_v1', { query: 'workspace_describe', limit: 5 });
        if (n === 1) {
          const found = JSON.parse(String(toolMessages[0].content)).items[0];
          return one(found.name, {});
        }
      }
      if (currentGoal.includes('[HARNESS_DELEGATE]') && !n)
        return one('agent_delegate_v1', {
          tasks: [
            {
              key: 'a',
              title: 'First research',
              goal: currentGoal.includes('slow')
                ? '[HARNESS_CHILD] slow'
                : currentGoal.includes('denied')
                  ? '[HARNESS_CHILD_DENIED]'
                  : '[HARNESS_CHILD]',
            },
            {
              key: 'b',
              title: 'Second research',
              goal: currentGoal.includes('slow')
                ? '[HARNESS_CHILD] slow'
                : currentGoal.includes('denied')
                  ? '[HARNESS_CHILD_DENIED]'
                  : '[HARNESS_CHILD]',
            },
          ],
        });
      if (currentGoal.includes('[HARNESS_CHILD_DENIED]') && !n)
        return one('fixture__write', { key: 'child-must-not-write' });
      if (currentGoal.includes('[HARNESS_CHILD]') && currentGoal.includes('slow'))
        await delay(30000, undefined, { signal: input.signal });
      if (currentGoal.includes('[HARNESS_CHILD]') && !n)
        return one('agent_code_v1', { source: 'return input * 2;', input: 4 });
      if (currentGoal.includes('[HARNESS_PLAN_CODE]')) {
        if (!n)
          return one('agent_plan_v1', { steps: [{ id: 'transform', label: 'Transform data', status: 'running' }] });
        if (n === 1) return one('agent_code_v1', { source: 'return input.map(x => x * 9);', input: [1, 2, 3] });
        if (n === 2)
          return one('agent_plan_v1', { steps: [{ id: 'transform', label: 'Transform data', status: 'completed' }] });
      }
      if (currentGoal.includes('[HARNESS_MEMORY]') && !n)
        return one('agent_memory_propose_v1', { content: 'Banking uses reviewed domain concepts.', evidence: [] });
      if (currentGoal.includes('[HARNESS_SKILL]') && currentGoal.includes('pause') && n === 1 && !answers)
        return one('ask_user_v2', {
          question: 'Continue skill verification?',
          fields: [{ id: 'approved', label: 'Continue', type: 'boolean', required: true }],
        });
      if (currentGoal.includes('[HARNESS_SKILL]') && (!n || (currentGoal.includes('pause') && n === 2))) {
        const system = String(input.messages[0].content),
          match = system.match(/"id":"([a-f0-9-]+)"/);
        return one('agent_skill_read_v1', { id: match?.[1] });
      }
      if (currentGoal.includes('[HARNESS_STRUCTURED]'))
        return make(
          [],
          input.messages.some((m) => String(m.content).includes('validationFeedback'))
            ? '{"factor":9}'
            : '{"factor":"wrong"}',
        );
      if (currentGoal.includes('[HARNESS_STEER]') && !n) {
        await delay(1500, undefined, { signal: input.signal });
        return one('workspace_describe_v1', {});
      }
      if (currentGoal.includes('[HARNESS_STEER]'))
        return make(
          [],
          input.messages.some((m) => String(m.content).includes('additionalUserGuidance'))
            ? 'Guidance received at next boundary.'
            : 'No guidance.',
        );
      return make([]);
    }
    const interrupt = currentGoal.includes('[AGENT_INTERRUPT]');
    if (interrupt) {
      const marker = new pg.Client({ connectionString: process.env.STUDIO_DATABASE_URL });
      await marker.connect();
      try {
        await marker.query('INSERT INTO studio_test_effects(effect_key) VALUES($1)', [
          `agent-interrupt:${currentGoal}`,
        ]);
      } finally {
        await marker.end();
      }
      await delay(30000, undefined, { signal: input.signal });
    }
    const ask = currentGoal.includes('[AGENT_ASK]');
    const structured = currentGoal.includes('[AGENT_FORM]');
    const proposing = currentGoal.includes('[AGENT_PROPOSE]');
    const attachedMessage = input.messages.find(
      (m) => typeof m.content === 'string' && m.content.startsWith('{"attachedResources"'),
    );
    const attachment = attachedMessage ? JSON.parse(attachedMessage.content as string).attachedResources[0] : null;
    const calls =
      currentGoal.includes('[AGENT_BATCH_PAUSE]') && !answers
        ? [
            {
              id: 'first-question',
              name: 'ask_user_v2',
              arguments: {
                question: 'Choose a domain.',
                fields: [{ id: 'domain', label: 'Domain', type: 'text', required: true }],
              },
            },
            {
              id: 'skipped-question',
              name: 'ask_user_v2',
              arguments: {
                question: 'This must never be asked.',
                fields: [{ id: 'wrong', label: 'Wrong', type: 'text', required: true }],
              },
            },
          ]
        : proposing && toolMessages.length === 0 && attachment
          ? [
              {
                id: 'proposal-1',
                name: 'ontology_propose_v1',
                arguments: {
                  id: attachment.artifact.id,
                  expectedVersion: attachment.artifact.editVersion,
                  summary: 'Clarify domain description',
                  content: currentGoal.includes('encoded')
                    ? JSON.stringify({ ...attachment.revision.content, description: 'Reviewed account domain' })
                    : { ...attachment.revision.content, description: 'Reviewed account domain' },
                },
              },
            ]
          : structured && !answers
            ? [
                {
                  id: 'form-1',
                  name: 'ask_user_v2',
                  arguments: {
                    question: 'Choose ownership and a processing limit.',
                    fields: [
                      {
                        id: 'team',
                        label: 'Owner',
                        type: 'select',
                        required: true,
                        options: [
                          { id: 'finance', label: 'Finance' },
                          { id: 'sales', label: 'Sales' },
                        ],
                      },
                      { id: 'limit', label: 'Limit', type: 'number', required: true },
                      { id: 'enabled', label: 'Enabled', type: 'boolean', required: true },
                    ],
                  },
                },
              ]
            : ask && !answers
              ? [{ id: 'ask-1', name: 'ask_user_v1', arguments: { question: 'Who owns the Account concept?' } }]
              : toolMessages.length === 0
                ? [{ id: 'context-1', name: 'workspace_describe_v1', arguments: {} }]
                : [];
    const message = {
      role: 'assistant',
      content: calls.length ? null : 'Workspace inspected with recorded evidence.',
      reasoning_content: 'fixture-private-continuation',
      ...(calls.length
        ? {
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.arguments) },
            })),
          }
        : {}),
    };
    return {
      message,
      text: message.content ?? '',
      calls,
      usage: { input: 20, output: 30 },
      model: input.model,
      responseId: crypto.randomUUID(),
    };
  },
};

export const agentExtensions = [
  {
    id: 'fixture',
    version: '1',
    tools: ['read', 'write'].map((effect) => ({
      name: effect,
      description: `fixture ${effect} operation`,
      effect: effect as 'read' | 'write',
      inputSchema: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
        additionalProperties: false,
      },
      async execute(input: unknown, context: any) {
        const key = (input as { key: string }).key;
        await context.service.pool.query('INSERT INTO studio_test_effects(effect_key) VALUES($1)', [
          `fixture:${effect}:${key}:start`,
        ]);
        if (effect === 'read') await delay(200, undefined, { signal: context.signal });
        await context.service.pool.query('INSERT INTO studio_test_effects(effect_key) VALUES($1)', [
          `fixture:${effect}:${key}:end`,
        ]);
        return { key, fixtureName: effect };
      },
    })),
  },
];

// Isolated integration fixtures only: deterministic local vectors, never used by production defaults.
export const memoryEmbedder = {
  local: true as const,
  model: 'fixture-memory-v1',
  dimensions: 3,
  embed: async (text: string) => [text.toLowerCase().includes('onboarding') ? 1 : 0, 1, 0],
};
