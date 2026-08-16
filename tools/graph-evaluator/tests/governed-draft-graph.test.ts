import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GOVERNED_PACK_ROOT,
  compareGovernedRuns,
  buildGovernedRunIdentity,
  loadGovernedBriefs,
  readGovernedManifest,
  scoreGovernedCase,
  scoreGovernedRun,
  verifyGovernedPack,
  type GovernedCaseCapture,
  type GovernedDraftManifest,
  type GovernedRun,
  type GovernedRunIdentity,
} from "../src/governed-draft-graph.js";

const CANDIDATE_PROMPT_SHA256 = "a".repeat(64);

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
    expect(result.manifest.status).toBe("BASELINE_FROZEN");
    expect(result.manifest.candidate_status).toBe("HOLD_WITH_EVIDENCE");
    expect(result.manifest.governance.candidate_path).toBeNull();
    expect(result.manifest.governance.candidate_sha256).toBeNull();
    expect(result.manifest.baseline.equivalence_scope).toBe(
      "first_primary_prompt_composition_and_model_under_pinned_direct_adapter_configuration",
    );
    expect(result.manifest.baseline.equivalence_excludes).toBe(
      "whole_route_and_request_bytes",
    );
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
        serving_record_disclosures_count: 0,
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
    expect(result.failures).not.toContain("SERVING_DISCLOSURE_COUNT_INVALID");
  });

  it("fails closed when the served disclosure count is absent or invalid", async () => {
    const manifest = await readGovernedManifest();
    const [brief] = await loadGovernedBriefs(manifest);
    const base = {
      brief_id: brief!.id,
      status: "success" as const,
      model_id: manifest.model.model_id,
      prompt_sha256: manifest.prompt.sha256,
      structured_outputs_used: true,
      graph: { version: "1", nodes: [], edges: [] },
      record_disclosures: [{ reason: "withheld" }],
    };
    const invalidValues = [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5, 2];

    for (const invalidValue of invalidValues) {
      const capture = {
        ...base,
        serving_record_disclosures_count: invalidValue,
      } as unknown as GovernedCaseCapture;
      const result = await scoreGovernedCase(capture, brief!);

      expect(result.failures).toContain("SERVING_DISCLOSURE_COUNT_INVALID");
      expect(result.provenance.serving_disclosure_count).toBe(0);
      expect(result.provenance.unsurfaced_disclosure_count).toBe(1);
    }

    const surfaced = await scoreGovernedCase(
      { ...base, serving_record_disclosures_count: 1 },
      brief!,
    );
    expect(surfaced.failures).not.toContain("SERVING_DISCLOSURE_COUNT_INVALID");
    expect(surfaced.provenance.serving_disclosure_count).toBe(1);
    expect(surfaced.provenance.unsurfaced_disclosure_count).toBe(0);
  });

  it("rejects a forged PASS even when the rewritten baseline artifact is re-hashed", async () => {
    const verification = await verifyPackMutant(async (packRoot) => {
      const manifestPath = join(packRoot, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        candidate_status: string;
        baseline: { result_path: string; result_sha256: string };
        governance: { candidate_path: string | null; candidate_sha256: string | null };
      };
      const artifactPath = join(packRoot, manifest.baseline.result_path);
      const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
        candidate_status: string;
        readonly [key: string]: unknown;
      };
      artifact.candidate_status = "PASS";
      const artifactBytes = `${JSON.stringify(artifact, null, 2)}\n`;
      await writeFile(artifactPath, artifactBytes, "utf8");
      manifest.candidate_status = "PASS";
      manifest.governance.candidate_path = "candidate-without-a-hash.txt";
      manifest.governance.candidate_sha256 = null;
      manifest.baseline.result_sha256 = createHash("sha256")
        .update(artifactBytes)
        .digest("hex");
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    });

    expect(verification.ok).toBe(false);
    expect(verification.problems.map((item) => item.code)).toContain(
      "GOVERNANCE_STATUS_INVALID",
    );
    expect(verification.problems.map((item) => item.code)).toContain(
      "CANDIDATE_IDENTITY_INVALID",
    );
  }, 40_000);

  it("rejects re-hashed precomputed score and summary tampering by replaying captures", async () => {
    const verification = await verifyPackMutant(async (packRoot) => {
      const manifestPath = join(packRoot, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        baseline: { result_path: string; result_sha256: string };
      };
      const artifactPath = join(packRoot, manifest.baseline.result_path);
      const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
        run: { scores: Array<{ legacy: { overall_score: number | null } }> };
        summary: { mean_legacy_score_scored_cases: number | null };
      };
      artifact.run.scores[0]!.legacy.overall_score = 0.999;
      artifact.summary.mean_legacy_score_scored_cases = 0.999;
      const artifactBytes = `${JSON.stringify(artifact, null, 2)}\n`;
      await writeFile(artifactPath, artifactBytes, "utf8");
      manifest.baseline.result_sha256 = createHash("sha256")
        .update(artifactBytes)
        .digest("hex");
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    });

    expect(verification.ok).toBe(false);
    expect(verification.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "GOVERNANCE_ARTIFACT_DRIFT",
          detail: expect.stringContaining("precomputed scores"),
        }),
        expect.objectContaining({
          code: "GOVERNANCE_ARTIFACT_DRIFT",
          detail: expect.stringContaining("precomputed summary"),
        }),
      ]),
    );
  }, 40_000);

  it("holds a numerical-only guessed-edge gain scored from the actual captures", async () => {
    const manifest = withCandidatePrompt(await readGovernedManifest());
    const identity = buildGovernedRunIdentity(manifest);
    const baseline = await makeScoredRun("baseline", identity, manifest, () =>
      makeDiagnosticGraph());
    const candidate = await makeScoredRun(
      "candidate",
      makeCandidateIdentity(identity),
      manifest,
      () => makeDiagnosticGraph({ numericDiversity: true }),
    );

    expect(candidate.scores.every((score, index) =>
      (score.legacy.param_quality ?? 0) > (baseline.scores[index]!.legacy.param_quality ?? 0)
    )).toBe(true);
    const result = await compareGovernedRuns(baseline, candidate, manifest);

    expect(result.verdict).toBe("HOLD");
    expect(result.mean_legacy_delta).toBeGreaterThan(0.03);
    expect(result.wins).toBe(14);
    expect(result.reasons).toContain(
      "QUALITY_AUTHORITY_UNAVAILABLE: the retired legacy scorer is diagnostic-only and no grounding-sensitive positive-quality promotion authority is governed",
    );
  });

  it("holds a completeness-only legacy gain scored from the actual captures", async () => {
    const manifest = withCandidatePrompt(await readGovernedManifest());
    const identity = buildGovernedRunIdentity(manifest);
    const baseline = await makeScoredRun("baseline", identity, manifest, () =>
      makeDiagnosticGraph({ genericFactorLabel: true }));
    const candidate = await makeScoredRun(
      "candidate",
      makeCandidateIdentity(identity),
      manifest,
      () => makeDiagnosticGraph(),
    );

    for (let index = 0; index < baseline.scores.length; index += 1) {
      const before = baseline.scores[index]!.legacy;
      const after = candidate.scores[index]!.legacy;
      expect(after.completeness).toBeGreaterThan(before.completeness ?? 0);
      expect(after.param_quality).toBe(before.param_quality);
      expect(after.option_diff).toBe(before.option_diff);
      expect(after.constraint_retention).toBe(before.constraint_retention);
      expect(after.external_factor_presence).toBe(before.external_factor_presence);
      expect(after.coaching_quality).toBe(before.coaching_quality);
      expect(after.ratio_encoding).toBe(before.ratio_encoding);
    }
    const result = await compareGovernedRuns(baseline, candidate, manifest);

    expect(result.verdict).toBe("HOLD");
    expect(result.mean_legacy_delta).toBeCloseTo(0.04, 8);
    expect(result.wins).toBe(14);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("QUALITY_AUTHORITY_UNAVAILABLE")]),
    );
  });

  it("rejects mean gain when canonical readiness or provenance regresses", async () => {
    const manifest = withCandidatePrompt(await readGovernedManifest());
    const identity = buildGovernedRunIdentity(manifest);
    const baseline = await makeScoredRun("baseline", identity, manifest, () =>
      makeDiagnosticGraph());
    const candidateIdentity = makeCandidateIdentity(identity);
    const damaged = await makeScoredRun(
      "candidate",
      candidateIdentity,
      manifest,
      (index) => index === 0
        ? makeDiagnosticGraph({ removeGoal: true, omitFactorProvenance: true })
        : makeDiagnosticGraph({ numericDiversity: true }),
    );

    const result = await compareGovernedRuns(baseline, damaged, manifest);

    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("READINESS_REGRESSION"),
        expect.stringContaining("PROVENANCE_REGRESSION"),
        expect.stringContaining("QUALITY_AUTHORITY_UNAVAILABLE"),
      ]),
    );
  });

  it("holds an otherwise promotable candidate when any disclosure remains unsurfaced", async () => {
    const manifest = withCandidatePrompt(await readGovernedManifest());
    const identity = buildGovernedRunIdentity(manifest);
    const baseline = await makeScoredRun("baseline", identity, manifest, () =>
      makeDiagnosticGraph());
    const hidden = await makeScoredRun(
      "candidate",
      makeCandidateIdentity(identity),
      manifest,
      () => makeDiagnosticGraph(),
      { recordDisclosures: [{ reason: "withheld" }], servedDisclosureCount: 0 },
    );

    const result = await compareGovernedRuns(baseline, hidden, manifest);

    expect(result.verdict).toBe("HOLD");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("DISCLOSURE_EVIDENCE_HOLD")]),
    );
  });

  it("holds a candidate that reuses the baseline prompt identity", async () => {
    const manifest = withCandidatePrompt(await readGovernedManifest());
    const identity = buildGovernedRunIdentity(manifest);
    const baseline = await makeScoredRun("baseline", identity, manifest, () =>
      makeDiagnosticGraph());
    const candidate = await makeScoredRun("candidate", identity, manifest, () =>
      makeDiagnosticGraph({ numericDiversity: true }));

    const result = await compareGovernedRuns(baseline, candidate, manifest);

    expect(result.verdict).toBe("HOLD");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("CANDIDATE_IDENTITY_INVALID")]),
    );
  });

  it("holds incomplete legacy quality evidence instead of calling it a quality failure", async () => {
    const manifest = withCandidatePrompt(await readGovernedManifest());
    const identity = buildGovernedRunIdentity(manifest);
    const candidateIdentity = makeCandidateIdentity(identity);
    const baseline = await makeScoredRun(
      "baseline",
      identity,
      manifest,
      (index) => index === 0 ? undefined : makeDiagnosticGraph(),
      { failedFirstCase: true },
    );
    const incomplete = await makeScoredRun(
      "candidate",
      candidateIdentity,
      manifest,
      (index) => index === 0 ? undefined : makeDiagnosticGraph({ numericDiversity: true }),
      { failedFirstCase: true },
    );

    const result = await compareGovernedRuns(baseline, incomplete, manifest);

    expect(result.verdict).toBe("HOLD");
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("QUALITY_EVIDENCE_INCOMPLETE")]),
    );
    expect(result.reasons.some((reason) =>
      reason.startsWith("QUALITY_GAIN_BELOW_THRESHOLD")
    )).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("QUALITY_AUTHORITY_UNAVAILABLE")]),
    );
  });

  it("rejects supplied comparison scores and uses deterministic capture replay", async () => {
    const manifest = withCandidatePrompt(await readGovernedManifest());
    const identity = buildGovernedRunIdentity(manifest);
    const baseline = await makeScoredRun("baseline", identity, manifest, () =>
      makeDiagnosticGraph());
    const candidate = await makeScoredRun(
      "candidate",
      makeCandidateIdentity(identity),
      manifest,
      () => makeDiagnosticGraph(),
    );
    const forged: GovernedRun = {
      ...candidate,
      scores: candidate.scores.map((score) => ({
        ...score,
        legacy: { ...score.legacy, overall_score: 1 },
        canonical_ready: true,
        canonical_blocking_issue_count: 0,
      })),
    };

    const result = await compareGovernedRuns(baseline, forged, manifest);

    expect(result.verdict).toBe("HOLD");
    expect(result.mean_legacy_delta).toBeCloseTo(0, 8);
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("SCORE_EVIDENCE_MISMATCH")]),
    );
  });

  it("holds incomplete, reordered, or ID-drifted 14-case pairs", async () => {
    const manifest = withCandidatePrompt(await readGovernedManifest());
    const identity = buildGovernedRunIdentity(manifest);
    const baseline = await makeScoredRun("baseline", identity, manifest, () =>
      makeDiagnosticGraph());
    const candidate = await makeScoredRun(
      "candidate",
      makeCandidateIdentity(identity),
      manifest,
      () => makeDiagnosticGraph({ numericDiversity: true }),
    );
    const swappedCases = [...candidate.cases];
    const swappedScores = [...candidate.scores];
    [swappedCases[0], swappedCases[1]] = [swappedCases[1]!, swappedCases[0]!];
    [swappedScores[0], swappedScores[1]] = [swappedScores[1]!, swappedScores[0]!];
    const mutants: GovernedRun[] = [
      { ...candidate, cases: candidate.cases.slice(0, -1), scores: candidate.scores.slice(0, -1) },
      { ...candidate, cases: swappedCases, scores: swappedScores },
      {
        ...candidate,
        cases: candidate.cases.map((capture, index) => index === 0
          ? { ...capture, brief_id: "01-drifted" }
          : capture),
        scores: candidate.scores.map((score, index) => index === 0
          ? { ...score, brief_id: "01-drifted" }
          : score),
      },
    ];

    for (const mutant of mutants) {
      const result = await compareGovernedRuns(baseline, mutant, manifest);
      expect(result.verdict).toBe("HOLD");
      expect(result.reasons).toEqual(
        expect.arrayContaining([expect.stringContaining("PAIR_INCOMPLETE")]),
      );
    }
  });
});

