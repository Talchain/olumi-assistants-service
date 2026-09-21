/**
 * Turn Debug Store
 *
 * In-memory FIFO store for per-turn V5 debug data, keyed by turn_id.
 * Enabled only when CEE_TURN_DEBUG_ENABLED=true -- never populates in production
 * unless the flag is explicitly set.
 *
 * Pattern mirrors src/cee/llm-output-store.ts (TTL, FIFO eviction, singleton).
 */

import { createHash } from 'node:crypto';
import type { QuantityExtractionResult } from '../context/cqe/schema-types.js';
import type { ResolutionSource } from '../../adapters/llm/router.js';
import { config } from '../../config/index.js';
import { getRuntimeEnv } from '../../config/env-resolver.js';

/** Default TTL: 1 hour */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** Max entries before FIFO eviction */
const MAX_ENTRIES = 500;

/**
 * CQE section captured per turn.
 * Fields mirror CqeExtractionSummary plus the full parsed_quantities array.
 */
export interface TurnDebugCqeSection {
  /** Full CQE extraction results, all fields including value_origin. */
  readonly parsed_quantities: readonly QuantityExtractionResult[];
  /** Pattern IDs that produced at least one match. */
  readonly patterns_matched: readonly string[];
  /** True if any pattern rule exceeded its wall-clock cap, or the total
   * CQE budget (CQE_TOTAL_BUDGET_MS) was exceeded. Indicates SLOWNESS. */
  readonly timeout: boolean;
  /**
   * True if at least one pattern rule did not run to completion, so the
   * result set may contain a lower-fidelity substitute value. Strictly
   * narrower than `timeout`; this is the signal that suppresses
   * deterministic value application.
   */
  readonly degraded: boolean;
  /** Number of results produced by the compromise backstop. */
  readonly compromise_match_count: number;
  /** Wall-clock duration of the CQE run in milliseconds. */
  readonly duration_ms: number;
  /** True if the message exceeded the CQE length limit. */
  readonly message_too_long: boolean;
  /** True if numeric tokens appeared outside the supported word-range. */
  readonly word_range_missed: boolean;
}

/**
 * Per-LLM-call model resolution record. One entry per call; a turn may
 * contain several. Appended in call-order.
 */
export interface ModelResolutionRecord {
  readonly task?: string;
  readonly resolved_model: string;
  readonly resolution_source: ResolutionSource;
  /**
   * Provider that served the request. Group 3 follow-up — without this
   * field an operator looking at model_resolutions can confirm a model
   * string was used but cannot distinguish (say) an openai-routed
   * gpt-4.1 from a misrouted one via a proxy. Optional because pre-
   * Group-3 entries in long-lived fixtures may not have it.
   */
  readonly provider?: 'anthropic' | 'openai' | 'fixtures';
  /** Unix timestamp (ms) when the resolution was recorded. */
  readonly timestamp: number;
}

/**
 * Optional freshness summary recorded on the failure path so a degraded
 * turn still exposes what state the orchestrator saw at routing time.
 * Mirrors the existing freshness fields populated by turn-executor's
 * success path (analysis_freshness, analysis_state_source, etc.) but
 * scoped to the safe subset that contains no raw prompt or user-content.
 */
export interface TurnDebugFreshnessSummary {
  readonly freshness?: string;
  readonly freshness_reason?: string;
  readonly analysis_state_source?: string;
  readonly analysis_staleness_reason?: string;
  readonly analysis_status?: string;
  readonly leading_option_present?: boolean;
}

/**
 * Maximum system-prompt bytes retained per capture. A served prompt is
 * a few tens of KB; the cap bounds a pathological store prompt without
 * silently truncating a real one. Exceeding it sets `truncated: true`
 * rather than dropping the record — a truncated prompt is still the
 * answer to "roughly what were we sending", and a silent absence is not.
 */
export const PROMPT_CAPTURE_MAX_CHARS = 200_000;

