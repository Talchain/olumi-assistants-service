/**
 * ⭐ THE PRIOR-DISTRIBUTION DRIFT ALARM FIRES, AND IT DISCRIMINATES (F4, 2026-07-25).
 *
 * WHY AN ALARM AND NOT A TEST. `PriorDistribution` (`schemas/graph.ts`) is a
 * one-member enum in the SENT draft grammar whose entire justification is that
 * the PMS-served `draft_graph` prompt promises `distribution` is always
 * "uniform". Two facts make that a trap-12 hand-maintained mirror:
 *
 *   * the prompt is re-pinnable WITHOUT a CEE deploy, so nothing in this repo
 *     can observe the drift at build time; and
 *   * the real validator (`cee-v3.ts`) types the field `z.string()`, so nothing
 *     REJECTS a second family either — the claim in `anthropic-graph-schema.ts`
 *     that "the grammar and the validator cannot disagree" is false for this one
 *     field.
 *
 * Left alone, a prompt teaching a second family drifts SILENTLY: on the
 * structured path the grammar forces "uniform" and the prior is MISLABELLED;
 * on the prompt-only fallback the new value passes straight through. Both read
 * as green. So the mirror is made to FAIL LOUD at runtime instead of assuming
 * good — and this file proves the mechanism EXECUTES rather than merely exists,
 * which is the defect class ("guarantee theatre") this estate keeps shipping.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: { cee: { debugCategoryTrace: false, debugLoggingEnabled: false } },
  isProduction: () => false,
}));

import { transformNodeToV3 } from "../../src/cee/transforms/schema-v3.js";
import { PriorDistribution, isKnownPriorDistribution } from "../../src/schemas/graph.js";
import { log } from "../../src/utils/telemetry.js";

function factorNodeWithPrior(distribution: unknown) {
  return {
    id: "fac_market_size",
    kind: "factor",
    label: "Addressable market size",
    category: "external",
    prior: { distribution, range_min: 0, range_max: 1 },
  } as never;
}

function driftEvents() {
  return (log.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
    (c) => (c[0] as { event?: string })?.event === "cee.draft.prior_distribution_drift",
  );
}

describe("F4 — prior.distribution prompt/grammar drift alarm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("FIRES on a distribution family the sent grammar cannot express", () => {
    transformNodeToV3(factorNodeWithPrior("lognormal"));

    const fired = driftEvents();
    expect(fired).toHaveLength(1);
    // The alarm must carry BOTH sides of the disagreement, or an on-call reading
    // it cannot tell which one moved.
    expect((fired[0][0] as Record<string, unknown>).observed_distribution).toBe("lognormal");
    expect((fired[0][0] as Record<string, unknown>).grammar_distributions).toEqual([
      ...PriorDistribution.options,
    ]);
  });

  it("PASSES THE VALUE THROUGH unchanged — it is a detector, not a rejector", () => {
    // A second distribution family is a PROMPT decision. Silently 400ing live
    // drafts over it would be a worse failure than the drift it detects.
    const v3 = transformNodeToV3(factorNodeWithPrior("lognormal"));
    expect((v3 as { prior?: { distribution?: string } }).prior?.distribution).toBe("lognormal");
  });

  it("POSITIVE CONTROL — stays SILENT on the value the prompt actually promises", () => {
    // Without this, an alarm that fired unconditionally would pass the test
    // above and drown its own signal.
    transformNodeToV3(factorNodeWithPrior("uniform"));
    expect(driftEvents()).toHaveLength(0);
  });

  it("also fires when `distribution` is missing or the wrong type", () => {
    transformNodeToV3(factorNodeWithPrior(undefined));
    transformNodeToV3(factorNodeWithPrior(42));
    expect(driftEvents()).toHaveLength(2);
  });

  it("the predicate is DERIVED from PriorDistribution, never a re-typed list", () => {
    // If a family is ever added to the enum, the alarm must retire for it
    // automatically — the whole point is that the list has one home.
    for (const member of PriorDistribution.options) {
      expect(isKnownPriorDistribution(member)).toBe(true);
    }
    expect(isKnownPriorDistribution("normal")).toBe(false);
    expect(isKnownPriorDistribution(undefined)).toBe(false);
  });
});
