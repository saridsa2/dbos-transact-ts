'use client';

import { ArrowUp02Icon, StopIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { PaperPlaneIcon } from '@/components/fa-icons';
import type { ChatStatus, UIMessage } from 'ai';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { AppSidebar } from './app-sidebar';
import type { AppSidebarProps } from './app-sidebar';
import { ChatLayout } from './chat-layout';
import type { ChatLayoutProps } from './chat-layout';
import { ChatThread } from './chat-thread';
import type { ChatThreadProps } from './chat-thread';
import { PanelDock } from './panel-dock';
import type { PanelDockItem, PanelDockProps } from './panel-dock';
import { ThreadHeader } from './thread-header';
import type { ThreadHeaderProps } from './thread-header';

export interface ChatScreenClassNames {
  root?: string;
  composer?: string;
  field?: string;
  send?: string;
}

export interface ChatScreenProps<T extends PanelDockItem = PanelDockItem> {
  showThinking?: boolean;
  emptyAlignment?: 'start' | 'center';
  threadLabel?: string;
  /** The host may own identity and actions in a single shared work-area header. */
  showHeader?: boolean;
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  /** The open chat's id. Switching it lands on that chat's last line. */
  id?: string;
  /** `messages` from `useChat`. */
  messages?: readonly UIMessage[];
  /** `status` from `useChat`. */
  status?: ChatStatus;
  /** `error` from `useChat`. */
  error?: Error | string | null;
  /** Called with what was typed. Pass it to `sendMessage({ text })`. */
  onSend?: (text: string) => void | Promise<void>;
  /** `stop` from `useChat`. Shown in place of send while a reply is written. */
  onStop?: () => void;
  /** `regenerate` from `useChat`. Offered after a reply failed. */
  onRetry?: () => void;
  renderMessage?: ChatThreadProps['renderMessage'];
  /** Shown in the middle of a chat with no messages. */
  empty?: ReactNode;
  placeholder?: string;
  /** Replaces the built-in field: a prompt input with mentions and files. */
  composer?: ReactNode;
  /** One quiet line under the field. */
  footnote?: ReactNode;

  title?: string;
  titlePending?: boolean;
  onRename?: (title: string) => void;
  onShare?: () => void;
  /** Anything else the header takes: a model picker as `children`, `actions`. */
  header?: Omit<
    ThreadHeaderProps,
    | 'onRename'
    | 'onShare'
    | 'onTogglePanel'
    | 'onToggleSidebar'
    | 'panelOpen'
    | 'scrolled'
    | 'sidebarOpen'
    | 'title'
    | 'titlePending'
  >;

  /**
   * The left rail: brand, navigation, account, and the chat list as
   * `children`. Leave it out for a screen with no sidebar.
   */
  sidebar?: Omit<AppSidebarProps, 'collapsed' | 'onToggle'>;
  defaultSidebarOpen?: boolean;

  /** What is open beside the thread: artifacts, sources, a browser view. */
  panels?: readonly T[];
  activePanel?: string;
  onActivePanelChange?: (id: string) => void;
  onClosePanel?: (id: string) => void;
  /** Draws one panel. */
  renderPanel?: PanelDockProps<T>['children'];
  /** Anything else the dock takes: `actions`, `keepMounted`, `label`. */
  dock?: Omit<PanelDockProps<T>, 'activeId' | 'children' | 'items' | 'onActiveChange' | 'onClose' | 'onDismiss'>;

  /** Anything else the frame takes: widths, the compact breakpoint. */
  layout?: Omit<
    ChatLayoutProps,
    | 'children'
    | 'onCompactChange'
    | 'onPanelOpenChange'
    | 'onSidebarOpenChange'
    | 'panel'
    | 'panelOpen'
    | 'sidebar'
    | 'sidebarOpen'
  >;
  className?: string;
  classNames?: ChatScreenClassNames;
  /** Handy for overriding the --chat-screen-* theme vars inline */
  style?: CSSProperties;
}

const RAIL_PX = 48;
const FIELD_MAX_PX = 208;

const THEME_VARS = [
  '[--chat-screen-shadow:0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.06),0_4px_12px_-2px_rgba(0,0,0,0.06)]',
  '[--chat-screen-shadow-focus:0_0_0_1px_rgba(0,0,0,0.14),0_1px_2px_-1px_rgba(0,0,0,0.08),0_6px_16px_-2px_rgba(0,0,0,0.09)]',
  'dark:[--chat-screen-shadow:0_0_0_1px_rgba(255,255,255,0.1)]',
  'dark:[--chat-screen-shadow-focus:0_0_0_1px_rgba(255,255,255,0.2)]',
  '[--chat-screen-field:var(--card)] dark:[--chat-screen-field:color-mix(in_oklab,var(--foreground)_4%,var(--card))]',
].join(' ');

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

const hasFinePointer = (): boolean => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export interface ComposerProps {
  busy: boolean;
  chatId: string;
  classNames?: ChatScreenClassNames;
  onSend?: (text: string) => void | Promise<void>;
  onStop?: () => void;
  placeholder: string;
  prefill?: string;
  onDraftChange?: (text: string) => void;
}

/** One growing field. Enter sends, Shift+Enter breaks the line. */
export const ChatComposer = ({
  busy,
  chatId,
  classNames,
  onSend,
  onStop,
  placeholder,
  prefill,
  onDraftChange,
}: ComposerProps) => {
  const field = useRef<HTMLTextAreaElement>(null);
  // What was typed in each chat, so a draft is still there on the way back.
  const drafts = useRef(new Map<string, string>());
  const [text, setText] = useState('');
  const [shownFor, setShownFor] = useState(chatId);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const activeChat = useRef(chatId);
  activeChat.current = chatId;
  if (shownFor !== chatId) {
    setShownFor(chatId);
    setText(drafts.current.get(chatId) ?? '');
  }

  const write = (next: string) => {
    drafts.current.set(chatId, next);
    setText(next);
  };
  useEffect(() => {
    if (prefill) {
      drafts.current.set(chatId, prefill);
      setText(prefill);
    }
  }, [prefill, chatId]);

  useLayoutEffect(() => {
    const node = field.current;
    if (!node) {
      return;
    }
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, FIELD_MAX_PX)}px`;
  }, [text]);

  // A chat that was just opened is ready to type in. Not on touch: that
  // would raise the keyboard over the thread.
  useEffect(() => {
    if (hasFinePointer()) {
      field.current?.focus({ preventScroll: true });
    }
  }, [chatId]);

  useEffect(() => {
    onDraftChange?.(text);
  }, [text, onDraftChange]);

  const ready = text.trim() !== '' && !busy && !sending && !!onSend;
  const canStop = busy && Boolean(onStop);

  const send = async () => {
    if (!ready || sendingRef.current) {
      return;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      await onSend?.(text.trim());
      drafts.current.delete(chatId);
      if (activeChat.current === chatId) setText((current) => (current === text ? '' : current));
    } catch {
      // The host presents the request error; retain the draft for an explicit retry.
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter also confirms a word being composed; that one is not a send.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    send();
  };

  return (
    <form
      className={cn(
        'flex min-w-0 items-end gap-2 rounded-[24px] bg-(--chat-screen-field) py-2 pr-2 pl-4 shadow-(--chat-screen-shadow) transition-shadow duration-200 ease-out focus-within:shadow-(--chat-screen-shadow-focus) motion-reduce:transition-none',
        classNames?.field,
      )}
      data-slot="chat-screen-field"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        aria-label={placeholder}
        className="my-1.5 max-h-52 min-h-6 min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-[15px] leading-6 tracking-[-0.005em] text-card-foreground outline-none placeholder:text-muted-foreground"
        enterKeyHint="send"
        onChange={(event) => {
          write(event.target.value);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        ref={field}
        rows={1}
        value={text}
        readOnly={sending}
      />
      <button
        aria-label={canStop ? 'Stop' : 'Send'}
        className={cn(
          'relative inline-flex size-9 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-foreground p-0 text-background transition-[opacity,scale] duration-150 ease-out active:scale-[0.96] disabled:cursor-default disabled:opacity-25 disabled:active:scale-100 motion-reduce:transition-none',
          FOCUS_CLASS,
          classNames?.send,
        )}
        data-slot="chat-screen-send"
        data-state={canStop ? 'stop' : 'send'}
        disabled={!ready && !canStop}
        onClick={(event) => {
          if (canStop) {
            event.preventDefault();
            onStop?.();
          }
        }}
        type="submit"
      >
        {/* Both marks stay mounted and trade places, so the swap can reverse. */}
        <PaperPlaneIcon
          aria-hidden="true"
          className={cn(
            'absolute size-4.5 transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none',
            canStop ? 'scale-75 opacity-0' : 'scale-100 opacity-100',
          )}
        />
        <HugeiconsIcon
          aria-hidden="true"
          className={cn(
            'absolute size-3.5 fill-current transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none',
            canStop ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
          )}
          icon={StopIcon}
          strokeWidth={2}
        />
      </button>
    </form>
  );
};

const DefaultEmpty = () => (
  <h2 className="m-0 text-center text-2xl leading-8 font-medium tracking-tight text-balance text-card-foreground">
    What should we work on?
  </h2>
);

export const ChatScreen = <T extends PanelDockItem = PanelDockItem>({
  id,
  messages,
  status = 'ready',
  showThinking,
  emptyAlignment,
  threadLabel,
  panelOpen: controlledPanelOpen,
  onPanelOpenChange,
  error,
  onSend,
  onStop,
  onRetry,
  renderMessage,
  empty,
  placeholder = 'Ask anything',
  composer,
  footnote,
  title,
  titlePending,
  onRename,
  onShare,
  header,
  showHeader = true,
  sidebar,
  defaultSidebarOpen = true,
  panels,
  activePanel,
  onActivePanelChange,
  onClosePanel,
  renderPanel,
  dock,
  layout,
  className,
  classNames,
  style,
}: ChatScreenProps<T>) => {
  const [compact, setCompact] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(defaultSidebarOpen);
  const [internalPanelOpen, setInternalPanelOpen] = useState(true);
  const panelOpen = controlledPanelOpen ?? internalPanelOpen;
  const setPanelOpen = (open: boolean) => {
    setInternalPanelOpen(open);
    onPanelOpenChange?.(open);
  };
  const [scrolled, setScrolled] = useState(false);

  const count = panels?.length ?? 0;
  // Opening something shows the panel, even after it was put away.
  const [seen, setSeen] = useState(count);
  if (seen !== count) {
    setSeen(count);
    if (count > seen) {
      setInternalPanelOpen(true);
    }
  }

  // On a phone, picking a chat is the end of the visit to the sidebar.
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) {
    setShownId(id);
    setScrolled(false);
    if (compact && sidebarOpen) {
      setSidebarOpen(false);
    }
  }

  const busy = status === 'submitted' || status === 'streaming';

  const rail = sidebar ? (
    <AppSidebar
      {...sidebar}
      collapsed={!compact && !sidebarOpen}
      onNewChat={
        sidebar.onNewChat
          ? () => {
              sidebar.onNewChat?.();
              if (compact) {
                setSidebarOpen(false);
              }
            }
          : undefined
      }
      onToggle={() => {
        setSidebarOpen(!sidebarOpen);
      }}
    />
  ) : undefined;

  const side =
    panels && count > 0 ? (
      <PanelDock<T>
        {...dock}
        activeId={activePanel}
        items={panels}
        onActiveChange={onActivePanelChange}
        onClose={onClosePanel}
        onDismiss={() => {
          setPanelOpen(false);
        }}
      >
        {renderPanel}
      </PanelDock>
    ) : null;

  return (
    <ChatLayout
      sidebarClosedWidth={RAIL_PX}
      {...layout}
      className={cn(THEME_VARS, className, classNames?.root)}
      onCompactChange={setCompact}
      onPanelOpenChange={setPanelOpen}
      onSidebarOpenChange={setSidebarOpen}
      panel={side}
      panelOpen={panelOpen}
      sidebar={rail}
      sidebarOpen={sidebarOpen}
      style={style}
    >
      {showHeader && (
        <ThreadHeader
          {...header}
          onRename={onRename}
          onShare={onShare}
          onTogglePanel={
            count > 0
              ? () => {
                  setPanelOpen(!panelOpen);
                }
              : undefined
          }
          // Side by side, the rail carries its own toggle.
          onToggleSidebar={
            sidebar && compact
              ? () => {
                  setSidebarOpen(!sidebarOpen);
                }
              : undefined
          }
          panelOpen={panelOpen}
          scrolled={scrolled}
          sidebarOpen={sidebarOpen}
          title={title}
          titlePending={titlePending}
        />
      )}
      <ChatThread
        emptyAlignment={emptyAlignment}
        label={threadLabel}
        showThinking={showThinking}
        empty={empty ?? <DefaultEmpty />}
        error={error}
        id={id}
        messages={messages}
        onRetry={onRetry}
        onScrolledChange={setScrolled}
        renderMessage={renderMessage}
        status={status}
      />
      <div
        className={cn(
          'mx-auto flex w-full max-w-[46rem] flex-none flex-col gap-2 px-4 pb-3',
          !footnote && 'pb-4',
          classNames?.composer,
        )}
        data-slot="chat-screen-composer"
      >
        {composer ?? (
          <ChatComposer
            busy={busy}
            chatId={id ?? ''}
            classNames={classNames}
            onSend={onSend}
            onStop={onStop}
            placeholder={placeholder}
          />
        )}
        {footnote ? (
          <p className="m-0 text-center text-xs leading-4 text-pretty text-muted-foreground">{footnote}</p>
        ) : null}
      </div>
    </ChatLayout>
  );
};