/**
 * The bytes of ONE served prompt, plus the identity that says WHICH
 * prompt it was and WHICH model received it.
 *
 * ── WHY BYTES AND IDENTITY TRAVEL TOGETHER ────────────────────────────────
 * Runtime already records `prompt_hash` / `prompt_version` in several
 * places (`v5-diagnostic-trace.ts`, `prompt-attribution.ts`). Those are
 * IDENTITIES: they let an operator say two turns used the same prompt,
 * never what that prompt SAID. Reading the repo's default prompt instead
 * answers a different question, because the served prompt comes from the
 * runtime store and `resolution_source: store_model_config` can override
 * the `CEE_MODEL_*` env vars. So bytes without provenance are unattributable
 * and provenance without bytes is unreadable; this record carries both,
 * derived from ONE `getSystemPromptSnapshot()` resolution so they cannot
 * describe different prompts.
 *
 * ── WHAT IS DELIBERATELY NOT HERE: USER CONTENT ───────────────────────────
 * `system_prompt` holds the SYSTEM half only — Olumi-authored instructions.
 * At the `draft_graph` capture seam `getSystemPromptSnapshot` is called with
 * NO `variables`, so no user text is interpolated into these bytes. The
 * user's own half of the turn (brief, message, graph) is recorded as SHAPE
 * ONLY — `user_content_chars`, `user_content_sha256` — never as text.
 *
 * That is not squeamishness, it is the channel rule: assembled prompts that
 * DO carry user content must never reach pino, Sentry or telemetry (see
 * `utils/logger-config.ts` `DECISION_CONTENT_FIELDS`). Keeping user bytes
 * out of this record entirely means the record is safe wherever it travels,
 * rather than safe only while every future carrier remembers to scrub it.
 */
export interface PromptCaptureRecord {
  /** CEE task whose prompt this is, e.g. `draft_graph`. */
  readonly task: string;
  /**
   * VERBATIM bytes of the served system prompt. Olumi-authored; contains
   * no user content at the capture seams (see the interface header).
   */
  readonly system_prompt: string;
  /** Length of the ORIGINAL prompt, before any truncation. */
  readonly system_prompt_chars: number;
  /** SHA-256 of the ORIGINAL prompt bytes, computed before truncation. */
  readonly system_prompt_sha256: string;
  /** True when `system_prompt` was cut to `PROMPT_CAPTURE_MAX_CHARS`. */
  readonly truncated: boolean;
  /**
   * The loader's own hash for the resolved cache entry. Distinct from
   * `system_prompt_sha256`, which this module computes over the bytes it
   * actually stored: if the two ever disagree, the bytes did not come from
   * the entry the identity names, and that is a finding rather than a
   * rounding error.
   */
  readonly prompt_hash?: string;
  /** Human-readable served version, e.g. `draft_graph_default@v6 (staging)`. */
  readonly prompt_version?: string;
  /** Store prompt id, when the prompt came from the runtime store. */
  readonly prompt_id?: string;
  /** Numeric store version, when the prompt came from the runtime store. */
  readonly prompt_store_version?: number;
  /** Where the bytes came from: the runtime store, or the repo default. */
  readonly prompt_source: 'store' | 'default';
  /** Whether the STAGING variant of the store prompt was served. */
  readonly is_staging?: boolean;
  /** Loader cache state at resolution time. */
  readonly cache_status?: 'fresh' | 'stale' | 'expired' | 'miss';
  /** Serving instance, for diagnosing multi-instance prompt skew. */
  readonly instance_id?: string;
  /** The model this prompt was actually sent to. */
  readonly resolved_model?: string;
  /**
   * Why that model was chosen. `store_model_config` here is the case the
   * env vars do not explain — the reason this field exists.
   */
  readonly resolution_source?: string;
  /** Provider that served the call. */
  readonly provider?: 'anthropic' | 'openai' | 'fixtures';
  /** Size of the user's half of the turn. A COUNT, never the text. */
  readonly user_content_chars?: number;
  /** SHA-256 of the user's half. A DIGEST, never the text. */
  readonly user_content_sha256?: string;
  /** Unix timestamp (ms) when this capture was recorded. */
  readonly captured_at: number;
}

