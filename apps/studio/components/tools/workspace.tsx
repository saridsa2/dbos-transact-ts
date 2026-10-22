'use client';
import { BuiltinToolDetail } from './builtin-tool-detail';
import { toolNames } from '@/lib/agent/contracts';
import { toolLabel } from '@/lib/agent/presentation';
import { builtinToolDescriptions, builtinToolHref } from '@/lib/agent/tool-catalog';
import { ToolLink } from './tool-link';
import { ToolFileList } from './file-list';
import { useUnsavedChanges } from '@/components/control/unsaved-changes';
import { ToolEditorLayout, ToolPanelToggle, useToolEditorPanels } from './editor-layout';
import { FullscreenWorkbench } from '@/components/workspace/fullscreen-workbench';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useControl, controlRequest } from '@/components/control/access';
import { WorkArea, TableViewport, RecordAction, EmptyState } from '@/components/control/work-area';
import { ControlButton, ControlInput, ControlModal, ControlSelect } from '@/components/control/controls';
import { FilePlus01 } from '@untitledui/icons';
import { InputFieldModal } from '@/components/application/modals/input-field-modal';
import { Table } from '@/components/application/table/table';
import { Tabs } from '@/components/application/tabs/tabs';
import { ToolFileEditor } from './file-editor';
import { Plus, Edit01, Trash01, DownloadIcon, Eye } from '@/components/fa-icons';
import { starterFiles, fileMapSchema, type ToolFiles, type ToolHead } from '@/lib/tools/contracts';
import { useWorkspaceRefresh } from '@/hooks/use-workspace-events';
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
export function ToolsWorkspace() {
  const { session } = useControl(),
    router = useRouter(),
    search = useSearchParams(),
    selected = search.get('id'),
    authorize = search.get('authorize');
  const editable = session.workspace?.role !== 'viewer',
    manager = ['owner', 'admin'].includes(session.workspace?.role ?? '');
  const [items, setItems] = useState<ToolHead[]>([]),
    [detail, setDetail] = useState<ToolHead | null>(null),
    [files, setFiles] = useState<ToolFiles>({}),
    [file, setFile] = useState('src/index.ts'),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all');
  const [testProgress, setTestProgress] = useState(''),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [result, setResult] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [panel, setPanel] = useState('problems'),
    [create, setCreate] = useState(false),
    [name, setName] = useState(''),
    [archive, setArchive] = useState<ToolHead | null>(null),
    [newFile, setNewFile] = useState(false),
    [fileError, setFileError] = useState(''),
    [path, setPath] = useState('src/helpers.ts');
  const panels = useToolEditorPanels(busy === 'Testing');
  const importFile = useRef<HTMLInputElement>(null),
    abort = useRef<AbortController | null>(null);
  const guardNavigation = useUnsavedChanges(dirty);
  const refresh = useCallback(async () => {
    try {
      setItems((await controlRequest('/api/tools')).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useWorkspaceRefresh(refresh);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    setError('');
    void controlRequest(`/api/tools/${selected}`)
      .then((d) => {
        if (alive) {
          setDetail(d.tool);
          setFiles(d.files);
          setDirty(false);
          setResult(null);
          setFile('src/index.ts');
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [selected]);
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function loadHistory() {
    if (detail) setHistory(await controlRequest(`/api/tools/${detail.id}/history`));
  }
  function change(value: string) {
    setFiles((f) => ({ ...f, [file]: value }));
    setDirty(true);
    setResult(null);
  }
  async function save() {
    const d = await controlRequest('/api/tools/uploads', {
      id: detail!.id,
      files,
      expectedVersion: detail!.editVersion,
      commandKey: crypto.randomUUID(),
    });
    setDetail(d.tool);
    setDirty(false);
    await refresh();
  }
  async function test() {
    const controller = new AbortController();
    abort.current = controller;
    setPanel('output');
    try {
      setResult(null);
      setTestProgress('Compiling saved snapshot…');
      const response = await fetch(`/api/tools/${detail!.id}/tests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: pretty({ hash: detail!.hash }),
        signal: controller.signal,
      });
      if (!response.ok) throw Error((await response.json()).error);
      const reader = response.body!.getReader();
      let pending = '',
        final = false;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let index;
        while ((index = pending.indexOf('\n\n')) >= 0) {
          const message = pending.slice(0, index);
          pending = pending.slice(index + 2);
          if (!message.startsWith('data: ')) continue;
          const event = JSON.parse(message.slice(6));
          if (event.phase === 'compiling') setTestProgress('Compiling saved snapshot…');
          if (event.phase === 'testing') setTestProgress(`Running fixture: ${event.fixture}`);
          if (event.phase === 'failed') throw Error(event.error);
          if (event.phase === 'completed') {
            final = true;
            setResult(event.result);
            if (event.result.diagnostics || event.result.error) setPanel('problems');
          }
        }
      }
      if (!final)
        throw Error('Connection ended before the test receipt arrived. Check Test history before running again.');
      await loadHistory();
    } finally {
      abort.current = null;
      setTestProgress('');
    }
  }

  function download(d: ToolHead) {
    const link = document.createElement('a');
    link.href = `/api/tools/${d.id}/export`;
    link.download = `tool-${d.id}.sptool`;
    link.click();
  }

  let manifest: any = {};
  try {
    manifest = JSON.parse(files['tool.json'] ?? '{}');
  } catch {}
  const schemaSummary = (() => {
    try {
      return JSON.parse(files[manifest.inputSchema] ?? '{}').properties ?? {};
    } catch {
      return {};
    }
  })();
  const completions = [
    { label: 'ctx.log.info', info: 'Write a bounded log entry' },
    { label: 'ctx.invocationId', info: 'Current invocation identity' },
    ...Object.keys(schemaSummary).map((k) => ({ label: `input.${k}`, info: 'Declared input field' })),
  ];
  const allowed = items.filter(
    (t) =>
      t.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all' ||
        filter === 'workspace' ||
        (filter === 'enabled' && t.enabledRevision !== null) ||
        (filter === 'draft' && t.enabledRevision === null)),
  );
  const builtin = ['all', 'builtin'].includes(filter)
    ? toolNames.filter((name) =>
        `${name} ${toolLabel(name)} ${builtinToolDescriptions[name]}`.toLowerCase().includes(query.toLowerCase()),
      )
    : [];
  if (search.get('capability')) return <BuiltinToolDetail name={search.get('capability')!} />;
  const Frame = selected ? FullscreenWorkbench : WorkArea;
  return (
    <>
      <Frame
        {...(selected
          ? {
              backHref: '/tools',
              onBack: () => {
                guardNavigation(() => router.push('/tools'));
              },
            }
          : {})}
        title={detail ? detail.name : 'Tools'}
        description={
          detail
            ? `${file} · ${dirty ? 'Unsaved changes' : 'Saved draft'} · v${detail.editVersion}${detail.publishedRevision ? ` · published r${detail.publishedRevision}` : ''}`
            : 'Inspect built-in agent capabilities and manage workspace code tools.'
        }
        actions={
          detail ? (
            <>
              <ControlButton disabled={!editable || !!busy || !dirty} onPress={() => void action('Saving', save)}>
                Save draft
              </ControlButton>
              <ControlButton disabled={!editable || !!busy || dirty} onPress={() => void action('Testing', test)}>
                Test fixtures
              </ControlButton>
              <ControlButton
                disabled={!manager || !!busy || dirty || !result?.success || result.hash !== detail.hash}
                onPress={() =>
                  void action('Publishing', async () => {
                    await controlRequest(`/api/tools/${detail.id}/releases`, {
                      hash: detail.hash,
                      version: manifest.version,
                      expectedVersion: detail.editVersion,
                      commandKey: crypto.randomUUID(),
                    });
                    setDetail((await controlRequest(`/api/tools/${detail.id}`)).tool);
                    await loadHistory();
                  })
                }
              >
                Publish
              </ControlButton>
              <ControlButton
                disabled={!manager || !!busy || !detail.publishedRevision || dirty}
                onPress={() =>
                  void action('Updating availability', async () => {
                    const d = await controlRequest(`/api/tools/${detail.id}/bindings`, {
                      revision: detail.enabledRevision === detail.publishedRevision ? null : detail.publishedRevision,
                      expectedVersion: detail.editVersion,
                      commandKey: crypto.randomUUID(),
                    });
                    setDetail(d.tool);
                  })
                }
              >
                {detail.enabledRevision !== null && detail.enabledRevision === detail.publishedRevision
                  ? 'Disable'
                  : detail.enabledRevision
                    ? 'Update enabled revision'
                    : 'Enable'}
              </ControlButton>
            </>
          ) : (
            <>
              <ControlInput
                aria-label="Search tools"
                placeholder="Search tools"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ControlSelect aria-label="Tool availability" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All tools</option>
                <option value="builtin">Built-in tools</option>
                <option value="workspace">Workspace tools</option>
                <option value="enabled">Enabled</option>
                <option value="draft">Not enabled</option>
              </ControlSelect>
              {editable && (
                <>
                  <ControlButton onPress={() => importFile.current?.click()}>Import package</ControlButton>
                  <ControlButton iconLeading={Plus} onPress={() => setCreate(true)}>
                    Create tool
                  </ControlButton>
                </>
              )}
            </>
          )
        }
        status={
          (error || busy) && (
            <div role={error ? 'alert' : 'status'} className={error ? 'cp-error' : 'tool-status'}>
              {error || `${busy}…`}
              {busy === 'Testing' && <ControlButton onPress={() => abort.current?.abort()}>Stop</ControlButton>}
            </div>
          )
        }
      >
        {selected && !detail ? (
          <EmptyState title={error ? 'Could not open tool' : 'Loading tool…'} />
        ) : detail ? (
          <ToolEditorLayout
            panels={panels}
            files={
              <aside className="tool-file-explorer">
                <div className="tool-panel-heading">
                  <span>Files</span>
                  <div className="tool-panel-header-actions">
                    {editable && (
                      <RecordAction
                        label="New file"
                        icon={FilePlus01}
                        onPress={() => {
                          setFileError('');
                          setNewFile(true);
                        }}
                      />
                    )}
                    <ToolPanelToggle panels={panels} name="files" />
                  </div>
                </div>
                <ToolFileList paths={Object.keys(files)} selected={file} onSelect={setFile} />
                <p>Source, schemas and fixtures travel together with the CLI.</p>
              </aside>
            }
            source={
              <>
                <ToolFileEditor
                  path={file}
                  key={file}
                  value={files[file] ?? ''}
                  onChange={change}
                  language={
                    file.endsWith('.md')
                      ? 'text'
                      : file.endsWith('.json')
                        ? 'json'
                        : file.endsWith('.ts')
                          ? 'typescript'
                          : 'javascript'
                  }
                  readOnly={!editable || !!busy}
                  ariaLabel={`Edit ${file}`}
                  completions={completions}
                  completionsOnly
                />
              </>
            }
            results={
              <Tabs selectedKey={panel} onSelectionChange={(k) => setPanel(String(k))} className="tool-test-panel">
                <div className="tool-tab-header">
                  <Tabs.List
                    aria-label="Tool tests"
                    type="underline"
                    items={[
                      { id: 'problems', label: 'Problems' },
                      { id: 'output', label: 'Output' },
                      { id: 'logs', label: 'Logs' },
                      { id: 'history', label: 'Test history' },
                    ]}
                  >
                    {(i) => <Tabs.Item id={i.id}>{i.label}</Tabs.Item>}
                  </Tabs.List>
                  <ToolPanelToggle panels={panels} name="results" />
                </div>
                <Tabs.Panel key={panel} id={panel} className="tool-test-body">
                  {panel === 'problems' ? (
                    result?.diagnostics?.length ? (
                      <ul>
                        {result.diagnostics.map((d: any, i: number) => (
                          <li key={i}>
                            <button className="tool-diagnostic" onClick={() => setFile(d.file)}>
                              {d.file}:{d.line ?? 1}:{d.column ?? 1}
                            </button>{' '}
                            {d.message}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        {result?.error ??
                          (dirty
                            ? 'Save this draft, then test its exact contents.'
                            : 'No recorded compilation problems. Test fixtures to validate this snapshot.')}
                      </p>
                    )
                  ) : panel === 'output' ? (
                    <>
                      <p>
                        {busy === 'Testing'
                          ? testProgress
                          : result
                            ? result.success
                              ? 'All fixtures passed'
                              : 'Tests failed'
                            : 'Run fixtures to see output.'}
                      </p>
                      {result?.results && <pre>{pretty(result.results.map(({ logs, ...r }: any) => r))}</pre>}
                    </>
                  ) : panel === 'logs' ? (
                    <pre>
                      {result?.results
                        ?.map((r: any) => `${r.name}\n${r.logs?.join('\n') ?? 'No logs.'}`)
                        .join('\n\n') ?? 'No recorded logs.'}
                    </pre>
                  ) : (
                    <>
                      <ControlButton onPress={() => void action('Loading history', loadHistory)}>
                        Refresh history
                      </ControlButton>
                      <pre>{history ? pretty(history.tests) : 'Load saved test receipts.'}</pre>
                    </>
                  )}
                </Tabs.Panel>
              </Tabs>
            }
          />
        ) : allowed.length || builtin.length ? (
          <TableViewport label="Workspace tools">
            <Table aria-label="Workspace tools">
              <Table.Header>
                <Table.Head isRowHeader>Name</Table.Head>
                <Table.Head>Type</Table.Head>
                <Table.Head>Draft</Table.Head>
                <Table.Head>Published</Table.Head>
                <Table.Head>Availability</Table.Head>
                <Table.Head>Actions</Table.Head>
              </Table.Header>
              <Table.Body>
                {allowed.map((t) => (
                  <Table.Row id={t.id} key={t.id}>
                    <Table.Cell>{t.name}</Table.Cell>
                    <Table.Cell>Workspace code</Table.Cell>
                    <Table.Cell>v{t.editVersion}</Table.Cell>
                    <Table.Cell>{t.publishedRevision ? `r${t.publishedRevision}` : '—'}</Table.Cell>
                    <Table.Cell>{t.enabledRevision ? `Enabled r${t.enabledRevision}` : 'Not enabled'}</Table.Cell>
                    <Table.Cell>
                      <div className="sp-row-actions">
                        <RecordAction label={`Open ${t.name}`} icon={Edit01} href={`/tools?id=${t.id}`} />
                        <RecordAction
                          label={`Download ${t.name}`}
                          icon={DownloadIcon}
                          onPress={() =>
                            void action('Downloading', async () => {
                              const d = await controlRequest(`/api/tools/${t.id}`);
                              download(t);
                            })
                          }
                        />
                        {manager && (
                          <RecordAction label={`Archive ${t.name}`} icon={Trash01} onPress={() => setArchive(t)} />
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
                {builtin.map((name) => (
                  <Table.Row id={`builtin:${name}`} key={`builtin:${name}`}>
                    <Table.Cell>
                      <div className="tool-catalog-name">
                        <ToolLink name={name}>{toolLabel(name)}</ToolLink>
                        <code>{name}</code>
                      </div>
                    </Table.Cell>
                    <Table.Cell>Built-in</Table.Cell>
                    <Table.Cell>—</Table.Cell>
                    <Table.Cell>—</Table.Cell>
                    <Table.Cell>Agent policy</Table.Cell>
                    <Table.Cell>
                      <RecordAction label={`Inspect ${name}`} icon={Eye} href={builtinToolHref(name)} />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </TableViewport>
        ) : (
          <EmptyState title={query || filter !== 'all' ? 'No matching tools' : 'No tools yet'}>
            Create a typed code tool or import a developer package.
          </EmptyState>
        )}
      </Frame>
      <input
        ref={importFile}
        hidden
        type="file"
        accept=".json,.sptool"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          void action('Importing', async () => {
            if (f.size > 1100000) throw Error('Package exceeds 1 MiB.');
            let incoming: ToolFiles;
            if (f.name.endsWith('.sptool')) {
              const bytes = new Uint8Array(await f.arrayBuffer());
              let binary = '';
              for (const byte of bytes) binary += String.fromCharCode(byte);
              incoming = fileMapSchema.parse(
                (await controlRequest('/api/tools/packages/decode', { archive: btoa(binary) })).files,
              );
            } else {
              incoming = fileMapSchema.parse(JSON.parse(await f.text()).files);
            }
            const m = JSON.parse(incoming['tool.json']);
            await controlRequest('/api/tools/uploads', {
              id: m.id,
              files: incoming,
              expectedVersion: 0,
              commandKey: crypto.randomUUID(),
            });
            await refresh();
            router.push(`/tools?id=${m.id}`);
          });
          e.target.value = '';
        }}
      />
      {create && (
        <ControlModal label="Create tool" onClose={() => setCreate(false)}>
          <div className="tool-dialog">
            <h2>Create tool</h2>
            <label>
              Tool name
              <ControlInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Sum values" />
            </label>
            <p>Start with a working TypeScript tool, schemas and a fixture.</p>
            <ControlButton
              disabled={!!busy}
              onPress={() =>
                void action('Creating', async () => {
                  const id = crypto.randomUUID(),
                    f = starterFiles(id),
                    m = JSON.parse(f['tool.json']);
                  m.name = name.trim() || m.name;
                  f['tool.json'] = pretty(m);
                  await controlRequest('/api/tools/uploads', {
                    id,
                    files: f,
                    expectedVersion: 0,
                    commandKey: crypto.randomUUID(),
                  });
                  setCreate(false);
                  router.push(`/tools?id=${id}`);
                })
              }
            >
              Create
            </ControlButton>
            <ControlButton onPress={() => setCreate(false)}>Cancel</ControlButton>
            {error && <p role="alert">{error}</p>}
          </div>
        </ControlModal>
      )}
      {newFile && (
        <InputFieldModal
          value={path}
          error={fileError}
          onClose={() => setNewFile(false)}
          onChange={(value) => {
            setPath(value);
            setFileError('');
          }}
          onCreate={() => {
            const target = path.trim();
            if (target in files) {
              setFileError('A file with this path already exists.');
              return;
            }
            const checked = fileMapSchema.safeParse({ ...files, [target]: '' });
            if (!checked.success) {
              setFileError(checked.error.issues.map((issue) => issue.message).join(' '));
              return;
            }
            setFiles((f) => ({ ...f, [target]: '' }));
            setFile(target);
            setDirty(true);
            setNewFile(false);
          }}
        />
      )}
      {archive && (
        <ControlModal label={`Archive ${archive.name}`} onClose={() => setArchive(null)}>
          <div className="tool-dialog">
            <h2>Archive {archive.name}?</h2>
            <p>This disables new invocations. Source, published versions and execution history are retained.</p>
            <ControlButton
              disabled={!!busy}
              onPress={() =>
                void action('Archiving', async () => {
                  await controlRequest(`/api/tools/${archive.id}/archive`, { expectedVersion: archive.editVersion });
                  setArchive(null);
                  await refresh();
                })
              }
            >
              Archive
            </ControlButton>
            <ControlButton onPress={() => setArchive(null)}>Cancel</ControlButton>
            {error && <p role="alert">{error}</p>}
          </div>
        </ControlModal>
      )}
      {authorize && (
        <ControlModal label="Approve developer access" onClose={() => router.replace('/tools')}>
          <div className="tool-dialog">
            <h2>Developer CLI access</h2>
            <p>Approve only a code shown by your own CLI.</p>
            <strong>{authorize}</strong>
            <p>
              Allow tool authoring in {session.workspace?.name} for one hour. Your current workspace role still applies.
              You can revoke this access with CLI logout.
            </p>
            <ControlButton
              disabled={!!busy || !editable}
              onPress={() =>
                void action('Approving', async () => {
                  await controlRequest('/api/tools/auth/approve', { code: authorize });
                  router.replace('/tools');
                })
              }
            >
              Approve developer access
            </ControlButton>
            <ControlButton onPress={() => router.replace('/tools')}>Cancel</ControlButton>
            {error && <p role="alert">{error}</p>}
          </div>
        </ControlModal>
      )}
    </>
  );
}
