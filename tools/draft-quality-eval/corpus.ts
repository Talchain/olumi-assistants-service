/**
 * THE CORPUS — briefs and captured drafts, all of them from the repo.
 *
 * ⚠ NOTHING HERE IS AUTHORED BY THIS TOOL. A corpus drawn from the harness
 * author's head cannot see the class the author did not imagine, and it would
 * quietly encode this lane's model of the drafter rather than the drafter.
 *
 * ── PROVENANCE ─────────────────────────────────────────────────────────────
 * BRIEFS · `tools/graph-evaluator/briefs/*.md` — the 14-brief evaluation corpus
 *   (`01-simple-binary` … `14-qualitative-strategy`) plus two staging briefs.
 *   Each carries FRONT-MATTER written with the brief and not by this lane:
 *   `expect_status_quo`, `has_numeric_target`, `complexity`. Those are real
 *   oracles and the rubric consumes `expect_status_quo` directly.
 *
 * CAPTURED DRAFTS · `tools/graph-evaluator/governed/draft-graph-v5/baseline/
 *   run-b9389df-claude-sonnet-4-6.json` — 14 LIVE draws, one per brief, taken
 *   through the production adapter against a pinned prompt snapshot. Its
 *   `run.identity.records_instruction_sha256` is the artefact identity that
 *   makes it attributable to a specific DRAFT_RECORDS_INSTRUCTION version;
 *   `assertInstructionAttribution()` below refuses to report a baseline whose
 *   identity is unknown to the caller.
 *
 * ── ⚠ WHAT THIS CORPUS EXCLUDES (state the gaps, do not imply coverage) ────
 *  · NO non-English brief, and no brief with an attached document.
 *  · NO adversarial / prompt-injection brief — the corpus is 14 well-formed
 *    business decisions. `03-vague-underspecified` is the only thin one.
 *  · NO brief whose stated goal is non-numeric AND whose options are unnamed.
 *  · NO multi-turn state: every case is a FIRST draft from a cold brief. A
 *    seeded or refined model is a different state-class entirely and this
 *    corpus says nothing about it.
 *  · NO repeat draws — exactly ONE draw per brief, so nothing here can speak to
 *    RUN-TO-RUN VARIANCE. A difference of one check between two instruction
 *    versions on n=1 is not a result.
 *  · The two staging briefs (`hiring-staging`, `pricing-staging`) have NO
 *    captured draw in the governed baseline, so they are available to the live
 *    arm only.
 *  · The banked RECORD SETS under
 *    `src/cee/draft/records/__tests__/fixtures/` (4 captures) PREDATE the
 *    widened grammar; they carry no `risk`/`outcome` claim and cannot.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const BRIEFS_DIR = "tools/graph-evaluator/briefs";
export const GOVERNED_BASELINE_PATH =
  "tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json";

export interface CorpusBrief {
  readonly id: string;
  /** The brief body, front-matter stripped — the bytes a user would type. */
  readonly text: string;
  readonly expectStatusQuo?: boolean;
  readonly hasNumericTarget?: boolean;
  readonly complexity?: string;
}

/**
 * Minimal front-matter reader. The corpus's front-matter is three scalar keys;
 * a YAML dependency would drag the standalone `tools/graph-evaluator` package
 * boundary (and its `gray-matter` dep) into the product test run, which is
 * exactly why that package is excluded from both root vitest configs.
 */
function parseBrief(id: string, raw: string): CorpusBrief {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { id, text: raw.trim() };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line.trim());
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  const bool = (v: string | undefined) =>
    v === "true" ? true : v === "false" ? false : undefined;
  return {
    id,
    text: m[2].trim(),
    expectStatusQuo: bool(fm.expect_status_quo),
    hasNumericTarget: bool(fm.has_numeric_target),
    complexity: fm.complexity,
  };
}

export function loadBriefs(repoRoot = "."): CorpusBrief[] {
  const dir = join(repoRoot, BRIEFS_DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseBrief(f.replace(/\.md$/, ""), readFileSync(join(dir, f), "utf8")));
}

export interface GovernedCase {
  readonly briefId: string;
  readonly status: string;
  readonly graph: unknown;
  readonly modelId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly latencyMs?: number;
  readonly estimatedCostUsd?: number;
}

export interface GovernedBaseline {
  readonly path: string;
  readonly recordsInstructionSha256: string;
  readonly recordsGrammarSha256: string;
  readonly promptId: string;
  readonly promptVersion: number;
  readonly modelId: string;
  readonly servingBaseSha: string;
  readonly generatedAt: string;
  readonly cases: readonly GovernedCase[];
}

export function loadGovernedBaseline(repoRoot = "."): GovernedBaseline {
  const path = join(repoRoot, GOVERNED_BASELINE_PATH);
  const j = JSON.parse(readFileSync(path, "utf8"));
  const id = j.run?.identity ?? {};
  return {
    path: GOVERNED_BASELINE_PATH,
    recordsInstructionSha256: id.records_instruction_sha256,
    recordsGrammarSha256: id.records_grammar_sha256,
    promptId: id.prompt_id,
    promptVersion: id.prompt_version,
    modelId: id.model_id,
    servingBaseSha: id.serving_base_sha,
    generatedAt: j.generated_at,
    cases: (j.run?.cases ?? []).map(
      (c: Record<string, unknown>): GovernedCase => ({
        briefId: String(c.brief_id),
        status: String(c.status),
        graph: c.graph,
        modelId: c.model_id as string | undefined,
        inputTokens: c.input_tokens as number | undefined,
        outputTokens: c.output_tokens as number | undefined,
        latencyMs: c.latency_ms as number | undefined,
        estimatedCostUsd: c.estimated_cost_usd as number | undefined,
      }),
    ),
  };
}

/**
 * ⭐ THE ATTRIBUTION GUARD — the one thing that makes a baseline mean anything.
 *
 * A quality figure is a claim ABOUT AN INSTRUCTION. If the captured run was
 * produced by a different instruction than the tree holds, the figure is
 * attributable to nothing, and reporting it as "the current baseline" is the
 * precise defect the instruction's own pin test exists to prevent (two
 * instructions sharing one evidence base).
 *
 * So this throws rather than warns. A harness that prints a reassuring number
 * about the wrong artefact is worse than one that refuses.
 */
export function assertInstructionAttribution(
  baseline: GovernedBaseline,
  liveInstructionSha256: string,
): void {
  if (baseline.recordsInstructionSha256 !== liveInstructionSha256) {
    throw new Error(
      `ATTRIBUTION FAILED: the governed baseline was captured against ` +
        `records_instruction_sha256=${baseline.recordsInstructionSha256}, but the tree's ` +
        `DRAFT_RECORDS_INSTRUCTION hashes to ${liveInstructionSha256}. This baseline is ` +
        `evidence about a DIFFERENT instruction and must not be reported as the current one. ` +
        `Re-capture with \`pnpm --dir tools/graph-evaluator run governed:draft-graph:baseline\` ` +
        `(needs ANTHROPIC_API_KEY), or pass --allow-stale-baseline to read it as HISTORIC.`,
    );
  }
}
