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

import { textAssertsLeadingOption } from './leading-option-egress-guard.js';
import { composeWithheldReasonTail } from './withheld-reason-tail.js';
import {
  MAY_NAME_LEADING_OPTION,
  type ConstraintVerdictState,
  type RatifiedConstraint,
} from '../../orchestrator/context/constraint-feasibility.js';

/**
 * The opening line for a withheld explanation answer **on a turn whose analysis
 * is verified CURRENT** (`conditionsAreCurrent === true`).
 *
 * States the one thing that is unambiguously true on a no-op rerun — the
 * analysis the user asked to re-run is the analysis they already have — and
 * nothing else. Every comparative word is absent BY CONSTRUCTION, and the
 * build-time probe below fails the module if that ever stops being true.
 *
 * ⚠ IT ASSERTS CURRENCY, SO IT IS NOW FRESHNESS-GATED — corrected 2026-07-29.
 * This constant used to be returned UNCONDITIONALLY by the REPLACE branch while
 * only the *tail* consumed `conditionsAreCurrent`. On any turn where that
 * predicate is `false` — stale, unknown, no analysis-readiness derived yet, or
 * the caller's own read failing closed — the sentence "your latest analysis is
 * still current" was **affirmatively false**, and the guard was swapping a
 * leader-claim leak for a freshness fabrication: one honesty defect for
 * another. Found by adversarial review of the chokepoint work (#755), which
 * also widened this constant's population from three explanation handlers on a
 * rerun to every non-execute exit — turns where there was no rerun at all and
 * the original justification above does not transfer.
 *
 * Use {@link WITHHELD_EXPLANATION_OPENING_CURRENCY_UNKNOWN} whenever currency
 * is not verified. The rule this encodes: **copy may state a fact only on the
 * population where that fact is true** — and a degradation path that could not
 * read its inputs must not make a factual claim about them.
 *
 * Deliberately NOT a per-branch variant ("no-op" vs "explanation"): the gate
 * cannot tell those apart from the answer text, and a sentence that guessed
 * would be wrong on the turns it guessed about. The freshness split is a
 * different thing — it is driven by a derived predicate, not a guess.
 */
export const WITHHELD_EXPLANATION_OPENING =
  'Your latest analysis is still current, so this is what it already shows.';

/**
 * The opening line when currency is **NOT verified** (`conditionsAreCurrent ===
 * false`): stale, `unknown`, `none`, no readiness derived yet, or the caller's
 * own input read failed closed.
 *
 * Asserts NOTHING about whether the analysis is up to date. It says only that
 * the answer reflects the most recent analysis — which is warranted on the whole
 * population by construction, not by assumption: a withheld verdict IMPLIES a
 * `run_analysis` fact exists in the chain (with no fact the permission reads
 * `true`, so this code is unreachable), and the verdict is read off the newest
 * non-noop such fact.
 *
 * Pairs with `WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL`, which is the only tail
 * reachable when `conditionsAreCurrent` is false — so the complete text on this
 * branch is "This reflects your most recent analysis. No single option can be
 * put forward on this result yet." Both halves are true on every exit that can
 * reach them.
 *
 * Probed at module load twice: leader-free (like every other substituted
 * fragment here) AND currency-free, with a positive control that the
 * currency-asserting sibling above still trips the same probe — an absence
 * check whose instrument cannot see a presence proves nothing (trap #13).
 */
export const WITHHELD_EXPLANATION_OPENING_CURRENCY_UNKNOWN =
  'This reflects your most recent analysis.';

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
 * @param conditionsAreCurrent whether those constraints describe the SAME graph
 *                    the verdict was derived against — i.e. the analysis is
 *                    `fresh`. See {@link WithheldExplanationProjection} and the
 *                    note below for why this is required rather than defaulted.
 */
