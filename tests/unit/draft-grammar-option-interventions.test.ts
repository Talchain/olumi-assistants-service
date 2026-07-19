/**
 * P0 REGRESSION GUARD — the draft grammar must not permit an option node to
 * carry an EMPTY interventions array.
 *
 * THE OUTAGE (2026-07-19, staging build e22f8a6)
 * ----------------------------------------------
 * Every draft turn 500'd. Verbatim from a live reproduction:
 *   violation_code: OPTIONS_IDENTICAL
 *   identical_option_ids: ["opt_hire_now","opt_hire_one","opt_wait"]
 *   intervention_signature: ""            <- EMPTY
 *   repair_skip_reason: "options_identical_unrepairable_by_llm"
 * The EMPTY signature is the tell. OPTIONS_IDENTICAL normally means "two
 * options picked the same values"; an empty signature means the options carry
 * NO values at all.
 *
 * THE MECHANISM (measured, not inferred)
 * --------------------------------------
 * The served prompt (draft_graph v195, sha256[:16] 152998b447819c2e) teaches
 * interventions as an OBJECT — every example reads
 * `"data": { "interventions": { "fac_id": 0.6 } }`. The grammar declares them
 * as an ARRAY of `{factor_id, value}`. Under structured outputs the GRAMMAR
 * wins, so the model must translate shape on the fly. Under v195's heavier
 * OPTION_RULES it stops translating and instead satisfies the grammar with the
 * empty array `[]` — perfectly legal, and content-free. Then:
 *   normalisation.ts converts array-form -> object-form, and `[]` becomes `{}`
 *   graph-validator buildInterventionSignature({}) returns ""
 *   every option collides on "" -> OPTIONS_IDENTICAL -> repair skipped -> 500.
 *
 * WHY `required` IS NOT THE FIX (this is the trap that burned the first two
 * diagnoses of this outage)
 * -----------------------------------------------------------------------
 * JSON-Schema `required` forces the KEY to be present, never the CONTENT. An
 * empty array satisfies `required` perfectly. Live A/B against the served v195
 * prompt, claude-sonnet-4-6, temperature 0, n=3/arm
 * (scripts/measure-interventions-ab.mjs, arms `required` and `minitems`;
 * the two single-arm harnesses that produced these numbers were unified into
 * it — see that file's header for why the split was actively dangerous):
 *   interventions OPTIONAL (the live v9 shape) -> OPTIONS_IDENTICAL 3/3
 *   interventions REQUIRED (the naive fix)     -> OPTIONS_IDENTICAL 3/3
 *   interventions optional + minItems: 1       -> OPTIONS_IDENTICAL 0/3
 *   no grammar at all (prompt-only)            -> OPTIONS_IDENTICAL 0/3
 * Only making `[]` UNGRAMMATICAL fixes it. `minItems` is also why the field
 * must stay OPTIONAL: a factor node has no interventions, so it omits the key
 * entirely (measured: 0 non-option nodes emit it). Requiring it AND bounding it
 * would force every factor node to invent an intervention.
 *
 * WHAT WOULD HAVE CAUGHT THIS
 * ---------------------------
 * Nothing in the suite could see it: the grammar change that exposed this
 * (#520, which demoted the field to optional) shipped with a test that pinned
 * the demotion, and seven merges shipped over the broken draft. This file is
 * the missing guard — it asserts the ONE property that makes the empty array
 * impossible, and then proves the consequence end-to-end through the real
 * normaliser and the real validator.
 */
import { describe, expect, it } from "vitest";

import { ANTHROPIC_DRAFT_GRAPH_SCHEMA, buildDraftGraphSchema } from "../../src/cee/draft/anthropic-graph-schema.js";
import { normaliseDraftResponse } from "../../src/adapters/llm/normalisation.js";
import { validateGraph } from "../../src/validators/graph-validator.js";

/**
 * Read the interventions array schema off the LIVE object (derive, don't
 * mirror — trap #12). Every step is anchor-asserted so that if the schema is
 * ever restructured this test fails LOUD rather than silently passing against
 * a node that no longer exists.
 */
function interventionsArraySchema(schema: unknown): Record<string, unknown> {
  const s = schema as {
    properties?: { nodes?: { items?: { properties?: { data?: { anyOf?: Record<string, unknown>[] } } } } };
  };
  const dataUnion = s.properties?.nodes?.items?.properties?.data?.anyOf;
  expect(dataUnion, "ANCHOR: nodes.items.properties.data.anyOf is gone — grammar restructured").toBeDefined();
  const dataObject = dataUnion?.find((b) => b.type === "object") as
    | { properties?: Record<string, Record<string, unknown>> }
    | undefined;
  expect(dataObject, "ANCHOR: no object branch in the data union").toBeDefined();
  const interventions = dataObject?.properties?.interventions;
  expect(interventions, "ANCHOR: data.interventions is gone from the draft grammar").toBeDefined();
  expect(interventions?.type, "ANCHOR: data.interventions is no longer an array").toBe("array");
  return interventions as Record<string, unknown>;
}

