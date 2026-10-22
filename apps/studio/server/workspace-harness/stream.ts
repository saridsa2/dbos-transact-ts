/** Bounded OpenAI-compatible SSE assembly. Reasoning remains private protocol state. */
export async function readChatStream(response: Response, onText?: (text: string) => Promise<void>) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Provider returned an empty stream.');
  const decoder = new TextDecoder();
  let buffer = '',
    bytes = 0,
    content = '',
    reasoning = '',
    reasoningDetails: unknown[] = [],
    id = '',
    model = '',
    finish: string | null = null,
    usage: any,
    done = false,
    emitted = '';
  const calls = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>();
  const publicText = (final = false) => {
    let text = content.replace(/<think>[\s\S]*?<\/think>/g, '');
    const open = text.indexOf('<think>');
    if (open >= 0) text = text.slice(0, open);
    // Hold a possible split opening tag until the next chunk establishes its type.
    if (!text.startsWith(emitted)) throw new Error('Provider changed previously streamed public content.');
    if (!final && open < 0) text = text.slice(0, Math.max(emitted.length, text.length - 8));
    return text;
  };
  async function frame(frame: string) {
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      done = true;
      return;
    }
    if (done) throw new Error('Provider sent data after its completion marker.');
    const chunk = JSON.parse(data);
    if (chunk.error || chunk.base_resp?.status_code) throw new Error('Provider reported a streaming error.');
    id = chunk.id ?? id;
    model = chunk.model ?? model;
    usage = chunk.usage ?? usage;
    // MiniMax ends streams with an explicit successful usage envelope rather
    // than [DONE]. A bare socket close or a finish_reason alone is insufficient.
    if (
      chunk.base_resp?.status_code === 0 &&
      Array.isArray(chunk.choices) &&
      chunk.choices.length === 0 &&
      Number.isInteger(chunk.usage?.prompt_tokens) &&
      Number.isInteger(chunk.usage?.completion_tokens)
    )
      done = true;
    const choice = chunk.choices?.find((c: any) => c.index === 0) ?? chunk.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
    if (Array.isArray(delta.reasoning_details)) reasoningDetails.push(...delta.reasoning_details);
    for (const part of delta.tool_calls ?? []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 8)
        throw new Error('Invalid streamed tool index.');
      const call = calls.get(part.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (part.id) call.id += part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      if (call.function.arguments.length > 65536 || call.function.name.length > 100 || call.id.length > 200)
        throw new Error('Streamed tool call exceeds its limit.');
      calls.set(part.index, call);
    }
    if (choice.finish_reason) finish = choice.finish_reason;
    const visible = publicText();
    const deltaText = visible.slice(emitted.length);
    emitted = visible;
    if (deltaText) await onText?.(deltaText);
  }
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('Provider stream exceeded 2 MiB.');
      buffer += decoder.decode(next.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let at;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        await frame(buffer.slice(0, at));
        buffer = buffer.slice(at + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await frame(buffer);
    if (!done || !finish) throw new Error('Provider stream ended without a complete receipt.');
    const visible = publicText(true);
    if (visible.length > emitted.length) await onText?.(visible.slice(emitted.length));
    return {
      id,
      model,
      usage,
      choices: [
        {
          finish_reason: finish,
          message: {
            role: 'assistant',
            content,
            ...(reasoning ? { reasoning_content: reasoning } : {}),
            ...(reasoningDetails.length ? { reasoning_details: reasoningDetails } : {}),
            ...(calls.size ? { tool_calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c) } : {}),
          },
        },
      ],
    };
  } finally {
    await reader.cancel().catch(() => {});
  }
}
