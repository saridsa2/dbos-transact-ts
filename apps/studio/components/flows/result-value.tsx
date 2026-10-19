'use client';
import { useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Tabs } from '@/components/application/tabs/tabs';
import { Table } from '@/components/application/table/table';
import { Copy01 } from '@/components/fa-icons';

function text(value: unknown, pretty = false): string {
  return JSON.stringify(value, null, pretty ? 2 : undefined) ?? String(value);
}
function ValueTree({ value, label, depth = 0 }: { value: unknown; label: string; depth?: number }) {
  const [limit, setLimit] = useState(30);
  if (!value || typeof value !== 'object')
    return (
      <div className="nc-result-leaf">
        <strong>{label}</strong>
        <code>{text(value)}</code>
      </div>
    );
  const entries = Object.entries(value);
  return (
    <details className="nc-result-branch" open={depth < 2}>
      <summary>
        {label} <span>{Array.isArray(value) ? `${entries.length} items` : `${entries.length} fields`}</span>
      </summary>
      {entries.slice(0, limit).map(([key, child]) => (
        <ValueTree key={key} label={Array.isArray(value) ? `[${key}]` : key} value={child} depth={depth + 1} />
      ))}
      {entries.length > limit && (
        <Button color="secondary" size="sm" onPress={() => setLimit(limit + 30)}>
          Show next 30
        </Button>
      )}
    </details>
  );
}
/** Result values have no mapping actions. Copy always copies the value itself. */
export function ResultValue({ value, label }: { value: unknown; label: string }) {
  const [copyStatus, setCopyStatus] = useState('');
  const [limit, setLimit] = useState(50);
  const structured =
    !!value &&
    typeof value === 'object' &&
    (!Array.isArray(value) || value.some((item) => item !== null && typeof item === 'object'));
  const records =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
      ? (value as Record<string, unknown>[])
      : null;
  const columns = records ? [...new Set(records.flatMap((row) => Object.keys(row)))] : [];
  const table = !!records && columns.length > 0 && columns.length <= 20;
  const [view, setView] = useState(table ? 'table' : 'tree');
  const activeView = view === 'table' && !table ? 'tree' : view;
  async function copy() {
    try {
      await navigator.clipboard.writeText(text(value, true));
      setCopyStatus('Value copied');
    } catch {
      setCopyStatus('Could not copy value');
    }
  }
  return (
    <section className="nc-result-value" aria-label={label}>
      <header>
        <h4>{label}</h4>
        <div>
          <Button
            color="tertiary"
            size="sm"
            iconLeading={Copy01}
            aria-label={`Copy ${label.toLowerCase()} value`}
            onPress={() => void copy()}
          >
            Copy value
          </Button>
          <span role="status">{copyStatus}</span>
        </div>
      </header>
      {!structured ? (
        <pre className="nc-result-json">
          {Array.isArray(value) ? `[${value.map((item) => text(item)).join(', ')}]` : text(value, true)}
        </pre>
      ) : (
        <Tabs selectedKey={activeView} onSelectionChange={(key) => setView(String(key))}>
          <Tabs.List aria-label={`${label} format`} orientation="horizontal" type="underline">
            {table && <Tabs.Item id="table">Table</Tabs.Item>}
            <Tabs.Item id="tree">Tree</Tabs.Item>
            <Tabs.Item id="json">JSON</Tabs.Item>
          </Tabs.List>
          <Tabs.Panel id={activeView}>
            {activeView === 'json' ? (
              <pre className="nc-result-json">{text(value, true)}</pre>
            ) : activeView === 'table' && records ? (
              <div className="nc-result-table">
                <Table aria-label={label}>
                  <Table.Header>
                    {columns.map((key, index) => (
                      <Table.Head key={key} id={key} isRowHeader={index === 0}>
                        {key || '(empty key)'}
                      </Table.Head>
                    ))}
                  </Table.Header>
                  <Table.Body>
                    {records.slice(0, limit).map((row, index) => (
                      <Table.Row key={index} id={index}>
                        {columns.map((key) => (
                          <Table.Cell key={key}>
                            <code>{Object.hasOwn(row, key) ? text(row[key]) : '—'}</code>
                          </Table.Cell>
                        ))}
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
                {records.length > limit && (
                  <Button color="secondary" onPress={() => setLimit(limit + 50)}>
                    Show next 50 rows
                  </Button>
                )}
              </div>
            ) : (
              <ValueTree value={value} label={label} />
            )}
          </Tabs.Panel>
        </Tabs>
      )}
    </section>
  );
}
export function ResultLogs({ logs }: { logs?: string[] }) {
  return logs?.length ? (
    <pre className="nc-result-console" aria-label="Execution logs">
      {logs.join('\n')}
    </pre>
  ) : (
    <p className="nc-empty">No logs were recorded.</p>
  );
}
