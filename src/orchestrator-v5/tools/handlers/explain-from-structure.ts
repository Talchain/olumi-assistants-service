/**
 * V5 `explain_from_structure` answer-carrying handler.
 *
 * Registered in 0.9.0 to give Sonnet a correct tool for pre-analysis
 * structural questions ("what factor most influences my decision?", "why
 * might X be the leading option?"). The handler does not call PLoT or ISL,
 * does not compute anything, and does not mutate state.
 *
 * Answer-carrying contract (post-v40 fix): Sonnet writes the complete
 * user-facing answer inside `invocation.explanation.answer_text`. When the
 * side-band validator marks it valid, the handler uses it verbatim;
 * otherwise it composes a deterministic fallback from
 * `invocation.structureProjection` (top causal links, named-factor
 * pathways, goal label, factor / option counts). The turn-executor forces
 * `suppress_orientation: true` for explanation handlers; the handler also
 * sets the flag on its outcome as defence-in-depth.
 *
 * Accepted entity kinds (validation-registry.ts):
 *   `['goal', 'option', 'node']` — the wire entity-kind enum's `node` literal
 *   collapses decision/factor/outcome/risk/action into one literal. `node` is
 *   accepted because this handler IGNORES the proposal entity entirely and
 *   explains the whole structure projection, so a factor / decision /
 *   outcome / risk / action target is a legitimate thing to ask it to explain.
 *   Rejecting `node` previously produced the V5 routeability dead-end for
 *   factor-centric questions ("what factor most influences my decision?")
 *   — ENTITY_KIND_MISMATCH → the generic "I wasn't sure what you meant"
 *   response. Validator authority is preserved: a `node` kind proposed
 *   against a real option/goal id still fails the graph-resolved kind
 *   cross-check, a missing id still fails ENTITY_NOT_FOUND, and `edge` /
 *   `constraint` stay rejected. See the V5 Chip Routeability Contract lane.
 *
 * F.6 invariant (no semantic computation):
 *   No PLoT, no ISL, no LLM call, no math/stats, no graph mutation. The
 *   fallback formats raw values from the projection; it does not derive
 *   new metrics or synthesise causality.
 */

import {
  ExplainFromStructureHandlerFactSchema,
  type ExplainFromStructureHandlerFact,
} from '@talchain/schemas/orchestrator';

import type {
  HandlerFn,
  HandlerInvocation,
  HandlerOutcome,
} from '../registry.js';
import { HandlerResultInvalidError } from '../handler-errors.js';
import { resolveOptionCount } from './no-op-helpers.js';
import { composeExplainFromStructureFallback } from './explanation-fallback.js';
import { mapFallbackReason } from './diagnostics.js';

export function createExplainFromStructureHandler(): HandlerFn {
  return async function explainFromStructureHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    const optionCount = resolveOptionCount(invocation);

    // Answer-carrying contract (post-Commit-3): use Sonnet's answer_text
    // when valid; otherwise compose a deterministic fallback from the
    // structure projection (top causal links, named-factor pathways, goal
    // label). The turn-executor forces suppress_orientation for explanation
    // handlers, so Sonnet's pre-tool-call orientation never reaches the user.
    //
    // V5 explain-stabilisation Task 3: the deterministic fallback is now
    // the primary path for generic structural prompts (Sonnet rarely
    // populates answer_text for them). Pass `canRunAnalysis` so the
    // composer's next-step nudge stays grounded in the structural-
    // readiness signal — no nudge when the graph cannot yet support a run.
    const explanation = invocation.explanation;
    const sonnetValid = !!(explanation && explanation.answer_text_valid);
    const canRunAnalysis = invocation.analysisReady?.status === 'ready';
    const assistantText = sonnetValid
      ? explanation!.answer_text
      : composeExplainFromStructureFallback(invocation.structureProjection, {
          canRunAnalysis,
        });

    const fact: ExplainFromStructureHandlerFact = {
      fact_type: 'explain_from_structure',
      fact_version: 1,
      noop: true,
      result: {
        option_count: optionCount,
        answer_source: sonnetValid ? 'sonnet' : 'deterministic_fallback',
        fallback_reason: sonnetValid
          ? null
          : mapFallbackReason(explanation?.answer_validation_error),
        answer_text_length: assistantText.length,
      },
    };

    const parsed = ExplainFromStructureHandlerFactSchema.safeParse(fact);
    if (!parsed.success) {
      throw new HandlerResultInvalidError(
        'ExplainFromStructureHandlerFact failed schema validation',
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
