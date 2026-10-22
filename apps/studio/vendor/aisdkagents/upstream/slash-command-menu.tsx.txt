"use client";

import { ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SlashCommandArgument {
  name: string;
  /** One line shown while this argument is being typed. */
  description?: string;
  /** The command will not run without it. */
  required?: boolean;
  /** Fixed choices, offered as a list while this argument is being typed. */
  options?: readonly string[];
}

/**
 * One command. `name`, `description`, and `arguments` follow the shape of an
 * MCP prompt, so a server's prompt list can be passed as `commands` as is.
 */
export interface SlashCommand {
  /** What is typed after the slash. No spaces. */
  name: string;
  description?: string;
  /** In typing order. The last one takes the rest of the line. */
  arguments?: readonly SlashCommandArgument[];
  /** Heading the command is listed under. */
  group?: string;
  /**
   * The message this command stands for, with `{name}` where an argument
   * goes, or a function of the arguments. Leave it out for a command the app
   * handles itself, such as clearing the chat.
   */
  prompt?: string | ((args: Record<string, string>) => string);
  /** Shown before the name in the list. */
  icon?: ReactNode;
}

export interface SlashCommandRun {
  command: SlashCommand;
  /** Argument values by name. Arguments left out are absent. */
  args: Record<string, string>;
  /** The line as typed, such as "/deploy preview". */
  text: string;
  /** `command.prompt` with the arguments filled in. Ready to send. */
  prompt?: string;
}

const DEFAULT_COMMANDS: SlashCommand[] = [
  {
    arguments: [
      {
        description: "A file, a folder, or a pull request",
        name: "target",
        required: true,
      },
    ],
    description: "Look for bugs and risky changes",
    name: "review",
    prompt: "Review {target} for bugs, risky changes, and missing tests.",
  },
  {
    description: "Sum up the conversation so far",
    name: "summarize",
    prompt: "Summarize this conversation so far in five lines or fewer.",
  },
  { description: "Start a new conversation", name: "clear" },
];

const RECENT_MAX = 3;
const SPACE_CHAR = /\s/u;
const TOKEN = /\S+/gu;
const PLACEHOLDER = /\{(\w+)\}/gu;
const SPACE_RUN = /\s{2,}/gu;

interface ArgToken {
  text: string;
  start: number;
}

/** Where the command's name ends, when the text starts with a slash. */
const readName = (text: string): { name: string; end: number } | null => {
  if (!text.startsWith("/")) {
    return null;
  }
  const space = text.search(SPACE_CHAR);
  const end = space === -1 ? text.length : space;
  return { end, name: text.slice(1, end) };
};

const readTokens = (text: string, from: number, to: number): ArgToken[] =>
  [...text.slice(from, to).matchAll(TOKEN)].map((match) => ({
    start: from + match.index,
    text: match[0],
  }));

const findCommand = (
  commands: readonly SlashCommand[],
  name: string
): SlashCommand | undefined => {
  const wanted = name.toLowerCase();
  return commands.find((command) => command.name.toLowerCase() === wanted);
};

/**
 * `command.prompt` with its arguments filled in. An argument that was left
 * out becomes an empty string.
 *
 * @example
 * fillSlashPrompt("Review {target} for bugs.", { target: "checkout.ts" });
 * // "Review checkout.ts for bugs."
 */
export const fillSlashPrompt = (
  prompt: NonNullable<SlashCommand["prompt"]>,
  args: Record<string, string>
): string =>
  typeof prompt === "function"
    ? prompt(args)
    : prompt
        .replaceAll(PLACEHOLDER, (_, name: string) => args[name] ?? "")
        .replaceAll(SPACE_RUN, " ")
        .trim();

/**
 * Reads a typed line as a command: which one, and the value of each
 * argument. `null` when the line is not one of `commands`. This is what
 * `onRun` reports, for when the text is sent from elsewhere.
 *
 * @example
 * parseSlashCommand("/deploy preview main", commands)?.args;
 * // { environment: "preview", branch: "main" }
 */
export const parseSlashCommand = (
  text: string,
  commands: readonly SlashCommand[]
): SlashCommandRun | null => {
  const line = text.trim();
  const head = readName(line);
  const command = head ? findCommand(commands, head.name) : undefined;
  if (!head || !command) {
    return null;
  }
  const declared = command.arguments ?? [];
  const tokens = readTokens(line, head.end, line.length);
  const args: Record<string, string> = {};
  for (const [index, argument] of declared.entries()) {
    const token = tokens[index];
    if (token) {
      args[argument.name] =
        index === declared.length - 1 ? line.slice(token.start) : token.text;
    }
  }
  return {
    args,
    command,
    prompt:
      command.prompt === undefined
        ? undefined
        : fillSlashPrompt(command.prompt, args),
    text: line,
  };
};

/** `target [branch]`: what is still to type, optional ones in brackets. */
const argumentHint = (declared: readonly SlashCommandArgument[]): string =>
  declared
    .map((argument) =>
      argument.required ? argument.name : `[${argument.name}]`
    )
    .join(" ");

interface CommandSection {
  label: string;
  commands: SlashCommand[];
}

/** Lower is a better match. `null` is no match. */
const matchRank = (command: SlashCommand, query: string): number | null => {
  const name = command.name.toLowerCase();
  if (name.startsWith(query)) {
    return 0;
  }
  if (name.includes(query)) {
    return 1;
  }
  return command.description?.toLowerCase().includes(query) ? 2 : null;
};

/**
 * With nothing typed: recent commands, then the rest under their headings.
 * With a query: one list, best match first.
 */
const pickSections = (
  commands: readonly SlashCommand[],
  recent: readonly string[],
  query: string
): CommandSection[] => {
  const needle = query.toLowerCase();
  if (needle !== "") {
    const ranked = commands
      .map((command, index) => ({
        command,
        index,
        rank: matchRank(command, needle),
      }))
      .filter(
        (entry): entry is typeof entry & { rank: number } => entry.rank !== null
      )
      .toSorted(
        (left, right) => left.rank - right.rank || left.index - right.index
      );
    return ranked.length > 0
      ? [{ commands: ranked.map((entry) => entry.command), label: "Commands" }]
      : [];
  }

  const recents = recent
    .map((name) => findCommand(commands, name))
    .filter((command): command is SlashCommand => command !== undefined)
    .slice(0, RECENT_MAX);
  const sections: CommandSection[] =
    recents.length > 0 ? [{ commands: recents, label: "Recent" }] : [];
  for (const command of commands) {
    if (!recents.includes(command)) {
      const label = command.group ?? "Commands";
      const section = sections.find((entry) => entry.label === label);
      if (section) {
        section.commands.push(command);
      } else {
        sections.push({ commands: [command], label });
      }
    }
  }
  return sections;
};

interface ArgumentAtCaret {
  index: number;
  argument: SlashCommandArgument;
  /** What has been typed of it so far. */
  partial: string;
  start: number;
}

/** The argument the caret is in, once the caret is past the name. */
const readArgument = (
  command: SlashCommand,
  text: string,
  nameEnd: number,
  caret: number
): ArgumentAtCaret | null => {
  const declared = command.arguments ?? [];
  if (declared.length === 0 || caret <= nameEnd) {
    return null;
  }
  const tokens = readTokens(text, nameEnd, caret);
  const fresh = SPACE_CHAR.test(text[caret - 1]);
  const index = fresh ? tokens.length : tokens.length - 1;
  const last = declared.length - 1;
  if (index > last) {
    // The last argument takes the rest of the line, spaces included.
    const { start } = tokens[last];
    return {
      argument: declared[last],
      index: last,
      partial: text.slice(start, caret),
      start,
    };
  }
  return {
    argument: declared[index],
    index,
    partial: fresh ? "" : tokens[index].text,
    start: fresh ? caret : tokens[index].start,
  };
};

const isChoice = (options: readonly string[], value: string): boolean =>
  options.some((option) => option.toLowerCase() === value.toLowerCase());

const matchOptions = (
  options: readonly string[],
  partial: string
): string[] => {
  const typed = partial.toLowerCase();
  // A choice typed out in full needs no list.
  if (options.some((option) => option.toLowerCase() === typed)) {
    return [];
  }
  return options.filter((option) => option.toLowerCase().startsWith(typed));
};

type MenuState =
  | { kind: "commands"; key: string; sections: CommandSection[] }
  | { kind: "options"; key: string; at: ArgumentAtCaret; options: string[] }
  | { kind: "hint"; key: string; argument: SlashCommandArgument }
  | null;

export interface SlashCommandMenuClassNames {
  root?: string;
  frame?: string;
  input?: string;
  command?: string;
  menu?: string;
  group?: string;
  item?: string;
}

export interface SlashCommandMenuProps {
  commands?: readonly SlashCommand[];
  /** Names of recently run commands, newest first. Listed before the rest. */
  recent?: readonly string[];
  defaultRecent?: readonly string[];
  /** Called after a run with the new list, to save it. */
  onRecentChange?: (recent: string[]) => void;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Enter on a command that has what it requires. The field clears. */
  onRun?: (run: SlashCommandRun) => void;
  /** Enter on anything that is not a command. The field clears. */
  onSubmit?: (text: string) => void;
  /** Where the menu opens. A composer at the foot of a chat opens upward. */
  side?: "top" | "bottom";
  placeholder?: string;
  disabled?: boolean;
  /** Focuses the field on mount without scrolling to it. */
  autoFocus?: boolean;
  /** Controls for the bar under the text, between / and send. */
  children?: ReactNode;
  className?: string;
  classNames?: SlashCommandMenuClassNames;
  style?: CSSProperties;
}

const THEME_VARS = [
  "[--slash-menu-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]",
  "[--slash-menu-shadow-focus:0_0_0_1px_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.08),0_2px_4px_0px_rgba(0,0,0,0.06)]",
  "dark:[--slash-menu-shadow:0_0_0_1px_rgba(255,255,255,0.08)]",
  "dark:[--slash-menu-shadow-focus:0_0_0_1px_rgba(255,255,255,0.16)]",
  "[--slash-menu-popup-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_2px_4px_-2px_rgba(0,0,0,0.08),0_8px_20px_-6px_rgba(0,0,0,0.14)]",
  "dark:[--slash-menu-popup-shadow:0_0_0_1px_rgba(255,255,255,0.1),0_8px_24px_-6px_rgba(0,0,0,0.6)]",
  "[--slash-menu-tint:color-mix(in_oklab,var(--primary)_14%,transparent)]",
  "dark:[--slash-menu-tint:color-mix(in_oklab,var(--primary)_28%,transparent)]",
  "[--slash-menu-accent:var(--primary)]",
  "dark:[--slash-menu-accent:color-mix(in_oklab,var(--primary)_45%,white)]",
  "[--slash-menu-soft:color-mix(in_oklab,var(--foreground)_8%,transparent)]",
  "dark:[--slash-menu-soft:color-mix(in_oklab,var(--foreground)_14%,transparent)]",
].join(" ");

const FOCUS_CLASS =
  "focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none";

/** The textarea and the layer that draws its text must wrap at the same places. */
const TEXT_CLASS =
  "col-start-1 row-start-1 m-0 min-h-[44px] w-full min-w-0 border-0 p-0 text-[14px] leading-[22px] tracking-normal break-words whitespace-pre-wrap";

const MENU_CLASS =
  "fade-in-0 zoom-in-[0.98] absolute inset-x-0 z-50 max-h-[420px] animate-in overflow-y-auto overscroll-contain rounded-2xl bg-popover p-1.5 text-popover-foreground shadow-(--slash-menu-popup-shadow) duration-150 ease-out motion-reduce:animate-none";

const ROW_CLASS =
  "flex h-8 w-full min-w-0 items-center gap-2 rounded-[10px] border-0 bg-transparent px-2 text-left text-[13px] leading-5 text-popover-foreground outline-none";

const EnterKey = ({ shown }: { shown: boolean }) => (
  <kbd
    aria-hidden="true"
    className={cn(
      "inline-flex size-4.5 flex-none items-center justify-center rounded-[4px] bg-foreground/6 font-sans text-[10px] leading-none font-medium text-muted-foreground",
      !shown && "invisible"
    )}
  >
    ↵
  </kbd>
);

/**
 * A prompt field with a / menu. A slash at the start lists the commands,
 * recent ones first; arrow keys move, Enter picks, Tab completes, Escape
 * closes. Once a command is named, the field shows which arguments are
 * still to type and lists the choices for an argument that has them.
 *
 * Commands that carry a `prompt` come back as a message ready for
 * `sendMessage`; the rest are yours to handle by name.
 *
 * @example
 * const { sendMessage, setMessages } = useChat();
 * <SlashCommandMenu
 *   commands={commands}
 *   onSubmit={(text) => sendMessage({ text })}
 *   onRun={({ command, prompt }) => {
 *     if (prompt) {
 *       sendMessage({ text: prompt });
 *     } else if (command.name === "clear") {
 *       setMessages([]);
 *     }
 *   }}
 * />
 */
export const SlashCommandMenu = ({
  commands = DEFAULT_COMMANDS,
  recent,
  defaultRecent = [],
  onRecentChange,
  value,
  defaultValue = "",
  onValueChange,
  onRun,
  onSubmit,
  side = "top",
  placeholder = "Message, or type / for commands",
  disabled = false,
  autoFocus = false,
  children,
  className,
  classNames,
  style,
}: SlashCommandMenuProps) => {
  const [inner, setInner] = useState(defaultValue);
  const text = value ?? inner;
  const [innerRecent, setInnerRecent] = useState(defaultRecent);
  const recents = recent ?? innerRecent;
  /** Where the caret is, or `null` without focus or with a selection. */
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  /** Key of the menu Escape closed. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  /** Name of the required argument Enter found missing. */
  const [missing, setMissing] = useState<string | null>(null);

  const field = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();

  const head = readName(text);
  const command = head ? findCommand(commands, head.name) : undefined;
  const declared = command?.arguments ?? [];

  let menu: MenuState = null;
  if (head && caret !== null && !disabled) {
    if (caret <= head.end) {
      const sections = pickSections(commands, recents, head.name);
      menu =
        sections.length > 0
          ? { key: "commands", kind: "commands", sections }
          : null;
    } else if (command) {
      const at = readArgument(command, text, head.end, caret);
      const options = at?.argument.options
        ? matchOptions(at.argument.options, at.partial)
        : [];
      const required = declared.find((argument) => argument.name === missing);
      if (at && options.length > 0) {
        menu = { at, key: `options:${at.index}`, kind: "options", options };
      } else if (required) {
        menu = { argument: required, key: "missing", kind: "hint" };
      } else if (at?.argument.description && !at.argument.options) {
        menu = {
          argument: at.argument,
          key: `hint:${at.index}`,
          kind: "hint",
        };
      }
    }
  }
  const open = menu !== null && menu.key !== dismissed;
  const commandRows =
    menu?.kind === "commands"
      ? menu.sections.flatMap((section) => section.commands)
      : [];
  const rowCount =
    menu?.kind === "options" ? menu.options.length : commandRows.length;
  const activeIndex = Math.min(active, rowCount - 1);

  // What is left to type, shown after the text once the next slot is empty.
  const typed = head ? readTokens(text, head.end, text.length).length : 0;
  const ghost =
    command &&
    head &&
    text.length > head.end &&
    SPACE_CHAR.test(text.at(-1) ?? "")
      ? argumentHint(declared.slice(typed))
      : "";

  // Restores the caret after an edit the browser did not make itself.
  useLayoutEffect(() => {
    if (pendingCaret.current !== null) {
      field.current?.setSelectionRange(
        pendingCaret.current,
        pendingCaret.current
      );
      pendingCaret.current = null;
    }
  }, [text]);

  useLayoutEffect(() => {
    const box = list.current;
    const row = box?.querySelector<HTMLElement>("[aria-selected='true']");
    if (!box || !row) {
      return;
    }
    if (activeIndex === 0) {
      box.scrollTop = 0;
      return;
    }
    const boxRect = box.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < boxRect.top) {
      box.scrollTop -= boxRect.top - rowRect.top + 6;
    } else if (rowRect.bottom > boxRect.bottom) {
      box.scrollTop += rowRect.bottom - boxRect.bottom + 6;
    }
  }, [activeIndex, open]);

  const setText = (next: string) => {
    if (value === undefined) {
      setInner(next);
    }
    onValueChange?.(next);
  };

  const readCaret = (element: HTMLTextAreaElement) => {
    setCaret(
      element.selectionStart === element.selectionEnd
        ? element.selectionStart
        : null
    );
  };

  useEffect(() => {
    const element = field.current;
    if (autoFocus && element) {
      element.focus({ preventScroll: true });
      element.setSelectionRange(element.value.length, element.value.length);
      // A page that is not in front gets no focus event, so read it here too.
      readCaret(element);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  /** Replaces a stretch of the text, keeping the browser's undo history. */
  const replaceRange = (start: number, end: number, insert: string) => {
    const element = field.current;
    if (!element) {
      return;
    }
    element.focus({ preventScroll: true });
    element.setSelectionRange(start, end);
    // execCommand is the only edit a textarea records for undo. Where it is
    // gone, the text is set directly and the caret restored by hand.
    if (!document.execCommand("insertText", false, insert)) {
      pendingCaret.current = start + insert.length;
      setText(text.slice(0, start) + insert + text.slice(end));
      setCaret(start + insert.length);
    }
  };

  const clear = () => {
    setText("");
    setMissing(null);
    setDismissed(null);
    setActive(0);
    setCaret(field.current === document.activeElement ? 0 : null);
  };

  const run = (next: SlashCommandRun) => {
    onRun?.(next);
    const names = [
      next.command.name,
      ...recents.filter((name) => name !== next.command.name),
    ].slice(0, RECENT_MAX);
    if (recent === undefined) {
      setInnerRecent(names);
    }
    onRecentChange?.(names);
    clear();
  };

  /** Writes the command's name and leaves the caret ready for arguments. */
  const complete = (picked: SlashCommand) => {
    if (!head) {
      return;
    }
    const spaced = SPACE_CHAR.test(text[head.end] ?? "");
    setActive(0);
    replaceRange(0, head.end + (spaced ? 1 : 0), `/${picked.name} `);
  };

  const choose = (picked: SlashCommand) => {
    if (picked.arguments?.length) {
      complete(picked);
      return;
    }
    run({
      args: {},
      command: picked,
      prompt:
        picked.prompt === undefined
          ? undefined
          : fillSlashPrompt(picked.prompt, {}),
      text: `/${picked.name}`,
    });
  };

  const chooseOption = (option: string) => {
    if (menu?.kind !== "options" || caret === null) {
      return;
    }
    const rest = text.slice(caret).search(SPACE_CHAR);
    const end = rest === -1 ? text.length : caret + rest;
    const more = menu.at.index < declared.length - 1;
    setActive(0);
    replaceRange(
      menu.at.start,
      end,
      more && !SPACE_CHAR.test(text[end] ?? "") ? `${option} ` : option
    );
  };

  const submit = () => {
    const line = text.trim();
    if (disabled || line === "") {
      return;
    }
    const parsed = parseSlashCommand(line, commands);
    if (!parsed) {
      onSubmit?.(line);
      clear();
      return;
    }
    // Stops on an argument that is required and absent, or not a choice.
    const required = declared.find((argument) => {
      const given = parsed.args[argument.name];
      if (given === undefined) {
        return argument.required === true;
      }
      return argument.options ? !isChoice(argument.options, given) : false;
    });
    if (required) {
      setMissing(required.name);
      setDismissed(null);
      return;
    }
    run(parsed);
  };

  const openCommands = () => {
    const element = field.current;
    if (!element) {
      return;
    }
    setDismissed(null);
    if (head) {
      element.focus({ preventScroll: true });
      element.setSelectionRange(head.end, head.end);
      readCaret(element);
      return;
    }
    replaceRange(0, text.length, "/");
  };

  const onMenuKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || !menu) {
      return false;
    }
    if (event.key === "Escape") {
      setDismissed(menu.key);
      setMissing(null);
      return true;
    }
    if (menu.kind === "hint" || rowCount === 0) {
      return false;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + rowCount) % rowCount);
      return true;
    }
    if (event.key !== "Enter" && event.key !== "Tab") {
      return false;
    }
    if (menu.kind === "options") {
      chooseOption(menu.options[activeIndex]);
    } else if (event.key === "Tab") {
      complete(commandRows[activeIndex]);
    } else {
      choose(commandRows[activeIndex]);
    }
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (onMenuKey(event)) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;
  const hasIcons = commands.some((item) => item.icon !== undefined);
  // Enter found a value where a choice was expected.
  const wrongChoice =
    menu?.kind === "hint" &&
    menu.key === "missing" &&
    parseSlashCommand(text, commands)?.args[menu.argument.name] !== undefined;

  // The field's own text is invisible. This layer draws it, so the command
  // and each recognised choice can read as a chip without moving a character.
  const drawn: ReactNode[] = [];
  if (command && head) {
    drawn.push(
      <mark
        className={cn(
          "rounded-[4px] bg-(--slash-menu-tint) text-(--slash-menu-accent) shadow-[0_0_0_1px_var(--slash-menu-tint)]",
          classNames?.command
        )}
        data-slot="slash-command-menu-command"
        key="command"
      >
        {text.slice(0, head.end)}
      </mark>
    );
    let cursor = head.end;
    const tokens = readTokens(text, head.end, text.length);
    for (const [index, token] of tokens.entries()) {
      const options = declared[index]?.options;
      // The last argument runs to the end of the line, so only a lone word counts.
      const whole = index < declared.length - 1 || index === tokens.length - 1;
      if (options && whole && isChoice(options, token.text)) {
        drawn.push(
          text.slice(cursor, token.start),
          <mark
            className="rounded-[4px] bg-(--slash-menu-soft) text-inherit shadow-[0_0_0_1px_var(--slash-menu-soft)]"
            data-slot="slash-command-menu-choice"
            key={token.start}
          >
            {token.text}
          </mark>
        );
        cursor = token.start + token.text.length;
      }
    }
    drawn.push(text.slice(cursor));
  } else {
    drawn.push(text);
  }
  const hasHeadings = menu?.kind === "commands" && menu.sections.length > 1;
  // One column for every name, so the descriptions line up.
  const nameWidth = `${Math.max(...commands.map((item) => item.name.length), 4) + 1}ch`;

  return (
    <div
      className={cn(
        THEME_VARS,
        "relative w-full max-w-full min-w-0 text-card-foreground",
        className,
        classNames?.root
      )}
      data-slot="slash-command-menu"
      style={style}
    >
      {open && menu?.kind === "hint" ? (
        <div
          className={cn(
            MENU_CLASS,
            side === "top"
              ? "bottom-[calc(100%+8px)] origin-bottom slide-in-from-bottom-1"
              : "top-[calc(100%+8px)] origin-top slide-in-from-top-1",
            classNames?.menu
          )}
          data-slot="slash-command-menu-hint"
          id={listId}
          role="status"
        >
          <div className={ROW_CLASS}>
            <span className="min-w-0 flex-1 truncate">
              {menu.key === "missing" ? (
                <span className="mr-2 font-medium">
                  {menu.argument.name}
                  {wrongChoice ? " must be one of" : " is required"}
                </span>
              ) : null}
              <span className="text-muted-foreground">
                {wrongChoice
                  ? menu.argument.options?.join(", ")
                  : (menu.argument.description ??
                    menu.argument.options?.join(", "))}
              </span>
            </span>
          </div>
        </div>
      ) : null}

      {open && menu && menu.kind !== "hint" ? (
        <div
          aria-label={
            menu.kind === "options" ? menu.at.argument.name : "Commands"
          }
          className={cn(
            MENU_CLASS,
            side === "top"
              ? "bottom-[calc(100%+8px)] origin-bottom slide-in-from-bottom-1"
              : "top-[calc(100%+8px)] origin-top slide-in-from-top-1",
            classNames?.menu
          )}
          data-slot="slash-command-menu-list"
          id={listId}
          style={{ "--slash-menu-name": nameWidth } as CSSProperties}
          // Swapping lists is not a second entrance.
          key="list"
          // Pressing a row must not take focus, and the caret, from the field.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          ref={list}
          role="listbox"
          tabIndex={-1}
        >
          {menu.kind === "commands"
            ? menu.sections.map((section) => (
                <div
                  aria-label={section.label}
                  data-slot="slash-command-menu-group"
                  key={section.label}
                  role="group"
                >
                  {hasHeadings ? (
                    <div
                      aria-hidden="true"
                      className={cn(
                        "px-2 pt-2 pb-1 text-[11px] leading-4 font-medium text-muted-foreground",
                        classNames?.group
                      )}
                    >
                      {section.label}
                    </div>
                  ) : null}
                  {section.commands.map((item) => {
                    const index = commandRows.indexOf(item);
                    const selected = index === activeIndex;
                    return (
                      <button
                        aria-selected={selected}
                        className={cn(
                          ROW_CLASS,
                          "cursor-pointer",
                          selected && "bg-foreground/6",
                          classNames?.item
                        )}
                        data-slot="slash-command-menu-item"
                        id={optionId(index)}
                        key={item.name}
                        onClick={() => {
                          choose(item);
                        }}
                        // Moves with the pointer, not with a list that scrolls under it.
                        onMouseMove={() => {
                          if (!selected) {
                            setActive(index);
                          }
                        }}
                        role="option"
                        tabIndex={-1}
                        type="button"
                      >
                        {hasIcons ? (
                          <span className="flex size-[18px] flex-none items-center justify-center text-muted-foreground [&_svg]:size-4">
                            {item.icon}
                          </span>
                        ) : null}
                        <span className="w-(--slash-menu-name) flex-none truncate font-medium">
                          <span className="text-muted-foreground">/</span>
                          {item.name}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {item.description}
                        </span>
                        <EnterKey shown={selected} />
                      </button>
                    );
                  })}
                </div>
              ))
            : menu.options.map((option, index) => {
                const selected = index === activeIndex;
                return (
                  <button
                    aria-selected={selected}
                    className={cn(
                      ROW_CLASS,
                      "cursor-pointer",
                      selected && "bg-foreground/6",
                      classNames?.item
                    )}
                    data-slot="slash-command-menu-option"
                    id={optionId(index)}
                    key={option}
                    onClick={() => {
                      chooseOption(option);
                    }}
                    onMouseMove={() => {
                      if (!selected) {
                        setActive(index);
                      }
                    }}
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {option}
                    </span>
                    <EnterKey shown={selected} />
                  </button>
                );
              })}
        </div>
      ) : null}

      <div
        className={cn(
          "flex flex-col gap-1.5 rounded-2xl bg-card p-2 shadow-(--slash-menu-shadow) transition-shadow duration-150 ease-out focus-within:shadow-(--slash-menu-shadow-focus) motion-reduce:transition-none",
          disabled && "opacity-60",
          classNames?.frame
        )}
        data-slot="slash-command-menu-frame"
      >
        <div className="grid max-h-[176px] overflow-y-auto px-1.5 pt-1">
          <div
            aria-hidden="true"
            className={cn(
              TEXT_CLASS,
              "pointer-events-none text-card-foreground select-none"
            )}
          >
            {drawn}
            {ghost ? (
              <span
                className="text-muted-foreground"
                data-slot="slash-command-menu-ghost"
              >
                {ghost}
              </span>
            ) : null}
            {/* Keeps a trailing empty line as tall as the textarea's. */}
            <br />
          </div>
          <textarea
            aria-activedescendant={
              open && rowCount > 0 ? optionId(activeIndex) : undefined
            }
            aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            aria-expanded={open && menu?.kind !== "hint"}
            aria-label="Message"
            className={cn(
              TEXT_CLASS,
              "resize-none overflow-hidden bg-transparent text-transparent caret-card-foreground outline-none selection:bg-primary/20 selection:text-transparent placeholder:text-muted-foreground disabled:cursor-not-allowed",
              classNames?.input
            )}
            data-slot="slash-command-menu-input"
            disabled={disabled}
            onBlur={(event) => {
              // Leaving the window is not leaving the field: the menu stays.
              if (document.activeElement !== event.target) {
                setCaret(null);
              }
            }}
            onChange={(event) => {
              setText(event.target.value);
              setActive(0);
              setMissing(null);
              if (!event.target.value.startsWith("/")) {
                setDismissed(null);
              }
              readCaret(event.target);
            }}
            onFocus={(event) => {
              readCaret(event.target);
            }}
            onKeyDown={onKeyDown}
            onSelect={(event) => {
              readCaret(event.currentTarget);
            }}
            placeholder={placeholder}
            ref={field}
            role="combobox"
            rows={1}
            value={text}
          />
        </div>

        <div className="flex h-7 items-center gap-1">
          <button
            aria-label="Commands"
            className={cn(
              "inline-flex size-7 flex-none cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-[15px] leading-none font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:enabled:bg-foreground/6 hover:enabled:text-card-foreground active:enabled:scale-[0.96] disabled:cursor-default disabled:opacity-40 motion-reduce:transition-none",
              FOCUS_CLASS
            )}
            data-slot="slash-command-menu-trigger"
            // A slash only means a command at the start of the message.
            disabled={disabled || (text !== "" && !head)}
            onClick={openCommands}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            type="button"
          >
            /
          </button>
          {children}
          <button
            aria-disabled={disabled || text.trim() === ""}
            aria-label="Send"
            className={cn(
              "ml-auto inline-flex size-7 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-primary p-0 text-primary-foreground transition-[opacity,transform] duration-150 ease-out active:scale-[0.96] aria-disabled:cursor-default aria-disabled:opacity-30 aria-disabled:active:scale-100 motion-reduce:transition-none",
              FOCUS_CLASS
            )}
            data-slot="slash-command-menu-send"
            onClick={submit}
            type="button"
          >
            <HugeiconsIcon
              aria-hidden="true"
              className="size-4"
              icon={ArrowUp02Icon}
              strokeWidth={1.8}
            />
          </button>
        </div>
      </div>
    </div>
  );
};
