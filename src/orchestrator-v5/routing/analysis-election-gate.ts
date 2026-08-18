/**
 * ⭐ THE ANALYSIS-ELECTION GATE — a deterministic post-router admission gate
 * on an LLM-elected `run_analysis`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT IT CLOSES
 * ─────────────────────────────────────────────────────────────────────────
 * Measured on deployed staging: ~43.8% of turn-2 follow-ups (the drafting
 * request "Use your best guess for the rest and draft the model now.") were
 * routed by the LLM router to `run_analysis` — an analysis nobody asked for.
 * Both outcomes are user-visible harms and they are opposites, which is why a
 * copy fix cannot reach either:
 *
 *   - the run REFUSES (`MISSING_OPTION_VALUE`): the user asked for a model and
 *     is shown refusal-recovery text for an analysis they never requested;
 *   - the run SUCCEEDS (`fresh` / `graph_hash_match`): an analysis executes,
 *     writes a fact and a `graph_hash_at_run`, and REPLACES whatever the user
 *     had, on a turn that asked for something else entirely.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ SANCTIONED vs UNSANCTIONED — derived, because it decides the fix's shape
 * ─────────────────────────────────────────────────────────────────────────
 * The product DOES have a sanctioned automatic provisional analysis after
 * initial model generation, and this gate must not touch it. It does not, and
 * the reason is STRUCTURAL rather than a predicate that could drift:
 *
 *   `route-v2.ts` → `scheduleAutoRunAfterFreshDraft`
 *     → `auto-run-after-draft.ts` → `dispatchChipClickRunAnalysis`
 *
 * That path builds its own turn context and invokes the handler directly. It
 * emits a FRESH turn (`source: 'chip_click'`, `chip.id:
 * 'auto_run_post_draft'`) and `handlers/chip-click-dispatch.ts` contains ZERO
 * references to `routeWithToolUse` or `runTurnExecutor` — so the sanctioned
 * run never produces a `routingResult.proposal` and can never reach this gate.
 * The same is true of the user-clicked "Run analysis" chip, which route-v2
 * claims at dispatch branch (b), ahead of the TurnExecutor fallthrough (e).
 *
 * **Verdict: the 43.8% is UNSANCTIONED SUBSTITUTION, not the sanctioned
 * transition misfiring.** The gate is therefore an admission test on the LLM
 * election alone, and disabling the sanctioned behaviour is not one of its
 * reachable outcomes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ THE GATE'S DOMAIN, ENUMERATED AGAINST EVERY PATH THAT RUNS AN ANALYSIS
 * ─────────────────────────────────────────────────────────────────────────
 * "One of six paths is gated" is only reassuring if the other five are named
 * and their sanction is stated, so here they are, derived at this tip.
 *
 * | # | Path                                   | Provenance      | Verdict |
 * |---|----------------------------------------|-----------------|---------|
 * | 1 | LLM router election (`routeWithToolUse`)| model-decided  | **GATED — this module** |
 * | 2 | Chip click, route-v2 branch (b)         | user's click   | SANCTIONED — the user pressed it |
 * | 3 | `scheduleAutoRunAfterFreshDraft`        | server, post-draft | SANCTIONED — the provisional analysis after initial model generation |
 * | 4 | Short-confirm resume of a pending run   | user's "yes"   | SANCTIONED — consent to an offer the product made |
 * | 5 | Imperative re-run pre-route (2.229)     | user's words, deterministic | SANCTIONED — an explicit instruction, matched without an LLM |
 * | 6 | Pending-action derivation → proposal    | product's own offer | SANCTIONED — the product offered it and the user took it |
 *
 * Every one of 2-6 is DETERMINISTIC: a human pressed something, answered
 * something, or wrote something a regex matched. Only path 1 is decided by a
 * model, and only path 1 can produce an analysis nobody asked for. Gating it
 * is not a partial fix — it is the whole of the reachable defect.
 *
 * ⭐ AND THE COVERAGE IS CHECKABLE IN ONE GREP, not by reading this table.
 * Paths 2-3 leave `turn-executor` entirely (`dispatchChipClickRunAnalysis`
 * builds its own turn context; `chip-click-dispatch.ts` has zero references to
 * `routeWithToolUse` or `runTurnExecutor`). Paths 4-6 are pre-routes inside
 * `turn-executor`, and `rg -n "^\s*routingResult = " turn-executor.ts` shows
 * why they cannot reach this gate: EVERY pre-route assignment sits at a lower
 * line than the `routeWithToolUse` call, each inside a block gated on
 * `routingResult === undefined`, and the gate is called immediately after that
 * call. Line order IS the proof, and it is re-derivable in seconds.
 *
 * ⚠ ON THE "MISSING GATE" DIAGNOSIS, which is right about the hole and wrong
 * about the cause. It is true that `run_analysis` is absent from
 * `GRAPH_MUTATING_HANDLER_IDS` (`routing/mutation-consent.ts:87-91` —
 * `{set_factor_value, add_constraint, adjust_edge_strength}`) and therefore
 * that the action-layer consent gate stands down for it. But that is NOT a
 * short list to lengthen. That set answers *"may this handler change the
 * user's graph without consent?"*, and `run_analysis` does not change the
 * graph, so its absence is CORRECT for that question. Adding it there would
 * have subjected analysis to mutation-consent semantics it has no business
 * under. The real gap is trap 21's shape: **no set answered "may this handler
 * run when the user did not ask for it?"** — a missing CONCEPT, not a missing
 * row. This module is that concept, kept deliberately separate.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ WHY THE PREDICATE CANNOT OSCILLATE (CLAUDE.md trap 22f)
 * ─────────────────────────────────────────────────────────────────────────
 * Trap 22f's ruling is that repeated rounds of token-list tuning over natural
 * language never settle. Three properties keep this gate out of that loop:
 *
 * 1. **THE RULE IS THE PRODUCER'S, NOT OURS** (preamble P7). It is not chosen
 *    from an observed corpus; it is the sentence the served routing prompt
 *    already gives the model, quoted verbatim in `analytical-intent.ts` above
 *    {@link looksLikeExplicitAnalysisRequest} and hash-bound to the wire
 *    identity `routing=120#adcc5128`. Tuning it would mean disagreeing with
 *    the instruction the model is served, which is a prompt change, not a
 *    predicate change.
 *
 * 2. **THE TWO ERROR DIRECTIONS ARE NOT TWO HARMS** (trap 22b requires two
 *    parameters only when they are). A false POSITIVE here honours an election
 *    that would have been honoured anyway — byte-identical to today's staging
 *    behaviour, no new harm class. A false NEGATIVE costs one click ON THE CHIP
 *    THIS MODULE EMITS (see THE OFFER below), or, on a model that cannot be
 *    analysed yet, costs nothing that was available: there was no run to have.
 *    Neither direction can produce a false claim, so one window is sound.
 *
 *    ⚠ THAT SENTENCE USED TO SAY "costs one click: the turn … still offers the
 *    analysis", AND IT WAS NOT TRUE WHEN WRITTEN. The demotion emitted no chip;
 *    whether one appeared was decided by chip rules answering an unrelated
 *    question. Measured through the real `runTurnExecutor` at 585f8dce, on the
 *    P0 message, three states and three different answers:
 *
 *      | readiness | prior turn offered Run? | chips shipped                |
 *      |-----------|-------------------------|------------------------------|
 *      | ready     | no                      | `chip_action_run_analysis`   |
 *      | ready     | YES                     | **none** — the chip-sameness |
 *      |           |                         | guard removed it             |
 *      | blocked   | no                      | "Resolve model issue" prompt |
 *
 *    A justification resting on an affordance the code does not emit is the
 *    guarantee-theatre class this estate hunts. The fix is not to soften the
 *    sentence: it is to make the module OWN the affordance, so the claim and
 *    the behaviour cannot drift apart again.
 *
 * 3. **THE GATE IS MONOTONE.** It can only ever REMOVE an analysis election;
 *    it never adds one. So no reachable input makes the product do something
 *    it would not otherwise have done.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ NO SILENT SUBSTITUTION IN EITHER DIRECTION
 * ─────────────────────────────────────────────────────────────────────────
 * A demoted turn must still answer the user. It may NOT reuse the router's
 * `orientationText`: the served prompt (line 99) scopes that text to
 * "run_analysis: pre-action orientation only. Say what the simulation will
 * test", so on a demoted election it is a future-tense description of a
 * simulation that will now not run — a fabrication of exactly the P5/P8 class.
 * `answer_shape` is unavailable too: the same prompt forbids it on execute.
 *
 * So the demotion carries its OWN deterministic answer, composed with no model
 * call. It makes no claim about the contents of the user's model (P5 — there is
 * no persisted read at this seam, so it asserts nothing that would need one)
 * and manufactures no obligation (P6).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ THE OFFER — one affordance, one acceptance path, both owned here (P8)
 * ─────────────────────────────────────────────────────────────────────────
 * A demoted turn returns TWO things: the copy and, when a run could actually
 * be honoured, {@link ANALYSIS_ELECTION_RUN_CHIP}. They move together by
 * construction:
 *
 *   `runAnalysisOfferable === true`  → {@link
 *     ANALYSIS_ELECTION_DEMOTION_TEXT_WITH_RUN_OFFER} + the chip. One click
 *     runs the analysis the user turns out to have wanted, and the chip's
 *     message is itself admitted by {@link looksLikeExplicitAnalysisRequest},
 *     so the typed form of the same sentence works too.
 *   `runAnalysisOfferable === false` → {@link ANALYSIS_ELECTION_DEMOTION_TEXT}
 *     and NO chip. The copy does not mention running, because on this model a
 *     click could only refuse — and an affordance that terminates in refusal is
 *     the same defect as a fabrication wearing different clothes (P8).
 *
 * ⚠ THE CALLER DERIVES `runAnalysisOfferable`, AND IT IS THE PRODUCER'S OWN
 * ADMISSION PREDICATE, NOT A NEW ONE (P7): `analysisReady.status === 'ready'`
 * AND `run_analysis` present in the validation registry — the exact conjunction
 * every executable-Run chip rule in `compose/chip-generator.ts` already uses
 * (its analyse-stage rule, its post-mutation rule and its floor). Inventing a
 * second readiness opinion here would be trap 21's shape: two predicates
 * answering the same question under different names.
 *
 * ⚠ AND THE CHIP IS NOT SUBJECT TO THE CHIP-SAMENESS GUARD. That guard exists
 * so a turn does not look stuck by repeating the previous turn's chip; this one
 * is the acceptance path a sentence on the SAME turn names. Suppressing it is
 * exactly how the measured "ready + recently offered → zero chips" state
 * arose. The copy and the chip are emitted or withheld together, never one
 * without the other — {@link withAnalysisElectionOffer} is the single place
 * that merges the offer into the turn's chips, and it prepends rather than
 * replaces so the generator's other affordances survive.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REJECTED ALTERNATIVE, recorded so it is not re-proposed
 * ─────────────────────────────────────────────────────────────────────────
 * Re-routing the demoted turn through a second LLM call with `run_analysis`
 * removed from the advert would answer the user more richly. It was rejected:
 * removing one option redistributes election probability toward the MUTATION
 * handlers on a message the model has already misread once, trading an
 * unrequested ANALYSIS for a possible unrequested EDIT. An analysis does not
 * change the user's model; an edit does. That is a strictly worse trade, and
 * it is trap 22b's shape — closing one direction by opening the other.
 */

