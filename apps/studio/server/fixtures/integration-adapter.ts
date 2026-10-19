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
