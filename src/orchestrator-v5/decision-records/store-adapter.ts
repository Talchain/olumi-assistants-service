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

import { log } from '../../utils/telemetry.js';
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

// ---------------------------------------------------------------------------
// Read (ROADMAP 1.199, P6 — knowledge-over-time). The capture side is
// write-only; this is the bounded READ slice that lets prior DECISIONS (not
// just prior turns) reach the coach. A DIRECT service-role table SELECT, not an
// RPC (no read RPC exists, and adding one needs a Paul-gated migration).
// ---------------------------------------------------------------------------

/**
 * A read-projection of a stored decision record — only the fields the
 * knowledge-over-time projection needs (never the full row). `decision` /
 * `prediction` are the JSONB columns (DecisionRecordDecisionSchema /
 * DecisionRecordPredictionSchema shapes); read defensively as records.
 */
export interface DecisionRecordRead {
  readonly record_id: string;
  readonly scenario_id: string;
  /** ISO timestamptz — the capture time (provenance anchor for the projection). */
  readonly created_at: string;
  readonly decision: Record<string, unknown>;
  readonly prediction: Record<string, unknown>;
}

export interface RetrieveDecisionRecordsOpts {
  /** Max records to return (most-recent-first). Hard-capped by the adapter. */
  readonly limit?: number;
}

/**
 * One page of the scenario-scoped read: the rows the LIMIT actually returned,
 * PLUS how many rows exist behind that LIMIT.
 *
 * The page shape exists because returning a bare array made a whole class of
 * truth unrepresentable: with 9 records stored and a LIMIT of 8, the process
 * received 8 rows and had NO way to know a 9th existed, so every downstream
 * "how many decisions are on record" answer was derived from the post-cap
 * array and was FALSE (verified live on build `55c64ed`: the coach was asked
 * point-blank for the total, answered "8", and called the list "the full
 * record"). {@link totalCount} is the pre-cap ground truth that makes the
 * honest answer derivable.
 */
export interface DecisionRecordReadPage {
  /** The rows actually read — newest-first, at most the effective limit. */
  readonly records: readonly DecisionRecordRead[];
  /**
   * How many records EXIST for this scenario, independent of the LIMIT.
   * PostgREST's `Prefer: count=exact` total, which is computed after the
   * `scenario_id` filter and BEFORE the limit.
   */
  readonly totalCount: number;
}

/** Store port — the capture hook + the P6 read depend on this interface, not
 *  the class, so tests inject hand-rolled fakes without a Supabase client. */
export interface DecisionRecordStorePort {
  createRecord(write: CreateDecisionRecordWrite): Promise<DecisionRecordWriteOutcome>;
  /**
   * Read the most-recent decision records FOR ONE SCENARIO, newest-first.
   * MUST scope by scenario_id at the query — the service-role client bypasses
   * RLS, so the scenario filter is the ONLY thing preventing a cross-scenario /
   * cross-user read (P6 adversarial guard). Bounded by {@link DECISION_RECORDS_HARD_CAP}.
   *
   * Returns a {@link DecisionRecordReadPage}, never a bare array: a caller that
   * cannot see past the LIMIT cannot tell the user the truth about it.
   */
  retrieveRecords(
    scenarioId: string,
    opts?: RetrieveDecisionRecordsOpts,
  ): Promise<DecisionRecordReadPage>;
}

/**
 * Hard ceiling on records read into any projection — fits the 1800/3000-char
 * budgets comfortably and bounds the SELECT regardless of the caller's `limit`.
 */
export const DECISION_RECORDS_HARD_CAP = 8;

/** Columns the read projection needs — NEVER `owner_user_id` (not projected). */
const DECISION_RECORD_READ_COLUMNS = 'record_id, scenario_id, created_at, decision, prediction';

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Coerce one raw SELECT row into a typed read, or null when malformed. */
function parseReadRow(row: unknown): DecisionRecordRead | null {
  if (!isPlainObject(row)) return null;
  const { record_id, scenario_id, created_at, decision, prediction } = row;
  if (typeof record_id !== 'string' || record_id.length === 0) return null;
  if (typeof scenario_id !== 'string' || scenario_id.length === 0) return null;
  if (typeof created_at !== 'string' || created_at.length === 0) return null;
  if (!isPlainObject(decision) || !isPlainObject(prediction)) return null;
  return { record_id, scenario_id, created_at, decision, prediction };
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

  async retrieveRecords(
    scenarioId: string,
    opts?: RetrieveDecisionRecordsOpts,
  ): Promise<DecisionRecordReadPage> {
    const requested = opts?.limit;
    const limit =
      typeof requested === 'number' && Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), DECISION_RECORDS_HARD_CAP)
        : DECISION_RECORDS_HARD_CAP;
    // SCOPE AT THE BYTES (P6 adversarial guard): .eq('scenario_id', …) is the
    // ONLY thing between this service-role read and every other scenario's
    // records — the client bypasses RLS. Newest-first uses the existing
    // (scenario_id, created_at DESC) index. Never SELECT owner_user_id.
    //
    // `count: 'exact'` sends `Prefer: count=exact`; PostgREST answers with the
    // row total AFTER the scenario filter and BEFORE the LIMIT, in the
    // Content-Range header, without shipping the extra rows. Verified against
    // the live staging PostgREST on a 9-record scenario before this was
    // written: `…&order=created_at.desc&limit=8` + `Prefer: count=exact`
    // → `HTTP/2 206`, `content-range: 0-7/9` (eight rows, true total nine).
    // Cost is one COUNT over the same (scenario_id, created_at DESC) index the
    // SELECT already uses, on a per-scenario handful of rows.
    const { data, error, count } = await this.client
      .from('decision_records')
      .select(DECISION_RECORD_READ_COLUMNS, { count: 'exact' })
      .eq('scenario_id', scenarioId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      throw new DecisionRecordStoreError(
        `retrieveRecords for scenario ${scenarioId} failed: ${errMsg(error)}`,
        { cause: error },
      );
    }
    if (!Array.isArray(data)) return { records: [], totalCount: 0 };
    const out: DecisionRecordRead[] = [];
    for (const row of data) {
      const parsed = parseReadRow(row);
      // Defence-in-depth: a row whose scenario_id does not match the query
      // filter is impossible (the .eq is server-side), but re-assert here so a
      // future query change can never silently widen the scope.
      if (parsed !== null && parsed.scenario_id === scenarioId) out.push(parsed);
    }
    // The count is the ONLY pre-cap truth available; a missing one is not
    // routed around silently. Falling back to the row count reproduces exactly
    // the pre-fix behaviour (a cap drop would go undisclosed), so it WARNS —
    // an assume-good fallback here is the defect this whole change removes.
    let totalCount = out.length;
    if (typeof count === 'number' && Number.isFinite(count) && count >= out.length) {
      totalCount = count;
    } else if (count !== null && count !== undefined) {
      log.warn(
        {
          event: 'v5.decision_records.exact_count_unusable',
          scenario_id: scenarioId,
          count,
          rows: out.length,
        },
        'DecisionRecords — PostgREST returned an unusable exact count; falling back to the row count (a cap drop may go undisclosed on this turn)',
      );
    } else {
      log.warn(
        {
          event: 'v5.decision_records.exact_count_absent',
          scenario_id: scenarioId,
          rows: out.length,
        },
        'DecisionRecords — no exact count on the read; falling back to the row count (a cap drop may go undisclosed on this turn)',
      );
    }
    return { records: out, totalCount };
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
