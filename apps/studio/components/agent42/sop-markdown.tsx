'use client';

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * Renders one SOP section (a paragraph of markdown: a heading line followed by
 * body) as formatted markdown. When the section compiled to a flow node,
 * `flowHref` is set and the heading becomes a link that jumps into the flow
 * focused on that node — the SOP's provenance made navigable.
 */
export function SopMarkdown({ text, flowHref, nodeName }: { text: string; flowHref?: string; nodeName?: string }) {
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    const sizeClass = level <= 1 ? 'text-base' : level <= 3 ? 'text-sm' : 'text-xs';
    const base = cn('font-semibold text-[#171717]', sizeClass);
    function HeadingRenderer({ children }: { children?: ReactNode }) {
      if (!flowHref) {
        return <span className={base}>{children}</span>;
      }
      return (
        <Link
          className={cn(
            base,
            'group inline-flex items-baseline gap-1 rounded text-[#4b2bbf] transition hover:text-[#3a0c4f] hover:underline',
          )}
          href={flowHref}
          title={nodeName ? `Open "${nodeName}" in the flow` : 'Open in the flow'}
        >
          {children}
          <ArrowUpRight className="size-3.5 shrink-0 translate-y-0.5 text-[#7c3aed] opacity-60 transition group-hover:opacity-100" />
        </Link>
      );
    }
    return HeadingRenderer;
  };

  const components: Components = {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
  };

  return (
    <div className="sop-markdown">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
