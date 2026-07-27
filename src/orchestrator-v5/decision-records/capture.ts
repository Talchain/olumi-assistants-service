/**
 * Decision Records v1 (ROADMAP 3.1, CEE half) — commit-seam capture.
 *
 * Two layers:
 *   1. `buildDecisionRecordWrite` — PURE projection of a successful
 *      run_analysis HandlerFact into the exact `create_decision_record`
 *      payload (or a typed skip). No I/O, no clock reads (review_date
 *      derives from the fact's own computed_at), fully unit-testable.
 *   2. `recordDecisionRecordForCommit` — the fire-and-forget hook invoked
 *      from commit.ts AFTER the durable append succeeded, whenever the
 *      commit carries a successful (non-noop) run_analysis fact
 *      (UNCONDITIONAL since #539 deleted CEE_DECISION_RECORD_CAPTURE —
 *      Paul's 19 Jul no-dark-launch ruling). Non-blocking contract
 *      (mirrors the MM commit-seam hook verbatim): every failure — guest
 *      pre-check read, store construction (missing SUPABASE_* env), RPC
 *      error, telemetry fault — is caught and logged; NOTHING propagates
 *      to the turn result.
 *
 * Binding seam rulings (PLATFORM-REPORT-2026-07-10-1, ratified):
 *   - graph_hash regime: `aag_v1:sha256:` + CEE's
 *     computeAnalysisAffectingGraphHash output. The hook does NOT recompute
 *     it — it prefixes the fact's own `graph_hash_at_run`, which the
 *     run_analysis handler computed from the EXACT snapshot the analysis
 *     ran against (PR #411 object-identity discipline: the snapshot the
 *     handler hashed, never a re-read). Same function at capture and
 *     review time, same codebase — the only skew-free option.
 *   - analysis_summary: copied from PLoT's `decision_brief.analysis_summary`
 *     OPTIONAL-FORWARD. PLoT only emits it behind its own flag
 *     (BRIEF_DECISION_RECORD_SUMMARY_ENABLE, default off), so ABSENT is the
 *     normal case today and the record is valid without it by design.
 *     Present-but-malformed is dropped (disclosed via debug log +
 *     `analysisSummaryDropped`), never forwarded into a DB 22023 refusal.
 *   - Guest scenarios are refused by the RPC with DR001 BY DESIGN; the hook
 *     short-circuits BEFORE the RPC via the scenario-owner pre-check (the
 *     MM guest pre-check pattern, commit.ts — seam memo §2.4; the turn
 *     context carries no user identity field, and scenarios.user_id is the
 *     exact identity the RPC derives owner_user_id from). Log-only, never
 *     an event per guest turn (the MM WARN-spam lesson).
 *   - Outcome writes (record_decision_outcome) are OUT OF SCOPE — a later
 *     surface. Only create_decision_record is called here.
 *   - 0.16.0 addendum (D-N Option-B derisk, ruled 2026-07-11): the chosen
 *     option's `probability_of_goal` + `probability_of_joint_goal` are
 *     captured VERBATIM onto prediction (both, from day one — a Neil
 *     overrule is then a recompute, never lost data), and
 *     `confidence_source: 'model_derived'` is stamped on every write
 *     (this seam has no user-stated path; calibration honesty §2).
 *     Absent/unusable values stay ABSENT — never 0. This lane was blocked
 *     under 0.15.0 (.strict() hard-rejected the fields at every layer —
 *     HANDOVER.md ~02:45 wave entry, 2026-07-11) and unblocked by the
 *     0.16.0 vendor bump in this same PR. ⚠ The merged-but-unexecuted
 *     migration still whitelists the 0.15.0 prediction key-set — see the
 *     SEAM NOTE on CreateDecisionRecordWrite (store-adapter.ts).
 *
 * Idempotency: record_id is a deterministic UUID over
 * (scenario_id, decision.graph_hash, computed_at), so a retried turn
 * replays through the RPC's same-scenario dedupe branch instead of writing
 * a duplicate. event_id = `decision_recorded_<record_id>` — deterministic,
 * and identical to the id the RPC would mint itself (passed explicitly for
 * parity with the MM hook's caller-supplied idempotency key).
 */

import { createHash } from 'node:crypto';

import { DecisionRecordAnalysisSummarySchema } from '@talchain/schemas/boundary';
import type { DecisionRecordAnalysisSummary } from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { readMayNameLeadingOptionVerdictForFact } from '../context/claim-safety-read.js';
import type { MayNameLeadingOptionVerdict } from '../context/claim-safety-read.js';
import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { getDecisionRecordStore } from './index.js';
import { DecisionRecordSignInRequiredError } from './store-adapter.js';
import type { CreateDecisionRecordWrite } from './store-adapter.js';

