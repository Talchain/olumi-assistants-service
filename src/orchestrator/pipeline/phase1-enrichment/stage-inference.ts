/**
 * Stage Inference
 *
 * Determines the current decision lifecycle stage from request data.
 * Pure function — no LLM calls, no I/O.
 */

import type { ConversationContext, SystemEvent } from "../types.js";
import type { StageIndicator } from "../types.js";

/**
 * Infer the current decision stage from context and optional system event.
 *
 * Priority:
 * 1. Explicit system event (patch_accepted, direct_analysis_run, etc.)
 * 2. Data-driven inference from graph + analysis state
 */
export function inferStage(
  context: ConversationContext,
  systemEvent?: SystemEvent,
): StageIndicator {
  // 1. Explicit system event → use it directly
  if (systemEvent) {
    const stage = stageFromSystemEvent(systemEvent, context);
    if (stage) return stage;
  }

  // 2. No graph or empty graph → frame.
  // Treat null, undefined, or structurally empty graphs (no nodes array or
  // zero nodes) the same way — the user has not built a model yet.
  const graphNodes = context.graph?.nodes;
  const hasGraph = context.graph != null && Array.isArray(graphNodes) && graphNodes.length > 0;

  if (!hasGraph) {
    return {
      stage: 'frame',
      confidence: 'high',
      source: 'inferred',
    };
  }

  // 3. Graph with nodes — check analysis state
  const analysis = context.analysis_response as Record<string, unknown> | null;

  if (!analysis) {
    // Graph with nodes but no analysis → ideate (user is building/refining the model)
    return {
      stage: 'ideate',
      confidence: 'high',
      source: 'inferred',
    };
  }

  // 4. Analysis exists — always evaluate.
  // 'decide' is user-intent-led: it must only be set by an explicit user signal
  // (e.g. "I'm ready to decide" or requesting a decision brief), never inferred
  // from data. Keeping users in evaluate after analysis prevents premature stage
  // lock and ensures they see results before being pushed toward a decision.
  //
  // 5. Analysis exists → evaluate
  // Substate: has_run (analysis is complete since it's present in context)
  return {
    stage: 'evaluate',
    substate: 'has_run',
    confidence: 'high',
    source: 'inferred',
  };
}

/**
 * Derive stage from a system event.
 * Returns null if the event doesn't imply a stage change.
 */
function stageFromSystemEvent(
  event: SystemEvent,
  context: ConversationContext,
): StageIndicator | null {
  switch (event.event_type) {
    case 'direct_analysis_run':
      return {
        stage: 'evaluate',
        substate: 'needs_run',
        confidence: 'high',
        source: 'explicit_event',
      };

    case 'patch_accepted':
      // User accepted a graph patch — still in ideate/build phase
      // unless analysis already exists
      if (context.analysis_response) {
        return {
          stage: 'evaluate',
          substate: 'has_run',
          confidence: 'high',
          source: 'explicit_event',
        };
      }
      return {
        stage: 'ideate',
        confidence: 'high',
        source: 'explicit_event',
      };

    case 'direct_graph_edit':
      // User edited graph directly — still building
      return {
        stage: 'ideate',
        confidence: 'high',
        source: 'explicit_event',
      };

    case 'patch_dismissed':
    case 'feedback_submitted':
      // These don't imply a stage change — fall through to data-driven inference
      return null;

    default:
      return null;
  }
}
