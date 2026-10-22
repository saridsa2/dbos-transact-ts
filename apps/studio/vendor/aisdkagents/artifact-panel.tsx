'use client';

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  ChartColumnIcon,
  Copy01Icon,
  Download01Icon,
  File02Icon,
  MaximizeScreenIcon,
  MinimizeScreenIcon,
  SourceCodeIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { parsePartialJson } from 'ai';
import type { UIMessage } from 'ai';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { bundledLanguages, createHighlighter } from 'shiki';
import type { BundledLanguage, BundledTheme, HighlighterGeneric, ThemedToken } from 'shiki';
import { Streamdown } from 'streamdown';

import { cn } from '@/lib/utils';

export type ArtifactKind = 'document' | 'code' | 'chart';

export type ArtifactStatus = 'streaming' | 'ready' | 'error';

export type ArtifactView = 'preview' | 'source';

export interface ArtifactVersion {
  id: string;
  /**
   * Markdown for a document, source for code, and JSON for a chart (see
   * `ArtifactChartSpec`).
   */
  content: string;
  /** What changed, such as "Shorter summary". Defaults to "Version 2". */
  label?: string;
}

export interface ArtifactChartSeries {
  /** Field of each row that holds this series' number. */
  key: string;
  label?: string;
}

/** The JSON a chart artifact is written in. */
export interface ArtifactChartSpec {
  type: 'bar' | 'line';
  /** Field of each row that holds its category, such as a date. */
  x: string;
  series: ArtifactChartSeries[];
  data: Record<string, unknown>[];
  /** Appended to values in the tooltip and table, such as "%". */
  unit?: string;
}

export interface ArtifactFile {
  filename: string;
  content: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const numberOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const readSeries = (value: unknown): ArtifactChartSeries[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const series: ArtifactChartSeries[] = [];
  for (const item of value) {
    const key = isRecord(item) ? textOf(item.key) : textOf(item);
    if (key) {
      series.push({
        key,
        label: isRecord(item) ? textOf(item.label) : undefined,
      });
    }
  }
  return series;
};

/**
 * Reads a chart out of parsed JSON. Missing parts are inferred from the first
 * row: the first text field is the category, every numeric field is a series.
 * Returns `null` until there is at least one row to draw.
 */
export const artifactChart = (value: unknown): ArtifactChartSpec | null => {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return null;
  }
  const data = value.data.filter(isRecord);
  const [first] = data;
  if (!first) {
    return null;
  }
  const fields = Object.keys(first);
  const x = textOf(value.x) ?? fields.find((field) => typeof first[field] === 'string') ?? fields[0];
  if (!x) {
    return null;
  }
  const given = readSeries(value.series);
  const series =
    given.length > 0
      ? given
      : fields.filter((field) => field !== x && numberOf(first[field]) !== undefined).map((key) => ({ key }));
  if (series.length === 0) {
    return null;
  }
  return {
    data,
    series,
    type: value.type === 'line' ? 'line' : 'bar',
    unit: textOf(value.unit),
    x,
  };
};

const EXTENSIONS: Record<string, string> = {
  bash: 'sh',
  css: 'css',
  go: 'go',
  html: 'html',
  javascript: 'js',
  json: 'json',
  jsx: 'jsx',
  markdown: 'md',
  python: 'py',
  rust: 'rs',
  shell: 'sh',
  sql: 'sql',
  tsx: 'tsx',
  typescript: 'ts',
  yaml: 'yaml',
};

const HAS_EXTENSION_RE = /\.[a-z0-9]{1,6}$/iu;
const UNSAFE_NAME_RE = /[^a-z0-9._-]+/giu;
const TRIM_DASH_RE = /^-+|-+$/gu;

const extensionFor = (kind: ArtifactKind, language: string | undefined) => {
  if (kind === 'document') {
    return 'md';
  }
  if (kind === 'chart') {
    return 'json';
  }
  const id = (language ?? '').toLowerCase();
  return EXTENSIONS[id] ?? (id || 'txt');
};

/** A safe file name for the artifact: `csp.ts` stays, "Incident review" becomes `incident-review.md`. */
export const artifactFilename = (title: string, kind: ArtifactKind, language?: string): string => {
  const name = title.trim().toLowerCase().replace(UNSAFE_NAME_RE, '-').replace(TRIM_DASH_RE, '') || 'artifact';
  return HAS_EXTENSION_RE.test(name) ? name : `${name}.${extensionFor(kind, language)}`;
};

const KINDS: readonly ArtifactKind[] = ['document', 'code', 'chart'];

const kindOf = (value: unknown, language: string | undefined): ArtifactKind => {
  const kind = KINDS.find((item) => item === value);
  if (kind) {
    return kind;
  }
  const id = (language ?? '').toLowerCase();
  return !id || id === 'markdown' || id === 'md' ? 'document' : 'code';
};

export interface ArtifactSource {
  /**
   * Tools whose input is an artifact: `{ id?, title, kind?, language?,
   * content }`. Each call is one version.
   */
  toolNames?: readonly string[];
  /** Artifact to read. Defaults to the one the latest call wrote. */
  id?: string;
}

export interface ArtifactFromMessages {
  id: string;
  title: string;
  kind: ArtifactKind;
  language?: string;
  versions: ArtifactVersion[];
  status: ArtifactStatus;
}

const DEFAULT_TOOL_NAMES = ['createArtifact', 'updateArtifact'] as const;

