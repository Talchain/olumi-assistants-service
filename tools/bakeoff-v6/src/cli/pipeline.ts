/**
 * Pipeline: generation → validation → scoring → report.
 *
 * Order of operations implements equal-compute matching: arms C and D run
 * FIRST per (brief, seed); their realized USD spend becomes the per-brief
 * target for B@match_c and B@match_d. Arm A is independent. Every candidate
 * from every arm passes GraphV3 validation; invalid candidates are counted
 * per arm and never crash the run.
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODELS, DEFAULT_RUN_SEED } from "../config.ts";
import { loadGoldenBriefs } from "../fixtures/loader.ts";
import { AnthropicLlmClient, type LlmClient } from "../llm/client.ts";
import { MockLlmClient } from "../llm/mock-client.ts";
import { mockPreflight, runPreflight } from "../llm/preflight.ts";
import { PRICING_TABLE, pricingStaleness } from "../llm/pricing.ts";
import { anyPlaceholder, loadPromptSet, promptHashes, type PromptSet } from "../prompts/loader.ts";
import { runArmA } from "../arms/arm-a.ts";
import { runArmB } from "../arms/arm-b.ts";
import { runArmC } from "../arms/arm-c.ts";
import { runArmD } from "../arms/arm-d.ts";
import { emptyOutput, type ArmRunInput, type ArmRunner, type ArmRunOutput } from "../arms/types.ts";
import { validateCandidate } from "../validate/validator.ts";
import { assessComputeMatch, budgetTokensForTarget, type BVariant, type ComputeMatchEntry } from "../compute/match.ts";
import { RunStore, computeCanonicalHash } from "../store/output-store.ts";
import {
  buildBlindPayload,
  buildPresentationMap,
  forbiddenTokens,
  scanForLeaks,
} from "../scoring/blind.ts";
import { runSafetyCells } from "../scoring/safety-cells.ts";
import { SmokeStubVerdictProvider } from "../scoring/verdicts.ts";
import { scoreFinalGraph } from "../scoring/fgq/fgq.ts";
import { scoreHolisticDeterministic } from "../scoring/holistic/deterministic.ts";
import { scoreHolisticLlm } from "../scoring/holistic/llm.ts";
import { assessEvidence } from "../report/attestations.ts";
import { buildReport, type ScoreRow } from "../report/report.ts";
import type { ArmId, BriefFixture, CandidateRecord, PreflightResult, RunConfig } from "../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

export interface PipelineOptions {
  runId: string;
  mock: boolean;
  arms: ArmId[];
  briefFilter: string[] | null;
  seeds: number[];
  resultsDir: string;
  attestationsPath: string | null;
  runSeed: number;
  /** Wired-but-held LLM holistic layer; off by default even on live runs. */
  holisticLlm: boolean;
  preflightOnly: boolean;
  /** Named prompt-set directory under prompts/ (variant axis); null = default v0.4.3 baseline. */
  promptSet: string | null;
}

export interface PipelineSummary {
  runDir: string;
  reportPath: string | null;
  watermark: boolean;
  rows: number;
  invalid: number;
  blockedArms: Array<{ arm: string; reason: string }>;
}

interface StoredCandidate {
  record: CandidateRecord;
  variant: BVariant | null;
  brief: BriefFixture;
  output: ArmRunOutput;
}

