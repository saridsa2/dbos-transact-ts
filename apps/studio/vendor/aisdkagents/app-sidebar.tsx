'use client';

import { PencilEdit02Icon, Search01Icon, SidebarLeftIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AnchorHTMLAttributes, CSSProperties, ComponentType, KeyboardEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface AppSidebarItem {
  id: string;
  label: string;
  /** A 16px mark. Shown alone when the sidebar is a rail. */
  icon?: ReactNode;
  /** Makes the row a link. */
  href?: string;
  /** A count or a short word at the end of the row. */
  badge?: number | string;
}

/** An anchor, or a router's link that takes the same props. */
export type AppSidebarLink = 'a' | ComponentType<AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>;

export interface AppSidebarAccount {
  name: string;
  /** A plan or an email under the name. */
  detail?: string;
  /** An image URL, or any mark. Without one the row shows initials. */
  avatar?: ReactNode;
}

export interface AppSidebarUsage {
  /** What is being measured: `Weekly messages`. */
  label: string;
  used: number;
  limit: number;
  /** One line under the bar: `Resets Monday`. */
  detail?: string;
}

export interface AppSidebarClassNames {
  root?: string;
  header?: string;
  brand?: string;
  row?: string;
  nav?: string;
  content?: string;
  footer?: string;
  usage?: string;
  account?: string;
}

export interface AppSidebarProps {
  /** The product or workspace mark, about 20px. */
  brand?: ReactNode;
  /** The product or workspace name beside the mark. */
  name?: string;
  /** Shows the rail: marks only, with each label as a tooltip. */
  collapsed?: boolean;
  /** Rendered only when passed: the button that closes and opens the sidebar. */
  onToggle?: () => void;
  /** Rendered only when passed. */
  onNewChat?: () => void;
  newChatLabel?: string;
  /** Rendered only when passed. Open your command palette or search here. */
  onSearch?: () => void;
  searchLabel?: string;
  /** Shown beside Search, after Cmd or Ctrl. Bind the key where search lives. */
  searchShortcut?: string;
  items?: readonly AppSidebarItem[];
  activeItem?: string;
  onNavigate?: (id: string) => void;
  /** What a row with an `href` renders as. Pass a router's link. */
  linkAs?: AppSidebarLink;
  /** The part that scrolls: a session list, projects, anything. */
  children?: ReactNode;
  /** Sits above the account row. */
  footer?: ReactNode;
  usage?: AppSidebarUsage;
  account?: AppSidebarAccount;
  /** Makes the account row a button. */
  onAccount?: () => void;
  label?: string;
  className?: string;
  classNames?: AppSidebarClassNames;
  /** Handy for overriding the --app-sidebar-* theme vars inline */
  style?: CSSProperties;
}

/** Past this share of the limit the meter changes tone. */
const USAGE_WARN = 0.9;

const THEME_VARS = [
  '[--app-sidebar-hover:color-mix(in_oklab,var(--foreground)_5%,transparent)]',
  '[--app-sidebar-active:color-mix(in_oklab,var(--foreground)_8%,transparent)]',
  '[--app-sidebar-press:color-mix(in_oklab,var(--foreground)_11%,transparent)]',
  'dark:[--app-sidebar-hover:color-mix(in_oklab,var(--foreground)_7%,transparent)]',
  'dark:[--app-sidebar-active:color-mix(in_oklab,var(--foreground)_11%,transparent)]',
  'dark:[--app-sidebar-press:color-mix(in_oklab,var(--foreground)_15%,transparent)]',
  '[--app-sidebar-warn:#b45309] dark:[--app-sidebar-warn:#fbbf24]',
].join(' ');

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

/** Labels leave at once and come back just behind the widening rail. */
const LABEL_CLASS =
  'min-w-0 transition-opacity ease-out motion-reduce:transition-none group-data-[collapsed=true]/sidebar:opacity-0 group-data-[collapsed=true]/sidebar:duration-100 group-data-[collapsed=false]/sidebar:delay-75 group-data-[collapsed=false]/sidebar:duration-200';

const ROW_CLASS = cn(
  'group/row relative flex h-8 w-full min-w-0 flex-none cursor-pointer items-center rounded-lg border-0 bg-transparent p-0 text-left text-[13px] leading-4 tracking-[-0.01em] text-inherit no-underline transition-colors duration-100 ease-out hover:bg-(--app-sidebar-hover) active:bg-(--app-sidebar-press) motion-reduce:transition-none',
  FOCUS_CLASS,
);

/** Every mark sits in the same 32px box, so nothing moves as the rail opens. */
const SLOT_CLASS =
  'relative inline-flex size-8 flex-none items-center justify-center [&_img]:size-5 [&_img]:rounded-md [&_img]:object-cover [&_svg]:size-4';

const emptySubscribe = () => () => {
  /* The platform does not change while the page is open. */
};

const isApplePlatform = (): boolean => /mac|iphone|ipad|ipod/iu.test(navigator.userAgent);

const useIsApple = () => useSyncExternalStore(emptySubscribe, isApplePlatform, () => true);

const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words.at(0)?.at(0) ?? '';
  const last = words.length > 1 ? (words.at(-1)?.at(0) ?? '') : '';
  return `${first}${last}`.toUpperCase() || '?';
};

