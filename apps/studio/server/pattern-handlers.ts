import { z } from 'zod';
import type { NodePostgresDataSource } from '@dbos-inc/node-pg-datasource';
import type { NodeRegistry } from './registry';
import type { StudioStore } from './store';

/** Runnable local adapters for the reference graphs. No provider credentials,
 * remote model calls, Slack messages, or AWS operations are performed here. */
export function registerPatternHandlers(registry: NodeRegistry, store: StudioStore, ds: NodePostgresDataSource) {
  const page = z.object({
    documentId: z.string().min(1),
    pageNumber: z.number().int().positive(),
    text: z.string().max(100000),
  });
  registry.registerStep('example.document.parse', 'Local documents: parse text pages', async (raw) => {
    const document = z
      .object({
        id: z.string().min(1),
        title: z.string().optional(),
        text: z.string().max(1000000).optional(),
        pages: z.array(z.string().max(100000)).min(1).max(1000).optional(),
      })
      .parse(raw);
    const pages = document.pages ?? document.text?.split('\f');
    if (!pages?.length)
      throw new Error('Provide text or a pages array. PDF download/embedding requires a registered document adapter.');
    return pages.map((text, index) => ({ documentId: document.id, pageNumber: index + 1, text }));
  });
  registry.registerTransaction(
    'example.document.index',
    'Local documents: index page in Postgres',
    async (raw, ctx) => {
      const input = page.parse(raw);
      return ds.runTransaction(
        async () => {
          await ds.client.query(
            'INSERT INTO studio_example_pages(execution_id,document_id,page_number,content) VALUES($1,$2,$3,$4) ON CONFLICT(execution_id) DO NOTHING',
            [ctx.executionId, input.documentId, input.pageNumber, input.text],
          );
          return { documentId: input.documentId, pageNumber: input.pageNumber, indexed: true };
        },
        { name: `index:${ctx.nodeId}` },
      );
    },
  );
  registry.registerStep('example.document.summary', 'Local documents: summarize indexed pages', async (raw) => {
    const { document, pages } = z
      .object({ document: z.object({ id: z.string() }), pages: z.array(z.object({ indexed: z.boolean() })) })
      .parse(raw);
    return { documentId: document.id, pages: pages.filter((page) => page.indexed).length };
  });
  registry.registerStep('example.document.totals', 'Local documents: aggregate totals', async (raw) => {
    const documents = z.array(z.object({ documentId: z.string(), pages: z.number().int().nonnegative() })).parse(raw);
    return {
      documentCount: documents.length,
      pageCount: documents.reduce((sum, document) => sum + document.pages, 0),
      documents,
    };
  });
  const order = z.object({
    customer: z.string().min(1),
    item: z.string().min(1),
    quantity: z.number().int().positive(),
  });
  registry.registerTransaction('example.order.create', 'Local outbox: create order', async (raw, ctx) => {
    const input = order.parse(raw);
    return ds.runTransaction(
      async () => {
        await ds.client.query(
          "INSERT INTO studio_example_orders(id,customer,item,quantity,notification_status) VALUES($1,$2,$3,$4,'PENDING')",
          [ctx.runId, input.customer, input.item, input.quantity],
        );
        return { orderId: ctx.runId, ...input };
      },
      { name: `order:${ctx.nodeId}` },
    );
  });
  const notification = async (id: string, channel: string, payload: unknown) => {
    await store.pool.query(
      'INSERT INTO studio_example_notifications(id,channel,payload) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
      [id, channel, JSON.stringify(payload)],
    );
    return { delivered: true, channel, payload };
  };
  registry.registerStep('example.order.notify', 'Local outbox: deliver idempotent notification', async (raw, ctx) =>
    notification(ctx.executionId, 'local-orders', raw),
  );
  registry.registerTransaction('example.order.sent', 'Local outbox: mark order notification sent', async (raw, ctx) => {
    const { orderId } = z.object({ orderId: z.string() }).parse(raw);
    return ds.runTransaction(
      async () => {
        const result = await ds.client.query(
          "UPDATE studio_example_orders SET notification_status='SENT' WHERE id=$1 RETURNING id,notification_status",
          [orderId],
        );
        if (!result.rowCount) throw new Error('Local order not found.');
        return { orderId, status: result.rows[0].notification_status };
      },
      { name: `sent:${ctx.nodeId}` },
    );
  });
  registry.registerStep('example.notification', 'Local notification: record message', async (raw, ctx) => {
    const input = z.object({ channel: z.string(), message: z.string() }).parse(raw);
    return notification(ctx.executionId, input.channel, input);
  });
  registry.registerStep('example.deployment.stage', 'Local deployment: simulated stage result', async (raw) => {
    const { phase } = z.object({ phase: z.enum(['build', 'test', 'deploy']) }).parse(raw);
    return { phase, status: 'passed', adapter: 'local-example' };
  });
  const object = z.object({ key: z.string().min(1), content: z.string().max(1000000) });
  registry.registerStep('example.mirror.plan', 'Local mirror: filter existing objects', async (raw) => {
    const input = z
      .object({ source: z.array(object).max(100), existingKeys: z.array(z.string()).default([]) })
      .parse(raw);
    if (new Set(input.source.map((item) => item.key)).size !== input.source.length)
      throw new Error('Source object keys must be unique.');
    const existing = new Set(input.existingKeys);
    return input.source.filter((item) => !existing.has(item.key));
  });
  registry.registerStep('example.mirror.copy', 'Local mirror: persist object copy', async (raw, ctx) => {
    const input = object.parse(raw);
    await store.pool.query(
      'INSERT INTO studio_example_mirror(execution_id,object_key,content) VALUES($1,$2,$3) ON CONFLICT(execution_id) DO NOTHING',
      [ctx.executionId, input.key, input.content],
    );
    return { key: input.key, copied: true, bytes: Buffer.byteLength(input.content), adapter: 'local-example' };
  });
  registry.registerTransaction(
    'example.refund.lookup',
    'Local refunds: create and read example purchase',
    async (raw, ctx) => {
      const input = z.object({ customer: z.string(), item: z.string(), price: z.number().nonnegative() }).parse(raw);
      return ds.runTransaction(
        async () => {
          await ds.client.query(
            "INSERT INTO studio_example_refunds(order_id,customer,item,price,status) VALUES($1,$2,$3,$4,'PURCHASED')",
            [ctx.runId, input.customer, input.item, input.price],
          );
          return { orderId: ctx.runId, ...input };
        },
        { name: `purchase:${ctx.nodeId}` },
      );
    },
  );
  registry.registerTransaction('example.refund.status', 'Local refunds: update purchase status', async (raw, ctx) => {
    const input = z
      .object({ orderId: z.string(), status: z.enum(['PENDING_REFUND', 'REFUNDED', 'REFUND_REJECTED']) })
      .parse(raw);
    return ds.runTransaction(
      async () => {
        const result = await ds.client.query(
          'UPDATE studio_example_refunds SET status=$2 WHERE order_id=$1 RETURNING order_id',
          [input.orderId, input.status],
        );
        if (!result.rowCount) throw new Error('Local purchase not found.');
        return input;
      },
      { name: `refund:${ctx.nodeId}` },
    );
  });
  const article = z.object({ id: z.string(), title: z.string(), text: z.string(), url: z.string() });
  const researchState = z.object({
    count: z.number().int().nonnegative(),
    findings: z.array(article),
    queries: z.array(z.string()),
  });
  registry.registerStep(
    'example.research.search',
    'Local research: search and accumulate article findings',
    async (raw) => {
      const input = z.object({ state: researchState, topic: z.string(), articles: z.array(article) }).parse(raw);
      const words = input.topic.toLowerCase().split(/\s+/).filter(Boolean);
      const query = words[input.state.count % Math.max(1, words.length)] ?? input.topic;
      const known = new Map(input.state.findings.map((article) => [article.id, article]));
      for (const article of input.articles)
        if (`${article.title} ${article.text}`.toLowerCase().includes(query.toLowerCase()))
          known.set(article.id, article);
      return { count: input.state.count + 1, findings: [...known.values()], queries: [...input.state.queries, query] };
    },
  );
  registry.registerStep('example.research.report', 'Local research: assemble source-backed findings', async (raw) => {
    const state = researchState.parse(raw);
    return {
      passes: state.count,
      queries: state.queries,
      findings: state.findings,
      summary: state.findings.map((article) => `${article.title}: ${article.text}`).join('\n'),
      adapter: 'local-corpus',
    };
  });
}
