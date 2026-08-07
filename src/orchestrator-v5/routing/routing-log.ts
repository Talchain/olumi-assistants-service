/**
 * V5 Phase 1b — Routing log (JSONL file append, PoC fallback).
 *
 * Spec §11: records per-turn routing decisions for offline evaluation.
 *
 *  - DOES NOT write to v5_handler_facts or any Supabase table. The fact
 *    contract is for handler execution facts; routing logs are a different
 *    concern with different quality requirements (§ brief Resolution F).
 *  - Appends to `logs/v5-routing-logs.jsonl` relative to CWD.
 *  - Privacy: when redacted === true, raw_user_message is null and
 *    sonnet_text_hash is a SHA-256 of the Sonnet text.
 *  - label_tier defaults to "unreviewed".
 *  - turn_id links back to v5_conversation_turns.
 *
 * Non-throwing: file append failures are logged to the telemetry sink and
 * swallowed. Routing log emission must never fail a turn.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { env } from 'node:process';

import { log } from '../../utils/telemetry.js';

import type { CoachingSignalId } from '../coaching/types.js';
import type { IntentClass, CoachingMode, ResolutionStatus } from './types.js';

/**
 * Graph-lookup outcome surfaced onto each routing-log row. Mirrors the
 * `outcome` field on the `turn_executor.graph_lookup` telemetry event so
 * analytics joins between the two streams are free.
 */
export type GraphLookupOutcome = 'no_graph' | 'ok' | 'all_dropped' | 'test_override';

export const DEFAULT_ROUTING_LOG_PATH = resolve(process.cwd(), 'logs', 'v5-routing-logs.jsonl');

export type LabelTier = 'unreviewed' | 'triaged' | 'reviewed' | 'gold';

export interface RoutingLogInput {
  readonly turn_id: string;
  readonly scenario_id: string;
  readonly stage: string;
  readonly intent_class: IntentClass | null;
  readonly handler_id: string | null;
  readonly coaching_mode: CoachingMode | null;
  readonly resolution_status: ResolutionStatus | null;
  readonly routing_error_cause: string | null;
  readonly validation_error_code: string | null;
  readonly compound_detected: boolean;
  readonly compound_pattern_matched: string | null;
  readonly raw_user_message: string;
  readonly sonnet_text: string;
  /** When true, raw_user_message is dropped and sonnet_text is hashed. */
  readonly redacted: boolean;
  readonly created_at: string;
  readonly label_tier?: LabelTier;
  /** Phase 1.5: graph signal counts from ContextPack.graph.counts. 0 on frame stage. */
  readonly graph_node_count: number;
  readonly graph_edge_count: number;
  /** Phase 1.5: deterministic graph hash (16 hex chars) or null when no graph. */
  readonly graph_hash: string | null;
  /**
   * Phase 1.5 review (Imp-2 + round 3 Imp-1): adapter drop stats and the
   * graph-lookup outcome, so drift triage and analytics work without
   * cross-referencing the telemetry stream. Count fields default to zero
   * (never null) so aggregation queries (AVG, SUM, percentile) don't need
   * COALESCE wrappers. `graph_lookup_outcome` is the canonical categorical
   * for per-turn grouping.
   */
  readonly graph_mapped_nodes: number;
  readonly graph_dropped_by_unknown_kind: number;
  readonly graph_dropped_by_missing_id: number;
  readonly graph_lookup_outcome: GraphLookupOutcome;
  /**
   * CQE (Custom Quantity Extractor — Layer 0) per-turn telemetry, mirrored
   * here from the assembler's CqeExtractionSummary for per-turn debugging
   * joins. The `cqe.extraction` event carries the same shape into Datadog.
   * All counts default to 0 so aggregation queries need no COALESCE wrapper.
   */
  readonly cqe_message_length: number;
  readonly cqe_result_count: number;
  readonly cqe_match_count: number;
  readonly cqe_compromise_match_count: number;
  readonly cqe_patterns_matched: readonly string[];
  readonly cqe_duration_ms: number;
  readonly cqe_timeout: boolean;
  /** True when a CQE pattern rule did not run to completion (see
   * CqeExtractionSummary.degraded) — the result set may hold a
   * lower-fidelity substitute value. Suppresses deterministic apply. */
  readonly cqe_degraded: boolean;
  readonly cqe_message_too_long: boolean;
  readonly cqe_word_range_missed: boolean;
  readonly cqe_ambiguous_phrasing_detected: boolean;
  /**
   * V5 Group 1 Task C: the coaching signal emitted by Step 5, if any.
   * Null on turns where no signal fired or where Step 5 did not run
   * (non-action intents skip Step 5). Persisted for offline evaluation of
   * coaching coverage and precision.
   */
  readonly coaching_signal_id: CoachingSignalId | null;
  /**
   * V5 product-state continuity (foamy-bee tranche) — observability for
   * the layered fix to the "what update did you make?" misroute class.
   * `recent_changes_count` is the count of curated mutation summaries
   * projected into the LLM-facing ContextPack on this turn (0..3, capped
   * by the projection budget). `prior_mutation_fact_count` is the
   * uncapped count of successful (non-noop) mutation facts across the
   * whole prior history — useful for distinguishing "long conversation
   * with several edits" from "fresh scenario". `state_query_guard_outcome`
   * records the pre-route outcome:
   *   - `'unmatched'`: guard pattern did not fire; turn proceeded to LLM
   *   - `'with_recent_change'`: matched, dispatched a deterministic
   *     direct_answer grounded in recent_changes
   *   - `'no_recent_changes'`: matched but no mutations to reference;
   *     dispatched the curated "I haven't applied any changes" reply
   *   - `'not_evaluated'`: pre-route never ran (e.g. an earlier
   *     pre-route already synthesised a routingResult)
   */
  readonly recent_changes_count: number;
  readonly prior_mutation_fact_count: number;
  readonly state_query_guard_outcome: StateQueryGuardOutcomeForLog;
}

