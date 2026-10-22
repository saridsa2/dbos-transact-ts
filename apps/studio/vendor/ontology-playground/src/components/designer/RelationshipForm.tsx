import { ControlButton, ControlInput, ControlSelect } from '@/components/control/controls';
import { DesignerTextArea } from '../../../host/controls';
import { Plus, Trash01 as Trash2 } from '@/components/fa-icons';
import { useDesignerStore } from '../../store/designerStore';
import type { Relationship } from '../../data/ontology';

const CARDINALITY_OPTIONS: Relationship['cardinality'][] = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'];

const CARDINALITY_LABELS: Record<Relationship['cardinality'], string> = {
  'one-to-one': '1 : 1',
  'one-to-many': '1 : N',
  'many-to-one': 'N : 1',
  'many-to-many': 'N : N',
};

export function RelationshipForm() {
  const {
    ontology,
    selectedRelationshipId,
    addRelationship,
    updateRelationship,
    removeRelationship,
    selectRelationship,
    addRelationshipAttribute,
    updateRelationshipAttribute,
    removeRelationshipAttribute,
  } = useDesignerStore();

  const entities = ontology.entityTypes;

  const handleAdd = () => {
    if (entities.length < 1) return;
    // Default the target to a second entity when one exists; otherwise create a
    // self-referencing relationship on the only entity (Fabric supports these).
    const from = entities[0].id;
    const to = entities[1]?.id ?? entities[0].id;
    addRelationship(from, to);
  };

  return (
    <div className="designer-relationship-list">
      <div className="designer-section-header">
        <h3>Relationships ({ontology.relationships.length})</h3>
        <ControlButton
          className="designer-add-btn"
          onClick={handleAdd}
          disabled={entities.length < 1}
          aria-label={entities.length < 1 ? 'Create at least one entity to add a relationship' : 'Add relationship'}
        >
          <Plus size={14} /> Add
        </ControlButton>
      </div>

      {ontology.relationships.length === 0 && (
        <div className="designer-empty">
          {entities.length < 1
            ? 'Create at least one entity first.'
            : 'No relationships yet. Click "Add" to create one.'}
        </div>
      )}

      {ontology.relationships.map((rel) => {
        const isSelected = selectedRelationshipId === rel.id;
        const isSubclass = rel.kind === 'subclass';
        const fromEntity = entities.find((e) => e.id === rel.from);
        const toEntity = entities.find((e) => e.id === rel.to);

        return (
          <div
            key={rel.id}
            className={`designer-rel-card ${isSelected ? 'selected' : ''}`}
            onClick={() => selectRelationship(rel.id)}
          >
            <div className="designer-rel-header">
              <span className="designer-rel-flow">
                {fromEntity?.icon ?? '?'} {fromEntity?.name ?? '???'}
                <span className="designer-rel-arrow"> → </span>
                {toEntity?.icon ?? '?'} {toEntity?.name ?? '???'}
              </span>
              <ControlButton
                className="designer-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  removeRelationship(rel.id);
                }}
                aria-label="Delete relationship"
              >
                <Trash2 size={14} />
              </ControlButton>
            </div>

            {isSelected && (
              <div className="designer-rel-body">
                {/* Name */}
                {isSubclass ? (
                  <div className="designer-import-error">
                    Class hierarchy edge (`rdfs:subClassOf`). It remains a subclass statement on RDF export.
                  </div>
                ) : (
                  <label className="designer-field">
                    <span>Name</span>
                    <ControlInput
                      type="text"
                      value={rel.name}
                      onChange={(e) => updateRelationship(rel.id, { name: e.target.value })}
                      placeholder="Relationship name"
                    />
                  </label>
                )}

                {/* Source / Target */}
                <div className="designer-field-row">
                  <label className="designer-field">
                    <span>{isSubclass ? 'Subclass' : 'From'}</span>
                    <ControlSelect
                      value={rel.from}
                      onChange={(e) => updateRelationship(rel.id, { from: e.target.value })}
                    >
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.icon} {e.name}
                        </option>
                      ))}
                    </ControlSelect>
                  </label>
                  <label className="designer-field">
                    <span>{isSubclass ? 'Parent class' : 'To'}</span>
                    <ControlSelect value={rel.to} onChange={(e) => updateRelationship(rel.id, { to: e.target.value })}>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.icon} {e.name}
                        </option>
                      ))}
                    </ControlSelect>
                  </label>
                </div>

                {/* Cardinality */}
                {!isSubclass && (
                  <label className="designer-field">
                    <span>Cardinality</span>
                    <ControlSelect
                      value={rel.cardinality}
                      onChange={(e) =>
                        updateRelationship(rel.id, { cardinality: e.target.value as Relationship['cardinality'] })
                      }
                    >
                      {CARDINALITY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {CARDINALITY_LABELS[c]}
                        </option>
                      ))}
                    </ControlSelect>
                  </label>
                )}

                {/* Description */}
                <label className="designer-field">
                  <span>Description</span>
                  <DesignerTextArea
                    rows={2}
                    value={rel.description ?? ''}
                    onChange={(e) => updateRelationship(rel.id, { description: e.target.value })}
                    placeholder="Describe this relationship"
                  />
                </label>

                {/* Attributes */}
                {!isSubclass && (
                  <div className="designer-field">
                    <div className="designer-section-header">
                      <span>Attributes ({rel.attributes?.length ?? 0})</span>
                      <ControlButton
                        className="designer-add-btn small"
                        onClick={() => addRelationshipAttribute(rel.id)}
                      >
                        <Plus size={12} /> Add
                      </ControlButton>
                    </div>
                    {(rel.attributes ?? []).map((attr, idx) => (
                      <div key={idx} className="designer-property-row">
                        <ControlInput
                          className="designer-prop-name"
                          type="text"
                          value={attr.name}
                          onChange={(e) => updateRelationshipAttribute(rel.id, idx, { name: e.target.value })}
                          placeholder="Attribute name"
                        />
                        <ControlInput
                          className="designer-prop-type"
                          type="text"
                          value={attr.type}
                          onChange={(e) => updateRelationshipAttribute(rel.id, idx, { type: e.target.value })}
                          placeholder="Type"
                        />
                        <ControlButton
                          className="designer-delete-btn small"
                          onClick={() => removeRelationshipAttribute(rel.id, idx)}
                          aria-label="Remove attribute"
                        >
                          <Trash2 size={12} />
                        </ControlButton>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
