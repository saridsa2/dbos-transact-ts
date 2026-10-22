'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatStatus, UIMessage } from 'ai';
import { useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatScreen, ChatComposer } from '@/vendor/aisdkagents/chat-screen';
import { SessionList } from '@/vendor/aisdkagents/session-list';
import { StarterPromptsVertical } from '@/vendor/aisdkagents/starter-prompts';
import { ThinkingState } from '@/vendor/aisdkagents/thinking-state';
import { GenerativeForm } from '@/vendor/aisdkagents/generative-form';
import { AttachmentsTray } from '@/vendor/aisdkagents/attachments-tray';
import { RunLog } from '@/vendor/aisdkagents/run-log';
import type { PanelDockItem } from '@/vendor/aisdkagents/panel-dock';
import { FullscreenWorkbench } from '@/components/workspace/fullscreen-workbench';
import { useUnsavedChanges } from '@/components/control/unsaved-changes';
import { useControl, controlRequest } from '@/components/control/access';
import { ControlButton, ControlInput, ControlSelect, ControlModal } from '@/components/control/controls';
import { Tabs } from '@/components/application/tabs/tabs';
import { KnowledgeSources } from '@/vendor/aisdkagents/knowledge-sources';
import { ArtifactPanel } from '@/vendor/aisdkagents/artifact-panel';
import { AgentGate } from '@/vendor/aisdkagents/agent-gate';
import {
  Cube,
  WorkflowIcon,
  SearchLg,
  Activity,
  SettingsIcon,
  LayersIcon as Layers,
  RedoIcon as RefreshCw,
} from '@/components/fa-icons';
import { Button } from '@/components/base/buttons/button';
import { useWorkspaceRefresh } from '@/hooks/use-workspace-events';
import {
  CONTEXT_UPLOAD_ACCEPT,
  CONTEXT_UPLOAD_LIMIT,
  type ContextPermissions,
  type UploadedContext,
} from '@/lib/agent/context-uploads';
import { useIntelligence } from '@/hooks/use-intelligence';
import { agentRequest } from '@/lib/agent/client';
import { canExecute, canManage } from '@/lib/control/contracts';
import { activityTitle, activityError } from '@/lib/agent/presentation';
import { ResumeBudget } from './memory';
import { AgentSettings } from './agent-settings';
import { agentActiveStates, workStatus } from '@/lib/agent/status';
import {
  questionFields,
  questionResponse,
  type MessageRow,
  type Proposal,
  type OntologyProposal,
  type ResourceAttachment,
} from '@/lib/agent/workbench-model';
import { agentResourceHref } from '@/lib/agent/resource-links';
import { resourceMarkdown } from '@/lib/agent/resource-markdown';
import { ontologySchema, type Ontology } from '@/lib/knowledge/ontology';
import { RunInspector } from './run-inspector';
import { OntologyReviewPreview, ProcessReviewPreview, ProposalChanges } from './proposal-preview';
import { ontologyChanges, processChanges } from '@/lib/agent/proposal-diff';
import { AgentLifecycle } from './agent-lifecycle';
import { IntelligenceShell, IntelligenceSidebarToggle } from './intelligence-shell';

