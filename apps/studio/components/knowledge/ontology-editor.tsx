'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RecordAction } from '@/components/control/work-area';
import { RotateLeft } from '@/components/fa-icons';
import { RedoIcon } from '@/components/fa-icons';
import { ControlButton } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import type { Ontology } from '@/lib/knowledge/ontology';
import { fromPlayground, toPlayground } from '@/lib/knowledge/playground';
import { RdfImportDialog } from './rdf-import-dialog';
import { replaceDesignerOntology } from '@/vendor/ontology-playground/src/store/designerStore';
import { EntityConfigDialog } from './entity-config-dialog';
import { EntityGlyph } from '@/vendor/ontology-playground/host/entity-glyph';
import { SettingsIcon, Plus, Trash01 } from '@/components/fa-icons';
import { validateOntology } from '@/lib/knowledge/ontology';
import { RelationshipForm } from '@/vendor/ontology-playground/src/components/designer/RelationshipForm';
import { RdfPreview } from '@/vendor/ontology-playground/src/components/designer/DesignerPreview';
import {
  createDesignerStore,
  configureDesignerEntity,
  DesignerStoreContext,
  useDesignerStore,
  ENTITY_ICONS,
} from '@/vendor/ontology-playground/src/store/designerStore';
import { OntologyGraph } from '@/vendor/ontology-playground/src/components/OntologyGraph';
import { InspectorPanel } from '@/vendor/ontology-playground/src/components/InspectorPanel';
import { SearchFilter } from '@/vendor/ontology-playground/src/components/SearchFilter';
import { OntologyStatsPanel } from '@/vendor/ontology-playground/src/components/OntologyStatsPanel';
import { PathFinderPanel } from '@/vendor/ontology-playground/src/components/PathFinderPanel';
import { createAppStore, ExplorerStoreContext } from '@/vendor/ontology-playground/src/store/appStore';
import { entityColors } from '@/lib/knowledge/material-colors';
import type { EntityType } from '@/vendor/ontology-playground/src/data/ontology';
import { playgroundDocumentSchema } from '@/lib/knowledge/playground-document';

