'use client';

import {
  Add01Icon,
  ArrowUpRight01Icon,
  Books01Icon,
  File01Icon,
  Globe02Icon,
  TextIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import type { UIMessage } from 'ai';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

export type KnowledgeSourceKind = 'file' | 'site' | 'text';

export type KnowledgeSourceStatus = 'queued' | 'indexing' | 'ready' | 'failed';

export interface KnowledgeSource {
  /** Host description when this is an attached revision rather than an index. */
  detail?: string;
  id: string;
  name: string;
  /** Defaults to `site` when there is a `url`, otherwise `file`. */
  kind?: KnowledgeSourceKind;
  /** Opened in a new tab. Only `http` and `https` links are followed. */
  url?: string;
  /** Defaults to `ready`. */
  status?: KnowledgeSourceStatus;
  /** 0 to 1, while `indexing`. Chunks embedded over chunks to embed. */
  progress?: number;
  /** Chunks in the index. Shown as passages. */
  chunks?: number;
  /** Pages read from a file, or crawled from a site. */
  pages?: number;
  indexedAt?: Date | string | number;
  /** One plain sentence about what went wrong, for `failed`. */
  error?: string;
}

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

const safeHref = (url?: string): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
};

/** `docs.stripe.com/payments/3d-secure`, without the protocol or `www.`. */
const shortUrl = (href: string): string => {
  const url = new URL(href);
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/u, '');
  return `${url.hostname.replace(/^www\./u, '')}${path}`;
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/u;

/** `Oct 6`, or `Oct 6, 2025` for another year. */
const formatDate = (value?: Date | string | number, now: Date = new Date()): string | null => {
  if (value === undefined) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  // A bare `2026-10-06` is midnight UTC. Read it back in UTC so it stays Oct 6.
  const utc = typeof value === 'string' && DATE_ONLY_RE.test(value);
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: utc ? 'UTC' : undefined,
    year: year === now.getFullYear() ? undefined : 'numeric',
  });
};

const count = (value: number, one: string, many: string): string =>
  `${Math.round(value).toLocaleString('en-US')} ${value === 1 ? one : many}`;

const clamp = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * How often each source was cited in a conversation, keyed by source id. A
 * `source-url` part matches on `url`; a `source-document` part matches on its
 * `sourceId`, `filename`, or `title`.
 *
 * @example
 * const { messages } = useChat();
 * <KnowledgeSources
 *   citations={knowledgeSourceCitations(messages, sources)}
 *   sources={sources}
 * />
 */
export const knowledgeSourceCitations = (
  messages: readonly UIMessage[],
  sources: readonly KnowledgeSource[],
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    for (const part of message.parts) {
      let match: KnowledgeSource | undefined;
      if (part.type === 'source-url') {
        match = sources.find((source) => source.url === part.url || source.id === part.sourceId);
      } else if (part.type === 'source-document') {
        match = sources.find(
          (source) => source.id === part.sourceId || source.name === part.filename || source.name === part.title,
        );
      }
      if (match) {
        counts[match.id] = (counts[match.id] ?? 0) + 1;
      }
    }
  }
  return counts;
};

export interface KnowledgeSourcesClassNames {
  root?: string;
  header?: string;
  list?: string;
  item?: string;
  detail?: string;
  footer?: string;
}

export interface KnowledgeSourcesProps {
  sources?: readonly KnowledgeSource[];
  title?: string;
  emptyMessage?: string;
  /** Times each source was cited, keyed by id. See `knowledgeSourceCitations`. */
  citations?: Record<string, number>;
  /** Rendered only when passed. Open your file picker or link field here. */
  onAdd?: () => void;
  /** Rendered only when passed. Also used by Retry on a failed source. */
  onReindex?: (source: KnowledgeSource) => void;
  /** Rendered only when passed, while nothing is indexing. */
  onReindexAll?: () => void;
  /** Rendered only when passed. Called as soon as Remove is pressed. */
  onRemove?: (source: KnowledgeSource) => void;
  /** Adds an Undo after a remove. Called with the source to put back. */
  onRestore?: (source: KnowledgeSource) => void;
  className?: string;
  classNames?: KnowledgeSourcesClassNames;
  /** Handy for overriding the --knowledge-sources-* theme vars inline */
  style?: CSSProperties;
}

