import type { FlowNodeKind } from '../flows/types';
export type OfferingDefinition = {
  id: string;
  version: 1;
  title: string;
  boundary: 'pure' | 'step' | 'workflow';
  parameters: readonly string[];
  profile?: 'pure-transform@1';
};
export const authoringDefinitions: Partial<Record<FlowNodeKind, OfferingDefinition>> = {
  construct: {
    id: 'core.construct-data',
    version: 1,
    title: 'Construct data',
    boundary: 'pure',
    parameters: ['value'],
  },
  setVariables: {
    id: 'core.set-variables',
    version: 1,
    title: 'Set variables',
    boundary: 'pure',
    parameters: ['values'],
  },
  merge: { id: 'core.merge', version: 1, title: 'Merge', boundary: 'pure', parameters: ['value'] },
  code: {
    id: 'code.pure-transform',
    version: 1,
    title: 'Code',
    boundary: 'step',
    parameters: ['input'],
    profile: 'pure-transform@1',
  },
  foreach: {
    id: 'core.for-each',
    version: 1,
    title: 'For each',
    boundary: 'workflow',
    parameters: ['items', 'partition'],
  },
  parallel: { id: 'core.parallel', version: 1, title: 'Parallel', boundary: 'workflow', parameters: [] },
  workflow: {
    id: 'core.call-workflow',
    version: 1,
    title: 'Call workflow',
    boundary: 'workflow',
    parameters: ['input', 'partition', 'delaySeconds'],
  },
};
