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
    const ids = Object.values(CEE_CALIBRATION_CASES);
    const cases = await Promise.all(ids.map((id) => loadCalibrationCase(id)));

    for (const calibration of cases) {
      expectNoSecretLikeKeys(calibration);
    }
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
    const ids = Object.values(CEE_GOLDEN_JOURNEYS);
    const journeys = await Promise.all(ids.map((id) => loadCeeGoldenJourney(id)));

    for (const journey of journeys) {
      expectNoSecretLikeKeys(journey);
    }
  });
});
