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
 * ⭐ FAIL-CLOSED WHERE THIS MODULE DECIDES. The result contributes to final
 * composed analysis authority, and the final wire gate can alter a categorical
 * designation when that authority withholds it. A spurious `true` would license
 * a real leak; a spurious `false` can suppress a designation, so the selected-
 * fact and final-state controls must accompany every fail-closed arm.
 *
 * ⭐ A DEGRADED STORE NOW WITHHOLDS IN THE ONE CANONICAL DERIVATION. Measured,
 * not assumed:
 *
 *   - `buildTurnContext` NEVER THROWS on a read failure. Every fetch inside it
 *     is individually guarded and degrades to an empty/null value. So the
 *     `catch` below is genuinely DEFENSIVE and has no known reachable trigger;
 *     it is kept because an unguarded `await` at a claim-safety seam is not a
 *     risk worth taking, not because it is a live guarantee.
 *   - A degraded WINDOW read is safe for a different reason than fail-closing:
 *     the scenario-scoped read still supplies the fact, so the verdict is a
 *     real `scenario_fact`. Pinned.
 *   - A FULLY degraded store (window AND count AND scenario read all failing)
 *     yields `false` / `fail_closed_unavailable`, even on a short scenario.
 *     Non-truncation cannot turn unread facts into authoritative emptiness: an
 *     older malformed row can invalidate the page while a valid withheld
 *     analysis exists. The change lives in `readMayNameLeadingOptionVerdict`,
 *     so execute and non-execute exits share the same conservative answer.
 *
 * This module still does not patch locally. It consumes the one canonical
 * derivation, avoiding the second-derivation defect it exists to prevent.
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { GraphV3T } from '../../schemas/cee-v3.js';

import { buildTurnContext } from '../build-turn-context.js';
import { log } from '../../utils/telemetry.js';
import {
  claimSafetyScopeFromContext,
  readMayNameLeadingOptionVerdict,
} from './claim-safety-read.js';
import type { MayNameLeadingOptionVerdict } from './claim-safety-read.js';
import type { FreshnessDerivation } from './freshness.js';
import {
  readOptionComparisonsFromRunAnalysisFact,
  readRawRobustnessFromRunAnalysisFact,
  type RawOptionComparisonSignal,
  type RawRobustnessSignals,
} from '../coaching/pick-raw-robustness.js';

/**
 * The fields a non-execute `sendFinalised200` exit must state, all derived from
 * ONE memoised turn-context read.
 *
 * Returned as ONE object so an exit spreads it and cannot supply the boolean
 * while forgetting the provenance — the pairing that made the pre-fix wire
 * unfalsifiable (a `true` with a `null` provenance is indistinguishable from a
 * `true` that read a permitting fact).
 *
 * ⚠ RENAMED FROM `ClaimSafetyExitStamp` (ROADMAP 2.1264, PR #1004 review), and
 * the rename is the honest half of the change. This object now carries a
 * freshness derivation as well as the claim-safety verdict, and a name saying
 * "claim safety" over a member that is not about claim safety is the
 * two-concepts-one-name defect this estate keeps paying for (trap 21).
 *
 * WHY THE FRESHNESS RIDES HERE rather than in a second resolver: `resolve()`
 * below already awaits `buildTurnContext`, which already computes the
 * persisted-graph freshness derivation. A second reader would mean a second
 * fact read AND a second authority that could disagree with this one about the
 * same turn. One read, one context, one derivation, carried together.
 */
