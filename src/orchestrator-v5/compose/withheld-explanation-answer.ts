/**
 * T1 claim safety — the EXPLANATION-ANSWER half. Closes the rerun NO-OP leak.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CLOSES, AND HOW THE PATH WAS FOUND.
 *
 * #711 gated the STRUCTURED enrichment and #712 gave every surface a typed
 * verdict to read. The POST-#711/#712 live walk (staging `820f3e8`,
 * `acceptance-evidence/g-cee-1-constraint-verdict/WALK-2026-07-26-POST-71112.md`)
 * confirmed both — S1–S6 silent on 11/11 withheld bodies — and then found the
 * claim asserted on the ONE surface neither PR touched, the chat slot:
 *
 *   "Your latest run is current, so there's no need to rerun it yet.
 *    … Standardise on MacBook Pro comes out ahead, leading in 44% of
 *    simulations, with Standardise on Dell XPS close behind at 34% …"
 *
 * on **4/4** rerun bodies that took the no-op branch. **3 of the 4 dropped the
 * withheld disclosure entirely**; the fourth emitted the leader claim AND
 * "that constraint still couldn't be evaluated" in one message — the exact
 * contradiction assertion 1(d) forbids.
 *
 * THE LIVE CHAIN, traced from the captured bytes rather than from a symbol grep
 * (CLAUDE.md trap #16 — a grep proves presence-in-repo, never presence-on-the-
 * wire). Four independent readings of the archived no-op bodies, all pointing
 * one way:
 *   1. `_diagnostic_trace.benchmarking.substage_timings.total_handler_duration_ms`
 *      = **0** on every no-op body, vs 3529 on the body that re-ran. Whatever
 *      composed this text did no PLoT call, no ISL call and no math — the
 *      `explain_results` F.6 invariant exactly.
 *   2. `llm_calls` carries **only** the routing call, at 675–859 output tokens,
 *      vs ~165 + a separate `decision_review` call on every path that re-ran.
 *      The prose was authored INSIDE the routing call.
 *   3. The four bodies carry four DIFFERENT wordings of the same opening
 *      ("…is current, so there's no need to rerun it yet." / "…is already
 *      current, so here's what it shows rather than a fresh run.") — no
 *      deterministic template in this repo emits that sentence at all.
 *   4. `suggested_actions` drops `chip_action_explain_results` on exactly these
 *      bodies and keeps it everywhere else — the signature of that handler
 *      having just run.
 *
 * ⇒ The router answered a "Run the analysis" turn on a CURRENT analysis by
 * dispatching an EXPLANATION handler (`EXPLANATION_HANDLER_IDS`) and carrying
 * its prose in `action.explanation.answer_text`, which
 * `validateExplanationAnswer` marked valid and the handler then used VERBATIM.
 * The blocks on those same bodies were correctly gated (S1–S6 silent), because
 * `buildLifecycleBlocksFromPrior` consults the verdict; `assistant_text` was
 * not, because nothing between the handler and the wire did.
 *
 * NOT A #711 REGRESSION. A literal scan of all 15 archived bodies from the two
 * prior walks finds **zero** no-op bodies: the path had never been exercised.
 * This is an unexercised gap, and it is stated as one.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THE GATE IS HERE AND NOT IN THE HANDLERS. Both halves of the explanation
 * answer leak, and they leak for different reasons:
 *
 *   - Sonnet's `answer_text`, used verbatim when the side-band validator passes
 *     it. LLM-authored, unconstrainable — the live failure above.
 *   - the DETERMINISTIC fallback the handler composes when that text is
 *     unusable. `composeExplainResultsFallback` opens with
 *     "`${leading.label}` performs best, with a probability of …";
 *     `composeWhatWouldFlipFallback` with "`${label}` currently leads, …".
 *
 * Rejecting Sonnet's text would therefore have routed the turn from one leak
 * into another. Both converge on ONE value — the handler outcome's
 * `assistant_text`, threaded through `renderConfirmation` into
 * `composeToolCallResponse` — so the gate sits on that value, once, at the
 * compose seam, and covers all three explanation handlers plus any future
 * member of `EXPLANATION_HANDLER_IDS` with no per-handler wiring. That is the
 * same "cover the family, not the instance" reasoning
 * `validator-explanation.ts` rule 5 was rewritten for.
 *
 * WHY REPLACE AND NOT REWRITE. compose.ts drops leader-presuming Phase-3 cards
 * WHOLE, for the stated reason that the prose is LLM-authored and "there is no
 * template to gate and no substitution that can make that prose honest". The
 * same is true here — but an `assistant_text` cannot be dropped whole, because
 * blanking the chat slot trades a dishonest answer for no answer at all (the
 * failure the egress guard's own "per-field, not whole-response" note warns
 * about). So this module SUBSTITUTES: deterministic copy that says the one true
 * thing about a no-op rerun, plus the disclosure that names the condition and
 * the repair step.
 *
 * WHY THE DISCLOSURE IS RE-EMITTED HERE. On the FIRST run the disclosure rides
 * the run_analysis summary. A rerun turn produces no run_analysis fact, so
 * nothing re-emits it — which is precisely why 3 of the 4 live no-op bodies
 * carried no disclosure at all. Re-emitting it is not a second account of one
 * fact (the #707 convention this estate keeps): on this turn it is the ONLY
 * account, and the slot it appears in is the one that owns it.
 *
 * FAIL CLOSED, twice over:
 *   - the PERMISSION is `readMayNameLeadingOptionFromResult`, which returns
 *     `false` for an unstamped fact — so a turn whose verdict cannot be read is
 *     treated as withholding;
 *   - the SUBSTITUTION runs whenever the answer trips the shared leader
 *     vocabulary, and the disclosure is appended whether or not it did.
 * A state we cannot name degrades to leader-free copy with no named condition
 * (see `readConstraintVerdictStateFromResult` for why a state has no safe
 * default), never to a guess about which condition failed.
 *
 * PURE. Never throws, never mutates its input. The build-time probe below is
 * what keeps the substituted copy from itself tripping the gate — the same
 * self-check `constraint-gap-disclosure.ts` carries, and for the same reason:
 * copy that cannot survive its own egress is inert in production.
 */

