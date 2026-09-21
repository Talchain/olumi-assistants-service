/**
 * v8 stringified aux fields — ingress parse tests (Lane 26, 2026-07-07).
 *
 * The Anthropic draft schema (v8) declares coaching, causal_claims, and
 * topology_plan as `{ type: "string" }` JSON-string fields so the compiled
 * grammar fits Anthropic's unpublished size limit (see GRAMMAR BUDGET (v8)
 * in src/cee/draft/anthropic-graph-schema.ts and the byte pins in
 * anthropic-graph-schema-grammar-budget.test.ts).
 *
 * parseStringifiedAuxFields() (called at the top of normaliseDraftResponse,
 * before Zod and every downstream consumer) must:
 *  - parse valid JSON strings back to objects/arrays,
 *  - unwrap the double-encoded edge case,
 *  - leave legacy object/array shapes untouched (prompt-only fallback path),
 *  - leave absent fields absent,
 *  - DROP malformed / wrong-shape values so downstream degrades to exactly
 *    the canonical-empty defaults it already applies when the LLM omits the
 *    field (Stage 5 canonical-empty coaching; causal_claims/topology_plan
 *    omitted) — enforcement never worse than the status-quo prompt-only path.
 */

import { describe, it, expect, vi } from "vitest";
import {
  normaliseDraftResponse,
  parseStringifiedAuxFields,
} from "../../src/adapters/llm/normalisation.js";

// Suppress noisy logs; capture warns for the drop-path assertions.
const warnSpy = vi.fn();
vi.mock("../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

const VALID_COACHING = {
  summary: "Key tension between cost and speed.",
  strengthen_items: [
    {
      id: "si_1",
      label: "Add exit option",
      detail: "Consider a structurally different exit path.",
      action_type: "add_option",
    },
  ],
  widening_log: {
    elements_added: [],
    elements_considered_but_excluded: [],
    brief_completeness: "partial",
  },
  bias_signals: [],
};

const VALID_CLAIMS = [
  { type: "direct_effect", from: "fac_price", to: "out_revenue", stated_strength: "strong" },
  { type: "unmeasured_confounder", between: ["fac_a", "fac_b"] },
];

const VALID_PLAN = ["goal: out_revenue", "options: opt_a, opt_b"];

function baseDraft(aux: Record<string, unknown>): Record<string, unknown> {
  return { nodes: [], edges: [], ...aux };
}

describe("parseStringifiedAuxFields — table-driven", () => {
  interface Case {
    name: string;
    input: Record<string, unknown>;
    expected: Record<string, unknown>; // expected final values per key
    droppedKeys?: string[]; // keys expected to be deleted
  }

  const cases: Case[] = [
    {
      name: "valid JSON strings for all three aux fields are parsed",
      input: {
        coaching: JSON.stringify(VALID_COACHING),
        causal_claims: JSON.stringify(VALID_CLAIMS),
        topology_plan: JSON.stringify(VALID_PLAN),
      },
      expected: {
        coaching: VALID_COACHING,
        causal_claims: VALID_CLAIMS,
        topology_plan: VALID_PLAN,
      },
    },
    {
      name: "legacy object/array shapes (prompt-only fallback path) pass through untouched",
      input: {
        coaching: VALID_COACHING,
        causal_claims: VALID_CLAIMS,
        topology_plan: VALID_PLAN,
      },
      expected: {
        coaching: VALID_COACHING,
        causal_claims: VALID_CLAIMS,
        topology_plan: VALID_PLAN,
      },
    },
    {
      name: "absent aux fields stay absent",
      input: {},
      expected: {},
      droppedKeys: ["coaching", "causal_claims", "topology_plan"],
    },
    {
      name: "double-encoded strings are unwrapped exactly once more",
      input: {
        coaching: JSON.stringify(JSON.stringify(VALID_COACHING)),
        causal_claims: JSON.stringify(JSON.stringify(VALID_CLAIMS)),
        topology_plan: JSON.stringify(JSON.stringify(VALID_PLAN)),
      },
      expected: {
        coaching: VALID_COACHING,
        causal_claims: VALID_CLAIMS,
        topology_plan: VALID_PLAN,
      },
    },
    {
      name: "malformed JSON strings are dropped (canonical-empty defaults downstream)",
      input: {
        coaching: '{"summary": "truncated mid-way',
        causal_claims: "[{ type: direct_effect }]", // unquoted keys — invalid JSON
        topology_plan: "not json at all",
      },
      expected: {},
      droppedKeys: ["coaching", "causal_claims", "topology_plan"],
    },
    {
      name: "valid JSON of the WRONG shape is dropped",
      input: {
        coaching: JSON.stringify(["array", "not", "object"]),
        causal_claims: JSON.stringify({ not: "an array" }),
        topology_plan: JSON.stringify("a bare string, double-encoded to a string"),
      },
      expected: {},
      droppedKeys: ["coaching", "causal_claims", "topology_plan"],
    },
    {
      name: "JSON null / number payloads are dropped",
      input: {
        coaching: "null",
        causal_claims: "42",
        topology_plan: "true",
      },
      expected: {},
      droppedKeys: ["coaching", "causal_claims", "topology_plan"],
    },
    {
      name: "empty aux content parses to empty structures (not dropped)",
      input: {
        coaching: "{}",
        causal_claims: "[]",
        topology_plan: "[]",
      },
      expected: {
        coaching: {},
        causal_claims: [],
        topology_plan: [],
      },
    },
    {
      name: "mixed: one valid, one malformed, one absent — independent handling",
      input: {
        coaching: JSON.stringify(VALID_COACHING),
        causal_claims: "{broken",
      },
      expected: { coaching: VALID_COACHING },
      droppedKeys: ["causal_claims", "topology_plan"],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const obj = baseDraft(c.input);
      parseStringifiedAuxFields(obj);
      for (const [key, value] of Object.entries(c.expected)) {
        expect(obj[key], `field "${key}"`).toEqual(value);
      }
      for (const key of c.droppedKeys ?? []) {
        expect(key in obj, `field "${key}" should be absent`).toBe(false);
      }
    });
  }

  it("non-aux string fields are never touched", () => {
    const obj = baseDraft({ rationales: '["not an aux field"]' });
    parseStringifiedAuxFields(obj);
    expect(obj.rationales).toBe('["not an aux field"]');
  });
});

