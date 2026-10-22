'use client';

import { AiBrain01Icon, ChartGanttIcon, Layers01Icon, Wrench01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import type { LanguageModelUsage } from 'ai';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type TraceSpanKind = 'model' | 'tool' | 'group';

export type TraceSpanStatus = 'ok' | 'error';

export interface TraceSpanUsage {
  /** All input tokens, cached ones included. */
  input: number;
  /** All output tokens, reasoning included. */
  output: number;
}

export interface TraceSpanImage {
  /** A URL or a data URL, such as an AI SDK image's `base64` with its media type. */
  src: string;
  alt: string;
}

export interface TraceSpan {
  id: string;
  /** The span this one sits under. A tool call sits under the model call that asked for it. */
  parentId?: string;
  kind: TraceSpanKind;
  /** A model id, a tool name, or any name for a group. */
  name: string;
  /** Milliseconds from an origin every span shares: the start of the run, or the epoch. */
  startMs: number;
  durationMs: number;
  /** Defaults to `ok`. */
  status?: TraceSpanStatus;
  /** Model calls: milliseconds from the start of the call to its first output. */
  firstTokenMs?: number;
  usage?: TraceSpanUsage;
  /** Model calls: output tokens per second once the answer started. */
  tokensPerSecond?: number;
  /** A string is shown as text, anything else as JSON. */
  input?: unknown;
  /** A string is shown as text, anything else as JSON. */
  output?: unknown;
  /** Shown in place of the output when the span failed. */
  error?: string;
  /** Images the span read or made, shown in the detail pane. */
  images?: readonly TraceSpanImage[];
  /** Extra facts for the detail pane, such as `{ Region: "iad1" }`. */
  attributes?: Record<string, string | number>;
  /** Wins over the mark found in `icons`. */
  icon?: ReactNode;
}

const clean = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;

const trimDecimal = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

/** `840ms`, `4.1s`, `2m 05s`. */
export const formatDuration = (ms: number): string => {
  const value = clean(ms);
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  if (value < 60_000) {
    return `${trimDecimal(value / 1000)}s`;
  }
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
};

/** `842`, `4.2K`, `1.2M`. */
export const formatTokens = (tokens: number): string => {
  const value = Math.round(clean(tokens));
  if (value < 1000) {
    return String(value);
  }
  if (value < 999_950) {
    return `${trimDecimal(value / 1000)}K`;
  }
  return `${trimDecimal(value / 1_000_000)}M`;
};

/** `search_logs`, `searchLogs`, and `search-logs` all read as `Search logs`. */
export const toolLabel = (name: string): string => {
  const words = name
    .replaceAll(/[_-]+/gu, ' ')
    .replaceAll(/([a-z\d])([A-Z])/gu, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : name;
};

const spanTokens = (span: TraceSpan): number => clean(span.usage?.input) + clean(span.usage?.output);

const spanEnd = (span: TraceSpan): number => clean(span.startMs) + clean(span.durationMs);

export interface TraceRow {
  span: TraceSpan;
  /** How many spans this one sits under. */
  depth: number;
  /** True when other spans sit under this one, as with a tool that ran a subagent. */
  parent: boolean;
}

/**
 * Spans in reading order: each one followed by the spans under it, earliest
 * first. A span whose parent is missing is listed at the top level.
 */
export const traceRows = (spans: readonly TraceSpan[]): TraceRow[] => {
  const ids = new Set(spans.map((span) => span.id));
  const children = new Map<string | undefined, TraceSpan[]>();
  for (const span of spans) {
    const parent =
      span.parentId !== undefined && span.parentId !== span.id && ids.has(span.parentId) ? span.parentId : undefined;
    children.set(parent, [...(children.get(parent) ?? []), span]);
  }
  const rows: TraceRow[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | undefined, depth: number) => {
    const group = (children.get(parent) ?? []).toSorted((left, right) => left.startMs - right.startMs);
    for (const span of group) {
      if (!seen.has(span.id)) {
        seen.add(span.id);
        rows.push({ depth, parent: children.has(span.id), span });
        visit(span.id, depth + 1);
      }
    }
  };
  visit(undefined, 0);
  // Spans that only point at each other have no way in from the top.
  for (const span of spans) {
    if (!seen.has(span.id)) {
      seen.add(span.id);
      rows.push({ depth: 0, parent: children.has(span.id), span });
    }
  }
  return rows;
};

export interface TraceSummary {
  /** Where the timeline starts, in the spans' own clock. */
  originMs: number;
  /** First start to last end. */
  durationMs: number;
  tokens: number;
  modelCalls: number;
  toolCalls: number;
  /** Spans that failed, earliest first. */
  failed: TraceSpan[];
  /** The longest model or tool call that nothing else sits under. */
  slowest: TraceSpan | null;
  /** The span worth opening first: the first failure, otherwise the slowest. */
  focus: TraceSpan | null;
}

export const traceSummary = (spans: readonly TraceSpan[]): TraceSummary => {
  let originMs = Number.POSITIVE_INFINITY;
  let endMs = 0;
  let tokens = 0;
  let slowest: TraceSpan | null = null;
  // A tool that ran other spans spent its time in them. A model call did
  // not: the tools under it start after it has answered.
  const parents = new Set(spans.map((span) => span.parentId));
  for (const span of spans) {
    originMs = Math.min(originMs, clean(span.startMs));
    endMs = Math.max(endMs, spanEnd(span));
    tokens += spanTokens(span);
    if (
      span.kind !== 'group' &&
      !(span.kind === 'tool' && parents.has(span.id)) &&
      clean(span.durationMs) > clean(slowest?.durationMs)
    ) {
      slowest = span;
    }
  }
  const failed = spans
    .filter((span) => span.status === 'error')
    .toSorted((left, right) => left.startMs - right.startMs);
  const origin = Number.isFinite(originMs) ? originMs : 0;
  return {
    durationMs: Math.max(0, endMs - origin),
    failed,
    focus: failed[0] ?? slowest ?? spans[0] ?? null,
    modelCalls: spans.filter((span) => span.kind === 'model').length,
    originMs: origin,
    slowest,
    tokens,
    toolCalls: spans.filter((span) => span.kind === 'tool').length,
  };
};

const TICK_FACTORS = [1, 2, 5, 10];

/** Round marks along a timeline: `0, 5000, 10000, 15000` for a 15.2s run. */
export const traceTicks = (durationMs: number, target = 4): number[] => {
  const total = clean(durationMs);
  if (total === 0) {
    return [0];
  }
  const rough = total / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const factor = TICK_FACTORS.find((item) => item * magnitude >= rough) ?? TICK_FACTORS[0];
  const step = (factor ?? 1) * magnitude;
  const ticks: number[] = [];
  for (let tick = 0; tick <= total; tick += step) {
    ticks.push(tick);
  }
  return ticks;
};

type UsageInput = Pick<LanguageModelUsage, 'inputTokens' | 'outputTokens'>;

/** The parts of an AI SDK `StepResult` a trace needs. */
export interface TraceStepSource {
  usage?: UsageInput;
  model?: { modelId?: string };
  performance?: {
    stepTimeMs?: number;
    responseTimeMs?: number;
    toolExecutionMs?: Readonly<Record<string, number>>;
    timeToFirstOutputMs?: number | undefined;
    outputTokensPerSecond?: number | undefined;
  };
  toolCalls?: readonly {
    toolCallId: string;
    toolName: string;
    input?: unknown;
  }[];
  toolResults?: readonly { toolCallId: string; output?: unknown }[];
  /** Read for `tool-error` parts. */
  content?: readonly { type: string; toolCallId?: string; error?: unknown }[];
  text?: string;
}

const errorText = (error: unknown): string => {
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error, null, 2) ?? String(error);
  } catch {
    return String(error);
  }
};

