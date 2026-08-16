import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { score, DRAFT_RUBRIC_VERSION } from "./scorer.js";
import type { Brief, LLMResponse, ParsedGraph, ScoreResult } from "./types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const TOOL_ROOT = resolve(MODULE_DIR, "..");
export const REPO_ROOT = resolve(TOOL_ROOT, "..", "..");
export const GOVERNED_PACK_ROOT = join(
  TOOL_ROOT,
  "governed",
  "draft-graph-v5",
);

type Disposition = "KEEP" | "REPLACE" | "QUARANTINE" | "REMOVE";

interface HashPinnedPath {
  readonly source_path: string;
  readonly source_sha256: string;
}

export interface GovernedDraftManifest {
  readonly schema_version: "olumi.draft_graph.governed_eval.v1";
  readonly status: "BASELINE_FROZEN";
  readonly candidate_status: "HOLD_WITH_EVIDENCE";
  readonly serving: {
    readonly git_sha: string;
    readonly git_tree: string;
    readonly route: string;
    readonly task_id: string;
    readonly operation: string;
  };
  readonly prompt: {
    readonly prompt_id: string;
    readonly store_version: number;
    readonly source: string;
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly characters: number;
  };
  readonly baseline: {
    readonly status: "complete";
    readonly executed_at: string;
    readonly result_path: string;
    readonly result_sha256: string;
    readonly logical_primary_calls: 14;
    readonly manual_retries: 0;
    readonly candidate_calls: 0;
    readonly equivalence_scope: "first_primary_prompt_composition_and_model_under_pinned_direct_adapter_configuration";
    readonly equivalence_excludes: "whole_route_and_request_bytes";
  };
  readonly model: {
    readonly provider: string;
    readonly model_id: string;
    readonly assignment_authority: string;
    readonly staging: string;
    readonly production: string;
    readonly model_config_path: string;
    readonly model_config_sha256: string;
    readonly thinking: string;
    readonly structured_outputs: string;
    readonly primary_calls_per_arm: number;
    readonly completion_calls_per_arm_max: number;
  };
  readonly invocation: {
    readonly seed: number;
    readonly documents: "none";
    readonly attachment: "none";
    readonly system_directive: "none";
    readonly timeout_ms: number;
    readonly max_tokens_ceiling: number;
    readonly completion_max_tokens: number;
    readonly completion_wall_ms: number;
    readonly external_spend_cap_usd: number;
    readonly prompt_cache: "enabled";
    readonly draft_compliance_reminder: "enabled";
    readonly brief_signals_header: "disabled";
    readonly currency_context: "derived_from_each_brief";
    readonly manual_retries: 0;
  };
  readonly composition: {
    readonly system_block_order: readonly string[];
    readonly user_suffix_order: readonly string[];
    readonly layers: readonly (HashPinnedPath & {
      readonly id: string;
      readonly content_sha256?: string;
      readonly bytes?: number;
      readonly characters?: number;
    })[];
    readonly excluded_layers: readonly (Partial<HashPinnedPath> & {
      readonly id: string;
      readonly reason: string;
    })[];
  };
  readonly corpus: {
    readonly directory: string;
    readonly cardinality: number;
    readonly order: readonly { readonly id: string; readonly sha256: string }[];
    readonly excluded_noncanonical_files: readonly string[];
  };
  readonly rubric: {
    readonly id: string;
    readonly legacy_signal: string;
    readonly legacy_scorer_source_sha256: string;
    readonly legacy_validator_source_sha256: string;
    readonly meaningful_gain: {
      readonly minimum_mean_legacy_delta: number;
      readonly minimum_case_wins: number;
      readonly maximum_case_losses: number;
      readonly maximum_single_case_legacy_regression: number;
    };
  };
  readonly governance: {
    readonly candidate_path: string | null;
    readonly candidate_sha256: string | null;
    readonly legacy_disposition_path: string;
    readonly legacy_disposition_sha256: string;
    readonly failure_taxonomy_path: string;
    readonly failure_taxonomy_sha256: string;
    readonly deployed_evidence_path: string;
    readonly deployed_evidence_sha256: string;
  };
}

interface LegacyDispositionFile {
  readonly dispositions: Readonly<Record<Disposition, readonly {
    readonly path: string;
    readonly reason: string;
  }[]>>;
}

export interface PackProblem {
  readonly code:
    | "PACK_BASE_MISMATCH"
    | "PROMPT_HASH_MISMATCH"
    | "CODE_LAYER_DRIFT"
    | "CORPUS_DRIFT"
    | "MODEL_ROUTE_DRIFT"
    | "LEGACY_UNDISPOSITIONED"
    | "DEPLOYED_EVIDENCE_DRIFT"
    | "GOVERNANCE_ARTIFACT_DRIFT"
    | "GOVERNANCE_STATUS_INVALID"
    | "CANDIDATE_IDENTITY_INVALID";
  readonly detail: string;
}

export interface PackVerification {
  readonly ok: boolean;
  readonly manifest: GovernedDraftManifest;
  readonly problems: readonly PackProblem[];
  readonly prompt_sha256: string;
  readonly prompt_bytes: number;
  readonly prompt_characters: number;
  readonly brief_ids: readonly string[];
  readonly layer_content_hashes: Readonly<Record<string, string>>;
}

export interface GovernedRunIdentity {
  readonly manifest_schema_version: string;
  readonly serving_base_sha: string;
  readonly prompt_id: string;
  readonly prompt_version: number | "candidate";
  readonly prompt_sha256: string;
  readonly model_id: string;
  readonly provider: string;
  readonly records_instruction_sha256: string;
  readonly records_grammar_sha256: string;
  readonly compliance_reminder_sha256: string;
  readonly structured_outputs_required: true;
  readonly corpus_ids: readonly string[];
}

export interface GovernedCaseCapture {
  readonly brief_id: string;
  readonly status: "success" | "failed";
  readonly failure_code?: string;
  readonly error_class?: string;
  readonly model_id: string;
  readonly prompt_sha256: string;
  readonly structured_outputs_used?: boolean;
  readonly prompt_version?: string;
  readonly prompt_store_version?: number | null;
  readonly graph?: unknown;
  readonly record_disclosures?: readonly unknown[];
  /** Count after the live AnthropicAdapter field projection. */
  readonly serving_record_disclosures_count: number;
  readonly latency_ms?: number;
  readonly provider_latency_ms?: number;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly finish_reason?: string;
  readonly streamed?: boolean;
  readonly salvaged_from_truncation?: boolean;
  readonly runaway_abort_count?: number;
  readonly runaway_abort_triggers?: readonly string[];
  readonly estimated_cost_usd?: number;
}

