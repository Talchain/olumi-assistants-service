/**
 * TurnContext Computation — Layer 0
 *
 * Computes a canonical DeterministicTurnContext per turn from graph, analysis,
 * and conversation data. Pure function, no async, no side effects.
 *
 * Replaces Zone 2 assembly for the deterministic pipeline.
 */

import type { OrchestratorTurnRequest, V2RunResponseEnvelope, DecisionStage } from "../types.js";
import type { GraphV3T, NodeV3T } from "../../schemas/cee-v3.js";
import type {
  DeterministicTurnContext,
  EntityRegistry,
  EntityEntry,
  EdgeEntry,
  GraphSummary,
  AnalysisSummary,
  DriverSummary,
  TurnCapabilities,
  Blocker,
  TurnSignals,
  ConversationSummary,
} from "./types.js";
import type { ActionName } from "./actions/types.js";
import { ACTION_NAMES } from "./actions/types.js";
import { inferStage } from "../pipeline/phase1-enrichment/stage-inference.js";
import { STAGE_TOOL_POLICY } from "../tools/stage-policy.js";
import { DEFAULT_EXISTS_PROBABILITY } from "../context/constants.js";

// ============================================================================
// Constants
// ============================================================================

/** Winner margin threshold for close_call signal (5 percentage points). */
const CLOSE_CALL_THRESHOLD = 0.05;

/** Sensitivity ratio threshold for dominant_factor signal. */
const DOMINANT_FACTOR_RATIO = 2.0;

/** Edge strength threshold for weak_edges signal. */
const WEAK_EDGE_THRESHOLD = 0.3;

// ============================================================================
// Stage → ActionName mapping (extends tool-based stage policy)
// ============================================================================

