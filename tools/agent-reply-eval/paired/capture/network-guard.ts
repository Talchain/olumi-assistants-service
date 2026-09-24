/**
 * OpenAI-only network guard + append-only recorder for the paired capture harness.
 *
 * HARD RULES this file enforces (AI Quality lane, 24 Sep, #63):
 *   1. Every Anthropic credential is removed from process.env and asserted absent.
 *   2. Global fetch is wrapped so ONLY https://api.openai.com/ can be reached. Any other
 *      host THROWS before a byte is sent. In-process Fastify inject never uses fetch.
 *   3. Every OpenAI request the route builds is written to disk (Authorization redacted)
 *      with its raw response and a meta record — append-only (`wx`), never overwritten.
 *   4. An OpenAI call made outside a declared turn is refused, so nothing goes unrecorded.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const OPENAI_HOST = 'api.openai.com';
const ANTHROPIC_ENV = (k: string): boolean => /ANTHROPIC/i.test(k) || k === 'CLAUDE_API_KEY';

export function scrubAnthropicEnv(): string[] {
  const removed: string[] = [];
  for (const k of Object.keys(process.env)) {
    if (ANTHROPIC_ENV(k)) { delete process.env[k]; removed.push(k); }
  }
  return removed;
}

export function assertNoAnthropicEnv(): void {
  const left = Object.keys(process.env).filter(ANTHROPIC_ENV);
  if (left.length > 0) throw new Error(`anthropic env still present: ${left.join(',')}`);
}

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Writes a JSON file that must not already exist (append-only). */
export function writeOnce(path: string, value: unknown): void {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  const key = process.env['OPENAI_API_KEY'];
  if (typeof key === 'string' && key.length > 8 && text.includes(key)) {
    throw new Error(`refusing to write ${path}: it would contain the OpenAI key`);
  }
  if (/Bearer\s+sk-/.test(text)) throw new Error(`refusing to write ${path}: bearer token pattern present`);
  writeFileSync(path, text, { flag: 'wx' });
}

export type InterceptFn = (body: Record<string, unknown>) => Record<string, unknown>[];

export interface TurnContext {
  readonly caseId: string;
  readonly turn: string;
  /** `live` sends to OpenAI; `intercept` saves the request and answers locally (no paid call). */
  readonly mode: 'live' | 'intercept';
  readonly intercept?: InterceptFn;
}

export interface CallRecord {
  readonly caseId: string;
  readonly turn: string;
  readonly call: string;
  readonly dir: string;
  readonly purpose: string;
  readonly hop: number | null;
  readonly during_hop: number | null;
  readonly intercepted: boolean;
  readonly paid: boolean;
  readonly http_status: number;
  readonly wall_ms: number;
  readonly final_reply_hop: boolean;
  readonly output_text: string;
  readonly function_calls: string[];
  readonly usage: Record<string, unknown> | null;
  readonly model: string;
  readonly instructions_sha256: string | null;
}

interface GuardState {
  root: string;
  ctx: TurnContext | null;
  callIndex: number;
  convHop: number;
  records: CallRecord[];
  blocked: { url: string; at: string }[];
  realFetch: typeof fetch | null;
  generationCalls: number;
  tokenCountCalls: number;
}

const state: GuardState = {
  root: '', ctx: null, callIndex: 0, convHop: -1, records: [], blocked: [], realFetch: null, generationCalls: 0, tokenCountCalls: 0,
};

export const guardStats = () => ({
  blocked: [...state.blocked], generation_calls: state.generationCalls, token_count_calls: state.tokenCountCalls,
});

export function beginTurn(ctx: TurnContext): string {
  const dir = join(state.root, ctx.caseId, ctx.turn);
  mkdirSync(dir, { recursive: true });
  state.ctx = ctx;
  state.callIndex = 0;
  state.convHop = -1;
  state.records = [];
  return dir;
}

export function endTurn(): CallRecord[] {
  const out = state.records;
  state.ctx = null;
  state.records = [];
  return out;
}

