/**
 * Prompt Assembler (V2)
 *
 * Composes the system prompt for the LLM call with enriched context.
 *
 * Zone 1: Static orchestrator prompt from prompt store.
 *         // F.2: Zone 1 will be replaced with science-powered prompt. Using existing cf-v4.0.5 for now.
 * Zone 2: Dynamic enriched context (stage, intent, archetype, graph, analysis, framing, DSK placeholder).
 * Zone 3: Tool definitions (reuse existing).
 */

import { getSystemPrompt } from "../../../adapters/llm/prompt-loader.js";
import type { EnrichedContext } from "../types.js";
import type { GraphV3Compact } from "../../context/graph-compact.js";
import type { AnalysisResponseSummary } from "../../context/analysis-compact.js";

// ============================================================================
// Compact Serialisers (structured text — not raw JSON)
// ============================================================================

/**
 * Serialise a compact graph into a structured text block for the LLM.
 * Format: one node per line, then one edge per line.
 */
function serialiseCompactGraph(g: GraphV3Compact): string {
  const lines: string[] = [`Graph (${g._node_count} nodes, ${g._edge_count} edges):`];

  for (const node of g.nodes) {
    const parts = [`  ${node.id} [${node.kind}] "${node.label}"`];
    if (node.type) parts.push(`type=${node.type}`);
    if (node.category) parts.push(`category=${node.category}`);
    if (node.value !== undefined) parts.push(`value=${node.value}`);
    lines.push(parts.join(', '));
  }

  for (const edge of g.edges) {
    lines.push(`  ${edge.from} → ${edge.to} (strength=${edge.strength}, exists_p=${edge.exists})`);
  }

  return lines.join('\n');
}

/**
 * Serialise a compact analysis summary into structured text for the LLM.
 */
function serialiseCompactAnalysis(a: AnalysisResponseSummary): string {
  const lines: string[] = ['Analysis:'];

  lines.push(`  Winner: ${a.winner.option_label} (${a.winner.option_id}) at ${Math.round(a.winner.win_probability * 100)}% win probability`);
  lines.push(`  Robustness: ${a.robustness_level}`);

  if (a.options.length > 1) {
    const optLines = a.options
      .map((o) => `    ${o.option_label} (${o.option_id}): ${Math.round(o.win_probability * 100)}%`)
      .join('\n');
    lines.push(`  All options:\n${optLines}`);
  }

  if (a.top_drivers.length > 0) {
    const driverLines = a.top_drivers
      .map((d) => `    ${d.factor_label} (${d.factor_id}): sensitivity=${d.sensitivity.toFixed(3)}, direction=${d.direction}`)
      .join('\n');
    lines.push(`  Top drivers:\n${driverLines}`);
  }

  if (a.fragile_edge_count > 0) {
    lines.push(`  Fragile edges: ${a.fragile_edge_count}`);
  }

  if (a.constraint_tensions && a.constraint_tensions.length > 0) {
    lines.push(`  Constraint tensions: ${a.constraint_tensions.join(', ')}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Prompt Assembler
// ============================================================================

/**
 * Assemble the system prompt with enriched context.
 *
 * Builds on the existing Zone 1 + Zone 2 pattern from prompt-assembly.ts
 * but injects the richer V2 enriched context fields.
 */
export async function assembleV2SystemPrompt(
  enrichedContext: EnrichedContext,
): Promise<string> {
  // Zone 1: Static orchestrator prompt (from prompt store / cache / defaults)
  // F.2: Zone 1 will be replaced with science-powered prompt. Using existing cf-v4.0.5 for now.
  const zone1 = await getSystemPrompt('orchestrator');

  // Zone 2: Dynamic enriched context
  const zone2Sections: string[] = [];

  // Stage indicator
  const si = enrichedContext.stage_indicator;
  zone2Sections.push(`Current stage: ${si.stage}${si.substate ? ` (${si.substate})` : ''}`);
  zone2Sections.push(`Stage confidence: ${si.confidence} (${si.source})`);

  // Decision goal
  const framing = enrichedContext.framing as Record<string, unknown> | null | undefined;
  const goal = framing?.goal;
  if (goal && typeof goal === 'string') {
    zone2Sections.push(`Decision goal: ${goal}`);
  }

  // Framing constraints
  const constraints = framing?.constraints;
  if (Array.isArray(constraints) && constraints.length > 0) {
    const constraintList = (constraints as unknown[]).map((c) => {
      const co = c as Record<string, unknown>;
      return co.label ?? co.name ?? co.id ?? String(c);
    });
    zone2Sections.push(`Constraints: ${constraintList.join(', ')}`);
  }

  // Framing options
  const options = framing?.options;
  if (Array.isArray(options) && options.length > 0) {
    const optionList = (options as unknown[]).map((o) => {
      const oo = o as Record<string, unknown>;
      return oo.label ?? oo.name ?? oo.id ?? String(o);
    });
    zone2Sections.push(`Options: ${optionList.join(', ')}`);
  }

  // Graph state (compact)
  if (enrichedContext.graph_compact) {
    zone2Sections.push(serialiseCompactGraph(enrichedContext.graph_compact));
  }

  // Analysis response (compact)
  if (enrichedContext.analysis_response) {
    zone2Sections.push(serialiseCompactAnalysis(enrichedContext.analysis_response));
  }

  // Event log summary (when populated — requires Supabase wiring in phase 1)
  if (enrichedContext.event_log_summary) {
    zone2Sections.push(`Decision history: ${enrichedContext.event_log_summary}`);
  }

  // Intent classification
  zone2Sections.push(`User intent: ${enrichedContext.intent_classification}`);

  // Decision archetype (if detected)
  const archetype = enrichedContext.decision_archetype;
  if (archetype.type) {
    zone2Sections.push(`Decision archetype: ${archetype.type} (${archetype.confidence} confidence, evidence: ${archetype.evidence})`);
  }

  // Stuck state
  if (enrichedContext.stuck.detected) {
    zone2Sections.push('User appears stuck — consider offering rescue routes.');
  }

  // DSK context placeholder
  zone2Sections.push('<!-- DSK claims will appear here when A.9 is active -->');

  // Specialist advice placeholder
  zone2Sections.push('<!-- Specialist advice will appear here when Phase 2 is active -->');

  const zone2 = zone2Sections.join('\n');

  return `${zone1}\n\n${zone2}`;
}
