/**
 * P0 REGRESSION GUARD — the draft grammar must not permit an EMPTY top-level
 * `edges` array.
 *
 * THE OUTAGE (2026-08-08, staging builds b8beb5a and db985bb)
 * ----------------------------------------------------------
 * Draft turns 500'd at `deterministic_enforcement` with
 *   reason: draft_graph_cee_graph_invalid
 *   codes:  MISSING_BRIDGE + UNREACHABLE_FROM_DECISION + NO_PATH_TO_GOAL
 *           + NO_EFFECT_PATH
 * and the Render log named the mechanism directly: `"edges":0`, with
 * `roots == leaves == nodes` on every failing event. Measured rates from the
 * CEE log stream for 8 Aug (PHASE0-EVIDENCE-2026-07-28/
 * structured-outputs-witness-2026-08-08.md §1.5, §2.5):
 *
 *   claude-sonnet-4-6, structured_outputs_used:true   n=45   edges:0  0%
 *   claude-sonnet-5,   structured_outputs_used:false  n=12   edges:0  25%
 *   claude-sonnet-5,   structured_outputs_used:true   n=15   edges:0  80%
 *
 * NOT a max_tokens truncation: the cap was 8489 and the failing outputs were
 * 183-986 output tokens (successes 2465-2876). The emission simply STOPS after
 * the node list, because at that point the object is already complete and legal.
 *
 * THE MECHANISM
 * -------------
 * `edges` IS in the schema's top-level `required` list. It always was. But the
 * `edges` property declared only `{ type: "array", items: {...} }` with NO
 * `minItems`, so `"edges": []` is a STRICTLY CONFORMANT structured output. Under
 * constrained decoding the model may satisfy the grammar with an empty array and
 * terminate early; under prompt-only JSON the served prompt's own instructions
 * kept edges flowing, which is why the fallback regime failed at 25% and the
 * structured-outputs regime at 80%.
 *
 * WHY `required` IS NOT THE FIX — and why this file exists at all
 * --------------------------------------------------------------
 * This is the SAME defect the option-`interventions` P0 guard documents 100
 * lines earlier in the same schema file (2026-07-19,
 * tests/unit/draft-grammar-option-interventions.test.ts), which states the
 * principle verbatim: `required` DOES NOT FIX THIS: it forces the KEY, never the
 * CONTENT, and `[]` satisfies it. That lane measured the 3-arm result
 *   optional -> 3/3 fail · required (the naive fix) -> 3/3 fail
 *   optional + minItems: 1 -> 0/3 · no grammar -> 0/3
 * and `edges` was left carrying the identical hole one level up.
 *
 * A guard that asserts only "edges is required" would pass at the exact commit
 * that produced the outage. So the central test below does NOT read a property
 * name: it VALIDATES an edgeless instance against the real sent grammar with
 * ajv and requires it to be REJECTED, and validates the same instance against a
 * control clone with `minItems` deleted and requires it to be ACCEPTED. That
 * pair is what pins LENGTH rather than presence.
 *
 * ⚠ THE VALUE MUST BE 1 — 1 IS NOT A STYLE CHOICE.
 * `enforceAnthropicSchemaCompliance` was REMOVED FROM THE RUNTIME (see
 * adapters/llm/anthropic.ts:65 — "schemas are compliant by construction"), so
 * nothing sanitises this object before it goes on the wire. Anthropic accepts
 * `minItems` values 0 and 1 ONLY (MIN_ITEMS_ALLOWED_VALUES, live-probed
 * 2026-07-19: `minItems: 4` -> HTTP 400). `minItems: 0` is accepted and is a
 * NO-OP. So 1 is the only value that is both legal and load-bearing, and any
 * other value would 400 EVERY draft rather than degrade quietly.
 */
import { describe, expect, it } from "vitest";
// NAMED import: ajv's default export is not constructable under this repo's
// module interop (`new (default)` is the shape that put
// tests/contracts/schema-self-test.test.ts into the typecheck baseline). The
// named class and its error type both typecheck cleanly.
import { Ajv, type ErrorObject } from "ajv";

import {
  ANTHROPIC_DRAFT_GRAPH_SCHEMA,
  buildDraftGraphSchema,
  countOptionalParams,
  countUnionParams,
} from "../../src/cee/draft/anthropic-graph-schema.js";
import { MIN_ITEMS_ALLOWED_VALUES } from "../../src/adapters/llm/anthropic-schema-compliance.js";
import { normaliseDraftResponse } from "../../src/adapters/llm/normalisation.js";
import { validateGraph } from "../../src/validators/graph-validator.js";

