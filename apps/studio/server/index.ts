import { WorkspaceEvents } from './control/events';
import { ControlPlane } from './control/service';
import { SecretVault } from './control/secrets';
import { loadAuthAdapter, loadCredentialResolver } from './control/auth';
import { registerExampleHandlers } from './example-handlers';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStudioServer } from './http';
import { NodeRegistry } from './registry';
import { createRuntime } from './runtime';
import { StudioStore } from './store';

const store = new StudioStore(process.env.STUDIO_DATABASE_URL || 'postgresql://postgres:dbos@127.0.0.1:55432/studio');
await store.initialize();
const authAdapter = await loadAuthAdapter();
const control = new ControlPlane(
  store.pool,
  await SecretVault.load(!authAdapter),
  authAdapter,
  await loadCredentialResolver(),
);
await control.initialize();
const registry = new NodeRegistry();
registerExampleHandlers(registry, store);
if (process.env.STUDIO_ADAPTER_MODULE) {
  const adapter = await import(pathToFileURL(resolve(process.env.STUDIO_ADAPTER_MODULE)).href);
  if (typeof adapter.register !== 'function') throw new Error('Adapter module must export register(registry).');
  await adapter.register(registry);
}
const runtime = createRuntime(store, registry);
DBOS.setConfig({
  name: 'dbos-flow-studio',
  systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL || 'postgresql://postgres:dbos@127.0.0.1:55432/studio_dbos',
  runAdminServer: false,
});
await DBOS.launch();
await runtime.native.restore();
await runtime.reconcile();
let reconciling = false;
const timer = setInterval(async () => {
  if (reconciling) return;
  reconciling = true;
  try {
    await runtime.reconcile();
  } catch (error) {
    console.error('Studio reconciliation failed:', error);
  } finally {
    reconciling = false;
  }
}, 1000);
const workspaceEvents = new WorkspaceEvents(store.pool);
await workspaceEvents.start();
const server = createStudioServer(store, runtime, registry, control, workspaceEvents);
const port = Number(process.env.STUDIO_PORT || 3021);
server.listen(port, '127.0.0.1', () => console.log(`DBOS Studio service: http://127.0.0.1:${port}`));
async function stop() {
  clearInterval(timer);
  server.closeAllConnections();
  server.close();
  workspaceEvents.stop();
  await DBOS.shutdown();
  await store.close();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
