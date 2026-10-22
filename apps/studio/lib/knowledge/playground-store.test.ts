import { describe, it, expect } from 'vitest';
import { createDesignerStore, configureDesignerEntity } from '../../vendor/ontology-playground/src/store/designerStore';
import { createAppStore } from '../../vendor/ontology-playground/src/store/appStore';
describe('imported Microsoft editor state', () => {
  it('keeps entity/property identities through rename, reorder and undo', () => {
    const store = createDesignerStore();
    store.getState().addEntity();
    const entity = store.getState().ontology.entityTypes[0];
    const property = entity.properties[0].stackprocId;
    expect(property).toBeTruthy();
    store.getState().addProperty(entity.id);
    const added = store.getState().ontology.entityTypes[0].properties[1].stackprocId;
    expect(added).not.toBe(property);
    store.getState().updateEntity(entity.id, { name: 'Customer' });
    store.getState().updateProperty(entity.id, 0, { name: 'Customer ID' });
    store.getState().moveProperty(entity.id, 0, 1);
    expect(store.getState().ontology.entityTypes[0].properties[1].stackprocId).toBe(property);
    store.getState().undo();
    expect(store.getState().ontology.entityTypes[0].properties[0]).toMatchObject({
      name: 'Customer ID',
      stackprocId: property,
    });
    store.getState().redo();
    expect(store.getState().ontology.entityTypes[0].properties[1].stackprocId).toBe(property);
  });
  it('isolates drafts, selection and history between editor instances', () => {
    const one = createDesignerStore(),
      two = createDesignerStore();
    one.getState().addEntity();
    expect(two.getState().ontology.entityTypes).toEqual([]);
    expect(two.getState().selectedEntityId).toBeNull();
    expect(two.getState()._past).toEqual([]);
    const explorerOne = createAppStore(),
      explorerTwo = createAppStore();
    explorerOne.getState().selectEntity('invoice');
    expect(explorerTwo.getState().selectedEntityId).toBeNull();
  });
});

it('applies entity configuration as one undoable change and leaves cancelled local edits untouched', () => {
  const store = createDesignerStore();
  store.getState().addEntity();
  const before = structuredClone(store.getState().ontology),
    entity = structuredClone(before.entityTypes[0]);
  entity.name = 'Updated';
  entity.properties.push({
    stackprocId: 'nested',
    name: 'Profile',
    type: 'object',
    schema: { type: 'object', properties: { active: { type: 'boolean' } } },
  });
  expect(store.getState().ontology).toEqual(before); // Local dialog draft, before Apply.
  store.getState().configureEntity(entity, []);
  expect(store.getState().ontology.entityTypes[0].properties).toHaveLength(2);
  store.getState().undo();
  expect(store.getState().ontology).toEqual(before);
  store.getState().redo();
  expect(store.getState().ontology.entityTypes[0].name).toBe('Updated');
});

it('applies configuration to a mounted store that predates the configureEntity action without resetting its draft', () => {
  const store = createDesignerStore();
  store.getState().addEntity();
  store.getState().setOntologyDescription('Unsaved domain description');
  const before = structuredClone(store.getState().ontology);
  const history = store.getState()._past.length;
  Reflect.deleteProperty(store.getState(), 'configureEntity');
  const entity = { ...before.entityTypes[0], name: 'Customer' };
  configureDesignerEntity(store, entity, []);
  expect(store.getState().ontology.description).toBe('Unsaved domain description');
  expect(store.getState().ontology.entityTypes[0].name).toBe('Customer');
  expect(store.getState()._past).toHaveLength(history + 1);
  store.getState().undo();
  expect(store.getState().ontology).toEqual(before);
});
