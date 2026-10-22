'use client';
/** Adapted from @reactbits-pro/agent-activity-2: controlled timeline, without demo phases/timings. */
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/base/buttons/button';
import { ChevronRight, Check, WarningIcon } from '@/components/fa-icons';
export function AgentActivity2({
  entries,
  renderDetail,
}: {
  entries: readonly { id: string; summary: string; kind: string; status?: 'done' | 'running' | 'error' }[];
  renderDetail: (id: string) => ReactNode;
}) {
  const uid = useId();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <ol className="rb-activity-timeline" data-registry-component="agent-activity-2">
      {entries.map((phase) => (
        <li key={phase.id} data-status={phase.status ?? 'done'}>
          <Button
            color="tertiary"
            className="rb-activity-row"
            aria-expanded={!!open[phase.id]}
            aria-controls={`${uid}-${phase.id}`}
            onPress={() => setOpen((prev) => ({ ...prev, [phase.id]: !prev[phase.id] }))}
          >
            {phase.status === 'running' ? (
              <span className="sp-agent-progress-indicator" aria-hidden="true" />
            ) : phase.status === 'error' ? (
              <WarningIcon aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <Check aria-hidden="true" className="size-4 shrink-0" />
            )}
            <span className="rb-activity-label">{phase.summary}</span>
            <span className="rb-activity-kind">
              {phase.kind === 'model'
                ? 'Reasoning'
                : phase.kind === 'tool'
                  ? 'Tool call'
                  : phase.kind.replaceAll('_', ' ')}
            </span>
            <ChevronRight aria-hidden="true" className={`size-4 shrink-0 ${open[phase.id] ? 'rotate-90' : ''}`} />
          </Button>
          {open[phase.id] && (
            <div id={`${uid}-${phase.id}`} className="rb-activity-detail">
              {renderDetail(phase.id)}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
