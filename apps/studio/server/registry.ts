import type { NativeContext } from '../lib/native/executor';
import type { FlowNodeData, FlowNodeKind } from '../lib/flows/types';
import type { ExecutionContext, NodeExecutor } from '../lib/flows/executor';
import type { WorkspaceModelProfile, WorkspaceResourceConfig } from '../lib/workspace/resources';

export function renderTemplate(template: string, context: ExecutionContext) {
  return template
    .replaceAll('{{userInput}}', context.input.userInput ?? '')
    .replaceAll('{{outputs}}', JSON.stringify(context.outputs))
    .replace(/\{\{variables\.([\w-]+)\}\}/g, (_, key: string) => String(context.input.variables?.[key] ?? ''));
}

/** Trusted server-side adapter registry. Domain integrations register tools or
 * override a core handler; graph JSON never supplies executable source. */
export type NativeHandler = (input: unknown, context: NativeContext & { signal?: AbortSignal }) => Promise<unknown>;
export class NodeRegistry {
  private steps = new Map<string, { name: string; execute: NativeHandler }>();
  private transactions = new Map<string, { name: string; execute: NativeHandler }>();
  registerStep(id: string, name: string, execute: NativeHandler) {
    this.steps.set(id, { name, execute });
  }
  registerTransaction(id: string, name: string, execute: NativeHandler) {
    this.transactions.set(id, { name, execute });
  }
  private processAgent?: NativeHandler;
  registerProcessAgent(execute: NativeHandler) {
    this.processAgent = execute;
  }
  executeProcessAgent(input: unknown, context: NativeContext) {
    if (!this.processAgent) throw new Error('Process agent harness is not registered.');
    return this.processAgent(input, context);
  }
  private workspaceTool?: NativeHandler;
  registerWorkspaceTools(execute: NativeHandler) {
    this.workspaceTool = execute;
  }
  hasStep(id: string) {
    return (
      (['stackproc.process-agent.v1', 'stackproc.process-agent.v2'].includes(id) && !!this.processAgent) ||
      this.steps.has(id) ||
      Boolean(this.workspaceTool && /^workspace_tool\.[a-f0-9-]{36}\.r[1-9][0-9]*$/.test(id))
    );
  }
  hasTransaction(id: string) {
    return this.transactions.has(id);
  }
  executeStep(id: string, input: unknown, context: NativeContext & { signal?: AbortSignal }) {
    const handler = this.steps.get(id);
    if (!handler && this.workspaceTool && /^workspace_tool\.[a-f0-9-]{36}\.r[1-9][0-9]*$/.test(id))
      return this.workspaceTool({ handler: id, input }, context);
    if (!handler) throw new Error(`Step '${id}' is not registered.`);
    return handler.execute(input, context);
  }
  executeTransaction(id: string, input: unknown, context: NativeContext) {
    const handler = this.transactions.get(id);
    if (!handler) throw new Error(`Transaction '${id}' is not registered.`);
    return handler.execute(input, context);
  }
  nativeCatalog() {
    return {
      steps: [...this.steps].map(([id, h]) => ({ id, name: h.name })),
      transactions: [...this.transactions].map(([id, h]) => ({ id, name: h.name })),
    };
  }
  private handlers = new Map<FlowNodeKind, NodeExecutor>();
  private tools = new Map<string, { name: string; execute: NodeExecutor }>();
  private models = new Map<string, { profile: WorkspaceModelProfile; execute: NodeExecutor }>();

  constructor() {
    this.register('trigger', async (_node, context) => ({ startedBy: 'manual', ...context.input }));
    this.register('prompt', async (node, context) => renderTemplate(node.config.prompt || '{{userInput}}', context));
    this.register('condition', async (node, context) => {
      if (node.config.conditionMode === 'model')
        throw new Error('Register a model-backed condition adapter to use this condition.');
      const expression = (node.config.expression || 'true').trim().toLowerCase();
      if (expression === 'true') return true;
      if (expression === 'false') return false;
      if (expression === 'has input') return Boolean(context.input.userInput?.trim());
      throw new Error('Condition must be true, false, or has input. Register an adapter for other expressions.');
    });
    this.register('output', async (node, context) => ({
      [node.config.outputKey || 'final']: node.config.prompt
        ? renderTemplate(node.config.prompt, context)
        : { ...context.outputs },
    }));
    this.register('llm', async (node, context) => {
      const model =
        this.models.get(node.config.modelProfileId || '') ||
        [...this.models.values()].find((model) => model.profile.isDefault);
      if (!model) throw new Error('No model adapter is configured. Register a model handler in STUDIO_ADAPTER_MODULE.');
      return model.execute(node, context);
    });
    this.register('tool', async (node, context) => {
      const key = node.config.toolId || node.config.toolName || '';
      const tool = this.tools.get(key);
      if (!tool) throw new Error(`Tool '${key}' is not registered. Configure a server-side adapter.`);
      return tool.execute(node, context);
    });
    this.registerTool('echo', 'Echo input', async (node, context) => {
      if (node.config.inputFromNodeId) {
        if (!(node.config.inputFromNodeId in context.outputs)) throw new Error('Tool input source has not completed.');
        return context.outputs[node.config.inputFromNodeId];
      }
      return node.config.prompt ? renderTemplate(node.config.prompt, context) : context.input;
    });
  }

  register(kind: FlowNodeKind, execute: NodeExecutor) {
    this.handlers.set(kind, execute);
  }
  registerTool(id: string, name: string, execute: NodeExecutor) {
    this.tools.set(id, { name, execute });
  }
  registerModel(profile: WorkspaceModelProfile, execute: NodeExecutor) {
    this.models.set(profile.id, { profile, execute });
  }
  execute(node: FlowNodeData, context: ExecutionContext) {
    const handler = this.handlers.get(node.kind);
    if (!handler) throw new Error(`No handler for '${node.kind}'.`);
    return handler(node, context);
  }
  resources(): WorkspaceResourceConfig {
    return {
      models: [...this.models.values()].map((model) => ({
        ...model.profile,
        apiKeyRef: undefined,
        baseUrl: undefined,
      })),
      tools: [...this.tools].map(([id, tool]) => ({
        id,
        name: tool.name,
        kind: 'registered',
        authType: 'server',
        status: 'active',
      })),
    };
  }
}
