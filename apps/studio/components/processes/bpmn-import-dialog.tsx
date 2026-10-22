'use client';
import { useRef, useState } from 'react';
import { ControlButton, ControlInput, ControlModal, ControlSelect } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import { controlRequest } from '@/components/control/access';
import { BPMN_IMPORT_LIMIT, type BpmnPreview } from '@/lib/processes/bpmn-import';
import type { ProcessDocument } from '@/lib/processes/model';
export function BpmnImportDialog({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (document: ProcessDocument, name: string) => void;
}) {
  const generation = useRef(0);
  const [source, setSource] = useState(''),
    [selected, setSelected] = useState(''),
    [preview, setPreview] = useState<BpmnPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function update(value: string) {
    generation.current++;
    setBusy(false);
    setSource(value);
    setSelected('');
    setPreview(null);
    setError('');
  }
  async function inspect(processId?: string) {
    const ticket = ++generation.current;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const result = await controlRequest('/api/knowledge/bpmn/preview', {
        source,
        ...(processId ? { processId } : {}),
      });
      if (ticket === generation.current) setPreview(result);
    } catch (e) {
      if (ticket === generation.current) setError(e instanceof Error ? e.message : 'Could not preview BPMN.');
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  return (
    <ControlModal label="Import BPMN" onClose={onClose}>
      <section className="cp-modal wa-review">
        <header className="sp-dialog-header">
          <h2>Import BPMN</h2>
          <p>
            Preview one process before replacing the draft. Imported tasks need executable bindings; unsupported
            semantics block import.
          </p>
        </header>
        <div className="sp-dialog-body wa-settings">
          <ControlInput
            type="file"
            aria-label="Choose BPMN file"
            accept=".bpmn,.xml,application/xml"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > BPMN_IMPORT_LIMIT) {
                update('');
                setError('Choose a file no larger than 1 MiB.');
                return;
              }
              update(await file.text());
            }}
          />
          <TextArea label="BPMN XML" value={source} onChange={update} rows={8} maxLength={BPMN_IMPORT_LIMIT} />
          {error && (
            <p role="alert" className="cp-error">
              {error}
            </p>
          )}
          {preview && (
            <section aria-label="BPMN import preview">
              <label>
                Process
                <ControlSelect
                  aria-label="BPMN process"
                  value={preview.selectedProcessId ?? selected}
                  disabled={busy}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    void inspect(e.target.value);
                  }}
                >
                  <option value="">Choose a process</option>
                  {preview.processes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </ControlSelect>
              </label>
              {preview.selectedProcessId && (
                <>
                  <h3>
                    {preview.summary.activities} elements · {preview.summary.lanes} lanes · {preview.summary.flows}{' '}
                    sequence flows
                  </h3>
                  <p>
                    {preview.document
                      ? 'Ready to import as a draft. Original XML and ID mapping will be retained. Configure task bindings and the final result before review.'
                      : 'Import blocked. Resolve the unsupported elements below in the source model; no draft has been changed.'}
                  </p>
                </>
              )}
              <ul>
                {preview.diagnostics.map((d, i) => (
                  <li key={i}>
                    <strong>
                      {d.severity === 'error' ? 'Blocked' : 'Review'} · {d.elementId}
                    </strong>
                    : {d.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <footer className="sp-dialog-footer">
          <ControlButton onPress={onClose}>Cancel</ControlButton>
          <ControlButton disabled={busy || !source.trim()} onPress={() => void inspect(selected || undefined)}>
            {busy ? 'Reading BPMN…' : 'Preview import'}
          </ControlButton>
          <ControlButton
            color="primary"
            disabled={busy || !preview?.document}
            onPress={() => {
              if (preview?.document) onApply(preview.document, preview.name ?? 'Imported process');
            }}
          >
            Replace draft
          </ControlButton>
        </footer>
      </section>
    </ControlModal>
  );
}
