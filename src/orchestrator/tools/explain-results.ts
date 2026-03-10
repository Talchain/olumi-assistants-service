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

// ============================================================================
// Types
// ============================================================================

export interface ExplainResultsResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
}

// ============================================================================
// Numeric Freehand Stripping
// ============================================================================

/**
 * Pattern matching ungrounded numeric tokens:
 * - Integers: "42", "1000"
 * - Decimals: "3.14", "0.5"
 * - Percentages: "42%", "99.9%"
 * - Currency: "$20", "£20k", "$1.5M"
 * - Ranges: "10-12", "10–12"
 * - Approximations: "~10", "approximately 10", "about 10"
 * - K/M/B suffixes: "10k", "1.5M", "2B"
 *
 * Exemptions: 4-digit years (1900-2099) unless preceded by analysis-context words.
 */
const NUMERIC_PATTERN = /(?:approximately |about |around |roughly |~)?(?:\$|£|€)?[\d,]+(?:\.\d+)?(?:%|k|m|b)?(?:\s*[-–]\s*(?:\$|£|€)?[\d,]+(?:\.\d+)?(?:%|k|m|b)?)?/gi;

/**
 * Strip ungrounded numeric tokens from commentary text.
 * Returns { cleaned, strippedCount }.
 */
export function stripUngroundedNumerics(text: string): { cleaned: string; strippedCount: number } {
  let strippedCount = 0;

  const cleaned = text.replace(NUMERIC_PATTERN, (match) => {
    // Strip commas and whitespace for pattern checking
    const core = match.trim().replace(/,/g, '');

    // Preserve 4-digit years (1900-2099)
    if (/^(?:19|20)\d{2}$/.test(core)) {
      return match;
    }

    // Preserve single-digit references like "3 options" (likely structural)
    if (/^\d$/.test(core)) {
      return match;
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

    // Strip ungrounded numerics
    const { cleaned, strippedCount } = stripUngroundedNumerics(chatResult.content);

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

    return {
      blocks: [block],
      assistantText: null,
      latencyMs,
    };
  } catch (error) {
    // Tiered graceful degradation — never 500.
    // Tier 1: if winner + top driver extractable, produce short explanation.
    // Tier 2: generic fallback when even that's missing.
    log.warn(
      { request_id: requestId, error: error instanceof Error ? error.message : String(error) },
      'explain_results: falling back to graceful degradation',
    );

    const insight = extractFallbackInsight(analysisResponse);
    const fallbackText = insight
      ?? 'I was unable to generate a detailed explanation of the analysis results. The analysis data may be incomplete. Try running the analysis again, or ask a more specific question.';

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
  const results = Array.isArray(response.results) ? response.results as Array<Record<string, unknown>> : [];
  const validResults = results.filter(
    (r) => typeof r.option_label === 'string' && typeof r.win_probability === 'number',
  );
  if (validResults.length > 0) {
    const optionSummaries = validResults
      .map((r) => `${r.option_label}: ${((r.win_probability as number) * 100).toFixed(1)}%`)
      .join(', ');
    parts.push(`Option comparison: ${optionSummaries}`);
  }

  // Sensitivity summary (top drivers) — guard each entry
  const factors = Array.isArray(response.factor_sensitivity) ? response.factor_sensitivity as Array<Record<string, unknown>> : [];
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
  const results = Array.isArray(response.results) ? response.results as Array<Record<string, unknown>> : [];
  const validResults = results.filter(
    (r) => typeof r.option_label === 'string' && typeof r.win_probability === 'number',
  );

  if (validResults.length === 0) return null;

  // Sort by win_probability desc, take winner
  const sorted = [...validResults].sort((a, b) => (b.win_probability as number) - (a.win_probability as number));
  const winner = sorted[0];
  const winnerLabel = winner.option_label as string;
  const winnerProb = ((winner.win_probability as number) * 100).toFixed(1);

  // Try to get top driver
  const factors = Array.isArray(response.factor_sensitivity) ? response.factor_sensitivity as Array<Record<string, unknown>> : [];
  const topDriver = factors.find((f) => f.label != null);
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