/** Versioned regime prefix for decision.graph_hash — binding on producer
 *  AND reviewer (migration header + seam memo §2.1). The in-value prefix
 *  exists because DecisionRecordDecisionSchema is .strict() (no sibling
 *  version fields possible). */
export const AAG_V1_GRAPH_HASH_PREFIX = 'aag_v1:sha256:';

/** Review-date horizon. BRIEF-C derivation rules: explicit user date >
 *  decision-horizon heuristic > 90-day default — no elicitation surface
 *  exists in this slice, so the labelled 90-day default applies.
 *  Deterministic from the fact's computed_at (no clock read), which keeps
 *  the whole write payload — and therefore the retry replay — stable. */
export const DECISION_RECORD_REVIEW_HORIZON_DAYS = 90;

const REVIEW_HORIZON_MS = DECISION_RECORD_REVIEW_HORIZON_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Deterministic ids.
// ---------------------------------------------------------------------------

/**
 * Deterministic UUID over (scenario_id, graph_hash, computed_at): SHA-256 of
 * the length-delimited tuple, truncated to 128 bits with RFC 4122 version-5
 * and variant bits stamped (name-based-style — deterministic by design, so a
 * retried turn carries the SAME p_record_id and the RPC's replay branch
 * dedupes instead of duplicating).
 */
export function deriveDecisionRecordId(
  scenarioId: string,
  graphHash: string,
  computedAt: string,
): string {
  const digest = createHash('sha256')
    .update(`cee:decision_record:v1\n${scenarioId}\n${graphHash}\n${computedAt}`)
    .digest();
  const bytes = digest.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version nibble → 5 (name-based)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Pure payload builder.
// ---------------------------------------------------------------------------

export type DecisionRecordSkipReason =
  | 'noop_fact'
  | 'missing_graph_hash'
  | 'missing_computed_at'
  | 'no_leading_option'
  | 'no_option_label'
  | 'empty_summary';

export type BuiltDecisionRecord =
  | {
      readonly kind: 'write';
      readonly write: CreateDecisionRecordWrite;
      /** true when PLoT sent a decision_brief.analysis_summary that failed
       *  the strict contract parse and was dropped (disclosed, not fatal). */
      readonly analysisSummaryDropped: boolean;
    }
  | { readonly kind: 'skip'; readonly reason: DecisionRecordSkipReason };

function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Read the per-option comparison records from the fact's enrichment.
 * Mirrors run-analysis.ts `readResultRecords` (PLoT's real wire key is
 * `option_comparison[]`; `results[]` is the defensive fallback) WITHOUT
 * importing the handler module — the commit seam must not pick up the
 * handler/PLoT-client import chain.
 */
function readComparisonRecords(
  enrichment: Record<string, unknown> | undefined,
): ReadonlyArray<Record<string, unknown>> {
  if (enrichment === undefined) return [];
  for (const key of ['option_comparison', 'results'] as const) {
    const raw = enrichment[key];
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.filter(isPlainRecord);
    }
  }
  return [];
}

/**
 * A probability value is USABLE only when it is a finite number in [0,1]
 * (the RPC's value-level guard and the 0.16.0 schema range). Anything else
 * — absent, non-number, non-finite, out of range — yields undefined: the
 * field is then OMITTED from the write, never clamped, defaulted, or zeroed
 * (a fabricated value would be scored; absence is honest).
 */
function usableUnitInterval(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1
    ? raw
    : undefined;
}

/** Mirrors run-analysis.ts `extractOptionId`: option_id first, label fallback. */
function comparisonRecordOptionId(record: Record<string, unknown>): string | null {
  if (typeof record.option_id === 'string' && record.option_id.length > 0) {
    return record.option_id;
  }
  if (typeof record.option_label === 'string' && record.option_label.length > 0) {
    return record.option_label;
  }
  return null;
}

/**
 * Project a successful run_analysis fact into the create_decision_record
 * write, or a typed skip when the fact carries no recordable decision.
 * Pure — no I/O, no clock, no env.
 */
