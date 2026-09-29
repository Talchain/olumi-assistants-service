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
 *
 * ⭐ RE-MEASURED 19 Aug 2026 — READ THIS BEFORE QUOTING THE 43.8% AGAIN.
 * The figure above is the LLM's ELECTION rate and this gate did not change it
 * (no prompt changed). What changed is whether an election is HONOURED. Against
 * 20 REAL captured wire turns (`__tests__/fixtures/n3-captured-turns.json`,
 * provenance per row) the honoured-without-a-request rate is **0/18**, with both
 * genuine requests still admitted — pinned in
 * `__tests__/n3-captured-turn-corpus.test.ts`, which REDs in either direction.
 * ⚠ THE RESIDUAL IS NOT CLOSED AND IS NOT WHAT THE LEDGER ROW SAYS. A demoted
 * turn is answered with {@link ANALYSIS_ELECTION_DEMOTION_TEXT} and NO further
 * model call, so the user's actual message is never answered. The harm changed
 * SHAPE (an unrequested analysis became an unrequested statement about
 * analysis) at an unchanged RATE. Closing it needs the demoted turn to be
 * answered, which is a turn-lifecycle change, not a predicate change — see the
 * REJECTED ALTERNATIVE at the foot of this comment.
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
 * ⭐ AND THE COVERAGE IS CHECKABLE IN ONE GREP, not by reading this table —
 * BUT THE GREP MUST BE CALL-SITE SCOPED, and an earlier draft of this comment
 * got that wrong in a way that would mislead the next reader (re-derived
 * 19 Aug 2026, N-3 re-measurement lane). It said `chip-click-dispatch.ts` "has
 * zero references to `routeWithToolUse` or `runTurnExecutor`". A plain
 * `grep -c routeWithToolUse` on that file returns **3, not 0** — all three are
 * PROSE inside comments, so the structural claim survives, but the check this
 * comment invites returns a number that contradicts the sentence beside it.
 * The honest form: paths 2-3 leave `turn-executor` entirely
 * (`dispatchChipClickRunAnalysis` builds its own turn context), and
 * `chip-click-dispatch.ts` has zero CALL SITES of either — derive with
 * `rg -n 'routeWithToolUse\(|runTurnExecutor\(' src/orchestrator-v5/handlers/chip-click-dispatch.ts`,
 * which must return nothing. Paths 4-6 are pre-routes inside
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
 * ⭐⭐ AMENDED 15 Sep 2026 — THE DEMOTION IS NOW AN ASK, NOT A REFUSAL.
 * Everything above describes the gate as shipped in Aug 2026 and is still an
 * accurate account of the ADMISSION rule, which is UNCHANGED. What changed is
 * the PAYOFF, which is what the code's own note below already prescribed.
 *
 * MEASURED at the serving tip 07da2c0b, one run with its contrast control
 * inside it: thirteen ordinary English ways of asking for the numbers ("ok
 * lets see the numbers", "show me the results", "so which one wins?", "go on
 * then", "crunch it", …) were demoted 13/13, while five literal commands
 * ("Run the analysis now.", "Rerun.", "Analyse it.", …) were admitted 5/5.
 * Target 0, contrast 5 — the predicate discriminates exactly as designed, and
 * the ordinary sentences were being answered with a sentence that TEACHES THE
 * USER OUR VOCABULARY instead of asking them a question.
 *
 * ⚠ THE FIX IS NOT A WIDER VERB LIST, and that round is banned by the sibling
 * predicate's own ruling in `analytical-intent.ts` (four measured oscillation
 * rounds; trap 22f's exit is to ASK the user, not to widen again). The
 * admission predicate, the negation veto, the interrogative veto and the
 * verb-position allowlist are all untouched by this change.
 *
 * WHAT CHANGED, and only this: a demotion that is NOT an explicit refusal now
 * carries {@link ANALYSIS_ELECTION_DEMOTION_TEXT} as a QUESTION plus an
 * `offer` the caller arms as a chip, from which the atomic-emit contract
 * derives a `run_analysis` pending — so a bare "yes" next turn resumes it via
 * `tryShortConfirmResume`, path 4 of the table above, already SANCTIONED. An
 * explicit refusal takes {@link ANALYSIS_ELECTION_REFUSAL_ACK_TEXT} and is
 * offered nothing. ONE authority still decides: the LLM election is the intent
 * signal, and the gate now converts it into consent rather than discarding it.
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

import {
  carriesExplicitAnalysisRefusal,
  looksLikeExplicitAnalysisRequest,
} from './analytical-intent.js';

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
  'I have not run the analysis, because I was not sure whether that was a request to run one. '
  + 'Do you want me to run it now? Say "run the analysis" or just say yes, and I will. '
  + 'If you meant something else, tell me what to add or change in the model.';

/**
 * The reply a demoted turn carries when the user EXPLICITLY REFUSED a run.
 *
 * ⚠ THIS ARM MUST NOT OFFER. Answering "Don't run the analysis." with "do you
 * want me to run it now?" is the product arguing with a clear instruction, and
 * it is a worse failure than the refusal this change is removing. The split is
 * the whole reason {@link carriesExplicitAnalysisRefusal} exists: one boolean
 * could not tell a refusal apart from a phrasing miss, so both were answered
 * as refusals.
 *
 * Same honesty rules as the offer copy above — it claims nothing about what
 * the model contains, states only this system's own reading, and names the
 * acceptance path in words so the user is never left without a next move.
 */
export const ANALYSIS_ELECTION_REFUSAL_ACK_TEXT =
  'I have not run the analysis, because I read that as you telling me not to. '
  + 'Say "run the analysis" whenever you do want it computed, '
  + 'or tell me what to add or change in the model.';

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
      /**
       * Present iff the demotion is an OFFER rather than a decline — i.e. the
       * user did not refuse, the phrasing merely missed the four-verb rule.
       *
       * The caller arms this as a rendered chip plus the pending action the
       * atomic-emit contract derives from it, so a bare "yes" next turn
       * resumes it through `tryShortConfirmResume` (path 4 of the gate's own
       * path table — SANCTIONED). ABSENT on the refusal arm, which is the one
       * structural difference between the two demotions.
       *
       * ⭐ THE GATE STAYS MONOTONE. This never runs an analysis: it offers
       * one. The run still requires a fresh, explicit consent turn, so no
       * reachable input makes the product compute something nobody asked for
       * — the property the anti-oscillation argument above rests on.
       */
      readonly offer?: { readonly kind: 'run_analysis' };
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
  // ⭐ THE PAYOFF SPLIT. Both arms still SUPPRESS the handler — the admission
  // rule is untouched, and so is every veto ahead of it. What differs is what
  // the suppressed turn says: an explicit refusal is acknowledged, and a
  // phrasing the four-verb rule simply did not spell is ASKED about.
  if (carriesExplicitAnalysisRefusal(input.message)) {
    return {
      kind: 'demoted',
      reason: 'no_explicit_analysis_request',
      assistant_text: ANALYSIS_ELECTION_REFUSAL_ACK_TEXT,
    };
  }
  return {
    kind: 'demoted',
    reason: 'no_explicit_analysis_request',
    assistant_text: ANALYSIS_ELECTION_DEMOTION_TEXT,
    offer: { kind: 'run_analysis' },
  };
}