describe("draft grammar — an option's interventions array must be non-empty", () => {
  it("the grammar makes an EMPTY interventions array ungrammatical (minItems >= 1)", () => {
    // THE GUARD. Without this, `"interventions": []` is a legal draft and the
    // whole product 500s at step one (see the file header).
    const interventions = interventionsArraySchema(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    expect(
      interventions.minItems,
      "data.interventions declares no minItems, so the model may satisfy the grammar with `[]` — " +
        "the exact shape that produced the 2026-07-19 OPTIONS_IDENTICAL outage",
    ).toBeDefined();
    expect(interventions.minItems as number).toBeGreaterThanOrEqual(1);
  });

  it("the guard survives the v10 flag-on variant of the schema", () => {
    // buildDraftGraphSchema() derives the topology_plan-omitted variant. The
    // guard must hold on BOTH arms or flipping CEE_DRAFT_OMIT_TOPOLOGY_PLAN
    // would silently reopen the outage.
    for (const schema of [buildDraftGraphSchema(), buildDraftGraphSchema({ omitTopologyPlan: true })]) {
      expect(interventionsArraySchema(schema).minItems as number).toBeGreaterThanOrEqual(1);
    }
  });

  it("interventions stays OPTIONAL — minItems must not force factor nodes to invent one", () => {
    // A factor node carries no interventions and omits the key (measured live:
    // 0 of 10 non-option nodes emitted it). If the field were also `required`,
    // minItems would make every factor node ungrammatical.
    const s = ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as {
      properties: { nodes: { items: { properties: { data: { anyOf: { required?: string[] }[] } } } } };
    };
    const dataObject = s.properties.nodes.items.properties.data.anyOf.find((b) => Array.isArray(b.required));
    expect(dataObject?.required ?? []).not.toContain("interventions");
  });
});

// ── The consequence, end-to-end through the REAL normaliser and validator ────
// This is what the grammar guard above is protecting against. These tests pin
// the failure mode itself, so that if someone ever relaxes the grammar again
// the reason the guard exists is executable, not just a comment.

/** The option-node shape the live grammar permitted, verbatim from a captured
 *  failing draft (claude-sonnet-4-6, served prompt v195, 2026-07-19). */
function rawDraftWithEmptyInterventions() {
  return {
    nodes: [
      { id: "goal_ship", kind: "goal", label: "Ship faster" },
      { id: "dec_hire", kind: "decision", label: "Hiring decision" },
      {
        id: "fac_capacity",
        kind: "factor",
        label: "Engineering capacity",
        category: "controllable",
        data: { value: 0.5, extractionType: "inferred", factor_type: "other" },
      },
      {
        id: "opt_hire_now",
        kind: "option",
        label: "Hire Two Senior Engineers Now",
        data: { value: 1.0, extractionType: "inferred", factor_type: "other", interventions: [], is_baseline: false },
        is_baseline: false,
      },
      {
        id: "opt_wait",
        kind: "option",
        label: "Wait Six Months",
        data: { value: 0.0, extractionType: "inferred", factor_type: "other", interventions: [], is_baseline: false },
        is_baseline: false,
      },
    ],
    edges: [
      { source: "opt_hire_now", target: "fac_capacity", effect_direction: "positive", strength_mean: 0.6 },
      { source: "opt_wait", target: "fac_capacity", effect_direction: "positive", strength_mean: 0.2 },
      { source: "fac_capacity", target: "goal_ship", effect_direction: "positive", strength_mean: 0.7 },
    ],
  };
}

/** Same graph, options carrying DISTINCT interventions — the shape the fixed
 *  grammar forces, taken from a captured arm-C draft. */
function rawDraftWithDistinctInterventions() {
  const draft = rawDraftWithEmptyInterventions();
  const byId = Object.fromEntries(draft.nodes.map((n) => [n.id, n])) as Record<string, { data?: Record<string, unknown> }>;
  byId.opt_hire_now.data!.interventions = [{ factor_id: "fac_capacity", value: 1.0 }];
  byId.opt_wait.data!.interventions = [{ factor_id: "fac_capacity", value: 0.0 }];
  return draft;
}

function optionsIdenticalIssues(raw: unknown) {
  const normalised = normaliseDraftResponse(raw) as Parameters<typeof validateGraph>[0]["graph"];
  const result = validateGraph({ graph: normalised, requestId: "test-p0-options-identical" });
  return (result.errors ?? []).filter((e) => e.code === "OPTIONS_IDENTICAL");
}

describe("empty interventions -> OPTIONS_IDENTICAL with an EMPTY signature (the outage)", () => {
  it("reproduces the live failure: `[]` on every option collides on the empty signature", () => {
    const issues = optionsIdenticalIssues(rawDraftWithEmptyInterventions());
    expect(issues, "empty interventions must trip OPTIONS_IDENTICAL").toHaveLength(1);
    // The empty signature is the fingerprint that distinguishes THIS defect
    // (options carry no values) from a genuine collision (options carry the
    // same values). The live 500 reported exactly `intervention_signature: ""`.
    expect((issues[0].context as { signature?: string })?.signature).toBe("");
    expect((issues[0].context as { optionIds?: string[] })?.optionIds).toEqual(["opt_hire_now", "opt_wait"]);
  });

  it("POSITIVE CONTROL: distinct interventions produce NO violation", () => {
    // Without this, the test above would pass in a world where everything
    // errors — an absence claim with no demonstrated presence (trap #13).
    expect(optionsIdenticalIssues(rawDraftWithDistinctInterventions())).toHaveLength(0);
  });
});
