import type { AgentService } from '../agent/service';
import { AgentExtensions } from '../workspace-harness/extensions';
import type { Context } from '../../lib/control/contracts';
import { ToolStore } from './store';
export type AuthoredPin = { id: string; revision: number; hash?: string; buildHash?: string };
export async function authoredExtensions(store: ToolStore, ctx: Context, pins?: AuthoredPin[]) {
  const current = await store.offerings(ctx);
  const selected: AuthoredPin[] =
    pins ??
    current.filter((t) => t.build.manifest.exposure.includes('agent')).map((t) => ({ id: t.id, revision: t.revision }));
  const registry = new AgentExtensions();
  const tools = [];
  const captured: AuthoredPin[] = [];
  for (const pin of selected) {
    const build = await store.releaseBuild(ctx, pin.id, pin.revision);
    if (!build.manifest.exposure.includes('agent')) continue;
    if ((pin.hash && pin.hash !== build.hash) || (pin.buildHash && pin.buildHash !== build.buildHash))
      throw Error('Pinned authored tool build changed.');
    captured.push({ id: pin.id, revision: pin.revision, hash: build.hash, buildHash: build.buildHash });
    tools.push({
      name: `t${pin.id.replaceAll('-', '')}_r${pin.revision}`,
      description: build.manifest.description,
      inputSchema: build.inputSchema,
      outputSchema: build.outputSchema,
      effect: 'read' as const,
      execute: async (
        input: unknown,
        context: { invocationId: string; signal: AbortSignal; service: AgentService; workId: string },
      ) => {
        const result = await store.invoke(ctx, pin.id, pin.revision, input, context.invocationId, context.signal);
        await context.service.activity(
          ctx.workspace.id,
          context.workId,
          'tool_log',
          `${build.manifest.name} completed.`,
          {
            toolId: pin.id,
            revision: pin.revision,
            buildHash: build.buildHash,
            invocationId: context.invocationId,
            logs: result.logs,
          },
        );
        return result.value;
      },
    });
  }
  registry.register({ id: 'workspace_tools', version: '1', tools });
  return { pins: captured, ...registry.resolve([{ id: 'workspace_tools', version: '1' }]) };
}