export function OntologyEditor(props: {
  value: Ontology;
  onChange: (value: Ontology) => void;
  readOnly?: boolean;
  name?: string;
  onValidityChange?: (error: string) => void;
  toolbarContainer?: HTMLElement | null;
}) {
  const [store] = useState(createDesignerStore);
  const [explorer] = useState(() => {
    const state = createAppStore();
    state.setState({
      theme: 'light',
      darkMode: false,
      currentOntology: toPlayground(props.value, props.name ?? 'Ontology'),
      activeQuest: null,
      availableQuests: [],
      dataBindings: [],
      currentCatalogueEntry: null,
    });
    return state;
  });
  return (
    <ExplorerStoreContext.Provider value={explorer}>
      <DesignerStoreContext.Provider value={store}>
        <Editor {...props} store={store} explorer={explorer} />
      </DesignerStoreContext.Provider>
    </ExplorerStoreContext.Provider>
  );
}
function Editor({
  value,
  onChange,
  readOnly = false,
  name = 'Ontology',
  onValidityChange,
  toolbarContainer,
  store,
  explorer,
}: {
  value: Ontology;
  onChange: (value: Ontology) => void;
  readOnly?: boolean;
  name?: string;
  onValidityChange?: (error: string) => void;
  toolbarContainer?: HTMLElement | null;
  store: ReturnType<typeof createDesignerStore>;
  explorer: ReturnType<typeof createAppStore>;
}) {
  const { ontology, undo, redo, _past, _future, setOntologyDescription } = useDesignerStore();
  const [importing, setImporting] = useState(false);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [newEntity, setNewEntity] = useState<EntityType | null>(null),
    [configuring, setConfiguring] = useState<string | null>(null),
    [view, setView] = useState<'design' | 'explore' | 'rdf'>(readOnly ? 'explore' : 'design');
  const current = useRef({ value, onChange, readOnly, onValidityChange, name });
  current.current = { value, onChange, readOnly, onValidityChange, name };
  const last = useRef(''),
    loading = useRef(false);
  useEffect(() => {
    const document = toPlayground(value, name),
      serialized = JSON.stringify(document);
    if (serialized === last.current) return;
    loading.current = true;
    store.getState().loadDraft(document);
    explorer.setState({
      currentOntology: document,
      selectedEntityId: null,
      selectedRelationshipId: null,
      highlightedEntities: [],
      highlightedRelationships: [],
    });
    last.current = serialized;
    loading.current = false;
    setLoaded(true);
    setError('');
  }, [value, name, store, explorer]);
  useEffect(
    () =>
      store.subscribe((state, prior) => {
        if (
          state.selectedEntityId !== prior.selectedEntityId ||
          state.selectedRelationshipId !== prior.selectedRelationshipId
        )
          explorer.setState({
            selectedEntityId: state.selectedEntityId,
            selectedRelationshipId: state.selectedRelationshipId,
          });
        if (state.ontology !== prior.ontology) explorer.setState({ currentOntology: state.ontology });
        if (loading.current || state.ontology === prior.ontology || current.current.readOnly) return;
        try {
          const document = playgroundDocumentSchema.parse(state.ontology);
          for (const e of document.entityTypes) for (const p of e.properties) p.stackprocId ??= crypto.randomUUID();
          // Normalize imported RDF once without adding a second history entry.
          if (JSON.stringify(document) !== JSON.stringify(state.ontology)) {
            loading.current = true;
            store.setState({ ontology: document });
            loading.current = false;
          }
          const next = fromPlayground(document, current.current.value);
          last.current = JSON.stringify(toPlayground(next, current.current.name));
          current.current.value = next;
          current.current.onChange(next);
          setError('');
          current.current.onValidityChange?.('');
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Could not read ontology draft.';
          setError(message);
          current.current.onValidityChange?.(message);
        }
      }),
    [store, explorer],
  );
  useEffect(
    () =>
      explorer.subscribe((state, prior) => {
        if (
          state.selectedEntityId !== prior.selectedEntityId ||
          state.selectedRelationshipId !== prior.selectedRelationshipId
        )
          store.setState({
            selectedEntityId: state.selectedEntityId,
            selectedRelationshipId: state.selectedRelationshipId,
          });
      }),
    [explorer, store],
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        current.current.readOnly ||
        (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable]'))
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);
  const configuringEntity = newEntity ?? ontology.entityTypes.find((e) => e.id === configuring);
  const toolbar = (
    <div className="sp-ontology-toolbar">
      <div className="sp-ontology-history" role="group" aria-label="Edit history">
        <RecordAction label="Undo (⌘/Ctrl Z)" icon={RotateLeft} disabled={readOnly || !_past.length} onPress={undo} />
        <RecordAction
          label="Redo (⌘/Ctrl Shift Z)"
          icon={RedoIcon}
          disabled={readOnly || !_future.length}
          onPress={redo}
        />
      </div>
      {!readOnly && <ControlButton onPress={() => setImporting(true)}>Import RDF</ControlButton>}
      <div className="sp-ontology-views" role="group" aria-label="Ontology views">
        <ControlButton aria-pressed={view === 'design'} disabled={readOnly} onClick={() => setView('design')}>
          Design
        </ControlButton>
        <ControlButton aria-pressed={view === 'explore'} onClick={() => setView('explore')}>
          Explore
        </ControlButton>
        <ControlButton aria-pressed={view === 'rdf'} onClick={() => setView('rdf')}>
          RDF
        </ControlButton>
      </div>
    </div>
  );
  return (
    <section className="sp-ontology-playground light-theme" aria-label="Ontology visual editor">
      {importing && (
        <RdfImportDialog
          previous={value}
          onClose={() => setImporting(false)}
          onApply={(document) => {
            replaceDesignerOntology(store, { ...document, name });
            setImporting(false);
            setView('design');
          }}
        />
      )}
      {error && (
        <p className="cp-error" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <p>Loading ontology…</p>
      ) : (
        <>
          {toolbarContainer ? createPortal(toolbar, toolbarContainer) : toolbar}
          {view === 'rdf' ? (
            <div className={`sp-ontology-preview${readOnly ? ' sp-ontology-readonly' : ''}`}>
              <RdfPreview readOnly ontology={ontology} onImported={() => {}} />
            </div>
          ) : (
            <div className={`sp-ontology-editor-grid ${view === 'explore' ? 'is-explorer' : ''}`}>
              {view === 'design' && (
                <fieldset className="designer-sidebar" disabled={readOnly}>
                  <TextArea
                    label="Domain description"
                    value={ontology.description}
                    onChange={setOntologyDescription}
                    isReadOnly={readOnly}
                  />
                  <div className="wi-section-heading">
                    <h3>Entities</h3>
                    <ControlButton
                      iconLeading={Plus}
                      disabled={readOnly || ontology.entityTypes.length >= 200}
                      onClick={() => {
                        const count = ontology.entityTypes.length;
                        setNewEntity({
                          id: crypto.randomUUID(),
                          name: `NewEntity${count + 1}`,
                          description: '',
                          color: entityColors[count % entityColors.length].hex,
                          icon: ENTITY_ICONS[count % ENTITY_ICONS.length],
                          properties: [
                            {
                              stackprocId: crypto.randomUUID(),
                              name: 'id',
                              type: 'string',
                              isIdentifier: true,
                              required: true,
                              nullable: false,
                            },
                          ],
                        });
                      }}
                    >
                      Add
                    </ControlButton>
                  </div>
                  <div className="sp-entity-list">
                    {ontology.entityTypes.map((entity) => (
                      <div
                        key={entity.id}
                        className="sp-entity-list-row"
                        data-selected={store.getState().selectedEntityId === entity.id || undefined}
                      >
                        <ControlButton
                          className="sp-entity-select"
                          onClick={() => store.getState().selectEntity(entity.id)}
                        >
                          <EntityGlyph symbol={entity.icon} />
                          <span>{entity.name}</span>
                          <small>
                            {entity.properties.length} {entity.properties.length === 1 ? 'property' : 'properties'}
                          </small>
                        </ControlButton>
                        <RecordAction
                          label={`Configure entity ${entity.name}`}
                          icon={SettingsIcon}
                          onPress={() => setConfiguring(entity.id)}
                        />
                        <RecordAction
                          label={`Remove entity ${entity.name}`}
                          icon={Trash01}
                          disabled={readOnly}
                          onPress={() => store.getState().removeEntity(entity.id)}
                        />
                      </div>
                    ))}
                  </div>
                  {!ontology.entityTypes.length && <p>Add an entity to define its properties and relationships.</p>}
                  <RelationshipForm />
                </fieldset>
              )}
              <OntologyGraph onConfigureEntity={setConfiguring} />
              <aside className="right-sidebar" aria-label="Ontology insights and inspector">
                <OntologyStatsPanel />
                <PathFinderPanel />
                <SearchFilter />
                <InspectorPanel />
                {store.getState().selectedEntityId && (
                  <div className="sp-entity-inspector-action">
                    <ControlButton
                      iconLeading={SettingsIcon}
                      onClick={() => setConfiguring(store.getState().selectedEntityId)}
                    >
                      Configure entity
                    </ControlButton>
                  </div>
                )}
              </aside>
            </div>
          )}
        </>
      )}
      {configuringEntity && (
        <EntityConfigDialog
          key={configuringEntity.id}
          entity={configuringEntity}
          ontology={newEntity ? { ...ontology, entityTypes: [...ontology.entityTypes, newEntity] } : ontology}
          readOnly={readOnly}
          onClose={() => {
            setConfiguring(null);
            setNewEntity(null);
          }}
          onApply={(entity, relationships) => {
            if (relationships.some((r) => r.from !== entity.id && r.to !== entity.id))
              throw new Error('Each relationship must connect to this entity.');
            const candidate = {
              ...ontology,
              entityTypes: newEntity
                ? [...ontology.entityTypes, entity]
                : ontology.entityTypes.map((e) => (e.id === entity.id ? entity : e)),
              relationships: [
                ...ontology.relationships.filter((r) => r.from !== entity.id && r.to !== entity.id),
                ...relationships,
              ],
            };
            const projected = fromPlayground(candidate, current.current.value),
              issues = validateOntology(projected);
            if (issues.some((i) => i.severity === 'error'))
              throw new Error(
                issues
                  .filter((i) => i.severity === 'error')
                  .map((i) => i.message)
                  .join(' '),
              );
            configureDesignerEntity(store, entity, relationships);
          }}
        />
      )}
    </section>
  );
}
