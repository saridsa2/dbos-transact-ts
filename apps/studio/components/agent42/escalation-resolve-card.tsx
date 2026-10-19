'use client';
// The editor action surface is retained. StackProc's SaaS password/e-signature
// form is replaced with an explicit local-development approval form.
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { EscalationSummary, FlowRunStatus } from '@/lib/flows/types';
export type EscalationAction = 'approve' | 'reject' | 'done';
export type ResolveResult = { escalation: EscalationSummary; run: { id: string; status: FlowRunStatus } };
export type ResolveOutcome =
  | { ok: true; result: ResolveResult }
  | { ok: false; reason: 'wrong-password' | 'already-resolved' | 'gone' | 'error'; message?: string };
export function useResolveEscalation() {
  const [resolving, setResolving] = useState<string | null>(null);
  const resolve = useCallback(
    async (
      escalation: EscalationSummary,
      action: EscalationAction,
      fields: { note: string; password: string },
    ): Promise<ResolveOutcome> => {
      setResolving(escalation.id);
      try {
        const response = await fetch(`/api/escalations/${escalation.id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, note: fields.note }),
        });
        const body = await response.json();
        if (response.status === 409) return { ok: false, reason: 'already-resolved' };
        if (!response.ok) return { ok: false, reason: 'error', message: body.error };
        return { ok: true, result: body };
      } catch (error) {
        return { ok: false, reason: 'error', message: error instanceof Error ? error.message : 'Decision failed.' };
      } finally {
        setResolving(null);
      }
    },
    [],
  );
  return { resolve, resolving };
}
export function EscalationResolveForm({
  escalation,
  note,
  onNoteChange,
  onResolve,
  resolving,
}: {
  escalation: EscalationSummary;
  note: string;
  onNoteChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onResolve: (action: EscalationAction) => void;
  password: string;
  resolving: boolean;
  signerName: string;
}) {
  return (
    <div className="space-y-4 p-5">
      <p className="text-sm text-slate-600">{escalation.instruction}</p>
      <p className="text-xs text-slate-500">Local development decision</p>
      <label className="block text-sm">
        Note
        <Textarea
          aria-label="Decision note"
          className="mt-2"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button disabled={resolving} onClick={() => onResolve('approve')}>
          Approve
        </Button>
        <Button disabled={resolving} variant="outline" onClick={() => onResolve('reject')}>
          Reject
        </Button>
      </div>
    </div>
  );
}
