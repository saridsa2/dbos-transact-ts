'use client';
/** Adapted from @reactbits-pro/tool-calls-1. See README.md for provenance/license. */
import { useId, useState } from 'react';
import { ChevronRight as ArrowRight01Icon } from '@/components/fa-icons';
import { RegistryIcon } from './registry-icon';
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const canvas = 'bg-white dark:bg-neutral-950';
const text1 = 'text-neutral-900 dark:text-neutral-100';
const text2 = 'text-neutral-900/80 dark:text-neutral-100/80';
const text3 = 'text-neutral-900/66 dark:text-neutral-100/66';
const rowsRuled = 'divide-y divide-neutral-900/8 dark:divide-neutral-100/8';
const typeHeadingXs = 'text-[16px]/[20px] font-[450] tracking-[-0.015em]';
const typeCaption = 'text-[14px]/[20px] font-normal tabular-nums';
const typeCodeSm = 'font-mono text-[14px]/[20px] tabular-nums';
const secondaryButton =
  'relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,outline-color,scale,filter] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] active:duration-[60ms] motion-reduce:active:scale-100 disabled:cursor-not-allowed aria-busy:cursor-progress focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] border border-neutral-900/12 bg-white text-neutral-900 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] hover:not-disabled:border-neutral-900/32 hover:not-disabled:bg-linear-to-b hover:not-disabled:from-neutral-900/3 hover:not-disabled:to-neutral-900/3 active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)] disabled:border-neutral-900/8 disabled:text-neutral-900/40 disabled:shadow-none dark:border-neutral-100/14 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-disabled:border-neutral-100/32 dark:hover:not-disabled:from-neutral-100/3 dark:hover:not-disabled:to-neutral-100/3 dark:active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] dark:disabled:border-neutral-100/8 dark:disabled:text-neutral-100/40';
const buttonMd = 'h-8 gap-2 rounded-[var(--rb-r-sm,6px)] px-4 text-[14px]/[16px] font-[450]';
const panel =
  'relative flex min-w-0 flex-col overflow-hidden rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-neutral-50 text-neutral-900 dark:text-neutral-100 dark:bg-neutral-900';
const panelBody =
  'mx-1 mb-1 flex min-w-0 flex-col overflow-hidden rounded-[var(--rb-r-sm,6px)] border border-neutral-900/8 bg-white [&:has(+*)]:mb-0 dark:border-neutral-100/8 dark:bg-neutral-950';
const statusWordSm = 'inline-flex items-start gap-1 text-[14px]/[20px] font-[450] tabular-nums';
const statusRunning = 'text-neutral-900 dark:text-neutral-100';
const statusOk = 'text-neutral-900/80 dark:text-neutral-100/80';
const statusFail = 'text-[oklch(51%_0.18_26)] dark:text-[oklch(76%_0.14_26)]';
const arcLine = 'flex h-lh shrink-0 items-center';
const runningArc =
  'inline-block size-2.5 shrink-0 rounded-full border border-current border-t-transparent animate-spin motion-reduce:animate-none';
const disclosureCaret =
  'shrink-0 text-neutral-900/66 dark:text-neutral-100/66 transition-transform duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none group-aria-expanded:rotate-90';
const toolRow =
  'group -mx-2 flex min-h-8 max-w-[calc(100%+16px)] min-w-0 cursor-pointer items-center gap-2 self-start rounded-[var(--rb-r-sm,6px)] px-2 text-left text-[14px]/[20px] text-neutral-900/80 dark:text-neutral-100/80 transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-neutral-900/5 active:bg-neutral-900/8 dark:hover:bg-neutral-100/5 dark:active:bg-neutral-100/8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]';
const stepGlyph = 'flex size-4 shrink-0 items-center justify-center';
const toolDetail = 'min-w-[6ch] truncate text-neutral-900 dark:text-neutral-100';
const toolEnd =
  'ms-auto flex shrink-0 items-center gap-2 whitespace-nowrap tabular-nums text-neutral-900/66 dark:text-neutral-100/66';
