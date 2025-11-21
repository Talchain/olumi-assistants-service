import { describe, it } from "vitest";

import { expectNoSecretLikeKeys } from "../utils/no-secret-like-keys.js";
import { CEE_CALIBRATION_CASES, loadCalibrationCase } from "../utils/cee-calibration.js";
import { GOLDEN_BRIEFS, loadGoldenBrief } from "../utils/fixtures.js";
import {
  CEE_GOLDEN_JOURNEYS,
  loadCeeGoldenJourney,
} from "../utils/cee-golden-journeys.js";

describe("expectNoSecretLikeKeys across long-lived fixtures", () => {
  it("holds for golden calibration fixtures", async () => {
    const highQuality = await loadCalibrationCase(CEE_CALIBRATION_CASES.HIGH_QUALITY);
    expectNoSecretLikeKeys(highQuality);
  });

  it("holds for golden brief fixtures", async () => {
    const briefs = await Promise.all([
      loadGoldenBrief(GOLDEN_BRIEFS.BUY_VS_BUILD),
      loadGoldenBrief(GOLDEN_BRIEFS.HIRE_VS_CONTRACT),
      loadGoldenBrief(GOLDEN_BRIEFS.MIGRATE_VS_STAY),
      loadGoldenBrief(GOLDEN_BRIEFS.EXPAND_VS_FOCUS),
      loadGoldenBrief(GOLDEN_BRIEFS.TECHNICAL_DEBT),
    ]);

    for (const brief of briefs) {
      expectNoSecretLikeKeys(brief);
    }
  });

  it("holds for CEE golden journey fixtures", async () => {
    const journeys = await Promise.all([
      loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.HEALTHY_PRODUCT_DECISION),
      loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.UNDER_SPECIFIED_STRATEGIC_DECISION),
      loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.EVIDENCE_HEAVY_WITH_TRUNCATION),
      loadCeeGoldenJourney(CEE_GOLDEN_JOURNEYS.TEAM_DISAGREEMENT),
    ]);

    for (const journey of journeys) {
      expectNoSecretLikeKeys(journey);
    }
  });
});
