'use client';
/** Adapted from @reactbits-pro/ai-chat-3. Controlled host data replaces the demo transport. */
import { useCallback, useEffect, useRef, useState, type RefObject, type ReactNode, type Ref } from 'react';
import { Button } from '@/components/base/buttons/button';
import { TextArea } from '@/components/base/textarea/textarea';
import { Tooltip } from '@/components/base/tooltip/tooltip';
import { ArrowDown, PaperPlaneIcon } from '@/components/fa-icons';
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const canvas = 'bg-white dark:bg-neutral-950';
const text1 = 'text-neutral-900 dark:text-neutral-100';
const text2 = 'text-neutral-900/80 dark:text-neutral-100/80';
const text3 = 'text-neutral-900/66 dark:text-neutral-100/66';
const typeBodySm = 'text-[14px]/[20px] font-normal';
const focusRingInset =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]';
const primaryButton =
  'relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,outline-color,scale,filter] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] active:duration-[60ms] motion-reduce:active:scale-100 disabled:cursor-not-allowed aria-busy:cursor-progress focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_84%,white),color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_94%,black))] text-[var(--rb-accent-fg,oklch(100%_0_0))] shadow-[inset_0_2px_0_-1px_rgb(255_255_255/0.2),inset_0_-2px_0_-1px_rgb(0_0_0/0.3),inset_0_0_0_1px_color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_88%,black),0_1px_1px_rgb(0_0_0/0.22),0_2px_5px_-2px_rgb(0_0_0/0.3)] hover:not-disabled:brightness-110 active:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_88%,black),inset_0_1px_2px_rgb(0_0_0/0.42)] disabled:opacity-40 disabled:shadow-none dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_84%,white),color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_94%,black))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:shadow-[inset_0_2px_0_-1px_rgb(255_255_255/0.2),inset_0_-2px_0_-1px_rgb(0_0_0/0.3),inset_0_0_0_1px_color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_88%,black),0_1px_1px_rgb(0_0_0/0.66),0_2px_5px_-2px_rgb(0_0_0/0.9)] dark:active:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_88%,black),inset_0_1px_2px_rgb(0_0_0/0.42)] dark:disabled:shadow-none';
const secondaryButton =
  'relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,outline-color,scale,filter] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] active:duration-[60ms] motion-reduce:active:scale-100 disabled:cursor-not-allowed aria-busy:cursor-progress focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] border border-neutral-900/12 bg-white text-neutral-900 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] hover:not-disabled:border-neutral-900/32 hover:not-disabled:bg-linear-to-b hover:not-disabled:from-neutral-900/3 hover:not-disabled:to-neutral-900/3 active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)] disabled:border-neutral-900/8 disabled:text-neutral-900/40 disabled:shadow-none dark:border-neutral-100/14 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-disabled:border-neutral-100/32 dark:hover:not-disabled:from-neutral-100/3 dark:hover:not-disabled:to-neutral-100/3 dark:active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] dark:disabled:border-neutral-100/8 dark:disabled:text-neutral-100/40';
const buttonMd = 'h-8 gap-2 rounded-[var(--rb-r-sm,6px)] px-4 text-[14px]/[16px] font-[450]';
const iconButtonSm = 'size-7 rounded-[var(--rb-r-sm,6px)]';
const statusWord = 'inline-flex items-start gap-1.5 text-[14px]/[16px] font-[450] tabular-nums';
const statusIdle = 'text-neutral-900/66 dark:text-neutral-100/66';
const arcLine = 'flex h-lh shrink-0 items-center';
const runningArc =
  'inline-block size-2.5 shrink-0 rounded-full border border-current border-t-transparent animate-spin motion-reduce:animate-none';
const panel =
  'relative flex min-w-0 flex-col overflow-hidden rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-neutral-50 text-neutral-900 dark:text-neutral-100 dark:bg-neutral-900';
