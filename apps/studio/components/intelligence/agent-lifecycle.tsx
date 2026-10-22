'use client';
import { activityTitle, activityError, toolLabel } from '@/lib/agent/presentation';
/** Product composition and durable adapters for the licensed catalog components. */
import { WorkspaceMemory, MemoryReadiness } from './memory';
import { defaultMemoryPolicy } from '@/lib/agent/memory';
import { BadgeWithDot, BadgeWithIcon } from '@/components/base/badges/badges';
import { readSetupProgress } from '@/lib/agent/setup-progress';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkToolReferences } from '@/lib/agent/tool-references';
import { ToolLink } from '@/components/tools/tool-link';
import { builtinToolHref } from '@/lib/agent/tool-catalog';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWorkspaceRefresh } from '@/hooks/use-workspace-events';
import { AgentList } from '@/vendor/aisdkagents/agent-list';
import { AgentCreate } from '@/vendor/aisdkagents/agent-create';
import { AgentSummary } from '@/vendor/aisdkagents/agent-summary';
import { GenerativeForm, type GenerativeFormField } from '@/vendor/aisdkagents/generative-form';
import { ArtifactPanel } from '@/vendor/aisdkagents/artifact-panel';
import { AgentGate } from '@/vendor/aisdkagents/agent-gate';
import { DecisionInbox } from '@/vendor/aisdkagents/decision-inbox';
import { EmptyState } from '@/components/application/empty-state/empty-state';
import { TextField, InputBase } from '@/components/base/input/input';
import {
  AgentIcon,
  Check,
  TimerIcon,
  WarningIcon,
  X,
  Plus,
  SearchLg,
  LayersIcon,
  ArrowRightIcon,
  InfoCircle,
  ShieldCheck,
  DatabaseIcon,
} from '@/components/fa-icons';
import { RunLog } from '@/vendor/aisdkagents/run-log';
import { KnowledgeSources } from '@/vendor/aisdkagents/knowledge-sources';
import { agentResourceHref } from '@/lib/agent/resource-links';
import { ThinkingState } from '@/vendor/aisdkagents/thinking-state';
import { IntelligenceShell, IntelligenceSidebarToggle, intelligenceDestinations } from './intelligence-shell';
import { ControlButton, ControlInput, ControlSelect, ControlModal } from '@/components/control/controls';
import { useUnsavedChanges } from '@/components/control/unsaved-changes';
import { Tabs } from '@/components/application/tabs/tabs';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { FullscreenWorkbench } from '@/components/workspace/fullscreen-workbench';
import { agentRequest } from '@/lib/agent/client';
import { controlRequest } from '@/components/control/access';
import { definitionSchema, definitionToolNames, type AgentDefinition } from '@/lib/agent/definitions';
import { agentActiveStates, workStatus } from '@/lib/agent/status';
import { AgentSettings } from './agent-settings';
function activityIcon(state: string) {
  const Icon =
    state === 'completed'
      ? Check
      : state === 'cancelled'
        ? X
        : ['failed', 'uncertain', 'budget_exhausted', 'suspended'].includes(state)
          ? WarningIcon
          : TimerIcon;
  return (
    <span className="wi-activity-mark" data-state={state}>
      <Icon />
    </span>
  );
}
type DefinitionRow = {
  id: string;
  name: string;
  description?: string;
  kind: string;
  editVersion: number;
  publishedRevision: number | null;
  enabled: boolean;
  archivedAt: string | null;
  draftHash: string;
  draft?: AgentDefinition;
  published?: { agentId: string; revision: number; hash: string; definition: AgentDefinition };
};
type Resource = { id: string; revisionId: string; kind: 'source' | 'ontology' | 'process'; name: string };
export function AgentLifecycle({ view, allowed, manager }: { view: string; allowed: boolean; manager: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [agentTab, setAgentTab] = useState('configuration');
  const [editSection, setEditSection] = useState('identity');
  const [setupStage, setSetupStage] = useState('purpose');
  const [setupInputs, setSetupInputs] = useState<Record<string, unknown>>({});
  const [gapActions, setGapActions] = useState<Record<number, string>>({});
  const [publicationReview, setPublicationReview] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [creationText, setCreationText] = useState('');
  const params = useSearchParams();
  const [definitions, setDefinitions] = useState<DefinitionRow[]>([]),
    [activities, setActivities] = useState<any[]>([]),
    [suggestions, setSuggestions] = useState<any[]>([]),
    [setups, setSetups] = useState<any[]>([]),
    [resources, setResources] = useState<Resource[]>([]);
  const [policy, setPolicy] = useState<any>(),
    [selected, setSelected] = useState<any>(),
    [summary, setSummary] = useState<any>(),
    [job, setJob] = useState<any>(),
    [setup, setSetup] = useState<any>();
  const [coordinator, setCoordinator] = useState<any>();
  const [overviewMemory, setOverviewMemory] = useState<{
    configured: boolean;
    available: boolean;
    approved: number;
    graph?: { initialized: boolean; nodes: Record<string, number> };
  }>();
  const [memoryCheckFailed, setMemoryCheckFailed] = useState(false);
  const [automaticReview, setAutomaticReview] = useState<any>(),
    [startInspection, setStartInspection] = useState(false);
  const [creating, setCreating] = useState(false),
    [editing, setEditing] = useState(false),
    [archiveReview, setArchiveReview] = useState(false),
    [settings, setSettings] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [gaps, setGaps] = useState<number[]>([]);
  useWorkspaceRefresh(() => setRefresh((n) => n + 1));
  useEffect(() => {
    if (view !== 'overview') return;
    let alive = true;
    setMemoryCheckFailed(false);
    void agentRequest('memory/status')
      .then((value) => {
        if (alive) setOverviewMemory(value);
      })
      .catch(() => {
        if (alive) {
          setOverviewMemory(undefined);
          setMemoryCheckFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [view, refresh]);
  const navigate = useUnsavedChanges(editorDirty || (creating && !!creationText.trim()));
  const pendingRequest = params.get('request');
  useEffect(() => {
    if (!pendingRequest) return;
    let alive = true,
      fetching = false,
      finished = false;
    const poll = async () => {
      if (fetching || finished) return;
      fetching = true;
      try {
        const receipt = await agentRequest(`requests/${pendingRequest}`);
        if (!alive) return;
        if (receipt.state === 'rejected') {
          finished = true;
          setError(receipt.error ?? 'The request could not start.');
        } else if (receipt.sessionId)
          router.replace(
            `/intelligence?session=${encodeURIComponent(receipt.sessionId)}${receipt.workItemId ? `&activity=${encodeURIComponent(receipt.workItemId)}` : ''}`,
          );
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not read request.');
      } finally {
        fetching = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pendingRequest, router]);
  const command = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const loaded = useRef(false),
    mutating = useRef(false);
  const commandKey = (value: unknown) => {
    const fingerprint = JSON.stringify(value);
    if (command.current?.fingerprint !== fingerprint) command.current = { fingerprint, key: crypto.randomUUID() };
    return command.current.key;
  };
  const run = async (fn: () => Promise<void>) => {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
      command.current = undefined;
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed.');
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    let alive = true;
    setLoading(!loaded.current);
    setError('');
    void Promise.all([
      agentRequest('definitions'),
      agentRequest('activities'),
      agentRequest('suggestions'),
      agentRequest('setup-runs'),
      agentRequest('state'),
      controlRequest('/api/knowledge/artifacts'),
      agentRequest('coordinator-review'),
    ])
      .then(([d, a, s, u, p, r, automatic]) => {
        if (alive) {
          loaded.current = true;
          setDefinitions(d.items);
          setActivities(a.items);
          setSuggestions(s.items);
          setSetups(u.items);
          setPolicy(p.configuration);
          setCoordinator(p.coordinator);
          setAutomaticReview(automatic);
          setResources(r.items.map((v: any) => ({ id: v.id, revisionId: v.revisionId, kind: v.kind, name: v.name })));
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  const selectionEpoch = useRef(0);
  const selectedAgentId = params.get('agent');
  const selectedSetupId = params.get('setup');
  const openAgent = async (id: string, updateUrl = true) => {
    setAgentTab('configuration');
    setEditSection('identity');
    setPublicationReview(false);
    setKnowledgeQuery('');
    const epoch = ++selectionEpoch.current;
    setError('');
    try {
      const data = await agentRequest(`definitions/${id}/summary`);
      if (epoch !== selectionEpoch.current) return;
      if (updateUrl) router.replace(`/intelligence?view=agents&agent=${encodeURIComponent(id)}`);
      setArchiveReview(false);
      setSelected(data.definition);
      setSummary(data);
      setEditing(false);
      setCreating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load agent.');
    }
  };
  useEffect(() => {
    if (view === 'agents' && selectedAgentId && selected?.id !== selectedAgentId)
      void openAgent(selectedAgentId, false);
    else if (view === 'agents' && !selectedAgentId) {
      setSelected(undefined);
      setSummary(undefined);
    }
  }, [view, selectedAgentId]);
  useEffect(() => {
    if (view !== 'agents' || !automaticReview?.enabled || selected?.id !== coordinator?.agentId) return;
    let active = true;
    const timer = setInterval(
      () =>
        void agentRequest('coordinator-review')
          .then((next) => {
            if (active) setAutomaticReview(next);
          })
          .catch((e) => {
            if (active) setError(e.message);
          }),
      5000,
    );
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [view, automaticReview?.enabled, selected?.id, coordinator?.agentId]);
  const openSession = (id: string, activity?: string) =>
    router.push(
      `/intelligence?session=${encodeURIComponent(id)}${activity ? `&activity=${encodeURIComponent(activity)}` : ''}`,
    );
  useEffect(() => {
    const target = job ?? setup;
    if (
      !target ||
      target.bundle ||
      target.projectionError ||
      target.request?.state === 'rejected' ||
      ['failed', 'uncertain', 'cancelled', 'suspended', 'budget_exhausted'].includes(target.work?.state)
    )
      return;
    let alive = true,
      fetching = false;
    const poll = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const target = job ?? setup;
        const next = await readSetupProgress(agentRequest, target.id);
        if (!alive) return;
        if (job) setJob(next);
        else setSetup(next);
        if (next.projectionError) throw Error(activityError(next.projectionError));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not update activity.');
      } finally {
        fetching = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [
    job?.id,
    setup?.id,
    job?.bundleHash,
    setup?.bundleHash,
    job?.work?.state,
    setup?.work?.state,
    job?.projectionError,
    setup?.projectionError,
    job?.request?.state,
    setup?.request?.state,
  ]);
  useEffect(() => {
    setGaps([]);
    setGapActions({});
  }, [setup?.id, setup?.bundleHash]);
  const scopedFields: GenerativeFormField[] = resources.map((r, i) => ({
    name: `source_${i}`,
    label: `${r.name} · ${r.kind}`,
    type: 'boolean',
    section: i === 0 ? 'Authorized knowledge' : undefined,
    hidden: !`${r.name} ${r.kind}`.toLowerCase().includes(knowledgeQuery.toLowerCase()),
  }));
  const sourceSelection = (values: Record<string, unknown>) =>
    resources
      .filter((_, i) => values[`source_${i}`] === true)
      .map(({ id, revisionId, kind }) => ({ id, revisionId, kind }));
  const defaultDefinition = (): AgentDefinition =>
    definitionSchema.parse({
      schemaVersion: 1,
      kind: 'specialist',
      name: 'New specialist',
      description: '',
      instructions: 'Inspect the assigned knowledge and report findings with evidence.',
      model: { provider: 'minimax', connectionId: policy.connectionId, connectionRevision: policy.connectionRevision },
      tools: ['workspace_describe_v1', 'artifact_read_v1', 'ontology_validate_v1', 'ask_user_v2'],
      context: { scope: 'selected', resources: [] },
      limits: policy.limits,
      interaction: 'interactive',
    });
  const startManual = () => {
    try {
      setSelected({
        draft: {
          ...defaultDefinition(),
          ...(creationText.trim() ? { description: creationText.trim(), instructions: creationText.trim() } : {}),
        },
        editVersion: 0,
      });
      setEditing(true);
      setCreating(false);
      setJob(undefined);
    } catch {
      setError('Configure a MiniMax connection in workspace policy before drafting an agent.');
    }
  };
  const operate = (row: DefinitionRow, status: string) =>
    void run(async () => {
      await agentRequest(`definitions/${row.id}/${status === 'live' ? 'resume' : 'pause'}`, {
        clientKey: commandKey([row.id, row.editVersion, status]),
        expectedVersion: row.editVersion,
      });
      if (selected?.id === row.id) await openAgent(row.id);
    });
  const selectedDefinition = selected?.draft as AgentDefinition | undefined;
  const editFields: GenerativeFormField[] = [
    { section: 'Responsibility', name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'description', label: 'Responsibility', type: 'longtext' },
    { name: 'instructions', label: 'Instructions', type: 'longtext', required: true },
    {
      section: 'Context and memory',
      name: 'memoryEnabled',
      label: 'Use durable working memory and proactive context compaction',
      type: 'boolean',
    },
    { name: 'memoryHistory', label: 'Use bounded observation and reflection for long histories', type: 'boolean' },
    {
      name: 'memoryIndex',
      label: 'Use semantic memory recall (requires available local embeddings)',
      type: 'boolean',
    },
    {
      name: 'memoryScope',
      label: 'Approved memory retrieval',
      type: 'select',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'agent', label: 'This agent only' },
        { value: 'workspace', label: 'Authorized workspace and agent memory' },
      ],
    },
    { section: 'Runtime limits', name: 'turns', label: 'Maximum reasoning turns', type: 'number', required: true },
    { name: 'tools', label: 'Maximum tool calls', type: 'number', required: true },
    { name: 'outputTokens', label: 'Maximum output tokens per response', type: 'number', required: true },
    {
      name: 'interaction',
      label: 'Response mode',
      type: 'select',
      required: true,
      options: [
        { value: 'interactive', label: 'Interactive · can ask questions' },
        { value: 'structured_output', label: 'Structured result · no user questions' },
      ],
    },
    {
      name: 'outputSchema',
      label: 'Result JSON Schema',
      type: 'longtext',
      visibleWhen: { name: 'interaction', value: 'structured_output' },
    },
    {
      section: 'Knowledge revision policy',
      name: 'followHead',
      label: 'Use the latest saved revision of selected resources for future assignments',
      type: 'boolean',
    },
    ...definitionToolNames
      .filter((t) => selectedDefinition?.kind === 'coordinator' || t !== 'workspace_suggestion_propose_v1')
      .map((t, index) => ({
        section: index === 0 ? 'Permitted capabilities' : undefined,
        name: `tool_${t}`,
        label: t.replaceAll('_v1', '').replaceAll('_v2', '').replaceAll('_', ' '),
        type: 'boolean' as const,
      })),
    ...scopedFields,
  ];
  const editObject = selectedDefinition
    ? {
        name: selectedDefinition.name,
        description: selectedDefinition.description,
        instructions: selectedDefinition.instructions,
        memoryEnabled: !!selectedDefinition.memory,
        memoryHistory: selectedDefinition.memory?.history === 'observational_v1',
        memoryIndex: selectedDefinition.memory?.index === 'mem0_v1',
        memoryScope: selectedDefinition.memory?.approved ?? 'off',
        turns: selectedDefinition.limits.turns,
        tools: selectedDefinition.limits.tools,
        outputTokens: selectedDefinition.limits.outputTokens,
        interaction: selectedDefinition.interaction,
        outputSchema: JSON.stringify(
          selectedDefinition.outputSchema ?? { type: 'object', properties: {}, additionalProperties: false },
          null,
          2,
        ),
        followHead: !!selectedDefinition.context.followHead,
        ...Object.fromEntries(definitionToolNames.map((t) => [`tool_${t}`, selectedDefinition.tools.includes(t)])),
        ...Object.fromEntries(
          resources.map((r, i) => [
            `source_${i}`,
            selectedDefinition.context.resources.some(
              (s) => s.id === r.id && (selectedDefinition.context.followHead || s.revisionId === r.revisionId),
            ),
          ]),
        ),
      }
    : {};
  const reviewSetup = async (id: string, updateUrl = true) => {
    try {
      setSetup(await agentRequest(`setup-runs/${id}`));
      if (updateUrl) router.replace(`/intelligence?view=setup&setup=${encodeURIComponent(id)}`);
      setGaps([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load setup.');
    }
  };
  useEffect(() => {
    if (view === 'setup' && selectedSetupId && setup?.id !== selectedSetupId) void reviewSetup(selectedSetupId, false);
  }, [view, selectedSetupId]);
  const assistanceAllowed = !!(policy?.enabled && policy?.allowModel && policy?.mode === 'assist');
  const coordinatorActive = !!(coordinator?.enabled && !coordinator?.archivedAt);
  const gapCount = coordinator?.content?.gaps?.length ?? 0;
  const readinessLabel = gapCount
    ? 'Gaps to review'
    : !resources.length || !assistanceAllowed || !coordinatorActive
      ? 'Setup needed'
      : memoryCheckFailed
        ? 'Check needed'
        : !overviewMemory
          ? 'Checking memory'
          : !overviewMemory.graph?.initialized
            ? 'Check needed'
            : !overviewMemory.available
              ? 'Memory unavailable'
              : 'Configured';
  const openReadinessReview = () => {
    const activated = setups.find((entry) => entry.activatedAt);
    if (activated) void reviewSetup(activated.id);
    else router.push('/intelligence?view=setup');
  };
  return (
    <IntelligenceShell
      view={view}
      onPolicy={manager ? () => setSettings(true) : undefined}
      pendingSuggestions={suggestions.filter((s) => s.state === 'proposed').length}
    >
      <FullscreenWorkbench
        title={intelligenceDestinations.find((item) => item.id === view)?.label ?? 'Overview'}
        showBrand={false}
        showBack={false}
        leading={<IntelligenceSidebarToggle />}
        actions={
          <div className="wi-header-controls">
            {['activities', 'suggestions'].includes(view) && (
              <>
                <TextField aria-label={`Search ${view}`} className="wi-header-search">
                  <InputBase
                    icon={SearchLg}
                    size="sm"
                    aria-label={`Search ${view}`}
                    placeholder={`Search ${view}`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </TextField>
                <ControlSelect aria-label={`Filter ${view}`} value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="all">All {view}</option>
                  {view === 'activities' ? (
                    <>
                      <option value="attention">Needs attention</option>
                      <option value="active">In progress</option>
                      <option value="completed">Completed</option>
                    </>
                  ) : (
                    <>
                      <option value="proposed">Pending review</option>
                      <option value="accepted">Accepted</option>
                      <option value="dismissed">Dismissed</option>
                    </>
                  )}
                </ControlSelect>
              </>
            )}
            {(view === 'activities' || (view === 'overview' && coordinator)) && allowed && (
              <ControlButton
                color="primary"
                iconLeading={Plus}
                onPress={() => router.push('/intelligence?view=conversation')}
              >
                New activity
              </ControlButton>
            )}
            {view === 'agents' && selected && !selected.archivedAt && !editing && (
              <div className="wi-record-actions">
                {selected.enabled && selected.published && allowed && (
                  <ControlButton
                    color="primary"
                    onPress={() =>
                      navigate(() => router.push(`/intelligence?view=conversation&executor=${selected.id}`))
                    }
                  >
                    Create activity with this agent
                  </ControlButton>
                )}
                {manager && selected.id && selected.draftHash !== selected.published?.hash && (
                  <ControlButton
                    color="primary"
                    onPress={() => {
                      setAgentTab('configuration');
                      setPublicationReview(true);
                    }}
                  >
                    Review and publish
                  </ControlButton>
                )}
                {allowed && (
                  <ControlButton
                    onPress={() => {
                      setAgentTab('configuration');
                      setEditing(true);
                    }}
                  >
                    Edit draft
                  </ControlButton>
                )}
                {manager && selected.id && (
                  <ControlButton
                    onPress={() => {
                      setAgentTab('configuration');
                      setArchiveReview(true);
                    }}
                  >
                    Archive agent
                  </ControlButton>
                )}
              </div>
            )}

            {view === 'agents' && allowed && !selected && (
              <ControlButton
                color="primary"
                iconLeading={Plus}
                onPress={() =>
                  navigate(() => {
                    setCreating(true);
                    setCreationText('');
                    setSelected(undefined);
                    setJob(undefined);
                  })
                }
              >
                New specialist
              </ControlButton>
            )}
          </div>
        }
      >
        {settings && <AgentSettings onClose={() => setSettings(false)} onSaved={() => setRefresh((n) => n + 1)} />}
        <div className={`wi-lifecycle-scroll${view === 'agents' ? ' wi-lifecycle-scroll--agents' : ''}`}>
          {view === 'activities' && !loading && !coordinator && (
            <div className="wi-setup-notice">
              <InfoCircle />
              <p>Workspace agent setup is optional for existing activities. Configure it to receive suggested work.</p>
              <ControlButton iconTrailing={ArrowRightIcon} onPress={() => router.push('/intelligence?view=setup')}>
                Workspace setup
              </ControlButton>
            </div>
          )}
          {error && (
            <p className="wi-error" role="alert">
              {activityError(error)}
            </p>
          )}
          {loading && <p role="status">Loading workspace intelligence…</p>}
          {!loading && view === 'overview' && (
            <div className="wi-overview">
              <div className="wi-overview-intro">
                <h2>{coordinator ? 'Workspace purpose' : 'Give this workspace a shared understanding'}</h2>
                <p>
                  {coordinator
                    ? coordinator.content?.purpose
                    : 'Select the evidence, establish a purpose and review the workspace agent before activation.'}
                </p>
              </div>
              <div className="wi-overview-grid">
                <div className="wi-overview-primary">
                  {coordinator ? (
                    <AgentSummary
                      icon={<AgentIcon />}
                      name={definitions.find((d) => d.id === coordinator?.agentId)?.name ?? 'Workspace agent'}
                      description={
                        coordinator
                          ? `${coordinator.sources?.length ?? 0} authorized knowledge revisions · ${coordinator.content?.gaps?.length ?? 0} accepted gaps`
                          : 'No workspace agent has been configured. Add knowledge, then review and activate your agent.'
                      }
                      status={
                        !coordinator
                          ? 'draft'
                          : coordinator.enabled && !coordinator.archivedAt && policy?.enabled
                            ? 'live'
                            : 'paused'
                      }
                      attention={{
                        text: !coordinator
                          ? 'Start with your workspace purpose and saved knowledge.'
                          : suggestions.some((s) => s.state === 'proposed')
                            ? 'Suggested work is waiting for your review.'
                            : 'Review knowledge coverage and operating rules before assigning new work.',
                        actionLabel: !coordinator
                          ? 'Set up workspace agent'
                          : suggestions.some((s) => s.state === 'proposed')
                            ? 'Review suggestions'
                            : 'Review workspace setup',
                        onAction: () =>
                          router.push(
                            `/intelligence?view=${coordinator && suggestions.some((s) => s.state === 'proposed') ? 'suggestions' : 'setup'}`,
                          ),
                      }}
                    />
                  ) : (
                    <section className="wi-section">
                      <h2>Workspace agent</h2>
                      <p>Not configured</p>
                      <p>Add saved knowledge and configure provider access before setting up your workspace agent.</p>
                      <div className="wi-action-row">
                        <ControlButton onPress={() => router.push('/sources')}>Add sources</ControlButton>
                        {manager && <ControlButton onPress={() => setSettings(true)}>Configure policy</ControlButton>}
                        {manager && (
                          <ControlButton onPress={() => router.push('/intelligence?view=setup')}>
                            Set up workspace agent
                          </ControlButton>
                        )}
                      </div>
                    </section>
                  )}
                  <section className="wi-section wi-readiness" aria-label="Workspace readiness">
                    <div className="wi-readiness-heading">
                      <h3>Workspace readiness</h3>
                      <BadgeWithDot
                        size="md"
                        className={`wi-readiness-status wi-readiness-status--${readinessLabel === 'Configured' ? 'ready' : ['Gaps to review', 'Memory unavailable', 'Check needed'].includes(readinessLabel) ? 'attention' : 'pending'}`}
                        color={
                          readinessLabel === 'Configured'
                            ? 'success'
                            : ['Gaps to review', 'Memory unavailable', 'Check needed'].includes(readinessLabel)
                              ? 'warning'
                              : 'gray'
                        }
                      >
                        {readinessLabel}
                      </BadgeWithDot>
                    </div>
                    <ul className="wi-readiness-indicators" aria-label="Readiness checks">
                      <li data-state={resources.length ? 'ready' : 'pending'}>
                        <span className="wi-readiness-icon">
                          <LayersIcon aria-hidden="true" />
                        </span>
                        <div>
                          <span>Knowledge</span>
                          <strong>{resources.length} records</strong>
                        </div>
                        {resources.length > 0 && <Check className="wi-readiness-check" aria-hidden="true" />}
                      </li>
                      <li data-state={assistanceAllowed ? 'ready' : 'pending'}>
                        <span className="wi-readiness-icon">
                          <ShieldCheck aria-hidden="true" />
                        </span>
                        <div>
                          <span>Assistance policy</span>
                          <strong>{assistanceAllowed ? 'Allowed' : 'Off'}</strong>
                        </div>
                        {assistanceAllowed && <Check className="wi-readiness-check" aria-hidden="true" />}
                      </li>
                      <li data-state={coordinatorActive ? 'ready' : 'pending'}>
                        <span className="wi-readiness-icon">
                          <AgentIcon aria-hidden="true" />
                        </span>
                        <div>
                          <span>Workspace agent</span>
                          <strong>{!coordinator ? 'Not set up' : coordinatorActive ? 'Active' : 'Paused'}</strong>
                        </div>
                        {coordinatorActive && <Check className="wi-readiness-check" aria-hidden="true" />}
                      </li>
                      <li data-state={overviewMemory?.available ? 'ready' : 'pending'} aria-live="polite">
                        <span className="wi-readiness-icon">
                          <DatabaseIcon aria-hidden="true" />
                        </span>
                        <div>
                          <span>Memory graph & retrieval</span>
                          <strong>
                            {memoryCheckFailed
                              ? 'Check failed'
                              : !overviewMemory
                                ? 'Checking…'
                                : !overviewMemory.graph?.initialized
                                  ? 'Graph not initialized'
                                  : overviewMemory.available
                                    ? 'Graph ready · search available'
                                    : 'Graph ready · search unavailable'}
                          </strong>
                        </div>
                        {overviewMemory?.available && <Check className="wi-readiness-check" aria-hidden="true" />}
                      </li>
                    </ul>
                    <div className="wi-readiness-footer">
                      <span>
                        <ShieldCheck aria-hidden="true" />
                        {automaticReview?.enabled ? 'Automatic review' : 'Manual review'}
                      </span>
                      <div className="wi-readiness-links">
                        {memoryCheckFailed && (
                          <ControlButton onPress={() => setRefresh((n) => n + 1)}>Retry memory check</ControlButton>
                        )}
                        {coordinator?.content?.gaps?.length > 0 && (
                          <ControlButton
                            iconLeading={WarningIcon}
                            iconTrailing={ArrowRightIcon}
                            onPress={openReadinessReview}
                          >
                            Review {coordinator.content.gaps.length} gaps
                          </ControlButton>
                        )}
                        {(activities.some((a) =>
                          ['waiting_for_user', 'ready_for_review', 'uncertain', 'failed', 'budget_exhausted'].includes(
                            a.state,
                          ),
                        ) ||
                          suggestions.some((s) => s.state === 'proposed')) && (
                          <ControlButton
                            iconTrailing={ArrowRightIcon}
                            onPress={() =>
                              router.push(
                                `/intelligence?view=${suggestions.some((s) => s.state === 'proposed') ? 'suggestions' : 'activities'}`,
                              )
                            }
                          >
                            Review pending work
                          </ControlButton>
                        )}
                      </div>
                    </div>
                  </section>
                  <RunLog
                    title="Recent activity"
                    caption="Latest work and outcomes"
                    visibleColumns={['started']}
                    runs={activities.slice(0, 4).map((a) => ({
                      id: a.id,
                      name: activityTitle(a.goal),
                      icon: activityIcon(a.state),
                      status: agentActiveStates.includes(a.state)
                        ? 'running'
                        : ['failed', 'uncertain', 'budget_exhausted'].includes(a.state)
                          ? 'error'
                          : 'ok',
                      stateLabel: workStatus(a.state),
                      startedAt: a.createdAt,
                    }))}
                    onSelect={(row) => {
                      const activity = activities.find((a) => a.id === row.id);
                      if (activity) openSession(activity.sessionId, activity.id);
                    }}
                  />
                </div>
                <KnowledgeSources
                  title="Saved knowledge inventory"
                  emptyMessage="Add knowledge in the workspace to give the agent evidence to work with."
                  sources={resources.map((r) => ({
                    id: r.id,
                    name: r.name,
                    kind: 'file',
                    detail: r.kind,
                    url: new URL(agentResourceHref(r), window.location.origin).href,
                  }))}
                />
              </div>
            </div>
          )}
          {!loading && view === 'activities' && (
            <RunLog
              title="Workspace activities"
              className="wi-activity-log"
              showFilters={false}
              visibleColumns={['started']}
              caption="Select an activity to review its result, evidence and execution"
              runs={activities
                .filter(
                  (a) =>
                    a.goal.toLowerCase().includes(query.toLowerCase()) &&
                    (filter === 'all' ||
                      (filter === 'active' && agentActiveStates.includes(a.state)) ||
                      (filter === 'attention' &&
                        [
                          'waiting_for_user',
                          'ready_for_review',
                          'uncertain',
                          'failed',
                          'suspended',
                          'budget_exhausted',
                        ].includes(a.state)) ||
                      a.state === filter),
                )
                .map((a) => ({
                  id: a.id,
                  name: activityTitle(a.goal),
                  icon: activityIcon(a.state),
                  status: agentActiveStates.includes(a.state)
                    ? 'running'
                    : ['failed', 'uncertain', 'budget_exhausted'].includes(a.state)
                      ? 'error'
                      : 'ok',
                  stateLabel: workStatus(a.state),
                  startedAt: a.createdAt,
                }))}
              onSelect={(r) => {
                const activity = activities.find((a) => a.id === r.id);
                if (activity) openSession(activity.sessionId, activity.id);
              }}
            />
          )}
          {!loading && view === 'agents' && !selected && !creating && !definitions.some((d) => !d.archivedAt) && (
            <EmptyState size="lg" className="wi-agents-empty">
              <EmptyState.Header pattern="none">
                <EmptyState.FeaturedIcon icon={AgentIcon} color="gray" theme="modern" />
              </EmptyState.Header>
              <EmptyState.Content>
                <h2 className="wi-empty-title">{definitions.length ? 'No active agents' : 'No agents yet'}</h2>
                <EmptyState.Description>
                  {manager
                    ? 'Set up the workspace agent to coordinate work, or use New specialist for a focused task.'
                    : 'Workspace agents coordinate work. Specialists handle focused tasks with their own knowledge and tools.'}
                </EmptyState.Description>
              </EmptyState.Content>
              {manager && !coordinator && (
                <EmptyState.Footer>
                  <ControlButton
                    color="primary"
                    iconLeading={AgentIcon}
                    onPress={() => router.push('/intelligence?view=setup')}
                  >
                    Set up workspace agent
                  </ControlButton>
                </EmptyState.Footer>
              )}
            </EmptyState>
          )}
          {!loading && view === 'agents' && (selected || creating || definitions.some((d) => !d.archivedAt)) && (
            <div className={`wi-agent-grid${selected || creating ? ' wi-agent-grid--detail' : ''}`}>
              <AgentList
                agents={definitions
                  .filter((d) => !d.archivedAt)
                  .map((d) => ({
                    id: d.id,
                    name: d.name,
                    description: d.description,
                    icon: <AgentIcon />,
                    status: !d.publishedRevision ? 'draft' : d.enabled ? 'live' : 'paused',
                  }))}
                loading={loading}
                selectedId={selected?.id}
                onOpen={(r) => navigate(() => void openAgent(r.id))}
                onStatusChange={
                  manager && !busy
                    ? (r, s) => {
                        const row = definitions.find((d) => d.id === r.id);
                        if (row) operate(row, s);
                      }
                    : undefined
                }
                onDuplicate={
                  manager && !busy
                    ? (r) =>
                        void run(async () => {
                          const row = await agentRequest(`definitions/${r.id}`);
                          const copy = await agentRequest(`definitions/${r.id}/duplicate`, {
                            clientKey: commandKey([r.id, row.editVersion, 'duplicate']),
                            expectedVersion: row.editVersion,
                          });
                          setArchiveReview(false);
                          await openAgent(copy.id);
                        })
                    : undefined
                }
                searchable={true}
                className="wi-agent-list"
              />
              <div className={`wi-agent-detail${selected ? ' wi-agent-detail--record' : ''}`}>
                {creating && (
                  <>
                    {!policy?.allowModel && (
                      <p className="wi-notice">
                        Enable MiniMax assistance in Workspace policy to generate a draft. You can create a manual draft
                        without making a model request.
                      </p>
                    )}
                    <p className="wi-secondary">
                      Generated specialists start without knowledge access. Select saved revisions in the draft before
                      publishing.
                    </p>
                    <AgentCreate
                      onValueChange={setCreationText}
                      status={
                        job?.bundle
                          ? 'ready'
                          : job?.projectionError || job?.request?.state === 'rejected'
                            ? 'error'
                            : job?.work &&
                                ['failed', 'uncertain', 'budget_exhausted', 'suspended', 'cancelled'].includes(
                                  job.work.state,
                                )
                              ? 'error'
                              : job
                                ? 'drafting'
                                : 'idle'
                      }
                      draft={
                        job?.bundle?.definition
                          ? { ...job.bundle.definition, model: 'minimax', maxSteps: job.bundle.definition.limits.turns }
                          : undefined
                      }
                      error={
                        activityError(error || job?.projectionError || job?.request?.error || job?.work?.error || '') ||
                        undefined
                      }
                      disabled={busy || !policy?.allowModel}
                      tools={definitionToolNames.map((name) => ({ name }))}
                      models={[{ id: 'minimax', name: 'Workspace MiniMax' }]}
                      onSubmit={(description) =>
                        void run(async () => {
                          const next = await agentRequest('definition-drafts/generate', {
                            clientKey: commandKey(description),
                            goal: description,
                            sources: [],
                          });
                          setJob(next);
                        })
                      }
                      onOpen={() => {
                        if (job?.draftAgentId) {
                          void openAgent(job.draftAgentId);
                          setJob(undefined);
                        }
                      }}
                      onStop={
                        job?.work && agentActiveStates.includes(job.work.state)
                          ? () =>
                              void run(async () => {
                                await agentRequest(`work-items/${job.work.id}/cancel`, {
                                  expectedVersion: job.work.editVersion,
                                });
                                setJob(undefined);
                              })
                          : undefined
                      }
                    />
                    <ControlButton onPress={startManual}>Configure manually</ControlButton>
                    {job?.work?.state === 'waiting_for_user' && (
                      <ControlButton onPress={() => openSession(job.work.sessionId, job.work.id)}>
                        Answer the agent’s question
                      </ControlButton>
                    )}
                  </>
                )}

                {selected && (
                  <>
                    <div className="wi-agent-record-header">
                      <AgentSummary
                        icon={<AgentIcon />}
                        name={selected.name ?? selectedDefinition?.name ?? 'New specialist'}
                        description={selectedDefinition?.description}
                        status={!selected.publishedRevision ? 'draft' : selected.enabled ? 'live' : 'paused'}
                        version={selected.publishedRevision ? `r${selected.publishedRevision}` : undefined}
                        model={{
                          name: `MiniMax · connection r${selected.published?.definition.model.connectionRevision ?? selectedDefinition?.model.connectionRevision ?? '—'}`,
                        }}
                        toolCount={selected.published?.definition.tools.length ?? selectedDefinition?.tools.length}
                        activity={
                          (summary?.activity?.length ?? 0) > 1
                            ? summary.activity.map((d: any) => ({ ...d, date: d.date + 'T12:00:00Z' }))
                            : []
                        }
                        attention={
                          summary?.runs?.[0] &&
                          [
                            'failed',
                            'uncertain',
                            'suspended',
                            'budget_exhausted',
                            'waiting_for_user',
                            'ready_for_review',
                          ].includes(summary.runs[0].state)
                            ? {
                                text: `${workStatus(summary.runs[0].state)}${summary.runs[0].error ? ': ' + activityError(summary.runs[0].error) : ''}`,
                                tone: ['failed', 'uncertain'].includes(summary.runs[0].state) ? 'error' : 'neutral',
                                actionLabel: 'Inspect activity',
                                onAction: () => openSession(summary.runs[0].sessionId, summary.runs[0].id),
                              }
                            : null
                        }
                        disabled={busy}
                        onStatusChange={manager && selected.publishedRevision ? (s) => operate(selected, s) : undefined}
                      />
                      {(selectedDefinition?.description.length ?? 0) > 200 && (
                        <details className="wi-agent-description">
                          <summary>Full responsibility</summary>
                          <p>{selectedDefinition?.description}</p>
                        </details>
                      )}
                      {!!summary?.runs?.length && (
                        <p className="wi-secondary">
                          Run activity is grouped by UTC date. Work requiring review remains visible in Activities.
                        </p>
                      )}
                      {!editing && (
                        <Tabs selectedKey={agentTab} onSelectionChange={(key) => setAgentTab(String(key))}>
                          <Tabs.List aria-label="Agent record sections" type="underline">
                            <Tabs.Item id="configuration">Configuration</Tabs.Item>
                            <Tabs.Item id="activities">Activities</Tabs.Item>
                            {manager && coordinator?.agentId === selected.id && (
                              <Tabs.Item id="automation">Automation</Tabs.Item>
                            )}
                          </Tabs.List>
                        </Tabs>
                      )}
                    </div>
                    <section className="wi-agent-record-content" aria-label="Agent record content" tabIndex={0}>
                      {agentTab === 'activities' && (
                        <RunLog
                          title="Agent activities"
                          caption="Recorded work for this executor"
                          visibleColumns={['started']}
                          runs={(summary?.runs ?? []).map((r: any) => ({
                            id: r.id,
                            name: activityTitle(activities.find((a) => a.id === r.id)?.goal),
                            stateLabel: workStatus(r.state),
                            startedAt: r.createdAt ?? r.created_at,
                            status: agentActiveStates.includes(r.state)
                              ? 'running'
                              : ['failed', 'uncertain'].includes(r.state)
                                ? 'error'
                                : 'ok',
                          }))}
                          onSelect={(row) => {
                            const activity = summary.runs.find((r: any) => r.id === row.id);
                            if (activity) openSession(activity.sessionId, activity.id);
                          }}
                        />
                      )}
                      <div hidden={agentTab !== 'configuration'} className="wi-agent-configuration">
                        {!editing && selectedDefinition && (
                          <section className="wi-section">
                            <h3>Responsibility and instructions</h3>
                            <div className="wi-instructions wi-markdown">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkToolReferences]}
                                components={{
                                  a: ({ href, children }) => {
                                    const name =
                                      typeof href === 'string' && href.startsWith('/tools?capability=')
                                        ? new URLSearchParams(href.split('?')[1]).get('capability')
                                        : null;
                                    return name && builtinToolHref(name) === href ? (
                                      <ToolLink name={name}>{children}</ToolLink>
                                    ) : (
                                      <a href={href}>{children}</a>
                                    );
                                  },
                                }}
                              >
                                {selectedDefinition.instructions}
                              </ReactMarkdown>
                            </div>
                            <h3>Permitted capabilities</h3>
                            <ul className="wi-capabilities" aria-label="Permitted capabilities">
                              {selectedDefinition.tools.map((tool) => (
                                <li key={tool}>
                                  <BadgeWithIcon
                                    type="modern"
                                    size="lg"
                                    color="gray"
                                    iconLeading={Check}
                                    className="wi-capability-badge"
                                  >
                                    {toolLabel(tool)}
                                  </BadgeWithIcon>
                                </li>
                              ))}
                            </ul>
                            <dl className="wi-record-facts">
                              <div>
                                <dt>Per activity</dt>
                                <dd>
                                  {selectedDefinition.limits.turns} reasoning turns · {selectedDefinition.limits.tools}{' '}
                                  tool calls
                                </dd>
                              </div>
                              <div>
                                <dt>Response</dt>
                                <dd>
                                  {selectedDefinition.interaction === 'interactive'
                                    ? 'Interactive questions and results'
                                    : 'Structured result'}
                                </dd>
                              </div>
                              <div>
                                <dt>Knowledge revisions</dt>
                                <dd>
                                  {selectedDefinition.context.followHead
                                    ? 'Future work resolves latest saved revisions'
                                    : 'Fixed saved revisions'}
                                </dd>
                              </div>
                              <div>
                                <dt>Working memory</dt>
                                <dd>
                                  {selectedDefinition.memory?.history === 'observational_v1'
                                    ? 'Bounded observations and hierarchical reflection'
                                    : selectedDefinition.memory?.working === 'compact'
                                      ? 'Durable checkpoints and proactive compaction'
                                      : 'Not enabled on this revision'}
                                </dd>
                              </div>
                              <div>
                                <dt>Approved memory</dt>
                                <dd>
                                  {selectedDefinition.memory?.approved === 'workspace'
                                    ? 'Authorized workspace and agent entries'
                                    : selectedDefinition.memory?.approved === 'agent'
                                      ? 'This agent only'
                                      : 'Off'}
                                </dd>
                              </div>
                            </dl>
                            <KnowledgeSources
                              title="Authorized knowledge"
                              sources={selectedDefinition.context.resources.map((ref) => ({
                                id: ref.id,
                                name: resources.find((r) => r.id === ref.id)?.name ?? ref.id,
                                kind: 'file',
                                detail: `Saved revision ${ref.revisionId}`,
                                url: new URL(
                                  agentResourceHref({
                                    ...ref,
                                    name: resources.find((r) => r.id === ref.id)?.name ?? ref.id,
                                  }),
                                  window.location.origin,
                                ).href,
                              }))}
                              emptyMessage={
                                selectedDefinition.context.scope === 'workspace_inventory'
                                  ? 'Workspace inventory scope. Review exact authorized coverage before publication.'
                                  : 'No knowledge revisions authorized.'
                              }
                            />
                          </section>
                        )}

                        {archiveReview && manager && selected.id && (
                          <ControlModal
                            label="Archive agent"
                            onClose={() => {
                              if (!busy) setArchiveReview(false);
                            }}
                          >
                            <div className="wi-policy-dialog wi-workspace">
                              {error && (
                                <p role="alert" className="wi-error">
                                  {activityError(error)}
                                </p>
                              )}
                              <AgentGate
                                variant="plan"
                                title="Archive agent"
                                planTitle={selected.name}
                                planSummary="Stop new assignments and suspend work at its next safe checkpoint. Published revisions and activity history are retained."
                                plan={[
                                  {
                                    id: 'archive',
                                    title: 'Archive this identity',
                                    detail:
                                      'Existing references stay pinned and will fail availability checks. Duplicating an agent creates a separate inactive draft.',
                                  },
                                ]}
                                disabled={busy}
                                approveLabel="Archive agent"
                                rejectLabel="Keep agent"
                                onReject={() => setArchiveReview(false)}
                                onApprove={() =>
                                  void run(async () => {
                                    await agentRequest(`definitions/${selected.id}/archive`, {
                                      clientKey: commandKey([selected.id, selected.editVersion, 'archive']),
                                      expectedVersion: selected.editVersion,
                                    });
                                    setArchiveReview(false);
                                    setSelected(undefined);
                                    router.replace('/intelligence?view=agents');
                                  })
                                }
                              />
                            </div>
                          </ControlModal>
                        )}
                        {editing && selectedDefinition && (
                          <>
                            <Tabs selectedKey={editSection} onSelectionChange={(key) => setEditSection(String(key))}>
                              <Tabs.List aria-label="Draft configuration sections" type="underline">
                                <Tabs.Item id="identity">Responsibility</Tabs.Item>
                                <Tabs.Item id="tools">Capabilities</Tabs.Item>
                                <Tabs.Item id="knowledge">Knowledge</Tabs.Item>
                                <Tabs.Item id="runtime">Runtime</Tabs.Item>
                                <Tabs.Item id="memory">Memory</Tabs.Item>
                              </Tabs.List>
                            </Tabs>
                            {editSection === 'knowledge' && (
                              <ControlInput
                                aria-label="Find authorized knowledge"
                                placeholder="Find knowledge by name or type"
                                value={knowledgeQuery}
                                onChange={(e) => setKnowledgeQuery(e.target.value)}
                              />
                            )}
                            {editSection === 'memory' && <MemoryReadiness />}
                            {editSection === 'runtime' && (
                              <p className="wi-secondary">
                                Structured results require a JSON schema and exclude interactive questions. Limits apply
                                to each new activity.
                              </p>
                            )}
                            <GenerativeForm
                              key={`${selected.id ?? 'new'}:${selected.editVersion}`}
                              title="Agent draft"
                              onInvalidField={(name) =>
                                setEditSection(
                                  name.startsWith('memory')
                                    ? 'memory'
                                    : name.startsWith('source_') || name === 'followHead'
                                      ? 'knowledge'
                                      : name.startsWith('tool_')
                                        ? 'tools'
                                        : ['turns', 'tools', 'outputTokens', 'interaction', 'outputSchema'].includes(
                                              name,
                                            )
                                          ? 'runtime'
                                          : 'identity',
                                )
                              }
                              onDirtyChange={setEditorDirty}
                              object={editObject}
                              fields={editFields.map((field) => ({
                                ...field,
                                hidden:
                                  field.hidden ||
                                  editSection !==
                                    (field.name.startsWith('memory')
                                      ? 'memory'
                                      : field.name.startsWith('source_') || field.name === 'followHead'
                                        ? 'knowledge'
                                        : field.name.startsWith('tool_')
                                          ? 'tools'
                                          : ['turns', 'tools', 'outputTokens', 'interaction', 'outputSchema'].includes(
                                                field.name,
                                              )
                                            ? 'runtime'
                                            : 'identity'),
                              }))}
                              submitLabel="Save draft"
                              error={error || undefined}
                              onCancel={() => setEditing(false)}
                              onSubmit={
                                allowed
                                  ? async (values) => {
                                      await run(async () => {
                                        if ((values.memoryHistory || values.memoryIndex) && !values.memoryEnabled)
                                          throw Error(
                                            'Enable durable working memory before selecting history or semantic recall.',
                                          );
                                        if (values.memoryIndex && (!values.memoryScope || values.memoryScope === 'off'))
                                          throw Error(
                                            'Choose an approved memory retrieval scope before enabling semantic recall.',
                                          );
                                        const definition = definitionSchema.parse({
                                          ...selectedDefinition,
                                          memory: values.memoryEnabled
                                            ? {
                                                ...defaultMemoryPolicy,
                                                approved: values.memoryScope ?? 'off',
                                                ...(values.memoryHistory ? { history: 'observational_v1' } : {}),
                                                ...(values.memoryIndex ? { index: 'mem0_v1' } : {}),
                                              }
                                            : undefined,
                                          name: values.name,
                                          description: values.description ?? '',
                                          instructions: values.instructions,
                                          limits: {
                                            ...selectedDefinition.limits,
                                            turns: Number(values.turns),
                                            tools: Number(values.tools),
                                            outputTokens: Number(values.outputTokens),
                                          },
                                          interaction: values.interaction,
                                          outputSchema:
                                            values.interaction === 'structured_output'
                                              ? JSON.parse(String(values.outputSchema))
                                              : undefined,
                                          tools: definitionToolNames.filter(
                                            (t) =>
                                              values[`tool_${t}`] === true &&
                                              !(values.interaction === 'structured_output' && t === 'ask_user_v2'),
                                          ),
                                          context: {
                                            scope: selectedDefinition.context.scope,
                                            resources: sourceSelection(values),
                                            followHead: values.followHead === true,
                                          },
                                        });
                                        const draft = await agentRequest(
                                          selected.id ? `definitions/${selected.id}` : 'definitions',
                                          {
                                            clientKey: commandKey([selected.id, selected.editVersion, definition]),
                                            expectedVersion: selected.editVersion,
                                            definition,
                                          },
                                          selected.id ? 'PATCH' : 'POST',
                                        );
                                        await openAgent(draft.id);
                                      });
                                    }
                                  : undefined
                              }
                            />
                          </>
                        )}
                        {manager && selected.id && !editing && selected.draftHash !== selected.published?.hash && (
                          <>
                            {publicationReview && (
                              <ControlModal
                                label="Review agent publication"
                                onClose={() => {
                                  if (!busy) setPublicationReview(false);
                                }}
                              >
                                <div className="wi-policy-dialog wi-workspace">
                                  {error && (
                                    <p role="alert" className="wi-error">
                                      {activityError(error)}
                                    </p>
                                  )}
                                  <AgentGate
                                    variant="plan"
                                    title="Publish agent revision"
                                    planTitle="Review executable configuration"
                                    planSummary="Publishing creates an immutable revision. Enabling the agent is a separate action."
                                    plan={[
                                      {
                                        id: 'instructions',
                                        title: 'Instructions',
                                        detail: selectedDefinition?.instructions ?? '',
                                      },
                                      {
                                        id: 'tools',
                                        title: 'Permitted tools',
                                        detail:
                                          selectedDefinition?.tools
                                            .map((t) => t.replace(/_v[0-9]+$/, '').replaceAll('_', ' '))
                                            .join(', ') ?? '',
                                      },
                                      {
                                        id: 'context',
                                        title: 'Knowledge scope',
                                        detail: `${selectedDefinition?.context.scope} · ${selectedDefinition?.context.resources.length} selected resources · ${selectedDefinition?.context.followHead ? 'future assignments resolve the latest saved revisions' : 'fixed saved revisions'}. Running work stays pinned.`,
                                      },
                                    ]}
                                    disabled={busy}
                                    approveLabel="Publish reviewed revision"
                                    rejectLabel="Return to draft"
                                    onApprove={() =>
                                      void run(async () => {
                                        await agentRequest(`definitions/${selected.id}/publish`, {
                                          clientKey: commandKey([
                                            selected.id,
                                            selected.editVersion,
                                            selected.draftHash,
                                          ]),
                                          expectedVersion: selected.editVersion,
                                          draftHash: selected.draftHash,
                                        });
                                        await openAgent(selected.id);
                                      })
                                    }
                                    onReject={() => {
                                      setPublicationReview(false);
                                      setEditing(true);
                                    }}
                                  />
                                </div>
                              </ControlModal>
                            )}
                          </>
                        )}
                      </div>
                      {agentTab === 'automation' && (
                        <section className="wi-automation-section">
                          <h2>Automatic knowledge review</h2>
                          <p>
                            Review changes to authorized knowledge and suggest useful work. Assignments still require
                            acceptance.
                          </p>
                          {manager && coordinator?.agentId === selected.id && automaticReview && (
                            <>
                              <GenerativeForm
                                key={`automatic:${automaticReview.editVersion}`}
                                title="Review rule and admission limits"
                                object={{
                                  enabled: automaticReview.enabled,
                                  maxRuns: automaticReview.maxRuns,
                                  dailyTokens: automaticReview.dailyTokens,
                                }}
                                fields={[
                                  {
                                    name: 'enabled',
                                    label: 'Review changes to authorized knowledge and suggest useful work',
                                    type: 'boolean',
                                  },
                                  {
                                    name: 'maxRuns',
                                    label: 'Maximum automatic reviews per UTC day · 1–12',
                                    type: 'number',
                                    required: true,
                                  },
                                  {
                                    name: 'dailyTokens',
                                    label: 'Daily token admission budget · checked between model calls',
                                    type: 'number',
                                    required: true,
                                  },
                                ]}
                                submitLabel="Save review rule"
                                onSubmit={async (values) => {
                                  await run(async () => {
                                    const body = {
                                      expectedVersion: automaticReview.editVersion,
                                      target: {
                                        agentId: coordinator.agentId,
                                        revision: coordinator.revision,
                                        hash: coordinator.hash,
                                      },
                                      enabled: values.enabled === true,
                                      maxRuns: Number(values.maxRuns),
                                      dailyTokens: Number(values.dailyTokens),
                                    };
                                    await agentRequest(
                                      'coordinator-review',
                                      { ...body, clientKey: commandKey(body) },
                                      'PUT',
                                    );
                                  });
                                }}
                              />
                              <p className="wi-secondary">
                                {automaticReview.pending} changed artifacts awaiting review. Only the selected
                                coordinator revision runs; assignments still require acceptance.
                              </p>
                              {automaticReview.error && <p role="status">{automaticReview.error}</p>}
                            </>
                          )}
                        </section>
                      )}
                    </section>
                  </>
                )}
              </div>
            </div>
          )}
          {!loading && view === 'memory' && <WorkspaceMemory manager={manager} />}
          {!loading && view === 'setup' && (
            <div className="wi-setup-layout">
              <section className="wi-section wi-setup-intro">
                <h2>Establish workspace understanding</h2>
                <p>Purpose and knowledge → inspection → coverage review → activation</p>
                <p className="wi-secondary">
                  Inspection uses the selected provider and saved revisions. Activation is a separate reviewed decision.
                </p>
              </section>
              {manager && !setup && setupStage === 'knowledge' && resources.length === 0 && (
                <section className="wi-section" role="status">
                  <h2>Add evidence first</h2>
                  <p>This workspace has no saved knowledge. Import sources before inspecting them.</p>
                  <ControlButton onPress={() => router.push('/sources')}>Add sources</ControlButton>
                </section>
              )}
              {manager && !setup && setupStage === 'knowledge' && (
                <ControlInput
                  aria-label="Find setup knowledge"
                  placeholder="Find saved knowledge by name or type"
                  value={knowledgeQuery}
                  onChange={(e) => setKnowledgeQuery(e.target.value)}
                />
              )}
              {!manager && (
                <AgentSummary
                  name="Workspace setup"
                  status={coordinator ? 'live' : 'draft'}
                  description={
                    coordinator?.content?.purpose ??
                    'A workspace administrator must establish and activate the workspace agent.'
                  }
                  attention={null}
                />
              )}
              {manager && !setup && (
                <Tabs selectedKey={setupStage} onSelectionChange={(key) => setSetupStage(String(key))}>
                  <Tabs.List aria-label="Workspace setup steps" type="underline">
                    <Tabs.Item id="purpose">1 · Purpose</Tabs.Item>
                    <Tabs.Item id="knowledge">2 · Evidence</Tabs.Item>
                  </Tabs.List>
                </Tabs>
              )}
              {manager && !setup && (
                <GenerativeForm
                  title="Purpose and evidence"
                  object={setupInputs}
                  onInvalidField={(name) => setSetupStage(name === 'goal' ? 'purpose' : 'knowledge')}
                  onDirtyChange={setEditorDirty}
                  fields={[
                    {
                      section: 'Purpose',
                      hidden: setupStage !== 'purpose',
                      name: 'goal',
                      label: 'Workspace purpose and priorities',
                      type: 'longtext',
                      required: true,
                    },
                    ...scopedFields.map((field) => ({
                      ...field,
                      section: field.section ? 'Evidence to inspect' : undefined,
                      hidden: field.hidden || setupStage !== 'knowledge',
                    })),
                  ]}
                  submitLabel={setupStage === 'purpose' ? 'Continue to evidence' : 'Inspect selected knowledge'}
                  cancelLabel="Back to purpose"
                  onCancel={setupStage === 'knowledge' ? () => setSetupStage('purpose') : undefined}
                  error={error || undefined}
                  onSubmit={async (values) => {
                    if (setupStage === 'purpose') {
                      setSetupStage('knowledge');
                      return;
                    }
                    if (!sourceSelection(values).length)
                      throw new Error('Choose at least one saved knowledge revision to inspect.');
                    await run(async () => {
                      const data = { goal: String(values.goal), sources: sourceSelection(values) };
                      const started = await agentRequest('setup-runs', { ...data, clientKey: commandKey(data) });
                      setSetup(started);
                      router.replace(`/intelligence?view=setup&setup=${started.id}`);
                      setGaps([]);
                    });
                  }}
                />
              )}
              {setup && (
                <ControlButton
                  onPress={() => {
                    setSetup(undefined);
                    router.replace('/intelligence?view=setup');
                  }}
                >
                  Back to purpose and evidence
                </ControlButton>
              )}
              <p className="wi-secondary">
                Only selected saved revisions are inspected. Setup proposes a configuration; activation requires your
                review.
              </p>
              {setups.map((s) => (
                <ControlButton key={s.id} onPress={() => void reviewSetup(s.id)}>
                  Inspection {s.id.slice(0, 8)} ·{' '}
                  {s.activatedAt
                    ? 'Activated setup'
                    : s.bundleHash
                      ? 'Review setup'
                      : s.state
                        ? workStatus(s.state)
                        : 'Setup queued'}
                </ControlButton>
              ))}
              {setup && !setup.bundle && (
                <>
                  {['waiting_for_user', 'ready_for_review'].includes(setup.work?.state) ? (
                    <p role="status">
                      {setup.work.state === 'waiting_for_user'
                        ? 'Waiting for your answer. Open the setup activity to continue.'
                        : 'The setup activity is ready for review.'}
                    </p>
                  ) : (
                    <ThinkingState
                      steps={[]}
                      variant="inline"
                      showTimer={false}
                      status={
                        setup.projectionError ||
                        setup.request?.state === 'rejected' ||
                        (setup.work &&
                          ['failed', 'uncertain', 'cancelled', 'budget_exhausted', 'suspended'].includes(
                            setup.work.state,
                          ))
                          ? 'error'
                          : setup.work?.state === 'completed'
                            ? 'done'
                            : 'working'
                      }
                      label={
                        setup.projectionError ||
                        setup.request?.state === 'rejected' ||
                        (setup.work &&
                          ['failed', 'uncertain', 'cancelled', 'budget_exhausted', 'suspended'].includes(
                            setup.work.state,
                          ))
                          ? 'Inspection needs attention'
                          : setup.work?.state === 'completed'
                            ? 'Preparing configuration for review'
                            : setup.work
                              ? 'Inspecting workspace knowledge'
                              : 'Waiting to start inspection'
                      }
                      className="wi-setup-progress"
                    />
                  )}
                  {setup.work && (
                    <ControlButton onPress={() => openSession(setup.work.sessionId, setup.work.id)}>
                      Open setup activity
                    </ControlButton>
                  )}
                </>
              )}
              {setup?.bundle?.result && (
                <>
                  {manager && !setup.activatedAt && (
                    <ControlButton onPress={() => setEditing(!editing)}>
                      {editing ? 'Close configuration editor' : 'Edit proposed configuration'}
                    </ControlButton>
                  )}
                  {manager && editing && !setup.activatedAt && (
                    <div id="wi-setup-configuration">
                      <GenerativeForm
                        key={setup.bundleHash}
                        title="Proposed workspace configuration"
                        object={{
                          purpose: setup.bundle.result.purpose,
                          goals: setup.bundle.result.goals.join('\n'),
                          gaps: setup.bundle.result.gaps.join('\n'),
                          name: setup.bundle.result.coordinator.name,
                          instructions: setup.bundle.result.coordinator.instructions,
                        }}
                        fields={[
                          { name: 'purpose', label: 'Workspace purpose', type: 'longtext', required: true },
                          { name: 'goals', label: 'Goals · one per line', type: 'longtext', required: true },
                          { name: 'gaps', label: 'Known gaps · one per line', type: 'longtext' },
                          { name: 'name', label: 'Workspace agent name', type: 'text', required: true },
                          {
                            name: 'instructions',
                            label: 'Workspace agent instructions',
                            type: 'longtext',
                            required: true,
                          },
                        ]}
                        submitLabel="Save review revision"
                        onSubmit={async (values) => {
                          await run(async () => {
                            const result = {
                              ...setup.bundle.result,
                              purpose: String(values.purpose),
                              goals: String(values.goals)
                                .split('\n')
                                .map((s) => s.trim())
                                .filter(Boolean),
                              gaps: String(values.gaps ?? '')
                                .split('\n')
                                .map((s) => s.trim())
                                .filter(Boolean),
                              coordinator: {
                                ...setup.bundle.result.coordinator,
                                name: String(values.name),
                                instructions: String(values.instructions),
                              },
                            };
                            await agentRequest(`setup-runs/${setup.id}/revise`, {
                              clientKey: commandKey([setup.id, setup.bundleHash, result]),
                              bundleHash: setup.bundleHash,
                              result,
                            });
                            setSetup(await agentRequest(`setup-runs/${setup.id}`));
                            setGaps([]);
                            setEditing(false);
                          });
                        }}
                      />
                    </div>
                  )}
                  <section className="wi-section">
                    <h2>Review workspace understanding</h2>
                    <p>{setup.bundle.result.purpose}</p>
                    <h3>Goals</h3>
                    <ul>
                      {setup.bundle.result.goals.map((g: string, i: number) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                    <h3>Inspection coverage</h3>
                    <ul>
                      {setup.bundle.coverage.map((c: any, i: number) => (
                        <li key={i}>
                          {resources.find((r) => r.id === c.source.id)?.name ?? c.source.id} · {c.status}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <details className="wi-advanced">
                    <summary>Configuration document and technical definition</summary>
                    <ArtifactPanel
                      title="Workspace setup review"
                      kind="document"
                      versions={[
                        {
                          id: setup.bundleHash,
                          label: 'Proposed workspace configuration',
                          content: `# ${setup.bundle.result.purpose}\n\n## Goals\n${setup.bundle.result.goals.map((g: string) => `- ${g}`).join('\n')}\n\n## Inspection coverage\n${setup.bundle.coverage.map((c: any) => `- ${resources.find((r) => r.id === c.source.id)?.name ?? c.source.id}: ${c.status}`).join('\n')}\n\n## Coordinator instructions\n${setup.bundle.result.coordinator.instructions}\n\n## Full reviewed definition\n\x60\x60\x60json\n${JSON.stringify(setup.bundle.result.coordinator, null, 2)}\n\x60\x60\x60`,
                        },
                      ]}
                      className="wi-setup-artifact"
                    />
                  </details>
                  {setup.bundle.result.gaps.length > 0 && (
                    <section className="wi-section wi-setup-gaps">
                      <h2>{setup.activatedAt ? 'Open gaps' : 'Resolve gaps before activation'}</h2>
                      <p>
                        Choose how to address each gap. Adding evidence requires another inspection; changing
                        instructions does not verify missing evidence. Deferring keeps the limitation open.
                      </p>
                      {setup.bundle.result.gaps.map((gap: string, i: number) => (
                        <div className="wi-setup-gap" key={`${setup.bundleHash}:${i}`}>
                          <h3>Gap {i + 1}</h3>
                          <p>{gap}</p>
                          {manager && (
                            <>
                              <ControlSelect
                                className="wi-gap-next-step"
                                aria-label={`Next step for gap ${i + 1}`}
                                value={gapActions[i] ?? ''}
                                disabled={busy}
                                onChange={(event) => {
                                  const action = event.target.value;
                                  setGapActions((previous) => ({ ...previous, [i]: action }));
                                  setGaps((previous) =>
                                    action === 'defer'
                                      ? [...previous.filter((value) => value !== i), i]
                                      : previous.filter((value) => value !== i),
                                  );
                                }}
                              >
                                <option value="">Choose a next step</option>
                                <option value="evidence">Add evidence and inspect again</option>
                                <option value="configuration">Revise scope or instructions</option>
                                {!setup.activatedAt && <option value="defer">Defer with current restrictions</option>}
                              </ControlSelect>
                              {gapActions[i] === 'evidence' && (
                                <div className="wi-setup-gap-action">
                                  <p>
                                    Add the missing policy, source or process details in Sources, then select them for a
                                    new inspection. This gap stays open until reviewed again.
                                  </p>
                                  <div className="wi-action-row">
                                    <ControlButton
                                      onPress={() => window.open('/sources', '_blank', 'noopener,noreferrer')}
                                      iconTrailing={ArrowRightIcon}
                                    >
                                      Open Sources
                                    </ControlButton>
                                    <ControlButton
                                      onPress={() => {
                                        setSetupInputs({
                                          goal: setup.bundle.result.purpose,
                                          ...Object.fromEntries(
                                            resources.map((resource, index) => [
                                              `source_${index}`,
                                              setup.bundle.sources.some((source: any) => source.id === resource.id),
                                            ]),
                                          ),
                                        });
                                        setSetup(undefined);
                                        setSetupStage('knowledge');
                                        setGaps([]);
                                        setGapActions({});
                                        requestAnimationFrame(() =>
                                          document.querySelector('.wi-lifecycle-scroll')?.scrollTo({ top: 0 }),
                                        );
                                        router.replace('/intelligence?view=setup');
                                      }}
                                    >
                                      Inspect updated evidence
                                    </ControlButton>
                                  </div>
                                </div>
                              )}
                              {gapActions[i] === 'configuration' && (
                                <div className="wi-setup-gap-action">
                                  <p>
                                    Limit the agent’s remit or add instructions for handling this missing information.
                                    Review the revised configuration before activation.
                                  </p>
                                  <ControlButton
                                    onPress={() => {
                                      if (setup.activatedAt) {
                                        setSetupInputs({ goal: setup.bundle.result.purpose });
                                        setSetup(undefined);
                                        setSetupStage('purpose');
                                        router.replace('/intelligence?view=setup');
                                      } else {
                                        setEditing(true);
                                        requestAnimationFrame(() =>
                                          document
                                            .getElementById('wi-setup-configuration')
                                            ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                                        );
                                      }
                                    }}
                                  >
                                    {setup.activatedAt ? 'Start a revised setup' : 'Edit proposed configuration'}
                                  </ControlButton>
                                </div>
                              )}
                              {gapActions[i] === 'defer' && (
                                <p className="wi-setup-gap-deferred">
                                  Deferred for this activation. The gap remains recorded and the agent must operate
                                  within its reviewed scope.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </section>
                  )}
                  {!setup.activatedAt && manager && (
                    <Checkbox
                      label="Start an initial inspection after activating this configuration"
                      isSelected={startInspection}
                      isDisabled={busy}
                      onChange={setStartInspection}
                    />
                  )}
                  {setup.activatedAt ? (
                    <>
                      <p role="status">Workspace agent activated.</p>
                      {setup.initialRequestId && (
                        <ControlButton
                          onPress={() => router.push(`/intelligence?view=activities&request=${setup.initialRequestId}`)}
                        >
                          Open initial inspection
                        </ControlButton>
                      )}
                    </>
                  ) : (
                    manager && (
                      <AgentGate
                        variant="plan"
                        title="Activate workspace agent"
                        planTitle="Review operating boundaries"
                        planSummary={setup.bundle.result.coordinator.description}
                        plan={[
                          {
                            id: 'tools',
                            title: 'Authorized tools',
                            detail: setup.bundle.result.coordinator.tools.join(', '),
                          },
                          {
                            id: 'scope',
                            title: 'Knowledge scope',
                            detail: `${setup.bundle.result.coordinator.context.scope} · ${setup.bundle.result.coordinator.context.resources.length} selected resources · ${setup.bundle.result.coordinator.context.followHead ? 'future work resolves latest saved revisions' : 'fixed saved revisions'}. Running work stays pinned.`,
                          },
                          {
                            id: 'limits',
                            title: 'Per-activity limits',
                            detail: `${setup.bundle.result.coordinator.limits.turns} reasoning turns · ${setup.bundle.result.coordinator.limits.tools} tool calls`,
                          },
                        ]}
                        disabled={busy}
                        approvalDisabled={gaps.length !== setup.bundle.result.gaps.length}
                        approveLabel="Activate reviewed workspace agent"
                        rejectLabel="Start a new setup review"
                        onReject={() => {
                          setSetup(undefined);
                          setGaps([]);
                        }}
                        onApprove={() =>
                          void run(async () => {
                            await agentRequest(`setup-runs/${setup.id}/activate`, {
                              clientKey: commandKey([setup.id, setup.bundleHash, gaps]),
                              bundleHash: setup.bundleHash,
                              acceptedGaps: gaps,
                              startInspection,
                            });
                            setSetup(await agentRequest(`setup-runs/${setup.id}`));
                          })
                        }
                      />
                    )
                  )}
                </>
              )}
            </div>
          )}
          {!loading && view === 'suggestions' && (
            <div className="wi-suggestion-list">
              {suggestions.length > 0 && (
                <section className="wi-section wi-suggestions-explanation">
                  <h2>Suggested work for this workspace</h2>
                  <p>
                    The workspace agent proposes activities based on its authorized knowledge and enabled review rules.
                    Each suggestion explains the goal and why it is useful.
                  </p>
                  <p>
                    Accepting a suggestion starts an activity with the proposed agent and evidence. You still review
                    proposed workspace changes before they are applied. Dismissing a suggestion does not change your
                    workspace.
                  </p>
                </section>
              )}
              {!suggestions.length && (
                <EmptyState size="lg" className="wi-suggestions-empty">
                  <EmptyState.Header pattern="none">
                    <EmptyState.FeaturedIcon icon={LayersIcon} color="gray" theme="modern" />
                  </EmptyState.Header>
                  <EmptyState.Content>
                    <h2 className="wi-empty-title">
                      {coordinator ? 'No suggested work yet' : 'Give suggestions a starting point'}
                    </h2>
                    <EmptyState.Description>
                      {coordinator
                        ? 'The workspace agent will suggest useful work from its authorized knowledge. Start an inspection to explore what needs attention.'
                        : 'Set up the workspace agent with a purpose and saved knowledge. It will use that context to propose useful activities for your review.'}
                    </EmptyState.Description>
                  </EmptyState.Content>
                  <EmptyState.Footer>
                    <ControlButton
                      color="primary"
                      iconLeading={coordinator ? Plus : AgentIcon}
                      onPress={() => router.push(`/intelligence?view=${coordinator ? 'conversation' : 'setup'}`)}
                    >
                      {coordinator ? 'New inspection activity' : 'Set up workspace agent'}
                    </ControlButton>
                  </EmptyState.Footer>
                </EmptyState>
              )}
              {allowed &&
                suggestions.some(
                  (s) =>
                    s.state === 'proposed' &&
                    s.proposal.executor &&
                    `${s.proposal.goal} ${s.proposal.rationale}`.toLowerCase().includes(query.toLowerCase()) &&
                    (filter === 'all' || filter === 'proposed'),
                ) && (
                  <DecisionInbox
                    title="Suggested activities"
                    approveLabel="Accept and start activity"
                    denyLabel="Dismiss suggestion"
                    askReason={false}
                    shortcuts={false}
                    items={suggestions
                      .filter(
                        (s) =>
                          s.state === 'proposed' &&
                          s.proposal.executor &&
                          `${s.proposal.goal} ${s.proposal.rationale}`.toLowerCase().includes(query.toLowerCase()) &&
                          (filter === 'all' || filter === 'proposed'),
                      )
                      .map((s) => ({
                        id: s.id,
                        title: s.proposal.goal,
                        description: s.proposal.rationale,
                        agent:
                          definitions.find((d) => d.id === s.proposal.executor?.agentId)?.name ??
                          'Published specialist',
                        context: 'Workspace assignment',
                        fields: [
                          { label: 'Evidence', value: `${s.proposal.context.length} saved revisions` },
                          { label: 'Completion criteria', value: s.proposal.successCriteria },
                        ],
                      }))}
                    onDecide={async (item, decision) => {
                      if (busy || !allowed) throw new Error('You cannot decide this suggestion right now.');
                      const row = suggestions.find((s) => s.id === item.id);
                      if (!row) throw new Error('Refresh suggestions before continuing.');
                      setBusy(true);
                      try {
                        const result = await agentRequest(
                          `suggestions/${row.id}/${decision.approved ? 'accept' : 'dismiss'}`,
                          {
                            clientKey: commandKey([decision.approved ? 'accept' : 'dismiss', row.id, row.editVersion]),
                            expectedVersion: row.editVersion,
                            hash: row.hash,
                          },
                        );
                        setRefresh((n) => n + 1);
                        if (decision.approved && result.requestId)
                          router.push(`/intelligence?view=activities&request=${result.requestId}`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                )}
              {!!suggestions.length &&
                !suggestions.some(
                  (s) =>
                    `${s.proposal.goal} ${s.proposal.rationale}`.toLowerCase().includes(query.toLowerCase()) &&
                    (filter === 'all' || s.state === filter),
                ) && <p role="status">No suggestions match these filters.</p>}
              {suggestions
                .filter(
                  (s) =>
                    !(allowed && s.state === 'proposed' && s.proposal.executor) &&
                    `${s.proposal.goal} ${s.proposal.rationale}`.toLowerCase().includes(query.toLowerCase()) &&
                    (filter === 'all' || s.state === filter),
                )
                .map((s) => (
                  <section key={s.id} className="wi-suggestion">
                    {
                      <>
                        <h2>{s.proposal.goal}</h2>
                        <p>{s.proposal.rationale}</p>
                      </>
                    }
                    {s.state === 'proposed' && allowed && (
                      <AgentGate
                        variant="plan"
                        title="Review suggested assignment"
                        planTitle="Assignment brief"
                        planSummary="Review the executor, evidence and expected outcome before starting this activity."
                        plan={[
                          {
                            id: 'executor',
                            title: 'Executor',
                            detail:
                              definitions.find((d) => d.id === s.proposal.executor?.agentId)?.name ??
                              'A specialist must be published first',
                          },
                          {
                            id: 'scope',
                            title: 'Pinned context',
                            detail: `${s.proposal.context.length} saved revisions`,
                          },
                          { id: 'result', title: 'Completion criteria', detail: s.proposal.successCriteria },
                        ]}
                        disabled={busy}
                        approvalDisabled={!s.proposal.executor}
                        approveLabel="Accept and start activity"
                        rejectLabel="Dismiss suggestion"
                        onApprove={() =>
                          void run(async () => {
                            const accepted = await agentRequest(`suggestions/${s.id}/accept`, {
                              clientKey: commandKey(['accept', s.id, s.editVersion]),
                              expectedVersion: s.editVersion,
                              hash: s.hash,
                            });
                            if (accepted.requestId)
                              router.push(`/intelligence?view=activities&request=${accepted.requestId}`);
                          })
                        }
                        onReject={() =>
                          void run(async () => {
                            await agentRequest(`suggestions/${s.id}/dismiss`, {
                              clientKey: commandKey(['dismiss', s.id, s.editVersion]),
                              expectedVersion: s.editVersion,
                              hash: s.hash,
                            });
                          })
                        }
                      />
                    )}
                    <p>
                      {s.state === 'proposed'
                        ? 'Pending review'
                        : s.state === 'dismissed'
                          ? 'Dismissed'
                          : s.state === 'accepted'
                            ? 'Accepted'
                            : workStatus(s.state)}
                      {s.workState ? ` · ${workStatus(s.workState)}` : ''}
                    </p>
                    <p className="wi-secondary">
                      {s.proposal.basis === 'observed'
                        ? `Evidence: ${s.proposal.evidenceReceiptIds?.length ?? 0} recorded source reads`
                        : 'Evidence: proposed inspection of incomplete or unread context'}
                    </p>
                    {!!s.proposal.context.length && (
                      <KnowledgeSources
                        title="Assignment context"
                        sources={s.proposal.context.map((ref: any) => ({
                          id: ref.id,
                          name: resources.find((r) => r.id === ref.id)?.name ?? ref.id,
                          kind: 'file' as const,
                          detail: `Saved revision ${ref.revisionId}`,
                          url:
                            typeof window === 'undefined'
                              ? undefined
                              : new URL(agentResourceHref(ref), window.location.origin).href,
                        }))}
                      />
                    )}
                    {s.workItemId && (
                      <ControlButton
                        onPress={() =>
                          void run(async () => {
                            const work = await agentRequest(`work-items/${s.workItemId}`);
                            openSession(work.sessionId);
                          })
                        }
                      >
                        Open assignment activity
                      </ControlButton>
                    )}
                  </section>
                ))}
            </div>
          )}
        </div>
      </FullscreenWorkbench>
    </IntelligenceShell>
  );
}