interface ArtifactCall {
  callId: string;
  id: string;
  input: Record<string, unknown>;
  state: string;
}

const readCalls = (messages: readonly UIMessage[], toolNames: readonly string[]): ArtifactCall[] => {
  const calls: ArtifactCall[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      const name = part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5);
      if (
        !(part.type === 'dynamic-tool' || part.type.startsWith('tool-')) ||
        !toolNames.includes(name) ||
        !('toolCallId' in part) ||
        !('state' in part)
      ) {
        continue;
      }
      const input = 'input' in part && isRecord(part.input) ? part.input : {};
      calls.push({
        callId: part.toolCallId,
        id: textOf(input.id) ?? textOf(input.title) ?? part.toolCallId,
        input,
        state: part.state,
      });
    }
  }
  return calls;
};

/**
 * Builds the panel's props from AI SDK chat state. Every call to an artifact
 * tool is a version, and while its input is still streaming the partial
 * `content` is the text written so far, so the panel fills in live.
 *
 * @example
 * const { messages, stop } = useChat();
 * const artifact = artifactFromMessages(messages);
 * {artifact ? <ArtifactPanel {...artifact} onStop={stop} /> : null}
 */
export const artifactFromMessages = (
  messages: readonly UIMessage[],
  { toolNames = DEFAULT_TOOL_NAMES, id }: ArtifactSource = {},
): ArtifactFromMessages | null => {
  const calls = readCalls(messages, toolNames);
  const target = id ?? calls.at(-1)?.id;
  const own = calls.filter((call) => call.id === target);
  const last = own.at(-1);
  if (!target || !last) {
    return null;
  }
  let title: string | undefined;
  let language: string | undefined;
  let kind: unknown;
  const versions: ArtifactVersion[] = [];
  for (const call of own) {
    title = textOf(call.input.title) ?? title;
    language = textOf(call.input.language) ?? language;
    kind = call.input.kind ?? kind;
    if (typeof call.input.content === 'string') {
      versions.push({
        content: call.input.content,
        id: call.callId,
        label: textOf(call.input.label),
      });
    }
  }
  let status: ArtifactStatus = 'ready';
  if (last.state === 'input-streaming') {
    status = 'streaming';
  } else if (last.state === 'output-error') {
    status = 'error';
  }
  return {
    id: target,
    kind: kindOf(kind, language),
    language,
    status,
    title: title ?? 'Untitled',
    versions,
  };
};

export interface ArtifactPanelClassNames {
  root?: string;
  header?: string;
  body?: string;
  footer?: string;
}

export interface ArtifactPanelProps {
  title?: string;
  kind?: ArtifactKind;
  /** Shiki language id for code, such as `tsx`. Also picks the file extension. */
  language?: string;
  /** Oldest first. The last one is the latest. */
  versions?: readonly ArtifactVersion[];
  /** Applies to the latest version. */
  status?: ArtifactStatus;
  /** Message shown when `status` is `error`. */
  error?: string;
  /** Controlled version id. Leave unset to follow the latest. */
  version?: string;
  onVersionChange?: (version: ArtifactVersion) => void;
  defaultView?: ArtifactView;
  /**
   * Replaces the built-in preview, for kinds the panel does not draw itself
   * (HTML, Mermaid, a sheet). The source view stays available.
   */
  children?: (version: ArtifactVersion) => ReactNode;
  /** File name for the download. Defaults to one derived from `title`. */
  filename?: string;
  /** Called with the copied text after it reaches the clipboard. */
  onCopy?: (content: string) => void;
  /** Called after the file is handed to the browser. */
  onDownload?: (file: ArtifactFile) => void;
  /** Rendered only when passed, while an older version is in view. */
  onRestore?: (version: ArtifactVersion) => void;
  /** Rendered only when passed, while the latest version is streaming. */
  onStop?: () => void;
  /** Rendered only when passed. */
  onClose?: () => void;
  onFullScreenChange?: (fullScreen: boolean) => void;
  className?: string;
  classNames?: ArtifactPanelClassNames;
  /** Handy for overriding the --artifact-* theme vars inline */
  style?: CSSProperties;
}

const DEFAULT_VERSIONS: ArtifactVersion[] = [
  {
    content:
      'export const stopAfter = (steps: number) =>\n  ({ stepNumber }: { stepNumber: number }) => stepNumber >= steps;\n',
    id: 'v1',
  },
  {
    content:
      'import { stepCountIs } from "ai";\n\n/** Ends the loop after `steps` model calls. */\nexport const stopAfter = (steps: number) => stepCountIs(steps);\n',
    id: 'v2',
    label: 'Use stepCountIs',
  },
];

const COPIED_MS = 1600;
const STICK_PX = 32;
const MAX_SERIES = 4;
const CHART_HEIGHT = 248;
const PLOT = { bottom: 24, left: 40, right: 10, top: 12 };
const BAR_MAX = 24;
const BAR_GAP = 2;
const LABEL_PX = 56;
const TOOLTIP_HALF = 84;
const SKELETON_LINES = [
  { id: 'l1', width: '38%' },
  { id: 'l2', width: '86%' },
  { id: 'l3', width: '72%' },
  { id: 'l4', width: '80%' },
  { id: 'l5', width: '46%' },
] as const;

const ENTER_CLASS =
  'fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-300 ease-out motion-reduce:animate-none';

