"use client";

import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import type { ChatStatus } from "ai";
import {
  AnimatePresence,
  Reorder,
  motion,
  useReducedMotion,
} from "framer-motion";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

export interface SessionTab {
  id: string;
  title: string;
  /** `status` from `useChat`. A busy chat shows a running mark. */
  status?: ChatStatus;
  /** Marks a chat that finished while the user was on another tab. */
  unread?: boolean;
}

export interface SessionTabsClassNames {
  root?: string;
  list?: string;
  tab?: string;
  indicator?: string;
  new?: string;
}

export interface SessionTabsProps {
  /** Open chats, in the order they should appear. */
  sessions?: readonly SessionTab[];
  /** Id of the chat on screen. */
  activeId?: string;
  onSelect?: (id: string) => void;
  /** Rendered only when passed. The caller picks which tab opens next. */
  onClose?: (id: string) => void;
  /** Rendered only when passed. Double-clicking the empty strip calls it too. */
  onNew?: () => void;
  /** Enables renaming a tab by double-clicking it. */
  onRename?: (id: string, title: string) => void;
  /**
   * Enables dragging tabs into a new order, and Alt with the arrow keys.
   * Called with every id in the new order; store it and pass it back.
   */
  onReorder?: (ids: string[]) => void;
  className?: string;
  classNames?: SessionTabsClassNames;
  /** Handy for overriding the --session-tabs-* theme vars inline */
  style?: CSSProperties;
}

/**
 * The tab to open after `id` closes: the one to its right, or the one to its
 * left when it was last.
 *
 * @example
 * onClose={(id) => {
 *   if (id === activeId) setActiveId(nextSessionTab(tabs, id));
 *   setTabs(tabs.filter((tab) => tab.id !== id));
 * }}
 */
export const nextSessionTab = (
  sessions: readonly SessionTab[],
  id: string
): string | undefined => {
  const at = sessions.findIndex((session) => session.id === id);
  return (sessions[at + 1] ?? sessions[at - 1])?.id;
};

/**
 * Puts tabs in the order `onReorder` reported.
 *
 * @example
 * onReorder={(ids) => setTabs(orderSessionTabs(tabs, ids))}
 */
export const orderSessionTabs = <T extends SessionTab>(
  sessions: readonly T[],
  ids: readonly string[]
): T[] => {
  const place = new Map(ids.map((id, index) => [id, index]));
  return sessions.toSorted(
    (left, right) =>
      (place.get(left.id) ?? sessions.length) -
      (place.get(right.id) ?? sessions.length)
  );
};

const DEFAULT_SESSIONS: SessionTab[] = [
  { id: "t1", title: "Refund agent approval rules" },
  { id: "t2", status: "streaming", title: "Safari checkout drop" },
  { id: "t3", title: "Chunking the docs index" },
];

const EDGE_PX = 2;
const EASE = [0.4, 0, 0.2, 1] as const;

const ENTER_CLASS =
  "fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-300 ease-out motion-reduce:animate-none";

const THEME_VARS = [
  "[--session-tabs-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]",
  "dark:[--session-tabs-shadow:0_0_0_1px_rgba(255,255,255,0.1)]",
  "[--session-tabs-lift:0_0_0_1px_rgba(0,0,0,0.08),0_3px_8px_-2px_rgba(0,0,0,0.2)]",
  "dark:[--session-tabs-lift:0_0_0_1px_rgba(255,255,255,0.14),0_3px_8px_-2px_rgba(0,0,0,0.6)]",
].join(" ");

const FOCUS_CLASS =
  "focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none";

const FADE_LEFT = "linear-gradient(to right, transparent, black 1.5rem)";
const FADE_RIGHT = "linear-gradient(to left, transparent, black 1.5rem)";

/** A hairline between resting tabs. It steps aside for the open or hovered one. */
const DIVIDER_CLASS =
  "before:pointer-events-none before:absolute before:inset-y-2 before:-left-px before:w-px before:bg-foreground/12 before:transition-opacity before:duration-150 before:content-[''] first:before:hidden hover:before:opacity-0 data-[active]:before:opacity-0 [:hover+&]:before:opacity-0 [[data-active]+&]:before:opacity-0";

const isBusy = (session: SessionTab): boolean =>
  session.status === "submitted" || session.status === "streaming";

const hasMark = (session: SessionTab): boolean =>
  isBusy(session) || session.status === "error" || Boolean(session.unread);

const Icon = ({
  icon,
  className,
}: {
  icon: IconSvgElement;
  className?: string;
}) => (
  <HugeiconsIcon
    aria-hidden="true"
    className={cn("size-3.5 flex-none", className)}
    icon={icon}
    strokeWidth={2}
  />
);

