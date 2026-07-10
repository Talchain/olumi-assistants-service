/**
 * Provenance generator — pins every seam this benchmark depends on.
 * Run:  npm run provenance   (writes tools/bakeoff-v6/provenance.json)
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex, stableStringify } from "../util/stable.ts";
import { anthropicSdkVersion } from "../util/sdk-version.ts";
import { PRICING_TABLE } from "../llm/pricing.ts";
import { DEFAULT_MODELS } from "../config.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(HERE, "../..");
const REPO_ROOT = resolve(TOOL_ROOT, "../..");

const EXPECTED_RUBRIC_SHA_PREFIX = "6023ee127a79d7a7";
const JUDGE_SCAFFOLD = "/Users/paulslee/v6-proposal-quality-judge";

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
}

function fileSha256(path: string): string | null {
  try {
    return sha256Hex(readFileSync(path));
  } catch {
    return null;
  }
}

function talchainPin(): { pin: string | null; integrity: string | null } {
  let pin: string | null = null;
  let integrity: string | null = null;
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    pin = pkg.dependencies?.["@talchain/schemas"] ?? null;
  } catch {
    /* recorded as null */
  }
  try {
    const lock = readFileSync(join(REPO_ROOT, "pnpm-lock.yaml"), "utf-8").split("\n");
    const idx = lock.findIndex((l) => l.includes("talchain-schemas") && l.includes("integrity"));
    if (idx >= 0) {
      const match = lock[idx].match(/integrity: (sha512-[^,}\s]+)/);
      integrity = match ? match[1] : null;
    }
  } catch {
    /* recorded as null */
  }
  return { pin, integrity };
}

const rubricSha = fileSha256(join(JUDGE_SCAFFOLD, "verdicts/rubric.txt"));
const { pin, integrity } = talchainPin();

const provenance = {
  lane: "V6 offline dual-model bake-off platform (tools/bakeoff-v6)",
  discipline:
    "Benchmark tooling ONLY. Additive under tools/bakeoff-v6/. No production wiring, no PMS, no push. Reports fail closed to 'PIPELINE SMOKE TEST — NOT EVIDENCE' unless every evidence attestation exists.",
  base: {
    sha: git("rev-parse HEAD"),
    branch: git("rev-parse --abbrev-ref HEAD"),
    origin_staging_expected: "3e4b861156e08ebb711d4d4d0fd78d05d2b5bab3",
  },
  graphv3_seam: {
    validator_module: "src/schemas/cee-v3.ts",
    validator_symbols: ["CEEGraphResponseV3", "GraphV3", "NodeV3", "EdgeV3"],
    validator_blob_sha: git("hash-object src/schemas/cee-v3.ts"),
    arm_a_structured_output_schema: "src/cee/draft/anthropic-graph-schema.ts",
    arm_a_schema_blob_sha: git("hash-object src/cee/draft/anthropic-graph-schema.ts"),
    talchain_schemas_pin: pin,
    talchain_schemas_integrity: integrity,
    import_cleanliness:
      "Verified: importing cee-v3.ts with a fully scrubbed env succeeds (transitively loads zod, @talchain/schemas, sibling schema modules, and utils/telemetry.ts which creates a pino logger at import — no env validation, no config load, no PMS, no network).",
  },
  fgq_vendoring: {
    source: `${JUDGE_SCAFFOLD}/fgq/fgq.py`,
    source_sha256: fileSha256(join(JUDGE_SCAFFOLD, "fgq/fgq.py")),
    known_cases_source: `${JUDGE_SCAFFOLD}/fgq/fgq_known_cases.py`,
    known_cases_sha256: fileSha256(join(JUDGE_SCAFFOLD, "fgq/fgq_known_cases.py")),
    rubric: `${JUDGE_SCAFFOLD}/verdicts/rubric.txt`,
    rubric_sha256: rubricSha,
    rubric_sha_matches_pinned: rubricSha?.startsWith(EXPECTED_RUBRIC_SHA_PREFIX) ?? false,
    port: "src/scoring/fgq/fgq.ts (TypeScript port; all 8 known cases re-asserted in tests/fgq.known-cases.test.ts)",
  },
  models: {
    arms: DEFAULT_MODELS,
    holistic_judge: "claude-opus-4-8",
    advisor_tool: {
      beta_header: "advisor-tool-2026-03-01",
      tool_type: "advisor_20260301",
      tool_max_tokens: 2048,
    },
    note: "Pre-flight records SERVED model ids per response; no silent substitution.",
  },
  arm_a_mirror: {
    source: "src/adapters/llm/anthropic.ts draft path (post #382/#385: Sonnet 5 is the served draft model on staging)",
    mirrored: {
      model: DEFAULT_MODELS.A.model,
      temperature: "omitted — Sonnet 5 rejects a non-default temperature with HTTP 400 (arm-a.ts:34)",
      max_tokens: 16384,
      structured_outputs: "output_config.format json_schema with ANTHROPIC_DRAFT_GRAPH_SCHEMA (GA)",
      thinking: "disabled — explicit thinking:{type:disabled} (Sonnet 5 defaults to adaptive when omitted); the --m1-thinking axis can switch this to adaptive+effort",
    },
    unverified_vs_live: [
      "CEE_ANTHROPIC_STRUCTURED_OUTPUTS flag state on staging (mirrored as ON)",
      "CEE_MAX_TOKENS_DRAFT unset assumption (mirrored as default 16384)",
      "prompts/arm-a.system.txt is the authored, real M1 prompt (NOT a placeholder), aligned to the served data.interventions requirement (see PARITY-CHECKLIST.md); it is NOT byte-identical to the served PMS prompt v194, which is a longer production prompt",
    ],
  },
  pricing: PRICING_TABLE,
  sdk: { "@anthropic-ai/sdk": anthropicSdkVersion(), node: process.version },
  r_set_status:
    "R (warranted reference set) NOT built — HARD benchmark input. FGQ recall reported as 'pending R'; no warranted-coverage claim until R exists (see fixtures/r-sets/).",
  arm_d_cost_gate:
    "Advisor-tool usage.iterations[] shape NOT verified on a real arm-D generation call (pre-flight probed access only, not a full draft). Arm-D USD cost attribution and B@D equal-compute matching are PROVISIONAL; no D comparison is evidential until the first real advisor generation confirms the shape and the cost mapper (src/compute/cost.ts) is checked against it.",
};

const outPath = join(TOOL_ROOT, "provenance.json");
writeFileSync(outPath, stableStringify(provenance) + "\n", "utf-8");
console.log(`wrote ${outPath}`);
