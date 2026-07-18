/**
 * Draft-side hard-constraint minting (trust-spine).
 *
 * Real-user acceptance run (real-user-acceptance-2026-07-17/PASS1.md, Step 6)
 * found the top remaining trust-spine gap: an explicit hard-constraint brief
 * ("first-year budget cannot exceed £50,000 ... full stop") drafted the budget
 * as ORDINARY FACTORS ("First-Year Budget Breach", "Budget Headroom Within £50k
 * Cap") and NO constraint — so the constraint chain
 * (CEE_CONSTRAINT_INFEASIBLE_GATE / PLoT constraint_probabilities / ISL
 * constraint tracking) had nothing to fire on for naturally-drafted models.
 *
 * Root cause is a PROMPT gap, not a schema gap:
 *   - The draft JSON schema (ANTHROPIC_DRAFT_GRAPH_SCHEMA) already allows the
 *     `goal_constraints[]` array with all required fields, and CEE emits
 *     constraints ONLY as `graph.goal_constraints[]` entries — run_analysis
 *     forwards them to PLoT, which compiles them into constraint nodes
 *     (add-constraint.ts / schemas/assist.ts:160 "PLoT merges explicit
 *     goal_constraints[] with compiled constraint nodes"). A `kind:"constraint"`
 *     NODE is dead on the producer side: the adapter normaliser demotes it to
 *     `risk` (adapters/llm/normalisation.ts). So "mint a constraint node" is,
 *     at the CEE producer, "emit a goal_constraints[] entry".
 *   - The in-repo default v187 prompt instructed generic goal_constraints[]
 *     extraction but never forced EXPLICIT hard-constraint language to mint a
 *     constraint entry rather than descriptive factors.
 *
 * This test pins BOTH halves (derive-not-mirror: it asserts the instruction
 * block and the well-formed shape exist, it does NOT hand-copy the whole
 * prompt):
 *   1. The v187 default prompt carries the hard-constraint minting instruction
 *      + the soft-preference negative example.
 *   2. The worked-example constraint the prompt tells the model to emit is a
 *      well-formed GoalConstraint (validates; malformed shapes rejected), and
 *      the draft JSON schema structurally allows goal_constraints[].
 */

import { describe, it, expect } from "vitest";

import { DRAFT_GRAPH_PROMPT_V187 } from "../../src/prompts/defaults-v187.js";
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../../src/cee/draft/anthropic-graph-schema.js";
import { GoalConstraintSchema } from "../../src/schemas/assist.js";

describe("draft prompt v187 — hard-constraint minting instruction", () => {
  it("instructs explicit hard-constraint language to mint a goal_constraints[] entry (not just factors)", () => {
    // Derive-not-mirror: assert the instruction BLOCK exists via stable
    // markers, not the full prose. If the block is ever removed or the
    // heading reworded away, this fails loud rather than drifting green.
    expect(DRAFT_GRAPH_PROMPT_V187).toContain("HARD CONSTRAINTS");
    expect(DRAFT_GRAPH_PROMPT_V187).toContain("MUST become a goal_constraints[] entry");
    // The exact failure mode from the acceptance run must be named as an
    // anti-pattern: descriptive factors alone are not enough.
    expect(DRAFT_GRAPH_PROMPT_V187).toContain("never ONLY descriptive factors");
  });

  it("lists the explicit hard-constraint trigger phrases from the acceptance-run brief", () => {
    // The brief that regressed used exactly this language.
    expect(DRAFT_GRAPH_PROMPT_V187).toContain("hard constraint");
    expect(DRAFT_GRAPH_PROMPT_V187).toContain("cannot exceed");
    expect(DRAFT_GRAPH_PROMPT_V187).toContain("full stop");
  });

  it("narrows to explicit limits only — soft numeric preferences stay factors, not constraints", () => {
    // The instruction must NOT teach the model to invent constraints from
    // soft preferences. The negative example is load-bearing.
    expect(DRAFT_GRAPH_PROMPT_V187).toContain("SOFT PREFERENCES ARE NOT HARD CONSTRAINTS");
    expect(DRAFT_GRAPH_PROMPT_V187).toContain("ideally");
    expect(DRAFT_GRAPH_PROMPT_V187).toContain("NOT a goal_constraints[] entry");
  });

  it("directs currency limits to USER units (matches the regex/edit-path and PLoT normalisation)", () => {
    // Currency constraints are stored in user units (50000, unit "£"), NOT a
    // 0-1 fraction — PLoT normalises against the constrained node's cap.
    // (compound-goal/extractor.ts normaliseConstraintUnits only touches "%".)
    expect(DRAFT_GRAPH_PROMPT_V187).toContain("currency/absolute-quantity constraints use USER units");
  });
});

describe("draft constraint shape — well-formed on the wire", () => {
  // The exact constraint the v187 worked example tells the model to emit for
  // the acceptance-run brief. This is the CEE producer shape run_analysis
  // forwards to PLoT (GoalConstraintSchema).
  const workedExampleConstraint = {
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

  it("the worked-example constraint validates under GoalConstraintSchema", () => {
    const parsed = GoalConstraintSchema.safeParse(workedExampleConstraint);
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed constraint (bad operator)", () => {
    const bad = { ...workedExampleConstraint, operator: "<" };
    expect(GoalConstraintSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a malformed constraint (missing node_id — nothing to enforce against)", () => {
    const { node_id: _omit, ...noNode } = workedExampleConstraint;
    expect(GoalConstraintSchema.safeParse(noNode).success).toBe(false);
  });

  it("the draft JSON schema structurally allows goal_constraints[] with the required fields", () => {
    // The schema is NOT the blocker — goal_constraints[] is already declared
    // with node_id/constraint_id/operator/value/label required.
    const props = ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties as Record<string, any>;
    const gc = props.goal_constraints;
    expect(gc?.type).toBe("array");
    const itemProps = gc.items.properties as Record<string, unknown>;
    for (const field of ["constraint_id", "node_id", "operator", "value", "label", "unit"]) {
      expect(itemProps).toHaveProperty(field);
    }
    expect(gc.items.required).toEqual(
      expect.arrayContaining(["node_id", "constraint_id", "operator", "value", "label"]),
    );
    // Operator is enum-constrained to the two ASCII operators PLoT accepts.
    expect((itemProps.operator as any).enum).toEqual([">=", "<="]);
  });
});
