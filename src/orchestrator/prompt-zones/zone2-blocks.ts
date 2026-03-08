/**
 * Zone 2 Block Registry
 *
 * Defines the block registry for dynamic Zone 2 context assembly.
 * Each block is a pure, synchronous, side-effect-free renderer that produces
 * a self-trimmed string for inclusion in the orchestrator system prompt.
 *
 * Blocks are versioned with ownership for tracking and ablation.
 * Data blocks render inside XML wrapper tags; hint blocks merge into
 * a single <CONTEXT_HINTS> wrapper.
 *
 * Zone 2 blocks must never contain: tool selection/routing, output format
 * rules, response priority rules, safety/security policy, permanent coaching
 * heuristics, role definitions, or BANNED_INTERNAL_TERMS.
 */

import type { GraphV3Compact } from "../context/graph-compact.js";
import type { AnalysisInputsSummary } from "../../schemas/analysis-inputs-summary.js";
import type { ConversationMessage } from "../types.js";

// ============================================================================
// TurnContext — per-turn structured state for block activation and rendering
// ============================================================================

/**
 * Structured state for a single orchestrator turn.
 *
 * Fields are either raw structured state or pre-rendered strings:
 *
 * **Raw structured state** (block renderers may transform):
 * - `stage`, `goal`, `constraints`, `options` — from ConversationContext.framing
 * - `graphCompact` — from compactGraph(graph)
 * - `analysisSummary` — from AnalysisInputsSummary contract
 * - `messages` — from ConversationContext.messages
 * - `selectedElements` — from ConversationContext.selected_elements
 * - `hasGraph`, `hasAnalysis`, `generateModel` — boolean flags
 * - `bilEnabled` — whether BIL feature is active
 *
 * **Pre-rendered strings** (block renderers pass through, do not re-render):
 * - `bilContext` — pre-formatted by formatBilForCoaching(); pass through only
 * - `eventLogSummary` — pre-formatted by buildEventLogSummary(); pass through only
 */
export interface TurnContext {
  stage: string;
  goal: string | undefined;
  constraints: string[] | undefined;
  options: string[] | undefined;
  graphCompact: GraphV3Compact | null;
  analysisSummary: AnalysisInputsSummary | null;
  /** Pre-rendered by buildEventLogSummary(). Pass through only. */
  eventLogSummary: string;
  messages: ConversationMessage[];
  selectedElements: string[];
  /** Pre-rendered by formatBilForCoaching(). Pass through only. */
  bilContext: string | undefined;
  bilEnabled: boolean;
  hasGraph: boolean;
  hasAnalysis: boolean;
  generateModel: boolean;
}

// ============================================================================
// Zone2Block interface
// ============================================================================

export interface Zone2Block {
  name: string;
  version: string;
  owner: 'orchestrator' | 'bil' | 'analysis' | 'events';
  scope: 'data' | 'hint';
  order: number;
  maxChars: number;
  xmlTag: string;
  activation: (ctx: TurnContext) => boolean;
  /**
   * Pure, synchronous, side-effect-free, deterministic renderer.
   * Must not: async, mutate state, log, or access external services.
   * Must self-trim output to maxChars.
   */
  render: (ctx: TurnContext) => string;
}

// ============================================================================
// Trust boundary helpers
// ============================================================================

const UNTRUSTED_OPEN = 'BEGIN_UNTRUSTED_CONTEXT';
const UNTRUSTED_CLOSE = 'END_UNTRUSTED_CONTEXT';

export function wrapUntrusted(content: string): string {
  return `${UNTRUSTED_OPEN}\n${content}\n${UNTRUSTED_CLOSE}`;
}

// ============================================================================
// Self-trimming helpers
// ============================================================================

/**
 * Trim text to maxChars at a word boundary. Appends "..." on truncation.
 * Never breaks mid-word. Returns original if within limit.
 */
function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars - 3);
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > 0) {
    return trimmed.slice(0, lastSpace) + '...';
  }
  return trimmed + '...';
}

/**
 * Trim JSON string by dropping optional fields until within limit.
 * Falls back to text truncation if still too long.
 */
function trimJson(obj: Record<string, unknown>, maxChars: number, dropOrder: string[]): string {
  let json = JSON.stringify(obj, null, 2);
  if (json.length <= maxChars) return json;

  const trimmed = { ...obj };
  for (const field of dropOrder) {
    if (field in trimmed) {
      delete trimmed[field];
      json = JSON.stringify(trimmed, null, 2);
      if (json.length <= maxChars) return json;
    }
  }
  return trimText(json, maxChars);
}

/**
 * Normalise whitespace: collapse multiple spaces/newlines, trim lines.
 */
function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

// ============================================================================
// Block renderers — pure, synchronous, side-effect-free, deterministic
// ============================================================================

