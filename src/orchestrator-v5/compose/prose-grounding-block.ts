/**
 * SHIP THE FACT THE PROSE WAS BUILT FROM.
 *
 * THE DEFECT THIS CLOSES. On a substantive coach / converse turn the model is
 * handed `display_analysis` — a projection of a persisted `run_analysis` fact
 * built by `buildAnalysisFromPriorFacts` — and the routing prompt carries an
 * explicit rendering rule for it (`Win probability: "leads in 69% of
 * simulations"`). The figure is therefore SERVER-COMPUTED and SERVER-RENDERED
 * before the model sees it; only the wording is model-authored. The same
 * response then shipped `blocks: []`, because the two channels are fed by
 * different code paths:
 *
 *   prose  — context-pack-assembler → formatAnalysisForContext → the prompt
 *   blocks — `buildBlocksFromFacts`, reached ONLY from `composeToolCallResponse`
 *
 * `composeDirectAnswerResponse` — the composer every coach / converse turn uses
 * — consults no facts at all; it emits whatever `blocks` its caller passes, and
 * every caller passed nothing. So on this whole turn class the `analysis_result`
 * block was not suppressed by a rule. It was STRUCTURALLY UNREACHABLE.
 *
 * The user-visible cost is not the missing block. It is that the assistant
 * asserts a quantified comparative claim ("leads in 74% of simulated runs")
 * that arrives beside NO machine-readable statement of the same fact — so a
 * consumer cannot check the sentence it is rendering, and the 73 UI consumers
 * of `win_probability` receive nothing on the turn that talks about it most.
 *
 * WHAT THIS DOES NOT DO, and each omission is deliberate.
 *
 * 1. IT DOES NOT ALIGN THE LEADER-NAMING AUTHORITIES. Three producers answer
 *    three DIFFERENT questions here — does the MODEL license a claim
 *    (`claim_safety.may_name_leading_option`), is THIS TURN entitled
 *    (`mayNameLeadingOption`), and can a consumer of THIS PAYLOAD verify both
 *    halves (`leader_claim.permitted`). They are correct as separate questions,
 *    and #709/#737 reopened a live defect by reconciling their defaults. This
 *    change touches none of them. It makes the THIRD question ANSWERABLE by
 *    putting the evidence on the payload the third question is scoped to —
 *    which is the opposite of making it agree with the other two.
 *
 * 2. IT DOES NOT MAKE `readRawRobustnessFromResponseBody` READ THE FACT. That
 *    reader's wire-scoping is a RAIL, stated at its own docstring: when the
 *    withheld-claim projection has redacted `near_tie`, the separation half is
 *    genuinely unknown TO THE CONSUMER and `leader_claim` must say so rather
 *    than assert a separation the payload no longer carries. Threading the fact
 *    in behind it as a fallback would let the claim assert exactly that. The
 *    honest repair is upstream: put the evidence on the wire and let the
 *    unchanged reader find it. If the projection redacts it, the reader still
 *    reads null and the claim still fails closed — correctly.
 *
 * 3. IT DOES NOT SHIP A BLOCK ON A NON-FRESH TURN. `buildLifecycleBlocksFromPrior`
 *    already ratified this rule for the prior-fact path: FRESH emits the result
 *    block, `stale` emits only the rerun coaching block, `unknown` / `none`
 *    emit nothing. This helper is gated identically, so the two prior-fact
 *    surfaces state one rule rather than two.
 *
 *    ⚠ NOTE THE ASYMMETRY WITH THE PROSE CHANNEL, because it is deliberate and
 *    it is NOT a divergence to reconcile. `formatAnalysisForContext` QUALIFIES
 *    on a non-fresh turn — it keeps the figures and attaches an in-band
 *    staleness disclosure — and that is adjudicated ("QUALIFIES, never
 *    withholds": the coach still needs the prior run to explain what re-running
 *    would update). A structured `analysis_result` block has no such register.
 *    It is rendered by the Results surface as THE result, and it carries no
 *    slot in which "this predates your last edit" can be said. Prose can
 *    qualify a figure; a block can only assert one. So the same verdict
 *    correctly produces a qualified sentence and no block.
 *
 * 4. IT FABRICATES NOTHING WHEN THE FACT IS THIN. `enrichment.robustness` is
 *    genuinely nullable — `pickLatestRawRobustness` has three null exits (no
 *    enrichment object; enrichment present but `robustness` not an object;
 *    `robustness` present but carrying neither a non-empty `level` nor
 *    `near_tie.is_tie === true`). This helper never synthesises it: it ships
 *    the block the fact supports, and when the fact carries no robustness the
 *    leader claim stays `separation_unavailable`, which is the true statement
 *    that nothing was measured.
 *
 * 5. IT ADDS NO NEW PROJECTION. The block is built by the SAME
 *    `buildAnalysisResultBlock` the tool-call and prior-fact paths use, so the
 *    unrequested-analysis confinement (`confineUnrequestedAnalysisBlock`, which
 *    strips the per-option win probability and the robustness verdict on a run
 *    the user did not ask for) applies here unchanged and without being
 *    restated. A second projection here would be the hand-maintained mirror.
 *    CONSEQUENCE, stated rather than left to be discovered: on an UNREQUESTED
 *    run the confinement removes exactly the fields `leader_claim` needs, so
 *    the claim correctly remains `separation_unavailable` even though a block
 *    shipped. This change closes the leader-claim gap on user-initiated runs;
 *    it does not close it on unrequested ones, and must not.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { FreshnessDerivation } from '../context/freshness.js';
import { buildAnalysisResultBlock } from '../compose.js';

/**
 * The freshness verdict on which a prior analysis may be re-presented as a
 * structured result. DERIVED as a literal comparison against the same token
 * `buildLifecycleBlocksFromPrior` branches on, rather than a second enum.
 */
