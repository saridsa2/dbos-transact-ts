'use client';
import { useEffect, useState } from 'react';
import { WorkArea, TableViewport, RecordAction, EmptyState } from './work-area';
import { ControlButton, ControlInput, ControlSelect, ControlModal } from './controls';
import { controlRequest } from './access';
import { Table } from '@/components/application/table/table';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { KeyRound, X } from '@/components/fa-icons';

type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; expiresAt: string; revoked: boolean };
const permissions = [
  ['tools:read', 'Read tools'],
  ['tools:write', 'Upload and edit'],
  ['tools:test', 'Run fixtures'],
  ['tools:publish', 'Publish releases'],
  ['tools:enable', 'Enable and archive'],
];
export function WorkspaceApiKeys({ manage, workspaceId }: { manage: boolean; workspaceId: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [days, setDays] = useState('30');
  const [scopes, setScopes] = useState(['tools:read', 'tools:write', 'tools:test']),
    [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState(''),
    [revoke, setRevoke] = useState<ApiKey>();
  async function load() {
    setLoading(true);
    try {
      setKeys((await controlRequest('/api/tools/auth/keys')).keys);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load API keys.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (manage) void load();
    else setLoading(false);
  }, [manage]);
  async function create() {
    setBusy(true);
    setError('');
    try {
      const result = await controlRequest('/api/tools/auth/keys', { name, days: Number(days), scopes });
      setSecret(result.token);
      setOpen(false);
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create API key.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkArea
      title="API keys"
      description="Workspace access for the Procczar CLI. Keys inherit your current workspace role."
      actions={
        manage && (
          <ControlButton iconLeading={KeyRound} color="primary" onPress={() => setOpen(true)}>
            Create API key
          </ControlButton>
        )
      }
      status={
        error && (
          <p role="alert" className="cp-error">
            {error}
          </p>
        )
      }
    >
      {!manage ? (
        <EmptyState title="Administrator access required">Owners and admins manage workspace API keys.</EmptyState>
      ) : loading ? (
        <EmptyState title="Loading API keys…" />
      ) : !keys.length ? (
        <EmptyState title="No workspace API keys">
          Create a key to upload and test tools from your developer machine.
        </EmptyState>
      ) : (
        <TableViewport label="Workspace API keys">
          <Table aria-label="Workspace API keys">
            <Table.Header>
              <Table.Head isRowHeader>Name</Table.Head>
              <Table.Head>Permissions</Table.Head>
              <Table.Head>Expires</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head>Actions</Table.Head>
            </Table.Header>
            <Table.Body>
              {keys.map((key) => (
                <Table.Row key={key.id}>
                  <Table.Cell>
                    <strong>{key.name}</strong>
                    <p>
                      <code>{key.prefix}…</code>
                    </p>
                  </Table.Cell>
                  <Table.Cell>
                    {key.scopes.map((scope) => permissions.find((p) => p[0] === scope)?.[1] ?? scope).join(', ')}
                  </Table.Cell>
                  <Table.Cell>{new Date(key.expiresAt).toLocaleDateString()}</Table.Cell>
                  <Table.Cell>
                    {key.revoked ? 'Revoked' : Date.parse(key.expiresAt) <= Date.now() ? 'Expired' : 'Active'}
                  </Table.Cell>
                  <Table.Cell>
                    <RecordAction
                      label={`Revoke ${key.name}`}
                      icon={X}
                      disabled={key.revoked}
                      onPress={() => setRevoke(key)}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </TableViewport>
      )}
      {open && (
        <ControlModal
          label="Create workspace API key"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <section className="cp-modal">
            <h2>Create API key</h2>
            <p>Access is limited to tools in this workspace. The key is shown once.</p>
            <label>
              Name
              <ControlInput
                aria-label="API key name"
                placeholder="Developer laptop"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </label>
            <label>
              Expiry
              <ControlSelect aria-label="API key expiry" value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </ControlSelect>
            </label>
            <fieldset style={{ display: 'grid', gap: 12, margin: '20px 0' }}>
              <legend>Tool permissions</legend>
              {permissions.map(([id, label]) => (
                <Checkbox
                  key={id}
                  label={label}
                  isSelected={scopes.includes(id)}
                  onChange={(selected) => setScopes((old) => (selected ? [...old, id] : old.filter((s) => s !== id)))}
                />
              ))}
            </fieldset>
            {error && <p role="alert">{error}</p>}
            <footer>
              <ControlButton disabled={busy} onPress={() => setOpen(false)}>
                Cancel
              </ControlButton>
              <ControlButton
                color="primary"
                disabled={busy || !name.trim() || !scopes.length}
                onPress={() => void create()}
              >
                {busy ? 'Creating…' : 'Create key'}
              </ControlButton>
            </footer>
          </section>
        </ControlModal>
      )}
      {secret && (
        <ControlModal label="Save your API key" onClose={() => setSecret('')}>
          <section className="cp-modal">
            <h2>Save your API key</h2>
            <p>Copy it now. You cannot view it again.</p>
            <ControlInput aria-label="New API key" readOnly value={secret} />
            <ControlButton
              onPress={() =>
                void navigator.clipboard.writeText(secret).catch(() => setError('Select and copy the key manually.'))
              }
            >
              Copy key
            </ControlButton>
            <p>
              Set <code>PROCCZAR_API_KEY</code> in your credential manager, then use:
            </p>
            <pre
              style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >{`procczar auth status --server ${window.location.origin} --workspace ${workspaceId}`}</pre>
            <p>
              For interactive macOS login, pipe the key to <code>procczar auth login --api-key-stdin --server …</code>.
            </p>
            <footer>
              <ControlButton color="primary" onPress={() => setSecret('')}>
                Done
              </ControlButton>
            </footer>
          </section>
        </ControlModal>
      )}
      {revoke && (
        <ControlModal
          label="Revoke API key"
          onClose={() => {
            if (!busy) setRevoke(undefined);
          }}
        >
          <section className="cp-modal">
            <h2>Revoke {revoke.name}?</h2>
            <p>CLI requests using this key will stop working immediately.</p>
            <footer>
              <ControlButton disabled={busy} onPress={() => setRevoke(undefined)}>
                Cancel
              </ControlButton>
              <ControlButton
                color="primary"
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await controlRequest(`/api/tools/auth/keys/${revoke.id}/revoke`, {});
                    setRevoke(undefined);
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not revoke key.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Revoke key
              </ControlButton>
            </footer>
            {error && <p role="alert">{error}</p>}
          </section>
        </ControlModal>
      )}
    </WorkArea>
  );
}
