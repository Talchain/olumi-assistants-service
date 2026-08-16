import { describe, expect, it } from "vitest";

import {
  compareGovernedRuns,
  buildGovernedRunIdentity,
  loadGovernedBriefs,
  readGovernedManifest,
  scoreGovernedCase,
  verifyGovernedPack,
  type GovernedCaseScore,
  type GovernedDraftManifest,
  type GovernedRun,
  type GovernedRunIdentity,
} from "../src/governed-draft-graph.js";
import type { ScoreResult } from "../src/types.js";

describe("governed draft_graph V5 pack", () => {
  it("pins the exact serving prompt composition and canonical 14 in order", async () => {
    const result = await verifyGovernedPack();

    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.prompt_sha256).toBe(
      "152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f",
    );
    expect(result.prompt_bytes).toBe(59_637);
    expect(result.prompt_characters).toBe(59_293);
    expect(result.brief_ids).toHaveLength(14);
    expect(result.brief_ids[0]).toBe("01-simple-binary");
    expect(result.brief_ids[13]).toBe("14-qualitative-strategy");
    expect(result.layer_content_hashes).toEqual({
      draft_records_instruction:
        "37f271b2377bc1f8a84c8b822af1a626aea22832ca767cfa8f897076f8c69af8",
      draft_records_grammar:
        "e6c508e0285a95c6d5dd84bfacc91921871d9c3bb7b7d3e55f8514ba6d8010a7",
      draft_compliance_reminder:
        "3ca1ca9c4c6460344f197876c82f3247251952522e1fe43dc4d7c457cb9bb898",
    });
  }, 40_000);

  it("loads only the manifest's canonical cases, excluding ad-hoc staging briefs", async () => {
    const manifest = await readGovernedManifest();
    const briefs = await loadGovernedBriefs(manifest);

    expect(briefs.map((brief) => brief.id)).toEqual(
      manifest.corpus.order.map((item) => item.id),
    );
    expect(briefs.map((brief) => brief.id)).not.toContain("hiring-staging");
    expect(briefs.map((brief) => brief.id)).not.toContain("pricing-staging");
  });

  it("executes the production canonical-readiness authority and provenance rubric", async () => {
    const manifest = await readGovernedManifest();
    const [brief] = await loadGovernedBriefs(manifest);
    const provenance = {
      provenance_class: "ai_inferred",
      source: "hypothesis",
      quote: "Model-inferred causal link (records projector)",
      basis: ["stated_0"],
      unbased: false,
    };
    const structural = {
      provenance_class: "projector_structural",
      source: "synthetic",
      quote: "Deterministic decision scaffold",
    };
    const stated = {
      provenance_class: "stated",
      source_quote: "Should we raise the price or keep it as is?",
    };
    const graph = {
      version: "1",
      nodes: [
        { id: "dec", kind: "decision", label: "Choose price", provenance: structural },
        {
          id: "raise",
          kind: "option",
          label: "Raise price",
          data: { interventions: { price: 0.8 } },
          provenance: stated,
        },
        {
          id: "keep",
          kind: "option",
          label: "Keep price (Status Quo)",
          data: { interventions: { price: 0.5 } },
          provenance: stated,
        },
        { id: "price", kind: "factor", label: "Subscription price", category: "controllable", provenance },
        { id: "revenue", kind: "outcome", label: "Recurring revenue", provenance },
        { id: "goal", kind: "goal", label: "Sustainable growth", provenance: stated },
      ],
      edges: [
        ["dec", "raise", 1, structural],
        ["dec", "keep", 1, structural],
        ["raise", "price", 0.8, provenance],
        ["keep", "price", 0.5, provenance],
        ["price", "revenue", 0.6, provenance],
        ["revenue", "goal", 0.7, provenance],
      ].map(([from, to, mean, edgeProvenance]) => ({
        from,
        to,
        strength_mean: mean,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        provenance: edgeProvenance,
      })),
    };

    const result = await scoreGovernedCase(
      {
        brief_id: brief!.id,
        status: "success",
        model_id: manifest.model.model_id,
        prompt_sha256: manifest.prompt.sha256,
        structured_outputs_used: true,
        graph,
        record_disclosures: [],
      },
      brief!,
    );

    expect(result.adapter_success).toBe(true);
    expect(result.structured_outputs_attested).toBe(true);
    expect(result.structural_valid).toBe(true);
    expect(result.canonical_ready).toBe(true);
    expect(result.canonical_blocking_issue_count).toBe(0);
    expect(result.provenance.missing_count).toBe(0);
    expect(result.provenance.unbased_inference_count).toBe(0);
  });

  it("does not confuse the retired topology validator with production records structure", async () => {
    const manifest = await readGovernedManifest();
    const [brief] = await loadGovernedBriefs(manifest);
    const stated = { provenance_class: "stated", source_quote: "brief" };
    const inferred = {
      provenance_class: "ai_inferred",
      source: "hypothesis",
      quote: "inferred",
      basis: ["stated_0"],
      unbased: false,
    };
    const structural = {
      provenance_class: "projector_structural",
      source: "synthetic",
      quote: "scaffold",
    };
    const graph = {
      version: "1",
      nodes: [
        { id: "dec", kind: "decision", label: "Choose", provenance: structural },
        { id: "a", kind: "option", label: "Act", data: { interventions: { lever: 1 } }, provenance: stated },
        { id: "b", kind: "option", label: "Status Quo", data: { interventions: { lever: 0 } }, provenance: stated },
        { id: "lever", kind: "factor", label: "Lever", category: "controllable", provenance: inferred },
        { id: "goal", kind: "goal", label: "Goal", provenance: stated },
      ],
      edges: [
        ["dec", "a", structural],
        ["dec", "b", structural],
        ["a", "lever", inferred],
        ["b", "lever", inferred],
        // Current production allows the factor-to-goal form; the retired raw
        // topology validator labels it FORBIDDEN_EDGE.
        ["lever", "goal", inferred],
      ].map(([from, to, provenance]) => ({
        from,
        to,
        strength_mean: 0.5,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        provenance,
      })),
    };

    const result = await scoreGovernedCase(
      {
        brief_id: brief!.id,
        status: "success",
        model_id: manifest.model.model_id,
        prompt_sha256: manifest.prompt.sha256,
        structured_outputs_used: true,
        graph,
        record_disclosures: [{ reason: "withheld" }],
        serving_record_disclosures_count: 0,
      },
      brief!,
    );

    expect(result.structural_valid).toBe(true);
    expect(result.legacy_structural_valid).toBe(false);
    expect(result.failures).not.toContain("STRUCTURAL_INVALID");
    expect(result.failures).toContain("RECORD_DISCLOSURE_UNSURFACED");
  });

  it("accepts a meaningful matched gain only when hard gates do not regress", async () => {
    const manifest = await readGovernedManifest();
    const identity = buildGovernedRunIdentity(manifest);
    const baseline = makeRun("baseline", identity, manifest, 0.60);
    const candidate = makeRun("candidate", { ...identity, prompt_sha256: "candidate" }, manifest, 0.64);

    const result = compareGovernedRuns(baseline, candidate, manifest);

    expect(result.verdict).toBe("PASS");
    expect(result.mean_legacy_delta).toBeCloseTo(0.04, 8);
    expect(result.wins).toBe(14);
  });

  it("rejects mean gain when canonical readiness or provenance regresses", async () => {
    const manifest = await readGovernedManifest();
    const identity = buildGovernedRunIdentity(manifest);
    const baseline = makeRun("baseline", identity, manifest, 0.60);
    const candidate = makeRun("candidate", { ...identity, prompt_sha256: "candidate" }, manifest, 0.66);
    const first = candidate.scores[0]!;
    const damaged: GovernedRun = {
      ...candidate,
      scores: [
        {
          ...first,
          canonical_ready: false,
          canonical_blocking_issue_count: 1,
          provenance: { ...first.provenance, missing_count: 1 },
        },
        ...candidate.scores.slice(1),
      ],
    };

    const result = compareGovernedRuns(baseline, damaged, manifest);

    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("READINESS_REGRESSION"),
        expect.stringContaining("PROVENANCE_REGRESSION"),
      ]),
    );
  });
});

