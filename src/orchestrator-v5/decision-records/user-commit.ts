/**
 * Decision Records — the USER-COMMITTED write (calibration R0, "record the
 * decision"). PURE: no I/O, no clock read (the caller injects `now`), no env.
 *
 * This is the seam that turns the live "Record the decision" modal — which
 * has been eliciting the user's chosen option and their stated confidence
 * into `sessionStorage` and losing both at the end of the browser session —
 * into a durable, personal calibration record.
 *
 * WHAT IT RECORDS, and why each field is the honest one:
 *
 *   decision.chosen_option_id / _label   THE USER'S choice. It may differ
 *                                        from the analysis leader; that is
 *                                        the point of a commit, and it is
 *                                        what makes the record scoreable as
 *                                        the PERSON'S forecast.
 *   decision.graph_hash                  The analysed graph, `aag_v1:sha256:`
 *                                        prefixed. ⚠ SERVER-DERIVED from
 *                                        CEE's own newest non-noop
 *                                        run_analysis fact — NEVER supplied
 *                                        by the client. See the anchor note
 *                                        below; this is a correction to the
 *                                        design brief.
 *   decision.committed_by_user = true    The intent marker. Distinguishes a
 *                                        decision the user MADE from ambient
 *                                        auto-capture, so a library can lead
 *                                        with the former.
 *   prediction.statement                 The user's own stated expectation.
 *                                        ⚠ NOT the modal's "rationale" — a
 *                                        rationale is backward-looking
 *                                        justification; `statement` is the
 *                                        forward claim the outcome is scored
 *                                        against. Scoring a rationale as a
 *                                        prediction would be a semantic lie.
 *   prediction.confidence                The user's number, normalised /100
 *                                        SERVER-side (the UI performs no
 *                                        arithmetic on probabilities).
 *   prediction.confidence_source         Exactly `'user_stated'`. The two
 *                                        populations are never blended.
 *   review_date                          USER-SET where a date was given —
 *                                        the first time the BRIEF-C ladder's
 *                                        rung 1 has ever been exercised —
 *                                        otherwise the LABELLED 90-day
 *                                        default. The rung rides the
 *                                        response; a silent fallback would
 *                                        be an undisclosed substitution.
 *
 * ⚠ THE GRAPH-HASH ANCHOR IS NOT THE CLIENT'S TO SUPPLY — A CORRECTED
 * PREMISE. The reconciliation brief said the modal "already holds [the
 * analysed graph] as `analysisHash`". Measured in the UI at
 * `a81121d1`: `results.hash` is annotated `// response_hash`
 * (`src/canvas/store.ts:194`) — that is PLoT's response hash, a DIFFERENT
 * regime, and `store-adapter.ts`'s own contract note forbids it by name
 * ("NEVER PLoT's response_hash / hashGraph, NEVER graph_identity_hash").
 * Sending it as `decision.graph_hash` would anchor every user record to a
 * value no reviewer can re-derive against the graph. So CEE reads its OWN
 * newest non-noop `run_analysis` fact for the scenario and prefixes the
 * `graph_hash_at_run` the handler computed from the exact snapshot the
 * analysis ran against — the same function, the same regime and the same
 * codebase as the auto-capture seam, which is the only skew-free option.
 * It is also strictly safer: the anchor cannot be forged by a caller.
 *
 * ⚠ FIELDS THE CONTRACT CANNOT HOLD. `DecisionRecordDecisionSchema` and
 * `DecisionRecordPredictionSchema` are `.strict()` and have no home for the
 * modal's `rationale`, `assumptionToWatch` or a non-date `revisitTrigger`.
 * v1 DROPS them from the durable record, disclosed in the UI copy, and keeps
 * the existing local copy for them. They are NOT smuggled into
 * `outcome.notes` — that field belongs to the outcome, not the record.
 * Contract candidate, rowed as reconcile R3.
 */

import type { CreateDecisionRecordWrite } from './store-adapter.js';
import {
  USER_COMMIT_RECORD_ID_NAMESPACE,
  deterministicRecordUuid,
} from './record-id.js';
import { AAG_V1_GRAPH_HASH_PREFIX, DECISION_RECORD_REVIEW_HORIZON_DAYS } from './capture.js';

const REVIEW_HORIZON_MS = DECISION_RECORD_REVIEW_HORIZON_DAYS * 24 * 60 * 60 * 1000;

/**
 * Which rung of the BRIEF-C review-date ladder produced `review_date`.
 * Rides the response — an undisclosed fallback is the defect this names.
 */
export type ReviewDateSource =
  /** Rung 1: the user gave a date and it is used VERBATIM. */
  | 'user_set'
  /** Rung 3: no revisit input at all → labelled 90-day default. */
  | 'default_horizon'
  /**
   * Rung 3, reached THROUGH a revisit input we could not read as a date
   * (e.g. "runway falls below 9 months"). Distinct from `default_horizon` on
   * purpose: collapsing the two would let an unparseable date vanish into the
   * default with nothing saying so.
   */
  | 'default_horizon_after_unparsed_trigger';

export type UserCommitRefusalCode =
  | 'invalid_confidence'
  | 'invalid_option'
  | 'invalid_expectation';

export type BuiltUserCommit =
  | {
      readonly kind: 'write';
      readonly write: CreateDecisionRecordWrite;
      readonly reviewDateSource: ReviewDateSource;
    }
  | { readonly kind: 'refuse'; readonly code: UserCommitRefusalCode; readonly message: string };

