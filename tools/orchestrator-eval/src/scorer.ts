/**
 * orchestrator-eval — deterministic scorer wrapper.
 *
 * Aggregates six dimensions into a pass/fail verdict for one candidate:
 *   1. no_forbidden_terms   (PRODUCTION guard) — findForbiddenMatches
 *   2. no_mutation_language (PRODUCTION guard) — containsMutationLanguage
 *   3. no_goal_fit_conflation (eval assertion) — detectGoalFitConflation
 *   4. no_held_science_vocabulary (eval assertion) — detectHeldScience
 *   5. no_false_success_claim (PRODUCTION guard) — findSuccessClaimHit
 *   6. substance_present (eval assertion) — non-empty prose
 *
 * Dimension 6 exists because 1-5 are all ABSENCE checks: an EMPTY answer
 * passes every one of them, so without a substance floor the pack —
 * repurposed as a RANKING (SEAM-1) — literally rewards emptiness. Empty
 * answer_text is the live prompt-defect class measured pre-v42.2g (0/6
 * populated); a candidate that regresses to empty text must FAIL, not win.
 *
 * Dimensions 1, 2, and 5 are imported wholesale from the runtime (see
 * guards.ts); the eval never re-specifies them. Dimensions 3 and 4 are this
 * pack's worked assertions — 4 (D5) deliberately does NOT re-export the
 * runtime's `HELD_SCIENCE_VOCABULARY_PATTERN` (see guards.ts / held-science.ts
 * for why: that pattern bans words the orchestrator terminology map mandates).
 * The verdict is deterministic and offline — no LLM call. A paid judge can be
 * layered on later (see judge-seam.ts) but the deterministic verdict always
 * stands on its own.
 */

import type { ContextPackAnalysis } from '../../../src/orchestrator-v5/context/context-pack-assembler.js';
import { findForbiddenMatches, containsMutationLanguage, findSuccessClaimHit } from './guards.js';
import { detectGoalFitConflation } from './goal-fit-conflation.js';
import { detectHeldScience } from './held-science.js';
import { finaliseScore, type CandidateResponse, type DimensionResult, type ScoreResult } from './types.js';

export function scoreCandidate(
  raw: ContextPackAnalysis,
  candidate: CandidateResponse,
): ScoreResult {
  const text = candidate.text;
  // Built without `status`, then finalised below. The routing pack has no
  // `not_applicable` dimension — every one of its six rules applies to every
  // turn — so its statuses derive straight from `pass`. The decision_review
  // pack, whose rules CAN be inapplicable, sets `status` explicitly.
  const dimensions: Array<Omit<DimensionResult, 'status'>> = [];

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

  // 4. Eval assertion — D5 held-science: raw metric tokens / raw score decimals
  // surfacing where the terminology map requires plain-language framing only.
  const heldScience = detectHeldScience(text);
  dimensions.push({
    name: 'no_held_science_vocabulary',
    pass: !heldScience.held,
    source: 'eval-assertion',
    detail: heldScience.held ? `hit: "${heldScience.evidence}"` : 'clean',
  });

  // 5. Production guard — D6 false-success: a done/updated/applied claim before
  // any confirmation exists (the mutation-receipt honesty class).
  const falseSuccess = findSuccessClaimHit(text);
  dimensions.push({
    name: 'no_false_success_claim',
    pass: falseSuccess === null,
    source: 'production-guard',
    detail: falseSuccess === null ? 'clean' : `hit: "${falseSuccess}"`,
  });

  // 6. Eval assertion — SUBSTANCE: dimensions 1-5 are absence checks, which
  // an empty answer passes vacuously. Empty/whitespace-only prose is a failed
  // turn (the pre-v42.2g empty-answer_text defect class), never a clean one.
  const substantive = text.trim().length > 0;
  dimensions.push({
    name: 'substance_present',
    pass: substantive,
    source: 'eval-assertion',
    detail: substantive ? 'non-empty prose' : 'empty/whitespace-only text — an empty answer is a failed turn, not a clean one',
  });

  return finaliseScore(
    candidate.label,
    dimensions.map((d) => ({ ...d, status: d.pass ? ('pass' as const) : ('fail' as const) })),
  );
}