export function buildDecisionRecordWrite(
  fact: RunAnalysisHandlerFact,
  scenarioId: string,
): BuiltDecisionRecord {
  if (fact.noop) return { kind: 'skip', reason: 'noop_fact' };

  const hashAtRun = fact.result.graph_hash_at_run;
  if (typeof hashAtRun !== 'string' || hashAtRun.length === 0) {
    // Empty graph at run time (the handler omits the field) — nothing a
    // reviewer could re-hash against; no record.
    return { kind: 'skip', reason: 'missing_graph_hash' };
  }

  const computedAt = fact.result.computed_at;
  if (typeof computedAt !== 'string') {
    return { kind: 'skip', reason: 'missing_computed_at' };
  }
  const computedAtMs = Date.parse(computedAt);
  if (!Number.isFinite(computedAtMs)) {
    return { kind: 'skip', reason: 'missing_computed_at' };
  }

  const leadingOptionId = fact.result.leading_option_id;
  if (typeof leadingOptionId !== 'string' || leadingOptionId.length === 0) {
    // No unambiguous leader (tie / missing probabilities) — there is no
    // "chosen option" to record. Designed skip, not a fault.
    return { kind: 'skip', reason: 'no_leading_option' };
  }

  const records = readComparisonRecords(fact.result.enrichment);
  const leadingRecord =
    records.find((r) => comparisonRecordOptionId(r) === leadingOptionId) ?? null;
  if (leadingRecord === null) {
    return { kind: 'skip', reason: 'no_option_label' };
  }
  const label =
    typeof leadingRecord.option_label === 'string' && leadingRecord.option_label.length > 0
      ? leadingRecord.option_label
      : null;
  if (label === null) {
    // Never id-as-label (§0.1 doctrine): a record whose chosen_option_label
    // is a raw node id would poison the long-horizon review surface.
    return { kind: 'skip', reason: 'no_option_label' };
  }

  const statement = fact.result.summary.trim();
  if (statement.length === 0) {
    return { kind: 'skip', reason: 'empty_summary' };
  }

  // Leader's win probability as prediction.confidence — only when usable
  // under the RPC's value-level guard (number in [0,1]).
  const usableConfidence = usableUnitInterval(leadingRecord.win_probability);

  // D-N Option-B scoring derisk (0.16.0 addendum, ruled 2026-07-11): BOTH
  // of the chosen option's goal-attainment probabilities, recorded VERBATIM
  // from the same comparison record the leader was resolved from —
  // `probability_of_goal` (ISL per-option: P(single goal threshold met))
  // and `probability_of_joint_goal` (ISL constraint_analysis.joint_probability
  // via PLoT: P(ALL constraints jointly met)). Capturing both from day one
  // makes a Neil overrule a recompute, never lost data. Each is independent
  // and optional-forward: absent/unusable values stay ABSENT (never 0 —
  // a fabricated probability would poison Brier scoring, ROADMAP 3.2).
  const probabilityOfGoal = usableUnitInterval(leadingRecord.probability_of_goal);
  const probabilityOfJointGoal = usableUnitInterval(leadingRecord.probability_of_joint_goal);

  // Optional-forward analysis_summary: strict contract parse before send —
  // an off-whitelist key or out-of-range value would otherwise fail the
  // WHOLE record at the RPC (22023). Drop-and-disclose, never block.
  let analysisSummary: DecisionRecordAnalysisSummary | undefined;
  let analysisSummaryDropped = false;
  const decisionBrief = fact.result.enrichment?.decision_brief;
  if (isPlainRecord(decisionBrief) && decisionBrief.analysis_summary !== undefined) {
    const parsed = DecisionRecordAnalysisSummarySchema.safeParse(decisionBrief.analysis_summary);
    if (parsed.success) {
      analysisSummary = parsed.data;
    } else {
      analysisSummaryDropped = true;
    }
  }

  const graphHash = `${AAG_V1_GRAPH_HASH_PREFIX}${hashAtRun}`;
  const recordId = deriveDecisionRecordId(scenarioId, graphHash, computedAt);

  return {
    kind: 'write',
    write: {
      scenario_id: scenarioId,
      decision: {
        chosen_option_id: leadingOptionId,
        chosen_option_label: label,
        graph_hash: graphHash,
        ...(analysisSummary !== undefined ? { analysis_summary: analysisSummary } : {}),
      },
      prediction: {
        statement,
        ...(usableConfidence !== undefined ? { confidence: usableConfidence } : {}),
        // Every value this seam can place on prediction is model-derived
        // (deterministic summary, leader win_probability, ISL goal
        // probabilities) — stamped explicitly on EVERY write so provenance
        // lives on the record itself rather than leaning on the schema's
        // absent⇒model_derived disclosed inference. 'user_stated' belongs
        // to a future elicitation lane; it is unreachable from this seam
        // (calibration honesty §2: the two populations are never blended).
        confidence_source: 'model_derived',
        ...(probabilityOfGoal !== undefined
          ? { probability_of_goal: probabilityOfGoal }
          : {}),
        ...(probabilityOfJointGoal !== undefined
          ? { probability_of_joint_goal: probabilityOfJointGoal }
          : {}),
      },
      review_date: new Date(computedAtMs + REVIEW_HORIZON_MS).toISOString(),
      record_id: recordId,
      // Matches the id the RPC's own COALESCE default would mint — passed
      // explicitly for parity with the MM hook's deterministic event_id.
      event_id: `decision_recorded_${recordId}`,
    },
    analysisSummaryDropped,
  };
}

