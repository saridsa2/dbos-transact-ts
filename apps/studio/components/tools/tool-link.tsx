'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/base/buttons/button';
import { builtinToolHref } from '@/lib/agent/tool-catalog';

/** Tool references navigate to inspection; clicking never executes or enables a tool. */
export function ToolLink({ name, toolId, children }: { name: string; toolId?: string; children?: ReactNode }) {
  const href = toolId ? `/tools?id=${encodeURIComponent(toolId)}` : builtinToolHref(name);
  if (!href) return <code>{children ?? name}</code>;
  return (
    <Button href={href} color="link-color" size="sm" className="sp-tool-link" aria-label={`Open tool ${name}`}>
      {children ?? name}
    </Button>
  );
}