export interface ProvenanceAssessment {
  readonly element_count: number;
  readonly missing_count: number;
  readonly stated_count: number;
  readonly inferred_count: number;
  readonly structural_count: number;
  readonly unbased_inference_count: number;
  readonly disclosure_count: number;
  readonly serving_disclosure_count: number;
  readonly unsurfaced_disclosure_count: number;
}

export interface GovernedCaseScore {
  readonly brief_id: string;
  readonly adapter_success: boolean;
  readonly structured_outputs_attested: boolean;
  /** Production records adapter returned a GraphT-shaped graph. */
  readonly structural_valid: boolean;
  /** Informational only: the retired raw-graph topology validator's result. */
  readonly legacy_structural_valid: boolean;
  readonly legacy: ScoreResult;
  readonly canonical_ready: boolean;
  readonly canonical_status: string | null;
  readonly canonical_blocking_issue_count: number;
  readonly canonical_blocking_codes: readonly string[];
  readonly provenance: ProvenanceAssessment;
  readonly failures: readonly string[];
}

export interface GovernedRun {
  readonly schema_version: "olumi.draft_graph.governed_run.v1";
  readonly arm: "baseline" | "candidate";
  readonly identity: GovernedRunIdentity;
  readonly cases: readonly GovernedCaseCapture[];
  readonly scores: readonly GovernedCaseScore[];
}

export interface GovernedComparison {
  readonly verdict: "PASS" | "FAIL" | "HOLD";
  readonly reasons: readonly string[];
  readonly mean_legacy_delta: number | null;
  readonly wins: number;
  readonly losses: number;
  readonly worst_case_delta: number | null;
  readonly baseline: ReturnType<typeof summariseGovernedScores>;
  readonly candidate: ReturnType<typeof summariseGovernedScores>;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

interface GovernedBaselineArtifactEnvelope {
  readonly schema_version?: unknown;
  readonly baseline_status?: unknown;
  readonly candidate_status?: unknown;
  readonly run?: unknown;
}

function isGovernedRun(value: unknown): value is GovernedRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<GovernedRun>;
  return run.schema_version === "olumi.draft_graph.governed_run.v1" &&
    (run.arm === "baseline" || run.arm === "candidate") &&
    Boolean(run.identity && typeof run.identity === "object") &&
    Array.isArray(run.cases) &&
    Array.isArray(run.scores);
}

