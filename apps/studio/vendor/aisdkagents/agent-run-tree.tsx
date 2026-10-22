"use client";

import {
  AlertCircleIcon,
  ArrowDown01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ChatStatus, UIMessage } from "ai";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

export type AgentRunStatus = "queued" | "running" | "done" | "error";

export interface AgentRunStep {
  id: string;
  label: string;
  /** Defaults to `done`. */
  status?: AgentRunStatus;
}

export interface AgentRunNode {
  id: string;
  name: string;
  /** Defaults to `done`. */
  status?: AgentRunStatus;
  /** What the agent was asked to do. Shown when the row is expanded. */
  task?: string;
  /** Overrides the line beside the name, which otherwise follows `steps`. */
  step?: string;
  steps?: readonly AgentRunStep[];
  /** A short result. Shown beside the name once done, and in full when expanded. */
  output?: string;
  /** This agent's own tokens, not counting the agents under it. */
  tokens?: number;
  /** Epoch milliseconds. Without it the row times itself from when it starts running. */
  startedAt?: number;
  endedAt?: number;
  /** A fixed elapsed time. Wins over `startedAt` and `endedAt`. */
  durationMs?: number;
  /** Agents this agent started. */
  agents?: readonly AgentRunNode[];
}

/** `4s`, `1m 04s`, `1h 02m`. */
export const formatElapsed = (ms: number): string => {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
};

const trimDecimal = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

/** `842`, `4.2K`, `200K`, `1.2M`. */
export const formatTokens = (tokens: number): string => {
  const value = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0;
  if (value < 1000) {
    return String(value);
  }
  if (value < 999_950) {
    return `${trimDecimal(value / 1000)}K`;
  }
  return `${trimDecimal(value / 1_000_000)}M`;
};

