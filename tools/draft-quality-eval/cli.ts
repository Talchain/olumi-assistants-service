/**
 * THE NON-SERVING EVALUATION PATH FOR `DRAFT_RECORDS_INSTRUCTION`.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 * `DRAFT_RECORDS_INSTRUCTION` owns the draft output contract and ships as a
 * CODE CONSTANT, so it has no `/admin/prompts` row, no candidate version, and
 * no `POST /admin/prompts/:id/test` bench. Until now the ONLY way to try a
 * different instruction was to edit the constant, branch and deploy — which is
 * exactly why its own pin file records v3 and v6 as UNMEASURED.
 *
 * `--live --candidate <file>` closes that: it composes the request from the
 * SAME two system blocks the adapter composes, swapping ONLY the second block
 * for the candidate file. No serving code is touched, no prompt row moves,
 * nothing is deployed. The control arm uses the tree's own constant, so a
 * candidate is always measured against the artefact it would replace.
 *
 * ── MODES ──────────────────────────────────────────────────────────────────
 *   --baseline              Score the 14 banked live draws from the governed
 *                           baseline. OFFLINE, no credential, deterministic,
 *                           and what CI runs. Refuses to report if the banked
 *                           run's `records_instruction_sha256` does not match
 *                           the tree's instruction (see the attribution guard).
 *   --live                  Draw fresh records from the model. Needs
 *                           ANTHROPIC_API_KEY. Arms: `control` (the tree's
 *                           instruction) plus every `--candidate <file>`.
 *   --briefs a,b,c          Restrict the corpus (default: all with a capture).
 *   --n <k>                 Draws per brief per arm in --live (default 1).
 *   --json                  Machine-readable report only.
 *   --allow-stale-baseline  Read a non-matching banked run as HISTORIC and say
 *                           so, instead of refusing.
 *
 * ── ⚠ WHAT `--live` COSTS, AND WHY THE DEFAULT IS SMALL ────────────────────
 * A full sweep is `arms × briefs × n` model calls. The banked baseline's own
 * per-case figures are the honest estimate and are printed before any call is
 * made, from the capture itself rather than from a guess. `--n 1` over 14
 * briefs and 2 arms is 28 calls; nothing here retries or fans out.
 *
 * ── ⚠ WHAT THIS CANNOT TELL YOU ────────────────────────────────────────────
 *  · ONE draw per brief measures a SAMPLE, not the instruction. A one-check
 *    difference between two arms at n=1 is noise until n says otherwise.
 *  · The rubric scores the MODEL, never the prose the user reads.
 *  · `--baseline` scores the PROJECTOR's output, which is upstream of the
 *    adapter's field projection, so it cannot see anything the adapter drops.
 *  · Nothing here is a journey witness. A green run is evidence about a draft,
 *    not about a user.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { DRAFT_RECORDS_INSTRUCTION, draftRecordsInstructionHash } from "../../src/cee/draft/records/instruction.js";
import { projectDraftRecords } from "../../src/cee/draft/records/seam.js";
import { buildDraftRecordsSchema } from "../../src/cee/draft/records/grammar.js";
import { loadBriefs, loadGovernedBaseline, assertInstructionAttribution, type CorpusBrief } from "./corpus.js";
import { evaluateDraft, evaluateDraftPostRepair } from "./runner.js";
import type { DraftQualityScore } from "./rubric.js";

const args = process.argv.slice(2);
const has = (f: string) => args.includes(`--${f}`);
const valueOf = (f: string, fallback?: string) => {
  const i = args.indexOf(`--${f}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const allValuesOf = (f: string) => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === `--${f}` && args[i + 1]) out.push(args[i + 1]);
  return out;
};

const JSON_ONLY = has("json");
const say = (s: string) => { if (!JSON_ONLY) process.stdout.write(s + "\n"); };

interface ArmResult {
  readonly arm: string;
  readonly instructionSha256: string;
  readonly scores: readonly DraftQualityScore[];
}

function summarise(scores: readonly DraftQualityScore[]) {
  const passed = scores.reduce((a, s) => a + s.checksPassed, 0);
  const applicable = scores.reduce((a, s) => a + s.checksApplicable, 0);
  const perCheck: Record<string, { pass: number; fail: number; na: number }> = {};
  for (const s of scores) {
    for (const c of s.checks) {
      const row = (perCheck[c.id] ??= { pass: 0, fail: 0, na: 0 });
      if (c.passed === null) row.na++;
      else if (c.passed) row.pass++;
      else row.fail++;
    }
  }
  return { drafts: scores.length, checksPassed: passed, checksApplicable: applicable, perCheck };
}

function printArm(r: ArmResult) {
  const s = summarise(r.scores);
  say(`\n── arm "${r.arm}"  instruction sha256=${r.instructionSha256.slice(0, 12)}…  ${s.drafts} draft(s)`);
  say(`   checks passed: ${s.checksPassed}/${s.checksApplicable}`);
  say(`   ${"check".padEnd(62)} pass fail  n/a`);
  for (const [id, row] of Object.entries(s.perCheck)) {
    say(`   ${id.padEnd(62)} ${String(row.pass).padStart(4)} ${String(row.fail).padStart(4)} ${String(row.na).padStart(4)}`);
  }
}

function printPerDraft(scores: readonly DraftQualityScore[]) {
  say(`\n   ${"brief".padEnd(28)} ${"checks".padStart(7)}  goals opts risk fact bare  n/e      blocking`);
  for (const s of scores) {
    const m = s.measures;
    say(
      `   ${s.briefId.padEnd(28)} ${String(s.checksPassed + "/" + s.checksApplicable).padStart(7)}  ` +
        `${String(m.goalNodeCount).padStart(5)} ${String(m.optionCount).padStart(4)} ${String(m.riskCount).padStart(4)} ` +
        `${String(m.factorCount).padStart(4)} ${String(m.factorsBareUnitInterval).padStart(4)}  ` +
        `${String(m.nodeCount + "/" + m.edgeCount).padStart(6)}  ${String(m.blockingErrorCount).padStart(3)} ${m.blockingErrorCodes.slice(0, 3).join(",")}`,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// MODE 1 — the banked baseline. Offline.
// ───────────────────────────────────────────────────────────────────────────
async function runBaseline(briefs: CorpusBrief[], only: string[] | null): Promise<ArmResult> {
  const baseline = loadGovernedBaseline();
  const live = draftRecordsInstructionHash();
  let attribution: "current" | "historic" = "current";
  if (baseline.recordsInstructionSha256 !== live) {
    if (!has("allow-stale-baseline")) assertInstructionAttribution(baseline, live);
    attribution = "historic";
  }
  say(`banked run: ${baseline.path}`);
  say(`  captured ${baseline.generatedAt} · model ${baseline.modelId} · prompt ${baseline.promptId}@v${baseline.promptVersion}`);
  say(`  records_instruction_sha256 ${baseline.recordsInstructionSha256.slice(0, 12)}… ` +
      `(tree: ${live.slice(0, 12)}…) ⇒ ${attribution.toUpperCase()}`);

  const byId = new Map(briefs.map((b) => [b.id, b]));
  const cases = baseline.cases.filter((c) => (only ? only.includes(c.briefId) : true));
  const postRepair = has("post-repair");
  say(`  stage: ${postRepair ? "POST-REPAIR (closer to what the user receives)" : "PROJECTED (the purest signal about the instruction)"}`);
  const scores: DraftQualityScore[] = [];
  for (const c of cases) {
    const b = byId.get(c.briefId);
    const input = { briefId: c.briefId, graph: c.graph, briefText: b?.text, expectStatusQuo: b?.expectStatusQuo };
    scores.push(postRepair ? await evaluateDraftPostRepair(input) : evaluateDraft(input));
  }
  const cost = cases.reduce((a, c) => a + (c.estimatedCostUsd ?? 0), 0);
  const outTok = cases.reduce((a, c) => a + (c.outputTokens ?? 0), 0);
  say(`  the banked run's own cost: ${cases.length} calls · ${outTok} output tokens · $${cost.toFixed(4)}`);
  return { arm: `banked:${attribution}`, instructionSha256: baseline.recordsInstructionSha256, scores };
}

// ───────────────────────────────────────────────────────────────────────────
// MODE 2 — the live arm. The non-serving bench.
// ───────────────────────────────────────────────────────────────────────────
const MODEL = "claude-sonnet-4-6";

/**
 * System block 1 — the served draft prompt. Read from the PINNED SNAPSHOT the
 * governed baseline was captured against, NOT from the prompt store: resolving
 * it live would make an arm comparison depend on whatever the store happens to
 * serve that minute (trap 12c — consecutive reads returned 119/120/119/120),
 * and the whole point of an arm comparison is that block 1 is held fixed.
 */
