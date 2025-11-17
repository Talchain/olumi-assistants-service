'use client';

import { useState } from 'react';
import { startStream } from './actions';

export default function HomePage() {
  const [brief, setBrief] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brief.trim()) return;

    setIsStreaming(true);
    setError(null);
    setEvents([]);

    try {
      const streamUrl = await startStream(brief);

      const response = await fetch(streamUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (part.trim()) {
            const lines = part.split('\n');
            const event: any = {};

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                event.type = line.substring(7);
              } else if (line.startsWith('data: ')) {
                try {
                  event.data = JSON.parse(line.substring(6));
                } catch {}
              }
            }

            if (event.type) {
              setEvents((prev) => [...prev, event]);
            }
          }
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <h1>Next.js SSE Resume Example</h1>

      <form onSubmit={handleSubmit}>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Enter your brief..."
          rows={3}
          style={{ width: '100%', padding: 10, marginBottom: 10 }}
          disabled={isStreaming}
        />
        <button
          type="submit"
          disabled={isStreaming || !brief.trim()}
          style={{ padding: '10px 20px' }}
        >
          {isStreaming ? 'Streaming...' : 'Start Stream'}
        </button>
      </form>

      {error && <div style={{ color: 'red', marginTop: 10 }}>{error}</div>}

      <div style={{ marginTop: 20 }}>
        <h2>Events ({events.length})</h2>
        {events.map((event, i) => (
          <div key={i} style={{ marginBottom: 10, padding: 10, background: '#f5f5f5' }}>
            <strong>{event.type}</strong>
            <pre style={{ fontSize: 12, overflow: 'auto' }}>
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
