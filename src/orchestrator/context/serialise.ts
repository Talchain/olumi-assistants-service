/**
 * Context Serialisation
 *
 * Compact serialisation of graph and analysis response for LLM context.
 * Full graph is sent to PLoT; compact form is for LLM context window only.
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import type { V2RunResponseEnvelope, ConversationContext } from "../types.js";
import type { GraphV3Compact, CompactNode, CompactEdge, EditCompactGraph, EditCompactNode, EditCompactEdge, AnalysisResponseSummary, OptionSummary, DriverSummary } from "./types.js";
import {
  emitContextTruncation,
  type ContextTruncationRecord,
} from "../../orchestrator-v5/context/context-budget-telemetry.js";

// ============================================================================
// Robustness Band Mapping
// ============================================================================

const ISL_ROBUSTNESS_MAP: Record<string, string> = {
  low: 'fragile', medium: 'moderate', high: 'stable', very_high: 'highly_stable',
  fragile: 'fragile', moderate: 'moderate', stable: 'stable', highly_stable: 'highly_stable',
};

function mapRobustnessBandV2(raw: string | null): string | null {
  if (raw == null) return null;
  return ISL_ROBUSTNESS_MAP[raw.toLowerCase().trim()] ?? 'moderate';
}

// ============================================================================
// Compact Graph
// ============================================================================

/**
 * Compact a V3 graph for LLM context.
 * Preserves: node IDs, labels, kinds. Edges as from→to with strength.
 */
export function compactGraph(graph: GraphV3T): GraphV3Compact {
  const nodes: CompactNode[] = graph.nodes.map((node) => ({
    id: node.id,
    label: node.label ?? node.id,
    kind: node.kind,
  }));

  const edges: CompactEdge[] = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    strength_mean: edge.strength?.mean ?? 0,
    exists_probability: edge.exists_probability ?? 1,
  }));

  return { nodes, edges };
}

// ============================================================================
// Edit Compact Graph (for edit_graph prompt — includes category + edge fields)
// ============================================================================

/**
 * Compact a graph for the edit_graph LLM prompt.
 *
 * More fields than compactGraph() because the LLM needs category, effect_direction,
 * and strength_std to produce valid PatchOperations. Still strips data payloads,
 * positions, and other heavy fields.
 */
export function editCompactGraph(graph: GraphV3T): EditCompactGraph {
  const nodes: EditCompactNode[] = graph.nodes.map((node) => {
    const category = (node as Record<string, unknown>).category as string | undefined;
    const result: EditCompactNode = {
      id: node.id,
      label: node.label ?? node.id,
      kind: node.kind,
    };
    if (category) result.category = category;
    return result;
  });

  const edges: EditCompactEdge[] = graph.edges.map((edge) => {
    const edgeLabel = (edge as Record<string, unknown>).label as string | undefined;
    const result: EditCompactEdge = {
      from: edge.from,
      to: edge.to,
      strength_mean: edge.strength?.mean ?? 0,
      strength_std: edge.strength?.std ?? 0.125,
      exists_probability: edge.exists_probability ?? 1,
      effect_direction: edge.effect_direction ?? 'positive',
    };
    if (edgeLabel) result.label = edgeLabel;
    return result;
  });

  return { nodes, edges };
}

// ============================================================================
// Safe Graph JSON Truncation
// ============================================================================

/**
 * Result of a graph-JSON truncation with enough metadata for in-band
 * disclosure (now unconditional) and cut-site telemetry (S0).
 */
export interface TruncateGraphJsonResult {
  readonly json: string;
  readonly truncated: boolean;
  /** Node/edge counts actually present in `json` (post-truncation). */
  readonly keptNodes: number;
  readonly keptEdges: number;
  readonly originalChars: number;
}

/**
 * Produce a JSON string of the graph, safely truncated to `maxBytes`,
 * with truncation metadata.
 *
 * Unlike `JSON.stringify().substring(n)`, this iteratively removes edges then
 * nodes to keep the result valid JSON. Returns the full string if it fits.
 */