/** One quiet mark: a spinning ring while the agent works, a dot when it has news. */
const StatusMark = ({ session }: { session: SessionTab }) => {
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
  if (session.status === "error") {
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
    const next = field.current?.value.trim() ?? "";
    if (save && next && next !== title) {
      onCommit(next);
    } else {
      onCancel();
    }
  };

  return (
    <input
      aria-label="Chat title"
      className="relative h-full w-full min-w-0 rounded-lg border-0 bg-card px-2.5 text-[13px] leading-4 text-card-foreground shadow-[0_0_0_1px_var(--ring)] outline-none"
      data-slot="session-tabs-rename"
      defaultValue={title}
      onBlur={() => {
        finish(true);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      ref={field}
    />
  );
};

/**
 * Tracks which edges have tabs scrolled out of view, and lets a mouse wheel
 * move the strip sideways.
 */
const useStrip = (count: number) => {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const element = scroller.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const left = element.scrollLeft > EDGE_PX;
      const right =
        element.scrollLeft + element.clientWidth <
        element.scrollWidth - EDGE_PX;
      setEdges((current) =>
        current.left === left && current.right === right
          ? current
          : { left, right }
      );
    };
    const wheel = (event: WheelEvent) => {
      const overflows = element.scrollWidth > element.clientWidth;
      if (overflows && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        element.scrollLeft += event.deltaY;
      }
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    element.addEventListener("wheel", wheel, { passive: false });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      element.removeEventListener("wheel", wheel);
      observer.disconnect();
    };
  }, [count]);

  return { edges, scroller };
};

const maskFor = (edges: { left: boolean; right: boolean }) => {
  const layers = [
    ...(edges.left ? [FADE_LEFT] : []),
    ...(edges.right ? [FADE_RIGHT] : []),
  ];
  return layers.length > 0 ? layers.join(", ") : undefined;
};

const noop = () => {
  // Reorder.Group needs a handler even when reordering is off.
};