function baseSha(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

async function runArmSafe(runner: ArmRunner, input: ArmRunInput): Promise<ArmRunOutput> {
  try {
    return await runner(input);
  } catch (err) {
    const out = emptyOutput();
    out.failure = { stage: "arm-crash", message: (err as Error).message };
    return out;
  }
}

function assembleRecord(
  config: RunConfig,
  prompts: PromptSet,
  arm: ArmId,
  brief: BriefFixture,
  seed: number,
  output: ArmRunOutput,
  startedAt: string,
  finishedAt: string
): CandidateRecord {
  const validation =
    output.candidate === null
      ? { valid: false, errors: ["no candidate produced"] }
      : validateCandidate(output.candidate);
  const record: CandidateRecord = {
    record_version: 1,
    run_id: config.run_id,
    arm,
    brief_id: brief.id,
    seed,
    prompt_hashes: promptHashes(prompts),
    prompt_placeholder: anyPlaceholder(prompts),
    requested_models: output.calls.map((c) => c.requested_model),
    served_models: output.calls.map((c) => c.served_model ?? "unknown"),
    calls: output.calls,
    cost_usd_total: output.calls.reduce((sum, c) => sum + c.cost_usd, 0),
    candidate: output.candidate,
    validation,
    arm_c: output.armC,
    arm_d: output.armD,
    artifacts: output.artifacts,
    failure: output.failure,
    timing: {
      started_at: startedAt,
      finished_at: finishedAt,
      total_latency_ms: output.calls.reduce((sum, c) => sum + c.latency_ms, 0),
    },
    canonical_hash: "",
  };
  record.canonical_hash = computeCanonicalHash(record);
  return record;
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineSummary> {
  const prompts = await loadPromptSet(opts.promptSet ?? undefined);
  const briefs = await loadGoldenBriefs(opts.briefFilter);
  const config: RunConfig = {
    run_id: opts.runId,
    arms: opts.arms,
    brief_ids: briefs.map((b) => b.id),
    seeds: opts.seeds,
    models: DEFAULT_MODELS,
    mock: opts.mock,
    results_dir: opts.resultsDir,
    compute_tolerance: 0.2,
  };

  const store = new RunStore(opts.resultsDir, opts.runId);
  const now = new Date();

  const preflight: PreflightResult = opts.mock ? mockPreflight(now) : await runPreflight(config.models, now);
  store.writeJson("preflight.json", preflight);

  if (opts.preflightOnly) {
    return {
      runDir: store.runDir,
      reportPath: null,
      watermark: true,
      rows: 0,
      invalid: 0,
      blockedArms: Object.entries(preflight.arm_gate)
        .filter(([, gate]) => !gate.allowed)
        .map(([arm, gate]) => ({ arm, reason: gate.reason })),
    };
  }

  const client: LlmClient = opts.mock ? new MockLlmClient() : new AnthropicLlmClient();
  const blockedArms = opts.arms
    .filter((arm) => !preflight.arm_gate[arm].allowed)
    .map((arm) => ({ arm, reason: preflight.arm_gate[arm].reason }));
  const liveArms = opts.arms.filter((arm) => preflight.arm_gate[arm].allowed);

  const stored: StoredCandidate[] = [];
  const matchEntries: ComputeMatchEntry[] = [];

  const runOne = async (
    arm: ArmId,
    runner: ArmRunner,
    brief: BriefFixture,
    seed: number,
    variant: BVariant | null,
    bTokenBudget?: number
  ): Promise<StoredCandidate> => {
    const startedAt = new Date().toISOString();
    const output = await runArmSafe(runner, {
      brief,
      seed,
      prompts,
      client,
      models: config.models,
      bTokenBudget,
    });
    const finishedAt = new Date().toISOString();
    const record = assembleRecord(config, prompts, arm, brief, seed, output, startedAt, finishedAt);
    store.writeCandidate(record, variant);
    const item: StoredCandidate = { record, variant, brief, output };
    stored.push(item);
    return item;
  };

  for (const brief of briefs) {
    for (const seed of opts.seeds) {
      // 1) partners first — their realized spend defines B's budgets
      const cRun = liveArms.includes("C") ? await runOne("C", runArmC, brief, seed, null) : null;
      const dRun = liveArms.includes("D") ? await runOne("D", runArmD, brief, seed, null) : null;
      if (liveArms.includes("A")) await runOne("A", runArmA, brief, seed, null);

      // 2) compute-matched B per comparison (B@C, B@D); unmatched if no partner
      if (liveArms.includes("B")) {
        const bModel = config.models.B.model;
        if (!cRun && !dRun) {
          await runOne("B", runArmB, brief, seed, "unmatched");
        }
        if (cRun) {
          const target = cRun.record.cost_usd_total;
          const budget = target > 0 ? budgetTokensForTarget(target, bModel) : undefined;
          const bC = await runOne("B", runArmB, brief, seed, "match_c", budget);
          matchEntries.push(
            assessComputeMatch("B_vs_C", brief.id, seed, target, bC.record.cost_usd_total, config.compute_tolerance)
          );
        }
        if (dRun) {
          const target = dRun.record.cost_usd_total;
          const budget = target > 0 ? budgetTokensForTarget(target, bModel) : undefined;
          const bD = await runOne("B", runArmB, brief, seed, "match_d", budget);
          matchEntries.push(
            assessComputeMatch("B_vs_D", brief.id, seed, target, bD.record.cost_usd_total, config.compute_tolerance)
          );
        }
      }
    }
  }

  // ---- Scoring (blind) ----
  const armLabel = (item: StoredCandidate) => (item.variant ? `${item.record.arm}@${item.variant}` : item.record.arm);
  const presentation = buildPresentationMap(
    stored.map((item) => ({ arm: armLabel(item), brief_id: item.record.brief_id, seed: item.record.seed })),
    opts.runSeed
  );
  store.writePresentationMap(presentation);
  const blindIdFor = new Map(presentation.map((e) => [`${e.arm}|${e.brief_id}|${e.seed}`, e.blind_id]));

  const forbidden = forbiddenTokens(
    config,
    Object.values(prompts).map((p) => p.name),
    Object.values(prompts).map((p) => p.hash)
  );
  const verdictProvider = new SmokeStubVerdictProvider();
  const rows: ScoreRow[] = [];
  // R is a HARD input: pending state derives from the INPUT fixtures, not
  // from whichever rows happened to get scored.
  let anyRPending = briefs.some((b) => !b.warrantedSet || b.warrantedSet.length === 0);

  for (const item of stored) {
    const label = armLabel(item);
    const blindId = blindIdFor.get(`${label}|${item.record.brief_id}|${item.record.seed}`) ?? "B???";
    const blind = buildBlindPayload(item.record, item.brief.brief, blindId);
    const leak = scanForLeaks(blind, forbidden);

    const row: ScoreRow = {
      arm_label: label,
      brief_id: item.record.brief_id,
      seed: item.record.seed,
      blind_id: blindId,
      valid: item.record.validation.valid,
      failure_stage: item.record.failure?.stage ?? null,
      scoring_refused: null,
      safety_hits: [],
      fgq: null,
      r_pending: false,
      holistic_det: null,
      holistic_llm: null,
      merge_failures: item.record.arm_c?.merge.failures.length ?? 0,
      merge_applied: item.record.arm_c?.merge.applied ?? 0,
      merge_proposals_total: item.record.arm_c?.merge.proposals_total ?? 0,
      cost_usd: item.record.cost_usd_total,
      latency_ms: item.record.timing.total_latency_ms,
    };

    if (!leak.clean) {
      // FAIL CLOSED: a payload that leaks identity is never scored.
      row.scoring_refused = `leak scan hit: ${leak.hits.join(", ")}`;
      rows.push(row);
      continue;
    }

    row.safety_hits = runSafetyCells(blind);
    if (item.record.validation.valid) {
      const bundle = verdictProvider.provide(blind, row.safety_hits, item.brief.warrantedSet);
      row.r_pending = bundle.r_pending;
      anyRPending = anyRPending || bundle.r_pending;
      row.fgq = scoreFinalGraph(bundle.elements, bundle.r_items);
      row.holistic_det = scoreHolisticDeterministic(blind);
      if (opts.holisticLlm && !opts.mock) {
        const outcome = await scoreHolisticLlm(blind, prompts.holisticJudge, client);
        row.holistic_llm = outcome.verdict;
      }
    }
    rows.push(row);
  }

  const evidence = assessEvidence({
    attestationsPath: opts.attestationsPath,
    anyPlaceholderPrompts: anyPlaceholder(prompts),
    preflight,
    config,
    verdictProvider: verdictProvider.name,
    anyRPending,
  });

  const staleness = pricingStaleness(now);
  const report = buildReport({
    config,
    baseSha: baseSha(),
    verdictProvider: verdictProvider.name,
    preflight,
    pricingStaleness: staleness,
    rows,
    matchEntries,
    evidence,
    blockedArms,
    generatedLabel: now.toISOString(),
  });
  const reportPath = store.writeReport(report);

  store.writeJson("run.json", {
    config,
    prompt_set: opts.promptSet ?? "default",
    prompt_hashes: promptHashes(prompts),
    prompt_placeholder: anyPlaceholder(prompts),
    pricing: PRICING_TABLE,
    pricing_staleness: staleness,
    evidence,
    base_sha: baseSha(),
  });
  store.writeJson("scores.json", { rows, match_entries: matchEntries });

  return {
    runDir: store.runDir,
    reportPath,
    watermark: evidence.watermark,
    rows: rows.length,
    invalid: rows.filter((r) => !r.valid).length,
    blockedArms,
  };
}

export const PIPELINE_DEFAULT_RUN_SEED = DEFAULT_RUN_SEED;
