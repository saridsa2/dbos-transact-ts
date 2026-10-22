'use client';
import { useEffect, useState } from 'react';
import { agentRequest } from '@/lib/agent/client';
import { OntologyGraph } from '@/vendor/ontology-playground/src/components/OntologyGraph';
import { createAppStore, ExplorerStoreContext } from '@/vendor/ontology-playground/src/store/appStore';
import { RecordAction } from '@/components/control/work-area';
import { ControlSelect } from '@/components/control/controls';
import { WorkflowIcon, RotateLeft } from '@/components/fa-icons';
import { entityIconFor } from '@/lib/knowledge/entity-presentation';

/** Read-only composition of the existing licensed graph renderer and official controls. */
export function MemoryGraph() {
  const [store] = useState(() => {
    const value = createAppStore();
    value.setState({
      currentOntology: { name: 'Workspace memory', description: '', entityTypes: [], relationships: [] },
      theme: 'light',
      darkMode: false,
      activeQuest: null,
      availableQuests: [],
      dataBindings: [],
      currentCatalogueEntry: null,
    });
    return value;
  });
  const [attempt, setAttempt] = useState(0),
    [state, setState] = useState<any>(),
    [error, setError] = useState(''),
    [view, setView] = useState('overview'),
    [refreshing, setRefreshing] = useState(true);
  useEffect(() => {
    let alive = true;
    setError('');
    setRefreshing(true);
    void agentRequest('memory/graph')
      .then((data) => {
        if (alive) setState(data);
      })
      .catch(() => {
        if (alive) setError('The workspace graph could not be loaded.');
      })
      .finally(() => {
        if (alive) setRefreshing(false);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  const visible =
    state?.nodes.filter((node: any) =>
      view === 'overview'
        ? !['ontology_concept', 'ontology_property', 'process_element', 'process_lane', 'navigation_term'].includes(
            node.kind,
          )
        : view === 'memory'
          ? ['approved_memory_version', 'navigation_term'].includes(node.kind)
          : node.key === view || node.key.startsWith(view + '/'),
    ) ?? [];
  const ids = new Set(visible.map((node: any) => node.key));
  const edges = state?.edges.filter((edge: any) => ids.has(edge.from) && ids.has(edge.to)) ?? [];
  useEffect(() => {
    if (!state) return;
    store.setState({
      currentOntology: {
        name: 'Workspace memory',
        description: state.notice,
        entityTypes: visible.map((node: any) => ({
          id: node.key,
          name: node.label,
          description: node.kind.replaceAll('_', ' ') + (node.state ? ` · ${node.state}` : ''),
          properties: [],
          icon:
            node.kind === 'workspace' || node.kind === 'process_lane'
              ? '🏢'
              : node.kind === 'navigation_term'
                ? '🔗'
                : node.kind.includes('memory') || node.kind.includes('history')
                  ? '📊'
                  : node.kind === 'ontology_concept'
                    ? entityIconFor(node.label, '')
                    : node.kind === 'process_element'
                      ? '⚡'
                      : '📁',
          color: node.kind === 'navigation_term' ? '#526e9b' : node.kind.includes('memory') ? '#527763' : '#827165',
        })),
        relationships: edges.map((edge: any) => ({
          id: edge.key,
          name: edge.label,
          from: edge.from,
          to: edge.to,
          cardinality: 'many-to-many' as const,
          kind: 'association' as const,
        })),
      },
      selectedEntityId: null,
      selectedRelationshipId: null,
      highlightedEntities: [],
      highlightedRelationships: [],
    });
    // Projection depends on the saved response and selected view, not graph interaction state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, view, store]);
  return (
    <section className="wi-section wi-memory-graph-section" aria-label="Workspace memory graph">
      <header className="wi-memory-graph-header">
        <div className="wi-memory-graph-heading">
          <WorkflowIcon aria-hidden="true" />
          <div className="wi-memory-graph-title">
            <h2>Workspace memory graph</h2>
            <p className="wi-secondary" aria-live="polite">
              {state
                ? `${visible.length} of ${state.nodes.length} nodes · ${edges.length} connections`
                : 'Saved knowledge and memory connections'}
            </p>
          </div>
        </div>
        <div className="wi-memory-graph-actions">
          {state && (
            <ControlSelect
              className="wi-memory-graph-view"
              aria-label="Graph view"
              value={view}
              onChange={(event) => setView(event.target.value)}
            >
              <option value="overview">Workspace overview</option>
              <option value="memory">Memory relationships</option>
              {state.nodes
                .filter((node: any) => node.kind === 'artifact_revision' && node.ref?.kind !== 'source')
                .map((node: any) => (
                  <option key={node.key} value={node.key}>
                    {node.label}
                  </option>
                ))}
            </ControlSelect>
          )}
          <RecordAction
            label={refreshing ? 'Refreshing graph' : 'Refresh graph'}
            icon={RotateLeft}
            disabled={refreshing}
            onPress={() => setAttempt((n) => n + 1)}
          />
        </div>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : !state ? (
        <p role="status">Loading workspace graph…</p>
      ) : (
        <>
          {state.truncated && (
            <p role="status" className="wi-secondary">
              The first 500 current nodes are loaded.
            </p>
          )}
          {!visible.length ? (
            <p>No approved memory relationships yet. Saved knowledge is available in Workspace overview.</p>
          ) : (
            <div className="sp-ontology-playground light-theme wi-memory-graph-canvas">
              <ExplorerStoreContext.Provider value={store}>
                <OntologyGraph
                  legendTitle="Nodes"
                  accessibleLabel={`Workspace memory graph: ${visible.length} nodes, ${edges.length} connections. Read-only diagram.`}
                />
              </ExplorerStoreContext.Provider>
            </div>
          )}
          <p className="wi-secondary">{state.notice}</p>
        </>
      )}
    </section>
  );
}
