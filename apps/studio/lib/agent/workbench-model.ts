import type { ProcessDocument } from '../processes/model';
import type { UploadedContext } from './context-uploads';
import type { AgentInteraction, InteractionResponse } from './interactions';
import { interactionErrors } from './interactions';
import type { AgentResource } from './resource-links';
import type { WorkState } from './contracts';
import type { Ontology } from '../knowledge/ontology';
export type ResourceAttachment = {
  kind: 'ontology' | 'source' | 'process';
  id: string;
  revisionId: string;
  name: string;
};
export type SessionRow = {
  archivedAt?: string | null;
  canDelete?: boolean;
  deleteBlockedReason?: string | null;
  id: string;
  title: string;
  updatedAt: string;
  editVersion: number;
};
export type WorkRow = {
  id: string;
  state: WorkState;
  goal: string;
  editVersion: number;
  error?: string;
  created_at?: string;
};
export type MessageRow = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  workItemId?: string;
  createdAt?: string;
  resources?: AgentResource[];
};
export type OntologyProposal = {
  kind?: 'ontology';
  id: string;
  artifactId: string;
  expectedVersion: number;
  content: Ontology;
  hash: string;
  summary: string;
  state: string;
  receipt?: { artifactId: string; revisionId: string };
};
export type ProcessProposal = Omit<OntologyProposal, 'kind' | 'content'> & {
  kind: 'process';
  content: ProcessDocument;
};
export type Proposal = OntologyProposal | ProcessProposal;
export type WorkDetail = WorkRow & {
  memoryProfile?: boolean;
  messages?: MessageRow[];
  sessionId: string;
  interaction: AgentInteraction | null;
  approval: unknown;
  tasks: { id: string; title: string; workId: string; state: WorkState; response?: string }[];
  activity: { id: string; kind: string; summary: string; detail: Record<string, unknown>; createdAt: string }[];
  proposals: Proposal[];
  usage: { tokens: number; duration: number };
};
export type SessionDetail = {
  contextUploads?: UploadedContext[];
  session: SessionRow;
  messages: MessageRow[];
  workItems: WorkRow[];
};

/** The catalog's form uses scalar fields. Expand a multi-choice question into named checkboxes. */
export function questionFields(interaction: AgentInteraction) {
  type Field = {
    name: string;
    label: string;
    type: 'text' | 'number' | 'boolean' | 'select';
    required?: boolean;
    placeholder?: string;
    options?: { value: string; label: string }[];
  };
  return interaction.fields.flatMap<Field>((field, fieldIndex) =>
    field.type === 'multiselect'
      ? field.options!.map((option, index) => ({
          name: `field_${fieldIndex}_option_${index}`,
          label: `${field.label} · ${option.label}`,
          type: 'boolean' as const,
        }))
      : [
          {
            name: `field_${fieldIndex}`,
            label: field.label,
            type: field.type,
            required: field.required,
            placeholder: field.hint,
            options: field.options?.map((option) => ({ value: option.id, label: option.label })),
          },
        ],
  );
}
export function questionResponse(interaction: AgentInteraction, values: Record<string, unknown>): InteractionResponse {
  const response: InteractionResponse = { interactionId: interaction.id, values: {} };
  for (const [fieldIndex, field] of interaction.fields.entries()) {
    if (field.type === 'multiselect')
      response.values[field.id] = field
        .options!.filter((_, index) => values[`field_${fieldIndex}_option_${index}`] === true)
        .map((option) => option.id);
    else if (values[`field_${fieldIndex}`] !== undefined)
      response.values[field.id] = values[`field_${fieldIndex}`] as InteractionResponse['values'][string];
  }
  const errors = interactionErrors(interaction, response);
  if (Object.keys(errors).length)
    throw new Error(
      Object.entries(errors)
        .map(([field, message]) => `${field}: ${message}`)
        .join(' '),
    );
  return response;
}
