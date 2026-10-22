'use client';
/** Licensed AI SDK Agents source; original retained in upstream/. Host control adaptations only. */

import { Loading03Icon, SparklesIcon, Wrench01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import { Button } from './host-controls';
import { Textarea } from './host-controls';
import { cn } from '@/lib/utils';

/**
 * `idle` is the empty form. `drafting` is the model writing the agent.
 * `ready` is a finished draft. `error` is a draft that could not be written.
 */
export type AgentCreateStatus = 'idle' | 'drafting' | 'ready' | 'error';

/**
 * The agent the model writes. Every field is optional because a streamed
 * object arrives a piece at a time.
 */
export interface AgentCreateDraft {
  name?: string;
  /** One line on what the agent does. */
  description?: string;
  /** The system prompt. */
  instructions?: string;
  /** Names of the tools the agent should start with. */
  tools?: readonly (string | undefined)[];
  /** The tools among those that should wait for a person before they run. */
  approvalTools?: readonly (string | undefined)[];
  /** The id of the model to run on, from the ones on offer. */
  model?: string;
  /** The most steps one run may take. */
  maxSteps?: number;
}

/** A description someone can start from instead of an empty field. */
export interface AgentCreateTemplate {
  id: string;
  label: string;
  /** What goes into the field when the template is picked. */
  description: string;
  /** A brand mark. Without one the chip is text only. */
  icon?: ReactNode;
}

/** How to show a tool the draft names. */
export interface AgentCreateTool {
  /** The key the tool has in the AI SDK tool set. */
  name: string;
  label?: string;
  icon?: ReactNode;
}

/** How to show a model the draft names. */
export interface AgentCreateModel {
  /** The id the AI SDK takes, such as `anthropic/claude-sonnet-5.5` for the gateway. */
  id: string;
  name: string;
  icon?: ReactNode;
}

/** The parts of `useObject` the form reads. */
export interface AgentCreateObjectState {
  isLoading: boolean;
  object?: AgentCreateDraft;
  error?: unknown;
}

/**
 * The form's status, from `useObject`.
 *
 * @example
 * const draft = useObject({ api: "/api/agents/draft", schema });
 * <AgentCreate draft={draft.object} status={agentCreateStatus(draft)} />
 */
export const agentCreateStatus = ({ isLoading, object, error }: AgentCreateObjectState): AgentCreateStatus => {
  if (error) {
    return 'error';
  }
  if (isLoading) {
    return 'drafting';
  }
  return object?.instructions ? 'ready' : 'idle';
};

/** `Billing triage` becomes `billing-triage`. */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '');

/** A `ToolLoopAgent` stops after 20 steps unless it is told otherwise. */
const DEFAULT_MAX_STEPS = 20;

/** What a draft becomes: fields a `ToolLoopAgent` takes, and the step limit beside them. */
export interface AgentCreateSettings {
  id: string;
  instructions: string;
  /** Left out when the draft names no model, so the caller's default applies. */
  model?: string;
  activeTools: string[];
  /** Each tool that asks first, in the shape `toolApproval` takes. */
  toolApproval: Record<string, 'user-approval'>;
  /** Pass to `isStepCount` as the agent's `stopWhen`. */
  maxSteps: number;
}

/**
 * A draft as AI SDK agent settings. The step limit is a stop condition, so it
 * comes back on its own.
 *
 * @example
 * import { ToolLoopAgent, isStepCount } from "ai";
 *
 * const { maxSteps, model, ...settings } = agentCreateSettings(draft);
 * const agent = new ToolLoopAgent({
 *   ...settings,
 *   model: model ?? "anthropic/claude-sonnet-5.5",
 *   stopWhen: isStepCount(maxSteps),
 *   tools,
 * });
 */
export const agentCreateSettings = (draft: AgentCreateDraft): AgentCreateSettings => {
  const activeTools = (draft.tools ?? []).filter((name) => name !== undefined);
  const steps = Math.round(draft.maxSteps ?? DEFAULT_MAX_STEPS);
  return {
    activeTools,
    id: slug(draft.name ?? '') || 'agent',
    instructions: draft.instructions ?? '',
    maxSteps: Number.isFinite(steps) && steps > 0 ? steps : DEFAULT_MAX_STEPS,
    model: draft.model || undefined,
    // A tool the agent does not have cannot ask for anything.
    toolApproval: Object.fromEntries(
      (draft.approvalTools ?? [])
        .filter((name) => name !== undefined && activeTools.includes(name))
        .map((name) => [name, 'user-approval'] as const),
    ),
  };
};