/**
 * Builds a trace from AI SDK steps. Each step becomes a model call followed
 * by the tool calls it asked for, which start together once the model has
 * answered. Timings come from `step.performance`, so nothing has to be
 * measured by hand.
 *
 * @example
 * const result = await generateText({ model, tools, prompt });
 * const spans = traceSpansFromSteps(result.steps);
 * // Store `spans` with the run, then on the admin page:
 * <TraceViewer spans={spans} />
 *
 * @example
 * // A subagent's steps go under the tool call that ran it.
 * const tool = spans.find((span) => span.name === "research_agent");
 * const nested = traceSpansFromSteps(subagentSteps, { under: tool });
 */
export const traceSpansFromSteps = (
  steps: readonly TraceStepSource[],
  options: { under?: TraceSpan } = {},
): TraceSpan[] => {
  const { under } = options;
  const spans: TraceSpan[] = [];
  let cursor = clean(under?.startMs);
  for (const [index, step] of steps.entries()) {
    const id = `${under ? `${under.id}/` : ''}step-${index + 1}`;
    const calls = step.toolCalls ?? [];
    const responseMs = clean(step.performance?.responseTimeMs);
    const toolMs = step.performance?.toolExecutionMs ?? {};
    spans.push({
      durationMs: responseMs,
      firstTokenMs: step.performance?.timeToFirstOutputMs,
      id,
      kind: 'model',
      name: step.model?.modelId ?? 'Model',
      output:
        step.text || (calls.length > 0 ? calls.map((call) => ({ input: call.input, tool: call.toolName })) : undefined),
      parentId: under?.id,
      startMs: cursor,
      tokensPerSecond: step.performance?.outputTokensPerSecond,
      usage: {
        input: clean(step.usage?.inputTokens),
        output: clean(step.usage?.outputTokens),
      },
    });
    let longestTool = 0;
    for (const call of calls) {
      const durationMs = clean(toolMs[call.toolCallId]);
      const failure = step.content?.find((part) => part.type === 'tool-error' && part.toolCallId === call.toolCallId);
      longestTool = Math.max(longestTool, durationMs);
      spans.push({
        durationMs,
        error: failure ? errorText(failure.error) : undefined,
        id: `${id}-${call.toolCallId}`,
        input: call.input,
        kind: 'tool',
        name: call.toolName,
        output: step.toolResults?.find((result) => result.toolCallId === call.toolCallId)?.output,
        parentId: id,
        startMs: cursor + responseMs,
        status: failure ? 'error' : 'ok',
      });
    }
    cursor += Math.max(clean(step.performance?.stepTimeMs), responseMs + longestTool);
  }
  return spans;
};