const PINNED_BLOCK_1 = "tools/graph-evaluator/governed/draft-graph-v5/baseline/pms-draft-graph-v195.txt";

interface Arm { readonly label: string; readonly instruction: string; }

/**
 * Arms are DATA. Two ways to name one:
 *
 *   --candidate <file>         the file IS the whole second system block.
 *   --candidate-append <file>  the file is a DELTA appended to the tree's own
 *                              instruction.
 *
 * The append form exists because most candidate changes are additions, and a
 * full copy of the instruction sitting in the repo is a second authority that
 * WILL drift from the constant it was copied from — this estate's dominant
 * defect. A delta cannot drift: its base is always the live bytes.
 */
function buildArms(): Arm[] {
  const arms: Arm[] = [{ label: "control", instruction: DRAFT_RECORDS_INSTRUCTION }];
  const vacuous = (f: string, text: string) => {
    if (text.trim() === DRAFT_RECORDS_INSTRUCTION.trim()) {
      throw new Error(
        `VACUOUS ARM: candidate "${f}" is identical to the tree's DRAFT_RECORDS_INSTRUCTION. ` +
          `An arm equal to its control measures nothing while looking like a comparison.`,
      );
    }
  };
  for (const f of allValuesOf("candidate")) {
    const text = readFileSync(f, "utf8");
    vacuous(f, text);
    arms.push({ label: `candidate:${f}`, instruction: text });
  }
  for (const f of allValuesOf("candidate-append")) {
    const delta = readFileSync(f, "utf8");
    if (delta.trim().length === 0) {
      throw new Error(`VACUOUS ARM: candidate-append "${f}" is empty — an empty delta is the control.`);
    }
    const text = `${DRAFT_RECORDS_INSTRUCTION}\n\n${delta.trim()}`;
    vacuous(f, text);
    arms.push({ label: `candidate-append:${f}`, instruction: text });
  }
  return arms;
}

