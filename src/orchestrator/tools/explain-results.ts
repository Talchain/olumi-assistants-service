/**
 * explain_results Tool Handler
 *
 * Internal LLM call via adapter.chat(). No external endpoint.
 * Output: CommentaryBlock with SupportingRef[] citations.
 *
 * No-numeric-freehand rule: Strip ungrounded numeric tokens.
 * Includes: integers, decimals, percentages ("42%"), currency ("£20k"),
 * ranges ("10–12"), approximations ("~10", "10k").
 * Years/dates only require citation when relating to analysis outputs.
 * Log commentary.numeric_freehand_stripped.
 *
 * Sensitivity prioritisation: From Evidence Priority card in review_cards[].
 * If no card, skip — don't compute substitute.
 *
 * Constraint tension: If joint_probability < min(individual_probabilities) × 0.7,
 * narrate "in tension." Threshold 0.7 provisional.
 */

import { log } from "../../utils/telemetry.js";
import { ORCHESTRATOR_TIMEOUT_MS } from "../../config/timeouts.js";
import type { LLMAdapter, CallOpts } from "../../adapters/llm/types.js";
import type { ConversationBlock, ConversationContext, V2RunResponseEnvelope, OrchestratorError, SupportingRef } from "../types.js";
import { createCommentaryBlock } from "../blocks/factory.js";
import { isAnalysisCurrent, isAnalysisExplainable } from "../analysis-state.js";

// ============================================================================
// Types
// ============================================================================

export interface ExplainResultsResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
  /** Which tier resolved this turn: 1 = cached deterministic, 2 = review data, 3 = LLM. */
  deterministic_answer_tier?: 1 | 2 | 3;
}

// ============================================================================
// Question Classification — Deterministic Tier Router
// ============================================================================

export type ExplainQuestionClass = 'tier1' | 'tier2' | 'tier2_recommendation' | 'tier3';

/**
 * Tier 1: Cache-safe factual reads — winner, scores, drivers, robustness.
 * Conservative — false negatives (falling to Tier 3) are preferable.
 */
