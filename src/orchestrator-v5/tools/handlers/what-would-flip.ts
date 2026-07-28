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
 * F.6 invariant (base case): no PLoT, no LLM call, no math, no graph mutation.
 * The single-factor flip answer formats raw values from the projection; it does
 * not derive new metrics. This is the THIN base case of a general what-if lens.
 *
 * What-if (counterfactual) EXTENSION (A1 subsume ruling, 23 Jul): on the
 * execute path only, AFTER the base flip answer is composed, a deterministic
 * selector may run ONE ISL counterfactual probe and APPEND a claim-safe
 * suggestion card. It is one owner / one path — `what_would_flip` subsumes the
 * general what-if; there is no new intent, no new handler, no parallel twin.
 * The extension is FAIL-LOUD: no injected client (transport dark / latent), no
 * auditable probe, an unmappable graph, or ANY non-2xx / degraded ISL result →
 * append NOTHING; the base answer is byte-preserved. It never fabricates a
 * value. See `./whatif/run-counterfactual-lens.ts`. The ISL call lives in the
 * injected `CounterfactualClient` (`src/adapters/isl/`), never as a `fetch` in
 * this handler.
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
import {
  buildPreconditionAssistantText,
  decideExplanationPrecondition,
  resolveOptionCount,
} from './no-op-helpers.js';
import { composeWhatWouldFlipFallback } from './explanation-fallback.js';
import { mapFallbackReason } from './diagnostics.js';
import { runCounterfactualLens } from './whatif/run-counterfactual-lens.js';
import { composeOptionTargetedFlipAnswer } from './whatif/compose-option-targeted-flip.js';
import type { CounterfactualClient } from '../../../adapters/isl/counterfactual-client.js';

/**
 * Handler dependencies. `counterfactualClient` is injected by the registry
 * (the `plotClient` pattern) and is `null`/absent when ISL is not configured —
 * the honest latent state in which the what-if extension never fires. Absent
 * deps (e.g. `createWhatWouldFlipHandler()` in unit tests) means a null client,
 * so the base `what_would_flip` behaviour is exactly preserved.
 */
export interface WhatWouldFlipHandlerDeps {
  readonly counterfactualClient?: CounterfactualClient | null;
}

export function createWhatWouldFlipHandler(deps?: WhatWouldFlipHandlerDeps): HandlerFn {
  const counterfactualClient = deps?.counterfactualClient ?? null;
  return async function whatWouldFlipHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    const optionCount = resolveOptionCount(invocation);
    const verdict = decideExplanationPrecondition(invocation);

    if (verdict !== 'execute') {
      const assistantText = buildPreconditionAssistantText(
        verdict,
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
    //
    // `invocation.rawRobustness` is forwarded so the fallback composer
    // can suppress the "smaller changes are unlikely" sentence on
    // raw-fragile or near-tie results (PR #193 SSOT). It is populated on
    // the live routed path — forced-intent explanation handlers via
    // `routeWithToolUse`, plus turn-executor's
    // `buildBoundedFallbackCopyAndChips`; callers without a raw signal may
    // omit it (undefined → composer treats as "no raw signal" and falls
    // back to projected-band copy).
    const explanation = invocation.explanation;
    const sonnetValid = !!(explanation && explanation.answer_text_valid);

    // M1 (finish-line criterion 7) — OPTION-TARGETED ANSWER.
    //
    // When the user named ONE option ("what would make Engage Offshore Partner
    // win?"), the answer must be about THAT option. The deterministic composer
    // below owns those turns, matching flip rows on `alternative_winner_id`, and
    // returns a typed refusal when no tested row makes the named option lead.
    //
    // WHY IT OUTRANKS SONNET'S ANSWER TOO, not only the generic fallback. This
    // is the exact question shape whose honest answer is often "nothing in the
    // tested set does that", and free prose asked that question invents a
    // threshold — a fabricated tipping point wearing this estate's trust
    // dressing. The refusal is the safety-bearing half of the feature, so it
    // cannot be a branch that only fires when Sonnet has already failed. Turns
    // where the user named no single option are untouched: `flipTargetOption` is
    // null and Sonnet keeps the answer exactly as before.
    //
    // The composer returns null when there is no flip evidence at all
    // (`flipSummary` absent or 'none'), because then there is nothing to address
    // the question WITH — and the pre-existing behaviour is preserved verbatim.
    const targeted =
      invocation.flipTargetOption != null
        ? composeOptionTargetedFlipAnswer(invocation.flipTargetOption, invocation.flipSummary)
        : null;

    const rawText =
      targeted !== null
        ? targeted.text
        : sonnetValid
          ? explanation!.answer_text
          : composeWhatWouldFlipFallback(
              invocation.analysisProjection,
              invocation.rawRobustness ?? null,
              invocation.flipSummary ?? null,
            );

    // V5 state-trust: CEE no longer prefixes assistant_text with the
    // staleness caveat. See explain-results.ts for the rationale; same
    // contract applies here. staleness_prefixed stays on the fact as
    // false for backwards-compat with telemetry consumers.
    //
    // What-if (counterfactual) lens EXTENSION — runs only here, on the execute
    // path, and only APPENDS. `runCounterfactualLens` is fully fail-loud and
    // returns `null` (append nothing) unless it has a validated ISL 2xx for the
    // exact intervention it asked about. When the client is null (the latent
    // state on staging today) it short-circuits immediately, so `rawText` is
    // returned unchanged and the base flip behaviour is byte-preserved.
    const lens = await runCounterfactualLens({
      client: counterfactualClient,
      graphForTurn: invocation.graphForTurn,
      flipSummary: invocation.flipSummary,
      rawRobustness: invocation.rawRobustness,
      requestId: invocation.requestId,
      signal: invocation.signal,
    });
    const assistantText = lens ? `${rawText} ${lens.card}` : rawText;

    const fact: WhatWouldFlipHandlerFact = {
      fact_type: 'what_would_flip',
      fact_version: 1,
      noop: true,
      result: {
        precondition_unmet: false,
        option_count: optionCount,
        // A targeted answer is DETERMINISTIC whichever path it displaced, so it
        // reports as such. (`ExplainAnswerSourceSchema` is a strict three-value
        // enum in `@talchain/schemas`; a dedicated `option_targeted` source
        // would be a cross-repo contract change, and `deterministic_fallback` is
        // already the true statement about who composed this string.)
        answer_source:
          targeted !== null || !sonnetValid ? 'deterministic_fallback' : 'sonnet',
        // Unchanged: a fallback REASON only exists when Sonnet's text failed
        // validation. A targeted answer that displaced a VALID Sonnet answer has
        // no failure to report, and must not invent one.
        fallback_reason: sonnetValid
          ? null
          : mapFallbackReason(explanation?.answer_validation_error),
        answer_text_length: assistantText.length,
        staleness_prefixed: false,
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