export interface TraceBody {
  text: string;
  /** True when `text` is pretty-printed JSON and can be highlighted. */
  json: boolean;
}

/** Display text for a span's input or output. */
export const traceBody = (value: unknown): TraceBody => {
  if (value === undefined) {
    return { json: false, text: '' };
  }
  if (typeof value === 'string') {
    return { json: false, text: value };
  }
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? { json: false, text: String(value) } : { json: true, text };
  } catch {
    return { json: false, text: String(value) };
  }
};

type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'punctuation' | 'plain';

interface Token {
  kind: TokenKind;
  offset: number;
  text: string;
}

const JSON_TOKEN = /"(?:[^"\\]|\\.)*"?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\],:]/gu;
const KEY_SUFFIX = /\s*:/uy;

const tokenKind = (value: string, source: string, end: number): TokenKind => {
  if (value.startsWith('"')) {
    KEY_SUFFIX.lastIndex = end;
    return KEY_SUFFIX.test(source) ? 'key' : 'string';
  }
  if (value === 'true' || value === 'false' || value === 'null') {
    return 'literal';
  }
  if (value.length === 1 && '{}[],:'.includes(value)) {
    return 'punctuation';
  }
  return 'number';
};

const tokenizeJson = (source: string): Token[] => {
  const tokens: Token[] = [];
  let cursor = 0;
  for (const match of source.matchAll(JSON_TOKEN)) {
    const [value] = match;
    const offset = match.index;
    if (offset > cursor) {
      tokens.push({
        kind: 'plain',
        offset: cursor,
        text: source.slice(cursor, offset),
      });
    }
    cursor = offset + value.length;
    tokens.push({
      kind: tokenKind(value, source, cursor),
      offset,
      text: value,
    });
  }
  if (cursor < source.length) {
    tokens.push({ kind: 'plain', offset: cursor, text: source.slice(cursor) });
  }
  return tokens;
};

export interface TraceViewerClassNames {
  root?: string;
  header?: string;
  summary?: string;
  waterfall?: string;
  row?: string;
  bar?: string;
  detail?: string;
  code?: string;
}

export interface TraceViewerProps {
  spans?: readonly TraceSpan[];
  title?: string;
  /** Shown in the header. Defaults to the model the run used. */
  model?: string;
  /** Display names, keyed by tool name or model id. */
  labels?: Record<string, string>;
  /** Marks for the rows, keyed by tool name or model id. */
  icons?: Record<string, ReactNode>;
  /** The open span. Leave it out to let the viewer open the first failure, or the slowest call. */
  selectedId?: string;
  defaultSelectedId?: string;
  onSelect?: (span: TraceSpan) => void;
  /** Called with the copied text after it reaches the clipboard. */
  onCopy?: (text: string) => void;
  className?: string;
  classNames?: TraceViewerClassNames;
  /** Handy for overriding the --trace-viewer-* theme vars inline */
  style?: CSSProperties;
}

const DEFAULT_SPANS: TraceSpan[] = [
  {
    durationMs: 900,
    firstTokenMs: 320,
    id: 's1',
    kind: 'model',
    name: 'Model',
    output: [{ input: { query: 'rate limits' }, tool: 'search_docs' }],
    startMs: 0,
    tokensPerSecond: 72,
    usage: { input: 1900, output: 140 },
  },
  {
    durationMs: 1400,
    id: 's1-search',
    input: { query: 'rate limits' },
    kind: 'tool',
    name: 'search_docs',
    output: { matches: 3, top: 'guides/rate-limits' },
    parentId: 's1',
    startMs: 900,
  },
  {
    durationMs: 800,
    firstTokenMs: 290,
    id: 's2',
    kind: 'model',
    name: 'Model',
    output: [{ input: { path: 'guides/rate-limits' }, tool: 'read_page' }],
    startMs: 2300,
    tokensPerSecond: 80,
    usage: { input: 4700, output: 120 },
  },
  {
    durationMs: 600,
    id: 's2-read',
    input: { path: 'guides/rate-limits' },
    kind: 'tool',
    name: 'read_page',
    output: { words: 1840 },
    parentId: 's2',
    startMs: 3100,
  },
  {
    durationMs: 2200,
    firstTokenMs: 410,
    id: 's3',
    kind: 'model',
    name: 'Model',
    output:
      'Requests are limited per key, per minute. A 429 carries a retry-after header that says when to send the next one.',
    startMs: 3700,
    tokensPerSecond: 88,
    usage: { input: 9500, output: 640 },
  },
];