/** A single stored debug entry. */
export interface TurnDebugEntry {
  readonly turn_id: string;
  readonly session_id: string;
  /** Unix timestamp (ms) when this entry was stored. Used for TTL and the response header. */
  readonly stored_at: number;
  readonly cqe: TurnDebugCqeSection;
  /**
   * Per-LLM-call model resolutions for this turn, in call-order.
   * Undefined when no resolutions recorded yet; empty array when explicitly
   * cleared. Append via recordModelResolution.
   */
  readonly model_resolutions?: readonly ModelResolutionRecord[];
  /**
   * V5 P0 stabilisation — failure-path observability. Populated by
   * `recordFailureContext` from the turn-executor's routing-error
   * branches so a debug bundle for a degraded turn carries enough
   * signal to diagnose the failure without leaking user content.
   *
   * `route_failure_type` is the routing-error cause name (e.g.
   * `unexpected_stop_reason`, `timeout`, `schema_repair_failed`).
   * `freshness_summary` carries the analysis-freshness verdicts the
   * orchestrator computed at ORIENT, when available.
   */
  readonly route_failure_type?: string;
  readonly freshness_summary?: TurnDebugFreshnessSummary;
  /**
   * Served prompts for this turn, in call-order. Undefined when nothing
   * recorded yet. Append via `recordPromptCapture`; like
   * `model_resolutions` it survives a later `storeTurnDebug` overwrite.
   */
  readonly prompt_captures?: readonly PromptCaptureRecord[];
}

/** Failure-context payload accepted by `recordFailureContext`. */
export interface TurnDebugFailureContext {
  readonly route_failure_type?: string;
  readonly freshness_summary?: TurnDebugFreshnessSummary;
}

/**
 * The all-zero CQE section used when a recorder must create an entry
 * before the CQE writer has run. One definition rather than a literal
 * per call site: a hand-copied twin here would drift the moment
 * `TurnDebugCqeSection` gains a field, and the drift would read green.
 */
function emptyCqeSection(): TurnDebugCqeSection {
  return {
    parsed_quantities: [],
    patterns_matched: [],
    timeout: false,
    degraded: false,
    compromise_match_count: 0,
    duration_ms: 0,
    message_too_long: false,
    word_range_missed: false,
  };
}

