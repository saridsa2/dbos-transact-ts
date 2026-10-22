'use client';

import {
  Add01Icon,
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Attachment01Icon,
  Cancel01Icon,
  File02Icon,
  FileZipIcon,
  Image01Icon,
  MusicNote01Icon,
  Pdf01Icon,
  RefreshIcon,
  SourceCodeIcon,
  Table01Icon,
  Tick02Icon,
  Txt01Icon,
  Upload01Icon,
  Video01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import type { FileUIPart, UIMessage } from 'ai';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type AttachmentStatus = 'uploading' | 'ready' | 'error';

export type AttachmentKind = 'image' | 'video' | 'audio' | 'pdf' | 'sheet' | 'code' | 'archive' | 'text' | 'file';

export interface Attachment {
  id: string;
  name: string;
  /** IANA media type, such as `image/png`. */
  mediaType: string;
  /** Size in bytes. Read from a data URL when missing. */
  size?: number;
  /** Where the file can be read: an `https`, `blob`, or `data` URL. */
  url?: string;
  /** Defaults to `ready`. */
  status?: AttachmentStatus;
  /** Upload progress from 0 to 1. Leave unset when it cannot be measured. */
  progress?: number;
  /** Why the upload failed, shown in place of the size. */
  error?: string;
}

const EXTENSION_KINDS: Record<string, AttachmentKind> = {
  csv: 'sheet',
  css: 'code',
  gz: 'archive',
  html: 'code',
  js: 'code',
  json: 'code',
  jsx: 'code',
  md: 'text',
  py: 'code',
  rs: 'code',
  sql: 'code',
  tar: 'archive',
  ts: 'code',
  tsv: 'sheet',
  tsx: 'code',
  txt: 'text',
  xls: 'sheet',
  xlsx: 'sheet',
  yaml: 'code',
  yml: 'code',
  zip: 'archive',
};

const MEDIA_KINDS: readonly [string, AttachmentKind][] = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
  ['application/pdf', 'pdf'],
  ['text/csv', 'sheet'],
  ['spreadsheet', 'sheet'],
  ['ms-excel', 'sheet'],
  ['zip', 'archive'],
  ['x-tar', 'archive'],
  ['json', 'code'],
  ['javascript', 'code'],
  ['typescript', 'code'],
  ['text/html', 'code'],
  ['text/css', 'code'],
  ['text/', 'text'],
];

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** What a file is, from its media type first and its extension second. */
export const attachmentKind = (mediaType: string, name = ''): AttachmentKind => {
  const type = mediaType.toLowerCase();
  const byExtension = EXTENSION_KINDS[extensionOf(name)];
  // Code files are often sent as text/plain. The extension says more.
  if (byExtension && (type === '' || type === 'text/plain')) {
    return byExtension;
  }
  for (const [needle, kind] of MEDIA_KINDS) {
    if (type.includes(needle)) {
      return kind;
    }
  }
  return byExtension ?? 'file';
};

const trimDecimal = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

/** `842 B`, `4.2 KB`, `1.3 MB`, `2 GB`. */
export const formatBytes = (bytes: number): string => {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (value < 1000) {
    return `${Math.round(value)} B`;
  }
  if (value < 999_950) {
    return `${trimDecimal(value / 1000)} KB`;
  }
  if (value < 999_950_000) {
    return `${trimDecimal(value / 1_000_000)} MB`;
  }
  return `${trimDecimal(value / 1_000_000_000)} GB`;
};

const dataUrlBytes = (url: string): number | undefined => {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma === -1) {
    return undefined;
  }
  const payload = url.length - comma - 1;
  return url.slice(0, comma).endsWith(';base64') ? Math.floor((payload * 3) / 4) : payload;
};

export const attachmentSize = (attachment: Attachment): number | undefined =>
  attachment.size ?? (attachment.url ? dataUrlBytes(attachment.url) : undefined);

const SOURCE_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'data:']);

/** The URL when it can be shown in the page, otherwise `undefined`. */
const sourceOf = (url?: string): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    return SOURCE_PROTOCOLS.has(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
};

const nameFromUrl = (url: string): string | undefined => {
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return undefined;
  }
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return undefined;
  }
};

/**
 * Attachments for the file parts of a message from `useChat`, so a sent
 * message can show what went with it.
 *
 * @example
 * <AttachmentsTray attachments={attachmentsFromMessage(message)} bare />
 */
export const attachmentsFromMessage = (message?: Pick<UIMessage, 'id' | 'parts'>): Attachment[] => {
  const attachments: Attachment[] = [];
  for (const [index, part] of (message?.parts ?? []).entries()) {
    if (part.type === 'file') {
      attachments.push({
        id: `${message?.id ?? 'message'}-${index}`,
        mediaType: part.mediaType,
        name: part.filename || nameFromUrl(part.url) || part.mediaType,
        status: 'ready',
        url: part.url,
      });
    }
  }
  return attachments;
};

/**
 * File parts for the attachments that finished uploading, ready to send.
 *
 * @example
 * const { sendMessage } = useChat();
 * sendMessage({ files: attachmentsToFileParts(attachments), text });
 */
