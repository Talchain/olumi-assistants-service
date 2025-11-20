/**
 * Scenario/Sandbox CEE service example (TypeScript)
 *
 * This example shows how a downstream app might expose a small, metadata-only
 * CEE integration service using the TypeScript SDK. It is intended as
 * copy-pastable service-layer code for a UI or Scenario/Sandbox backend.
 *
 * In the SSOT, this service lives behind PLoT or a backend API layer. The
 * Scenario UI calls that backend and never calls CEE directly or holds CEE
 * credentials.
 *
 * Notes:
 * - This file is not executed automatically in CI.
 * - When consuming the published SDK, replace relative imports such as
 *   "../index.js" with "@olumi/assistants-sdk".
 */

import {
  createCEEClient,
  buildCeeDecisionReviewPayload,
  type CeeDecisionReviewPayload,
} from "../index.js";
import { isRetryableCEEError } from "../ceeHelpers.js";
import { OlumiAPIError } from "../errors.js";
import type {
  CEEDraftGraphRequestV1,
  CEEOptionsRequestV1,
  CEEEvidenceHelperRequestV1,
  CEEBiasCheckRequestV1,
  CEETeamPerspectivesRequestV1,
  CEEDraftGraphResponseV1,
  CEEOptionsResponseV1,
  CEEEvidenceHelperResponseV1,
  CEEBiasCheckResponseV1,
  CEETeamPerspectivesResponseV1,
} from "../ceeTypes.js";

/**
 * Minimal CEE configuration for a Scenario/Sandbox-style service.
 */
export interface ScenarioCeeConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Minimal decision metadata that a Scenario/Sandbox app would already have.
 * The CEE layer never needs to see raw briefs or decision text – only these
 * safe identifiers and timestamps.
 */
export interface ScenarioDecision {
  id: string;
  title: string;
  createdAt: string;
}

/**
 * Product-facing payload wrapping a metadata-only CEE decision review under a
 * `cee` key, plus app-level identifiers and a safe trace identifier.
 *
 * On success, `cee` is populated and `retryable` is typically false.
 * On failure, `cee` is null and `retryable` / `errorCode` indicate whether the
 * client may safely retry.
 *
 * In production PLoT, this would usually be embedded in or closely mirror the
 * canonical CEE integration bundle (`CeeIntegrationReviewBundle`) exposed to
 * the Scenario UI, as defined in the SDK helpers.
 */
export interface ScenarioCeeDecisionReview {
  decisionId: string;
  createdAt: string;
  cee: CeeDecisionReviewPayload | null;
  retryable: boolean;
  errorCode?: string;
  traceId?: string;
}

export interface ScenarioCeeEnvelopes {
  draft?: CEEDraftGraphResponseV1;
  options?: CEEOptionsResponseV1;
  evidence?: CEEEvidenceHelperResponseV1;
  bias?: CEEBiasCheckResponseV1;
  team?: CEETeamPerspectivesResponseV1;
}

/**
 * Helper to derive a Scenario-style error object from a thrown CEE error.
 *
 * This function remains metadata-only: it uses only structured error codes and
 * trace IDs surfaced by the TS SDK (never prompts, graphs, or content).
 */
function mapCeeErrorForScenario(error: unknown): {
  code?: string;
  retryable: boolean;
  traceId?: string;
} {
  const retryable = isRetryableCEEError(error);
  let code: string | undefined;
  let traceId: string | undefined;

  if (error instanceof OlumiAPIError) {
    const fromDetails =
      error.details && typeof (error.details as any).cee_code === "string"
        ? ((error.details as any).cee_code as string)
        : undefined;

    if (fromDetails) {
      code = fromDetails;
    } else if (typeof error.code === "string") {
      code = error.code;
    }

    if (typeof error.requestId === "string") {
      traceId = error.requestId;
    } else if (
      error.details &&
      typeof (error.details as any).cee_trace?.request_id === "string"
    ) {
      traceId = (error.details as any).cee_trace.request_id as string;
    }
  }

  return { code, retryable, traceId };
}

/**
 * Pure helper that composes CEE envelopes (or a structured error) into a
 * ScenarioCeeDecisionReview. This is the easiest entry-point for tests and for
 * downstream services that already have CEE responses.
 */
export function buildScenarioCeeDecisionReviewFromEnvelopes(
  decision: ScenarioDecision,
  envelopes: ScenarioCeeEnvelopes,
  error?: unknown,
): ScenarioCeeDecisionReview {
  if (error) {
    const { code, retryable, traceId } = mapCeeErrorForScenario(error);

    return {
      decisionId: decision.id,
      createdAt: decision.createdAt,
      cee: null,
      retryable,
      errorCode: code,
      traceId,
    };
  }

  const cee = buildCeeDecisionReviewPayload(envelopes);

  return {
    decisionId: decision.id,
    createdAt: decision.createdAt,
    cee,
    retryable: false,
    errorCode: undefined,
    traceId: cee.trace?.request_id,
  };
}

/**
 * Example async service wrapper that a Scenario/Sandbox backend could adapt.
 *
 * Behaviour:
 * - Calls core CEE endpoints via the TypeScript SDK.
 * - Collapses their metadata into a CeeDecisionReviewPayload.
 * - Wraps the result (or a structured error) in ScenarioCeeDecisionReview.
 *
 * This function is intentionally conservative:
 * - It never logs or inspects prompts, graphs, or LLM outputs.
 * - It relies only on structured metadata (error codes, trace IDs, booleans).
 */
export async function buildScenarioCeeDecisionReview(
  decision: ScenarioDecision,
  config: ScenarioCeeConfig,
): Promise<ScenarioCeeDecisionReview> {
  const client = createCEEClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeout: config.timeoutMs ?? 60_000,
  });

  try {
    // 1) Draft My Model – example pricing decision. In a real app, the brief
    //    would come from existing product context and must not be logged.
    const draftReq: CEEDraftGraphRequestV1 = {
      brief:
        "SCENARIO_DECISION_BRIEF_DO_NOT_LOG: Should we launch a new Pro tier?",
    } as any;

    const draft = await client.draftGraph(draftReq);

    // 2) Options Helper – enrich the decision with explicit options.
    const optionsReq: CEEOptionsRequestV1 = {
      graph: draft.graph as any,
      archetype: draft.archetype,
    } as any;

    const options = await client.options(optionsReq);

    // 3) Evidence Helper – score a small set of supporting evidence items.
    const evidenceReq: CEEEvidenceHelperRequestV1 = {
      evidence: [
        { id: "e1", type: "experiment" },
        { id: "e2", type: "user_research" },
      ],
    } as any;

    const evidence = await client.evidenceHelper(evidenceReq);

    // 4) Bias Check – check the graph for structural/content biases.
    const biasReq: CEEBiasCheckRequestV1 = {
      graph: draft.graph as any,
      archetype: draft.archetype,
    } as any;

    const bias = await client.biasCheck(biasReq);

    // 5) Team Perspectives – summarise team stances.
    const teamReq: CEETeamPerspectivesRequestV1 = {
      perspectives: [
        { id: "p1", stance: "for", confidence: 0.8 },
        { id: "p2", stance: "against", confidence: 0.7 },
        { id: "p3", stance: "neutral" },
      ],
    } as any;

    const team = await client.teamPerspectives(teamReq);

    return buildScenarioCeeDecisionReviewFromEnvelopes(decision, {
      draft,
      options,
      evidence,
      bias,
      team,
    });
  } catch (error) {
    return buildScenarioCeeDecisionReviewFromEnvelopes(decision, {}, error);
  }
}