function makeCandidateIdentity(identity: GovernedRunIdentity): GovernedRunIdentity {
  return {
    ...identity,
    prompt_version: "candidate",
    prompt_sha256: CANDIDATE_PROMPT_SHA256,
  };
}

function withCandidatePrompt(
  manifest: GovernedDraftManifest,
): GovernedDraftManifest {
  return {
    ...manifest,
    governance: {
      ...manifest.governance,
      candidate_path: "candidate/prompt.txt",
      candidate_sha256: CANDIDATE_PROMPT_SHA256,
    },
  };
}

interface DiagnosticGraphOptions {
  readonly numericDiversity?: boolean;
  readonly genericFactorLabel?: boolean;
  readonly removeGoal?: boolean;
  readonly omitFactorProvenance?: boolean;
}

function makeDiagnosticGraph(options: DiagnosticGraphOptions = {}): unknown {
  const stated = { provenance_class: "stated", source_quote: "governed test brief" };
  const inferred = {
    provenance_class: "ai_inferred",
    source: "hypothesis",
    quote: "governed test inference",
    basis: ["stated_0"],
    unbased: false,
  };
  const structural = {
    provenance_class: "projector_structural",
    source: "synthetic",
    quote: "deterministic decision scaffold",
  };
  const nodes: Array<Record<string, unknown>> = [
    { id: "decision", kind: "decision", label: "Choose an approach", provenance: structural },
    {
      id: "option_a",
      kind: "option",
      label: "Act now",
      data: { interventions: { lever: 0.8 } },
      provenance: stated,
    },
    {
      id: "option_b",
      kind: "option",
      label: "Keep the status quo",
      data: { interventions: { lever: 0.5 } },
      provenance: stated,
    },
    {
      id: "lever",
      kind: "factor",
      label: options.genericFactorLabel ? "Competition" : "Regional competitor response",
      category: "controllable",
      ...(!options.omitFactorProvenance ? { provenance: inferred } : {}),
    },
    {
      id: "external",
      kind: "factor",
      label: options.genericFactorLabel ? "Market risk" : "External market conditions",
      category: "external",
      provenance: inferred,
    },
    { id: "outcome", kind: "outcome", label: "Operating outcome", provenance: inferred },
    { id: "goal", kind: "goal", label: "Sustainable result", provenance: stated },
  ];
  const causalNumbers = options.numericDiversity
    ? [
        { mean: 0.2, std: 0.05, exists: 0.6 },
        { mean: 0.3, std: 0.1, exists: 0.8 },
        { mean: 0.4, std: 0.15, exists: 1 },
      ]
    : [
        { mean: 0.5, std: 0.125, exists: 1 },
        { mean: 0.5, std: 0.125, exists: 1 },
        { mean: 0.5, std: 0.125, exists: 1 },
      ];
  const edge = (
    from: string,
    to: string,
    mean: number,
    std: number,
    exists: number,
    provenance: Record<string, unknown>,
  ): Record<string, unknown> => ({
    from,
    to,
    strength_mean: mean,
    strength_std: std,
    belief_exists: exists,
    effect_direction: "positive",
    provenance,
  });
  const edges = [
    edge("decision", "option_a", 1, 0, 1, structural),
    edge("decision", "option_b", 1, 0, 1, structural),
    edge("option_a", "lever", 1, 0, 1, structural),
    edge("option_b", "lever", 1, 0, 1, structural),
    edge("lever", "outcome", causalNumbers[0]!.mean, causalNumbers[0]!.std, causalNumbers[0]!.exists, inferred),
    edge("external", "outcome", causalNumbers[1]!.mean, causalNumbers[1]!.std, causalNumbers[1]!.exists, inferred),
    edge("outcome", "goal", causalNumbers[2]!.mean, causalNumbers[2]!.std, causalNumbers[2]!.exists, inferred),
  ];

  return {
    version: "1",
    nodes: options.removeGoal ? nodes.filter((node) => node.id !== "goal") : nodes,
    edges: options.removeGoal ? edges.filter((item) => item.to !== "goal") : edges,
    goal_constraints: [],
  };
}

