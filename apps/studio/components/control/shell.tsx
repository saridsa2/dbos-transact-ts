'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/base/buttons/button';
import { Avatar } from '@/components/base/avatar/avatar';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import {
  Activity,
  Bell,
  Building2,
  Check,
  ChevronDown,
  KeyRound,
  Link2,
  MenuIcon,
  Plus,
  ShieldCheck,
  Users,
  WorkflowIcon,
  X,
  User01,
} from '@/components/fa-icons';
import { useControlNavigation, type ControlTab } from '@/hooks/use-control-navigation';
import { useWorkspaceEvents, WorkspaceStreamContext } from '@/hooks/use-workspace-events';
import { notificationDestination } from '@/lib/control/notifications';
import { canManage, type Session } from '@/lib/control/contracts';
import { Onboarding, controlRequest } from './access';
import { ControlModal } from './controls';
import { StackProcLogo } from './stackproc-logo';

const sections = [
  { id: 'overview', label: 'Overview', icon: Building2 },
  { id: 'connections', label: 'Connections', icon: Link2 },
  { id: 'team', label: 'People', icon: Users },
  { id: 'runs', label: 'Run history', icon: Activity },
  { id: 'audit', label: 'Audit trail', icon: ShieldCheck },
  { id: 'identity', label: 'Identity', icon: KeyRound },
] as const;
export function StackProcShell({
  session,
  refresh,
  children,
}: {
  session: Session;
  refresh: () => Promise<void>;
  children: ReactNode;
}) {
  const { pathname, tab, navigate } = useControlNavigation();
  const workspace = session.workspace,
    user = session.user!;
  const [menuOpen, setMenuOpen] = useState(false),
    [onboarding, setOnboarding] = useState(false),
    [error, setError] = useState(''),
    [profileOpen, setProfileOpen] = useState(false);
  const stream = useWorkspaceEvents(workspace?.id, () => void refresh(), workspace?.role);
  const unread = stream.notifications.filter((event) => !event.readAt).length;
  const control = pathname === '/control';
  const pageName = control
    ? sections.find((item) => item.id === tab)?.label
    : pathname === '/flows'
      ? 'Workflow builder'
      : 'Workflows';
  const initials = user.displayName
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  async function switchWorkspace(id: string) {
    try {
      await controlRequest('/api/control/workspace', { id });
      window.location.href = '/control';
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not switch workspace.');
    }
  }
  async function signOut() {
    try {
      await controlRequest('/api/control/session', undefined, 'DELETE');
      window.location.href = '/control';
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not sign out.');
    }
  }
  if (pathname === '/flows')
    return (
      <WorkspaceStreamContext.Provider value={stream}>
        <div className="stackproc-builder-fullscreen" key={workspace?.id}>
          {children}
        </div>
      </WorkspaceStreamContext.Provider>
    );
  return (
    <WorkspaceStreamContext.Provider value={stream}>
      <div className={`stackproc-shell ${menuOpen ? 'is-navigation-open' : ''}`}>
        <header className="stackproc-header">
          <Link href="/control" className="stackproc-brand" aria-label="Stack Proc home">
            <StackProcLogo />
            <span>Stack Proc</span>
          </Link>
          <div className="stackproc-header-content">
            <Button
              color="tertiary"
              className="stackproc-mobile-menu"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              iconLeading={menuOpen ? X : MenuIcon}
              onPress={() => setMenuOpen(!menuOpen)}
            />
            <div className="stackproc-breadcrumb">
              <span>{workspace?.name ?? 'Workspace'}</span>
              <ChevronDown size={12} />
              <strong>{pageName}</strong>
            </div>
            <div className="stackproc-header-actions">
              <span className={`stackproc-live ${stream.status}`} role="status">
                <i />
                {stream.status === 'live'
                  ? 'Live'
                  : stream.status === 'connecting'
                    ? 'Connecting'
                    : stream.status === 'reconnecting'
                      ? 'Reconnecting'
                      : 'Offline'}
              </span>
              <Dropdown.Root>
                <Button
                  color="tertiary"
                  className="stackproc-notification-button"
                  aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                  iconLeading={Bell}
                  iconTrailing={unread ? <span className="stackproc-unread-count">{unread}</span> : undefined}
                />
                <Dropdown.Popover className="stackproc-notifications" placement="bottom end">
                  <Dropdown.Menu
                    aria-label="Workspace notifications"
                    onAction={(key) => {
                      void (async () => {
                        try {
                          if (key === 'mark-read') {
                            await stream.markRead(
                              stream.notifications.filter((event) => !event.readAt).map((event) => event.id),
                            );
                            return;
                          }
                          const event = stream.notifications.find((item) => `event:${item.id}` === key);
                          if (!event) return;
                          await stream.markRead([event.id]);
                          window.location.href = notificationDestination(event);
                        } catch (error) {
                          setError(error instanceof Error ? error.message : 'Notification action failed.');
                        }
                      })();
                    }}
                  >
                    <Dropdown.Section>
                      <Dropdown.SectionHeader className="stackproc-menu-heading">
                        Notifications <span>Active workspace</span>
                      </Dropdown.SectionHeader>
                      {stream.notifications.map((event) => (
                        <Dropdown.Item key={event.id} id={`event:${event.id}`} textValue={event.title}>
                          <div className={`stackproc-notification-item ${!event.readAt ? 'unread' : ''}`}>
                            <strong>{event.title}</strong>
                            {event.resourceName && (
                              <span className="stackproc-notification-resource">{event.resourceName}</span>
                            )}
                            <small>{new Date(event.createdAt).toLocaleString()}</small>
                          </div>
                        </Dropdown.Item>
                      ))}
                      {!stream.notifications.length && (
                        <Dropdown.Item id="empty" isDisabled>
                          No notifications yet
                        </Dropdown.Item>
                      )}
                    </Dropdown.Section>
                    <Dropdown.Separator />
                    <Dropdown.Item id="mark-read" icon={Check} isDisabled={!unread}>
                      Mark all as read
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown.Root>
            </div>
          </div>
        </header>
        <aside className="stackproc-sidebar">
          <Dropdown.Root>
            <Button
              color="tertiary"
              className="stackproc-workspace-trigger"
              aria-label="Switch workspace"
              iconTrailing={ChevronDown}
            >
              <span className="stackproc-workspace-mark">
                <Building2 size={18} />
              </span>
              <span className="stackproc-workspace-copy">
                <strong>{workspace?.customerName ?? 'Customer workspace'}</strong>
                <small>{workspace?.name ?? 'Select a workspace'}</small>
              </span>
            </Button>
            <Dropdown.Popover className="stackproc-workspace-menu" placement="bottom start">
              <Dropdown.Menu
                aria-label="Workspaces"
                selectionMode="single"
                selectedKeys={workspace ? [workspace.id] : []}
                onAction={(key) => (key === 'new-workspace' ? setOnboarding(true) : void switchWorkspace(String(key)))}
              >
                <Dropdown.Section>
                  <Dropdown.SectionHeader className="stackproc-menu-heading">Switch workspace</Dropdown.SectionHeader>
                  {session.workspaces.map((item) => (
                    <Dropdown.Item
                      id={item.id}
                      key={item.id}
                      label={`${item.customerName} / ${item.name}`}
                      textValue={`${item.customerName} / ${item.name}`}
                    />
                  ))}
                </Dropdown.Section>
                <Dropdown.Separator />
                <Dropdown.Item id="new-workspace" icon={Plus}>
                  Create customer workspace
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.Root>
          <nav className="stackproc-navigation" aria-label="Main navigation">
            <Button
              href="/"
              color="tertiary"
              iconLeading={WorkflowIcon}
              className={!control ? 'selected' : ''}
              aria-current={!control ? 'page' : undefined}
            >
              Workflows
            </Button>
            <p>Workspace</p>
            {sections
              .filter((item) => item.id !== 'audit' || (workspace && canManage(workspace.role)))
              .map((item) => (
                <Button
                  key={item.id}
                  color="tertiary"
                  iconLeading={item.icon}
                  className={control && tab === item.id ? 'selected' : ''}
                  aria-current={control && tab === item.id ? 'page' : undefined}
                  onPress={() => {
                    navigate(item.id as ControlTab);
                    setMenuOpen(false);
                  }}
                >
                  {item.label}
                </Button>
              ))}
          </nav>
          <div className="stackproc-sidebar-footer">
            <Dropdown.Root>
              <Button
                color="tertiary"
                className="stackproc-profile-trigger"
                aria-label="Profile and account"
                iconTrailing={ChevronDown}
              >
                <Avatar size="sm" initials={initials} />
                <span>
                  <strong>{user.displayName}</strong>
                  <small>{user.email}</small>
                </span>
              </Button>
              <Dropdown.Popover className="stackproc-profile-menu" placement="top start">
                <Dropdown.Menu
                  aria-label="Profile and account"
                  onAction={(key) => {
                    if (key === 'sign-out') void signOut();
                    else if (key === 'profile') setProfileOpen(true);
                    else if (key === 'identity') navigate('identity');
                  }}
                >
                  <Dropdown.Section>
                    <Dropdown.SectionHeader className="stackproc-menu-heading">
                      <div className="stackproc-account-summary">
                        <Avatar size="md" initials={initials} />
                        <div>
                          <strong>{user.displayName}</strong>
                          <span>{user.email}</span>
                        </div>
                      </div>
                      <div className="stackproc-account-workspace">
                        <strong>{workspace?.customerName}</strong>
                        <span>
                          {workspace?.name} · {workspace?.role}
                        </span>
                      </div>
                    </Dropdown.SectionHeader>
                    <Dropdown.Item id="profile" icon={User01}>
                      View profile
                    </Dropdown.Item>
                    <Dropdown.Item id="identity" icon={ShieldCheck}>
                      Identity and access
                    </Dropdown.Item>
                  </Dropdown.Section>
                  <Dropdown.Separator />
                  <Dropdown.Item id="sign-out">Sign out</Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.Root>
          </div>
        </aside>
        <div
          className={`stackproc-content ${pathname === '/flows' ? 'is-builder' : ''}`}
          key={workspace?.id ?? 'invitation'}
        >
          {error && (
            <div role="alert" className="cp-error">
              {error}
            </div>
          )}
          {children}
        </div>
      </div>
      {profileOpen && (
        <ControlModal label="Your profile" onClose={() => setProfileOpen(false)}>
          <section className="cp-modal stackproc-profile-details">
            <header className="sp-dialog-header">
              <Avatar size="lg" initials={initials} />
              <div>
                <h2>Your profile</h2>
                <p>{user.displayName}</p>
              </div>
            </header>
            <div className="sp-dialog-body">
              <dl>
                <dt>Email</dt>
                <dd>{user.email}</dd>
                <dt>Organization</dt>
                <dd>{workspace?.customerName}</dd>
                <dt>Workspace</dt>
                <dd>{workspace?.name}</dd>
                <dt>Role</dt>
                <dd>{workspace?.role}</dd>
                <dt>Sign-in</dt>
                <dd>{session.mode === 'development' ? 'Development identity' : session.adapter}</dd>
                <dt>Email verified</dt>
                <dd>{user.emailVerified ? 'Verified' : 'Not verified'}</dd>
              </dl>
            </div>
            <footer>
              <Button color="secondary" onPress={() => setProfileOpen(false)}>
                Close
              </Button>
            </footer>
          </section>
        </ControlModal>
      )}
      {onboarding && (
        <ControlModal label="Create customer workspace" onClose={() => setOnboarding(false)}>
          <Onboarding
            legacyAvailable={session.legacyImportAvailable}
            onCancel={() => setOnboarding(false)}
            onComplete={() => {
              window.location.href = '/control';
            }}
          />
        </ControlModal>
      )}
    </WorkspaceStreamContext.Provider>
  );
}
