/**
 * PATH-B: the OpenAI client the Agents SDK runs on. It is the SDK's own client (openai v7, the same instance the SDK
 * resolves, with its Conversations API). Stateless calls keep native retries; a client bound to a Conversation never
 * resends a Responses call whose acceptance may be unknown. Its `fetch` writes each physical
 * model attempt to the request's provider ledger (`_provider_calls`):
 * - each row carries the requested and the RETURNED model, the tool names sent and a digest of the input sent;
 * - a resend of the same input after a failed attempt marks that attempt as retried;
 * - a STREAMED attempt is recorded from its terminal event when the stream ends; the caller awaits `pending` before it
 *   reads the ledger.
 * The request's provider policy is checked when the client is made, so a route that does not allow OpenAI never gets one
 * (a refusal thrown inside `fetch` would be retried and re-labelled by the client). Calls that are not model calls
 * (creating the scenario's Conversation) take no row.
 */
import { createHash } from 'node:crypto';
import OpenAI from 'openai-v7';
import { config } from '../../config/index.js';
import {
  assertProviderAllowed, currentProviderPolicy, ForbiddenProviderError, isProviderAllowed, recordProviderAttempt,
  recordProviderRetry, recordProviderReturnedModel, recordProviderUsage, type ProviderCallDetail, type ProviderCallHandle,
} from './provider-policy.js';

/** Resends the SDK's client makes itself (429, 5xx, connection errors), after the first attempt. */
export const AGENTS_CLIENT_MAX_RETRIES = 2;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const toolNamesOf = (tools: unknown): string[] => (Array.isArray(tools) ? tools : [])
  .map((t) => (t !== null && typeof t === 'object' ? (t as { name?: unknown }).name : undefined))
  .filter((n): n is string => typeof n === 'string');
const SETTINGS = ['reasoning', 'max_output_tokens', 'tool_choice', 'temperature', 'max_tool_calls', 'parallel_tool_calls', 'context_management'];

export interface AgentsClientLedger {
  /** The ledger site of every model row. */
  readonly site: string;
  /** The row's identity fields for one request body (prompt identity, purpose), from the caller's own identity rule. */
  readonly detailOf: (body: Readonly<Record<string, unknown>>) => ProviderCallDetail;
  /** Each streamed attempt's recording, settled when its stream ends (await all before reading `_provider_calls`). */
  readonly pending?: Promise<void>[];
  /** A Conversation can accept a request before its transport fails: never replay that client's calls automatically. */
  readonly conversationBound?: boolean;
  /** A Conversation response was lost or ended without a terminal event; this does not describe Olumi's saved writes. */
  readonly onDeliveryUnknown?: (cause: unknown) => void;
}

/** The terminal response of a Responses SSE stream (`response.completed`, `.incomplete` or `.failed`), if it has one. */
function streamTerminal(text: string): { usage?: unknown; model?: unknown; status?: unknown } | undefined {
  for (const block of text.split('\n\n').reverse()) {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (data === '') continue;
    try {
      const event = JSON.parse(data) as { type?: unknown; response?: { usage?: unknown; model?: unknown; status?: unknown } };
      if (typeof event.type === 'string' && /^response\.(completed|incomplete|failed)$/.test(event.type) && event.response) return event.response;
    } catch { /* not a JSON event */ }
  }
  return undefined;
}

/**
 * Whether a Responses SSE stream carried the provider's own `error` event (a refusal such as exhausted credits or a server
 * error). That is an answer, so its delivery is known; only a stream that simply stops leaves delivery unknown.
 */
function streamCarriedError(sse: string): boolean {
  return sse.split('\n').some((line) => {
    if (line.trim() === 'event: error') return true;
    if (!line.startsWith('data:')) return false;
    try { return (JSON.parse(line.slice(5).trim()) as { type?: unknown }).type === 'error'; } catch { return false; }
  });
}