const COPIED_MS = 1600;
const INDENT_PX = 12;
const MAX_INDENT = 4;
const HIGHLIGHT_LIMIT = 20_000;
const EASE = [0.22, 1, 0.36, 1] as const;

const ENTER_CLASS =
  'fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-300 ease-out motion-reduce:animate-none';

const THEME_VARS = [
  '[--trace-viewer-model:#2a78d6] dark:[--trace-viewer-model:#3987e5]',
  '[--trace-viewer-tool:#1baf7a] dark:[--trace-viewer-tool:#199e70]',
  '[--trace-viewer-group:color-mix(in_oklab,var(--foreground)_30%,transparent)]',
  '[--trace-viewer-error:var(--destructive)]',
  '[--trace-viewer-accent:#1d6496] dark:[--trace-viewer-accent:#6eb5dc]',
  '[--trace-viewer-icon-bg:color-mix(in_oklab,var(--trace-viewer-accent)_14%,var(--card))] dark:[--trace-viewer-icon-bg:color-mix(in_oklab,var(--trace-viewer-accent)_22%,var(--card))]',
  '[--trace-viewer-key:#005cc5] dark:[--trace-viewer-key:#79b8ff]',
  '[--trace-viewer-string:#032f62] dark:[--trace-viewer-string:#9ecbff]',
  '[--trace-viewer-number:#b35900] dark:[--trace-viewer-number:#ffab70]',
  '[--trace-viewer-literal:#d73a49] dark:[--trace-viewer-literal:#f97583]',
  '[--trace-viewer-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]',
  '[--trace-viewer-shadow-hover:0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.08),0_2px_4px_0px_rgba(0,0,0,0.06)]',
  'dark:[--trace-viewer-shadow:0_0_0_1px_rgba(255,255,255,0.08)]',
  'dark:[--trace-viewer-shadow-hover:0_0_0_1px_rgba(255,255,255,0.13)]',
].join(' ');

/** Column widths the axis, the rows, and the overlay behind them all share. */
const COLUMN_VARS =
  '[--trace-viewer-label:6.5rem] [--trace-viewer-figures:2.75rem] @xs:[--trace-viewer-label:7.5rem] @md:[--trace-viewer-label:9.5rem] @md:[--trace-viewer-figures:6rem]';

const TOKEN_CLASS: Record<TokenKind, string | undefined> = {
  key: 'text-(--trace-viewer-key)',
  literal: 'text-(--trace-viewer-literal)',
  number: 'text-(--trace-viewer-number)',
  plain: undefined,
  punctuation: 'text-muted-foreground',
  string: 'text-(--trace-viewer-string)',
};

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

const ROW_CLASS =
  'flex h-7 w-full min-w-0 items-center gap-2 rounded-md border-0 bg-transparent px-1.5 text-left text-[13px] leading-4 text-card-foreground transition-colors duration-150 ease-out motion-reduce:transition-none';

const PILL_CLASS = cn(
  "relative z-0 inline-flex h-6 cursor-pointer items-center rounded-full border-0 bg-transparent px-2.5 text-xs leading-none font-medium whitespace-nowrap text-card-foreground transition-transform duration-150 ease-out before:absolute before:inset-0 before:-z-1 before:rounded-full before:bg-foreground/6 before:transition-colors before:duration-150 before:ease-out before:content-[''] after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] hover:before:bg-foreground/10 active:scale-[0.96] motion-reduce:transition-none",
  FOCUS_CLASS,
);

const KIND_ICON: Record<TraceSpanKind, IconSvgElement> = {
  group: Layers01Icon,
  model: AiBrain01Icon,
  tool: Wrench01Icon,
};

/** A tool that ran other spans is an agent, so it takes the group mark. */
const markKind = (span: TraceSpan, parent: boolean): TraceSpanKind =>
  parent && span.kind === 'tool' ? 'group' : span.kind;

const KIND_LABEL: Record<TraceSpanKind, string> = {
  group: 'Group',
  model: 'Model call',
  tool: 'Tool call',
};

const barColor = (span: TraceSpan): CSSProperties => {
  const color = span.status === 'error' ? 'var(--trace-viewer-error)' : `var(--trace-viewer-${span.kind})`;
  // SAFETY: custom properties are valid CSS; CSSProperties omits `--*` keys.
  return { '--trace-viewer-bar': color } as CSSProperties;
};

const percent = (part: number, whole: number): number =>
  whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;

const shareText = (part: number, whole: number): string => {
  const share = Math.round(percent(part, whole));
  return share < 1 ? 'under 1%' : `${share}%`;
};

const countText = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

const modelSummary = (spans: readonly TraceSpan[]): string | null => {
  const models = [...new Set(spans.flatMap((span) => (span.kind === 'model' ? [span.name] : [])))];
  if (models.length === 0) {
    return null;
  }
  return models.length === 1 ? (models[0] ?? null) : `${models.length} models`;
};

