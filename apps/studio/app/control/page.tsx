'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ControlButton, ControlInput, ControlSelect, ControlModal } from '@/components/control/controls';
import { WorkArea, TableViewport, RecordAction, EmptyState } from '@/components/control/work-area';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import type { ContextPermissions } from '@/lib/agent/context-uploads';
import { agentRequest } from '@/lib/agent/client';
import { Table } from '@/components/application/table/table';
import { useWorkspaceRefresh } from '@/hooks/use-workspace-events';
import { useControlNavigation } from '@/hooks/use-control-navigation';
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronRight,
  Edit01,
  KeyRound,
  Link2,
  Plus,
  ShieldCheck,
  Users,
  X,
} from '@/components/fa-icons';
import { canManage, providers, type AuditEvent, type Connection, type Member } from '@/lib/control/contracts';
import { controlRequest, useControl } from '@/components/control/access';
import { WorkspaceApiKeys } from '@/components/control/workspace-api-keys';
import { ConnectionForm, RotateCredential } from '@/components/control/connection-form';

type Run = {
  id: string;
  flow_id: string;
  flow_name: string;
  status: string;
  created_at: string;
  actor: string;
  parent_id?: string;
};
type Invitation = { id: string; email: string; role: string; expiresAt: string; acceptedAt?: string };
const titles = {
  overview: 'Overview',
  connections: 'Connections',
  team: 'People',
  runs: 'Run history',
  audit: 'Audit trail',
  keys: 'API keys',
  identity: 'Identity',
};
const descriptions = {
  overview: 'Workspace health and setup progress.',
  connections: 'Manage provider keys, data sources and temporary credentials.',
  team: 'Manage workspace membership and invitations.',
  runs: 'Trace executions, outcomes and the people who started them.',
  audit: 'Review workspace activity. Credential values are excluded.',
  keys: 'Manage workspace CLI access.',
  identity: 'Review your sign-in identity and federation adapter.',
};
export default function ControlPage() {
  const { session, refresh: refreshSession } = useControl();
  const workspace = session.workspace;
  const manage = workspace ? canManage(workspace.role) : false;
  const { tab } = useControlNavigation();
  const router = useRouter();
  const search = useSearchParams();
  const peopleView =
    manage && ['invitations', 'permissions'].includes(search.get('view') ?? '') ? search.get('view')! : 'members';
  const context = `${workspace?.id}:${tab}:${tab === 'team' ? peopleView : ''}`;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [contextPermissions, setContextPermissions] = useState<ContextPermissions>();
  const [editorUploadDraft, setEditorUploadDraft] = useState<boolean>();
  useEffect(() => {
    setContextPermissions(undefined);
    setEditorUploadDraft(undefined);
  }, [workspace?.id]);
  const [members, setMembers] = useState<Member[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [dataError, setDataError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadedContext, setLoadedContext] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [add, setAdd] = useState(false);
  const [editing, setEditing] = useState<Connection>();
  const [rotating, setRotating] = useState<Connection>();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteNotice, setInviteNotice] = useState('');
  const [queries, setQueries] = useState<Record<string, string>>({});
  const queryKey = `${tab}:${peopleView}`;
  const query = queries[queryKey] ?? '';
  const [status, setStatus] = useState('all');
  const [confirm, setConfirm] = useState<{ title: string; description: string; action: () => Promise<void> } | null>(
    null,
  );
  const [confirmError, setConfirmError] = useState('');
  const [roleMember, setRoleMember] = useState<Member>();
  const [memberRole, setMemberRole] = useState('editor');
  const [roleError, setRoleError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paging, setPaging] = useState(false);
  const requestId = useRef(0);
  const expandedAudit = useRef(false);
  const inviteToken = search.get('invite');
  const loading = loadedContext !== context;
  const refresh = useCallback(async () => {
    if (!workspace || inviteToken) return;
    const id = ++requestId.current;
    setRefreshing(true);
    try {
      if (tab === 'overview') {
        const [c, m, r] = await Promise.all([
          controlRequest('/api/control/connections'),
          controlRequest('/api/control/members'),
          controlRequest('/api/control/runs'),
        ]);
        if (id !== requestId.current) return;
        setConnections(c);
        setMembers(m);
        setRuns(r);
      } else if (tab === 'connections') {
        const result = await controlRequest('/api/control/connections');
        if (id !== requestId.current) return;
        setConnections(result);
      } else if (tab === 'team') {
        const permissions: ContextPermissions = await agentRequest('context-permissions');
        const result =
          peopleView === 'permissions'
            ? null
            : await controlRequest(peopleView === 'members' ? '/api/control/members' : '/api/control/invitations');
        if (id !== requestId.current) return;
        setContextPermissions(permissions);
        setEditorUploadDraft((current) => current ?? permissions.editorUpload);
        if (peopleView === 'members') setMembers(result);
        else if (peopleView === 'invitations') setInvitations(result);
      } else if (tab === 'runs') {
        const result = await controlRequest('/api/control/runs');
        if (id !== requestId.current) return;
        setRuns(result);
      } else if (tab === 'audit' && manage) {
        const result = await controlRequest('/api/control/audit');
        if (id !== requestId.current) return;
        setAudit((current) =>
          expandedAudit.current
            ? [
                ...result.events,
                ...current.filter((event) => !result.events.some((newEvent: AuditEvent) => event.id === newEvent.id)),
              ]
            : result.events,
        );
        if (!expandedAudit.current) setCursor(result.nextCursor);
      }
      if (id === requestId.current) {
        setDataError('');
        setLoadedContext(context);
      }
    } catch (err) {
      if (id === requestId.current) {
        setDataError(err instanceof Error ? err.message : 'Could not load workspace.');
        setLoadedContext(context);
      }
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, [workspace?.id, tab, peopleView, manage, context, inviteToken]);
  useEffect(() => {
    expandedAudit.current = false;
    setError('');
    setNotice('');
    setConfirm(null);
    setRoleMember(undefined);
    setInviteOpen(false);
    setEditing(undefined);
    setRotating(undefined);
    setAdd(false);
    void refresh();
    return () => {
      requestId.current++;
    };
  }, [refresh]);
  useWorkspaceRefresh(refresh);
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setNotice(message);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }
  if (inviteToken)
    return (
      <main className="cp-gate">
        <section className="cp-onboarding">
          <header className="sp-dialog-header">
            <h1>Join your team</h1>
          </header>
          <div className="sp-dialog-body">
            <p>Accept this invitation as {session.user?.email}. The invitation determines your workspace and role.</p>
            {error && (
              <p role="alert" className="cp-error">
                {error}
              </p>
            )}
          </div>
          <footer>
            <Link href="/control">Back to workspace</Link>
            <ControlButton
              className="cp-primary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await controlRequest('/api/control/invitations/accept', { token: inviteToken });
                  window.location.href = '/control';
                }, 'Invitation accepted.')
              }
            >
              Accept invitation
            </ControlButton>
          </footer>
        </section>
      </main>
    );
  if (!workspace) return null;
  if (tab === 'keys') return <WorkspaceApiKeys key={workspace.id} manage={manage} workspaceId={workspace.id} />;
  const active = connections.filter((c) => c.status === 'configured');
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const filteredConnections = connections.filter((c) => matches(`${c.name} ${c.provider} ${c.status}`));
  const filteredMembers = members.filter((m) => matches(`${m.displayName} ${m.email} ${m.role}`));
  const filteredInvitations = invitations.filter((i) => !i.acceptedAt && matches(`${i.email} ${i.role}`));
  const filteredRuns = runs.filter(
    (r) => (status === 'all' || r.status === status) && matches(`${r.flow_name} ${r.id} ${r.actor}`),
  );
  const filteredAudit = audit.filter((e) =>
    matches(`${e.action} ${e.actor} ${e.entityType} ${e.entityId} ${JSON.stringify(e.details)}`),
  );
  const forbidden = tab === 'audit' && !manage;
  const hasSearch =
    ['connections', 'team', 'runs', 'audit'].includes(tab) &&
    !forbidden &&
    !(tab === 'team' && peopleView === 'permissions');
  const count =
    tab === 'connections'
      ? filteredConnections.length
      : tab === 'team'
        ? peopleView === 'members'
          ? filteredMembers.length
          : filteredInvitations.length
        : tab === 'runs'
          ? filteredRuns.length
          : filteredAudit.length;
  const tableReady = !loading && !dataError && !forbidden;
  return (
    <>
      <WorkArea
        title={titles[tab]}
        description={descriptions[tab]}
        contextKey={context}
        scroll={tab === 'overview' || tab === 'identity'}
        actions={
          <>
            {hasSearch && (
              <ControlInput
                aria-label={`Search ${titles[tab].toLowerCase()}`}
                placeholder={`Search ${titles[tab].toLowerCase()}`}
                value={query}
                onChange={(e) => setQueries((old) => ({ ...old, [queryKey]: e.target.value }))}
              />
            )}
            {tab === 'runs' && (
              <ControlSelect aria-label="Run status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All statuses</option>
                {['queued', 'running', 'waiting', 'succeeded', 'failed'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </ControlSelect>
            )}
            <ControlButton
              disabled={refreshing}
              onClick={() => void (tab === 'identity' ? refreshSession() : refresh())}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </ControlButton>
            {manage && tab === 'connections' && (
              <ControlButton className="cp-primary" iconLeading={Plus} onClick={() => setAdd(true)}>
                Add connection
              </ControlButton>
            )}
            {manage && tab === 'team' && peopleView === 'permissions' && (
              <ControlButton
                color="primary"
                disabled={
                  busy ||
                  !contextPermissions ||
                  editorUploadDraft === undefined ||
                  editorUploadDraft === contextPermissions.editorUpload
                }
                onPress={() =>
                  void action(async () => {
                    const saved: ContextPermissions = await agentRequest(
                      'context-permissions',
                      { expectedVersion: contextPermissions!.editVersion, editorUpload: editorUploadDraft },
                      'PUT',
                    );
                    setContextPermissions(saved);
                    setEditorUploadDraft(saved.editorUpload);
                  }, 'Context upload permissions saved.')
                }
              >
                Save permissions
              </ControlButton>
            )}
            {manage && tab === 'team' && peopleView !== 'permissions' && (
              <ControlButton
                className="cp-primary"
                iconLeading={Plus}
                onClick={() => {
                  setInviteError('');
                  setInviteNotice('');
                  setInviteLink('');
                  setInviteEmail('');
                  setInviteOpen(true);
                }}
              >
                Invite teammate
              </ControlButton>
            )}
          </>
        }
        navigation={
          tab === 'team'
            ? {
                label: 'People views',
                value: peopleView,
                items: [
                  { id: 'members', label: 'Members' },
                  ...(manage
                    ? [
                        { id: 'invitations', label: 'Invitations' },
                        { id: 'permissions', label: 'Context permissions' },
                      ]
                    : []),
                ],
                onChange: (view) => router.push(`/control?tab=team&view=${view}`),
              }
            : undefined
        }
        status={
          error || notice ? (
            <>
              {error && (
                <p role="alert" className="cp-error">
                  {error}
                </p>
              )}
              {notice && (
                <div role="status" className="cp-success">
                  {notice}
                  <ControlButton aria-label="Dismiss notification" iconLeading={X} onClick={() => setNotice('')} />
                </div>
              )}
            </>
          ) : undefined
        }
        footer={
          hasSearch && tableReady ? (
            <>
              <span>
                {count}{' '}
                {tab === 'runs' ? 'of latest 100 executions' : tab === 'audit' ? 'matching loaded events' : 'results'}
              </span>
              {tab === 'connections' && <span>Credentials are write-only. Provider access is not verified.</span>}
              {tab === 'audit' && cursor && (
                <ControlButton
                  disabled={paging}
                  onClick={async () => {
                    const id = requestId.current;
                    setPaging(true);
                    try {
                      const page = await controlRequest(`/api/control/audit?before=${cursor}`);
                      if (id !== requestId.current) return;
                      expandedAudit.current = true;
                      setAudit((current) => [
                        ...current,
                        ...page.events.filter((e: AuditEvent) => !current.some((old) => old.id === e.id)),
                      ]);
                      setCursor(page.nextCursor);
                    } catch (err) {
                      if (id === requestId.current)
                        setError(err instanceof Error ? err.message : 'Could not load earlier events.');
                    } finally {
                      setPaging(false);
                    }
                  }}
                >
                  {paging ? 'Loading…' : 'Load earlier events'}
                </ControlButton>
              )}
            </>
          ) : undefined
        }
      >
        {loading ? (
          <div role="status" className="sp-empty">
            Loading {titles[tab].toLowerCase()}…
          </div>
        ) : dataError ? (
          <div className="sp-empty" role="alert">
            <h2>Could not load {titles[tab].toLowerCase()}</h2>
            <p>{dataError}</p>
          </div>
        ) : forbidden ? (
          <EmptyState title="Access restricted">An owner or admin can review the audit trail.</EmptyState>
        ) : (
          <>
            {tab === 'overview' && (
              <div className="sp-summary">
                <div className="cp-stats">
                  {[
                    { label: 'Connections', value: active.length, detail: 'Configured in this workspace', icon: Link2 },
                    { label: 'People', value: members.length, detail: 'Workspace members', icon: Users },
                    {
                      label: 'Recent runs',
                      value: runs.filter((r) => !r.parent_id).length,
                      detail: 'From the latest 100 executions',
                      icon: Activity,
                    },
                    {
                      label: 'Failed executions',
                      value: runs.filter((r) => r.status === 'failed').length,
                      detail: 'From the latest 100 executions',
                      icon: ShieldCheck,
                    },
                  ].map((stat) => (
                    <section key={stat.label}>
                      <stat.icon size={19} />
                      <p>{stat.label}</p>
                      <strong>{stat.value}</strong>
                      <small>{stat.detail}</small>
                    </section>
                  ))}
                </div>
                <section className="cp-card">
                  <h2>Workspace setup</h2>
                  <p>Progress toward your first durable workflow.</p>
                  {[
                    { done: true, label: 'Customer and workspace created', detail: workspace.customerName },
                    {
                      done: active.length > 0,
                      label: 'Service connected',
                      detail: 'Manage provider access in Connections.',
                    },
                    { done: members.length > 1, label: 'Team invited', detail: 'Manage membership in People.' },
                    {
                      done: runs.length > 0,
                      label: 'Workflow executed',
                      detail: 'Inspect execution outcomes in Run history.',
                    },
                  ].map((item) => (
                    <div className="cp-checklist-row" key={item.label}>
                      <span className={item.done ? 'done' : ''}>
                        {item.done ? <Check size={15} /> : <ChevronRight size={15} />}
                      </span>
                      <div>
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </div>
                    </div>
                  ))}
                </section>
              </div>
            )}
            {tab === 'connections' &&
              (filteredConnections.length ? (
                <TableViewport label="Scrollable connections">
                  <Table aria-label="Workspace connections">
                    <Table.Header>
                      <Table.Head isRowHeader>Connection</Table.Head>
                      <Table.Head>Authentication</Table.Head>
                      <Table.Head>Status</Table.Head>
                      <Table.Head>Revision</Table.Head>
                      <Table.Head>Actions</Table.Head>
                    </Table.Header>
                    <Table.Body>
                      {filteredConnections.map((c) => (
                        <Table.Row key={c.id}>
                          <Table.Cell>
                            <strong>{c.name}</strong>
                            <small>{providers.find((p) => p.id === c.provider)?.name}</small>
                          </Table.Cell>
                          <Table.Cell>
                            {c.authKind === 'sts'
                              ? 'AWS STS session'
                              : c.authKind === 'api_key'
                                ? 'API key'
                                : c.authKind === 'client_secret'
                                  ? 'Service principal'
                                  : c.authKind === 'password'
                                    ? 'Password'
                                    : 'Bearer token'}
                            <small>
                              {c.hasSecret
                                ? c.authKind === 'sts'
                                  ? 'External ID stored'
                                  : 'Credential stored'
                                : c.authKind === 'sts'
                                  ? 'Workload identity resolver'
                                  : 'No credential stored'}
                            </small>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="cp-tag">
                              {c.status === 'revoked'
                                ? 'Revoked'
                                : c.authKind === 'sts' && !c.resolverAvailable
                                  ? 'Resolver needed'
                                  : 'Configured'}
                            </span>
                          </Table.Cell>
                          <Table.Cell>
                            v{c.revision}
                            <small>{new Date(c.updatedAt).toLocaleDateString()}</small>
                          </Table.Cell>
                          <Table.Cell>
                            {manage && c.status !== 'revoked' ? (
                              <div className="sp-row-actions">
                                <RecordAction label={`Edit ${c.name}`} icon={Edit01} onPress={() => setEditing(c)} />
                                <RecordAction
                                  label={`Rotate credential for ${c.name}`}
                                  icon={KeyRound}
                                  onPress={() => setRotating(c)}
                                />
                                <RecordAction
                                  label={`Revoke ${c.name}`}
                                  icon={X}
                                  onPress={() => {
                                    setConfirmError('');
                                    setConfirm({
                                      title: `Revoke ${c.name}?`,
                                      description:
                                        'This workspace will lose access to the stored credential. The key at the provider is not changed.',
                                      action: async () => {
                                        await controlRequest(`/api/control/connections/${c.id}/revoke`, {
                                          revision: c.revision,
                                        });
                                      },
                                    });
                                  }}
                                />
                              </div>
                            ) : (
                              '—'
                            )}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </TableViewport>
              ) : (
                <EmptyState title={query ? 'No matching connections' : 'No connections yet'}>
                  {query
                    ? 'Try a different search.'
                    : 'Use Add connection in the header to connect your first service.'}
                </EmptyState>
              ))}
            {tab === 'team' && peopleView === 'permissions' && manage && (
              <TableViewport label="Context permissions by role">
                <Table aria-label="Context upload permissions">
                  <Table.Header>
                    <Table.Head isRowHeader>Role</Table.Head>
                    <Table.Head>Upload new context</Table.Head>
                    <Table.Head>Access</Table.Head>
                  </Table.Header>
                  <Table.Body>
                    {['owner', 'admin', 'editor', 'viewer'].map((role) => (
                      <Table.Row key={role}>
                        <Table.Cell>{role[0].toUpperCase() + role.slice(1)}</Table.Cell>
                        <Table.Cell>
                          <Checkbox
                            aria-label={`Allow ${role} context uploads`}
                            isSelected={role === 'editor' ? !!editorUploadDraft : role === 'owner' || role === 'admin'}
                            isDisabled={role !== 'editor' || busy}
                            onChange={setEditorUploadDraft}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          {role === 'viewer'
                            ? 'Read-only workspace access'
                            : role === 'editor'
                              ? 'Configurable by owners and admins'
                              : 'Can upload and manage this permission'}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </TableViewport>
            )}
            {tab === 'team' &&
              peopleView === 'members' &&
              (filteredMembers.length ? (
                <TableViewport label="Scrollable members">
                  <Table aria-label="Workspace members">
                    <Table.Header>
                      <Table.Head isRowHeader>Member</Table.Head>
                      <Table.Head>Role</Table.Head>
                      <Table.Head>Actions</Table.Head>
                    </Table.Header>
                    <Table.Body>
                      {filteredMembers.map((m) => (
                        <Table.Row key={m.id}>
                          <Table.Cell>
                            <strong>{m.displayName}</strong>
                            <small>{m.email}</small>
                          </Table.Cell>
                          <Table.Cell>{m.role}</Table.Cell>
                          <Table.Cell>
                            {manage && m.role !== 'owner' && (workspace.role === 'owner' || m.role !== 'admin') ? (
                              <div className="sp-row-actions">
                                <RecordAction
                                  label={`Change role for ${m.displayName}`}
                                  icon={Edit01}
                                  onPress={() => {
                                    setRoleMember(m);
                                    setMemberRole(m.role);
                                    setRoleError('');
                                  }}
                                />
                                <RecordAction
                                  label={`Remove ${m.displayName}`}
                                  icon={X}
                                  onPress={() => {
                                    setConfirmError('');
                                    setConfirm({
                                      title: `Remove ${m.displayName}?`,
                                      description: 'This removes workspace access. You can invite them again later.',
                                      action: async () => {
                                        await controlRequest(`/api/control/members/${m.id}`, undefined, 'DELETE');
                                      },
                                    });
                                  }}
                                />
                              </div>
                            ) : (
                              '—'
                            )}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </TableViewport>
              ) : (
                <EmptyState title="No matching members">Try a different search.</EmptyState>
              ))}
            {tab === 'team' &&
              peopleView === 'invitations' &&
              (filteredInvitations.length ? (
                <TableViewport label="Scrollable invitations">
                  <Table aria-label="Workspace invitations">
                    <Table.Header>
                      <Table.Head isRowHeader>Email</Table.Head>
                      <Table.Head>Role</Table.Head>
                      <Table.Head>Status</Table.Head>
                      <Table.Head>Expires</Table.Head>
                      <Table.Head>Actions</Table.Head>
                    </Table.Header>
                    <Table.Body>
                      {filteredInvitations.map((i) => (
                        <Table.Row key={i.id}>
                          <Table.Cell>{i.email}</Table.Cell>
                          <Table.Cell>{i.role}</Table.Cell>
                          <Table.Cell>{new Date(i.expiresAt) > new Date() ? 'Pending' : 'Expired'}</Table.Cell>
                          <Table.Cell>{new Date(i.expiresAt).toLocaleDateString()}</Table.Cell>
                          <Table.Cell>
                            {new Date(i.expiresAt) > new Date() && (
                              <RecordAction
                                label={`Revoke invitation for ${i.email}`}
                                icon={X}
                                disabled={busy}
                                onPress={() => {
                                  setConfirmError('');
                                  setConfirm({
                                    title: `Revoke invitation for ${i.email}?`,
                                    description: 'This invitation link will no longer grant workspace access.',
                                    action: async () => {
                                      await controlRequest(`/api/control/invitations/${i.id}`, undefined, 'DELETE');
                                    },
                                  });
                                }}
                              />
                            )}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </TableViewport>
              ) : (
                <EmptyState title={query ? 'No matching invitations' : 'No pending invitations'}>
                  Use Invite teammate in the header to create an invitation.
                </EmptyState>
              ))}
            {tab === 'runs' &&
              (filteredRuns.length ? (
                <TableViewport label="Scrollable executions">
                  <Table aria-label="Workflow run history">
                    <Table.Header>
                      <Table.Head isRowHeader>Workflow</Table.Head>
                      <Table.Head>Status</Table.Head>
                      <Table.Head>Started by</Table.Head>
                      <Table.Head>Created</Table.Head>
                      <Table.Head>Actions</Table.Head>
                    </Table.Header>
                    <Table.Body>
                      {filteredRuns.map((r) => (
                        <Table.Row key={r.id}>
                          <Table.Cell>
                            <strong>{r.flow_name}</strong>
                            <small>
                              {r.id.slice(0, 18)}
                              {r.parent_id ? ' · child execution' : ''}
                            </small>
                          </Table.Cell>
                          <Table.Cell>
                            <span
                              className={`cp-tag ${r.status === 'failed' ? 'error' : r.status === 'succeeded' ? 'success' : ''}`}
                            >
                              {r.status}
                            </span>
                          </Table.Cell>
                          <Table.Cell>{r.actor}</Table.Cell>
                          <Table.Cell>{new Date(r.created_at).toLocaleString()}</Table.Cell>
                          <Table.Cell>
                            <RecordAction
                              label={`View trace for ${r.flow_name}, ${r.id}`}
                              icon={ArrowUpRight}
                              href={`/flows?flow=${encodeURIComponent(r.flow_id)}&run=${encodeURIComponent(r.id)}`}
                            />
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </TableViewport>
              ) : (
                <EmptyState title="No matching runs">
                  {query || status !== 'all'
                    ? 'Try another search or status.'
                    : 'Run a workflow to see its execution trace here.'}
                </EmptyState>
              ))}
            {tab === 'audit' &&
              (filteredAudit.length ? (
                <TableViewport label="Scrollable audit events">
                  <Table aria-label="Workspace audit trail">
                    <Table.Header>
                      <Table.Head isRowHeader>Activity</Table.Head>
                      <Table.Head>Actor</Table.Head>
                      <Table.Head>Resource</Table.Head>
                      <Table.Head>Time</Table.Head>
                    </Table.Header>
                    <Table.Body>
                      {filteredAudit.map((e) => (
                        <Table.Row key={e.id}>
                          <Table.Cell>
                            <strong>{e.action}</strong>
                            <small>
                              {Object.entries(e.details)
                                .map(([k, v]) => `${k}: ${String(v)}`)
                                .join(' · ')}
                            </small>
                          </Table.Cell>
                          <Table.Cell>{e.actor}</Table.Cell>
                          <Table.Cell>
                            {e.entityType}
                            <small>{e.entityId.slice(0, 20)}</small>
                          </Table.Cell>
                          <Table.Cell>{new Date(e.createdAt).toLocaleString()}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </TableViewport>
              ) : (
                <EmptyState title="No matching audit events">
                  {query
                    ? 'Search applies to loaded events. Load earlier events to include more history.'
                    : 'Workspace activity will appear here.'}
                </EmptyState>
              ))}
            {tab === 'identity' && (
              <section className="cp-card sp-identity">
                <h2>Sign-in details</h2>
                <p>Authentication adapters verify identities. Workspace membership determines application access.</p>
                <dl className="cp-details">
                  <dt>Adapter</dt>
                  <dd>{session.adapter}</dd>
                  <dt>Mode</dt>
                  <dd>{session.mode}</dd>
                  <dt>Identity issuer</dt>
                  <dd>{session.user?.issuer}</dd>
                  <dt>Email</dt>
                  <dd>{session.user?.email}</dd>
                  <dt>Email verified</dt>
                  <dd>{session.user?.emailVerified ? 'Verified' : 'Not verified'}</dd>
                </dl>
                <div className="cp-notice">
                  Enterprise identity and STS federation connect through the authentication adapter. Provider claims do
                  not automatically grant workspace roles.
                </div>
              </section>
            )}
          </>
        )}
      </WorkArea>
      {(add || editing) && (
        <ConnectionForm
          connection={editing}
          onClose={() => {
            setAdd(false);
            setEditing(undefined);
          }}
          onSaved={() => {
            setNotice('Connection saved. Provider access has not been verified.');
            void refresh();
          }}
        />
      )}
      {rotating && (
        <RotateCredential
          connection={rotating}
          onClose={() => setRotating(undefined)}
          onSaved={() => {
            setNotice('Credential rotated.');
            void refresh();
          }}
        />
      )}
      {inviteOpen && (
        <ControlModal label="Invite teammate" onClose={() => setInviteOpen(false)}>
          <form
            className="cp-modal"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setInviteError('');
              try {
                const result = await controlRequest('/api/control/invitations', {
                  email: inviteEmail,
                  role: inviteRole,
                });
                setInviteLink(new URL(result.path, window.location.origin).href);
                await refresh();
              } catch (err) {
                setInviteError(err instanceof Error ? err.message : 'Could not create invitation.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <header className="sp-dialog-header">
              <h2>Invite teammate</h2>
              <p>Create a link bound to their email. It expires in seven days.</p>
            </header>
            <div className="sp-dialog-body">
              {!inviteLink ? (
                <>
                  <label>
                    Email
                    <ControlInput
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </label>
                  <label>
                    Role
                    <ControlSelect value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                      {workspace.role === 'owner' && <option value="admin">Admin</option>}
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </ControlSelect>
                  </label>
                </>
              ) : (
                <>
                  <p role="status">Invitation created. Share this link with {inviteEmail}.</p>
                  <label>
                    Invitation link
                    <ControlInput readOnly value={inviteLink} />
                  </label>
                </>
              )}
              {inviteError && (
                <p role="alert" className="cp-error">
                  {inviteError}
                </p>
              )}
              {inviteNotice && <p role="status">{inviteNotice}</p>}
            </div>
            <footer>
              <ControlButton type="button" onClick={() => setInviteOpen(false)}>
                {inviteLink ? 'Close' : 'Cancel'}
              </ControlButton>
              {inviteLink ? (
                <ControlButton
                  type="button"
                  className="cp-primary"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(inviteLink)
                      .then(() => setInviteNotice('Invitation link copied.'))
                      .catch(() => setInviteError('Copy the invitation link from the field.'))
                  }
                >
                  Copy link
                </ControlButton>
              ) : (
                <ControlButton type="submit" className="cp-primary" disabled={busy}>
                  {busy ? 'Creating…' : 'Create invitation'}
                </ControlButton>
              )}
            </footer>
          </form>
        </ControlModal>
      )}
      {roleMember && (
        <ControlModal label={`Change role for ${roleMember.displayName}`} onClose={() => setRoleMember(undefined)}>
          <form
            className="cp-modal"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setRoleError('');
              try {
                await controlRequest(`/api/control/members/${roleMember.id}`, { role: memberRole }, 'PATCH');
                setRoleMember(undefined);
                setNotice('Role updated.');
                await refresh();
              } catch (err) {
                setRoleError(err instanceof Error ? err.message : 'Could not update role.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <header className="sp-dialog-header">
              <h2>Change workspace role</h2>
              <p>{roleMember.displayName}</p>
            </header>
            <div className="sp-dialog-body">
              <label>
                Role
                <ControlSelect value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
                  {workspace.role === 'owner' && <option value="admin">Admin</option>}
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </ControlSelect>
              </label>
              <p>
                {memberRole === 'viewer'
                  ? 'Viewers cannot upload context or change workspace records.'
                  : memberRole === 'editor'
                    ? contextPermissions?.editorUpload === false
                      ? 'Editors can edit workspace records; context uploads are currently disabled by workspace policy.'
                      : 'Editors can upload context. Uploads are saved as workspace sources and audited.'
                    : 'Admins can upload context and manage context permissions.'}
              </p>
              {roleError && (
                <p role="alert" className="cp-error">
                  {roleError}
                </p>
              )}
            </div>
            <footer>
              <ControlButton type="button" onClick={() => setRoleMember(undefined)}>
                Cancel
              </ControlButton>
              <ControlButton type="submit" className="cp-primary" disabled={busy}>
                Save role
              </ControlButton>
            </footer>
          </form>
        </ControlModal>
      )}
      {confirm && (
        <ControlModal label={confirm.title} onClose={() => setConfirm(null)}>
          <section className="cp-modal">
            <header className="sp-dialog-header">
              <h2>{confirm.title}</h2>
            </header>
            <div className="sp-dialog-body">
              <p>{confirm.description}</p>
              {confirmError && (
                <p role="alert" className="cp-error">
                  {confirmError}
                </p>
              )}
            </div>
            <footer>
              <ControlButton onClick={() => setConfirm(null)}>Cancel</ControlButton>
              <ControlButton
                className="cp-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setConfirmError('');
                  try {
                    await confirm.action();
                    setConfirm(null);
                    setNotice('Access updated.');
                    await refresh();
                  } catch (err) {
                    setConfirmError(err instanceof Error ? err.message : 'Action failed.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm
              </ControlButton>
            </footer>
          </section>
        </ControlModal>
      )}
    </>
  );
}
