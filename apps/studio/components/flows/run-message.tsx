'use client';
import { useState } from 'react';
export function RunMessage({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [topic, setTopic] = useState('payment');
  const [value, setValue] = useState('"paid"');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="native-modal-backdrop">
      <section role="dialog" aria-modal="true" aria-label="Send workflow message" className="native-modal">
        <h2>Send workflow message</h2>
        <label>
          Topic
          <input value={topic} onChange={(event) => setTopic(event.target.value)} />
        </label>
        <label>
          Value (JSON)
          <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={4} />
        </label>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button onClick={onClose}>Cancel</button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const response = await fetch(`/api/runs/${runId}/messages`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ topic, value: JSON.parse(value), idempotencyKey: crypto.randomUUID() }),
                });
                if (!response.ok) throw new Error((await response.json()).error);
                onClose();
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Message failed.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Send message
          </button>
        </footer>
      </section>
    </div>
  );
}
