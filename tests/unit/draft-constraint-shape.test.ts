/**
 * Draft-side hard-constraint SHAPE pins.
 *
 * Salvaged 2026-07-19 from PR #510 ("draft-side constraint-node minting from
 * explicit hard-constraint briefs"), closed unmerged.
 *
 * ── WHAT WAS SALVAGED ───────────────────────────────────────────────────────
 * Only the shape assertions: that a well-formed hard-constraint validates
 * under `GoalConstraintSchema`, that malformed ones are rejected, and that
 * `ANTHROPIC_DRAFT_GRAPH_SCHEMA` structurally allows `goal_constraints[]` with
 * the required fields and the two-operator enum. These pin real producer-side
 * contract facts and are independent of any prompt.
 *
 * ── WHAT WAS DELIBERATELY DISCARDED ─────────────────────────────────────────
 * PR #510's `src/prompts/defaults-v187.ts` edit and the four prompt-assertion
 * tests that went with it. That instruction class caused a **live 0/3 drafting
 * regression**, and the PR's premise was subsequently refuted. Landing the
 * prompt edit — or tests that assert the prompt contains it — would re-import
 * a known-bad change. Do not restore them from #510.
 *
 * ── THE ONE PIECE OF #510'S ANALYSIS WORTH KEEPING ──────────────────────────
 * Recorded here because it is a repo fact, not a prompt claim, and it is easy
 * to get wrong: **a `kind:"constraint"` NODE is dead on the CEE producer
 * side** — the adapter normaliser (`adapters/llm/normalisation.ts`) demotes it
 * to `risk`. CEE emits constraints ONLY as `graph.goal_constraints[]` entries,
 * which `run_analysis` forwards to PLoT, which compiles them into constraint
 * nodes. So "mint a constraint" at CEE means "emit a `goal_constraints[]`
 * entry", never "emit a constraint node". This claim was NOT re-verified at
 * salvage time — confirm against the normaliser before acting on it.
 *
 * These tests are pure schema assertions. Nothing here is wired to a live path.
 */

import { describe, it, expect } from "vitest";

import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../../src/cee/draft/anthropic-graph-schema.js";
import { GoalConstraintSchema } from "../../src/schemas/assist.js";

describe("draft constraint shape — well-formed on the wire", () => {
  // A hard-constraint in the CEE producer shape that `run_analysis` forwards
  // to PLoT.
  const wellFormedConstraint = {
    constraint_id: "gc_budget_cap",
    node_id: "fac_first_year_cost",
    operator: "<=",
    value: 50000,
    label: "First-year budget cannot exceed £50k",
    unit: "£",
    source_quote: "cannot exceed £50,000",
    confidence: 1.0,
    provenance: "explicit",
  };

  it("a well-formed constraint validates under GoalConstraintSchema", () => {
    const parsed = GoalConstraintSchema.safeParse(wellFormedConstraint);
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed constraint (bad operator)", () => {
    const bad = { ...wellFormedConstraint, operator: "<" };
    expect(GoalConstraintSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a malformed constraint (missing node_id — nothing to enforce against)", () => {
    const { node_id: _omit, ...noNode } = wellFormedConstraint;
    expect(GoalConstraintSchema.safeParse(noNode).success).toBe(false);
  });

  it("the draft JSON schema structurally allows goal_constraints[] with the required fields", () => {
    // The schema is NOT the blocker — goal_constraints[] is already declared
    // with node_id/constraint_id/operator/value/label required.
    const props = ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties as Record<
      string,
      any
    >;
    const gc = props.goal_constraints;
    expect(gc?.type).toBe("array");
    const itemProps = gc.items.properties as Record<string, unknown>;
    for (const field of [
      "constraint_id",
      "node_id",
      "operator",
      "value",
      "label",
      "unit",
    ]) {
      expect(itemProps).toHaveProperty(field);
    }
    expect(gc.items.required).toEqual(
      expect.arrayContaining([
        "node_id",
        "constraint_id",
        "operator",
        "value",
        "label",
      ])
    );
    // Operator is enum-constrained to the two ASCII operators PLoT accepts.
    expect((itemProps.operator as any).enum).toEqual([">=", "<="]);
  });
});