import type { SuggestedAction } from '../compose/types.js';

import { looksLikeExplicitAnalysisRequest } from './analytical-intent.js';

/** The one handler id this gate governs. */
export const GATED_ANALYSIS_HANDLER_ID = 'run_analysis' as const;

/**
 * The deterministic reply a demoted turn carries when no run can be honoured.
 *
 * ⚠ EVERY CLAUSE IS LOAD-BEARING; read the P-notes before editing it.
 *  - It LEADS WITH WHAT THE USER CAN DO. The shipped first version opened
 *    "I have not run the analysis, because I did not read that as a request to
 *    run one" — a negation about the system followed by a self-justification,
 *    which is ledger defect L-43 (robotic / defensive register) on what is now
 *    one of the most-read sentences in the product. The user did not ask for an
 *    analysis; answering a question they never asked, and then explaining the
 *    router's reading of their words, is not information they can use.
 *  - It never says an analysis ran, will run, or was skipped for a reason it
 *    cannot know. It makes no claim at all about the run, which is the only
 *    thing at this seam that is unambiguously true.
 *  - It makes no statement about what the model contains. There is no
 *    canonical persisted read at this seam, so it makes no claim that would
 *    need one (P5).
 *  - It offers nothing this state cannot honour (P8). The run offer lives in
 *    {@link ANALYSIS_ELECTION_DEMOTION_TEXT_WITH_RUN_OFFER} and ships only
 *    beside {@link ANALYSIS_ELECTION_RUN_CHIP}.
 *  - House style, from the served prompt's own STYLE section: British
 *    English, sentence case, no em dashes.
 */
