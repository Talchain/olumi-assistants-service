/**
 * CEE SDK Journey Example (TypeScript)
 *
 * This module demonstrates how a client might call multiple CEE endpoints via
 * the TypeScript SDK and then build a combined decision story, journey
 * summary, and UI flags using metadata-only helpers.
 *
 * Notes:
 * - This file is not executed automatically in CI; it is intended as
 *   copy-pastable example code for integrators.
 * - When consuming the published SDK, replace relative imports such as
 *   "../index.js" with "@olumi/assistants-sdk".
 */

import {
  createCEEClient,
  buildDecisionStorySummary,
  buildCeeJourneySummary,
  buildCeeUiFlags,
} from "../index.js";
import type {
  CEEDraftGraphRequestV1,
  CEEOptionsRequestV1,
  CEEEvidenceHelperRequestV1,
  CEETeamPerspectivesRequestV1,
} from "../ceeTypes.js";
import type {
  DecisionStorySummary,
  CeeJourneySummary,
  CeeUiFlags,
} from "../ceeHelpers.js";

export interface CeeJourneyExampleConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface CeeJourneyExampleResult {
  story: DecisionStorySummary;
  journey: CeeJourneySummary;
  uiFlags: CeeUiFlags;
}

/**
 * Run a simple CEE journey using the SDK client.
 *
 * This function intentionally returns a compact, metadata-only result suitable
 * for driving a UI layer (e.g. chips, banners, and badges) without exposing
 * raw briefs, graphs, or LLM text.
 */
export async function runCeeJourneyExample(
  config: CeeJourneyExampleConfig,
): Promise<CeeJourneyExampleResult> {
  const client = createCEEClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeout: config.timeoutMs ?? 60_000,
  });

  const draftBody: CEEDraftGraphRequestV1 = {
    brief: "Draft a simple pricing decision model for a new SaaS feature.",
  } as any;

  const draft = await client.draftGraph(draftBody);

  const optionsBody: CEEOptionsRequestV1 = {
    graph: draft.graph as any,
    archetype: draft.archetype,
  } as any;

  const options = await client.options(optionsBody);

  const evidenceBody: CEEEvidenceHelperRequestV1 = {
    evidence: [
      { id: "e1", type: "experiment" },
      { id: "e2", type: "user_research" },
    ],
  } as any;

  const evidence = await client.evidenceHelper(evidenceBody);

  const teamBody: CEETeamPerspectivesRequestV1 = {
    perspectives: [
      { id: "p1", stance: "for", confidence: 0.8 },
      { id: "p2", stance: "against", confidence: 0.7 },
      { id: "p3", stance: "neutral" },
    ],
  } as any;

  const team = await client.teamPerspectives(teamBody);

  const story: DecisionStorySummary = buildDecisionStorySummary({
    draft,
    options,
    evidence,
    team,
  });

  const journey: CeeJourneySummary = buildCeeJourneySummary({
    draft,
    options,
    evidence,
    team,
  });

  const uiFlags: CeeUiFlags = buildCeeUiFlags(journey);

  return { story, journey, uiFlags };
}
