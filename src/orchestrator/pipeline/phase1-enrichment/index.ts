/**
 * Phase 1: Enrichment
 *
 * Deterministic context enrichment — no LLM calls. Target: <50ms.
 *
 * Calls all sub-modules and assembles EnrichedContext:
 * - Stage inference
 * - Intent classification
 * - Archetype detection
 * - Progress tracking
 * - Stuck detection
 * - DSK loading (stub)
 * - User profile loading (stub)
 */

import { randomUUID } from "node:crypto";
import type { ConversationContext, SystemEvent } from "../types.js";
import type { EnrichedContext } from "../types.js";
import { inferStage } from "./stage-inference.js";
import { classifyUserIntent } from "./intent-classifier.js";
import { detectArchetype } from "./archetype-detector.js";
import { trackProgress } from "./progress-tracker.js";
import { detectStuck } from "./stuck-detector.js";
import { loadDSK } from "./dsk-loader.js";
import { loadUserProfile } from "./user-profile-loader.js";
import { compactGraph } from "../../context/graph-compact.js";
import { compactAnalysis } from "../../context/analysis-compact.js";
import { buildEventLogSummary } from "../../context/event-log-summary.js";
import { enforceContextBudget } from "../../context/budget.js";
import type { BudgetEnforcementContext } from "../../context/budget.js";
import { computeContextHash, toHashableContext } from "../../context/context-hash.js";
import type { GraphV3T } from "../../types.js";
import { log } from "../../../utils/telemetry.js";

/** Maximum conversation turns to keep in the enriched context */
const MAX_CONVERSATION_TURNS = 5;

/**
 * Phase 1 entry point: enrich the request context.
 *
 * Deterministic. No LLM calls. No I/O (except context management utilities).
 *
 * Context management steps (added in A.4):
 * 1. compactGraph → graph_compact
 * 2. compactAnalysis → analysis_response (compact summary)
 * 3. Trim messages to last 5 turns
 * 4. buildEventLogSummary → event_log_summary
 *    (TODO: events will be populated when UI sends events or CEE reads from Supabase)
 * 5. enforceContextBudget → trim within token allocation
 * 6. computeContextHash → context_hash
 */
export function phase1Enrich(
  message: string,
  context: ConversationContext,
  scenarioId: string,
  systemEvent?: SystemEvent,
): EnrichedContext {
  const turnId = randomUUID();

  // Stage inference
  const stageIndicator = inferStage(context, systemEvent);

  // Intent classification (from user message)
  const intentClassification = classifyUserIntent(message);

  // Archetype detection (from message + framing)
  const decisionArchetype = detectArchetype(message, context.framing);

  // Progress tracking (last 5 turns)
  const progressMarkers = trackProgress(context.messages);

  // Stuck detection
  const stuck = detectStuck(context.messages, progressMarkers);

  // DSK (stub)
  const dsk = loadDSK();

  // User profile (stub)
  const userProfile = loadUserProfile();

  // ─── Context Management (A.4) ───────────────────────────────────────────

  // 1. Compact graph
  const graphCompact = context.graph
    ? compactGraph(context.graph as GraphV3T)
    : undefined;

  // 2. Compact analysis (build node label map from compact graph for driver labels)
  const nodeLabels = graphCompact
    ? new Map(graphCompact.nodes.map((n) => [n.id, n.label]))
    : undefined;
  const analysisResponseCompact = context.analysis_response
    ? compactAnalysis(context.analysis_response, nodeLabels)
    : undefined;

  // 3. Trim messages to last 5 turns
  const trimmedMessages = context.messages.slice(-MAX_CONVERSATION_TURNS);

  // 4. Event log summary
  // events are not yet in ConversationContext — pass empty array until CEE reads from Supabase.
  // buildEventLogSummary returns "" for empty input, so event_log_summary stays undefined when empty.
  const eventLogSummaryRaw = buildEventLogSummary([]);
  const eventLogSummary: string | undefined = eventLogSummaryRaw || undefined;

  // 5. Normalise selected_elements → selected_node_ids / selected_edge_ids
  // selected_elements is a flat string[] of opaque IDs. Without separate node/edge ID
  // namespaces we treat all IDs as node IDs (matching normaliseSelectedElements convention).
  const rawSelected = context.selected_elements ?? [];
  const selectedNodeIds = [...rawSelected].sort();
  const selectedEdgeIds: string[] = [];

  // Assemble pre-budget context for enforcement
  const preBudgetContext: EnrichedContext = {
    // Scenario state
    graph: context.graph,
    analysis: context.analysis_response,
    framing: context.framing,
    conversation_history: context.messages,
    selected_elements: rawSelected,

    // Context management fields
    graph_compact: graphCompact,
    analysis_response: analysisResponseCompact ?? undefined,
    messages: trimmedMessages,
    event_log_summary: eventLogSummary,
    selected_node_ids: selectedNodeIds,
    selected_edge_ids: selectedEdgeIds,
    analysis_inputs: context.analysis_inputs,

    // Inferred state
    stage_indicator: stageIndicator,
    intent_classification: intentClassification,
    decision_archetype: decisionArchetype,
    progress_markers: progressMarkers,
    stuck,

    // DSK (stub)
    dsk,

    // User profile (stub)
    user_profile: userProfile,

    // System
    scenario_id: scenarioId,
    turn_id: turnId,
    system_event: systemEvent,
    user_message: message,
  };

  // 5. Enforce context budget (operates on graph_compact, analysis_response, messages)
  const budgetedContext = enforceContextBudget(
    preBudgetContext as unknown as BudgetEnforcementContext & EnrichedContext,
  ) as EnrichedContext;

  // 6. Compute context hash (after budget enforcement so hash reflects actual sent context)
  const budgetedMessages = budgetedContext.messages ?? trimmedMessages;
  const contextHash = computeContextHash(toHashableContext({
    ...budgetedContext,
    messages: budgetedMessages,
  }));

  log.debug(
    { turn_id: turnId, scenario_id: scenarioId, context_hash: contextHash },
    'phase1Enrich: context management complete',
  );

  return {
    ...budgetedContext,
    context_hash: contextHash,
  } as EnrichedContext;
}
