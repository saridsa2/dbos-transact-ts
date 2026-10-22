'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface ChatLayoutState {
  /** True when the frame is too narrow for panes side by side. */
  compact: boolean;
  sidebarOpen: boolean;
  panelOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
}

const ChatLayoutContext = createContext<ChatLayoutState | null>(null);

/**
 * The layout a component sits in, for a button that opens the sidebar or
 * the side panel from inside the thread.
 */
export const useChatLayout = (): ChatLayoutState => {
  const state = useContext(ChatLayoutContext);
  if (!state) {
    throw new Error('useChatLayout must be used inside <ChatLayout>.');
  }
  return state;
};

export interface ChatLayoutClassNames {
  root?: string;
  sidebar?: string;
  main?: string;
  panel?: string;
  handle?: string;
  scrim?: string;
}

export interface ChatLayoutProps {
  /** The left rail. Laid out at `sidebarWidth` and clipped as it closes. */
  sidebar?: ReactNode;
  /** The thread: header, messages, composer. */
  children?: ReactNode;
  /** The side panel. Pass `null` when nothing is open and it slides away. */
  panel?: ReactNode;
  sidebarOpen?: boolean;
  defaultSidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
  /** Hides the panel without unmounting it, so a preview keeps its state. */
  panelOpen?: boolean;
  defaultPanelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  /** Pixels. */
  sidebarWidth?: number;
  /** What a closed sidebar leaves behind. `48` keeps a rail of icons. */
  sidebarClosedWidth?: number;
  panelWidth?: number;
  defaultPanelWidth?: number;
  onPanelWidthChange?: (width: number) => void;
  minPanelWidth?: number;
  /** The thread never gets narrower than this while the panel is dragged. */
  minMainWidth?: number;
  /** Below this frame width the panes become sheets over the thread. */
  compactBelow?: number;
  onCompactChange?: (compact: boolean) => void;
  /** With Cmd or Ctrl, toggles the sidebar. `false` turns it off. */
  shortcut?: string | false;
  sidebarLabel?: string;
  panelLabel?: string;
  className?: string;
  classNames?: ChatLayoutClassNames;
  /** Handy for overriding the --chat-layout-* theme vars inline */
  style?: CSSProperties;
}

const GUTTER_PX = 8;
const KEY_STEP_PX = 16;
const KEY_LEAP_PX = 64;
/** Long enough for one frame to paint with transitions off. */
const SETTLE_MS = 60;
/** Covers the slide, for tabs that never fire `transitionend`. */
const EXIT_MS = 360;

const THEME_VARS = [
  '[--chat-layout-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]',
  'dark:[--chat-layout-shadow:0_0_0_1px_rgba(255,255,255,0.08)]',
  '[--chat-layout-sheet-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_8px_24px_-6px_rgba(0,0,0,0.18),0_24px_48px_-12px_rgba(0,0,0,0.16)]',
  'dark:[--chat-layout-sheet-shadow:0_0_0_1px_rgba(255,255,255,0.1),0_24px_48px_-12px_rgba(0,0,0,0.7)]',
  '[--chat-layout-scrim:rgba(0,0,0,0.28)] dark:[--chat-layout-scrim:rgba(0,0,0,0.55)]',
].join(' ');

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

/** Steep start, long settle: a pane leaves the edge at once and lands softly. */
const PANE_EASE = 'ease-[cubic-bezier(0.32,0.72,0,1)]';

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max));

const useControlled = <T,>(controlled: T | undefined, initial: T, onChange: ((value: T) => void) | undefined) => {
  const [inner, setInner] = useState(initial);
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  });
  const set = useCallback((next: T) => {
    setInner(next);
    report.current?.(next);
  }, []);
  return [controlled === undefined ? inner : controlled, set] as const;
};

/** The last panel that was passed, so a closing panel keeps what it showed. */
const useLastPanel = (panel: ReactNode, keep: boolean): ReactNode => {
  const [last, setLast] = useState(panel);
  const has = panel !== null && panel !== undefined && panel !== false;
  if (has && last !== panel) {
    setLast(panel);
    return panel;
  }
  if (!has && !keep && last !== null) {
    setLast(null);
    return null;
  }
  return has ? panel : last;
};