/** `search_web`, `searchWeb`, and `search-web` all read as `Search web`. */
export const toolLabel = (name: string): string => {
  const words = name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll(/[_\-.]+/gu, " ")
    .trim()
    .toLowerCase();
  if (!words) {
    return "Tool";
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Every agent in the tree, parents before the agents under them. */
export const flattenAgentRun = (
  nodes: readonly AgentRunNode[]
): AgentRunNode[] =>
  nodes.flatMap((node) => [node, ...flattenAgentRun(node.agents ?? [])]);

const nodeStatus = (node: AgentRunNode): AgentRunStatus =>
  node.status ?? "done";

const stepStatus = (step: AgentRunStep): AgentRunStatus =>
  step.status ?? "done";

const isWorking = (status: AgentRunStatus): boolean =>
  status === "running" || status === "queued";

const OUTPUT_LIMIT = 280;

const clip = (text: string): string | undefined => {
  const clean = text.trim();
  if (!clean) {
    return undefined;
  }
  return clean.length > OUTPUT_LIMIT
    ? `${clean.slice(0, OUTPUT_LIMIT - 1).trimEnd()}…`
    : clean;
};

const firstLine = (text: string | undefined): string | undefined =>
  text
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

type Fields = ReadonlyMap<string, unknown>;

/** Own fields of a value from the stream, or none when it is not an object. */
const fieldsOf = (value: unknown): Fields =>
  new Map(isObject(value) ? Object.entries(value) : []);

const textField = (fields: Fields, key: string): string | undefined => {
  const found = fields.get(key);
  return typeof found === "string" ? found : undefined;
};

const numberField = (fields: Fields, key: string): number | undefined => {
  const found = fields.get(key);
  return typeof found === "number" && Number.isFinite(found)
    ? found
    : undefined;
};

/** What this reader needs from a message part, at any depth of the tree. */
interface StreamPart {
  type: string;
  toolName: string | undefined;
  toolCallId: string | undefined;
  title: string | undefined;
  state: string | undefined;
  preliminary: boolean;
  input: unknown;
  output: unknown;
  errorText: string | undefined;
  text: string | undefined;
}

const parsePart = (value: unknown): StreamPart | null => {
  const fields = fieldsOf(value);
  const type = textField(fields, "type");
  if (!type) {
    return null;
  }
  let toolName: string | undefined;
  if (type === "dynamic-tool") {
    toolName = textField(fields, "toolName");
  } else if (type.startsWith("tool-")) {
    toolName = type.slice(5);
  }
  return {
    errorText: textField(fields, "errorText"),
    input: fields.get("input"),
    output: fields.get("output"),
    preliminary: fields.get("preliminary") === true,
    state: textField(fields, "state"),
    text: textField(fields, "text"),
    title: textField(fields, "title"),
    toolCallId: textField(fields, "toolCallId"),
    toolName,
    type,
  };
};

const parseParts = (value: unknown): StreamPart[] =>
  Array.isArray(value)
    ? value.map(parsePart).filter((part) => part !== null)
    : [];

/** A subagent's own message, when the tool streams one as its output. */
const messagePartsOf = (output: unknown): StreamPart[] | undefined => {
  const parts = fieldsOf(output).get("parts");
  return Array.isArray(parts) ? parseParts(parts) : undefined;
};

const TASK_KEYS = ["task", "prompt", "instructions", "query", "goal"];

const taskOf = (input: unknown): string | undefined => {
  if (typeof input === "string") {
    return clip(input);
  }
  const fields = fieldsOf(input);
  for (const key of TASK_KEYS) {
    const value = textField(fields, key);
    if (value) {
      return clip(value);
    }
  }
  const first = [...fields.values()].find((value) => typeof value === "string");
  return typeof first === "string" ? clip(first) : undefined;
};

/** Reads `metadata.usage.totalTokens`, `metadata.totalUsage.totalTokens`, or `metadata.totalTokens`. */
const tokensOf = (message: unknown): number | undefined => {
  const metadata = fieldsOf(fieldsOf(message).get("metadata"));
  return (
    numberField(fieldsOf(metadata.get("usage")), "totalTokens") ??
    numberField(fieldsOf(metadata.get("totalUsage")), "totalTokens") ??
    numberField(metadata, "totalTokens")
  );
};

const toolStatus = (part: StreamPart): AgentRunStatus => {
  if (part.state === "input-streaming") {
    return "queued";
  }
  if (part.state === "output-error" || part.state === "output-denied") {
    return "error";
  }
  if (part.state === "output-available") {
    return part.preliminary ? "running" : "done";
  }
  return "running";
};

type Settled = "working" | "done" | "error";

const settle = (status: AgentRunStatus, settled: Settled): AgentRunStatus => {
  if (settled === "working" || !isWorking(status)) {
    return status;
  }
  return settled;
};

interface ReadOptions {
  agents: Record<string, string> | undefined;
  depth: number;
  settled: Settled;
}

interface ReadResult {
  agents: AgentRunNode[];
  steps: AgentRunStep[];
  output: string | undefined;
}

const readAgent = (
  part: StreamPart,
  name: string,
  id: string,
  options: ReadOptions
): AgentRunNode => {
  const inner = messagePartsOf(part.output);
  const nested = inner
    ? readAgentParts(inner, { ...options, depth: options.depth + 1 })
    : undefined;
  return {
    agents: nested?.agents,
    id,
    name: options.agents?.[name] ?? part.title ?? toolLabel(name),
    output:
      nested?.output ??
      (typeof part.output === "string" ? clip(part.output) : undefined) ??
      firstLine(part.errorText),
    status: settle(toolStatus(part), options.settled),
    steps: nested?.steps,
    task: taskOf(part.input),
    tokens: tokensOf(part.output),
  };
};

function readAgentParts(
  parts: readonly StreamPart[],
  options: ReadOptions
): ReadResult {
  const result: ReadResult = { agents: [], output: undefined, steps: [] };
  for (const [index, part] of parts.entries()) {
    const name = part.toolName;
    const id = part.toolCallId ?? `${options.depth}-${index}`;
    const isAgent = options.agents
      ? name !== undefined && name in options.agents
      : name !== undefined && options.depth === 0;
    if (name !== undefined && isAgent) {
      result.agents.push(readAgent(part, name, id, options));
    } else if (name !== undefined) {
      result.steps.push({
        id,
        label: part.title ?? toolLabel(name),
        status: settle(toolStatus(part), options.settled),
      });
    } else if (part.type === "text") {
      result.output = clip(part.text ?? "") ?? result.output;
    }
  }
  return result;
}

export interface AgentRunSource {
  /** The orchestrator's assistant message, usually `messages.at(-1)`. */
  message: UIMessage | undefined;
  /** `status` from `useChat`. */
  status: ChatStatus;
  /**
   * Tool name to agent name, for the tools that are subagents. At any depth,
   * a listed tool becomes an agent and every other tool becomes a step.
   * Without it, each top-level tool call is treated as an agent.
   */
  agents?: Record<string, string>;
}

/**
 * Builds the tree from an orchestrator message where each subagent is a tool
 * call. When the tool streams the subagent's own `UIMessage` as its output
 * (an `async function*` execute that yields `readUIMessageStream` chunks), the
 * subagent's tool calls become its steps, its text becomes its output, and
 * its own subagent calls become agents under it.
 *
 * @example
 * const { messages, status } = useChat();
 * <AgentRunTree
 *   agents={agentRunFromMessage({
 *     agents: { research: "Researcher", write: "Writer" },
 *     message: messages.at(-1),
 *     status,
 *   })}
 * />
 */
export const agentRunFromMessage = ({
  message,
  status,
  agents,
}: AgentRunSource): AgentRunNode[] => {
  if (!message || message.role !== "assistant") {
    return [];
  }
  let settled: Settled = "working";
  if (status === "ready") {
    settled = "done";
  } else if (status === "error") {
    settled = "error";
  }
  return readAgentParts(parseParts(message.parts), {
    agents,
    depth: 0,
    settled,
  }).agents;
};

export interface AgentRunTreeClassNames {
  root?: string;
  header?: string;
  label?: string;
  meta?: string;
  tree?: string;
  row?: string;
  name?: string;
  step?: string;
  details?: string;
}

export interface AgentRunTreeProps {
  agents?: readonly AgentRunNode[];
  /** Overrides the header line, which otherwise counts the agents. */
  title?: string;
  /**
   * Whether the orchestrator is still going. Defaults to whether any agent is
   * queued or running, so pass it to keep the header live between agents.
   */
  working?: boolean;
  /** Epoch milliseconds for the whole run. Defaults to when work was first seen. */
  startedAt?: number;
  /** A fixed elapsed time for the whole run. */
  durationMs?: number;
  /** Uncontrolled ids of the rows that start expanded. */
  defaultExpanded?: readonly string[];
  expanded?: readonly string[];
  onExpandedChange?: (ids: string[]) => void;
  showTokens?: boolean;
  showTimers?: boolean;
  className?: string;
  classNames?: AgentRunTreeClassNames;
  /** Handy for overriding the --agent-run-tree-* theme vars inline */
  style?: CSSProperties;
}

const DEFAULT_AGENTS: AgentRunNode[] = [
  {
    durationMs: 12_000,
    id: "research",
    name: "Researcher",
    output: "Six vendor pricing pages read. Pipedrive is cheapest per seat.",
    steps: [
      { id: "search", label: "Search web" },
      { id: "read", label: "Read pricing pages" },
    ],
    task: "Find current per-seat pricing for the five CRMs on the shortlist.",
    tokens: 8200,
  },
  {
    agents: [
      {
        id: "verify",
        name: "Fact checker",
        status: "running",
        steps: [
          { id: "check", label: "Check renewal terms", status: "running" },
        ],
        tokens: 1300,
      },
    ],
    id: "analyst",
    name: "Pricing analyst",
    status: "running",
    steps: [
      { id: "deals", label: "List open deals" },
      { id: "compare", label: "Compare annual cost", status: "running" },
    ],
    task: "Model the yearly cost for a ten-person sales team.",
    tokens: 4100,
  },
  { id: "writer", name: "Writer", status: "queued" },
];

const TICK_MS = 250;
const RUN_ID = "__agent-run-tree__";
const EASE = [0.4, 0, 0.2, 1] as const;
const RAIL = "border-foreground/12";

const THEME_VARS = [
  "[--agent-run-tree-done:#15803d] dark:[--agent-run-tree-done:#4ade80]",
  "[--agent-run-tree-error:var(--destructive)]",
  "[--agent-run-tree-shadow:0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06),0_2px_4px_0px_rgba(0,0,0,0.04)]",
  "[--agent-run-tree-shadow-hover:0_0_0_1px_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.08),0_2px_4px_0px_rgba(0,0,0,0.06)]",
  "dark:[--agent-run-tree-shadow:0_0_0_1px_rgba(255,255,255,0.08)]",
  "dark:[--agent-run-tree-shadow-hover:0_0_0_1px_rgba(255,255,255,0.13)]",
].join(" ");

const ENTER_CLASS =
  "fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both duration-300 ease-out motion-reduce:animate-none";

interface ClockMark {
  start: number;
  end?: number;
}

type ClockMarks = Record<string, ClockMark>;

const stampMarks = (
  current: ClockMarks,
  entries: readonly (readonly [string, boolean])[],
  stamp: number
): ClockMarks => {
  const next: ClockMarks = { ...current };
  let changed = false;
  for (const [id, running] of entries) {
    const mark = current[id];
    if (running && !mark) {
      next[id] = { start: stamp };
      changed = true;
    } else if (running && mark.end !== undefined) {
      // Picking up again continues the same clock.
      next[id] = { start: mark.start };
      changed = true;
    } else if (!running && mark && mark.end === undefined) {
      next[id] = { ...mark, end: stamp };
      changed = true;
    }
  }
  return changed ? next : current;
};

/** Times each id from when it starts running until it stops. */
const useRunClock = (entries: readonly (readonly [string, boolean])[]) => {
  const [marks, setMarks] = useState<ClockMarks>({});
  const [now, setNow] = useState(0);
  const signature = JSON.stringify(entries);
  const anyRunning = entries.some(([, running]) => running);

  useEffect(() => {
    const parsed: [string, boolean][] = JSON.parse(signature);
    const stamp = Date.now();
    setNow(stamp);
    setMarks((current) => stampMarks(current, parsed, stamp));
  }, [signature]);

  useEffect(() => {
    if (!anyRunning) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [anyRunning]);

  return { marks, now };
};

const elapsedBetween = (
  start: number,
  end: number | undefined,
  now: number
): number => Math.max(0, (end ?? now) - start);

const nodeElapsed = (
  node: AgentRunNode,
  marks: ClockMarks,
  now: number
): number | undefined => {
  if (node.durationMs !== undefined) {
    return node.durationMs;
  }
  const running = nodeStatus(node) === "running";
  if (node.startedAt !== undefined) {
    if (node.endedAt === undefined && !running) {
      return undefined;
    }
    return elapsedBetween(node.startedAt, node.endedAt, now);
  }
  const mark = marks[node.id];
  return mark ? elapsedBetween(mark.start, mark.end, now) : undefined;
};

const plural = (count: number): string =>
  `${count} ${count === 1 ? "agent" : "agents"}`;

const runLabel = (all: readonly AgentRunNode[], working: boolean): string => {
  const failed = all.filter((node) => nodeStatus(node) === "error").length;
  if (all.length === 0) {
    return working ? "Starting agents" : "No agents ran";
  }
  if (working) {
    return `Running ${plural(all.length)}`;
  }
  if (failed > 0) {
    return `${failed} of ${plural(all.length)} failed`;
  }
  return `Ran ${plural(all.length)}`;
};

const runGlyph = (
  all: readonly AgentRunNode[],
  working: boolean
): AgentRunStatus => {
  if (working) {
    return "running";
  }
  return all.some((node) => nodeStatus(node) === "error") ? "error" : "done";
};

/** The line beside the name: what the agent is doing, or what came of it. */
const stepLine = (node: AgentRunNode): string => {
  const status = nodeStatus(node);
  if (node.step) {
    return node.step;
  }
  if (status === "queued") {
    return "Queued";
  }
  const steps = node.steps ?? [];
  if (status === "running") {
    const running = steps.findLast((step) => stepStatus(step) === "running");
    return running?.label ?? steps.at(-1)?.label ?? "Starting";
  }
  if (status === "error") {
    return firstLine(node.output) ?? "Failed";
  }
  return firstLine(node.output) ?? "Finished";
};

const DashedRing = ({ spinning }: { spinning: boolean }) => {
  const dots = 12;
  const dash = 0.022;
  const gap = 1 / dots - dash;
  return (
    <svg
      aria-hidden="true"
      className={cn(
        "size-full",
        spinning &&
          "animate-spin [animation-duration:1.8s] motion-reduce:animate-none"
      )}
      viewBox="0 0 24 24"
    >
      <circle
        cx="12"
        cy="12"
        fill="none"
        pathLength={1}
        r="9"
        stroke="currentColor"
        strokeDasharray={`${dash} ${gap}`}
        strokeLinecap="round"
        strokeWidth="2.2"
      />
    </svg>
  );
};

const GLYPH_TONE: Record<AgentRunStatus, string> = {
  done: "text-(--agent-run-tree-done)",
  error: "text-(--agent-run-tree-error)",
  queued: "text-muted-foreground/70",
  running: "text-card-foreground",
};

const STATUS_NAME: Record<AgentRunStatus, string> = {
  done: "Done",
  error: "Failed",
  queued: "Queued",
  running: "Running",
};

const StatusGlyph = ({
  status,
  className,
}: {
  status: AgentRunStatus;
  className?: string;
}) => {
  const reduce = useReducedMotion();
  const settled = status === "done" || status === "error";
  return (
    <span
      className={cn(
        "relative inline-flex size-3.5 flex-none items-center justify-center",
        GLYPH_TONE[status],
        className
      )}
      data-slot="agent-run-tree-glyph"
      data-status={status}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ filter: "blur(0px)", opacity: 1, scale: 1 }}
          className="inline-flex size-full items-center justify-center"
          exit={{ filter: "blur(2px)", opacity: 0, scale: 0.4 }}
          initial={{ filter: "blur(2px)", opacity: 0, scale: 0.4 }}
          key={settled ? status : "ring"}
          transition={{ duration: reduce ? 0 : 0.25, ease: EASE }}
        >
          {settled ? (
            <HugeiconsIcon
              aria-hidden="true"
              className="size-full"
              icon={status === "done" ? Tick02Icon : AlertCircleIcon}
              strokeWidth={2.4}
            />
          ) : (
            <DashedRing spinning={status === "running"} />
          )}
        </motion.span>
      </AnimatePresence>
      <span className="sr-only">{STATUS_NAME[status]}</span>
    </span>
  );
};

/** A band of light that sweeps across the text while work is in progress. */
const Shimmer = ({ children }: { children: string }) => {
  const reduce = useReducedMotion();
  if (reduce) {
    return <span>{children}</span>;
  }
  return (
    <motion.span
      animate={{ backgroundPosition: "-50% center" }}
      className="bg-size-[200%_100%] bg-clip-text text-transparent"
      initial={{ backgroundPosition: "150% center" }}
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--muted-foreground) 35%, var(--card-foreground) 50%, var(--muted-foreground) 65%)",
      }}
      transition={{
        duration: 1.8,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </motion.span>
  );
};