const redactHeaders = (h: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  const entries: [string, string][] = h instanceof Headers
    ? [...h.entries()]
    : Array.isArray(h) ? (h as [string, string][]) : Object.entries((h ?? {}) as Record<string, string>);
  for (const [k, v] of entries) {
    out[k] = /authorization|api-key|openai-organization|openai-project/i.test(k) ? '[REDACTED]' : String(v);
  }
  return out;
};

const outputTextOf = (output: unknown): string => {
  let t = '';
  for (const o of (Array.isArray(output) ? output : []) as { type?: string; content?: { type?: string; text?: string }[] }[]) {
    if (o?.type !== 'message') continue;
    for (const c of o.content ?? []) if (c?.type === 'output_text') t += c.text ?? '';
  }
  return t;
};

const usageOf = (u: unknown): Record<string, unknown> | null => {
  if (u === null || typeof u !== 'object') return null;
  const x = u as Record<string, any>;
  return {
    input_tokens: x.input_tokens ?? null,
    cached_tokens: x.input_tokens_details?.cached_tokens ?? null,
    cache_write_tokens: x.input_tokens_details?.cache_write_tokens ?? null,
    output_tokens: x.output_tokens ?? null,
    reasoning_tokens: x.output_tokens_details?.reasoning_tokens ?? null,
    total_tokens: x.total_tokens ?? null,
    raw: x,
  };
};

