/**
 * MEASUREMENT BRANCH ONLY (model comparison, 27 Oct 2026): never merged, never pushed. With MC_DRAFT_PROVIDER=anthropic the
 * canonical drafter's call goes to Claude instead of OpenAI, with the SAME instructions, conversation and canonical schema
 * (`draftRequestBody`), at effort medium with adaptive thinking. Unset, nothing changes. The call is ledgered as an
 * `anthropic` row at the same site, so `_provider_calls` carries its tokens and duration.
 *
 * The schema cannot go as a Claude structured output: the API refuses it (400, 27 Oct: "71 parameters with type arrays or
 * anyOf … limit: 16 parameters with unions"). So the same schema JSON goes as text after the same instructions, with one
 * line asking for the bare object, and CEE's own parse → compile → repair loop judges the reply exactly as it judges OpenAI's.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadavg } from 'node:os';
import { DS_NATIVE_RULES } from './mc-ds-native.js';
import OpenAI from 'openai-v7';
import { assertProviderAllowed, recordProviderAttempt, recordProviderReturnedModel, recordProviderUsage } from '../../adapters/llm/provider-policy.js';
import type { CallOutput, ResponsesCall } from './draft.js';

export const mcDraftModel = (): string | null =>
  (process.env['MC_DRAFT_PROVIDER'] === 'anthropic' ? process.env['MC_DRAFT_MODEL'] || 'claude-opus-5-5'
    : process.env['MC_DRAFT_PROVIDER'] === 'deepseek' ? process.env['MC_DRAFT_MODEL'] || 'deepseek-v4-pro' : null);

/** MC_OPENAI_MODEL / MC_OPENAI_EFFORT: the OpenAI drafter call with another model or effort (measurement only); unset, unchanged. */
export function mcOpenAiBody<B extends { model?: unknown; reasoning?: unknown }>(body: B): B {
  const model = process.env['MC_OPENAI_MODEL']; const effort = process.env['MC_OPENAI_EFFORT'];
  if (!model && !effort) return body;
  return { ...body, ...(model ? { model } : {}), ...(effort ? { reasoning: { ...(body.reasoning as object | undefined), effort } } : {}) };
}

const transient = (err: unknown): boolean => {
  const s = (err as { status?: unknown })?.status;
  return err instanceof Anthropic.APIConnectionError || (typeof s === 'number' && (s >= 500 || s === 408));
};

/** The bare JSON object: a fenced or prefaced reply is cut to its outermost braces (and the cut is recorded). */
function bareJson(text: string): { text: string; cleanup: string | null } {
  const t = text.trim();
  if (t.startsWith('{') && t.endsWith('}')) return { text: t, cleanup: null };
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  return a >= 0 && b > a ? { text: t.slice(a, b + 1), cleanup: t.startsWith('```') ? 'fence' : 'slice' } : { text: t, cleanup: 'none_found' };
}

