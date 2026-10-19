/**
 * PATH-B: the OpenAI client the Agents SDK runs on. It is the SDK's own client (openai v7, the same instance the SDK
 * resolves, with its native retries and Conversations API). Olumi adds one thing, its `fetch`, which writes each physical
 * model attempt to the request's provider ledger (`_provider_calls`):
 * - each row carries the requested and the RETURNED model, the tool names sent and a digest of the input sent;
 * - a resend of the same input after a failed attempt marks that attempt as retried.
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
      throw err;
    }
    if (!r.ok) {
      recordProviderAttempt(handle, { transport_status: r.status, result: 'http_error', outcome: r.status === 429 ? 'rate_limited' : 'http_error', retry: false });
      return r;
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
  return new OpenAI({ apiKey, fetch: ledgerFetch, maxRetries: AGENTS_CLIENT_MAX_RETRIES });
}