async function makeScoredRun(
  arm: GovernedRun["arm"],
  identity: GovernedRunIdentity,
  manifest: GovernedDraftManifest,
  graphForCase: (index: number, id: string) => unknown,
  options: {
    readonly recordDisclosures?: readonly unknown[];
    readonly servedDisclosureCount?: number;
    readonly failedFirstCase?: boolean;
  } = {},
): Promise<GovernedRun> {
  const ids = manifest.corpus.order.map((item) => item.id);
  const disclosures = options.recordDisclosures ?? [];
  const captures: GovernedCaseCapture[] = ids.map((id, index) => {
    const failed = options.failedFirstCase === true && index === 0;
    const graph = graphForCase(index, id);
    return {
      brief_id: id,
      status: failed ? "failed" as const : "success" as const,
      ...(failed ? { failure_code: "GOVERNED_TEST_FAILURE" } : {}),
      model_id: identity.model_id,
      prompt_sha256: identity.prompt_sha256,
      structured_outputs_used: true,
      ...(graph !== undefined ? { graph } : {}),
      record_disclosures: disclosures,
      serving_record_disclosures_count:
        options.servedDisclosureCount ?? disclosures.length,
    };
  });
  return scoreGovernedRun(arm, identity, captures, manifest);
}

async function verifyPackMutant(
  mutate: (packRoot: string) => Promise<void>,
): Promise<Awaited<ReturnType<typeof verifyGovernedPack>>> {
  const temporaryParent = await mkdtemp(join(tmpdir(), "governed-draft-graph-mutant-"));
  const packRoot = join(temporaryParent, "pack");
  try {
    await cp(GOVERNED_PACK_ROOT, packRoot, { recursive: true });
    await mutate(packRoot);
    return await verifyGovernedPack(packRoot);
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
}