export const attachmentsToFileParts = (attachments: readonly Attachment[]): FileUIPart[] => {
  const parts: FileUIPart[] = [];
  for (const attachment of attachments) {
    if ((attachment.status ?? 'ready') === 'ready' && attachment.url) {
      parts.push({
        filename: attachment.name,
        mediaType: attachment.mediaType,
        type: 'file',
        url: attachment.url,
      });
    }
  }
  return parts;
};

/**
 * An uploading attachment for a file the user picked. Its `url` is an object
 * URL for the local preview: swap it for the uploaded URL when the upload
 * finishes, and call `URL.revokeObjectURL` on the old one.
 */
export const attachmentFromFile = (file: File, id?: string): Attachment => ({
  id: id ?? `${file.name}-${file.size}-${file.lastModified}`,
  mediaType: file.type || 'application/octet-stream',
  name: file.name,
  progress: 0,
  size: file.size,
  status: 'uploading',
  url: URL.createObjectURL(file),
});

/** Whether a file matches an `accept` list such as `image/*,.pdf`. */
export const acceptsFile = (file: Pick<File, 'name' | 'type'>, accept?: string): boolean => {
  const rules = (accept ?? '')
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) {
    return true;
  }
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith('.')) {
      return name.endsWith(rule);
    }
    return rule.endsWith('/*') ? type.startsWith(rule.slice(0, -1)) : type === rule;
  });
};

export interface AttachmentFileRules {
  accept?: string;
  /** How many more files fit. Leave unset for no limit. */
  room?: number;
}

/**
 * Splits picked files into the ones the tray takes and the ones it turns
 * away. The tray runs this on its own picker, drop, and paste. Call it from
 * a composer that receives files itself, so both follow the same rules.
 */
export const filterAttachmentFiles = (files: readonly File[], { accept, room }: AttachmentFileRules = {}) => {
  const accepted: File[] = [];
  const wrongType: File[] = [];
  const overLimit: File[] = [];
  for (const file of files) {
    if (!acceptsFile(file, accept)) {
      wrongType.push(file);
    } else if (room !== undefined && accepted.length >= Math.max(0, room)) {
      overLimit.push(file);
    } else {
      accepted.push(file);
    }
  }
  return { accepted, overLimit, wrongType };
};

export interface AttachmentsTrayClassNames {
  root?: string;
  header?: string;
  images?: string;
  list?: string;
  item?: string;
}

export interface AttachmentsTrayProps {
  attachments?: readonly Attachment[];
  title?: string;
  /** Drops the card and header, for attachments inside a sent message. */
  bare?: boolean;
  /** Host label for the empty upload picker. Drop and paste remain supported. */
  emptyLabel?: string;
  /**
   * Rendered only when passed: an add action, plus drop and paste on the
   * tray. Called with the files that passed `accept` and `maxFiles`.
   */
  onAdd?: (files: File[]) => void;
  /** Called with the files that were turned away. */
  onReject?: (files: File[]) => void;
  /** `accept` for the picker, drop, and paste, such as `image/*,.pdf`. */
  accept?: string;
  /** Most attachments the tray holds. Shown in the header as "4 of 8". */
  maxFiles?: number;
  /** Rendered only when passed. */
  onRemove?: (attachment: Attachment) => void;
  /** Called instead of `onRemove` while the attachment is still uploading. */
  onCancel?: (attachment: Attachment) => void;
  /** Rendered only when passed, on attachments that failed. */
  onRetry?: (attachment: Attachment) => void;
  /**
   * Called when a ready attachment is opened. Images, video, and audio open
   * in the built-in viewer unless `viewer` is false.
   */
  onOpen?: (attachment: Attachment) => void;
  viewer?: boolean;
  /**
   * How file marks are drawn. `neutral` keeps them grey so images and errors
   * stand out. `color` gives each kind of file its own hue.
   */
  marks?: 'neutral' | 'color';
  addLabel?: string;
  className?: string;
  classNames?: AttachmentsTrayClassNames;
  /** Handy for overriding the --attachments-* theme vars inline */
  style?: CSSProperties;
}

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const DEFAULT_ATTACHMENTS: Attachment[] = [
  {
    id: 'trace',
    mediaType: 'image/svg+xml',
    name: 'agent-trace.svg',
    size: 48_200,
    url: svgUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#e9eef7"/><rect x="14" y="26" width="64" height="9" rx="4.5" fill="#2a78d6"/><rect x="30" y="45" width="76" height="9" rx="4.5" fill="#1baf7a"/><rect x="30" y="64" width="40" height="9" rx="4.5" fill="#eda100"/><rect x="14" y="83" width="88" height="9" rx="4.5" fill="#2a78d6"/></svg>',
    ),
  },
  {
    id: 'tools',
    mediaType: 'text/typescript',
    name: 'tools.ts',
    size: 5900,
  },
  {
    id: 'evals',
    mediaType: 'text/csv',
    name: 'eval-results.csv',
    progress: 0.6,
    size: 212_000,
    status: 'uploading',
  },
];

const ENTER_CLASS =
  'fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-300 ease-out motion-reduce:animate-none';