/**
 * Read the top-level `edges` array schema off the LIVE object (derive, don't
 * mirror — trap #12). Every step is anchor-asserted, so a restructure fails
 * LOUD here instead of silently passing against a node that no longer exists.
 */
function edgesArraySchema(schema: unknown): Record<string, unknown> {
  const s = schema as { properties?: Record<string, Record<string, unknown>> };
  const edges = s.properties?.edges;
  expect(edges, "ANCHOR: top-level `edges` is gone from the draft grammar").toBeDefined();
  expect(edges?.type, "ANCHOR: top-level `edges` is no longer an array").toBe("array");
  return edges as Record<string, unknown>;
}

describe("draft grammar — the top-level edges array must be non-empty", () => {
  it("the grammar makes an EMPTY edges array ungrammatical (minItems >= 1)", () => {
    // THE GUARD. Without this, `"edges": []` is a legal draft and the turn 500s
    // at deterministic_enforcement (see the file header).
    const edges = edgesArraySchema(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    expect(
      edges.minItems,
      "top-level `edges` declares no minItems, so the model may satisfy the grammar with `[]` — " +
        "the exact shape that produced the 2026-08-08 edges:0 draft-failure regression",
    ).toBeDefined();
    expect(edges.minItems as number).toBeGreaterThanOrEqual(1);
  });

  it("the guard survives the BUILT (actually-sent) variant of the schema", () => {
    // buildDraftGraphSchema() derives the variant handed to `output_config`
    // (anthropic.ts:795 -> :909). A guard that only held on the base object
    // would be blind to the grammar the product actually sends.
    const edges = edgesArraySchema(buildDraftGraphSchema());
    expect(edges.minItems as number).toBeGreaterThanOrEqual(1);
  });

  it("the sibling `nodes` hole is closed too (PROPHYLACTIC — never observed live)", () => {
    // `nodes` carried the identical shape: required, array, no length bound.
    // ⚠ Scope: this is NOT part of the measured regression. Every failing event
    // in the 2026-08-08 corpus carried nodes and no edges, so `nodes: []` was
    // never observed and its reachability is UNKNOWN. Closed because the hole
    // is identical and the keyword is free.
    const s = buildDraftGraphSchema() as unknown as { properties: Record<string, Record<string, unknown>> };
    const nodes = s.properties.nodes;
    expect(nodes?.type, "ANCHOR: top-level `nodes` is no longer an array").toBe("array");
    expect(nodes.minItems as number).toBeGreaterThanOrEqual(1);
    expect(MIN_ITEMS_ALLOWED_VALUES.has(nodes.minItems as number)).toBe(true);
  });

  it("`goal_constraints` is deliberately NOT bounded — an empty list is legitimate", () => {
    // The negative half of the rule, so a later tidy-up does not "helpfully"
    // apply minItems everywhere. A brief may genuinely state no goal
    // constraint; forcing one would make the model INVENT a threshold, which is
    // the same class of harm as the edges hole, in the opposite direction.
    const s = buildDraftGraphSchema() as unknown as { properties: Record<string, Record<string, unknown>> };
    expect(s.properties.goal_constraints?.type).toBe("array");
    expect(s.properties.goal_constraints.minItems).toBeUndefined();
  });

  it("minItems carries an API-ACCEPTED value — anything else 400s every draft", () => {
    // Runtime schema-compliance stripping was REMOVED (anthropic.ts:65), so this
    // object reaches the wire verbatim. Anthropic accepts only 0 or 1, and 0 is
    // a no-op, so 1 is the single value that is legal AND enforcing.
    const edges = edgesArraySchema(buildDraftGraphSchema());
    expect(
      MIN_ITEMS_ALLOWED_VALUES.has(edges.minItems as number),
      `edges.minItems = ${String(edges.minItems)} — Anthropic accepts only ${[...MIN_ITEMS_ALLOWED_VALUES].join(" or ")}; ` +
        "an out-of-range value is NOT stripped at runtime and would 400 every draft call",
    ).toBe(true);
    expect(edges.minItems, "minItems: 0 is accepted by the API but is a NO-OP").not.toBe(0);
  });
});

// ── The distinction that IS the defect, proven by EXECUTION ──────────────────
// `required` forces the KEY; only `minItems` forces the CONTENT. These two tests
// are a matched pair: the first proves the shipped grammar rejects `edges: []`,
// the second proves that a grammar identical except for the missing `minItems`
// ACCEPTS it. Without the second, the first could pass for any reason at all
// (a typo in the fixture, an unrelated required field) and the guard would be
// binding to something other than edge-array length.

const ajv = new Ajv({ strict: false, allErrors: true });

/** A structurally complete draft whose only defect is the empty edge list. */
function edgelessInstance() {
  return {
    nodes: [
      { id: "goal_ship", kind: "goal", label: "Ship faster" },
      { id: "dec_hire", kind: "decision", label: "Hiring decision" },
    ],
    edges: [],
    goal_constraints: [],
  };
}

/** The same instance carrying one edge — the shape the fixed grammar forces. */
function singleEdgeInstance() {
  return {
    ...edgelessInstance(),
    edges: [
      {
        from: "dec_hire",
        to: "goal_ship",
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: "positive",
      },
    ],
  };
}

describe("`required` forces the KEY, `minItems` forces the CONTENT", () => {
  it("the SENT grammar REJECTS an edgeless draft, and the rejection is about edge COUNT", () => {
    const validate = ajv.compile(buildDraftGraphSchema() as object);
    const ok = validate(edgelessInstance());
    expect(ok, "the sent grammar accepted `edges: []` — the empty draft is still grammatical").toBe(false);
    // Bind to the REASON, not merely to a failure: the instance is otherwise
    // complete, so any other error would mean this test passes for the wrong
    // cause (trap #19 — assert against the named object, not a value predicate).
    const errs: ErrorObject[] = validate.errors ?? [];
    expect(
      errs.some((e: ErrorObject) => e.keyword === "minItems" && e.instancePath === "/edges"),
      `expected a minItems violation at /edges, got: ${JSON.stringify(errs.map((e: ErrorObject) => ({ p: e.instancePath, k: e.keyword })))}`,
    ).toBe(true);
  });

  it("CONTROL: the same grammar WITHOUT minItems ACCEPTS the edgeless draft", () => {
    // This is the pre-fix grammar, reconstructed by deleting exactly one
    // keyword. It accepting `[]` is the whole outage, and it is what proves the
    // guard above binds to LENGTH rather than to the `required` list.
    const control = structuredClone(buildDraftGraphSchema()) as unknown as {
      properties: { edges: Record<string, unknown> };
      required: string[];
    };
    delete control.properties.edges.minItems;
    expect(control.required, "CONTROL ANCHOR: `edges` must still be REQUIRED here — " +
      "otherwise this control would prove nothing about the required-vs-minItems distinction",
    ).toContain("edges");

    const validate = ajv.compile(control as object);
    expect(
      validate(edgelessInstance()),
      "the pre-fix grammar rejected `edges: []` — then minItems is not what closed the hole, " +
        "and this whole diagnosis is wrong",
    ).toBe(true);
  });

  it("POSITIVE CONTROL: a one-edge draft is accepted by the SENT grammar", () => {
    // An absence assertion must first prove it can see a presence (trap #13).
    // Without this, the rejection tests above would pass in a world where the
    // grammar rejects everything.
    const validate = ajv.compile(buildDraftGraphSchema() as object);
    expect(
      validate(singleEdgeInstance()),
      `the fixed grammar rejected a VALID one-edge draft: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });
});

// ── The consequence, end-to-end through the REAL normaliser and validator ────
// The grammar guard above protects against this. Pinning the failure itself
// keeps the REASON the guard exists executable rather than merely commented.

/** The three enforcement codes the live edges:0 failures carried. */
const EDGE_STARVED_CODES = ["NO_EFFECT_PATH", "NO_PATH_TO_GOAL", "UNREACHABLE_FROM_DECISION"] as const;

/** A causal edge in the GRAMMAR's own form (`from`/`to`/`strength`). */
const edge = (from: string, to: string, mean: number) => ({
  from,
  to,
  strength: { mean, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: "positive",
});
/** An option->factor structural edge, at the canonical values the validator demands. */
const structural = (from: string, to: string) => ({
  from,
  to,
  strength: { mean: 1.0, std: 0.01 },
  exists_probability: 1.0,
  effect_direction: "positive",
});

function draftWithEdges(edges: unknown[]) {
  return {
    nodes: [
      { id: "goal_rev", kind: "goal", label: "Grow revenue" },
      { id: "dec_hire", kind: "decision", label: "Hiring decision" },
      {
        id: "opt_now",
        kind: "option",
        label: "Hire now",
        data: { value: 1, extractionType: "inferred", factor_type: "other", interventions: [{ factor_id: "fac_cap", value: 1 }] },
      },
      {
        id: "opt_wait",
        kind: "option",
        label: "Wait six months",
        data: { value: 0, extractionType: "inferred", factor_type: "other", interventions: [{ factor_id: "fac_cap", value: 0 }] },
      },
      {
        id: "fac_cap",
        kind: "factor",
        label: "Engineering capacity",
        category: "controllable",
        data: { value: 0.5, extractionType: "inferred", factor_type: "other", uncertainty_drivers: ["hiring market"] },
      },
      { id: "out_ship", kind: "outcome", label: "Shipping throughput" },
    ],
    edges,
  };
}

/** The edge set that makes the fixture above FULLY valid (measured: 0 errors). */
function wellFormedEdges() {
  return [
    edge("dec_hire", "opt_now", 0.5),
    edge("dec_hire", "opt_wait", 0.5),
    structural("opt_now", "fac_cap"),
    structural("opt_wait", "fac_cap"),
    edge("fac_cap", "out_ship", 0.7),
    edge("out_ship", "goal_rev", 0.8),
  ];
}

function codesFor(raw: unknown): string[] {
  const normalised = normaliseDraftResponse(raw) as Parameters<typeof validateGraph>[0]["graph"];
  const result = validateGraph({ graph: normalised, requestId: "test-p0-edges-empty" });
  return [...new Set((result.errors ?? []).map((e) => e.code))];
}

describe("empty edges -> the live enforcement failure (the outage)", () => {
  it("reproduces the live failure: an edgeless graph trips every edge-starved code", () => {
    const codes = codesFor(draftWithEdges([]));
    for (const code of EDGE_STARVED_CODES) {
      expect(codes, `an edgeless graph must trip ${code} — this is the live 500`).toContain(code);
    }
  });

  it("POSITIVE CONTROL: the identical graph WITH edges validates CLEANLY", () => {
    // Proves the codes above are caused by the missing edges and by nothing
    // else (trap #13 — demonstrate the presence, not just the absence). The two
    // arms differ in the edge list ALONE, and this arm carries ZERO errors, so
    // there is no residual noise for the assertions above to be riding on.
    const codes = codesFor(draftWithEdges(wellFormedEdges()));
    expect(codes, `the well-formed control must validate cleanly, got: ${codes.join(", ")}`).toEqual([]);
  });
});

// ── Grammar-budget cost of the fix ──────────────────────────────────────────
// The schema file documents a TIGHT budget (16 union params, 24 optional
// params, serialized bytes). The interventions precedent asserts `minItems`
// "costs no optional-parameter slot and 13 bytes". That claim is re-derived
// here for THIS addition rather than inherited, by measuring the same schema
// with and without the keyword.

describe("minItems costs no union slot and no optional slot", () => {
  function withoutEdgesMinItems() {
    const clone = structuredClone(ANTHROPIC_DRAFT_GRAPH_SCHEMA) as unknown as {
      properties: { edges: Record<string, unknown> };
    };
    delete clone.properties.edges.minItems;
    return clone;
  }

  it("union-param count is unchanged by the keyword", () => {
    // `minItems` introduces no anyOf and no type array, so it cannot consume a
    // union slot. Derived, not asserted from the comment.
    expect(countUnionParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA)).toBe(countUnionParams(withoutEdgesMinItems()));
  });

  it("optional-param count is unchanged by the keyword", () => {
    // countOptionalParams counts PROPERTIES absent from their object's
    // `required` list. `minItems` is a keyword, not a property, so it is
    // invisible to that budget.
    expect(countOptionalParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA)).toBe(countOptionalParams(withoutEdgesMinItems()));
  });

  it("the byte cost is exactly the keyword, and the budget still holds", () => {
    const withBytes = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA).length;
    const withoutBytes = JSON.stringify(withoutEdgesMinItems()).length;
    expect(withBytes - withoutBytes).toBe('"minItems":1,'.length); // 13
    // The dedicated budget test owns the absolute ceiling; this only pins that
    // THIS change did not spend it.
    expect(withBytes).toBeLessThanOrEqual(3400);
  });
});
