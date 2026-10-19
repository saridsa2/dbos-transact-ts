'use client';
import { StackProcShell } from './shell';
import { Button } from '@/components/base/buttons/button';
import { ControlButton, ControlInput } from '@/components/control/controls';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Session } from '@/lib/control/contracts';
export async function controlRequest(path: string, value?: unknown, method = value === undefined ? 'GET' : 'POST') {
  const response = await fetch(path, {
    method,
    headers: value === undefined ? undefined : { 'content-type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
const AccessContext = createContext<{ session: Session; refresh: () => Promise<void> } | null>(null);
export function useControl() {
  const value = useContext(AccessContext);
  if (!value) throw new Error('Control plane session is unavailable.');
  return value;
}
export function Onboarding({
  legacyAvailable = false,
  onComplete,
  onCancel,
}: {
  legacyAvailable?: boolean;
  onComplete: () => void;
  onCancel?: () => void;
}) {
  const [customer, setCustomer] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [adopt, setAdopt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="cp-onboarding"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          await controlRequest('/api/control/onboarding', {
            customerName: customer,
            workspaceName: workspace,
            adoptLocalWorkspace: adopt,
          });
          onComplete();
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Onboarding failed.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <header className="sp-dialog-header">
        <span className="cp-eyebrow">CUSTOMER ONBOARDING</span>
        <h1>Create your workspace</h1>
        <p>A workspace brings your team, connections and workflow history together.</p>
      </header>
      <div className="sp-dialog-body">
        <label>
          Customer or organization
          <ControlInput
            required
            maxLength={150}
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
            placeholder="Organization name"
          />
        </label>
        <label>
          Workspace name
          <ControlInput
            required
            maxLength={150}
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="Production or development"
          />
        </label>
        {legacyAvailable && (
          <Checkbox
            isSelected={adopt}
            onChange={setAdopt}
            label="Include the existing local workflows and history in this workspace"
          />
        )}
        {error && (
          <p className="cp-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        {onCancel && (
          <ControlButton type="button" onClick={onCancel}>
            Cancel
          </ControlButton>
        )}
        <ControlButton type="submit" className="cp-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create workspace'}
        </ControlButton>
      </footer>
    </form>
  );
}
export function ControlAccess({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(false);
  const refresh = async () => {
    try {
      setSession(await controlRequest('/api/control/session'));
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Service unavailable.');
    }
  };
  useEffect(() => {
    setInvite(new URLSearchParams(window.location.search).has('invite'));
    void refresh();
  }, []);
  if (!session)
    return (
      <main className="cp-gate">
        <section className="cp-onboarding">
          <h1>Stack Proc workspace</h1>
          <p role={error ? 'alert' : 'status'}>{error || 'Loading your workspace…'}</p>
          {error && <ControlButton onClick={() => void refresh()}>Retry</ControlButton>}
        </section>
      </main>
    );
  if (!session.user)
    return (
      <main className="cp-gate">
        <form
          className="cp-onboarding"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              await controlRequest('/api/control/session/development', { email, displayName: name });
              await refresh();
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not continue.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <header className="sp-dialog-header">
            <span className="cp-eyebrow">STACK PROC</span>
            <h1>Your customer workspace</h1>
            <p>Manage your team, provider connections and run history.</p>
          </header>
          <div className="sp-dialog-body">
            {session.mode === 'development' ? (
              <>
                <div className="cp-notice">
                  <strong>Development identity</strong>
                  <p>
                    This local identity adapter is for development. Enterprise sign-in and token federation use your
                    configured authentication adapter.
                  </p>
                </div>
                <label>
                  Your name
                  <ControlInput
                    required
                    maxLength={150}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Email
                  <ControlInput
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                  />
                </label>
              </>
            ) : (
              <>
                <p>Sign in through {session.adapter}.</p>
                {!session.loginUrl && <p>Your organization’s identity gateway must authenticate this session.</p>}
              </>
            )}
            {error && (
              <p role="alert" className="cp-error">
                {error}
              </p>
            )}
          </div>
          {session.mode === 'development' ? (
            <footer>
              <ControlButton type="submit" className="cp-primary" disabled={busy}>
                {busy ? 'Continuing…' : 'Continue locally'}
              </ControlButton>
            </footer>
          ) : session.loginUrl ? (
            <footer>
              <Button href={session.loginUrl} color="primary" className="cp-primary">
                Sign in
              </Button>
            </footer>
          ) : null}
        </form>
      </main>
    );
  if (!session.workspace && !invite)
    return (
      <main className="cp-gate">
        <Onboarding
          legacyAvailable={session.legacyImportAvailable}
          onComplete={() => {
            window.location.href = '/control';
          }}
        />
      </main>
    );
  return (
    <AccessContext.Provider value={{ session, refresh }}>
      <StackProcShell session={session} refresh={refresh}>
        {children}
      </StackProcShell>
    </AccessContext.Provider>
  );
}