export const ANALYSIS_ELECTION_DEMOTION_TEXT =
  'Tell me what you would like added, changed or filled in and I will work on the model with you.';

/**
 * The same reply plus the run offer, used ONLY when the caller has told the
 * gate a run could be honoured now.
 *
 * ⚠ COMPOSED FROM THE BASE, never written out a second time: two hand-kept
 * copies of one sentence is the hand-maintained mirror this estate keeps paying
 * for (CLAUDE.md trap 12), and a test pins that the offer variant still STARTS
 * WITH the base so an edit to one cannot silently diverge them.
 *
 * The offered sentence is also the typed acceptance path: `run the analysis` is
 * admitted by {@link looksLikeExplicitAnalysisRequest}, so a user who types it
 * instead of clicking gets the same outcome.
 */
export const ANALYSIS_ELECTION_DEMOTION_TEXT_WITH_RUN_OFFER =
  `${ANALYSIS_ELECTION_DEMOTION_TEXT} Or run the analysis whenever you want the results.`;

/**
 * ⭐ THE ACCEPTANCE PATH THE COPY NAMES, emitted by this module so the two
 * cannot drift apart (P8).
 *
 * Deliberately byte-identical to the executable Run chip
 * `compose/chip-generator.ts` already emits — same id, same label, same message,
 * same `action_type` — so a click lands on the SAME deterministic dispatch
 * (route-v2 branch (b) → `dispatchChipClickRunAnalysis`), which the header's
 * path table lists as SANCTIONED and which never re-enters this gate. A new
 * bespoke chip here would have been a second affordance for one action, and the
 * dedupe in {@link withAnalysisElectionOffer} relies on the shared id.
 *
 * The `message` is scanned out of `src/` by the unit suite's MUST-ADMIT corpus,
 * so if it is ever re-worded into a shape the gate demotes, that test — not a
 * user — finds out.
 */
