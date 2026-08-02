/**
 * Shared helpers for the V5 no-op explanation handlers
 * (`explain_from_structure`, `explain_results`, `what_would_flip`).
 *
 * Kept narrow on purpose — only utilities used by ≥ 2 handlers and tested
 * once. Handler-specific logic stays in each handler file so the per-
 * handler contract is readable in one place.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { HandlerInvocation } from '../registry.js';
import {
  isSuccessfulRunAnalysisFact,
  selectDegradedRunAnalysisFact,
  type AnalysisFreshness,
} from '../../context/freshness.js';

/**
 * Source-of-truth for `option_count` in the no-op handlers' result body
 * and precondition-fail template.
 *
 * `entity_registry.option_ids` from the wire-level `TurnContext` is a
 * stub: `build-turn-context.ts` initialises it as an empty array on every
 * turn and never populates it from the persisted graph. Reading it
 * directly produces "0 options" in production regardless of graph state.
 *
 * `analysisReady.options` from `computeStructuralReadiness` is the
 * authoritative graph-derived source. The turn-executor threads
 * `analysisReadyForTurn` into `HandlerInvocation` for this purpose.
 *
 * Falls back to the entity_registry stub only when `analysisReady` is
 * undefined — which today only happens on frame-stage turns with no
 * graph at all (computeStructuralReadiness returns undefined when no
 * graph is present). The fallback returns 0 in those cases by design.
 * The chip-click dispatch path also passes no analysisReady, but it
 * currently invokes only `run_analysis` and never these no-op handlers,
 * so that path is not a concern here.
 */
export function resolveOptionCount(invocation: HandlerInvocation): number {
  if (invocation.analysisReady) {
    return invocation.analysisReady.options.length;
  }
  return invocation.context.entity_registry.option_ids?.length ?? 0;
}

/**
 * Select the options that are blocking readiness, for `buildAnalysisAbsentTemplate`.
 *
 * Derived from the SAME `analysisReady.options` the readiness verdict itself
 * is rolled up from (`computeStructuralReadiness`), so the copy cannot name a
 * different set of options than the gate blocked on. Options with no usable
 * label are dropped rather than rendered as an id — an id in user prose is the
 * internal-field leak the 2.308 diagnosis rowed twice (§5b, §11.2).
 */
export function resolveBlockedOptionLabels(invocation: HandlerInvocation): string[] {
  const options = invocation.analysisReady?.options;
  if (!Array.isArray(options)) return [];
  const labels: string[] = [];
  for (const option of options) {
    if (option.status === 'ready') continue;
    const label = option.label;
    if (typeof label !== 'string' || label.trim().length === 0) continue;
    labels.push(label.trim());
  }
  return labels;
}

