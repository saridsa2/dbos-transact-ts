import { readChatStream } from '../workspace-harness/stream';
import { z } from 'zod';
import { ControlError } from '../control/service';
export type AgentReply = {
  message: Record<string, unknown>;
  text: string;
  calls: { id: string; name: string; arguments: unknown }[];
  usage: { input: number; output: number };
  model: string;
  responseId: string;
};
/** A fully received provider response that cannot be executed; no tool has run. */
export class AgentResponseError extends Error {
  constructor(
    readonly finishReason: string,
    readonly usage: { input: number; output: number },
    readonly responseId: string,
    readonly outputLimit: number,
  ) {
    super(
      finishReason === 'invalid_tool_arguments'
        ? 'MiniMax returned invalid tool arguments. No tools from this response were run. Send a smaller instruction to continue; the request was not automatically repeated.'
        : finishReason === 'length'
          ? `MiniMax reached the ${outputLimit.toLocaleString('en-US')}-token response limit before completing its response. No tools from this response were run. Increase Response token limit in Agent settings → Runtime, then start a new request.`
          : `MiniMax did not complete the response (finish reason: ${finishReason}). No tools from this response were run.`,
    );
  }
}
export interface AgentModel {
  complete(
    input: {
      model: string;
      messages: Record<string, unknown>[];
      tools: unknown[];
      toolChoice?: 'auto' | { type: 'function'; function: { name: string } };
      outputTokens: number;
      signal: AbortSignal;
      onText?: (text: string) => Promise<void>;
    },
    secret: string,
  ): Promise<AgentReply>;
}
const responseSchema = z.object({
  id: z.string().max(200),
  model: z.string().max(200),
  base_resp: z.object({ status_code: z.number() }).optional(),
  usage: z
    .object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() })
    .optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z
          .object({
            role: z.literal('assistant').optional(),
            content: z.string().nullable().optional(),
            tool_calls: z
              .array(
                z.object({
                  id: z.string().min(1).max(200),
                  type: z.literal('function'),
                  function: z.object({ name: z.string().max(100), arguments: z.string().max(65536) }),
                }),
              )
              .max(8)
              .optional(),
          })
          .passthrough(),
      }),
    )
    .min(1),
});
export function minimaxAgentModel(transport: typeof fetch = fetch): AgentModel {
  return {
    async complete(input, secret) {
      if (!secret) throw new ControlError(422, 'MiniMax credential is unavailable.');
      const body = JSON.stringify({
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        ...(input.toolChoice ? { tool_choice: input.toolChoice } : {}),
        stream: !!input.onText,
        ...(input.onText ? { stream_options: { include_usage: true } } : {}),
        reasoning_split: true,
        max_completion_tokens: input.outputTokens,
      });
      if (Buffer.byteLength(body) > 256 * 1024)
        throw new ControlError(422, 'Agent context exceeds the request limit. Start a narrower work item.');
      let attempts = 0;
      const request = async (): Promise<Response> => {
        attempts++;
        const response = await transport('https://api.minimax.io/v1/chat/completions', {
          method: 'POST',
          redirect: 'error',
          signal: input.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
          body,
        });
        if (response.status === 429 && attempts < 3) {
          await response.body?.cancel();
          const retry = Number(response.headers.get('retry-after') ?? 'NaN');
          const wait = Number.isFinite(retry) && retry >= 0 ? Math.min(2000, retry * 1000) : 250 * attempts;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              input.signal.removeEventListener('abort', abort);
              resolve();
            }, wait);
            const abort = () => {
              clearTimeout(timer);
              reject(new Error('Provider retry was cancelled.'));
            };
            if (input.signal.aborted) abort();
            else input.signal.addEventListener('abort', abort, { once: true });
          });
          return request();
        }
        return response;
      };
      const response = await request();
      if (!response.ok) {
        await response.body?.cancel();
        throw new ControlError(
          response.status === 401 || response.status === 403 ? 422 : 502,
          `MiniMax rejected the agent request (HTTP ${response.status}).`,
        );
      }
      let raw: unknown;
      if (response.headers.get('content-type')?.includes('text/event-stream'))
        raw = await readChatStream(response, input.onText);
      else {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('MiniMax returned an empty response.');
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('MiniMax agent response exceeded 2 MiB.');
          }
          chunks.push(value);
        }
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      const data = responseSchema.parse(raw);
      if (data.base_resp?.status_code) throw new ControlError(422, 'MiniMax reported a provider error.');
      const choice = data.choices[0];
      if (!['stop', 'tool_calls'].includes(choice.finish_reason))
        throw new AgentResponseError(
          choice.finish_reason,
          { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
          data.id,
          input.outputTokens,
        );
      // Validate the entire response before returning any executable calls. A single
      // complete JSON code fence is transport formatting, never executable text.
      const calls = (choice.message.tool_calls ?? []).map((call) => {
        const raw = call.function.arguments.trim();
        const fenced = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
        let args: unknown;
        try {
          args = JSON.parse(fenced ? fenced[1] : raw);
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Expected object');
        } catch {
          throw new AgentResponseError(
            'invalid_tool_arguments',
            { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
            data.id,
            input.outputTokens,
          );
        }
        return { id: call.id, name: call.function.name, arguments: args };
      });
      const message = {
        ...choice.message,
        role: 'assistant',
        ...(choice.message.tool_calls
          ? {
              tool_calls: choice.message.tool_calls.map((call, i) => ({
                ...call,
                function: { ...call.function, arguments: JSON.stringify(calls[i].arguments) },
              })),
            }
          : {}),
      };
      if (new Set(calls.map((c) => c.id)).size !== calls.length)
        throw new ControlError(422, 'MiniMax returned duplicate tool call identifiers.');
      const text = (choice.message.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return {
        message,
        text,
        calls,
        model: data.model,
        responseId: data.id,
        usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
