import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHarness2Bridge } from './harness2-bridge';

describe('Harness2 scoped MCP tool bridge', () => {
  it('uses the real MCP client for discovery and execution and rejects missing credentials', async () => {
    const calls: { name: string; args: unknown; requestId: string }[] = [];
    const bridge = await createHarness2Bridge(async (name, args, requestId) => {
      calls.push({ name, args, requestId });
      return { knowledge: [], workflows: [] };
    });
    const client = new Client({ name: 'stackproc-test', version: '1.0.0' });
    try {
      expect(
        (await fetch(bridge.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))
          .status,
      ).toBe(403);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(bridge.url), {
          requestInit: { headers: { Authorization: `Bearer ${bridge.token}` } },
        }),
      );
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === 'workspace_describe_v1')).toBe(true);
      expect(tools.tools.some((tool) => tool.name === 'bash')).toBe(false);
      const result = await client.callTool({ name: 'workspace_describe_v1', arguments: {} });
      expect(result.content).toEqual([{ type: 'text', text: '{"knowledge":[],"workflows":[]}' }]);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('workspace_describe_v1');
      expect(calls[0].requestId).toBeTruthy();
    } finally {
      await client.close();
      await bridge.close();
    }
  });
});