type Resource = ResourceAttachment & { editVersion: number; uploadId?: string; mediaType?: string; size?: number };
type UploadJob = { id: string; file: File; sessionId: string; status: 'uploading' | 'error'; error?: string };
export function IntelligenceWorkspace() {
  const { session } = useControl();
  const search = useSearchParams(),
    view = search.get('view') ?? 'overview';
  if (!search.get('session') && view !== 'conversation')
    return (
      <AgentLifecycle
        key={session.workspace!.id + view}
        view={view}
        allowed={canExecute(session.workspace!.role)}
        manager={canManage(session.workspace!.role)}
      />
    );
  return (
    <Workspace
      key={session.workspace!.id}
      workspaceId={session.workspace!.id}
      allowed={canExecute(session.workspace!.role)}
      manager={canManage(session.workspace!.role)}
    />
  );
}
function Workspace({ workspaceId, allowed, manager }: { workspaceId: string; allowed: boolean; manager: boolean }) {
  const search = useSearchParams();
  const [resumeOpen, setResumeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextQuery, setContextQuery] = useState('');
  const [contextKind, setContextKind] = useState('all');
  const [outcome, setOutcome] = useState('');
  const [goalDraft, setGoalDraft] = useState('');
  const navigate = useUnsavedChanges(!!goalDraft.trim() || !!outcome.trim());
  const [executorId, setExecutorId] = useState(search.get('executor') ?? '');
  const [executor, setExecutor] = useState<any>();
  const [executors, setExecutors] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    agentRequest('definitions')
      .then((data) => {
        if (alive)
          setExecutors(data.items.filter((item: any) => item.enabled && item.publishedRevision && !item.archivedAt));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspaceId]);
  useEffect(() => {
    let alive = true;
    setExecutor(undefined);
    if (executorId)
      agentRequest(`definitions/${executorId}`)
        .then((row) => {
          if (alive) setExecutor(row);
        })
        .catch((e) => {
          if (alive) state.setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [executorId]);
  const [selected, setSelected] = useState(search.get('session') ?? '');
  const [focusedActivity, setFocusedActivity] = useState(search.get('activity') ?? '');
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [archived, setArchived] = useState(false);
  const state = useIntelligence(workspaceId, selected, archived, focusedActivity);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [panels, setPanels] = useState<PanelDockItem[]>([]);
  const [panel, setPanel] = useState<string>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [attachments, setAttachments] = useState<Resource[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceError, setResourceError] = useState('');
  const [resourceLoading, setResourceLoading] = useState(true);
  const [selectingContext, setSelectingContext] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reviewProposal, setReviewProposal] = useState<string>();
  const [contextPermissions, setContextPermissions] = useState<ContextPermissions>();
  const [contextPermissionError, setContextPermissionError] = useState('');
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const uploadLock = useRef(false);
  const [uploading, setUploading] = useState(false);
  const hydratedContext = useRef('');
  const refreshPermissions = useCallback(() => {
    void agentRequest('context-permissions')
      .then((permissions) => {
        setContextPermissions(permissions);
        setContextPermissionError('');
      })
      .catch(() => {
        setContextPermissions(undefined);
        setContextPermissionError('Could not check context upload permissions.');
      });
  }, []);
  useEffect(refreshPermissions, [workspaceId, allowed, refreshPermissions]);
  useWorkspaceRefresh(refreshPermissions);
  const [selectedRun, setSelectedRun] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const [starter, setStarter] = useState('');
  const [draftEpoch, setDraftEpoch] = useState(0);
  const { work, detail } = state;
  const choose = useCallback((id: string) => {
    selectedRef.current = id;
    if (!id) setDraftEpoch((value) => value + 1);
    hydratedContext.current = '';
    setSelected(id);
    setFocusedActivity('');
    setPanels([]);
    setPanel(undefined);
    setInspectorOpen(false);
    setAttachments([]);
    setStarter('');
    setOutcome('');
    setExecutorId('');
    const url = new URL(window.location.href);
    url.searchParams.delete('activity');
    url.searchParams.delete('executor');
    if (id) url.searchParams.set('session', id);
    else {
      url.searchParams.delete('session');
      url.searchParams.set('view', 'conversation');
    }
    window.history.replaceState(null, '', url);
  }, []);
  useEffect(() => {
    const id = search.get('session') ?? '',
      activity = search.get('activity') ?? '';
    if (id !== selected || activity !== focusedActivity) {
      hydratedContext.current = '';
      setSelected(id);
      setFocusedActivity(activity);
      setPanels([]);
      setPanel(undefined);
      setInspectorOpen(false);
      setAttachments([]);
      setStarter('');
    }
  }, [search]);
  const openPanel = useCallback((id: string, title: string) => {
    setPanels((old) => (old.some((item) => item.id === id) ? old : [...old, { id, title }]));
    setPanel(id);
    setInspectorOpen(true);
  }, []);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      ['ontology', 'process', 'source'].map((kind) =>
        controlRequest(`/api/knowledge/artifacts?kind=${kind}`).then((data) =>
          data.items.map((row: Resource) => ({ ...row, kind })),
        ),
      ),
    )
      .then((lists) => {
        if (alive) setResources(lists.flat());
      })
      .catch((error) => {
        if (alive) setResourceError(error.message);
      })
      .finally(() => {
        if (alive) setResourceLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId]);
  useEffect(() => {
    if (detail?.session.id !== selected || !selected || hydratedContext.current === selected) return;
    hydratedContext.current = selected;
    setAttachments(detail.contextUploads ?? []);
  }, [selected, detail?.session.id]);
  const performUpload = async (job: UploadJob) => {
    try {
      if (!/\.(txt|md)$/i.test(job.file.name)) throw new Error('Select a text (.txt) or Markdown (.md) file.');
      if (!job.file.size) throw new Error('Select a file that contains text.');
      if (job.file.size > CONTEXT_UPLOAD_LIMIT) throw new Error('File exceeds the 250 KB context limit.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the selected file.'));
        reader.readAsDataURL(job.file);
      });
      const uploaded: UploadedContext = await agentRequest('context-uploads', {
        sessionId: job.sessionId,
        clientKey: job.id,
        filename: job.file.name,
        data,
      });
      setUploadJobs((old) => old.filter((item) => item.id !== job.id));
      setResources((old) => (old.some((item) => item.id === uploaded.id) ? old : [...old, uploaded]));
      if (selectedRef.current === job.sessionId)
        setAttachments((old) => (old.some((item) => item.id === uploaded.id) ? old : [...old, uploaded]));
      state.refresh();
    } catch (error) {
      setUploadJobs((old) =>
        old.map((item) =>
          item.id === job.id
            ? { ...item, status: 'error', error: error instanceof Error ? error.message : 'Upload failed.' }
            : item,
        ),
      );
      refreshPermissions();
    }
  };
  const uploadFiles = async (files: File[]) => {
    if (uploadLock.current || !files.length || !contextPermissions?.canUpload || detail?.session.archivedAt) return;
    if (attachments.length + visibleUploads.length + files.length > 10) {
      state.setError('Attach up to 10 evidence records, including pending uploads.');
      return;
    }
    uploadLock.current = true;
    setUploading(true);
    try {
      const origin = selectedRef.current;
      const id = origin || (await state.createSession(`Context: ${files[0].name}`));
      if (!origin && !selectedRef.current) {
        // Bind the upload to a durable history without discarding the activity brief or open picker.
        selectedRef.current = id;
        hydratedContext.current = id;
        setSelected(id);
        setStarter(goalDraft);
        const url = new URL(window.location.href);
        url.searchParams.set('session', id);
        window.history.replaceState(null, '', url);
      }
      const jobs: UploadJob[] = files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        sessionId: id,
        status: 'uploading',
      }));
      setUploadJobs((old) => [...old, ...jobs]);
      for (const job of jobs) await performUpload(job);
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Could not upload context.');
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  };
  const detachContext = async (resource: Resource) => {
    try {
      if (resource.uploadId)
        await agentRequest(
          `sessions/${encodeURIComponent(selected)}/context/${encodeURIComponent(resource.uploadId)}/detach`,
          {},
        );
      setAttachments((old) => old.filter((item) => item.id !== resource.id));
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Could not detach context.');
    }
  };
  const visibleUploads = uploadJobs.filter((job) => job.sessionId === selected);
  const changeSession = async (id: string, action: 'archive' | 'restore' | 'delete') => {
    if (sessionBusy) return;
    const row = state.sessions.find((item) => item.id === id);
    if (!row) return;
    setSessionBusy(true);
    state.setError('');
    try {
      await agentRequest(`sessions/${encodeURIComponent(id)}/${action}`, { expectedVersion: row.editVersion });
      if (selectedRef.current === id) {
        state.resetDraft();
        choose('');
      }
      state.refresh();
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Could not update activity history.');
      state.refresh();
    } finally {
      setSessionBusy(false);
    }
  };
  const configured =
    !!state.configuration?.enabled && !!state.configuration?.allowModel && state.configuration?.mode === 'assist';
  const waiting = work?.state === 'waiting_for_user';
  const review = work?.state === 'ready_for_review';
  const pendingHere = state.pending?.sessionId === selected ? state.pending : null;
  useEffect(() => {
    if (pendingHere || work) {
      setGoalDraft('');
      setOutcome('');
    }
  }, [pendingHere?.requestId, work?.id]);
  const canSend =
    !visibleUploads.length &&
    !uploading &&
    !detail?.session.archivedAt &&
    allowed &&
    configured &&
    !state.loading &&
    !state.active &&
    !waiting &&
    !review &&
    !state.busy &&
    !pendingHere &&
    !choosing &&
    (!executorId || !!executor?.published);
  const send = async (text: string) => {
    setChoosing(true);
    try {
      const goal = outcome.trim() ? `${text}\n\nExpected outcome: ${outcome.trim()}` : text;
      if (goal.length > 10000) throw new Error('Keep the goal and expected outcome within 10,000 characters.');
      const id = selected || (await state.createSession(text));
      await state.submit(
        {
          text: goal,
          ...(executor?.published
            ? {
                agent: {
                  agentId: executor.published.agentId,
                  revision: executor.published.revision,
                  hash: executor.published.hash,
                },
              }
            : {}),
          sessionId: id,
          kind: 'goal',
          origin: 'workbench',
          context: { surface: 'intelligence' },
          attachments: attachments.map(({ kind, id, revisionId }) => ({ kind, id, revisionId })),
          remember: false,
        },
        goal,
      );
      if (selectedRef.current === selected) {
        if (!selected || focusedActivity) choose(id);
        setAttachments([]);
        setStarter('');
      }
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Could not submit instruction.');
      throw error;
    } finally {
      setChoosing(false);
    }
  };
  const answer = async (values: Record<string, unknown>) => {
    if (!work?.interaction) return;
    try {
      const response = questionResponse(work.interaction, values);
      await state.submit(
        {
          kind: 'answer',
          origin: 'workbench',
          text: JSON.stringify(response.values),
          sessionId: selected,
          workItemId: work.id,
          expectedVersion: work.editVersion,
          response,
          context: { surface: 'intelligence' },
          attachments: [],
          remember: false,
        },
        work.interaction.id,
      );
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Could not submit your answer.');
      throw error;
    }
  };
  const stop = async () => {
    if (!work) return;
    try {
      await agentRequest(`work-items/${work.id}/cancel`, { expectedVersion: work.editVersion });
      state.refresh();
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Could not stop work.');
    }
  };
  const apply = async (proposal: Proposal) => {
    if (applying) return;
    setApplying(true);
    state.setError('');
    try {
      await agentRequest(`change-sets/${proposal.id}/apply`, { hash: proposal.hash });
      state.refresh();
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Could not apply changes.');
    } finally {
      setApplying(false);
    }
  };
  const requestChanges = async () => {
    if (!work) return;
    try {
      await agentRequest(`work-items/${work.id}/cancel`, { expectedVersion: work.editVersion });
      state.refresh();
      setInspectorOpen(false);
      setStarter('Revise the previous proposal with these changes: ');
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Could not stop the current proposal.');
    }
  };
  const visibleMessages = useMemo(() => {
    if (!focusedActivity) return detail?.messages ?? [];
    const recorded = work?.messages ?? [];
    // A retained initial instruction may have been projected after result rows.
    // Keep the selected activity's instruction first without reordering answers.
    const instruction = recorded.find((m) => m.role === 'user' && m.content === work?.goal);
    return instruction ? [instruction, ...recorded.filter((m) => m.id !== instruction.id)] : recorded;
  }, [focusedActivity, work?.messages, work?.goal, detail?.messages]);
  const messageRows = useMemo(
    () => new Map(visibleMessages.map((message) => [message.id, message])),
    [visibleMessages],
  );
  const messages: UIMessage[] = visibleMessages
    .filter((message) => !(work?.state === 'failed' && message.role === 'assistant' && message.content === work.error))
    .map((message) => ({
      id: message.id,
      role: message.role,
      parts: [{ type: 'text', text: message.role === 'assistant' ? activityError(message.content) : message.content }],
    }));
  for (const answer of work?.activity.filter((event) => event.kind === 'answer') ?? []) {
    let text = answer.summary;
    try {
      const values: unknown = JSON.parse(text);
      if (values && typeof values === 'object' && !Array.isArray(values))
        text = Object.entries(values)
          .map(
            ([key, value]) =>
              `${key.replaceAll('_', ' ')}: ${Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}`,
          )
          .join('\n');
    } catch {
      /* Free-text answers remain text. */
    }
    const message: UIMessage = { id: `answer:${answer.id}`, role: 'user', parts: [{ type: 'text', text }] };
    const after = messages.findIndex((item) => {
      const row = messageRows.get(item.id);
      return !!row?.createdAt && Date.parse(row.createdAt) > Date.parse(answer.createdAt);
    });
    if (after < 0) messages.push(message);
    else messages.splice(after, 0, message);
  }
  if (
    pendingHere?.kind !== 'answer' &&
    pendingHere?.text &&
    !detail?.messages.some(
      (message) => message.role === 'user' && message.content === pendingHere.text && message.id === work?.id,
    )
  )
    messages.push({ id: 'pending-instruction', role: 'user', parts: [{ type: 'text', text: pendingHere.text }] });
  if (state.active && state.live.answer?.text)
    messages.push({ id: 'live-answer', role: 'assistant', parts: [{ type: 'text', text: state.live.answer.text }] });
  if (work || pendingHere || state.loading)
    messages.push({ id: 'work-status', role: 'assistant', parts: [{ type: 'text', text: '' }] });
  const renderMessage = useCallback(
    (message: UIMessage) => {
      if (message.id !== 'work-status') {
        if (message.role === 'user') return undefined;
        const row: MessageRow | undefined = messageRows.get(message.id);
        const text = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
        return (
          <div className="wi-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[resourceMarkdown(row?.resources ?? [])]}>
              {text}
            </ReactMarkdown>
          </div>
        );
      }
      if (state.loading) return <p role="status">Loading session…</p>;
      return (
        <div className="wi-work-state">
          {work?.state === 'failed' && work.error && (
            <section className="wi-section wi-execution-error" role="alert">
              <h2>Activity stopped</h2>
              <p>{activityError(work.error)}</p>
              <p className="wi-secondary">
                Review the execution details, then continue below with a revised instruction. Previous calls are
                recorded; no failed request is automatically repeated.
              </p>
              <ControlButton
                onPress={() => {
                  setSelectedRun(work.id);
                  openPanel('activity', 'Execution');
                }}
              >
                Inspect execution
              </ControlButton>
            </section>
          )}
          {work?.interaction && waiting && !pendingHere && (
            <GenerativeForm
              key={work.interaction.id}
              object={{}}
              fields={questionFields(work.interaction)}
              title={work.interaction.question}
              submitLabel="Answer and continue"
              onSubmit={allowed ? answer : undefined}
              error={state.error || undefined}
            />
          )}
          {work?.proposals.map((proposal) => (
            <div className="wi-result" key={proposal.id}>
              <div>
                <strong>
                  {proposal.kind === 'process'
                    ? 'Process proposal'
                    : proposal.state === 'applied'
                      ? 'Ontology updated'
                      : 'Ontology proposal'}
                </strong>
                <p>
                  {proposal.kind === 'process'
                    ? `${proposal.content.graph.elements.length} process elements`
                    : `${proposal.content.entities.length} entities · ${proposal.content.relationships.length} relationships`}{' '}
                  · {proposal.state === 'applied' ? 'Saved draft' : 'Ready to review'}
                </p>
              </div>
              <ControlButton onPress={() => setReviewProposal(proposal.id)}>
                {proposal.state === 'applied' ? 'View changes' : 'Review changes'}
              </ControlButton>
            </div>
          ))}
          {work && (
            <ControlButton
              color="link-gray"
              iconLeading={Activity}
              onPress={() => {
                setSelectedRun(work.id);
                openPanel('activity', 'Activity');
              }}
            >
              View activity
            </ControlButton>
          )}
        </div>
      );
      // Host callbacks carry current versions; completed messages continue to use recorded resource references.
    },
    [
      messageRows,
      state.loading,
      state.active,
      state.connection,
      state.error,
      state.busy,
      pendingHere,
      work,
      waiting,
      allowed,
      openPanel,
    ],
  );
  const sessionStatus = (id: string): ChatStatus => {
    const status =
      id === selected ? work?.state : state.activities.find((activity) => activity.sessionId === id)?.state;
    return agentActiveStates.some((value) => value === status)
      ? 'streaming'
      : ['failed', 'uncertain'].includes(status ?? '')
        ? 'error'
        : 'ready';
  };
  const newSession = () => {
    setArchived(false);
    setOutcome('');
    setExecutorId('');
    state.resetDraft();
    choose('');
  };
  const attachmentTray = (
    <>
      <AttachmentsTray
        bare
        emptyLabel="Upload files"
        attachments={[
          ...visibleUploads.map((job) => ({
            id: job.id,
            name: job.file.name,
            mediaType: job.file.type || 'text/plain',
            size: job.file.size,
            status: job.status,
            error: job.error,
          })),
        ]}
        viewer={false}
        accept={CONTEXT_UPLOAD_ACCEPT}
        maxFiles={10}
        onAdd={
          contextPermissions?.canUpload && !uploading && !detail?.session.archivedAt
            ? (files) => void uploadFiles(files)
            : undefined
        }
        onReject={() => state.setError('Use .txt or .md files, with at most ten context attachments.')}
        onRetry={(attachment) => {
          const job = uploadJobs.find((item) => item.id === attachment.id);
          if (job) {
            setUploadJobs((old) =>
              old.map((item) => (item.id === job.id ? { ...item, status: 'uploading', error: undefined } : item)),
            );
            void performUpload(job);
          }
        }}
        onRemove={
          allowed
            ? (ref) => {
                const resource = attachments.find((item) => item.id === ref.id);
                if (resource) void detachContext(resource);
                else setUploadJobs((old) => old.filter((item) => item.id !== ref.id));
              }
            : undefined
        }
        onOpen={() => openPanel('context', 'Context')}
      />
    </>
  );
  const history = (
    <>
      <div className="wi-session-filter">
        <Tabs
          selectedKey={archived ? 'archived' : 'active'}
          onSelectionChange={(key) => setArchived(key === 'archived')}
        >
          <Tabs.List aria-label="Activity history" type="button-gray" fullWidth>
            <Tabs.Item id="active">Active</Tabs.Item>
            <Tabs.Item id="archived">Archived</Tabs.Item>
          </Tabs.List>
        </Tabs>
      </div>
      <SessionList
        sessions={state.sessions.map((item) => ({
          ...item,
          title: activityTitle(item.title),
          deleteBlockedReason: item.deleteBlockedReason ?? (!item.canDelete ? 'Deletion is not available.' : null),
          status: sessionStatus(item.id),
        }))}
        activeId={selected}
        onSelect={(id) => navigate(() => choose(id))}
        onArchive={allowed && !sessionBusy ? (id) => void changeSession(id, 'archive') : undefined}
        onRestore={allowed && !sessionBusy ? (id) => void changeSession(id, 'restore') : undefined}
        onDelete={allowed && !sessionBusy ? (id) => void changeSession(id, 'delete') : undefined}
      />
    </>
  );
  const policyReady = configured;
  return (
    <IntelligenceShell
      view="conversation"
      onNewInstruction={newSession}
      onPolicy={manager ? () => setSettingsOpen(true) : undefined}
    >
      <FullscreenWorkbench
        title={state.loading ? 'Loading activity…' : work ? activityTitle(work.goal) : 'New activity'}
        showBrand={false}
        showBack={false}
        leading={<IntelligenceSidebarToggle />}
        status={
          selected || pendingHere ? (
            <div className="wi-activity-status" role="status" aria-live="polite">
              {state.active || pendingHere ? (
                <ThinkingState
                  variant="inline"
                  steps={[]}
                  status="working"
                  showTimer={false}
                  label={
                    pendingHere
                      ? 'Activity accepted · waiting to start'
                      : state.connection === 'reconnecting'
                        ? 'Reconnecting to recorded activity…'
                        : workStatus(work?.state)
                  }
                />
              ) : (
                <span>{work ? workStatus(work.state) : 'Draft activity'}</span>
              )}
              <span className="wi-secondary">
                {waiting
                  ? 'Answer the decision below to resume this activity.'
                  : review
                    ? 'Review the proposed changes before applying.'
                    : work?.state === 'uncertain'
                      ? 'Inspect execution receipts before starting follow-up work.'
                      : work?.state === 'completed'
                        ? 'Execution finished. Continue below using the same working context.'
                        : selected
                          ? 'Evidence and execution details are available in the side panel.'
                          : 'Nothing runs until you send the goal.'}
              </span>
              {state.active && allowed && <ControlButton onPress={() => void stop()}>Stop activity</ControlButton>}
            </div>
          ) : undefined
        }
        actions={
          <>
            {work?.state === 'budget_exhausted' && work.memoryProfile && manager && (
              <ControlButton color="primary" onPress={() => setResumeOpen(true)}>
                Resume from checkpoint
              </ControlButton>
            )}
            <ControlButton onPress={() => openPanel('history', 'Activity history')}>History</ControlButton>
            {selected && (
              <ControlButton iconLeading={Activity} onPress={() => openPanel('runs', 'Related activities')}>
                Related activities
              </ControlButton>
            )}
            {work && (
              <ControlButton
                onPress={() => {
                  setSelectedRun(work.id);
                  openPanel('activity', 'Execution');
                }}
              >
                Execution
              </ControlButton>
            )}
            <ControlButton
              aria-label="Refresh workspace intelligence"
              iconLeading={RefreshCw}
              onPress={state.refresh}
            />
          </>
        }
      >
        {reviewProposal && (
          <ControlModal
            label="Review proposed changes"
            onClose={() => {
              if (!applying) setReviewProposal(undefined);
            }}
          >
            <div className="wi-review-dialog wi-workspace wi-shell">
              <header>
                <h2>Review proposed changes</h2>
                <ControlButton onPress={() => setReviewProposal(undefined)} disabled={applying}>
                  Close review
                </ControlButton>
              </header>
              <div className="wi-review-body">
                <ProposalReview
                  proposal={work?.proposals.find((p) => p.id === reviewProposal)}
                  error={state.error}
                  applying={applying}
                  allowed={allowed && work?.state === 'ready_for_review'}
                  onApply={apply}
                  onRequestChanges={requestChanges}
                />
              </div>
            </div>
          </ControlModal>
        )}
        {resumeOpen && work && manager && (
          <ResumeBudget work={work} onSaved={state.refresh} onClose={() => setResumeOpen(false)} />
        )}
        {settingsOpen && manager && <AgentSettings onClose={() => setSettingsOpen(false)} onSaved={state.refresh} />}
        <ChatScreen
          panelOpen={inspectorOpen}
          onPanelOpenChange={setInspectorOpen}
          showThinking={false}
          emptyAlignment="start"
          threadLabel={work ? 'Activity result' : 'Activity brief'}
          id={selected || `new-${draftEpoch}`}
          title={
            selected
              ? detail?.session.title
                ? activityTitle(detail.session.title)
                : 'Loading activity…'
              : 'New session'
          }
          messages={messages}
          renderMessage={renderMessage}
          status={state.active || pendingHere ? 'streaming' : 'ready'}
          error={state.error || null}
          showHeader={false}
          empty={
            <div className="wi-work-brief">
              {!policyReady && (
                <section className="wi-section wi-readiness-banner" role="status">
                  <h2>Enable assistance before starting</h2>
                  <p>Select the MiniMax connection and enable Assist mode in workspace policy.</p>
                  {manager && (
                    <ControlButton onPress={() => setSettingsOpen(true)}>Configure workspace policy</ControlButton>
                  )}
                </section>
              )}
              <section className="wi-section">
                <h2>Activity details</h2>
                <p>Choose an executor and the outcome you need. Attach evidence before starting.</p>
                <label>
                  Executor
                  <ControlSelect
                    aria-label="Activity executor"
                    value={executorId}
                    onChange={(e) => setExecutorId(e.target.value)}
                  >
                    <option value="">Workspace assistance · current policy</option>
                    {executors.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} · published r{row.publishedRevision}
                      </option>
                    ))}
                  </ControlSelect>
                </label>
                <label>
                  Expected outcome <span className="wi-secondary">optional</span>
                  <ControlInput
                    aria-label="Expected outcome"
                    placeholder="For example, an ontology draft with source evidence"
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                  />
                </label>
                <p className="wi-secondary">
                  {executor
                    ? `${executor.published?.definition.tools.length ?? 0} authorized tools · published revision ${executor.published?.revision}`
                    : 'Uses the configured workspace assistance policy.'}{' '}
                  Proposed knowledge changes require your review before they are applied.
                </p>
              </section>
              <StarterPromptsVertical
                prompts={[
                  {
                    id: 'ontology',
                    icon: <Cube />,
                    text: 'Help me extend the ontology in this workspace',
                    label: 'Build on your ontology',
                    hint: 'Knowledge',
                  },
                  {
                    id: 'process',
                    icon: <WorkflowIcon />,
                    text: 'Review the attached process document and identify its entities, relationships and process steps',
                    label: 'Understand a process document',
                    hint: 'Sources',
                  },
                  {
                    id: 'inspect',
                    icon: <SearchLg />,
                    text: 'Inspect this workspace and explain the available knowledge and workflows. Do not make changes.',
                    label: 'Explore this workspace',
                    hint: 'Inspection',
                  },
                ]}
                title="Start with a useful goal"
                description="Choose a starting point or describe your own goal below."
                onSelect={(prompt) => setStarter(prompt.text)}
              />
            </div>
          }
          composer={
            selected && !work ? (
              <p role="status" className="wi-follow-up">
                Loading recorded activity…
              </p>
            ) : selected &&
              work &&
              (state.active || waiting || review || work.state === 'uncertain' || !!detail?.session.archivedAt) ? (
              <div className="wi-follow-up">
                <p>
                  {waiting
                    ? 'Answer the structured question in this activity to continue.'
                    : review
                      ? 'Review the proposal to resolve this activity.'
                      : state.active
                        ? 'Work is in progress. Execution details and Stop are available above.'
                        : 'This recorded activity is finished. Follow-up work gets its own goal, executor and evidence.'}
                </p>
                {!state.active && !waiting && !review && allowed && !detail?.session.archivedAt && (
                  <ControlButton
                    onPress={() =>
                      navigate(() => {
                        const previous = work;
                        newSession();
                        setStarter(`Follow-up to activity ${previous.id} (${previous.goal.split('\n')[0]}): `);
                      })
                    }
                  >
                    Create follow-up activity
                  </ControlButton>
                )}
              </div>
            ) : (
              <div className="wi-compose">
                {work?.state === 'budget_exhausted' && (
                  <p role="status" className="wi-notice">
                    {(work.error ? activityError(work.error) : null) ??
                      `The previous execution reached a work limit after ${work.usage.tokens.toLocaleString()} input/output tokens. Continue below with a smaller instruction. Each instruction has its own execution budget.`}
                  </p>
                )}
                <div className="wi-context-actions">
                  <ControlButton
                    color="secondary"
                    iconLeading={Layers}
                    onPress={() => {
                      openPanel('context', 'Evidence');
                      setSelectingContext(true);
                    }}
                  >
                    {attachments.length ? `Evidence · ${attachments.length} selected` : 'Attach evidence'}
                  </ControlButton>
                </div>
                {contextPermissionError && (
                  <div role="alert" className="wi-error">
                    {contextPermissionError} <ControlButton onPress={refreshPermissions}>Retry</ControlButton>
                  </div>
                )}
                <ChatComposer
                  chatId={selected || `new-${draftEpoch}`}
                  prefill={starter}
                  onDraftChange={setGoalDraft}
                  busy={state.active || !!pendingHere || state.busy || choosing}
                  placeholder={selected ? 'Continue this activity…' : 'Describe the goal for this activity…'}
                  onSend={canSend ? send : undefined}
                  onStop={state.active && allowed ? () => void stop() : undefined}
                />
                <div className="wi-compose-meta">
                  <span>
                    {attachments.length
                      ? `${attachments.length} context item${attachments.length === 1 ? '' : 's'} attached`
                      : ''}
                  </span>
                  <span>
                    {waiting
                      ? 'Answer the question above to continue'
                      : review
                        ? 'Review the proposed changes above'
                        : 'Enter to send · Shift + Enter for a new line'}
                  </span>
                </div>
                {detail?.session.archivedAt && (
                  <p className="wi-notice">Archived history. Restore it from History to create a follow-up activity.</p>
                )}
                {selected && !configured && state.configurationLoaded && (
                  <p className="wi-notice">
                    MiniMax assistance is disabled for this workspace.{' '}
                    {manager ? (
                      <>
                        Open{' '}
                        <ControlButton color="link-gray" onPress={() => setSettingsOpen(true)}>
                          Workspace policy
                        </ControlButton>{' '}
                        to enable the agent, allow MiniMax and choose Assist mode.
                      </>
                    ) : (
                      'Ask a workspace owner or administrator to enable assistance in Workspace policy.'
                    )}
                  </p>
                )}
                {!state.configurationLoaded && (
                  <p role="status" className="wi-secondary">
                    Checking workspace execution policy…
                  </p>
                )}
                {!allowed && (
                  <p className="wi-notice">Your role can inspect work. Execution requires a workspace editor role.</p>
                )}
              </div>
            )
          }
          panels={panels}
          activePanel={panel}
          onActivePanelChange={setPanel}
          onClosePanel={(id) => {
            setPanels((old) => old.filter((item) => item.id !== id));
            if (panel === id) setPanel(panels.find((item) => item.id !== id)?.id);
          }}
          layout={{ defaultPanelWidth: 480 }}
          renderPanel={(item) =>
            item.id === 'history' ? (
              <div className="wi-inspector">
                <div className="wi-history-actions">
                  <ControlButton onPress={newSession}>New activity</ControlButton>
                  <ControlButton onPress={() => openPanel('runs', 'Work in history')}>
                    Work in this history
                  </ControlButton>
                </div>
                {history}
              </div>
            ) : item.id === 'context' ? (
              <div className="wi-inspector">
                <h2>Activity evidence</h2>
                <p className="wi-secondary">
                  Up to 10 saved revisions for your next activity. Agent-authorized knowledge and tools still follow its
                  published definition and workspace policy.
                </p>
                <ControlInput
                  aria-label="Search saved evidence"
                  placeholder="Find evidence by name"
                  value={contextQuery}
                  onChange={(e) => setContextQuery(e.target.value)}
                />
                <ControlSelect
                  aria-label="Evidence type"
                  value={contextKind}
                  onChange={(e) => setContextKind(e.target.value)}
                >
                  <option value="all">All types</option>
                  <option value="ontology">Ontologies</option>
                  <option value="process">Processes</option>
                  <option value="source">Sources</option>
                </ControlSelect>
                {resourceLoading && <p role="status">Loading knowledge…</p>}
                {resourceError && (
                  <p role="alert" className="wi-error">
                    {resourceError}
                  </p>
                )}
                {!selectingContext && (
                  <KnowledgeSources
                    title="Selected saved revisions"
                    emptyMessage="No saved revisions attached. Add context for your next instruction."
                    sources={attachments.map((resource) => ({
                      id: resource.id,
                      name: `${resource.name} · ${resource.kind} · revision ${resource.editVersion}`,
                      kind: 'file' as const,
                      url:
                        typeof window === 'undefined'
                          ? undefined
                          : new URL(agentResourceHref(resource), window.location.origin).href,
                      detail: 'Saved revision attached to your next instruction.',
                    }))}
                    onAdd={!resourceLoading && !resourceError ? () => setSelectingContext(true) : undefined}
                    onRemove={(source) => {
                      const resource = attachments.find((item) => item.id === source.id);
                      if (resource) void detachContext(resource);
                    }}
                  />
                )}
                <section className="wi-upload-section">
                  <h3>Upload new evidence</h3>
                  <p className="wi-secondary">
                    Text or Markdown · 250 KB per file. Uploads are saved to workspace Sources and audited. Detaching
                    does not delete the Source.
                  </p>
                  {attachmentTray}
                  {contextPermissions && !contextPermissions.canUpload && <p>Your role cannot upload new evidence.</p>}
                </section>
                {selectingContext && (
                  <GenerativeForm
                    key="activity-evidence-picker"
                    title="Choose saved evidence"
                    object={Object.fromEntries(
                      resources.map((resource, index) => [
                        `resource_${index}`,
                        attachments.some((item) => item.id === resource.id),
                      ]),
                    )}
                    fields={resources.map((resource, index) => ({
                      name: `resource_${index}`,
                      label: `${resource.name} · ${resource.kind} · revision ${resource.editVersion}`,
                      hidden:
                        !resource.name.toLowerCase().includes(contextQuery.toLowerCase()) ||
                        (contextKind !== 'all' && resource.kind !== contextKind),
                      type: 'boolean' as const,
                    }))}
                    submitLabel="Use selected evidence"
                    cancelLabel="Cancel"
                    onCancel={() => setSelectingContext(false)}
                    onSubmit={async (values) => {
                      const chosen = resources
                        .filter((_, index) => values[`resource_${index}`] === true)
                        .map((resource) => ({ ...resource, ...attachments.find((item) => item.id === resource.id) }));
                      if (chosen.length > 10) throw new Error('Attach up to 10 saved resources.');
                      for (const resource of attachments.filter(
                        (item) => item.uploadId && !chosen.some((next) => next.id === item.id),
                      ))
                        await agentRequest(
                          `sessions/${encodeURIComponent(selected)}/context/${encodeURIComponent(resource.uploadId!)}/detach`,
                          {},
                        );
                      setAttachments(chosen);
                      setSelectingContext(false);
                    }}
                  />
                )}
              </div>
            ) : item.id === 'runs' ? (
              <div className="wi-inspector">
                <RunLog
                  title="Related activities"
                  caption="Work in this retained history · most recent 30"
                  visibleColumns={['started']}
                  runs={(detail?.workItems ?? []).map((run) => ({
                    id: run.id,
                    name: activityTitle(run.goal),
                    stateLabel: workStatus(run.state),
                    startedAt: run.created_at,
                    status: agentActiveStates.some((value) => value === run.state)
                      ? 'running'
                      : ['failed', 'uncertain', 'suspended', 'budget_exhausted'].includes(run.state)
                        ? 'error'
                        : 'ok',
                    error: run.error,
                  }))}
                  selectedId={null}
                  onSelect={(run) => {
                    setFocusedActivity(run.id);
                    setInspectorOpen(false);
                    const url = new URL(window.location.href);
                    url.searchParams.set('activity', run.id);
                    window.history.replaceState(null, '', url);
                  }}
                />
              </div>
            ) : item.id === 'activity' ? (
              selectedRun ? (
                <RunInspector key={selectedRun} id={selectedRun} />
              ) : (
                <p>Select a run to inspect.</p>
              )
            ) : (
              <ProposalReview
                proposal={work?.proposals.find((proposal) => `proposal:${proposal.id}` === item.id)}
                error={state.error}
                applying={applying}
                allowed={allowed && work?.state === 'ready_for_review'}
                onApply={apply}
                onRequestChanges={requestChanges}
              />
            )
          }
        />
      </FullscreenWorkbench>
    </IntelligenceShell>
  );
}
function ProposalReview(props: {
  proposal?: Proposal;
  error?: string;
  applying: boolean;
  allowed: boolean;
  onApply: (proposal: Proposal) => Promise<void>;
  onRequestChanges: () => Promise<void>;
}) {
  return props.proposal?.kind === 'process' ? (
    <ProcessProposalReview {...props} proposal={props.proposal} />
  ) : (
    <OntologyProposalReview {...props} proposal={props.proposal} />
  );
}
function ProcessProposalReview({
  proposal,
  error,
  applying,
  allowed,
  onApply,
  onRequestChanges,
}: {
  proposal: import('@/lib/agent/workbench-model').ProcessProposal;
  error?: string;
  applying: boolean;
  allowed: boolean;
  onApply: (proposal: Proposal) => Promise<void>;
  onRequestChanges: () => Promise<void>;
}) {
  const [baseline, setBaseline] = useState<{ version: number; content: unknown } | null>(null),
    [loadError, setLoadError] = useState('');
  useEffect(() => {
    let alive = true;
    void controlRequest(`/api/knowledge/artifacts/${encodeURIComponent(proposal.artifactId)}`)
      .then((data) => {
        if (alive) setBaseline({ version: data.artifact.editVersion, content: data.revision.content });
      })
      .catch((e) => {
        if (alive) setLoadError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [proposal.id, proposal.state]);
  const stale = !!baseline && baseline.version !== proposal.expectedVersion;
  const versions = [
    ...(baseline
      ? [
          {
            id: 'saved',
            label: 'Saved process',
            content: '```json\n' + JSON.stringify(baseline.content, null, 2) + '\n```',
          },
        ]
      : []),
    {
      id: proposal.id,
      label: 'Proposed process',
      content:
        '# Visual process proposal\n\n' +
        proposal.content.graph.elements.map((n) => `- ${n.name} (${n.kind}, ${n.id})`).join('\n') +
        '\n\n## Complete process definition\n```json\n' +
        JSON.stringify(proposal.content, null, 2) +
        '\n```',
    },
  ];
  return (
    <div className="wi-inspector">
      <h2>Process changes</h2>
      <p>{proposal.summary}</p>
      <ProcessReviewPreview
        proposed={proposal.content}
        applied={proposal.state === 'applied'}
        saved={
          proposal.state === 'applied'
            ? undefined
            : (baseline?.content as import('@/lib/processes/model').ProcessDocument | undefined)
        }
      />
      {baseline && proposal.state !== 'applied' && (
        <ProposalChanges
          changes={processChanges(
            baseline.content as import('@/lib/processes/model').ProcessDocument,
            proposal.content,
          )}
        />
      )}
      <details className="wi-advanced">
        <summary>Technical process definition</summary>
        <ArtifactPanel
          className="h-[min(50vh,480px)]"
          title="Process proposal"
          kind="document"
          versions={versions}
          filename="process-review.md"
        />
      </details>
      {(error || loadError) && (
        <p role="alert" className="wi-error">
          {error || loadError}
        </p>
      )}
      {stale && proposal.state !== 'applied' && (
        <p role="alert">The saved process changed. Request a fresh proposal.</p>
      )}
      {proposal.state === 'applied' ? (
        <Button
          color="secondary"
          className="wi-domain-link"
          href={`/processes?id=${encodeURIComponent(proposal.artifactId)}`}
        >
          Open process canvas
        </Button>
      ) : (
        <AgentGate
          variant="plan"
          title="Review process changes"
          planTitle="Save proposed process draft"
          planSummary={proposal.summary}
          plan={[
            {
              id: 'elements',
              title: `${proposal.content.graph.elements.length} elements`,
              detail: proposal.content.graph.elements.map((n) => n.name).join(', '),
            },
            {
              id: 'routes',
              title: `${proposal.content.graph.flows.length} sequence routes`,
              detail: 'Applying saves a draft revision; it does not review, compile or execute this process.',
            },
          ]}
          disabled={!allowed || applying}
          approvalDisabled={!baseline || stale}
          approveLabel={applying ? 'Applying…' : 'Apply reviewed changes'}
          rejectLabel="Request changes"
          onApprove={() => void onApply(proposal)}
          onReject={() => void onRequestChanges()}
        />
      )}
    </div>
  );
}
function OntologyProposalReview({
  proposal,
  error,
  applying,
  allowed,
  onApply,
  onRequestChanges,
}: {
  proposal?: OntologyProposal;
  error?: string;
  applying: boolean;
  allowed: boolean;
  onApply: (proposal: Proposal) => Promise<void>;
  onRequestChanges: () => Promise<void>;
}) {
  const [baseline, setBaseline] = useState<{ content: Ontology; version: number } | null>(null);
  const [baselineError, setBaselineError] = useState('');
  useEffect(() => {
    let alive = true;
    setBaseline(null);
    setBaselineError('');
    if (proposal)
      void controlRequest(`/api/knowledge/artifacts/${encodeURIComponent(proposal.artifactId)}`)
        .then((data) => {
          if (alive)
            setBaseline({ content: ontologySchema.parse(data.revision.content), version: data.artifact.editVersion });
        })
        .catch((error) => {
          if (alive) setBaselineError(error.message);
        });
    return () => {
      alive = false;
    };
  }, [proposal?.id, proposal?.state]);
  if (!proposal) return <p>This proposal is no longer in the selected run. Reopen it from the session.</p>;
  const stale = baseline && proposal.state !== 'applied' && baseline.version !== proposal.expectedVersion;
  const versions = [
    ...(baseline
      ? [
          {
            id: 'saved',
            label: `Saved ontology · version ${baseline.version}`,
            content: ontologyDocument(baseline.content),
          },
        ]
      : []),
    {
      id: proposal.id,
      label: proposal.state === 'applied' ? 'Applied draft' : 'Proposed draft',
      content: ontologyDocument(proposal.content),
    },
  ];
  return (
    <div className="wi-inspector">
      <h2>Ontology changes</h2>
      <p>{proposal.summary}</p>
      <OntologyReviewPreview
        proposed={proposal.content}
        applied={proposal.state === 'applied'}
        saved={proposal.state === 'applied' ? undefined : baseline?.content}
      />
      {baseline && proposal.state !== 'applied' && (
        <ProposalChanges changes={ontologyChanges(baseline.content, proposal.content)} />
      )}
      <details className="wi-advanced">
        <summary>Technical ontology definition</summary>
        <ArtifactPanel
          className="h-[min(50vh,480px)]"
          title="Ontology proposal"
          kind="document"
          versions={versions}
          filename="ontology-review.md"
        />
      </details>
      {error && (
        <p role="alert" className="wi-error">
          {activityError(error)}
        </p>
      )}
      {baselineError && (
        <p role="alert" className="wi-error">
          Could not load the current ontology: {baselineError}
        </p>
      )}
      {!baseline && !baselineError && <p role="status">Comparing with the saved ontology…</p>}
      {stale && (
        <p role="alert" className="wi-error">
          The saved ontology has changed. Request a new proposal before applying.
        </p>
      )}
      {proposal.state === 'applied' ? (
        <Button
          color="secondary"
          className="wi-domain-link"
          href={`/ontology?id=${encodeURIComponent(proposal.artifactId)}`}
        >
          Open ontology
        </Button>
      ) : (
        <AgentGate
          variant="plan"
          title="Review ontology changes"
          planTitle="Save proposed ontology draft"
          planSummary={`${proposal.summary} Based on version ${proposal.expectedVersion}. Applying saves a new draft revision.`}
          plan={[
            {
              id: 'entities',
              title: `${proposal.content.entities.length} proposed entities`,
              detail: proposal.content.entities.map((entity) => entity.name).join(', '),
            },
            {
              id: 'relationships',
              title: `${proposal.content.relationships.length} proposed relationships`,
              detail: proposal.content.relationships.map((relationship) => relationship.name).join(', '),
            },
            {
              id: 'removed',
              title: 'Removed from the saved ontology',
              detail: baseline
                ? [
                    ...baseline.content.entities
                      .filter((entity) => !proposal.content.entities.some((next) => next.id === entity.id))
                      .map((entity) => entity.name),
                    ...baseline.content.relationships
                      .filter(
                        (relationship) => !proposal.content.relationships.some((next) => next.id === relationship.id),
                      )
                      .map((relationship) => relationship.name),
                  ].join(', ') || 'None'
                : 'Waiting for the saved ontology',
            },
          ]}
          disabled={!allowed || applying || proposal.state !== 'proposed'}
          approvalDisabled={!baseline || !!stale}
          approveLabel={applying ? 'Applying…' : 'Apply reviewed changes'}
          rejectLabel="Request changes"
          onApprove={() => void onApply(proposal)}
          onReject={() => void onRequestChanges()}
        />
      )}
    </div>
  );
}

/** Data projection for the library document renderer; exact schema retained for review/export. */
function ontologyDocument(content: Ontology) {
  const text = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', ' ');
  return [
    '# Ontology draft',
    ...content.entities.map((entity) =>
      [
        `## ${text(entity.name)}`,
        entity.description ?? '',
        '| Property | Type | Required |',
        '| --- | --- | --- |',
        ...entity.properties.map(
          (property) => `| ${text(property.name)} | ${text(property.type)} | ${property.required ? 'Yes' : 'No'} |`,
        ),
      ].join('\n'),
    ),
    '## Relationships',
    ...content.relationships.map(
      (relationship) =>
        `${text(content.entities.find((entity) => entity.id === relationship.sourceId)?.name ?? relationship.sourceId)} → **${text(relationship.name)}** → ${text(content.entities.find((entity) => entity.id === relationship.targetId)?.name ?? relationship.targetId)}`,
    ),
    '## Complete schema',
    '```json',
    JSON.stringify(content, null, 2),
    '```',
  ].join('\n\n');
}
