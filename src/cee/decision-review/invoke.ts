/**
 * Shared decision_review LLM invocation helper.
 *
 * Extracted from src/routes/assist.v1.decision-review.ts for reuse by the
 * V5 Group 1 Task B auto-fire path. The HTTP endpoint keeps its full retry /
 * shape-correction logic layered on top; V5 uses single-shot semantics with
 * a hard 15s timeout, degrading to thin content on failure.
 *
 * Design:
 *  - `buildDecisionReviewUserMessage` exposes the exact user-message shape
 *    the prompt expects. Unchanged from the route handler.
 *  - `invokeDecisionReview` loads the prompt, calls the adapter, extracts
 *    JSON, and returns a parsed object plus call metadata. No retry; caller
 *    decides whether to retry. No rate limiting; that is a route concern.
 *  - Never throws on shape-check failure; returns null in `output` so the
 *    caller decides how to degrade.
 *  - Throws only on adapter errors / timeouts / aborts (caller catches and
 *    translates to graceful degradation).
 */

import { getSystemPrompt, getSystemPromptMeta } from '../../adapters/llm/prompt-loader.js';
import {
  getAdapterWithResolution,
  getMaxTokensFromConfig,
  type ModelResolution,
} from '../../adapters/llm/router.js';
import type { CallOpts } from '../../adapters/llm/types.js';
import { extractJsonFromResponse } from '../../utils/json-extractor.js';
import {
  buildScienceClaimsSection,
  injectScienceClaimsSection,
} from './science-claims.js';

// ============================================================================
// Shared input shape (subset the V5 enricher needs; route schema is richer)
// ============================================================================

/**
 * Adapter-side diagnostics for the decision_review LLM call. Lives on the
 * input object, never injected into the user message — see
 * `buildDecisionReviewUserMessage` for the strict separation. v12 (the next
 * decision_review prompt revision) will read these signals through a future
 * adapter-side hook that overrides deterministic_coaching defaults; today
 * v11 is unaware of `_meta` and that is intentional.
 */
export interface DecisionReviewMeta {
  readonly input_shape_version: 'v5-normalised';
  /** Number of populated entries on flip_threshold_data after derivation. */
  readonly flip_threshold_count: number;
  /** Number of populated entries on isl_results.factor_sensitivity. */
  readonly factor_sensitivity_count: number;
  /** Number of populated entries on isl_results.fragile_edges. */
  readonly fragile_edge_count: number;
  /** Number of model_critiques carried by deterministic_coaching after
   *  adapter v1 wiring (2026-05-21). Sourced from
   *  `enrichment.m1_coaching.model_critiques` when present; 0 when absent
   *  or when upstream supplies an empty array. May still be 0 in practice
   *  while PLoT's m1_coaching critiques pipeline matures. */
  readonly model_critique_count: number;
  /** Number of upstream m1_coaching.evidence_gaps entries that were object-
   *  shaped but missing one of the four required fields (factor_id,
   *  factor_label, voi_score, confidence). Internal observability only —
   *  the contract test at decision-review-enricher.contract.test.ts §"_meta
   *  is adapter-only" asserts this key never reaches the user message. */
  readonly evidence_gaps_dropped_count: number;
  /** True when at least one real upstream m1_coaching signal was mapped:
   *  non-default `readiness` or `headline_type`, non-empty `evidence_gaps`,
   *  or non-empty `model_critiques`. False when adapter fell back entirely
   *  to safe defaults (no m1_coaching subtree, or every field defaulted /
   *  was dropped). v13 will branch on this to decide whether to trust the
   *  `<DETERMINISTIC_COACHING>` block or derive from raw signals (margin,
   *  robustness_level, factor_sensitivity). */
  readonly has_deterministic_coaching: boolean;
  /** winner.win_probability minus runner_up.win_probability. Null when no
   *  runner-up exists. */
  readonly margin: number | null;
  /** robustness.level pulled defensively from the V2 envelope. Null when
   *  absent. */
  readonly robustness_level: string | null;
}