import { textNamesLeadingOption } from './leading-option-egress-guard.js';
import { buildConstraintDisclosureFromState } from '../coaching/constraint-gap-disclosure.js';
import type {
  ConstraintVerdictState,
  RatifiedConstraint,
} from '../../orchestrator/context/constraint-feasibility.js';

/**
 * The opening line for a withheld explanation answer.
 *
 * States the one thing that is unambiguously true on a no-op rerun — the
 * analysis the user asked to re-run is the analysis they already have — and
 * nothing else. Every comparative word is absent BY CONSTRUCTION, and the
 * build-time probe below fails the module if that ever stops being true.
 *
 * Deliberately NOT a per-branch variant ("no-op" vs "explanation"): the gate
 * cannot tell those apart from the answer text, and a sentence that guessed
 * would be wrong on the turns it guessed about.
 */
export const WITHHELD_EXPLANATION_OPENING =
  'Your latest analysis is still current, so this is what it already shows.';

/**
 * Tail used when the verdict withholds but has NOTHING to disclose — today
 * `evaluated_infeasible`, whose own copy lives in the coach's compact-summary
 * note (see `buildConstraintDisclosureFromState`), and any turn whose state
 * could not be read back.
 *
 * Says only that no single option can be put forward, which is exactly what
 * `mayNameLeadingOption === false` means, without asserting a cause we may not
 * have evidence for. "put forward", never "recommended" —
 * `FORBIDDEN_HEADLINE_VOCABULARY_REGEX` bans the whole `recommend*` family and
 * the shared leader vocabulary matches it too.
 */
export const WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL =
  ' No single option can be put forward on this result yet.';

/** Why an answer was projected. Bounded — this is the telemetry cardinality. */
export type WithheldExplanationReason =
  /** The answer named or presumed a leader; it was replaced wholesale. */
  | 'leader_claim_replaced'
  /** The answer was already leader-free; only the missing disclosure was added. */
  | 'disclosure_appended'
  /** Nothing to do — the answer was clean and the disclosure already present. */
  | 'unchanged';

export interface WithheldExplanationProjection {
  readonly text: string;
  readonly changed: boolean;
  readonly reason: WithheldExplanationReason;
}

