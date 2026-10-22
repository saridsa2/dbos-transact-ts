import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it, expect } from 'vitest';
import { importBpmn } from './bpmn-import';
import { processGraphIssues } from './model';
const prefix = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">';
const linear = `${prefix}<process id="sample" name="Sample"><laneSet id="lanes"><lane id="staff" name="Staff"><flowNodeRef>task</flowNodeRef></lane></laneSet><startEvent id="start"/><userTask id="task" name="Review"/><endEvent id="end"/><sequenceFlow id="a" sourceRef="start" targetRef="task"/><sequenceFlow id="b" sourceRef="task" targetRef="end"/></process></definitions>`;
function parse(xml: string, id?: string) {
  const dom = new JSDOM(xml, { contentType: 'application/xml' });
  try {
    return importBpmn(xml, dom.window.document as unknown as Document, id);
  } finally {
    dom.window.close();
  }
}
describe('BPMN draft import (issue #2)', () => {
  it('preserves lanes, connectivity and source while keeping tasks unbound', () => {
    const p = parse(linear);
    expect(p.document).not.toBeNull();
    expect(p.document?.bpmnSource?.xml).toBe(linear);
    expect(p.document?.graph.elements.find((e) => e.id === 'task')).toMatchObject({
      laneId: 'staff',
      kind: 'activity',
      binding: { kind: 'requirement', performer: 'human' },
    });
    expect(p.document?.graph.flows).toHaveLength(2);
    expect(processGraphIssues(p.document!).every((i) => i.code === 'missing_capability')).toBe(true);
  });
  for (const file of ['pizza-collaboration.bpmn', 'invoice.bpmn'])
    it(`does not flatten ${file}`, () => {
      const xml = readFileSync(new URL(`../../server/fixtures/bpmn/${file}`, import.meta.url), 'utf8');
      const first = parse(xml);
      for (const process of first.processes) {
        const p = parse(xml, process.id);
        expect(p.document).toBeNull();
        expect(p.diagnostics.some((d) => d.severity === 'error')).toBe(true);
      }
    });
  it('requires a process selection for multi-process files', () => {
    const p = parse(`${prefix}<process id="one"/><process id="two"/></definitions>`);
    expect(p.processes).toHaveLength(2);
    expect(p.document).toBeNull();
    expect(() => parse(linear, 'missing')).toThrow('existing process');
  });
  it.each([
    linear.replace(
      '<userTask id="task" name="Review"/>',
      '<userTask id="task"><multiInstanceLoopCharacteristics/></userTask>',
    ),
    linear.replace('<startEvent id="start"/>', '<startEvent id="start"><timerEventDefinition/></startEvent>'),
    linear.replace('sourceRef="task" targetRef="end"', 'sourceRef="missing" targetRef="end"'),
    linear.replace('<endEvent id="end"/>', '<endEvent id="task"/>'),
    linear.replace('targetRef="end"', 'targetRef="start"'),
  ])('blocks unsupported behavior or invalid graphs', (xml) => {
    expect(parse(xml).document).toBeNull();
  });
  it('rejects DTDs, oversized input and non-BPMN XML', () => {
    expect(() => parse('<root/>')).toThrow('BPMN');
    const dom = new JSDOM(linear, { contentType: 'application/xml' });
    try {
      expect(() => importBpmn('x'.repeat(1024 * 1024 + 1), dom.window.document as unknown as Document)).toThrow(
        '1 MiB',
      );
      expect(() => importBpmn('<!DOCTYPE definitions>' + linear, dom.window.document as unknown as Document)).toThrow(
        'DTD',
      );
    } finally {
      dom.window.close();
    }
  });
});