const panelHead = 'flex min-h-10 min-w-0 shrink-0 items-center gap-2 px-4 has-[button]:pe-2';
const panelBody =
  'mx-1 mb-1 flex min-w-0 flex-col overflow-hidden rounded-[var(--rb-r-sm,6px)] border border-neutral-900/8 bg-white [&:has(+*)]:mb-0 dark:border-neutral-100/8 dark:bg-neutral-950';
const frameTitle = 'min-w-0 truncate text-[14px]/[16px] font-[450] text-neutral-900 dark:text-neutral-100';
const rowsRuled = 'divide-y divide-neutral-900/8 dark:divide-neutral-100/8';
const itemRowSm =
  'relative flex min-h-8 w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-left text-neutral-900 dark:text-neutral-100 transition-[background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]';
const itemRowInteractive =
  'cursor-pointer hover:bg-neutral-900/5 dark:hover:bg-neutral-100/5 active:bg-neutral-900/8 dark:active:bg-neutral-100/8';
const cornerSm = 'rounded-[var(--rb-r-sm,6px)]';
const emptyTitle = 'text-[16px]/[20px] font-[450] tracking-[-0.015em] text-neutral-900 dark:text-neutral-100';
const emptyDescription = 'max-w-[48ch] text-[14px]/[20px] text-neutral-900/80 dark:text-neutral-100/80';
const userBubble =
  'w-fit max-w-full rounded-[var(--rb-r-lg,10px)] border border-neutral-900/10 dark:border-neutral-100/14 bg-white dark:bg-neutral-900 px-3.5 py-2 text-[14px]/[20px] whitespace-pre-wrap text-neutral-900 dark:text-neutral-100 [overflow-wrap:anywhere]';
const prose =
  'flex min-w-0 flex-col gap-3 text-[14px]/[20px] text-neutral-900 dark:text-neutral-100 [overflow-wrap:anywhere]';
const activityLine =
  'relative flex w-fit max-w-full min-w-0 items-center gap-2 text-[14px]/[16px] font-[450] text-neutral-900 dark:text-neutral-100';
const composer =
  'relative flex w-full min-w-0 flex-col rounded-[var(--rb-r-lg,10px)] border border-neutral-900/12 bg-white text-neutral-900 dark:text-neutral-100 shadow-[0_1px_2px_-1px_rgb(0_0_0/0.12)] transition-[border-color,box-shadow] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:not-focus-within:border-neutral-900/32 focus-within:border-[var(--rb-accent,oklch(20.5%_0_0))] focus-within:ring-3 focus-within:ring-neutral-900/8 dark:border-neutral-100/14 dark:bg-neutral-900 dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.36)] dark:hover:not-focus-within:border-neutral-100/32 dark:focus-within:border-[var(--rb-accent,oklch(100%_0_0))] dark:focus-within:ring-neutral-100/8';
const composerRow = 'flex min-w-0 items-end gap-1 p-2';
const composerInput =
  'max-h-40 min-h-5 min-w-0 flex-auto resize-none bg-transparent px-1.5 py-1 field-sizing-content text-[14px]/[20px] text-neutral-900 dark:text-neutral-100 outline-none placeholder:text-neutral-900/66 dark:placeholder:text-neutral-100/66';
const fadeTop =
  'bg-linear-to-b from-white to-transparent transition-opacity duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] dark:from-neutral-950';
const fadeBottom =
  'bg-linear-to-t from-white to-transparent transition-opacity duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] dark:from-neutral-950';

