/**
 * V5 `explain_from_structure` handler — pure no-op routing surface.
 *
 * Registered in 0.9.0 to give Sonnet a correct tool for pre-analysis
 * structural questions ("what factor most influences my decision?", "why
 * might X be the leading option?"). The handler does not call PLoT or ISL,
 * does not compute anything, and does not mutate state. Its sole purpose is
 * to signal correct intent classification: when Sonnet picks
 * `explain_from_structure`, the handler runs through the normal lifecycle
 * (validation → execute → fact persistence → compose) and Sonnet's
 * pre-tool-call orientation text becomes the assistant response. The
 * persisted handler fact (`noop: true`) records routing success for
 * observability.
 *
 * Accepted entity kinds (validation-registry.ts):
 *   `['goal', 'option']` — the wire entity-kind enum's `node` literal
 *   collapses decision/factor/outcome/risk into one literal, which is too
 *   broad for a no-op handler to safely accept. Decision-node misroutes
 *   from Sonnet (the recurring "what factor influences my decision?"
 *   pattern) are caught by the validator's ENTITY_KIND_MISMATCH path and
 *   the recoverable-validator coaching pipeline returns a 200 response
 *   asking the user to retarget — correct degradation when the wire
 *   schema cannot disambiguate which node class the user meant.
 *
 * Empty-orientation guard (D8):
 *   Sonnet occasionally emits only the tool_use block with no preceding
 *   text. In that case `invocation.orientationText.trim() === ''` and the
 *   handler returns a safe fallback string so the user is not shown an
 *   empty assistant_text. The fallback is intentionally generic — narrative
 *   detail is Sonnet's job; the handler's job is to ensure the routing
 *   round-trip never surfaces silently.
 *
 * F.6 invariant (no semantic computation):
 *   No PLoT, no ISL, no LLM call, no math/stats, no graph mutation. The
 *   handler does not synthesise narrative; orientation text is the only
 *   substantive content the user sees on the happy path.
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

export function createExplainFromStructureHandler(): HandlerFn {
  return async function explainFromStructureHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    const optionCount = resolveOptionCount(invocation);

    const fact: ExplainFromStructureHandlerFact = {
      fact_type: 'explain_from_structure',
      fact_version: 1,
      noop: true,
      result: { option_count: optionCount },
    };

    const parsed = ExplainFromStructureHandlerFactSchema.safeParse(fact);
    if (!parsed.success) {
      throw new HandlerResultInvalidError(
        'ExplainFromStructureHandlerFact failed schema validation',
        { issues: parsed.error.issues },
      );
    }

    // Answer-carrying contract (post-Commit-3): use Sonnet's answer_text
    // when valid; otherwise compose a deterministic fallback from the
    // structure projection (top causal links, named-factor pathways, goal
    // label). The turn-executor forces suppress_orientation for explanation
    // handlers, so Sonnet's pre-tool-call orientation never reaches the user.
    const explanation = invocation.explanation;
    const assistantText =
      explanation && explanation.answer_text_valid
        ? explanation.answer_text
        : composeExplainFromStructureFallback(invocation.structureProjection);

    return {
      assistant_text: assistantText,
      handler_facts: [parsed.data],
      llm_calls_used: 0,
      suppress_orientation: true,
    };
  };
}