/** The SDK's client with the ledger on its fetch. Make one per turn: the ledger is the request's. */
export function ledgeredAgentsClient(ledger: AgentsClientLedger): OpenAI {
  if (!isProviderAllowed('openai')) throw new ForbiddenProviderError('openai', currentProviderPolicy()?.route ?? 'unknown', ledger.site);
  let previous: { readonly handle: ProviderCallHandle; readonly input: string; ok: boolean } | undefined;
  const ledgerFetch = async (url: string | URL | Request, init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const path = new URL(url instanceof Request ? url.url : String(url)).pathname;
    if (!path.endsWith('/responses')) return fetch(url, init);
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
    const input = sha256(JSON.stringify(body['input'] ?? null));
    const handle = assertProviderAllowed('openai', ledger.site, {
      ...ledger.detailOf(body), model: String(body['model']), tool_names: toolNamesOf(body['tools']), input_sha256: input,
      settings: Object.fromEntries(SETTINGS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])),
    });
    if (previous !== undefined && !previous.ok && previous.input === input) recordProviderRetry(previous.handle, 'transport');
    const attempt = { handle, input, ok: false };
    previous = attempt;
    let r: Response;
    try {
      r = await fetch(url, init);
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      recordProviderAttempt(handle, { transport_status: null, result: name || 'transport_failure',
        outcome: name === 'TimeoutError' ? 'timeout' : name === 'AbortError' ? 'cancelled' : 'transport_error', retry: false });
      if (ledger.conversationBound) ledger.onDeliveryUnknown?.(err);
      throw err;
    }
    if (!r.ok) {
      recordProviderAttempt(handle, { transport_status: r.status, result: 'http_error', outcome: r.status === 429 ? 'rate_limited' : 'http_error', retry: false });
      return r;
    }
    if (body['stream'] === true && r.body !== null) {
      /**
       * The SDK reads THIS stream, and Olumi notes the bytes as they pass through (fresh Claude BLOCK on #3594: a copy is
       * destroyed when the SDK cancels the request on a provider `error` event, so it cannot tell a refusal from a lost
       * transport). The attempt is recorded once, when the stream ends, is cancelled or its request is aborted. Delivery is
       * unknown only when neither a terminal event nor the provider's own error passed through.
       */
      const decoder = new TextDecoder();
      let text = '';
      let ended = false;
      let settle: () => void = () => {};
      ledger.pending?.push(new Promise<void>((resolve) => { settle = resolve; }));
      const end = (how: 'done' | 'stopped' | 'failed', cause?: unknown): void => {
        if (ended) return;
        ended = true;
        try {
          const done = streamTerminal(text);
          if (done !== undefined) {
            recordProviderUsage(handle, done.usage);
            recordProviderReturnedModel(handle, done.model);
            recordProviderAttempt(handle, { transport_status: r.status, result: typeof done.status === 'string' ? done.status : 'response',
              outcome: 'success', retry: false, response_sha256: sha256(text) });
            attempt.ok = true;
            return;
          }
          recordProviderAttempt(handle, how === 'failed'
            ? { transport_status: r.status, result: cause instanceof Error ? cause.name : 'stream_failure', outcome: 'transport_error', retry: false }
            : { transport_status: r.status, result: 'stream_without_terminal_event', outcome: 'invalid_response', retry: false });
          if (ledger.conversationBound && !streamCarriedError(text)) {
            ledger.onDeliveryUnknown?.(cause ?? new Error('Conversation response ended without a terminal event'));
          }
        } finally { settle(); }
      };
      init?.signal?.addEventListener('abort', () => end('stopped', init.signal?.reason), { once: true });
      const reader = r.body.getReader();
      const passThrough = new globalThis.ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) { text += decoder.decode(); end('done'); controller.close(); return; }
            text += decoder.decode(value, { stream: true });
            controller.enqueue(value);
          } catch (err) { end('failed', err); controller.error(err); }
        },
        cancel(reason) { end('stopped', reason); return reader.cancel(reason); },
      });
      return new Response(passThrough, { status: r.status, statusText: r.statusText, headers: r.headers });
    }
    const bytes = await r.clone().text();
    try {
      const j = JSON.parse(bytes) as { usage?: unknown; status?: unknown; model?: unknown };
      recordProviderUsage(handle, j.usage);
      recordProviderReturnedModel(handle, j.model);
      recordProviderAttempt(handle, { transport_status: r.status, result: typeof j.status === 'string' ? j.status : 'response',
        outcome: 'success', retry: false, response_sha256: sha256(bytes) });
      attempt.ok = true;
    } catch {
      recordProviderAttempt(handle, { transport_status: r.status, result: 'invalid_json', outcome: 'invalid_response', retry: false });
    }
    return r;
  };
  // No key configured: the request still goes, and OpenAI's 401 becomes an `http_error` row, as `postResponses` does with
  // an empty bearer (the client itself refuses to start without one).
  const apiKey = config.llm.openaiApiKey || 'no-openai-api-key-configured';
  return new OpenAI({ apiKey, fetch: ledgerFetch, maxRetries: ledger.conversationBound ? 0 : AGENTS_CLIENT_MAX_RETRIES });
}
