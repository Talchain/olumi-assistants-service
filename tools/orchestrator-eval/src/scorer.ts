/**
 * orchestrator-eval — deterministic scorer wrapper.
 *
 * Aggregates three dimensions into a pass/fail verdict for one candidate:
 *   1. no_forbidden_terms   (PRODUCTION guard) — findForbiddenMatches
 *   2. no_mutation_language (PRODUCTION guard) — containsMutationLanguage
 *   3. no_goal_fit_conflation (eval assertion) — detectGoalFitConflation
 *
 * Dimensions 1–2 are imported wholesale from the runtime (see guards.ts); the
 * eval never re-specifies them. Dimension 3 is this pack's worked assertion,
 * grounded in the fixture's assembled numbers. The verdict is deterministic and
 * offline — no LLM call. A paid judge can be layered on later (see judge-seam.ts)
 * but the deterministic verdict always stands on its own.
 */

import type { ContextPackAnalysis } from '../../../src/orchestrator-v5/context/context-pack-assembler.js';
import { findForbiddenMatches, containsMutationLanguage } from './guards.js';
import { detectGoalFitConflation } from './goal-fit-conflation.js';
import type { CandidateResponse, DimensionResult, ScoreResult } from './types.js';

export function scoreCandidate(
  raw: ContextPackAnalysis,
  candidate: CandidateResponse,
): ScoreResult {
  const text = candidate.text;
  const dimensions: DimensionResult[] = [];

  // 1. Production guard — forbidden user-facing phrases / raw-id / hash / dev leaks.
  const forbidden = findForbiddenMatches(text);
  dimensions.push({
    name: 'no_forbidden_terms',
    pass: forbidden.length === 0,
    source: 'production-guard',
    detail: forbidden.length === 0 ? 'clean' : `hits: ${forbidden.join(', ')}`,
  });

  // 2. Production guard — no false mutation-claim language on a non-edit turn.
  const mutation = containsMutationLanguage(text);
  dimensions.push({
    name: 'no_mutation_language',
    pass: !mutation,
    source: 'production-guard',
    detail: mutation ? 'reads as an unbacked graph mutation' : 'clean',
  });

  // 3. Eval assertion — win% not narrated as target attainment (the worked defect).
  const conflation = detectGoalFitConflation(raw, text);
  dimensions.push({
    name: 'no_goal_fit_conflation',
    pass: !conflation.conflated,
    source: 'eval-assertion',
    detail: conflation.conflated
      ? `win ${conflation.grounding.winPercent}% narrated as target attainment: "${conflation.evidence[0]}"`
      : 'win% and target-fit kept distinct',
  });

  const pass = dimensions.every((d) => d.pass);
  return { candidate: candidate.label, pass, dimensions };
}
