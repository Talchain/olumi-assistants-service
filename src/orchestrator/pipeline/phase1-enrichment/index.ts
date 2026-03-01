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

/**
 * Phase 1 entry point: enrich the request context.
 *
 * All deterministic. No LLM calls. No I/O.
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

  return {
    // Scenario state
    graph: context.graph,
    analysis: context.analysis_response,
    framing: context.framing,
    conversation_history: context.messages,
    selected_elements: context.selected_elements ?? [],

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
  };
}