export interface TurnExitStamp {
  readonly mayNameLeadingOption: boolean;
  readonly mayNameLeadingOptionProvenance: MayNameLeadingOptionVerdict['provenance'];
  /** Robustness from the same scenario fact selected by exit freshness. */
  readonly rawRobustness: RawRobustnessSignals | null;
  /** Comparisons from that same selected fact; never reconstructed from body copy. */
  readonly rawOptionComparisons: readonly RawOptionComparisonSignal[] | null;
  /** Persisted reasoning graph from this resolver snapshot, for graphless exits only. */
  readonly exitReasoningGraph?: GraphV3T | null;
  /**
   * The turn context's persisted-graph analysis-freshness derivation, for the
   * `analysis_state` stamped at this exit.
   *
   * ⚠ DELIBERATELY NOT NAMED `freshness`. Four graph-bearing exits spread this
   * object AND set `freshness` themselves, and the KEY ORDER DIFFERS BETWEEN
   * THEM — `system_event` and `chip_click` set it BEFORE the spread,
   * `draft_graph` and `edit_graph` after. A member called `freshness` here would
   * therefore have silently overridden two of those exits' real per-turn
   * derivations with a derivation about the PERSISTED graph. The distinct name
   * makes that collision unrepresentable and moves precedence into the
   * finaliser, where it is stated once and explicitly.
   *
   * ABSENT when there was no turn payload to read (the `system_event` family
   * passes `null`) — a genuine "nothing was looked at", distinct from a read
   * that looked and found nothing (`freshness: 'none'`) and from a read that
   * failed (`reason: 'derivation_failed'`).
   */
  readonly exitFreshness?: FreshnessDerivation;
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

/**
 * The freshness derivation for a turn whose context read THREW.
 *
 * `derivation_failed` is this vocabulary's own word for "the dispatcher
 * attempted derivation and failed (session-store error, bad graph parse)", and
 * the `analysis_state` composer maps it to `unknown_degraded` /
 * `store_unreadable`. Emitting it is strictly more honest than letting the
 * stamp fall back to "no graph was in scope": we DID have a graph in scope and
 * we could not read the store, which is a different sentence with a different
 * remedy. It must never read `none` — a failed read that claims "this scenario
 * has never been analysed" is the positive claim `prior_facts_read_ok` exists to
 * prevent.
 */
const CONTEXT_READ_FAILED_DERIVATION: FreshnessDerivation = Object.freeze({
  freshness: 'unknown',
  reason: 'derivation_failed',
  selected_fact_index: null,
  graph_hash_at_run: null,
  current_graph_hash: null,
  computed_at: null,
});

/** The one memoised read's two answers, kept together (see {@link TurnExitStamp}). */
interface ResolvedTurnExit {
  readonly verdict: MayNameLeadingOptionVerdict;
  readonly freshness?: FreshnessDerivation;
  readonly rawRobustness: RawRobustnessSignals | null;
  readonly rawOptionComparisons: readonly RawOptionComparisonSignal[] | null;
  readonly reasoningGraph?: GraphV3T | null;
}

export interface TurnClaimSafetyResolver {
  /**
   * The verdict for this turn, derived once and reused. Every non-execute exit
   * spreads the result into its `sendFinalised200` ctx.
   */
  forExit(): Promise<TurnExitStamp>;
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
  let memo: Promise<ResolvedTurnExit> | null = null;

  async function resolve(): Promise<ResolvedTurnExit> {
    // No payload ⇒ nothing was looked at. NO freshness is carried, which is
    // distinct from a read that looked and found nothing.
    if (payload === null) {
      return {
        verdict: NO_TURN_CONTEXT_VERDICT,
        rawRobustness: null,
        rawOptionComparisons: null,
      };
    }
    try {
      const context = await buildTurnContext(payload, requestId);
      const freshness = context.persisted_analysis_freshness;
      const scenarioAnalysisFacts = context.scenario_analysis_fact_set?.facts ?? [];
      const selectedFact =
        freshness.freshness === 'fresh' && freshness.selected_fact_index !== null
          ? scenarioAnalysisFacts[freshness.selected_fact_index]
          : undefined;
      // THE canonical derivation — the same two arguments the execute path
      // passes at `turn-executor.ts`. Nothing is re-derived or mirrored here.
      return {
        verdict: readMayNameLeadingOptionVerdict(
          context.prior_facts,
          claimSafetyScopeFromContext(context),
        ),
        // NOT a second derivation: the context computed this from the same
        // facts, the same persisted-graph hash and the same degraded-read flag
        // it hands `deriveCoachingState`. Read, never recomputed (trap 12).
        freshness,
        rawRobustness: readRawRobustnessFromRunAnalysisFact(selectedFact),
        rawOptionComparisons: readOptionComparisonsFromRunAnalysisFact(selectedFact),
        reasoningGraph: context.persistedGraph,
      };
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
      // SAY WHICH KIND OF IGNORANCE THIS IS. The verdict fails closed as before;
      // the freshness reports a FAILED read rather than letting the exit's
      // `analysis_state` claim no graph was in scope.
      return {
        verdict: NO_TURN_CONTEXT_VERDICT,
        freshness: CONTEXT_READ_FAILED_DERIVATION,
        rawRobustness: null,
        rawOptionComparisons: null,
        reasoningGraph: null,
      };
    }
  }

  return {
    async forExit(): Promise<TurnExitStamp> {
      memo ??= resolve();
      const resolved = await memo;
      return {
        mayNameLeadingOption: resolved.verdict.may_name_leading_option,
        mayNameLeadingOptionProvenance: resolved.verdict.provenance,
        rawRobustness: resolved.rawRobustness,
        rawOptionComparisons: resolved.rawOptionComparisons,
        ...(resolved.reasoningGraph !== undefined
          ? { exitReasoningGraph: resolved.reasoningGraph }
          : {}),
        // Spread conditionally: an exit with no derivation carries NO key, so
        // "not read" stays distinguishable from every derived verdict.
        ...(resolved.freshness !== undefined ? { exitFreshness: resolved.freshness } : {}),
      };
    },
  };
}
