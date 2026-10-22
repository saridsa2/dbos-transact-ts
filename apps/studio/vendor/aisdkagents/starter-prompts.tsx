'use client';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface StarterPrompt {
  icon?: ReactNode;
  id: string;
  /** What gets sent when the prompt is picked. */
  text: string;
  /** What the row says. Defaults to `text`. */
  label?: string;
  /** Tool names this prompt needs. It is hidden until all are available. */
  requires?: string | readonly string[];
  /** Marks a prompt that continues earlier work. These are listed first. */
  recent?: boolean;
  /** A word or two on the right, such as "Yesterday" or "Linear". */
  hint?: string;
}

/** Tool names, or an AI SDK tool set whose keys are the names. */
export type StarterPromptTools = readonly string[] | Record<string, unknown>;

const isNameList = (tools: StarterPromptTools): tools is readonly string[] => Array.isArray(tools);

const toolNames = (tools: StarterPromptTools | undefined): Set<string> =>
  new Set(tools && !isNameList(tools) ? Object.keys(tools) : (tools ?? []));

const requiredTools = (prompt: StarterPrompt): readonly string[] => {
  if (prompt.requires === undefined) {
    return [];
  }
  return typeof prompt.requires === 'string' ? [prompt.requires] : prompt.requires;
};

const rank = (prompt: StarterPrompt): number => {
  if (prompt.recent) {
    return 0;
  }
  return requiredTools(prompt).length > 0 ? 1 : 2;
};

/**
 * The prompts worth offering right now: those whose tools are available,
 * with recent work first, then prompts that use a connected tool, then the
 * rest. Order within each group is kept.
 *
 * @example
 * const { sendMessage } = useChat();
 * <StarterPromptsVertical
 *   onSelect={(prompt) => sendMessage({ text: prompt.text })}
 *   prompts={PROMPTS}
 *   tools={tools}
 * />
 */
export const pickStarterPrompts = (prompts: readonly StarterPrompt[], tools?: StarterPromptTools): StarterPrompt[] => {
  const available = toolNames(tools);
  return prompts
    .filter((prompt) => requiredTools(prompt).every((name) => available.has(name)))
    .map((prompt, index) => ({ index, prompt }))
    .toSorted((left, right) => rank(left.prompt) - rank(right.prompt) || left.index - right.index)
    .map((item) => item.prompt);
};

/** A row reads as a title, so a sentence loses its full stop. */
const rowLabel = (prompt: StarterPrompt): string => prompt.label ?? prompt.text.replace(/\.$/u, '');

export interface StarterPromptsVerticalClassNames {
  root?: string;
  title?: string;
  description?: string;
  list?: string;
  prompt?: string;
  hint?: string;
  more?: string;
}

export interface StarterPromptsVerticalProps {
  prompts?: readonly StarterPrompt[];
  /** Tools the agent can use now. Prompts that need others stay hidden. */
  tools?: StarterPromptTools;
  title?: string;
  /** One quiet line under the title. */
  description?: string;
  /** How many prompts show at once. */
  max?: number;
  /** Shows placeholder rows while prompts are being worked out. */
  loading?: boolean;
  /** Stops prompts from being picked, while a reply is on its way. */
  disabled?: boolean;
  onSelect?: (prompt: StarterPrompt) => void;
  className?: string;
  classNames?: StarterPromptsVerticalClassNames;
  style?: CSSProperties;
}

const DEFAULT_PROMPTS: StarterPrompt[] = [
  { id: 'loop', text: 'Explain why my agent stops after one tool call.' },
  { id: 'prompt', text: 'Write a system prompt for a refund agent.' },
  { id: 'eval', text: 'Plan an eval for the support agent.' },
];

const DEFAULT_MAX = 4;
const STAGGER_MS = 50;
const SKELETON_WIDTHS = ['62%', '78%', '54%', '70%'] as const;

