import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AgentExtensions } from '../workspace-harness/extensions';
import type { AgentService } from './service';
import type { Context } from '../../lib/control/contracts';
import { contentHash } from '../../lib/knowledge/contracts';
import { ControlError } from '../control/service';
export type McpBinding = {
  connectionId: string;
  revision: number;
  tools: { name: string; hash: string; effect: 'read' | 'write' }[];
};
async function connection(
  service: AgentService,
  ctx: Context,
  id: string,
  revision: number,
  signal = AbortSignal.timeout(30000),
) {
  const metadata = (await service.control.connections(ctx)).find(
    (c) => c.id === id && c.revision === revision && c.provider === 'mcp' && c.status === 'configured',
  );
  if (!metadata) throw new ControlError(403, 'MCP connection was changed, revoked or is unavailable.');
  const credential = await service.control.resolveCredential(ctx.workspace.id, id, revision);
  if (!('secret' in credential) || !credential.secret)
    throw new ControlError(422, 'MCP bearer credential is unavailable.');
  const endpoint = new URL(String(metadata.config.endpoint));
  const client = new Client({ name: 'stackproc-workspace', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${credential.secret}` }, redirect: 'error' },
    reconnectionOptions: {
      maxRetries: 0,
      maxReconnectionDelay: 0,
      initialReconnectionDelay: 0,
      reconnectionDelayGrowFactor: 1,
    },
    fetch: async (url, init) => {
      const actual = new URL(String(url));
      if (actual.origin !== endpoint.origin) throw Error('MCP attempted to change the configured connection origin.');
      const response = await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000), ...(init?.signal ? [init.signal] : [])]),
      });
      let bytes = 0;
      return new Response(
        response.body?.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              bytes += chunk.byteLength;
              if (bytes > 1024 * 1024) throw Error('MCP response exceeded 1 MiB.');
              controller.enqueue(chunk);
            },
          }),
        ),
        { status: response.status, statusText: response.statusText, headers: response.headers },
      );
    },
  });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await client.close().catch(() => {});
    throw new Error('Could not initialize the configured MCP connection.');
  }
}
async function catalogue(client: Client) {
  const tools = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: 30000 });
    tools.push(...page.tools);
    if (tools.length > 200) throw Error('MCP tool discovery exceeded 200 tools.');
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw Error('MCP returned a repeated discovery cursor.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return Promise.all(
    tools.map(async (t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      hash: await contentHash({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema ?? null,
      }),
    })),
  );
}
export async function discoverMcp(service: AgentService, ctx: Context, id: string, revision: number) {
  if (!['owner', 'admin'].includes(ctx.workspace.role))
    throw new ControlError(403, 'Only administrators can discover agent MCP offerings.');
  const client = await connection(service, ctx, id, revision);
  try {
    return { connectionId: id, revision, tools: await catalogue(client) };
  } finally {
    await client.close();
  }
}
export async function mcpExtensions(service: AgentService, ctx: Context, bindings: McpBinding[]) {
  const registry = new AgentExtensions(),
    pins = [];
  for (const binding of bindings) {
    const client = await connection(service, ctx, binding.connectionId, binding.revision);
    let tools;
    try {
      tools = await catalogue(client);
    } finally {
      await client.close();
    }
    const id = `mcp_${(await contentHash(binding.connectionId)).slice(0, 12)}`;
    registry.register({
      id,
      version: String(binding.revision),
      tools: binding.tools.map((pin) => {
        const tool = tools.find((t) => t.name === pin.name && t.hash === pin.hash);
        if (!tool)
          throw new ControlError(409, 'A pinned MCP offering changed. Rediscover and review it before enabling.');
        return {
          name: tool.name.replace(/[^a-zA-Z0-9_]/g, '_'),
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          effect: pin.effect,
          execute: async (args: unknown, execution: { signal: AbortSignal }) => {
            const live = await connection(service, ctx, binding.connectionId, binding.revision, execution.signal);
            try {
              if (!(await catalogue(live)).some((t) => t.name === pin.name && t.hash === pin.hash))
                throw Error('MCP schema changed before invocation.');
              const result = await live.callTool(
                { name: pin.name, arguments: args as Record<string, unknown> },
                undefined,
                { signal: execution.signal, timeout: 30000 },
              );
              if (result.isError) throw Error('The MCP server reported a tool error.');
              return result.structuredContent ?? { content: result.content };
            } finally {
              await live.close();
            }
          },
        };
      }),
    });
    pins.push({ id, version: String(binding.revision) });
  }
  return registry.resolve(pins);
}
