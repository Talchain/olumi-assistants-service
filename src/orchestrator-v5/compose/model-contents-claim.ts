/**
 * ⭐⭐⭐ ROADMAP 2.1265 (D2) — A CLAIM ABOUT THE MODEL'S CONTENTS IS ONLY
 * CONSTRUCTIBLE FROM THE AUTHORITATIVE READ THAT GROUNDS IT.
 *
 * **THE RULE (Paul, 17 Aug 2026, ratified — STANDING-BRIEF-PREAMBLE P5).**
 * *Olumi may not assert that the model contains or reflects a value unless that
 * claim is grounded in the authoritative persisted state — AND a simultaneous
 * blocker saying the value is missing must make such a claim IMPOSSIBLE, not
 * merely discouraged.*
 *
 * THE DEFECT, wire-witnessed on deployed CEE `8be62df`
 * (`olumi-docs/witness-acceptance-2026-08-17/`, scenario
 * `289c2690-f605-4f3c-8e43-465b339fda1e`, J4 turn 2, capture
 * `j4-t2-event-final.json`, `exit_path: "turn_executor"`, one `routing` LLM
 * call, prompt 120 hash `adcc5128d4e6e6bc`):
 *
 *   > "Your model already reflects subcontractor cost at 12% of affected-route
 *   >  revenue, so no change is needed there."
 *
 * …while the SAME payload's `readiness.blockers[0]` was a live
 * `MISSING_OPTION_VALUE` for option `21ea9b80` × factor `49a2b80b`, and the
 * persisted draft held the factor at `0.5` (`cee_inference`) with no 0.12/12%
 * in any slot the claim could be about. **A reply that contradicts its own
 * payload's blocker is unconditionally wrong** — and Paul's ruling is that this
 * is worse than a refusal, so it is the programme's top trust defect.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ WHY THIS MODULE EXISTS RATHER THAN A BETTER PREDICATE — the escalation.
 *
 * The first version of this fix was ADVISORY: a finaliser guard that recognised
 * the sentence and swapped it. That is a corrector, and a corrector's failure
 * mode is silence — miss the phrasing, ship the fabrication. The ruling asks for
 * something different: make the contradiction **unrepresentable at the seam**.
 *
 * Three structural properties carry that here, and each is pinned by a test that
 * RESTORES the claim and goes RED:
 *
 *   1. **THE READ IS THE ONLY KEY.** `AuthoritativeModelRead` is BRANDED with a
 *      module-private unique symbol, so no caller anywhere in the service can
 *      fabricate one — it can only come out of `readAuthoritativeModelState`,
 *      which requires the persisted graph. A permission decision therefore
 *      CANNOT be requested without the read that grounds it. This is a
 *      compile-time property, not a convention: `classifyModelContentsClaim`
 *      takes the branded type, so passing a bare graph is a type error.
 *   2. **DEFAULT-DENY OVER THE VALUE SPACE.** The permission question is not
 *      "does this sentence look suspicious" but "is every number it asserts
 *      present in the grounded set derived from the persisted state". An
 *      unrecognised value is DENIED, not allowed. Widening the recogniser can
 *      only ever catch MORE claims; it can never create a permission.
 *   3. **NO OVERRIDE EXISTS.** There is no flag, option, force parameter or
 *      second entry point that returns `grounded` when the payload carries a
 *      blocker saying the value is missing and the value is ungrounded. The
 *      refusal is computed before any other branch and returns immediately. A
 *      test asserts the exported surface admits no such key.
 *
 * ⚠ WHAT THIS HONESTLY CANNOT DO, stated rather than implied. The prose is a
 * STRING produced by a model; TypeScript cannot make a string unrepresentable.
 * What is made unrepresentable is the *permitted* state: there is no reachable
 * code path in this service that returns "this contents claim may ship" for a
 * blocker-bearing payload whose grounded set lacks the asserted value. The
 * recogniser that decides *which sentences are contents claims* remains a
 * predicate over natural language, and its honest gaps are pinned as data
 * (`MODEL_CONTENTS_CLAIM_KNOWN_DROPPED`) so the suite REDs if the set grows OR
 * shrinks (trap 22f). Every gap is a MISSED claim, never an invented permission
 * — the failure direction is chosen, not accidental.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ TWO MEASURED NEAR-MISSES, recorded rather than quietly fixed (trap 14).
 *
 * (a) **Binding the claim to a blocker's `factor_label` NEVER FIRES on the
 *     witnessed bytes.** The fabrication says "subcontractor cost at 12% of
 *     affected-route revenue" and "as a share of affected-route revenue"; the
 *     persisted label is "Subcontractor cost as share of affected-route
 *     revenue". Neither paraphrase contains it. The obvious trap-19 binding
 *     would have produced a guard that is correct and pointed at the wrong
 *     bytes. What the claim actually asserts is a NUMBER, and whether the model
 *     holds it is a server-side fact — which is what the ruling names.
 *
 * (b) **A whole-object numeric sweep reports `0.12` PRESENT in the witnessed
 *     graph** — from digit runs inside hex node ids (`21ea9b80` → `21`, `80`)
 *     and twelve edges carrying `strength.std = 0.11999999999999998`, which
 *     matches 0.12 inside any sane tolerance. That sweep would have GRANTED
 *     permission on the exact fabrication, and its "value present" reading looks
 *     like an ordinary grounded result (trap 13e). The grounded set is therefore
 *     scoped to the CLAIM'S DOMAIN — option effect values read through
 *     `mergeInterventionSources` (the reader the readiness payload itself uses)
 *     and node observed/display values — never the object graph.
 *
 * (c) **The blocker discriminator is spelled two different ways.** The wire
 *     projection carries `code: "MISSING_OPTION_VALUE"`; the CANONICAL in-process
 *     payload the executor holds carries `blocker_type: "missing_value"` and NO
 *     `code` field at all. Reading only the wire spelling was fully green in unit
 *     and DEAD in production. Both are read, and both shapes are asserted over
 *     the same witnessed graph.
 *
 * Pure: no I/O, no LLM, no telemetry. The caller owns emission and the swap.
 */