const STAGE_ACTION_POLICY: Record<DecisionStage, ReadonlySet<ActionName>> = {
  frame: new Set<ActionName>(['set_factor_value', 'add_factor', 'set_goal_target', 'add_constraint']),
  ideate: new Set<ActionName>(['set_factor_value', 'add_constraint', 'add_factor', 'adjust_edge_strength', 'add_option', 'remove_factor', 'set_goal_target']),
  evaluate: new Set<ActionName>(['run_analysis', 'explain_result', 'compare_options', 'challenge_assumption', 'run_premortem', 'what_would_flip', 'generate_artefact', 'set_factor_value', 'adjust_edge_strength', 'add_constraint']),
  decide: new Set<ActionName>(['explain_result', 'compare_options', 'what_would_flip', 'generate_artefact', 'challenge_assumption', 'run_premortem']),
  optimise: new Set<ActionName>(['set_factor_value', 'adjust_edge_strength', 'add_constraint', 'run_analysis', 'explain_result', 'compare_options', 'challenge_assumption', 'run_premortem', 'what_would_flip', 'generate_artefact']),
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute the canonical TurnContext from a turn request.
 * Pure function — deterministic, synchronous, no side effects.
 */
export function computeTurnContext(turnRequest: OrchestratorTurnRequest): DeterministicTurnContext {
  const ctx = turnRequest.context;
  const graph = ctx.graph ?? turnRequest.graph_state ?? null;
  const analysis = ctx.analysis_response ?? turnRequest.analysis_state ?? null;
  const analysisInputs = ctx.analysis_inputs ?? null;

  // Stage inference
  const stageResult = inferStage(ctx, turnRequest.system_event);
  const stage: DecisionStage = stageResult?.stage ?? 'frame';

  // Build entity registry
  const entities = buildEntityRegistry(graph);

  // Summaries
  const graphSummary = computeGraphSummary(graph, entities);
  const analysisSummary = computeAnalysisSummary(analysis);

  // Capabilities
  const capabilities = computeCapabilities(graph, analysis);

  // Blockers
  const blockers = computeBlockers(graph, analysis, capabilities);

  // Signals
  const signals = computeSignals(graph, analysis, entities);

  // Conversation summary
  const conversation = computeConversationSummary(turnRequest);

  // Eligible actions
  const eligibleActions = computeEligibleActions(stage, capabilities, blockers, conversation.recent_actions_taken);

  return {
    stage,
    entities,
    graph_summary: graphSummary,
    analysis_summary: analysisSummary,
    capabilities,
    blockers,
    signals,
    conversation,
    eligible_actions: eligibleActions,
    graph,
    analysis,
    conversational_state: ctx.conversational_state ?? null,
    scenario_id: ctx.scenario_id,
    analysis_inputs: analysisInputs,
  };
}

// ============================================================================
// Entity Registry Builder
// ============================================================================

export function buildEntityRegistry(graph: GraphV3T | null): EntityRegistry {
  const nodes = new Map<string, EntityEntry>();
  const edges: EdgeEntry[] = [];
  const optionIds: string[] = [];
  let goalId: string | null = null;

  if (!graph) {
    return { nodes, edges, option_ids: optionIds, goal_id: null };
  }

  // Build node entries
  for (const node of graph.nodes ?? []) {
    const entry: EntityEntry = {
      id: node.id,
      label: node.label ?? node.id,
      kind: node.kind,
      aliases: buildAliases(node),
      category: (node as Record<string, unknown>).category as string | undefined,
      is_action_target: node.kind !== 'decision',
    };

    // Factor-specific fields
    const observed = (node as Record<string, unknown>).observed_state as Record<string, unknown> | undefined;
    if (observed) {
      if (typeof observed.value === 'number') entry.value = observed.value;
      if (typeof observed.unit === 'string') entry.unit = observed.unit;
      if (typeof observed.cap === 'number') entry.cap = observed.cap;
    }

    nodes.set(node.id, entry);

    if (node.kind === 'option') optionIds.push(node.id);
    if (node.kind === 'goal') goalId = node.id;
  }

  // Build edge entries
  for (const edge of graph.edges ?? []) {
    const fromEntry = nodes.get(edge.from);
    const toEntry = nodes.get(edge.to);
    edges.push({
      from: edge.from,
      to: edge.to,
      from_label: fromEntry?.label ?? edge.from,
      to_label: toEntry?.label ?? edge.to,
      strength_mean: edge.strength?.mean ?? 0,
      strength_std: edge.strength?.std ?? 0,
      exists_probability: edge.exists_probability ?? DEFAULT_EXISTS_PROBABILITY,
      effect_direction: edge.effect_direction as 'positive' | 'negative' | undefined,
    });
  }

  return { nodes, edges, option_ids: optionIds, goal_id: goalId };
}

// ============================================================================
// Graph Summary
// ============================================================================

function computeGraphSummary(graph: GraphV3T | null, entities: EntityRegistry): GraphSummary {
  if (!graph) {
    return {
      node_count: 0,
      edge_count: 0,
      option_count: 0,
      option_labels: [],
      goal_label: null,
      missing_structural: ['no goal node'],
    };
  }

  const optionLabels = entities.option_ids
    .map((id) => entities.nodes.get(id)?.label ?? id);

  // Check for structural issues
  const issues: string[] = [];
  const goalId = entities.goal_id;

  if (!goalId) {
    issues.push('no goal node');
  }

  // Check constraints on goal
  if (goalId) {
    const goalNode = graph.nodes?.find((n) => n.id === goalId);
    const constraints = (goalNode as Record<string, unknown> | undefined)?.goal_constraints;
    if (!constraints || (Array.isArray(constraints) && constraints.length === 0)) {
      issues.push('no constraints');
    }
  }

  // Check for external factors
  const hasExternal = [...entities.nodes.values()].some(
    (n) => n.kind === 'factor' && n.category === 'external',
  );
  if (!hasExternal) {
    issues.push('no external factors');
  }

  // Check each option has a path to goal
  if (goalId && entities.option_ids.length > 0) {
    for (const optId of entities.option_ids) {
      const hasEdgeToGoal = entities.edges.some(
        (e) => (e.from === optId && e.to === goalId) || (e.to === optId && e.from === goalId),
      );
      if (!hasEdgeToGoal) {
        const label = entities.nodes.get(optId)?.label ?? optId;
        issues.push(`option ${label} has no path to goal`);
      }
    }
  }

  return {
    node_count: graph.nodes?.length ?? 0,
    edge_count: graph.edges?.length ?? 0,
    option_count: entities.option_ids.length,
    option_labels: optionLabels,
    goal_label: goalId ? (entities.nodes.get(goalId)?.label ?? null) : null,
    missing_structural: issues,
  };
}

// ============================================================================
// Analysis Summary
// ============================================================================

function computeAnalysisSummary(analysis: V2RunResponseEnvelope | null): AnalysisSummary | null {
  if (!analysis || !analysis.results || !Array.isArray(analysis.results) || analysis.results.length === 0) {
    return null;
  }

  // Extract option results sorted by win probability
  const results = (analysis.results as Array<Record<string, unknown>>)
    .filter((r) => typeof r.win_probability === 'number')
    .sort((a, b) => (b.win_probability as number) - (a.win_probability as number));

  const winner = results[0] ?? null;
  const runnerUp = results[1] ?? null;

  // Extract top drivers from factor_sensitivity
  const topDrivers: DriverSummary[] = [];
  if (Array.isArray(analysis.factor_sensitivity)) {
    for (const fs of analysis.factor_sensitivity as Array<Record<string, unknown>>) {
      if (typeof fs.label === 'string' && typeof fs.elasticity === 'number') {
        topDrivers.push({
          label: fs.label as string,
          factor_id: (fs.factor_id as string) ?? (fs.label as string),
          sensitivity: Math.abs(fs.elasticity as number),
          direction: (fs.direction as string) ?? 'unknown',
        });
      }
    }
    topDrivers.sort((a, b) => b.sensitivity - a.sensitivity);
  }

  // Fragile edges
  const fragileEdgeCount = Array.isArray(analysis.robustness?.fragile_edges)
    ? analysis.robustness!.fragile_edges!.length
    : 0;

  // Constraints
  let constraintsMet: boolean | null = null;
  const constraintTensions: string[] = [];
  if (analysis.constraint_analysis) {
    const ca = analysis.constraint_analysis;
    if (Array.isArray(ca.per_constraint)) {
      const violated = (ca.per_constraint as Array<Record<string, unknown>>)
        .filter((c) => typeof c.probability === 'number' && (c.probability as number) < 0.5);
      constraintsMet = violated.length === 0;
      for (const v of violated) {
        constraintTensions.push(
          `${v.label ?? v.constraint_id ?? 'constraint'}: ${((v.probability as number) * 100).toFixed(0)}% met`,
        );
      }
    }
    // Joint probability tension check
    if (typeof ca.joint_probability === 'number' && Array.isArray(ca.per_constraint)) {
      const individualProbs = (ca.per_constraint as Array<Record<string, unknown>>)
        .filter((c) => typeof c.probability === 'number')
        .map((c) => c.probability as number);
      if (individualProbs.length > 0) {
        const minIndividual = Math.min(...individualProbs);
        if (ca.joint_probability < minIndividual * 0.7) {
          constraintTensions.push('Constraints are in tension (joint probability significantly below individual)');
        }
      }
    }
  }

  return {
    winner: winner ? (winner.option_label as string) ?? null : null,
    winner_probability: winner ? (winner.win_probability as number) ?? null : null,
    runner_up: runnerUp ? (runnerUp.option_label as string) ?? null : null,
    runner_up_probability: runnerUp ? (runnerUp.win_probability as number) ?? null : null,
    robustness_band: analysis.robustness?.level ?? null,
    top_drivers: topDrivers.slice(0, 5),
    fragile_edge_count: fragileEdgeCount,
    constraints_met: constraintsMet,
    constraint_tensions: constraintTensions,
  };
}

// ============================================================================
// Capabilities
// ============================================================================

function computeCapabilities(
  graph: GraphV3T | null,
  analysis: V2RunResponseEnvelope | null,
): TurnCapabilities {
  const hasGraph = graph != null && Array.isArray(graph.nodes) && graph.nodes.length > 0;
  const hasAnalysis = analysis != null && Array.isArray(analysis.results) && analysis.results.length > 0;
  const hasOptions = hasGraph && (graph!.nodes?.some((n: NodeV3T) => n.kind === 'option') ?? false);

  return {
    can_run_analysis: hasGraph && hasOptions,
    can_explain_results: hasAnalysis,
    can_edit_graph: hasGraph,
    can_compare_options: hasAnalysis && hasOptions,
    can_challenge: hasAnalysis,
    can_generate_artefact: hasGraph && hasAnalysis,
  };
}

// ============================================================================
// Blockers
// ============================================================================

function computeBlockers(
  graph: GraphV3T | null,
  analysis: V2RunResponseEnvelope | null,
  capabilities: TurnCapabilities,
): Blocker[] {
  const blockers: Blocker[] = [];

  if (!capabilities.can_run_analysis) {
    if (!graph) {
      blockers.push({
        action_type: 'run_analysis',
        reason: 'No decision model available. Draft a model first.',
        suggested_action_type: undefined,
      });
    } else {
      blockers.push({
        action_type: 'run_analysis',
        reason: 'Model needs at least one option before analysis can run.',
        suggested_action_type: 'add_option',
      });
    }
  }

  if (!capabilities.can_explain_results) {
    blockers.push({
      action_type: 'explain_result',
      reason: 'No analysis results available. Run analysis first.',
      suggested_action_type: 'run_analysis',
    });
  }

  if (!capabilities.can_compare_options) {
    if (!analysis) {
      blockers.push({
        action_type: 'compare_options',
        reason: 'No analysis results available. Run analysis first.',
        suggested_action_type: 'run_analysis',
      });
    }
  }

  // Check for goal node
  if (graph && !graph.nodes?.some((n: NodeV3T) => n.kind === 'goal')) {
    blockers.push({
      action_type: 'set_goal_target',
      reason: 'No goal node in the model.',
    });
  }

  return blockers;
}

// ============================================================================
// Signals
// ============================================================================

function computeSignals(
  graph: GraphV3T | null,
  analysis: V2RunResponseEnvelope | null,
  entities: EntityRegistry,
): TurnSignals {
  const highUncertaintyFactors: string[] = [];
  let defaultValueCount = 0;
  const weakEdges: string[] = [];

  if (graph) {
    // Scan nodes for uncertainty and defaults
    for (const node of graph.nodes ?? []) {
      if (node.kind !== 'factor') continue;
      const observed = (node as Record<string, unknown>).observed_state as Record<string, unknown> | undefined;
      if (!observed) continue;

      const extractionType = observed.extractionType as string | undefined;
      const uncertaintyDrivers = observed.uncertainty_drivers as string[] | undefined;

      if (extractionType === 'inferred' || (Array.isArray(uncertaintyDrivers) && uncertaintyDrivers.length >= 2)) {
        highUncertaintyFactors.push(node.id);
      }
      if (extractionType === 'inferred') {
        defaultValueCount++;
      }
    }

    // Scan edges for weak strength
    for (const edge of entities.edges) {
      if (Math.abs(edge.strength_mean) < WEAK_EDGE_THRESHOLD) {
        weakEdges.push(`${edge.from}→${edge.to}`);
      }
    }
  }

  // Dominant factor and close call from analysis
  let dominantFactor: string | null = null;
  let closeCall = false;

  if (analysis) {
    // Close call
    const results = (analysis.results as Array<Record<string, unknown>> | undefined) ?? [];
    const sorted = [...results]
      .filter((r) => typeof r.win_probability === 'number')
      .sort((a, b) => (b.win_probability as number) - (a.win_probability as number));
    if (sorted.length >= 2) {
      const margin = (sorted[0].win_probability as number) - (sorted[1].win_probability as number);
      closeCall = margin < CLOSE_CALL_THRESHOLD;
    }

    // Dominant factor
    if (Array.isArray(analysis.factor_sensitivity)) {
      const sensitivities = (analysis.factor_sensitivity as Array<Record<string, unknown>>)
        .filter((fs) => typeof fs.elasticity === 'number')
        .map((fs) => ({
          factor_id: (fs.factor_id as string) ?? (fs.label as string) ?? '',
          sensitivity: Math.abs(fs.elasticity as number),
        }))
        .sort((a, b) => b.sensitivity - a.sensitivity);

      if (sensitivities.length >= 2 && sensitivities[0].sensitivity > sensitivities[1].sensitivity * DOMINANT_FACTOR_RATIO) {
        dominantFactor = sensitivities[0].factor_id;
      }
    }
  }

  return {
    high_uncertainty_factors: highUncertaintyFactors,
    dominant_factor: dominantFactor,
    close_call: closeCall,
    default_value_count: defaultValueCount,
    weak_edges: weakEdges,
  };
}

// ============================================================================
// Conversation Summary
// ============================================================================

function computeConversationSummary(turnRequest: OrchestratorTurnRequest): ConversationSummary {
  const messages = turnRequest.context.messages ?? [];
  const convState = turnRequest.context.conversational_state;

  // Recent actions from messages (last 5 assistant turns)
  const recentActions: string[] = [];
  const recentDeclined: string[] = [];
  const assistantMessages = messages.filter((m) => m.role === 'assistant').slice(-5);
  for (const msg of assistantMessages) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        recentActions.push(tc.name);
      }
    }
  }

  // Last user intent
  const lastUserMessage = messages.filter((m) => m.role === 'user').pop();

  // Pending confirmation
  let pendingConfirmation: string | null = null;
  if (convState?.pending_proposal) {
    pendingConfirmation = convState.pending_proposal.tool;
  } else if (convState?.pending_clarification) {
    pendingConfirmation = convState.pending_clarification.tool;
  }

  return {
    turn_count: messages.length,
    last_user_intent: lastUserMessage?.content?.slice(0, 200) ?? null,
    recent_actions_taken: recentActions,
    recent_actions_declined: recentDeclined,
    pending_confirmation: pendingConfirmation,
  };
}