export const SessionTabs = ({
  sessions = DEFAULT_SESSIONS,
  activeId,
  onSelect,
  onClose,
  onNew,
  onRename,
  onReorder,
  className,
  classNames,
  style,
}: SessionTabsProps) => {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const { edges, scroller } = useStrip(sessions.length);
  const reduce = useReducedMotion();
  const indicatorId = useId();
  const ids = sessions.map((session) => session.id);
  const current = ids.includes(activeId ?? "") ? activeId : ids.at(0);
  const duration = reduce ? 0 : 0.2;

  // Keep the open tab in view without scrolling anything but the strip.
  useLayoutEffect(() => {
    const element = scroller.current;
    const tab = element?.querySelector<HTMLElement>("[data-active]");
    if (!element || !tab) {
      return;
    }
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    if (start < element.scrollLeft) {
      element.scrollTo({ behavior: "smooth", left: start });
    } else if (end > element.scrollLeft + element.clientWidth) {
      element.scrollTo({ behavior: "smooth", left: end - element.clientWidth });
    }
  }, [current, scroller, sessions.length]);

  const focusTab = (id: string | undefined) => {
    if (!id) {
      return;
    }
    requestAnimationFrame(() => {
      scroller.current
        ?.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(id)}"]`)
        ?.focus();
    });
  };

  const move = (id: string, step: -1 | 1) => {
    const from = ids.indexOf(id);
    const to = from + step;
    if (!onReorder || to < 0 || to >= ids.length) {
      return;
    }
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, id);
    onReorder(next);
    focusTab(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
    const at = ids.indexOf(id);
    if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      move(id, -1);
      return;
    }
    if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      move(id, 1);
      return;
    }
    const targets: Record<string, string | undefined> = {
      ArrowLeft: ids[at - 1],
      ArrowRight: ids[at + 1],
      End: ids.at(-1),
      Home: ids.at(0),
    };
    const target = targets[event.key];
    if (target) {
      event.preventDefault();
      onSelect?.(target);
      focusTab(target);
    } else if (
      onClose &&
      (event.key === "Delete" || event.key === "Backspace")
    ) {
      event.preventDefault();
      focusTab(nextSessionTab(sessions, id));
      onClose(id);
    } else if (onRename && event.key === "F2") {
      event.preventDefault();
      setRenaming(id);
    }
  };

  return (
    <div
      className={cn(
        THEME_VARS,
        ENTER_CLASS,
        "flex w-full max-w-full min-w-0 items-center gap-1 rounded-xl bg-foreground/[0.06] p-1 text-card-foreground",
        className,
        classNames?.root
      )}
      data-slot="session-tabs"
      style={style}
    >
      <Reorder.Group
        aria-label="Open sessions"
        as="div"
        axis="x"
        className={cn(
          // A scroller clips on both axes, so it reaches past the tabs to
          // leave their shadows room.
          "relative -mx-1 -my-2 flex min-w-0 flex-1 gap-0.5 overflow-x-auto px-1 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          classNames?.list
        )}
        data-slot="session-tabs-list"
        layoutScroll
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) {
            onNew?.();
          }
        }}
        onReorder={onReorder ?? noop}
        ref={scroller}
        role="tablist"
        style={{ maskComposite: "intersect", maskImage: maskFor(edges) }}
        values={ids}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {sessions.map((session) => {
            const active = session.id === current;
            const marked = hasMark(session);
            const lifted = dragging === session.id;
            return (
              <Reorder.Item
                animate={{ opacity: 1, scale: 1 }}
                as="div"
                className={cn(
                  "group/tab relative flex h-8 max-w-52 min-w-32 flex-[1_1_0] items-center rounded-lg",
                  !lifted && dragging === null && DIVIDER_CLASS,
                  lifted && "z-10",
                  classNames?.tab
                )}
                data-active={active || undefined}
                dragListener={
                  Boolean(onReorder) &&
                  renaming !== session.id &&
                  sessions.length > 1
                }
                exit={{ opacity: 0, scale: 0.92 }}
                initial={{ opacity: 0, scale: 0.92 }}
                key={session.id}
                onDragEnd={() => {
                  setDragging(null);
                }}
                onDragStart={() => {
                  setDragging(session.id);
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, session.id);
                }}
                transition={{ duration, ease: EASE }}
                value={session.id}
              >
                {active ? (
                  <motion.span
                    className={cn(
                      "absolute inset-0 rounded-lg bg-card transition-shadow duration-150 ease-out dark:bg-foreground/[0.12]",
                      lifted
                        ? "shadow-(--session-tabs-lift)"
                        : "shadow-(--session-tabs-shadow)",
                      classNames?.indicator
                    )}
                    data-slot="session-tabs-indicator"
                    layoutId={indicatorId}
                    transition={{ duration: reduce ? 0 : 0.25, ease: EASE }}
                  />
                ) : null}
                {!active && lifted ? (
                  <span className="absolute inset-0 rounded-lg bg-card/80 shadow-(--session-tabs-lift) dark:bg-foreground/[0.1]" />
                ) : null}
                {renaming === session.id ? (
                  <RenameField
                    onCancel={() => {
                      setRenaming(null);
                      focusTab(session.id);
                    }}
                    onCommit={(title) => {
                      setRenaming(null);
                      onRename?.(session.id, title);
                      focusTab(session.id);
                    }}
                    title={session.title}
                  />
                ) : (
                  <>
                    <button
                      aria-selected={active}
                      className={cn(
                        "relative h-full min-w-0 flex-1 cursor-pointer rounded-lg border-0 bg-transparent pl-2.5 text-left text-[13px] leading-4 transition-colors duration-150 ease-out motion-reduce:transition-none",
                        FOCUS_CLASS,
                        onClose || marked ? "pr-7" : "pr-2.5",
                        active
                          ? "font-medium text-card-foreground"
                          : "text-muted-foreground hover:text-card-foreground",
                        lifted && "cursor-grabbing"
                      )}
                      data-slot="session-tabs-tab"
                      data-tab-id={session.id}
                      onAuxClick={(event) => {
                        if (event.button === 1 && onClose) {
                          event.preventDefault();
                          onClose(session.id);
                        }
                      }}
                      onClick={(event) => {
                        // A press already selected it. This is the keyboard.
                        if (event.detail === 0) {
                          onSelect?.(session.id);
                        }
                      }}
                      onDoubleClick={
                        onRename
                          ? () => {
                              setRenaming(session.id);
                            }
                          : undefined
                      }
                      onPointerDown={(event) => {
                        if (event.button === 0 && !active) {
                          onSelect?.(session.id);
                        }
                      }}
                      role="tab"
                      tabIndex={active ? 0 : -1}
                      title={session.title}
                      type="button"
                    >
                      <span className="block overflow-hidden [mask-image:linear-gradient(to_right,black_calc(100%-1rem),transparent)] whitespace-nowrap">
                        {session.title}
                      </span>
                    </button>
                    <span className="pointer-events-none absolute right-1.5 flex size-5 items-center justify-center">
                      <span
                        className={cn(
                          "flex transition-opacity duration-150 ease-out motion-reduce:transition-none",
                          onClose &&
                            "group-focus-within/tab:opacity-0 group-hover/tab:opacity-0 pointer-coarse:opacity-0"
                        )}
                      >
                        <StatusMark session={session} />
                      </span>
                      {onClose ? (
                        <button
                          aria-label={`Close ${session.title}`}
                          className={cn(
                            "pointer-events-auto absolute inset-0 flex cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-150 ease-out group-focus-within/tab:opacity-100 group-hover/tab:opacity-100 hover:bg-foreground/8 hover:text-card-foreground motion-reduce:transition-none pointer-coarse:opacity-100",
                            active && !marked && "opacity-100"
                          )}
                          data-slot="session-tabs-close"
                          onClick={() => {
                            onClose(session.id);
                          }}
                          onPointerDown={(event) => {
                            // Closing is not the start of a drag.
                            event.stopPropagation();
                          }}
                          tabIndex={-1}
                          type="button"
                        >
                          <Icon className="size-3" icon={Cancel01Icon} />
                        </button>
                      ) : null}
                    </span>
                  </>
                )}
              </Reorder.Item>
            );
          })}
        </AnimatePresence>
      </Reorder.Group>
      {onNew ? (
        <button
          aria-label="New chat"
          className={cn(
            "flex size-8 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/8 hover:text-card-foreground active:scale-[0.96] motion-reduce:transition-none",
            FOCUS_CLASS,
            classNames?.new
          )}
          data-slot="session-tabs-new"
          onClick={onNew}
          title="New chat"
          type="button"
        >
          <Icon icon={Add01Icon} />
        </button>
      ) : null}
    </div>
  );
};
