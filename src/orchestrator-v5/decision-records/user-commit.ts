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
 * ⚠ FIELDS THE CONTRACT COULD NOT HOLD — SUPERSEDED 2026-09-24 (schemas
 * 0.57.0, migration 20260924120000). Superseded text: ~~`DecisionRecordDecisionSchema`
 * and `DecisionRecordPredictionSchema` are `.strict()` and have no home for the
 * modal's `rationale`, `assumptionToWatch` or a non-date `revisitTrigger`. v1
 * DROPS them from the durable record~~. They now have a home INSIDE `decision`
 * — `rationale`, `key_assumption`, `revisit_trigger`, plus the new
 * `next_action` — and are persisted when, and only when, the client sends them
 * under those names. They are still NOT smuggled into `outcome.notes` or
 * `prediction`: `prediction.statement` stays the one scored claim.
 *
 * ⚠ `revisit_trigger` vs `revisit_trigger_or_date` — TWO FIELDS, ON PURPOSE.
 * `revisit_trigger_or_date` has always been SENT and only ever used to derive
 * `review_date`; its text was never stored, and the live UI copy tells the
 * user the trigger "stays on this device". Persisting that text from TODAY'S
 * payload would make that copy false for every user who has not updated. So
 * the durable text is opt-in: it is stored only from the new
 * `revisit_trigger` field, which only a client that says so will send.
 *
 * ⭐ "NOT READY TO CHOOSE" (0.57.0). `position: 'not_ready'` records the
 * user's current view WITHOUT an option. It is not a decision and is never
 * written as one: the write carries `position: 'not_ready'` and NO option
 * keys at all (the RPC whitelist and the table CHECK both refuse one), and a
 * request that says not-ready while naming an option is refused as a
 * contradiction rather than resolved by guessing which half the user meant.
 * The graph anchor is still server-derived and `review_date` follows the same
 * ladder (the user's date, else the labelled 90-day default).
 *
 * ⭐ A NOT-READY POSITION MAKES NO PREDICTION (reconciled 2026-09-24, Paul's
 * product semantics). The expectation and the stated confidence are claims
 * about a CHOSEN option's outcome — the expectation is what that outcome is
 * scored against — so without a choice both are claims about nothing. A
 * not-ready commit therefore requires neither, and the write carries
 * `prediction: null` (stored as NULL; the migration ties NULL to
 * `position = 'not_ready'`). Sending either WITH `position: 'not_ready'` is
 * refused as `position_contradiction`, exactly like naming an option: storing
 * it would keep a forecast the user's own position says they have not made,
 * and silently dropping it would discard something they sent.
 */

import type {
  ChosenOptionDecisionWrite,
  CreateDecisionRecordWrite,
  DecisionRecordDecisionWrite,
  DecisionRecordReasoningTextWrite,
  NotReadyPositionDecisionWrite,
} from './store-adapter.js';
import {
  USER_COMMIT_RECORD_ID_NAMESPACE,
  deterministicRecordUuid,
} from './record-id.js';
import { AAG_V1_GRAPH_HASH_PREFIX, DECISION_RECORD_REVIEW_HORIZON_DAYS } from './capture.js';

const REVIEW_HORIZON_MS = DECISION_RECORD_REVIEW_HORIZON_DAYS * 24 * 60 * 60 * 1000;

/**
 * Bound on each reasoning-text field (0.57.0). ⚠ A MIRROR of
 * `@talchain/schemas` 0.57.0 `DECISION_RECORD_TEXT_MAX_CHARS` and of the
 * `char_length(...) > 1000` guards in migration 20260924120000 — CEE's
 * vendored pin (0.55.0) does not export it yet.
 * `decision-records-not-ready-migration-static-guards.test.ts` pins this
 * number against the migration's four guards; import it from the package
 * once the pin reaches 0.57.0.
 */
export const DECISION_RECORD_TEXT_MAX_CHARS = 1000;

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
  | 'invalid_expectation'
  /** 0.57.0: `position` present but not `'chosen'` / `'not_ready'`. */
  | 'invalid_position'
  /**
   * 0.57.0: `position: 'not_ready'` AND an option id or label, a confidence,
   * or an expectation — each is a claim about a CHOSEN option.
   */
  | 'position_contradiction'
  /** 0.57.0: a reasoning-text field present but not a string. */
  | 'invalid_text_field'
  /** 0.57.0: a reasoning-text field longer than DECISION_RECORD_TEXT_MAX_CHARS. */
  | 'text_field_too_long';

/**
 * What the user recorded. `'chosen'` is every commit that does not say
 * otherwise — including every client that predates 0.57.0.
 */
export type UserCommitPosition = 'chosen' | 'not_ready';

export type BuiltUserCommit =
  | {
      readonly kind: 'write';
      readonly position: 'chosen';
      readonly write: CreateDecisionRecordWrite<ChosenOptionDecisionWrite>;
      readonly reviewDateSource: ReviewDateSource;
    }
  | {
      readonly kind: 'write';
      readonly position: 'not_ready';
      /** `prediction: null` — a not-ready position makes no forecast. */
      readonly write: CreateDecisionRecordWrite<NotReadyPositionDecisionWrite>;
      readonly reviewDateSource: ReviewDateSource;
    }
  | { readonly kind: 'refuse'; readonly code: UserCommitRefusalCode; readonly message: string };

/**
 * The four optional reasoning fields, as `request key → write key`. The
 * request and the stored record use the SAME names (pass-through doctrine).
 */
export const REASONING_TEXT_FIELDS = [
  'rationale',
  'key_assumption',
  'revisit_trigger',
  'next_action',
] as const satisfies ReadonlyArray<keyof DecisionRecordReasoningTextWrite>;
export type ReasoningTextField = (typeof REASONING_TEXT_FIELDS)[number];

export interface UserCommitInput {
  readonly scenarioId: string;
  /** The verified JWT `sub` — part of the id tuple, so a commit can never
   *  collide with the ambient auto-capture id space. */
  readonly userId: string;
  /**
   * The request's RAW `chosen_option_id` / `chosen_option_label`. Raw, not
   * pre-stringified, so a not-ready commit that names an option in ANY form
   * (a number included) is seen and refused. A non-string on the chosen
   * branch reads as empty and refuses `invalid_option`, exactly as before.
   */
  readonly chosenOptionId: unknown;
  readonly chosenOptionLabel: unknown;
  /** RAW `position` (0.57.0). Absent / null ⇒ `'chosen'`. */
  readonly position?: unknown;
  /** RAW reasoning text (0.57.0), keyed by the request/write field name. */
  readonly reasoningText?: Partial<Record<ReasoningTextField, unknown>>;
  /** The user's raw 0–100 number. Normalised HERE, server-side. Required on
   *  the chosen branch; must be ABSENT (or null / blank) on not-ready. */
  readonly confidence0to100: unknown;
  /**
   * The user's forward-looking claim ("What do you expect to happen?"), RAW.
   * Required (a non-empty string) on the chosen branch — a non-string reads
   * as empty there, exactly as before; must be ABSENT (or null / blank) on
   * not-ready.
   */
  readonly expectationStatement: unknown;
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

/** Absent, null, or a whitespace-only string: the request names nothing. */
function namesNothing(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

type ParsedReasoningText =
  | { readonly kind: 'ok'; readonly text: DecisionRecordReasoningTextWrite }
  | { readonly kind: 'refuse'; readonly code: UserCommitRefusalCode; readonly message: string };

/**
 * The four optional reasoning fields. Absent / null / whitespace-only ⇒ the
 * key is OMITTED from the write (never `''`, which the RPC would 22023, and
 * never `null`). A non-string is refused, not coerced; an over-long value is
 * refused, never truncated — a silently shortened rationale is a sentence the
 * user did not write. Length is measured AFTER trimming, in UTF-16 code units
 * (JS `.length`), which is never more permissive than the RPC's code-point
 * `char_length`.
 */
function parseReasoningText(
  raw: Partial<Record<ReasoningTextField, unknown>> | undefined,
): ParsedReasoningText {
  const text: { -readonly [K in ReasoningTextField]?: string } = {};
  for (const field of REASONING_TEXT_FIELDS) {
    const value = raw?.[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      return {
        kind: 'refuse',
        code: 'invalid_text_field',
        message: `${field} must be a string when present`,
      };
    }
    const trimmed = value.trim();
    if (trimmed === '') continue;
    if (trimmed.length > DECISION_RECORD_TEXT_MAX_CHARS) {
      return {
        kind: 'refuse',
        code: 'text_field_too_long',
        message: `${field} must be at most ${DECISION_RECORD_TEXT_MAX_CHARS} characters (got ${trimmed.length})`,
      };
    }
    text[field] = trimmed;
  }
  return { kind: 'ok', text };
}

/**
 * Project a validated commit request into the `create_decision_record`
 * payload, or a typed refusal. Pure.
 */
export function buildUserCommitWrite(input: UserCommitInput): BuiltUserCommit {
  // 0.57.0 — which branch. Absent / null is 'chosen': every client that
  // predates the field keeps exactly its old behaviour, INCLUDING the order
  // in which its refusals are reported (confidence → option → expectation).
  let position: UserCommitPosition;
  if (input.position === undefined || input.position === null || input.position === 'chosen') {
    position = 'chosen';
  } else if (input.position === 'not_ready') {
    position = 'not_ready';
  } else {
    return {
      kind: 'refuse',
      code: 'invalid_position',
      message: "position must be 'chosen' or 'not_ready' when present",
    };
  }

  // Set on the chosen branch only; `null` ⇔ not ready.
  let chosen: {
    readonly optionId: string;
    readonly optionLabel: string;
    readonly confidence: number;
    readonly statement: string;
  } | null = null;
  if (position === 'not_ready') {
    // THE CONTRADICTION IS REFUSED, NOT RESOLVED. Keeping the option — or a
    // confidence or expectation about one — would record a decision (or a
    // forecast) the user said they had not made; dropping it would discard
    // something they sent. Neither is ours to choose.
    if (!namesNothing(input.chosenOptionId) || !namesNothing(input.chosenOptionLabel)) {
      return {
        kind: 'refuse',
        code: 'position_contradiction',
        message:
          "position 'not_ready' cannot name an option — send chosen_option_id and chosen_option_label only for a chosen position",
      };
    }
    if (!namesNothing(input.confidence0to100) || !namesNothing(input.expectationStatement)) {
      return {
        kind: 'refuse',
        code: 'position_contradiction',
        message:
          "position 'not_ready' makes no prediction — send confidence_0_100 and expectation_statement only for a chosen position",
      };
    }
  } else {
    const confidence = normaliseStatedConfidence(input.confidence0to100);
    if (confidence === undefined) {
      return {
        kind: 'refuse',
        code: 'invalid_confidence',
        message: 'confidence_0_100 must be a number between 0 and 100 inclusive',
      };
    }
    const optionId = typeof input.chosenOptionId === 'string' ? input.chosenOptionId.trim() : '';
    const optionLabel =
      typeof input.chosenOptionLabel === 'string' ? input.chosenOptionLabel.trim() : '';
    if (optionId === '' || optionLabel === '') {
      return {
        kind: 'refuse',
        code: 'invalid_option',
        // Never id-as-label (§0.1 doctrine): a record whose chosen_option_label
        // is a raw node id would poison the long-horizon review surface.
        message: 'chosen_option_id and chosen_option_label must both be non-empty',
      };
    }
    const statement =
      typeof input.expectationStatement === 'string' ? input.expectationStatement.trim() : '';
    if (statement === '') {
      return {
        kind: 'refuse',
        code: 'invalid_expectation',
        message: 'expectation_statement must be non-empty — it is the claim the outcome is scored against',
      };
    }
    chosen = { optionId, optionLabel, confidence, statement };
  }

  const reasoning = parseReasoningText(input.reasoningText);
  if (reasoning.kind === 'refuse') return reasoning;

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

  const common = {
    scenario_id: input.scenarioId,
  };
  const tail = {
    review_date: reviewDate.toISOString(),
    record_id: recordId,
    event_id: `decision_recorded_${recordId}`,
  };

  if (chosen === null) {
    return {
      kind: 'write',
      reviewDateSource,
      position: 'not_ready',
      write: {
        ...common,
        decision: {
          position: 'not_ready',
          graph_hash: graphHash,
          committed_by_user: true,
          ...reasoning.text,
        },
        // NO FORECAST: sent as JSON null → SQL NULL. The RPC refuses anything
        // else on this branch, and the table CHECK ties NULL to not_ready.
        prediction: null,
        ...tail,
      },
    };
  }

  // Key order is deliberate: for a chosen commit with no reasoning text the
  // whole write is byte-identical to the pre-0.57.0 write.
  return {
    kind: 'write',
    reviewDateSource,
    position: 'chosen',
    write: {
      ...common,
      decision: {
        chosen_option_id: chosen.optionId,
        chosen_option_label: chosen.optionLabel,
        graph_hash: graphHash,
        committed_by_user: true,
        ...reasoning.text,
      },
      prediction: {
        statement: chosen.statement,
        confidence: chosen.confidence,
        confidence_source: 'user_stated',
      },
      ...tail,
    },
  };
}

/**
 * Which reasoning texts the account now HOLDS, as the commit response's
 * `stored_text_fields`. A field is listed only when the request carried it
 * (trimmed, non-blank) AND the row the RPC returned holds exactly that text.
 *
 * Read from the RPC's own echo, never inferred from the request: on a replay
 * (`deduped: true`) the returned row is the EARLIER one and may hold
 * different text, and a UI that says "on your account" must be saying it
 * about the words the user sees. Absent echo ⇒ `[]` — the truthful default,
 * under which the UI keeps saying "on this device".
 */
export function confirmStoredTextFields(
  sent: DecisionRecordDecisionWrite,
  stored: Readonly<Record<string, unknown>> | undefined,
): ReasoningTextField[] {
  if (stored === undefined) return [];
  const confirmed: ReasoningTextField[] = [];
  for (const field of REASONING_TEXT_FIELDS) {
    const sentText = sent[field];
    if (typeof sentText === 'string' && sentText !== '' && stored[field] === sentText) {
      confirmed.push(field);
    }
  }
  return confirmed;
}
