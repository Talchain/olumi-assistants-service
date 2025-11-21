import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CeeGoldenJourneyInputs {
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

export interface CeeGoldenJourneyExpectations {
  expected_quality_band?: "low" | "medium" | "high";
  expect_any_truncated: boolean;
  expect_has_validation_issues: boolean;
  expect_has_team_disagreement?: boolean;
  expect_is_complete?: boolean;
}

export interface CeeGoldenJourneyFixture {
  kind: "cee_journey";
  id: CeeGoldenJourneyId;
  description: string;
  inputs: CeeGoldenJourneyInputs;
  expectations: CeeGoldenJourneyExpectations;
}

export const CEE_GOLDEN_JOURNEYS = {
  HEALTHY_PRODUCT_DECISION: "healthy_product_decision",
  UNDER_SPECIFIED_STRATEGIC_DECISION: "under_specified_strategic_decision",
  EVIDENCE_HEAVY_WITH_TRUNCATION: "evidence_heavy_with_truncation",
  TEAM_DISAGREEMENT: "team_disagreement",
  LONG_TERM_STRATEGIC_BET: "long_term_strategic_bet",
} as const;

export type CeeGoldenJourneyId =
  (typeof CEE_GOLDEN_JOURNEYS)[keyof typeof CEE_GOLDEN_JOURNEYS];

const JOURNEY_CACHE = new Map<CeeGoldenJourneyId, CeeGoldenJourneyFixture>();

function cloneJourney(journey: CeeGoldenJourneyFixture): CeeGoldenJourneyFixture {
  // Fixtures are plain JSON; a JSON round-trip is sufficient for a deep copy and
  // avoids tests or tools accidentally mutating shared cached state.
  return JSON.parse(JSON.stringify(journey)) as CeeGoldenJourneyFixture;
}

export async function loadCeeGoldenJourney(
  id: CeeGoldenJourneyId,
): Promise<CeeGoldenJourneyFixture> {
  const cached = JOURNEY_CACHE.get(id);
  if (cached) return cloneJourney(cached);

  const fixturePath = join(
    __dirname,
    "../fixtures/cee/golden-journeys",
    `${id}.json`,
  );
  const content = await readFile(fixturePath, "utf-8");
  const parsed = JSON.parse(content) as CeeGoldenJourneyFixture;

  if (parsed.kind !== "cee_journey") {
    throw new Error(`Unexpected golden journey kind for ${id}: ${parsed.kind}`);
  }

  JOURNEY_CACHE.set(id, parsed);
  return cloneJourney(parsed);
}
