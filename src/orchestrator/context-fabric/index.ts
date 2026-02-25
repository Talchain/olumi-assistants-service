/**
 * Context Fabric — Barrel Export
 *
 * 3-zone cache-aware context assembly pipeline for the Conversational Orchestrator.
 * Built in isolation — a separate follow-up change wires these into the
 * orchestrator turn handler behind CEE_ORCHESTRATOR_CONTEXT_ENABLED.
 */

// Types and Schemas
export type {
  ContextFabricRoute,
  DecisionStage,
  DecisionState,
  GraphSummary,
  AnalysisSummary,
  DriverSummary,
  Framing,
  ConversationTurn,
  ToolOutput,
  RouteProfile,
  TokenBudget,
  AssembledContext,
} from "./types.js";

export {
  ContextFabricRouteSchema,
  DecisionStageSchema,
  DecisionStateSchema,
  GraphSummarySchema,
  AnalysisSummarySchema,
  DriverSummarySchema,
  ConversationTurnSchema,
  ToolOutputSchema,
  RouteProfileSchema,
} from "./types.js";

// Route Profiles
export { getProfile, computeBudget, getZone2Tokens } from "./profiles.js";

// Renderer
export {
  assembleContext,
  renderZone1,
  renderZone2,
  renderZone3,
  renderProbability,
  renderSensitivity,
  renderMargin,
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
  RULES_REMINDER,
} from "./renderer.js";

// Token Estimator
export { estimateTokens, checkBudget } from "./token-estimator.js";