const DEFAULT_SOURCES: KnowledgeSource[] = [
  { chunks: 86, id: 'k1', name: 'Refund policy.pdf', pages: 12 },
  {
    chunks: 214,
    id: 'k2',
    name: 'Payments docs',
    pages: 38,
    url: 'https://docs.example.com/payments',
  },
  { id: 'k3', name: 'Support macros.md', progress: 0.4, status: 'indexing' },
];

const UNDO_MS = 6000;
const DONE_MS = 2200;
const EASE = [0.4, 0, 0.2, 1] as const;

const ENTER_CLASS =
  'fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-300 ease-out motion-reduce:animate-none';

const THEME_VARS = [
  '[--knowledge-sources-accent:#3d4d9c] dark:[--knowledge-sources-accent:#8b9ae0]',
  '[--knowledge-sources-done:#15803d] dark:[--knowledge-sources-done:#4ade80]',
  '[--knowledge-sources-icon-bg:color-mix(in_oklab,var(--knowledge-sources-accent)_14%,var(--card))] dark:[--knowledge-sources-icon-bg:color-mix(in_oklab,var(--knowledge-sources-accent)_22%,var(--card))]',
  '[--knowledge-sources-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]',
  '[--knowledge-sources-shadow-hover:0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.08),0_2px_4px_0px_rgba(0,0,0,0.06)]',
  'dark:[--knowledge-sources-shadow:0_0_0_1px_rgba(255,255,255,0.08)]',
  'dark:[--knowledge-sources-shadow-hover:0_0_0_1px_rgba(255,255,255,0.13)]',
].join(' ');

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

const ICON_BUTTON_CLASS = cn(
  "relative flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out after:absolute after:-inset-1 after:content-[''] hover:bg-foreground/6 hover:text-card-foreground active:scale-[0.96] motion-reduce:transition-none",
  FOCUS_CLASS,
);

const TEXT_ACTION_CLASS = cn(
  'flex-none cursor-pointer rounded-[4px] border-0 bg-transparent p-0 text-xs leading-4 font-medium text-muted-foreground no-underline transition-colors duration-150 ease-out hover:text-card-foreground motion-reduce:transition-none',
  FOCUS_CLASS,
);

const KIND_ICON: Record<KnowledgeSourceKind, IconSvgElement> = {
  file: File01Icon,
  site: Globe02Icon,
  text: TextIcon,
};

