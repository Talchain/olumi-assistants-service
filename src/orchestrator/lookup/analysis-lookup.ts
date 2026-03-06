/**
 * Analysis Lookup — Deterministic Handler for Factual Analysis Questions
 *
 * Intercepts factual questions about cached analysis results and answers them
 * without an LLM call. Target latency: <500ms.
 *
 * Insertion point: inside Phase 3, AFTER the intent gate (which routes to tools)
 * but BEFORE the LLM call. If the intent gate already matched a tool, the lookup
 * does not fire. If the lookup matches, the LLM is skipped entirely.
 *
 * Causal/explanatory questions (why, what if, explain) are excluded — they
 * need explain_results, not a cached value.
 */

import { log } from "../../utils/telemetry.js";
import type { V2RunResponseEnvelope, SuggestedAction, ConversationBlock } from "../types.js";
import type { GraphV3T } from "../../schemas/cee-v3.js";
import type { EnrichedContext, OrchestratorResponseEnvelopeV2 } from "../pipeline/types.js";
import { resolveContextHash } from "../pipeline/phase5-validation/envelope-assembler.js";
import { config } from "../../config/index.js";
import { getDskVersionHash } from "../dsk-loader.js";

// ============================================================================
// Types
// ============================================================================

export type AnalysisLookupResult =
  | { matched: true; pattern: string; assistantText: string; suggestedActions: SuggestedAction[] }
  | { matched: false };

// ============================================================================
// Normalisation
// ============================================================================

