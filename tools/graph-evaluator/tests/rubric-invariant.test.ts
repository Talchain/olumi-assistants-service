/**
 * RUBRIC INVARIANT (ROADMAP 2.285a)
 *
 * The draft-graph rubric scores ONLY fields the model is PERMITTED to emit.
 *
 * Rubric 1 broke this: it rewarded `goal_threshold` and preferred
 * `goal_threshold_unit`, which PR #789 made unwritable by the model (grammar
 * cut + ingress strip). The result was a sub-dimension unearnable on every
 * numeric-target brief, and a pipeline-vs-raw benchmark biased toward whichever
 * arm had been through the enricher.
 *
 * ⚠ THIS GUARD IS DERIVED, NOT MIRRORED. The forbidden-field list is READ AT
 * RUN TIME from CEE's own source of truth — `CEE_MINTED_GOAL_FIELDS` in
 * src/adapters/llm/normalisation.ts, the list the ingress strip actually
 * applies. A hand-copied list here would be exactly the drift-prone mirror this
 * estate keeps getting caught by; if CEE adds a field, this test picks it up on
 * the next run, and if it cannot find the list it FAILS LOUD rather than
 * passing vacuously.
 *
 * The assertion is BEHAVIOURAL, not textual: for every forbidden field, a graph
 * carrying it must score identically to one without it. That proves the field
 * cannot influence the score — a stronger claim than "the identifier does not
 * appear in scorer.ts", and immune to the field being named in a comment
 * (scorer.ts names all of them, deliberately, to explain why they are ignored).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { score } from "../src/scorer.js";
import type { ParsedGraph, GraphNode, GraphEdge, LLMResponse, Brief } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// =============================================================================
// Derivation from CEE's source of truth — FAIL LOUD, never assume-good
// =============================================================================

/** Read a `export const NAME = [ 'a', 'b' ] as const;` string array from a CEE source file. */
function deriveStringArrayConst(relPath: string, constName: string): string[] {
  const abs = path.join(REPO_ROOT, relPath);
  let source: string;
  try {
    source = readFileSync(abs, "utf-8");
  } catch (err) {
    throw new Error(
      `[rubric-invariant] CANNOT DERIVE: unable to read ${abs}. This guard reads ` +
      `CEE's forbidden-field list at run time so it cannot go stale. Do not replace ` +
      `it with a hand-written list — fix the path. (${String(err)})`
    );
  }

  const anchor = new RegExp(
    String.raw`export const ${constName}\s*=\s*\[([\s\S]*?)\]\s*as const;`
  );
  const match = anchor.exec(source);
  if (!match) {
    throw new Error(
      `[rubric-invariant] ANCHOR MISSING: could not find \`export const ${constName} = [...] as const;\` ` +
      `in ${relPath}. The constant was renamed, moved, or reshaped. This guard must be ` +
      `re-pointed at the new source of truth — it must NOT be softened into a skip, and ` +
      `it must NOT be replaced by a copy of the list.`
    );
  }

  const keys = [...match[1]!.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!);
  if (keys.length === 0) {
    throw new Error(
      `[rubric-invariant] EMPTY DERIVATION: ${constName} in ${relPath} parsed to zero keys. ` +
      `An empty forbidden list would make every assertion below vacuous.`
    );
  }
  return keys;
}

/** Every goal field the ingress strip removes — i.e. every field no model may author. */
const FORBIDDEN_GOAL_FIELDS = deriveStringArrayConst(
  "src/adapters/llm/normalisation.ts",
  "CEE_MINTED_GOAL_FIELDS"
);

/** The narrower list PR #789 cut from the sent grammar. */
const GRAMMAR_CUT_GOAL_KEYS = deriveStringArrayConst(
  "src/cee/draft/anthropic-graph-schema.ts",
  "ENRICHER_OWNED_GOAL_KEYS"
);

/**
 * Plausible values, so each mutation below is capable of moving a score.
 * Coverage of the DERIVED list is asserted — a new CEE field with no sample
 * value here REDs rather than being silently untested.
 */
const SAMPLE_VALUES: Record<string, unknown> = {
  goal_threshold: 0.5,
  goal_threshold_raw: 20000,
  goal_threshold_unit: "£",
  goal_threshold_cap: 40000,
  goal_threshold_frame: "cee_v1",
  goal_baseline: 0.3,
  goal_baseline_raw: 12000,
};

// =============================================================================
// Fixture — built so that EVERY forbidden field could plausibly move a score
// =============================================================================

function makeEdge(from: string, to: string, mean: number, std: number, p: number): GraphEdge {
  return {
    from,
    to,
    strength: { mean, std },
    exists_probability: p,
    effect_direction: mean >= 0 ? "positive" : "negative",
    edge_type: "directed",
  };
}

