import { localMemoryEmbedder } from './agent/context/local-embeddings';
import { ToolStore } from './tools/store';
import { AgentExtensions, type AgentExtension } from './workspace-harness/extensions';
import { AgentService } from './agent/service';
import { createAgentRuntime } from './agent/runtime';
import { KnowledgeStore } from './knowledge/store';
import { IntelligenceService } from './intelligence/service';
import { createIntelligenceRuntime } from './intelligence/workflows';
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
await new ToolStore(control).initialize();
const knowledge = new KnowledgeStore(control);
await knowledge.initialize();
const intelligence = new IntelligenceService(knowledge);
let memoryEmbedder: import('./agent/context/mem0-index').MemoryEmbedder | undefined;
let agentModel: import('./agent/model').AgentModel | undefined;
let authoringAdapter: import('./intelligence/minimax').AuthoringModelAdapter | undefined;
const registry = new NodeRegistry();
const workspaceTools = new ToolStore(control);
registry.registerWorkspaceTools((input, ctx) =>
  workspaceTools.invokeWorkflow(ctx.runId, ctx.nodeId, input, ctx.signal),
);
const agentExtensions = new AgentExtensions();
registerExampleHandlers(registry, store);
if (process.env.STUDIO_ADAPTER_MODULE) {
  const adapter = await import(pathToFileURL(resolve(process.env.STUDIO_ADAPTER_MODULE)).href);
  if (typeof adapter.register !== 'function') throw new Error('Adapter module must export register(registry).');
  await adapter.register(registry);
  authoringAdapter = adapter.authoringModel;
  agentModel = adapter.agentModel;
  memoryEmbedder = adapter.memoryEmbedder;
  for (const extension of (adapter.agentExtensions ?? []) as AgentExtension[]) agentExtensions.register(extension);
}
memoryEmbedder ??= await localMemoryEmbedder();
const agent = new AgentService(knowledge, store, agentExtensions, memoryEmbedder);
await agent.initialize();
intelligence.validateNamedAgent = (ctx, definition) =>
  control.transaction(async (c) => {
    await agent.definitions.lock(c, ctx.workspace.id);
    return agent.definitions.processSnapshot(ctx, definition, c);
  });
const agentRuntime = await createAgentRuntime(agent, registry, agentModel);
const intelligenceRuntime = createIntelligenceRuntime(intelligence, authoringAdapter);
const runtime = createRuntime(store, registry);
intelligence.validateRuntime = (flow) => runtime.native.validate(flow);
DBOS.setConfig({
  name: 'dbos-flow-studio',
  systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL || 'postgresql://postgres:dbos@127.0.0.1:55432/studio_dbos',
  runAdminServer: false,
});
await DBOS.launch();
await agentRuntime.initialize();
await runtime.native.restore();
await runtime.reconcile();
await intelligenceRuntime.reconcile();
await agentRuntime.reconcile();
let reconciling = false;
const timer = setInterval(async () => {
  if (reconciling) return;
  reconciling = true;
  try {
    await runtime.reconcile();
    await intelligenceRuntime.reconcile();
    await agentRuntime.reconcile();
  } catch (error) {
    console.error('Studio reconciliation failed:', error);
  } finally {
    reconciling = false;
  }
}, 1000);
const workspaceEvents = new WorkspaceEvents(store.pool);
await workspaceEvents.start();
const server = createStudioServer(store, runtime, registry, control, workspaceEvents, {
  knowledge,
  intelligence,
  agent,
});
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