function normalise(message: string): string {
  return message
    .toLowerCase()
    .trim()
    .replace(/[.!?,;:\u2026]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// Exclusion Patterns — causal/explanatory intent bypasses lookup
// ============================================================================

const EXCLUDE_KEYWORDS = [
  'why',
  'what would change',
  'what would happen',
  'what if',
  'explain',
  'recommend',
  'should we',
  'should i',
  'what do you think',
  'pros and cons',
  'how come',
  'cause',
  'reason',
];

function hasExcludedIntent(normalised: string): boolean {
  return EXCLUDE_KEYWORDS.some(kw => normalised.includes(kw));
}

// ============================================================================
// Field Path Drift Protection
// ============================================================================

/**
 * Safely access a nested field by dot-delimited path.
 * Returns undefined if any segment is missing.
 */
function getField(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const segment of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Try multiple field paths in order. Returns the first non-undefined value.
 */
function resolveField(obj: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const value = getField(obj, path);
    if (value !== undefined) return value;
  }
  return undefined;
}

// ============================================================================
// Lookup Catalogue
// ============================================================================

/**
 * Sentinel value: format returns SKIP_TO_LLM when the lookup matched
 * a keyword but the user's question requires LLM reasoning (e.g. asking
 * about an option not in the results). The caller treats this as
 * { matched: false } rather than a graceful fallback.
 */
const SKIP_TO_LLM = Symbol('SKIP_TO_LLM');

interface LookupEntry {
  keywords: string[];
  excludeKeywords?: string[];
  format: (analysis: V2RunResponseEnvelope, graph: GraphV3T | null, normalised?: string) => string | null | typeof SKIP_TO_LLM;
}

const LOOKUP_CATALOGUE: LookupEntry[] = [
  // Robustness
  {
    keywords: ['robustness', 'how robust', 'how reliable'],
    format: (analysis) => {
      const ar = analysis as unknown as Record<string, unknown>;
      const level = resolveField(ar, ['robustness.level', 'robustness.overall_level']) as string | undefined;
      const score = resolveField(ar, ['robustness.score', 'robustness.overall_score', 'robustness_score']) as number | undefined;
      if (!level && score === undefined) return null;
      const scorePart = score !== undefined ? `${Math.round(score * 100)}% ` : '';
      return `Robustness is ${scorePart}(${level ?? 'unknown'}) — the recommendation holds under ${scorePart || 'most '}of plausible parameter variations.`;
    },
  },

  // Win probability / option comparison
  {
    keywords: ['win probability', 'which option wins', 'how often does', 'what are the results', 'who wins'],
    format: (analysis, _graph, normalised) => {
      const results = analysis.results as Array<Record<string, unknown>> | undefined;
      if (!results || results.length === 0) return null;

      // If the user names a specific option, check it exists in results.
      // Return SKIP_TO_LLM when the named option is absent — the LLM can
      // explain that the option doesn't exist or suggest alternatives.
      if (normalised) {
        const optionLabels = results.map(r =>
          String(r.option_label ?? r.label ?? '').toLowerCase(),
        );
        for (const label of optionLabels) {
          if (label && normalised.includes(label)) break;
        }
        // Check if user mentioned an option-like noun not in the results.
        // Heuristic: if the message contains "option" followed by a word that
        // doesn't match any known label, fall through.
        const optionMention = normalised.match(/option\s+([a-z0-9]+)/);
        if (optionMention) {
          const mentioned = optionMention[1];
          const found = optionLabels.some(l => l.includes(mentioned));
          if (!found) return SKIP_TO_LLM;
        }
      }

      const sorted = [...results].sort((a, b) =>
        ((b.win_probability as number) ?? 0) - ((a.win_probability as number) ?? 0)
      );
      const lines = sorted.map(r =>
        `${r.option_label ?? r.label ?? 'Unknown'}: ${Math.round(((r.win_probability as number) ?? 0) * 100)}%`
      );
      const winner = sorted[0];
      const second = sorted[1];
      let text = `${winner.option_label ?? winner.label} wins in ${Math.round(((winner.win_probability as number) ?? 0) * 100)}% of simulations.`;
      if (second) {
        text += ` ${second.option_label ?? second.label} is at ${Math.round(((second.win_probability as number) ?? 0) * 100)}%.`;
      }
      if (sorted.length > 2) {
        text += `\n\nFull breakdown:\n${lines.join('\n')}`;
      }
      return text;
    },
  },

  // Top drivers / sensitivity
  {
    keywords: ['top drivers', 'what matters most', 'sensitivity', 'most influential', 'most sensitive', 'which factors matter'],
    format: (analysis) => {
      const factors = analysis.factor_sensitivity as Array<Record<string, unknown>> | undefined;
      if (!factors || factors.length === 0) return null;
      const sorted = [...factors].sort((a, b) =>
        Math.abs((b.elasticity as number) ?? (b.sensitivity as number) ?? 0) -
        Math.abs((a.elasticity as number) ?? (a.sensitivity as number) ?? 0)
      );
      const top3 = sorted.slice(0, 3);
      const lines = top3.map((f, i) => {
        const pct = Math.round(Math.abs(((f.elasticity as number) ?? (f.sensitivity as number) ?? 0) * 100));
        return `${i + 1}. ${f.label} (${pct}%)`;
      });
      return `The ${top3.length === 3 ? 'three ' : ''}most influential factors are:\n${lines.join('\n')}`;
    },
  },

  // Sample size
  {
    keywords: ['how many simulations', 'sample size', 'n samples', 'number of simulations'],
    format: (analysis) => {
      const ar = analysis as unknown as Record<string, unknown>;
      const n = resolveField(ar, ['meta.n_samples', 'n_samples']) as number | undefined;
      if (n === undefined) return null;
      return `The analysis ran ${n.toLocaleString()} simulations.`;
    },
  },

  // Model size
  {
    keywords: ['how many factors', 'model size', 'how big is the model'],
    format: (_analysis, graph) => {
      if (!graph) return null;
      const nodes = (graph as Record<string, unknown>).nodes as unknown[] | undefined;
      const edges = (graph as Record<string, unknown>).edges as unknown[] | undefined;
      const nNodes = nodes?.length ?? 0;
      const nEdges = edges?.length ?? 0;
      return `${nNodes} factors, ${nEdges} relationships.`;
    },
  },

  // Fragile edges / vulnerable assumptions
  {
    keywords: ['fragile', 'vulnerable assumptions', 'fragile edges', 'weak links'],
    format: (analysis) => {
      const ar = analysis as unknown as Record<string, unknown>;
      const fragile = resolveField(ar, ['robustness.fragile_edges']) as Array<Record<string, unknown>> | undefined;
      if (!fragile || fragile.length === 0) {
        return "No vulnerable assumptions were identified in the latest analysis.";
      }
      const labels = fragile.map(e => `${e.from ?? e.from_label ?? '?'} → ${e.to ?? e.to_label ?? '?'}`);
      return `${fragile.length} vulnerable assumption${fragile.length === 1 ? '' : 's'}: ${labels.join(', ')}.`;
    },
  },

  // Constraints
  {
    keywords: ['constraints', 'success conditions', 'are constraints met', 'constraint'],
    format: (analysis) => {
      const ar = analysis as unknown as Record<string, unknown>;
      const perConstraint = resolveField(ar, [
        'constraint_analysis.per_constraint',
        'constraint_analysis.constraints',
        'critiques',
      ]) as Array<Record<string, unknown>> | undefined;
      if (!perConstraint || perConstraint.length === 0) {
        return "No constraints were defined for this analysis.";
      }
      const lines = perConstraint.map(c => {
        const label = (c.label ?? c.constraint_label ?? c.name ?? 'Unnamed') as string;
        const prob = c.probability as number | undefined;
        const met = prob !== undefined ? (prob >= 0.5 ? 'met' : 'at risk') : 'unknown';
        return `- ${label}: ${met}${prob !== undefined ? ` (${Math.round(prob * 100)}%)` : ''}`;
      });
      return `${perConstraint.length} constraint${perConstraint.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
    },
  },
];

// ============================================================================
// Staleness Detection
// ============================================================================

/**
 * Detect whether the analysis is stale (graph was edited after analysis ran).
 *
 * Heuristic: if the stage is 'ideate' (graph editing phase) but analysis
 * exists, the graph was likely edited after the last analysis run.
 */
function isAnalysisStale(enrichedContext: EnrichedContext): boolean {
  if (!enrichedContext.analysis) return false;
  // Stage 'ideate' with existing analysis means graph was edited since last run
  return enrichedContext.stage_indicator.stage === 'ideate';
}

// ============================================================================
// Matching
// ============================================================================

/**
 * Try to match a user message against the lookup catalogue.
 *
 * Returns the formatted response if matched, or { matched: false } to
 * fall through to the LLM.
 */
export function tryAnalysisLookup(
  userMessage: string,
  analysisResponse: V2RunResponseEnvelope | null,
  graph: GraphV3T | null,
): AnalysisLookupResult {
  const start = Date.now();

  if (!analysisResponse) {
    log.debug({ reason: 'no_analysis' }, "Analysis lookup: skipped — no analysis in context");
    return { matched: false };
  }

  const normalised = normalise(userMessage);

  // Exclude causal/explanatory questions
  if (hasExcludedIntent(normalised)) {
    log.debug({ reason: 'excluded_intent', normalised }, "Analysis lookup: skipped — causal/explanatory intent");
    return { matched: false };
  }

  // Try each pattern in order (ordered by specificity)
  for (const entry of LOOKUP_CATALOGUE) {
    // Check exclude keywords first
    if (entry.excludeKeywords?.some(kw => normalised.includes(kw))) continue;

    // Check if any keyword matches
    const matchedKeyword = entry.keywords.find(kw => normalised.includes(kw));
    if (!matchedKeyword) continue;

    // Try to format the response
    const text = entry.format(analysisResponse, graph, normalised);
    if (text === SKIP_TO_LLM) {
      // Keyword matched but question needs LLM reasoning (e.g. named option absent)
      log.debug(
        { pattern: matchedKeyword, reason: 'skip_to_llm', latency_ms: Date.now() - start },
        "Analysis lookup: keyword matched but deferred to LLM",
      );
      return { matched: false };
    }
    if (text === null) {
      // Field not found at any path — graceful fallback
      log.info(
        { pattern: matchedKeyword, field_resolution: 'missing', latency_ms: Date.now() - start },
        "Analysis lookup: matched but field missing — returning fallback",
      );
      return {
        matched: true,
        pattern: matchedKeyword,
        assistantText: "I can't find that in the latest analysis results. Want me to explain what I can see?",
        suggestedActions: [
          { label: 'Explain results', prompt: 'explain the results', role: 'facilitator' },
        ],
      };
    }

    log.info(
      { pattern: matchedKeyword, field_resolution: 'found', latency_ms: Date.now() - start },
      "Analysis lookup: matched — returning deterministic response",
    );
    return {
      matched: true,
      pattern: matchedKeyword,
      assistantText: text + "\n\nAsk me 'why' if you'd like me to explain the drivers.",
      suggestedActions: [],
    };
  }

  log.debug(
    { reason: 'no_pattern_match', latency_ms: Date.now() - start },
    "Analysis lookup: no pattern matched",
  );
  return { matched: false };
}

// ============================================================================
// Envelope Builder
// ============================================================================

/**
 * Build a minimal V2 envelope for a lookup response.
 * Follows the same pattern as buildSystemEventAckEnvelope in pipeline.ts.
 */
export function buildLookupEnvelope(
  enrichedContext: EnrichedContext,
  lookupResult: Extract<AnalysisLookupResult, { matched: true }>,
): OrchestratorResponseEnvelopeV2 {
  let text = lookupResult.assistantText;

  // Append staleness note if analysis is stale
  if (isAnalysisStale(enrichedContext)) {
    text += "\n\nNote: this is from the last analysis run, which doesn't reflect your recent edits.";
  }

  return {
    turn_id: enrichedContext.turn_id,
    assistant_text: text,
    blocks: [],
    suggested_actions: lookupResult.suggestedActions,
    guidance_items: [],

    lineage: {
      context_hash: resolveContextHash(enrichedContext),
      dsk_version_hash: config.features.dskV0
        ? (getDskVersionHash() ?? enrichedContext.dsk.version_hash)
        : null,
    },

    stage_indicator: {
      stage: enrichedContext.stage_indicator.stage,
      confidence: enrichedContext.stage_indicator.confidence,
      source: enrichedContext.stage_indicator.source,
    },

    science_ledger: {
      claims_used: [],
      techniques_used: [],
      scope_violations: [],
      phrasing_violations: [],
      rewrite_applied: false,
    },

    progress_marker: { kind: 'none' },

    observability: {
      triggers_fired: [],
      triggers_suppressed: [],
      intent_classification: enrichedContext.intent_classification,
      specialist_contributions: [],
      specialist_disagreement: null,
    },

    turn_plan: {
      selected_tool: null,
      routing: 'deterministic',
      long_running: false,
    },
  };
}
