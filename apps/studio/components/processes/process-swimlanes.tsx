'use client';
import type { PointerEventHandler, ReactNode } from 'react';
import { ControlButton } from '@/components/control/controls';
import { Plus, SettingsIcon } from '@/components/fa-icons';
import { type PoolRow } from '@/lib/processes/lanes';
import { processCanvasPool } from '@/lib/processes/canvas-layout';
import type { ProcessDocument } from '@/lib/processes/model';
/** Domain canvas rendering; all action controls use the shared Untitled UI buttons. */
export function ProcessSwimlanes({
  document,
  name,
  readOnly,
  selected,
  onSelect,
  onAdd,
  onConfigure,
  onResizeStart,
  onResizeKey,
  renderActivities,
  sheetSize,
}: {
  renderActivities: (row: PoolRow) => ReactNode;
  sheetSize: { width: number; height: number };
  document: ProcessDocument;
  name: string;
  readOnly: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (id: string | null) => void;
  onConfigure: () => void;
  onResizeStart: (row: PoolRow, event: Parameters<PointerEventHandler<HTMLDivElement>>[0]) => void;
  onResizeKey: (row: PoolRow, delta: number) => void;
}) {
  const pool = processCanvasPool(document);
  if (!pool) return null;
  return (
    <section
      className="process-pool"
      aria-label={`Process pool: ${name}`}
      data-editor-container="structured"
      style={{ left: 0, top: 0, width: sheetSize.width, height: sheetSize.height }}
    >
      <div className="process-pool-title">
        <span title={name}>{name}</span>
      </div>
      {pool.rows.map((row, index) => (
        <div
          key={row.id ?? 'unassigned'}
          className={`process-swimlane${selected === (row.id ?? '') ? ' is-selected' : ''}${row.id === null ? ' is-unassigned' : ''}`}
          data-process-lane={row.id ?? ''}
          style={{
            top: row.top - pool.y,
            height: row.height + (index === pool.rows.length - 1 ? sheetSize.height - pool.height : 0),
          }}
          role="group"
          aria-label={`${row.name} lane, ${row.count} activities`}
        >
          <header className="process-lane-header" data-process-lane-control>
            <ControlButton
              className="process-lane-heading"
              onPress={() => onSelect(row.id)}
              aria-label={`Select ${row.name} lane`}
            >
              <span>{row.name}</span>
              {row.role && <small>{row.role}</small>}
              <small>
                {row.count} {row.count === 1 ? 'activity' : 'activities'}
              </small>
            </ControlButton>
            {!readOnly && (
              <div className="process-lane-actions">
                <ControlButton
                  iconLeading={Plus}
                  aria-label={`Add activity to ${row.name}`}
                  onPress={() => onAdd(row.id)}
                />
                {row.id !== null && (
                  <>
                    <ControlButton
                      iconLeading={SettingsIcon}
                      aria-label={`Configure ${row.name} lane`}
                      onPress={onConfigure}
                    />
                  </>
                )}
              </div>
            )}
          </header>
          <div
            className="process-lane-content"
            data-process-lane-content={row.id ?? ''}
            aria-label={`${row.name} activities`}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('[data-board-node]')) return;
              e.stopPropagation();
              onSelect(row.id);
            }}
            onContextMenu={(e) => {
              if (readOnly || (e.target as HTMLElement).closest('[data-board-node]')) return;
              e.preventDefault();
              e.stopPropagation();
              onAdd(row.id);
            }}
          >
            {renderActivities(row)}
          </div>
          {!row.count && !readOnly && (
            <div className="process-empty-lane">
              <ControlButton iconLeading={Plus} onPress={() => onAdd(row.id)}>
                Add activity
              </ControlButton>
            </div>
          )}
          {!readOnly && pool.explicit && (
            <div
              className="process-lane-resizer"
              data-process-lane-control
              role="separator"
              aria-label={`Resize ${row.name} lane`}
              aria-orientation="horizontal"
              aria-valuemin={280}
              aria-valuemax={3000}
              aria-valuenow={row.height}
              tabIndex={0}
              onPointerDown={(e) => onResizeStart(row, e)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  e.stopPropagation();
                  onResizeKey(row, (e.key === 'ArrowDown' ? 1 : -1) * (e.shiftKey ? 80 : 20));
                }
              }}
            >
              <span />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