const ENTER_CLASS =
  'fade-in-0 slide-in-from-bottom-1 animate-in fill-mode-both duration-300 ease-out motion-reduce:animate-none';

const FOCUS_CLASS =
  'focus-visible:ring-2 focus-visible:ring-ring/50 dark:focus-visible:ring-ring/80 focus-visible:outline-none';

export const StarterPromptsVertical = ({
  prompts = DEFAULT_PROMPTS,
  tools,
  title = 'What should we work on?',
  description,
  max = DEFAULT_MAX,
  loading = false,
  disabled = false,
  onSelect,
  className,
  classNames,
  style,
}: StarterPromptsVerticalProps) => {
  const [turn, setTurn] = useState(0);
  const size = Math.max(1, Math.floor(max));
  const eligible = pickStarterPrompts(prompts, tools);
  const pages = Math.max(1, Math.ceil(eligible.length / size));
  const page = turn % pages;
  const shown = eligible.slice(page * size, page * size + size);

  return (
    <section
      aria-busy={loading}
      aria-label={title}
      className={cn('flex w-full max-w-full min-w-0 flex-col gap-5 text-foreground', className, classNames?.root)}
      data-slot="starter-prompts"
      style={style}
    >
      <div className={cn(ENTER_CLASS, 'flex flex-col gap-1.5')}>
        <h2
          className={cn('m-0 text-2xl leading-tight font-semibold tracking-tight text-balance', classNames?.title)}
          data-slot="starter-prompts-title"
        >
          {title}
        </h2>
        {description ? (
          <p
            className={cn('m-0 text-sm leading-[1.5] text-pretty text-muted-foreground', classNames?.description)}
            data-slot="starter-prompts-description"
          >
            {description}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div aria-hidden="true" className="flex flex-col">
          {SKELETON_WIDTHS.slice(0, size).map((width) => (
            <span className="flex h-9 items-center" key={width}>
              <span
                className="h-2.5 animate-pulse rounded-full bg-foreground/8 motion-reduce:animate-none"
                style={{ width }}
              />
            </span>
          ))}
        </div>
      ) : (
        <ul
          className={cn('m-0 -mx-2.5 flex list-none flex-col p-0', classNames?.list)}
          data-slot="starter-prompts-list"
          // A new page is a new list, so its rows arrive together.
          key={page}
        >
          {shown.map((prompt, index) => (
            <li className={ENTER_CLASS} key={prompt.id} style={{ animationDelay: `${(index + 1) * STAGGER_MS}ms` }}>
              <button
                className={cn(
                  'flex min-h-9 w-full min-w-0 cursor-pointer items-baseline gap-3 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-sm leading-5 text-foreground transition-[background-color,transform] duration-150 ease-out hover:enabled:bg-foreground/5 active:enabled:scale-[0.995] disabled:cursor-default disabled:opacity-50 motion-reduce:transition-none',
                  FOCUS_CLASS,
                  classNames?.prompt,
                )}
                data-slot="starter-prompts-prompt"
                disabled={disabled}
                onClick={() => {
                  onSelect?.(prompt);
                }}
                type="button"
              >
                {prompt.icon && (
                  <span data-slot="starter-prompts-icon" aria-hidden="true">
                    {prompt.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1 text-pretty">{rowLabel(prompt)}</span>
                {prompt.hint ? (
                  <span
                    className={cn('flex-none text-xs leading-5 text-muted-foreground', classNames?.hint)}
                    data-slot="starter-prompts-hint"
                  >
                    {prompt.hint}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && pages > 1 ? (
        <button
          className={cn(
            '-mt-2 cursor-pointer self-start rounded-[4px] border-0 bg-transparent p-0 text-xs leading-4 font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground motion-reduce:transition-none',
            FOCUS_CLASS,
            classNames?.more,
          )}
          data-slot="starter-prompts-more"
          onClick={() => {
            setTurn(page + 1);
          }}
          type="button"
        >
          More ideas
        </button>
      ) : null}
    </section>
  );
};