export function truncateGraphJsonWithMeta(graph: EditCompactGraph, maxBytes: number): TruncateGraphJsonResult {
  const full = JSON.stringify(graph);
  if (full.length <= maxBytes) {
    return {
      json: full,
      truncated: false,
      keptNodes: graph.nodes.length,
      keptEdges: graph.edges.length,
      originalChars: full.length,
    };
  }

  let truncated = { ...graph, nodes: [...graph.nodes], edges: [...graph.edges] };
  const done = (json: string): TruncateGraphJsonResult => ({
    json,
    truncated: true,
    keptNodes: truncated.nodes.length,
    keptEdges: truncated.edges.length,
    originalChars: full.length,
  });

  // Iteratively reduce: remove edges first, then nodes
  for (let i = 0; i < 10; i++) {
    const json = JSON.stringify(truncated);
    if (json.length <= maxBytes) return done(json);

    if (truncated.edges.length > 1) {
      const newLen = Math.ceil(truncated.edges.length * 0.8);
      truncated = { ...truncated, edges: truncated.edges.slice(0, newLen) };
    } else if (truncated.nodes.length > 1) {
      const newLen = Math.ceil(truncated.nodes.length * 0.8);
      const keptIds = new Set(truncated.nodes.slice(0, newLen).map(n => n.id));
      truncated = {
        ...truncated,
        nodes: truncated.nodes.slice(0, newLen),
        edges: truncated.edges.filter(e => keptIds.has(e.from) && keptIds.has(e.to)),
      };
    } else {
      break;
    }
  }

  return done(JSON.stringify(truncated));
}

/**
 * Back-compat string form of {@link truncateGraphJsonWithMeta}. Kept so
 * existing callers/tests are untouched; byte-identical output.
 */
export function truncateGraphJson(graph: EditCompactGraph, maxBytes: number): string {
  return truncateGraphJsonWithMeta(graph, maxBytes).json;
}

// ============================================================================
// Recent Conversation Rendering (for edit_graph LLM prompt)
// ============================================================================

/**
 * Render `context.messages` (the prior-turns conversation slice — see
 * `dispatchEditGraph`, which populates it from the same 5-turn/2,000-char-
 * per-message slice `context-pack-assembler.ts`'s `projectConversation`
 * already builds for the coaching/draft LLM path) into a bounded prompt
 * section.
 *
 * `context.messages` carries prior turns ONLY — the current turn's message
 * is sent separately as the edit LLM's `userMessage` (see `edit-graph.ts`),
 * so it is not duplicated here.
 *
 * Bounded to `maxChars`: each message is already capped at persist time
 * (`CONVERSATION_TEXT_CAP` in `commit.ts`), but five turns of user+assistant
 * text can still exceed a sane prompt budget. If the joined text overflows,
 * the OLDEST messages are dropped first (most recent context matters most
 * for resolving "that", "it", "the one we discussed") and the drop is
 * disclosed with a leading marker so the LLM knows the history is partial
 * rather than silently truncated mid-sentence.
 */
export function renderRecentConversationForEdit(
  messages: readonly { role: 'user' | 'assistant'; content: string }[],
  maxChars: number = 4000,
): string {
  return renderRecentConversationForEditWithMeta(messages, maxChars).text;
}

/** Metadata form of {@link renderRecentConversationForEdit} (S0 telemetry). */
export function renderRecentConversationForEditWithMeta(
  messages: readonly { role: 'user' | 'assistant'; content: string }[],
  maxChars: number = 4000,
): { text: string; dropped: number; originalChars: number } {
  if (messages.length === 0) return { text: '', dropped: 0, originalChars: 0 };

  const lines = messages.map((m) => `${m.role}: ${m.content}`);
  const originalChars = lines.join('\n').length;

  let dropped = 0;
  while (lines.join('\n').length > maxChars && lines.length > 1) {
    lines.shift();
    dropped += 1;
  }

  const body = lines.join('\n');
  const text = dropped > 0
    ? `(${dropped} earlier turn${dropped === 1 ? '' : 's'} omitted for length)\n${body}`
    : body;
  return { text, dropped, originalChars };
}

// ============================================================================
// Edit-lane brief projection (Context v2 S2, 02 §Seam 1)
// ============================================================================

/**
 * Char cap for the edit/repair brief slice. 02 §Seam 1 sizes table: edit
 * needs decision framing to resolve "the hire option" style referents, not
 * the full narrative — 1,000 chars ≈ +250 tok, negligible against the
 * measured 20.4s edit call. First-N of the same normalised text the
 * routing pack slices (routing keeps its own 2,000-char cap).
 */