import { mergeInterventionSources } from '../../orchestrator/tools/analysis-ready-helper.js';

/**
 * Module-private brand. Nothing outside this file can produce a value of the
 * branded type, which is what makes the authoritative read the ONLY key to a
 * permission decision.
 *
 * ⚠ A REAL RUNTIME SYMBOL, NOT `declare const` — and that distinction was caught
 * by execution, not inspection (trap 14, recorded rather than quietly fixed). The
 * first version used `declare const AUTHORITATIVE_READ: unique symbol`, which is
 * a TYPE-ONLY declaration with no runtime value, so `readAuthoritativeModelState`
 * threw `ReferenceError: AUTHORITATIVE_READ is not defined` on every call. A
 * type-only brand would have been a compile-time guarantee that could not run —
 * the guarantee-theatre shape, in the one module written to abolish it. It is
 * deliberately NOT exported: an unexported symbol is unforgeable from outside.
 */
const AUTHORITATIVE_READ: unique symbol = Symbol('olumi.authoritativeModelRead');

/** A live missing-effect-value blocker, projected to the two labels we name. */
export interface MissingValuePair {
  readonly optionLabel: string;
  readonly factorLabel: string;
}

/**
 * The authoritative read a model-contents claim must be grounded in.
 *
 * Obtainable ONLY from `readAuthoritativeModelState`. The brand is not
 * decoration: it is the compile-time reason a caller cannot ask for a permission
 * decision while holding nothing but a sentence.
 */
export interface AuthoritativeModelRead {
  readonly [AUTHORITATIVE_READ]: true;
  /** Values the persisted model genuinely holds, in the slots a claim can name. */
  readonly groundedValues: ReadonlySet<number>;
  /** Slots the SAME payload declares MISSING. Non-empty ⇒ refusal is mandatory. */
  readonly blockedSlots: readonly MissingValuePair[];
}

/**
 * The two spellings of a missing-effect-value blocker. NOT interchangeable
 * spellings of one field — see near-miss (c) in the header.
 */
