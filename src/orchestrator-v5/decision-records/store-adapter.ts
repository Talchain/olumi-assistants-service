/**
 * Decision Records v1 (ROADMAP 3.1, CEE half) — Supabase store adapter
 * (service-role client).
 *
 * Mirrors the model-management adapter idiom (model-management/
 * store-adapter.ts, itself mirroring session/supabase-store.ts):
 * constructor-injected `SupabaseClient` (hand-rolled mocks in tests, no
 * live network), writes exclusively via the SECURITY DEFINER RPC, typed
 * error mapping on the migration's distinct SQLSTATEs.
 *
 * RPC: `create_decision_record` — migration
 * supabase/migrations/20260710113000_v5_decision_records.sql (#406,
 * MERGED but execution is Paul-gated — see the migration header). Until
 * the migration is executed the RPC does not exist on staging: this
 * adapter then surfaces the PostgREST "function not found" error as a
 * DecisionRecordStoreError, which the capture hook logs and swallows
 * (never silent data corruption, never a turn failure).
 *
 * Error mapping (distinct SQLSTATEs raised by the migration's RPCs):
 *   DR001 → DecisionRecordSignInRequiredError (guest refusal — the
 *           DESIGNED outcome for unowned scenarios, recoverable)
 *   else  → DecisionRecordStoreError
 * (DR404 / DR409 belong to `record_decision_outcome` — the write-once
 * outcome surface, a later slice; only `create_decision_record` is called
 * here.)
 *
 * Rows in decision_records are effectively immutable from this seam: this
 * adapter only creates records (idempotently by p_record_id — the RPC's
 * same-scenario replay branch returns the existing record with
 * `deduped: true`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  DecisionRecordAnalysisSummary,
  DecisionRecordConfidenceSourceLiteral,
} from '@talchain/schemas/boundary';

// ---------------------------------------------------------------------------
// Typed errors (adapter throws typed, callers map — session-store idiom).
// ---------------------------------------------------------------------------

export class DecisionRecordSignInRequiredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DecisionRecordSignInRequiredError';
  }
}

export class DecisionRecordStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DecisionRecordStoreError';
  }
}

// ---------------------------------------------------------------------------
// Inputs / outcomes.
// ---------------------------------------------------------------------------

/**
 * Write payload for `create_decision_record`. Sub-object shapes mirror
 * @talchain/schemas 0.16.0 DecisionRecordDecisionSchema /
 * DecisionRecordPredictionSchema VERBATIM (pass-through doctrine — the RPC
 * enforces the same key-set whitelists value-level; anything off-whitelist
 * is a 22023 refusal, so the builder in capture.ts validates before send).
 *
 * ⚠ 0.16.0 SEAM NOTE: the merged-but-UNEXECUTED migration
 * (supabase/migrations/20260710113000_v5_decision_records.sql) still guards
 * p_prediction against the 0.15.0 key-set {statement, confidence} — its
 * whitelist (and the dr_prediction_shape CHECK) must be amended in place
 * (the file's own documented pre-execution amendment flow) to admit
 * confidence_source / probability_of_goal / probability_of_joint_goal
 * BEFORE the Paul-gated execution, or every capture from this seam will be
 * 22023-refused wholesale once the RPC exists.
 */