type SectionId = 'input' | 'output';

interface Section {
  id: SectionId;
  label: string;
  body: TraceBody;
  tone?: 'error';
}

const spanSections = (span: TraceSpan): Section[] => {
  const sections: Section[] = [];
  if (span.input !== undefined) {
    sections.push({ body: traceBody(span.input), id: 'input', label: 'Input' });
  }
  if (span.status === 'error') {
    sections.push({
      body: { json: false, text: span.error ?? 'The call failed.' },
      id: 'output',
      label: 'Error',
      tone: 'error',
    });
  } else if (span.output !== undefined) {
    sections.push({
      body: traceBody(span.output),
      id: 'output',
      label: 'Output',
    });
  }
  return sections;
};

/** How far into the run a span began. */
const startText = (span: TraceSpan, summary: TraceSummary): string => {
  const offset = clean(span.startMs) - summary.originMs;
  return offset > 0 ? formatDuration(offset) : '0s';
};

const spanFacts = (span: TraceSpan, summary: TraceSummary): { label: string; value: string }[] => {
  const facts = [
    { label: 'Started', value: startText(span, summary) },
    { label: 'Duration', value: formatDuration(span.durationMs) },
  ];
  if (span.firstTokenMs !== undefined) {
    facts.push({
      label: 'First token',
      value: formatDuration(span.firstTokenMs),
    });
  }
  if (span.usage) {
    facts.push(
      { label: 'Input', value: formatTokens(span.usage.input) },
      { label: 'Output', value: formatTokens(span.usage.output) },
    );
  }
  if (span.tokensPerSecond !== undefined) {
    facts.push({
      label: 'Speed',
      value: `${Math.round(clean(span.tokensPerSecond))} tok/s`,
    });
  }
  for (const [label, value] of Object.entries(span.attributes ?? {})) {
    facts.push({ label, value: String(value) });
  }
  return facts;
};

/** Writes to the clipboard and reports `copied` for a moment afterwards. */
const useCopy = (onCopy: ((text: string) => void) | undefined) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopy?.(value);
    } catch {
      setCopied(false);
    }
  };

  return { copied, copy };
};

const SpanMark = ({ icon, kind }: { icon?: ReactNode; kind: TraceSpanKind }) => (
  <span
    aria-hidden="true"
    className="inline-flex size-4 flex-none items-center justify-center text-muted-foreground [&_svg]:size-3.5"
    data-slot="trace-viewer-mark"
  >
    {icon ?? <HugeiconsIcon icon={KIND_ICON[kind]} strokeWidth={2} />}
  </span>
);

const Bar = ({
  className,
  hollow,
  span,
  summary,
}: {
  className?: string;
  /** Drawn as a tint only, so the spans under it carry the color. */
  hollow: boolean;
  span: TraceSpan;
  summary: TraceSummary;
}) => {
  const reduce = useReducedMotion();
  const left = percent(clean(span.startMs) - summary.originMs, summary.durationMs);
  const width = percent(span.durationMs, summary.durationMs);
  // The lighter lead of a model bar is the wait for its first token.
  const wait = span.kind === 'model' ? percent(clean(span.firstTokenMs), span.durationMs) : 0;
  const lead = hollow ? 100 : wait;
  return (
    <motion.span
      animate={{ clipPath: 'inset(0 0% 0 0)' }}
      className={cn(
        'absolute top-1/2 block h-2 -translate-y-1/2 overflow-hidden rounded-[3px] bg-[color-mix(in_oklab,var(--trace-viewer-bar)_36%,transparent)] transition-[left,width] duration-300 ease-out motion-reduce:transition-none',
        className,
      )}
      data-slot="trace-viewer-bar"
      initial={reduce ? false : { clipPath: 'inset(0 100% 0 0)' }}
      style={{
        ...barColor(span),
        left: `min(${left}%, calc(100% - 3px))`,
        width: `max(${width}%, 3px)`,
      }}
      transition={{
        delay: (left / 100) * 0.5,
        duration: 0.3 + (width / 100) * 0.4,
        ease: EASE,
      }}
    >
      <span className="absolute inset-y-0 right-0 bg-(--trace-viewer-bar)" style={{ left: `${lead}%` }} />
    </motion.span>
  );
};

const tickTransform = (share: number): string | undefined => {
  if (share === 0) {
    return undefined;
  }
  return share > 90 ? 'translateX(-100%)' : 'translateX(-50%)';
};

const Axis = ({ summary, ticks }: { summary: TraceSummary; ticks: number[] }) => (
  <div aria-hidden="true" className="flex h-4 items-center gap-2 px-1.5">
    <span className="w-(--trace-viewer-label) flex-none" />
    <span className="relative h-4 min-w-0 flex-1">
      {ticks.map((tick, index) => {
        const share = percent(tick, summary.durationMs);
        // A narrow card has room for the first and last mark only.
        const inner = index > 0 && index < ticks.length - 1;
        return (
          <span
            className={cn(
              'absolute top-0 text-[10px] leading-4 whitespace-nowrap text-muted-foreground tabular-nums',
              inner && 'hidden @xs:block',
            )}
            key={tick}
            style={{ left: `${share}%`, transform: tickTransform(share) }}
          >
            {tick === 0 ? '0' : formatDuration(tick)}
          </span>
        );
      })}
    </span>
    <span className="w-(--trace-viewer-figures) flex-none" />
  </div>
);