export const EDIT_CONTEXT_BRIEF_CHAR_CAP = 1000;

/**
 * Project `scenarios.brief_text` to the edit-lane slice — the exact
 * ContextPackBriefSchema disclosure shape ({text, truncated,
 * original_chars}), at the edit cap. Returns null for nullish/blank input
 * (never an empty section). Emits `v5.context_truncation` at the cut —
 * DISCLOSED, because the rendered section carries the disclosure line.
 */
export function projectBriefForEdit(
  briefText: string | null | undefined,
): { text: string; truncated: boolean; original_chars: number } | null {
  if (briefText == null) return null;
  const trimmed = briefText.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= EDIT_CONTEXT_BRIEF_CHAR_CAP) {
    return { text: trimmed, truncated: false, original_chars: trimmed.length };
  }
  emitContextTruncation({
    site: 'serialise.projectBriefForEdit',
    section: 'brief',
    original_chars: trimmed.length,
    kept_chars: EDIT_CONTEXT_BRIEF_CHAR_CAP,
    strategy: 'hard_slice',
    disclosed: true,
  });
  return {
    text: trimmed.slice(0, EDIT_CONTEXT_BRIEF_CHAR_CAP),
    truncated: true,
    original_chars: trimmed.length,
  };
}

// ============================================================================
// Edit Context Serialisation (for edit_graph LLM prompt)
// ============================================================================

/**
 * Build the full context string for the edit_graph LLM prompt.
 *
 * Includes: edit compact graph, framing metadata, recent conversation,
 * analysis summary, selected elements.
 *
 * ROADMAP 1.33: prior to this fix, `context.messages` was populated but
 * never rendered here — a stale V4-era assumption ("the orchestrator
 * distils intent into editDescription") that does not hold in V5. The edit
 * LLM saw only the verbatim current message, dropping facts the user
 * established over earlier turns in the same request. `context.messages`
 * (prior turns, oldest-first) is now rendered as `## Recent Conversation`.
 */
export function serialiseEditContextForLLM(
  context: ConversationContext,
  maxGraphBytes: number = 8000,
  maxConversationChars: number = 4000,
): string {
  return serialiseEditContextForLLMWithMeta(context, maxGraphBytes, maxConversationChars).text;
}

/**
 * Per-section metadata alongside the rendered context (Context v2 S0):
 * section char counts feed `v5.context_budget` at the edit/repair adapter
 * boundary; truncation records mirror the `v5.context_truncation` events
 * emitted at the cut sites inside this function.
 */
export interface SerialisedEditContext {
  readonly text: string;
  /** Rendered chars per section (headers included), 0 when absent. */
  readonly sectionChars: Readonly<Record<string, number>>;
  readonly truncations: readonly ContextTruncationRecord[];
}

