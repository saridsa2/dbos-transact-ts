"use client";

import { Cancel01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface PanelDockItem {
  id: string;
  title: string;
  /** A 16px mark for what the item is: a document, a page, a file. */
  icon?: ReactNode;
  /** True while the item is still being written or loaded. */
  busy?: boolean;
  /** Set to `false` for an item that cannot be closed on its own. */
  closable?: boolean;
}

export interface PanelDockClassNames {
  root?: string;
  header?: string;
  tabs?: string;
  tab?: string;
  title?: string;
  actions?: string;
  panel?: string;
}

export interface PanelDockProps<T extends PanelDockItem = PanelDockItem> {
  /** What is open, in tab order. */
  items?: readonly T[];
  activeId?: string;
  defaultActiveId?: string;
  onActiveChange?: (id: string) => void;
  /** Rendered only when passed: closes one item. Remove it from `items`. */
  onClose?: (id: string) => void;
  /** Rendered only when passed: the button that puts the whole dock away. */
  onDismiss?: () => void;
  /** Draws an item: an artifact, a source, a browser view. */
  children?: (item: T, info: { active: boolean }) => ReactNode;
  /**
   * Keeps an item that has been shown mounted while another is in front, so
   * a preview does not reload. Set to `false` to mount only the one in front.
   */
  keepMounted?: boolean;
  /** Sits before the dismiss button, for the item in front. */
  actions?: (item: T) => ReactNode;
  /** Shown when nothing is open. */
  empty?: ReactNode;
  label?: string;
  className?: string;
  classNames?: PanelDockClassNames;
  /** Handy for overriding the --panel-dock-* theme vars inline */
  style?: CSSProperties;
}

/**
 * The item to bring forward when one closes: the one after it, or the one
 * before when it was last. `undefined` when it was the only one.
 */
export const panelAfterClose = (
  items: readonly PanelDockItem[],
  closingId: string,
  activeId: string | undefined
): string | undefined => {
  if (activeId !== closingId) {
    return activeId;
  }
  const at = items.findIndex((item) => item.id === closingId);
  return (items[at + 1] ?? items[at - 1])?.id;
};

const EDGE_FADE_PX = 20;

const THEME_VARS = [
  "[--panel-dock-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]",
  "dark:[--panel-dock-shadow:0_0_0_1px_rgba(255,255,255,0.08)]",
  "[--panel-dock-hover:color-mix(in_oklab,var(--foreground)_5%,transparent)]",
  "[--panel-dock-active:color-mix(in_oklab,var(--foreground)_8%,transparent)]",
  "dark:[--panel-dock-hover:color-mix(in_oklab,var(--foreground)_8%,transparent)]",
  "dark:[--panel-dock-active:color-mix(in_oklab,var(--foreground)_12%,transparent)]",
  "[--panel-dock-line:color-mix(in_oklab,var(--foreground)_8%,transparent)]",
  "dark:[--panel-dock-line:color-mix(in_oklab,var(--foreground)_12%,transparent)]",
].join(" ");

const FOCUS_CLASS =
  "focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none";

const ICON_BUTTON_CLASS = cn(
  "inline-flex size-8 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground transition-[background-color,color,scale] duration-100 ease-out hover:bg-(--panel-dock-hover) hover:text-card-foreground active:scale-[0.96] motion-reduce:transition-none [&_svg]:size-4",
  FOCUS_CLASS
);

const MARK_CLASS =
  "inline-flex size-4 flex-none items-center justify-center [&_img]:size-full [&_img]:rounded-[3px] [&_img]:object-cover [&_svg]:size-4";

const Icon = ({
  className,
  icon,
}: {
  className?: string;
  icon: IconSvgElement;
}) => (
  <HugeiconsIcon
    aria-hidden="true"
    className={className}
    icon={icon}
    strokeWidth={2}
  />
);

const Mark = ({ item }: { item: PanelDockItem }) => {
  if (item.busy) {
    return (
      <span className={MARK_CLASS}>
        <Icon
          className="size-3.5! animate-spin motion-reduce:animate-none"
          icon={Loading03Icon}
        />
      </span>
    );
  }
  return item.icon ? <span className={MARK_CLASS}>{item.icon}</span> : null;
};

/** Which ends of a scrolling row have more behind them. */
const useEdges = (count: number) => {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ end: false, start: false });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const read = () => {
      const start = node.scrollLeft > 1;
      const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      setEdges((current) =>
        current.start === start && current.end === end
          ? current
          : { end, start }
      );
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    node.addEventListener("scroll", read, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", read);
    };
  }, [count]);

  return { edges, ref };
};

