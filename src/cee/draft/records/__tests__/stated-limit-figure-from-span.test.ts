/**
 * THE USER'S STATED LIMIT GETS A FIGURE, AND A MIS-TARGETED LIMIT REFUSES VISIBLY.
 *
 * MEASURED 15 Sep 2026 on 23 captured drafts at served prompt v201 /
 * `claude-sonnet-4-6`. The brief's "keeping monthly churn under 4%" reached the
 * graph in 0 of 20 pricing drafts — no threshold, no constraint node, no
 * `goal_constraints` row — while the goal from the SAME sentence bound perfectly
 * (`goal_threshold_raw: 20000`, `brief_binding: "verified"`). That contrast is
 * what made it a finding rather than a guess.
 *
 * Cause: 13 of 13 captured constraints carried `direction` and NO numeric
 * `value` — the figure sat in the span. Both constraint branches gate on
 * `typeof item.value === "number"`, so neither fired, `statedConstraintBindings`
 * stayed empty, and `constraint_target_not_measurable` — written for exactly
 * this case — could not fire AT ALL: 0 occurrences in 23 captures.
 *
 * The fixture is a REAL pass-1 record set. Append to it, never edit it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { projectDraftRecords } from "../seam.js";
import { enumerateCompletionAsk, modelAnswerableAskItems } from "../completion.js";
import type { DraftRecordSet } from "../grammar.js";

const FIXTURES = join(process.cwd(), "src/cee/draft/records/__tests__/fixtures/2026-09-15-option-effect-references");
const BRIEF =
  "Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price to £59 with the next Pro feature release, or hold at £49 and ship the same feature release to drive volume?";

function project(records: DraftRecordSet) {
  const r = projectDraftRecords(records, BRIEF);
  if (!r.ok) throw new Error(`projection failed: ${r.reason}`);
  return r.projection;
}
const captured = (): DraftRecordSet =>
  JSON.parse(readFileSync(join(FIXTURES, "live-stated-limit-no-value-2026-09-15.json"), "utf8")) as DraftRecordSet;

describe("A — the limit's figure is read from its own span", () => {
  it("A1: the purpose-built refusal FIRES, where it previously could not fire at all", () => {
    const dropped = project(captured()).dropped as ReadonlyArray<{ reason: string; label?: string }>;
    const hit = dropped.find((d) => d.reason === "constraint_target_not_measurable");
    expect(hit).toBeDefined();
    expect(hit!.label).toBe("keeping monthly churn under 4%");
  });

  it("A2: and the limit's own quantity is carried on the disclosure", () => {
    const dropped = project(captured()).dropped as ReadonlyArray<Record<string, unknown>>;
    const withValue = dropped.filter(
      (d) => d.label === "keeping monthly churn under 4%" && typeof d.value === "number",
    );
    expect(withValue.length).toBeGreaterThan(0);
    expect(withValue[0]!.value).toBe(4);
    expect(withValue[0]!.unit).toBe("%");
  });
});

describe("B — the EXISTING repair path engages, and its blocker is pinned", () => {
  it("B1: `constraint_target_unbindable` is asked, naming the target that cannot carry a threshold", () => {
    const records = captured();
    const ask = enumerateCompletionAsk(records, project(records));
    const item = ask.items.find((i) => i.kind === "constraint_target_unbindable");
    expect(item).toBeDefined();
    expect(String(item!.detail)).toContain("not a measured quantity");
  });

  /**
   * ⭐⭐ THE BLOCKER, PINNED IN THE SUITE RATHER THAN LEFT IN A COMMENT.
   *
   * The repair for a mis-targeted limit is a write to `applies_to_*` on a
   * `stated_items[]` entry, and `buildRecordsCompletionSchema()` exposes ONLY
   * `claims` with `additionalProperties: false`. So this ask can be raised and
   * NOT answered, by design. If a `stated_items` axis is ever added to the
   * completion grammar, this test is where that shows up.
   */
  it("B2: it is NOT model-answerable — the completion grammar has no `stated_items` axis", () => {
    const records = captured();
    const ask = enumerateCompletionAsk(records, project(records));
    const answerable = modelAnswerableAskItems(ask).map((i) => i.kind);
    expect(ask.items.some((i) => i.kind === "constraint_target_unbindable")).toBe(true);
    expect(answerable).not.toContain("constraint_target_unbindable");
  });
});