export const ANALYSIS_ELECTION_RUN_CHIP: SuggestedAction = Object.freeze({
  id: 'chip_action_run_analysis',
  label: 'Run analysis',
  message: 'Run analysis.',
  action_type: 'run_analysis',
});

/** Why an election was admitted or demoted. Structural enums only. */
export type AnalysisElectionOutcome =
  | {
      /** The proposal was not an analysis election; the gate is inert. */
      readonly kind: 'not_analysis_election';
    }
  | {
      /** The message carries the explicit request the served prompt requires. */
      readonly kind: 'admitted';
      readonly reason: 'explicit_analysis_request';
    }
  | {
      /** No explicit request; the handler must not be invoked. */
      readonly kind: 'demoted';
      readonly reason: 'no_explicit_analysis_request';
      /**
       * The turn's reply. Which variant is decided by `runAnalysisOfferable`,
       * and it always agrees with `suggested_actions` — see THE OFFER above.
       */
      readonly assistant_text: string;
      /**
       * The offer, or empty. NEVER a chip without the sentence that names it,
       * and never the sentence without the chip.
       */
      readonly suggested_actions: readonly SuggestedAction[];
    };

export interface AnalysisElectionGateInput {
  /**
   * `action.handler_id` from the proposal the LLM router returned.
   *
   * ⚠ THE CALLER OWNS THE PROVENANCE, AND IT IS STRUCTURAL, NOT A FLAG. This
   * gate must see ONLY LLM-elected proposals. In `turn-executor.ts` that is
   * guaranteed by WHERE the call sits: inside the `if (routingResult ===
   * undefined)` block that wraps `routeWithToolUse`. Every deterministic
   * pre-route — value-update, typed-chip, deictic, compound,
   * clarification-resume, short-confirm and the ROADMAP 2.229 imperative
   * re-run — assigns `routingResult` BEFORE that block and is itself gated on
   * `routingResult === undefined`, so control cannot reach the router when one
   * of them has claimed the turn. There is no discriminator to keep in sync
   * and therefore no mirror to drift (CLAUDE.md trap 12).
   */
  readonly electedHandlerId: string;
  /** The user's message, verbatim. */
  readonly message: string;
  /**
   * Could a `run_analysis` actually execute for this turn's model, right now?
   *
   * ⚠ THE CALLER DERIVES THIS FROM THE PRODUCER, NOT FROM A NEW OPINION (P7):
   * `analysisReady.status === 'ready'` AND `run_analysis` present in the
   * validation registry — the identical conjunction `compose/chip-generator.ts`
   * requires before it will emit an executable Run chip anywhere. This gate
   * must never widen it: the whole point of the flag is that the offer it
   * controls can be honoured, and a readiness opinion of our own would be a
   * second answer to a question that already has one (trap 21).
   *
   * `false` is the safe value. It withholds an offer; it never suppresses the
   * demotion, and it never admits a run.
   */
  readonly runAnalysisOfferable: boolean;
}