function renderStageContext(ctx: TurnContext): string {
  const lines: string[] = [];
  lines.push(`Stage: ${ctx.stage}`);
  if (ctx.goal) {
    lines.push(`Goal: ${ctx.goal}`);
  }
  if (ctx.constraints && ctx.constraints.length > 0) {
    lines.push(`Constraints: ${ctx.constraints.join('; ')}`);
  }
  if (ctx.options && ctx.options.length > 0) {
    lines.push(`Options: ${ctx.options.join('; ')}`);
  }
  return trimText(lines.join('\n'), 500);
}

function renderGraphState(ctx: TurnContext): string {
  if (!ctx.graphCompact) return '';

  const g = ctx.graphCompact;
  const lines: string[] = [];

  // Node counts by kind
  const kindCounts: Record<string, number> = {};
  for (const node of g.nodes) {
    kindCounts[node.kind] = (kindCounts[node.kind] ?? 0) + 1;
  }
  const kindSummary = Object.entries(kindCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(', ');

  lines.push(`Nodes: ${g._node_count} (${kindSummary})`);
  lines.push(`Edges: ${g._edge_count}`);

  // Top 3 highest-strength edges
  const topEdges = [...g.edges]
    .sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength))
    .slice(0, 3);

  if (topEdges.length > 0) {
    lines.push('Strongest edges:');
    for (const e of topEdges) {
      lines.push(`  ${e.from} → ${e.to} (strength: ${e.strength.toFixed(2)})`);
    }
  }

  const result = lines.join('\n');
  // Self-trim: drop lower-strength edges if over budget
  if (result.length > 1500) {
    const shortEdges = topEdges.slice(0, 1);
    const shortLines = [
      lines[0], lines[1],
      'Strongest edge:',
      `  ${shortEdges[0].from} → ${shortEdges[0].to} (strength: ${shortEdges[0].strength.toFixed(2)})`,
    ];
    return trimText(shortLines.join('\n'), 1500);
  }
  return result;
}

function renderAnalysisState(ctx: TurnContext): string {
  // ACCEPTANCE RULE: renders from AnalysisInputsSummary contract ONLY.
  // Never from analysisCompact, raw V2RunResponse, or any uncontracted payload.
  if (!ctx.analysisSummary) return '';

  const a = ctx.analysisSummary;
  const lines: string[] = [];

  lines.push(`Winner: ${a.recommendation.option_label} (${(a.recommendation.win_probability * 100).toFixed(1)}%)`);

  if (a.top_drivers.length > 0) {
    lines.push('Top drivers:');
    for (const d of a.top_drivers) {
      lines.push(`  ${d.factor_label}: elasticity ${d.elasticity.toFixed(2)}`);
    }
  }

  lines.push(`Robustness: ${a.robustness.level}`);

  if (a.confidence_band) {
    lines.push(`Confidence: ${a.confidence_band}`);
  }

  if (a.constraints_status.length > 0) {
    const satisfied = a.constraints_status.filter((c) => c.satisfied).length;
    lines.push(`Constraints: ${satisfied}/${a.constraints_status.length} satisfied`);
  }

  // Already capped at 2048 bytes by schema
  return trimText(lines.join('\n'), 2048);
}

function renderBilContext(ctx: TurnContext): string {
  // Pre-rendered by formatBilForCoaching(). Pass through only.
  if (!ctx.bilContext) return '';
  return trimText(ctx.bilContext, 800);
}

function renderConversationSummary(ctx: TurnContext): string {
  if (ctx.messages.length === 0) return '';

  const clauses: string[] = [];

  // Decision domain from goal
  if (ctx.goal) {
    clauses.push(`User described a decision: "${trimText(ctx.goal, 80)}"`);
  }

  // Graph state
  if (ctx.graphCompact) {
    const g = ctx.graphCompact;
    clauses.push(`Model drafted with ${g._node_count} factors, ${g._edge_count} edges`);
  }

  // Analysis state — only include if data is present, never produce "undefined at undefined%"
  if (ctx.analysisSummary) {
    const a = ctx.analysisSummary;
    clauses.push(
      `Analysis run: ${a.recommendation.option_label} at ${(a.recommendation.win_probability * 100).toFixed(1)}%, ` +
      `robustness ${a.robustness.level}`,
    );
  }

  // Turn count
  clauses.push(`${ctx.messages.length} conversation turns`);

  return trimText(clauses.join('. ') + '.', 1000);
}

function renderRecentTurns(ctx: TurnContext): string {
  if (ctx.messages.length === 0) return '';

  // Last 3 turns
  const recent = ctx.messages.slice(-3);
  const turnLines: string[] = [];

  for (const msg of recent) {
    const role = msg.role === 'user' ? 'user' : 'assistant';
    let content = msg.content;

    // Normalise whitespace
    content = normaliseWhitespace(content);

    // Strip existing untrusted markers before re-wrapping
    content = content
      .replace(/BEGIN_UNTRUSTED_CONTEXT\n?/g, '')
      .replace(/\n?END_UNTRUSTED_CONTEXT/g, '');

    // Truncate at 500 chars per turn, never mid-marker
    if (content.length > 500) {
      content = content.slice(0, 497) + '...';
    }

    // User turns wrapped in untrusted delimiters
    if (role === 'user') {
      turnLines.push(wrapUntrusted(`${role}: ${content}`));
    } else {
      turnLines.push(`${role}: ${content}`);
    }
  }

  return trimText(turnLines.join('\n'), 2000);
}