function exactStrings(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function hasExactRunCoverage(
  run: GovernedRun,
  expectedIds: readonly string[],
): boolean {
  return run.schema_version === "olumi.draft_graph.governed_run.v1" &&
    exactStrings(run.identity.corpus_ids, expectedIds) &&
    exactStrings(run.cases.map((item) => item.brief_id), expectedIds) &&
    exactStrings(run.scores.map((item) => item.brief_id), expectedIds);
}

function captureDisclosureEvidence(captures: readonly GovernedCaseCapture[]): {
  readonly invalid_count: number;
  readonly unsurfaced_count: number;
} {
  let invalid = 0;
  let unsurfaced = 0;
  for (const capture of captures) {
    const generated = Array.isArray(capture.record_disclosures)
      ? capture.record_disclosures.length
      : 0;
    const served = (capture as { serving_record_disclosures_count?: unknown })
      .serving_record_disclosures_count;
    if (
      typeof served !== "number" ||
      !Number.isFinite(served) ||
      !Number.isInteger(served) ||
      served < 0 ||
      served > generated
    ) {
      invalid += 1;
      unsurfaced += generated;
      continue;
    }
    unsurfaced += generated - served;
  }
  return { invalid_count: invalid, unsurfaced_count: unsurfaced };
}

function problem(
  problems: PackProblem[],
  code: PackProblem["code"],
  detail: string,
): void {
  problems.push({ code, detail });
}

function decodeStaticTemplate(raw: string): string {
  if (raw.includes("${")) {
    throw new Error("template contains interpolation and cannot be decoded statically");
  }
  return raw
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .replaceAll("\\t", "\t")
    .replaceAll("\\`", "`")
    .replaceAll("\\\\", "\\");
}

async function deriveComplianceReminder(): Promise<string> {
  const source = await readFile(join(REPO_ROOT, "src/adapters/llm/anthropic.ts"), "utf8");
  const match = /export const DRAFT_COMPLIANCE_REMINDER = `([\s\S]*?)`;/u.exec(source);
  if (!match?.[1]) {
    throw new Error("DRAFT_COMPLIANCE_REMINDER source anchor missing");
  }
  return decodeStaticTemplate(match[1]);
}

function deriveRecordsLayerHashes(): {
  instruction: string;
  grammar: string;
} {
  const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const script = [
    "import { draftRecordsInstructionHash } from './src/cee/draft/records/instruction.ts';",
    "import { draftRecordsGrammarHash } from './src/cee/draft/records/grammar.ts';",
    "process.stdout.write(JSON.stringify({instruction:draftRecordsInstructionHash(),grammar:draftRecordsGrammarHash()}));",
    "process.exit(0);",
  ].join("");
  const raw = execFileSync(tsx, ["-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(raw) as { instruction: string; grammar: string };
}

function gitValue(args: readonly string[]): string | null {
  try {
    return execFileSync("git", [...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function assertManifestShape(raw: unknown): GovernedDraftManifest {
  if (!raw || typeof raw !== "object") throw new Error("manifest must be an object");
  const manifest = raw as Partial<GovernedDraftManifest>;
  if (manifest.schema_version !== "olumi.draft_graph.governed_eval.v1") {
    throw new Error("unsupported governed draft manifest schema");
  }
  if (
    !manifest.prompt ||
    !manifest.baseline ||
    !manifest.model ||
    !manifest.invocation ||
    !manifest.composition ||
    !manifest.corpus
  ) {
    throw new Error("governed draft manifest is incomplete");
  }
  return manifest as GovernedDraftManifest;
}

export async function readGovernedManifest(
  packRoot = GOVERNED_PACK_ROOT,
): Promise<GovernedDraftManifest> {
  return assertManifestShape(await readJson(join(packRoot, "manifest.json")));
}

/**
 * Fail-closed verification of every byte/config identity that makes a run
 * comparable. This function performs no provider call and no external write.
 */
export async function verifyGovernedPack(
  packRoot = GOVERNED_PACK_ROOT,
): Promise<PackVerification> {
  const manifest = await readGovernedManifest(packRoot);
  const problems: PackProblem[] = [];
  const layerContentHashes: Record<string, string> = {};

  const runtimeManifest = manifest as unknown as {
    status?: unknown;
    candidate_status?: unknown;
    baseline?: {
      status?: unknown;
      logical_primary_calls?: unknown;
      manual_retries?: unknown;
      candidate_calls?: unknown;
      equivalence_scope?: unknown;
      equivalence_excludes?: unknown;
    };
  };
  if (
    runtimeManifest.status !== "BASELINE_FROZEN" ||
    runtimeManifest.candidate_status !== "HOLD_WITH_EVIDENCE" ||
    runtimeManifest.baseline?.status !== "complete" ||
    runtimeManifest.baseline.logical_primary_calls !== 14 ||
    runtimeManifest.baseline.manual_retries !== 0 ||
    runtimeManifest.baseline.candidate_calls !== 0 ||
    runtimeManifest.baseline.equivalence_scope !==
      "first_primary_prompt_composition_and_model_under_pinned_direct_adapter_configuration" ||
    runtimeManifest.baseline.equivalence_excludes !== "whole_route_and_request_bytes"
  ) {
    problem(
      problems,
      "GOVERNANCE_STATUS_INVALID",
      "the frozen baseline must remain BASELINE_FROZEN + HOLD_WITH_EVIDENCE with 14 baseline calls, no retries, and zero candidate calls",
    );
  }

  const candidatePath = manifest.governance.candidate_path;
  const candidateHash = manifest.governance.candidate_sha256;
  const candidateAbsent = candidatePath === null && candidateHash === null;
  const candidatePairPresent = typeof candidatePath === "string" &&
    candidatePath.length > 0 &&
    typeof candidateHash === "string" &&
    SHA256_PATTERN.test(candidateHash);
  if (!candidateAbsent && !candidatePairPresent) {
    problem(
      problems,
      "CANDIDATE_IDENTITY_INVALID",
      "candidate_path and candidate_sha256 must either both be null or form one complete hash-pinned pair",
    );
  } else if (candidatePairPresent) {
    const candidateAbsolutePath = resolve(packRoot, candidatePath);
    const candidateRelativePath = relative(packRoot, candidateAbsolutePath);
    if (
      candidateRelativePath.length === 0 ||
      isAbsolute(candidateRelativePath) ||
      candidateRelativePath === ".." ||
      candidateRelativePath.startsWith(`..${sep}`)
    ) {
      problem(
        problems,
        "CANDIDATE_IDENTITY_INVALID",
        "candidate prompt path must resolve to a file within the governed pack",
      );
    } else {
      try {
        const actualCandidateHash = sha256(await readFile(candidateAbsolutePath));
        if (
          actualCandidateHash !== candidateHash ||
          actualCandidateHash === manifest.prompt.sha256
        ) {
          problem(
            problems,
            "CANDIDATE_IDENTITY_INVALID",
            "candidate prompt must match its pinned hash and be byte-distinct from the baseline prompt",
          );
        }
      } catch (error) {
        problem(
          problems,
          "CANDIDATE_IDENTITY_INVALID",
          `candidate prompt could not be read: ${String(error)}`,
        );
      }
    }
  }

  const mergeBase = gitValue(["merge-base", manifest.serving.git_sha, "HEAD"]);
  if (mergeBase !== manifest.serving.git_sha) {
    problem(
      problems,
      "PACK_BASE_MISMATCH",
      `HEAD is not descended from serving base ${manifest.serving.git_sha}`,
    );
  }
  const baseTree = gitValue(["show", "-s", "--format=%T", manifest.serving.git_sha]);
  if (baseTree !== manifest.serving.git_tree) {
    problem(
      problems,
      "PACK_BASE_MISMATCH",
      `serving base tree is ${baseTree ?? "unavailable"}, expected ${manifest.serving.git_tree}`,
    );
  }

  const promptBytes = await readFile(join(packRoot, manifest.prompt.path));
  const promptText = promptBytes.toString("utf8");
  const promptHash = sha256(promptBytes);
  if (
    promptHash !== manifest.prompt.sha256 ||
    promptBytes.byteLength !== manifest.prompt.bytes ||
    promptText.length !== manifest.prompt.characters
  ) {
    problem(
      problems,
      "PROMPT_HASH_MISMATCH",
      `PMS snapshot is sha256=${promptHash}, bytes=${promptBytes.byteLength}, chars=${promptText.length}`,
    );
  }

  for (const layer of manifest.composition.layers) {
    const content = await readFile(join(REPO_ROOT, layer.source_path));
    const actual = sha256(content);
    if (actual !== layer.source_sha256) {
      problem(
        problems,
        "CODE_LAYER_DRIFT",
        `${layer.id} source hash is ${actual}, expected ${layer.source_sha256}`,
      );
    }
  }
  for (const layer of manifest.composition.excluded_layers) {
    if (!layer.source_path || !layer.source_sha256) continue;
    const content = await readFile(join(REPO_ROOT, layer.source_path));
    const actual = sha256(content);
    if (actual !== layer.source_sha256) {
      problem(
        problems,
        "CODE_LAYER_DRIFT",
        `${layer.id} excluded-layer source hash is ${actual}, expected ${layer.source_sha256}`,
      );
    }
  }

  try {
    const records = deriveRecordsLayerHashes();
    layerContentHashes["draft_records_instruction"] = records.instruction;
    layerContentHashes["draft_records_grammar"] = records.grammar;
    const instruction = manifest.composition.layers.find((layer) => layer.id === "draft_records_instruction");
    const grammar = manifest.composition.layers.find((layer) => layer.id === "draft_records_grammar");
    if (records.instruction !== instruction?.content_sha256) {
      problem(problems, "CODE_LAYER_DRIFT", "draft records instruction content hash drifted");
    }
    if (records.grammar !== grammar?.content_sha256) {
      problem(problems, "CODE_LAYER_DRIFT", "draft records grammar content hash drifted");
    }
  } catch (error) {
    problem(problems, "CODE_LAYER_DRIFT", `records hashes could not be derived: ${String(error)}`);
  }

  try {
    const compliance = await deriveComplianceReminder();
    const complianceHash = sha256(compliance);
    layerContentHashes["draft_compliance_reminder"] = complianceHash;
    const layer = manifest.composition.layers.find((item) => item.id === "draft_compliance_reminder");
    if (
      complianceHash !== layer?.content_sha256 ||
      Buffer.byteLength(compliance) !== layer.bytes ||
      compliance.length !== layer.characters
    ) {
      problem(
        problems,
        "CODE_LAYER_DRIFT",
        `draft compliance reminder is sha256=${complianceHash}, bytes=${Buffer.byteLength(compliance)}, chars=${compliance.length}`,
      );
    }
  } catch (error) {
    problem(problems, "CODE_LAYER_DRIFT", `compliance reminder could not be derived: ${String(error)}`);
  }

  const corpusDir = join(TOOL_ROOT, manifest.corpus.directory);
  const actualNumberedFiles = (await readdir(corpusDir))
    .filter((file) => /^\d{2}-.*\.md$/u.test(file))
    .sort();
  const expectedNumberedFiles = manifest.corpus.order.map((item) => `${item.id}.md`);
  if (
    manifest.corpus.cardinality !== 14 ||
    manifest.corpus.order.length !== 14 ||
    JSON.stringify(actualNumberedFiles) !== JSON.stringify(expectedNumberedFiles)
  ) {
    problem(
      problems,
      "CORPUS_DRIFT",
      `numbered corpus is [${actualNumberedFiles.join(", ")}], expected [${expectedNumberedFiles.join(", ")}]`,
    );
  }
  for (const item of manifest.corpus.order) {
    const actual = sha256(await readFile(join(corpusDir, `${item.id}.md`)));
    if (actual !== item.sha256) {
      problem(problems, "CORPUS_DRIFT", `${item.id} hash is ${actual}, expected ${item.sha256}`);
    }
  }

  const modelConfigPath = join(TOOL_ROOT, manifest.model.model_config_path);
  const modelConfigBytes = await readFile(modelConfigPath);
  const modelConfigHash = sha256(modelConfigBytes);
  const modelConfig = JSON.parse(modelConfigBytes.toString("utf8")) as {
    provider?: string;
    model?: string;
    id?: string;
  };
  if (
    modelConfigHash !== manifest.model.model_config_sha256 ||
    modelConfig.provider !== manifest.model.provider ||
    modelConfig.model !== manifest.model.model_id ||
    modelConfig.id !== manifest.model.model_id ||
    manifest.model.staging !== manifest.model.model_id ||
    manifest.model.production !== manifest.model.model_id
  ) {
    problem(
      problems,
      "MODEL_ROUTE_DRIFT",
      `model config/hash does not resolve exactly to ${manifest.model.provider}/${manifest.model.model_id}`,
    );
  }

  const legacy = await readJson<LegacyDispositionFile>(
    join(packRoot, manifest.governance.legacy_disposition_path),
  );
  const disposed = new Map<string, Disposition>();
  for (const disposition of ["KEEP", "REPLACE", "QUARANTINE", "REMOVE"] as const) {
    for (const item of legacy.dispositions[disposition] ?? []) {
      if (disposed.has(item.path)) {
        problem(problems, "LEGACY_UNDISPOSITIONED", `${item.path} has multiple dispositions`);
      }
      disposed.set(item.path, disposition);
    }
  }
  const promptDir = join(TOOL_ROOT, "prompts");
  const legacyDraftFiles = (await readdir(promptDir))
    .filter((file) =>
      /^(?:draft(?:-|_)|store_draft_graph)/u.test(file) || file === "user-message-reminder.txt",
    )
    .map((file) => `prompts/${file}`)
    .sort();
  const undispositioned = legacyDraftFiles.filter((path) => !disposed.has(path));
  if (undispositioned.length > 0) {
    problem(
      problems,
      "LEGACY_UNDISPOSITIONED",
      `legacy draft artefacts lack disposition: ${undispositioned.join(", ")}`,
    );
  }

  const deployedEvidence = await readFile(
    join(packRoot, manifest.governance.deployed_evidence_path),
  );
  const deployedEvidenceHash = sha256(deployedEvidence);
  if (deployedEvidenceHash !== manifest.governance.deployed_evidence_sha256) {
    problem(
      problems,
      "DEPLOYED_EVIDENCE_DRIFT",
      `deployed evidence hash is ${deployedEvidenceHash}, expected ${manifest.governance.deployed_evidence_sha256}`,
    );
  }

  const governanceArtifacts: readonly [string, string, string][] = [
    [
      "legacy disposition",
      manifest.governance.legacy_disposition_path,
      manifest.governance.legacy_disposition_sha256,
    ],
    [
      "failure taxonomy",
      manifest.governance.failure_taxonomy_path,
      manifest.governance.failure_taxonomy_sha256,
    ],
    ["baseline result", manifest.baseline.result_path, manifest.baseline.result_sha256],
  ];
  for (const [label, relativePath, expectedHash] of governanceArtifacts) {
    const actualHash = sha256(await readFile(join(packRoot, relativePath)));
    if (actualHash !== expectedHash) {
      problem(
        problems,
        "GOVERNANCE_ARTIFACT_DRIFT",
        `${label} hash is ${actualHash}, expected ${expectedHash}`,
      );
    }
  }

  try {
    const artifact = await readJson<GovernedBaselineArtifactEnvelope>(
      join(packRoot, manifest.baseline.result_path),
    );
    const baselineRun = artifact.run;
    const expectedIdentity = buildGovernedRunIdentity(manifest);
    const expectedIds = manifest.corpus.order.map((item) => item.id);
    if (
      artifact.schema_version !== "olumi.draft_graph.governed_baseline_artifact.v1" ||
      artifact.baseline_status !== "COMPLETE" ||
      artifact.candidate_status !== "HOLD_WITH_EVIDENCE"
    ) {
      problem(
        problems,
        "GOVERNANCE_STATUS_INVALID",
        "the frozen baseline artifact must remain COMPLETE + HOLD_WITH_EVIDENCE",
      );
    }
    if (
      !isGovernedRun(baselineRun) ||
      baselineRun.arm !== "baseline" ||
      JSON.stringify(baselineRun.identity) !== JSON.stringify(expectedIdentity) ||
      !hasExactRunCoverage(baselineRun, expectedIds) ||
      baselineRun.cases.some((capture) =>
        capture.model_id !== baselineRun.identity.model_id ||
        capture.prompt_sha256 !== baselineRun.identity.prompt_sha256
      ) ||
      captureDisclosureEvidence(baselineRun.cases).invalid_count > 0
    ) {
      problem(
        problems,
        "GOVERNANCE_ARTIFACT_DRIFT",
        "baseline result does not contain the exact complete hash-pinned 14-case baseline run",
      );
    }
  } catch (error) {
    problem(
      problems,
      "GOVERNANCE_ARTIFACT_DRIFT",
      `baseline result could not be validated: ${String(error)}`,
    );
  }

  return {
    ok: problems.length === 0,
    manifest,
    problems,
    prompt_sha256: promptHash,
    prompt_bytes: promptBytes.byteLength,
    prompt_characters: promptText.length,
    brief_ids: manifest.corpus.order.map((item) => item.id),
    layer_content_hashes: layerContentHashes,
  };
}

export function buildGovernedRunIdentity(
  manifest: GovernedDraftManifest,
): GovernedRunIdentity {
  const layers = new Map(
    manifest.composition.layers.map((layer) => [layer.id, layer] as const),
  );
  const instruction = layers.get("draft_records_instruction")?.content_sha256;
  const grammar = layers.get("draft_records_grammar")?.content_sha256;
  const compliance = layers.get("draft_compliance_reminder")?.content_sha256;
  if (!instruction || !grammar || !compliance) {
    throw new Error("governed run identity is missing a content-pinned prompt layer");
  }
  return {
    manifest_schema_version: manifest.schema_version,
    serving_base_sha: manifest.serving.git_sha,
    prompt_id: manifest.prompt.prompt_id,
    prompt_version: manifest.prompt.store_version,
    prompt_sha256: manifest.prompt.sha256,
    model_id: manifest.model.model_id,
    provider: manifest.model.provider,
    records_instruction_sha256: instruction,
    records_grammar_sha256: grammar,
    compliance_reminder_sha256: compliance,
    structured_outputs_required: true,
    corpus_ids: manifest.corpus.order.map((item) => item.id),
  };
}

export async function loadGovernedBriefs(
  manifest: GovernedDraftManifest,
): Promise<Brief[]> {
  const corpusDir = join(TOOL_ROOT, manifest.corpus.directory);
  return Promise.all(manifest.corpus.order.map(async (item) => {
    const content = await readFile(join(corpusDir, `${item.id}.md`), "utf8");
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(content);
    if (!match) throw new Error(`governed brief front matter invalid: ${item.id}`);
    const fields = new Map<string, string>();
    for (const line of match[1]!.split("\n")) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    const complexity = fields.get("complexity");
    if (complexity !== "simple" && complexity !== "moderate" && complexity !== "complex") {
      throw new Error(`governed brief complexity invalid: ${item.id}`);
    }
    return {
      id: item.id,
      meta: {
        expect_status_quo: fields.get("expect_status_quo") !== "false",
        has_numeric_target: fields.get("has_numeric_target") === "true",
        complexity,
      },
      body: match[2]!.trim(),
    };
  }));
}

function toLegacyGraph(graph: unknown): ParsedGraph | undefined {
  if (!graph || typeof graph !== "object") return undefined;
  const record = graph as Record<string, unknown>;
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) return undefined;
  const nodes = record.nodes as ParsedGraph["nodes"];
  const edges = record.edges.map((raw) => {
    const edge = raw as Record<string, unknown>;
    const nested = edge.strength as { mean?: unknown; std?: unknown } | undefined;
    const mean = typeof nested?.mean === "number"
      ? nested.mean
      : typeof edge.strength_mean === "number"
        ? edge.strength_mean
        : typeof edge.weight === "number"
          ? edge.weight
          : 0;
    const std = typeof nested?.std === "number"
      ? nested.std
      : typeof edge.strength_std === "number"
        ? edge.strength_std
        : 0.125;
    const exists = typeof edge.exists_probability === "number"
      ? edge.exists_probability
      : typeof edge.belief_exists === "number"
        ? edge.belief_exists
        : typeof edge.belief === "number"
          ? edge.belief
          : 1;
    return {
      ...edge,
      from: String(edge.from ?? ""),
      to: String(edge.to ?? ""),
      strength: { mean, std },
      exists_probability: exists,
    } as ParsedGraph["edges"][number];
  });
  return {
    nodes,
    edges,
    ...(Array.isArray(record.goal_constraints)
      ? { goal_constraints: record.goal_constraints as ParsedGraph["goal_constraints"] }
      : {}),
    ...(record.coaching && typeof record.coaching === "object"
      ? { coaching: record.coaching as ParsedGraph["coaching"] }
      : {}),
  };
}

function assessProvenance(
  graph: unknown,
  disclosures: readonly unknown[] | undefined,
  servingDisclosuresCount: number,
): ProvenanceAssessment {
  const record = graph && typeof graph === "object" ? graph as Record<string, unknown> : {};
  const elements = [
    ...(Array.isArray(record.nodes) ? record.nodes : []),
    ...(Array.isArray(record.edges) ? record.edges : []),
  ];
  let missing = 0;
  let stated = 0;
  let inferred = 0;
  let structural = 0;
  let unbased = 0;
  for (const raw of elements) {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const provenance = item.provenance && typeof item.provenance === "object"
      ? item.provenance as Record<string, unknown>
      : undefined;
    const cls = provenance?.provenance_class;
    if (cls === "stated") stated += 1;
    else if (cls === "ai_inferred") {
      inferred += 1;
      if (provenance?.unbased === true) unbased += 1;
    } else if (cls === "projector_structural") structural += 1;
    else missing += 1;
  }
  const disclosureCount = disclosures?.length ?? 0;
  return {
    element_count: elements.length,
    missing_count: missing,
    stated_count: stated,
    inferred_count: inferred,
    structural_count: structural,
    unbased_inference_count: unbased,
    disclosure_count: disclosureCount,
    serving_disclosure_count: servingDisclosuresCount,
    unsurfaced_disclosure_count: disclosureCount - servingDisclosuresCount,
  };
}

type ProductionContractModules = {
  assessCanonicalAnalysisReadiness(graph: unknown): {
    safeToAnalyse: boolean;
    analysisReady?: { status?: unknown };
    blockingIssues: readonly { code?: unknown }[];
  };
  transformResponseToV3(
    response: { graph: unknown; record_disclosures?: readonly unknown[] },
    context: { brief: string },
  ): unknown;
};

async function loadProductionContractModules(): Promise<ProductionContractModules> {
  // A non-literal specifier keeps the graph-evaluator package's rootDir
  // isolated while still executing the production authority under tsx/vitest.
  const readinessSpecifier = pathToFileURL(
    join(REPO_ROOT, "src/orchestrator/tools/analysis-ready-helper.ts"),
  ).href;
  const transformSpecifier = pathToFileURL(
    join(REPO_ROOT, "src/cee/transforms/schema-v3.ts"),
  ).href;
  const [readiness, transform] = await Promise.all([
    import(readinessSpecifier),
    import(transformSpecifier),
  ]);
  return {
    assessCanonicalAnalysisReadiness:
      readiness.assessCanonicalAnalysisReadiness as ProductionContractModules["assessCanonicalAnalysisReadiness"],
    transformResponseToV3:
      transform.transformResponseToV3 as ProductionContractModules["transformResponseToV3"],
  };
}

function looksLikeCanonicalV3(graph: unknown): boolean {
  if (!graph || typeof graph !== "object") return false;
  const record = graph as Record<string, unknown>;
  if (record.schema_version === "3.0") return true;
  if (!Array.isArray(record.edges) || record.edges.length === 0) return false;
  const first = record.edges[0];
  return Boolean(
    first &&
    typeof first === "object" &&
    (first as Record<string, unknown>).strength &&
    typeof (first as Record<string, unknown>).strength === "object",
  );
}

export async function scoreGovernedCase(
  capture: GovernedCaseCapture,
  brief: Brief,
): Promise<GovernedCaseScore> {
  const legacyGraph = toLegacyGraph(capture.graph);
  const response: LLMResponse = legacyGraph
    ? {
        model_id: capture.model_id,
        brief_id: capture.brief_id,
        status: "success",
        parsed_graph: legacyGraph,
        latency_ms: capture.latency_ms ?? 0,
      }
    : {
        model_id: capture.model_id,
        brief_id: capture.brief_id,
        status: "server_error",
        failure_code: "server_error",
        latency_ms: capture.latency_ms ?? 0,
      };
  const legacy = score(response, brief);
  const productionStructuralValid = capture.status === "success" && legacyGraph !== undefined;
  const generatedDisclosureCount = Array.isArray(capture.record_disclosures)
    ? capture.record_disclosures.length
    : 0;
  const rawServingDisclosureCount = (
    capture as { serving_record_disclosures_count?: unknown }
  ).serving_record_disclosures_count;
  const servingDisclosureCountValid =
    typeof rawServingDisclosureCount === "number" &&
    Number.isFinite(rawServingDisclosureCount) &&
    Number.isInteger(rawServingDisclosureCount) &&
    rawServingDisclosureCount >= 0 &&
    rawServingDisclosureCount <= generatedDisclosureCount;
  const provenance = assessProvenance(
    capture.graph,
    capture.record_disclosures,
    servingDisclosureCountValid ? rawServingDisclosureCount : 0,
  );
  let canonicalReady = false;
  let canonicalStatus: string | null = null;
  let blockingCodes: string[] = [];
  if (capture.graph !== undefined) {
    const production = await loadProductionContractModules();
    const canonicalGraph = looksLikeCanonicalV3(capture.graph)
      ? capture.graph
      : production.transformResponseToV3(
          {
            graph: capture.graph,
            ...(capture.record_disclosures
              ? { record_disclosures: capture.record_disclosures }
              : {}),
          },
          { brief: brief.body },
        );
    const readiness = production.assessCanonicalAnalysisReadiness(canonicalGraph);
    canonicalReady = readiness.safeToAnalyse;
    canonicalStatus = typeof readiness.analysisReady?.status === "string"
      ? readiness.analysisReady.status
      : null;
    blockingCodes = readiness.blockingIssues.map((issue) => String(issue.code ?? "UNKNOWN"));
  }
  const failures: string[] = [];
  if (capture.status !== "success") failures.push(capture.failure_code ?? "PROVIDER_FAILURE");
  if (capture.structured_outputs_used !== true) failures.push("STRUCTURED_OUTPUTS_REJECTED");
  if (!productionStructuralValid) failures.push("STRUCTURAL_INVALID");
  if (!canonicalReady) failures.push("CANONICAL_READINESS_BLOCKED");
  if (blockingCodes.includes("INTERNAL_ERROR")) failures.push("CANONICAL_READINESS_INTERNAL");
  if (provenance.missing_count > 0) failures.push("PROVENANCE_MISSING");
  if (!servingDisclosureCountValid) {
    failures.push("SERVING_DISCLOSURE_COUNT_INVALID");
  }
  if (provenance.unsurfaced_disclosure_count > 0) {
    failures.push("RECORD_DISCLOSURE_UNSURFACED");
  }

  return {
    brief_id: capture.brief_id,
    adapter_success: capture.status === "success" && legacyGraph !== undefined,
    structured_outputs_attested: capture.structured_outputs_used === true,
    structural_valid: productionStructuralValid,
    legacy_structural_valid: legacy.structural_valid,
    legacy,
    canonical_ready: canonicalReady,
    canonical_status: canonicalStatus,
    canonical_blocking_issue_count: blockingCodes.length,
    canonical_blocking_codes: blockingCodes,
    provenance,
    failures: [...new Set(failures)],
  };
}

export async function scoreGovernedRun(
  arm: GovernedRun["arm"],
  identity: GovernedRunIdentity,
  captures: readonly GovernedCaseCapture[],
  manifest: GovernedDraftManifest,
): Promise<GovernedRun> {
  const briefs = await loadGovernedBriefs(manifest);
  const expectedIds = manifest.corpus.order.map((item) => item.id);
  if (
    !exactStrings(identity.corpus_ids, expectedIds) ||
    !exactStrings(captures.map((capture) => capture.brief_id), expectedIds)
  ) {
    throw new Error("governed run must contain the exact 14 case IDs in manifest order");
  }
  if (captures.some((capture) =>
    capture.model_id !== identity.model_id ||
    capture.prompt_sha256 !== identity.prompt_sha256
  )) {
    throw new Error("governed run case identity does not match its hash-pinned run identity");
  }
  const byBrief = new Map(captures.map((capture) => [capture.brief_id, capture] as const));
  const orderedCaptures = identity.corpus_ids.map((id) => {
    const capture = byBrief.get(id);
    if (!capture) throw new Error(`governed run missing case ${id}`);
    return capture;
  });
  const scores = await Promise.all(
    orderedCaptures.map((capture, index) => scoreGovernedCase(capture, briefs[index]!)),
  );
  return {
    schema_version: "olumi.draft_graph.governed_run.v1",
    arm,
    identity,
    cases: orderedCaptures,
    scores,
  };
}

export function summariseGovernedScores(scores: readonly GovernedCaseScore[]): {
  adapter_success_count: number;
  structured_outputs_count: number;
  structural_valid_count: number;
  legacy_structural_valid_count: number;
  legacy_scored_count: number;
  canonical_ready_count: number;
  canonical_blocking_issue_count: number;
  missing_provenance_count: number;
  unbased_inference_count: number;
  record_disclosure_count: number;
  serving_record_disclosure_count: number;
  unsurfaced_record_disclosure_count: number;
  mean_legacy_score: number | null;
  mean_legacy_score_scored_cases: number | null;
} {
  const legacy = scores
    .map((item) => item.legacy.overall_score)
    .filter((value): value is number => typeof value === "number");
  return {
    adapter_success_count: scores.filter((item) => item.adapter_success).length,
    structured_outputs_count: scores.filter((item) => item.structured_outputs_attested).length,
    structural_valid_count: scores.filter((item) => item.structural_valid).length,
    legacy_structural_valid_count: scores.filter((item) => item.legacy_structural_valid).length,
    legacy_scored_count: legacy.length,
    canonical_ready_count: scores.filter((item) => item.canonical_ready).length,
    canonical_blocking_issue_count: scores.reduce(
      (sum, item) => sum + item.canonical_blocking_issue_count,
      0,
    ),
    missing_provenance_count: scores.reduce(
      (sum, item) => sum + item.provenance.missing_count,
      0,
    ),
    unbased_inference_count: scores.reduce(
      (sum, item) => sum + item.provenance.unbased_inference_count,
      0,
    ),
    record_disclosure_count: scores.reduce(
      (sum, item) => sum + item.provenance.disclosure_count,
      0,
    ),
    serving_record_disclosure_count: scores.reduce(
      (sum, item) => sum + item.provenance.serving_disclosure_count,
      0,
    ),
    unsurfaced_record_disclosure_count: scores.reduce(
      (sum, item) => sum + item.provenance.unsurfaced_disclosure_count,
      0,
    ),
    mean_legacy_score: legacy.length === scores.length && legacy.length > 0
      ? legacy.reduce((sum, value) => sum + value, 0) / legacy.length
      : null,
    mean_legacy_score_scored_cases: legacy.length > 0
      ? legacy.reduce((sum, value) => sum + value, 0) / legacy.length
      : null,
  };
}

function comparisonIdentity(identity: GovernedRunIdentity): string {
  return JSON.stringify({
    manifest_schema_version: identity.manifest_schema_version,
    serving_base_sha: identity.serving_base_sha,
    model_id: identity.model_id,
    provider: identity.provider,
    records_instruction_sha256: identity.records_instruction_sha256,
    records_grammar_sha256: identity.records_grammar_sha256,
    compliance_reminder_sha256: identity.compliance_reminder_sha256,
    structured_outputs_required: identity.structured_outputs_required,
    corpus_ids: identity.corpus_ids,
  });
}

export function compareGovernedRuns(
  baseline: GovernedRun,
  candidate: GovernedRun,
  manifest: GovernedDraftManifest,
): GovernedComparison {
  const reasons: string[] = [];
  const expectedIds = manifest.corpus.order.map((item) => item.id);
  const manifestHasCanonical14 = manifest.corpus.cardinality === 14 &&
    expectedIds.length === 14;
  const baselineCoverageExact = manifestHasCanonical14 &&
    hasExactRunCoverage(baseline, expectedIds);
  const candidateCoverageExact = manifestHasCanonical14 &&
    hasExactRunCoverage(candidate, expectedIds);
  if (baseline.arm !== "baseline" || candidate.arm !== "candidate") {
    reasons.push("PAIR_INCOMPLETE: arm labels are not baseline/candidate");
  }
  if (!baselineCoverageExact || !candidateCoverageExact) {
    reasons.push(
      "PAIR_INCOMPLETE: both arms must contain the exact 14 case IDs in manifest order across identity, captures, and scores",
    );
  }
  if (
    JSON.stringify(baseline.identity) !==
      JSON.stringify(buildGovernedRunIdentity(manifest)) ||
    baseline.cases.some((capture) =>
      capture.model_id !== baseline.identity.model_id ||
      capture.prompt_sha256 !== baseline.identity.prompt_sha256
    )
  ) {
    reasons.push("MODEL_CONFIG_MISMATCH: baseline identity differs from the manifest");
  }
  if (comparisonIdentity(baseline.identity) !== comparisonIdentity(candidate.identity)) {
    reasons.push("MODEL_CONFIG_MISMATCH: non-prompt run identity differs");
  }
  const governedCandidatePath = manifest.governance.candidate_path;
  const governedCandidateHash = manifest.governance.candidate_sha256;
  if (
    typeof governedCandidatePath !== "string" ||
    governedCandidatePath.length === 0 ||
    typeof governedCandidateHash !== "string" ||
    !SHA256_PATTERN.test(governedCandidateHash) ||
    !SHA256_PATTERN.test(candidate.identity.prompt_sha256) ||
    candidate.identity.prompt_sha256 !== governedCandidateHash ||
    candidate.identity.prompt_sha256 === baseline.identity.prompt_sha256 ||
    candidate.identity.prompt_version !== "candidate" ||
    candidate.identity.prompt_id.length === 0 ||
    candidate.cases.some((capture) =>
      capture.model_id !== candidate.identity.model_id ||
      capture.prompt_sha256 !== candidate.identity.prompt_sha256
    )
  ) {
    reasons.push(
      "CANDIDATE_IDENTITY_INVALID: candidate prompt identity must match the manifest's complete distinct path/hash pin, use candidate version, and match every case capture",
    );
  }
  const baselineSummary = summariseGovernedScores(baseline.scores);
  const candidateSummary = summariseGovernedScores(candidate.scores);
  const baselineDisclosures = captureDisclosureEvidence(baseline.cases);
  const candidateDisclosures = captureDisclosureEvidence(candidate.cases);
  if (baselineDisclosures.invalid_count > 0 || candidateDisclosures.invalid_count > 0) {
    reasons.push(
      `DISCLOSURE_EVIDENCE_HOLD: invalid served-disclosure counts baseline=${baselineDisclosures.invalid_count}, candidate=${candidateDisclosures.invalid_count}`,
    );
  }
  if (
    baselineDisclosures.unsurfaced_count > 0 ||
    candidateDisclosures.unsurfaced_count > 0 ||
    baselineSummary.unsurfaced_record_disclosure_count > 0 ||
    candidateSummary.unsurfaced_record_disclosure_count > 0
  ) {
    reasons.push(
      `DISCLOSURE_EVIDENCE_HOLD: unsurfaced disclosures baseline=${Math.max(baselineDisclosures.unsurfaced_count, baselineSummary.unsurfaced_record_disclosure_count)}, candidate=${Math.max(candidateDisclosures.unsurfaced_count, candidateSummary.unsurfaced_record_disclosure_count)}`,
    );
  }
  const hardPairs: Array<[keyof typeof baselineSummary, string, "at_least" | "at_most"]> = [
    ["adapter_success_count", "records adapter success", "at_least"],
    ["structured_outputs_count", "structured outputs attestation", "at_least"],
    ["structural_valid_count", "structural validity", "at_least"],
    ["canonical_ready_count", "canonical readiness", "at_least"],
    ["canonical_blocking_issue_count", "canonical blocking issues", "at_most"],
    ["missing_provenance_count", "missing provenance", "at_most"],
    ["unbased_inference_count", "unbased inference", "at_most"],
  ];
  for (const [key, label, direction] of hardPairs) {
    const before = baselineSummary[key];
    const after = candidateSummary[key];
    if (typeof before !== "number" || typeof after !== "number") continue;
    if (direction === "at_least" ? after < before : after > before) {
      const family = label.includes("provenance") ||
        label.includes("inference")
        ? "PROVENANCE_REGRESSION"
        : label.includes("readiness") || label.includes("blocking")
          ? "READINESS_REGRESSION"
          : "STRUCTURAL_REGRESSION";
      reasons.push(`${family}: ${label} moved ${before} -> ${after}`);
    }
  }

  const deltas: number[] = [];
  for (let index = 0; index < manifest.corpus.cardinality; index += 1) {
    const before = baseline.scores[index]?.legacy.overall_score;
    const after = candidate.scores[index]?.legacy.overall_score;
    if (typeof before !== "number" || typeof after !== "number") continue;
    deltas.push(after - before);
  }
  const meanDelta = deltas.length === manifest.corpus.cardinality
    ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
    : null;
  const wins = deltas.filter((value) => value > 0).length;
  const losses = deltas.filter((value) => value < 0).length;
  const worst = deltas.length > 0 ? Math.min(...deltas) : null;
  const gate = manifest.rubric.meaningful_gain;
  const qualityEvidenceComplete = baselineCoverageExact &&
    candidateCoverageExact &&
    baselineSummary.legacy_scored_count === manifest.corpus.cardinality &&
    candidateSummary.legacy_scored_count === manifest.corpus.cardinality &&
    deltas.length === manifest.corpus.cardinality;
  if (!qualityEvidenceComplete) {
    reasons.push(
      `QUALITY_EVIDENCE_INCOMPLETE: legacy coverage baseline=${baselineSummary.legacy_scored_count}/${manifest.corpus.cardinality}, candidate=${candidateSummary.legacy_scored_count}/${manifest.corpus.cardinality}, paired=${deltas.length}/${manifest.corpus.cardinality}`,
    );
  } else if (
    meanDelta === null ||
    meanDelta < gate.minimum_mean_legacy_delta ||
    wins < gate.minimum_case_wins ||
    losses > gate.maximum_case_losses ||
    worst === null ||
    worst < -gate.maximum_single_case_legacy_regression
  ) {
    reasons.push(
      `QUALITY_GAIN_BELOW_THRESHOLD: mean=${meanDelta ?? "incomplete"}, wins=${wins}, losses=${losses}, worst=${worst ?? "incomplete"}`,
    );
  }

  const isHold = reasons.some((item) =>
    item.startsWith("PAIR_INCOMPLETE") ||
    item.startsWith("MODEL_CONFIG_MISMATCH") ||
    item.startsWith("CANDIDATE_IDENTITY_INVALID") ||
    item.startsWith("DISCLOSURE_EVIDENCE_HOLD") ||
    item.startsWith("QUALITY_EVIDENCE_INCOMPLETE"),
  );
  return {
    verdict: reasons.length === 0 ? "PASS" : isHold ? "HOLD" : "FAIL",
    reasons,
    mean_legacy_delta: meanDelta,
    wins,
    losses,
    worst_case_delta: worst,
    baseline: baselineSummary,
    candidate: candidateSummary,
  };
}

export function assertLegacyRubricIdentity(manifest: GovernedDraftManifest): void {
  if (manifest.rubric.legacy_signal !== DRAFT_RUBRIC_VERSION) {
    throw new Error(
      `legacy rubric drift: ${DRAFT_RUBRIC_VERSION} != ${manifest.rubric.legacy_signal}`,
    );
  }
}

export function promptStem(path: string): string {
  return basename(path).replace(/\.[^.]+$/u, "");
}