const TIER1_PATTERNS = [
  /\bwho\s*(?:'s|is)\s+winning\b/i,
  /\bwho\s+wins\b/i,
  /\bwhich\s+(?:option\s+)?is\s+(?:winning|best)\b/i,
  /\bwhich\s+is\s+(?:winning|best)\b/i,
  /\bwhat\s*(?:'s|is)\s+(?:the\s+)?(?:top\s+)?(?:recommendation|best)\b/i,
  /\bwhat\s+(?:are\s+(?:the\s+)?)?top\s+drivers\b/i,
  /\bwhat\s+(?:matters|drives)\s+most\b/i,
  /\bwhat\s+(?:are\s+(?:the\s+)?)?scores?\b/i,
  /\b(?:show\s+me\s+(?:the\s+)?)?option\s+(?:scores?|comparison)\b/i,
  /\bwhat\s+(?:are\s+(?:the\s+)?)?options?\b/i,
  /\bhow\s+(?:robust|confident|stable|reliable|strong)\b/i,
  /\b(?:how\s+do\s+(?:the\s+)?options\s+)?compare\s+(?:the\s+)?options\b/i,
  /\bhow\s+do\s+(?:the\s+)?options\s+compare\b/i,
];

/** Tier 3: Causal/counterfactual questions that need multi-step LLM reasoning. */
const TIER3_CAUSAL_PATTERNS = [
  /\bwhy\b/i,
  /\bwhat\s+(?:would|could|might)\s+(?:change|affect|shift|flip|alter)\b/i,
  /\bwhat\s+if\b/i,
  /\bhow\s+does\s+\w+\s+affect\b/i,
  /\bhow\s+would\b/i,
  /\bwhat\s+caused?\b/i,
  /\bwhat\s+drives?\b/i,
];

/** Tier 2: Summary/narrative questions served from review_cards. */
const TIER2_PATTERNS = [
  /\bsumm(?:arise|arize)\b/i,
  /\bheadline\b/i,
  /\bgive\s+me\s+(?:a\s+|an\s+)?(?:summary|overview|headline)\b/i,
  /\bwhat\s+(?:did|does)\s+(?:the\s+)?analysis\s+(?:say|show|find)\b/i,
];

/** Tier 2 recommendation: explicit "what should I do / which should I choose". */
const TIER2_RECOMMENDATION_PATTERNS = [
  /\bwhat\s+should\s+I\s+(?:do|choose|pick|go\s+with)\b/i,
  /\bwhich\s+(?:option\s+)?should\s+I\s+(?:choose|pick|go\s+with|select)\b/i,
  /\bwhich\s+is\s+(?:better|best|recommended)\b/i,
];

/**
 * Classify a user question/focus into a deterministic routing tier.
 *
 * Conservative: false negatives (falling through to Tier 3) are preferred
 * over false positives (answering deterministically when the question needs LLM).
 */
export function classifyExplainQuestion(message: string): ExplainQuestionClass {
  if (!message || message.trim().length === 0) return 'tier3';

  // Check causal patterns first -- if present, always Tier 3
  for (const pattern of TIER3_CAUSAL_PATTERNS) {
    if (pattern.test(message)) return 'tier3';
  }

  // Tier 1: factual reads
  for (const pattern of TIER1_PATTERNS) {
    if (pattern.test(message)) return 'tier1';
  }

  // Tier 2 recommendation
  for (const pattern of TIER2_RECOMMENDATION_PATTERNS) {
    if (pattern.test(message)) return 'tier2_recommendation';
  }

  // Tier 2 summary/narrative
  for (const pattern of TIER2_PATTERNS) {
    if (pattern.test(message)) return 'tier2';
  }

  return 'tier3';
}

// ============================================================================
// Tier 1 Deterministic Builders
// ============================================================================

interface CompactSummary {
  winner: { label: string; probability: number } | null;
  options: Array<{ label: string; probability: number }>;
  topDrivers: string[];
  robustnessLevel: string | null;
}

function buildCompactSummaryFromResponse(response: V2RunResponseEnvelope): CompactSummary | null {
  const results = getOptionResults(response);
  const validResults = results.filter(
    (r) => typeof r.option_label === 'string' && typeof r.win_probability === 'number',
  );
  if (validResults.length === 0) return null;

  const sorted = [...validResults].sort((a, b) => (b.win_probability as number) - (a.win_probability as number));
  const options = sorted.map(r => ({
    label: r.option_label as string,
    probability: (r.win_probability as number) * 100,
  }));

  const rr = response as Record<string, unknown>;
  const nestedRr = rr.results && typeof rr.results === 'object' && !Array.isArray(rr.results) ? rr.results as Record<string, unknown> : null;
  const rawFs = response.factor_sensitivity ?? nestedRr?.factor_sensitivity;
  const factors = Array.isArray(rawFs) ? rawFs as Array<Record<string, unknown>> : [];
  const topDrivers = factors.slice(0, 3).filter(f => f.label != null).map(f => String(f.label));

  const robustnessLevel = (response.robustness?.level as string | undefined) ?? null;

  return {
    winner: options[0] ?? null,
    options,
    topDrivers,
    robustnessLevel,
  };
}

function buildTier1Default(summary: CompactSummary, stalePrefix: string): string | null {
  if (!summary.winner) return null;
  const parts: string[] = [];
  if (stalePrefix) parts.push(stalePrefix);
  parts.push(`${summary.winner.label} leads with ${summary.winner.probability.toFixed(1)}% win probability.`);
  if (summary.options.length > 1) {
    const others = summary.options.slice(1).map(o => `${o.label} (${o.probability.toFixed(1)}%)`).join(', ');
    parts.push(`Other options: ${others}.`);
  }
  return parts.join(' ');
}

function buildTier1DriversAnswer(summary: CompactSummary, stalePrefix: string): string | null {
  if (summary.topDrivers.length === 0) return null;
  const parts: string[] = [];
  if (stalePrefix) parts.push(stalePrefix);
  parts.push(`Top sensitivity drivers: ${summary.topDrivers.join(', ')}.`);
  return parts.join(' ');
}

function buildTier1OptionsAnswer(summary: CompactSummary, stalePrefix: string): string | null {
  if (summary.options.length === 0) return null;
  const parts: string[] = [];
  if (stalePrefix) parts.push(stalePrefix);
  const optionList = summary.options.map(o => `${o.label} (${o.probability.toFixed(1)}%)`).join(', ');
  parts.push(`Options analysed: ${optionList}.`);
  return parts.join(' ');
}

function buildTier1RobustnessAnswer(summary: CompactSummary, stalePrefix: string): string | null {
  if (!summary.robustnessLevel) return null;
  const parts: string[] = [];
  if (stalePrefix) parts.push(stalePrefix);
  parts.push(`Model robustness is rated ${summary.robustnessLevel}.`);
  return parts.join(' ');
}

/**
 * Route a Tier 1 question to the appropriate sub-answer based on the focus text.
 * Returns null if the relevant data is absent (falls through to Tier 3).
 */
function buildTier1Response(
  questionText: string,
  summary: CompactSummary,
  stalePrefix: string,
): string | null {
  // Driver question
  if (/\b(?:top\s+)?drivers?\b|\bmatters\s+most\b|\bdrives?\s+most\b/i.test(questionText)) {
    return buildTier1DriversAnswer(summary, stalePrefix);
  }
  // Options/scores question
  if (/\boptions?\b|\bscores?\b/i.test(questionText)) {
    return buildTier1OptionsAnswer(summary, stalePrefix);
  }
  // Robustness question
  if (/\bhow\s+(?:robust|confident|stable|reliable|strong)\b/i.test(questionText)) {
    return buildTier1RobustnessAnswer(summary, stalePrefix);
  }
  // Winning / recommendation default
  return buildTier1Default(summary, stalePrefix);
}

// ============================================================================
// Tier 2 Review Data Builder
// ============================================================================

function buildTier2ReviewAnswer(
  response: V2RunResponseEnvelope,
  questionClass: ExplainQuestionClass,
  stalePrefix: string,
): string | null {
  const reviewCards = Array.isArray(response.review_cards) ? response.review_cards as Array<Record<string, unknown>> : [];
  if (reviewCards.length === 0) return null;

  if (questionClass === 'tier2_recommendation') {
    // Only answer if an explicit recommendation exists — otherwise fall to Tier 3
    const recCard = reviewCards.find(c => typeof c.recommendation_summary === 'string' && c.recommendation_summary.trim());
    if (!recCard) return null;
    const parts: string[] = [];
    if (stalePrefix) parts.push(stalePrefix);
    parts.push(recCard.recommendation_summary as string);
    return parts.join(' ');
  }

  // Tier 2 summary — use first narrative_summary
  const summaryCard = reviewCards.find(c => typeof c.narrative_summary === 'string' && c.narrative_summary.trim());
  if (!summaryCard) return null;
  const parts: string[] = [];
  if (stalePrefix) parts.push(stalePrefix);
  parts.push(summaryCard.narrative_summary as string);
  return parts.join(' ');
}

// ============================================================================
// PLoT Response Normalization
// ============================================================================

/**
 * Resolve option results from a V2RunResponseEnvelope.
 * PLoT /v2/run returns data under `option_comparison`, but the typed interface
 * and UI normalizer use `results`. This helper checks both fields.
 */
function getOptionResults(response: V2RunResponseEnvelope): Array<Record<string, unknown>> {
  const fromResults = Array.isArray(response.results) ? response.results as Array<Record<string, unknown>> : [];
  if (fromResults.length > 0) return fromResults;

  // Fallback: PLoT returns option_comparison instead of results
  const r = response as Record<string, unknown>;
  const oc = r.option_comparison;
  if (Array.isArray(oc) && oc.length > 0) return oc as Array<Record<string, unknown>>;

  // Fallback: UI may nest V2 fields inside results as an object
  if (r.results && typeof r.results === 'object' && !Array.isArray(r.results)) {
    const nested = r.results as Record<string, unknown>;
    if (Array.isArray(nested.option_comparison)) return nested.option_comparison as Array<Record<string, unknown>>;
  }
  return [];
}

// ============================================================================
// Numeric Freehand Stripping (Grounded-Set Aware)
// ============================================================================

/**
 * Pattern matching numeric tokens in LLM output:
 * - Integers: "42", "1000"
 * - Decimals: "3.14", "0.5", "-0.4"
 * - Percentages: "42%", "99.9%", "62 percent"
 * - Currency: "$20", "£20k", "$1.5M", "-$500"
 * - Ranges: "10-12", "10–12"
 * - Approximations: "~10", "approximately 10", "about 10"
 * - K/M/B suffixes: "10k", "1.5M", "2B"
 */
const NUMERIC_PATTERN = /(?:approximately |about |around |roughly |~)?-?(?:\$|£|€)?\d[\d,]*(?:\.\d+)?(?:%|\s*percent\b|k|m|b)?(?:\s*[-–]\s*-?(?:\$|£|€)?\d[\d,]*(?:\.\d+)?(?:%|\s*percent\b|k|m|b)?)?/gi;

/**
 * Build a set of grounded numeric values from analysis data.
 * These are numbers the LLM is expected to cite and must NOT be stripped.
 *
 * For each raw value we generate multiple surface forms:
 *   0.62 → "62", "62.0", "0.62"
 *   18500 → "18500", "18,500", "18.5k"
 */
export function buildGroundedValues(analysisResponse: V2RunResponseEnvelope): Set<string> {
  const values = new Set<string>();

  function addNumber(n: number): void {
    if (!Number.isFinite(n)) return;

    // Raw value and common formatting variants
    values.add(String(n));
    values.add(n.toFixed(1));

    // For negative numbers, also ground the absolute value
    // (LLM may write "0.4" when citing elasticity of -0.4)
    if (n < 0) {
      addNumber(-n);
    }

    // Integer form (for things like 18500)
    if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 0.001) {
      const rounded = Math.round(n);
      values.add(String(rounded));
      // Comma-separated (18,500) — manual formatting for determinism
      if (Math.abs(rounded) >= 1000) {
        values.add(Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));
      }
    }

    // Percentage form (0.62 → "62", "62.0", also rounded like "63" for 0.625)
    if (n >= 0 && n <= 1) {
      const pct = n * 100;
      values.add(String(Math.round(pct)));
      values.add(pct.toFixed(1));
      // Handle LLM rounding: floor and ceil
      values.add(String(Math.floor(pct)));
      values.add(String(Math.ceil(pct)));
    }

    // Already a percentage-scale number (65.0 → "65")
    if (n > 1 && n <= 100) {
      values.add(String(Math.round(n)));
      values.add(n.toFixed(1));
    }

    // K/M suffixes for large numbers
    if (Math.abs(n) >= 1000) {
      const k = n / 1000;
      values.add(`${Number.isInteger(k) ? k : k.toFixed(1)}k`);
    }
    if (Math.abs(n) >= 1_000_000) {
      const m = n / 1_000_000;
      values.add(`${Number.isInteger(m) ? m : m.toFixed(1)}m`);
    }
  }

  // Option win probabilities (results or option_comparison)
  const results = getOptionResults(analysisResponse);
  for (const r of results) {
    if (typeof r.win_probability === 'number') addNumber(r.win_probability);
    // Goal values (mean, p10, p50, p90)
    const gv = r.goal_value as Record<string, unknown> | undefined;
    if (gv && typeof gv === 'object') {
      for (const k of ['mean', 'p10', 'p50', 'p90', 'min', 'max'] as const) {
        if (typeof gv[k] === 'number') addNumber(gv[k] as number);
      }
    }
  }

  // Factor sensitivities (elasticity values)
  const arNested = (analysisResponse as Record<string, unknown>).results;
  const arNestedObj = arNested && typeof arNested === 'object' && !Array.isArray(arNested) ? arNested as Record<string, unknown> : null;
  const rawArFactors = analysisResponse.factor_sensitivity ?? arNestedObj?.factor_sensitivity;
  const arFactors = Array.isArray(rawArFactors) ? rawArFactors as Array<Record<string, unknown>> : [];
  for (const f of arFactors) {
    if (typeof f.elasticity === 'number') addNumber(f.elasticity);
  }

  // Robustness
  if (analysisResponse.robustness) {
    const rob = analysisResponse.robustness;
    const fragileEdges = Array.isArray(rob.fragile_edges) ? rob.fragile_edges : [];
    values.add(String(fragileEdges.length));
    if (typeof rob.recommendation_stability === 'number') addNumber(rob.recommendation_stability);
    if (typeof rob.confidence === 'number') addNumber(rob.confidence);
  }

  // Constraint analysis
  if (analysisResponse.constraint_analysis) {
    const ca = analysisResponse.constraint_analysis;
    if (typeof ca.joint_probability === 'number') addNumber(ca.joint_probability);
    const perConstraint = Array.isArray(ca.per_constraint) ? ca.per_constraint as Array<Record<string, unknown>> : [];
    for (const c of perConstraint) {
      if (typeof c.probability === 'number') addNumber(c.probability);
    }
  }

  // Meta: samples count
  if (typeof analysisResponse.meta?.n_samples === 'number') {
    addNumber(analysisResponse.meta.n_samples);
  }

  // Option count and factor count (structural numbers)
  values.add(String(results.length));
  values.add(String(arFactors.length));

  return values;
}

