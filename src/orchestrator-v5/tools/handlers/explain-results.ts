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
 * Precondition (P0 V5 golden-path repair): the handler combines
 * "successful prior analysis exists" AND "current graph still matches
 * that analysis" into one verdict. Three non-execute states each map to
 * dedicated recovery copy:
 *
 *   - missing  → no run_analysis fact at all → "Run analysis" template.
 *   - degraded → latest fact arrived non-success (partial / failed /
 *                blocked / etc.) → "didn't produce a usable result" + Re-run.
 *   - stale    → successful fact exists but graph hash diverged → "model
 *                has changed since the last analysis" + Re-run.
 *   - usable_legacy → legacy fact (pre-0.10.0, no graph_hash_at_run) with a
 *                non-null projection → execute (status missing means legacy
 *                success per `selectRunAnalysisFact` eligibility).
 *   - fresh    → successful fact AND graph hashes match → execute.
 *
 * The verdict reuses `analysisFreshness` from `HandlerInvocation` (the
 * pre-dispatch derivation) plus `selectDegradedRunAnalysisFact` so the
 * "missing vs degraded" distinction is explicit. This keeps the routing
 * layer, freshness derivation, chip-generator and handler precondition
 * all reading from the same predicate (`isSuccessfulRunAnalysisFact`).
 *
 * Why the precondition lives in the handler, not the validator (D2):
 *   The validator's PRECONDITION_UNMET path produces a typed rejection
 *   shape that the recoverable-validator coaching pipeline turns into a
 *   different UX than the brief specifies. Returning a normal
 *   `HandlerOutcome` with the templated `assistant_text` and a noop fact
 *   gives the chip-generator the same handler-just-ran signal it uses
 *   elsewhere, so the recovery chip surfaces through the existing
 *   compose path.
 *
 * Defensive null-projection guard: even on the fresh path, if
 * `analysisProjection` is null/undefined, fall through to the absent
 * template. The composer's own defensive branch returns a generic line in
 * that case, but routing through the precondition path produces the
 * correct chip ("Run analysis") rather than a degraded explanation.
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
import {
  buildAnalysisAbsentTemplate,
  buildAnalysisDegradedTemplate,
  buildAnalysisStaleTemplate,
  resolveOptionCount,
} from './no-op-helpers.js';
import { composeExplainResultsFallback } from './explanation-fallback.js';
import { mapFallbackReason } from './diagnostics.js';
import {
  isSuccessfulRunAnalysisFact,
  selectDegradedRunAnalysisFact,
} from '../../context/freshness.js';

type PreconditionVerdict = 'missing' | 'degraded' | 'stale' | 'execute';

/**
 * Derive the user-visible precondition verdict for `explain_results`.
 *
 * The decision tree:
 *   1. No successful run_analysis fact in prior_facts:
 *       - If a degraded fact exists → 'degraded'.
 *       - Otherwise → 'missing'.
 *   2. Successful fact exists, freshness === 'stale' → 'stale'.
 *   3. Successful fact exists, freshness ∈ {'fresh','unknown'} → 'execute'.
 *      ('unknown' covers legacy facts and the
 *      current_graph_hash_unavailable path; either way a successful
 *      projection is the best the system has.)
 *   4. Successful fact exists but `analysisProjection` is null/undefined
 *      → treat as 'missing' (defensive — the projection is what the
 *      handler answers from).
 */
function decidePrecondition(invocation: HandlerInvocation): PreconditionVerdict {
  const priorFacts = invocation.context.prior_facts;
  const hasSuccessfulFact = priorFacts.some(isSuccessfulRunAnalysisFact);

  if (!hasSuccessfulFact) {
    return selectDegradedRunAnalysisFact(priorFacts) !== null ? 'degraded' : 'missing';
  }

  if (invocation.analysisProjection == null) {
    // Defensive: we found a successful fact but the projection assembler
    // produced nothing usable. Route through 'missing' so the chip-
    // generator emits "Run analysis" rather than letting the composer
    // hit its own generic-line fallback (which has no recovery chip).
    return 'missing';
  }

  if (invocation.analysisFreshness?.freshness === 'stale') {
    return 'stale';
  }

  return 'execute';
}

function buildPreconditionAssistantText(
  verdict: Exclude<PreconditionVerdict, 'execute'>,
  invocation: HandlerInvocation,
  optionCount: number,
): string {
  switch (verdict) {
    case 'missing':
      return buildAnalysisAbsentTemplate(optionCount, invocation.analysisReady?.status);
    case 'stale':
      return buildAnalysisStaleTemplate();
    case 'degraded':
      return buildAnalysisDegradedTemplate();
  }
}

export function createExplainResultsHandler(): HandlerFn {
  return async function explainResultsHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    const optionCount = resolveOptionCount(invocation);
    const verdict = decidePrecondition(invocation);

    if (verdict !== 'execute') {
      const assistantText = buildPreconditionAssistantText(verdict, invocation, optionCount);
      const fact: ExplainResultsHandlerFact = {
        fact_type: 'explain_results',
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
      const parsed = ExplainResultsHandlerFactSchema.safeParse(fact);
      if (!parsed.success) {
        throw new HandlerResultInvalidError(
          'ExplainResultsHandlerFact failed schema validation',
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

    // Answer-carrying contract (post-Commit-3): the side-band validator's
    // verdict drives whether to use Sonnet's answer_text or compose a
    // deterministic fallback. The handler ALWAYS owns the entire
    // user-visible string; the turn-executor forces suppress_orientation
    // for explanation handlers, so any orientation Sonnet produced is
    // ignored on the user side.
    const explanation = invocation.explanation;
    const sonnetValid = !!(explanation && explanation.answer_text_valid);
    const rawText = sonnetValid
      ? explanation!.answer_text
      : composeExplainResultsFallback(invocation.analysisProjection);

    // V5 state-trust: CEE no longer prefixes assistant_text with the
    // staleness caveat. The wire field analysis_ready.freshness drives UI
    // staleness display in a separate brief; the chip-generator emits a
    // "Rerun analysis" chip when freshness === 'stale' (retargeted from
    // staleness_reason in the same commit). The applyStalenessPrefix
    // function is preserved for now (removal is a follow-up); call sites
    // are removed here. `staleness_prefixed` stays on the fact as `false`
    // for backwards compat with telemetry consumers.
    const assistantText = rawText;

    const fact: ExplainResultsHandlerFact = {
      fact_type: 'explain_results',
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
        staleness_prefixed: false,
      },
    };
    const parsed = ExplainResultsHandlerFactSchema.safeParse(fact);
    if (!parsed.success) {
      throw new HandlerResultInvalidError(
        'ExplainResultsHandlerFact failed schema validation',
        { issues: parsed.error.issues },
      );
    }

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
