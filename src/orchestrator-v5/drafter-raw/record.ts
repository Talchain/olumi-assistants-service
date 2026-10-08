/**
 * ⭐ THE DRAFTER'S RAW ANSWER, KEPT FOR EVERY SERVED DRAFT — the pure half (no I/O).
 *
 * WHY (DL bench, `bench/ATTRIBUTION.md`, 6 Oct): the replay bench re-runs every served draft with 0 LLM calls, but only
 * AFTER the drafter — the drafter's raw output was stored for 0 of 77 served drafts, so no change to the drafter or to
 * construction (`buildModelFromBrief`) could be measured on a real served draft, only on a 9-draw proxy. This module
 * captures, per served draft, the exact text each drafter call returned — the string `buildModelFromBrief` then
 * `JSON.parse`s — with the identity of the request that produced it (the same prompt/schema identity the provider
 * ledger row carries, `agentRequestIdentity`), so the bench can feed those texts back through any tree's construction.
 *
 * ⛔ WHAT IS NEVER STORED HERE:
 *   · the brief — it is already persisted by the registration (`brief_text`); only its sha256 and length are kept;
 *   · the call's `input` — it embeds the brief (and, on a retry, the first draft, which is the first call's raw text);
 *     only its sha256 is kept;
 *   · a provider error message — an OpenAI 401 body echoes a (masked) key; a failed call is recorded as `threw: true`;
 *   · request headers, the API key, the user id.
 *
 * ⛔ ONE RECORD PER DRAFT, NOT ONE ROW PER CALL: the first call and its one construction retry travel together in
 * `calls`, in the order they were made, so "exactly one record per served draft" holds by construction.
 */
import { createHash } from 'node:crypto';

import { agentRequestIdentity } from '../agent-lane/runtime/prompt-identity.js';
import { strictForTheDrafter, type CallStructuredModel } from '../agent-lane/runtime/build-model.js';

/** The dedicated table. No window reader at any pin reads it (see the migration header). */
export const DRAFTER_RAW_TABLE = 'cee_drafter_raw_responses';
/** Bump when the row's shape changes, so a reader can tell records apart. */
export const DRAFTER_RAW_RECORD_VERSION = 1;
/** The stored cap per raw response: 200 KiB of UTF-8, marker included. */
export const DRAFTER_RAW_MAX_BYTES = 200 * 1024;
/** A draft makes at most two drafter calls today (first + one retry); anything past this is not kept. */
export const DRAFTER_RAW_MAX_CALLS = 4;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The marker a truncated response ends with — never valid JSON, so a truncated text can never be replayed as whole. */
export function truncationMarker(originalBytes: number, keptBytes: number): string {
  return `\n[[olumi:drafter_raw_truncated original_bytes=${originalBytes} kept_bytes=${keptBytes}]]`;
}

/**
 * Cap a raw response at `maxBytes` of UTF-8 INCLUDING the marker. Under the cap the text is returned untouched (the
 * SAME string). Over it, the longest prefix that ends on a whole character is kept and the marker appended.
 */
export function capRawResponse(text: string, maxBytes: number = DRAFTER_RAW_MAX_BYTES): { text: string; bytes: number; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, bytes: buf.length, truncated: false };
  // The marker's own length depends on the kept count's digits; size it on the worst case (the cap itself).
  const room = Math.max(0, maxBytes - Buffer.byteLength(truncationMarker(buf.length, maxBytes), 'utf8'));
  let end = room;
  // Never cut inside a character: step back over UTF-8 continuation bytes (10xxxxxx).
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end -= 1;
  return { text: buf.subarray(0, end).toString('utf8') + truncationMarker(buf.length, end), bytes: buf.length, truncated: true };
}

/** One drafter call, as kept. */
export interface DrafterCallRecord {
  readonly seq: number;
  /** `first`: the brief's draft · `retry`: the one construction retry `buildModelFromBrief` may make. */
  readonly role: 'first' | 'retry';
  readonly model: string;
  /** From `agentRequestIdentity` — the SAME fields the provider ledger row for this call carries. */
  readonly prompt_alias: string;
  readonly prompt_sha256: string;
  readonly schema_sha256: string | null;
  readonly reasoning_effort: string | null;
  readonly max_output_tokens: number;
  /** sha256 of the call's `input` (the brief, or brief + issues + first draft on a retry). The input itself is not kept. */
  readonly input_sha256: string;
  readonly status: string | null;
  readonly incomplete_reason: string | null;
  readonly usage: Record<string, unknown> | null;
  /** The call threw (transport/HTTP failure): no text came back. The error message is deliberately not kept. */
  readonly threw: boolean;
  /** The text the call returned — the string construction parses — byte-identical unless `raw_truncated`. */
  readonly raw_text: string;
  /** UTF-8 length of the text as returned, before any cap. */
  readonly raw_bytes: number;
  readonly raw_truncated: boolean;
}

