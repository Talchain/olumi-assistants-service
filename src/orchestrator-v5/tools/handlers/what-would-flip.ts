/**
 * V5 `what_would_flip` handler — pure no-op routing surface for sensitivity /
 * robustness questions ("what would change this outcome?", "how robust is
 * this result?", "what would it take for X to win instead?").
 *
 * Registered in 0.9.0. Identical pattern to `explain_results`: no PLoT, no
 * ISL, no compute. Sonnet's pre-tool-call orientation text becomes the
 * assistant response on the happy path; persisted fact carries `noop: true`.
 *
 * Precondition (D2): `what_would_flip` requires a non-noop `run_analysis`
 * fact in `prior_facts`. Without one, no margin / drivers / robustness data
 * exists for Sonnet to reference, so the handler returns the deterministic
 * "no analysis run yet" template with `suppress_orientation: true`. The
 * "Run analysis" chip surfaces via the chip-generator's `facts_absent` rule.
 *
 * F.6 invariant: no PLoT, no ISL, no LLM call, no math, no graph mutation.
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

const SAFE_FALLBACK_ASSISTANT_TEXT =
  'Here is what could change the outcome.' as const;

export function createWhatWouldFlipHandler(): HandlerFn {
  return async function whatWouldFlipHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    const optionCount = resolveOptionCount(invocation);

    const hasAnalysisFact = invocation.context.prior_facts.some(
      (f) => f.fact_type === 'run_analysis' && !f.noop,
    );

    if (!hasAnalysisFact) {
      const fact: WhatWouldFlipHandlerFact = {
        fact_type: 'what_would_flip',
        fact_version: 1,
        noop: true,
        result: { precondition_unmet: true, option_count: optionCount },
      };
      const parsed = WhatWouldFlipHandlerFactSchema.safeParse(fact);
      if (!parsed.success) {
        throw new HandlerResultInvalidError(
          'WhatWouldFlipHandlerFact failed schema validation',
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

    const fact: WhatWouldFlipHandlerFact = {
      fact_type: 'what_would_flip',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: false, option_count: optionCount },
    };
    const parsed = WhatWouldFlipHandlerFactSchema.safeParse(fact);
    if (!parsed.success) {
      throw new HandlerResultInvalidError(
        'WhatWouldFlipHandlerFact failed schema validation',
        { issues: parsed.error.issues },
      );
    }

    const orientation = invocation.orientationText.trim();
    const assistantText =
      orientation === '' ? SAFE_FALLBACK_ASSISTANT_TEXT : '';

    return {
      assistant_text: assistantText,
      handler_facts: [parsed.data],
      llm_calls_used: 0,
    };
  };
}
