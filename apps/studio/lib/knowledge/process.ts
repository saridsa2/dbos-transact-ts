import { z } from 'zod';
import { processV2Schema, processGraphIssues } from '../processes/model';
import { parameterSchema } from '../authoring/model';
import { duplicateIssues, evidenceList, id, refSchema, type KnowledgeIssue } from './contracts';
const stepBase = { id, name: z.string().trim().min(1).max(200), evidence: evidenceList };
export const processStepSchema = z.discriminatedUnion('kind', [
  z.object({ ...stepBase, kind: z.literal('construct'), value: parameterSchema }).strict(),
  z.object({ ...stepBase, kind: z.literal('return'), value: parameterSchema }).strict(),
  z.object({ ...stepBase, kind: z.literal('requirement'), capability: z.string().min(1).max(2000) }).strict(),
]);
export const processSchema = z
  .object({
    schemaVersion: z.literal(1),
    purpose: z.string().min(1).max(10000),
    ontologyRefs: z.array(refSchema).max(20).default([]),
    inputSchema: z.record(z.string(), z.json()).default({ type: 'object' }),
    defaultInput: z.record(z.string(), z.json()).default({}),
    steps: z.array(processStepSchema).min(1).max(49),
    questions: z
      .array(z.object({ id, question: z.string().min(1).max(2000), answer: z.string().max(5000).optional() }).strict())
      .max(50)
      .default([]),
  })
  .strict();
export const processDocumentSchema = z.discriminatedUnion('schemaVersion', [processSchema, processV2Schema]);
export type Process = z.infer<typeof processSchema>;
export function validateProcess(value: unknown): KnowledgeIssue[] {
  const parsed = processDocumentSchema.safeParse(value);
  if (!parsed.success)
    return parsed.error.issues.map((i) => ({
      code: 'schema',
      path: i.path.join('.'),
      severity: 'error',
      message: i.message,
    }));
  if (parsed.data.schemaVersion === 2) return processGraphIssues(parsed.data);
  const p = parsed.data,
    issues = duplicateIssues(p.steps, 'steps');
  issues.push(...duplicateIssues(p.questions, 'questions'));
  p.steps.forEach((s, i) => {
    if (s.id === 'trigger')
      issues.push({
        code: 'reserved_id',
        path: `steps.${i}.id`,
        severity: 'error',
        message: 'The trigger ID is reserved.',
      });
    if (s.kind === 'return' && i !== p.steps.length - 1)
      issues.push({
        code: 'early_return',
        path: `steps.${i}`,
        severity: 'error',
        message: 'Return must be the final step in a linear process.',
      });
    if (s.kind === 'requirement')
      issues.push({ code: 'missing_capability', path: `steps.${i}`, severity: 'warning', message: s.capability });
  });
  if (p.steps.at(-1)?.kind !== 'return')
    issues.push({
      code: 'missing_return',
      path: 'steps',
      severity: 'warning',
      message: 'Add an explicit final result before generating a workflow.',
    });
  p.questions.forEach((q, i) => {
    if (!q.answer?.trim())
      issues.push({ code: 'unanswered_question', path: `questions.${i}`, severity: 'warning', message: q.question });
  });
  return issues;
}
