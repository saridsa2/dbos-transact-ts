import { z } from 'zod';
import type { AgentReply } from '../agent/model';

export class StructuredResultUnavailable extends Error {
  constructor(readonly receiptId: string) {
    super('Structured result failed validation after one repair attempt. Original receipts are retained.');
  }
}
export type StructuredRepair = {
  output: string;
  receiptId: string;
  issues: { code: string; path: string; message?: string }[];
};
export class StructuredResponseError extends Error implements StructuredRepair {
  constructor(
    readonly output: string,
    readonly receiptId: string,
    readonly issues: StructuredRepair['issues'],
  ) {
    super('Structured result did not match its required tool contract.');
  }
}
/** Internal return values only: these tool definitions never enter an execution registry. */
export function structuredResult<T>(name: string, schema: z.ZodType<T>, maxBytes = 12000) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) throw Error('Invalid structured result tool name.');
  const tools = [
    {
      type: 'function',
      function: {
        name,
        description:
          'Return the requested structured result. This only records a return value; it performs no external action.',
        parameters: z.toJSONSchema(schema, { io: 'input' }),
      },
    },
  ];
  const toolChoice = { type: 'function' as const, function: { name } };
  function validate(reply: Pick<AgentReply, 'text' | 'calls'>, receiptId: string): T {
    const output = JSON.stringify({ text: reply.text, calls: reply.calls });
    let code = 'invalid_return_tool';
    try {
      if (Buffer.byteLength(output) > maxBytes) {
        code = 'result_too_large';
        throw Error(code);
      }
      if (reply.calls.length !== 1 || reply.calls[0].name !== name) throw Error(code);
      return schema.parse(reply.calls[0].arguments);
    } catch (error) {
      const issues =
        error instanceof z.ZodError
          ? error.issues
              .slice(0, 8)
              .map((issue) => ({ code: issue.code, path: issue.path.map(String).join('.'), message: issue.message }))
          : [{ code, path: '' }];
      throw new StructuredResponseError(output, receiptId, issues);
    }
  }
  return { name, tools, toolChoice, validate };
}
/** The durable host supplies each attempt, including receipts, metering and uncertain-outcome checks. */
export async function withStructuredRepair<T>(
  attempt: (repair?: StructuredRepair) => Promise<T>,
  maxBytes = 12000,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof StructuredResponseError)) throw error;
    if (Buffer.byteLength(error.output) > maxBytes)
      throw Error('Structured result exceeds the safe repair allowance. Original receipts are retained.');
    try {
      return await attempt(error);
    } catch (repairError) {
      if (!(repairError instanceof StructuredResponseError)) throw repairError;
      throw new StructuredResultUnavailable(repairError.receiptId);
    }
  }
}