export interface UserCommitInput {
  readonly scenarioId: string;
  /** The verified JWT `sub` — part of the id tuple, so a commit can never
   *  collide with the ambient auto-capture id space. */
  readonly userId: string;
  readonly chosenOptionId: string;
  readonly chosenOptionLabel: string;
  /** The user's raw 0–100 number. Normalised HERE, server-side. */
  readonly confidence0to100: unknown;
  /** The user's forward-looking claim ("What do you expect to happen?"). */
  readonly expectationStatement: string;
  /** Free text from the modal's "Revisit trigger or date" field, if any. */
  readonly revisitTriggerOrDate?: string;
  /** `graph_hash_at_run` from CEE's own newest non-noop run_analysis fact —
   *  UNPREFIXED; this builder applies `aag_v1:sha256:`. */
  readonly graphHashAtRun: string;
  /**
   * Per-commit nonce. A client-supplied stable value makes a network RETRY
   * idempotent (the RPC replays); a fresh value makes a genuinely NEW commit
   * a NEW record rather than a swallowed one. The route supplies the request
   * timestamp when the client sends none.
   */
  readonly commitNonce: string;
  /** Injected clock — keeps this module pure and the write deterministic. */
  readonly now: Date;
}

/**
 * The USER-COMMIT record id. Distinct from the auto-capture id space by
 * THREE independent means: a different namespace, the submitting user id,
 * and a per-commit nonce.
 *
 * ⭐ THE COLLISION THIS EXISTS TO MAKE IMPOSSIBLE: derive a commit id the way
 * `deriveDecisionRecordId` derives an ambient one and, for the same analysed
 * graph, the two ids are EQUAL — `create_decision_record`'s replay branch
 * then returns the existing model-derived record with `deduped: true` and the
 * user's stated confidence is never written. Nothing errors. Nothing logs a
 * loss. The product simply keeps a forecast the user did not make and throws
 * away the one they did.
 */
export function deriveCommittedDecisionRecordId(
  scenarioId: string,
  graphHash: string,
  userId: string,
  commitNonce: string,
): string {
  return deterministicRecordUuid(USER_COMMIT_RECORD_ID_NAMESPACE, [
    scenarioId,
    graphHash,
    userId,
    commitNonce,
  ]);
}

/**
 * A date-shaped revisit input, or null. DELIBERATELY STRICT: only a full ISO
 * calendar date (`YYYY-MM-DD`) or an ISO datetime is read as a date. Bare
 * `Date.parse` is lenient enough to turn "9" into a year and would silently
 * convert a trigger phrase into a review date the user never chose.
 */
export function parseRevisitDate(raw: string | undefined): Date | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

/**
 * A user-stated confidence, normalised to the contract's [0,1] — or
 * `undefined` when the input is not a usable 0–100 number.
 *
 * REFUSAL, NEVER A CLAMP. `101` is not "certain" and `-1` is not "no
 * confidence": both are inputs we did not understand, and clamping would
 * persist a number the user never stated. The caller turns `undefined` into a
 * typed 400 with NO RPC call.
 */
export function normaliseStatedConfidence(raw: unknown): number | undefined {
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
  return value / 100;
}

/**
 * Project a validated commit request into the `create_decision_record`
 * payload, or a typed refusal. Pure.
 */
export function buildUserCommitWrite(input: UserCommitInput): BuiltUserCommit {
  const confidence = normaliseStatedConfidence(input.confidence0to100);
  if (confidence === undefined) {
    return {
      kind: 'refuse',
      code: 'invalid_confidence',
      message: 'confidence_0_100 must be a number between 0 and 100 inclusive',
    };
  }

  const optionId = input.chosenOptionId.trim();
  const optionLabel = input.chosenOptionLabel.trim();
  if (optionId === '' || optionLabel === '') {
    return {
      kind: 'refuse',
      code: 'invalid_option',
      // Never id-as-label (§0.1 doctrine): a record whose chosen_option_label
      // is a raw node id would poison the long-horizon review surface.
      message: 'chosen_option_id and chosen_option_label must both be non-empty',
    };
  }

  const statement = input.expectationStatement.trim();
  if (statement === '') {
    return {
      kind: 'refuse',
      code: 'invalid_expectation',
      message: 'expectation_statement must be non-empty — it is the claim the outcome is scored against',
    };
  }

  const parsedDate = parseRevisitDate(input.revisitTriggerOrDate);
  const hadRevisitInput =
    typeof input.revisitTriggerOrDate === 'string' && input.revisitTriggerOrDate.trim() !== '';
  const reviewDateSource: ReviewDateSource =
    parsedDate !== null
      ? 'user_set'
      : hadRevisitInput
        ? 'default_horizon_after_unparsed_trigger'
        : 'default_horizon';
  const reviewDate =
    parsedDate !== null
      ? parsedDate
      : new Date(input.now.getTime() + REVIEW_HORIZON_MS);

  const graphHash = `${AAG_V1_GRAPH_HASH_PREFIX}${input.graphHashAtRun}`;
  const recordId = deriveCommittedDecisionRecordId(
    input.scenarioId,
    graphHash,
    input.userId,
    input.commitNonce,
  );

  return {
    kind: 'write',
    reviewDateSource,
    write: {
      scenario_id: input.scenarioId,
      decision: {
        chosen_option_id: optionId,
        chosen_option_label: optionLabel,
        graph_hash: graphHash,
        committed_by_user: true,
      },
      prediction: {
        statement,
        confidence,
        confidence_source: 'user_stated',
      },
      review_date: reviewDate.toISOString(),
      record_id: recordId,
      event_id: `decision_recorded_${recordId}`,
    },
  };
}