// ============================================================================
// Eligible Actions
// ============================================================================

function computeEligibleActions(
  stage: DecisionStage,
  capabilities: TurnCapabilities,
  blockers: Blocker[],
  recentActions: string[],
): ActionName[] {
  const stageActions = STAGE_ACTION_POLICY[stage] ?? new Set<ActionName>();
  const blockedActions = new Set(blockers.map((b) => b.action_type));

  const eligible: ActionName[] = [];

  for (const action of ACTION_NAMES) {
    // Must be in stage policy
    if (!stageActions.has(action)) continue;

    // Must not be blocked
    if (blockedActions.has(action)) continue;

    // Capability checks
    if (action === 'run_analysis' && !capabilities.can_run_analysis) continue;
    if (action === 'explain_result' && !capabilities.can_explain_results) continue;
    if (action === 'compare_options' && !capabilities.can_compare_options) continue;
    if ((action === 'challenge_assumption' || action === 'run_premortem' || action === 'what_would_flip') && !capabilities.can_challenge) continue;
    if (action === 'generate_artefact' && !capabilities.can_generate_artefact) continue;
    if ((action === 'set_factor_value' || action === 'add_factor' || action === 'adjust_edge_strength' || action === 'add_option' || action === 'remove_factor' || action === 'set_goal_target' || action === 'add_constraint') && !capabilities.can_edit_graph) continue;

    eligible.push(action);
  }

  return eligible;
}

// ============================================================================
// Helpers
// ============================================================================

function buildAliases(node: NodeV3T): string[] {
  const aliases: string[] = [];
  const label = node.label ?? '';

  // Common abbreviations
  if (label.toLowerCase().includes('revenue')) aliases.push('rev');
  if (label.toLowerCase().includes('customer')) aliases.push('cust');
  if (label.toLowerCase().includes('acquisition')) aliases.push('acq');
  if (label.toLowerCase().includes('probability')) aliases.push('prob');

  // Split multi-word labels into individual words (3+ chars)
  const words = label.split(/[\s_-]+/).filter((w) => w.length >= 3);
  if (words.length > 1) {
    for (const word of words) {
      aliases.push(word.toLowerCase());
    }
  }

  return aliases;
}
