/**
 * ⭐ THE TURN-ENTRY CLAIM-SAFETY RESOLVER — ROADMAP 1.233 finish-line
 * criterion 2, and the mechanism 1.349 P1-2 asked for instead of six patches.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES, and why it is a MECHANISM and not a set of edits.
 *
 * Every non-execute exit in `route-v2.ts` handed the finaliser a LITERAL
 * `mayNameLeadingOption: true`, under this comment, repeated verbatim at
 * seventeen call sites:
 *
 *     "this path runs no analysis, so it withheld no leading-option claim.
 *      `true` is the honest statement of that, not a fail-open."
 *
 * The premise is FALSE, and its falseness is the whole point:
 * **the permission belongs to the FACT THE RESPONSE DISPLAYS, not to the work
 * THIS turn performed.** An edit turn receives the prior analysis as context
 * (`edit-graph-dispatch.ts` takes request-supplied prior analysis), so an edit
 * response can talk about an analysis whose own verdict withheld the leader
 * claim. Live-confirmed 28 Jul: after a withheld analysis
 * (`may_name_leading_option: false`) an EDIT turn came back `true`.
 *
 * "This turn ran no analysis" and "this turn displays no analysis" are
 * DIFFERENT CLAIMS. The comment asserted the first; the code relied on it for
 * the second. Because the Layer-3 egress guard short-circuits on `true`
 * (`leading-option-egress-guard.ts` — `if (opts.mayNameLeadingOption) return
 * response`), a `true` here does not merely fail to help: it is an explicit,
 * LICENSED instruction to the alarm not to look.
 *
 * ⚠ WHY A RESOLVER RATHER THAN SEVENTEEN CORRECTED LITERALS. Because a
 * corrected literal is a hand-maintained mirror (CLAUDE.md trap #12), and the
 * estate has already watched this exact one drift: `route-v2.ts:2206` carries a
 * comment stating that "the ROADMAP 1.233 hoist removed [the default]
 * everywhere else" — written in good faith, and false at every one of the
 * seventeen sites the moment it was written. The eighteenth exit anyone adds
 * would have copied the same literal and the same comment. So the literal is
 * removed as a CONSTRUCT: exits inherit, and a drift test pins that no literal
 * can regrow.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ NOT A SECOND DERIVATION (CLAUDE.md trap #12). This module contains no
 * selection and no verdict logic. It fetches the same inputs the execute path
 * fetches (`buildTurnContext`) and hands them to the SAME canonical function
 * (`readMayNameLeadingOptionVerdict`) with the SAME scope builder
 * (`claimSafetyScopeFromContext`). It is a third READ POINT, which the
 * claim-safety module's own header explicitly sanctions — "Two read points is
 * fine. Two DERIVATIONS is the defect" — and a future fourth caller gets the
 * same answer by construction.
 *
 * ⚠ IT DOES NOT REPLACE #737's POST-DISPATCH RE-READ, and the two must not be
 * confused. The execute path re-reads the verdict AFTER this turn's new facts
 * commit, which is correct and is a different question ("what does the fact
 * this turn just wrote say?"). This resolver answers the ENTRY question ("what
 * does the scenario's existing displayed fact say?") for the exits that return
 * before any dispatch and therefore bypass the derivation entirely. The two
 * exits that already inherit a real verdict — `turn_executor` (via
 * `run.mayNameLeadingOption`) and `chip_click` (via `cc.mayNameLeadingOption`)
 * — are deliberately left alone.
 *
 * ⭐ LAZY AND MEMOISED, both load-bearing:
 *
 *   - LAZY, so the hot path pays nothing. `turn_executor` never calls this
 *     resolver (it carries its own post-dispatch verdict), so the common turn
 *     shape is byte- and cost-identical to before. The cost lands only on
 *     turns that actually take an early exit — turns that by definition make no
 *     LLM call and have the latency budget for one read.
 *   - MEMOISED, so an exit cannot be reached twice and answer twice. Exactly
 *     one `sendFinalised200` runs per turn today, so the memo is belt-and-
 *     braces rather than load-bearing — but it is what makes "one derivation
 *     per turn" true by construction rather than by call-graph audit.
 *
 * ⭐ FAIL-CLOSED, ALWAYS, AND IT IS CHEAP HERE. A read failure or an absent
 * turn context yields `false` with the honest `fail_closed_no_turn_context`
 * provenance — never `true`. The cost of a wrong `false` is bounded and
 * non-destructive: the egress guard is OBSERVE-ONLY today (it reports hits and
 * returns the response un-cloned), so a spurious `false` buys a scan and
 * possibly a log line, and cannot alter a single wire byte. The cost of a
 * wrong `true` is a disarmed alarm on a real leak. The asymmetry is not close.
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { buildTurnContext } from '../build-turn-context.js';
import { log } from '../../utils/telemetry.js';
import {
  claimSafetyScopeFromContext,
  readMayNameLeadingOptionVerdict,
} from './claim-safety-read.js';
import type { MayNameLeadingOptionVerdict } from './claim-safety-read.js';

/**
 * The claim-safety fields a `sendFinalised200` exit must state.
 *
 * Returned as ONE object so an exit spreads it and cannot supply the boolean
 * while forgetting the provenance — the pairing that made the pre-fix wire
 * unfalsifiable (a `true` with a `null` provenance is indistinguishable from a
 * `true` that read a permitting fact).
 */