export const PanelDock = <T extends PanelDockItem = PanelDockItem>({
  items = [],
  activeId: activeIdProp,
  defaultActiveId,
  onActiveChange,
  onClose,
  onDismiss,
  children,
  keepMounted = true,
  actions,
  empty,
  label = "Side panel",
  className,
  classNames,
  style,
}: PanelDockProps<T>) => {
  const uid = useId();
  const { edges, ref: strip } = useEdges(items.length);
  const refocus = useRef(false);

  const [inner, setInner] = useState(defaultActiveId);
  // Ids that have been listed, to spot the one that was just opened.
  const [known, setKnown] = useState<ReadonlySet<string>>(
    () => new Set(items.map((item) => item.id))
  );
  // Ids listed on the first render. Those tabs were not opened in view.
  const [baseline] = useState(known);
  const opened = items.filter((item) => !known.has(item.id));
  if (opened.length > 0 || known.size > items.length) {
    setKnown(new Set(items.map((item) => item.id)));
    const newest = opened.at(-1);
    // Opening something brings it forward.
    if (newest && activeIdProp === undefined) {
      setInner(newest.id);
    }
  }

  const wanted = activeIdProp ?? inner;
  const active = items.find((item) => item.id === wanted) ?? items.at(0);
  const activeId = active?.id;

  // An item is mounted the first time it comes forward, then kept.
  const [visited, setVisited] = useState<ReadonlySet<string>>(
    () => new Set(activeId ? [activeId] : [])
  );
  if (activeId && !visited.has(activeId)) {
    setVisited(new Set([...visited, activeId]));
  }

  const select = (id: string) => {
    if (id === activeId) {
      return;
    }
    setInner(id);
    onActiveChange?.(id);
  };

  const close = (id: string) => {
    const next = panelAfterClose(items, id, activeId);
    if (next && next !== activeId) {
      setInner(next);
      onActiveChange?.(next);
    }
    onClose?.(id);
  };

  const tabId = (id: string) => `${uid}-tab-${id}`;
  const panelId = (id: string) => `${uid}-panel-${id}`;

  // The tab in front stays in view, and takes focus back after a close by key.
  useEffect(() => {
    if (!activeId) {
      return;
    }
    const tab = document.querySelector<HTMLElement>(
      `#${CSS.escape(`${uid}-tab-${activeId}`)}`
    );
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (refocus.current) {
      refocus.current = false;
      tab?.focus({ preventScroll: true });
    }
  }, [activeId, items.length, uid]);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, item: T) => {
    const at = items.findIndex((entry) => entry.id === item.id);
    let to: T | undefined;
    if (event.key === "ArrowRight") {
      to = items[(at + 1) % items.length];
    } else if (event.key === "ArrowLeft") {
      to = items[(at - 1 + items.length) % items.length];
    } else if (event.key === "Home") {
      to = items.at(0);
    } else if (event.key === "End") {
      to = items.at(-1);
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      onClose &&
      item.closable !== false
    ) {
      event.preventDefault();
      refocus.current = true;
      close(item.id);
      return;
    }
    if (!to) {
      return;
    }
    event.preventDefault();
    refocus.current = true;
    select(to.id);
  };

  const tabbed = items.length > 1;

  return (
    <section
      aria-label={label}
      className={cn(
        THEME_VARS,
        "flex size-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-(--panel-dock-shadow)",
        className,
        classNames?.root
      )}
      data-slot="panel-dock"
      style={style}
    >
      <div
        className={cn(
          "flex h-11 min-w-0 flex-none items-center gap-1 px-1.5 shadow-[inset_0_-1px_0_var(--panel-dock-line)]",
          classNames?.header
        )}
        data-slot="panel-dock-header"
      >
        {tabbed ? (
          <div
            aria-label="Open items"
            aria-orientation="horizontal"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              "[mask-image:linear-gradient(to_right,transparent,black_var(--panel-dock-fade-start),black_calc(100%-var(--panel-dock-fade-end)),transparent)]",
              classNames?.tabs
            )}
            data-slot="panel-dock-tabs"
            ref={strip}
            role="tablist"
            style={
              {
                "--panel-dock-fade-end": edges.end
                  ? `${EDGE_FADE_PX}px`
                  : "0px",
                "--panel-dock-fade-start": edges.start
                  ? `${EDGE_FADE_PX}px`
                  : "0px",
              } as CSSProperties
            }
          >
            {items.map((item) => {
              const selected = item.id === activeId;
              const closable = Boolean(onClose) && item.closable !== false;
              return (
                <div
                  className={cn(
                    "group/tab relative flex h-7 max-w-52 min-w-0 flex-none items-center rounded-lg transition-colors duration-100 ease-out motion-reduce:transition-none",
                    selected
                      ? "bg-(--panel-dock-active) text-card-foreground"
                      : "text-muted-foreground hover:bg-(--panel-dock-hover) hover:text-card-foreground",
                    !baseline.has(item.id) &&
                      "animate-in duration-200 ease-out fade-in-0 zoom-in-95 motion-reduce:animate-none",
                    classNames?.tab
                  )}
                  data-selected={selected ? "true" : undefined}
                  data-slot="panel-dock-tab"
                  key={item.id}
                  // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a middle click closes, as on any tab
                  onAuxClick={(event) => {
                    if (event.button === 1 && closable) {
                      event.preventDefault();
                      close(item.id);
                    }
                  }}
                >
                  <button
                    aria-controls={panelId(item.id)}
                    aria-selected={selected}
                    className={cn(
                      "flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent py-0 pl-2 text-left text-[13px] leading-4 tracking-[-0.01em] text-inherit",
                      closable ? "pr-7" : "pr-2",
                      selected && "font-medium",
                      FOCUS_CLASS
                    )}
                    id={tabId(item.id)}
                    onClick={() => {
                      select(item.id);
                    }}
                    onKeyDown={(event) => {
                      onTabKey(event, item);
                    }}
                    role="tab"
                    tabIndex={selected ? 0 : -1}
                    title={item.title}
                    type="button"
                  >
                    <Mark item={item} />
                    <span className="truncate">{item.title}</span>
                  </button>
                  {closable ? (
                    <button
                      aria-label={`Close ${item.title}`}
                      className={cn(
                        "absolute top-1/2 right-1 inline-flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-[opacity,background-color,color] duration-100 ease-out after:absolute after:-inset-1 after:content-[''] hover:bg-(--panel-dock-active) hover:text-card-foreground focus-visible:opacity-100 motion-reduce:transition-none",
                        // Without hover, only the tab in front offers to close.
                        selected
                          ? "opacity-100"
                          : "opacity-0 group-hover/tab:opacity-100",
                        FOCUS_CLASS
                      )}
                      data-slot="panel-dock-close"
                      onClick={() => {
                        close(item.id);
                      }}
                      tabIndex={-1}
                      type="button"
                    >
                      <Icon className="size-3" icon={Cancel01Icon} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 pl-2 text-[13px] leading-4 font-medium tracking-[-0.01em]",
              classNames?.title
            )}
            data-slot="panel-dock-title"
          >
            {active ? (
              <>
                <Mark item={active} />
                <span className="truncate" title={active.title}>
                  {active.title}
                </span>
              </>
            ) : (
              <span className="truncate text-muted-foreground">{label}</span>
            )}
          </div>
        )}

        {active && actions ? (
          <div
            className={cn(
              "flex flex-none items-center gap-1",
              classNames?.actions
            )}
            data-slot="panel-dock-actions"
          >
            {actions(active)}
          </div>
        ) : null}
        {onDismiss ? (
          <button
            aria-label={`Close ${label.toLowerCase()}`}
            className={ICON_BUTTON_CLASS}
            data-slot="panel-dock-dismiss"
            onClick={onDismiss}
            title={`Close ${label.toLowerCase()}`}
            type="button"
          >
            <Icon icon={Cancel01Icon} />
          </button>
        ) : null}
      </div>

      <div
        className="relative min-h-0 min-w-0 flex-1"
        data-slot="panel-dock-body"
      >
        {items.length === 0 ? (
          <div className="flex size-full items-center justify-center p-6 text-center text-[13px] leading-5 text-pretty text-muted-foreground">
            {empty ?? "Nothing is open."}
          </div>
        ) : null}
        {items.map((item) => {
          const selected = item.id === activeId;
          if (!selected && !(keepMounted && visited.has(item.id))) {
            return null;
          }
          return (
            <div
              aria-labelledby={tabbed ? tabId(item.id) : undefined}
              className={cn(
                "absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-auto outline-none",
                classNames?.panel
              )}
              data-slot="panel-dock-panel"
              hidden={!selected}
              id={panelId(item.id)}
              key={item.id}
              role={tabbed ? "tabpanel" : undefined}
            >
              {children?.(item, { active: selected })}
            </div>
          );
        })}
      </div>
    </section>
  );
};