describe("C — it guesses nothing, and changes nothing it should not", () => {
  /** `factor` is NOT a valid stated kind — the target must be a factor CLAIM. */
  const base = (over: Record<string, unknown>): DraftRecordSet =>
    ({
      stated_items: [
        { kind: "goal", source_quote: "reach £20k MRR", role: "target" },
        { kind: "constraint", source_quote: "keeping monthly churn under 4%", direction: "ceiling", applies_to_claim: 0, ...over },
      ],
      claims: [
        { claim_kind: "factor", label: "Monthly Churn Rate", basis: [] },
        { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [0] },
        { claim_kind: "causal_link", label: "churn erodes MRR", from_claim: 0, to_claim: 1, effect: "negative", strength: 0.5 },
        { claim_kind: "causal_link", label: "MRR drives goal", from_claim: 1, to_stated: 0, effect: "positive", strength: 0.8 },
      ],
    }) as unknown as DraftRecordSet;

  it("C1: an AMBIGUOUS span yields no figure — two quantities means no guess", () => {
    const records = base({ source_quote: "keep churn under 4% and CAC under 200" });
    const dropped = project(records).dropped as ReadonlyArray<Record<string, unknown>>;
    const valued = dropped.filter((d) => typeof d.value === "number" && String(d.label).includes("CAC"));
    expect(valued.length).toBe(0);
    // and it did not silently pick one of the two either
    const nodes = project(records).graph.nodes as ReadonlyArray<Record<string, any>>;
    const bound = nodes.find((n) => n.observed_state !== undefined && String(n.label).includes("CAC"));
    expect(bound).toBeUndefined();
  });

  it("C2: a DECLARED value still wins — the span is a fallback, never an override", () => {
    // A BOUND limit stops being a node and becomes a `goalConstraints` row, so
    // that is where the value has to be asserted. Reading it off a node was the
    // first version of this test and it looked like a product failure.
    const rows = (project(base({ value: 0.02 })) as unknown as {
      goalConstraints: ReadonlyArray<Record<string, unknown>>;
    }).goalConstraints;
    const row = rows.find((r) => String(r.source_quote).includes("monthly churn"));
    expect(row).toBeDefined();
    expect(row!.value).toBe(0.02);
    expect(row!.operator).toBe("<=");
  });

  /**
   * ⭐⭐ THE POSITIVE CONTROL THAT MAKES THE WHOLE FINDING LEGIBLE: the pipeline
   * is fully CAPABLE of honouring this limit. Given the span figure and a target
   * that is a measured quantity, it binds and produces a real row with the
   * user's own operator and provenance `explicit`.
   *
   * So nothing downstream is missing. In the captured live draft the model
   * targets the GOAL instead of the churn factor, the existing safety correctly
   * refuses, and the completion grammar cannot rewrite `applies_to_*`. THAT is
   * the residual blocker — not a gap in this path.
   */
  it("C4: with the figure in the span and a MEASURED target, the limit BINDS", () => {
    const rows = (project(base({})) as unknown as {
      goalConstraints: ReadonlyArray<Record<string, unknown>>;
    }).goalConstraints;
    const row = rows.find((r) => String(r.source_quote).includes("monthly churn"));
    expect(row).toBeDefined();
    expect(row!.value).toBe(4);
    expect(row!.operator).toBe("<=");
    expect(row!.provenance).toBe("explicit");
  });

  it("C3: NO DIRECTION still refuses to bind — the operator gate stays in front", () => {
    const records = base({ direction: undefined });
    const dropped = project(records).dropped as ReadonlyArray<{ reason: string }>;
    expect(dropped.some((d) => d.reason === "constraint_direction_unstated")).toBe(true);
  });
});
