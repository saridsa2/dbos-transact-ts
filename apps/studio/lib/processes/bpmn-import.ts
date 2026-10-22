import { processV2Schema, processGraphIssues, type ProcessDocument, type ProcessElement } from './model';
import { arrangeProcessLanes } from './lanes';
import { id as referenceId } from '../knowledge/contracts';
export const BPMN_IMPORT_LIMIT = 1024 * 1024;
const BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI';
const DC = 'http://www.omg.org/spec/DD/20100524/DC';
export type BpmnDiagnostic = { severity: 'error' | 'warning'; elementId: string; message: string };
export type BpmnPreview = {
  processes: { id: string; name: string }[];
  selectedProcessId?: string;
  name?: string;
  document: ProcessDocument | null;
  diagnostics: BpmnDiagnostic[];
  summary: { activities: number; lanes: number; flows: number };
};
/** Deliberately bounded draft import. BPMN engines/expressions are never executed. */
export function importBpmn(source: string, doc: Document, processId?: string): BpmnPreview {
  if (!source.trim() || new TextEncoder().encode(source).byteLength > BPMN_IMPORT_LIMIT)
    throw new Error('Choose BPMN XML no larger than 1 MiB.');
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source)) throw new Error('DTD and entity declarations are not supported.');
  if (
    doc.querySelector('parsererror') ||
    doc.documentElement.namespaceURI !== BPMN ||
    doc.documentElement.localName !== 'definitions'
  )
    throw new Error('Choose a BPMN 2.0 XML definitions document.');
  const roots = Array.from(doc.documentElement.children).filter(
    (e) => e.namespaceURI === BPMN && e.localName === 'process',
  );
  if (!roots.length) throw new Error('No BPMN process definitions were found.');
  const processes = roots.map((e) => ({
    id: e.getAttribute('id') ?? '',
    name:
      e.getAttribute('name') ||
      Array.from(doc.getElementsByTagNameNS(BPMN, 'participant'))
        .find((p) => p.getAttribute('processRef') === e.getAttribute('id'))
        ?.getAttribute('name') ||
      e.getAttribute('id') ||
      'Unnamed process',
  }));
  if (processes.some((p) => !p.id) || new Set(processes.map((p) => p.id)).size !== processes.length)
    throw new Error('Every process must have a unique ID.');
  const result: BpmnPreview = {
    processes,
    document: null,
    diagnostics: [],
    summary: { activities: 0, lanes: 0, flows: 0 },
  };
  const selected = processId
    ? roots.find((e) => e.getAttribute('id') === processId)
    : roots.length === 1
      ? roots[0]
      : undefined;
  if (!selected) {
    if (processId) throw new Error('Select an existing process.');
    return result;
  }
  result.selectedProcessId = selected.getAttribute('id')!;
  result.name = selected.getAttribute('name') || result.selectedProcessId;
  const diagnostic = (e: Element, message: string, severity: 'error' | 'warning' = 'error') =>
    result.diagnostics.push({
      elementId: e.getAttribute('id') || e.parentElement?.getAttribute('id') || e.localName,
      severity,
      message,
    });
  const descendants = Array.from(selected.getElementsByTagNameNS(BPMN, '*'));
  const children = Array.from(selected.children).filter((e) => e.namespaceURI === BPMN);
  const tasks = new Set([
    'task',
    'userTask',
    'manualTask',
    'serviceTask',
    'scriptTask',
    'businessRuleTask',
    'sendTask',
    'receiveTask',
  ]);
  const nodes = children.filter((e) => tasks.has(e.localName) || ['startEvent', 'endEvent'].includes(e.localName));
  const sequence = children.filter((e) => e.localName === 'sequenceFlow');
  const lanes = descendants.filter((e) => e.localName === 'lane');
  result.summary = { activities: nodes.length, lanes: lanes.length, flows: sequence.length };
  if (nodes.length > 200 || sequence.length > 400 || lanes.length > 30)
    throw new Error('This process exceeds the editor limit of 200 elements, 400 flows or 30 lanes.');
  const allowed = new Set([
    'documentation',
    'extensionElements',
    'laneSet',
    'sequenceFlow',
    ...tasks,
    'startEvent',
    'endEvent',
  ]);
  for (const e of children)
    if (!allowed.has(e.localName))
      diagnostic(e, `${e.localName} is not supported by BPMN import. Import is blocked to preserve its semantics.`);
  for (const e of nodes)
    if (e.getAttribute('isForCompensation') === 'true')
      diagnostic(
        e,
        'Compensation activities need explicit compensation semantics and cannot be imported as ordinary tasks.',
      );
  for (const e of descendants) {
    if (
      [
        'standardLoopCharacteristics',
        'multiInstanceLoopCharacteristics',
        'childLaneSet',
        'conditionExpression',
      ].includes(e.localName) ||
      e.localName.endsWith('EventDefinition')
    )
      diagnostic(e, `${e.localName} needs an explicit supported implementation; it cannot be flattened during import.`);
    if (e.localName === 'extensionElements')
      diagnostic(e, 'Vendor extensions are retained in the original XML but are not executable bindings.', 'warning');
  }
  for (const e of Array.from(doc.getElementsByTagNameNS(BPMN, 'messageFlow'))) {
    const endpoints = [e.getAttribute('sourceRef'), e.getAttribute('targetRef')];
    const participants = Array.from(doc.getElementsByTagNameNS(BPMN, 'participant'))
      .filter((p) => p.getAttribute('processRef') === result.selectedProcessId)
      .map((p) => p.getAttribute('id'));
    if (endpoints.some((v) => participants.includes(v) || nodes.some((n) => n.getAttribute('id') === v)))
      diagnostic(
        e,
        'Cross-participant message flow cannot be executed by this importer. Import the collaboration only after modeling its message contracts explicitly.',
      );
  }
  const used = new Set<string>(),
    mapped = new Map<string, string>();
  for (const e of [...nodes, ...sequence, ...lanes]) {
    const original = e.getAttribute('id');
    if (!original || mapped.has(original)) {
      diagnostic(e, 'Every element, sequence flow and lane must have a unique ID.');
      continue;
    }
    let key = referenceId.safeParse(original).success && original !== 'trigger' ? original : `bpmn-${mapped.size + 1}`;
    while (used.has(key)) key += '-import';
    used.add(key);
    mapped.set(original, key);
  }
  const memberships = new Map<string, string>();
  for (const lane of lanes)
    for (const ref of Array.from(lane.children).filter(
      (e) => e.namespaceURI === BPMN && e.localName === 'flowNodeRef',
    )) {
      const key = ref.textContent?.trim() || '';
      if (memberships.has(key)) diagnostic(lane, `Activity ${key} belongs to multiple lanes.`);
      if (!nodes.some((n) => n.getAttribute('id') === key))
        diagnostic(lane, `Lane references unsupported or missing activity ${key}.`);
      memberships.set(key, mapped.get(lane.getAttribute('id')!)!);
    }
  const elements: ProcessElement[] = nodes.map((e) => {
    const original = e.getAttribute('id')!,
      base = {
        id: mapped.get(original)!,
        name: (e.getAttribute('name') || original || e.localName).slice(0, 200),
        evidence: [],
        laneId: memberships.get(original),
      };
    if (e.localName === 'startEvent') return { ...base, kind: 'start' };
    if (e.localName === 'endEvent') return { ...base, kind: 'end', value: { mode: 'fixed', value: null } };
    diagnostic(e, 'Imported as an unbound activity. Configure its operation before review or compilation.', 'warning');
    return {
      ...base,
      kind: 'activity',
      binding: {
        kind: 'requirement',
        performer: ['userTask', 'manualTask'].includes(e.localName) ? 'human' : 'system',
        capability: `Bind imported BPMN ${e.localName} (${original}) to a workspace operation.`,
      },
    };
  });
  const flows: ProcessDocument['graph']['flows'] = [];
  for (const e of sequence) {
    const from = e.getAttribute('sourceRef'),
      to = e.getAttribute('targetRef');
    if (!nodes.some((n) => n.getAttribute('id') === from) || !nodes.some((n) => n.getAttribute('id') === to)) {
      diagnostic(e, 'Sequence flow references an unsupported or missing activity.');
      continue;
    }
    flows.push({ id: mapped.get(e.getAttribute('id')!)!, source: mapped.get(from!)!, target: mapped.get(to!)! });
  }
  if (result.diagnostics.some((d) => d.severity === 'error')) return result;
  // Native cards have different dimensions. Keep BPMN horizontal order; size lanes for native cards.
  const shapes = Array.from(doc.getElementsByTagNameNS(BPMNDI, 'BPMNShape'));
  const x = (e: ProcessElement) => {
    const original = [...mapped].find(([, key]) => key === e.id)?.[0];
    const bounds = shapes
      .find((s) => s.getAttribute('bpmnElement') === original)
      ?.getElementsByTagNameNS(DC, 'Bounds')[0];
    return Number(bounds?.getAttribute('x') ?? 0);
  };
  const ordered = [...elements].sort((a, b) => x(a) - x(b));
  const document = processV2Schema.parse({
    schemaVersion: 2,
    purpose: `Imported BPMN process: ${result.name}. Activities require workspace bindings; original BPMN XML is retained.`,
    ontologyRefs: [],
    inputSchema: { type: 'object' },
    defaultInput: {},
    questions: [],
    lanes: lanes.map((e) => ({
      id: mapped.get(e.getAttribute('id')!)!,
      name: (e.getAttribute('name') || e.getAttribute('id')!).slice(0, 200),
    })),
    graph: { elements: ordered, flows },
    presentation: { positions: {} },
    compatibility: { sourceVersion: 1, inputEnvelope: 'variables' },
    bpmnSource: { xml: source, processId: result.selectedProcessId, idMap: Object.fromEntries(mapped) },
  });
  const graphIssues = processGraphIssues(document).filter((i) => i.code !== 'missing_capability');
  for (const issue of graphIssues)
    result.diagnostics.push({ severity: 'error', elementId: issue.path, message: issue.message });
  if (!result.diagnostics.some((d) => d.severity === 'error')) result.document = arrangeProcessLanes(document);
  return result;
}