export function projectExplanationAnswerForWithheldClaim(
  answerText: string,
  state: ConstraintVerdictState | null,
  constraints: readonly RatifiedConstraint[],
  conditionsAreCurrent: boolean,
): WithheldExplanationProjection {
  const original = typeof answerText === 'string' ? answerText : '';

  // ⚠ ROADMAP 2.104 — THIS USED TO BE `buildConstraintDisclosureFromState`
  // DIRECTLY, AND THAT IS WHY THE APPEND BRANCH BELOW COULD NOT FIRE FOR TWO OF
  // THE THREE WITHHOLDING STATES.
  //
  // That builder returns `''` for `evaluated_infeasible` (deliberately — it
  // says its copy "lives in the coach's compact-summary note", which is not
  // available on a narrating turn and which names the winning option), and this
  // function was handed `null` for an unreadable state. In both cases
  // `disclosure.length > 0` was false, so the APPEND branch was skipped and the
  // turn carried no reason at all. Only the REPLACE branch spoke, and only when
  // the answer happened to trip the leader vocabulary.
  //
  // `composeWithheldReasonTail` is total over the withholding states: it
  // DELEGATES the two voices this estate already got right, and supplies the
  // two that had none. Same leading-space fragment contract, so nothing about
  // how it is consumed changes.
  // ⚠ FRESHNESS SPLITS THE TWO BRANCHES, AND CONFLATING THEM WOULD BREAK ONE OF
  // THEM WHICHEVER WAY YOU CHOSE. Found by a route-level test on this change:
  // this gate had NO freshness predicate, so on a STALE run it named a condition
  // read from the CURRENT graph against a verdict derived from the PREVIOUS one.
  // `goal_constraints` are inside the analysis-affecting hash, so any constraint
  // edit produces exactly that state — including the edit this copy's own repair
  // step asks for. Pre-existing, and it would have been WIDENED here rather than
  // introduced, because the tail is now total over the withholding states.
  //
  //   REPLACE is a SAFETY branch and is NEVER freshness-gated. It fires when the
  //   answer asserts a leader on a withheld turn; suppressing it on a stale run
  //   would re-open the very leak this module exists to close. Stale simply
  //   costs it the named condition — it degrades to the cause-free tail, which
  //   is true on every withheld turn regardless of graph state.
  //
  //   APPEND is an INFORMATIVE branch. Its whole value is naming the condition,
  //   and on a stale run that name may be wrong, so it stands down entirely.
  //
  // `conditionsAreCurrent` is REQUIRED, not optional-with-a-default: an optional
  // one is the one a future caller silently forgets, and the forgotten value
  // would be the unsafe one — the same doctrine
  // `EgressSanitiseOpts.mayNameLeadingOption` applies.
  const reason = conditionsAreCurrent ? composeWithheldReasonTail(state, constraints) : null;
  // `null` for the two PERMITTING states (a correct caller cannot reach them —
  // it owns the permission) and for a stale run. Falling back to the cause-free
  // tail rather than inventing one is the same fail-closed posture as the rest
  // of this module.
  const tail = reason?.text ?? WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL;
  const disclosure = reason?.text ?? '';

  // ⚠ THE OPENING IS FRESHNESS-GATED TOO — and it was not, which was a
  // fabrication (see WITHHELD_EXPLANATION_OPENING's docstring). `conditionsAreCurrent`
  // now governs BOTH halves of the substituted sentence, because both halves make
  // claims that are only true when it holds: the tail names a ratified condition
  // read off the CURRENT graph, and the opening asserts the analysis is CURRENT.
  // Splitting them was the defect — the tail stood down honestly while the opening
  // kept asserting.
  const opening = conditionsAreCurrent
    ? WITHHELD_EXPLANATION_OPENING
    : WITHHELD_EXPLANATION_OPENING_CURRENCY_UNKNOWN;

  // LEADER CLAIM ⇒ replace wholesale. A leader-naming answer cannot be
  // repaired by appending to it: the contradiction the walk photographed
  // (`case1g`) was exactly a leader claim followed by the disclosure.
  if (textAssertsLeadingOption(original)) {
    return {
      text: `${opening}${tail}`,
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
    [
      'WITHHELD_EXPLANATION_OPENING_CURRENCY_UNKNOWN',
      WITHHELD_EXPLANATION_OPENING_CURRENCY_UNKNOWN,
    ],
    ['WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL', WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL],
    // ⚠ DERIVED FROM THE STATE ENUM, not the two voices this probe used to
    // hand-list. It listed `unevaluated` and `identity_unresolved` because they
    // were the only states with copy; the tail is now total over the
    // withholding states, and a hand-list would have left the two NEW voices
    // (`evaluated_infeasible`, `reason_unrecorded`) unprobed — the same mirror
    // drift this file's sibling probes were written against.
    ...([null, ...(Object.keys(MAY_NAME_LEADING_OPTION) as ConstraintVerdictState[])] as const)
      .flatMap((state): ReadonlyArray<readonly [string, string]> =>
        (
          [
            ['none', [] as readonly RatifiedConstraint[]],
            ['labelled', [{ constraint_id: 'c1', label: 'Three-Year Total Cost of Ownership' }]],
            ['count-only', [
              { constraint_id: 'c1', label: null },
              { constraint_id: 'c2', label: null },
            ]],
          ] as const
        ).flatMap(([shape, constraints]) => {
          const tail = composeWithheldReasonTail(state, constraints);
          return tail === null
            ? []
            : [[`tail:${state ?? 'null'}:${shape}`, tail.text] as const];
        }),
      ),
  ];
  for (const [name, copy] of probes) {
    if (textAssertsLeadingOption(copy)) {
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

/**
 * Spans that ASSERT the analysis is up to date.
 *
 * Small and anchored to what this module's own copy actually says — not a
 * speculative vocabulary. It exists to hold ONE invariant: currency is claimed
 * only on the population where currency was verified.
 */
const CURRENCY_ASSERTION_PATTERN =
  /\b(?:still\s+current|already\s+shows|already\s+reflects|up\s+to\s+date|unchanged\s+since)\b/i;

/**
 * BUILD-TIME PROBE #2 — the PREDICTION-FREE one, added 2026-07-29 with the
 * freshness gate on the opening.
 *
 * The defect it exists to prevent is not hypothetical: the REPLACE branch used
 * to emit "Your latest analysis is still current" on turns where the caller had
 * just told it currency could NOT be established — including this module's own
 * caller forcing `conditionsAreCurrent = false` on a failed input read. A
 * fabrication in the mouth of the guard whose job is honesty.
 *
 * ⚠ IT CARRIES ITS OWN POSITIVE CONTROL, and that is the load-bearing half.
 * An absence assertion whose instrument cannot see a presence passes by testing
 * nothing (trap #13, and trap 12b: a control that can only pass is not a
 * control). So the probe asserts BOTH directions:
 *
 *   - the currency-UNKNOWN opening must NOT match the pattern; and
 *   - the currency-ASSERTING opening MUST match it.
 *
 * Reword the first to sneak a currency claim in and the first arm throws.
 * Weaken the pattern to make the first arm vacuous and the second arm throws.
 */
function assertCurrencyIsClaimedOnlyWhenVerified(): void {
  if (CURRENCY_ASSERTION_PATTERN.test(WITHHELD_EXPLANATION_OPENING_CURRENCY_UNKNOWN)) {
    throw new Error(
      'withheld-explanation-answer: WITHHELD_EXPLANATION_OPENING_CURRENCY_UNKNOWN asserts that ' +
        'the analysis is up to date. That copy is emitted precisely when currency could NOT be ' +
        'established (stale / unknown / none / no readiness / a failed input read), so the ' +
        'sentence would be false on its entire population. Reword the copy — do not narrow ' +
        'CURRENCY_ASSERTION_PATTERN, which is what keeps this invariant readable.',
    );
  }
  if (!CURRENCY_ASSERTION_PATTERN.test(WITHHELD_EXPLANATION_OPENING)) {
    throw new Error(
      'withheld-explanation-answer: the POSITIVE CONTROL failed — WITHHELD_EXPLANATION_OPENING ' +
        'no longer trips CURRENCY_ASSERTION_PATTERN, so the absence check above is now vacuous ' +
        'and would pass on copy that fabricates currency. Either the opening was reworded (then ' +
        'update the pattern to match what it now claims) or the pattern was weakened (then ' +
        'restore it). Do not delete this arm.',
    );
  }
}
assertCurrencyIsClaimedOnlyWhenVerified();
