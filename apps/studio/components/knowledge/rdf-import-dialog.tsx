'use client';
import { useState } from 'react';
import { ControlButton, ControlInput, ControlModal } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import { controlRequest } from '@/components/control/access';
import { EntityGlyph } from '@/vendor/ontology-playground/host/entity-glyph';
import { RDF_IMPORT_LIMIT } from '@/lib/knowledge/rdf-import';
import type { Ontology } from '@/lib/knowledge/ontology';
import type { prepareImportedOntology } from '@/lib/knowledge/rdf-import';
export function RdfImportDialog({
  previous,
  onClose,
  onApply,
}: {
  previous: Ontology;
  onClose: () => void;
  onApply: (document: ReturnType<typeof prepareImportedOntology>['document']) => void;
}) {
  const [source, setSource] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof prepareImportedOntology> | null>(null);
  function update(value: string) {
    setSource(value);
    setPreview(null);
    setError('');
  }
  return (
    <ControlModal label="Import RDF/XML" onClose={onClose}>
      <div className="cp-modal wa-review">
        <header className="sp-dialog-header">
          <h2>Import RDF/XML</h2>
          <p>Preview entities and relationships before replacing the current draft.</p>
        </header>
        <div className="sp-dialog-body wa-settings">
          <ControlInput
            type="file"
            aria-label="Choose RDF/XML file"
            accept=".rdf,.owl,.xml,application/rdf+xml"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > RDF_IMPORT_LIMIT) {
                setError('Choose a file no larger than 1 MiB.');
                return;
              }
              update(await file.text());
            }}
          />
          <TextArea label="RDF/XML content" value={source} onChange={update} rows={8} maxLength={RDF_IMPORT_LIMIT} />
          {error && (
            <p role="alert" className="cp-error">
              {error}
            </p>
          )}
          {preview && (
            <section>
              <h3>
                {preview.document.entityTypes.length} entities · {preview.document.relationships.length} relationships
              </h3>
              <div className="sp-rdf-entities">
                {preview.document.entityTypes.map((entity) => (
                  <div key={entity.id}>
                    <EntityGlyph symbol={entity.icon} />
                    <strong>{entity.name}</strong>
                    <span>{entity.properties.length} properties</span>
                  </div>
                ))}
              </div>
              {preview.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </section>
          )}
        </div>
        <footer className="sp-dialog-footer">
          <ControlButton onPress={onClose}>Cancel</ControlButton>
          <ControlButton
            disabled={busy || !source.trim()}
            onPress={async () => {
              setBusy(true);
              setError('');
              try {
                setPreview(await controlRequest('/api/knowledge/rdf/preview', { source, previous }));
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not preview RDF/XML.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Preview import
          </ControlButton>
          <ControlButton
            color="primary"
            disabled={!preview || busy}
            onPress={() => {
              if (preview) onApply(preview.document);
            }}
          >
            Replace draft
          </ControlButton>
        </footer>
      </div>
    </ControlModal>
  );
}
