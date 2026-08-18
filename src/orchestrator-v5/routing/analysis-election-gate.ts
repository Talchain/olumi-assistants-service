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
 *    behaviour, no new harm class. A false NEGATIVE costs one click: the turn
 *    answers conversationally and still offers the analysis. Neither direction
 *    can produce a false claim, so one window is sound.
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
 * So the demotion carries its OWN deterministic answer ({@link
 * ANALYSIS_ELECTION_DEMOTION_TEXT}), composed with no model call. It makes no
 * claim about the contents of the user's model (P5 — there is no persisted
 * read at this seam, so it asserts nothing that would need one), manufactures
 * no obligation (P6), and its one affordance has a pinned acceptance path
 * (P8): the sentence it prints tells the user to say "run the analysis", and
 * {@link looksLikeExplicitAnalysisRequest} admits that string — asserted in
 * `__tests__/analysis-election-gate.test.ts`, together with every
 * run-analysis chip message the product emits anywhere in `src/`.
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

import { looksLikeExplicitAnalysisRequest } from './analytical-intent.js';

/** The one handler id this gate governs. */
export const GATED_ANALYSIS_HANDLER_ID = 'run_analysis' as const;

/**
 * The deterministic reply a demoted turn carries.
 *
 * ⚠ EVERY CLAUSE IS LOAD-BEARING; read the P-notes before editing it.
 *  - "I did not read that as a request" is a claim about THIS SYSTEM'S OWN
 *    READING, never about the user. It stays true even when the predicate
 *    misses a genuine request, which a sentence like "you did not ask" would
 *    not (P5 — never assert beyond what is grounded).
 *  - It never says an analysis ran, will run, or was skipped for a reason it
 *    cannot know.
 *  - It makes no statement about what the model contains. There is no
 *    canonical persisted read at this seam, so it makes no claim that would
 *    need one.
 *  - The quoted phrase is the ACCEPTANCE PATH (P8) and is pinned by test
 *    against the admission predicate.
 *  - House style, from the served prompt's own STYLE section: British
 *    English, sentence case, no em dashes.
 */
export const ANALYSIS_ELECTION_DEMOTION_TEXT =
  'I have not run the analysis, because I did not read that as a request to run one. '
  + 'Tell me what you would like added, changed or filled in and I will work on the model with you. '
  + 'Say "run the analysis" whenever you want the results computed.';

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
      readonly assistant_text: string;
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
  return {
    kind: 'demoted',
    reason: 'no_explicit_analysis_request',
    assistant_text: ANALYSIS_ELECTION_DEMOTION_TEXT,
  };
}