const THEME_VARS = [
  '[--attachments-mark:var(--muted-foreground)]',
  '[--attachments-video:#8f3d62] dark:[--attachments-video:#e090b0]',
  '[--attachments-audio:#3d4d9c] dark:[--attachments-audio:#8b9ae0]',
  '[--attachments-pdf:#a3472c] dark:[--attachments-pdf:#e39278]',
  '[--attachments-sheet:#4a6b24] dark:[--attachments-sheet:#a8c66a]',
  '[--attachments-code:#7e4eb2] dark:[--attachments-code:#bf9deb]',
  '[--attachments-archive:#3d5a6c] dark:[--attachments-archive:#8eb0c2]',
  '[--attachments-done:#15803d] dark:[--attachments-done:#4ade80]',
  '[--attachments-error-bg:color-mix(in_oklab,var(--destructive)_5%,var(--card))] dark:[--attachments-error-bg:color-mix(in_oklab,var(--destructive)_10%,var(--card))]',
  '[--attachments-error-line:0_0_0_1px_color-mix(in_oklab,var(--destructive)_24%,transparent)]',
  '[--attachments-hairline:0_0_0_1px_rgba(0,0,0,0.06)] dark:[--attachments-hairline:0_0_0_1px_rgba(255,255,255,0.08)]',
  '[--attachments-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]',
  '[--attachments-shadow-hover:0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.08),0_2px_4px_0px_rgba(0,0,0,0.06)]',
  'dark:[--attachments-shadow:0_0_0_1px_rgba(255,255,255,0.08)]',
  'dark:[--attachments-shadow-hover:0_0_0_1px_rgba(255,255,255,0.13)]',
].join(' ');

const KIND_META: Record<AttachmentKind, { icon: IconSvgElement; label: string; color?: string }> = {
  archive: {
    color: 'var(--attachments-archive)',
    icon: FileZipIcon,
    label: 'Archive',
  },
  audio: {
    color: 'var(--attachments-audio)',
    icon: MusicNote01Icon,
    label: 'Audio',
  },
  code: {
    color: 'var(--attachments-code)',
    icon: SourceCodeIcon,
    label: 'Code',
  },
  file: { icon: File02Icon, label: 'File' },
  image: { icon: Image01Icon, label: 'Image' },
  pdf: { color: 'var(--attachments-pdf)', icon: Pdf01Icon, label: 'PDF' },
  sheet: {
    color: 'var(--attachments-sheet)',
    icon: Table01Icon,
    label: 'Sheet',
  },
  text: { icon: Txt01Icon, label: 'Text' },
  video: {
    color: 'var(--attachments-video)',
    icon: Video01Icon,
    label: 'Video',
  },
};

const VIEWABLE = new Set<AttachmentKind>(['image', 'video', 'audio']);
const RING = 2 * Math.PI * 9;
const EASE = [0.4, 0, 0.2, 1] as const;
const DONE_MS = 1100;
const NOTICE_MS = 4000;

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

/** Shown on hover and keyboard focus, and always on touch screens. */
const REVEAL_CLASS =
  'opacity-0 transition-[opacity,background-color,color,transform] group-focus-within/entry:opacity-100 group-hover/entry:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100';

const kindOf = (attachment: Attachment): AttachmentKind => attachmentKind(attachment.mediaType, attachment.name);

const statusOf = (attachment: Attachment): AttachmentStatus => attachment.status ?? 'ready';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const typeLabel = (attachment: Attachment): string => {
  const extension = extensionOf(attachment.name);
  return extension && extension.length <= 5 ? extension.toUpperCase() : KIND_META[kindOf(attachment)].label;
};

const detailOf = (attachment: Attachment): string => {
  const status = statusOf(attachment);
  if (status === 'error') {
    return attachment.error ?? 'Upload failed';
  }
  if (status === 'uploading') {
    return attachment.progress === undefined
      ? 'Uploading…'
      : `Uploading ${Math.round(clamp01(attachment.progress) * 100)}%`;
  }
  const size = attachmentSize(attachment);
  return size === undefined ? typeLabel(attachment) : `${typeLabel(attachment)} · ${formatBytes(size)}`;
};

const Icon = ({ icon, className }: { icon: IconSvgElement; className?: string }) => (
  <HugeiconsIcon aria-hidden="true" className={cn('size-3.5 flex-none', className)} icon={icon} strokeWidth={2} />
);

