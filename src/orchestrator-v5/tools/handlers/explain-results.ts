/**
 * V5 `explain_results` answer-carrying handler for post-analysis explanation
 * questions ("why did X win?", "explain the analysis results").
 *
 * Answer-carrying contract (post-v40 fix): the handler always owns the
 * entire user-visible string. Sonnet's `answer_text` (carried inside the
 * tool-call payload via `invocation.explanation`) is used verbatim when the
 * side-band validator marked it valid; otherwise the deterministic
 * fallback in `explanation-fallback.ts` composes a response from the
 * pre-built `analysisProjection` summary. The turn-executor forces
 * `suppress_orientation: true` for explanation handlers, so Sonnet's
 * pre-tool-call orientation never reaches the user; the handler also sets
 * the flag on its outcome as defence-in-depth.
 *
 * Precondition (D2): `explain_results` requires a non-noop `run_analysis`
 * fact in the conversation's `prior_facts`. When absent (the user has not
 * yet run analysis), the handler returns a deterministic template explaining
 * that no analysis has been run, with the option count interpolated. The
 * composer surfaces a "Run analysis" chip via the chip-generator's
 * `facts_absent` rule.
 *
 * Why the precondition lives in the handler, not the validator (D2):
 *   The validator's PRECONDITION_UNMET path produces a typed rejection
 *   shape that the recoverable-validator coaching pipeline turns into a
 *   different UX than the brief specifies. Returning a normal
 *   `HandlerOutcome` with the templated `assistant_text` and a noop fact
 *   gives the chip-generator the same handler-just-ran signal it uses
 *   elsewhere, so the "Run analysis" chip surfaces through the existing
 *   compose path.
 *
 * Non-noop filter on the precondition check:
 *   The check is `f.fact_type === 'run_analysis' && !f.noop`. A future noop
 *   `run_analysis` fact (none exist today, but the discriminated union
 *   permits one) must NOT satisfy the precondition — only a real PLoT-
 *   backed analysis run produces the projection data the answer references.
 *   See `chip-generator.ts:findHandlerJustRan` for the parallel filter.
 *
 * F.6 invariant: no PLoT, no ISL, no LLM call, no math, no graph mutation.
 * The fallback formats raw values from the projection; it does not derive
 * new metrics.
 */

import {
  ExplainResultsHandlerFactSchema,
  type ExplainResultsHandlerFact,
} from '@talchain/schemas/orchestrator';

import type {
  HandlerFn,
  HandlerInvocation,
  HandlerOutcome,
} from '../registry.js';
import { HandlerResultInvalidError } from '../handler-errors.js';
import { buildAnalysisAbsentTemplate, resolveOptionCount } from './no-op-helpers.js';
import { composeExplainResultsFallback } from './explanation-fallback.js';

export function createExplainResultsHandler(): HandlerFn {
  return async function explainResultsHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    const optionCount = resolveOptionCount(invocation);

    const hasAnalysisFact = invocation.context.prior_facts.some(
      (f) => f.fact_type === 'run_analysis' && !f.noop,
    );

    if (!hasAnalysisFact) {
      const fact: ExplainResultsHandlerFact = {
        fact_type: 'explain_results',
        fact_version: 1,
        noop: true,
        result: { precondition_unmet: true, option_count: optionCount },
      };
      const parsed = ExplainResultsHandlerFactSchema.safeParse(fact);
      if (!parsed.success) {
        throw new HandlerResultInvalidError(
          'ExplainResultsHandlerFact failed schema validation',
          { issues: parsed.error.issues },
        );
      }
      return {
        assistant_text: buildAnalysisAbsentTemplate(
          optionCount,
          invocation.analysisReady?.status,
        ),
        handler_facts: [parsed.data],
        llm_calls_used: 0,
        suppress_orientation: true,
      };
    }

    const fact: ExplainResultsHandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: false, option_count: optionCount },
    };
    const parsed = ExplainResultsHandlerFactSchema.safeParse(fact);
    if (!parsed.success) {
      throw new HandlerResultInvalidError(
        'ExplainResultsHandlerFact failed schema validation',
        { issues: parsed.error.issues },
      );
    }

    // Answer-carrying contract (post-Commit-3): the side-band validator's
    // verdict drives whether to use Sonnet's answer_text or compose a
    // deterministic fallback. The handler ALWAYS owns the entire
    // user-visible string; the turn-executor forces suppress_orientation
    // for explanation handlers, so any orientation Sonnet produced is
    // ignored on the user side.
    const explanation = invocation.explanation;
    const assistantText =
      explanation && explanation.answer_text_valid
        ? explanation.answer_text
        : composeExplainResultsFallback(invocation.analysisProjection);

    return {
      assistant_text: assistantText,
      handler_facts: [parsed.data],
      llm_calls_used: 0,
      // Drive home that the handler owns the response; defence-in-depth in
      // case future compose-layer changes inspect this flag directly.
      suppress_orientation: true,
    };
  };
}