// ============================================================================
// Brief-Context Number Extraction
// ============================================================================

/**
 * Decision-relevant nouns that, when adjacent to a number, indicate the number
 * is grounded in the user's brief and should NOT be stripped.
 */
const DECISION_RELEVANT_NOUNS = /\b(?:revenue|cost|price|target|goal|budget|timeline|months?|years?|quarters?|customers?|users?|mrr|arr|churn|conversion|headcount|salary|salaries|margin|roi|profit|turnover|spend|income|growth|rate|fee|subscription|deal|contract|wage|unit|volume|capacity)\b/i;

/**
 * Extract decision-relevant numbers from the user's original brief text.
 *
 * Only extracts numbers that appear alongside:
 * - Currency indicators (£, $, €, GBP, USD, etc.)
 * - Percentage expressions ("15%", "15 percent")
 * - Decision-relevant nouns (revenue, cost, MRR, target, etc.)
 *
 * Numbers in casual context ("I've been thinking about this for 3 weeks") are
 * excluded unless they match the above patterns.
 */
export function extractBriefNumbers(briefText: string): Set<string> {
  const values = new Set<string>();
  if (!briefText) return values;

  // Strategy: find all numbers in the brief, then check their surrounding
  // context (±40 chars) for decision-relevant signals.
  const NUMBER_IN_BRIEF = /(?:\$|£|€)?[\d,]+(?:\.\d+)?(?:%|\s*percent\b|[kmb]\b)?/gi;
  let m: RegExpExecArray | null;

  while ((m = NUMBER_IN_BRIEF.exec(briefText)) !== null) {
    const raw = m[0];
    const start = Math.max(0, m.index - 40);
    const end = Math.min(briefText.length, m.index + raw.length + 40);
    const vicinity = briefText.slice(start, end);

    // Check for decision-relevant context
    const hasCurrency = /[\$£€]|GBP|USD|EUR/i.test(vicinity);
    const hasPercent = /%/.test(raw) || /\bpercent\b/i.test(raw);
    const hasRelevantNoun = DECISION_RELEVANT_NOUNS.test(vicinity);

    if (!hasCurrency && !hasPercent && !hasRelevantNoun) continue;

    // Normalise to core numeric form (strip currency, commas)
    const core = raw
      .replace(/^[\$£€]/, '')
      .replace(/,/g, '')
      .replace(/\s*percent$/i, '%')
      .replace(/%$/, '');

    if (!core || !/\d/.test(core)) continue;

    values.add(core);

    // Resolve k/m/b suffix to full numeric value
    const suffixMatch = core.match(/^([\d.]+)([kmb])$/i);
    const multiplier = suffixMatch
      ? { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[suffixMatch[2].toLowerCase()] ?? 1
      : 1;
    const baseNum = suffixMatch ? parseFloat(suffixMatch[1]) : parseFloat(core);
    const n = baseNum * multiplier;

    // Also add common surface forms for matching
    if (Number.isFinite(n)) {
      values.add(String(n));
      if (Number.isInteger(n) && n >= 1000) {
        values.add(n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));
        const k = n / 1000;
        values.add(`${Number.isInteger(k) ? k : k.toFixed(1)}k`);
      }
      if (n >= 1_000_000) {
        const mil = n / 1_000_000;
        values.add(`${Number.isInteger(mil) ? mil : mil.toFixed(1)}m`);
      }
    }
  }

  return values;
}

