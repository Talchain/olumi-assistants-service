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
import type { EnrichedContext, ReferencedEntityDetail } from "../types.js";
import type { GraphV3Compact } from "../../context/graph-compact.js";
import type { AnalysisResponseSummary, OptionComparisonEntry } from "../../context/analysis-compact.js";
import type { DecisionContinuity } from "../../context/decision-continuity.js";
import type { SystemCacheBlock } from "../../../adapters/llm/types.js";
import type { EntityStateMap } from "../../context/entity-state-tracker.js";
import { log } from "../../../utils/telemetry.js";

/**
 * Result from assembleV2SystemPrompt — includes both the full combined string
 * and pre-split blocks for Anthropic prompt caching.
 */
export interface AssembledSystemPrompt {
  /** Full system prompt (Zone 1 + Zone 2) — used by non-caching paths. */
  text: string;
  /** Pre-split system blocks for prompt caching. Block 0 = static prefix (Zone 1) with cache_control. */
  cache_blocks: SystemCacheBlock[];
}

// ============================================================================
// Section cap — prevents any single Zone 2 block from bloating the prompt
// ============================================================================

const SECTION_CHAR_CAP = 2000;

/**
 * Zone 2 total char budget. This is a character-count proxy for tokens, not
 * an exact token count — assumes ~4 chars/token giving ~2000 tokens at 8000 chars.
 * When exceeded, low-priority blocks are trimmed in priority order:
 * entity_memory first, then event_log_summary.
 */
const ZONE2_CHAR_BUDGET = 8000;

function capSection(text: string): string {
  if (text.length <= SECTION_CHAR_CAP) return text;
  return text.slice(0, SECTION_CHAR_CAP) + '…truncated';
}

// ============================================================================
// Compact Serialisers (structured text — not raw JSON)
// ============================================================================

/**
 * Serialise a compact graph into a structured text block for the LLM.
 * Format: one node per line, then one edge per line.
 * Input arrays are pre-sorted deterministically by compactGraph() (nodes by id,
 * edges by from then to). No additional sort is applied here.
 */
function serialiseCompactGraph(g: GraphV3Compact): string {
  const lines: string[] = [`Graph (${g._node_count} nodes, ${g._edge_count} edges):`];

  for (const node of g.nodes) {
    const parts = [`  ${node.id} [${node.kind}] "${node.label}"`];
    if (node.type) parts.push(`type=${node.type}`);
    if (node.category) parts.push(`category=${node.category}`);
    if (node.value !== undefined) parts.push(`value=${node.value}`);
    if (node.source) parts.push(`source=${node.source}`);
    if (node.intervention_summary) parts.push(`interventions: ${node.intervention_summary}`);
    lines.push(parts.join(', '));
  }

  for (const edge of g.edges) {
    let edgeLine = `  ${edge.from} → ${edge.to} (strength=${edge.strength}, exists_p=${edge.exists})`;
    if (edge.plain_interpretation) edgeLine += ` — ${edge.plain_interpretation}`;
    lines.push(edgeLine);
  }

  return lines.join('\n');
}

/**
 * Serialise a compact analysis summary into structured text for the LLM.
 * Input arrays are pre-sorted deterministically by compactAnalysis() (options by
 * win_probability desc, drivers by sensitivity desc). No additional sort applied here.
 */