/**
 * Decide whether an LLM-elected `run_analysis` may be honoured.
 *
 * Pure, total, no I/O, no telemetry — the caller emits.
 */
export function evaluateAnalysisElection(
  input: AnalysisElectionGateInput,
): AnalysisElectionOutcome {
  if (input.electedHandlerId !== GATED_ANALYSIS_HANDLER_ID) {
    return { kind: 'not_analysis_election' };
  }
  if (looksLikeExplicitAnalysisRequest(input.message)) {
    return { kind: 'admitted', reason: 'explicit_analysis_request' };
  }
  return input.runAnalysisOfferable
    ? {
        kind: 'demoted',
        reason: 'no_explicit_analysis_request',
        assistant_text: ANALYSIS_ELECTION_DEMOTION_TEXT_WITH_RUN_OFFER,
        suggested_actions: [ANALYSIS_ELECTION_RUN_CHIP],
      }
    : {
        kind: 'demoted',
        reason: 'no_explicit_analysis_request',
        assistant_text: ANALYSIS_ELECTION_DEMOTION_TEXT,
        suggested_actions: [],
      };
}

/**
 * Merge a demotion's offer into the turn's composed chips.
 *
 * PREPENDS rather than replaces: the offer is the affordance this turn's copy
 * names, so it must be present and first, but the generator's other chips are
 * answers to other questions and are not this module's to discard.
 *
 * Dedupes by id — the generator frequently produces the same Run chip on its
 * own, and shipping it twice would be a visible defect — then caps to the
 * caller's chip budget, which is passed in rather than imported so this module
 * stays free of the compose layer's internals.
 *
 * Total and pure: an empty offer returns the base array unchanged (same
 * reference), so every non-demoted turn is byte-identical to before.
 */
export function withAnalysisElectionOffer(
  offer: readonly SuggestedAction[],
  baseChips: readonly SuggestedAction[],
  maxChips: number,
): readonly SuggestedAction[] {
  if (offer.length === 0) return baseChips;
  const offeredIds = new Set(offer.map((chip) => chip.id));
  return [...offer, ...baseChips.filter((chip) => !offeredIds.has(chip.id))].slice(0, maxChips);
}
