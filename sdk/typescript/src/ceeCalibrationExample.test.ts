import { describe, it, expect } from "vitest";
import type {
  CEEDraftGraphResponseV1,
  CEEEvidenceHelperResponseV1,
} from "./ceeTypes.js";
import type { CeeJourneyEnvelopes } from "./ceeHelpers.js";
import { buildCeeCalibrationSnapshot } from "./examples/ceeCalibrationExample.js";

describe("ceeCalibrationExample", () => {
  it("produces a high-quality, untruncated, issue-free snapshot", () => {
    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-sdk-high", correlation_id: "r-sdk-high", engine: {} },
      quality: { overall: 9 } as any,
      graph: {} as any,
    } as any;

    const envelopes: CeeJourneyEnvelopes = { draft };

    const snap = buildCeeCalibrationSnapshot(envelopes);

    expect(snap.quality_overall).toBe(9);
    expect(snap.quality_band).toBe("high");
    expect(snap.any_truncated).toBe(false);
    expect(snap.has_validation_issues).toBe(false);
  });

  it("tracks truncation and validation issues across envelopes", () => {
    const evidence: CEEEvidenceHelperResponseV1 = {
      trace: { request_id: "r-sdk-mixed", correlation_id: "r-sdk-mixed", engine: {} },
      quality: { overall: 6 } as any,
      items: [] as any,
      validation_issues: [{ code: "structural_gap", severity: "error" } as any],
      response_limits: {
        items_max: 10,
        items_truncated: true,
      } as any,
    } as any;

    const envelopes: CeeJourneyEnvelopes = { evidence };

    const snap = buildCeeCalibrationSnapshot(envelopes);

    expect(snap.quality_overall).toBe(6);
    expect(snap.quality_band).toBe("medium");
    expect(snap.any_truncated).toBe(true);
    expect(snap.has_validation_issues).toBe(true);
  });

  it("never leaks raw graph labels into the calibration snapshot", () => {
    const SECRET = "SDK_CAL_DO_NOT_LEAK";

    const draft: CEEDraftGraphResponseV1 = {
      trace: { request_id: "r-sdk-secret", correlation_id: "r-sdk-secret", engine: {} },
      quality: { overall: 7 } as any,
      graph: {
        // Intentionally include a secret marker in a label; the calibration
        // snapshot must not surface it.
        nodes: [{ id: "n1", kind: "goal", label: `Secret ${SECRET}` }],
        edges: [],
      } as any,
    } as any;

    const envelopes: CeeJourneyEnvelopes = { draft };

    const snap = buildCeeCalibrationSnapshot(envelopes);

    const serialized = JSON.stringify(snap).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });
});