export const ChatLayout = ({
  sidebar,
  children,
  panel,
  sidebarOpen: sidebarOpenProp,
  defaultSidebarOpen = true,
  onSidebarOpenChange,
  panelOpen: panelOpenProp,
  defaultPanelOpen = true,
  onPanelOpenChange,
  sidebarWidth = 264,
  sidebarClosedWidth = 0,
  panelWidth: panelWidthProp,
  defaultPanelWidth = 440,
  onPanelWidthChange,
  minPanelWidth = 320,
  minMainWidth = 360,
  compactBelow = 768,
  onCompactChange,
  shortcut = 'b',
  sidebarLabel = 'Sidebar',
  panelLabel = 'Side panel',
  className,
  classNames,
  style,
}: ChatLayoutProps) => {
  const root = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelInner = useRef<HTMLDivElement>(null);

  const [frame, setFrame] = useState<number | null>(null);
  const [instant, setInstant] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [sidebarWanted, setSidebarWanted] = useControlled(sidebarOpenProp, defaultSidebarOpen, onSidebarOpenChange);
  const [panelWanted, setPanelWanted] = useControlled(panelOpenProp, defaultPanelOpen, onPanelOpenChange);
  const [wantedWidth, setWantedWidth] = useControlled(panelWidthProp, defaultPanelWidth, onPanelWidthChange);

  const hasSidebar = sidebar !== null && sidebar !== undefined;
  const hasPanel = panel !== null && panel !== undefined && panel !== false;
  const compact = frame !== null && frame < compactBelow;
  const sidebarOpen = hasSidebar && sidebarWanted;
  const panelOpen = hasPanel && panelWanted;

  // A closing panel stays in place until it is off screen.
  const [leaving, setLeaving] = useState(false);
  const shownPanel = useLastPanel(panel, leaving);
  const hasShownPanel = shownPanel !== null && shownPanel !== undefined;
  const [wasOpen, setWasOpen] = useState(panelOpen);
  if (wasOpen !== panelOpen) {
    setWasOpen(panelOpen);
    setLeaving(!panelOpen);
  }
  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = setTimeout(() => {
      setLeaving(false);
    }, EXIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [leaving]);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) {
      return;
    }
    // `offsetWidth` is in the frame's own pixels, whatever zoom it sits under.
    const measure = () => {
      setFrame(node.offsetWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  // One paint with transitions off: for a keyboard toggle and a mode change.
  const jump = useCallback(() => {
    setInstant(true);
  }, []);
  useEffect(() => {
    if (!instant) {
      return;
    }
    const timer = setTimeout(() => {
      setInstant(false);
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [instant]);

  // Sheets start shut. Going wide again puts the panes back as they were.
  const wide = useRef({ panel: panelWanted, sidebar: sidebarWanted });
  const mode = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (frame === null || mode.current === compact) {
      return;
    }
    const first = mode.current === null;
    mode.current = compact;
    onCompactChange?.(compact);
    if (compact) {
      wide.current = { panel: panelWanted, sidebar: sidebarWanted };
      jump();
      if (sidebarWanted) {
        setSidebarWanted(false);
      }
      if (panelWanted) {
        setPanelWanted(false);
      }
    } else if (!first) {
      jump();
      setSidebarWanted(wide.current.sidebar);
      setPanelWanted(wide.current.panel);
    }
    // Runs on a mode change only; the open states are read, not watched.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, frame]);

  const setSidebarOpen = useCallback(
    (open: boolean) => {
      // One sheet at a time.
      if (open && compact && panelOpen) {
        setPanelWanted(false);
      }
      setSidebarWanted(open);
    },
    [compact, panelOpen, setPanelWanted, setSidebarWanted],
  );
  const setPanelOpen = useCallback(
    (open: boolean) => {
      if (open && compact && sidebarOpen) {
        setSidebarWanted(false);
      }
      setPanelWanted(open);
    },
    [compact, setPanelWanted, setSidebarWanted, sidebarOpen],
  );

  const state = useMemo<ChatLayoutState>(
    () => ({
      compact,
      panelOpen,
      setPanelOpen,
      setSidebarOpen,
      sidebarOpen,
      togglePanel: () => {
        setPanelOpen(!panelOpen);
      },
      toggleSidebar: () => {
        setSidebarOpen(!sidebarOpen);
      },
    }),
    [compact, panelOpen, setPanelOpen, setSidebarOpen, sidebarOpen],
  );

  // The sheet on top, if any. The thread under it is inert.
  let sheet: 'panel' | 'sidebar' | null = null;
  if (compact && panelOpen) {
    sheet = 'panel';
  } else if (compact && sidebarOpen) {
    sheet = 'sidebar';
  }

  useEffect(() => {
    if (!sheet) {
      return;
    }
    const before = document.activeElement;
    const node = sheet === 'panel' ? panelRef.current : sidebarRef.current;
    node?.focus({ preventScroll: true });
    // Escape closes the sheet even when focus has wandered off the frame.
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      if (sheet === 'panel') {
        setPanelWanted(false);
      } else {
        setSidebarWanted(false);
      }
    };
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('keydown', onEscape);
      // Hand focus back only if it was left stranded in the closed sheet.
      const now = document.activeElement;
      const stranded = now === document.body || (node?.contains(now) ?? false);
      if (stranded && before instanceof HTMLElement && before.isConnected) {
        before.focus({ preventScroll: true });
      }
    };
  }, [setPanelWanted, setSidebarWanted, sheet]);

  const closedWidth = Math.max(sidebarClosedWidth, GUTTER_PX);
  // Wide enough to hold a mark, a closed sidebar stays on screen as a rail.
  const rail = sidebarClosedWidth >= GUTTER_PX * 4;
  const railWidth = sidebarOpen ? sidebarWidth : closedWidth;
  const maxPanelWidth =
    frame === null ? wantedWidth : frame - (hasSidebar ? railWidth : GUTTER_PX) - minMainWidth - GUTTER_PX * 2;
  const panelWidth = clamp(wantedWidth, minPanelWidth, maxPanelWidth);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) {
      return;
    }
    if (
      shortcut &&
      hasSidebar &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === shortcut.toLowerCase()
    ) {
      event.preventDefault();
      // A key toggles at once. Only a sheet, which crosses the thread, moves.
      if (!compact) {
        jump();
      }
      setSidebarOpen(!sidebarOpen);
    }
  };

  // Dragging writes the width straight to the two boxes and commits on release.
  const drag = useRef<{ scale: number; width: number; x: number } | null>(null);
  const live = useRef(panelWidth);
  const paint = (width: number) => {
    live.current = width;
    if (panelRef.current) {
      panelRef.current.style.width = `${width + GUTTER_PX}px`;
    }
    if (panelInner.current) {
      panelInner.current.style.width = `${width}px`;
    }
  };
  const onHandleDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const node = root.current;
    const box = node?.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      // On-screen pixels per layout pixel, when the frame is zoomed or scaled.
      scale: node && box && node.offsetWidth > 0 ? box.width / node.offsetWidth : 1,
      width: panelWidth,
      x: event.clientX,
    };
    setResizing(true);
  };
  const onHandleMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (!from) {
      return;
    }
    paint(clamp(from.width + (from.x - event.clientX) / from.scale, minPanelWidth, maxPanelWidth));
  };
  const onHandleUp = () => {
    if (!drag.current) {
      return;
    }
    drag.current = null;
    setResizing(false);
    setWantedWidth(Math.round(live.current));
  };
  const onHandleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_LEAP_PX : KEY_STEP_PX;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') {
      next = panelWidth + step;
    } else if (event.key === 'ArrowRight') {
      next = panelWidth - step;
    } else if (event.key === 'Home') {
      next = maxPanelWidth;
    } else if (event.key === 'End') {
      next = minPanelWidth;
    } else if (event.key === 'Enter') {
      next = defaultPanelWidth;
    }
    if (next === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    jump();
    setWantedWidth(Math.round(clamp(next, minPanelWidth, maxPanelWidth)));
  };

  const still = instant || resizing || frame === null;
  const paneMotion = still ? 'transition-none' : cn('duration-300 motion-reduce:transition-none', PANE_EASE);

  return (
    <ChatLayoutContext.Provider value={state}>
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the sidebar shortcut and Escape work from anywhere inside */}
      <div
        className={cn(
          THEME_VARS,
          'relative isolate flex size-full min-h-0 min-w-0 overflow-hidden bg-muted text-foreground dark:bg-background',
          !compact && 'pr-2',
          resizing && 'cursor-col-resize select-none [&_iframe]:pointer-events-none',
          className,
          classNames?.root,
        )}
        data-compact={compact ? 'true' : undefined}
        data-slot="chat-layout"
        onKeyDown={onKeyDown}
        ref={root}
        style={style}
      >
        {hasSidebar ? (
          <aside
            aria-label={sidebarLabel}
            className={cn(
              'flex-none overflow-hidden outline-none',
              compact
                ? cn(
                    'absolute inset-y-0 left-0 z-30 max-w-[calc(100%-3rem)] rounded-r-2xl bg-muted shadow-(--chat-layout-sheet-shadow) dark:bg-background',
                    // Shown at once, so it can take focus. Hidden only once it is off screen.
                    sidebarOpen
                      ? 'visible translate-x-0 transition-[translate]'
                      : 'invisible -translate-x-full transition-[translate,visibility]',
                    // Leaving is quicker than arriving.
                    !still && !sidebarOpen && 'duration-200',
                  )
                : 'relative transition-[width]',
              paneMotion,
              compact && !still && !sidebarOpen && 'duration-200',
              classNames?.sidebar,
            )}
            data-slot="chat-layout-sidebar"
            data-state={sidebarOpen ? 'open' : 'closed'}
            inert={compact ? !sidebarOpen : sheet !== null}
            ref={sidebarRef}
            style={{ width: compact ? sidebarWidth : railWidth }}
            tabIndex={-1}
          >
            <div
              className={cn(
                'h-full transition-opacity duration-200 ease-out motion-reduce:transition-none',
                // Nothing of a fully closed sidebar should show in the gutter.
                !compact && !sidebarOpen && !rail ? 'opacity-0' : 'opacity-100',
                still && 'transition-none',
              )}
              inert={!compact && !sidebarOpen && !rail}
              // A rail squeezes with the pane. A sidebar that hides is clipped.
              style={{ width: compact || rail ? '100%' : sidebarWidth }}
            >
              {sidebar}
            </div>
          </aside>
        ) : (
          <div aria-hidden="true" className={cn('flex-none', compact && 'hidden')} style={{ width: GUTTER_PX }} />
        )}

        <main
          className={cn(
            'relative flex min-w-0 flex-1 flex-col overflow-hidden bg-card text-card-foreground',
            compact ? '' : 'my-2 rounded-2xl shadow-(--chat-layout-shadow)',
            classNames?.main,
          )}
          data-slot="chat-layout-main"
          inert={sheet !== null}
        >
          {children}
        </main>

        {compact ? (
          <div
            aria-hidden="true"
            className={cn(
              'absolute inset-0 z-20 bg-(--chat-layout-scrim) transition-opacity ease-out',
              sheet === 'sidebar' ? 'opacity-100 duration-300' : 'pointer-events-none opacity-0 duration-200',
              still && 'transition-none',
              classNames?.scrim,
            )}
            data-slot="chat-layout-scrim"
            onClick={() => {
              setSidebarOpen(false);
            }}
          />
        ) : null}

        {hasShownPanel ? (
          <aside
            aria-label={panelLabel}
            className={cn(
              'flex flex-none overflow-hidden outline-none',
              compact
                ? cn(
                    'absolute inset-0 z-30 bg-muted p-2 dark:bg-background',
                    // Shown at once, so it can take focus. Hidden only once it is off screen.
                    panelOpen
                      ? 'visible translate-x-0 transition-[translate]'
                      : 'invisible translate-x-full transition-[translate,visibility]',
                  )
                : 'relative py-2 transition-[width]',
              paneMotion,
              compact && !still && !panelOpen && 'duration-200',
              classNames?.panel,
            )}
            data-slot="chat-layout-panel"
            data-state={panelOpen ? 'open' : 'closed'}
            inert={!panelOpen}
            onTransitionEnd={(event) => {
              if (event.target === event.currentTarget && !panelOpen) {
                setLeaving(false);
              }
            }}
            ref={panelRef}
            style={compact ? undefined : { width: panelOpen ? panelWidth + GUTTER_PX : 0 }}
            tabIndex={-1}
          >
            {compact ? null : (
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a separator that can be focused is a control
              <div
                aria-label="Resize side panel"
                aria-orientation="vertical"
                aria-valuemax={Math.round(Math.max(minPanelWidth, maxPanelWidth))}
                aria-valuemin={minPanelWidth}
                aria-valuenow={Math.round(panelWidth)}
                className={cn(
                  "group/handle relative z-10 flex flex-none cursor-col-resize touch-none items-center justify-center rounded-full outline-none after:absolute after:-inset-x-1 after:inset-y-0 after:content-['']",
                  FOCUS_CLASS,
                  classNames?.handle,
                )}
                data-slot="chat-layout-handle"
                onDoubleClick={() => {
                  jump();
                  setWantedWidth(Math.round(clamp(defaultPanelWidth, minPanelWidth, maxPanelWidth)));
                }}
                onKeyDown={onHandleKey}
                onLostPointerCapture={onHandleUp}
                onPointerCancel={onHandleUp}
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                role="separator"
                style={{ width: GUTTER_PX }}
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- arrow keys resize the panel
                tabIndex={0}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-8 w-[3px] rounded-full bg-foreground/25 opacity-0 transition-[opacity,height,background-color] delay-0 duration-150 ease-out group-hover/handle:opacity-100 group-hover/handle:delay-100 group-focus-visible/handle:opacity-100 motion-reduce:transition-none',
                    resizing && 'h-12 bg-foreground/45 opacity-100',
                  )}
                />
              </div>
            )}
            <div className="h-full min-w-0 flex-none" ref={panelInner} style={{ width: compact ? '100%' : panelWidth }}>
              {shownPanel}
            </div>
          </aside>
        ) : null}
      </div>
    </ChatLayoutContext.Provider>
  );
};
