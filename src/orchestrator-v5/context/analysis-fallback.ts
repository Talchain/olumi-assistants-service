import { withReadTimeHorizonGate } from '../goal-target/goal-horizon-verdict.js';
/**
 * Is a prior `run_analysis` fact projectable? The chip floor's one question
 * (`compose/chip-generator.ts`): offer the executable `what_would_flip` chip, or
 * the plain prompt chip.
 *
 * ⚠ DELETION 10 (track2, 22 Oct 2026): this module used to BUILD the
 * prior-facts analysis summary (`buildAnalysisFromPriorFacts`, plus the
 * top-level driver / fragile-edge overrides and the signal reconcile seam). Its
 * only served caller compared the result with `null` and discarded it, so the
 * summary and everything only it used were deleted. What remains is that
 * builder cut off at its null decision, with the SAME steps in the SAME order —
 * select the fact, the read-time horizon gate, the goal-probability
 * projection, the unknown-key tripwire, `compactAnalysis` — so the boolean and
 * the side effects (the tripwire log, compactAnalysis's warnings) are
 * unchanged. Every step after the decision only built the discarded value. The
 * original is kept in `evidence/track2-deletion10-20261022/deleted/`.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { compactAnalysis } from '../../orchestrator/context/analysis-compact.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import { selectRunAnalysisFact } from './freshness.js';
import { emitUnknownEnrichmentKeyTelemetry } from './enrichment-manifest.js';
import { projectGoalProbabilitiesForTransport } from '../compose/goal-probability-transport.js';

/**
 * True exactly when the deleted `buildAnalysisFromPriorFacts(priorFacts, undefined)`
 * returned non-null: a successful run_analysis fact is selected AND either
 * (a) its stored enrichment is a plain object and `compactAnalysis` returns
 * options, or (b) it declares a leading option, or (c) its `win_probabilities`
 * has at least one entry. "A successful fact exists" is NOT equivalent: a fact
 * with none of (a)–(c) was null.
 */
export function hasBuildableAnalysisProjection(priorFacts: readonly HandlerFact[]): boolean {
  const selected = selectRunAnalysisFact(priorFacts);
  if (!selected) return false;
  const fact = selected.fact;
  if (fact.fact_type !== 'run_analysis') return false; // narrow for the type checker

  const result = withReadTimeHorizonGate(fact.result, undefined, fact.result.enrichment);
  const enrichment = result.enrichment;
  const enrichmentRecord =
    enrichment && typeof enrichment === 'object' && !Array.isArray(enrichment)
      ? projectGoalProbabilitiesForTransport(enrichment as Record<string, unknown>, result.goal_certainty) ?? null
      : null;
  if (enrichmentRecord !== null) {
    // Runtime tripwire (context-audit #1): a top-level key PLoT emits that is
    // not in ENRICHMENT_PRODUCER_MANIFEST is logged here — observe-only, never
    // throws, never blocks.
    emitUnknownEnrichmentKeyTelemetry(enrichmentRecord);
  }
  const fromEnrichment =
    enrichmentRecord !== null
      ? compactAnalysis(enrichmentRecord as unknown as V2RunResponseEnvelope)
      : null;
  if (fromEnrichment !== null && fromEnrichment.options.length > 0) return true;

  return Boolean(result.leading_option_id) || Object.entries(result.win_probabilities ?? {}).length > 0;
}