function serialiseCompactAnalysis(a: AnalysisResponseSummary): string {
  const lines: string[] = ['Analysis:'];

  lines.push(`  Winner: ${a.winner.option_label} (${a.winner.option_id}) at ${Math.round(a.winner.win_probability * 100)}% win probability`);
  lines.push(`  Robustness: ${a.robustness_level}`);
  if (a.margin !== null && Number.isFinite(a.margin)) {
    lines.push(`  Margin: ${Math.round(a.margin * 100)} percentage points`);
  }

  if (a.option_results && a.option_results.length > 0) {
    // Prefer dedicated comparison array (has p10/p90 guaranteed)
    const optLines = a.option_results
      .map((o: OptionComparisonEntry) =>
        `    ${o.label}: ${Math.round(o.win_probability * 100)}% win, mean=${o.mean.toFixed(2)}, range [${o.p10.toFixed(2)}, ${o.p90.toFixed(2)}]`)
      .join('\n');
    lines.push(`  Option comparison:\n${optLines}`);
  } else if (a.options.length > 0) {
    // Fallback: render from options (may lack range)
    const optLines = a.options
      .map((o) => {
        const winPct = `${Math.round(o.win_probability * 100)}% win`;
        const mean = `mean=${o.outcome_mean.toFixed(2)}`;
        const hasRange = o.outcome_p10 !== undefined && o.outcome_p90 !== undefined;
        const range = hasRange ? `, range [${o.outcome_p10!.toFixed(2)}, ${o.outcome_p90!.toFixed(2)}]` : '';
        return `    ${o.option_label}: ${winPct}, ${mean}${range}`;
      })
      .join('\n');
    lines.push(`  Option comparison:\n${optLines}`);
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

  if (a.top_fragile_edges && a.top_fragile_edges.length > 0) {
    const edgeLines = a.top_fragile_edges
      .map((e) => `    ${e.from_label} → ${e.to_label}`)
      .join('\n');
    lines.push(`  Fragile edge paths:\n${edgeLines}`);
  }

  if (a.constraint_tensions && a.constraint_tensions.length > 0) {
    lines.push(`  Constraint tensions: ${a.constraint_tensions.join(', ')}`);
  }

  if (a.flip_thresholds && a.flip_thresholds.length > 0) {
    const ftLines = a.flip_thresholds
      .map((ft) => {
        const unit = ft.unit ? ` ${ft.unit}` : '';
        return `    ${ft.factor_label}: current=${ft.current_value}${unit}, flip_at=${ft.flip_value}${unit}`;
      })
      .join('\n');
    lines.push(`  Flip thresholds:\n${ftLines}`);
  }

  return lines.join('\n');
}

/**
 * Serialise a DecisionContinuity object into the <decision_state> Zone 2 block.
 * This is the preferred compact summary layer — do not duplicate info already here
 * in other Zone 2 blocks.
 *
 * Options line contract:
 *   - Always emits "[count] options"
 *   - When hasCompactGraph is false, appends "([label1], [label2], …)" after the count
 *   - When hasCompactGraph is true, emits count only (labels already in graph block)
 *
 * @param dc - The decision continuity object
 * @param hasCompactGraph - When true, the compact graph block already contains full option labels;
 *   emit a count reference instead of repeating them to avoid Zone 2 duplication.
 */
function serialiseDecisionContinuity(dc: DecisionContinuity, hasCompactGraph: boolean): string {
  const lines: string[] = ['<decision_state>'];

  if (dc.goal) lines.push(`Goal: ${dc.goal}`);

  if (dc.options.length > 0) {
    if (hasCompactGraph) {
      // Compact graph already lists option labels — count only to avoid duplication
      lines.push(`Options: ${dc.options.length} options`);
    } else {
      lines.push(`Options: ${dc.options.length} options (${dc.options.join(', ')})`);
    }
  }

  if (dc.constraints.length > 0) {
    lines.push(`Constraints: ${dc.constraints.join(', ')}`);
  }

  lines.push(`Stage: ${dc.stage}`);
  lines.push(`Analysis: ${dc.analysis_status}`);

  if (dc.top_drivers.length > 0) {
    lines.push(`Top drivers: ${dc.top_drivers.join(', ')}`);
  }

  if (dc.top_uncertainties.length > 0) {
    lines.push(`Top uncertainties: ${dc.top_uncertainties.join(', ')}`);
  }

  if (dc.assumption_count > 0) {
    lines.push(`Assumptions: ${dc.assumption_count} inferred value${dc.assumption_count !== 1 ? 's' : ''}`);
  }

  if (dc.last_patch_summary) {
    lines.push(`Last change: ${dc.last_patch_summary}`);
  }

  if (dc.active_proposal) {
    lines.push(`Pending: ${dc.active_proposal}`);
  }

  lines.push('</decision_state>');
  return lines.join('\n');
}

const MAX_REFERENCED_ENTITIES = 2;
const MAX_ENTITY_MEMORY_FACTORS = 8;

/**
 * Serialise a referenced entity detail into a <referenced_entity> Zone 2 block.
 *
 * Format (null/undefined fields omitted):
 *   <referenced_entity>
 *   Label: {label}
 *   Kind: {kind} | Category: {category}          ← Category line omitted if absent
 *   Value: {value} | Unit: {unit} | Source: {source}  ← only present fields included
 *   Connected: {label1} (mean={s1}), {label2} (mean={s2})   ← omitted if no edges
 *   </referenced_entity>
 */
function serialiseReferencedEntity(entity: ReferencedEntityDetail): string {
  const lines: string[] = ['<referenced_entity>'];

  lines.push(`Label: ${entity.label}`);

  // Kind + optional Category on one line
  if (entity.category) {
    lines.push(`Kind: ${entity.kind} | Category: ${entity.category}`);
  } else {
    lines.push(`Kind: ${entity.kind}`);
  }

  // Value line — only emit if at least one value field is present
  const valueParts: string[] = [];
  if (entity.value !== undefined) valueParts.push(`Value: ${entity.value}`);
  if (entity.unit) valueParts.push(`Unit: ${entity.unit}`);
  if (entity.source) valueParts.push(`Source: ${entity.source}`);
  if (valueParts.length > 0) lines.push(valueParts.join(' | '));

  // Connected edges
  if (entity.edges.length > 0) {
    const edgeParts = entity.edges
      .map((e) => `${e.connected_label} (mean=${e.strength.toFixed(1)})`)
      .join(', ');
    lines.push(`Connected: ${edgeParts}`);
  }

  lines.push('</referenced_entity>');
  return lines.join('\n');
}

// ============================================================================
// Entity Memory Block
// ============================================================================

/**
 * Serialise entity memory into an <entity_memory> Zone 2 block.
 *
 * Includes only factors with non-default state (calibrated, challenged, untouched
 * where the factor is still relevant). Capped at MAX_ENTITY_MEMORY_FACTORS.
 *
 * Budget priority: lower than decision_state and referenced_entity.
 * Trimmed first when Zone 2 exceeds budget.
 */
function serialiseEntityMemory(stateMap: EntityStateMap, currentTurn: number): string | null {
  // Filter to non-default states, sort by recency (most recent first), cap at 8
  const entries = Object.entries(stateMap)
    .filter(([, entry]) => entry.state !== 'default' && entry.state !== 'untouched')
    .sort((a, b) => b[1].last_action_turn - a[1].last_action_turn)
    .slice(0, MAX_ENTITY_MEMORY_FACTORS);

  // Also include 'default' state factors (AI assumption, not yet discussed) up to the cap
  const defaultEntries = Object.entries(stateMap)
    .filter(([, entry]) => entry.state === 'default')
    .slice(0, MAX_ENTITY_MEMORY_FACTORS - entries.length);

  const allEntries = [...entries, ...defaultEntries];
  if (allEntries.length === 0) return null;

  const lines: string[] = ['<entity_memory>'];

  for (const [nodeId, entry] of allEntries) {
    const attrs: string[] = [
      `id="${nodeId}"`,
      `state="${entry.state}"`,
    ];

    if (entry.last_action_turn >= 0) {
      const turnsAgo = currentTurn - entry.last_action_turn;
      attrs.push(`turns_ago="${turnsAgo}"`);
    }

    if (entry.value !== undefined) {
      attrs.push(`value="${entry.value}"`);
    }

    // Human-readable description based on state
    let description: string;
    switch (entry.state) {
      case 'calibrated':
        description = `${entry.label} — set by user${entry.value !== undefined ? ` to ${entry.value}` : ''}`;
        break;
      case 'challenged':
        description = `${entry.label} — user questioned this value`;
        break;
      case 'default':
        description = `${entry.label} — AI assumption, not yet discussed`;
        break;
      default:
        description = entry.label;
    }

    lines.push(`  <factor ${attrs.join(' ')}>${description}</factor>`);
  }

  lines.push('</entity_memory>');
  return lines.join('\n');
}

// ============================================================================
// Pending Changes Block
// ============================================================================

/**
 * Build a <pending_changes> block when analysis is stale relative to the current graph.
 * Returns null when analysis is current, absent, or staleness cannot be determined.
 */
function buildPendingChangesBlock(enrichedContext: EnrichedContext): string | null {
  const dc = enrichedContext.decision_continuity;
  if (!dc || dc.analysis_status !== 'stale') return null;

  const lines: string[] = ['<pending_changes>'];

  if (dc.last_patch_summary) {
    lines.push(`Since last analysis: ${dc.last_patch_summary}. Consider re-running the analysis.`);
  } else {
    lines.push('The graph has been modified since the last analysis. Results may not reflect current model values. Consider re-running the analysis.');
  }

  lines.push('</pending_changes>');
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
): Promise<AssembledSystemPrompt> {
  // Zone 1: Static orchestrator prompt (from prompt store / cache / defaults)
  // F.2: Zone 1 will be replaced with science-powered prompt. Using existing cf-v4.0.5 for now.
  const zone1 = await getSystemPrompt('orchestrator');

  // Zone 2: Dynamic enriched context
  const zone2Sections: string[] = [];

  const hasContinuity = !!enrichedContext.decision_continuity;

  // Decision continuity block (preferred compact summary — avoids duplicating stage/goal/options/constraints)
  if (enrichedContext.decision_continuity) {
    zone2Sections.push(capSection(serialiseDecisionContinuity(enrichedContext.decision_continuity, !!enrichedContext.graph_compact)));
  }

  // Stage indicator — include substate/confidence even when continuity block covers stage
  const si = enrichedContext.stage_indicator;
  if (!hasContinuity) {
    zone2Sections.push(`Current stage: ${si.stage}${si.substate ? ` (${si.substate})` : ''}`);
  }
  zone2Sections.push(`Stage confidence: ${si.confidence} (${si.source})`);

  // Decision goal / framing — only when continuity block is absent (to avoid duplication)
  const framing = enrichedContext.framing;
  if (!hasContinuity) {
    if (framing?.goal) {
      zone2Sections.push(`Decision goal: ${framing.goal}`);
    }
    // Framing constraints (bounded at API boundary: max 20 items × 200 chars each)
    if (framing?.constraints && framing.constraints.length > 0) {
      zone2Sections.push(capSection(`Constraints: ${framing.constraints.join(', ')}`));
    }
    // Framing options (bounded at API boundary: max 20 items × 200 chars each)
    if (framing?.options && framing.options.length > 0) {
      zone2Sections.push(capSection(`Options: ${framing.options.join(', ')}`));
    }
  }

  // Graph state (compact) — provides full node/edge detail not in continuity block
  if (enrichedContext.graph_compact) {
    zone2Sections.push(capSection(serialiseCompactGraph(enrichedContext.graph_compact)));
  }

  // Analysis response (compact) — provides per-option probabilities and driver detail
  if (enrichedContext.analysis_response) {
    zone2Sections.push(capSection(serialiseCompactAnalysis(enrichedContext.analysis_response)));

    // Pending changes — surface staleness when graph has changed since last analysis
    const pendingChanges = buildPendingChangesBlock(enrichedContext);
    if (pendingChanges) {
      zone2Sections.push(pendingChanges);
    }
  }

  // Referenced entities — focused explanation-ready blocks for entities named in the user message
  // Capped at MAX_REFERENCED_ENTITIES (2) to keep prompt size bounded.
  if (enrichedContext.referenced_entities && enrichedContext.referenced_entities.length > 0) {
    const entitiesToRender = enrichedContext.referenced_entities.slice(0, MAX_REFERENCED_ENTITIES);
    for (const entity of entitiesToRender) {
      zone2Sections.push(capSection(serialiseReferencedEntity(entity)));
    }
  }

  // Entity memory — cross-turn factor interaction state (lower priority than decision_state and referenced_entity)
  // Tracked for budget trimming: entity_memory is the first block dropped when Zone 2 exceeds budget.
  let entityMemoryIdx = -1;
  if (enrichedContext.entity_state_map) {
    const currentTurn = enrichedContext.conversation_history?.length ?? 0;
    const entityMemoryBlock = serialiseEntityMemory(enrichedContext.entity_state_map, currentTurn);
    if (entityMemoryBlock) {
      entityMemoryIdx = zone2Sections.length;
      zone2Sections.push(capSection(entityMemoryBlock));
    }
  }

  // Event log summary (when populated — requires Supabase wiring in phase 1)
  let eventLogIdx = -1;
  if (enrichedContext.event_log_summary) {
    eventLogIdx = zone2Sections.length;
    zone2Sections.push(capSection(`Decision history: ${enrichedContext.event_log_summary}`));
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

  // Budget enforcement: trim low-priority blocks if Zone 2 exceeds char budget.
  // Priority order (first dropped): entity_memory → event_log_summary.
  const blockNames: Record<number, string> = {};
  if (entityMemoryIdx >= 0) blockNames[entityMemoryIdx] = 'entity_memory';
  if (eventLogIdx >= 0) blockNames[eventLogIdx] = 'event_log_summary';

  const trimOrder = [entityMemoryIdx, eventLogIdx].filter((i) => i >= 0);
  for (const idx of trimOrder) {
    const totalChars = zone2Sections.reduce((sum, s) => sum + s.length, 0);
    if (totalChars <= ZONE2_CHAR_BUDGET) break;
    log.info(
      {
        event: 'zone2.budget_trim',
        block_dropped: blockNames[idx],
        zone2_chars_before: totalChars,
        budget: ZONE2_CHAR_BUDGET,
      },
      'zone2.budget_trim: dropping low-priority block',
    );
    zone2Sections[idx] = ''; // drop this section
  }

  const zone2 = zone2Sections.filter((s) => s.length > 0).join('\n');
  const text = `${zone1}\n\n${zone2}`;

  // Track budget-trimmed sections as the V2 pipeline equivalent of "activated but empty" Zone 2 blocks.
  // In the V2 assembler, sections are only pushed when data exists, so the only way a section
  // becomes empty is through budget trimming (zone2Sections[idx] = '').
  const emptyBlocks: string[] = [];
  if (entityMemoryIdx >= 0 && zone2Sections[entityMemoryIdx] === '') emptyBlocks.push('entity_memory');
  if (eventLogIdx >= 0 && zone2Sections[eventLogIdx] === '') emptyBlocks.push('event_log');

  // Persist empty blocks to enrichedContext for feature-health cross-referencing in Phase 5
  if (emptyBlocks.length > 0) {
    enrichedContext.zone2_empty_blocks = emptyBlocks;
  }

  // Per-turn Zone 2 assembly diagnostic log (V2 pipeline path)
  const totalChars = text.length;
  const activeSectionCount = zone2Sections.filter((s) => s.length > 0).length;
  log.info(
    {
      event: 'zone2_assembly_complete',
      pipeline: 'v2',
      total_chars: totalChars,
      zone2_chars: zone2.length,
      section_count: activeSectionCount,
      has_continuity: hasContinuity,
      has_graph: !!enrichedContext.graph_compact,
      has_analysis: !!enrichedContext.analysis_response,
      has_entities: (enrichedContext.referenced_entities?.length ?? 0) > 0,
      has_entity_memory: !!enrichedContext.entity_state_map,
      has_event_log: !!enrichedContext.event_log_summary,
      empty_blocks: emptyBlocks.length > 0 ? emptyBlocks : undefined,
    },
    `Zone 2 assembled (V2): ${activeSectionCount} sections, ${totalChars} chars${emptyBlocks.length > 0 ? `, empty: ${emptyBlocks.join(',')}` : ''}`,
  );

  // Pre-split blocks for Anthropic prompt caching:
  // Block 0 = static Zone 1 (cache_control: ephemeral) — identical across turns
  // Block 1 = dynamic Zone 2 — varies per turn, no cache marker
  const cache_blocks: SystemCacheBlock[] = [
    { type: 'text', text: zone1, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `\n\n${zone2}` },
  ];

  return { text, cache_blocks };
}