export function anthropicResponsesCall(model: string): ResponsesCall {
  // No SDK retries: a 429 must surface on the first one (the run stops); one resend of our own for a 5xx/529 or a lost connection.
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'], maxRetries: 0 });
  return async (body): Promise<CallOutput> => {
    const format = body.text?.format as { name?: string; schema?: Record<string, unknown> } | undefined;
    const system = `${String(body.instructions)}\n\nReply with ONE JSON object and nothing else (no prose, no code fences). It must conform exactly to this JSON schema "${format?.name ?? 'canonical_model'}" (strict: every property is required, no other properties; use null where the schema allows it):\n${JSON.stringify(format?.schema ?? {})}`;
    const params = {
      model,
      max_tokens: body.max_output_tokens ?? 32_000,
      system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
      messages: (body.input as { role: 'user' | 'assistant'; content: string }[]).map((m) => ({ role: m.role, content: m.content })),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
    };
    for (let tries = 0; ; tries += 1) {
      const handle = assertProviderAllowed('anthropic', 'model-program.draft', { model, purpose: 'canonical_draft' });
      try {
        const msg = await client.messages.stream(params as unknown as Anthropic.MessageStreamParams).finalMessage();
        const u = msg.usage as unknown as Record<string, number | null>;
        const fresh = u['input_tokens'] ?? 0; const read = u['cache_read_input_tokens'] ?? 0; const write = u['cache_creation_input_tokens'] ?? 0;
        const raw = msg.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
        const bare = raw === '' ? null : bareJson(raw);
        recordProviderUsage(handle, { input_tokens: fresh + read + write, output_tokens: u['output_tokens'] ?? 0,
          input_tokens_details: { cached_tokens: read, cache_write_tokens: write }, anthropic_usage: { ...u }, mc_cleanup: bare?.cleanup ?? null });
        recordProviderReturnedModel(handle, msg.model);
        recordProviderAttempt(handle, { transport_status: 200, result: String(msg.stop_reason), outcome: 'success', retry: false });
        const stop = msg.stop_reason;
        return { text: bare?.text ?? null, status: stop === 'end_turn' ? 'completed' : String(stop),
          incomplete: stop === 'max_tokens' ? 'max_output_tokens' : stop === 'refusal' ? 'refusal' : null, usage: { ...msg.usage, mc_cleanup: bare?.cleanup ?? null } };
      } catch (err) {
        const s = (err as { status?: unknown })?.status;
        if (process.env['MC_DEBUG']) console.error('MC anthropic error:', s, err instanceof Error ? err.message.slice(0, 600) : err);
        recordProviderUsage(handle, undefined);
        recordProviderAttempt(handle, { transport_status: typeof s === 'number' ? s : null, result: err instanceof Error ? err.name : 'error',
          outcome: s === 429 ? 'rate_limited' : typeof s === 'number' ? 'http_error' : 'transport_error', retry: tries === 0 && transient(err) });
        if (tries === 0 && transient(err)) continue;
        // providerErrorOf reads status / type / code / requestID: give it Anthropic's error type as `type`.
        const e = err as { error?: { error?: { type?: string } }; type?: string };
        if (err !== null && typeof err === 'object' && e.type === undefined && e.error?.error?.type) Object.assign(err, { type: e.error.error.type });
        throw err;
      }
    }
  };
}

/**
 * MC_DRAFT_PROVIDER=deepseek: the same drafter call to DeepSeek's OpenAI-compatible Chat Completions (27 Oct). DeepSeek has no
 * strict json_schema ("This response_format type is unavailable now"), so, as for Claude, the same schema goes as text with
 * json_object mode, and CEE's parse -> compile -> repair loop judges the reply. Ledgered as a `deepseek` row.
 */