function useStickToBottom(scrollRef: RefObject<HTMLDivElement | null>) {
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const sync = () => {
      const overflowing = el.scrollHeight - el.clientHeight > 1;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = !overflowing || distance < 24;
      stickRef.current = atBottom;
      setShowJump(overflowing && !atBottom);
    };

    const onIntent = (e: WheelEvent | TouchEvent) => {
      const up = 'deltaY' in e ? e.deltaY < 0 : true;
      if (!up) return;
      if (el.scrollHeight - el.clientHeight > 1 && el.scrollTop > 0) {
        stickRef.current = false;
      }
    };

    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
      sync();
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    el.addEventListener('wheel', onIntent, { passive: true });
    el.addEventListener('touchmove', onIntent, { passive: true });
    el.addEventListener('scroll', sync, { passive: true });

    el.scrollTop = el.scrollHeight;
    sync();
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', onIntent);
      el.removeEventListener('touchmove', onIntent);
      el.removeEventListener('scroll', sync);
    };
  }, [scrollRef]);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, [scrollRef]);

  return { showJump, jumpToLatest };
}

export function AiChat3<Message extends { id: string; role: string; content: string }>({
  messages,
  renderMessage,
  children,
  footer,
  emptyContent,
}: {
  messages: readonly Message[];
  renderMessage: (message: Message) => ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  emptyContent?: ReactNode;
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const { showJump, jumpToLatest } = useStickToBottom(transcriptRef);
  return (
    <div className="rb-agent-conversation" data-registry-component="ai-chat-3">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={transcriptRef} className="rb-agent-transcript" aria-label="Agent conversation">
          <div className="rb-agent-transcript-content">
            {!messages.length && emptyContent}
            {messages.map((message) => (
              <article
                key={message.id}
                className={message.role === 'user' ? 'rb-agent-message rb-agent-message-user' : 'rb-agent-message'}
                aria-label={message.role === 'user' ? 'Your message' : 'Workspace agent message'}
              >
                <div className={message.role === 'user' ? userBubble : prose}>{renderMessage(message)}</div>
              </article>
            ))}
            {children}
          </div>
        </div>
        {showJump && (
          <div className="rb-agent-jump">
            <Button color="secondary" iconLeading={ArrowDown} onPress={jumpToLatest}>
              Latest updates
            </Button>
          </div>
        )}
      </div>
      {footer}
    </div>
  );
}

/** React Bits ai-chat-3 composer with controlled transport and Untitled UI input/action. */
export function AiChat3Composer({
  value,
  onChange,
  onSubmit,
  inputRef,
  label,
  placeholder,
  disabled = false,
  busy = false,
  running = false,
  allowGuidance = false,
  onStop,
  submitLabel = 'Send',
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  running?: boolean;
  allowGuidance?: boolean;
  onStop?: () => void;
  submitLabel?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [value]);
  const submit = () => {
    if (!disabled && !busy && (!running || allowGuidance) && value.trim()) onSubmit();
  };
  return (
    <form
      className={cx(composer, 'rb-agent-composer')}
      data-registry-component="ai-chat-3-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={cx(composerRow, 'rb-agent-composer-row')}>
        <TextArea
          textAreaRef={(el) => {
            textarea.current = el;
            if (typeof inputRef === 'function') inputRef(el);
            else if (inputRef) inputRef.current = el;
          }}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={10000}
          isDisabled={disabled || busy}
          className="rb-agent-composer-field"
          textAreaClassName="rb-agent-composer-input"
        />
        {running && allowGuidance && !!value.trim() && (
          <Tooltip title="Send guidance">
            <Button
              type="submit"
              color="primary"
              size="sm"
              iconLeading={PaperPlaneIcon}
              aria-label="Send guidance"
              isDisabled={disabled || busy}
            />
          </Tooltip>
        )}
        <Tooltip title={running ? 'Stop' : busy ? 'Sending…' : submitLabel}>
          <Button
            type={running ? 'button' : 'submit'}
            color="primary"
            size="sm"
            iconLeading={running ? <span className="rb-agent-stop-icon" aria-hidden="true" /> : PaperPlaneIcon}
            aria-label={running ? 'Stop agent' : busy ? 'Sending…' : submitLabel}
            aria-busy={busy}
            isDisabled={disabled || busy || (!running && !value.trim())}
            onPress={running ? onStop : undefined}
          />
        </Tooltip>
      </div>
    </form>
  );
}