async function drawOnce(brief: CorpusBrief, instruction: string, block1: string, key: string) {
  const schema = buildDraftRecordsSchema();
  const body = {
    model: MODEL,
    max_tokens: 12000,
    temperature: 0,
    // Two system blocks, in the adapter's order: the long served prompt first
    // (it is the one that carries the cache breakpoint in production), the
    // output-shape instruction SECOND. `anthropic.ts:506` appends it exactly
    // here, and an arm that put it first would not be measuring the product's
    // composition.
    system: [
      { type: "text", text: block1 },
      { type: "text", text: instruction },
    ],
    messages: [{ role: "user", content: brief.text }],
    output_config: { format: { type: "json_schema", schema } },
  };
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const json = (await res.json()) as Record<string, any>;
  if (!res.ok) return { ok: false as const, detail: `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`, ms };
  const text = (json.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
  let records: unknown;
  try { records = JSON.parse(text); } catch { return { ok: false as const, detail: "unparseable JSON", ms }; }
  // Project through the PRODUCT's own post-LLM seam. Re-implementing projection
  // here would make the harness a second, drifting copy of the thing it
  // measures.
  const seam = projectDraftRecords(records as never, brief.text);
  if (!seam.ok) return { ok: false as const, detail: `${seam.reason}: ${seam.detail}`, ms };
  return {
    ok: true as const,
    graph: seam.projection.graph,
    ms,
    outputTokens: json.usage?.output_tokens as number | undefined,
    inputTokens: json.usage?.input_tokens as number | undefined,
  };
}

async function runLive(briefs: CorpusBrief[], only: string[] | null): Promise<ArmResult[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. --live makes real, paid model calls; nothing is faked and no result " +
        "is invented in its absence. Run --baseline for the offline banked measurement instead.",
    );
  }
  const block1 = readFileSync(PINNED_BLOCK_1, "utf8");
  const arms = buildArms();
  const n = Number(valueOf("n", "1"));
  const corpus = briefs.filter((b) => (only ? only.includes(b.id) : true));
  say(`live: ${arms.length} arm(s) × ${corpus.length} brief(s) × n=${n} = ${arms.length * corpus.length * n} model calls`);

  const out: ArmResult[] = [];
  for (const arm of arms) {
    const scores: DraftQualityScore[] = [];
    for (const brief of corpus) {
      for (let i = 0; i < n; i++) {
        const r = await drawOnce(brief, arm.instruction, block1, key);
        if (!r.ok) { say(`  ${arm.label} ${brief.id}#${i}: DRAW FAILED — ${r.detail}`); continue; }
        scores.push(evaluateDraft({
          briefId: n > 1 ? `${brief.id}#${i}` : brief.id,
          graph: r.graph,
          briefText: brief.text,
          expectStatusQuo: brief.expectStatusQuo,
        }));
        say(`  ${arm.label} ${brief.id}#${i}: ${r.ms}ms ${r.outputTokens ?? "?"}tok`);
      }
    }
    out.push({ arm: arm.label, instructionSha256: sha256(arm.instruction), scores });
  }
  return out;
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ───────────────────────────────────────────────────────────────────────────
async function main() {
  const briefs = loadBriefs();
  const only = valueOf("briefs") ? valueOf("briefs")!.split(",").map((s) => s.trim()) : null;

  const results: ArmResult[] = has("live")
    ? await runLive(briefs, only)
    : [await runBaseline(briefs, only)];

  for (const r of results) { printArm(r); printPerDraft(r.scores); }

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify({ results: results.map((r) => ({ ...r, summary: summarise(r.scores) })) }, null, 2) + "\n");
  }
  const outDir = valueOf("out");
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/draft-quality-eval.json`, JSON.stringify({ results }, null, 2));
    say(`\nevidence: ${outDir}/draft-quality-eval.json`);
  }
}

main().catch((e) => { process.stderr.write(String(e?.stack ?? e) + "\n"); process.exit(1); });
