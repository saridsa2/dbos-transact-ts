import type { ValidateFunction } from 'ajv';
import { schemaValidator } from './schema';
import type { Context } from '../../lib/control/contracts';
import type { AgentService } from '../agent/service';
import type { HarnessHook } from './hooks';
export type ExtensionTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  effect: 'read' | 'write';
  execute(
    input: unknown,
    context: { service: AgentService; principal: Context; workId: string; invocationId: string; signal: AbortSignal },
  ): Promise<unknown>;
};
export type AgentExtension = { id: string; version: string; tools: ExtensionTool[]; hooks?: HarnessHook[] };
export class AgentExtensions {
  private readonly extensions = new Map<string, AgentExtension>();
  private readonly tools = new Map<
    string,
    { extension: AgentExtension; tool: ExtensionTool; input: ValidateFunction; output?: ValidateFunction }
  >();
  register(extension: AgentExtension) {
    if (!/^[a-z][a-z0-9_-]{1,40}$/.test(extension.id) || !extension.version || this.extensions.has(extension.id))
      throw new Error('Invalid or duplicate agent extension.');
    if (extension.tools.length > 100) throw Error('An extension may expose at most 100 tools.');
    const prepared = extension.tools.map((tool) => {
      const name = `${extension.id}__${tool.name}`;
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(name) || this.tools.has(name) || typeof tool.execute !== 'function')
        throw new Error('Invalid or duplicate extension tool.');
      return {
        name,
        value: {
          extension,
          tool,
          input: schemaValidator(tool.inputSchema),
          output: tool.outputSchema ? schemaValidator(tool.outputSchema) : undefined,
        },
      };
    });
    if (new Set(prepared.map((t) => t.name)).size !== prepared.length) throw new Error('Duplicate extension tool.');
    this.extensions.set(extension.id, extension);
    for (const item of prepared) this.tools.set(item.name, item.value);
  }
  list() {
    return [...this.extensions.values()].map((e) => ({
      id: e.id,
      version: e.version,
      tools: e.tools.map((t) => ({ name: `${e.id}__${t.name}`, effect: t.effect })),
    }));
  }
  resolve(enabled: readonly { id: string; version: string }[]) {
    for (const pin of enabled) {
      const found = this.extensions.get(pin.id);
      if (!found || found.version !== pin.version) throw new Error(`Agent extension ${pin.id} is missing or changed.`);
    }
    const allowed = new Set(enabled.map((e) => e.id));
    return {
      definitions: [...this.tools]
        .filter(([, v]) => allowed.has(v.extension.id))
        .map(([name, v]) => ({
          type: 'function' as const,
          function: { name, description: v.tool.description, parameters: v.tool.inputSchema },
        })),
      hooks: [...this.extensions.values()].filter((e) => allowed.has(e.id)).flatMap((e) => e.hooks ?? []),
      get: (name: string) => {
        const found = this.tools.get(name);
        return found && allowed.has(found.extension.id) ? found : undefined;
      },
    };
  }
}
export class UncertainToolError extends Error {}
