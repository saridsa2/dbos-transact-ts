'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useEventCallback } from 'usehooks-ts';
import type { WorkspaceNotification } from '@/lib/control/contracts';

type StreamState = {
  notifications: WorkspaceNotification[];
  markRead: (ids: string[]) => Promise<void>;
  revision: number;
  status: 'connecting' | 'live' | 'reconnecting' | 'offline';
};
export const WorkspaceStreamContext = createContext<StreamState>({
  notifications: [],
  markRead: async () => {},
  revision: 0,
  status: 'connecting',
});
export const useWorkspaceStream = () => useContext(WorkspaceStreamContext);

/** One authenticated SSE connection for the entire shell, never one per screen. */
export function useWorkspaceEvents(
  workspaceId: string | undefined,
  onAccessChanged: () => void,
  authorizationKey = '',
): StreamState {
  const [state, setState] = useState<Omit<StreamState, 'markRead'>>({
    notifications: [],
    revision: 0,
    status: 'connecting',
  });
  const accessChanged = useEventCallback(onAccessChanged);
  useEffect(() => {
    if (!workspaceId) return;
    let disposed = false,
      source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    setState({ notifications: [], revision: 0, status: 'connecting' });
    async function connect() {
      try {
        const response = await fetch('/api/control/notifications');
        if (!response.ok) {
          if ([401, 403].includes(response.status)) {
            accessChanged();
            return;
          }
          throw new Error('Notifications unavailable');
        }
        const data = await response.json();
        if (disposed) return;
        for (const event of data.events as WorkspaceNotification[]) seen.add(event.id);
        setState({ notifications: data.events, revision: 0, status: 'connecting' });
        source = new EventSource(
          `/api/control/events?workspace=${encodeURIComponent(workspaceId!)}&after=${data.cursor}`,
        );
        source.addEventListener('ready', () => {
          if (!disposed) setState((old) => ({ ...old, status: 'live', revision: old.revision + 1 }));
        });
        source.addEventListener('workspace', (message) => {
          const event: WorkspaceNotification = JSON.parse((message as MessageEvent).data);
          if (disposed || seen.has(event.id)) return;
          seen.add(event.id);
          if (seen.size > 2000) seen.delete(seen.values().next().value!);
          setState((old) => ({
            ...old,
            revision: old.revision + 1,
            notifications:
              event.action === 'execution.progress' ? old.notifications : [event, ...old.notifications].slice(0, 30),
          }));
        });
        source.addEventListener('access-changed', () => {
          source?.close();
          if (!disposed) accessChanged();
        });
        source.onerror = () => {
          if (!disposed) setState((old) => ({ ...old, status: 'reconnecting' }));
        };
      } catch {
        if (!disposed) {
          setState((old) => ({ ...old, status: 'offline' }));
          retry = setTimeout(() => void connect(), 2000);
        }
      }
    }
    void connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [workspaceId, authorizationKey, accessChanged]);
  const markRead = useEventCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const response = await fetch('/api/control/notifications/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error('Could not mark notifications as read.');
    const reads: { id: string; readAt: string }[] = await response.json();
    setState((old) => ({
      ...old,
      notifications: old.notifications.map((event) => {
        const read = reads.find((item) => item.id === event.id);
        return read ? { ...event, readAt: read.readAt } : event;
      }),
    }));
  });
  return { ...state, markRead };
}

/** Coalesce a worker's burst of checkpoints into one data refresh. */
export function useWorkspaceRefresh(refresh: () => void | Promise<void>) {
  const { revision } = useWorkspaceStream();
  const refreshLatest = useEventCallback(refresh);
  useEffect(() => {
    if (!revision) return;
    const timer = setTimeout(() => void refreshLatest(), 120);
    return () => clearTimeout(timer);
  }, [revision, refreshLatest]);
}