/** Metadata form of {@link serialiseEditContextForLLM}. */
export function serialiseEditContextForLLMWithMeta(
  context: ConversationContext,
  maxGraphBytes: number = 8000,
  maxConversationChars: number = 4000,
): SerialisedEditContext {
  const briefSlice = context.brief ?? null;
  const sections: string[] = [];
  const sectionChars: Record<string, number> = {};
  const truncations: ContextTruncationRecord[] = [];
  const scenarioId = context.scenario_id ?? null;

  // Tracks the rendered length of the current logical section: sections[]
  // entries joined with '\n\n' — attribute the joiner to the section that
  // follows it, matching total = sum(sectionChars) exactly.
  const measure = (name: string, render: () => void): void => {
    const before = sections.join('\n\n').length;
    render();
    const after = sections.join('\n\n').length;
    if (after > before) sectionChars[name] = after - before;
  };

  // Decision brief (Context v2 S2, 02 §Seam 1): placed FIRST — it is the
  // decision frame the rest of the context hangs off. Presence is gated
  // upstream (dispatchEditGraph populates `context.brief` only under
  // CEE_CONTEXT_BRIEF_ALL_SITES), so a flag-off render is byte-identical.
  // Truncation is disclosed in-section, mirroring the routing pack's
  // {truncated, original_chars} discipline.
  if (briefSlice && briefSlice.text.length > 0) {
    measure('brief', () => {
      sections.push('## Decision Brief');
      if (briefSlice.truncated) {
        sections.push(
          `(brief truncated: showing ${briefSlice.text.length} of ${briefSlice.original_chars} chars)`,
        );
        truncations.push({
          section: 'brief',
          original_chars: briefSlice.original_chars,
          kept_chars: briefSlice.text.length,
          disclosed: true,
        });
      }
      sections.push(briefSlice.text);
    });
  }

  // Graph section (always present — handler validates graph exists before calling)
  if (context.graph) {
    measure('graph_json', () => {
      const compact = editCompactGraph(context.graph as GraphV3T);
      const graphCut = truncateGraphJsonWithMeta(compact, maxGraphBytes);
      if (graphCut.truncated) {
        // S0 made the cut observable; disclosure (now unconditional) makes
        // it VISIBLE to the LLM — honest header counts + in-section marker.
        // `disclosed` tracks the in-prompt reality, not an aspiration.
        emitContextTruncation({
          site: 'serialise.truncateGraphJson',
          section: 'graph_json',
          original_chars: graphCut.originalChars,
          kept_chars: graphCut.json.length,
          strategy: 'drop_edges_then_nodes',
          disclosed: true,
          scenario_id: scenarioId,
        });
        truncations.push({
          section: 'graph_json',
          original_chars: graphCut.originalChars,
          kept_chars: graphCut.json.length,
          disclosed: true,
        });
        // 02 §Disclosure fix 1: header reports what is ACTUALLY in the JSON
        // below it (pre-disclosure it printed pre-truncation counts — the LLM
        // was actively misinformed), and the marker names the cut explicitly.
        sections.push(`## Current Graph (${graphCut.keptNodes} nodes, ${graphCut.keptEdges} edges)`);
        sections.push(
          `(graph truncated: showing ${graphCut.keptNodes} of ${compact.nodes.length} nodes, ` +
            `${graphCut.keptEdges} of ${compact.edges.length} edges)`,
        );
      } else {
        sections.push(`## Current Graph (${compact.nodes.length} nodes, ${compact.edges.length} edges)`);
      }
      sections.push('```json');
      sections.push(graphCut.json);
      sections.push('```');
    });
  }

  // Recent conversation (prior turns only — current message is sent
  // separately as the LLM's userMessage). Placed early, alongside the
  // graph, so facts the user already established are not pushed out by
  // later sections when the prompt is trimmed upstream.
  if (context.messages && context.messages.length > 0) {
    measure('conversation', () => {
      const rendered = renderRecentConversationForEditWithMeta(context.messages, maxConversationChars);
      if (rendered.dropped > 0) {
        // Always disclosed in-prompt ("(N earlier turns omitted for length)").
        emitContextTruncation({
          site: 'serialise.renderRecentConversationForEdit',
          section: 'conversation',
          original_chars: rendered.originalChars,
          kept_chars: rendered.text.length,
          strategy: 'drop_oldest_turns',
          disclosed: true,
          scenario_id: scenarioId,
        });
        truncations.push({
          section: 'conversation',
          original_chars: rendered.originalChars,
          kept_chars: rendered.text.length,
          disclosed: true,
        });
      }
      if (rendered.text.length > 0) {
        sections.push('## Recent Conversation');
        sections.push(rendered.text);
      }
    });
  }

  // Framing metadata
  if (context.framing) {
    measure('framing', () => {
      sections.push(`## Decision Stage: ${context.framing!.stage}`);
      if (context.framing!.goal) {
        sections.push(`Goal: ${context.framing!.goal}`);
      }
      if (context.framing!.constraints && (context.framing!.constraints as unknown[]).length > 0) {
        sections.push(`Constraints: ${JSON.stringify(context.framing!.constraints)}`);
      }
    });
  }

  // Analysis summary (if available)
  if (context.analysis_response) {
    measure('analysis_summary', () => {
      const summary = summariseAnalysisResponse(context.analysis_response!);
      sections.push('## Analysis Summary');
      sections.push(JSON.stringify(summary));
    });
  }

  // Selected elements (FOCUS section)
  if (context.selected_elements && context.selected_elements.length > 0) {
    measure('focus', () => {
      sections.push('## FOCUS');
      sections.push('The user has selected these elements. Prioritise changes to these:');
      sections.push(context.selected_elements!.map(el => `- ${el}`).join('\n'));
    });
  }

  return { text: sections.join('\n\n'), sectionChars, truncations };
}