/** Installs the guard. Returns the unwrapped fetch for nothing — it is deliberately not exposed. */
export function installGuard(root: string): void {
  if (state.realFetch !== null) { state.root = root; return; }
  state.root = root;
  const realFetch = globalThis.fetch;
  state.realFetch = realFetch;
  const guarded = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as { url?: unknown })?.url ?? '');
    let u: URL;
    try { u = new URL(url); } catch { throw new Error(`network guard: unparseable URL refused before send`); }
    if (u.protocol !== 'https:' || u.host !== OPENAI_HOST) {
      state.blocked.push({ url: `${u.protocol}//${u.host}${u.pathname}`, at: new Date().toISOString() });
      throw new Error(`network guard: ${u.host} is not ${OPENAI_HOST} — refused before send`);
    }
    assertNoAnthropicEnv();
    const ctx = state.ctx;
    if (ctx === null) throw new Error('network guard: OpenAI call outside a recorded turn — refused before send');
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(bodyText) as Record<string, unknown>; } catch { body = { _unparseable_body: true }; }
    const isTokenCount = u.pathname.endsWith('/input_tokens');
    const isConstruction = (body['text'] as { format?: { type?: string } } | undefined)?.format?.type === 'json_schema';
    // A second structured call in the same turn is the size gate's one bounded retry.
    const purpose = isTokenCount ? 'token_count' : isConstruction
      ? (state.records.some((r) => r.purpose.startsWith('construction')) ? 'construction_retry' : 'construction')
      : 'conversation';
    if (purpose === 'conversation') state.convHop += 1;
    state.callIndex += 1;
    const call = String(state.callIndex).padStart(2, '0');
    const dir = join(state.root, ctx.caseId, ctx.turn);
    const requestRecord = {
      url: `${u.protocol}//${u.host}${u.pathname}`,
      method: init?.method ?? 'GET',
      headers: redactHeaders(init?.headers),
      body,
    };
    // Written BEFORE the call so a crashed turn still keeps what was sent.
    writeOnce(join(dir, `call-${call}.request.json`), requestRecord);

    const started = performance.now();
    let status = 200;
    let rawText: string;
    let responseHeaders: Record<string, string> = {};
    const intercepted = ctx.mode === 'intercept' && !isTokenCount;
    let res: Response;
    if (intercepted) {
      const output = (ctx.intercept ?? (() => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '(intercepted: capture only)' }] }]))(body);
      rawText = JSON.stringify({ id: 'resp_intercepted_capture_only', object: 'response', status: 'completed', model: body['model'], output, usage: null, _intercepted: true });
      res = new Response(rawText, { status: 200, headers: { 'content-type': 'application/json' } });
    } else {
      const upstream = await realFetch(url, init);
      status = upstream.status;
      rawText = await upstream.text();
      for (const k of ['x-request-id', 'openai-processing-ms', 'openai-version']) {
        const v = upstream.headers.get(k);
        if (v !== null) responseHeaders[k] = v;
      }
      if (isTokenCount) state.tokenCountCalls += 1; else state.generationCalls += 1;
      res = new Response(rawText, { status: upstream.status, statusText: upstream.statusText, headers: { 'content-type': 'application/json' } });
    }
    const wallMs = Math.round((performance.now() - started) * 10) / 10;
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(rawText) as Record<string, unknown>; } catch { parsed = null; }
    if (parsed !== null) writeOnce(join(dir, `call-${call}.response.json`), parsed);
    else writeOnce(join(dir, `call-${call}.response.txt`), rawText);

    const output = parsed?.['output'];
    const fnCalls = ((Array.isArray(output) ? output : []) as { type?: string; name?: string }[])
      .filter((o) => o?.type === 'function_call').map((o) => String(o.name));
    const text = outputTextOf(output);
    const finalReply = purpose === 'conversation' && fnCalls.length === 0 && status === 200;
    const tools = Array.isArray(body['tools']) ? (body['tools'] as { name?: string }[]) : null;
    const instructions = typeof body['instructions'] === 'string' ? (body['instructions'] as string) : null;
    const usage = usageOf(parsed?.['usage']);
    const meta = {
      case: ctx.caseId,
      turn: ctx.turn,
      call,
      purpose,
      hop: purpose === 'conversation' ? state.convHop : null,
      during_hop: purpose.startsWith('construction') ? state.convHop : null,
      final_reply_hop: finalReply,
      model: body['model'] ?? null,
      url: requestRecord.url,
      settings: {
        max_output_tokens: body['max_output_tokens'] ?? null,
        tool_choice: body['tool_choice'] ?? null,
        reasoning: body['reasoning'] ?? null,
        text_format: (body['text'] as { format?: Record<string, unknown> } | undefined)?.format
          ? { type: (body['text'] as any).format.type, name: (body['text'] as any).format.name, strict: (body['text'] as any).format.strict }
          : null,
        temperature: body['temperature'] ?? null,
        tools_count: tools === null ? null : tools.length,
        tool_names: tools === null ? null : tools.map((t) => t.name),
        instructions_chars: instructions?.length ?? null,
        instructions_sha256: instructions === null ? null : sha256(instructions),
        input_items: Array.isArray(body['input']) ? (body['input'] as unknown[]).length : typeof body['input'] === 'string' ? 'string' : null,
        input_item_types: Array.isArray(body['input'])
          ? (body['input'] as { type?: string; role?: string }[]).map((i) => i?.type ?? `role:${i?.role}`)
          : null,
      },
      wall_ms: wallMs,
      http_status: status,
      usage,
      output_function_calls: fnCalls,
      output_text_chars: text.length,
      response_headers: responseHeaders,
      intercepted,
      paid: !intercepted && !isTokenCount,
      guard: 'openai-only-ok',
      guard_detail: { host: u.host, protocol: u.protocol, anthropic_env_absent: true, recorded_before_send: true },
      recorded_at: new Date().toISOString(),
    };
    writeOnce(join(dir, `call-${call}.meta.json`), meta);
    state.records.push({
      caseId: ctx.caseId, turn: ctx.turn, call, dir, purpose, hop: meta.hop, during_hop: meta.during_hop,
      intercepted, paid: meta.paid, http_status: status, wall_ms: wallMs, final_reply_hop: finalReply,
      output_text: text, function_calls: fnCalls, usage, model: String(body['model'] ?? ''),
      instructions_sha256: meta.settings.instructions_sha256,
    });
    return res;
  };
  globalThis.fetch = guarded as typeof fetch;
}