export interface AgentCreateClassNames {
  root?: string;
  header?: string;
  title?: string;
  field?: string;
  templates?: string;
  template?: string;
  quote?: string;
  instructions?: string;
  details?: string;
  tools?: string;
  tool?: string;
  footer?: string;
  action?: string;
}

/**
 * Creates an agent from one sentence. UI only: `onSubmit` hands over the
 * description, the caller streams a draft back, and the form shows it being
 * written.
 *
 * @example
 * // Shared: the draft, in the order it should be written.
 * const schema = z.object({
 *   name: z.string(),
 *   description: z.string(),
 *   instructions: z.string(),
 *   tools: z.array(z.enum(toolNames)),
 *   approvalTools: z.array(z.enum(toolNames)),
 *   model: z.enum(modelIds),
 *   maxSteps: z.number().int().min(1).max(50),
 * });
 *
 * // Server
 * const result = streamText({
 *   model,
 *   output: Output.object({ schema }),
 *   prompt: `Draft a tool loop agent for: ${description}`,
 * });
 * return createTextStreamResponse({
 *   stream: toTextStream({ stream: result.stream }),
 * });
 *
 * // Client
 * const draft = useObject({ api: "/api/agents/draft", schema });
 *
 * <AgentCreate
 *   draft={draft.object}
 *   models={models}
 *   onOpen={(agent) => saveAgent(agentCreateSettings(agent))}
 *   onStop={draft.stop}
 *   onSubmit={(description) => draft.submit({ description })}
 *   status={agentCreateStatus(draft)}
 *   tools={tools}
 * />
 */
export interface AgentCreateProps {
  status?: AgentCreateStatus;
  draft?: AgentCreateDraft;
  /** One sentence on what went wrong, shown beside the button. */
  error?: string;
  /** The description. Leave out to let the form hold it. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Called with the description when the person asks for a draft. */
  onSubmit?: (description: string) => void;
  /** Shown as the button while a draft is being written. */
  onStop?: () => void;
  /** Called with the finished draft. */
  onOpen?: (draft: AgentCreateDraft) => void;
  /**
   * Makes the description a way back to the form. Set `status` to `idle` in
   * here.
   */
  onEdit?: () => void;
  templates?: readonly AgentCreateTemplate[];
  /** Names and marks for the tools a draft can pick. */
  tools?: readonly AgentCreateTool[];
  /** Names and marks for the models a draft can pick. */
  models?: readonly AgentCreateModel[];
  title?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  classNames?: AgentCreateClassNames;
  /** Handy for overriding the --agent-create-* theme vars inline */
  style?: CSSProperties;
}

const NO_TEMPLATES: readonly AgentCreateTemplate[] = [];
const NO_TOOLS: readonly AgentCreateTool[] = [];
const NO_MODELS: readonly AgentCreateModel[] = [];
const EMPTY_DRAFT: AgentCreateDraft = {};
const INSTRUCTIONS_MAX_PX = 132;
/** The height of the three placeholder lines a draft starts as. */
const WAITING_PX = 78;
/** How close to the end still counts as reading along. */
const PINNED_SLACK_PX = 24;

const THEME_VARS = [
  '[--agent-create-accent:#7e4eb2] dark:[--agent-create-accent:#bf9deb]',
  '[--agent-create-error:var(--destructive)]',
  '[--agent-create-icon-bg:color-mix(in_oklab,var(--agent-create-accent)_14%,var(--card))] dark:[--agent-create-icon-bg:color-mix(in_oklab,var(--agent-create-accent)_22%,var(--card))]',
  '[--agent-create-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]',
  '[--agent-create-shadow-hover:0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.08),0_2px_4px_0px_rgba(0,0,0,0.06)]',
  'dark:[--agent-create-shadow:0_0_0_1px_rgba(255,255,255,0.08)]',
  'dark:[--agent-create-shadow-hover:0_0_0_1px_rgba(255,255,255,0.13)]',
].join(' ');

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