/**
 * Wrap the drafter so every call it makes is appended to `calls`, in order. Transparent: it returns (or throws)
 * exactly what the wrapped call did, and the recording itself never throws into the build.
 */
export function recordingDrafter(inner: CallStructuredModel, calls: DrafterCallRecord[]): CallStructuredModel {
  return async (req, deadlineAt) => {
    const seq = calls.length;
    const keep = (out: Awaited<ReturnType<CallStructuredModel>> | null): void => {
      try {
        if (seq >= DRAFTER_RAW_MAX_CALLS) return;
        const identity = agentRequestIdentity('agent.construct', {
          instructions: req.instructions,
          max_output_tokens: req.max_output_tokens,
          ...(req.reasoning_effort !== undefined ? { reasoning: { effort: req.reasoning_effort } } : {}),
          text: { format: { type: 'json_schema', schema: strictForTheDrafter(req.schema) } },
        });
        const raw = capRawResponse(out?.text ?? '');
        calls.push({
          seq,
          role: seq === 0 ? 'first' : 'retry',
          model: req.model,
          prompt_alias: String(identity['prompt_alias'] ?? 'agent.construct'),
          prompt_sha256: String(identity['prompt_sha256'] ?? ''),
          schema_sha256: typeof identity['schema_sha256'] === 'string' ? identity['schema_sha256'] : null,
          reasoning_effort: req.reasoning_effort ?? null,
          max_output_tokens: req.max_output_tokens,
          input_sha256: sha256(req.input),
          status: out?.status ?? null,
          incomplete_reason: out?.incomplete_reason ?? null,
          usage: out?.usage !== undefined && out.usage !== null && typeof out.usage === 'object' ? out.usage : null,
          threw: out === null,
          raw_text: raw.text,
          raw_bytes: raw.bytes,
          raw_truncated: raw.truncated,
        });
      } catch { /* keeping a record never costs the draft */ }
    };
    let out: Awaited<ReturnType<CallStructuredModel>>;
    try {
      out = await (deadlineAt === undefined ? inner(req) : inner(req, deadlineAt));
    } catch (err) {
      keep(null);
      throw err;
    }
    keep(out);
    return out;
  };
}

/** What the draft became, as far as the record needs it. */
export type DrafterRawOutcome = 'registered' | 'replayed' | 'refused' | 'threw';

/** The row written to {@link DRAFTER_RAW_TABLE} — one per served draft that made at least one drafter call. */
export interface DrafterRawRow {
  readonly record_version: number;
  readonly scenario_id: string;
  /** The construction's operation id (`constructionOperationId`) — the id the registration and its version carry. */
  readonly operation_id: string;
  readonly request_id: string;
  readonly model_version_id: string | null;
  readonly outcome: DrafterRawOutcome;
  readonly refusal: string | null;
  readonly brief_sha256: string;
  readonly brief_chars: number;
  readonly cee_build: string;
  readonly environment: string;
  readonly environment_source: string;
  readonly render_service: string | null;
  readonly calls: readonly DrafterCallRecord[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build the row from what the build returned (`undefined` when it threw). Pure. */
export function drafterRawRow(input: {
  readonly scenarioId: string;
  readonly operationId: string;
  readonly requestId: string;
  readonly brief: string;
  readonly built: { readonly ok: boolean; readonly [k: string]: unknown } | undefined;
  readonly calls: readonly DrafterCallRecord[];
  readonly ceeBuild: string;
  readonly environment: string;
  readonly environmentSource: string;
  readonly renderService: string | null;
}): DrafterRawRow {
  const { built } = input;
  const version = built?.['model_version'];
  const versionId = version !== null && typeof version === 'object' ? (version as { version_id?: unknown }).version_id : undefined;
  const outcome: DrafterRawOutcome = built === undefined ? 'threw'
    : built.ok !== true ? 'refused'
      : built['replayed'] === true ? 'replayed' : 'registered';
  return {
    record_version: DRAFTER_RAW_RECORD_VERSION,
    scenario_id: input.scenarioId,
    operation_id: input.operationId,
    request_id: input.requestId,
    model_version_id: typeof versionId === 'string' && UUID.test(versionId) ? versionId : null,
    outcome,
    refusal: outcome === 'refused' && typeof built?.['refusal'] === 'string' ? built['refusal'] : null,
    brief_sha256: sha256(input.brief),
    brief_chars: input.brief.length,
    cee_build: input.ceeBuild,
    environment: input.environment,
    environment_source: input.environmentSource,
    render_service: input.renderService,
    calls: input.calls,
  };
}
