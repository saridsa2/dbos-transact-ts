'use client';
import { useMapping } from './mapping-context';
import { assertValue } from '@/lib/authoring/contracts';
import { useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Tooltip } from '@/components/base/tooltip/tooltip';
import { ChevronRight, ChevronDown, Copy01, ArrowRightIcon } from '@/components/fa-icons';
export function DataTree({
  value,
  path = '$input',
  label = 'input',
  depth = 0,
  mappable = false,
  labels,
}: {
  value: unknown;
  path?: string;
  label?: string;
  depth?: number;
  mappable?: boolean;
  labels?: Record<string, string>;
}) {
  const mapping = useMapping();
  let incompatible = '';
  try {
    if (mapping.target?.schema) assertValue(mapping.target.schema, value, 'Destination');
  } catch (err) {
    incompatible = err instanceof Error ? err.message : 'Incompatible type';
  }
  const [expanded, setExpanded] = useState(depth < 2);
  const [copyStatus, setCopyStatus] = useState('');
  const [limit, setLimit] = useState(30);
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const composite = value !== null && typeof value === 'object';
  const entries = composite ? Object.entries(value as object) : [];
  return (
    <div className="nc-tree-node">
      <div className="nc-tree-row">
        {composite ? (
          <Button
            color="tertiary"
            size="xs"
            iconLeading={expanded ? ChevronDown : ChevronRight}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${path}`}
            aria-expanded={expanded}
            onPress={() => setExpanded(!expanded)}
          />
        ) : (
          <span className="nc-tree-indent" />
        )}
        <strong>{label}</strong>
        <span className="nc-type">
          {type}
          {composite ? ` · ${entries.length}` : ''}
        </span>
        {mappable && mapping.target && (
          <Tooltip title={incompatible || `Insert into ${mapping.target.label}`}>
            <Button
              color="tertiary"
              size="xs"
              iconLeading={Copy01}
              isDisabled={!!incompatible}
              aria-label={`Insert mapping ${path}`}
              onPress={() => mapping.requestInsert(path)}
            />
          </Tooltip>
        )}
        <Tooltip title={`Copy ${path}`}>
          <Button
            color="tertiary"
            size="xs"
            iconLeading={Copy01}
            aria-label={`Copy path ${path}`}
            onPress={() =>
              void navigator.clipboard.writeText(path).then(
                () => setCopyStatus('Path copied'),
                () => setCopyStatus('Could not copy path'),
              )
            }
          />
        </Tooltip>
      </div>
      {!composite && (
        <div className="nc-tree-value">
          {value === undefined ? 'Unavailable' : typeof value === 'string' ? value : JSON.stringify(value)}
        </div>
      )}
      {copyStatus && <small role="status">{copyStatus}</small>}
      {composite && expanded && (
        <div className="nc-tree-children">
          {entries.slice(0, limit).map(([key, v]) => (
            <DataTree
              key={key}
              label={Array.isArray(value) ? `[${key}]` : (labels?.[key] ?? key)}
              path={`${path}[${Array.isArray(value) ? key : JSON.stringify(key)}]`}
              value={v}
              depth={depth + 1}
              mappable={mappable}
            />
          ))}
          {entries.length > limit && (
            <Button color="secondary" onPress={() => setLimit(limit + 30)}>
              Show next {Math.min(30, entries.length - limit)} items
            </Button>
          )}
          {!entries.length && <small>Empty {type}</small>}
        </div>
      )}
    </div>
  );
}
