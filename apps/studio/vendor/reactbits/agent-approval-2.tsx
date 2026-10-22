'use client';
/** Adapted from @reactbits-pro/agent-approval-2. The host owns review and approval authority. */
import type { ReactNode } from 'react';
export function AgentApproval2({
  title,
  summary,
  state,
  children,
  actions,
}: {
  title: string;
  summary: ReactNode;
  state: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rb-approval-card" data-registry-component="agent-approval-2">
      <header>
        <strong>{title}</strong>
        <span>{state}</span>
      </header>
      <div className="rb-approval-content">
        {summary}
        {children}
      </div>
      {actions && <footer>{actions}</footer>}
    </section>
  );
}