/** Tick lines behind the rows, and a band that marks when the open span ran. */
const TrackOverlay = ({
  selected,
  summary,
  ticks,
}: {
  selected: TraceSpan | null;
  summary: TraceSummary;
  ticks: number[];
}) => (
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-y-0 right-[calc(var(--trace-viewer-figures)+0.875rem)] left-[calc(var(--trace-viewer-label)+0.875rem)]"
  >
    {ticks.map((tick) => (
      <span
        className="absolute inset-y-0 w-px bg-foreground/6"
        key={tick}
        style={{ left: `${percent(tick, summary.durationMs)}%` }}
      />
    ))}
    {selected ? (
      <span
        className="absolute inset-y-0 bg-foreground/4 shadow-[inset_1px_0_0_color-mix(in_oklab,var(--foreground)_12%,transparent),inset_-1px_0_0_color-mix(in_oklab,var(--foreground)_12%,transparent)] transition-[left,width] duration-200 ease-out motion-reduce:transition-none"
        data-slot="trace-viewer-band"
        style={{
          left: `${percent(clean(selected.startMs) - summary.originMs, summary.durationMs)}%`,
          width: `max(${percent(selected.durationMs, summary.durationMs)}%, 2px)`,
        }}
      />
    ) : null}
  </div>
);

const SectionSwitch = ({
  active,
  onChange,
  sections,
}: {
  active: SectionId;
  onChange: (id: SectionId) => void;
  sections: readonly Section[];
}) => (
  <div
    aria-label="Show"
    className="inline-flex flex-none items-center gap-0.5 rounded-full bg-foreground/6 p-0.5"
    role="group"
  >
    {sections.map((section) => (
      <button
        aria-pressed={active === section.id}
        className={cn(
          'h-5 cursor-pointer rounded-full border-0 px-2 text-xs leading-none font-medium transition-[background-color,color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
          FOCUS_CLASS,
          active === section.id
            ? 'bg-card text-card-foreground shadow-(--trace-viewer-shadow)'
            : 'bg-transparent text-muted-foreground hover:text-card-foreground',
        )}
        key={section.id}
        onClick={() => {
          onChange(section.id);
        }}
        type="button"
      >
        {section.label}
      </button>
    ))}
  </div>
);

const CodeText = ({ body }: { body: TraceBody }) => {
  if (!body.json || body.text.length > HIGHLIGHT_LIMIT) {
    return body.text;
  }
  return tokenizeJson(body.text).map((token) => (
    <span className={TOKEN_CLASS[token.kind]} key={token.offset}>
      {token.text}
    </span>
  ));
};

