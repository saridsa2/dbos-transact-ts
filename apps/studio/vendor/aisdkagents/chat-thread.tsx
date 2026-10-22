'use client';

import { AlertCircleIcon, ArrowDown02Icon, File01Icon, Loading03Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import type { ChatStatus, UIMessage } from 'ai';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** What `renderMessage` is told about the message it draws. */
export interface ChatThreadMessageInfo {
  /** True for the newest message in the thread. */
  last: boolean;
  /** True while this message is still being written. */
  streaming: boolean;
}

export interface ChatThreadClassNames {
  root?: string;
  scroller?: string;
  content?: string;
  turn?: string;
  user?: string;
  assistant?: string;
  tool?: string;
  error?: string;
  jump?: string;
}

export interface ChatThreadProps {
  /** A host may supply its own durable progress component. */
  showThinking?: boolean;
  emptyAlignment?: 'start' | 'center';
  /** `messages` from `useChat`. */
  messages?: readonly UIMessage[];
  /** `status` from `useChat`. */
  status?: ChatStatus;
  /** `error` from `useChat`. Shown under the last message with Retry. */
  error?: Error | string | null;
  /** Rendered only when passed, and only after a reply failed. */
  onRetry?: () => void;
  /**
   * The chat's id. Opening another chat lands at its end with nothing
   * animating. Without it the thread watches the first message instead.
   */
  id?: string;
  /**
   * Draws a message your way: an answer with citations, a tool card. Return
   * `undefined` to keep the built-in look for that message. Keep the function
   * stable so finished messages are not drawn again on every token.
   */
  renderMessage?: (message: UIMessage, info: ChatThreadMessageInfo) => ReactNode | undefined;
  /** Shown in the middle while the chat has no messages. */
  empty?: ReactNode;
  /** Tells a header when the thread has scrolled under it. */
  onScrolledChange?: (scrolled: boolean) => void;
  jumpLabel?: string;
  label?: string;
  className?: string;
  classNames?: ChatThreadClassNames;
  /** Handy for overriding the --chat-thread-* theme vars inline */
  style?: CSSProperties;
}

/** Top and bottom padding of the column, in pixels. Matches `pt-6 pb-8`. */
const PAD_TOP_PX = 24;
const PAD_BOTTOM_PX = 32;
/** Closer to the end than this still counts as being at the end. */
const STICK_PX = 8;
/** Further from the end than this, the way back is offered. */
const AWAY_PX = 96;
/** A scroll the thread started is done by now, with or without `scrollend`. */
const AUTO_SCROLL_MS = 1000;
/** A pasted wall of text folds past this height, in pixels. */
const FOLD_OVER_PX = 320;
const FOLD_TO_PX = 216;
/** Turns older than the newest few are laid out only when scrolled to. */
const LIVE_TURNS = 3;

const THEME_VARS = [
  '[--chat-thread-bubble:var(--muted)] dark:[--chat-thread-bubble:var(--background)]',
  '[--chat-thread-error:var(--destructive)]',
  '[--chat-thread-done:#15803d] dark:[--chat-thread-done:#4ade80]',
  '[--chat-thread-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.08),0_4px_10px_-2px_rgba(0,0,0,0.1)]',
  'dark:[--chat-thread-shadow:0_0_0_1px_rgba(255,255,255,0.12),0_4px_12px_-2px_rgba(0,0,0,0.6)]',
].join(' ');

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

/** A message that was just sent rises into place. History does not. */
const ENTER_CLASS =
  'animate-in duration-300 ease-[cubic-bezier(0.19,1,0.22,1)] fill-mode-both fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none';

const TEXT_CLASS = 'text-[15px] leading-[1.6] tracking-[-0.005em] [overflow-wrap:anywhere] whitespace-pre-wrap';

type Part = UIMessage['parts'][number];

interface ToolPart {
  type: string;
  state?: string;
  toolName?: string;
  errorText?: string;
}

interface FilePart {
  type: 'file';
  url: string;
  mediaType: string;
  filename?: string;
}

const isToolPart = (part: Part): boolean => part.type === 'dynamic-tool' || part.type.startsWith('tool-');

const isVisible = (part: Part): boolean =>
  (part.type === 'text' && part.text.trim() !== '') || part.type === 'file' || isToolPart(part);

const textOf = (message: UIMessage): string =>
  message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n\n')
    .trim();

/** `search_docs` and `searchDocs` both read as `Search docs`. */
const toolLabel = (part: ToolPart): string => {
  const raw = part.type === 'dynamic-tool' ? (part.toolName ?? 'tool') : part.type.slice('tool-'.length);
  const words = raw
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll(/[_-]+/gu, ' ')
    .trim()
    .toLowerCase();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : 'Tool';
};

const errorText = (error: Error | string | null | undefined): string => {
  const text = typeof error === 'string' ? error : (error?.message ?? '');
  return text.trim() || 'The reply did not finish.';
};

const prefersLessMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const Icon = ({ className, icon }: { className?: string; icon: IconSvgElement }) => (
  <HugeiconsIcon aria-hidden="true" className={className} icon={icon} strokeWidth={2} />
);

const Files = ({ files, end }: { files: FilePart[]; end: boolean }) => (
  <div className={cn('flex flex-wrap gap-1.5', end && 'justify-end')}>
    {files.map((file, index) =>
      file.mediaType.startsWith('image/') ? (
        // oxlint-disable-next-line nextjs/no-img-element -- installs into projects without next/image
        <img
          alt={file.filename ?? 'Attached image'}
          className="size-16 rounded-xl object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1)]"
          draggable={false}
          // Parts carry no id; a message's files keep their order.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          src={file.url}
        />
      ) : (
        <span
          className="inline-flex h-8 max-w-56 items-center gap-1.5 rounded-lg bg-(--chat-thread-bubble) px-2 text-[13px] leading-4 text-card-foreground"
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
        >
          <Icon className="size-4 flex-none text-muted-foreground" icon={File01Icon} />
          <span className="truncate">{file.filename ?? 'File'}</span>
        </span>
      ),
    )}
  </div>
);

const filesOf = (message: UIMessage): FilePart[] =>
  message.parts.flatMap((part) => (part.type === 'file' ? [part as FilePart] : []));

/** What the person said. A very long paste folds, with a way to open it. */
const UserMessage = ({ className, message }: { className?: string; message: UIMessage }) => {
  const text = textOf(message);
  const files = filesOf(message);
  const body = useRef<HTMLDivElement>(null);
  const [folds, setFolds] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const node = body.current;
    if (node) {
      setFolds(node.scrollHeight > FOLD_OVER_PX);
    }
  }, [text]);

  const folded = folds && !open;

  return (
    <div className="flex min-w-0 flex-col items-end gap-1.5">
      {files.length > 0 ? <Files end files={files} /> : null}
      {text ? (
        <div
          className={cn(
            'max-w-[min(85%,36rem)] min-w-0 rounded-2xl bg-(--chat-thread-bubble) px-3.5 py-2 text-card-foreground',
            className,
          )}
          data-slot="chat-thread-user"
        >
          <div
            className={cn(
              TEXT_CLASS,
              folded && 'overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]',
            )}
            ref={body}
            style={folded ? { maxHeight: FOLD_TO_PX } : undefined}
          >
            {text}
          </div>
          {folds ? (
            <button
              aria-expanded={open}
              className={cn(
                "relative mt-1 cursor-pointer rounded-sm border-0 bg-transparent p-0 text-[13px] leading-5 font-medium text-card-foreground underline decoration-foreground/25 underline-offset-2 transition-[text-decoration-color] duration-150 ease-out after:absolute after:-inset-2 after:content-[''] hover:decoration-current motion-reduce:transition-none",
                FOCUS_CLASS,
              )}
              onClick={() => {
                setOpen(!open);
              }}
              type="button"
            >
              {open ? 'Show less' : 'Show more'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const ToolRow = ({ className, part }: { className?: string; part: ToolPart }) => {
  const failed = part.state === 'output-error';
  const done = part.state === 'output-available';
  const denied = part.state === 'output-denied';
  const running = !failed && !done && !denied;
  let mark: ReactNode = (
    <Icon className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" icon={Loading03Icon} />
  );
  if (failed || denied) {
    mark = (
      <Icon
        className={cn('size-3.5', failed ? 'text-(--chat-thread-error)' : 'text-muted-foreground')}
        icon={AlertCircleIcon}
      />
    );
  } else if (done) {
    mark = <Icon className="size-3.5 text-(--chat-thread-done)" icon={Tick02Icon} />;
  }
  return (
    <div
      className={cn('flex min-w-0 items-center gap-2 text-[13px] leading-5 text-muted-foreground', className)}
      data-slot="chat-thread-tool"
      data-state={part.state}
    >
      <span className="inline-flex size-4 flex-none items-center justify-center">{mark}</span>
      <span className="min-w-0 truncate">
        <span className={cn(running && 'text-card-foreground')}>{toolLabel(part)}</span>
        {failed ? ` failed${part.errorText ? `: ${part.errorText}` : ''}` : null}
        {denied ? ' was not allowed' : null}
      </span>
    </div>
  );
};

const AssistantMessage = ({ classNames, message }: { classNames?: ChatThreadClassNames; message: UIMessage }) => {
  const files = filesOf(message);
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-3 text-card-foreground', classNames?.assistant)}
      data-slot="chat-thread-assistant"
    >
      {message.parts.map((part, index) => {
        if (part.type === 'text' && part.text.trim() !== '') {
          return (
            // oxlint-disable-next-line react/no-array-index-key -- parts carry no id and only ever append
            <div className="flex flex-col gap-3" key={index}>
              {part.text
                .trim()
                .split(/\n{2,}/u)
                .map((paragraph, at) => (
                  // oxlint-disable-next-line react/no-array-index-key
                  <p className={cn('m-0', TEXT_CLASS)} key={at}>
                    {paragraph}
                  </p>
                ))}
            </div>
          );
        }
        if (isToolPart(part)) {
          return (
            <ToolRow
              className={classNames?.tool}
              // oxlint-disable-next-line react/no-array-index-key
              key={index}
              part={part as ToolPart}
            />
          );
        }
        return null;
      })}
      {files.length > 0 ? <Files end={false} files={files} /> : null}
    </div>
  );
};

interface RowProps {
  animate: boolean;
  classNames?: ChatThreadClassNames;
  last: boolean;
  message: UIMessage;
  renderMessage: ChatThreadProps['renderMessage'];
  streaming: boolean;
}

/** One message. Finished ones are skipped while the newest is being written. */
const Row = memo(({ animate, classNames, last, message, renderMessage, streaming }: RowProps) => {
  const custom = renderMessage?.(message, { last, streaming });
  let body: ReactNode = custom;
  if (custom === undefined) {
    if (message.role === 'user') {
      body = <UserMessage className={classNames?.user} message={message} />;
    } else if (message.role === 'assistant') {
      body = message.parts.some(isVisible) ? <AssistantMessage classNames={classNames} message={message} /> : null;
    } else {
      body = null;
    }
  }
  if (body === null || body === false) {
    return null;
  }
  return (
    <div
      className={cn('min-w-0', animate && message.role === 'user' && ENTER_CLASS)}
      data-message-id={message.id}
      data-role={message.role}
      data-slot="chat-thread-message"
    >
      {body}
    </div>
  );
});
Row.displayName = 'ChatThreadRow';

interface Turn {
  id: string;
  messages: UIMessage[];
}

/** A question and everything said in reply to it. */
const turnsOf = (messages: readonly UIMessage[]): Turn[] => {
  const turns: Turn[] = [];
  for (const message of messages) {
    const current = turns.at(-1);
    if (message.role === 'user' || !current) {
      turns.push({ id: message.id, messages: [message] });
    } else {
      current.messages.push(message);
    }
  }
  return turns;
};

interface Track {
  /** Message ids that were already there when the chat was opened. */
  baseline: ReadonlySet<string>;
  /** Bumps when another chat is opened. */
  epoch: number;
  key: string;
  lastUser: string | undefined;
  /** The question that was just asked, held at the top of the view. */
  anchor: string | null;
}

const EMPTY: readonly UIMessage[] = [];

export const ChatThread = ({
  messages = EMPTY,
  status = 'ready',
  showThinking = true,
  emptyAlignment = 'center',
  error,
  onRetry,
  id,
  renderMessage,
  empty,
  onScrolledChange,
  jumpLabel = 'Jump to latest',
  label = 'Conversation',
  className,
  classNames,
  style,
}: ChatThreadProps) => {
  const emptyView = useRef(messages.length === 0);
  emptyView.current = messages.length === 0;
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  /** True while the view should stay on the newest line as text arrives. */
  const follow = useRef(true);
  /** Set while a scroll the thread started is still moving. */
  const auto = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrolled = useRef(false);
  const report = useRef(onScrolledChange);
  const [away, setAway] = useState(false);

  useEffect(() => {
    report.current = onScrolledChange;
  });

  const lastUserAt = messages.findLastIndex((message) => message.role === 'user');
  const lastUser = lastUserAt === -1 ? undefined : messages[lastUserAt]?.id;
  const key = id ?? messages.at(0)?.id ?? '';
  const [track, setTrack] = useState<Track>(() => ({
    anchor: null,
    baseline: new Set(messages.map((message) => message.id)),
    epoch: 0,
    key,
    lastUser,
  }));
  if (track.key !== key) {
    // With no id to go by, a first message in an empty chat is a send.
    const started = id === undefined && track.key === '' && messages.length <= 2;
    setTrack(
      started
        ? { ...track, anchor: lastUser ?? null, key, lastUser }
        : {
            anchor: null,
            baseline: new Set(messages.map((message) => message.id)),
            epoch: track.epoch + 1,
            key,
            lastUser,
          },
    );
  } else if (track.lastUser !== lastUser) {
    const sent = lastUser !== undefined && !track.baseline.has(lastUser) && lastUserAt >= messages.length - 2;
    setTrack({ ...track, anchor: sent ? lastUser : track.anchor, lastUser });
  }

  const measure = useCallback(() => {
    const node = scroller.current;
    if (!node) {
      return 0;
    }
    const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
    // Not while the thread is scrolling itself: the way back would flash.
    setAway(!emptyView.current && gap > AWAY_PX && auto.current === null);
    const under = node.scrollTop > 0;
    if (under !== scrolled.current) {
      scrolled.current = under;
      report.current?.(under);
    }
    return gap;
  }, []);

  const endAuto = useCallback(() => {
    if (auto.current !== null) {
      clearTimeout(auto.current);
      auto.current = null;
    }
  }, []);

  const startAuto = useCallback(() => {
    endAuto();
    auto.current = setTimeout(() => {
      auto.current = null;
      measure();
    }, AUTO_SCROLL_MS);
  }, [endAuto, measure]);

  // The view's height, for the space kept under a question that was just asked.
  useLayoutEffect(() => {
    const node = scroller.current;
    const inner = content.current;
    if (!node || !inner) {
      return;
    }
    const fit = () => {
      node.style.setProperty('--chat-thread-view', `${node.clientHeight}px`);
      if (follow.current) {
        node.scrollTop = emptyView.current ? 0 : node.scrollHeight;
      }
      measure();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    observer.observe(inner);
    return () => {
      observer.disconnect();
      endAuto();
    };
  }, [endAuto, measure]);

  // Opening a chat lands on its last line, at once.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) {
      return;
    }
    endAuto();
    follow.current = true;
    node.scrollTop = emptyView.current ? 0 : node.scrollHeight;
    measure();
  }, [endAuto, measure, track.epoch]);

  // A question that was just asked moves to the top, and the reply is written
  // into the space under it. Nothing the person is reading moves after that.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || track.anchor === null) {
      return;
    }
    const turn = node.querySelector<HTMLElement>(`[data-turn="${CSS.escape(track.anchor)}"]`);
    if (!turn) {
      return;
    }
    follow.current = false;
    startAuto();
    node.scrollTo({
      behavior: prefersLessMotion() ? 'auto' : 'smooth',
      top: turn.offsetTop - PAD_TOP_PX,
    });
  }, [startAuto, track.anchor]);

  const onScroll = () => {
    const gap = measure();
    // Reaching the end by hand asks to follow along. Leaving it stops that.
    if (auto.current === null) {
      follow.current = gap <= STICK_PX;
    }
  };

  const toEnd = () => {
    const node = scroller.current;
    if (!node) {
      return;
    }
    follow.current = true;
    if (prefersLessMotion()) {
      node.scrollTop = emptyView.current ? 0 : node.scrollHeight;
      return;
    }
    startAuto();
    node.scrollTo({ behavior: 'smooth', top: node.scrollHeight });
  };

  const turns = turnsOf(messages);

  // Older turns are laid out only when scrolled to. Each is measured once
  // first, so the space it holds is its real height and nothing shifts.
  const [sizes, setSizes] = useState<ReadonlyMap<string, number>>(() => new Map());
  const settled = Math.max(0, turns.length - LIVE_TURNS);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node || settled === 0) {
      return;
    }
    const found: [string, number][] = [];
    for (const element of node.querySelectorAll<HTMLElement>('[data-slot=chat-thread-turn]:not([data-settled])')) {
      const turnId = element.dataset.turn;
      if (turnId && element.dataset.settle === 'true') {
        found.push([turnId, element.offsetHeight]);
      }
    }
    if (found.length > 0) {
      setSizes((current) => new Map([...current, ...found]));
    }
  }, [settled, track.epoch]);
  const lastMessage = messages.at(-1);
  const busy = status === 'submitted' || status === 'streaming';
  const failed = status === 'error' || Boolean(error);
  const waiting =
    !failed &&
    (status === 'submitted' ||
      (status === 'streaming' && (lastMessage?.role !== 'assistant' || !lastMessage.parts.some(isVisible))));
  const isEmpty = messages.length === 0 && !waiting && !failed;

  const tail = (
    <>
      {waiting && showThinking ? (
        <div aria-label="Thinking" className="flex h-6 items-center" data-slot="chat-thread-waiting" role="status">
          <span className="size-2.5 animate-pulse rounded-full bg-foreground/70 motion-reduce:animate-none" />
        </div>
      ) : null}
      {failed ? (
        <div
          className={cn('flex min-w-0 items-start gap-2 text-[13px] leading-5', ENTER_CLASS, classNames?.error)}
          data-slot="chat-thread-error"
          role="alert"
        >
          <span className="inline-flex h-5 flex-none items-center">
            <Icon className="size-4 text-(--chat-thread-error)" icon={AlertCircleIcon} />
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere] text-card-foreground">{errorText(error)}</span>
          {onRetry ? (
            <button
              className={cn(
                "relative flex-none cursor-pointer rounded-sm border-0 bg-transparent p-0 font-medium text-card-foreground underline decoration-foreground/25 underline-offset-2 transition-[text-decoration-color,scale] duration-150 ease-out after:absolute after:-inset-2 after:content-[''] hover:decoration-current active:scale-[0.97] motion-reduce:transition-none",
                FOCUS_CLASS,
              )}
              data-slot="chat-thread-retry"
              onClick={onRetry}
              type="button"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(THEME_VARS, 'relative flex min-h-0 min-w-0 flex-1 flex-col', className, classNames?.root)}
      data-slot="chat-thread"
      data-status={status}
      style={style}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a hand on the thread ends a scroll the thread started */}
      <div
        aria-label={label}
        className={cn(
          'relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)] outline-none [scrollbar-gutter:stable_both-edges] focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--ring)_50%,transparent)]',
          classNames?.scroller,
        )}
        data-slot="chat-thread-scroller"
        onKeyDown={endAuto}
        onPointerDown={endAuto}
        onScroll={onScroll}
        onScrollEnd={() => {
          endAuto();
          measure();
        }}
        onTouchStart={endAuto}
        onWheel={endAuto}
        ref={scroller}
        role="region"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- arrow keys and Page Up scroll the thread
        tabIndex={0}
      >
        <div
          aria-busy={busy}
          aria-relevant="additions"
          className={cn(
            'mx-auto flex w-full max-w-[46rem] flex-col gap-8 px-4 pt-6 pb-8',
            isEmpty && emptyAlignment === 'center' && 'flex-1 justify-center',
            classNames?.content,
          )}
          data-slot="chat-thread-content"
          ref={content}
          role="log"
        >
          {isEmpty ? empty : null}
          {turns.map((turn, index) => {
            const newest = index === turns.length - 1;
            const held = newest && turn.id === track.anchor;
            const size = index < settled ? sizes.get(turn.id) : undefined;
            const sizeStyle = size === undefined ? undefined : { containIntrinsicSize: `auto ${size}px` };
            return (
              <div
                className={cn(
                  'flex min-w-0 flex-col gap-4',
                  size !== undefined && '[content-visibility:auto]',
                  classNames?.turn,
                )}
                data-settle={index < settled ? 'true' : undefined}
                data-settled={size === undefined ? undefined : 'true'}
                data-slot="chat-thread-turn"
                data-turn={turn.id}
                key={turn.id}
                style={
                  held
                    ? {
                        minHeight: `calc(var(--chat-thread-view) - ${PAD_TOP_PX + PAD_BOTTOM_PX}px)`,
                      }
                    : sizeStyle
                }
              >
                {turn.messages.map((message) => {
                  const last = message === lastMessage;
                  return (
                    <Row
                      animate={!track.baseline.has(message.id)}
                      classNames={classNames}
                      key={message.id}
                      last={last}
                      message={message}
                      renderMessage={renderMessage}
                      streaming={last && status === 'streaming'}
                    />
                  );
                })}
                {newest ? tail : null}
              </div>
            );
          })}
          {turns.length === 0 && !isEmpty ? <div className="flex flex-col gap-4">{tail}</div> : null}
        </div>
      </div>

      <button
        aria-label={jumpLabel}
        className={cn(
          'absolute bottom-3 left-1/2 z-10 inline-flex size-8 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-card p-0 text-card-foreground shadow-(--chat-thread-shadow) transition-[opacity,scale,translate] ease-out active:scale-[0.96] motion-reduce:transition-none',
          away
            ? 'translate-y-0 scale-100 opacity-100 duration-200'
            : 'pointer-events-none translate-y-1 scale-95 opacity-0 duration-100',
          FOCUS_CLASS,
          classNames?.jump,
        )}
        data-slot="chat-thread-jump"
        inert={!away}
        onClick={toEnd}
        title={jumpLabel}
        type="button"
      >
        <Icon className="size-4" icon={ArrowDown02Icon} />
      </button>
    </div>
  );
};
