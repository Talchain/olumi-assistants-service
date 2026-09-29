import {
  buildCeeJourneySummary,
  buildCeeUiFlags,
  type CeeJourneyEnvelopes,
} from "../ceeHelpers.js";
import { CEE_QUALITY_HIGH_MIN, CEE_QUALITY_MEDIUM_MIN } from "../ceePolicy.js";
import type { CEEClient } from "../ceeClient.js";
import type {
  CEEDraftGraphRequestV1,
  CEEEvidenceHelperRequestV1,
  CEEOptionsRequestV1,
  CEEBiasCheckRequestV1,
  CEETeamPerspectivesRequestV1,
} from "../ceeTypes.js";

export type CeeJourneyQualityBand = "low" | "medium" | "high";

export interface CeeGoldenJourneySnapshot {
  quality_overall?: number;
  quality_band?: CeeJourneyQualityBand;
  any_truncated: boolean;
  has_validation_issues: boolean;
  has_team_disagreement: boolean;
  is_complete: boolean;
}

export function buildCeeGoldenJourneySnapshot(
  envelopes: CeeJourneyEnvelopes,
): CeeGoldenJourneySnapshot {
  const journey = buildCeeJourneySummary(envelopes);
  const uiFlags = buildCeeUiFlags(journey);

  const qualityOverall = journey?.story?.quality_overall;

  let band: CeeJourneyQualityBand | undefined;
  if (typeof qualityOverall === "number") {
    if (qualityOverall >= CEE_QUALITY_HIGH_MIN) band = "high";
    else if (qualityOverall >= CEE_QUALITY_MEDIUM_MIN) band = "medium";
    else band = "low";
  }

  const anyTruncated =
    (journey?.health?.any_truncated ?? false) ||
    (journey?.story?.any_truncated ?? false) ||
    uiFlags.has_truncation_somewhere;

  const hasValidationIssues = Boolean(journey?.health?.has_validation_issues);
  const hasTeamDisagreement = Boolean(
    journey?.has_team_disagreement || uiFlags.has_team_disagreement,
  );
  const isComplete = Boolean(journey?.is_complete);

  return {
    quality_overall: qualityOverall,
    quality_band: band,
    any_truncated: Boolean(anyTruncated),
    has_validation_issues: hasValidationIssues,
    has_team_disagreement: hasTeamDisagreement,
    is_complete: isComplete,
  };
}

export interface CeeGoldenJourneyInput {
  draftBrief: string;
  draftArchetypeHint?: string;
  evidenceItems?: Array<{
    id: string;
    type: string;
  }>;
  teamPerspectives?: Array<{
    id: string;
    stance: "for" | "against" | "neutral";
    confidence?: number;
  }>;
  archetype?: {
    decision_type?: string;
    match?: "exact" | "fuzzy" | "generic";
    confidence?: number;
  };
}

// Lightweight helper type that mirrors the golden-journey fixture `inputs` shape
// without taking a hard dependency on the test utilities. This allows callers to
// map fixture-style inputs directly into the SDK helper input.
export interface CeeGoldenJourneyFixtureInputsLike {
  draft?: {
    brief: string;
    archetype_hint?: string;
  };
  evidence?: {
    items: Array<{
      id: string;
      type: string;
    }>;
  };
  team?: {
    perspectives: Array<{
      id: string;
      stance: "for" | "against" | "neutral";
      confidence?: number;
    }>;
  };
}

export function buildCeeGoldenJourneyInputFromFixtureInputs(
  inputs: CeeGoldenJourneyFixtureInputsLike,
): CeeGoldenJourneyInput {
  const draftBrief = inputs.draft?.brief ?? "Synthetic CEE golden journey";

  const evidenceItems = inputs.evidence?.items?.length
    ? inputs.evidence.items.map((item) => ({ id: item.id, type: item.type }))
    : undefined;

  const teamPerspectives = inputs.team?.perspectives?.length
    ? inputs.team.perspectives.map((p) => ({
        id: p.id,
        stance: p.stance,
        ...(typeof p.confidence === "number" ? { confidence: p.confidence } : {}),
      }))
    : undefined;

  return {
    draftBrief,
    ...(inputs.draft?.archetype_hint
      ? { draftArchetypeHint: inputs.draft.archetype_hint }
      : {}),
    ...(evidenceItems ? { evidenceItems } : {}),
    ...(teamPerspectives ? { teamPerspectives } : {}),
  };
}

export interface CeeGoldenJourneyRunResult {
  envelopes: CeeJourneyEnvelopes;
  snapshot: CeeGoldenJourneySnapshot;
}

export async function runCeeGoldenJourney(
  client: CEEClient,
  input: CeeGoldenJourneyInput,
): Promise<CeeGoldenJourneyRunResult> {
  const draftReq: CEEDraftGraphRequestV1 = {
    brief: input.draftBrief,
    ...(input.draftArchetypeHint
      ? { archetype_hint: input.draftArchetypeHint }
      : {}),
  } as any;

  const draft = await client.draftGraph(draftReq);
  const draftGraph = (draft as any)?.graph;
  const hasUsableGraph = draftGraph && typeof draftGraph === "object";

  if (!hasUsableGraph) {
    const envelopes: CeeJourneyEnvelopes = {
      draft,
    };

    const snapshot = buildCeeGoldenJourneySnapshot(envelopes);

    return { envelopes, snapshot };
  }

  const optionsReq: CEEOptionsRequestV1 = {
    graph: draftGraph,
    ...(input.archetype ? { archetype: input.archetype as any } : {}),
  } as any;

  const options = await client.options(optionsReq);

  let evidenceEnvelope: unknown | null = null;
  if (input.evidenceItems && input.evidenceItems.length > 0) {
    const evidenceReq: CEEEvidenceHelperRequestV1 = {
      evidence: input.evidenceItems.map((item) => ({
        id: item.id,
        type: item.type as any,
      })),
    } as any;

    evidenceEnvelope = await client.evidenceHelper(evidenceReq);
  }

  const biasReq: CEEBiasCheckRequestV1 = {
    graph: draftGraph,
    ...(input.archetype ? { archetype: input.archetype as any } : {}),
  } as any;

  const bias = await client.biasCheck(biasReq);

  let teamEnvelope: unknown | null = null;
  if (input.teamPerspectives && input.teamPerspectives.length > 0) {
    const teamReq: CEETeamPerspectivesRequestV1 = {
      perspectives: input.teamPerspectives.map((p) => ({
        id: p.id,
        stance: p.stance,
        ...(typeof p.confidence === "number" ? { confidence: p.confidence } : {}),
      })),
    } as any;

    teamEnvelope = await client.teamPerspectives(teamReq);
  }

  const envelopes: CeeJourneyEnvelopes = {
    draft,
    options,
    evidence: evidenceEnvelope as any,
    bias,
    team: teamEnvelope as any,
  };

  const snapshot = buildCeeGoldenJourneySnapshot(envelopes);

  return { envelopes, snapshot };
}