function legacyScore(value: number): ScoreResult {
  return {
    rubric_version: "draft-graph-rubric-2.0.0",
    structural_valid: true,
    violation_codes: [],
    param_quality: value,
    option_diff: value,
    completeness: value,
    constraint_retention: value,
    ratio_encoding: value,
    external_factor_presence: value,
    coaching_quality: value,
    overall_score: value,
    node_count: 8,
    edge_count: 10,
  };
}

function makeScore(id: string, value: number): GovernedCaseScore {
  return {
    brief_id: id,
    adapter_success: true,
    structured_outputs_attested: true,
    structural_valid: true,
    legacy_structural_valid: true,
    legacy: legacyScore(value),
    canonical_ready: true,
    canonical_status: "ready",
    canonical_blocking_issue_count: 0,
    canonical_blocking_codes: [],
    provenance: {
      element_count: 18,
      missing_count: 0,
      stated_count: 4,
      inferred_count: 9,
      structural_count: 5,
      unbased_inference_count: 0,
      disclosure_count: 0,
      serving_disclosure_count: 0,
      unsurfaced_disclosure_count: 0,
    },
    failures: [],
  };
}

function makeRun(
  arm: GovernedRun["arm"],
  identity: GovernedRunIdentity,
  manifest: GovernedDraftManifest,
  value: number,
): GovernedRun {
  const ids = manifest.corpus.order.map((item) => item.id);
  return {
    schema_version: "olumi.draft_graph.governed_run.v1",
    arm,
    identity,
    cases: ids.map((id) => ({
      brief_id: id,
      status: "success" as const,
      model_id: manifest.model.model_id,
      prompt_sha256: identity.prompt_sha256,
      structured_outputs_used: true,
    })),
    scores: ids.map((id) => makeScore(id, value)),
  };
}
