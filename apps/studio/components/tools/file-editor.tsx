'use client';
import { useState, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeEditor } from '@/components/flows/code-editor';
import { Tabs } from '@/components/application/tabs/tabs';

/** Markdown files share a rendered preview and the existing source editor. */
export function ToolFileEditor({ path, ...props }: ComponentProps<typeof CodeEditor> & { path: string }) {
  const [view, setView] = useState('preview');
  if (!path.endsWith('.md')) return <CodeEditor {...props} />;
  return (
    <Tabs selectedKey={view} onSelectionChange={(key) => setView(String(key))} className="tool-markdown-editor">
      <Tabs.List
        aria-label="Markdown file view"
        type="underline"
        items={[
          { id: 'preview', label: 'Preview' },
          { id: 'markdown', label: 'Markdown' },
        ]}
      >
        {(item) => <Tabs.Item id={item.id}>{item.label}</Tabs.Item>}
      </Tabs.List>
      <Tabs.Panel
        id={view}
        key={view}
        className={view === 'preview' ? 'tool-markdown-preview' : 'tool-markdown-source'}
      >
        {view === 'preview' ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.value}</ReactMarkdown>
        ) : (
          <CodeEditor {...props} />
        )}
      </Tabs.Panel>
    </Tabs>
  );
}
