/**
 * Test fakes of the OpenAI Responses API answer in JSON. Every core model call now streams (#3594: a Conversation call never
 * sits idle on a buffered transport), so a fake's 200 Responses body is re-sent as the Responses SSE stream when, and only
 * when, the request asked to stream. Conversations, errors and unstreamed calls (the critic) pass through unchanged.
 */
type Json = Record<string, any>;
type Fetch = (url: unknown, init?: { body?: unknown; signal?: AbortSignal | null }) => Promise<Response>;

/** The Responses SSE stream for one body: created → each item (text as a delta) → completed (the STREAM row's shape). */
export const responsesSse = (resp: Json): string => {
  const ev = (o: Json) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  let out = ev({ type: 'response.created', sequence_number: 0, response: { ...resp, status: 'in_progress', output: [] } });
  ((resp.output ?? []) as Json[]).forEach((item, i) => {
    out += ev({ type: 'response.output_item.added', output_index: i, item: item.type === 'message' ? { ...item, status: 'in_progress', content: [] } : item });
    if (item.type === 'message') out += ev({ type: 'response.output_text.delta', item_id: item.id, output_index: i, content_index: 0, delta: item.content?.[0]?.text ?? '' });
    out += ev({ type: 'response.output_item.done', output_index: i, item });
  });
  return out + ev({ type: 'response.completed', response: resp });
};

/**
 * An SSE answer that behaves like a real connection (fresh Claude BLOCK D on #3594): a completed stream closes; any other
 * (a provider `error` event, `response.incomplete`) stays open until the client cancels it or aborts the request, then fails.
 */
export const sseResponse = (text: string, init?: { signal?: AbortSignal | null }): Response => {
  const bytes = new TextEncoder().encode(text);
  const completes = text.includes('"type":"response.completed"');
  const stream = new globalThis.ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      if (completes) { controller.close(); return; }
      const signal = init?.signal ?? undefined;
      const fail = () => { try { controller.error(signal?.reason ?? new DOMException('aborted', 'AbortError')); } catch { /* already closed */ } };
      if (signal?.aborted) fail(); else signal?.addEventListener('abort', fail, { once: true });
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

export const streamWhenAsked = (fake: Fetch): Fetch => async (url, init) => {
  const r = await fake(url, init);
  let asked = false;
  try { asked = JSON.parse(String(init?.body ?? '{}'))?.stream === true; } catch { asked = false; }
  if (!asked || r.status !== 200 || !(r.headers.get('content-type') ?? '').includes('application/json')) return r;
  const text = await r.text();
  let body: Json | undefined;
  try { body = JSON.parse(text) as Json; } catch { body = undefined; }
  if (body?.object !== 'response') return new Response(text, { status: r.status, headers: r.headers });
  return sseResponse(responsesSse(body), init);
};