export type StateQueryGuardOutcomeForLog =
  | 'unmatched'
  | 'with_recent_change'
  | 'no_recent_changes'
  | 'not_evaluated';

/**
 * PER-FIELD REDACTION POLICY — the single list both output branches
 * derive from (14-Jul PII ruling follow-through; kills the
 * hand-maintained-mirror defect class here).
 *
 * WHY: buildRoutingLog used to be two hand-maintained ~44-field
 * object literals whose redacted branch nulled exactly two enumerated
 * fields — so a NEW field defaulted to include-not-redact (fail-open)
 * unless its author remembered both literals. This policy inverts
 * that structurally:
 *
 *  - `satisfies Record<keyof RoutingLogInput, …>` makes an
 *    unclassified field a BUILD-TIME error (`tsc -p
 *    tsconfig.build.json`, the required gate): add a field to
 *    RoutingLogInput and the compile fails until you classify it
 *    here. Add a policy entry for a field the input doesn't declare
 *    and the compile also fails (excess key).
 *  - The output record is built ONLY by iterating this policy, so a
 *    field the policy doesn't know about structurally CANNOT reach
 *    the JSONL — at runtime an unknown key (only reachable via
 *    untyped spreads) throws in test envs and is dropped-with-warning
 *    in production (this call site sits in TurnExecutor's `finally`;
 *    a production throw here would eat the turn's real outcome).
 *
 * Classifications:
 *  - `structural`   — service metadata (ids, enums, counts, hashes,
 *                     timings); passes through both branches.
 *  - `content_null` — decision content; nulled when redacted.
 *  - `content_hash` — decision content; nulled when redacted with a
 *                     SHA-256 emitted as `<field>_hash`.
 *  - `control`      — consumed by buildRoutingLog itself
 *                     (`redacted`, `label_tier`).
 *
 * Content-classified fields must also be members of
 * DECISION_CONTENT_FIELDS (src/utils/logger-config.ts) so the pino
 * logger boundary covers the same names — enforced by test.
 */
export type RoutingLogFieldPolicy =
  | 'structural'
  | 'content_null'
  | 'content_hash'
  | 'control';

export const ROUTING_LOG_FIELD_POLICY = {
  turn_id: 'structural',
  scenario_id: 'structural',
  stage: 'structural',
  intent_class: 'structural',
  handler_id: 'structural',
  coaching_mode: 'structural',
  resolution_status: 'structural',
  routing_error_cause: 'structural',
  validation_error_code: 'structural',
  compound_detected: 'structural',
  compound_pattern_matched: 'structural',
  raw_user_message: 'content_null',
  sonnet_text: 'content_hash',
  redacted: 'control',
  created_at: 'structural',
  label_tier: 'control',
  graph_node_count: 'structural',
  graph_edge_count: 'structural',
  graph_hash: 'structural',
  graph_mapped_nodes: 'structural',
  graph_dropped_by_unknown_kind: 'structural',
  graph_dropped_by_missing_id: 'structural',
  graph_lookup_outcome: 'structural',
  cqe_message_length: 'structural',
  cqe_result_count: 'structural',
  cqe_match_count: 'structural',
  cqe_compromise_match_count: 'structural',
  cqe_patterns_matched: 'structural',
  cqe_duration_ms: 'structural',
  cqe_timeout: 'structural',
  cqe_degraded: 'structural',
  cqe_message_too_long: 'structural',
  cqe_word_range_missed: 'structural',
  cqe_ambiguous_phrasing_detected: 'structural',
  coaching_signal_id: 'structural',
  recent_changes_count: 'structural',
  prior_mutation_fact_count: 'structural',
  state_query_guard_outcome: 'structural',
} as const satisfies Record<keyof RoutingLogInput, RoutingLogFieldPolicy>;

