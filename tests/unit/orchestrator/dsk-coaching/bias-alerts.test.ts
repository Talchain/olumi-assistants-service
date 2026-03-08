import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dsk-loader before importing module under test
vi.mock("../../../../src/orchestrator/dsk-loader.js", () => ({
  getClaimById: vi.fn(() => null),
  getProtocolById: vi.fn(() => null),
  getAllByType: vi.fn(() => []),
  getVersion: vi.fn(() => null),
  getDskVersionHash: vi.fn(() => null),
}));

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { formatBiasAlerts } from "../../../../src/orchestrator/dsk-coaching/bias-alerts.js";
import { getClaimById, getAllByType } from "../../../../src/orchestrator/dsk-loader.js";
import { log } from "../../../../src/utils/telemetry.js";
import type { BriefIntelligence } from "../../../../src/schemas/brief-intelligence.js";

type DskCue = BriefIntelligence['dsk_cues'][number];

function makeCue(overrides: Partial<DskCue> & { bias_type: string; signal: string }): DskCue {
  return {
    confidence: 0.8,
    claim_id: null,
    ...overrides,
  };
}

describe("formatBiasAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sunk_cost cue → correct reflective question", () => {
    const alerts = formatBiasAlerts([
      makeCue({ bias_type: "sunk_cost", signal: "already invested", confidence: 0.9 }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].human_description).toBe(
      "Could past investment or time already spent be influencing this decision?",
    );
    expect(alerts[0].human_description).toMatch(/\?$/);
  });

  it("below threshold → filtered out", () => {
    const alerts = formatBiasAlerts([
      makeCue({ bias_type: "anchoring", signal: "anchored", confidence: 0.5 }),
    ]);
    expect(alerts).toHaveLength(0);
  });

  it("custom threshold respected", () => {
    const alerts = formatBiasAlerts(
      [makeCue({ bias_type: "anchoring", signal: "anchored", confidence: 0.5 })],
      { confidenceThreshold: 0.4 },
    );
    expect(alerts).toHaveLength(1);
  });

  it(">3 above threshold → top 3 by confidence", () => {
    const cues = [
      makeCue({ bias_type: "sunk_cost", signal: "a", confidence: 0.95 }),
      makeCue({ bias_type: "anchoring", signal: "b", confidence: 0.9 }),
      makeCue({ bias_type: "availability", signal: "c", confidence: 0.85 }),
      makeCue({ bias_type: "confirmation", signal: "d", confidence: 0.8 }),
    ];
    const alerts = formatBiasAlerts(cues);
    expect(alerts).toHaveLength(3);
    expect(alerts[0].bias_type).toBe("sunk_cost");
    expect(alerts[1].bias_type).toBe("anchoring");
    expect(alerts[2].bias_type).toBe("availability");
  });

  it("unrecognised bias_type → generic question ending with '?'", () => {
    const alerts = formatBiasAlerts([
      makeCue({ bias_type: "unknown_bias_xyz", signal: "something", confidence: 0.9 }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].human_description).toMatch(/\?$/);
    expect(alerts[0].human_description).toContain("cognitive pattern");
  });

  it("dedup: same bias_type twice → one alert (highest confidence)", () => {
    const alerts = formatBiasAlerts([
      makeCue({ bias_type: "anchoring", signal: "first", confidence: 0.75 }),
      makeCue({ bias_type: "anchoring", signal: "second", confidence: 0.9 }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].confidence).toBe(0.9);
  });

  it("empty cues → empty array", () => {
    expect(formatBiasAlerts([])).toEqual([]);
  });

  it("deterministic IDs — same inputs → same ID", () => {
    const a = formatBiasAlerts([
      makeCue({ bias_type: "sunk_cost", signal: "invested", confidence: 0.8 }),
    ]);
    const b = formatBiasAlerts([
      makeCue({ bias_type: "sunk_cost", signal: "invested", confidence: 0.8 }),
    ]);
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).toHaveLength(12);
  });

  it("surface_targets always ['guidance_panel']", () => {
    const alerts = formatBiasAlerts([
      makeCue({ bias_type: "anchoring", signal: "x", confidence: 0.8 }),
    ]);
    expect(alerts[0].surface_targets).toEqual(["guidance_panel"]);
  });

  it("dsk bundle present → evidence_strength populated from claim", () => {
    vi.mocked(getClaimById).mockReturnValueOnce({
      id: "DSK-B-001",
      type: "claim",
      evidence_strength: "strong",
    } as ReturnType<typeof getClaimById>);

    const alerts = formatBiasAlerts([
      makeCue({ bias_type: "anchoring", signal: "x", confidence: 0.8, claim_id: "DSK-B-001" }),
    ]);
    expect(alerts[0].evidence_strength).toBe("strong");
  });

  it("drift warning fires only when bundle is loaded and claim missing", () => {
    // Bundle loaded (getAllByType returns claims), but claim_id not found
    vi.mocked(getAllByType).mockReturnValueOnce([{ id: "DSK-B-999", type: "claim" }] as never);
    vi.mocked(getClaimById).mockReturnValueOnce(undefined);

    formatBiasAlerts([
      makeCue({ bias_type: "anchoring", signal: "x", confidence: 0.8, claim_id: "DSK-B-001" }),
    ]);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ claim_id: "DSK-B-001" }),
      expect.stringContaining("drift detection"),
    );
  });

  it("no drift warning when bundle is not loaded", () => {
    // No bundle loaded (getAllByType returns [])
    vi.mocked(getAllByType).mockReturnValueOnce([]);
    vi.mocked(getClaimById).mockReturnValueOnce(undefined);

    formatBiasAlerts([
      makeCue({ bias_type: "anchoring", signal: "x", confidence: 0.8, claim_id: "DSK-B-001" }),
    ]);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
