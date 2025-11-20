import { describe, it, expect } from "vitest";
import { summariseTeam } from "../../src/cee/team/index.js";

function makePerspective(overrides: Partial<any> = {}): any {
  return {
    id: "p-1",
    stance: "for",
    ...overrides,
  };
}

describe("CEE team helper - summariseTeam", () => {
  it("computes zero disagreement when everyone is aligned", () => {
    const perspectives = [
      makePerspective({ id: "p1", stance: "for" }),
      makePerspective({ id: "p2", stance: "for" }),
      makePerspective({ id: "p3", stance: "for" }),
    ];

    const summary = summariseTeam(perspectives as any);

    expect(summary.participant_count).toBe(3);
    expect(summary.for_count).toBe(3);
    expect(summary.against_count).toBe(0);
    expect(summary.neutral_count).toBe(0);
    expect(summary.weighted_for_fraction).toBeGreaterThanOrEqual(0);
    expect(summary.weighted_for_fraction).toBeLessThanOrEqual(1);
    expect(summary.disagreement_score).toBeGreaterThanOrEqual(0);
    expect(summary.disagreement_score).toBeLessThanOrEqual(1);
    expect(summary.disagreement_score).toBeCloseTo(0, 5);
    expect(summary.has_team_disagreement).toBe(false);
  });

  it("computes moderate disagreement for 50/50 split", () => {
    const perspectives = [
      makePerspective({ id: "pf1", stance: "for" }),
      makePerspective({ id: "pf2", stance: "for" }),
      makePerspective({ id: "pa1", stance: "against" }),
      makePerspective({ id: "pa2", stance: "against" }),
    ];

    const summary = summariseTeam(perspectives as any);

    expect(summary.participant_count).toBe(4);
    expect(summary.for_count).toBe(2);
    expect(summary.against_count).toBe(2);
    expect(summary.neutral_count).toBe(0);
    expect(summary.disagreement_score).toBeGreaterThanOrEqual(0.4);
    expect(summary.disagreement_score).toBeLessThanOrEqual(0.6);
    expect(summary.has_team_disagreement).toBe(true);
  });

  it("handles even split across three stances", () => {
    const perspectives = [
      makePerspective({ id: "pf1", stance: "for" }),
      makePerspective({ id: "pa1", stance: "against" }),
      makePerspective({ id: "pn1", stance: "neutral" }),
    ];

    const summary = summariseTeam(perspectives as any);

    expect(summary.participant_count).toBe(3);
    expect(summary.for_count).toBe(1);
    expect(summary.against_count).toBe(1);
    expect(summary.neutral_count).toBe(1);
    expect(summary.disagreement_score).toBeGreaterThanOrEqual(0.6);
    expect(summary.disagreement_score).toBeLessThanOrEqual(0.8);
    expect(summary.has_team_disagreement).toBe(true);
  });

  it("respects weights when computing weighted_for_fraction", () => {
    const perspectives = [
      makePerspective({ id: "pf1", stance: "for", weight: 3 }),
      makePerspective({ id: "pa1", stance: "against", weight: 1 }),
    ];

    const summary = summariseTeam(perspectives as any);

    expect(summary.participant_count).toBe(2);
    expect(summary.for_count).toBe(1);
    expect(summary.against_count).toBe(1);
    expect(summary.neutral_count).toBe(0);
    expect(summary.weighted_for_fraction).toBeGreaterThan(0.5);
    expect(summary.weighted_for_fraction).toBeLessThanOrEqual(1);
    expect(summary.disagreement_score).toBeGreaterThanOrEqual(0);
    expect(summary.disagreement_score).toBeLessThanOrEqual(1);
    expect(summary.has_team_disagreement).toBe(false);
  });

  it("treats non-positive weights as no influence but still counts participants", () => {
    const perspectives = [
      makePerspective({ id: "p1", stance: "for", weight: 0 }),
      makePerspective({ id: "p2", stance: "against", weight: 2 }),
    ];

    const summary = summariseTeam(perspectives as any);

    expect(summary.participant_count).toBe(2);
    expect(summary.for_count).toBe(1);
    expect(summary.against_count).toBe(1);
    expect(summary.neutral_count).toBe(0);
    expect(summary.weighted_for_fraction).toBeGreaterThanOrEqual(0);
    expect(summary.weighted_for_fraction).toBeLessThan(0.5);
    expect(summary.disagreement_score).toBeGreaterThanOrEqual(0);
    expect(summary.disagreement_score).toBeLessThanOrEqual(1);
    expect(summary.has_team_disagreement).toBe(false);
  });
});