// ============================================================================
// Analysis Response Summary
// ============================================================================

/**
 * Summarise a V2RunResponseEnvelope for LLM context.
 * Extracts: winner, top 3 option probabilities, top 5 drivers, robustness, constraints.
 */
export function summariseAnalysisResponse(response: V2RunResponseEnvelope): AnalysisResponseSummary {
  // Resolve nested results object (UI may send V2 fields inside results as an object)
  const nested = (response.results && typeof response.results === 'object' && !Array.isArray(response.results))
    ? response.results as Record<string, unknown>
    : null;

  // Option probabilities (top 3)
  const rawResults = Array.isArray(response.results)
    ? response.results as Array<Record<string, unknown>>
    : Array.isArray((response as Record<string, unknown>).option_comparison)
      ? (response as Record<string, unknown>).option_comparison as Array<Record<string, unknown>>
      : Array.isArray(nested?.option_comparison)
        ? nested!.option_comparison as Array<Record<string, unknown>>
        : [];
  const optionProbabilities: OptionSummary[] = rawResults
    .filter((r) => typeof r.option_label === 'string' && typeof r.win_probability === 'number')
    .map((r) => ({
      label: r.option_label as string,
      win_probability: r.win_probability as number,
    }))
    .sort((a, b) => b.win_probability - a.win_probability)
    .slice(0, 3);

  const winner = optionProbabilities.length > 0 ? optionProbabilities[0].label : null;

  // Top 5 sensitivity drivers
  const factors = (response.factor_sensitivity ?? nested?.factor_sensitivity ?? []) as Array<Record<string, unknown>>;
  const topDrivers: DriverSummary[] = factors
    .filter((f) => typeof f.label === 'string' || typeof f.factor_label === 'string')
    .slice(0, 5)
    .map((f) => ({
      label: (f.label ?? f.factor_label) as string,
      elasticity: (f.elasticity as number) ?? 0,
      direction: (f.direction as string) ?? 'unknown',
    }));

  // Robustness — map ISL vocabulary to canonical set
  const rawRobustnessLevel = response.robustness?.level
    ?? (nested?.robustness as Record<string, unknown> | undefined)?.level as string | undefined
    ?? null;
  const robustnessLevel = mapRobustnessBandV2(rawRobustnessLevel as string | null);

  // Constraint joint probability
  const ca = response.constraint_analysis ?? nested?.constraint_analysis as Record<string, unknown> | undefined;
  const constraintJointProbability = (ca as Record<string, unknown> | null | undefined)?.joint_probability as number | null ?? null;

  return {
    winner,
    option_probabilities: optionProbabilities,
    top_drivers: topDrivers,
    robustness_level: robustnessLevel,
    constraint_joint_probability: constraintJointProbability,
  };
}

// ============================================================================
// Full Context Serialisation
// ============================================================================

/**
 * Serialise conversation context for LLM prompt.
 * Uses compact graph and analysis summary to fit within token budget.
 */
export function serialiseContextForLLM(context: ConversationContext): string {
  const sections: string[] = [];

  // Graph section
  if (context.graph) {
    const compact = compactGraph(context.graph as GraphV3T);
    sections.push(`## Graph (${compact.nodes.length} nodes, ${compact.edges.length} edges)`);
    sections.push(JSON.stringify(compact));
  }

  // Analysis summary section
  if (context.analysis_response) {
    const summary = summariseAnalysisResponse(context.analysis_response);
    sections.push('## Analysis Summary');
    sections.push(JSON.stringify(summary));
  }

  // Framing section
  if (context.framing) {
    sections.push(`## Decision Stage: ${context.framing.stage}`);
    if (context.framing.goal) {
      sections.push(`Goal: ${context.framing.goal}`);
    }
  }

  // Event log summary
  if (context.event_log_summary) {
    sections.push('## Progress');
    sections.push(context.event_log_summary);
  }

  return sections.join('\n\n');
}
