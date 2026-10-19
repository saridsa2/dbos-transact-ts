'use client';

import { useLingui } from '@/lib/i18n';
import { X } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  EscalationResolveForm,
  useResolveEscalation,
  type EscalationAction,
  type ResolveResult,
} from '@/components/agent42/escalation-resolve-card';
import type { NodeActionContext, NodeActionId } from '@/lib/flows/node-actions';
import type { FlowNodeData } from '@/lib/flows/types';

function msg(message: string) {
  return { id: message, message };
}

export type NodeActionSurfaceProps = {
  node: FlowNodeData;
  ctx: NodeActionContext;
  signerName?: string;
  workspaceSlug?: string;
  /** Where to anchor the pointed dialog relative to the node — same shape the
   * inspector panel uses so the surface points at its node with a caret. */
  placement: {
    left: number;
    top: number;
    side: 'left' | 'right';
    connectorY: number;
  };
  onClose: () => void;
  onResolved: (result: ResolveResult) => void;
  /** Re-sync open escalations when the server state changed underneath us
   * (already-resolved / gone) without a local resolve — so the now-closed
   * escalation drops off the canvas and its Resolve chip disappears instead of
   * re-failing on every click until a reload. */
  onStale: () => void;
};

function EscalationResolveSurface({
  node,
  ctx,
  signerName,
  workspaceSlug,
  placement,
  onClose,
  onResolved,
  onStale,
}: NodeActionSurfaceProps) {
  const { _ } = useLingui();
  const escalation = ctx.escalationsByNodeId[node.id];
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const { resolve, resolving } = useResolveEscalation();

  // Escape closes the dialog (matches the inspector panel's affordances).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!escalation) return null;

  async function submit(action: EscalationAction) {
    const outcome = await resolve(escalation, action, { note, password });
    if (outcome.ok) {
      toast.success(_(msg('Decision recorded — run resuming')), {
        action: workspaceSlug
          ? {
              label: _(msg('View in audit')),
              onClick: () => {
                window.location.href = `/dashboard/${workspaceSlug}/settings?tab=governance`;
              },
            }
          : undefined,
      });
      onResolved(outcome.result);
      onClose();
      return;
    }
    if (outcome.reason === 'wrong-password') {
      toast.error(_(msg('Incorrect password — not signed.')));
      return; // keep modal open for retry
    }
    if (outcome.reason === 'already-resolved') {
      toast.info(_(msg('Already resolved by someone else')));
    } else if (outcome.reason === 'gone') {
      toast.error(_(msg('This step is no longer waiting.')));
    } else {
      toast.error(outcome.message || _(msg("Couldn't resolve")));
    }
    // Re-sync to server truth: a closed escalation drops out of the map (chip
    // disappears); a still-open one after a transient error stays.
    onStale();
    onClose();
  }

  return (
    <aside
      className="inspector-node-dialog"
      data-inspector-side={placement.side}
      style={
        {
          '--inspector-connector-y': `${placement.connectorY}px`,
          left: placement.left,
          top: placement.top,
          width: 420,
        } as CSSProperties
      }
    >
      <div className="inspector-node-caret" />
      <div className="inspector-node-panel">
        <button aria-label={_(msg('Close'))} className="inspector-close" onClick={onClose} type="button">
          <X className="size-4" />
        </button>
        <div className="node-action-body">
          <h2 className="node-action-title">{escalation.nodeName}</h2>
          <EscalationResolveForm
            escalation={escalation}
            note={note}
            onNoteChange={setNote}
            onPasswordChange={setPassword}
            onResolve={submit}
            password={password}
            resolving={resolving === escalation.id}
            signerName={signerName ?? _(msg('you'))}
          />
        </div>
      </div>
    </aside>
  );
}

/** Surface registry: one entry per action id. */
export const NODE_ACTION_SURFACES: Record<NodeActionId, (props: NodeActionSurfaceProps) => React.ReactElement | null> =
  {
    'resolve-escalation': EscalationResolveSurface,
  };
