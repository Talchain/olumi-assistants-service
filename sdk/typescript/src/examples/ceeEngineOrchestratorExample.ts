/**
 * CEE Engine / Orchestrator Example (TypeScript)
 *
 * This example shows how a backend engine or orchestrator (such as PLoT or a
 * decision-intelligence service) might:
 *
 * - Call multiple CEE endpoints via the TypeScript SDK.
 * - Collapse their metadata into a single CeeDecisionReviewPayload.
 * - Derive coarse-grained engine actions (warn, auto re-run, tag health band)
 *   based solely on CEE metadata.
 *
 * In the SSOT, this code runs on the PLoT/engine side only. Scenario UIs
 * consume metadata-only review bundles from PLoT and never call CEE directly
 * or hold CEE credentials.
 *
 * Notes:
 * - This file is not executed automatically in CI; it is example code only.
 * - When consuming the published SDK, replace "../index.js" with
 *   "@olumi/assistants-sdk".
 */

import {
  createCEEClient,
  buildCeeDecisionReviewPayload,
  type CeeDecisionReviewPayload,
} from "../index.js";
import type {
  CEEDraftGraphRequestV1,
  CEEOptionsRequestV1,
  CEEEvidenceHelperRequestV1,
  CEEBiasCheckRequestV1,
  CEETeamPerspectivesRequestV1,
  CEEDraftGraphResponseV1 as _CEEDraftGraphResponseV1,
  CEEOptionsResponseV1 as _CEEOptionsResponseV1,
  CEEEvidenceHelperResponseV1 as _CEEEvidenceHelperResponseV1,
  CEEBiasCheckResponseV1 as _CEEBiasCheckResponseV1,
  CEETeamPerspectivesResponseV1 as _CEETeamPerspectivesResponseV1,
} from "../ceeTypes.js";

/**
 * Minimal configuration for an engine service calling CEE.
 */
export interface EngineCeeConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Minimal scenario metadata available to an engine; the CEE layer never needs
 * to see raw prompts or graphs from the engine.
 */
export interface EngineScenario {
  id: string;
  label: string;
  createdAt: string;
}

export type EngineHealthBand = "ok" | "warning" | "risk";

/**
 * Coarse-grained actions an engine might take based on CEE.
 */
export interface EngineCeeActions {
  healthBand: EngineHealthBand;
  shouldWarn: boolean;
  shouldAutoReRun: boolean;
  traceId?: string;
}

/**
 * Example engine-facing wrapper around a CEE decision review payload.
 */
export interface EngineCeeDecisionReview {
  scenarioId: string;
  createdAt: string;
  cee: CeeDecisionReviewPayload;
  actions: EngineCeeActions;
}

/**
 * Pure helper: derive engine actions from a metadata-only
 * CeeDecisionReviewPayload.
 */
export function computeEngineCeeActions(
  review: CeeDecisionReviewPayload,
): EngineCeeActions {
  const { journey, uiFlags, trace } = review;
  const band: EngineHealthBand = journey.health.overallStatus;

  const shouldWarn =
    band !== "ok" || uiFlags.has_truncation_somewhere || uiFlags.has_team_disagreement;

  const shouldAutoReRun =
    band === "risk" &&
    (journey.health.any_truncated || journey.health.has_validation_issues);

  return {
    healthBand: band,
    shouldWarn,
    shouldAutoReRun,
    traceId: trace?.request_id,
  };
}

/**
 * Example async orchestration function. In a real engine, this might be wired
 * into a batch evaluation pipeline or a scenario runner.
 *
 * This example deliberately avoids logging prompts or graph contents; it uses
 * only metadata and the SDK helpers.
 */
export async function runEngineCeeReviewForScenario(
  scenario: EngineScenario,
  config: EngineCeeConfig,
): Promise<EngineCeeDecisionReview> {
  const client = createCEEClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeout: config.timeoutMs ?? 60_000,
  });

  // 1) Draft My Model – scenario-specific brief (must not be logged).
  const draftReq: CEEDraftGraphRequestV1 = {
    brief: `ENGINE_SCENARIO_DO_NOT_LOG: ${scenario.label}`,
  } as any;

  const draft = await client.draftGraph(draftReq);

  // 2) Options Helper – enrich the decision with explicit options.
  const optionsReq: CEEOptionsRequestV1 = {
    graph: draft.graph as any,
    archetype: draft.archetype,
  } as any;

  const options = await client.options(optionsReq);

  // 3) Evidence Helper – score engine-provided evidence items (if any).
  const evidenceReq: CEEEvidenceHelperRequestV1 = {
    evidence: [], // engines can plug in their own evidence IDs/types here.
  } as any;

  const evidence = await client.evidenceHelper(evidenceReq);

  // 4) Bias Check – check for structural/content biases.
  const biasReq: CEEBiasCheckRequestV1 = {
    graph: draft.graph as any,
    archetype: draft.archetype,
  } as any;

  const bias = await client.biasCheck(biasReq);

  // 5) Team Perspectives – capture team stance summaries if applicable.
  const teamReq: CEETeamPerspectivesRequestV1 = {
    perspectives: [],
  } as any;

  const team = await client.teamPerspectives(teamReq);

  const cee = buildCeeDecisionReviewPayload({
    draft,
    options,
    evidence,
    bias,
    team,
  });

  const actions = computeEngineCeeActions(cee);

  return {
    scenarioId: scenario.id,
    createdAt: scenario.createdAt,
    cee,
    actions,
  };
}