const FRESH: FreshnessDerivation['freshness'] = 'fresh';

export interface ProseGroundingBlockInput {
  /**
   * The run fact the model-facing `display_analysis` projection was built from,
   * or null when the prose carried no projected analysis. MUST be the fact the
   * prose used — the caller co-assigns it with the projection, over one array
   * through one selector.
   */
  readonly sourceFact: RunAnalysisHandlerFact | null;
  /**
   * The freshness derivation for the SAME array `sourceFact` was selected from
   * (`promptAnalysisFreshness`, derived over the durable scenario fact set) —
   * never the routing or post-dispatch derivation, which are verdicts about
   * different arrays.
   */
  readonly freshness: FreshnessDerivation | null;
}

/**
 * The blocks a substantive prose turn may ship to ground its own figures.
 *
 * Returns `[]` — byte-identical to today — on every turn that did not project
 * an analysis into the prompt, and on every non-fresh turn.
 */
export function buildProseGroundingBlocks(
  input: ProseGroundingBlockInput,
): readonly OlumiResponse['blocks'][number][] {
  const fact = input.sourceFact;
  if (fact === null) return [];
  // Fail closed on an absent derivation, matching the rule the flip-point
  // licence and `classifyClaimUsable` already apply: anything but the literal
  // 'fresh' — including absence — keeps the band.
  if (input.freshness === null || input.freshness.freshness !== FRESH) return [];
  return [buildAnalysisResultBlock(fact)];
}

/**
 * Narrow a selected fact to a `run_analysis` fact. Exported so the caller does
 * not re-implement the discriminant check at its assignment site.
 */
export function asRunAnalysisFact(
  fact: HandlerFact | null | undefined,
): RunAnalysisHandlerFact | null {
  if (fact === null || fact === undefined) return null;
  return fact.fact_type === 'run_analysis' ? (fact as RunAnalysisHandlerFact) : null;
}