/**
 * Extract numbers from graph node labels (option labels like "Raise to £59").
 * Uses the same decision-relevant context filter as extractBriefNumbers so that
 * only numbers appearing alongside currency, percentage, or decision-relevant
 * nouns are preserved. Only reads node.label — not IDs, edges, or internal fields.
 */
export function extractGraphNumbers(graphState: object | null | undefined): Set<string> {
  const values = new Set<string>();
  if (!graphState || typeof graphState !== 'object') return values;

  const g = graphState as Record<string, unknown>;
  const nodes = g.nodes;
  if (!Array.isArray(nodes)) return values;

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const label = (node as Record<string, unknown>).label;
    if (typeof label !== 'string' || !label) continue;

    // Reuse extractBriefNumbers which already applies the decision-relevant
    // context filter (currency, percentage, decision nouns).
    for (const v of extractBriefNumbers(label)) {
      values.add(v);
    }
  }

  return values;
}

/**
 * Extract the core numeric value from a matched token.
 * Strips currency symbols, commas, whitespace, prefix words, and suffix chars.
 * Returns lowercase for case-insensitive matching.
 */
function extractCoreNumeric(match: string): string {
  return match
    .trim()
    .replace(/^(?:approximately|about|around|roughly|~)\s*/i, '')
    .replace(/^(-?)[\$£€]/, '$1')
    .replace(/,/g, '')
    .replace(/\s*percent/gi, '%')
    .toLowerCase();
}