const RollingLabel = ({
  className,
  label,
  shimmer,
}: {
  className?: string;
  label: string;
  shimmer: boolean;
}) => {
  const reduce = useReducedMotion();
  return (
    <span className={cn("relative flex min-w-0", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          className="block min-w-0 truncate"
          exit={{ filter: "blur(3px)", opacity: 0, y: "-0.5em" }}
          initial={{ filter: "blur(3px)", opacity: 0, y: "0.5em" }}
          key={label}
          transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
        >
          {shimmer ? <Shimmer>{label}</Shimmer> : label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

const AgentDetails = ({
  className,
  hasChildren,
  node,
}: {
  className?: string;
  hasChildren: boolean;
  node: AgentRunNode;
}) => {
  const steps = node.steps ?? [];
  const failed = nodeStatus(node) === "error";
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 pt-0.5 pr-1.5 pb-2 pl-7",
        className
      )}
      data-slot="agent-run-tree-details"
    >
      {hasChildren ? (
        <span
          aria-hidden="true"
          className={cn("absolute inset-y-0 left-[12.5px] border-l", RAIL)}
        />
      ) : null}
      {node.task ? (
        <p className="text-xs leading-4 text-pretty text-muted-foreground">
          {node.task}
        </p>
      ) : null}
      {steps.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {steps.map((step) => (
            <li
              className="flex min-w-0 items-center gap-1.5 text-xs leading-4"
              key={step.id}
            >
              <StatusGlyph className="size-3" status={stepStatus(step)} />
              <span
                className={cn(
                  "min-w-0 truncate",
                  stepStatus(step) === "queued"
                    ? "text-muted-foreground"
                    : "text-card-foreground"
                )}
              >
                {step.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {node.output ? (
        <p
          className={cn(
            "rounded-lg bg-muted px-2.5 py-2 text-xs leading-4 text-pretty dark:bg-background",
            failed ? "text-(--agent-run-tree-error)" : "text-card-foreground"
          )}
        >
          {node.output}
        </p>
      ) : null}
    </div>
  );
};

interface BranchContext {
  classNames: AgentRunTreeClassNames | undefined;
  expanded: ReadonlySet<string>;
  marks: ClockMarks;
  now: number;
  onToggle: (id: string) => void;
  showTimers: boolean;
  showTokens: boolean;
}

const ROW_CLASS =
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md border-0 bg-transparent px-1.5 text-left text-[13px] leading-4 text-card-foreground transition-colors duration-150 ease-out motion-reduce:transition-none";

const AgentRow = ({
  context,
  node,
}: {
  context: BranchContext;
  node: AgentRunNode;
}) => {
  const { classNames, expanded, marks, now, onToggle, showTimers, showTokens } =
    context;
  const status = nodeStatus(node);
  const elapsed = nodeElapsed(node, marks, now);
  const expandable = Boolean(
    node.task || node.output || (node.steps?.length ?? 0) > 0
  );
  const isOpen = expandable && expanded.has(node.id);
  const content = (
    <>
      <StatusGlyph status={status} />
      <span
        className={cn(
          "max-w-[60%] flex-none truncate font-medium tracking-[-0.01em]",
          status === "queued" && "text-muted-foreground",
          classNames?.name
        )}
        data-slot="agent-run-tree-name"
      >
        {node.name}
      </span>
      <RollingLabel
        className={cn("flex-1 text-muted-foreground", classNames?.step)}
        label={stepLine(node)}
        shimmer={status === "running"}
      />
      {showTimers && elapsed !== undefined ? (
        <span
          className="flex-none text-xs text-muted-foreground tabular-nums"
          data-slot="agent-run-tree-elapsed"
        >
          {formatElapsed(elapsed)}
        </span>
      ) : null}
      {showTokens && node.tokens !== undefined ? (
        <span
          className="hidden w-9 flex-none text-right text-xs text-muted-foreground tabular-nums @xs/agent-run-tree:block"
          data-slot="agent-run-tree-tokens"
        >
          {formatTokens(node.tokens)}
        </span>
      ) : null}
      {expandable ? (
        <HugeiconsIcon
          aria-hidden="true"
          className={cn(
            "size-3 flex-none text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none",
            isOpen ? "rotate-0" : "-rotate-90"
          )}
          icon={ArrowDown01Icon}
          strokeWidth={2}
        />
      ) : null}
    </>
  );
  if (!expandable) {
    return (
      <div
        className={cn(ROW_CLASS, classNames?.row)}
        data-slot="agent-run-tree-row"
      >
        {content}
      </div>
    );
  }
  return (
    <button
      aria-expanded={isOpen}
      className={cn(
        ROW_CLASS,
        "cursor-pointer hover:bg-foreground/6 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none dark:focus-visible:ring-ring/80",
        classNames?.row
      )}
      data-slot="agent-run-tree-row"
      onClick={() => {
        onToggle(node.id);
      }}
      type="button"
    >
      {content}
    </button>
  );
};

const AgentBranch = ({
  className,
  context,
  nodes,
}: {
  className?: string;
  context: BranchContext;
  nodes: readonly AgentRunNode[];
}) => {
  const reduce = useReducedMotion();
  return (
    <ul className={cn("m-0 flex list-none flex-col p-0", className)}>
      {nodes.map((node, index) => {
        const isLast = index === nodes.length - 1;
        const children = node.agents ?? [];
        const isOpen = context.expanded.has(node.id);
        return (
          <motion.li
            animate={{
              height: "auto",
              opacity: 1,
              // Clip only while growing, so focus rings are not cut off.
              transitionEnd: { overflow: "visible" },
            }}
            className="relative pt-0.5 pl-6"
            data-slot="agent-run-tree-agent"
            data-status={nodeStatus(node)}
            initial={{ height: 0, opacity: 0, overflow: "hidden" }}
            key={node.id}
            transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-0 left-[11.5px] h-4 w-2.5 rounded-bl-md border-b border-l",
                RAIL
              )}
            />
            {isLast ? null : (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-y-0 left-[11.5px] border-l",
                  RAIL
                )}
              />
            )}
            <AgentRow context={context} node={node} />
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  animate={{ height: "auto", opacity: 1 }}
                  className="overflow-hidden"
                  exit={{ height: 0, opacity: 0 }}
                  initial={{ height: 0, opacity: 0 }}
                  key="details"
                  transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
                >
                  <AgentDetails
                    className={context.classNames?.details}
                    hasChildren={children.length > 0}
                    node={node}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
            {children.length > 0 ? (
              <AgentBranch
                className="ml-px"
                context={context}
                nodes={children}
              />
            ) : null}
          </motion.li>
        );
      })}
    </ul>
  );
};

const useExpanded = ({
  defaultExpanded,
  expanded,
  onExpandedChange,
}: {
  defaultExpanded: readonly string[] | undefined;
  expanded: readonly string[] | undefined;
  onExpandedChange: ((ids: string[]) => void) | undefined;
}) => {
  const [uncontrolled, setUncontrolled] = useState<readonly string[]>(
    defaultExpanded ?? []
  );
  const ids = expanded ?? uncontrolled;
  const toggle = (id: string) => {
    const next = ids.includes(id)
      ? ids.filter((current) => current !== id)
      : [...ids, id];
    if (expanded === undefined) {
      setUncontrolled(next);
    }
    onExpandedChange?.(next);
  };
  return { ids: new Set(ids), toggle };
};

export const AgentRunTree = ({
  agents = DEFAULT_AGENTS,
  title,
  working: workingProp,
  startedAt,
  durationMs,
  defaultExpanded,
  expanded,
  onExpandedChange,
  showTokens = true,
  showTimers = true,
  className,
  classNames,
  style,
}: AgentRunTreeProps) => {
  const all = flattenAgentRun(agents);
  const working =
    workingProp ?? all.some((node) => isWorking(nodeStatus(node)));
  const { marks, now } = useRunClock([
    [RUN_ID, working],
    ...all.map((node) => [node.id, nodeStatus(node) === "running"] as const),
  ]);
  const { ids, toggle } = useExpanded({
    defaultExpanded,
    expanded,
    onExpandedChange,
  });
  const runElapsed = nodeElapsed(
    {
      durationMs,
      id: RUN_ID,
      name: RUN_ID,
      startedAt,
      status: working ? "running" : "done",
    },
    marks,
    now
  );
  const tokens = all.reduce((total, node) => total + (node.tokens ?? 0), 0);
  const hasTokens = showTokens && all.some((node) => node.tokens !== undefined);
  const meta = [
    showTimers && runElapsed !== undefined ? formatElapsed(runElapsed) : null,
    hasTokens ? `${formatTokens(tokens)} tokens` : null,
  ].filter((part) => part !== null);

  return (
    <section
      aria-label="Agent run"
      className={cn(
        THEME_VARS,
        ENTER_CLASS,
        "@container/agent-run-tree flex w-full max-w-full min-w-0 flex-col rounded-2xl bg-card p-3 text-card-foreground shadow-(--agent-run-tree-shadow) transition-shadow duration-150 ease-out hover:shadow-(--agent-run-tree-shadow-hover)",
        className,
        classNames?.root
      )}
      data-slot="agent-run-tree"
      data-status={working ? "working" : "settled"}
      style={style}
    >
      <div
        className={cn(
          "flex h-6 min-w-0 items-center gap-2",
          classNames?.header
        )}
        data-slot="agent-run-tree-header"
      >
        <span className="inline-flex size-6 flex-none items-center justify-center rounded-md bg-muted dark:bg-background">
          <StatusGlyph status={runGlyph(all, working)} />
        </span>
        <output
          aria-live="polite"
          className={cn(
            "flex min-w-0 flex-1 text-[13px] leading-5 font-medium tracking-[-0.01em]",
            classNames?.label
          )}
          data-slot="agent-run-tree-label"
        >
          <RollingLabel
            label={title ?? runLabel(all, working)}
            shimmer={working}
          />
        </output>
        {meta.length > 0 ? (
          <span
            className={cn(
              "flex-none text-xs leading-4 text-muted-foreground tabular-nums",
              classNames?.meta
            )}
            data-slot="agent-run-tree-meta"
          >
            {meta.join(" · ")}
          </span>
        ) : null}
      </div>
      {agents.length > 0 ? (
        <AgentBranch
          className={classNames?.tree}
          context={{
            classNames,
            expanded: ids,
            marks,
            now,
            onToggle: toggle,
            showTimers,
            showTokens,
          }}
          nodes={agents}
        />
      ) : null}
    </section>
  );
};