const IconButton = ({
  label,
  slot,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string;
  slot: string;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: ReactNode;
}) => (
  <button
    aria-label={label}
    className={cn(
      "relative flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground duration-150 ease-out after:absolute after:-inset-1 after:content-[''] hover:enabled:bg-foreground/8 hover:enabled:text-card-foreground active:enabled:scale-[0.96] disabled:cursor-default disabled:opacity-40 motion-reduce:transition-none",
      'transition-[background-color,color,transform]',
      FOCUS_CLASS,
      className,
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

/** A ring that fills with the upload, or spins when progress is unknown. */
const ProgressRing = ({ progress }: { progress: number | undefined }) => (
  <svg
    aria-hidden="true"
    className={cn('size-6 -rotate-90', progress === undefined && 'animate-spin motion-reduce:animate-none')}
    viewBox="0 0 24 24"
  >
    <circle cx="12" cy="12" fill="none" r="9" stroke="currentColor" strokeOpacity={0.2} strokeWidth="2.5" />
    <circle
      className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
      cx="12"
      cy="12"
      fill="none"
      r="9"
      stroke="currentColor"
      strokeDasharray={RING}
      strokeDashoffset={RING * (1 - (progress === undefined ? 0.3 : clamp01(progress)))}
      strokeLinecap="round"
      strokeWidth="2.5"
    />
  </svg>
);

type Phase = 'ring' | 'error' | 'check' | 'idle';

/**
 * Where an attachment is in its upload. `check` holds for a moment after an
 * upload finishes, so the ring resolves into a tick before the file's own
 * mark returns.
 */
const usePhase = (status: AttachmentStatus): Phase => {
  const previous = useRef(status);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (!(was === 'uploading' && status === 'ready')) {
      setFinished(false);
      return;
    }
    setFinished(true);
    const timer = setTimeout(() => {
      setFinished(false);
    }, DONE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  if (status === 'uploading') {
    return 'ring';
  }
  if (status === 'error') {
    return 'error';
  }
  return finished ? 'check' : 'idle';
};

const PhaseMark = ({ phase, progress, idle }: { phase: Phase; progress: number | undefined; idle: ReactNode }) => {
  const reduce = useReducedMotion();
  let content = idle;
  if (phase === 'ring') {
    content = <ProgressRing progress={progress} />;
  } else if (phase === 'error') {
    content = <Icon className="size-4" icon={AlertCircleIcon} />;
  } else if (phase === 'check') {
    content = <Icon className="size-4" icon={Tick02Icon} />;
  }
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.span
        animate={{ opacity: 1, scale: 1 }}
        className="flex"
        exit={{ opacity: 0, scale: 0.7 }}
        initial={{ opacity: 0, scale: 0.7 }}
        key={phase}
        transition={{ duration: reduce ? 0 : 0.16, ease: EASE }}
      >
        {content}
      </motion.span>
    </AnimatePresence>
  );
};

/** Keeps the extension in view when a long name is cut short. */
const FileName = ({ name }: { name: string }) => {
  const extension = extensionOf(name);
  const stem = extension ? name.slice(0, -(extension.length + 1)) : name;
  return (
    <span className="flex min-w-0 text-[13px] leading-[1.35] font-medium">
      <span className="min-w-0 truncate">{stem}</span>
      {extension ? <span className="flex-none">.{extension}</span> : null}
    </span>
  );
};

/** The line under the name. It rolls over when the upload settles. */
const Detail = ({ attachment }: { attachment: Attachment }) => {
  const reduce = useReducedMotion();
  const status = statusOf(attachment);
  return (
    <span className="relative block h-4 overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'block truncate text-xs leading-4 tabular-nums',
            status === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
          exit={{ opacity: 0, y: -8 }}
          initial={{ opacity: 0, y: 8 }}
          key={status}
          transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
        >
          {detailOf(attachment)}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

interface EntryProps {
  attachment: Attachment;
  className?: string;
  onOpen?: (attachment: Attachment) => void;
  onRetry?: (attachment: Attachment) => void;
  /** Draws the mark in the hue of its kind. */
  colorful?: boolean;
  /** Removes the attachment, or cancels it while it uploads. */
  dismiss?: { label: string; run: (from: HTMLElement) => void };
}

const onDismissKey = (dismiss: EntryProps['dismiss']) => (event: KeyboardEvent<HTMLElement>) => {
  if (dismiss && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault();
    dismiss.run(event.currentTarget);
  }
};

const Chip = ({ attachment, className, colorful, onOpen, onRetry, dismiss }: EntryProps) => {
  const status = statusOf(attachment);
  const phase = usePhase(status);
  const meta = KIND_META[kindOf(attachment)];
  const tint = colorful ? meta.color : undefined;
  const body = (
    <>
      <span
        className={cn(
          'flex size-9 flex-none items-center justify-center rounded-lg text-(--attachments-mark) transition-colors duration-200 ease-out motion-reduce:transition-none',
          tint
            ? 'bg-[color-mix(in_oklab,var(--attachments-mark)_14%,var(--card))] dark:bg-[color-mix(in_oklab,var(--attachments-mark)_22%,var(--card))]'
            : 'bg-foreground/6',
          phase === 'error' && 'bg-destructive/10 text-destructive',
          phase === 'check' && 'text-(--attachments-done)',
        )}
        data-slot="attachments-tray-mark"
        style={
          tint
            ? // SAFETY: custom properties are valid CSS; CSSProperties omits `--*` keys.
              ({ '--attachments-mark': tint } as CSSProperties)
            : undefined
        }
      >
        <PhaseMark idle={<Icon className="size-4" icon={meta.icon} />} phase={phase} progress={attachment.progress} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <FileName name={attachment.name} />
        <Detail attachment={attachment} />
      </span>
    </>
  );
  return (
    <div
      className={cn(
        'relative flex min-w-0 items-center gap-1 rounded-[11px] bg-card p-1.5 pr-1 shadow-(--attachments-hairline) transition-[background-color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
        status === 'error' && 'bg-(--attachments-error-bg) shadow-(--attachments-error-line)',
        onOpen && 'hover:bg-muted dark:hover:bg-background',
        className,
      )}
      data-slot="attachments-tray-item"
      data-status={status}
    >
      {onOpen ? (
        <button
          aria-label={`Open ${attachment.name}, ${detailOf(attachment)}`}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent p-0 text-card-foreground after:absolute after:inset-0 after:rounded-[11px] after:content-['']",
            FOCUS_CLASS,
          )}
          onClick={() => {
            onOpen(attachment);
          }}
          onKeyDown={onDismissKey(dismiss)}
          type="button"
        >
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">{body}</span>
      )}
      {status === 'error' && onRetry ? (
        <IconButton
          className="z-1"
          label={`Retry ${attachment.name}`}
          onClick={() => {
            onRetry(attachment);
          }}
          slot="attachments-tray-retry"
        >
          <Icon icon={RefreshIcon} />
        </IconButton>
      ) : null}
      {dismiss ? (
        <IconButton
          className={cn('z-1', REVEAL_CLASS)}
          label={dismiss.label}
          onClick={(event) => {
            dismiss.run(event.currentTarget);
          }}
          slot="attachments-tray-remove"
        >
          <Icon icon={Cancel01Icon} />
        </IconButton>
      ) : null}
    </div>
  );
};

const TILE_FOCUS = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

const ImageTile = ({
  attachment,
  source,
  onOpen,
  onBroken,
  dismiss,
}: EntryProps & { source: string; onBroken: () => void }) => {
  const status = statusOf(attachment);
  const phase = usePhase(status);
  const image = (
    // oxlint-disable-next-line next/no-img-element -- user file, any origin, often a blob or data URL
    <img alt={onOpen ? '' : attachment.name} className="size-full object-cover" onError={onBroken} src={source} />
  );
  return (
    <div
      className="relative size-20 overflow-hidden rounded-xl bg-muted after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] after:content-[''] dark:bg-background dark:after:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
      data-slot="attachments-tray-image"
      data-status={status}
      title={attachment.name}
    >
      {onOpen ? (
        <button
          aria-label={`Open ${attachment.name}, ${detailOf(attachment)}`}
          className={cn(
            'block size-full cursor-zoom-in border-0 bg-transparent p-0 transition-transform duration-200 ease-out hover:scale-[1.03] motion-reduce:transition-none',
            TILE_FOCUS,
          )}
          onClick={() => {
            onOpen(attachment);
          }}
          onKeyDown={onDismissKey(dismiss)}
          type="button"
        >
          {image}
        </button>
      ) : (
        image
      )}
      {phase === 'idle' ? null : (
        <span
          aria-label={detailOf(attachment)}
          className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"
          role="img"
        >
          <PhaseMark idle={null} phase={phase} progress={attachment.progress} />
        </span>
      )}
      {dismiss ? (
        <button
          aria-label={dismiss.label}
          className={cn(
            "absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-full border-0 bg-black/60 p-0 text-white duration-150 ease-out after:absolute after:-inset-1.5 after:content-[''] hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white active:scale-[0.94] motion-reduce:transition-none",
            REVEAL_CLASS,
          )}
          data-slot="attachments-tray-remove"
          onClick={(event) => {
            dismiss.run(event.currentTarget);
          }}
          title={dismiss.label}
          type="button"
        >
          <Icon className="size-3" icon={Cancel01Icon} />
        </button>
      ) : null}
    </div>
  );
};

const ViewerMedia = ({ attachment }: { attachment: Attachment }) => {
  const kind = kindOf(attachment);
  const source = sourceOf(attachment.url);
  if (!source) {
    return null;
  }
  if (kind === 'video') {
    return (
      // oxlint-disable-next-line jsx-a11y/media-has-caption -- a user upload has no caption track to offer
      <video className="max-h-[70vh] max-w-full rounded-lg" controls src={source} />
    );
  }
  if (kind === 'audio') {
    return (
      // oxlint-disable-next-line jsx-a11y/media-has-caption -- a user upload has no caption track to offer
      <audio className="w-80 max-w-full" controls src={source} />
    );
  }
  return (
    // oxlint-disable-next-line next/no-img-element -- user file, any origin, often a blob or data URL
    <img
      alt={attachment.name}
      className="max-h-[70vh] w-auto max-w-full min-w-[min(28rem,100%)] rounded-lg object-contain"
      src={source}
    />
  );
};

/** Keyframes that grow the viewer out of the thumbnail it was opened from. */
const flightFrom = (dialog: HTMLElement, origin: DOMRect | undefined) => {
  const box = dialog.getBoundingClientRect();
  if (!origin || box.width === 0) {
    return [
      { opacity: 0, transform: 'scale(0.96)' },
      { opacity: 1, transform: 'none' },
    ];
  }
  const x = origin.left + origin.width / 2 - (box.left + box.width / 2);
  const y = origin.top + origin.height / 2 - (box.top + box.height / 2);
  const scale = Math.max(0.08, origin.width / box.width);
  return [
    { opacity: 0.2, transform: `translate(${x}px, ${y}px) scale(${scale})` },
    { opacity: 1, transform: 'none' },
  ];
};

const Viewer = ({
  items,
  activeId,
  onChange,
  originOf,
}: {
  items: readonly Attachment[];
  activeId: string | null;
  onChange: (id: string | null) => void;
  /** Where on screen an attachment's thumbnail sits, to fly from and back to. */
  originOf: (id: string) => DOMRect | undefined;
}) => {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDialogElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const index = items.findIndex((item) => item.id === activeId);
  const active = items[index];
  const open = Boolean(active);
  const canFly = !reduce;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (!open) {
      if (dialog.open) {
        dialog.close();
      }
      return;
    }
    if (dialog.open) {
      return;
    }
    dialog.showModal();
    // Focus rests on the media, so arrow keys work and no button is ringed.
    mediaRef.current?.focus();
    if (canFly && activeId) {
      dialog.animate(flightFrom(dialog, originOf(activeId)), {
        duration: 260,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      });
    }
    // Only opening and closing should run this, not a step to the next item.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    const dialog = ref.current;
    if (!dialog?.open || closing.current) {
      return;
    }
    if (!canFly || !activeId) {
      dialog.close();
      return;
    }
    closing.current = true;
    const flight = dialog.animate(flightFrom(dialog, originOf(activeId)).toReversed(), {
      duration: 180,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    });
    const finish = () => {
      closing.current = false;
      dialog.close();
      flight.cancel();
    };
    flight.addEventListener('finish', finish);
    flight.addEventListener('cancel', () => {
      closing.current = false;
    });
  };

  const step = (offset: number) => {
    const next = items[(index + offset + items.length) % items.length];
    if (next) {
      onChange(next.id);
    }
  };
  const size = active ? attachmentSize(active) : undefined;

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- a click on the backdrop closes; Escape is the keyboard path
    <dialog
      aria-label={active ? `Preview of ${active.name}` : 'Preview'}
      className={cn(
        THEME_VARS,
        'm-auto max-h-[calc(100dvh-2rem)] max-w-[min(56rem,calc(100vw-2rem))] flex-col gap-3 rounded-2xl border-0 bg-card p-3 text-card-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_12px_40px_-8px_rgba(0,0,0,0.3)] outline-none backdrop:bg-black/50 open:flex dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_12px_40px_-8px_rgba(0,0,0,0.7)]',
      )}
      data-slot="attachments-tray-viewer"
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const inside =
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom;
        if (!inside) {
          close();
        }
      }}
      onCancel={(event) => {
        // Escape takes the same way out as the close button.
        event.preventDefault();
        close();
      }}
      onClose={() => {
        onChange(null);
      }}
      onKeyDown={(event) => {
        if (items.length < 2) {
          return;
        }
        if (event.key === 'ArrowRight') {
          step(1);
        } else if (event.key === 'ArrowLeft') {
          step(-1);
        }
      }}
      ref={ref}
      tabIndex={-1}
    >
      {active ? (
        <>
          <div className="flex h-6 min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] leading-tight font-medium tracking-[-0.01em]">
              {active.name}
            </span>
            <span className="flex-none text-xs leading-4 text-muted-foreground tabular-nums">
              {items.length > 1 ? `${index + 1} of ${items.length}` : ''}
              {items.length > 1 && size !== undefined ? ' · ' : ''}
              {size === undefined ? '' : formatBytes(size)}
            </span>
            {items.length > 1 ? (
              <span className="flex flex-none items-center">
                <IconButton
                  label="Previous"
                  onClick={() => {
                    step(-1);
                  }}
                  slot="attachments-tray-previous"
                >
                  <Icon className="size-3" icon={ArrowLeft01Icon} />
                </IconButton>
                <IconButton
                  label="Next"
                  onClick={() => {
                    step(1);
                  }}
                  slot="attachments-tray-next"
                >
                  <Icon className="size-3" icon={ArrowRight01Icon} />
                </IconButton>
              </span>
            ) : null}
            <IconButton label="Close preview" onClick={close} slot="attachments-tray-close">
              <Icon icon={Cancel01Icon} />
            </IconButton>
          </div>
          <div
            className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-muted p-2 outline-none dark:bg-background"
            ref={mediaRef}
            tabIndex={-1}
          >
            <ViewerMedia attachment={active} key={active.id} />
          </div>
        </>
      ) : null}
    </dialog>
  );
};