const ENTER_CLASS =
  'fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-300 ease-out motion-reduce:animate-none';

/** Text that replaces other text in place: a short fade through a soft blur. */
const SWAP_CLASS = 'fade-in-0 blur-in-[2px] animate-in duration-200 ease-out motion-reduce:animate-none';

const CHIP_CLASS =
  'inline-flex h-6 max-w-full flex-none items-center gap-1.5 rounded-full bg-foreground/6 pr-2.5 pl-2 text-xs leading-none font-medium text-card-foreground [&_img]:size-3.5 [&_img]:rounded-[3px] [&_svg]:size-3.5 [&_svg]:flex-none';

/** One line of the draft under its instructions: a short label, then what it holds. */
const DETAIL_CLASS = 'flex min-w-0 items-start gap-3 pb-1.5';

const DETAIL_LABEL_CLASS = 'flex h-6 w-11 flex-none items-center text-xs leading-none text-muted-foreground';

/** `search_orders` becomes `Search orders`. */
const toolLabel = (name: string): string => {
  const words = name.replaceAll(/[_-]+/gu, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Whatever it was last given that was not `null`, so a closing panel keeps its words. */
const useLast = <T,>(value: T | null): T | null => {
  const [last, setLast] = useState(value);
  if (value !== null && value !== last) {
    setLast(value);
    return value;
  }
  return value ?? last;
};

/**
 * Opens and closes to the height of what it holds, so the card grows instead
 * of jumping between the form and the draft.
 */
const Collapse = ({ children, open }: { children: ReactNode; open: boolean }) => (
  <div
    className={cn(
      'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none',
      open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
    )}
    inert={!open}
  >
    {/* The clip sits 4px out, so a field's line and halo are not cut off. */}
    <div className="-m-1 min-h-0 overflow-hidden p-1">{children}</div>
  </div>
);

/**
 * Eases to the height of what it holds. A list that wraps onto a new line
 * grows into it instead of pushing everything below down in one frame.
 */
const AutoHeight = ({ children, className }: { children: ReactNode; className?: string }) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) {
      return;
    }
    const measure = () => {
      setHeight(inner.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={cn(
        'overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none',
        className,
      )}
      style={{ height: height ?? undefined }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
};

/**
 * The instructions as they are written. The well grows with the text up to a
 * limit, then scrolls, and it follows the last line for as long as the reader
 * has not scrolled away from it.
 */
const Instructions = ({ className, streaming, text }: { className?: string; streaming: boolean; text: string }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [height, setHeight] = useState<number | null>(null);

  // The paragraph is measured, and the well is given that height to ease to.
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) {
      return;
    }
    const measure = () => {
      // While it is being written the well never drops below its waiting size.
      setHeight(Math.min(INSTRUCTIONS_MAX_PX, Math.max(inner.offsetHeight, streaming ? WAITING_PX : 0)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => {
      observer.disconnect();
    };
  }, [streaming]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && streaming && pinned.current) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [streaming, text, height]);

  // A finished draft is read from its first line.
  useEffect(() => {
    if (streaming) {
      pinned.current = true;
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollRef.current?.scrollTo({
      behavior: reduce ? 'auto' : 'smooth',
      top: 0,
    });
  }, [streaming]);

  return (
    <div
      className={cn('relative rounded-xl bg-muted dark:bg-background', className)}
      data-slot="agent-create-instructions"
    >
      <div
        className="overflow-y-auto overscroll-contain px-3 transition-[height] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] [scrollbar-width:thin] motion-reduce:transition-none"
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < PINNED_SLACK_PX;
        }}
        ref={scrollRef}
        style={{ height: height ?? undefined }}
        // Long instructions scroll, so the keyboard has to reach them.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        <div ref={innerRef}>
          {text ? (
            <p className="m-0 py-2.5 text-[13px] leading-5 text-pretty wrap-break-word whitespace-pre-wrap text-card-foreground">
              {text}
              {streaming ? (
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 animate-caret-blink rounded-full bg-(--agent-create-accent) motion-reduce:animate-none"
                />
              ) : null}
            </p>
          ) : (
            // Nothing written yet: the well holds its place at about three lines.
            <div aria-hidden="true" className="flex flex-col gap-2.5 py-3.5">
              <span className="h-2.5 w-11/12 animate-pulse rounded-full bg-foreground/8 motion-reduce:animate-none" />
              <span className="h-2.5 w-4/5 animate-pulse rounded-full bg-foreground/8 delay-150 motion-reduce:animate-none" />
              <span className="h-2.5 w-2/5 animate-pulse rounded-full bg-foreground/8 delay-300 motion-reduce:animate-none" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const AgentCreate = ({
  status = 'idle',
  draft,
  error,
  value,
  defaultValue = '',
  onValueChange,
  onSubmit,
  onStop,
  onOpen,
  onEdit,
  templates = NO_TEMPLATES,
  tools = NO_TOOLS,
  models = NO_MODELS,
  title = 'New agent',
  placeholder = 'What should this agent do?',
  disabled = false,
  className,
  classNames,
  style,
}: AgentCreateProps) => {
  const fieldId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [held, setHeld] = useState(defaultValue);
  const text = value ?? held;
  const setText = (next: string) => {
    setHeld(next);
    onValueChange?.(next);
  };

  const composing = status === 'idle' || status === 'error';
  const drafting = status === 'drafting';
  const description = text.trim();
  const canSubmit = description.length > 0 && !disabled;
  // A closing panel keeps showing the draft it held.
  const shown = useLast(composing ? null : (draft ?? EMPTY_DRAFT));
  const quote = useLast(composing ? null : description);
  const instructions = shown?.instructions ?? '';
  const named = shown?.name?.trim() ?? '';
  const picked = (shown?.tools ?? []).filter((name) => name !== undefined);
  const asking = new Set(shown?.approvalTools ?? []);
  const modelId = shown?.model ?? '';
  const model = models.find((item) => item.id === modelId);
  const steps = shown?.maxSteps;
  // Templates give way once the person has written something of their own.
  const offered = description.length === 0 || templates.some((template) => template.description.trim() === description);

  // Coming back to the form puts the caret where the writing left off.
  const wasComposing = useRef(composing);
  useEffect(() => {
    if (composing && !wasComposing.current) {
      const field = fieldRef.current;
      field?.focus({ preventScroll: true });
      field?.setSelectionRange(field.value.length, field.value.length);
    }
    wasComposing.current = composing;
  }, [composing]);

  const submit = () => {
    if (canSubmit && composing) {
      onSubmit?.(description);
    }
  };

  const onFieldKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const heading = composing ? title : named || title;

  const actions: Record<AgentCreateStatus, { label: string; run: (() => void) | undefined; off: boolean }> = {
    drafting: { label: 'Stop', off: !onStop, run: onStop },
    error: { label: 'Try again', off: !canSubmit, run: submit },
    idle: { label: 'Create draft', off: !canSubmit, run: submit },
    ready: {
      label: 'Open draft',
      off: !onOpen,
      run: () => {
        onOpen?.(draft ?? {});
      },
    },
  };
  const action = actions[status];

  // While it is written, the line under the draft names the part being written.
  let writing = 'Reading your description';
  if (instructions) {
    writing = 'Writing instructions';
  }
  if (picked.length > 0) {
    writing = 'Choosing tools';
  }
  if (modelId) {
    writing = 'Setting limits';
  }
  const offer =
    tools.length > 0
      ? `Drafts instructions and picks from ${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}.`
      : 'Drafts a name, instructions, and tools.';
  const footnote: Record<AgentCreateStatus, string> = {
    drafting: writing,
    error: error ?? 'The draft could not be written.',
    idle: offer,
    ready: 'Saved as a draft. Nothing runs until you publish it.',
  };

  return (
    <section
      aria-busy={drafting ? true : undefined}
      aria-label={title}
      className={cn(
        THEME_VARS,
        '@container flex w-full max-w-full min-w-0 flex-col rounded-2xl bg-card p-3 text-card-foreground shadow-(--agent-create-shadow) transition-shadow duration-150 ease-out hover:shadow-(--agent-create-shadow-hover)',
        className,
        classNames?.root,
      )}
      data-slot="agent-create"
      data-status={status}
      style={style}
    >
      <div
        className={cn(ENTER_CLASS, 'flex h-6 min-w-0 items-center gap-2', classNames?.header)}
        data-slot="agent-create-header"
      >
        <span className="inline-flex size-6 flex-none items-center justify-center rounded-md bg-(--agent-create-icon-bg)">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-3.5 text-(--agent-create-accent)"
            icon={SparklesIcon}
            strokeWidth={2}
          />
        </span>
        <div
          className={cn(
            SWAP_CLASS,
            'min-w-0 flex-1 truncate text-[13px] leading-tight font-medium tracking-[-0.01em]',
            classNames?.title,
          )}
          data-slot="agent-create-title"
          // A new heading is a new element, so it fades in on its own.
          key={heading}
          title={heading}
        >
          {heading}
        </div>
      </div>

      <Collapse open={composing}>
        <div className={cn(ENTER_CLASS, 'flex flex-col pt-3 delay-75')}>
          <label className="sr-only" htmlFor={fieldId}>
            Describe the agent
          </label>
          <Textarea
            aria-invalid={status === 'error' ? true : undefined}
            className={cn(
              'max-h-52 min-h-[5.25rem] resize-none rounded-xl border-0 bg-card px-3 py-2.5 text-[13px] leading-5 shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_11%,transparent)] transition-[background-color,box-shadow] duration-150 ease-out placeholder:text-muted-foreground focus-visible:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_34%,transparent),0_0_0_3px_color-mix(in_oklab,var(--foreground)_8%,transparent)] focus-visible:ring-0 aria-invalid:ring-1 aria-invalid:ring-(--agent-create-error)/40 motion-reduce:transition-none md:text-[13px] dark:bg-card dark:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_16%,transparent)] dark:focus-visible:shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_42%,transparent),0_0_0_3px_color-mix(in_oklab,var(--foreground)_12%,transparent)] dark:focus-visible:ring-foreground/25 dark:aria-invalid:ring-(--agent-create-error)/50',
              classNames?.field,
            )}
            data-slot="agent-create-field"
            disabled={disabled}
            id={fieldId}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={onFieldKeyDown}
            placeholder={placeholder}
            ref={fieldRef}
            value={text}
          />
          {templates.length > 0 ? (
            <Collapse open={offered}>
              <div
                aria-label="Start from a template"
                className={cn('flex min-w-0 flex-wrap gap-1.5 pt-2', classNames?.templates)}
                data-slot="agent-create-templates"
                role="group"
              >
                {templates.map((template) => {
                  const on = template.description.trim() === description;
                  return (
                    <button
                      aria-pressed={on}
                      className={cn(
                        CHIP_CLASS,
                        'cursor-pointer border-0 transition-[background-color,color,scale] duration-150 ease-out hover:bg-foreground/10 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
                        on &&
                          'bg-(--agent-create-icon-bg) text-(--agent-create-accent) hover:bg-(--agent-create-icon-bg)',
                        FOCUS_CLASS,
                        classNames?.template,
                      )}
                      data-slot="agent-create-template"
                      disabled={disabled}
                      key={template.id}
                      onClick={() => {
                        setText(on ? '' : template.description);
                        fieldRef.current?.focus({ preventScroll: true });
                      }}
                      type="button"
                    >
                      {template.icon}
                      <span className="truncate">{template.label}</span>
                    </button>
                  );
                })}
              </div>
            </Collapse>
          ) : null}
        </div>
      </Collapse>

      <Collapse open={!composing}>
        <div className="flex flex-col gap-2.5 pt-3" data-slot="agent-create-draft">
          {onEdit ? (
            <button
              className={cn(
                '-mx-1 line-clamp-2 cursor-pointer rounded-md border-0 bg-transparent px-1 text-left text-[13px] leading-5 text-pretty text-muted-foreground transition-colors duration-150 ease-out hover:text-card-foreground motion-reduce:transition-none',
                FOCUS_CLASS,
                classNames?.quote,
              )}
              data-slot="agent-create-quote"
              onClick={() => {
                if (drafting) {
                  onStop?.();
                }
                onEdit();
              }}
              title="Edit the description"
              type="button"
            >
              “{quote}”
            </button>
          ) : (
            <p
              className={cn(
                'm-0 line-clamp-2 text-[13px] leading-5 text-pretty text-muted-foreground',
                classNames?.quote,
              )}
              data-slot="agent-create-quote"
            >
              “{quote}”
            </p>
          )}

          <Instructions className={classNames?.instructions} streaming={drafting} text={instructions} />

          <div className={cn('flex flex-col', classNames?.details)} data-slot="agent-create-details">
            <Collapse open={picked.length > 0}>
              <div className={DETAIL_CLASS}>
                <span className={DETAIL_LABEL_CLASS}>Tools</span>
                <AutoHeight className="min-w-0 flex-1">
                  <ul
                    aria-label="Tools"
                    className={cn('m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0', classNames?.tools)}
                    data-slot="agent-create-tools"
                  >
                    {picked.map((name) => {
                      const known = tools.find((tool) => tool.name === name);
                      return (
                        <li
                          className={cn(
                            CHIP_CLASS,
                            'animate-in duration-200 ease-out fade-in-0 zoom-in-95 motion-reduce:animate-none',
                            classNames?.tool,
                          )}
                          data-asks={asking.has(name) ? 'true' : undefined}
                          data-slot="agent-create-tool"
                          key={name}
                        >
                          {known?.icon ?? (
                            <HugeiconsIcon
                              aria-hidden="true"
                              className="text-muted-foreground"
                              icon={Wrench01Icon}
                              strokeWidth={2}
                            />
                          )}
                          <span className="truncate">{known?.label ?? toolLabel(name)}</span>
                          {asking.has(name) ? (
                            <span className="flex-none animate-in font-normal text-muted-foreground duration-200 fade-in-0 motion-reduce:animate-none">
                              asks first
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </AutoHeight>
              </div>
            </Collapse>
            <Collapse open={modelId.length > 0}>
              <div className={DETAIL_CLASS}>
                <span className={DETAIL_LABEL_CLASS}>Model</span>
                <span
                  className="flex h-6 min-w-0 flex-1 items-center gap-1.5 text-xs leading-none font-medium text-card-foreground [&_img]:size-3.5 [&_svg]:size-3.5 [&_svg]:flex-none"
                  data-slot="agent-create-model"
                >
                  {model?.icon}
                  <span className="truncate">{model?.name ?? modelId}</span>
                </span>
              </div>
            </Collapse>
            <Collapse open={steps !== undefined}>
              <div className={DETAIL_CLASS}>
                <span className={DETAIL_LABEL_CLASS}>Limit</span>
                <span
                  className="flex h-6 min-w-0 flex-1 items-center text-xs leading-none text-card-foreground tabular-nums"
                  data-slot="agent-create-limit"
                >
                  <span className="truncate">
                    <span className="font-medium">
                      {steps} {steps === 1 ? 'step' : 'steps'}
                    </span>
                    <span className="text-muted-foreground"> a run</span>
                  </span>
                </span>
              </div>
            </Collapse>
          </div>
        </div>
      </Collapse>

      <div
        className={cn(ENTER_CLASS, 'flex min-h-7 min-w-0 items-center gap-3 pt-3 delay-100', classNames?.footer)}
        data-slot="agent-create-footer"
      >
        <output
          aria-live="polite"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 text-xs leading-4 text-pretty text-muted-foreground',
            status === 'error' && 'font-medium text-(--agent-create-error)',
          )}
        >
          {drafting ? (
            <HugeiconsIcon
              aria-hidden="true"
              className="size-3 flex-none animate-spin text-(--agent-create-accent) motion-reduce:animate-none"
              icon={Loading03Icon}
              strokeWidth={2.5}
            />
          ) : null}
          <span className={cn(SWAP_CLASS, 'min-w-0')} key={footnote[status]}>
            {footnote[status]}
          </span>
        </output>
        <Button
          className={cn(
            'flex-none rounded-full px-3 transition-[background-color,color,opacity,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none',
            classNames?.action,
          )}
          data-slot="agent-create-action"
          disabled={action.off}
          onClick={action.run}
          size="xs"
          type="button"
          variant={drafting ? 'secondary' : 'default'}
        >
          <span className={SWAP_CLASS} key={action.label}>
            {action.label}
          </span>
          {composing ? (
            <kbd className="pointer-events-none hidden font-sans text-[10px] leading-none font-medium opacity-60 select-none @xs:inline">
              ⌘↵
            </kbd>
          ) : null}
        </Button>
      </div>
    </section>
  );
};