/**
 * Strip ungrounded numeric tokens from commentary text.
 *
 * When analysisResponse is provided, numbers matching grounded analysis values
 * are preserved. Numbers not in the grounded set are stripped to '[value]'.
 *
 * When no analysisResponse is provided (legacy call), ALL non-exempt numbers
 * are stripped (backward-compatible behaviour).
 */
export function stripUngroundedNumerics(
  text: string,
  analysisResponse?: V2RunResponseEnvelope | null,
  briefText?: string | null,
  graphState?: object | null,
): { cleaned: string; strippedCount: number } {
  const groundedValues = analysisResponse ? buildGroundedValues(analysisResponse) : null;

  // Merge brief-context numbers into the grounded set
  if (groundedValues && briefText) {
    for (const v of extractBriefNumbers(briefText)) {
      groundedValues.add(v);
    }
  }

  // Merge graph-label numbers into the grounded set
  if (groundedValues && graphState) {
    for (const v of extractGraphNumbers(graphState)) {
      groundedValues.add(v);
    }
  }
  let strippedCount = 0;

  const cleaned = text.replace(NUMERIC_PATTERN, (match) => {
    const core = extractCoreNumeric(match);

    // Preserve 4-digit years (1900-2099)
    if (/^(?:19|20)\d{2}$/.test(core)) {
      return match;
    }

    // Preserve single-digit references like "3 options" (likely structural)
    if (/^\d$/.test(core)) {
      return match;
    }

    // When grounded set is available, check if this number is grounded
    if (groundedValues) {
      if (groundedValues.has(core)) {
        return match;
      }

      // Check without suffix (e.g., "65%" → "65")
      const withoutSuffix = core.replace(/%$/, '');
      if (withoutSuffix !== core && groundedValues.has(withoutSuffix)) {
        return match;
      }

      // Check range endpoints individually (e.g., "14200-22800" → "14200", "22800")
      const rangeMatch = core.match(/^(-?[\d.]+[km]?)\s*[-–]\s*(-?[\d.]+[km]?)$/);
      if (rangeMatch) {
        const [, left, right] = rangeMatch;
        if (groundedValues.has(left) || groundedValues.has(right)) {
          return match;
        }
      }
    }

    strippedCount++;
    return '[value]';
  });

  return { cleaned, strippedCount };
}