const hasFiles = (event: DragEvent<HTMLElement>): boolean => event.dataTransfer.types.includes('Files');

const draggedCount = (event: DragEvent<HTMLElement>): number =>
  [...event.dataTransfer.items].filter((item) => item.kind === 'file').length;

/** What the tray holds, in one line: counts by state, or the total size. */
const summaryOf = (attachments: readonly Attachment[], maxFiles: number | undefined): string => {
  const uploading = attachments.filter((attachment) => statusOf(attachment) === 'uploading').length;
  const failed = attachments.filter((attachment) => statusOf(attachment) === 'error').length;
  const ready = attachments.length - uploading - failed;
  if (uploading > 0 || failed > 0) {
    return [
      ready > 0 ? `${ready} ready` : '',
      uploading > 0 ? `${uploading} uploading` : '',
      failed > 0 ? `${failed} failed` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  let total = 0;
  for (const attachment of attachments) {
    total += attachmentSize(attachment) ?? 0;
  }
  const count = maxFiles === undefined ? plural(attachments.length, 'file') : `${attachments.length} of ${maxFiles}`;
  return total > 0 ? `${count} · ${formatBytes(total)}` : count;
};

const noticeOf = (wrongType: number, overLimit: number, maxFiles: number | undefined): string => {
  if (wrongType > 0 && overLimit > 0) {
    return `${plural(wrongType + overLimit, 'file')} skipped`;
  }
  return wrongType > 0
    ? `${plural(wrongType, 'file')} skipped: type not accepted`
    : `${plural(overLimit, 'file')} skipped: limit of ${maxFiles ?? 0}`;
};

/** A short message that clears itself. */
const useNotice = () => {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);

  return [notice, setNotice] as const;
};

/** Moves focus to the next attachment, so removing one never drops it. */
const focusNeighbor = (from: HTMLElement) => {
  const entry = from.closest('[data-slot=attachments-tray-entry]');
  const sibling = entry?.nextElementSibling ?? entry?.previousElementSibling;
  const target =
    sibling?.querySelector<HTMLElement>('button') ??
    from.closest('[data-slot=attachments-tray]')?.querySelector<HTMLElement>('[data-slot=attachments-tray-add]');
  target?.focus();
};

const FILES_CLASS =
  'm-0 grid list-none grid-cols-1 gap-1.5 p-0 @sm/attachments:grid-cols-2 @2xl/attachments:grid-cols-3';

export const AttachmentsTray = ({
  attachments = DEFAULT_ATTACHMENTS,
  title = 'Attachments',
  bare = false,
  emptyLabel = 'Drop, paste, or browse for files',
  onAdd,
  onReject,
  accept,
  maxFiles,
  onRemove,
  onCancel,
  onRetry,
  onOpen,
  viewer = true,
  marks = 'neutral',
  addLabel = 'Add files',
  className,
  classNames,
  style,
}: AttachmentsTrayProps) => {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useNotice();

  const room = maxFiles === undefined ? undefined : Math.max(0, maxFiles - attachments.length);
  const full = room === 0;

  const imageSource = (attachment: Attachment): string | undefined =>
    kindOf(attachment) === 'image' && statusOf(attachment) !== 'error' && !broken.has(attachment.id)
      ? sourceOf(attachment.url)
      : undefined;
  const images = attachments.filter((attachment) => imageSource(attachment) !== undefined);
  const files = attachments.filter((attachment) => imageSource(attachment) === undefined);

  const viewable = viewer
    ? attachments.filter(
        (attachment) =>
          statusOf(attachment) === 'ready' &&
          VIEWABLE.has(kindOf(attachment)) &&
          sourceOf(attachment.url) !== undefined,
      )
    : [];
  const isViewable = (attachment: Attachment) => viewable.some((item) => item.id === attachment.id);

  const originOf = (id: string) =>
    rootRef.current
      ?.querySelector(
        `[data-attachment="${CSS.escape(id)}"] :is([data-slot=attachments-tray-image], [data-slot=attachments-tray-mark])`,
      )
      ?.getBoundingClientRect();

  const open = (attachment: Attachment) => {
    onOpen?.(attachment);
    if (isViewable(attachment)) {
      setViewing(attachment.id);
    }
  };
  const openFor = (attachment: Attachment) =>
    statusOf(attachment) === 'ready' && (Boolean(onOpen) || isViewable(attachment)) ? open : undefined;

  const dismissFor = (attachment: Attachment): EntryProps['dismiss'] => {
    const uploading = statusOf(attachment) === 'uploading';
    const handler = uploading ? onCancel : onRemove;
    if (!handler) {
      return undefined;
    }
    return {
      label: uploading ? `Cancel upload of ${attachment.name}` : `Remove ${attachment.name}`,
      run: (from) => {
        focusNeighbor(from);
        handler(attachment);
      },
    };
  };

  const add = (list: FileList | null) => {
    if (!onAdd || !list || list.length === 0) {
      return;
    }
    const { accepted, overLimit, wrongType } = filterAttachmentFiles([...list], { accept, room });
    if (accepted.length > 0) {
      onAdd(accepted);
    }
    if (wrongType.length > 0 || overLimit.length > 0) {
      onReject?.([...wrongType, ...overLimit]);
      setNotice(noticeOf(wrongType.length, overLimit.length, maxFiles));
    }
  };

  if (attachments.length === 0 && !onAdd) {
    return null;
  }

  const entryMotion = {
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.94 },
    initial: { opacity: 0, scale: 0.94 },
    layout: !reduce,
    transition: { duration: reduce ? 0 : 0.2, ease: EASE },
  };

  return (
    <section
      aria-label={title}
      className={cn(
        THEME_VARS,
        '@container/attachments relative flex w-full max-w-full min-w-0 flex-col text-card-foreground',
        bare
          ? 'gap-1.5'
          : 'gap-3 rounded-2xl bg-card p-3 shadow-(--attachments-shadow) transition-shadow duration-150 ease-out hover:shadow-(--attachments-shadow-hover)',
        className,
        classNames?.root,
      )}
      data-dragging={dragging > 0 ? '' : undefined}
      data-slot="attachments-tray"
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node && event.currentTarget.contains(next))) {
          setDragging(0);
        }
      }}
      onDragOver={(event) => {
        if (onAdd && hasFiles(event)) {
          event.preventDefault();
          setDragging(Math.max(1, draggedCount(event)));
        }
      }}
      onDrop={(event) => {
        if (onAdd && hasFiles(event)) {
          event.preventDefault();
          setDragging(0);
          add(event.dataTransfer.files);
        }
      }}
      onPaste={(event) => {
        if (onAdd && event.clipboardData.files.length > 0) {
          event.preventDefault();
          add(event.clipboardData.files);
        }
      }}
      ref={rootRef}
      style={style}
    >
      {bare ? null : (
        <div
          className={cn(ENTER_CLASS, 'flex h-6 min-w-0 items-center gap-2', classNames?.header)}
          data-slot="attachments-tray-header"
        >
          <span className="inline-flex size-6 flex-none items-center justify-center rounded-md bg-foreground/6 text-muted-foreground">
            <Icon icon={Attachment01Icon} />
          </span>
          <div className="max-w-[60%] flex-none truncate text-[13px] leading-tight font-medium tracking-[-0.01em]">
            {title}
          </div>
          <output
            aria-live="polite"
            className={cn(
              'min-w-0 flex-1 truncate text-right text-xs leading-4 tabular-nums',
              notice ? 'text-destructive' : 'text-muted-foreground',
            )}
            data-slot="attachments-tray-summary"
          >
            {notice ?? (attachments.length > 0 ? summaryOf(attachments, maxFiles) : '')}
          </output>
          {onAdd ? (
            <IconButton
              disabled={full}
              label={full ? `Limit of ${maxFiles} reached` : addLabel}
              onClick={() => {
                inputRef.current?.click();
              }}
              slot="attachments-tray-add"
            >
              <Icon icon={Add01Icon} />
            </IconButton>
          ) : null}
        </div>
      )}

      {images.length > 0 ? (
        <ul
          className={cn(ENTER_CLASS, 'm-0 flex list-none flex-wrap gap-1.5 p-0 delay-100', classNames?.images)}
          data-slot="attachments-tray-images"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {images.map((attachment) => (
              <motion.li
                className="group/entry flex-none"
                data-attachment={attachment.id}
                data-slot="attachments-tray-entry"
                key={attachment.id}
                {...entryMotion}
              >
                <ImageTile
                  attachment={attachment}
                  dismiss={dismissFor(attachment)}
                  onBroken={() => {
                    setBroken((current) => new Set(current).add(attachment.id));
                  }}
                  onOpen={openFor(attachment)}
                  source={imageSource(attachment) ?? ''}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}

      {files.length > 0 ? (
        <ul className={cn(ENTER_CLASS, FILES_CLASS, 'delay-100', classNames?.list)} data-slot="attachments-tray-list">
          <AnimatePresence initial={false} mode="popLayout">
            {files.map((attachment) => (
              <motion.li
                className="group/entry min-w-0"
                data-attachment={attachment.id}
                data-slot="attachments-tray-entry"
                key={attachment.id}
                {...entryMotion}
              >
                <Chip
                  attachment={attachment}
                  className={classNames?.item}
                  colorful={marks === 'color'}
                  dismiss={dismissFor(attachment)}
                  onOpen={openFor(attachment)}
                  onRetry={onRetry}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}

      {onAdd && attachments.length === 0 ? (
        <button
          className={cn(
            ENTER_CLASS,
            'flex h-20 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-0 bg-muted px-3 text-[13px] leading-4 text-muted-foreground transition-[background-color,color,transform] delay-100 duration-150 ease-out hover:text-card-foreground active:scale-[0.99] motion-reduce:transition-none dark:bg-background',
            FOCUS_CLASS,
          )}
          data-slot="attachments-tray-empty"
          onClick={() => {
            inputRef.current?.click();
          }}
          type="button"
        >
          <Icon className="size-4" icon={Upload01Icon} />
          {emptyLabel}
        </button>
      ) : null}

      {onAdd && bare && attachments.length > 0 ? (
        <button
          className={cn(
            'inline-flex h-6 cursor-pointer items-center gap-1 self-start rounded-full border-0 bg-foreground/6 px-2.5 text-xs leading-none font-medium text-card-foreground transition-[background-color,transform] duration-150 ease-out hover:enabled:bg-foreground/10 active:enabled:scale-[0.96] disabled:cursor-default disabled:opacity-40 motion-reduce:transition-none',
            FOCUS_CLASS,
          )}
          data-slot="attachments-tray-add"
          disabled={full}
          onClick={() => {
            inputRef.current?.click();
          }}
          type="button"
        >
          <Icon className="size-3" icon={Add01Icon} />
          {addLabel}
        </button>
      ) : null}

      {onAdd ? (
        <input
          accept={accept}
          aria-label={addLabel}
          hidden
          multiple
          onChange={(event) => {
            add(event.target.files);
            event.target.value = '';
          }}
          ref={inputRef}
          type="file"
        />
      ) : null}

      {dragging > 0 ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex animate-in items-center justify-center gap-2 rounded-[inherit] bg-card/85 text-[13px] leading-4 font-medium text-card-foreground shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--primary)_55%,transparent)] backdrop-blur-[2px] duration-150 fade-in-0 motion-reduce:animate-none"
          data-slot="attachments-tray-drop"
        >
          <Icon className="size-4 text-primary" icon={Upload01Icon} />
          {full ? `Limit of ${maxFiles} reached` : `Drop ${dragging > 1 ? plural(dragging, 'file') : 'file'} to attach`}
        </div>
      ) : null}

      {viewer ? <Viewer activeId={viewing} items={viewable} onChange={setViewing} originOf={originOf} /> : null}
    </section>
  );
};
