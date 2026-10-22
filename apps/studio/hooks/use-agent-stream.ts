'use client';
import { useEffect, useRef, useState } from 'react';
import { useEventCallback } from 'usehooks-ts';
/** The stream is presentation only; server work continues when this view closes. */
export function useAgentStream(workId: string | undefined, state: string | undefined, onSettled: () => void) {
  const [text, setText] = useState('');
  const cursor = useRef('0');
  const settled = useEventCallback(onSettled);
  useEffect(() => {
    cursor.current = '0';
    setText('');
  }, [workId]);
  const active = !!state && ['queued', 'preparing', 'reasoning', 'executing_tool'].includes(state);
  useEffect(() => {
    if (!workId || !active) return;
    const stream = new EventSource(
      `/api/agent/work-items/${encodeURIComponent(workId)}/events?after=${cursor.current}`,
    );
    stream.addEventListener('agent', (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      if (BigInt(data.id) <= BigInt(cursor.current)) return;
      cursor.current = data.id;
      if (data.kind === 'model_start') setText('');
      else if (data.kind === 'text') setText((old) => (old + data.payload.text).slice(-65536));
      else if (data.kind === 'model_end' && data.payload.hasTools) setText('');
    });
    stream.addEventListener('state', () => {
      stream.close();
      settled();
    });
    return () => stream.close();
  }, [workId, active, settled]);
  return active ? text : '';
}