describe("normaliseDraftResponse — v8 aux fields integrate with the existing pipeline", () => {
  it("parses stringified aux fields before the coaching sentinel coercion", () => {
    // strengthen_items with "" sentinels — the coercion at the bottom of
    // normaliseDraftResponse must see the PARSED object, proving the aux
    // parse runs first.
    const coaching = {
      summary: "s",
      strengthen_items: [{ id: "si_1", label: "", detail: "", action_type: "add_risk" }],
    };
    const result = normaliseDraftResponse(
      baseDraft({ coaching: JSON.stringify(coaching) }),
    ) as Record<string, any>;
    expect(result.coaching.summary).toBe("s");
    expect(result.coaching.strengthen_items[0].label).toBeUndefined();
    expect(result.coaching.strengthen_items[0].detail).toBeUndefined();
  });

  it("drops a malformed coaching string so downstream sees an omitted field", () => {
    const result = normaliseDraftResponse(
      baseDraft({ coaching: "{oops", causal_claims: JSON.stringify(VALID_CLAIMS) }),
    ) as Record<string, unknown>;
    expect("coaching" in result).toBe(false);
    expect(result.causal_claims).toEqual(VALID_CLAIMS);
  });

  it("prompt-only object shapes still flow through unchanged (regression)", () => {
    const result = normaliseDraftResponse(
      baseDraft({
        coaching: VALID_COACHING,
        causal_claims: VALID_CLAIMS,
        topology_plan: VALID_PLAN,
      }),
    ) as Record<string, unknown>;
    expect(result.coaching).toEqual(VALID_COACHING);
    expect(result.causal_claims).toEqual(VALID_CLAIMS);
    expect(result.topology_plan).toEqual(VALID_PLAN);
  });
});
