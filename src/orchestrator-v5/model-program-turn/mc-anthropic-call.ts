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
import { assertProviderAllowed, recordProviderAttempt, recordProviderReturnedModel, recordProviderUsage } from '../../adapters/llm/provider-policy.js';
import type { CallOutput, ResponsesCall } from './draft.js';

export const mcDraftModel = (): string | null =>
  (process.env['MC_DRAFT_PROVIDER'] === 'anthropic' ? process.env['MC_DRAFT_MODEL'] || 'claude-opus-5-5' : null);

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
