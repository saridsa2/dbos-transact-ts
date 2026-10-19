'use client';
import { useState } from 'react';
import type { ValueSchema } from '@/lib/authoring/contracts';
import { ControlButton } from '@/components/control/controls';
import { ChevronDown, ChevronRight, ArrowRightIcon } from '@/components/fa-icons';
import { shapeMismatch } from '@/lib/authoring/editor-shapes';
import { useMapping } from './mapping-context';
export function SchemaTree({
  schema,
  path,
  label,
  selectable = true,
  depth = 0,
}: {
  schema: ValueSchema;
  path: string;
  label: string;
  selectable?: boolean;
  depth?: number;
}) {
  const { target, requestInsert } = useMapping();
  const [expanded, setExpanded] = useState(depth === 0);
  const properties = Object.entries((schema.properties ?? {}) as Record<string, ValueSchema>);
  const mismatch = shapeMismatch(target?.schema, schema);
  return (
    <div className="nc-tree-node">
      <div className="nc-tree-row">
        {properties.length > 0 && (
          <ControlButton
            iconLeading={expanded ? ChevronDown : ChevronRight}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          />
        )}
        <strong>{label}</strong>
        {Boolean(schema.type) && (
          <small>
            {schema.type === 'array'
              ? 'List'
              : schema.type === 'object'
                ? `${properties.length} fields`
                : schema.type === 'integer'
                  ? 'Number'
                  : String(schema.type)}
          </small>
        )}
        {selectable && target && (
          <ControlButton
            iconLeading={ArrowRightIcon}
            disabled={!!mismatch}
            aria-label={`Use ${label}${mismatch ? `: ${mismatch}` : ''}`}
            onClick={() => requestInsert(path)}
          >
            Use value
          </ControlButton>
        )}
      </div>
      {expanded && properties.length > 0 && (
        <div className="nc-tree-children">
          {properties.map(([key, value]) => (
            <SchemaTree
              key={key}
              schema={value}
              path={`${path}[${JSON.stringify(key)}]`}
              label={key}
              selectable={selectable}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
      {!schema.type && properties.length === 0 && (
        <small>Field structure is not declared. You can reference the whole value.</small>
      )}
    </div>
  );
}