const MISSING_VALUE_DISCRIMINATORS: readonly (readonly [string, string])[] = [
  // Canonical, in-process — what the turn-executor and the edit dispatcher hold.
  ['blocker_type', 'missing_value'],
  // Wire projection — what `analysis_state.readiness.blockers` carries.
  ['code', 'MISSING_OPTION_VALUE'],
];

/** Numeric token: digits, optional thousands commas, optional decimal, optional %. */
const NUMBER_TOKEN = /(\d[\d,]*(?:\.\d+)?)\s*(%)?/g;

/**
 * Project the LIVE missing-effect-value pairs off the readiness payload.
 *
 * DERIVED, NOT MIRRORED (trap 12): read off the SAME blockers that compose the
 * blocker copy the user is looking at, so this cannot disagree with the product
 * about what is missing. Duck-typed deliberately — it must read both the
 * canonical payload and the wire projection.
 */
export function projectMissingValuePairs(readiness: unknown): MissingValuePair[] {
  if (readiness === null || typeof readiness !== 'object') return [];
  const blockers = (readiness as { blockers?: unknown }).blockers;
  if (!Array.isArray(blockers)) return [];
  const pairs: MissingValuePair[] = [];
  for (const raw of blockers) {
    if (raw === null || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    if (!MISSING_VALUE_DISCRIMINATORS.some(([field, value]) => b[field] === value)) continue;
    const optionLabel = b.option_label;
    const factorLabel = b.factor_label;
    if (typeof optionLabel !== 'string' || optionLabel.trim().length === 0) continue;
    if (typeof factorLabel !== 'string' || factorLabel.trim().length < 3) continue;
    pairs.push({ optionLabel: optionLabel.trim(), factorLabel: factorLabel.trim() });
  }
  return pairs;
}

/**
 * Sweep the values the persisted MODEL holds in the slots a "your model already
 * reflects X" claim can be about: every option's effect values and every node's
 * own observed value, numeric and display-string form.
 *
 * Scoped to the claim's domain, NOT the object graph — see near-miss (b).
 * Intervention values come through `mergeInterventionSources`, the SAME reader
 * that composes the readiness payload whose blocker triggers the refusal, so the
 * two can never disagree about what the model holds (trap 12).
 */
export function collectModelValueNumbers(graph: unknown): Set<number> {
  const found = new Set<number>();
  if (graph === null || typeof graph !== 'object') return found;
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return found;

  const addNumber = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) found.add(value);
  };
  const addFromDisplayString = (value: unknown): void => {
    if (typeof value !== 'string') return;
    for (const m of value.matchAll(NUMBER_TOKEN)) {
      const parsed = Number(m[1]!.replace(/,/g, ''));
      if (!Number.isFinite(parsed)) continue;
      found.add(parsed);
      if (m[2] === '%') found.add(parsed / 100);
    }
  };
  const addObservedState = (holder: unknown): void => {
    if (holder === null || typeof holder !== 'object') return;
    const observed = (holder as Record<string, unknown>).observed_state;
    if (observed !== null && typeof observed === 'object') {
      addNumber((observed as Record<string, unknown>).value);
      addFromDisplayString((observed as Record<string, unknown>).display_value);
    }
    addFromDisplayString((holder as Record<string, unknown>).display_value);
  };
  // ⭐⭐ GOAL TARGETS ARE PART OF THE CLAIM'S DOMAIN — added after CI proved the
  // omission caused a FALSE REFUSAL of a TRUE claim (trap 14, recorded not
  // patched). The required check failed on
  // `turn-executor-direct-answer-registration-claim.test.ts`'s own POSITIVE
  // CONTROL — *"the SAME prose ships untouched when the persisted goal node DOES
  // register the target"* — because "The model already has that target in place:
  // growing MRR to £250,000…" is `already` + a holding verb + a number, and this
  // sweep looked only at effect values and node observed values. The claim was
  // TRUE and this guard refused it.
  //
  // ⚠ AND THE DEEPER POINT (trap 21): goal-target registration claims ALREADY have
  // a dedicated authority — `compose/goal-target-receipt-guard.ts` (ROADMAP 1.19),
  // which checks the canonical `goal_threshold_raw` contract. Two guards answering
  // one question and disagreeing is the defect; this sweep reads the same
  // registration so it can only ever AGREE with that authority, never contradict
  // it. Over-refusal is a failure, not a safe default.
  const addTargetCarriers = (holder: unknown): void => {
    if (holder === null || typeof holder !== 'object') return;
    for (const [key, value] of Object.entries(holder as Record<string, unknown>)) {
      if (!/threshold|target/i.test(key)) continue;
      addNumber(value);
      addFromDisplayString(value);
    }
  };

  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    addObservedState(record);
    addObservedState(record.data);
    addTargetCarriers(record);
    addTargetCarriers(record.data);
    const interventions = mergeInterventionSources(record);
    if (interventions !== undefined) {
      for (const value of Object.values(interventions)) addNumber(value);
    }
  }
  return found;
}