/** Render a label list as `"A"`, `"A" and "B"`, `"A", "B" and "C"`. */
function renderQuotedLabelList(labels: readonly string[]): string {
  const quoted = labels.map((label) => `"${label}"`);
  if (quoted.length === 1) return quoted[0]!;
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]!}`;
}

/**
 * Decide the precondition-fail template wording based on structural
 * readiness. The earlier single-string template said "ready to analyse"
 * unconditionally — wrong when readiness is `needs_user_input`,
 * `needs_user_mapping`, or `needs_encoding` because those statuses block
 * the run_analysis CTA. Branch the copy so the user gets accurate
 * direction.
 *
 * ⚠ ROADMAP 2.308 / S3 — the needs-setup branch used to CONTRADICT ITSELF BY
 * CONSTRUCTION. The head clause `Your model has ${n} ${optionsLabel} set up `
 * was emitted unconditionally and the tail then denied it, producing (live, at
 * `a5a3e22`, for the tester's real state):
 *
 *   "Your model has 6 options set up but the options still need to be set up
 *    before analysis can run."
 *
 * "This is not an LLM hallucination — it is deterministic concatenation." It
 * also named no option and no missing thing, so it was unactionable. The fix
 * is structural, not a reword: the "set up" head clause is now confined to the
 * branch that can truthfully make it, and each blocking status states what it
 * actually means.
 *
 * Statuses recognised:
 *   - `ready` → "and is ready to analyse" (run-analysis chip will follow).
 *     Unchanged, byte for byte.
 *   - `needs_user_input` → the roll-up for FEWER THAN TWO options
 *     (`analysis-ready-helper.ts`: `options.length < 2`). Says exactly that;
 *     it is not an effect-values problem and never was.
 *   - `needs_user_mapping` / `needs_encoding` → the option(s) have no effect
 *     values. Names them when the caller knows them, in the same words the
 *     UI's own blocked reason uses ("has no effect values yet"), and never an
 *     internal field name.
 *   - undefined / unknown literal → fall back to the neutral "ready to
 *     analyse" wording. The chip generator's own readiness gate prevents
 *     a misleading executable chip in that case.
 *
 * `blockedOptionLabels` is optional so the two-argument callers that cannot
 * reach the option list (the coaching postcheck) keep compiling and still get
 * non-contradicting copy.
 */
export function buildAnalysisAbsentTemplate(
  optionCount: number,
  readinessStatus: string | undefined,
  blockedOptionLabels: readonly string[] = [],
): string {
  const optionsLabel = optionCount === 1 ? 'option' : 'options';
  const head = `No analysis has been run on your model yet. `;

  if (readinessStatus === 'needs_user_input') {
    return (
      head +
      `Your model has ${optionCount} ${optionsLabel}, and analysis needs at ` +
      `least two to compare.`
    );
  }

  if (readinessStatus === 'needs_user_mapping' || readinessStatus === 'needs_encoding') {
    if (blockedOptionLabels.length > 0) {
      const named = renderQuotedLabelList(blockedOptionLabels);
      const verb = blockedOptionLabels.length === 1 ? 'has' : 'have';
      const pronoun = blockedOptionLabels.length === 1 ? 'it' : 'they';
      return (
        head +
        `${named} ${verb} no effect values yet. Tell me what ${pronoun} ` +
        `change and the analysis can run.`
      );
    }
    return (
      head +
      `Some of your ${optionsLabel} have no effect values yet. Tell me what ` +
      `they change and the analysis can run.`
    );
  }

  return (
    head +
    `Your model has ${optionCount} ${optionsLabel} set up ` +
    `and is ready to analyse. Would you like me to run the analysis?`
  );
}

/**
 * Combined success+currentness precondition verdict for the V5
 * explanation handlers (`explain_results`, `what_would_flip`).
 *
 * Both handlers consume the same four-state decision tree pre-Wave-1;
 * the duplication was originally inlined per-handler with a comment
 * justifying it. The follow-up review correctly noted that future
 * predicate changes could drift again — extracted here so there is a
 * single source of truth.
 */
export type ExplanationPreconditionVerdict =
  | 'missing'
  | 'degraded'
  | 'stale'
  | 'unconfirmed'
  | 'execute';

/**
 * Decide the precondition verdict from the handler invocation.
 *
 * Single source of truth: when the turn-executor threads the canonical
 * `analysisFreshness` derivation (the HandlerInvocation contract), both
 * "does a successful analysis exist" and "is it still current" are read
 * from that one verdict rather than re-derived from local signals. The
 * local prior_facts scan is kept only as a graceful fallback for callers
 * that omit `analysisFreshness` (chip-click fixtures / unit tests).
 *
 * Invariant — `'missing'` ⟺ NO successful run_analysis fact exists. Once a
 * successful fact is present we never deny it (Tier 0: Olumi must not say
 * "no analysis" after analysis has run). Currency is judged BEFORE the
 * projection-buildability guard, so a stale-but-unprojectable fact is
 * labelled stale, not "no analysis".
 *
 * Decision tree:
 *   1. No successful run_analysis fact:
 *      - Degraded fact present → 'degraded'.
 *      - Otherwise            → 'missing'.
 *   2. Successful fact exists; judge currency from the canonical verdict:
 *      - freshness 'stale'   → 'stale'       (the model has changed).
 *      - freshness 'unknown' → 'unconfirmed' (Tier 0: insufficient evidence
 *        to confirm the analysis still matches the current model — treated
 *        as stale for user-facing freshness, with distinct copy that does
 *        NOT assert the model changed).
 *   3. Successful + current (fresh / legacy-usable) but no `analysisProjection`
 *      to summarise → 'degraded' (honest "no usable result"; never 'missing').
 *   4. Otherwise → 'execute'.
 */
export function decideExplanationPrecondition(
  invocation: {
    readonly context: { readonly prior_facts: readonly HandlerFact[] }
    readonly analysisProjection?: unknown
    // Restrict to the canonical freshness literals (not bare `string`) so
    // invalid caller/fixture values and misspelled comparison literals fail
    // typechecking. (Variant-exhaustiveness — a future verdict forcing a
    // decision here — is enforced by the switch below, not by this type.)
    readonly analysisFreshness?: { readonly freshness: AnalysisFreshness }
  },
): ExplanationPreconditionVerdict {
  const priorFacts = invocation.context.prior_facts
  const fd = invocation.analysisFreshness

  // Prefer the canonical freshness derivation as the single source of truth
  // for "a successful analysis fact exists"; fall back to a local scan only
  // when the derivation is absent (optional per the HandlerInvocation contract).
  const hasSuccessfulFact = fd
    ? fd.freshness !== 'none'
    : priorFacts.some(isSuccessfulRunAnalysisFact)

  if (!hasSuccessfulFact) {
    return selectDegradedRunAnalysisFact(priorFacts) !== null ? 'degraded' : 'missing'
  }

  // A successful fact EXISTS — 'missing' is unreachable from here (invariant).
  // Judge currency from the canonical verdict BEFORE the projection guard.
  // The switch is exhaustive over AnalysisFreshness (plus `undefined` for the
  // fallback path where the derivation is not threaded), so a future freshness
  // variant trips the `never` guard and forces an explicit decision here
  // rather than silently falling through to 'execute'.
  const freshness = fd?.freshness
  switch (freshness) {
    case 'stale':
      return 'stale' // the model has changed (hashes known to differ)
    case 'unknown':
      return 'unconfirmed' // Tier 0: can't confirm currency, treat as stale
    case 'fresh':
    case 'none': // unreachable once hasSuccessfulFact; kept for exhaustiveness
    case undefined: // derivation absent — local fallback path
      // Current analysis, but only summarisable when a projection was built.
      return invocation.analysisProjection == null ? 'degraded' : 'execute'
    default: {
      // Compile-time guard: a new AnalysisFreshness variant must add a case
      // above instead of inheriting the fresh/execute path by default.
      const _exhaustive: never = freshness
      return _exhaustive
    }
  }
}

/**
 * Render the precondition-fail assistant_text for a non-execute verdict.
 * Pure function over the verdict + invocation context.
 */
export function buildPreconditionAssistantText(
  verdict: Exclude<ExplanationPreconditionVerdict, 'execute'>,
  optionCount: number,
  readinessStatus: string | undefined,
  blockedOptionLabels: readonly string[] = [],
): string {
  switch (verdict) {
    case 'missing':
      return buildAnalysisAbsentTemplate(optionCount, readinessStatus, blockedOptionLabels)
    case 'stale':
      return buildAnalysisStaleTemplate()
    case 'unconfirmed':
      return buildAnalysisUnconfirmedTemplate()
    case 'degraded':
      return buildAnalysisDegradedTemplate()
  }
}

/**
 * Stale-analysis template. Used by the V5 explanation handlers when a
 * successful prior analysis exists but the current graph hash differs
 * from the hash at the time of that run.
 *
 * V5 stale-aware explain recovery — the opening sentence matches the
 * brief's required wording verbatim ("These results may be out of date
 * because the model has changed since the last analysis."). The
 * recovery offer follows so the user has a one-click path forward; the
 * chip-generator pairs this with a "Rerun analysis" suggested action.
 *
 * Hard-fail prose: the template contains no FORBIDDEN_USER_FACING_PHRASES
 * entry. The phrase "the last analysis" is intentional (not in the
 * forbidden list, distinct from the forbidden "previous analysis" /
 * "prior analysis"). Without internal terms (no graph hash, no
 * fact_type, no analysis_status).
 *
 * "the results" is used in place of any prescription-shaped noun. The
 * foamy-bee UI handoff brief bans `recommended`, `winner`, `winning`
 * from user-facing copy; the noun form `recommendation` is treated in
 * scope by the same rule.
 */
export function buildAnalysisStaleTemplate(): string {
  return (
    `These results may be out of date because the model has changed ` +
    `since the last analysis. Would you like to re-run analysis to see ` +
    `how your changes affect the results?`
  );
}

/**
 * Unconfirmed-freshness template. Used by the V5 explanation handlers when
 * a successful prior analysis exists but its currency cannot be confirmed
 * (freshness 'unknown' — a legacy fact missing its run-time graph hash, or
 * the current graph hash could not be computed this turn).
 *
 * Tier 0 doctrine: treat 'unknown' as stale for user-facing freshness, but
 * do NOT assert the model has changed — we don't know that. Say only that
 * we cannot confirm the last analysis still matches the current model, and
 * offer a re-run. Distinct from `buildAnalysisStaleTemplate`, which DOES
 * assert the change because the hashes are known to differ.
 *
 * Hard-fail prose: uses "the last analysis" (the forbidden list bans
 * "previous analysis" / "prior analysis"); "may be out of date" is the
 * brief's approved phrasing. No FORBIDDEN_USER_FACING_PHRASES entry, no
 * internal terms (no graph hash, fact_type, analysis_status).
 */
export function buildAnalysisUnconfirmedTemplate(): string {
  return (
    `The last analysis may be out of date because I can't confirm it ` +
    `still matches the current model. Re-run analysis to see the current result.`
  );
}

/**
 * Degraded-analysis template. Used by the V5 explanation handlers when
 * the most recent run_analysis fact arrived in a non-success state
 * (partial / blocked / failed / future non-canonical statuses). Frames
 * the situation in user terms — the analysis didn't produce usable
 * results — and offers a recovery path. Never echoes the internal
 * status string. The chip-generator pairs this with a "Re-run analysis"
 * suggested action.
 */
export function buildAnalysisDegradedTemplate(): string {
  return (
    `The last analysis didn't produce a usable result, so I can't ` +
    `summarise it for you. Would you like to re-run analysis?`
  );
}