const toolWell =
  'flex min-w-0 flex-col gap-3 rounded-[var(--rb-r-sm,6px)] bg-neutral-900/5 px-3 py-2 dark:bg-neutral-100/5';
const codeText = 'min-w-0 flex-1 whitespace-pre';
const fadeTop =
  'bg-linear-to-b from-white to-transparent transition-opacity duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] dark:from-neutral-950';
const fadeBottom =
  'bg-linear-to-t from-white to-transparent transition-opacity duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] dark:from-neutral-950';

const pageTitle = cx(typeHeadingXs, text1);
const captionText = cx(typeCaption, text3);
const jsonText = cx(typeCodeSm, text2, codeText);

type Status = 'streaming' | 'running' | 'done' | 'failed';

export type ToolCall = {
  id: string;
  name: string;
  title?: string;
  status: Status;
  input?: string;
  output?: string;
  startedAt?: string;
  duration?: string;
};

const STATUS_WORD: Record<Status, string> = {
  streaming: 'Streaming',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

const STATUS_TONE: Record<Status, string> = {
  streaming: statusRunning,
  running: statusRunning,
  done: statusOk,
  failed: statusFail,
};

const isActive = (s: Status) => s === 'streaming' || s === 'running';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className={text3}>{label}</dt>
      <dd className={text2}>{value}</dd>
    </div>
  );
}

export function ToolCalls1({ calls }: { calls: readonly ToolCall[] }) {
  const uid = useId();
  const [openId, setOpenId] = useState('');
  return (
    <div className="rb-tool-calls" data-registry-component="tool-calls-1">
      <div className={rowsRuled}>
        {calls.map((p) => {
          const open = openId === p.id;
          const hasInput = Boolean(p.input);
          const hasOutput = Boolean(p.output);
          const panelId = `${uid}-${p.id}`;
          return (
            <div key={p.id}>
              <div className="flex px-3 py-1">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenId(open ? '' : p.id)}
                  className={cx(toolRow, 'flex-1')}
                >
                  <span className={stepGlyph}>
                    <RegistryIcon
                      icon={ArrowRight01Icon}
                      size={12}
                      strokeWidth={1.8}
                      aria-hidden="true"
                      className={disclosureCaret}
                    />
                  </span>
                  <span className={cx(toolDetail, typeCodeSm)}>{p.title ?? p.name}</span>
                  <span className={toolEnd}>
                    <span>{p.duration}</span>
                    <span className={cx(statusWordSm, STATUS_TONE[p.status], 'w-24 shrink-0 justify-end')}>
                      {isActive(p.status) && (
                        <span className={arcLine}>
                          <span aria-hidden="true" className={runningArc} />
                        </span>
                      )}
                      {STATUS_WORD[p.status]}
                    </span>
                  </span>
                </button>
              </div>

              {open && (
                <div id={panelId} className="space-y-3 px-3 pt-1 pb-3">
                  <dl className={cx(typeCaption, 'flex flex-wrap gap-x-8 gap-y-1')}>
                    {p.startedAt && <Field label="Started" value={p.startedAt} />}
                    {p.duration && <Field label="Duration" value={p.duration} />}
                  </dl>

                  {hasInput && (
                    <div>
                      <p className={cx(captionText, 'mb-1.5')}>Arguments</p>
                      <div className={cx(toolWell, 'max-h-40 overflow-y-auto')}>
                        <pre className={jsonText}>{p.input ?? ''}</pre>
                      </div>
                    </div>
                  )}

                  {hasOutput && (
                    <div>
                      <p className={cx(captionText, 'mb-1.5')}>Result</p>
                      <div className={cx(toolWell, 'max-h-60 overflow-auto')}>
                        <pre className={jsonText}>{p.output}</pre>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