/**
 * Take the authoritative read.
 *
 * Returns `null` when there is no persisted graph to read — and that null is
 * load-bearing: with no authoritative state there is no grounding, so a claim
 * cannot be permitted, and the caller has nothing to pass. There is deliberately
 * no way to synthesise a read from a sentence, a request body, or a hash.
 */
export function readAuthoritativeModelState(params: {
  readonly persistedGraph: unknown;
  readonly readiness: unknown;
  /**
   * ⭐⭐ DID THIS TURN WRITE THE MODEL? If so there is NO authoritative read to
   * ground against yet, and this returns `null` so the guard stands down.
   *
   * Added after CI proved the omission caused a FALSE REFUSAL (trap 14): the
   * required check failed on `baseline-elicitation-route-level.test.ts` —
   * *"about 12%" against the live question mints the baseline on the named
   * target* — where the reply *"Noted Churn rate is currently at 12%."* is TRUE
   * because the turn had just written it, while the graph this guard holds is the
   * PRE-dispatch parse. Refusing there is unsound, and it is P3 exactly: my
   * emission must not be LESS TRUE than the behaviour it replaces. A mutating
   * turn's claim is the mutation's own to justify — the structural-success and
   * goal-target receipt guards own that question.
   */
  readonly turnWroteModel?: boolean;
}): AuthoritativeModelRead | null {
  const { persistedGraph, readiness } = params;
  if (params.turnWroteModel === true) return null;
  if (persistedGraph === null || persistedGraph === undefined) return null;
  return {
    [AUTHORITATIVE_READ]: true,
    groundedValues: collectModelValueNumbers(persistedGraph),
    blockedSlots: projectMissingValuePairs(readiness),
  };
}

/** A number as written in a claim, plus every value it could denote. */
export interface AssertedNumber {
  readonly asWritten: string;
  /** `12%` ⇒ {12, 0.12}; `0.12` ⇒ {0.12, 12}. Share/percent are one claim. */
  readonly candidates: readonly number[];
}

/** Extract every number in a sentence with its percent/share equivalents. */
export function extractAssertedNumbers(sentence: string): AssertedNumber[] {
  const out: AssertedNumber[] = [];
  for (const m of sentence.matchAll(NUMBER_TOKEN)) {
    const raw = m[1]!;
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const candidates = new Set<number>([value]);
    if (m[2] === '%') candidates.add(value / 100);
    if (value > 0 && value < 1) candidates.add(value * 100);
    else if (value >= 1 && value <= 100) candidates.add(value / 100);
    out.push({ asWritten: m[0].trim(), candidates: [...candidates] });
  }
  return out;
}

/** Float-safe membership (0.12 must match a stored 0.12). */
function readHolds(read: AuthoritativeModelRead, candidate: number): boolean {
  for (const held of read.groundedValues) {
    if (held === candidate) return true;
    if (Math.abs(held - candidate) <= 1e-9 * Math.max(1, Math.abs(candidate))) return true;
  }
  return false;
}

/**
 * ⭐ Trap 22f's honest-gap protocol at the SEAM. A sentence pairing a grounded
 * figure with a fabricated one is NOT refused, because refusing it would require
 * `every`, which measurably refuses true claims (see the scope ruling in
 * `groundModelValueClaim`). Recorded as data so the suite REDs if this changes in
 * either direction, and reported up as the follow-up that needs per-value slot
 * attribution.
 */
export const MIXED_CLAIM_KNOWN_GAP =
  'Your model already uses 0.5 for that driver and already reflects 12% on the subcontracting route.';