/** A structurally valid, post-#789-shaped draft: no goal_threshold* anywhere. */
function postCutDraft(): ParsedGraph {
  const nodes: GraphNode[] = [
    { id: "dec1", kind: "decision", label: "dec1" },
    { id: "opt_a", kind: "option", label: "opt_a", data: { interventions: { fac_ctrl: 0.8 } } },
    { id: "opt_b", kind: "option", label: "opt_b", data: { interventions: { fac_ctrl: 0.2 } } },
    { id: "opt_sq", kind: "option", label: "Status Quo", data: { interventions: { fac_ctrl: 0.5 } } },
    { id: "fac_ctrl", kind: "factor", label: "fac_ctrl", category: "controllable", data: { value: 0.5 } },
    {
      id: "fac_ext",
      kind: "factor",
      label: "fac_ext",
      category: "external",
      prior: { distribution: "uniform", range_min: 0, range_max: 1 },
    },
    { id: "out1", kind: "outcome", label: "out1" },
    { id: "goal1", kind: "goal", label: "goal1" },
  ];

  return {
    nodes,
    edges: [
      makeEdge("dec1", "opt_a", 1.0, 0.01, 1.0),
      makeEdge("dec1", "opt_b", 1.0, 0.01, 1.0),
      makeEdge("dec1", "opt_sq", 1.0, 0.01, 1.0),
      makeEdge("opt_a", "fac_ctrl", 1.0, 0.01, 1.0),
      makeEdge("opt_b", "fac_ctrl", 1.0, 0.01, 1.0),
      makeEdge("opt_sq", "fac_ctrl", 1.0, 0.01, 1.0),
      makeEdge("fac_ctrl", "out1", 0.6, 0.12, 0.9),
      makeEdge("fac_ext", "out1", -0.3, 0.2, 0.75),
      makeEdge("out1", "goal1", 0.7, 0.1, 0.95),
    ],
    coaching: { summary: "Test graph.", strengthen_items: [{ id: "str_1", label: "Add constraint" }] },
  };
}

function makeResponse(graph: ParsedGraph): LLMResponse {
  return { model_id: "test-model", brief_id: "test-brief", status: "success", parsed_graph: graph, latency_ms: 1 };
}

/**
 * A brief engineered so every rubric term that ever consulted the quad is LIVE:
 * numeric target required (completeness 0.20), currency present in the body
 * (currency 0.10), and a ratio metric keyed to the goal node (ratio_encoding,
 * 5% of overall) whose expected_min a 0.5 threshold would violate.
 */
function hostileBrief(): Brief {
  return {
    id: "test-brief",
    meta: {
      expect_status_quo: true,
      has_numeric_target: true,
      complexity: "moderate",
      ratio_metrics: [{ keyword: "goal1", expected_min: 1.0 }],
    },
    body: "Reach £20k MRR within 12 months while keeping monthly churn under 4%.",
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("rubric invariant — the rubric scores only model-permitted fields", () => {
  it("derives a non-empty forbidden-field list from CEE's ingress strip", () => {
    expect(FORBIDDEN_GOAL_FIELDS.length).toBeGreaterThan(0);
    // Sanity: the strip list must cover the grammar cut list. If these diverge,
    // one of the two protections has a hole and this guard is measuring the
    // wrong set.
    for (const key of GRAMMAR_CUT_GOAL_KEYS) {
      expect(FORBIDDEN_GOAL_FIELDS).toContain(key);
    }
  });

  it("has a sample value for every derived forbidden field (fails loud on a new CEE field)", () => {
    const missing = FORBIDDEN_GOAL_FIELDS.filter((k) => !(k in SAMPLE_VALUES));
    expect(
      missing,
      `CEE added goal field(s) ${missing.join(", ")} to CEE_MINTED_GOAL_FIELDS. Add a ` +
      `sample value to SAMPLE_VALUES so the invariant below actually exercises them — ` +
      `an untested field is how the previous rubric drifted.`
    ).toEqual([]);
  });

  it.each(FORBIDDEN_GOAL_FIELDS)(
    "a graph carrying `%s` scores identically to one without it",
    (field) => {
      const baseline = score(makeResponse(postCutDraft()), hostileBrief());

      const mutated = postCutDraft();
      const goalNode = mutated.nodes.find((n) => n.kind === "goal")!;
      (goalNode as unknown as Record<string, unknown>)[field] = SAMPLE_VALUES[field];

      const withForbiddenField = score(makeResponse(mutated), hostileBrief());

      expect(
        withForbiddenField,
        `Setting \`${field}\` — a field the model is FORBIDDEN to author (stripped at ` +
        `ingress by CEE_MINTED_GOAL_FIELDS) — changed the score. The rubric is measuring ` +
        `enricher output, not draft quality.`
      ).toEqual(baseline);
    }
  );

  it("POSITIVE CONTROL: the fixture is sensitive enough for the assertion to mean something", () => {
    // If the hostile brief could not move a score at all, every assertion above
    // would pass by testing nothing (trap 13). Prove the same fixture DOES
    // respond to model-permitted equivalents of the forbidden fields.
    const baseline = score(makeResponse(postCutDraft()), hostileBrief());

    // Permitted equivalent of goal_threshold: a constraint on the goal node.
    const withTarget = postCutDraft();
    withTarget.goal_constraints = [
      { constraint_id: "c1", node_id: "goal1", operator: ">=", value: 20000, label: "MRR >= 20000" },
    ];
    expect(score(makeResponse(withTarget), hostileBrief()).completeness).toBeGreaterThan(
      baseline.completeness!
    );

    // Permitted equivalent of goal_threshold_unit: the goal node's data.unit.
    const withUnit = postCutDraft();
    withUnit.nodes.find((n) => n.kind === "goal")!.data = { unit: "£" };
    expect(score(makeResponse(withUnit), hostileBrief()).completeness).toBeGreaterThan(
      baseline.completeness!
    );
  });
});