const Icon = ({ icon }: { icon: IconSvgElement }) => <HugeiconsIcon aria-hidden="true" icon={icon} strokeWidth={2} />;

const Avatar = ({ account }: { account: AppSidebarAccount }) => {
  const [failed, setFailed] = useState<string | null>(null);
  const { avatar } = account;
  const src = typeof avatar === 'string' ? avatar : null;
  if (avatar && src === null) {
    return avatar;
  }
  return (
    <span
      className="inline-flex size-6 items-center justify-center overflow-hidden rounded-full bg-card text-[10px] leading-none font-medium text-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.08)] select-none dark:shadow-[0_0_0_1px_rgba(255,255,255,0.14)]"
      data-slot="app-sidebar-avatar"
    >
      {src && failed !== src ? (
        // oxlint-disable-next-line nextjs/no-img-element -- installs into projects without next/image
        <img
          alt=""
          className="size-full! rounded-none! object-cover"
          draggable={false}
          onError={() => {
            setFailed(src);
          }}
          src={src}
        />
      ) : (
        initialsOf(account.name)
      )}
    </span>
  );
};

const Usage = ({ className, usage }: { className?: string; usage: AppSidebarUsage }) => {
  const limit = Number.isFinite(usage.limit) && usage.limit > 0 ? usage.limit : 0;
  const used = Number.isFinite(usage.used) ? Math.max(0, usage.used) : 0;
  const share = limit === 0 ? 0 : Math.min(1, used / limit);
  const percent = Math.round(share * 100);
  const warn = share >= USAGE_WARN;
  return (
    <div
      className={cn(LABEL_CLASS, 'flex flex-col gap-1.5 px-2 pt-1 pb-2.5 whitespace-nowrap', className)}
      data-slot="app-sidebar-usage"
      data-warn={warn ? 'true' : undefined}
    >
      <div className="flex items-baseline gap-2 text-xs leading-4">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{usage.label}</span>
        <span
          className={cn('flex-none font-medium tabular-nums', warn ? 'text-(--app-sidebar-warn)' : 'text-foreground')}
        >
          {percent}%
        </span>
      </div>
      <div
        aria-label={usage.label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="h-1 overflow-hidden rounded-full bg-foreground/8"
        role="progressbar"
      >
        <div
          className={cn(
            'h-full origin-left rounded-full transition-[scale,background-color] duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none',
            warn ? 'bg-(--app-sidebar-warn)' : 'bg-foreground/50',
          )}
          style={{ scale: `${share} 1` }}
        />
      </div>
      {usage.detail ? <span className="truncate text-xs leading-4 text-muted-foreground">{usage.detail}</span> : null}
    </div>
  );
};

export const AppSidebar = ({
  brand,
  name,
  collapsed = false,
  onToggle,
  onNewChat,
  newChatLabel = 'New chat',
  onSearch,
  searchLabel = 'Search',
  searchShortcut,
  items = [],
  activeItem,
  onNavigate,
  linkAs: Link = 'a',
  children,
  footer,
  usage,
  account,
  onAccount,
  label = 'Sidebar',
  className,
  classNames,
  style,
}: AppSidebarProps) => {
  const isApple = useIsApple();
  const root = useRef<HTMLElement>(null);
  const brandButton = useRef<HTMLButtonElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);

  // The toggle changes hands as the rail closes: keep focus on whichever shows.
  const [was, setWas] = useState(collapsed);
  const handover = useRef(false);
  if (was !== collapsed) {
    setWas(collapsed);
    handover.current = true;
  }
  useEffect(() => {
    if (!handover.current) {
      return;
    }
    handover.current = false;
    const from = collapsed ? toggleButton.current : brandButton.current;
    const to = collapsed ? brandButton.current : toggleButton.current;
    if (from && document.activeElement === from) {
      to?.focus({ preventScroll: true });
    }
  }, [collapsed]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
      return;
    }
    const rows = [...(root.current?.querySelectorAll<HTMLElement>('[data-slot=app-sidebar-row]') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at === -1) {
      return;
    }
    event.preventDefault();
    rows[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  };

  // As a rail, the mark is the button that opens the sidebar again.
  const canOpen = collapsed && Boolean(onToggle);

  const tip = (text: string): string | undefined => (collapsed ? text : undefined);

  const hasActions = Boolean(onNewChat ?? onSearch) || items.length > 0;

  const accountBody = account ? (
    <>
      <span className={SLOT_CLASS}>
        <Avatar account={account} />
      </span>
      <span className={cn(LABEL_CLASS, 'flex flex-1 flex-col pr-2')}>
        <span className="truncate font-medium text-foreground">{account.name}</span>
        {account.detail ? (
          <span className="truncate text-xs leading-4 text-muted-foreground">{account.detail}</span>
        ) : null}
      </span>
    </>
  ) : null;

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow keys move between the rows inside
    <nav
      aria-label={label}
      className={cn(
        THEME_VARS,
        'group/sidebar flex size-full min-h-0 min-w-0 flex-col overflow-hidden p-2 text-[13px] leading-4 text-muted-foreground',
        className,
        classNames?.root,
      )}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-slot="app-sidebar"
      onKeyDown={onKeyDown}
      ref={root}
      style={style}
    >
      <div className={cn('flex h-8 min-w-0 flex-none items-center', classNames?.header)} data-slot="app-sidebar-header">
        {/* As a rail, the mark is the way back: it turns into the toggle on hover. */}
        <button
          aria-label="Open sidebar"
          className={cn(
            SLOT_CLASS,
            'group/brand rounded-lg border-0 bg-transparent p-0 text-foreground transition-[background-color,scale] duration-100 ease-out enabled:cursor-pointer enabled:hover:bg-(--app-sidebar-hover) enabled:active:scale-[0.96] motion-reduce:transition-none',
            FOCUS_CLASS,
            classNames?.brand,
          )}
          data-slot="app-sidebar-brand"
          disabled={!canOpen}
          onClick={onToggle}
          ref={brandButton}
          title={tip('Open sidebar')}
          type="button"
        >
          {brand ? (
            <span
              className={cn(
                'inline-flex items-center justify-center transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none',
                canOpen &&
                  'group-hover/brand:scale-90 group-hover/brand:opacity-0 group-focus-visible/brand:scale-90 group-focus-visible/brand:opacity-0',
              )}
            >
              {brand}
            </span>
          ) : null}
          {onToggle ? (
            <span
              className={cn(
                'absolute inset-0 inline-flex items-center justify-center text-muted-foreground opacity-0 transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none',
                brand && 'scale-90',
                canOpen && !brand && 'opacity-100',
                canOpen &&
                  brand &&
                  'group-hover/brand:scale-100 group-hover/brand:opacity-100 group-focus-visible/brand:scale-100 group-focus-visible/brand:opacity-100',
              )}
            >
              <Icon icon={SidebarLeftIcon} />
            </span>
          ) : null}
        </button>
        <span
          className={cn(LABEL_CLASS, 'flex-1 truncate pl-0.5 text-sm font-medium tracking-[-0.01em] text-foreground')}
          title={name}
        >
          {name}
        </span>
        {onToggle ? (
          <button
            aria-label="Close sidebar"
            className={cn(
              LABEL_CLASS,
              SLOT_CLASS,
              'cursor-pointer rounded-lg border-0 bg-transparent p-0 text-muted-foreground transition-[background-color,color,opacity,scale] hover:bg-(--app-sidebar-hover) hover:text-foreground active:scale-[0.96]',
              FOCUS_CLASS,
            )}
            data-slot="app-sidebar-toggle"
            inert={collapsed}
            onClick={onToggle}
            ref={toggleButton}
            title="Close sidebar"
            type="button"
          >
            <Icon icon={SidebarLeftIcon} />
          </button>
        ) : null}
      </div>

      {hasActions ? (
        <div className={cn('mt-3 flex min-w-0 flex-none flex-col gap-px', classNames?.nav)} data-slot="app-sidebar-nav">
          {onNewChat ? (
            <button
              aria-label={newChatLabel}
              className={cn(ROW_CLASS, 'text-foreground', classNames?.row)}
              data-slot="app-sidebar-row"
              onClick={onNewChat}
              title={tip(newChatLabel)}
              type="button"
            >
              <span className={SLOT_CLASS}>
                <Icon icon={PencilEdit02Icon} />
              </span>
              <span className={cn(LABEL_CLASS, 'flex-1 truncate pr-2')}>{newChatLabel}</span>
            </button>
          ) : null}
          {onSearch ? (
            <button
              aria-label={searchLabel}
              className={cn(ROW_CLASS, 'text-foreground', classNames?.row)}
              data-slot="app-sidebar-row"
              onClick={onSearch}
              title={tip(searchLabel)}
              type="button"
            >
              <span className={SLOT_CLASS}>
                <Icon icon={Search01Icon} />
              </span>
              <span className={cn(LABEL_CLASS, 'flex-1 truncate')}>{searchLabel}</span>
              {searchShortcut ? (
                <kbd
                  aria-hidden="true"
                  className={cn(LABEL_CLASS, 'mr-2 flex-none font-sans text-xs leading-4 text-muted-foreground')}
                  // The server cannot know the platform.
                  suppressHydrationWarning
                >
                  {isApple ? '⌘' : 'Ctrl '}
                  {searchShortcut.toUpperCase()}
                </kbd>
              ) : (
                <span className="w-2 flex-none" />
              )}
            </button>
          ) : null}
          {items.map((item) => {
            const active = item.id === activeItem;
            const hasBadge = item.badge !== undefined && item.badge !== '';
            const body = (
              <>
                <span className={SLOT_CLASS}>
                  {item.icon}
                  {hasBadge ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-foreground opacity-0 transition-opacity duration-150 ease-out group-data-[collapsed=true]/sidebar:opacity-100 motion-reduce:transition-none"
                    />
                  ) : null}
                </span>
                <span className={cn(LABEL_CLASS, 'flex-1 truncate')}>{item.label}</span>
                {hasBadge ? (
                  <span
                    className={cn(
                      LABEL_CLASS,
                      'mr-2 flex-none text-xs leading-4 font-normal text-muted-foreground tabular-nums',
                    )}
                  >
                    {item.badge}
                  </span>
                ) : (
                  <span className="w-2 flex-none" />
                )}
              </>
            );
            const shared = {
              'aria-label': hasBadge ? `${item.label}, ${item.badge}` : item.label,
              className: cn(
                ROW_CLASS,
                active
                  ? 'bg-(--app-sidebar-active) font-medium text-foreground hover:bg-(--app-sidebar-active)'
                  : 'text-foreground',
                classNames?.row,
              ),
              'data-active': active ? 'true' : undefined,
              'data-slot': 'app-sidebar-row',
              onClick: () => {
                onNavigate?.(item.id);
              },
              title: tip(item.label),
            };
            return item.href ? (
              <Link {...shared} aria-current={active ? 'page' : undefined} href={item.href} key={item.id}>
                {body}
              </Link>
            ) : (
              <button {...shared} aria-pressed={active} key={item.id} type="button">
                {body}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        className={cn(LABEL_CLASS, 'mt-3 flex min-h-0 flex-1 flex-col', classNames?.content)}
        data-slot="app-sidebar-content"
        inert={collapsed}
      >
        {children}
      </div>

      {footer || usage || account ? (
        <div className={cn('flex min-w-0 flex-none flex-col pt-2', classNames?.footer)} data-slot="app-sidebar-footer">
          {footer ? (
            <div className={LABEL_CLASS} inert={collapsed}>
              {footer}
            </div>
          ) : null}
          {usage ? <Usage className={classNames?.usage} usage={usage} /> : null}
          {account && onAccount ? (
            <button
              aria-label={account.detail ? `${account.name}, ${account.detail}` : account.name}
              className={cn(ROW_CLASS, account.detail && 'h-10', classNames?.account)}
              data-slot="app-sidebar-row"
              onClick={onAccount}
              title={tip(account.name)}
              type="button"
            >
              {accountBody}
            </button>
          ) : null}
          {account && !onAccount ? (
            <div
              className={cn('flex w-full min-w-0 items-center', account.detail ? 'h-10' : 'h-8', classNames?.account)}
              data-slot="app-sidebar-account"
              title={tip(account.name)}
            >
              {accountBody}
            </div>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
};