/**
 * Project one explanation-handler answer for a turn whose verdict WITHHOLDS.
 *
 * The caller is responsible for the permission (`mayNameLeadingOption === false`)
 * — this function assumes it and does not re-derive it, so the permission and
 * the prose it governs describe the same analysis (CLAUDE.md trap #12).
 *
 * @param answerText  the handler outcome's `assistant_text`, post-render.
 * @param state       the persisted verdict state, or `null` when unreadable.
 * @param constraints the ratified constraints, read from the same persisted
 *                    `goal_constraints` the original derivation read.
 */
export function projectExplanationAnswerForWithheldClaim(
  answerText: string,
  state: ConstraintVerdictState | null,
  constraints: readonly RatifiedConstraint[],
): WithheldExplanationProjection {
  const original = typeof answerText === 'string' ? answerText : '';

  // The disclosure, in the SAME copy the first run emitted. Empty for a state
  // with nothing to disclose, and for a state we could not read back.
  const disclosure =
    state === null ? '' : buildConstraintDisclosureFromState(state, constraints);
  const tail = disclosure.length > 0 ? disclosure : WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL;

  // LEADER CLAIM ⇒ replace wholesale. A leader-naming answer cannot be
  // repaired by appending to it: the contradiction the walk photographed
  // (`case1g`) was exactly a leader claim followed by the disclosure.
  if (textNamesLeadingOption(original)) {
    return {
      text: `${WITHHELD_EXPLANATION_OPENING}${tail}`,
      changed: true,
      reason: 'leader_claim_replaced',
    };
  }

  // Clean answer, but the disclosure may still be missing — the 3/4 case.
  // Idempotent: an answer that already carries this exact disclosure (a future
  // handler that learns to emit it) is left byte-identical.
  if (disclosure.length > 0 && !original.includes(disclosure.trim())) {
    return {
      text: `${original}${disclosure}`,
      changed: true,
      reason: 'disclosure_appended',
    };
  }

  return { text: original, changed: false, reason: 'unchanged' };
}

/**
 * BUILD-TIME PROBE — the substituted copy must not itself trip the gate.
 *
 * Without this, a copy edit that introduced a banned word ("…so this is what
 * already leads.") would produce an answer the egress guard flags on every
 * withheld turn, and the only symptom would be a telemetry rate nobody had a
 * reason to look at. The disclosure fragments get the same treatment because
 * they are interpolated into the same string.
 *
 * Runs at module load, throws on drift. This module is imported by the compose
 * seam, so a violation fails the process at startup and every test that touches
 * the seam — loudly, which is the point (CLAUDE.md trap #12: a mirror must fail
 * loud, never assume-good).
 */
function assertSubstitutedCopyIsLeaderFree(): void {
  const probes: ReadonlyArray<readonly [string, string]> = [
    ['WITHHELD_EXPLANATION_OPENING', WITHHELD_EXPLANATION_OPENING],
    ['WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL', WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL],
    // Both speakable voices, at the shapes the builder can actually emit:
    // count-only and label-naming, singular and plural.
    ...(['unevaluated', 'identity_unresolved'] as const).flatMap(
      (voice): ReadonlyArray<readonly [string, string]> => [
        [`disclosure:${voice}:count-only`, buildConstraintDisclosureFromState(voice, [
          { constraint_id: 'c1', label: null },
          { constraint_id: 'c2', label: null },
        ])],
        [`disclosure:${voice}:labelled`, buildConstraintDisclosureFromState(voice, [
          { constraint_id: 'c1', label: 'Three-Year Total Cost of Ownership' },
        ])],
      ],
    ),
  ];
  for (const [name, copy] of probes) {
    if (textNamesLeadingOption(copy)) {
      throw new Error(
        `withheld-explanation-answer: substituted copy ${name} trips the shared ` +
          'leader vocabulary (compose/leading-option-egress-guard.ts ' +
          'LEADER_CLAIM_PATTERNS). The gate would replace a withheld answer with ' +
          'copy the egress guard then flags on every withheld turn. Reword the ' +
          'copy — do not narrow the pattern set, which is shared with the alarm.',
      );
    }
  }
}
assertSubstitutedCopyIsLeaderFree();