const THEME_VARS = [
  '[--artifact-document:#1d6496] dark:[--artifact-document:#6eb5dc]',
  '[--artifact-code:#7e4eb2] dark:[--artifact-code:#bf9deb]',
  '[--artifact-chart:#007273] dark:[--artifact-chart:#68c1c1]',
  '[--artifact-icon-bg:color-mix(in_oklab,var(--artifact-accent)_14%,var(--card))] dark:[--artifact-icon-bg:color-mix(in_oklab,var(--artifact-accent)_22%,var(--card))]',
  '[--artifact-well:var(--muted)] dark:[--artifact-well:var(--background)]',
  '[--artifact-series-1:#2a78d6] dark:[--artifact-series-1:#3987e5]',
  '[--artifact-series-2:#eb6834] dark:[--artifact-series-2:#d95926]',
  '[--artifact-series-3:#1baf7a] dark:[--artifact-series-3:#199e70]',
  '[--artifact-series-4:#eda100] dark:[--artifact-series-4:#c98500]',
  '[--artifact-grid:color-mix(in_oklab,var(--foreground)_9%,transparent)] dark:[--artifact-grid:color-mix(in_oklab,var(--foreground)_12%,transparent)]',
  '[--artifact-hairline:0_0_0_1px_rgba(0,0,0,0.06)] dark:[--artifact-hairline:0_0_0_1px_rgba(255,255,255,0.08)]',
  '[--artifact-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]',
  '[--artifact-shadow-hover:0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.08),0_2px_4px_0px_rgba(0,0,0,0.06)]',
  'dark:[--artifact-shadow:0_0_0_1px_rgba(255,255,255,0.08)]',
  'dark:[--artifact-shadow-hover:0_0_0_1px_rgba(255,255,255,0.13)]',
].join(' ');

const KIND_META: Record<
  ArtifactKind,
  {
    accent: string;
    icon: IconSvgElement;
    views: Record<ArtifactView, string> | null;
  }
> = {
  chart: {
    accent: 'var(--artifact-chart)',
    icon: ChartColumnIcon,
    views: { preview: 'Chart', source: 'Data' },
  },
  code: { accent: 'var(--artifact-code)', icon: SourceCodeIcon, views: null },
  document: {
    accent: 'var(--artifact-document)',
    icon: File02Icon,
    views: { preview: 'Preview', source: 'Markdown' },
  },
};

const CUSTOM_VIEWS: Record<ArtifactView, string> = {
  preview: 'Preview',
  source: 'Source',
};

const SERIES_COLORS = [
  'var(--artifact-series-1)',
  'var(--artifact-series-2)',
  'var(--artifact-series-3)',
  'var(--artifact-series-4)',
] as const;

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

const Icon = ({ icon, className }: { icon: IconSvgElement; className?: string }) => (
  <HugeiconsIcon aria-hidden="true" className={cn('size-3.5 flex-none', className)} icon={icon} strokeWidth={2} />
);