export interface DecisionReviewInvokeInput {
  readonly brief: string;
  readonly brief_hash: string;
  readonly graph: Record<string, unknown>;
  readonly isl_results: Record<string, unknown>;
  readonly deterministic_coaching: Record<string, unknown>;
  readonly winner: {
    readonly id: string;
    readonly label: string;
    readonly win_probability: number;
    readonly outcome_mean?: number;
    readonly [k: string]: unknown;
  };
  readonly runner_up: {
    readonly id: string;
    readonly label: string;
    readonly win_probability: number;
    readonly outcome_mean?: number;
    readonly [k: string]: unknown;
  } | null;
  readonly flip_threshold_data?: ReadonlyArray<Record<string, unknown>>;
  /** Adapter-side diagnostics — never injected into the user message. */
  readonly _meta?: DecisionReviewMeta;
}

export interface InvokeDecisionReviewOptions {
  readonly requestId: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface DecisionReviewInvokeResult {
  /** Parsed JSON object from the LLM response, or null when extraction failed. */
  readonly output: Record<string, unknown> | null;
  /** Raw LLM content (pre-extraction), for logging. */
  readonly raw: string;
  readonly model: string;
  readonly provider: string;
  readonly llm_latency_ms: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly prompt_version: string | undefined;
  /**
   * Model-routing resolution for this call. Closes the V5 holistic audit
   * UU-16 observability gap: previously this site used `getAdapter(...)`
   * which does not surface the precedence-chain outcome, leaving the only
   * post-run_analysis LLM call invisible on the `model_resolutions`
   * dashboard. Callers that have per-turn context (the V5 enricher does)
   * forward this into `recordModelResolution` so turn-debug attributions
   * cover decision_review alongside ORIENT.
   */
  readonly resolution: ModelResolution;
}

// ============================================================================
// FIX 2 (1.41) — prompt size budgets
//
// Live evidence (flag-activation trial, 2026-07-08) captured this prompt at
// ~9.9k input tokens for a MODEST 4-option/5-factor/15-edge decision, with
// zero capping anywhere on <GRAPH>, <ISL_RESULTS>, or <DETERMINISTIC_COACHING>
// (each is a raw `JSON.stringify` of whatever the caller forwards — see
// Docs/lanes for the FIX-2 read-only assessment). Nothing stops this from
// growing linearly (or worse) with graph/option/factor count on a larger
// real decision. The caps below are a structural ceiling: array-length caps
// (primary defense, keeping the most decision-relevant entries — highest
// |elasticity| factors, highest switch_probability edges, highest
// win_probability options) plus a hard per-section byte ceiling (backstop
// for pathological single-entry bloat, e.g. an oversized node.data blob,
// that array-count capping alone would not catch). Truncation is always
// disclosed in-prompt via a `[TRUNCATED: ...]` marker — never silent.
// ============================================================================

/** Max graph.nodes entries forwarded (structural cap — no per-node relevance signal at this layer, so we keep the first N). */
export const DECISION_REVIEW_MAX_GRAPH_NODES = 40;
/** Max graph.edges entries forwarded (same rationale as MAX_GRAPH_NODES). */
export const DECISION_REVIEW_MAX_GRAPH_EDGES = 80;
/** Max isl_results.factor_sensitivity entries forwarded — ranked by |elasticity| descending when truncating (matches the prompt's own "pick by highest voi/influence, not position" doctrine). */
export const DECISION_REVIEW_MAX_FACTOR_SENSITIVITY = 15;
/** Max isl_results.fragile_edges entries forwarded — ranked by switch_probability descending (most severe first) when truncating. */
export const DECISION_REVIEW_MAX_FRAGILE_EDGES = 15;
/** Max isl_results.option_comparison entries forwarded — ranked by win_probability descending when truncating. */
export const DECISION_REVIEW_MAX_OPTION_COMPARISON = 20;
/** Hard per-section byte ceiling applied AFTER array-count capping — a pure backstop, not the primary mechanism. Chosen well above typical (currently-observed) section sizes so it never clips a normal, well-formed payload. */
export const DECISION_REVIEW_SECTION_MAX_CHARS = 8_000;
/**
 * Max flip_threshold_data entries forwarded — ranked by smallest
 * |flip_value - current_value| (closest-to-flip = most actionable /
 * decision-relevant) when truncating, mirroring the historical
 * `deriveFlipThresholds` closest-distance doctrine in
 * `src/orchestrator/context/analysis-compact.ts`.
 *
 * FIX A (1.41 fix round, C1): this section was still raw uncapped
 * `JSON.stringify` after FIX 2 shipped — one entry per factor, uncapped —
 * defeating the "hard ceiling" claim for graphs with many flip-eligible
 * factors.
 */
export const DECISION_REVIEW_MAX_FLIP_THRESHOLD_ENTRIES = 15;
/**
 * Max `<BRIEF>` character length. The brief is user-controlled free text
 * (no array structure to count-cap), so this is a direct char ceiling with
 * disclosed truncation — same "never silent" doctrine as the hard
 * per-section byte ceiling.
 *
 * FIX A (1.41 fix round, C1): the brief was still raw, uncapped user input
 * forwarded verbatim.
 */
export const DECISION_REVIEW_MAX_BRIEF_CHARS = 2_000;

function readSortNum(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

/**
 * Cap an array to `max` entries. Under the cap: no-op (preserves original
 * order/content exactly — no behaviour change for typical/small payloads).
 * Over the cap: sorts by `rank` (descending relevance) before truncating,
 * so the KEPT entries are the most decision-relevant and the DROPPED tail
 * is the least relevant. Non-array input is treated as empty.
 */
function capArray<T>(
  arr: unknown,
  max: number,
  rank?: (a: T, b: T) => number,
): { kept: T[]; droppedCount: number } {
  if (!Array.isArray(arr)) return { kept: [], droppedCount: 0 };
  const list = arr as T[];
  if (list.length <= max) return { kept: list, droppedCount: 0 };
  const ranked = rank ? [...list].sort(rank) : list;
  return { kept: ranked.slice(0, max), droppedCount: list.length - max };
}

/**
 * Stringify a (already array-capped) section value, then apply the hard
 * byte-ceiling backstop. Any truncation (array-level or byte-level) is
 * disclosed via an appended `[TRUNCATED: ...]` marker — never silent.
 */
function boundedJsonBlock(value: unknown, notes: readonly string[]): string {
  let json = JSON.stringify(value, null, 2);
  const allNotes = [...notes];
  if (json.length > DECISION_REVIEW_SECTION_MAX_CHARS) {
    json = json.slice(0, DECISION_REVIEW_SECTION_MAX_CHARS);
    allNotes.push(`section body truncated at ${DECISION_REVIEW_SECTION_MAX_CHARS} chars (hard ceiling)`);
  }
  return allNotes.length > 0 ? `${json}\n[TRUNCATED: ${allNotes.join('; ')}]` : json;
}

/**
 * Cap a free-text block (the `<BRIEF>` section — user-controlled, no array
 * structure to count-cap) to `maxChars`. Under the cap: no-op (byte-identical
 * for typical/small briefs). Over the cap: hard-slice and disclose via the
 * same `[TRUNCATED: ...]` marker doctrine as `boundedJsonBlock` — never
 * silent.
 */
function boundedTextBlock(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n[TRUNCATED: brief truncated at ${maxChars} chars (hard ceiling), ${omitted} chars omitted]`;
}

/**
 * Distance-to-flip for a flip_threshold_data entry: |flip_value -
 * current_value|. Missing/non-numeric fields sort last (treated as least
 * relevant, not most) so a malformed entry never displaces a well-formed one
 * from the kept set.
 */
function flipDistance(entry: Record<string, unknown>): number {
  const flip = entry['flip_value'];
  const current = entry['current_value'];
  if (typeof flip !== 'number' || typeof current !== 'number' || !Number.isFinite(flip) || !Number.isFinite(current)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(flip - current);
}

// ============================================================================
// User message assembly (identical to route handler's buildUserMessage)
// ============================================================================

export function buildDecisionReviewUserMessage(
  input: DecisionReviewInvokeInput,
  margin: number | null,
): string {
  const sections: string[] = [];

  sections.push('<BRIEF>');
  sections.push(boundedTextBlock(input.brief, DECISION_REVIEW_MAX_BRIEF_CHARS));
  sections.push('</BRIEF>');

  // GRAPH — cap nodes/edges by count (no decision-relevance signal exists
  // for individual nodes/edges at this layer; keep the first N).
  const graphNodesRaw = input.graph['nodes'];
  const graphEdgesRaw = input.graph['edges'];
  const nodesCap = capArray<unknown>(graphNodesRaw, DECISION_REVIEW_MAX_GRAPH_NODES);
  const edgesCap = capArray<unknown>(graphEdgesRaw, DECISION_REVIEW_MAX_GRAPH_EDGES);
  const cappedGraph: Record<string, unknown> = {
    ...input.graph,
    ...(Array.isArray(graphNodesRaw) ? { nodes: nodesCap.kept } : {}),
    ...(Array.isArray(graphEdgesRaw) ? { edges: edgesCap.kept } : {}),
  };
  const graphNotes: string[] = [];
  if (nodesCap.droppedCount > 0) graphNotes.push(`${nodesCap.droppedCount} additional graph.nodes entries omitted`);
  if (edgesCap.droppedCount > 0) graphNotes.push(`${edgesCap.droppedCount} additional graph.edges entries omitted`);

  sections.push('<GRAPH>');
  sections.push(boundedJsonBlock(cappedGraph, graphNotes));
  sections.push('</GRAPH>');

  // ISL_RESULTS — cap factor_sensitivity / fragile_edges / option_comparison,
  // ranking by decision-relevance when truncation is actually needed.
  const islRaw = input.isl_results;
  const factorSensitivityRaw = islRaw['factor_sensitivity'];
  const fragileEdgesRaw = islRaw['fragile_edges'];
  const optionComparisonRaw = islRaw['option_comparison'];

  const factorCap = capArray<Record<string, unknown>>(
    factorSensitivityRaw,
    DECISION_REVIEW_MAX_FACTOR_SENSITIVITY,
    (a, b) => Math.abs(readSortNum(b.elasticity)) - Math.abs(readSortNum(a.elasticity)),
  );
  const edgeCap = capArray<Record<string, unknown>>(
    fragileEdgesRaw,
    DECISION_REVIEW_MAX_FRAGILE_EDGES,
    (a, b) => readSortNum(b.switch_probability) - readSortNum(a.switch_probability),
  );
  const optionCap = capArray<Record<string, unknown>>(
    optionComparisonRaw,
    DECISION_REVIEW_MAX_OPTION_COMPARISON,
    (a, b) => readSortNum(b.win_probability) - readSortNum(a.win_probability),
  );

  const cappedIslResults: Record<string, unknown> = {
    ...islRaw,
    ...(Array.isArray(factorSensitivityRaw) ? { factor_sensitivity: factorCap.kept } : {}),
    ...(Array.isArray(fragileEdgesRaw) ? { fragile_edges: edgeCap.kept } : {}),
    ...(Array.isArray(optionComparisonRaw) ? { option_comparison: optionCap.kept } : {}),
  };
  const islNotes: string[] = [];
  if (factorCap.droppedCount > 0) {
    islNotes.push(`${factorCap.droppedCount} lower-sensitivity factor_sensitivity entries omitted`);
  }
  if (edgeCap.droppedCount > 0) {
    islNotes.push(`${edgeCap.droppedCount} lower-severity fragile_edges entries omitted`);
  }
  if (optionCap.droppedCount > 0) {
    islNotes.push(`${optionCap.droppedCount} lower-probability option_comparison entries omitted`);
  }

  sections.push('<ISL_RESULTS>');
  sections.push(boundedJsonBlock(cappedIslResults, islNotes));
  sections.push('</ISL_RESULTS>');

  // DETERMINISTIC_COACHING — array-length capping (model_critiques allowlist
  // + count cap) happens upstream at the source
  // (orchestrator-v5/coaching/decision-review-enricher.ts
  // normaliseDeterministicCoachingFromM1, mirroring the evidence_gaps
  // pattern). Here we only apply the hard byte-ceiling backstop, since this
  // block's shape is caller-defined (the HTTP route handler builds its own
  // richer deterministic_coaching) and not always the enricher's output.
  sections.push('<DETERMINISTIC_COACHING>');
  sections.push(boundedJsonBlock(input.deterministic_coaching, []));
  sections.push('</DETERMINISTIC_COACHING>');

  sections.push('<DECISION_CONTEXT>');
  sections.push(`winner: ${JSON.stringify(input.winner)}`);
  if (input.runner_up !== null) {
    sections.push(`runner_up: ${JSON.stringify(input.runner_up)}`);
  } else {
    sections.push('runner_up: null (single-option decision)');
  }
  sections.push(`margin: ${JSON.stringify(margin)}`);
  sections.push('</DECISION_CONTEXT>');

  sections.push('<FLIP_THRESHOLD_DATA>');
  if (input.flip_threshold_data && input.flip_threshold_data.length > 0) {
    const flipCap = capArray<Record<string, unknown>>(
      input.flip_threshold_data,
      DECISION_REVIEW_MAX_FLIP_THRESHOLD_ENTRIES,
      (a, b) => flipDistance(a) - flipDistance(b),
    );
    const flipNotes: string[] = [];
    if (flipCap.droppedCount > 0) {
      flipNotes.push(`${flipCap.droppedCount} farther-from-flip flip_threshold_data entries omitted`);
    }
    sections.push(boundedJsonBlock(flipCap.kept, flipNotes));
  } else {
    sections.push('Not available');
  }
  sections.push('</FLIP_THRESHOLD_DATA>');

  return sections.join('\n\n');
}

// ============================================================================
// Single-shot invocation
// ============================================================================

/**
 * Load the decision_review prompt, call the configured adapter once, and
 * extract the JSON body. Returns `output: null` when JSON extraction fails.
 * Throws only on adapter / transport / timeout errors; caller is expected to
 * catch and decide how to degrade.
 */
export async function invokeDecisionReview(
  input: DecisionReviewInvokeInput,
  options: InvokeDecisionReviewOptions,
): Promise<DecisionReviewInvokeResult> {
  const rawPrompt = await getSystemPrompt('decision_review');
  const promptMeta = getSystemPromptMeta('decision_review');

  let assembledPrompt = rawPrompt;
  const scienceResult = buildScienceClaimsSection();
  if (scienceResult !== null && !rawPrompt.includes('<SCIENCE_CLAIMS>')) {
    assembledPrompt = injectScienceClaimsSection(rawPrompt, scienceResult.section);
  }

  const margin =
    input.runner_up !== null
      ? input.winner.win_probability - input.runner_up.win_probability
      : null;

  const userMessage = buildDecisionReviewUserMessage(input, margin);

  const { adapter, resolution } = getAdapterWithResolution('decision_review');
  const configuredMaxTokens = getMaxTokensFromConfig('decision_review');
  const maxTokens = configuredMaxTokens ?? 4096;

  const callOpts: CallOpts = {
    requestId: options.requestId,
    timeoutMs: options.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
  };

  const llmResult = await adapter.chat(
    {
      system: assembledPrompt,
      userMessage,
      temperature: 0,
      maxTokens,
      responseFormat: 'json_object',
    },
    callOpts,
  );

  const extraction = extractJsonFromResponse(llmResult.content, {
    task: 'decision_review',
    model: llmResult.model,
    correlationId: options.requestId,
  });

  const parsed =
    extraction.json && typeof extraction.json === 'object' && !Array.isArray(extraction.json)
      ? (extraction.json as Record<string, unknown>)
      : null;

  return {
    output: parsed,
    raw: llmResult.content,
    model: llmResult.model,
    provider: adapter.name,
    llm_latency_ms: llmResult.latencyMs,
    input_tokens: llmResult.usage.input_tokens,
    output_tokens: llmResult.usage.output_tokens,
    prompt_version: promptMeta.prompt_version,
    resolution,
  };
}
