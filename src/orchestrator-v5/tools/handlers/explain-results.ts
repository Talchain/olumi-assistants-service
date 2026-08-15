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
  buildPreconditionAssistantText,
  resolveBlockedOptionLabels,
  decideExplanationPrecondition,
  resolveOptionCount,
} from './no-op-helpers.js';
import { composeExplainResultsFallback } from './explanation-fallback.js';
import { mapFallbackReason } from './diagnostics.js';
import { selectMostSensitiveRow } from '../../../orchestrator/shared/fragile-edge-authority.js';
import {
  composeStandaloneValidationPriority,
  decideValidationBeat,
  isCleanDisplayLabel,
  type ValidationBeatDecision,
  type ValidationFragileEdge,
} from '../../coaching/validation-priority.js';

/**
 * Inputs for the "what to validate" beat, read from the projection the
 * turn-executor already threads in (same source the advice gate reads on
 * the deterministic J1b path). `fragile_edges` arrives pre-filtered to
 * renderable entries by `buildAnalysisProjectionSummary`; selection goes
 * through the shared producer-metric authority (and retains the projected head
 * when this labels-only view carries no finite metric). The driver label gets the
 * standalone clean-label guard (non-empty, not ID-shaped) because this path
 * does not pass through the gate's availability checks.
 */
function selectValidationSignals(
  projection: HandlerInvocation['analysisProjection'],
): {
  fragileEdge: ValidationFragileEdge | null;
  topDriverLabel: string | null;
} {
  const fragileEdge = selectMostSensitiveRow(projection?.fragile_edges ?? []) ?? null;
  const rawDriverLabel = projection?.top_drivers?.[0]?.factor_label;
  return {
    fragileEdge,
    topDriverLabel: isCleanDisplayLabel(rawDriverLabel) ? rawDriverLabel : null,
  };
}

export function createExplainResultsHandler(): HandlerFn {
  return async function explainResultsHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    const optionCount = resolveOptionCount(invocation);
    const verdict = decideExplanationPrecondition(invocation);

    if (verdict !== 'execute') {
      const assistantText = buildPreconditionAssistantText(
        verdict,
        optionCount,
        invocation.analysisReady?.status,
        // ROADMAP 2.308 / S3 — name the option(s) actually blocking readiness.
        resolveBlockedOptionLabels(invocation),
      );
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

    // V5-LANE-B-STRUCTURAL-01 — the "what to validate" beat (J1 hybrid).
    // On the Sonnet-valid path the standalone beat is appended as a final
    // paragraph, subject to the dedup guard (the free narrative may already
    // state the validation priority). On the fallback path the beat is
    // composed directly (no dedup — the deterministic narrative never
    // states one) and placed by the composer before its closing nudge.
    // Execute-verdict turns only; precondition/stale/missing/degraded copy
    // above is untouched.
    const { fragileEdge, topDriverLabel } = selectValidationSignals(
      invocation.analysisProjection,
    );
    let validationBeat: ValidationBeatDecision;
    let rawText: string;
    if (sonnetValid) {
      const answerText = explanation!.answer_text;
      validationBeat = decideValidationBeat({
        answerText,
        fragileEdge,
        topDriverLabel,
      });
      rawText =
        validationBeat.mechanism === 'appended'
          ? `${answerText}\n\n${validationBeat.beat.text}`
          : answerText;
    } else {
      const beat = composeStandaloneValidationPriority(fragileEdge, topDriverLabel);
      validationBeat = beat
        ? { mechanism: 'appended', beat }
        : { mechanism: 'omitted', reason: 'no_renderable_signal' };
      rawText = composeExplainResultsFallback(
        invocation.analysisProjection,
        beat?.text ?? null,
        // Same robustness signal the what_would_flip fallback receives, so the
        // two composers derive the near-tie verdict (incl. the raw
        // `near_tie.is_tie` override) from identical inputs and never
        // contradict. Populated for explanation handlers when the projection is
        // prior-fact-sourced (turn-executor same-run guard); routed/request
        // paths pass null and both composers fall back to margin-only.
        invocation.rawRobustness ?? null,
        // Same fact, same same-run guard as `rawRobustness` above.
        invocation.defaultedAssumptions ?? null,
      );
    }

    // V5 stale-aware explain recovery: the staleness signal travels via
    // the precondition branch above — `decideExplanationPrecondition`
    // returns `'stale'` when `invocation.analysisFreshness?.freshness ===
    // 'stale'` and that branch emits `buildAnalysisStaleTemplate` whose
    // leading sentence is the brief's required wording ("These results
    // may be out of date because the model has changed since the last
    // analysis."). When we reach THIS branch — verdict === 'execute' —
    // freshness is `'fresh'` (or 'unknown' / 'none' with usable legacy
    // data), so no caveat prefix is appropriate. The applyStalenessPrefix
    // helper remains for legacy call sites; `staleness_prefixed` stays on
    // the fact as `false` for backwards compat with telemetry consumers.
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
      // Mechanism record for the validation beat — mirrored to telemetry by
      // the turn-executor (see HandlerOutcome.__validation_beat).
      __validation_beat: validationBeat,
    };
  };
}