// ============================================================================
// Constraint Tension Detection
// ============================================================================

const CONSTRAINT_TENSION_THRESHOLD = 0.7;

/**
 * Detect constraint tension from analysis response.
 * Returns a tension note string, or null if no tension detected.
 */
export function detectConstraintTension(analysisResponse: V2RunResponseEnvelope): string | null {
  const ca = analysisResponse.constraint_analysis;
  if (!ca?.joint_probability || !ca?.per_constraint) return null;

  const jointProb = ca.joint_probability;
  const perConstraint = ca.per_constraint as Array<Record<string, unknown>>;

  const individualProbs = perConstraint
    .map((c) => c.probability as number)
    .filter((p) => typeof p === 'number' && Number.isFinite(p));

  if (individualProbs.length === 0) return null;

  const minIndividual = Math.min(...individualProbs);

  if (jointProb < minIndividual * CONSTRAINT_TENSION_THRESHOLD) {
    return `The constraints appear to be in tension — the joint probability (${(jointProb * 100).toFixed(1)}%) is significantly lower than the individual constraint probabilities, suggesting they interact in ways that make them harder to satisfy simultaneously.`;
  }

  return null;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Execute the explain_results tool.
 *
 * @param context - Conversation context (must have analysis_response)
 * @param adapter - LLM adapter for generating explanation
 * @param requestId - Request ID for tracing
 * @param turnId - Turn ID for block provenance
 * @param focus - Optional focus area for the explanation
 * @returns CommentaryBlock with citations
 */
export async function handleExplainResults(
  context: ConversationContext,
  adapter: LLMAdapter,
  requestId: string,
  turnId: string,
  focus?: string,
): Promise<ExplainResultsResult> {
  if (!context.analysis_response) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: 'No analysis results to explain. Run analysis first.',
      tool: 'explain_results',
      recoverable: true,
      suggested_retry: 'Run the analysis first, then ask for an explanation.',
    };
    throw Object.assign(new Error(err.message), { orchestratorError: err });
  }

  const startTime = Date.now();
  const analysisResponse = context.analysis_response;
  if (!isAnalysisExplainable(analysisResponse)) {
    return {
      blocks: [
        createCommentaryBlock(
          'I can only explain results from a completed, explainable analysis. Run the analysis again after the options are fully configured, then ask me to explain it.',
          turnId,
          'tool:explain_results:blocked',
        ),
      ],
      assistantText: null,
      latencyMs: Date.now() - startTime,
    };
  }

  // Determine stale state (graph changed since last analysis run)
  const stale = !isAnalysisCurrent(context.framing?.stage ?? null, analysisResponse);
  const stalePrefix = stale ? 'Based on the last analysis, before your recent changes:' : '';

  // Classify the question for deterministic routing
  const questionText = focus ?? '';
  const questionClass = classifyExplainQuestion(questionText);

  // ---- Tier 1: Cached deterministic read ----
  if (questionClass === 'tier1' && context.analysis_response) {
    const compactSummary = buildCompactSummaryFromResponse(analysisResponse);
    if (compactSummary) {
      const tier1Text = buildTier1Response(questionText, compactSummary, stalePrefix);
      if (tier1Text) {
        log.info(
          { request_id: requestId, tier: 1, question_class: questionClass, stale },
          'explain_results: deterministic_answer_tier=1',
        );
        return {
          blocks: [createCommentaryBlock(tier1Text, turnId, 'tool:explain_results:tier1')],
          assistantText: null,
          latencyMs: Date.now() - startTime,
          deterministic_answer_tier: 1,
        };
      }
    }
  }

  // ---- Tier 2: Review data narrative ----
  if ((questionClass === 'tier2' || questionClass === 'tier2_recommendation') && context.analysis_response) {
    const tier2Text = buildTier2ReviewAnswer(analysisResponse, questionClass, stalePrefix);
    if (tier2Text) {
      log.info(
        { request_id: requestId, tier: 2, question_class: questionClass, stale },
        'explain_results: deterministic_answer_tier=2',
      );
      return {
        blocks: [createCommentaryBlock(tier2Text, turnId, 'tool:explain_results:tier2')],
        assistantText: null,
        latencyMs: Date.now() - startTime,
        deterministic_answer_tier: 2,
      };
    }
  }

  // ---- Tier 3: LLM explanation ----
  // When analysis is stale and the question is causal/open (Tier 3), return a
  // recovery message instead of calling the LLM — a stale explanation would be misleading.
  if (stale) {
    return {
      blocks: [createCommentaryBlock(
        'The graph has changed since that run — please re-run the analysis to get an up-to-date explanation.',
        turnId,
        'tool:explain_results:stale',
      )],
      assistantText: null,
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    // Build summary for LLM context (avoid injecting full response)
    const summary = buildAnalysisSummary(analysisResponse);

    // Check for constraint tension
    const tensionNote = detectConstraintTension(analysisResponse);

    // Build system prompt for explanation — include framing so the LLM grounds its
    // explanation in the actual decision goal and constraints, not just raw numbers.
    const framingContext = {
      goal: context.framing?.goal,
      constraints: Array.isArray(context.framing?.constraints) ? context.framing.constraints : undefined,
    };
    const systemPrompt = buildExplanationPrompt(summary, tensionNote, focus, framingContext);

    const opts: CallOpts = {
      requestId,
      timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
    };

    const chatResult = await adapter.chat(
      {
        system: systemPrompt,
        userMessage: focus
          ? `Explain the analysis results, focusing on: ${focus}`
          : 'Explain the analysis results.',
      },
      opts,
    );

    const latencyMs = Date.now() - startTime;

    // Strip ungrounded numerics — pass analysis data + all user-provided text so grounded values are preserved
    const briefText = buildBriefTextForGrounding(context);
    if (!briefText) {
      log.info({ request_id: requestId }, 'explain-results: brief_text not available, brief numbers will not be preserved');
    }
    const { cleaned, strippedCount } = stripUngroundedNumerics(chatResult.content, analysisResponse, briefText, context.graph);

    if (strippedCount > 0) {
      log.info(
        { request_id: requestId, stripped_count: strippedCount },
        "commentary.numeric_freehand_stripped",
      );
    }

    // Build supporting refs from analysis elements
    const refs = buildSupportingRefs(analysisResponse);

    const block = createCommentaryBlock(
      cleaned,
      turnId,
      'tool:explain_results',
      refs,
    );

    log.info(
      { request_id: requestId, tier: 3, question_class: questionClass, stale },
      'explain_results: deterministic_answer_tier=3',
    );

    return {
      blocks: [block],
      assistantText: null,
      latencyMs,
      deterministic_answer_tier: 3,
    };
  } catch (error) {
    // Graceful degradation — never 500.
    log.warn(
      { request_id: requestId, error: error instanceof Error ? error.message : String(error) },
      'explain_results: falling back to graceful degradation',
    );

    const insight = extractFallbackInsight(analysisResponse);
    const fallbackText = insight
      ?? 'I could not produce a fuller explanation from the current explainable analysis. Ask a more specific question about the drivers, trade-offs, or constraints.';

    const block = createCommentaryBlock(
      fallbackText,
      turnId,
      'tool:explain_results:fallback',
    );

    return {
      blocks: [block],
      assistantText: null,
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a compact analysis summary for LLM context.
 * Defensive: every field access is guarded — malformed analysis data must not crash.
 */
function buildAnalysisSummary(response: V2RunResponseEnvelope): string {
  const parts: string[] = [];

  // Results summary (option comparison) — filter to entries with valid label + probability
  const results = getOptionResults(response);
  const validResults = results.filter(
    (r) => typeof r.option_label === 'string' && typeof r.win_probability === 'number',
  );
  if (validResults.length > 0) {
    const optionSummaries = validResults
      .map((r) => `${r.option_label}: ${((r.win_probability as number) * 100).toFixed(1)}%`)
      .join(', ');
    parts.push(`Option comparison: ${optionSummaries}`);
  }

  // Sensitivity summary (top drivers) — guard each entry.
  // factor_sensitivity is top-level on V2RunResponseEnvelope; fall back to
  // the nested results object shape used by some PLoT response variants.
  const r = response as Record<string, unknown>;
  const nestedResults = r.results && typeof r.results === 'object' && !Array.isArray(r.results) ? r.results as Record<string, unknown> : null;
  const rawFactors = response.factor_sensitivity ?? nestedResults?.factor_sensitivity;
  const factors = Array.isArray(rawFactors) ? rawFactors as Array<Record<string, unknown>> : [];
  if (factors.length > 0) {
    const top5 = factors.slice(0, 5)
      .filter((f) => f.label != null)
      .map((f) => `${f.label} (elasticity: ${f.elasticity ?? 'N/A'}, direction: ${f.direction ?? 'N/A'})`)
      .join('; ');
    if (top5) {
      parts.push(`Top sensitivity drivers: ${top5}`);
    }
  }

  // Robustness — guard level and fragile_edges
  if (response.robustness) {
    parts.push(`Robustness: ${response.robustness.level ?? 'unknown'}`);
    const fragileEdges = Array.isArray(response.robustness.fragile_edges) ? response.robustness.fragile_edges : [];
    if (fragileEdges.length > 0) {
      parts.push(`Fragile edges: ${fragileEdges.length}`);
    }
  }

  // Constraint analysis — guard joint_probability
  if (response.constraint_analysis) {
    const ca = response.constraint_analysis;
    if (typeof ca.joint_probability === 'number' && Number.isFinite(ca.joint_probability)) {
      parts.push(`Constraint joint probability: ${(ca.joint_probability * 100).toFixed(1)}%`);
    }
  }

  return parts.length > 0
    ? parts.join('\n')
    : 'Analysis data is available but contains no detailed results.';
}

/**
 * Extract winner label and top driver for tiered degradation fallback.
 * Returns null if neither can be extracted.
 */
function extractFallbackInsight(response: V2RunResponseEnvelope): string | null {
  const results = getOptionResults(response);
  const validResults = results.filter(
    (r) => typeof r.option_label === 'string' && typeof r.win_probability === 'number',
  );

  if (validResults.length === 0) return null;

  // Sort by win_probability desc, take winner
  const sorted = [...validResults].sort((a, b) => (b.win_probability as number) - (a.win_probability as number));
  const winner = sorted[0];
  const winnerLabel = winner.option_label as string;
  const winnerProb = ((winner.win_probability as number) * 100).toFixed(1);

  // Try to get top driver — apply nested fallback for the same PLoT shape variants
  const fiNested = (response as Record<string, unknown>).results;
  const fiNestedObj = fiNested && typeof fiNested === 'object' && !Array.isArray(fiNested) ? fiNested as Record<string, unknown> : null;
  const rawFiFactors = response.factor_sensitivity ?? fiNestedObj?.factor_sensitivity;
  const fiFactors = Array.isArray(rawFiFactors) ? rawFiFactors as Array<Record<string, unknown>> : [];
  const topDriver = fiFactors.find((f) => f.label != null);
  const driverLabel = topDriver ? String(topDriver.label) : null;

  if (driverLabel) {
    return `Based on the analysis, ${winnerLabel} leads at ${winnerProb}%. The biggest driver is ${driverLabel}. I wasn't able to generate a full explanation — try asking a more specific question.`;
  }
  return `Based on the analysis, ${winnerLabel} leads at ${winnerProb}%. I wasn't able to generate a full explanation — try asking a more specific question.`;
}

function buildExplanationPrompt(
  summary: string,
  tensionNote: string | null,
  focus?: string,
  framing?: { goal?: string; constraints?: string[] },
): string {
  const sections = [
    'You are explaining analysis results from a Monte Carlo decision model.',
    'Use ONLY the data provided below. Do NOT generate specific numbers, percentages, or statistics from memory.',
    'When referencing a specific value, cite it from the analysis data.',
  ];

  // Ground the explanation in the actual decision context so responses
  // are relevant to the user's goal, not just abstract model statistics.
  if (framing?.goal || (framing?.constraints && framing.constraints.length > 0)) {
    sections.push('', '## Decision Context');
    if (framing.goal) {
      sections.push(`Goal: ${framing.goal}`);
    }
    if (framing.constraints && framing.constraints.length > 0) {
      sections.push(`Constraints: ${framing.constraints.join(', ')}`);
    }
  }

  sections.push('', '## Analysis Data', summary);

  if (tensionNote) {
    sections.push('', '## Constraint Note', tensionNote);
  }

  if (focus) {
    sections.push('', `## Focus Area`, `The user wants to focus on: ${focus}`);
  }

  sections.push(
    '',
    '## Rules',
    '- Be concise and clear.',
    '- Cite specific values from the analysis data above.',
    '- Do NOT invent or estimate numbers.',
    '- Explain what the results mean for the user\'s decision goal.',
    '- Reference the goal and constraints when interpreting the results.',
  );

  return sections.join('\n');
}

/**
 * Build a combined brief text string from all user-provided text in the framing:
 * brief_text, goal, constraints, and option labels.
 * This ensures numbers in constraints (e.g., "£50k budget") and option labels
 * are preserved by the grounding filter.
 */
export function buildBriefTextForGrounding(context: ConversationContext): string | null {
  const framing = context.framing as Record<string, unknown> | null;
  if (!framing) return null;

  const parts: string[] = [];

  if (typeof framing.brief_text === 'string' && framing.brief_text) {
    parts.push(framing.brief_text);
  }
  if (typeof framing.goal === 'string' && framing.goal) {
    parts.push(framing.goal);
  }
  if (Array.isArray(framing.constraints)) {
    for (const c of framing.constraints) {
      if (typeof c === 'string' && c) parts.push(c);
    }
  }
  if (Array.isArray(framing.options)) {
    for (const o of framing.options) {
      if (typeof o === 'string' && o) {
        parts.push(o);
      } else if (o && typeof o === 'object') {
        const label = (o as Record<string, unknown>).label ?? (o as Record<string, unknown>).option_label;
        if (typeof label === 'string' && label) parts.push(label);
      }
    }
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function buildSupportingRefs(response: V2RunResponseEnvelope): SupportingRef[] {
  const refs: SupportingRef[] = [];

  // Reference fact objects if present
  if (response.fact_objects && Array.isArray(response.fact_objects)) {
    for (const fact of response.fact_objects) {
      const f = fact as Record<string, unknown>;
      if (f.fact_id && f.fact_type) {
        refs.push({
          ref_type: 'fact',
          ref_id: f.fact_id as string,
          claim: String(f.fact_type),
        });
      }
    }
  }

  return refs;
}
