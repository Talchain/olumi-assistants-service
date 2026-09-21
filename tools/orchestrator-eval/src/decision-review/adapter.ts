/**
 * orchestrator-eval — the `decision_review` task adapter.
 *
 * The second implementation of `EvalTaskAdapter`, and the reason the seam
 * exists. Everything the chassis guarantees — the fail-closed double-opt-in
 * live gate, the pre-call 24-turn cap, `mock:` zero-network playback,
 * fail-closed extraction, the ranking-key invariants — is inherited unchanged;
 * this file supplies only the three task-specific steps.
 *
 * REQUEST: `buildRequest` puts the CANDIDATE PROMPT in the system slot and the
 * PRODUCTION-assembled user message in the user slot. That is the runtime's own
 * arrangement (`invokeDecisionReview`: `getSystemPrompt('decision_review')` as
 * system, `buildDecisionReviewUserMessage(...)` as user), so a candidate is
 * measured in the position it will actually occupy — not, as the graph-evaluator
 * adapter does, against a `JSON.stringify` of the fixture with a hardcoded DSK
 * block bolted on.
 *
 * NOT REPRODUCED, deliberately: `invokeDecisionReview` also injects a
 * `<SCIENCE_CLAIMS>` section built by `buildScienceClaimsSection()` when the
 * served prompt lacks one. That builder reads the DSK registry through runtime
 * config, so calling it here would make the offline default path depend on
 * config state — and the served v14 prompt is scored without it. The omission is
 * therefore a REAL difference from a DSK-enabled staging call, and the two
 * DSK-sensitive dimensions the March pack scored (`dsk_fields_correct`) are
 * consciously NOT revived. Recorded in the baseline report rather than papered
 * over.
 */

import { applyExtractionContract } from '../candidate-run.js';
import type { EvalTaskAdapter, ScoredOutput } from '../task-adapter.js';
import { assembleDecisionReviewUserMessage } from './assemble.js';
import { extractDecisionReviewOutput, loadDecisionReviewFixtures } from './run.js';
import { scoreDecisionReview } from './scorer.js';
import type { DecisionReviewEvalFixture } from './types.js';

export const DECISION_REVIEW_ADAPTER: EvalTaskAdapter<DecisionReviewEvalFixture> = {
  task: 'decision_review',

  fixtureId: (fixture) => fixture.id,

  loadFixtures: (dir) => loadDecisionReviewFixtures(dir),

  buildRequest: (fixture, promptText) => ({
    system: promptText,
    user: assembleDecisionReviewUserMessage(fixture.input).userMessage,
  }),

  /**
   * Mock playback re-SERIALISES the recorded output object. Fixtures store the
   * object (readable, diffable); the pipeline receives text, so the JSON
   * extraction path is exercised on every offline run too — a mock run proves
   * the plumbing, not just the scorer.
   */
  mockRaw: (fixture, mockLabel) => {
    const recorded = fixture.candidates.find((c) => c.label === mockLabel);
    return recorded ? JSON.stringify(recorded.output) : null;
  },

  scoreRaw: (fixture, raw, candidateLabel): ScoredOutput => {
    const { output, extraction } = extractDecisionReviewOutput(raw);
    // Fail-closed: an unparseable envelope has no output to score, so the
    // scorer is handed an EMPTY object. Every dimension then reports what an
    // empty review actually is — `substance_present` fails, the coverage floor
    // fails — and `applyExtractionContract` additionally forces the substance
    // dimension false and appends the flagged `extraction_contract` dimension.
    // Nothing is skipped; a flagged turn is a failed turn.
    const score = scoreDecisionReview({
      output: output ?? {},
      input: fixture.input,
      candidateLabel,
    });
    return { extraction, score: applyExtractionContract(score, extraction) };
  },
};