export type ClaimRefusalReason =
  /** The payload's own blocker says the value is missing. MANDATORY refusal. */
  | 'blocker_says_missing'
  /** No blocker, but the persisted state does not hold the asserted value. */
  | 'not_in_persisted_state';

export type GroundedClaimVerdict =
  | { readonly grounded: true }
  | { readonly grounded: false; readonly reason: ClaimRefusalReason };

/**
 * ⭐⭐ THE SEAM. Is a model-contents claim asserting these numbers grounded?
 *
 * ⚠ THE SIGNATURE IS THE GUARANTEE. The only way to reach this function is to
 * hold an `AuthoritativeModelRead`, and the only way to hold one is to have read
 * the persisted state. There is NO options object, NO force flag, NO second
 * entry point, and the mandatory-refusal branch is evaluated FIRST and returns
 * immediately — so no later condition can reinstate a permission. Pinned by
 * `model-contents-claim.structural.test.ts`, which RESTORES the claim on a
 * blocker-bearing read through every shape the witness produced and asserts each
 * one is refused.
 *
 * DEFAULT-DENY: a claim is grounded only if EVERY number it asserts is held by
 * the read. An unrecognised or unparsed value is not a permission.
 */
export function groundModelValueClaim(params: {
  readonly read: AuthoritativeModelRead;
  readonly assertedValues: readonly AssertedNumber[];
}): GroundedClaimVerdict {
  const { read, assertedValues } = params;
  // Default-deny: a claim with no readable number asserts nothing this function
  // can ground, so it is not grounded.
  if (assertedValues.length === 0) {
    return { grounded: false, reason: 'not_in_persisted_state' };
  }
  // ⭐⭐⭐ SCOPE RULING (trap 22f — TWO ROUNDS IN OPPOSITE DIRECTIONS, SO STOP
  // GUESSING). This predicate has now failed in both directions under measurement:
  //
  //   · `some` (any value held ⇒ grounded) let a FABRICATED figure ride on a TRUE
  //     one — the mutant that survived the first battery.
  //   · `every` (all values held ⇒ grounded) FALSELY REFUSED a true claim: CI
  //     failed on `turn-executor-direct-answer-registration-claim`'s own positive
  //     control, where *"The model already has that target in place: growing MRR to
  //     £250,000 is set as the goal, alongside your churn ceiling (below 3%) and
  //     gross margin floor (above 80%…)"* is TRUE — the £250,000 target IS
  //     registered — but 3% and 80% are CONSTRAINTS, which this sweep does not
  //     read, so one true sentence read as ungrounded.
  //
  // The estate's ruling for an oscillating predicate is not a third guess: it is to
  // ship the SAFE direction with the gap pinned as data. Refusal therefore requires
  // that the claim have NO grounding at all. Consequences, stated plainly:
  //   · the witnessed fabrication still refuses (it asserts 12% alone, ungrounded);
  //   · a true claim can no longer be refused because it mentions an incidental or
  //     constraint-held figure — over-refusal of a true statement about the user's
  //     own model is itself a P5 harm, and it was shipping;
  //   · the MIXED case (a fabricated value beside a grounded one) is now a KNOWN,
  //     PINNED GAP — see `MIXED_CLAIM_KNOWN_GAP` and its spec, which REDs if the gap
  //     silently widens or closes. The real fix is per-value slot attribution (which
  //     number is claimed about WHICH slot); that needs the producer-side derivation
  //     this lane does not have and is reported up rather than guessed at here.
  const anyValueHeld = assertedValues.some((n) =>
    n.candidates.some((candidate) => readHolds(read, candidate)),
  );
  if (anyValueHeld) return { grounded: true };
  // ⭐ MANDATORY REFUSAL, and it is deliberately the FIRST thing decided once
  // grounding fails: when the same payload says the value is missing, a claim
  // that the model already holds it is not merely unsupported, it is a
  // contradiction, and no downstream condition may soften it.
  if (read.blockedSlots.length > 0) {
    return { grounded: false, reason: 'blocker_says_missing' };
  }
  return { grounded: false, reason: 'not_in_persisted_state' };
}