export interface CreateDecisionRecordWrite {
  readonly scenario_id: string;
  readonly decision: {
    readonly chosen_option_id: string;
    readonly chosen_option_label: string;
    /** `aag_v1:sha256:`-prefixed CEE analysis-affecting graph hash — the
     *  agreed regime (seam memo PLATFORM-REPORT-2026-07-10-1 §2.1). NEVER
     *  PLoT's response_hash / hashGraph, NEVER graph_identity_hash. */
    readonly graph_hash: string;
    readonly analysis_summary?: DecisionRecordAnalysisSummary;
  };
  readonly prediction: {
    readonly statement: string;
    readonly confidence?: number;
    /** Provenance of the prediction's model-side values (0.16.0, calibration
     *  honesty §2 — the two populations are never blended). This seam only
     *  ever produces 'model_derived'; 'user_stated' belongs to a future
     *  elicitation lane. */
    readonly confidence_source?: DecisionRecordConfidenceSourceLiteral;
    /** Chosen option's P(single goal threshold met) — ISL via PLoT, recorded
     *  VERBATIM (D-N Option-B derisk; 0.16.0). Absent when no goal target
     *  existed at capture — never a fabricated 0. */
    readonly probability_of_goal?: number;
    /** Chosen option's P(ALL goal constraints jointly met) — ISL
     *  constraint_analysis.joint_probability via PLoT, recorded VERBATIM
     *  (D-N Option-B derisk; 0.16.0). Absent when unscored — never 0. */
    readonly probability_of_joint_goal?: number;
  };
  /** ISO timestamptz. */
  readonly review_date: string;
  /** Deterministic UUID (idempotency key — the RPC's replay branch dedupes). */
  readonly record_id: string;
  /** Deterministic journey-event id (idempotent by event_id in the RPC). */
  readonly event_id: string;
}

export interface DecisionRecordWriteOutcome {
  readonly record_id: string;
  /** true = p_record_id already existed; nothing was written. */
  readonly deduped: boolean;
  readonly event_id: string | null;
}

/** Store port — the capture hook depends on this interface, not the class,
 *  so tests inject hand-rolled fakes without a Supabase client. */
export interface DecisionRecordStorePort {
  createRecord(write: CreateDecisionRecordWrite): Promise<DecisionRecordWriteOutcome>;
}

// ---------------------------------------------------------------------------
// Implementation.
// ---------------------------------------------------------------------------

interface SupabaseErrorLike {
  message?: string;
  code?: string;
}

function errMsg(e: unknown): string {
  return (e as SupabaseErrorLike | null)?.message ?? String(e);
}

function errCode(e: unknown): string | undefined {
  return (e as SupabaseErrorLike | null)?.code ?? undefined;
}

export class SupabaseDecisionRecordStore implements DecisionRecordStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async createRecord(write: CreateDecisionRecordWrite): Promise<DecisionRecordWriteOutcome> {
    // PostgREST discipline (the 20260426160532 lesson, carried through the
    // MM adapter): the function name is distinct (no overloads exist), and
    // ALL named args are passed anyway as defence-in-depth against any
    // future overload reintroduction.
    const { data, error } = await this.client.rpc('create_decision_record', {
      p_scenario_id: write.scenario_id,
      p_decision: write.decision,
      p_prediction: write.prediction,
      p_review_date: write.review_date,
      p_record_id: write.record_id,
      p_event_id: write.event_id,
    });
    if (error) {
      throw mapRpcError('create_decision_record', error);
    }
    return parseWriteOutcome('create_decision_record', data);
  }
}

// ---------------------------------------------------------------------------
// Outcome parsing — content-level checks; degraded envelopes throw typed
// store errors (silent shape drift must not propagate).
// ---------------------------------------------------------------------------

function parseWriteOutcome(rpc: string, data: unknown): DecisionRecordWriteOutcome {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new DecisionRecordStoreError(
      `${rpc} returned non-object outcome: ${JSON.stringify(data)}`,
    );
  }
  const envelope = data as Record<string, unknown>;
  const record = envelope.record;
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new DecisionRecordStoreError(
      `${rpc} returned malformed outcome (no record object): ${JSON.stringify(data)}`,
    );
  }
  const recordId = (record as Record<string, unknown>).record_id;
  if (typeof recordId !== 'string' || recordId.length === 0) {
    throw new DecisionRecordStoreError(
      `${rpc} returned malformed outcome (no record.record_id): ${JSON.stringify(data)}`,
    );
  }
  return {
    record_id: recordId,
    deduped: envelope.deduped === true,
    event_id: typeof envelope.event_id === 'string' ? envelope.event_id : null,
  };
}

function mapRpcError(rpc: string, error: unknown): Error {
  const code = errCode(error);
  const message = `${rpc} RPC failed: ${errMsg(error)}`;
  if (code === 'DR001') {
    return new DecisionRecordSignInRequiredError(message, { cause: error });
  }
  return new DecisionRecordStoreError(message, { cause: error });
}
