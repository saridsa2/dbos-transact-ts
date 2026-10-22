'use client';
/** Licensed AI SDK Agents source; original retained in upstream/. Host control adaptations only. */

import {
  Add01Icon,
  Copy01Icon,
  Delete02Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RoboticIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useDeferredValue, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import { Button } from './host-controls';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { Input } from './host-controls';
import { SearchLg } from '@/components/fa-icons';
import { cn } from '@/lib/utils';

/**
 * `live` is published and answering. `draft` has never been published.
 * `paused` was published and is switched off.
 */
export type AgentListStatus = 'live' | 'draft' | 'paused';

/** What happened the last time the agent ran. */
export interface AgentListRun {
  status: 'running' | 'done' | 'error';
  /** Epoch milliseconds: when the run started, or when it ended. */
  at?: number;
  /** One sentence, shown on the row when the run failed. */
  error?: string;
}

export interface AgentListAgent {
  id: string;
  name: string;
  /** One line on what the agent does. */
  description?: string;
  /** A brand mark or avatar. Without one the row shows a monogram. */
  icon?: ReactNode;
  /** Defaults to `live`. */
  status?: AgentListStatus;
  owner?: { name: string; avatarUrl?: string };
  lastRun?: AgentListRun;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const clean = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;

/** `now`, `4m`, `3h`, `2d`, `5w`, then `8mo` and `2y`. */
export const formatAgo = (ms: number): string => {
  const value = clean(ms);
  if (value < MINUTE) {
    return 'now';
  }
  if (value < HOUR) {
    return `${Math.floor(value / MINUTE)}m`;
  }
  if (value < DAY) {
    return `${Math.floor(value / HOUR)}h`;
  }
  if (value < 7 * DAY) {
    return `${Math.floor(value / DAY)}d`;
  }
  if (value < 60 * DAY) {
    return `${Math.floor(value / (7 * DAY))}w`;
  }
  if (value < 365 * DAY) {
    return `${Math.floor(value / (30 * DAY))}mo`;
  }
  return `${Math.floor(value / (365 * DAY))}y`;
};

/** The parts of an AI SDK `generateText` or `agent.generate` result a row reads. */
export interface AgentListResultSource {
  finishReason?: string;
  response?: { timestamp?: Date };
}

/**
 * The last run of an agent, from an AI SDK result. Pass the caught error's
 * message as `error` when the call threw instead of returning.
 *
 * @example
 * const result = await agent.generate({ prompt });
 * await saveLastRun(agent.id, agentListRunFromResult(result));
 */
export const agentListRunFromResult = (result: AgentListResultSource | undefined, error?: string): AgentListRun => {
  const failed = error !== undefined || result?.finishReason === 'error';
  return {
    at: result?.response?.timestamp?.getTime() ?? Date.now(),
    error: failed ? error : undefined,
    status: failed ? 'error' : 'done',
  };
};

/**
 * A row for an AI SDK agent. The agent carries its own `id`; the name and the
 * rest come from wherever the app keeps them.
 *
 * @example
 * const triage = new ToolLoopAgent({ id: "billing-triage", model, tools });
 * agentListAgent(triage, { name: "Billing triage", status: "live" });
 */
export const agentListAgent = (
  agent: { id?: string },
  details: Omit<AgentListAgent, 'id'> & { id?: string },
): AgentListAgent => ({
  ...details,
  id: details.id ?? agent.id ?? details.name,
});

export interface AgentListClassNames {
  root?: string;
  header?: string;
  summary?: string;
  search?: string;
  list?: string;
  row?: string;
  icon?: string;
  name?: string;
  line?: string;
  tag?: string;
  menu?: string;
}

/**
 * Every agent in a workspace, one row each. UI only: the caller stores the
 * agents and passes them in, and each callback names the agent it is about.
 *
 * @example
 * <AgentList
 *   agents={agents}
 *   onCreate={() => router.push("/agents/new")}
 *   onOpen={(agent) => router.push(`/agents/${agent.id}`)}
 *   onStatusChange={(agent, status) => saveStatus(agent.id, status)}
 * />
 */
export interface AgentListProps {
  agents?: readonly AgentListAgent[];
  title?: string;
  /** Shows placeholder rows while the first page of agents is on its way. */
  loading?: boolean;
  /** The agent whose page is open, in a list that sits beside it. */
  selectedId?: string;
  /** Makes each row a button. */
  onOpen?: (agent: AgentListAgent) => void;
  /** Shows the New agent button. */
  onCreate?: () => void;
  /** Adds Pause and Resume to the row menu of a published agent. */
  onStatusChange?: (agent: AgentListAgent, status: Exclude<AgentListStatus, 'draft'>) => void;
  /** Adds Duplicate to the row menu. */
  onDuplicate?: (agent: AgentListAgent) => void;
  /** Adds Delete to the row menu. It takes two presses. */
  onDelete?: (agent: AgentListAgent) => void;
  /** Shows a search field. Defaults to on for more than eight agents. */
  searchable?: boolean;
  /**
   * `attention` lifts agents whose last run failed to the top. `given` keeps
   * the order of `agents`.
   */
  order?: 'attention' | 'given';
  /** Pins the clock that "4m" is counted against. */
  now?: number;
  className?: string;
  classNames?: AgentListClassNames;
  /** Handy for overriding the --agent-list-* theme vars inline */
  style?: CSSProperties;
}

const SEARCH_THRESHOLD = 8;
const CLOCK_TICK_MS = 30_000;
const NO_AGENTS: readonly AgentListAgent[] = [];
const PLACEHOLDER_ROWS = ['w-28', 'w-36', 'w-24'] as const;

const THEME_VARS = [
  '[--agent-list-accent:#7e4eb2] dark:[--agent-list-accent:#bf9deb]',
  '[--agent-list-error:var(--destructive)]',
  '[--agent-list-tone-1:#7e4eb2] dark:[--agent-list-tone-1:#bf9deb]',
  '[--agent-list-tone-2:#1d6496] dark:[--agent-list-tone-2:#6eb5dc]',
  '[--agent-list-tone-3:#007273] dark:[--agent-list-tone-3:#68c1c1]',
  '[--agent-list-tone-4:#8f3d62] dark:[--agent-list-tone-4:#e090b0]',
  '[--agent-list-icon-bg:color-mix(in_oklab,var(--agent-list-accent)_14%,var(--card))] dark:[--agent-list-icon-bg:color-mix(in_oklab,var(--agent-list-accent)_22%,var(--card))]',
  '[--agent-list-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]',
  '[--agent-list-shadow-hover:0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.08),0_2px_4px_0px_rgba(0,0,0,0.06)]',
  'dark:[--agent-list-shadow:0_0_0_1px_rgba(255,255,255,0.08)]',
  'dark:[--agent-list-shadow-hover:0_0_0_1px_rgba(255,255,255,0.13)]',
].join(' ');

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

const ENTER_CLASS =
  'fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-300 ease-out motion-reduce:animate-none';

const TAG_CLASS =
  'inline-flex h-[18px] flex-none items-center rounded-full bg-foreground/6 px-1.5 text-[11px] leading-none font-medium text-muted-foreground';

const TONES = [
  'var(--agent-list-tone-1)',
  'var(--agent-list-tone-2)',
  'var(--agent-list-tone-3)',
  'var(--agent-list-tone-4)',
] as const;

const ROW_SLOT = 'agent-list-open';

/** Rows trade places without overshoot, and a caught one carries on. */
const MOVE = { bounce: 0, duration: 0.3, type: 'spring' } as const;

/** The same tone for the same agent on every render and every machine. */
const toneOf = (id: string): string => {
  let sum = 0;
  for (const char of id) {
    sum += char.codePointAt(0) ?? 0;
  }
  return TONES[sum % TONES.length] ?? TONES[0];
};

const statusOf = (agent: AgentListAgent): AgentListStatus => agent.status ?? 'live';

const hasFailed = (agent: AgentListAgent): boolean => agent.lastRun?.status === 'error';

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** `4 live, 1 draft, 1 paused`: only the kinds the list holds. */
const countsSentence = (agents: readonly AgentListAgent[]): string => {
  const count = (status: AgentListStatus): number => agents.filter((agent) => statusOf(agent) === status).length;
  const parts = [
    count('live') > 0 ? `${count('live')} live` : null,
    count('draft') > 0 ? plural(count('draft'), 'draft', 'drafts') : null,
    count('paused') > 0 ? `${count('paused')} paused` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? `${parts.join(', ')}.` : '';
};

const failedSentence = (agents: readonly AgentListAgent[]): string | null => {
  const failed = agents.filter(hasFailed);
  if (failed.length === 0) {
    return null;
  }
  return failed.length === 1 ? `${failed[0]?.name} failed its last run.` : `${failed.length} failed their last run.`;
};

/**
 * A clock that moves every half minute, which is as often as "4m" can change.
 * One timer serves every row.
 */
const useClock = (pinned: number | undefined): number => {
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (pinned !== undefined) {
      return;
    }
    const timer = setInterval(() => {
      setClock(Date.now());
    }, CLOCK_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [pinned]);

  return pinned ?? clock;
};

const AgentMark = ({ agent, className }: { agent: AgentListAgent; className?: string }) => (
  <span
    aria-hidden="true"
    className={cn(
      'inline-flex size-7 flex-none items-center justify-center rounded-lg text-xs leading-none font-semibold uppercase transition-[opacity,filter] duration-200 ease-out motion-reduce:transition-none [&_img]:size-full [&_img]:rounded-[inherit] [&_img]:object-cover [&_svg]:size-4',
      agent.icon
        ? 'bg-muted dark:bg-background'
        : 'bg-[color-mix(in_oklab,var(--agent-list-tone)_14%,var(--card))] text-(--agent-list-tone) dark:bg-[color-mix(in_oklab,var(--agent-list-tone)_22%,var(--card))]',
      statusOf(agent) === 'paused' && 'opacity-55 grayscale',
      className,
    )}
    data-slot="agent-list-icon"
    style={{ '--agent-list-tone': toneOf(agent.id) } as CSSProperties}
  >
    {agent.icon ?? [...agent.name.trim()][0] ?? 'A'}
  </span>
);

/** The one thing a row says under the agent's name. */
const RowLine = ({ agent, className, now }: { agent: AgentListAgent; className?: string; now: number }) => {
  const status = statusOf(agent);
  const run = agent.lastRun;
  const base = cn('block truncate text-xs leading-4', className);

  if (run?.status === 'running') {
    return (
      <span className={cn(base, 'flex items-center gap-1 text-muted-foreground')} data-slot="agent-list-line">
        <HugeiconsIcon
          aria-hidden="true"
          className="size-3 flex-none animate-spin text-(--agent-list-accent) motion-reduce:animate-none"
          icon={Loading03Icon}
          strokeWidth={2.5}
        />
        <span className="truncate">Running now</span>
      </span>
    );
  }
  if (run?.status === 'error') {
    const when = run.at === undefined ? '' : ` ${formatAgo(now - run.at)} ago`.replace(' now ago', ' just now');
    const text = `Failed${when}${run.error ? `. ${run.error}` : ''}`;
    return (
      <span
        // The reason is the one thing on the row worth reading in full.
        className={cn('line-clamp-2 text-xs leading-4 text-pretty text-(--agent-list-error)', className)}
        data-slot="agent-list-line"
        suppressHydrationWarning
        title={text}
      >
        {text}
      </span>
    );
  }
  const fallback: Record<AgentListStatus, string> = {
    draft: 'Not published yet',
    live: 'No runs yet',
    paused: 'Switched off',
  };
  const text = agent.description ?? fallback[status];
  return (
    <span className={cn(base, 'text-muted-foreground')} data-slot="agent-list-line" title={text}>
      {text}
    </span>
  );
};

interface RowMenuProps {
  agent: AgentListAgent;
  className?: string;
  onDelete?: (agent: AgentListAgent) => void;
  onDuplicate?: (agent: AgentListAgent) => void;
  onStatusChange?: AgentListProps['onStatusChange'];
}

const MENU_ITEM_CLASS = 'gap-2 text-[13px] [&_svg]:size-3.5';

const RowMenu = ({ agent, onStatusChange, onDuplicate }: RowMenuProps) =>
  !onDuplicate && (!onStatusChange || statusOf(agent) === 'draft') ? null : (
    <Dropdown.Root>
      <Dropdown.DotsButton aria-label={`Actions for ${agent.name}`} />
      <Dropdown.Popover>
        <Dropdown.Menu aria-label={`Actions for ${agent.name}`}>
          {onStatusChange && statusOf(agent) !== 'draft' ? (
            <Dropdown.Item
              id="status"
              label={statusOf(agent) === 'paused' ? 'Resume' : 'Pause'}
              onAction={() => onStatusChange(agent, statusOf(agent) === 'paused' ? 'live' : 'paused')}
            />
          ) : null}
          {onDuplicate ? <Dropdown.Item id="duplicate" label="Duplicate" onAction={() => onDuplicate(agent)} /> : null}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown.Root>
  );

export const AgentList = ({
  agents = NO_AGENTS,
  title = 'Agents',
  loading = false,
  selectedId,
  onOpen,
  onCreate,
  onStatusChange,
  onDuplicate,
  onDelete,
  searchable,
  order = 'attention',
  now,
  className,
  classNames,
  style,
}: AgentListProps) => {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const clock = useClock(now);

  const showSearch = searchable ?? agents.length > SEARCH_THRESHOLD;
  const needle = showSearch ? deferredQuery.trim().toLowerCase() : '';
  const matching = needle
    ? agents.filter((agent) =>
        `${agent.name} ${agent.description ?? ''} ${agent.owner?.name ?? ''}`.toLowerCase().includes(needle),
      )
    : agents;
  const shown =
    order === 'attention'
      ? [...matching.filter(hasFailed), ...matching.filter((agent) => !hasFailed(agent))]
      : matching;
  const failed = failedSentence(agents);
  const hasMenu = Boolean(onStatusChange ?? onDuplicate ?? onDelete);

  /** Arrow keys walk the rows, the way they do in any list. */
  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || !listRef.current) {
      return;
    }
    const rows = [...listRef.current.querySelectorAll<HTMLElement>(`[data-slot="${ROW_SLOT}"]`)];
    const at = rows.findIndex((row) => row === document.activeElement);
    if (at === -1) {
      return;
    }
    event.preventDefault();
    const next = {
      ArrowDown: Math.min(rows.length - 1, at + 1),
      ArrowUp: Math.max(0, at - 1),
      End: rows.length - 1,
      Home: 0,
    }[event.key];
    rows[next ?? at]?.focus();
  };

  const renderRow = (agent: AgentListAgent) => {
    const status = statusOf(agent);
    const selected = agent.id === selectedId;
    const run = agent.lastRun;
    const quiet = run?.status === 'done' && run.at !== undefined;
    const tag = { draft: 'Draft', live: null, paused: 'Paused' }[status];
    const hasAvatar = Boolean(agent.owner?.avatarUrl);

    const body = (
      <>
        <AgentMark agent={agent} className={classNames?.icon} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'truncate text-[13px] leading-5 font-medium tracking-[-0.01em] text-card-foreground',
                classNames?.name,
              )}
              data-slot="agent-list-name"
              title={agent.name}
            >
              {agent.name}
            </span>
            {tag ? (
              <span className={cn(TAG_CLASS, classNames?.tag)} data-slot="agent-list-tag">
                {tag}
              </span>
            ) : null}
          </span>
          <RowLine agent={agent} className={classNames?.line} now={clock} />
        </span>
      </>
    );

    return (
      <motion.li
        className={cn(
          'group/row relative flex min-w-0 items-center gap-2 rounded-xl pr-2 transition-colors duration-100 ease-out motion-reduce:transition-none',
          onOpen && 'hover:bg-foreground/4',
          selected && 'bg-foreground/6 hover:bg-foreground/6',
          classNames?.row,
        )}
        data-slot="agent-list-row"
        data-status={status}
        exit={{ opacity: 0, scale: 0.98 }}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        key={agent.id}
        layout="position"
        transition={{ layout: MOVE, opacity: { duration: 0.15 } }}
      >
        {onOpen ? (
          <button
            aria-current={selected ? 'true' : undefined}
            className={cn(
              'flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-xl border-0 bg-transparent py-1.5 pl-2 text-left text-inherit',
              FOCUS_CLASS,
            )}
            data-slot={ROW_SLOT}
            onClick={() => {
              onOpen(agent);
            }}
            type="button"
          >
            {body}
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-2">{body}</span>
        )}
        <span className="flex flex-none items-center gap-2">
          {quiet ? (
            <span
              className="hidden text-xs leading-4 text-muted-foreground tabular-nums @sm:block"
              data-slot="agent-list-ago"
              suppressHydrationWarning
              title={new Date(clean(run.at)).toLocaleString()}
            >
              {formatAgo(clock - clean(run.at))}
            </span>
          ) : null}
          {/* On a pointer the avatar gives its place to the menu while the row is hovered. */}
          {hasAvatar || hasMenu ? (
            <span className="relative flex size-6 flex-none items-center justify-center">
              {agent.owner?.avatarUrl ? (
                // oxlint-disable-next-line next/no-img-element -- a 20px avatar from any host
                <img
                  alt={agent.owner.name}
                  className={cn(
                    'size-5 flex-none rounded-full object-cover transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none',
                    hasMenu &&
                      'group-focus-within/row:scale-90 group-focus-within/row:opacity-0 group-hover/row:scale-90 group-hover/row:opacity-0 group-has-[[data-popup-open]]/row:scale-90 group-has-[[data-popup-open]]/row:opacity-0 pointer-coarse:hidden',
                  )}
                  data-slot="agent-list-owner"
                  height={20}
                  src={agent.owner.avatarUrl}
                  title={agent.owner.name}
                  width={20}
                />
              ) : null}
              {hasMenu ? (
                <RowMenu
                  agent={agent}
                  className={cn('absolute inset-0', classNames?.menu)}
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                  onStatusChange={onStatusChange}
                />
              ) : null}
            </span>
          ) : null}
        </span>
      </motion.li>
    );
  };

  let content: ReactNode;
  if (loading && agents.length === 0) {
    content = (
      <div aria-hidden="true" className="flex flex-col gap-px" data-slot="agent-list-loading">
        {PLACEHOLDER_ROWS.map((width) => (
          <div className="flex items-center gap-2.5 px-2 py-1.5" key={width}>
            <span className="size-7 flex-none animate-pulse rounded-lg bg-foreground/6 motion-reduce:animate-none" />
            <span className="flex flex-1 flex-col gap-1.5 py-1">
              <span
                className={cn('h-3 animate-pulse rounded-full bg-foreground/8 motion-reduce:animate-none', width)}
              />
              <span className="h-2.5 w-2/3 max-w-56 animate-pulse rounded-full bg-foreground/5 motion-reduce:animate-none" />
            </span>
          </div>
        ))}
      </div>
    );
  } else if (agents.length === 0) {
    content = (
      <p className="m-0 pl-0.5 text-[13px] leading-5 text-pretty text-muted-foreground">
        No agents yet.
        {onCreate ? ' Describe one and it shows up here as a draft.' : null}
      </p>
    );
  } else {
    content = (
      <>
        <div
          className={cn(ENTER_CLASS, 'flex min-w-0 flex-col gap-2 pl-0.5 delay-75', classNames?.summary)}
          data-slot="agent-list-summary"
        >
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-2xl leading-none font-medium tracking-tight tabular-nums">{agents.length}</span>
            <span className="text-[13px] leading-none text-muted-foreground">
              {agents.length === 1 ? 'agent' : 'agents'}
            </span>
          </div>
          <output aria-live="polite" className="block text-[13px] leading-[18px] text-pretty text-muted-foreground">
            {countsSentence(agents)}
            {failed ? (
              <span className="font-medium text-card-foreground" data-slot="agent-list-warning">
                {' '}
                {failed}
              </span>
            ) : null}
          </output>
        </div>

        {showSearch ? (
          <div className={cn(ENTER_CLASS, 'relative delay-100', classNames?.search)} data-slot="agent-list-search">
            <Input
              icon={SearchLg}
              aria-controls={listId}
              aria-label="Search agents"
              className="h-8 rounded-full border-0 bg-card pr-3 pl-8 text-[13px] shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_11%,transparent)] transition-[background-color,box-shadow] duration-150 ease-out placeholder:text-muted-foreground focus-visible:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_34%,transparent),0_0_0_3px_color-mix(in_oklab,var(--foreground)_8%,transparent)] focus-visible:ring-0 motion-reduce:transition-none md:text-[13px] dark:bg-card dark:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_16%,transparent)] dark:focus-visible:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_42%,transparent),0_0_0_3px_color-mix(in_oklab,var(--foreground)_12%,transparent)] [&::-webkit-search-cancel-button]:appearance-none"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search agents"
              type="search"
              value={query}
            />
          </div>
        ) : null}

        {shown.length === 0 ? (
          <p className="m-0 pl-0.5 text-[13px] leading-5 text-pretty wrap-break-word text-muted-foreground">
            No agent matches “{deferredQuery.trim()}”.
          </p>
        ) : (
          // Arrow keys move between rows.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <ul
            className={cn(
              ENTER_CLASS,
              'relative m-0 -mx-1 flex max-h-[32rem] min-w-0 list-none flex-col gap-px overflow-x-hidden overflow-y-auto p-0 px-1 delay-100',
              classNames?.list,
            )}
            data-slot="agent-list-rows"
            id={listId}
            onKeyDown={onListKeyDown}
            ref={listRef}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {shown.map((agent) => renderRow(agent))}
            </AnimatePresence>
          </ul>
        )}
      </>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <section
        aria-busy={loading ? true : undefined}
        aria-label={title}
        className={cn(
          THEME_VARS,
          '@container flex w-full max-w-full min-w-0 flex-col gap-3 rounded-2xl bg-card p-3 text-card-foreground shadow-(--agent-list-shadow) transition-shadow duration-150 ease-out hover:shadow-(--agent-list-shadow-hover)',
          className,
          classNames?.root,
        )}
        data-slot="agent-list"
        style={style}
      >
        <div
          className={cn(ENTER_CLASS, 'flex h-6 min-w-0 items-center gap-2', classNames?.header)}
          data-slot="agent-list-header"
        >
          <span className="inline-flex size-6 flex-none items-center justify-center rounded-md bg-(--agent-list-icon-bg)">
            <HugeiconsIcon
              aria-hidden="true"
              className="size-3.5 text-(--agent-list-accent)"
              icon={RoboticIcon}
              strokeWidth={2}
            />
          </span>
          <div className="min-w-0 flex-1 truncate text-[13px] leading-tight font-medium tracking-[-0.01em]">
            {title}
          </div>
          {onCreate ? (
            <Button
              className="rounded-full pr-2.5 pl-2 transition-[background-color,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none"
              data-slot="agent-list-create"
              onClick={onCreate}
              size="xs"
              type="button"
            >
              <HugeiconsIcon aria-hidden="true" icon={Add01Icon} strokeWidth={2.5} />
              New agent
            </Button>
          ) : null}
        </div>
        {content}
      </section>
    </MotionConfig>
  );
};