const HeadAction = ({
  label,
  pressed,
  disabled,
  slot,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  slot: string;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    aria-label={label}
    aria-pressed={pressed}
    className={cn(
      "relative flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out after:absolute after:-inset-1 after:content-[''] hover:enabled:bg-foreground/6 hover:enabled:text-card-foreground active:enabled:scale-[0.96] disabled:cursor-default disabled:opacity-40 motion-reduce:transition-none",
      FOCUS_CLASS,
    )}
    data-slot={slot}
    disabled={disabled}
    onClick={onClick}
    title={label}
    type="button"
  >
    {children}
  </button>
);

const ActionButton = ({ slot, onClick, children }: { slot: string; onClick: () => void; children: string }) => (
  <button
    className={cn(
      "relative z-0 inline-flex h-6 cursor-pointer items-center rounded-full border-0 bg-transparent px-2.5 text-xs leading-none font-medium whitespace-nowrap text-card-foreground transition-transform duration-150 ease-out before:absolute before:inset-0 before:-z-1 before:rounded-full before:bg-foreground/6 before:transition-colors before:duration-150 before:ease-out before:content-[''] after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] hover:before:bg-foreground/10 active:scale-[0.96] motion-reduce:transition-none",
      FOCUS_CLASS,
    )}
    data-slot={slot}
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);

const Shimmer = ({ children }: { children: string }) => {
  const reduce = useReducedMotion();
  if (reduce) {
    return <span>{children}</span>;
  }
  return (
    <motion.span
      animate={{ backgroundPosition: ['100% 0', '-100% 0'] }}
      className="bg-[linear-gradient(90deg,var(--muted-foreground)_40%,var(--card-foreground)_50%,var(--muted-foreground)_60%)] bg-[length:200%_100%] bg-clip-text text-transparent"
      transition={{
        duration: 1.8,
        ease: 'linear',
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </motion.span>
  );
};

const ViewToggle = ({
  labels,
  view,
  onChange,
}: {
  labels: Record<ArtifactView, string>;
  view: ArtifactView;
  onChange: (view: ArtifactView) => void;
}) => (
  <div
    aria-label="View"
    className="flex flex-none items-center gap-0.5 rounded-full bg-foreground/5 p-0.5"
    data-slot="artifact-panel-views"
    role="group"
  >
    {(['preview', 'source'] as const).map((id) => (
      <button
        aria-pressed={view === id}
        className={cn(
          "relative h-5 cursor-pointer rounded-full border-0 px-2 text-xs leading-none font-medium transition-[background-color,box-shadow,color] duration-150 ease-out after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] motion-reduce:transition-none",
          FOCUS_CLASS,
          view === id
            ? 'bg-card text-card-foreground shadow-(--artifact-shadow)'
            : 'bg-transparent text-muted-foreground hover:text-card-foreground',
        )}
        key={id}
        onClick={() => {
          onChange(id);
        }}
        type="button"
      >
        {labels[id]}
      </button>
    ))}
  </div>
);

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;

let highlighterPromise: Promise<Highlighter> | null = null;

const getHighlighter = () => {
  highlighterPromise ??= createHighlighter({
    langs: [],
    themes: ['github-light', 'github-dark'],
  });
  return highlighterPromise;
};

const bundledLanguage = (language: string): BundledLanguage | null => {
  const id = language.toLowerCase();
  // SAFETY: membership in `bundledLanguages` means `id` is a bundled language id.
  return id in bundledLanguages ? (id as BundledLanguage) : null;
};

interface CodeToken {
  content: string;
  light?: string;
  dark?: string;
}

const toToken = (token: ThemedToken): CodeToken => ({
  content: token.content,
  dark: token.htmlStyle?.['--shiki-dark'],
  light: token.htmlStyle?.['--shiki-light'],
});

interface Highlighted {
  source: string[];
  lines: CodeToken[][];
}

const highlight = async (code: string, language: string): Promise<Highlighted | null> => {
  const lang = bundledLanguage(language);
  if (!lang) {
    return null;
  }
  const highlighter = await getHighlighter();
  if (!highlighter.getLoadedLanguages().includes(lang)) {
    await highlighter.loadLanguage(lang);
  }
  const { tokens } = highlighter.codeToTokens(code, {
    defaultColor: false,
    lang,
    themes: { dark: 'github-dark', light: 'github-light' },
  });
  return {
    lines: tokens.map((line) => line.map(toToken)),
    source: code.split('\n'),
  };
};

const useHighlighted = (code: string, language: string): Highlighted | null => {
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const next = await highlight(code, language);
        if (!cancelled) {
          setHighlighted(next);
        }
      } catch {
        if (!cancelled) {
          setHighlighted(null);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return highlighted;
};

const CodeView = ({ code, language, wrap }: { code: string; language: string; wrap?: boolean }) => {
  const highlighted = useHighlighted(code, language);
  const lines = code.replace(/\n$/u, '').split('\n');
  return (
    <pre
      className="m-0 min-w-full py-2 font-mono text-xs leading-5"
      data-language={language}
      data-slot="artifact-panel-code"
    >
      <code className="grid grid-cols-[auto_minmax(0,1fr)]">
        {lines.map((line, index) => {
          // Colors arrive a moment after the text. A line keeps its plain
          // text until the highlighted copy matches it.
          const tokens = highlighted?.source[index] === line ? highlighted.lines[index] : undefined;
          return (
            <span
              className="col-span-2 grid grid-cols-subgrid"
              // oxlint-disable-next-line react/no-array-index-key -- lines are positions in a file
              key={index}
            >
              <span
                aria-hidden="true"
                className="sticky left-0 bg-(--artifact-well) pr-3 pl-3 text-right text-muted-foreground/60 tabular-nums select-none"
              >
                {index + 1}
              </span>
              <span className={cn('pr-4', wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre')}>
                {tokens
                  ? tokens.map((token, position) => (
                      <span
                        className="text-(--shiki-light) dark:text-(--shiki-dark)"
                        // oxlint-disable-next-line react/no-array-index-key -- tokens are positions in a line
                        key={position}
                        style={
                          // SAFETY: Shiki theme colors are valid CSS custom properties; CSSProperties omits `--*` keys.
                          {
                            '--shiki-dark': token.dark,
                            '--shiki-light': token.light,
                          } as CSSProperties
                        }
                      >
                        {token.content}
                      </span>
                    ))
                  : line || ' '}
              </span>
            </span>
          );
        })}
      </code>
    </pre>
  );
};

const useWidth = (ref: RefObject<HTMLElement | null>): number => {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return width;
};

/** A step of 1, 2, 2.5, 5, or 10 times a power of ten. */
const niceStep = (raw: number): number => {
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  if (unit <= 1) {
    return power;
  }
  if (unit <= 2) {
    return 2 * power;
  }
  if (unit <= 2.5) {
    return 2.5 * power;
  }
  return (unit <= 5 ? 5 : 10) * power;
};

const chartScale = (values: readonly number[]) => {
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const step = niceStep((top - bottom || 1) / 4);
  const max = Math.ceil(top / step) * step || step;
  const min = Math.floor(bottom / step) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) {
    ticks.push(Math.round(tick * 1e6) / 1e6);
  }
  return { max, min, ticks };
};

const COMPACT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
});
const FULL = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const valueLabel = (value: number | undefined, unit: string | undefined) =>
  value === undefined ? 'No value' : `${FULL.format(value)}${unit ?? ''}`;

const seriesLabel = (series: ArtifactChartSeries) => series.label ?? series.key;

const categoryOf = (row: Record<string, unknown>, x: string): string => {
  const value = row[x];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

/** A column with a rounded data end and a square foot on the baseline. */
const barPath = (x: number, width: number, from: number, to: number) => {
  const radius = Math.min(4, width / 2, Math.abs(to - from));
  const bend = to < from ? radius : -radius;
  return `M${x},${from}V${to + bend}Q${x},${to} ${x + radius},${to}H${x + width - radius}Q${x + width},${to} ${x + width},${to + bend}V${from}Z`;
};

const SeriesKey = ({ color, line }: { color: string; line: boolean }) => (
  <span
    aria-hidden="true"
    className={cn('flex-none bg-(--artifact-key)', line ? 'h-0.5 w-3 rounded-full' : 'size-2 rounded-[2px]')}
    style={
      // SAFETY: custom properties are valid CSS; CSSProperties omits `--*` keys.
      { '--artifact-key': color } as CSSProperties
    }
  />
);

const ChartTooltip = ({
  spec,
  series,
  row,
  left,
}: {
  spec: ArtifactChartSpec;
  series: readonly ArtifactChartSeries[];
  row: Record<string, unknown>;
  left: number;
}) => (
  <div
    className="pointer-events-none absolute top-1 z-10 flex w-max max-w-40 -translate-x-1/2 flex-col gap-1 rounded-lg bg-popover px-2 py-1.5 text-popover-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_2px_4px_-2px_rgba(0,0,0,0.08),0_8px_20px_-6px_rgba(0,0,0,0.14)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_8px_24px_-6px_rgba(0,0,0,0.6)]"
    data-slot="artifact-panel-tooltip"
    style={{ left }}
  >
    <span className="text-xs leading-4 text-muted-foreground">{categoryOf(row, spec.x)}</span>
    {series.map((item, index) => (
      <span className="flex items-center gap-1.5 text-xs leading-4" key={item.key}>
        <SeriesKey color={SERIES_COLORS[index] ?? SERIES_COLORS[0]} line />
        <span className="font-medium tabular-nums">{valueLabel(numberOf(row[item.key]), spec.unit)}</span>
        <span className="min-w-0 truncate text-muted-foreground">{seriesLabel(item)}</span>
      </span>
    ))}
  </div>
);

const ChartView = ({ spec }: { spec: ArtifactChartSpec }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [active, setActive] = useState<number | null>(null);

  const series = spec.series.slice(0, MAX_SERIES);
  const rows = spec.data;
  const line = spec.type === 'line';
  const values = rows.flatMap((row) => series.flatMap((item) => numberOf(row[item.key]) ?? []));
  const { max, min, ticks } = chartScale(values);
  const innerWidth = Math.max(0, width - PLOT.left - PLOT.right);
  const innerHeight = CHART_HEIGHT - PLOT.top - PLOT.bottom;
  const band = rows.length > 0 ? innerWidth / rows.length : 0;
  const xAt = (index: number) => PLOT.left + band * (index + 0.5);
  const yAt = (value: number) => PLOT.top + innerHeight * (1 - (value - min) / (max - min));
  const barWidth = Math.max(1, Math.min(BAR_MAX, (band * 0.72 - BAR_GAP * (series.length - 1)) / series.length));
  const groupWidth = barWidth * series.length + BAR_GAP * (series.length - 1);
  const labelEvery = Math.max(1, Math.ceil(LABEL_PX / Math.max(band, 1)));
  const activeRow = active === null ? undefined : rows[active];
  const hidden = spec.series.length - series.length;

  return (
    <div className="flex flex-col gap-2 p-3" data-slot="artifact-panel-chart">
      <div className="relative" ref={ref}>
        {width > 0 ? (
          <svg
            aria-label={`${line ? 'Line' : 'Bar'} chart of ${series.map(seriesLabel).join(', ')} by ${spec.x}`}
            className="block overflow-visible"
            height={CHART_HEIGHT}
            onPointerLeave={() => {
              setActive(null);
            }}
            role="group"
            width={width}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  stroke="var(--artifact-grid)"
                  strokeWidth={1}
                  x1={PLOT.left}
                  x2={width - PLOT.right}
                  y1={yAt(tick)}
                  y2={yAt(tick)}
                />
                <text
                  className="fill-muted-foreground text-[11px] tabular-nums"
                  dominantBaseline="middle"
                  textAnchor="end"
                  x={PLOT.left - 8}
                  y={yAt(tick)}
                >
                  {COMPACT.format(tick)}
                </text>
              </g>
            ))}
            {rows.map((row, index) =>
              index % labelEvery === 0 ? (
                <text
                  className="fill-muted-foreground text-[11px]"
                  // oxlint-disable-next-line react/no-array-index-key -- rows are positions on the axis
                  key={index}
                  textAnchor="middle"
                  x={xAt(index)}
                  y={CHART_HEIGHT - 6}
                >
                  {categoryOf(row, spec.x)}
                </text>
              ) : null,
            )}
            {line && active !== null ? (
              <line
                stroke="var(--artifact-grid)"
                strokeWidth={1}
                x1={xAt(active)}
                x2={xAt(active)}
                y1={PLOT.top}
                y2={PLOT.top + innerHeight}
              />
            ) : null}
            {series.map((item, position) => {
              const color = SERIES_COLORS[position] ?? SERIES_COLORS[0];
              const points = rows.flatMap((row, index) => {
                const value = numberOf(row[item.key]);
                return value === undefined ? [] : [{ index, x: xAt(index), y: yAt(value) }];
              });
              if (!line) {
                return (
                  <g key={item.key}>
                    {points.map((point) => (
                      <path
                        className="transition-opacity duration-150 ease-out motion-reduce:transition-none"
                        d={barPath(
                          point.x - groupWidth / 2 + position * (barWidth + BAR_GAP),
                          barWidth,
                          yAt(0),
                          point.y,
                        )}
                        fill={color}
                        key={point.index}
                        opacity={active === null || active === point.index ? 1 : 0.45}
                      />
                    ))}
                  </g>
                );
              }
              const end = points.at(-1);
              const marked = points.find((point) => point.index === active);
              return (
                <g key={item.key}>
                  <polyline
                    fill="none"
                    points={points.map((point) => `${point.x},${point.y}`).join(' ')}
                    stroke={color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                  {[end, marked].map((point, slot) =>
                    point ? (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        fill={color}
                        key={slot === 0 ? 'end' : 'active'}
                        r={4}
                        stroke="var(--artifact-well)"
                        strokeWidth={2}
                      />
                    ) : null,
                  )}
                </g>
              );
            })}
            {rows.map((row, index) => (
              <rect
                aria-label={`${categoryOf(row, spec.x)}: ${series
                  .map((item) => `${seriesLabel(item)} ${valueLabel(numberOf(row[item.key]), spec.unit)}`)
                  .join(', ')}`}
                className="outline-none focus-visible:fill-foreground/5"
                fill="transparent"
                height={innerHeight}
                // oxlint-disable-next-line react/no-array-index-key -- rows are positions on the axis
                key={index}
                onBlur={() => {
                  setActive(null);
                }}
                onFocus={() => {
                  setActive(index);
                }}
                onPointerEnter={() => {
                  setActive(index);
                }}
                role="img"
                tabIndex={0}
                width={band}
                x={PLOT.left + band * index}
                y={PLOT.top}
              />
            ))}
          </svg>
        ) : (
          <div style={{ height: CHART_HEIGHT }} />
        )}
        {active !== null && activeRow ? (
          <ChartTooltip
            left={Math.min(Math.max(xAt(active), TOOLTIP_HALF), Math.max(TOOLTIP_HALF, width - TOOLTIP_HALF))}
            row={activeRow}
            series={series}
            spec={spec}
          />
        ) : null}
      </div>
      {series.length > 1 ? (
        <ul
          className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 pl-10"
          data-slot="artifact-panel-legend"
        >
          {series.map((item, index) => (
            <li className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground" key={item.key}>
              <SeriesKey color={SERIES_COLORS[index] ?? SERIES_COLORS[0]} line={line} />
              {seriesLabel(item)}
            </li>
          ))}
          {hidden > 0 ? <li className="text-xs leading-4 text-muted-foreground">+{hidden} more in Data</li> : null}
        </ul>
      ) : null}
    </div>
  );
};

const CELL_CLASS = 'px-3 py-1.5 text-left align-top';

const DataTable = ({ spec }: { spec: ArtifactChartSpec }) => (
  <table className="w-full border-collapse text-[13px] leading-[1.45]" data-slot="artifact-panel-table">
    <thead>
      <tr>
        <th className={cn(CELL_CLASS, 'font-medium text-muted-foreground')} scope="col">
          {spec.x}
        </th>
        {spec.series.map((item) => (
          <th className={cn(CELL_CLASS, 'text-right font-medium text-muted-foreground')} key={item.key} scope="col">
            {seriesLabel(item)}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {spec.data.map((row, index) => (
        <tr
          className="border-t border-foreground/6"
          // oxlint-disable-next-line react/no-array-index-key -- rows have no id of their own
          key={index}
        >
          <th className={cn(CELL_CLASS, 'font-normal')} scope="row">
            {categoryOf(row, spec.x)}
          </th>
          {spec.series.map((item) => (
            <td className={cn(CELL_CLASS, 'text-right tabular-nums')} key={item.key}>
              {valueLabel(numberOf(row[item.key]), spec.unit)}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

/** Parses chart JSON as it streams, keeping the last chart that could be read. */
const useChart = (content: string): ArtifactChartSpec | null => {
  const [spec, setSpec] = useState<ArtifactChartSpec | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const { value } = await parsePartialJson(content);
      const next = artifactChart(value);
      if (!cancelled && next) {
        setSpec(next);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [content]);

  return spec;
};

const Skeleton = () => (
  <div aria-hidden="true" className="flex flex-col gap-3 p-4">
    {SKELETON_LINES.map((line) => (
      <span
        className="h-2.5 animate-pulse rounded-full bg-foreground/8 motion-reduce:animate-none"
        key={line.id}
        style={{ width: line.width }}
      />
    ))}
  </div>
);

const Note = ({ children }: { children: string }) => (
  <p className="m-0 p-4 text-[13px] leading-5 text-muted-foreground">{children}</p>
);

const ChartBody = ({ content, view, streaming }: { content: string; view: ArtifactView; streaming: boolean }) => {
  const spec = useChart(content);
  if (!spec) {
    return streaming ? <Skeleton /> : <Note>This chart could not be read. Check the data in the file.</Note>;
  }
  return view === 'source' ? <DataTable spec={spec} /> : <ChartView spec={spec} />;
};

const DOCUMENT_CLASS = [
  'mx-auto max-w-[44rem] p-4 text-sm leading-[1.6] [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  // Streamdown sizes headings for a full page. A side panel wants them quieter.
  '[&_h1]:mt-0 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:leading-snug [&_h1]:font-semibold [&_h1]:tracking-tight',
  '[&_h2]:mt-5 [&_h2]:mb-1.5 [&_h2]:text-[15px] [&_h2]:leading-snug [&_h2]:font-semibold [&_h2]:tracking-[-0.01em]',
  '[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold',
].join(' ');

const ArtifactBody = ({
  version,
  kind,
  language,
  view,
  streaming,
  custom,
}: {
  version: ArtifactVersion | undefined;
  kind: ArtifactKind;
  language: string | undefined;
  view: ArtifactView;
  streaming: boolean;
  custom: ((version: ArtifactVersion) => ReactNode) | undefined;
}) => {
  if (!version || version.content.trim() === '') {
    return streaming ? <Skeleton /> : <Note>Nothing here yet.</Note>;
  }
  if (custom && view === 'preview') {
    return custom(version);
  }
  if (kind === 'chart' && !custom) {
    return <ChartBody content={version.content} key={version.id} streaming={streaming} view={view} />;
  }
  if (kind === 'document' && view === 'preview') {
    return <Streamdown className={DOCUMENT_CLASS}>{version.content}</Streamdown>;
  }
  if (kind === 'document') {
    return <CodeView code={version.content} language="markdown" wrap />;
  }
  return <CodeView code={version.content} language={kind === 'chart' ? 'json' : (language ?? 'text')} />;
};

const VersionNav = ({ index, count, onStep }: { index: number; count: number; onStep: (index: number) => void }) => (
  <div className="flex flex-none items-center" data-slot="artifact-panel-versions">
    <HeadAction
      disabled={index <= 0}
      label="Previous version"
      onClick={() => {
        onStep(index - 1);
      }}
      slot="artifact-panel-previous"
    >
      <Icon className="size-3" icon={ArrowLeft01Icon} />
    </HeadAction>
    <span className="min-w-9 text-center text-xs leading-4 font-medium text-muted-foreground tabular-nums">
      {index + 1} / {count}
    </span>
    <HeadAction
      disabled={index >= count - 1}
      label="Next version"
      onClick={() => {
        onStep(index + 1);
      }}
      slot="artifact-panel-next"
    >
      <Icon className="size-3" icon={ArrowRight01Icon} />
    </HeadAction>
  </div>
);

/** Writes to the clipboard and reports `copied` for a moment afterwards. */
const useCopy = (onCopy: ((content: string) => void) | undefined) => {
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

const saveFile = ({ filename, content }: ArtifactFile) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

/**
 * Lifts the panel into the browser's top layer with the Popover API, so it
 * covers the window without moving in the DOM: scroll position, highlighted
 * code, and focus all survive. Escape brings it back.
 */
const useFullScreen = (ref: RefObject<HTMLElement | null>, onChange: ((fullScreen: boolean) => void) | undefined) => {
  const [fullScreen, setFullScreen] = useState(false);
  const [reserved, setReserved] = useState<number | undefined>();

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !fullScreen) {
      return;
    }
    element.setAttribute('popover', 'manual');
    if (typeof element.showPopover === 'function') {
      element.showPopover();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullScreen(false);
        onChange?.(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (element.matches(':popover-open')) {
        element.hidePopover();
      }
      element.removeAttribute('popover');
    };
  }, [fullScreen, onChange, ref]);

  const toggle = () => {
    const next = !fullScreen;
    // Holds the panel's place in the layout while it is lifted out of it.
    setReserved(next ? ref.current?.offsetHeight : undefined);
    setFullScreen(next);
    onChange?.(next);
  };

  return { fullScreen, reserved, toggle };
};

/** Keeps the latest text in view while it streams, until the reader scrolls up. */
const useFollow = (ref: RefObject<HTMLElement | null>, content: string, streaming: boolean) => {
  const stuck = useRef(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element && streaming && stuck.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [content, ref, streaming]);

  return () => {
    const element = ref.current;
    if (element) {
      stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_PX;
    }
  };
};

const countLabel = (count: number, noun: string) => `${FULL.format(count)} ${noun}${count === 1 ? '' : 's'}`;

const sizeLabel = (kind: ArtifactKind, content: string): string => {
  if (kind === 'document') {
    return countLabel(content.trim().split(/\s+/u).filter(Boolean).length, 'word');
  }
  return countLabel(content.replace(/\n$/u, '').split('\n').length, 'line');
};

export const ArtifactPanel = ({
  title = 'stop-after.ts',
  kind = 'code',
  language = 'typescript',
  versions = DEFAULT_VERSIONS,
  status = 'ready',
  error,
  version,
  onVersionChange,
  defaultView = 'preview',
  children,
  filename,
  onCopy,
  onDownload,
  onRestore,
  onStop,
  onClose,
  onFullScreenChange,
  className,
  classNames,
  style,
}: ArtifactPanelProps) => {
  const rootRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<ArtifactView>(defaultView);
  const { copied, copy } = useCopy(onCopy);
  const { fullScreen, reserved, toggle } = useFullScreen(rootRef, onFullScreenChange);

  const meta = KIND_META[kind];
  const views = children ? CUSTOM_VIEWS : meta.views;
  const lastIndex = versions.length - 1;
  const wanted = version ?? picked;
  const found = versions.findIndex((item) => item.id === wanted);
  const index = found === -1 ? lastIndex : found;
  const current = versions[index];
  const latest = index === lastIndex;
  const streaming = status === 'streaming' && latest;
  const content = current?.content ?? '';
  const onBodyScroll = useFollow(bodyRef, content, streaming);

  const step = (next: number) => {
    const target = versions[next];
    if (!target) {
      return;
    }
    // Landing on the newest version goes back to following new ones.
    setPicked(next === lastIndex ? null : target.id);
    onVersionChange?.(target);
  };

  const download = () => {
    const file = {
      content,
      filename: filename ?? artifactFilename(title, kind, language),
    };
    saveFile(file);
    onDownload?.(file);
  };

  let state: ArtifactStatus | 'history' = status;
  if (!latest) {
    state = 'history';
  }

  return (
    <div
      className={cn('flex min-h-72 w-full min-w-0', className)}
      data-slot="artifact-panel-frame"
      style={{ minHeight: reserved }}
    >
      <section
        aria-busy={streaming}
        aria-label={title}
        className={cn(
          THEME_VARS,
          'flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 rounded-2xl bg-card p-3 text-card-foreground shadow-(--artifact-shadow) transition-shadow duration-150 ease-out hover:shadow-(--artifact-shadow-hover)',
          'data-[full-screen]:fixed data-[full-screen]:inset-3 data-[full-screen]:z-50 data-[full-screen]:m-0 data-[full-screen]:h-auto data-[full-screen]:max-h-none data-[full-screen]:w-auto data-[full-screen]:max-w-none data-[full-screen]:overflow-visible data-[full-screen]:border-0 data-[full-screen]:backdrop:bg-black/40',
          classNames?.root,
        )}
        data-full-screen={fullScreen ? '' : undefined}
        data-kind={kind}
        data-slot="artifact-panel"
        data-state={state}
        ref={rootRef}
        style={
          // SAFETY: custom properties are valid CSS; CSSProperties omits `--*` keys.
          { '--artifact-accent': meta.accent, ...style } as CSSProperties
        }
      >
        <div
          className={cn(ENTER_CLASS, 'flex h-6 min-w-0 flex-none items-center gap-2', classNames?.header)}
          data-slot="artifact-panel-header"
        >
          <span className="inline-flex size-6 flex-none items-center justify-center rounded-md bg-(--artifact-icon-bg)">
            <Icon className="text-(--artifact-accent)" icon={meta.icon} />
          </span>
          <div className="min-w-0 flex-1 truncate text-[13px] leading-tight font-medium tracking-[-0.01em]">
            {title}
          </div>
          {views ? <ViewToggle labels={views} onChange={setView} view={view} /> : null}
          <div className="flex flex-none items-center gap-0.5">
            <HeadAction
              disabled={content === ''}
              label={copied ? 'Copied' : 'Copy'}
              onClick={() => {
                void copy(content);
              }}
              slot="artifact-panel-copy"
            >
              <Icon icon={copied ? Tick02Icon : Copy01Icon} />
            </HeadAction>
            <HeadAction
              disabled={content === '' || streaming}
              label="Download"
              onClick={download}
              slot="artifact-panel-download"
            >
              <Icon icon={Download01Icon} />
            </HeadAction>
            <HeadAction
              label={fullScreen ? 'Exit full screen' : 'Full screen'}
              onClick={toggle}
              pressed={fullScreen}
              slot="artifact-panel-full-screen"
            >
              <Icon icon={fullScreen ? MinimizeScreenIcon : MaximizeScreenIcon} />
            </HeadAction>
            {onClose ? (
              <HeadAction label="Close" onClick={onClose} slot="artifact-panel-close">
                <Icon icon={Cancel01Icon} />
              </HeadAction>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            ENTER_CLASS,
            'min-h-0 flex-1 overflow-auto rounded-lg bg-(--artifact-well) delay-100',
            classNames?.body,
          )}
          data-slot="artifact-panel-body"
          onScroll={onBodyScroll}
          ref={bodyRef}
          // Scrollable regions need to be reachable from the keyboard.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          <ArtifactBody
            custom={children}
            kind={kind}
            language={language}
            streaming={streaming}
            version={current}
            view={views ? view : 'source'}
          />
        </div>

        <div
          className={cn(ENTER_CLASS, 'flex min-h-6 min-w-0 flex-none items-center gap-2 delay-200', classNames?.footer)}
          data-slot="artifact-panel-footer"
        >
          {versions.length > 1 ? <VersionNav count={versions.length} index={index} onStep={step} /> : null}
          <output
            aria-live="polite"
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs leading-4',
              versions.length > 1 ? '' : 'pl-0.5',
              status === 'error' && latest ? 'text-destructive' : 'text-muted-foreground',
            )}
            data-slot="artifact-panel-status"
          >
            {streaming ? <Shimmer>Generating…</Shimmer> : null}
            {status === 'error' && latest ? (
              <span className="min-w-0 truncate">{error ?? 'This version did not finish.'}</span>
            ) : null}
            {!streaming && !(status === 'error' && latest) ? (
              <span className="min-w-0 truncate">
                {current?.label ?? (latest ? 'Latest' : `Version ${index + 1}`)}
                {content && kind !== 'chart' ? ` · ${sizeLabel(kind, content)}` : ''}
              </span>
            ) : null}
          </output>
          <div className="flex flex-none items-center gap-1.5">
            {streaming && onStop ? (
              <ActionButton onClick={onStop} slot="artifact-panel-stop">
                Stop
              </ActionButton>
            ) : null}
            {!latest && current && onRestore ? (
              <ActionButton
                onClick={() => {
                  onRestore(current);
                }}
                slot="artifact-panel-restore"
              >
                Restore
              </ActionButton>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
};
