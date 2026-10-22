'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { agentRequest } from '@/lib/agent/client';
import type { AgentConfiguration, WorkspaceRequest } from '@/lib/agent/contracts';
import { agentActiveStates } from '@/lib/agent/status';
import type { SessionRow, SessionDetail, WorkDetail } from '@/lib/agent/workbench-model';
import { emptyLiveRun, receiveRunEvent } from '@/lib/agent/live-run';
import { useWorkspaceRefresh } from './use-workspace-events';

export function useIntelligence(workspaceId: string, selected: string, archived = false, activityId?: string) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [activities, setActivities] = useState<{ id: string; sessionId: string; state: string }[]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [configuration, setConfiguration] = useState<(AgentConfiguration & { editVersion: number }) | null>(null);
  const [error, setError] = useState('');
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<{ requestId: string; sessionId: string; text?: string; kind?: string } | null>(
    null,
  );
  const [live, setLive] = useState(emptyLiveRun(''));
  const [connection, setConnection] = useState<'live' | 'reconnecting' | 'idle'>('idle');
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const attempt = useRef<{ fingerprint: string; request: WorkspaceRequest } | null>(null);
  const draftSession = useRef<{ title: string; key: string; id?: string } | null>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useWorkspaceRefresh(refresh);
  const active = !!work && agentActiveStates.includes(work.state as (typeof agentActiveStates)[number]);

  useEffect(() => {
    let alive = true;
    void Promise.all([agentRequest(`sessions?archived=${archived}`), agentRequest('state'), agentRequest('activities')])
      .then(([list, state, activity]) => {
        if (alive) {
          setSessions(list.items);
          setConfiguration(state.configuration);
          setConfigurationLoaded(true);
          setActivities(activity.items);
        }
      })
      .catch((error) => {
        if (alive) {
          setError(error.message);
          setConfigurationLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [workspaceId, revision, archived]);

  useEffect(() => {
    let alive = true;
    setLoading(!!selected);
    setDetail(null);
    setWork(null);
    setLive(emptyLiveRun(''));
    setError('');
    if (selected)
      void agentRequest(`sessions/${encodeURIComponent(selected)}`)
        .then(async (data: SessionDetail) => {
          const currentId = activityId || data.workItems[0]?.id;
          const next = currentId ? await agentRequest(`work-items/${encodeURIComponent(currentId)}`) : null;
          if (next && next.sessionId !== selected)
            throw Error('This activity does not belong to the selected history.');
          if (alive) {
            setDetail(data);
            setWork(next);
          }
        })
        .catch((error) => {
          if (alive) setError(error.message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    return () => {
      alive = false;
    };
  }, [workspaceId, selected, activityId]);

  // Refresh snapshots without unmounting the thread, form or user's scroll position.
  useEffect(() => {
    if (!selected) return;
    let alive = true,
      fetching = false;
    const sync = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const data: SessionDetail = await agentRequest(`sessions/${encodeURIComponent(selected)}`);
        const currentId = activityId || data.workItems[0]?.id;
        const next = currentId ? await agentRequest(`work-items/${encodeURIComponent(currentId)}`) : null;
        if (next && next.sessionId !== selected) throw Error('This activity does not belong to the selected history.');
        if (alive) {
          setDetail(data);
          setWork(next);
        }
      } catch (error) {
        if (alive) setError(error instanceof Error ? error.message : 'Could not refresh work.');
      } finally {
        fetching = false;
      }
    };
    void sync();
    const timer = active || pending ? setInterval(() => void sync(), 1800) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [workspaceId, selected, activityId, revision, active, pending]);

  useEffect(() => {
    if (!pending) return;
    let alive = true,
      fetching = false;
    const check = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const receipt = await agentRequest(`requests/${encodeURIComponent(pending.requestId)}`);
        if (!alive) return;
        if (receipt.state !== 'queued') {
          setPending(null);
          sessionStorage.removeItem(`sp-intake:${workspaceId}`);
          refresh();
          if (receipt.state === 'rejected') setError(receipt.error ?? 'The agent could not accept this instruction.');
        }
      } catch (error) {
        if (alive) setError(error instanceof Error ? error.message : 'Could not check submission.');
      } finally {
        fetching = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [workspaceId, pending, refresh]);
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(`sp-intake:${workspaceId}`) ?? 'null');
      if (stored?.requestId && stored?.sessionId) setPending(stored);
    } catch {
      /* An unavailable browser store does not prevent durable server work. */
    }
  }, [workspaceId]);

  useEffect(() => {
    const workId = work?.id;
    if (!workId) return;
    let projected = emptyLiveRun(workId);
    setLive(projected);
    const stream = new EventSource(`/api/agent/work-items/${encodeURIComponent(workId)}/events`);
    stream.onopen = () => setConnection('live');
    stream.onerror = () => setConnection('reconnecting');
    stream.addEventListener('agent', (event) => {
      try {
        projected = receiveRunEvent(projected, JSON.parse((event as MessageEvent).data));
        setLive(projected);
      } catch {
        setError('An activity update could not be read. Refresh this session to resync.');
      }
    });
    stream.addEventListener('state', () => {
      stream.close();
      setConnection('idle');
      refresh();
    });
    return () => {
      stream.close();
      setConnection('idle');
    };
  }, [workspaceId, work?.id, work?.state, refresh]);

  const submit = async (request: Omit<WorkspaceRequest, 'clientRequestId'>, textKey: string) => {
    if (mutation.current) throw new Error('An instruction is already being submitted.');
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      const fingerprint = JSON.stringify([request, textKey]);
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { fingerprint, request: { ...request, clientRequestId: crypto.randomUUID() } };
      const receipt = await agentRequest('requests', attempt.current.request);
      const accepted = {
        requestId: receipt.requestId,
        sessionId: request.sessionId!,
        text: request.text,
        kind: request.kind,
      };
      setPending(accepted);
      try {
        sessionStorage.setItem(
          `sp-intake:${workspaceId}`,
          JSON.stringify({ requestId: accepted.requestId, sessionId: accepted.sessionId }),
        );
      } catch {
        /* Optional browser recovery hint. */
      }
      attempt.current = null;
      refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Submission failed.');
      throw error;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const createSession = async (text: string) => {
    if (draftSession.current?.title !== text) draftSession.current = { title: text, key: crypto.randomUUID() };
    const draft = draftSession.current;
    if (!draft.id) {
      const result = await agentRequest('sessions', { clientKey: draft.key, title: text.split('\n')[0].slice(0, 64) });
      draft.id = result.id;
    }
    return draft.id!;
  };
  return {
    sessions,
    activities,
    detail,
    work,
    configuration,
    configurationLoaded,
    error,
    setError,
    loading,
    pending,
    live: live.workId === work?.id ? live : emptyLiveRun(work?.id ?? ''),
    connection,
    active,
    busy,
    refresh,
    submit,
    createSession,
    resetDraft: () => {
      draftSession.current = null;
    },
  };
}