const Detail = ({
  className,
  codeClassName,
  icon,
  kind,
  label,
  onCopy,
  onSectionChange,
  section,
  span,
  summary,
}: {
  className?: string;
  codeClassName?: string;
  icon?: ReactNode;
  /** The mark to fall back on when there is no icon. */
  kind: TraceSpanKind;
  label: string;
  onCopy?: (text: string) => void;
  onSectionChange: (id: SectionId) => void;
  section: SectionId;
  span: TraceSpan;
  summary: TraceSummary;
}) => {
  const { copied, copy } = useCopy(onCopy);
  const sections = spanSections(span);
  const open = sections.find((item) => item.id === section) ?? sections.at(-1) ?? null;
  const failed = span.status === 'error';
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-2.5 rounded-lg bg-muted px-3 pt-2 pb-2.5 dark:bg-background', className)}
      data-slot="trace-viewer-detail"
    >
      <div className="flex min-h-5.5 min-w-0 items-center gap-1.5">
        <SpanMark icon={icon} kind={kind} />
        <span className="min-w-0 truncate text-[13px] leading-tight font-medium tracking-[-0.01em]">{label}</span>
        <span className="ml-auto flex min-w-0 flex-none items-center gap-1.5 text-xs leading-4 text-muted-foreground">
          {failed ? <span className="text-(--trace-viewer-error)">Failed</span> : null}
          {label === span.name ? (
            <span className={cn(failed && 'hidden')}>{KIND_LABEL[span.kind]}</span>
          ) : (
            <span className="max-w-48 truncate font-mono">{span.name}</span>
          )}
        </span>
      </div>
      <dl className="m-0 flex flex-wrap gap-x-5 gap-y-2 pl-0.5">
        {spanFacts(span, summary).map((fact) => (
          <div className="flex min-w-0 flex-col gap-1" key={fact.label}>
            <dt className="text-[11px] leading-none text-muted-foreground">{fact.label}</dt>
            <dd className="m-0 text-[13px] leading-none tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {span.images && span.images.length > 0 ? (
        <div className="flex min-w-0 gap-1.5 overflow-x-auto pl-0.5" data-slot="trace-viewer-images">
          {span.images.map((image) => (
            // oxlint-disable-next-line next/no-img-element -- any image the caller passes, often a data URL
            // eslint-disable-next-line @next/next/no-img-element -- any image the caller passes, often a data URL
            <img
              alt={image.alt}
              className="h-24 w-auto flex-none rounded-md object-cover outline-1 -outline-offset-1 outline-foreground/10"
              key={image.src}
              src={image.src}
            />
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="flex min-w-0 flex-col gap-1.5 border-t border-foreground/6 pt-2">
          <div className="flex h-6 items-center justify-between gap-2">
            <SectionSwitch active={open.id} onChange={onSectionChange} sections={sections} />
            <button
              aria-label={copied ? `Copied ${open.label.toLowerCase()}` : `Copy ${open.label.toLowerCase()}`}
              className={PILL_CLASS}
              data-slot="trace-viewer-copy"
              onClick={() => {
                void copy(open.body.text);
              }}
              type="button"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre
            className={cn(
              'm-0 max-h-40 overflow-auto pl-0.5 wrap-break-word whitespace-pre-wrap',
              open.body.json ? 'font-mono text-xs leading-[18px]' : 'font-sans text-[13px] leading-5',
              open.tone === 'error' ? 'text-(--trace-viewer-error)' : 'text-card-foreground',
              codeClassName,
            )}
            data-slot="trace-viewer-code"
            // A scrolling region has to be reachable from the keyboard.
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
          >
            <CodeText body={open.body} />
          </pre>
          <output aria-live="polite" className="sr-only">
            {copied ? `Copied ${open.label.toLowerCase()}` : ''}
          </output>
        </div>
      ) : null}
    </div>
  );
};

const ROW_KEYS: Record<string, (index: number, last: number) => number> = {
  ArrowDown: (index, last) => Math.min(last, index + 1),
  ArrowUp: (index) => Math.max(0, index - 1),
  End: (_index, last) => last,
  Home: () => 0,
};

export const TraceViewer = ({
  spans = DEFAULT_SPANS,
  title = 'Trace',
  model,
  labels,
  icons,
  selectedId,
  defaultSelectedId,
  onSelect,
  onCopy,
  className,
  classNames,
  style,
}: TraceViewerProps) => {
  const [picked, setPicked] = useState(defaultSelectedId);
  const [section, setSection] = useState<SectionId>('output');
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const rows = traceRows(spans);
  const summary = traceSummary(spans);
  const ticks = traceTicks(summary.durationMs);
  const wanted = selectedId ?? picked;
  const selected = rows.find((row) => row.span.id === wanted)?.span ?? summary.focus;
  const usedModel = modelSummary(spans);
  const header = model ?? (usedModel ? (labels?.[usedModel] ?? usedModel) : null);

  const labelOf = (span: TraceSpan): string =>
    labels?.[span.name] ?? (span.kind === 'tool' ? toolLabel(span.name) : span.name);
  const iconOf = (span: TraceSpan): ReactNode => span.icon ?? icons?.[span.name];

  const select = (span: TraceSpan) => {
    setPicked(span.id);
    onSelect?.(span);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = rows[ROW_KEYS[event.key]?.(index, rows.length - 1) ?? index];
    if (!next || next === rows[index]) {
      return;
    }
    event.preventDefault();
    select(next.span);
    rowRefs.current.get(next.span.id)?.focus();
  };

  const [firstFailure] = summary.failed;
  const others = summary.failed.length - 1;

  return (
    <section
      aria-label={title}
      className={cn(
        THEME_VARS,
        '@container flex w-full max-w-full min-w-0 flex-col gap-3 rounded-2xl bg-card p-3 text-card-foreground shadow-(--trace-viewer-shadow) transition-shadow duration-150 ease-out hover:shadow-(--trace-viewer-shadow-hover)',
        className,
        classNames?.root,
      )}
      data-slot="trace-viewer"
      style={style}
    >
      <div
        className={cn(ENTER_CLASS, 'flex h-6 min-w-0 items-center gap-2', classNames?.header)}
        data-slot="trace-viewer-header"
      >
        <span className="inline-flex size-6 flex-none items-center justify-center rounded-md bg-(--trace-viewer-icon-bg)">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-3.5 text-(--trace-viewer-accent)"
            icon={ChartGanttIcon}
            strokeWidth={2}
          />
        </span>
        <div className="max-w-[60%] flex-none truncate text-[13px] leading-tight font-medium tracking-[-0.01em]">
          {title}
        </div>
        {header ? (
          <span
            className="min-w-0 flex-1 truncate text-right text-xs leading-4 text-muted-foreground"
            data-slot="trace-viewer-model"
          >
            {header}
          </span>
        ) : null}
      </div>

      {rows.length === 0 || !selected ? (
        <p className="m-0 pl-0.5 text-[13px] leading-5 text-pretty text-muted-foreground">
          No spans recorded for this run.
        </p>
      ) : (
        <>
          <div
            className={cn(ENTER_CLASS, 'flex min-w-0 flex-col gap-2 pl-0.5 delay-100', classNames?.summary)}
            data-slot="trace-viewer-summary"
          >
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="text-2xl leading-none font-medium tracking-tight tabular-nums">
                {formatDuration(summary.durationMs)}
              </span>
              {summary.tokens > 0 ? (
                <span className="flex-none text-[13px] leading-none text-muted-foreground tabular-nums">
                  / {formatTokens(summary.tokens)} tokens
                </span>
              ) : null}
              <span className="ml-auto hidden min-w-0 truncate text-[13px] leading-none text-muted-foreground tabular-nums @md:block">
                {[
                  ...(summary.modelCalls > 0 ? [countText(summary.modelCalls, 'model call')] : []),
                  ...(summary.toolCalls > 0 ? [countText(summary.toolCalls, 'tool call')] : []),
                ].join(' · ')}
              </span>
            </div>
            <p className="m-0 text-[13px] leading-[18px] text-pretty text-muted-foreground">
              {firstFailure ? (
                <>
                  <span className="font-medium text-card-foreground">{labelOf(firstFailure)}</span> failed after{' '}
                  {formatDuration(firstFailure.durationMs)}
                  {others > 0 ? `, and ${countText(others, 'more call')} failed.` : '.'}
                </>
              ) : (
                <>
                  <span className="font-medium text-card-foreground">{labelOf(summary.slowest ?? selected)}</span> took{' '}
                  {formatDuration((summary.slowest ?? selected).durationMs)},{' '}
                  {shareText((summary.slowest ?? selected).durationMs, summary.durationMs)} of the run.
                </>
              )}
            </p>
          </div>

          <div
            className={cn(ENTER_CLASS, COLUMN_VARS, 'flex min-w-0 flex-col gap-1 delay-150', classNames?.waterfall)}
            data-slot="trace-viewer-waterfall"
          >
            <Axis summary={summary} ticks={ticks} />
            <div className="max-h-[22rem] overflow-y-auto">
              <div className="relative">
                <TrackOverlay selected={selected} summary={summary} ticks={ticks} />
                <ul className="relative m-0 flex list-none flex-col gap-px p-0">
                  {rows.map(({ depth, parent, span }, index) => {
                    const isSelected = span.id === selected.id;
                    const failed = span.status === 'error';
                    return (
                      <li key={span.id}>
                        <button
                          aria-pressed={isSelected}
                          className={cn(
                            ROW_CLASS,
                            'cursor-pointer hover:bg-foreground/4',
                            FOCUS_CLASS,
                            isSelected && 'bg-foreground/6 hover:bg-foreground/6',
                            classNames?.row,
                          )}
                          data-kind={span.kind}
                          data-slot="trace-viewer-row"
                          data-status={span.status ?? 'ok'}
                          onClick={() => {
                            select(span);
                          }}
                          onKeyDown={(event) => {
                            onRowKeyDown(event, index);
                          }}
                          ref={(element) => {
                            if (element) {
                              rowRefs.current.set(span.id, element);
                            } else {
                              rowRefs.current.delete(span.id);
                            }
                          }}
                          type="button"
                        >
                          <span
                            className="flex w-(--trace-viewer-label) min-w-0 flex-none items-center gap-1.5"
                            style={{
                              paddingLeft: Math.min(depth, MAX_INDENT) * INDENT_PX,
                            }}
                          >
                            <SpanMark icon={iconOf(span)} kind={markKind(span, parent)} />
                            <span className="min-w-0 truncate">{labelOf(span)}</span>
                          </span>
                          <span className="relative h-full min-w-0 flex-1">
                            <Bar
                              className={classNames?.bar}
                              hollow={parent && span.kind !== 'model'}
                              span={span}
                              summary={summary}
                            />
                          </span>
                          <span className="hidden w-11 flex-none text-right text-muted-foreground tabular-nums @md:block">
                            {span.usage ? formatTokens(spanTokens(span)) : null}
                          </span>
                          <span
                            className={cn(
                              'w-11 flex-none text-right tabular-nums',
                              failed && 'text-(--trace-viewer-error)',
                            )}
                          >
                            {formatDuration(span.durationMs)}
                            {failed ? <span className="sr-only">, failed</span> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>

          <div className={cn(ENTER_CLASS, 'min-w-0 delay-200')}>
            <Detail
              className={classNames?.detail}
              codeClassName={classNames?.code}
              icon={iconOf(selected)}
              kind={markKind(
                selected,
                rows.some((row) => row.parent && row.span.id === selected.id),
              )}
              label={labelOf(selected)}
              onCopy={onCopy}
              onSectionChange={setSection}
              section={section}
              span={selected}
              summary={summary}
            />
          </div>
        </>
      )}
    </section>
  );
};
