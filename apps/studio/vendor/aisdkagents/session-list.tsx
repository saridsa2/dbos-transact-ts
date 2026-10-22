'use client';

import { Menu } from '@base-ui/react/menu';
import {
  Archive01Icon,
  Cancel01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import type { ChatStatus, UIMessage } from 'ai';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

export interface ChatSession {
  archivedAt?: string | null;
  deleteBlockedReason?: string | null;
  id: string;
  title: string;
  /** When the chat last changed. Decides its group and its place in it. */
  updatedAt: Date | string | number;
  pinned?: boolean;
  /** `status` from `useChat`. A busy chat shows a running mark. */
  status?: ChatStatus;
  /** Marks a chat that finished while the user was elsewhere. */
  unread?: boolean;
}

export interface ChatSessionGroup {
  id: string;
  label: string;
  sessions: ChatSession[];
}

const DAY_MS = 86_400_000;
const TITLE_LIMIT = 48;

const timeOf = (value: ChatSession['updatedAt']): number => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

/** Calendar day number in local time, so "yesterday" follows the user's clock. */
const dayOf = (time: number): number => {
  const date = new Date(time);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
};

const groupOf = (time: number, now: number): { id: string; label: string } => {
  const age = dayOf(now) - dayOf(time);
  if (age <= 0) {
    return { id: 'today', label: 'Today' };
  }
  if (age === 1) {
    return { id: 'yesterday', label: 'Yesterday' };
  }
  if (age <= 7) {
    return { id: 'week', label: 'Previous 7 days' };
  }
  if (age <= 30) {
    return { id: 'month', label: 'Previous 30 days' };
  }
  const date = new Date(time);
  const year = date.getFullYear();
  if (year === new Date(now).getFullYear()) {
    const label = date.toLocaleString('en-US', { month: 'long' });
    return { id: `${year}-${date.getMonth()}`, label };
  }
  return { id: String(year), label: String(year) };
};

/**
 * Sorts chats newest first and groups them the way people remember them:
 * pinned, today, yesterday, the last week, the last month, then by month
 * and year.
 */
export const groupSessions = (
  sessions: readonly ChatSession[],
  now: Date | number = Date.now(),
): ChatSessionGroup[] => {
  const current = timeOf(now);
  const sorted = sessions.toSorted((left, right) => timeOf(right.updatedAt) - timeOf(left.updatedAt));
  const groups: ChatSessionGroup[] = [];
  const pinned = sorted.filter((session) => session.pinned);
  if (pinned.length > 0) {
    groups.push({ id: 'pinned', label: 'Pinned', sessions: pinned });
  }
  for (const session of sorted) {
    if (session.pinned) {
      continue;
    }
    const group = groupOf(timeOf(session.updatedAt), current);
    const last = groups.at(-1);
    if (last?.id === group.id) {
      last.sessions.push(session);
    } else {
      groups.push({ ...group, sessions: [session] });
    }
  }
  return groups;
};

/**
 * A title for a chat that has none yet: the first thing the user said, cut
 * at a word.
 *
 * @example
 * const { id, messages, status } = useChat();
 * const session = {
 *   id,
 *   status,
 *   title: sessionTitle(messages),
 *   updatedAt: Date.now(),
 * };
 */
export const sessionTitle = (messages: readonly UIMessage[], fallback = 'New chat'): string => {
  const first = messages.find((message) => message.role === 'user');
  const text = (first?.parts ?? [])
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join(' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
  if (!text) {
    return fallback;
  }
  if (text.length <= TITLE_LIMIT) {
    return text;
  }
  const cut = text.slice(0, TITLE_LIMIT);
  const space = cut.lastIndexOf(' ');
  return `${(space > TITLE_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

export interface SessionListClassNames {
  root?: string;
  search?: string;
  list?: string;
  group?: string;
  item?: string;
  menu?: string;
}

export interface SessionListProps {
  /** Stack Proc lifecycle actions; data and permission checks remain in the host. */
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  sessions?: readonly ChatSession[];
  /** Id of the open chat. */
  activeId?: string;
  onSelect?: (id: string) => void;
  /** Rendered only when passed. */
  onNew?: () => void;
  /** Rendered only when passed. */
  onRename?: (id: string, title: string) => void;
  /** Rendered only when passed. */
  onPin?: (id: string, pinned: boolean) => void;
  /** Rendered only when passed. Called after the user confirms. */
  onDelete?: (id: string) => void;
  /** Set to `false` to leave out the search field. */
  search?: boolean;
  /** The moment groups are measured from. Defaults to now. */
  now?: Date | number;
  className?: string;
  classNames?: SessionListClassNames;
  /** Handy for overriding the --session-list-* theme vars inline */
  style?: CSSProperties;
}

const DEFAULT_SESSIONS: ChatSession[] = [
  {
    id: 's1',
    status: 'streaming',
    title: 'Refund agent approval rules',
    updatedAt: Date.now(),
  },
  {
    id: 's2',
    title: 'Why the agent stops after one tool call',
    updatedAt: Date.now() - DAY_MS,
  },
  {
    id: 's3',
    title: 'Chunking the docs index',
    updatedAt: Date.now() - DAY_MS * 4,
  },
];

const ENTER_CLASS =
  'fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-300 ease-out motion-reduce:animate-none';

const THEME_VARS = [
  '[--session-list-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]',
  '[--session-list-shadow-hover:0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.08),0_2px_4px_0px_rgba(0,0,0,0.06)]',
  'dark:[--session-list-shadow:0_0_0_1px_rgba(255,255,255,0.08)]',
  'dark:[--session-list-shadow-hover:0_0_0_1px_rgba(255,255,255,0.13)]',
].join(' ');

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

const MENU_CLASS =
  'flex min-w-36 origin-(--transform-origin) flex-col rounded-xl bg-popover p-1 text-popover-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_2px_4px_-2px_rgba(0,0,0,0.08),0_8px_20px_-6px_rgba(0,0,0,0.14)] transition-[opacity,scale] duration-150 ease-out outline-none data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 motion-reduce:transition-none dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_8px_24px_-6px_rgba(0,0,0,0.6)]';

const MENU_ITEM_CLASS =
  'flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] leading-4 outline-none select-none data-[highlighted]:bg-foreground/6';

const PILL_CLASS = cn(
  'inline-flex h-6 flex-none cursor-pointer items-center rounded-full border-0 px-2.5 text-xs leading-none font-medium whitespace-nowrap transition-[background-color,transform] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none',
  FOCUS_CLASS,
);

const ROW_CLASS =
  'group/item relative flex h-8 min-w-0 items-center rounded-lg transition-colors duration-150 ease-out motion-reduce:transition-none';

const isBusy = (session: ChatSession): boolean => session.status === 'submitted' || session.status === 'streaming';

const Icon = ({ icon, className }: { icon: IconSvgElement; className?: string }) => (
  <HugeiconsIcon aria-hidden="true" className={cn('size-3.5 flex-none', className)} icon={icon} strokeWidth={2} />
);

/** One quiet mark: a spinning ring while the agent works, a dot when it has news. */
const StatusDot = ({ session }: { session: ChatSession }) => {
  if (isBusy(session)) {
    return (
      <span
        className="size-2.5 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent motion-reduce:animate-none"
        title="Running"
      >
        <span className="sr-only">Running</span>
      </span>
    );
  }
  if (session.status === 'error') {
    return (
      <span className="size-1.5 rounded-full bg-destructive" title="Failed">
        <span className="sr-only">Failed</span>
      </span>
    );
  }
  if (session.unread) {
    return (
      <span className="size-1.5 rounded-full bg-primary" title="Unread">
        <span className="sr-only">Unread</span>
      </span>
    );
  }
  return null;
};

const Title = ({ title, query }: { title: string; query: string }) => {
  const at = query ? title.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at === -1) {
    return title;
  }
  return (
    <>
      {title.slice(0, at)}
      <mark className="bg-transparent font-semibold text-foreground">{title.slice(at, at + query.length)}</mark>
      {title.slice(at + query.length)}
    </>
  );
};

const RenameField = ({
  title,
  onCancel,
  onCommit,
}: {
  title: string;
  onCancel: () => void;
  onCommit: (title: string) => void;
}) => {
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (done.current) {
      return;
    }
    done.current = true;
    const next = field.current?.value.trim() ?? '';
    if (save && next && next !== title) {
      onCommit(next);
    } else {
      onCancel();
    }
  };

  return (
    <input
      aria-label="Chat title"
      className="h-8 w-full min-w-0 rounded-lg border-0 bg-card px-2 text-[13px] leading-4 text-card-foreground shadow-[0_0_0_1px_var(--ring)] outline-none"
      data-slot="session-list-rename"
      defaultValue={title}
      onBlur={() => {
        finish(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      ref={field}
    />
  );
};

const DeleteConfirm = ({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) => {
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirm.current?.focus();
  }, []);

  return (
    <div
      className={cn(ROW_CLASS, 'gap-1.5 bg-foreground/6 pr-1 pl-2')}
      data-slot="session-list-confirm"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
      role="group"
    >
      <span className="min-w-0 flex-1 truncate text-[13px] leading-4">Delete conversation?</span>
      <button
        className={cn(PILL_CLASS, 'bg-foreground/6 text-card-foreground hover:bg-foreground/10')}
        onClick={onCancel}
        type="button"
      >
        Keep
      </button>
      <button
        className={cn(PILL_CLASS, 'bg-destructive text-white hover:bg-destructive/90')}
        onClick={onConfirm}
        ref={confirm}
        type="button"
      >
        Delete
      </button>
    </div>
  );
};

interface RowActions {
  onArchive?: () => void;
  onRestore?: () => void;
  onRename?: () => void;
  onPin?: () => void;
  onDelete?: () => void;
}

const RowMenu = ({
  session,
  actions,
  className,
  onOpenChange,
}: {
  session: ChatSession;
  actions: RowActions;
  className?: string;
  onOpenChange: (open: boolean) => void;
}) => (
  <Menu.Root onOpenChange={onOpenChange}>
    <Menu.Trigger
      aria-label={`Options for ${session.title}`}
      className={cn(
        'flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-[background-color,color] duration-150 ease-out hover:bg-foreground/8 hover:text-card-foreground data-[popup-open]:bg-foreground/8 data-[popup-open]:text-card-foreground motion-reduce:transition-none',
        FOCUS_CLASS,
      )}
      data-slot="session-list-options"
    >
      <Icon icon={MoreHorizontalIcon} />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner align="start" className="z-50" collisionPadding={8} sideOffset={6}>
        <Menu.Popup className={cn(MENU_CLASS, className)} data-slot="session-list-menu">
          {actions.onRename ? (
            <Menu.Item className={MENU_ITEM_CLASS} onClick={actions.onRename}>
              <Icon className="text-muted-foreground" icon={PencilEdit02Icon} />
              Rename
            </Menu.Item>
          ) : null}
          {actions.onPin ? (
            <Menu.Item className={MENU_ITEM_CLASS} onClick={actions.onPin}>
              <Icon className="text-muted-foreground" icon={session.pinned ? PinOffIcon : PinIcon} />
              {session.pinned ? 'Unpin' : 'Pin'}
            </Menu.Item>
          ) : null}
          {actions.onArchive || actions.onRestore ? (
            <Menu.Item className={MENU_ITEM_CLASS} onClick={actions.onRestore ?? actions.onArchive}>
              <Icon className="text-muted-foreground" icon={Archive01Icon} />
              {actions.onRestore ? 'Restore' : 'Archive'}
            </Menu.Item>
          ) : null}
          {actions.onDelete ? (
            <Menu.Item
              className={cn(MENU_ITEM_CLASS, 'text-destructive')}
              aria-label="Delete"
              disabled={!!session.deleteBlockedReason}
              title={session.deleteBlockedReason ?? undefined}
              onClick={actions.onDelete}
            >
              <Icon icon={Delete02Icon} />
              <span>
                Delete
                {session.deleteBlockedReason && (
                  <span className="mt-1 block max-w-64 text-sm leading-5 font-normal whitespace-normal">
                    {session.deleteBlockedReason}
                  </span>
                )}
              </span>
            </Menu.Item>
          ) : null}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
);

const SessionRow = ({
  session,
  active,
  query,
  actions,
  classNames,
  onSelect,
}: {
  session: ChatSession;
  active: boolean;
  query: string;
  actions: RowActions;
  classNames?: SessionListClassNames;
  onSelect: () => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMenu = Boolean(
    actions.onRename || actions.onPin || actions.onDelete || actions.onArchive || actions.onRestore,
  );
  return (
    <div
      className={cn(ROW_CLASS, active || menuOpen ? 'bg-foreground/[0.07]' : 'hover:bg-foreground/5', classNames?.item)}
      data-active={active || undefined}
    >
      <button
        aria-current={active ? 'true' : undefined}
        className={cn(
          'h-full min-w-0 flex-1 cursor-pointer truncate rounded-lg border-0 bg-transparent pr-8 pl-2 text-left text-[13px] leading-4 text-card-foreground',
          FOCUS_CLASS,
          active && 'font-medium',
        )}
        data-session-id={session.id}
        data-slot="session-list-item"
        onClick={onSelect}
        onDoubleClick={actions.onRename}
        type="button"
      >
        <Title query={query} title={session.title} />
      </button>
      <span className="pointer-events-none absolute right-1 flex size-8 items-center justify-center">
        <span
          className={cn(
            'flex transition-opacity duration-150 ease-out motion-reduce:transition-none',
            hasMenu && 'group-focus-within/item:opacity-0 group-hover/item:opacity-0',
            hasMenu && menuOpen && 'opacity-0',
          )}
        >
          <StatusDot session={session} />
        </span>
        {hasMenu ? (
          <span
            className={cn(
              'pointer-events-auto absolute inset-0 opacity-0 transition-opacity duration-150 ease-out group-focus-within/item:opacity-100 group-hover/item:opacity-100 motion-reduce:transition-none',
              menuOpen && 'opacity-100',
            )}
          >
            <RowMenu actions={actions} className={classNames?.menu} onOpenChange={setMenuOpen} session={session} />
          </span>
        ) : null}
      </span>
    </div>
  );
};

const SearchField = ({
  value,
  className,
  onChange,
  onKeyDown,
}: {
  value: string;
  className?: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) => (
  <label
    className={cn(
      'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-foreground/5 pr-1 pl-2 text-muted-foreground transition-colors duration-150 ease-out focus-within:bg-foreground/[0.07] motion-reduce:transition-none',
      className,
    )}
    data-slot="session-list-search"
  >
    <Icon icon={Search01Icon} />
    <input
      aria-label="Search sessions"
      className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] leading-4 text-card-foreground outline-none placeholder:text-muted-foreground"
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={onKeyDown}
      placeholder="Search"
      type="text"
      value={value}
    />
    {value ? (
      <button
        aria-label="Clear search"
        className={cn(
          'flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-colors duration-150 ease-out hover:text-card-foreground motion-reduce:transition-none',
          FOCUS_CLASS,
        )}
        onClick={() => {
          onChange('');
        }}
        type="button"
      >
        <Icon className="size-3" icon={Cancel01Icon} />
      </button>
    ) : null}
  </label>
);

export const SessionList = ({
  sessions = DEFAULT_SESSIONS,
  activeId,
  onSelect,
  onNew,
  onRename,
  onPin,
  onDelete,
  onArchive,
  onRestore,
  search = true,
  now,
  className,
  classNames,
  style,
}: SessionListProps) => {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);

  const needle = query.trim();
  const groups: ChatSessionGroup[] = needle
    ? [
        {
          id: 'results',
          label: '',
          sessions: sessions
            .filter((session) => session.title.toLowerCase().includes(needle.toLowerCase()))
            .toSorted((left, right) => timeOf(right.updatedAt) - timeOf(left.updatedAt)),
        },
      ]
    : groupSessions(sessions, now);
  const count = groups.reduce((sum, group) => sum + group.sessions.length, 0);

  const rows = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[data-slot=session-list-item]') ?? [])];

  const focusRow = (id: string) => {
    requestAnimationFrame(() => {
      root.current?.querySelector<HTMLButtonElement>(`[data-session-id="${CSS.escape(id)}"]`)?.focus();
    });
  };

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    const items = rows();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) {
      return;
    }
    event.preventDefault();
    items[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  };

  const searchKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      rows().at(0)?.focus();
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      setQuery('');
    } else if (event.key === 'Enter' && needle) {
      const first = groups.at(0)?.sessions.at(0);
      if (first) {
        onSelect?.(first.id);
      }
    }
  };

  return (
    <nav
      aria-label="Sessions"
      className={cn(
        THEME_VARS,
        ENTER_CLASS,
        'flex w-full max-w-full min-w-0 flex-col gap-2 rounded-2xl bg-card p-2 text-card-foreground shadow-(--session-list-shadow) transition-shadow duration-150 ease-out hover:shadow-(--session-list-shadow-hover)',
        className,
        classNames?.root,
      )}
      data-slot="session-list"
      ref={root}
      style={style}
    >
      {search || onNew ? (
        <div className="flex flex-none items-center gap-1.5">
          {search ? (
            <SearchField className={classNames?.search} onChange={setQuery} onKeyDown={searchKeys} value={query} />
          ) : (
            <span className="flex-1" />
          )}
          {onNew ? (
            <button
              aria-label="New chat"
              className={cn(
                'flex size-8 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/6 hover:text-card-foreground active:scale-[0.96] motion-reduce:transition-none',
                FOCUS_CLASS,
              )}
              data-slot="session-list-new"
              onClick={onNew}
              title="New chat"
              type="button"
            >
              <Icon className="size-4" icon={PencilEdit02Icon} />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- arrow keys move between the rows inside */}
      <div
        className={cn(
          '-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)] px-1 pt-1 pb-4',
          classNames?.list,
        )}
        data-slot="session-list-groups"
        onKeyDown={moveFocus}
      >
        {count === 0 ? (
          <p className="m-0 px-2 py-1.5 text-[13px] leading-4.5 text-muted-foreground">
            {needle ? `No chats match "${needle}".` : 'No conversations here.'}
          </p>
        ) : null}
        {groups.map((group) =>
          group.sessions.length === 0 ? null : (
            <section
              aria-label={group.label || 'Results'}
              className={cn('flex flex-col gap-px', classNames?.group)}
              key={group.id}
            >
              {group.label ? (
                <div className="px-2 pb-1 text-xs leading-4 text-muted-foreground">{group.label}</div>
              ) : null}
              {group.sessions.map((session) => {
                if (renaming === session.id) {
                  return (
                    <RenameField
                      key={session.id}
                      onCancel={() => {
                        setRenaming(null);
                        focusRow(session.id);
                      }}
                      onCommit={(title) => {
                        setRenaming(null);
                        onRename?.(session.id, title);
                        focusRow(session.id);
                      }}
                      title={session.title}
                    />
                  );
                }
                if (deleting === session.id) {
                  return (
                    <DeleteConfirm
                      key={session.id}
                      onCancel={() => {
                        setDeleting(null);
                        focusRow(session.id);
                      }}
                      onConfirm={() => {
                        setDeleting(null);
                        onDelete?.(session.id);
                      }}
                    />
                  );
                }
                return (
                  <SessionRow
                    actions={{
                      onArchive: onArchive && !session.archivedAt ? () => onArchive(session.id) : undefined,
                      onRestore: onRestore && session.archivedAt ? () => onRestore(session.id) : undefined,
                      onDelete: onDelete
                        ? () => {
                            setDeleting(session.id);
                          }
                        : undefined,
                      onPin: onPin
                        ? () => {
                            onPin(session.id, !session.pinned);
                          }
                        : undefined,
                      onRename: onRename
                        ? () => {
                            setRenaming(session.id);
                          }
                        : undefined,
                    }}
                    active={session.id === activeId}
                    classNames={classNames}
                    key={session.id}
                    onSelect={() => {
                      onSelect?.(session.id);
                    }}
                    query={needle}
                    session={session}
                  />
                );
              })}
            </section>
          ),
        )}
      </div>
    </nav>
  );
};
