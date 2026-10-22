'use client';
import { useEffect, useState } from 'react';
import { FullscreenWorkbench } from '@/components/workspace/fullscreen-workbench';
import { Tabs } from '@/components/application/tabs/tabs';
import { ToolFileList } from './file-list';
import { controlRequest } from '@/components/control/access';
import { ToolFileEditor } from './file-editor';
import { ToolEditorLayout, ToolPanelToggle, useToolEditorPanels } from './editor-layout';
import { toolLabel } from '@/lib/agent/presentation';

type Source = {
  name: string;
  description: string;
  primary: string;
  entrypoint: string;
  hash: string;
  files: Record<string, string>;
};

/** The same editor composition as workspace tools, with no mutation or execution controls. */
export function BuiltinToolDetail({ name }: { name: string }) {
  const [source, setSource] = useState<Source>();
  const [file, setFile] = useState('');
  const [error, setError] = useState('');
  const [panel, setPanel] = useState('problems');
  const panels = useToolEditorPanels(false);
  useEffect(() => {
    let alive = true;
    setSource(undefined);
    setError('');
    void controlRequest(`/api/tools/builtins/${encodeURIComponent(name)}`)
      .then((value: Source) => {
        if (alive) {
          setSource(value);
          setFile(value.primary);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [name]);
  const files: Record<string, string> = source
    ? {
        ...source.files,
        'README.md': [
          `# ${toolLabel(name)}`,
          source.description,
          `Runtime entry point: ${source.entrypoint}`,
          'This built-in runs through the agent harness under the published capabilities and workspace policy. Installed source is read-only and shared modules may contain several handlers.',
          `Source snapshot SHA-256: ${source.hash}`,
        ].join('\n\n'),
      }
    : {};
  return (
    <FullscreenWorkbench
      title={toolLabel(name)}
      description={`${file || name} · Built-in · Read-only`}
      backHref="/tools"
    >
      {error ? (
        <p role="alert" className="cp-error">
          {error}
        </p>
      ) : !source ? (
        <p role="status">Loading tool implementation…</p>
      ) : (
        <ToolEditorLayout
          panels={panels}
          files={
            <aside className="tool-file-explorer">
              <div className="tool-panel-heading">
                <span>Files</span>
                <ToolPanelToggle panels={panels} name="files" />
              </div>
              <ToolFileList paths={Object.keys(files)} selected={file} onSelect={setFile} />
              <p>Installed implementation source. These shared server files can contain handlers for several tools.</p>
            </aside>
          }
          source={
            <ToolFileEditor
              path={file}
              key={`${name}:${file}`}
              value={files[file] ?? ''}
              onChange={() => {}}
              language={file.endsWith('.md') ? 'text' : file.endsWith('.json') ? 'json' : 'typescript'}
              readOnly
              ariaLabel={`Read-only ${file}`}
            />
          }
          results={
            <Tabs selectedKey={panel} onSelectionChange={(key) => setPanel(String(key))} className="tool-test-panel">
              <div className="tool-tab-header">
                <Tabs.List
                  aria-label="Tool results"
                  type="underline"
                  items={[
                    { id: 'problems', label: 'Problems' },
                    { id: 'output', label: 'Output' },
                    { id: 'logs', label: 'Logs' },
                    { id: 'history', label: 'Test history' },
                  ]}
                >
                  {(item) => <Tabs.Item id={item.id}>{item.label}</Tabs.Item>}
                </Tabs.List>
                <ToolPanelToggle panels={panels} name="results" />
              </div>
              <Tabs.Panel id={panel} key={panel} className="tool-test-body">
                <p>
                  {panel === 'problems'
                    ? 'No compilation diagnostics are collected for this installed built-in.'
                    : panel === 'output'
                      ? 'No execution selected. Review a tool call in its agent activity to see recorded output.'
                      : panel === 'logs'
                        ? 'No execution selected. Recorded tool logs are available in the originating activity.'
                        : 'Built-in tools have no workspace fixture history. Their implementation is tested with the server; this editor does not run those tests.'}
                </p>
              </Tabs.Panel>
            </Tabs>
          }
        />
      )}
    </FullscreenWorkbench>
  );
}
