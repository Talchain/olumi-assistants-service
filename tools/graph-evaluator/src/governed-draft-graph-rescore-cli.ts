import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  GOVERNED_PACK_ROOT,
  assertLegacyRubricIdentity,
  buildGovernedRunIdentity,
  scoreGovernedRun,
  summariseGovernedScores,
  verifyGovernedPack,
  type GovernedRun,
} from "./governed-draft-graph.js";

const RESULT_PATH = join(
  GOVERNED_PACK_ROOT,
  "baseline",
  "run-b9389df-claude-sonnet-4-6.json",
);

interface BaselineArtifact {
  readonly schema_version: "olumi.draft_graph.governed_baseline_artifact.v1";
  readonly generated_at: string;
  readonly baseline_status: string;
  readonly candidate_status: string;
  readonly run: GovernedRun;
  readonly execution: Readonly<Record<string, unknown>>;
  readonly serving_equivalence: Readonly<Record<string, unknown>>;
  readonly hold_reasons: readonly string[];
  readonly [key: string]: unknown;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const fraction = position - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * fraction;
}

async function main(): Promise<void> {
  if (process.argv.length !== 2) {
    throw new Error("rescore takes no arguments and never calls a provider");
  }
  const verification = await verifyGovernedPack();
  assertLegacyRubricIdentity(verification.manifest);
  if (!verification.ok) {
    throw new Error(
      `governed pack is not exact: ${verification.problems.map((item) => item.code).join(", ")}`,
    );
  }
  const existing = JSON.parse(await readFile(RESULT_PATH, "utf8")) as BaselineArtifact;
  if (
    existing.schema_version !== "olumi.draft_graph.governed_baseline_artifact.v1" ||
    existing.run.arm !== "baseline" ||
    existing.run.cases.length !== verification.manifest.corpus.cardinality
  ) {
    throw new Error("baseline artifact identity or cardinality is invalid");
  }
  const identity = buildGovernedRunIdentity(verification.manifest);
  if (
    existing.run.identity.serving_base_sha !== identity.serving_base_sha ||
    existing.run.identity.prompt_sha256 !== identity.prompt_sha256 ||
    existing.run.identity.model_id !== identity.model_id
  ) {
    throw new Error("baseline artifact does not match the governed run identity");
  }

  const run = await scoreGovernedRun(
    "baseline",
    identity,
    existing.run.cases,
    verification.manifest,
  );
  const summary = summariseGovernedScores(run.scores);
  const caseFailures: Record<string, number> = {};
  const canonicalBlockers: Record<string, number> = {};
  const legacyTopologyViolations: Record<string, number> = {};
  for (const score of run.scores) {
    for (const code of score.failures) increment(caseFailures, code);
    for (const code of score.canonical_blocking_codes) increment(canonicalBlockers, code);
    for (const code of score.legacy.violation_codes) {
      increment(legacyTopologyViolations, code);
    }
  }
  const latencies = run.cases
    .map((capture) => capture.latency_ms)
    .filter((value): value is number => typeof value === "number");
  const servingEquivalence = Object.fromEntries(
    Object.entries(existing.serving_equivalence).filter(
      ([key]) => key !== "request_bytes_and_model",
    ),
  );
  const updated = {
    ...existing,
    rescored_at: new Date().toISOString(),
    candidate_status: "HOLD_WITH_EVIDENCE",
    run,
    summary,
    failure_taxonomy_summary: {
      case_failures: caseFailures,
      canonical_blockers: canonicalBlockers,
      legacy_topology_violations: legacyTopologyViolations,
      legacy_rubric_coverage: {
        scored_cases: summary.legacy_scored_count,
        total_cases: run.scores.length,
        promotable_mean_available: summary.mean_legacy_score !== null,
      },
    },
    execution: {
      ...existing.execution,
      successful_primary_calls: summary.adapter_success_count,
      latency_min_ms: latencies.length > 0 ? Math.min(...latencies) : null,
      latency_p50_ms: percentile(latencies, 0.5),
      latency_p95_ms: percentile(latencies, 0.95),
      latency_max_ms: latencies.length > 0 ? Math.max(...latencies) : null,
    },
    serving_equivalence: {
      ...servingEquivalence,
      first_primary_prompt_composition_and_model:
        "exact_under_pinned_direct_adapter_configuration",
      scope_limit: "not_whole_route_or_request_bytes",
    },
    quality_interpretation: [
      `${summary.adapter_success_count}/14 exact-identity calls passed the production records adapter and ${summary.structured_outputs_count}/14 attested structured outputs.`,
      `${summary.canonical_ready_count}/14 projected graphs passed canonical analysis readiness; ${summary.canonical_blocking_issue_count} blocking findings remain.`,
      `The retired raw-graph rubric produced a numeric score for ${summary.legacy_scored_count}/14 cases, so it cannot provide a promotion mean for this records-contract baseline.`,
      `${summary.unbased_inference_count} AI-inferred elements lack an evidence basis despite complete provenance-class coverage.`,
      `${summary.record_disclosure_count} projector disclosures were generated and all are lost by the live AnthropicAdapter field projection.`,
    ],
    product_implications: [
      "Draft generation is available, but most captured models are not safe to analyse without repair or user mapping; downstream scientific capability is therefore often unreachable.",
      "The only canonically ready case was the forced-binary brief, indicating a serious risk that narrow framing is easier to operationalise than richer strategic work.",
      "Invisible projector refusals prevent users from seeing what Olumi declined to assert, weakening trust and making apparently complete graphs scientifically misleading.",
      "The exact serving SHA has both a user-visible graph-contract failure and a success on rerun, so reliability remains stochastic even though this bounded corpus pass returned 14 adapter successes.",
    ],
  };
  const temporaryPath = `${RESULT_PATH}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, RESULT_PATH);
  process.stdout.write(
    `rescored baseline: records=${summary.adapter_success_count}/14, readiness=${summary.canonical_ready_count}/14, legacy=${summary.legacy_scored_count}/14\n`,
  );
}

await main();
