'use client';
import { useState } from 'react';
import { z } from 'zod';
import type { AgentFlow } from '@/lib/flows/types';
import { queueSchema } from '@/lib/native/model';
import { ControlModal, ControlButton, ControlInput } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Tabs } from '@/components/application/tabs/tabs';
import { DeclarationFields } from './declaration-fields';
import { declarationSchema } from '@/lib/authoring/contracts';
import { ParameterFields } from './parameter-fields';
import { type Parameter, parameterSchema } from '@/lib/authoring/model';
import { compileAuthoringGraph } from '@/lib/authoring/compiler';
export function NativeSettings({
  flow,
  onApply,
  onSave,
  onClose,
}: {
  flow: AgentFlow;
  onApply: (patch: Partial<AgentFlow>) => void;
  onSave?: (patch: Partial<AgentFlow>) => Promise<void>;
  onClose: () => void;
}) {
  const [declarations, setDeclarations] = useState(flow.declarations ?? []);
  const [tab, setTab] = useState('variables');
  const [variables, setVariables] = useState<Parameter>({ mode: 'object', fields: flow.variables ?? {} });
  const [queues, setQueues] = useState(JSON.stringify(flow.queues ?? [], null, 2));
  const [cron, setCron] = useState(flow.schedule?.cron ?? '0 * * * * *');
  const [enabled, setEnabled] = useState(flow.schedule?.enabled ?? false);
  const [timezone, setTimezone] = useState(flow.schedule?.timezone ?? 'UTC');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(persist: boolean) {
    setError('');
    setSaving(persist);
    try {
      const resource = z.array(queueSchema).parse(JSON.parse(queues));
      let patch: Partial<AgentFlow>;
      if (flow.authoringVersion === 2) {
        const parsed = z.array(declarationSchema).parse(declarations);
        if (
          new Set(parsed.map((d) => d.id)).size !== parsed.length ||
          new Set(parsed.map((d) => d.name)).size !== parsed.length
        )
          throw new Error('Variable IDs/names must be unique.');
        patch = { declarations: parsed, queues: resource, schedule: { enabled, cron, timezone } };
      } else {
        parameterSchema.parse(variables);
        let fields: Record<string, Parameter>;
        if (variables.mode === 'object') fields = variables.fields;
        else if (
          variables.mode === 'fixed' &&
          variables.value &&
          typeof variables.value === 'object' &&
          !Array.isArray(variables.value)
        )
          fields = Object.fromEntries(
            Object.entries(variables.value).map(([key, value]) => [key, { mode: 'fixed', value }]),
          );
        else throw new Error('Workflow variables must be an object with named fields.');
        const changed = JSON.stringify(fields) !== JSON.stringify(flow.variables ?? {});
        patch = {
          queues: resource,
          schedule: { enabled, cron, timezone },
          ...(changed || flow.authoringVersion ? { authoringVersion: 1, variables: fields } : {}),
        };
        compileAuthoringGraph({ ...flow, ...patch });
      }
      if (persist && onSave) await onSave(patch);
      else onApply(patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save workflow settings.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <ControlModal
      label="Workflow settings"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <section className="cp-modal nc-resources">
        <header className="sp-dialog-header">
          <h2>Workflow settings</h2>
          <p>Declare workflow variables, queues and schedule.</p>
        </header>
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))} className="nc-resource-tabs">
          <Tabs.List aria-label="Workflow settings sections" type="underline">
            <Tabs.Item id="variables">Variables</Tabs.Item>
            <Tabs.Item id="queues">Queues</Tabs.Item>
            <Tabs.Item id="schedule">Schedule</Tabs.Item>
          </Tabs.List>
          <Tabs.Panel id={tab} className="sp-dialog-body">
            {tab === 'variables' && Boolean(flow.captures?.length) && (
              <section>
                <h3>Inherited read-only values</h3>
                {flow.captures?.map((d) => (
                  <p key={d.id}>
                    {d.name} · {String(d.schema.type ?? 'any')} · {d.id}
                  </p>
                ))}
              </section>
            )}
            {tab === 'variables' && flow.authoringVersion === 2 && (
              <DeclarationFields value={declarations} onChange={setDeclarations} nodes={flow.nodes} />
            )}
            {tab === 'variables' && flow.authoringVersion !== 2 && (
              <>
                <p>
                  Variables can contain objects and arrays. Initial expressions may reference $input. Use a Set
                  variables node to update them during execution.
                </p>
                <ParameterFields
                  value={variables}
                  onChange={setVariables}
                  label="Workflow variables"
                  path="variables"
                />
              </>
            )}
            {tab === 'queues' && (
              <TextArea
                label="Queue definitions (advanced JSON)"
                aria-label="Queue resources JSON"
                value={queues}
                onChange={setQueues}
                rows={10}
              />
            )}
            {tab === 'schedule' && (
              <>
                <Checkbox
                  className="nc-checkbox-row"
                  label="Enable scheduled invocation when saved"
                  isSelected={enabled}
                  onChange={setEnabled}
                />
                <label>
                  Cron expression
                  <ControlInput value={cron} onChange={(e) => setCron(e.target.value)} />
                </label>
                <label>
                  Timezone
                  <ControlInput value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                </label>
              </>
            )}
          </Tabs.Panel>
        </Tabs>
        {error && (
          <p role="alert" className="nc-field-errors">
            {error}
          </p>
        )}
        <footer>
          <p className="nc-settings-save-note">
            {onSave
              ? 'Save workflow persists these settings and the current graph. Apply to draft keeps changes only in this editor.'
              : 'Apply updates this scope in the draft. Save the parent workflow to persist it.'}
          </p>
          <div className="nc-settings-actions">
            <ControlButton disabled={saving} onClick={onClose}>
              Cancel
            </ControlButton>
            <ControlButton
              disabled={saving}
              className={!onSave ? 'cp-primary' : undefined}
              onClick={() => void submit(false)}
            >
              Apply to draft
            </ControlButton>
            {onSave && (
              <ControlButton disabled={saving} className="cp-primary" onClick={() => void submit(true)}>
                {saving ? 'Saving…' : 'Save workflow'}
              </ControlButton>
            )}
          </div>
        </footer>
      </section>
    </ControlModal>
  );
}