// ---------------------------------------------------------------------------
// Fire-and-forget commit-seam hook.
// ---------------------------------------------------------------------------

/**
 * Minimal structural slice of SessionStore used by the guest pre-check.
 * Declared locally (not imported from session/store.js) so the state-write
 * invariant guard's SessionStore import surface stays exactly
 * {session/, commit.ts, build-turn-context.ts}; commit.ts — a sanctioned
 * importer — passes its store, which satisfies this structurally.
 */
export interface ScenarioOwnerReader {
  getScenarioOwner?(scenarioId: string): Promise<string | null>;
}

export interface RecordDecisionRecordArgs {
  readonly scenarioId: string;
  readonly turnId: string;
  readonly persistedRowId: string;
  readonly fact: RunAnalysisHandlerFact;
  readonly sessionStore: ScenarioOwnerReader;
}

/**
 * Capture one decision record after a successful run_analysis commit.
 * Fire-and-forget: callers `void` the promise; every failure is logged and
 * swallowed — the turn result is NEVER affected and no error can surface
 * to any user (guest or owner).
 */
export async function recordDecisionRecordForCommit(
  args: RecordDecisionRecordArgs,
): Promise<void> {
  // ⭐ THE CLAIM VERDICT, STAMPED AT CAPTURE — read from the SAME fact the
  // record is projected from, at the one moment we still hold it.
  //
  // A decision record asserts `chosen_option_label` — a leading-option claim —
  // and the constraint verdict on that very fact decides whether the turn was
  // ENTITLED to name a leader. A record captured from a WITHHELD fact is a
  // claim the turn itself refused to make, and nothing on the record said so.
  // At review time the fact is long gone and the verdict is not re-derivable,
  // so it is taken here or not at all.
  //
  // READ, never re-derived (CLAUDE.md trap #12): the shared per-fact reader is
  // the one the turn-executor and the withheld-claim projection already use,
  // so a third caller cannot walk a different ladder on the same fact.
  //
  // ⚠ WHY THE TELEMETRY EVENT AND NOT `write.prediction` — this is a REPORTED
  // SUBSTITUTION, not the shape originally asked for. A new key on the
  // persisted `prediction` is a THREE-hop contract change, and CEE owns only
  // the middle hop:
  //   1. `@talchain/schemas` `DecisionRecordPredictionSchema` is `.strict()`
  //      (vendor/talchain-schemas-0.25.0 → dist/boundary/decision-record.js),
  //      and `capture.test.ts` pins that it "stays armed";
  //   2. `create_decision_record`'s `p_prediction` key whitelist — LIVE on
  //      staging since 2026-07-11T18:46Z, not merely merged — raises 22023 on
  //      any off-whitelist key, refusing the WHOLE record rather than
  //      dropping the field, so a unilateral CEE key would take the entire
  //      capture seam down;
  //   3. the local `CreateDecisionRecordWrite` mirror in store-adapter.ts.
  // Until hops 1 and 3 land (rowed, with the migration amendment), the verdict
  // rides the capture event — which CEE owns outright, makes the withheld
  // population countable TODAY, and is one line from the persisted field.
  const claimVerdict = readMayNameLeadingOptionVerdictForFact(args.fact);

  try {
    const built = buildDecisionRecordWrite(args.fact, args.scenarioId);
    if (built.kind === 'skip') {
      log.debug(
        { scenario_id: args.scenarioId, turn_id: args.turnId, skip_reason: built.reason },
        'DecisionRecords — capture skipped (fact carries no recordable decision; designed skip, not a fault)',
      );
      emitCaptureEvent(args, claimVerdict, { status: 'skipped', skip_reason: built.reason });
      return;
    }
    if (built.analysisSummaryDropped) {
      log.debug(
        { scenario_id: args.scenarioId, turn_id: args.turnId },
        'DecisionRecords — decision_brief.analysis_summary failed the strict contract parse and was dropped (record still captured; optional-forward)',
      );
    }

    // GUEST SHORT-CIRCUIT — before any RPC (seam memo §2.4, the MM guest
    // pre-check pattern): scenarios.user_id is the exact identity the RPC
    // derives owner_user_id from; NULL means the RPC would refuse with
    // DR001 by design. Log-only (no per-guest telemetry — the MM WARN-spam
    // lesson). Best-effort: a missing implementation or a failed read
    // fails OPEN to the RPC, which answers authoritatively.
    if (typeof args.sessionStore.getScenarioOwner === 'function') {
      try {
        const owner = await args.sessionStore.getScenarioOwner(args.scenarioId);
        if (owner === null) {
          log.debug(
            { scenario_id: args.scenarioId, turn_id: args.turnId },
            'DecisionRecords — capture skipped pre-emptively (guest scenario, sign-in required; expected, not a fault)',
          );
          return;
        }
      } catch (precheckErr) {
        log.debug(
          {
            scenario_id: args.scenarioId,
            turn_id: args.turnId,
            err: precheckErr instanceof Error ? precheckErr.message : String(precheckErr),
          },
          'DecisionRecords — guest pre-check read failed; proceeding to create_decision_record (fail-open)',
        );
      }
    }

    const store = getDecisionRecordStore();
    const outcome = await store.createRecord(built.write);
    emitCaptureEvent(args, claimVerdict, {
      status: outcome.deduped ? 'deduped' : 'ok',
      record_id: outcome.record_id,
    });
  } catch (err) {
    if (err instanceof DecisionRecordSignInRequiredError) {
      // The RPC's authoritative DR001 on the fail-open path — the DESIGNED
      // guest outcome, demoted to debug exactly like the MM MV001 case.
      log.debug(
        { scenario_id: args.scenarioId, turn_id: args.turnId },
        'DecisionRecords — create_decision_record refused (guest scenario, DR001; expected, not a fault)',
      );
      emitCaptureEvent(args, claimVerdict, { status: 'guest_refused' });
      return;
    }
    log.warn(
      {
        scenario_id: args.scenarioId,
        turn_id: args.turnId,
        err: err instanceof Error ? err.message : String(err),
      },
      'DecisionRecords — capture hook failed (turn result unaffected)',
    );
    emitCaptureEvent(args, claimVerdict, {
      status: 'error',
      error_name: err instanceof Error ? err.name : 'unknown',
    });
  }
}

