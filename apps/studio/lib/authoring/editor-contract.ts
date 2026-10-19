import type { FlowNodeData } from '../flows/types';
import { configDefinition, type ConfigTab } from '../native/node-config';

export type EditorSection = 'input' | 'process' | 'output';
export type EditorPage = {
  id: string;
  label: string;
  renderer: 'native' | 'code' | 'authoring' | 'details' | 'execution' | 'contract' | 'result' | 'empty' | 'legacy';
  tab?: ConfigTab;
  fields?: string[];
  direction?: 'input' | 'output';
  description?: string;
};
export type NodeEditorContract = {
  classification: 'operation' | 'control' | 'invocation' | 'entry' | 'legacy-composition';
  sections: Record<EditorSection, EditorPage[]>;
};

export function nodeClassification(kind: FlowNodeData['kind']): NodeEditorContract['classification'] {
  if (['foreach', 'loop', 'parallel', 'merge'].includes(kind)) return 'control';
  if (kind === 'workflow') return 'invocation';
  if (kind === 'trigger') return 'entry';
  if (['review', 'agent', 'approval'].includes(kind)) return 'legacy-composition';
  return 'operation';
}

/** Presentation adapter for saved definitions. Does not change their persisted or runtime semantics. */
export function nodeEditorContract(node: FlowNodeData): NodeEditorContract {
  const def = configDefinition(node);
  const kind = node.config.code ? 'code' : node.kind;
  const sections: NodeEditorContract['sections'] = { input: [], process: [], output: [] };
  const classification = nodeClassification(kind);
  if (kind === 'code') {
    sections.input.push(
      { id: 'values', label: 'Values', renderer: 'code', tab: 'inputs' },
      { id: 'input-contract', label: 'Input contract', renderer: 'contract', direction: 'input' },
    );
    sections.process.push(
      { id: 'editor', label: 'Editor', renderer: 'code', tab: 'operation' },
      { id: 'limits', label: 'Runtime limits', renderer: 'code', tab: 'execution' },
    );
    sections.output.push({
      id: 'output-contract',
      label: 'Return contract',
      renderer: 'contract',
      direction: 'output',
    });
  } else if (['construct', 'merge', 'setVariables'].includes(kind) || node.config.variableAssignment) {
    sections.process.push({
      id: 'values',
      label: kind === 'setVariables' ? 'Assignments' : 'Fields',
      renderer:
        node.config.variableAssignment || !['construct', 'merge', 'setVariables'].includes(kind) ? 'code' : 'authoring',
      tab: 'inputs',
    });
  } else if (def) {
    const behaviorKeys = new Set(['timeoutSeconds', 'durationMS', 'delaySeconds', 'partition']);
    const inputs = def.fields.filter((f) => f.tab === 'inputs' && !behaviorKeys.has(f.key));
    const process = def.fields.filter((f) => !inputs.includes(f));
    if (inputs.length)
      sections.input.push({ id: 'values', label: 'Values', renderer: 'native', fields: inputs.map((f) => f.key) });
    if (process.length)
      sections.process.push({
        id: 'operation',
        label: def.operationLabel,
        renderer: 'native',
        fields: process.map((f) => f.key),
      });
  } else if (kind !== 'trigger')
    sections.process.push({ id: 'configuration', label: 'Configuration', renderer: 'legacy' });
  if (!sections.input.length)
    sections.input.push({
      id: 'none',
      label: 'Input',
      renderer: 'empty',
      description:
        kind === 'trigger'
          ? 'Workflow input is supplied when this workflow starts.'
          : ['construct', 'merge', 'setVariables'].includes(kind)
            ? 'Choose values and workflow data directly in Process.'
            : 'This operation requires no data input.',
    });
  if (!sections.output.length) sections.output.push({ id: 'result', label: 'Result', renderer: 'result' });
  if (def?.execution)
    sections.process.push({ id: 'execution', label: 'Retries & timeout', renderer: 'execution', tab: 'execution' });
  sections.process.push({ id: 'details', label: 'Details', renderer: 'details', tab: 'general' });
  return { classification, sections };
}

/** Map diagnostics to their actual owner, including nested parameter and branch paths. */
export function editorIssueLocation(node: FlowNodeData, issue: string): { section: EditorSection; page: string } {
  const contract = nodeEditorContract(node);
  if (/^config\.ports\.(input|output)/.test(issue)) {
    const section = issue.startsWith('config.ports.input') ? 'input' : 'output';
    return {
      section,
      page: contract.sections[section].find((p) => p.renderer === 'contract')?.id ?? contract.sections[section][0].id,
    };
  }
  if (/^(name|description)/.test(issue)) return { section: 'process', page: 'details' };
  if (issue.startsWith('config.code.limits')) return { section: 'process', page: 'limits' };
  if (issue.startsWith('config.code')) return { section: 'process', page: 'editor' };
  if (issue.startsWith('config.execution')) return { section: 'process', page: 'execution' };
  const key = issue.replace(/^config\.(operation|parameters)\./, '').split(/[.:]/)[0];
  for (const section of ['input', 'process', 'output'] as const) {
    const page = contract.sections[section].find(
      (p) =>
        p.fields?.includes(key) ||
        (p.renderer === 'code' && p.tab === 'inputs' && key === 'input') ||
        p.renderer === 'authoring',
    );
    if (page) return { section, page: page.id };
  }
  return { section: 'process', page: contract.sections.process[0].id };
}