class TurnDebugStore {
  private readonly store = new Map<string, TurnDebugEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs = DEFAULT_TTL_MS, maxEntries = MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  set(entry: TurnDebugEntry): void {
    this.cleanup();
    const existing = this.store.get(entry.turn_id);
    if (!existing && this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    // Preserve append-style fields across overwrites. The CQE writer
    // typically runs before the resolution/failure recorders, but
    // order is not guaranteed (recordFailureContext and
    // recordModelResolution both create minimal entries when none
    // exists yet). Whichever order callers use, the union must
    // survive a subsequent storeTurnDebug overwrite.
    const merged: TurnDebugEntry = existing
      ? {
          ...entry,
          model_resolutions: entry.model_resolutions ?? existing.model_resolutions,
          route_failure_type:
            entry.route_failure_type ?? existing.route_failure_type,
          freshness_summary:
            entry.freshness_summary ?? existing.freshness_summary,
          prompt_captures: entry.prompt_captures ?? existing.prompt_captures,
        }
      : entry;
    this.store.set(entry.turn_id, merged);
  }

  appendFailureContext(
    turn_id: string,
    session_id: string,
    fields: TurnDebugFailureContext,
  ): void {
    this.cleanup();
    const existing = this.store.get(turn_id);
    if (existing) {
      this.store.set(turn_id, {
        ...existing,
        ...(fields.route_failure_type !== undefined
          ? { route_failure_type: fields.route_failure_type }
          : {}),
        ...(fields.freshness_summary !== undefined
          ? { freshness_summary: fields.freshness_summary }
          : {}),
      });
      return;
    }
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(turn_id, {
      turn_id,
      session_id,
      stored_at: Date.now(),
      cqe: emptyCqeSection(),
      ...(fields.route_failure_type !== undefined
        ? { route_failure_type: fields.route_failure_type }
        : {}),
      ...(fields.freshness_summary !== undefined
        ? { freshness_summary: fields.freshness_summary }
        : {}),
    });
  }

  appendModelResolution(
    turn_id: string,
    session_id: string,
    resolution: ModelResolutionRecord,
  ): void {
    this.cleanup();
    const existing = this.store.get(turn_id);
    if (existing) {
      const model_resolutions = [...(existing.model_resolutions ?? []), resolution];
      this.store.set(turn_id, { ...existing, model_resolutions });
      return;
    }
    // First write for this turn: create a minimal entry so the resolution
    // is persisted even if the CQE writer has not yet run. Enforce FIFO
    // eviction on new-key insertion.
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(turn_id, {
      turn_id,
      session_id,
      stored_at: Date.now(),
      cqe: emptyCqeSection(),
      model_resolutions: [resolution],
    });
  }

  appendPromptCapture(
    turn_id: string,
    session_id: string,
    capture: PromptCaptureRecord,
  ): void {
    this.cleanup();
    const existing = this.store.get(turn_id);
    if (existing) {
      const prompt_captures = [...(existing.prompt_captures ?? []), capture];
      this.store.set(turn_id, { ...existing, prompt_captures });
      return;
    }
    // First write for this turn. The prompt is resolved in the draft stage,
    // which runs BEFORE the turn-executor's CQE writer, so this is the
    // ordinary path rather than a defensive one — enforce FIFO eviction on
    // new-key insertion exactly as the sibling recorders do.
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(turn_id, {
      turn_id,
      session_id,
      stored_at: Date.now(),
      cqe: emptyCqeSection(),
      prompt_captures: [capture],
    });
  }

  /**
   * Retrieve a stored entry.
   * Returns undefined when not found or expired; returns 'expired' when an expired
   * entry was evicted (distinct from never-stored).
   */
  get(turn_id: string): TurnDebugEntry | undefined | 'expired' {
    const entry = this.store.get(turn_id);
    if (!entry) return undefined;
    if (Date.now() - entry.stored_at > this.ttlMs) {
      this.store.delete(turn_id);
      return 'expired';
    }
    return entry;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.stored_at > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

const turnDebugStore = new TurnDebugStore();

/**
 * Store a turn debug entry. No-op when CEE_TURN_DEBUG_ENABLED is false.
 */
export function storeTurnDebug(entry: TurnDebugEntry): void {
  if (!config.cee.turnDebugEnabled) return;
  turnDebugStore.set(entry);
}

/**
 * Append a per-LLM-call model resolution to the turn's debug entry.
 * No-op when CEE_TURN_DEBUG_ENABLED is false. Safe to call before the
 * CQE writer has run — a minimal entry is created if needed.
 */
export function recordModelResolution(
  turn_id: string,
  session_id: string,
  resolution: Omit<ModelResolutionRecord, 'timestamp'> & { timestamp?: number },
): void {
  if (!config.cee.turnDebugEnabled) return;
  const record: ModelResolutionRecord = {
    task: resolution.task,
    resolved_model: resolution.resolved_model,
    resolution_source: resolution.resolution_source,
    ...(resolution.provider !== undefined ? { provider: resolution.provider } : {}),
    timestamp: resolution.timestamp ?? Date.now(),
  };
  turnDebugStore.appendModelResolution(turn_id, session_id, record);
}

/**
 * Record failure-path context on the turn-debug entry (V5 P0 stabilisation).
 * No-op when CEE_TURN_DEBUG_ENABLED is false. Safe to call before the CQE
 * writer has run — a minimal entry is created if needed so the failure
 * record survives even when context-pack assembly itself failed.
 */
export function recordFailureContext(
  turn_id: string,
  session_id: string,
  fields: TurnDebugFailureContext,
): void {
  if (!config.cee.turnDebugEnabled) return;
  turnDebugStore.appendFailureContext(turn_id, session_id, fields);
}

/** Input to `recordPromptCapture`: the raw resolution, before shaping. */
export interface PromptCaptureInput {
  readonly task: string;
  /** Verbatim served system-prompt bytes, from `getSystemPromptSnapshot().content`. */
  readonly systemPrompt: string;
  /** `getSystemPromptSnapshot().meta`, i.e. the SAME resolution the bytes came from. */
  readonly meta: {
    readonly prompt_hash?: string;
    readonly prompt_version?: string;
    readonly promptId?: string;
    readonly version?: number;
    readonly source: 'store' | 'default';
    readonly isStaging?: boolean;
    readonly cache_status?: 'fresh' | 'stale' | 'expired' | 'miss';
    readonly instance_id?: string;
  };
  /** Model resolution for the call this prompt was sent on. */
  readonly resolution?: {
    readonly resolved_model?: string;
    readonly resolution_source?: string;
    readonly provider?: 'anthropic' | 'openai' | 'fixtures';
  };
  /**
   * The user's half of the turn. Passed so its SIZE and DIGEST can be
   * recorded; the text itself is hashed here and immediately dropped —
   * it is never stored, never returned and never logged.
   */
  readonly userContent?: string;
}

/**
 * Record the bytes and identity of a served prompt against a turn.
 * No-op when CEE_TURN_DEBUG_ENABLED is false, exactly like its siblings.
 *
 * ⛔ This function is the ONLY sanctioned carrier for served-prompt bytes.
 * Do not pass `systemPrompt` (or any value derived from it) to `log.*`,
 * Sentry, or a telemetry emitter. The store is in-memory, TTL-bounded and
 * never persisted; a log line is none of those things.
 */
export function recordPromptCapture(
  turn_id: string,
  session_id: string,
  input: PromptCaptureInput,
): void {
  if (!config.cee.turnDebugEnabled) return;

  const full = input.systemPrompt;
  // Hash the ORIGINAL bytes. Hashing after truncation would produce a
  // digest that matches nothing the model ever received, which is worse
  // than no digest: it looks like provenance and is not.
  const sha = createHash('sha256').update(full).digest('hex');
  const truncated = full.length > PROMPT_CAPTURE_MAX_CHARS;

  const capture: PromptCaptureRecord = {
    task: input.task,
    system_prompt: truncated ? full.slice(0, PROMPT_CAPTURE_MAX_CHARS) : full,
    system_prompt_chars: full.length,
    system_prompt_sha256: sha,
    truncated,
    prompt_hash: input.meta.prompt_hash,
    prompt_version: input.meta.prompt_version,
    prompt_id: input.meta.promptId,
    prompt_store_version: input.meta.version,
    prompt_source: input.meta.source,
    is_staging: input.meta.isStaging,
    cache_status: input.meta.cache_status,
    instance_id: input.meta.instance_id,
    resolved_model: input.resolution?.resolved_model,
    resolution_source: input.resolution?.resolution_source,
    provider: input.resolution?.provider,
    ...(input.userContent !== undefined
      ? {
          user_content_chars: input.userContent.length,
          user_content_sha256: createHash('sha256')
            .update(input.userContent)
            .digest('hex'),
        }
      : {}),
    captured_at: Date.now(),
  };

  turnDebugStore.appendPromptCapture(turn_id, session_id, capture);
}

/**
 * May captured prompt bytes ride the TURN RESPONSE on this deployment?
 *
 * Two conjuncts, and the second is not belt-and-braces. `CEE_OBSERVABILITY_RAW_IO`
 * — the estate's other raw-prompt flag — is declared with
 * `createEnvEnforcedBoolean`, so production forces it false whatever an
 * operator sets. `CEE_TURN_DEBUG_ENABLED` is a plain
 * `booleanString.default(false)` with NO such enforcement. That was
 * proportionate while the flag exposed CQE counters and a trace shape; it now
 * decides whether prompt BYTES leave the service, so the same env value
 * carries a larger consequence than it did when it was declared. Refuse in
 * prod here rather than trust that nobody ever sets it there.
 *
 * The ADMIN ROUTE is deliberately not gated on this: it is admin-key gated,
 * so an operator holding the key keeps full access in every environment. The
 * conjunct narrows the UNAUTHENTICATED surface only.
 */
export function promptCaptureMayRideTheWire(): boolean {
  return config.cee.turnDebugEnabled && getRuntimeEnv() !== 'prod';
}

/**
 * Read the prompt captures recorded for a turn. Returns an empty array
 * when the turn is unknown or expired, so a caller attaching this to a
 * response never has to distinguish "no captures" from "no turn" — both
 * mean there is nothing honest to show.
 */
export function getTurnDebugPromptCaptures(
  turn_id: string,
): readonly PromptCaptureRecord[] {
  const entry = turnDebugStore.get(turn_id);
  if (!entry || entry === 'expired') return [];
  return entry.prompt_captures ?? [];
}

/**
 * Retrieve a stored turn debug entry by turn_id.
 * Returns the entry, undefined (never stored), or 'expired' (stored but TTL elapsed).
 */
export function getTurnDebug(turn_id: string): TurnDebugEntry | undefined | 'expired' {
  return turnDebugStore.get(turn_id);
}

/** Get current store size (diagnostics). */
export function getTurnDebugStoreSize(): number {
  return turnDebugStore.size;
}

/** Clear all entries -- test use only. */
export function clearTurnDebugStore(): void {
  turnDebugStore.clear();
}
