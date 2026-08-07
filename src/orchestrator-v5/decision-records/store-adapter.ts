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
 * RPCs: `create_decision_record` + `record_decision_outcome` — migration
 * supabase/migrations/20260710113000_v5_decision_records.sql (#406).
 * ⚠ CORRECTED (calibration R0, reconcile R7): this header used to say
 * execution was "Paul-gated … until the migration is executed the RPC does
 * not exist on staging". FALSE at the current tip — the migration header
 * reads "✅ EXECUTED ON STAGING" (`…decision_records.sql:5-14`) and the
 * 2026-07-12 amendment widened both key whitelists (`:26-34,446-467`). A
 * stale warning teaches the next lane to route around a hazard that is gone
 * (CLAUDE.md trap 7b).
 *
 * Error mapping (distinct SQLSTATEs raised by the migration's RPCs):
 *   DR001 → DecisionRecordSignInRequiredError (guest refusal — the
 *           DESIGNED outcome for unowned scenarios, recoverable)
 *   DR404 → DecisionRecordNotFoundError      (record_decision_outcome)
 *   DR409 → DecisionRecordOutcomeConflictError (write-once violation;
 *           an IDENTICAL-payload retry is deduped by the RPC, not errored)
 *   else  → DecisionRecordStoreError
 *
 * Rows in decision_records are append-then-fill: this adapter creates
 * records (idempotently by p_record_id — the RPC's same-scenario replay
 * branch returns the existing record with `deduped: true`) and fills the
 * WRITE-ONCE `outcome` exactly once (DR409 on any conflicting rewrite).
 * Nothing here can rewrite a decision or a prediction.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { log } from '../../utils/telemetry.js';
import type {
  DecisionRecordAnalysisSummary,
  DecisionRecordConfidenceSourceLiteral,
  DecisionRecordOutcomeResultLiteral,
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

/** SQLSTATE DR404 — `record_decision_outcome` on a record that does not exist. */
export class DecisionRecordNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DecisionRecordNotFoundError';
  }
}

/**
 * SQLSTATE DR409 — the outcome is WRITE-ONCE and a CONFLICTING rewrite was
 * attempted. An identical-payload retry never reaches here: the RPC returns
 * the existing record with `deduped: true` (…decision_records.sql:726-746).
 */
export class DecisionRecordOutcomeConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DecisionRecordOutcomeConflictError';
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
 * ⚠ THE 0.16.0 SEAM NOTE THAT USED TO SIT HERE IS DELETED (calibration R0,
 * reconcile R7). It warned that the "merged-but-UNEXECUTED" migration still
 * guarded `p_prediction` against the 0.15.0 key-set `{statement, confidence}`
 * and had to be amended before execution. BOTH HALVES ARE FALSE at the
 * current tip: the migration is executed (`…decision_records.sql:5-14`) and
 * its whitelists already admit `committed_by_user`, `confidence_source`,
 * `probability_of_goal` and `probability_of_joint_goal` (`:26-34,422-424,
 * 446-467`) — verified at the bytes, not inherited.
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
    /** true when the record was created by an explicit "record the decision"
     *  action (0.16.0). Absent on ambient auto-capture — a disclosed
     *  inference, never a fabricated `false`. Live on the RPC whitelist
     *  (`…decision_records.sql:422-424`). */
    readonly committed_by_user?: boolean;
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

/**
 * Write payload for `record_decision_outcome`'s `p_outcome`. Mirrors
 * `DecisionRecordOutcomeSchema` VERBATIM, and the RPC's key whitelist is
 * CLOSED at exactly these four keys (`…decision_records.sql:672`) — an
 * off-whitelist key is a 22023 refusal of the WHOLE outcome.
 *
 * `brier_component` is OMITTED, never null and never 0, when the record
 * cannot be scored (no confidence on the prediction, or `abandoned`). See
 * scoring.ts for why a stored 0 would be a fabrication.
 */
export interface RecordDecisionOutcomeWrite {
  readonly record_id: string;
  readonly outcome: {
    /** ISO offset datetime — the contract's `.datetime({offset:true})`. */
    readonly recorded_at: string;
    readonly result: DecisionRecordOutcomeResultLiteral;
    readonly notes?: string;
    readonly brier_component?: number;
  };
  /** Deterministic journey-event id (idempotent by event_id in the RPC). */
  readonly event_id: string;
}

/**
 * What the outcome path needs to know about a record BEFORE writing: who owns
 * it, and what confidence (if any) the prediction staked.
 *
 * ⭐ READ FROM `decision_records`, NEVER FROM THE EVENT JOURNAL. Records
 * OUTLIVE scenarios by design (no FK — the migration's own comment,
 * `…decision_records.sql:697,753-754`), and `record_decision_outcome`
 * DELIBERATELY SKIPS the journey event when the scenario has been deleted
 * (`:753-757`). A scoring path built over `scenarios.events` would therefore
 * silently lose exactly the records whose scenarios were deleted, while a
 * read over this table keeps them. The two sources disagree BY CONSTRUCTION;
 * `decision_records` is the scoring source of truth and the journal is
 * provenance only.
 */
export interface DecisionRecordOwnerRead {
  readonly record_id: string;
  readonly owner_user_id: string | null;
  /** `prediction.confidence` when present, finite and in [0,1]; else undefined. */
  readonly confidence: number | undefined;
  /** true when an outcome has already been written (write-once). */
  readonly hasOutcome: boolean;
}

/**
 * The analysis anchor a USER COMMIT is recorded against: the `graph_hash_at_run`
 * of the scenario's newest non-noop `run_analysis` fact, plus when it was
 * computed. Derived SERVER-side — never supplied by a caller (see
 * user-commit.ts's anchor note).
 */
export interface AnalysisAnchorRead {
  /** UNPREFIXED — the builder applies `aag_v1:sha256:`. */
  readonly graphHashAtRun: string;
  readonly computedAt: string | null;
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

  /**
   * Fill a record's WRITE-ONCE outcome. Throws
   * {@link DecisionRecordNotFoundError} (DR404) and
   * {@link DecisionRecordOutcomeConflictError} (DR409) as typed errors; an
   * identical-payload retry returns `deduped: true` rather than throwing.
   */
  recordOutcome(write: RecordDecisionOutcomeWrite): Promise<DecisionRecordWriteOutcome>;

  /**
   * `scenarios.user_id` for one scenario — NULL for a guest scenario, and
   * `undefined` when no such scenario exists. This is the exact identity the
   * RPC derives `owner_user_id` from, so an ownership check against it cannot
   * drift from the RPC's own answer.
   */
  readScenarioOwner(scenarioId: string): Promise<string | null | undefined>;

  /** Owner + staked confidence for one record, or null when absent. */
  readRecordForOutcome(recordId: string): Promise<DecisionRecordOwnerRead | null>;

  /**
   * The scenario's newest non-noop `run_analysis` fact, reduced to the
   * analysis anchor. `null` when the scenario has never completed an
   * analysis — a commit then has nothing to anchor to and is refused rather
   * than anchored to a fabricated hash.
   */
  readNewestAnalysisAnchor(scenarioId: string): Promise<AnalysisAnchorRead | null>;
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

  async recordOutcome(write: RecordDecisionOutcomeWrite): Promise<DecisionRecordWriteOutcome> {
    // Same PostgREST discipline as createRecord: distinct function name, all
    // named args passed explicitly.
    const { data, error } = await this.client.rpc('record_decision_outcome', {
      p_record_id: write.record_id,
      p_outcome: write.outcome,
      p_event_id: write.event_id,
    });
    if (error) {
      throw mapRpcError('record_decision_outcome', error);
    }
    return parseWriteOutcome('record_decision_outcome', data);
  }

  async readScenarioOwner(scenarioId: string): Promise<string | null | undefined> {
    const { data, error } = await this.client
      .from('scenarios')
      .select('user_id')
      .eq('id', scenarioId)
      .limit(1);
    if (error) {
      throw new DecisionRecordStoreError(
        `readScenarioOwner(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error },
      );
    }
    const rows = (data ?? []) as Array<{ user_id?: unknown }>;
    const row = rows[0];
    // THREE distinct answers, never conflated: absent scenario (undefined),
    // guest scenario (null), owned scenario (the uuid). Collapsing the first
    // two would turn "there is no such scenario" into "sign in", which is a
    // different — and wrong — thing to tell a signed-in user.
    if (!row) return undefined;
    return typeof row.user_id === 'string' && row.user_id.length > 0 ? row.user_id : null;
  }

  async readRecordForOutcome(recordId: string): Promise<DecisionRecordOwnerRead | null> {
    const { data, error } = await this.client
      .from('decision_records')
      .select('record_id, owner_user_id, prediction, outcome')
      .eq('record_id', recordId)
      .limit(1);
    if (error) {
      throw new DecisionRecordStoreError(
        `readRecordForOutcome(${recordId}) failed: ${errMsg(error)}`,
        { cause: error },
      );
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    if (typeof row.record_id !== 'string' || row.record_id.length === 0) return null;
    const prediction = isPlainObject(row.prediction) ? row.prediction : {};
    const rawConfidence = prediction.confidence;
    // The SAME usability bound the contract and the RPC enforce ([0,1],
    // finite). An unusable stored value yields undefined — the outcome then
    // records UNSCORED rather than scoring a number nothing can justify.
    const confidence =
      typeof rawConfidence === 'number' &&
      Number.isFinite(rawConfidence) &&
      rawConfidence >= 0 &&
      rawConfidence <= 1
        ? rawConfidence
        : undefined;
    return {
      record_id: row.record_id,
      owner_user_id:
        typeof row.owner_user_id === 'string' && row.owner_user_id.length > 0
          ? row.owner_user_id
          : null,
      confidence,
      hasOutcome: row.outcome !== null && row.outcome !== undefined,
    };
  }

  async readNewestAnalysisAnchor(scenarioId: string): Promise<AnalysisAnchorRead | null> {
    // SCOPE AT THE BYTES: `.eq('scenario_id', …)` is the only thing between
    // this service-role read and every other scenario's facts — the client
    // bypasses RLS. Index: (scenario_id, handler_id, created_at DESC)
    // = v5_handler_facts_scenario_handler_idx (migration 20260417160000), so
    // the ORDER BY … LIMIT 1 is a single index descent.
    //
    // `handler_id` + the real `noop` COLUMN, never a JSONB path: the same
    // filter shape the session store's own newest-analysis read uses.
    const { data, error } = await this.client
      .from('v5_handler_facts')
      .select('payload')
      .eq('scenario_id', scenarioId)
      .eq('handler_id', 'run_analysis')
      .eq('noop', false)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      // THROWS, never returns null: "this scenario has no analysis" and "I
      // could not look" are exactly the two states a commit must not
      // conflate — the second would anchor nothing and refuse a legitimate
      // decision, or worse, invite a fabricated anchor.
      throw new DecisionRecordStoreError(
        `readNewestAnalysisAnchor(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error },
      );
    }
    const rows = (data ?? []) as Array<{ payload?: unknown }>;
    const payload = rows[0]?.payload;
    if (!isPlainObject(payload)) return null;
    const result = payload.result;
    if (!isPlainObject(result)) return null;
    const hashAtRun = result.graph_hash_at_run;
    if (typeof hashAtRun !== 'string' || hashAtRun.length === 0) return null;
    return {
      graphHashAtRun: hashAtRun,
      computedAt: typeof result.computed_at === 'string' ? result.computed_at : null,
    };
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
  if (code === 'DR404') {
    return new DecisionRecordNotFoundError(message, { cause: error });
  }
  if (code === 'DR409') {
    return new DecisionRecordOutcomeConflictError(message, { cause: error });
  }
  return new DecisionRecordStoreError(message, { cause: error });
}
