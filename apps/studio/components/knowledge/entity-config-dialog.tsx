'use client';
import { useState } from 'react';
import { ModalOverlay, Modal, Dialog } from '@/components/application/modals/modal';
import { Tabs } from '@/components/application/tabs/tabs';
import { Table } from '@/components/application/table/table';
import { ControlButton, ControlInput, ControlSelect } from '@/components/control/controls';
import { TextArea } from '@/components/base/textarea/textarea';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { RecordAction } from '@/components/control/work-area';
import { SchemaFields } from '@/components/flows/schema-fields';
import { ErrorMark } from '@/components/flows/field-validation';
import { FixedValue } from './fixed-value';
import { Plus, Trash01, ChevronDown, ChevronRight, X } from '@/components/fa-icons';
import { EntityGlyph } from '@/vendor/ontology-playground/host/entity-glyph';
import { entityIcons } from '@/lib/knowledge/entity-presentation';
import { entityColors } from '@/lib/knowledge/material-colors';
import type { EntityType, Property, Relationship, Ontology } from '@/vendor/ontology-playground/src/data/ontology';
import { assertValue, type ValueSchema } from '@/lib/authoring/contracts';

const types: Property['type'][] = [
  'string',
  'integer',
  'decimal',
  'double',
  'date',
  'datetime',
  'boolean',
  'enum',
  'object',
  'array',
];
export function propertyValueSchema(p: Property): ValueSchema {
  const type =
    p.type === 'decimal' || p.type === 'double'
      ? 'number'
      : ['date', 'datetime', 'enum'].includes(p.type)
        ? 'string'
        : p.type;
  return {
    ...p.schema,
    type,
    ...(p.type === 'date' ? { format: 'date' } : p.type === 'datetime' ? { format: 'date-time' } : {}),
    ...(p.type === 'enum' ? { enum: p.values ?? [] } : {}),
    ...(type === 'array' && !p.schema?.items ? { items: {} } : {}),
  };
}
export function EntityConfigDialog({
  entity,
  ontology,
  readOnly = false,
  onApply,
  onClose,
}: {
  entity: EntityType;
  ontology: Ontology;
  readOnly?: boolean;
  onApply: (entity: EntityType, relationships: Relationship[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(entity));
  const [relations, setRelations] = useState(() =>
    structuredClone(ontology.relationships.filter((r) => r.from === entity.id || r.to === entity.id)),
  );
  const [tab, setTab] = useState('general'),
    [selected, setSelected] = useState<string | null>(entity.properties[0]?.stackprocId ?? null),
    [error, setError] = useState('');
  const property = draft.properties.find((p) => p.stackprocId === selected);
  const update = (id: string, patch: Partial<Property>) =>
    setDraft((v) => ({ ...v, properties: v.properties.map((p) => (p.stackprocId === id ? { ...p, ...patch } : p)) }));
  let defaultError = '';
  if (property && Object.hasOwn(property.schema ?? {}, 'default'))
    try {
      const schema = propertyValueSchema(property);
      assertValue(
        { ...schema, ...(property.nullable ? { type: [schema.type, 'null'] } : {}) },
        property.schema!.default,
        'Default',
      );
    } catch (err) {
      defaultError = err instanceof Error ? err.message : 'Invalid default value.';
    }
  function apply() {
    try {
      if (!draft.name.trim()) {
        setTab('general');
        throw new Error('Enter an entity name.');
      }
      if (draft.properties.some((p) => !p.name.trim())) {
        setTab('properties');
        throw new Error('Enter a name for each property.');
      }
      if (new Set(draft.properties.map((p) => p.name.trim().toLowerCase())).size !== draft.properties.length) {
        setTab('properties');
        throw new Error('Property names must be unique.');
      }
      if (defaultError) throw new Error(defaultError);
      onApply(draft, relations);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply entity configuration.');
    }
  }
  const propertyDetails = property ? (
    <section className="sp-entity-property-details">
      <TextArea
        label="Description"
        value={property.description ?? ''}
        onChange={(description) => update(property.stackprocId!, { description })}
      />
      {(property.type === 'object' || property.type === 'array') && (
        <SchemaFields
          label="Property schema"
          value={propertyValueSchema(property)}
          types={[property.type]}
          onChange={(schema) => update(property.stackprocId!, { schema: schema as Property['schema'] })}
        />
      )}
      {property.type === 'enum' && (
        <TextArea
          label="Allowed values (one per line)"
          value={(property.values ?? []).join('\n')}
          onChange={(text) => update(property.stackprocId!, { values: text.split('\n') })}
        />
      )}
      <div className="sp-entity-property-metadata">
        <label>
          Unit
          <ControlInput
            value={property.unit ?? ''}
            onChange={(e) => update(property.stackprocId!, { unit: e.target.value || undefined })}
          />
        </label>
        <div className="sp-entity-default-settings">
          <Checkbox
            className="sp-entity-checkbox"
            label="Define a default value"
            isSelected={Object.hasOwn(property.schema ?? {}, 'default')}
            onChange={(enabled) => {
              const schema = propertyValueSchema(property);
              delete schema.default;
              if (enabled)
                schema.default =
                  property.type === 'array'
                    ? []
                    : property.type === 'object'
                      ? {}
                      : property.type === 'boolean'
                        ? false
                        : ['integer', 'decimal', 'double'].includes(property.type)
                          ? 0
                          : '';
              update(property.stackprocId!, { schema: schema as Property['schema'] });
            }}
          />
          {Object.hasOwn(property.schema ?? {}, 'default') && (
            <div className={defaultError ? 'sp-entity-default sp-entity-invalid' : 'sp-entity-default'}>
              <FixedValue
                label="Default value"
                value={property.schema!.default}
                onChange={(value) =>
                  update(property.stackprocId!, {
                    schema: { ...propertyValueSchema(property), default: value } as Property['schema'],
                  })
                }
              />
              {defaultError && <p role="alert">{defaultError}</p>}
            </div>
          )}
          <p>Defaults describe the schema; they do not execute an expression or change workflow variables.</p>{' '}
        </div>
      </div>
    </section>
  ) : null;
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="nc-overlay"
    >
      <Modal className="nc-modal">
        <Dialog aria-label={`Configure entity ${entity.name}`} className="nc-dialog sp-entity-dialog">
          <header className="nc-header">
            <div className="nc-heading">
              <EntityGlyph symbol={draft.icon} />
              <div>
                <span>Entity configuration</span>
                <h2>{draft.name || 'Untitled entity'}</h2>
              </div>
            </div>
            <RecordAction label="Close entity configuration" icon={X} onPress={onClose} />
          </header>
          <Tabs
            orientation="vertical"
            selectedKey={tab}
            onSelectionChange={(key) => setTab(String(key))}
            className="nc-workspace"
          >
            <Tabs.List aria-label="Entity configuration" orientation="vertical" type="line" className="nc-section-nav">
              <Tabs.Item id="general">General</Tabs.Item>
              <Tabs.Item id="properties">Properties</Tabs.Item>
              <Tabs.Item id="relationships">Relationships</Tabs.Item>
              <Tabs.Item id="help">Help</Tabs.Item>
            </Tabs.List>
            <Tabs.Panel id={tab} className="nc-section-panel sp-entity-panel">
              {error && (
                <p className="nc-field-errors" role="alert">
                  <ErrorMark /> {error}
                </p>
              )}
              <fieldset disabled={readOnly} className="sp-entity-fields">
                {tab === 'general' && (
                  <>
                    <label>
                      Name
                      <ControlInput
                        value={draft.name}
                        aria-label="Entity name"
                        aria-invalid={!draft.name.trim() || undefined}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                    </label>
                    <TextArea
                      label="Description"
                      value={draft.description}
                      onChange={(description) => setDraft({ ...draft, description })}
                    />
                    <section>
                      <h3>Icon</h3>
                      <div className="sp-entity-icon-picker">
                        {entityIcons.map(({ symbol, label }) => (
                          <ControlButton
                            key={symbol}
                            aria-label={`${label} icon`}
                            aria-pressed={draft.icon === symbol}
                            onClick={() => setDraft({ ...draft, icon: symbol })}
                          >
                            <EntityGlyph symbol={symbol} />
                          </ControlButton>
                        ))}
                      </div>
                    </section>
                    <section>
                      <h3>Color</h3>
                      <p>Material Design · 500 shades</p>
                      <div className="sp-entity-color-picker">
                        {entityColors.map((color) => (
                          <ControlButton
                            key={color.hex}
                            aria-label={`${color.name} 500`}
                            aria-pressed={draft.color.toLowerCase() === color.hex}
                            onClick={() => setDraft({ ...draft, color: color.hex })}
                          >
                            <span style={{ background: color.hex }} />
                            {color.name}
                          </ControlButton>
                        ))}
                      </div>
                    </section>
                  </>
                )}
                {tab === 'properties' && (
                  <>
                    <div className="wi-section-heading sp-entity-properties-heading">
                      <div>
                        <h3>Properties</h3>
                        <p>Expand a property to edit its description, nested structure and default value.</p>
                      </div>
                      <ControlButton
                        iconLeading={Plus}
                        disabled={readOnly || draft.properties.length >= 100}
                        onClick={() => {
                          const id = crypto.randomUUID();
                          setDraft({
                            ...draft,
                            properties: [
                              ...draft.properties,
                              { stackprocId: id, name: '', type: 'string', required: false, nullable: false },
                            ],
                          });
                          setSelected(id);
                        }}
                      >
                        Add property
                      </ControlButton>
                    </div>
                    <div className="sp-entity-table-viewport">
                      <Table aria-label="Entity properties" className="sp-entity-properties-table">
                        <Table.Header>
                          <Table.Head aria-label="Expand property" />
                          <Table.Head isRowHeader>Name</Table.Head>
                          <Table.Head>Type</Table.Head>
                          <Table.Head>Required</Table.Head>
                          <Table.Head>Nullable</Table.Head>
                          <Table.Head>Identifier</Table.Head>
                          <Table.Head>Actions</Table.Head>
                        </Table.Header>
                        <Table.Body>
                          {draft.properties.flatMap((p) => [
                            <Table.Row
                              key={p.stackprocId}
                              id={p.stackprocId!}
                              textValue={p.name || 'New property'}
                              className={selected === p.stackprocId ? 'sp-entity-property-expanded' : undefined}
                              onAction={() => setSelected(p.stackprocId!)}
                              onFocusCapture={(event) => {
                                if (
                                  event.target instanceof HTMLElement &&
                                  event.target.matches('input, select, textarea')
                                )
                                  setSelected(p.stackprocId!);
                              }}
                            >
                              <Table.Cell>
                                <ControlButton
                                  color="tertiary"
                                  aria-label={`${selected === p.stackprocId ? 'Collapse' : 'Expand'} property ${p.name || 'new property'}`}
                                  aria-expanded={selected === p.stackprocId}
                                  aria-controls={`property-details-${p.stackprocId}`}
                                  iconLeading={selected === p.stackprocId ? ChevronDown : ChevronRight}
                                  onPress={() =>
                                    setSelected((value) => (value === p.stackprocId ? null : p.stackprocId!))
                                  }
                                />
                              </Table.Cell>
                              <Table.Cell>
                                <ControlInput
                                  aria-label={`Property name ${p.stackprocId}`}
                                  placeholder="Property name"
                                  value={p.name}
                                  aria-invalid={!p.name.trim() || undefined}
                                  onChange={(e) => update(p.stackprocId!, { name: e.target.value })}
                                />
                              </Table.Cell>
                              <Table.Cell>
                                <ControlSelect
                                  aria-label={`Type for ${p.name || 'new property'}`}
                                  value={p.type}
                                  onChange={(e) =>
                                    update(p.stackprocId!, {
                                      type: e.target.value as Property['type'],
                                      schema: undefined,
                                    })
                                  }
                                >
                                  {types.map((t) => (
                                    <option key={t}>{t}</option>
                                  ))}
                                </ControlSelect>
                              </Table.Cell>
                              <Table.Cell>
                                <Checkbox
                                  aria-label={`Required ${p.name || 'new property'}`}
                                  isSelected={p.required ?? false}
                                  onChange={(required) => update(p.stackprocId!, { required })}
                                />
                              </Table.Cell>
                              <Table.Cell>
                                <Checkbox
                                  aria-label={`Nullable ${p.name || 'new property'}`}
                                  isSelected={p.nullable ?? false}
                                  onChange={(nullable) => update(p.stackprocId!, { nullable })}
                                />
                              </Table.Cell>
                              <Table.Cell>
                                <Checkbox
                                  aria-label={`Identifier ${p.name || 'new property'}`}
                                  isSelected={p.isIdentifier ?? false}
                                  onChange={(isIdentifier) => update(p.stackprocId!, { isIdentifier })}
                                />
                              </Table.Cell>
                              <Table.Cell>
                                <div className="wi-inline-actions">
                                  <RecordAction
                                    label={`Remove property ${p.name || 'new property'}`}
                                    icon={Trash01}
                                    disabled={readOnly}
                                    onPress={() => {
                                      setDraft({
                                        ...draft,
                                        properties: draft.properties.filter((v) => v.stackprocId !== p.stackprocId),
                                      });
                                      if (selected === p.stackprocId) setSelected(null);
                                    }}
                                  />
                                </div>
                              </Table.Cell>
                            </Table.Row>,
                            ...(selected === p.stackprocId
                              ? [
                                  <Table.Row
                                    key={`${p.stackprocId}-details`}
                                    id={`${p.stackprocId}-details`}
                                    textValue={`${p.name || 'New property'} details`}
                                    className="sp-entity-property-detail-row"
                                  >
                                    <Table.Cell colSpan={7}>
                                      <div id={`property-details-${p.stackprocId}`}>{propertyDetails}</div>
                                    </Table.Cell>
                                  </Table.Row>,
                                ]
                              : []),
                          ])}
                        </Table.Body>
                      </Table>
                    </div>
                    {!draft.properties.length && <p>No properties. Add a property to define this entity’s data.</p>}
                  </>
                )}
                {tab === 'relationships' && (
                  <>
                    <div className="wi-section-heading">
                      <h3>Connected relationships</h3>
                      <ControlButton
                        iconLeading={Plus}
                        disabled={readOnly}
                        onClick={() =>
                          setRelations([
                            ...relations,
                            {
                              id: crypto.randomUUID(),
                              name: 'related_to',
                              from: draft.id,
                              to: ontology.entityTypes.find((e) => e.id !== draft.id)?.id ?? draft.id,
                              cardinality: 'one-to-many',
                            },
                          ])
                        }
                      >
                        Add relationship
                      </ControlButton>
                    </div>
                    {!relations.length && <p>No relationships for this entity.</p>}
                    {relations.map((r) => (
                      <section key={r.id} className="wi-card">
                        <div className="wi-section-heading">
                          <ControlInput
                            aria-label="Relationship name"
                            value={r.name}
                            onChange={(e) =>
                              setRelations(relations.map((v) => (v.id === r.id ? { ...v, name: e.target.value } : v)))
                            }
                          />
                          <RecordAction
                            label={`Remove relationship ${r.name}`}
                            icon={Trash01}
                            disabled={readOnly}
                            onPress={() => setRelations(relations.filter((v) => v.id !== r.id))}
                          />
                        </div>
                        <div className="wi-form-grid">
                          {(['from', 'to'] as const).map((key) => (
                            <label key={key}>
                              {key === 'from' ? 'From' : 'To'}
                              <ControlSelect
                                value={r[key]}
                                onChange={(e) =>
                                  setRelations(
                                    relations.map((v) => (v.id === r.id ? { ...v, [key]: e.target.value } : v)),
                                  )
                                }
                              >
                                {ontology.entityTypes.map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {e.id === draft.id ? draft.name : e.name}
                                  </option>
                                ))}
                              </ControlSelect>
                            </label>
                          ))}
                          <label>
                            Cardinality
                            <ControlSelect
                              value={r.cardinality}
                              onChange={(e) =>
                                setRelations(
                                  relations.map((v) =>
                                    v.id === r.id
                                      ? { ...v, cardinality: e.target.value as Relationship['cardinality'] }
                                      : v,
                                  ),
                                )
                              }
                            >
                              {['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'].map((c) => (
                                <option key={c}>{c}</option>
                              ))}
                            </ControlSelect>
                          </label>
                        </div>
                      </section>
                    ))}
                  </>
                )}
                {tab === 'help' && (
                  <section>
                    <h3>Configure an entity</h3>
                    <p>
                      An entity defines a domain concept and the shape of its data. Properties use the same schema
                      editor as workflow nodes, including nested objects and arrays.
                    </p>
                    <p>
                      Required controls whether a property must be present. Nullable allows an explicit null. Identifier
                      marks a business identity field. Defaults are schema annotations.
                    </p>
                    <p>
                      Apply updates this ontology draft as one undoable change. Save in the main header persists a
                      revision. Cancel discards changes made in this dialog.
                    </p>
                  </section>
                )}
              </fieldset>
            </Tabs.Panel>
          </Tabs>
          <footer className="nc-footer">
            <p>Apply updates the ontology draft. Save the ontology to persist it.</p>
            <div>
              <ControlButton onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</ControlButton>
              {!readOnly && (
                <ControlButton className="cp-primary" onClick={apply}>
                  Apply
                </ControlButton>
              )}
            </div>
          </footer>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
