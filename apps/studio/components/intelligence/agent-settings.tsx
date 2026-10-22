'use client';
import { useEffect, useRef, useState } from 'react';
import { ControlButton, ControlModal, ControlSelect, ControlInput } from '@/components/control/controls';
import { useUnsavedChanges } from '@/components/control/unsaved-changes';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { controlRequest } from '@/components/control/access';
import { agentRequest } from '@/lib/agent/client';
import { agentConfigurationSchema, type AgentConfiguration } from '@/lib/agent/contracts';
import { harnessOptionsSchema } from '@/server/workspace-harness/options';
import type { Connection } from '@/lib/control/contracts';
type Configuration = AgentConfiguration & { editVersion: number };
export function AgentSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<AgentConfiguration>();
  const [saved, setSaved] = useState<AgentConfiguration>();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0),
    [conflict, setConflict] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setConflict(false);
    void Promise.all([agentRequest('state'), controlRequest('/api/control/connections')])
      .then(([state, items]: [{ configuration: Configuration | null }, Connection[]]) => {
        if (!alive) return;
        const current = state.configuration;
        setConnections(items.filter((c) => c.provider === 'minimax' && c.status === 'configured' && c.hasSecret));
        const configuration = agentConfigurationSchema.parse(
          current
            ? {
                expectedVersion: current.editVersion,
                enabled: current.enabled,
                mode: current.mode,
                allowModel: current.allowModel,
                connectionId: current.connectionId,
                connectionRevision: current.connectionRevision,
                runtime: current.runtime,
                triggers: current.triggers,
                limits: current.limits,
              }
            : { expectedVersion: 0, enabled: false, mode: 'assist', allowModel: false, triggers: [] },
        );
        setDraft(configuration);
        setSaved(configuration);
      })
      .catch((e) => {
        if (alive) {
          setDraft(undefined);
          setError(e instanceof Error ? e.message : 'Could not load agent settings.');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  const selected = connections.find((c) => c.id === draft?.connectionId && c.revision === draft?.connectionRevision);
  const confirmClose = useUnsavedChanges(!!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved));
  const close = () => {
    if (!savingRef.current) confirmClose(onClose);
  };
  return (
    <ControlModal label="Workspace policy" onClose={close}>
      <form
        className="cp-modal"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft || savingRef.current) return;
          if (draft.allowModel && !selected) {
            setError('Select a configured MiniMax connection with a stored key.');
            return;
          }
          savingRef.current = true;
          setSaving(true);
          setError('');
          try {
            await agentRequest('configuration', agentConfigurationSchema.parse(draft), 'PUT');
            onSaved();
            onClose();
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Could not save agent settings.';
            setError(message);
            if (message.includes('configuration changed')) setConflict(true);
          } finally {
            savingRef.current = false;
            setSaving(false);
          }
        }}
      >
        <header className="sp-dialog-header">
          <h2>Workspace policy</h2>
          <p>
            Control provider access and execution mode for this workspace. Agent publication and activation remain
            separate decisions.
          </p>
        </header>
        <div className="sp-dialog-body">
          {loading && <p role="status">Loading workspace settings…</p>}
          {!loading && draft && (
            <fieldset disabled={saving} className="nc-edit-fields">
              <section className="wi-policy-readiness">
                <h3>Current saved policy</h3>
                <p>
                  {saved?.enabled && saved?.allowModel && saved?.mode === 'assist'
                    ? 'Assistance enabled'
                    : 'Assistance unavailable'}{' '}
                  · {saved?.mode === 'observe' ? 'Observe mode' : 'Assist mode'}
                </p>
                <p className="wi-secondary">
                  {JSON.stringify(draft) === JSON.stringify(saved)
                    ? 'No unsaved changes.'
                    : 'You have unsaved policy changes.'}
                </p>
              </section>
              <h3>Execution mode</h3>
              <Checkbox
                label="Enable workspace agent"
                isSelected={draft.enabled}
                onChange={(enabled) => setDraft({ ...draft, enabled })}
              />
              <label>
                Working mode
                <ControlSelect
                  aria-label="Working mode"
                  value={draft.mode}
                  onChange={(e) => setDraft({ ...draft, mode: e.target.value as AgentConfiguration['mode'] })}
                >
                  <option value="assist">Assist · reason and propose changes</option>
                  <option value="observe">Observe · no model requests</option>
                </ControlSelect>
              </label>
              <h3>Provider access</h3>
              <Checkbox
                label="Allow MiniMax assistance"
                hint="Workspace content attached to requests may be sent to the selected MiniMax connection."
                isSelected={draft.allowModel}
                onChange={(allowModel) => setDraft({ ...draft, allowModel })}
              />
              <label>
                MiniMax connection
                <ControlSelect
                  aria-label="MiniMax connection"
                  value={selected?.id ?? ''}
                  onChange={(e) => {
                    const connection = connections.find((c) => c.id === e.target.value);
                    setDraft({ ...draft, connectionId: connection?.id, connectionRevision: connection?.revision });
                  }}
                >
                  <option value="">Choose a configured connection</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · revision {c.revision}
                    </option>
                  ))}
                </ControlSelect>
              </label>
              {!connections.length && (
                <p>Add a MiniMax connection with a key in Connections, then reopen these settings.</p>
              )}
              {draft.connectionId && !selected && (
                <p role="alert">
                  The selected connection changed or is unavailable. Select its current revision before enabling
                  assistance.
                </p>
              )}
              <p>
                {!draft.enabled
                  ? 'The workspace agent is disabled.'
                  : draft.mode === 'observe'
                    ? 'Observe mode does not call MiniMax. Choose Assist to reason over instructions.'
                    : !draft.allowModel
                      ? 'Allow MiniMax assistance to enable model requests.'
                      : selected
                        ? JSON.stringify(draft) === JSON.stringify(saved)
                          ? 'The saved policy permits MiniMax assistance.'
                          : 'Saving these changes will permit MiniMax assistance.'
                        : 'Select a MiniMax connection to finish setup.'}
              </p>
              <label>
                Initial token allowance per activity
                <ControlInput
                  type="number"
                  min={1024}
                  max={1000000}
                  value={draft.runtime?.totalTokens ?? 200000}
                  onChange={(e) => {
                    const parsed = harnessOptionsSchema.safeParse({
                      ...draft.runtime,
                      totalTokens: Number(e.target.value),
                    });
                    if (parsed.success) setDraft({ ...draft, runtime: parsed.data });
                  }}
                />
              </label>
              <label>
                Maximum tokens after an approved extension
                <ControlInput
                  type="number"
                  min={draft.runtime?.totalTokens ?? 200000}
                  max={1000000}
                  value={draft.runtime?.maxTotalTokens ?? draft.runtime?.totalTokens ?? 200000}
                  onChange={(e) => {
                    const parsed = harnessOptionsSchema.safeParse({
                      ...draft.runtime,
                      maxTotalTokens: Number(e.target.value),
                    });
                    if (parsed.success) setDraft({ ...draft, runtime: parsed.data });
                  }}
                />
              </label>
              <p>
                The maximum is pinned when an activity starts. Extensions require owner/admin approval; saving does not
                increase any running activity budget. Existing triggers are preserved. Configure automatic knowledge
                review in the workspace agent’s Automation section. Saving policy does not start work.
              </p>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="cp-error">
              {error}
            </p>
          )}
          {((!draft && !loading) || conflict) && (
            <ControlButton onPress={() => setAttempt((n) => n + 1)}>Reload settings</ControlButton>
          )}
        </div>
        <footer className="sp-dialog-footer">
          <ControlButton disabled={saving} onPress={close}>
            Cancel
          </ControlButton>
          <ControlButton
            type="submit"
            color="primary"
            disabled={
              loading ||
              saving ||
              !draft ||
              conflict ||
              JSON.stringify(draft) === JSON.stringify(saved) ||
              (!!draft.allowModel && !selected)
            }
          >
            {saving ? 'Saving…' : 'Save policy'}
          </ControlButton>
        </footer>
      </form>
    </ControlModal>
  );
}