/**
 * Content-free capture telemetry (frozen-registry member
 * `v5.decision_records.record_captured`). Best-effort: a telemetry fault
 * inside the error path must not escape the fire-and-forget contract, so
 * emit failures degrade to a debug log.
 */
function emitCaptureEvent(
  args: RecordDecisionRecordArgs,
  claimVerdict: MayNameLeadingOptionVerdict,
  fields: {
    readonly status: 'ok' | 'deduped' | 'skipped' | 'guest_refused' | 'error';
    readonly record_id?: string;
    readonly skip_reason?: DecisionRecordSkipReason;
    readonly error_name?: string;
  },
): void {
  try {
    emit(TelemetryEvents.V5DecisionRecordCaptured, {
      scenario_id: args.scenarioId,
      turn_id: args.turnId,
      turn_row_id: args.persistedRowId,
      status: fields.status,
      record_id: fields.record_id ?? null,
      skip_reason: fields.skip_reason ?? null,
      error_name: fields.error_name ?? null,
      // Claim verdict of the fact this record was projected from. Content-free
      // and on EVERY status, including 'skipped' — a withheld analysis that
      // never produced a record is part of the same population, and an event
      // that only fires on the happy path cannot measure a withhold rate.
      // Booleans + closed enums only; no labels, no probabilities.
      may_name_leading_option: claimVerdict.may_name_leading_option,
      constraint_verdict_state: claimVerdict.constraint_verdict_state,
      claim_verdict_provenance: claimVerdict.provenance,
    });
  } catch (emitErr) {
    log.debug(
      {
        scenario_id: args.scenarioId,
        turn_id: args.turnId,
        err: emitErr instanceof Error ? emitErr.message : String(emitErr),
      },
      'DecisionRecords — capture telemetry emit failed (swallowed; fire-and-forget contract)',
    );
  }
}
