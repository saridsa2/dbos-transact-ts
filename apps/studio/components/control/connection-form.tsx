'use client';
import { ControlModal, ControlButton, ControlInput, ControlSelect } from '@/components/control/controls';
import { useState } from 'react';
import { providers, type Connection, type Provider } from '@/lib/control/contracts';
import { controlRequest } from './access';
const fields: Record<Provider, { key: string; label: string; required?: boolean; type?: string; default?: string }[]> =
  {
    minimax: [{ key: 'model', label: 'Model', required: true, default: 'MiniMax-M2.7' }],
    openai: [{ key: 'project', label: 'Project ID (optional)' }],
    anthropic: [],
    'microsoft-foundry': [
      { key: 'endpoint', label: 'Foundry endpoint', required: true, type: 'url' },
      { key: 'project', label: 'Project name (optional)' },
      { key: 'deployment', label: 'Deployment name (optional)' },
      { key: 'apiVersion', label: 'API version (optional)' },
    ],
    azure: [
      { key: 'tenantId', label: 'Directory (tenant) ID', required: true },
      { key: 'clientId', label: 'Application (client) ID', required: true },
      { key: 'subscriptionId', label: 'Subscription ID (optional)' },
    ],
    'azure-openai': [
      { key: 'endpoint', label: 'Azure OpenAI endpoint', required: true, type: 'url' },
      { key: 'deployment', label: 'Deployment name', required: true },
      { key: 'apiVersion', label: 'API version (optional)' },
    ],
    http: [{ key: 'endpoint', label: 'Service endpoint', required: true, type: 'url' }],
    mcp: [{ key: 'endpoint', label: 'MCP endpoint', required: true, type: 'url' }],
    postgres: [
      { key: 'host', label: 'Host', required: true },
      { key: 'port', label: 'Port', required: true, type: 'number', default: '5432' },
      { key: 'database', label: 'Database', required: true },
      { key: 'username', label: 'Username', required: true },
    ],
    'aws-sts': [
      { key: 'roleArn', label: 'Role ARN', required: true },
      { key: 'region', label: 'Region', required: true, default: 'us-east-1' },
      { key: 'durationSeconds', label: 'Session duration (seconds)', required: true, type: 'number', default: '3600' },
    ],
  };
export function ConnectionForm({
  connection,
  onClose,
  onSaved,
}: {
  connection?: Connection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState<Provider>(connection?.provider ?? 'openai');
  const [name, setName] = useState(connection?.name ?? '');
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(connection?.config ?? {}).map(([key, value]) => [key, String(value)])),
  );
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <ControlModal label="Workspace connection" onClose={onClose}>
      <form
        className="cp-modal"
        aria-label={connection ? 'Edit connection' : 'Add connection'}
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          setBusy(true);
          try {
            const settings = Object.fromEntries(
              fields[provider]
                .map((field) => [field.key, config[field.key] ?? field.default ?? ''])
                .filter(([, value]) => String(value).trim())
                .map(([key, value]) => [
                  key,
                  fields[provider].find((field) => field.key === key)?.type === 'number'
                    ? Number(value)
                    : String(value).trim(),
                ]),
            );
            await controlRequest(
              connection ? `/api/control/connections/${connection.id}` : '/api/control/connections',
              connection
                ? { name, config: settings, revision: connection.revision }
                : { name, provider, config: settings, ...(secret ? { secret } : {}) },
              connection ? 'PATCH' : 'POST',
            );
            setSecret('');
            onSaved();
            onClose();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not save connection.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <header className="sp-dialog-header">
          <span className="cp-eyebrow">WORKSPACE CONNECTION</span>
          <h2>{connection ? 'Edit connection' : 'Add a connection'}</h2>
          <p>Choose a service and save its connection settings. Credentials stay server-side.</p>
        </header>
        <div className="sp-dialog-body">
          <label>
            Service
            <ControlSelect
              value={provider}
              disabled={Boolean(connection)}
              onChange={(event) => {
                setProvider(event.target.value as Provider);
                setConfig({});
                setSecret('');
              }}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </ControlSelect>
          </label>
          <label>
            Connection name
            <ControlInput
              required
              maxLength={150}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="A name your team will recognize"
            />
          </label>
          {fields[provider].map((field) => (
            <label key={field.key}>
              {field.label}
              <ControlInput
                required={field.required}
                type={field.type ?? 'text'}
                value={config[field.key] ?? field.default ?? ''}
                onChange={(event) => setConfig({ ...config, [field.key]: event.target.value })}
              />
            </label>
          ))}
          {!connection && (
            <label>
              {provider === 'aws-sts'
                ? 'External ID (optional)'
                : provider === 'azure'
                  ? 'Client secret'
                  : provider === 'postgres'
                    ? 'Database password'
                    : provider === 'http' || provider === 'mcp'
                      ? 'Bearer token'
                      : 'API key'}
              <ControlInput
                type="password"
                autoComplete="new-password"
                required={provider !== 'aws-sts'}
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </label>
          )}
          {provider === 'aws-sts' && (
            <div className="cp-notice">
              Workers request temporary AWS credentials through the credential resolver. No permanent AWS access key is
              required here.
            </div>
          )}
          <small>Saving checks the settings format. Live provider access has not been verified.</small>
          {error && (
            <p className="cp-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <ControlButton type="button" onClick={onClose}>
            Cancel
          </ControlButton>
          <ControlButton type="submit" className="cp-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save connection'}
          </ControlButton>
        </footer>
      </form>
    </ControlModal>
  );
}
export function RotateCredential({
  connection,
  onClose,
  onSaved,
}: {
  connection: Connection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <ControlModal label="Workspace connection" onClose={onClose}>
      <form
        className="cp-modal"
        aria-label="Rotate credential"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await controlRequest(`/api/control/connections/${connection.id}/rotate`, {
              revision: connection.revision,
              secret,
            });
            setSecret('');
            onSaved();
            onClose();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Rotation failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <header className="sp-dialog-header">
          <span className="cp-eyebrow">CREDENTIAL ROTATION</span>
          <h2>{connection.name}</h2>
          <p>Replace the stored credential. The previous value cannot be retrieved.</p>
        </header>
        <div className="sp-dialog-body">
          <label>
            {connection.provider === 'aws-sts' ? 'New external ID' : 'New credential'}
            <ControlInput
              type="password"
              required
              autoComplete="new-password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="cp-error">
              {error}
            </p>
          )}
        </div>
        <footer>
          <ControlButton type="button" onClick={onClose}>
            Cancel
          </ControlButton>
          <ControlButton type="submit" className="cp-primary" disabled={busy}>
            {busy ? 'Rotating…' : 'Rotate credential'}
          </ControlButton>
        </footer>
      </form>
    </ControlModal>
  );
}
