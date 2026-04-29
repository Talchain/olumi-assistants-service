/**
 * V5 `what_would_flip` answer-carrying handler for sensitivity / robustness
 * questions ("what would change this outcome?", "how robust is this
 * result?", "what would it take for X to win instead?").
 *
 * Answer-carrying contract (post-v40 fix): Sonnet writes the complete
 * user-facing answer inside `invocation.explanation.answer_text`. When the
 * side-band validator marks it valid, the handler uses it verbatim;
 * otherwise it composes a deterministic fallback from
 * `invocation.analysisProjection` (margins, top drivers with sensitivity
 * values, robustness band). The turn-executor forces
 * `suppress_orientation: true` for explanation handlers; the handler also
 * sets the flag on its outcome as defence-in-depth.
 *
 * Precondition (D2): `what_would_flip` requires a non-noop `run_analysis`
 * fact in `prior_facts`. Without one, no margin / drivers / robustness data
 * exists for the answer to reference, so the handler returns the
 * deterministic "no analysis run yet" template with
 * `suppress_orientation: true`. The "Run analysis" chip surfaces via the
 * chip-generator's `facts_absent` rule.
 *
 * F.6 invariant: no PLoT, no ISL, no LLM call, no math, no graph mutation.
 * The fallback formats raw values from the projection; it does not derive
 * new metrics.
 *
 * The `WhatWouldFlipResultSchema` retains optional legacy fields
 * (`narrative`, `flip_scenarios`) for backwards compatibility with the
 * pre-0.9 fact body shape. The V5 no-op handler populates only the no-op
 * metadata fields (`precondition_unmet`, `option_count`).
 */

import {
  WhatWouldFlipHandlerFactSchema,
  type WhatWouldFlipHandlerFact,
} from '@talchain/schemas/orchestrator';

import type {
  HandlerFn,
  HandlerInvocation,
  HandlerOutcome,
} from '../registry.js';
import { HandlerResultInvalidError } from '../handler-errors.js';
import { buildAnalysisAbsentTemplate, resolveOptionCount } from './no-op-helpers.js';
import { composeWhatWouldFlipFallback } from './explanation-fallback.js';
import { mapFallbackReason } from './diagnostics.js';
import { applyStalenessPrefix } from './staleness-prefix.js';

export function createWhatWouldFlipHandler(): HandlerFn {
  return async function whatWouldFlipHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    const optionCount = resolveOptionCount(invocation);

    const hasAnalysisFact = invocation.context.prior_facts.some(
      (f) => f.fact_type === 'run_analysis' && !f.noop,
    );

    if (!hasAnalysisFact) {
      const assistantText = buildAnalysisAbsentTemplate(
        optionCount,
        invocation.analysisReady?.status,
      );
      const fact: WhatWouldFlipHandlerFact = {
        fact_type: 'what_would_flip',
        fact_version: 1,
        noop: true,
        result: {
          precondition_unmet: true,
          option_count: optionCount,
          answer_source: 'precondition_template',
          fallback_reason: null,
          answer_text_length: assistantText.length,
        },
      };
      const parsed = WhatWouldFlipHandlerFactSchema.safeParse(fact);
      if (!parsed.success) {
        throw new HandlerResultInvalidError(
          'WhatWouldFlipHandlerFact failed schema validation',
          { issues: parsed.error.issues },
        );
      }
      return {
        assistant_text: assistantText,
        handler_facts: [parsed.data],
        llm_calls_used: 0,
        suppress_orientation: true,
      };
    }

    // Answer-carrying contract (post-Commit-3): use Sonnet's answer_text
    // when valid; otherwise compose a deterministic fallback from the
    // analysis projection (margins, top drivers, robustness). The
    // turn-executor forces suppress_orientation for explanation handlers.
    const explanation = invocation.explanation;
    const sonnetValid = !!(explanation && explanation.answer_text_valid);
    const rawText = sonnetValid
      ? explanation!.answer_text
      : composeWhatWouldFlipFallback(invocation.analysisProjection);

    // Trust contract: when the analysis is loaded from a prior run, prepend
    // the staleness caveat in code. The chip-generator separately surfaces a
    // "Rerun analysis" chip from the projection's staleness_reason.
    const stalenessReason = invocation.analysisProjection?.staleness_reason ?? null;
    const { text: assistantText, prefixed } = applyStalenessPrefix(
      rawText,
      stalenessReason,
    );

    const fact: WhatWouldFlipHandlerFact = {
      fact_type: 'what_would_flip',
      fact_version: 1,
      noop: true,
      result: {
        precondition_unmet: false,
        option_count: optionCount,
        answer_source: sonnetValid ? 'sonnet' : 'deterministic_fallback',
        fallback_reason: sonnetValid
          ? null
          : mapFallbackReason(explanation?.answer_validation_error),
        answer_text_length: assistantText.length,
        staleness_prefixed: prefixed,
      },
    };
    const parsed = WhatWouldFlipHandlerFactSchema.safeParse(fact);
    if (!parsed.success) {
      throw new HandlerResultInvalidError(
        'WhatWouldFlipHandlerFact failed schema validation',
        { issues: parsed.error.issues },
      );
    }

    return {
      assistant_text: assistantText,
      handler_facts: [parsed.data],
      llm_calls_used: 0,
      suppress_orientation: true,
    };
  };
}