export interface ClaimSafetyExitStamp {
  readonly mayNameLeadingOption: boolean;
  readonly mayNameLeadingOptionProvenance: MayNameLeadingOptionVerdict['provenance'];
}

/**
 * The fail-closed answer. Shared by both "we could not look" situations so the
 * degraded path and the no-context path cannot drift into different bytes.
 */
const NO_TURN_CONTEXT_VERDICT: MayNameLeadingOptionVerdict = {
  may_name_leading_option: false,
  // No fact was read, so there is no state to report. `null` is the honest
  // "not recorded"; inventing a cause for a withhold whose entire justification
  // is that we could not look would be a fabricated one.
  constraint_verdict_state: null,
  provenance: 'fail_closed_no_turn_context',
};

export interface TurnClaimSafetyResolver {
  /**
   * The verdict for this turn, derived once and reused. Every non-execute exit
   * spreads the result into its `sendFinalised200` ctx.
   */
  forExit(): Promise<ClaimSafetyExitStamp>;
}

/**
 * Build the per-turn resolver at TURN ENTRY.
 *
 * @param payload the validated ingress. `kind: 'system_event'` is passed as
 *   `null` by the caller — see {@link NO_TURN_CONTEXT_VERDICT} and the
 *   `fail_closed_no_turn_context` docstring for why that family cannot derive
 *   and must therefore withhold.
 */
export function createTurnClaimSafetyResolver(
  payload: MessageTurnPayload | null,
  requestId: string,
): TurnClaimSafetyResolver {
  // The memo is a PROMISE, not a value: two concurrent exits (impossible
  // today, but not a property this module should depend on) would otherwise
  // each start their own read and the second would discard the first's answer.
  let memo: Promise<MayNameLeadingOptionVerdict> | null = null;

  async function resolve(): Promise<MayNameLeadingOptionVerdict> {
    if (payload === null) return NO_TURN_CONTEXT_VERDICT;
    try {
      const context = await buildTurnContext(payload, requestId);
      // THE canonical derivation — the same two arguments the execute path
      // passes at `turn-executor.ts`. Nothing is re-derived or mirrored here.
      return readMayNameLeadingOptionVerdict(
        context.prior_facts,
        claimSafetyScopeFromContext(context),
      );
    } catch (err) {
      // FAIL CLOSED and SAY SO. A swallowed read failure that returned `true`
      // is the shape of every defect in this workstream; a swallowed read
      // failure that returns `false` silently is only marginally better,
      // because the next walk cannot tell it from a real withhold. The
      // provenance on the wire is what tells them apart.
      log.warn(
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 claim safety — turn-context read failed at an early exit; withholding the leading-option permission',
      );
      return NO_TURN_CONTEXT_VERDICT;
    }
  }

  return {
    async forExit(): Promise<ClaimSafetyExitStamp> {
      memo ??= resolve();
      const verdict = await memo;
      return {
        mayNameLeadingOption: verdict.may_name_leading_option,
        mayNameLeadingOptionProvenance: verdict.provenance,
      };
    },
  };
}