function renderEventLog(ctx: TurnContext): string {
  // Pre-rendered by buildEventLogSummary(). Pass through only.
  if (!ctx.eventLogSummary || ctx.eventLogSummary.length === 0) return '';
  return trimText(ctx.eventLogSummary, 500);
}

function renderBilHint(_ctx: TurnContext): string {
  return 'A deterministic brief analysis is appended below — use its findings to ground your coaching. Do not repeat the analysis verbatim; reference specific elements.';
}

function renderAnalysisHint(_ctx: TurnContext): string {
  return 'Post-analysis data is available in context. Reference specific results, drivers, and robustness when coaching — all numbers must come from this data.';
}

// ============================================================================
// Block definitions
// ============================================================================

const STAGE_CONTEXT: Zone2Block = {
  name: 'stage_context',
  version: '1.0.0',
  owner: 'orchestrator',
  scope: 'data',
  order: 10,
  maxChars: 500,
  xmlTag: 'STAGE',
  activation: () => true,
  render: renderStageContext,
};

const GRAPH_STATE: Zone2Block = {
  name: 'graph_state',
  version: '1.0.0',
  owner: 'orchestrator',
  scope: 'data',
  order: 20,
  maxChars: 1500,
  xmlTag: 'GRAPH_STATE',
  activation: (ctx) => ctx.hasGraph,
  render: renderGraphState,
};

const ANALYSIS_STATE: Zone2Block = {
  name: 'analysis_state',
  version: '1.0.0',
  owner: 'analysis',
  scope: 'data',
  order: 30,
  maxChars: 2048,
  xmlTag: 'ANALYSIS_STATE',
  activation: (ctx) => ctx.hasAnalysis,
  render: renderAnalysisState,
};

const BIL_CONTEXT: Zone2Block = {
  name: 'bil_context',
  version: '1.0.0',
  owner: 'bil',
  scope: 'data',
  order: 40,
  maxChars: 800,
  xmlTag: 'BRIEF_ANALYSIS',
  activation: (ctx) =>
    ctx.bilEnabled && (ctx.stage === 'frame' || ctx.stage === 'ideate'),
  render: renderBilContext,
};

const CONVERSATION_SUMMARY: Zone2Block = {
  name: 'conversation_summary',
  version: '1.0.0',
  owner: 'orchestrator',
  scope: 'data',
  order: 50,
  maxChars: 1000,
  xmlTag: 'CONVERSATION_SUMMARY',
  activation: (ctx) => ctx.messages.length > 0,
  render: renderConversationSummary,
};

const RECENT_TURNS: Zone2Block = {
  name: 'recent_turns',
  version: '1.0.0',
  owner: 'orchestrator',
  scope: 'data',
  order: 60,
  maxChars: 2000,
  xmlTag: 'RECENT_TURNS',
  activation: (ctx) => ctx.messages.length > 0,
  render: renderRecentTurns,
};

const EVENT_LOG: Zone2Block = {
  name: 'event_log',
  version: '1.0.0',
  owner: 'events',
  scope: 'data',
  order: 70,
  maxChars: 500,
  xmlTag: 'EVENT_LOG',
  activation: (ctx) => ctx.eventLogSummary.length > 0,
  render: renderEventLog,
};

const BIL_HINT: Zone2Block = {
  name: 'bil_hint',
  version: '1.0.0',
  owner: 'bil',
  scope: 'hint',
  order: 80,
  maxChars: 200,
  xmlTag: '',
  activation: (ctx) =>
    ctx.bilEnabled && (ctx.stage === 'frame' || ctx.stage === 'ideate') && !!ctx.bilContext,
  render: renderBilHint,
};

const ANALYSIS_HINT: Zone2Block = {
  name: 'analysis_hint',
  version: '1.0.0',
  owner: 'analysis',
  scope: 'hint',
  order: 81,
  maxChars: 200,
  xmlTag: '',
  activation: (ctx) => ctx.hasAnalysis && !!ctx.analysisSummary,
  render: renderAnalysisHint,
};

// ============================================================================
// Registry
// ============================================================================

export const ZONE2_BLOCKS: readonly Zone2Block[] = Object.freeze([
  STAGE_CONTEXT,
  GRAPH_STATE,
  ANALYSIS_STATE,
  BIL_CONTEXT,
  CONVERSATION_SUMMARY,
  RECENT_TURNS,
  EVENT_LOG,
  BIL_HINT,
  ANALYSIS_HINT,
]);

/**
 * Return blocks whose activation predicate passes for the given context.
 * Sorted by order ascending.
 */
export function getActiveBlocks(ctx: TurnContext): Zone2Block[] {
  return ZONE2_BLOCKS.filter((block) => block.activation(ctx));
}

// Export helpers for testing
export { trimText as _trimText, trimJson as _trimJson, normaliseWhitespace as _normaliseWhitespace };
