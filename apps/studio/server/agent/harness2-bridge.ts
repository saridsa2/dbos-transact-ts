import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { modelTools } from './tools';
/** Per-activation tool bridge: token and authorization are bound to one host-owned context. */
export async function createHarness2Bridge(call: (name: string, args: unknown, requestId: string) => Promise<unknown>) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const transports = new Set<StreamableHTTPServerTransport>();
  const http = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || req.url !== '/mcp') {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const rpc = new Server({ name: 'stackproc', version: '1.0.0' }, { capabilities: { tools: {} } });
    rpc.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: modelTools.map(({ function: tool }) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters as any,
      })),
    }));
    rpc.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const value = await call(request.params.name, request.params.arguments ?? {}, String(extra.requestId));
      return { content: [{ type: 'text', text: JSON.stringify(value) }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    transports.add(transport);
    res.on('close', () => {
      transports.delete(transport);
      void rpc.close();
    });
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 256 * 1024) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      await rpc.connect(transport);
      await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });
  await new Promise<void>((accept, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', accept);
  });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Tool bridge did not bind to loopback.');
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    token,
    async close() {
      await Promise.all([...transports].map((t) => t.close()));
      http.closeAllConnections();
      await new Promise<void>((accept) => http.close(() => accept()));
    },
  };
}
