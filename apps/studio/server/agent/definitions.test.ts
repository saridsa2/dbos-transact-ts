import { describe, it, expect, vi } from 'vitest';
import { definitionSchema } from '../../lib/agent/definitions';
import { AgentDefinitions } from './definitions';
const resource = { kind: 'ontology' as const, id: crypto.randomUUID(), revisionId: crypto.randomUUID() };
const definition = {
  schemaVersion: 1,
  kind: 'specialist',
  name: 'Reviewer',
  description: 'Inspect context',
  instructions: 'Use evidence.',
  model: { provider: 'minimax', connectionId: crypto.randomUUID(), connectionRevision: 1 },
  tools: ['artifact_read_v1', 'ontology_propose_v1'],
  context: { scope: 'selected', resources: [resource] },
  limits: { turns: 4, tools: 6, outputTokens: 1024 },
  interaction: 'interactive',
};
describe('workspace-owned agent contracts and resource boundary', () => {
  it('resolves followed resource heads once per invocation without changing published references', async () => {
    let head = crypto.randomUUID();
    const profile = definitionSchema.parse({ ...definition, context: { ...definition.context, followHead: true } }),
      hash = 'a'.repeat(64);
    const config = {
      enabled: true,
      allowModel: true,
      mode: 'assist',
      connectionId: profile.model.connectionId,
      connectionRevision: 1,
      limits: profile.limits,
    };
    const service: any = {
      knowledge: {
        get: vi.fn().mockImplementation(async (_ctx, _id, revisionId) => ({
          artifact: { kind: 'ontology' },
          revision: { id: revisionId ?? head },
        })),
      },
    };
    const c: any = {
      query: vi.fn().mockImplementation(async (sql: string) => ({
        rows: [
          sql.includes('d.enabled')
            ? { enabled: true, content_hash: hash, definition: profile }
            : sql.includes('edit_version')
              ? { enabled: true, edit_version: 1, config }
              : { config },
        ],
      })),
    };
    const definitions = new AgentDefinitions(service),
      ctx: any = { workspace: { id: 'workspace' }, user: { id: 'actor' } },
      ref = { agentId: crypto.randomUUID(), revision: 1, hash };
    const first = await definitions.resolve(ctx, ref, c),
      firstHead = head;
    head = crypto.randomUUID();
    const second = await definitions.resolve(ctx, ref, c);
    expect(first.contextResources?.[0].revisionId).toBe(firstHead);
    expect(second.contextResources?.[0].revisionId).toBe(head);
    expect(first.definition.context.resources[0].revisionId).toBe(resource.revisionId);
    expect(first.ref).toEqual(second.ref);
    expect(first.hash).not.toBe(second.hash);
  });
  it('rejects unsupported capabilities, duplicate tools and specialist authority expansion', () => {
    expect(definitionSchema.safeParse(definition).success).toBe(true);
    for (const value of [
      { ...definition, tools: ['agent_delegate_v1'] },
      { ...definition, tools: ['artifact_read_v1', 'artifact_read_v1'] },
      { ...definition, context: { ...definition.context, scope: 'workspace_inventory' } },
      { ...definition, tools: ['workspace_suggestion_propose_v1'] },
      { ...definition, interaction: 'structured_output' },
    ])
      expect(definitionSchema.safeParse(value).success).toBe(false);
  });
  it('pins reads and rejects other resources, revision expansion and stale proposals', async () => {
    const service: any = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [{ execution_snapshot: { definition } }] }) },
      knowledge: { get: vi.fn().mockResolvedValue({ revision: { id: crypto.randomUUID() } }) },
    };
    const definitions = new AgentDefinitions(service);
    vi.spyOn(definitions, 'access').mockResolvedValue({} as any);
    const ctx: any = { workspace: { id: crypto.randomUUID() } },
      args: any = { id: resource.id };
    await definitions.guard(ctx, 'work', 'artifact_read_v1', args);
    expect(args.revisionId).toBe(resource.revisionId);
    await expect(definitions.guard(ctx, 'work', 'artifact_read_v1', { id: crypto.randomUUID() })).rejects.toThrow(
      'outside',
    );
    await expect(
      definitions.guard(ctx, 'work', 'artifact_read_v1', { id: resource.id, revisionId: crypto.randomUUID() }),
    ).rejects.toThrow('revision');
    await expect(definitions.guard(ctx, 'work', 'ontology_propose_v1', { id: resource.id })).rejects.toThrow('changed');
    await expect(definitions.guard(ctx, 'work', 'memory_search_v1', {})).rejects.toThrow('profile');
  });
  it('does not let viewers write drafts or editors publish them', async () => {
    const definitions = new AgentDefinitions({} as any);
    await expect(definitions.save({ workspace: { role: 'viewer' } } as any, undefined, {})).rejects.toThrow('editor');
    await expect(definitions.publish({ workspace: { role: 'editor' } } as any, 'id', {})).rejects.toThrow(
      'administrators',
    );
  });
});