const Icon = ({ icon, className }: { icon: IconSvgElement; className?: string }) => (
  <HugeiconsIcon aria-hidden="true" className={cn('size-3.5 flex-none', className)} icon={icon} strokeWidth={2} />
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

const statusOf = (source: KnowledgeSource): KnowledgeSourceStatus => source.status ?? 'ready';

const isBusy = (source: KnowledgeSource): boolean => statusOf(source) === 'indexing' || statusOf(source) === 'queued';

/** True for a moment after a source finishes indexing. */
const useJustFinished = (status: KnowledgeSourceStatus): boolean => {
  const previous = useRef(status);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (status === 'ready' && (was === 'indexing' || was === 'queued')) {
      setFinished(true);
    } else if (status !== 'ready') {
      setFinished(false);
    }
  }, [status]);

  useEffect(() => {
    if (!finished) {
      return;
    }
    const timer = setTimeout(() => {
      setFinished(false);
    }, DONE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [finished]);

  return finished;
};

/** A check that draws itself, then leaves. */
const DoneMark = () => {
  const reduce = useReducedMotion();
  return (
    <motion.span
      animate={{ opacity: 1, scale: 1 }}
      className="flex size-4 flex-none items-center justify-center text-(--knowledge-sources-done)"
      data-slot="knowledge-sources-done"
      exit={{ opacity: 0, scale: 0.8 }}
      initial={reduce ? false : { opacity: 0, scale: 0.6 }}
      transition={{ duration: reduce ? 0 : 0.2, ease: EASE }}
    >
      <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
        <motion.path
          animate={{ pathLength: 1 }}
          d="M3.5 8.5l3 3 6-7"
          initial={reduce ? false : { pathLength: 0 }}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.75"
          transition={{ delay: 0.08, duration: reduce ? 0 : 0.3, ease: EASE }}
        />
      </svg>
      <span className="sr-only">Indexed</span>
    </motion.span>
  );
};

/** What a row says on its right. A source that is fine says nothing. */
const RowNote = ({ source, finished }: { source: KnowledgeSource; finished: boolean }) => {
  const status = statusOf(source);
  if (status === 'ready') {
    return <AnimatePresence initial={false}>{finished ? <DoneMark key="done" /> : null}</AnimatePresence>;
  }
  if (status === 'failed') {
    return <span className="flex-none text-xs leading-4 text-destructive">Failed</span>;
  }
  return (
    <span className="flex-none text-xs leading-4 text-muted-foreground tabular-nums">
      {status === 'queued' ? 'Waiting' : `${Math.round(clamp(source.progress) * 100)}%`}
    </span>
  );
};

/** One line of facts about a source that is in the index. */
const factsOf = (source: KnowledgeSource, cited: number): string =>
  [
    source.chunks === undefined ? null : count(source.chunks, 'passage', 'passages'),
    source.pages === undefined ? null : count(source.pages, 'page', 'pages'),
    formatDate(source.indexedAt) && `Indexed ${formatDate(source.indexedAt)}`,
    cited > 0 && `Cited ${count(cited, 'time', 'times')} here`,
  ]
    .filter(Boolean)
    .join(' · ');

const detailText = (source: KnowledgeSource, cited: number): string => {
  const status = statusOf(source);
  if (status === 'failed') {
    return source.error ?? 'This source could not be read.';
  }
  if (status === 'queued') {
    return 'Waiting for the sources ahead of it.';
  }
  if (status === 'indexing') {
    return 'Reading and indexing. You can keep working.';
  }
  return source.detail ?? (factsOf(source, cited) || 'In the index.');
};

const SourceItem = ({
  source,
  cited,
  open,
  classNames,
  onToggle,
  onReindex,
  onRemove,
}: {
  source: KnowledgeSource;
  cited: number;
  open: boolean;
  classNames?: KnowledgeSourcesClassNames;
  onToggle: () => void;
  onReindex?: () => void;
  onRemove?: () => void;
}) => {
  const reduce = useReducedMotion();
  const transition = { duration: reduce ? 0 : 0.2, ease: EASE };
  const status = statusOf(source);
  const finished = useJustFinished(status);
  const href = safeHref(source.url);
  const kind = source.kind ?? (source.url ? 'site' : 'file');
  return (
    <motion.li
      animate={{ height: 'auto', opacity: 1 }}
      className="overflow-hidden"
      data-slot="knowledge-sources-item"
      data-status={status}
      exit={{ height: 0, opacity: 0 }}
      initial={{ height: 0, opacity: 0 }}
      transition={transition}
    >
      <div
        className={cn(
          'rounded-lg transition-colors duration-150 ease-out motion-reduce:transition-none',
          open ? 'bg-muted dark:bg-background' : 'hover:bg-foreground/4',
          classNames?.item,
        )}
      >
        <button
          aria-expanded={open}
          className={cn(
            'flex w-full min-w-0 cursor-pointer flex-col rounded-lg border-0 bg-transparent px-2 py-1.5 text-left',
            FOCUS_CLASS,
          )}
          data-slot="knowledge-sources-source"
          onClick={onToggle}
          type="button"
        >
          <span className="flex w-full min-w-0 items-center gap-2">
            <Icon className="text-muted-foreground" icon={KIND_ICON[kind]} />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm leading-5',
                isBusy(source) ? 'text-muted-foreground' : 'text-card-foreground',
              )}
            >
              {source.name}
            </span>
            <RowNote finished={finished} source={source} />
          </span>
          <AnimatePresence initial={false}>
            {status === 'indexing' ? (
              <motion.span
                animate={{ height: 'auto', opacity: 1 }}
                className="block w-full overflow-hidden"
                exit={{ height: 0, opacity: 0 }}
                initial={{ height: 0, opacity: 0 }}
                key="progress"
                transition={transition}
              >
                <span className="block pt-1.5 pl-5.5">
                  <span
                    aria-label={`${Math.round(clamp(source.progress) * 100)} percent indexed`}
                    className="block h-[3px] rounded-full bg-foreground/8"
                    role="img"
                  >
                    <span
                      className="block h-full rounded-full bg-foreground/45 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                      style={{ width: `${clamp(source.progress) * 100}%` }}
                    />
                  </span>
                </span>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </button>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              animate={{ height: 'auto', opacity: 1 }}
              className="overflow-hidden"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              key="detail"
              transition={transition}
            >
              <div
                className={cn(
                  'flex flex-col gap-2 pt-0.5 pr-2 pb-2 pl-7.5 text-xs leading-[1.5] text-muted-foreground',
                  classNames?.detail,
                )}
                data-slot="knowledge-sources-detail"
              >
                <span
                  className={cn('text-pretty tabular-nums', status === 'failed' && 'text-card-foreground')}
                  suppressHydrationWarning
                >
                  {detailText(source, cited)}
                </span>
                <div className="flex min-w-0 items-center gap-3 leading-4">
                  <span className="min-w-0 flex-1">
                    {href ? (
                      <a
                        className={cn(
                          TEXT_ACTION_CLASS,
                          'inline-flex max-w-full min-w-0 items-center gap-1 font-normal',
                        )}
                        href={href}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <span className="min-w-0 truncate">{shortUrl(href)}</span>
                        <Icon className="size-3" icon={ArrowUpRight01Icon} />
                      </a>
                    ) : null}
                  </span>
                  {onReindex && !isBusy(source) ? (
                    <button
                      className={TEXT_ACTION_CLASS}
                      data-slot="knowledge-sources-reindex"
                      onClick={onReindex}
                      type="button"
                    >
                      {status === 'failed' ? 'Retry' : 'Re-index'}
                    </button>
                  ) : null}
                  {onRemove ? (
                    <button
                      className={cn(TEXT_ACTION_CLASS, 'hover:text-destructive')}
                      data-slot="knowledge-sources-remove"
                      onClick={onRemove}
                      type="button"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.li>
  );
};

/** Holds a value for a moment, then lets it go. */
const useExpiring = <T,>(ms: number) => {
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    if (value === null) {
      return;
    }
    const timer = setTimeout(() => {
      setValue(null);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [ms, value]);

  return [value, setValue] as const;
};

/** The one thing worth saying about the whole index right now. */
const summaryOf = (sources: readonly KnowledgeSource[]) => {
  const busy = sources.filter(isBusy).length;
  const failed = sources.filter((source) => statusOf(source) === 'failed').length;
  if (busy > 0) {
    return { busy: true, text: `Indexing ${busy} of ${sources.length}…` };
  }
  if (failed > 0) {
    return {
      busy: false,
      text: `${failed} could not be indexed`,
    };
  }
  const chunks = sources.reduce((total, source) => total + (source.chunks ?? 0), 0);
  return {
    busy: false,
    text: chunks > 0 ? `${count(chunks, 'passage', 'passages')} to search` : '',
  };
};

/**
 * What an agent can search: files and sites in its index. A source that is
 * fine shows only its name. Indexing shows progress, a failure says so, and
 * opening a source shows the details with Re-index and Remove.
 *
 * Feed `progress` from your ingest job: chunks embedded with `embedMany` over
 * chunks to embed.
 */
export const KnowledgeSources = ({
  sources = DEFAULT_SOURCES,
  title = 'Knowledge',
  emptyMessage = 'Nothing to search yet. Add files or sites and the agent can cite them.',
  citations = {},
  onAdd,
  onReindex,
  onReindexAll,
  onRemove,
  onRestore,
  className,
  classNames,
  style,
}: KnowledgeSourcesProps) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [removed, setRemoved] = useExpiring<KnowledgeSource>(UNDO_MS);
  const summary = summaryOf(sources);
  const canReindexAll = Boolean(onReindexAll) && !summary.busy && sources.length > 0;

  return (
    <section
      aria-label={title}
      className={cn(
        THEME_VARS,
        'flex w-full max-w-full min-w-0 flex-col gap-3 rounded-2xl bg-card p-3 text-card-foreground shadow-(--knowledge-sources-shadow) transition-shadow duration-150 ease-out hover:shadow-(--knowledge-sources-shadow-hover)',
        className,
        classNames?.root,
      )}
      data-slot="knowledge-sources"
      style={style}
    >
      <div
        className={cn(ENTER_CLASS, 'flex h-6 min-w-0 items-center gap-2', classNames?.header)}
        data-slot="knowledge-sources-header"
      >
        <span className="inline-flex size-6 flex-none items-center justify-center rounded-md bg-(--knowledge-sources-icon-bg)">
          <Icon className="text-(--knowledge-sources-accent)" icon={Books01Icon} />
        </span>
        <div className="min-w-0 flex-1 truncate text-[13px] leading-tight font-medium tracking-[-0.01em]">{title}</div>
        {onAdd ? (
          <button
            aria-label="Add a source"
            className={ICON_BUTTON_CLASS}
            data-slot="knowledge-sources-add"
            onClick={onAdd}
            title="Add a source"
            type="button"
          >
            <Icon icon={Add01Icon} />
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          ENTER_CLASS,
          '-mx-0.5 -mr-1.5 flex max-h-96 min-h-0 flex-col overflow-y-auto pr-1 delay-100',
          classNames?.list,
        )}
        data-slot="knowledge-sources-list"
      >
        <ul className="m-0 flex list-none flex-col p-0">
          <AnimatePresence initial={false}>
            {sources.map((source) => (
              <SourceItem
                cited={citations[source.id] ?? 0}
                classNames={classNames}
                key={source.id}
                onReindex={
                  onReindex
                    ? () => {
                        onReindex(source);
                      }
                    : undefined
                }
                onRemove={
                  onRemove
                    ? () => {
                        setOpenId(null);
                        setRemoved(onRestore ? source : null);
                        onRemove(source);
                      }
                    : undefined
                }
                onToggle={() => {
                  setOpenId(openId === source.id ? null : source.id);
                }}
                open={openId === source.id}
                source={source}
              />
            ))}
          </AnimatePresence>
        </ul>
        {sources.length === 0 ? (
          <p
            className="m-0 px-2 py-6 text-center text-[13px] leading-[1.45] text-pretty text-muted-foreground"
            data-slot="knowledge-sources-empty"
          >
            {emptyMessage}
          </p>
        ) : null}
      </div>

      {removed || summary.text || canReindexAll ? (
        <div
          className={cn('flex min-h-6 min-w-0 items-center gap-2 px-1.5', classNames?.footer)}
          data-slot="knowledge-sources-footer"
        >
          <output
            aria-live="polite"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-xs leading-4 text-muted-foreground tabular-nums"
            data-slot="knowledge-sources-status"
          >
            {removed ? (
              <>
                <span className="min-w-0 truncate">Removed.</span>
                <button
                  className={cn(TEXT_ACTION_CLASS, 'text-card-foreground')}
                  data-slot="knowledge-sources-undo"
                  onClick={() => {
                    onRestore?.(removed);
                    setRemoved(null);
                  }}
                  type="button"
                >
                  Undo
                </button>
              </>
            ) : null}
            {!removed && summary.busy ? <Shimmer>{summary.text}</Shimmer> : null}
            {!removed && !summary.busy ? <span className="min-w-0 truncate">{summary.text}</span> : null}
          </output>
          {canReindexAll ? (
            <button
              className={TEXT_ACTION_CLASS}
              data-slot="knowledge-sources-reindex-all"
              onClick={onReindexAll}
              type="button"
            >
              Re-index all
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
