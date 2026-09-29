/**
 * V5 coaching — pick the LEADING OPTION IDENTITY from the SAME `run_analysis`
 * fact that the freshness / projection / robustness / flip layers selected.
 *
 * Mirrors `pickLatestFlipSummary` and `pickLatestRawRobustness` exactly, and
 * for the same reason: every grounding layer must read one fact. A leader id
 * read off a DIFFERENT run than the flip rows it is compared against would let
 * the option-targeted composer decide "is the target the current leader?"
 * against a run whose leader has since changed.
 *
 * IDENTITY, not label. `AnalysisProjectionSummary.leading_option` carries only a
 * `label`, and two options can share one (the collision case UI #492's resolver
 * had to handle). Comparing a resolved target id against a label would fold two
 * distinct options together — the exact class this whole lane exists to avoid.
 * `extractAnalysedLeaderId` reads `result.leading_option_id`, which
 * `run-analysis.ts:selectLeadingOptionId` populates with a real option id.
 *
 * Returns `null` when there is no successful `run_analysis` fact, or when the
 * fact records no unambiguous leader (a tie leaves the field empty). `null` is
 * "we do not know", never "there is no leader" — the caller must treat it as
 * unknown and refuse to presuppose the target's position.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { selectRunAnalysisFact } from '../context/freshness.js';
import { extractAnalysedLeaderId } from '../context/option-identity.js';

export function pickLatestLeadingOptionId(
  priorFacts: readonly HandlerFact[],
): string | null {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null) return null;
  return extractAnalysedLeaderId(selected.fact);
}