const STUDY = '/Users/paulslee/olumi-work/recovery/live/q-runs-model-compare/deepseek-study';
const INBOX = '/Users/paulslee/olumi-work/recovery/inbox/DL-3.md';
const digest = (s: string): string => createHash('sha256').update(s).digest('hex');
export function dsSystem(body: Parameters<ResponsesCall>[0]): string {
  const format = body.text?.format as { name?: string; schema?: Record<string, unknown> } | undefined;
  return `Return ONE JSON object conforming to this exact closed schema. All required keys must be present; null only where allowed.\nJSON SCHEMA ${format?.name ?? 'canonical_model'}:\n${JSON.stringify(format?.schema ?? {})}\n\n${DS_NATIVE_RULES}\n\nROUND-3 RULES (all apply):\n${String(body.instructions)}`;
}
export function deepseekResponsesCall(model: string): ResponsesCall {
  const asTool = process.env['MC_DS_TOOL'] === '1';
  const client = new OpenAI({ apiKey: process.env['DEEPSEEK_API_KEY'], baseURL: asTool ? 'https://api.deepseek.com/beta' : 'https://api.deepseek.com', maxRetries: 0, timeout: 600_000 });
  return async (body): Promise<CallOutput> => {
    if (existsSync(`${STUDY}/STOP-429.txt`)) throw new Error('study stopped on first 429');
    while (loadavg()[0] >= 25) await new Promise((r) => setTimeout(r, 30_000));
    const format = body.text?.format as { name?: string; schema?: Record<string, unknown> } | undefined;
    const system = dsSystem(body);
    const messages = [{ role: 'system' as const, content: system }, ...(body.input as { role: 'user' | 'assistant'; content: string }[])];
    const effort = process.env['MC_DRAFT_EFFORT'] || 'low';
    const think = effort === 'off' ? { thinking: { type: 'disabled' } } : { reasoning_effort: effort };
    const shape = asTool ? { tools: [{ type: 'function', function: { name: format?.name ?? 'canonical_model', strict: true, parameters: format?.schema ?? {} } }], tool_choice: { type: 'function', function: { name: format?.name ?? 'canonical_model' } } } : { response_format: { type: 'json_object' } };
    const handle = assertProviderAllowed('deepseek' as never, 'model-program.draft', { model, purpose: 'canonical_draft', prompt_sha256: digest(system), schema_sha256: digest(JSON.stringify(format?.schema ?? {})), reasoning_effort: effort, max_output_tokens: 32_000 });
    const start = Date.now(); const at = new Date().toISOString();
    let reasoningFirst: number | null = null, contentFirst: number | null = null, last: number | null = null;
    try {
      const stream = await client.chat.completions.create({ model, messages, max_tokens: 32_000, ...shape, ...think, stream: true, stream_options: { include_usage: true } } as unknown as OpenAI.ChatCompletionCreateParamsStreaming);
      let raw = '', stop: string | null = null, returned = '', usage: Record<string, unknown> = {}; let heartbeat = 0;
      for await (const c of stream) {
        if (Date.now() - heartbeat > 10_000) { writeFileSync(`${STUDY}/probe-heartbeat-${start}.json`, JSON.stringify({ at, model, effort, elapsed_ms: Date.now() - start, output_chars: raw.length })); heartbeat = Date.now(); }
        const delta = c.choices[0]?.delta as { content?: string; reasoning_content?: string; tool_calls?: { function?: { arguments?: string } }[] } | undefined;
        if (delta?.reasoning_content && reasoningFirst === null) reasoningFirst = Date.now() - start;
        const part = asTool ? delta?.tool_calls?.[0]?.function?.arguments : delta?.content;
        if (part) { if (contentFirst === null) contentFirst = Date.now() - start; raw += part; }
        if (delta?.reasoning_content || part) last = Date.now() - start;
        if (c.usage) usage = c.usage as unknown as Record<string, unknown>;
        if (c.model) returned = c.model;
        if (c.choices[0]?.finish_reason) stop = c.choices[0].finish_reason;
      }
      const bare = raw ? bareJson(raw) : null;
      const u = usage as Record<string, number>;
      const timing = { total_ms: Date.now() - start, reasoning_first_ms: reasoningFirst, output_first_ms: contentFirst, last_token_ms: last, reasoning_phase_ms: reasoningFirst !== null && contentFirst !== null ? contentFirst - reasoningFirst : null, output_phase_ms: contentFirst !== null && last !== null ? last - contentFirst : null };
      const meta = { at, model, returned_model: returned, effort, tool: asTool, system_sha256: digest(system), schema_sha256: digest(JSON.stringify(format?.schema ?? {})), usage, timing, status: 200, stop };
      appendFileSync(`${STUDY}/provider-ledger.jsonl`, JSON.stringify(meta) + '\n');
      recordProviderUsage(handle, { input_tokens: u['prompt_tokens'] ?? 0, output_tokens: u['completion_tokens'] ?? 0, input_tokens_details: { cached_tokens: u['prompt_cache_hit_tokens'] ?? 0 }, deepseek_usage: usage, mc_timing: timing, mc_cleanup: bare?.cleanup ?? null });
      recordProviderReturnedModel(handle, returned);
      recordProviderAttempt(handle, { transport_status: 200, result: String(stop), outcome: 'success', retry: false });
      return { text: bare?.text ?? null, status: stop === 'stop' || stop === 'tool_calls' ? 'completed' : String(stop), incomplete: stop === 'length' ? 'max_output_tokens' : null, usage: { ...usage, mc_timing: timing } };
    } catch (err) {
      const status = (err as { status?: number })?.status ?? null;
      appendFileSync(`${STUDY}/provider-ledger.jsonl`, JSON.stringify({ at, model, effort, status, total_ms: Date.now() - start, error_type: err instanceof Error ? err.name : 'error' }) + '\n');
      recordProviderUsage(handle, undefined);
      recordProviderAttempt(handle, { transport_status: status, result: err instanceof Error ? err.name : 'error', outcome: status === 429 ? 'rate_limited' : 'http_error', retry: false });
      if (status === 429) {
        const line = `MODEL-COMPARE/DeepSeek study STOP: first real 429 at ${new Date().toISOString()}; no further provider calls. Evidence: ${STUDY}/STOP-429.txt`;
        writeFileSync(`${STUDY}/STOP-429.txt`, line + '\n'); appendFileSync(INBOX, '\n' + line + '\n');
      }
      throw err;
    }
  };
}
