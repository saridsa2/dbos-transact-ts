import { registerPatternHandlers } from './pattern-handlers';
import { NodePostgresDataSource } from '@dbos-inc/node-pg-datasource';
import type { NodeRegistry } from './registry';
import type { StudioStore } from './store';
/** Deliberate local example adapters, like the stubs in txd-dbos. They never
 * contact a fleet, payment provider, email service, or model provider. */
export function registerExampleHandlers(registry: NodeRegistry, store: StudioStore) {
  const datasource = new NodePostgresDataSource(
    'studio-examples',
    { connectionString: process.env.STUDIO_DATABASE_URL || 'postgresql://postgres:dbos@127.0.0.1:55432/studio' },
    'studio_transactions',
  );
  registerPatternHandlers(registry, store, datasource);
  registry.registerStep('core.identity', 'Return input', async (input) => input);
  registry.registerStep('example.confirmation', 'Example: prepare confirmation', async (input) => ({
    confirmation: input,
  }));
  registry.registerStep('example.reminder', 'Example: prepare reminder', async (input) => ({ reminder: input }));
  registry.registerStep('example.health', 'Example: check congestion', async (input) => ({
    client: input,
    unhealthy: Boolean((input as { unhealthy?: boolean })?.unhealthy),
  }));
  registry.registerStep('example.decommission', 'Example: decommission client', async (input) => ({
    decommissioned: input,
  }));
  registry.registerStep('example.machine', 'Example: provision replacement', async (input) => ({
    machine: `replacement-${(input as { id?: string })?.id || 'client'}`,
  }));
  registry.registerStep('example.startup', 'Example: initialize replacement', async (input) => ({
    client: input,
    ready: true,
  }));
  registry.registerStep('example.register', 'Example: register replacement', async (input) => ({ registered: input }));
  registry.registerStep('example.increment', 'Example: advance loop state', async (input) => ({
    count: Number((input as { count: number }).count) + 1,
  }));
  registry.registerStep('example.fail', 'Example: raise a recoverable error', async () => {
    throw new Error('Deliberate example failure.');
  });
  registry.registerStep('example.filterHealth', 'Example: collect unhealthy clients', async (input) => {
    if (!Array.isArray(input)) throw new Error('Expected health results.');
    return input.filter((item) => item?.unhealthy).map((item) => item.client);
  });
  registry.registerTransaction('example.reserve', 'Example: reserve inventory', async (_input, context) =>
    datasource.runTransaction(
      async () => {
        await datasource.client.query(
          'INSERT INTO studio_example_inventory(run_id,available) VALUES($1,1) ON CONFLICT DO NOTHING',
          [context.runId],
        );
        const result = await datasource.client.query(
          'UPDATE studio_example_inventory SET available=available-1 WHERE run_id=$1 AND available>0 RETURNING available',
          [context.runId],
        );
        if (!result.rowCount) throw new Error('Insufficient example inventory.');
        return { reserved: true };
      },
      { name: `reserve:${context.nodeId}` },
    ),
  );
  registry.registerTransaction('example.restoreInventory', 'Example: restore inventory', async (_input, context) =>
    datasource.runTransaction(
      async () => {
        const result = await datasource.client.query(
          'UPDATE studio_example_inventory SET available=available+1 WHERE run_id=$1 RETURNING available',
          [context.runId],
        );
        return { available: result.rows[0]?.available };
      },
      { name: `restore:${context.nodeId}` },
    ),
  );
  registry.registerTransaction('example.ledger', 'Example: transactional ledger entry', async (input, context) => {
    return datasource.runTransaction(
      async () => {
        await datasource.client.query('INSERT INTO studio_example_ledger(run_id,operation,value) VALUES($1,$2,$3)', [
          context.runId,
          context.nodeId,
          JSON.stringify(input),
        ]);
        return { recorded: input };
      },
      { name: `ledger:${context.nodeId}` },
    );
  });
  registry.registerTransaction('example.ledgerCount', 'Example: count ledger entries', async (_input, context) => {
    return datasource.runTransaction(
      async () =>
        Number(
          (
            await datasource.client.query('SELECT count(*) AS count FROM studio_example_ledger WHERE run_id=$1', [
              context.runId,
            ])
          ).rows[0].count,
        ),
      { name: `ledgerCount:${context.nodeId}`, readOnly: true },
    );
  });
}