type PolicyMap = typeof ROUTING_LOG_FIELD_POLICY;

/** Keys carrying a given policy — used to DERIVE the output type. */
type KeysWithPolicy<P extends RoutingLogFieldPolicy> = {
  [K in keyof PolicyMap]: PolicyMap[K] extends P ? K : never;
}[keyof PolicyMap];

/**
 * The routing-log output shape — DERIVED from the field policy, not
 * hand-declared, so the policy and the wire shape cannot drift:
 * structural fields keep their input type; content fields become
 * nullable; each content_hash field gains a `<field>_hash` sibling.
 */
export type RoutingLog = {
  readonly [K in KeysWithPolicy<'structural'>]: RoutingLogInput[K];
} & {
  readonly [K in KeysWithPolicy<'content_null' | 'content_hash'>]:
    | RoutingLogInput[K]
    | null;
} & {
  readonly [K in KeysWithPolicy<'content_hash'> as `${K & string}_hash`]:
    | string
    | null;
} & {
  readonly redacted: boolean;
  readonly label_tier: LabelTier;
};

function isTestEnv(): boolean {
  // Same direct-env test-detection shape as telemetry.ts setTestSink —
  // read at call time (not module load) so tests can exercise the
  // production drop path by clearing these for one call.
  return env.NODE_ENV === 'test' || Boolean(env.VITEST);
}

/**
 * Build a routing log record. Applies redaction + defaults. Pure — no I/O.
 *
 * The output is assembled ONLY from ROUTING_LOG_FIELD_POLICY entries;
 * see the policy's header for the fail-loud contract on unknown fields.
 */
export function buildRoutingLog(input: RoutingLogInput): RoutingLog {
  // FAIL-LOUD SEAM: a field with no policy entry can only appear at
  // runtime through an untyped spread (typed call sites are caught at
  // compile time by the `satisfies` clause above). Tests die on it;
  // production drops it with a warning — never silent passthrough.
  const unknownFields = Object.keys(input).filter(
    (k) => !Object.prototype.hasOwnProperty.call(ROUTING_LOG_FIELD_POLICY, k),
  );
  if (unknownFields.length > 0) {
    const detail = `routing-log: field(s) without a redaction policy: ${unknownFields.join(
      ', ',
    )} — classify them in ROUTING_LOG_FIELD_POLICY (structural | content_null | content_hash)`;
    if (isTestEnv()) {
      throw new Error(detail);
    }
    // Field NAMES are code-authored identifiers, never user content.
    log.warn(
      { unknown_fields: unknownFields },
      'routing-log: fields without a redaction policy were DROPPED',
    );
  }

  const redacted = input.redacted;
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(ROUTING_LOG_FIELD_POLICY) as Array<
    keyof PolicyMap
  >) {
    const policy: RoutingLogFieldPolicy = ROUTING_LOG_FIELD_POLICY[field];
    switch (policy) {
      case 'structural':
        out[field] = input[field];
        break;
      case 'content_null':
        out[field] = redacted ? null : input[field];
        break;
      case 'content_hash':
        out[field] = redacted ? null : input[field];
        out[`${field}_hash`] = redacted ? sha256(String(input[field])) : null;
        break;
      case 'control':
        // Emitted at the policy's position to keep JSONL key order stable.
        if (field === 'redacted') out.redacted = redacted;
        if (field === 'label_tier') out.label_tier = input.label_tier ?? 'unreviewed';
        break;
    }
  }
  return out as RoutingLog;
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Append a routing log to the JSONL file. Swallows I/O errors (logs a
 * warning via the telemetry sink). Never throws.
 */
export async function writeRoutingLog(
  record: RoutingLog,
  filePath: string = DEFAULT_ROUTING_LOG_PATH,
): Promise<void> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    log.warn(
      {
        request_id: record.turn_id,
        file_path: filePath,
        err: err instanceof Error ? err.message : String(err),
      },
      'V5 routing log append failed — swallowed',
    );
  }
}
