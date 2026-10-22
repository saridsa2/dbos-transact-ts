'use client';

import { Share05Icon, SidebarLeftIcon, SidebarRightIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface ThreadHeaderClassNames {
  root?: string;
  title?: string;
  input?: string;
  detail?: string;
  actions?: string;
  button?: string;
}

export interface ThreadHeaderProps {
  title?: string;
  /** Shown while a chat has no title yet. */
  placeholder?: string;
  /** True while a title is being written for a new chat. */
  titlePending?: boolean;
  /** Makes the title editable. Called with the new title, trimmed. */
  onRename?: (title: string) => void;
  maxTitleLength?: number;
  /** Rendered only when passed: the button that opens the sidebar. */
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  /** Sits after the title: a model picker, a project, a status. */
  children?: ReactNode;
  /** Sits before Share. */
  actions?: ReactNode;
  /** Rendered only when passed. */
  onShare?: () => void;
  shareLabel?: string;
  /** Rendered only when passed: the button that shows and hides the panel. */
  onTogglePanel?: () => void;
  panelOpen?: boolean;
  panelLabel?: string;
  /** Draws a hairline under the bar once the thread has scrolled under it. */
  scrolled?: boolean;
  className?: string;
  classNames?: ThreadHeaderClassNames;
  /** Handy for overriding the --thread-header-* theme vars inline */
  style?: CSSProperties;
}

const THEME_VARS = [
  '[--thread-header-hover:color-mix(in_oklab,var(--foreground)_5%,transparent)]',
  'dark:[--thread-header-hover:color-mix(in_oklab,var(--foreground)_8%,transparent)]',
  '[--thread-header-line:color-mix(in_oklab,var(--foreground)_8%,transparent)]',
  'dark:[--thread-header-line:color-mix(in_oklab,var(--foreground)_12%,transparent)]',
].join(' ');

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

const ICON_BUTTON_CLASS = cn(
  'inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground transition-[background-color,color,scale] duration-100 ease-out hover:bg-(--thread-header-hover) hover:text-card-foreground active:scale-[0.96] aria-pressed:text-card-foreground motion-reduce:transition-none [&_svg]:size-4',
  FOCUS_CLASS,
);

/** The title and the field that edits it share one box, so nothing shifts. */
const TITLE_TEXT_CLASS = 'text-sm leading-5 font-medium tracking-[-0.01em] whitespace-pre';

const tidy = (value: string): string => value.replaceAll(/\s+/gu, ' ').trim();

const Icon = ({ icon }: { icon: IconSvgElement }) => <HugeiconsIcon aria-hidden="true" icon={icon} strokeWidth={2} />;

const TitleField = ({
  className,
  initial,
  maxLength,
  onDone,
}: {
  className?: string;
  initial: string;
  maxLength: number;
  onDone: (next: string | null, byKey: boolean) => void;
}) => {
  const [draft, setDraft] = useState(initial);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  }, []);

  const finish = (next: string | null, byKey: boolean) => {
    if (done.current) {
      return;
    }
    done.current = true;
    onDone(next, byKey);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter also confirms a word being composed; that one is not ours.
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(draft, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(null, true);
    }
  };

  return (
    <span className="relative inline-grid max-w-full min-w-0 items-center rounded-lg bg-(--thread-header-hover) px-2 py-1.5 ring-2 ring-ring/50 dark:ring-ring/80">
      {/* Sizes the field to the text it holds. */}
      <span
        aria-hidden="true"
        className={cn(TITLE_TEXT_CLASS, 'invisible col-start-1 row-start-1 min-w-[4ch] overflow-hidden')}
      >
        {draft || ' '}
      </span>
      <input
        aria-label="Chat title"
        autoCapitalize="sentences"
        autoComplete="off"
        className={cn(
          TITLE_TEXT_CLASS,
          'col-start-1 row-start-1 w-full min-w-0 border-0 bg-transparent p-0 text-card-foreground outline-none',
          className,
        )}
        data-slot="thread-header-input"
        maxLength={maxLength}
        onBlur={() => {
          finish(draft, false);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={onKeyDown}
        ref={field}
        spellCheck={false}
        value={draft}
      />
    </span>
  );
};

export const ThreadHeader = ({
  title,
  placeholder = 'New chat',
  titlePending = false,
  onRename,
  maxTitleLength = 80,
  onToggleSidebar,
  sidebarOpen = false,
  children,
  actions,
  onShare,
  shareLabel = 'Share',
  onTogglePanel,
  panelOpen = false,
  panelLabel = 'side panel',
  scrolled = false,
  className,
  classNames,
  style,
}: ThreadHeaderProps) => {
  const shown = tidy(title ?? '');
  const [editing, setEditing] = useState(false);
  const titleButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  // A title the model wrote eases in. One the person typed is already there.
  const [seen, setSeen] = useState(shown);
  const [arrival, setArrival] = useState(0);
  const typed = useRef<string | null>(null);
  if (seen !== shown) {
    setSeen(shown);
    if (typed.current === shown) {
      typed.current = null;
    } else if (shown) {
      setArrival(arrival + 1);
    }
  }

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      titleButton.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  const finish = (next: string | null, byKey: boolean) => {
    refocus.current = byKey;
    setEditing(false);
    const value = next === null ? '' : tidy(next);
    if (value && value !== shown) {
      typed.current = value;
      onRename?.(value);
    }
  };

  const text = (
    <span
      className={cn(
        'block truncate',
        TITLE_TEXT_CLASS,
        shown ? 'text-card-foreground' : 'text-muted-foreground',
        titlePending && !shown && 'animate-pulse motion-reduce:animate-none',
        arrival > 0 && 'animate-in duration-300 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none',
      )}
      key={arrival}
    >
      {shown || placeholder}
    </span>
  );

  let heading: ReactNode = <span className="block max-w-full min-w-0 px-2 py-1.5">{text}</span>;
  if (onRename && editing) {
    heading = <TitleField className={classNames?.input} initial={shown} maxLength={maxTitleLength} onDone={finish} />;
  } else if (onRename) {
    heading = (
      <button
        aria-label={`${shown || placeholder}. Rename chat`}
        className={cn(
          'block max-w-full min-w-0 cursor-text rounded-lg border-0 bg-transparent px-2 py-1.5 text-left transition-colors duration-100 ease-out hover:bg-(--thread-header-hover) motion-reduce:transition-none',
          FOCUS_CLASS,
        )}
        data-slot="thread-header-rename"
        onClick={() => {
          setEditing(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            setEditing(true);
          }
        }}
        ref={titleButton}
        title="Rename"
        type="button"
      >
        {text}
      </button>
    );
  }

  return (
    <header
      className={cn(
        THEME_VARS,
        '@container/header relative z-10 flex h-12 w-full min-w-0 flex-none items-center gap-1 bg-card px-2 text-card-foreground',
        "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-(--thread-header-line) after:opacity-0 after:transition-opacity after:duration-200 after:ease-out after:content-[''] motion-reduce:after:transition-none",
        scrolled && 'after:opacity-100',
        className,
        classNames?.root,
      )}
      data-scrolled={scrolled ? 'true' : undefined}
      data-slot="thread-header"
      style={style}
    >
      {onToggleSidebar ? (
        <button
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          className={cn(ICON_BUTTON_CLASS, classNames?.button)}
          data-slot="thread-header-sidebar"
          onClick={onToggleSidebar}
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          type="button"
        >
          <Icon icon={SidebarLeftIcon} />
        </button>
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-1">
        <h1
          className={cn('m-0 flex min-w-0 flex-initial items-center', classNames?.title)}
          data-slot="thread-header-title"
        >
          {heading}
        </h1>
        {children ? (
          <div
            className={cn(
              'flex flex-none items-center gap-1 text-[13px] leading-4 text-muted-foreground',
              classNames?.detail,
            )}
            data-slot="thread-header-detail"
          >
            {children}
          </div>
        ) : null}
      </div>

      <div className={cn('flex flex-none items-center gap-1', classNames?.actions)} data-slot="thread-header-actions">
        {actions}
        {onShare ? (
          <button
            aria-label={shareLabel}
            className={cn(
              'inline-flex h-8 flex-none cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[13px] leading-4 font-medium text-card-foreground transition-[background-color,scale] duration-100 ease-out hover:bg-(--thread-header-hover) active:scale-[0.97] motion-reduce:transition-none [&_svg]:size-4 [&_svg]:text-muted-foreground',
              FOCUS_CLASS,
              classNames?.button,
            )}
            data-slot="thread-header-share"
            onClick={onShare}
            type="button"
          >
            <Icon icon={Share05Icon} />
            <span className="@max-sm/header:sr-only">{shareLabel}</span>
          </button>
        ) : null}
        {onTogglePanel ? (
          <button
            aria-label={panelOpen ? `Hide ${panelLabel}` : `Show ${panelLabel}`}
            aria-pressed={panelOpen}
            className={cn(ICON_BUTTON_CLASS, classNames?.button)}
            data-slot="thread-header-panel"
            onClick={onTogglePanel}
            title={panelOpen ? `Hide ${panelLabel}` : `Show ${panelLabel}`}
            type="button"
          >
            <Icon icon={SidebarRightIcon} />
          </button>
        ) : null}
      </div>
    </header>
  );
};
