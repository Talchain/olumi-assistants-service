/**
 * CEE Decision Review Payload Example (TypeScript)
 *
 * This module shows how a backend or Sandbox-style service might:
 * - Call multiple CEE endpoints using the TypeScript SDK.
 * - Collapse their metadata into a single CeeDecisionReviewPayload suitable
 *   for driving a "decision review" UI (chips, banners, badges).
 *
 * Notes:
 * - This file is not executed automatically in CI; it is intended as
 *   copy-pastable example code for integrators.
 * - When consuming the published SDK, replace relative imports such as
 *   "../index.js" with "@olumi/assistants-sdk".
 */

import {
  createCEEClient,
  buildCeeDecisionReviewPayload,
  type CeeDecisionReviewPayloadLegacy as CeeDecisionReviewPayload,
} from "../index.js";
import type {
  CEEDraftGraphRequestV1,
  CEEOptionsRequestV1,
  CEEEvidenceHelperRequestV1,
  CEEBiasCheckRequestV1,
  CEETeamPerspectivesRequestV1,
} from "../ceeTypes.js";

export interface CeeDecisionReviewExampleConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Example product-facing payload that embeds CEE metadata-only results under
 * a `cee` key. This is intentionally minimal and should be adapted to each
 * product's own decision / scenario model.
 */
export interface ScenarioDecisionReview {
  id: string;
  title: string;
  created_at: string;
  cee: CeeDecisionReviewPayload;
}

export async function buildScenarioDecisionReview(
  config: CeeDecisionReviewExampleConfig,
): Promise<ScenarioDecisionReview> {
  const client = createCEEClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeout: config.timeoutMs ?? 60_000,
  });

  // 1) Draft My Model – example pricing decision
  const draftReq: CEEDraftGraphRequestV1 = {
    brief: "Should we launch a new Pro tier for our SaaS product?",
  } as any;

  const draft = await client.draftGraph(draftReq);

  // 2) Options Helper – enrich the decision with explicit options
  const optionsReq: CEEOptionsRequestV1 = {
    graph: draft.graph as any,
    archetype: draft.archetype,
  } as any;

  const options = await client.options(optionsReq);

  // 3) Evidence Helper – score a small set of supporting evidence items
  const evidenceReq: CEEEvidenceHelperRequestV1 = {
    evidence: [
      { id: "e1", type: "experiment" },
      { id: "e2", type: "user_research" },
    ],
  } as any;

  const evidence = await client.evidenceHelper(evidenceReq);

  // 4) Bias Check – check the graph for structural/content biases
  const biasReq: CEEBiasCheckRequestV1 = {
    graph: draft.graph as any,
    archetype: draft.archetype,
  } as any;

  const bias = await client.biasCheck(biasReq);

  // 5) Team Perspectives – summarise team stances
  const teamReq: CEETeamPerspectivesRequestV1 = {
    perspectives: [
      { id: "p1", stance: "for", confidence: 0.8 },
      { id: "p2", stance: "against", confidence: 0.7 },
      { id: "p3", stance: "neutral" },
    ],
  } as any;

  const team = await client.teamPerspectives(teamReq);

  // Collapse envelopes into a compact, metadata-only decision review payload.
  const cee = buildCeeDecisionReviewPayload({
    draft,
    options,
    evidence,
    bias,
    team,
  });

  const now = new Date();

  return {
    id: cee.trace?.request_id ?? "decision-review-example",
    title: "New Pro tier pricing decision (CEE review)",
    created_at: now.toISOString(),
    cee,
  };
}
