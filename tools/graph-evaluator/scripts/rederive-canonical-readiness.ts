/**
 * RE-DERIVE canonical analysis readiness for the frozen governed corpus, at the
 * CURRENT tip, on the FROZEN model outputs — in TWO ARMS.
 *
 * ⭐ WHY THIS EXISTS. Two independent reasons, both measured.
 *
 * ── 1. THE GOVERNED RESCORE CANNOT RUN AT THIS TIP ─────────────────────────
 * `governed:draft-graph:rescore` hard-stops at `bf4a1d28` with
 * `CODE_LAYER_DRIFT: canonical_analysis_readiness` — the pinned
 * `analysis-ready-helper.ts` hash moved (commit `2988eacf`, #996). That stop is
 * CORRECT: the frozen baseline's scores were computed against a different
 * readiness assessor than this tree carries, so the pack refuses to present them
 * as comparable. The consequence is that the frozen `canonical_ready_count: 1/14`
 * and its 91-finding taxonomy are not re-derivable through the governed path
 * here, and a lane that inherits those numbers is quoting a measurement taken
 * against code that no longer exists (estate trap 1, one level up).
 *
 * This script re-derives them. It IMPORTS the same two production functions the
 * pack scores with — `transformResponseToV3` and
 * `assessCanonicalAnalysisReadiness` — via the same file-URL specifier pattern,
 * so it owns NO readiness predicate of its own. MEASURED: it reproduces the
 * frozen artefact's verdict and blocking-code multiset for all 14 briefs, which
 * is its positive control (a re-derivation that cannot reproduce a known result
 * is not an instrument).
 *
 * ── 2. THE GOVERNED EVAL MEASURES A PATH THE USER NEVER TAKES ──────────────
 * ⭐⭐ THE FINDING THAT BOUNDS EVERY NUMBER HERE. The governed eval calls the
 * provider and then the readiness authority DIRECTLY. It never runs
 * `runUnifiedPipeline`, so it never runs the deterministic sweep
 * (`stages/repair/deterministic-sweep.ts`) — the estate's structural-repair
 * authority, which on the product path runs BETWEEN the projector and anything
 * that assesses readiness. Independently corroborated at the bytes: every node in
 * all 14 frozen graphs carries NO `category`, and category is inferred later
 * (`graph-validator.ts:83-134`).
 *
 * So the frozen `1/14` is a PRE-SWEEP number. It is a claim about the
 * evaluator's path, not about the model a user receives (estate trap 16 — a
 * capture proves what it was pointed at). This script therefore reports BOTH:
 *
 *   PRE_SWEEP  — projector output straight into readiness (the governed number)
 *   POST_SWEEP — projector output through `runDeterministicSweep`, then readiness
 *
 * ⚠ SCOPE OF THE POST-SWEEP ARM, stated precisely. It runs the SWEEP, not the
 * whole pipeline: no LLM repair stage, no enrichment, no factor extraction. It is
 * therefore a LOWER BOUND on what the product path repairs, not a reproduction of
 * it. The `StageContext` handed to the sweep is partial, and that is grounded
 * rather than assumed: `rg -a -o 'ctx\.[a-zA-Z_]+'` over the sweep's whole source
 * returns exactly nine fields — `causalClaims`, `coaching`, `detectedEdgeFormat`,
 * `deterministicRepairs`, `graph`, `llmRepairNeeded`, `remainingViolations`,
 * `repairTrace`, `requestId` — none of them `request`. All nine are supplied. If
 * the sweep ever reads a tenth, this cast breaks loudly at that property rather
 * than silently measuring a degraded sweep.
 *
 * Neither arm makes a provider call. Both are deterministic and free.
 *
 * Usage:
 *   npx tsx scripts/rederive-canonical-readiness.ts            # table
 *   npx tsx scripts/rederive-canonical-readiness.ts --json     # machine-readable
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = join(HERE, "..");
const REPO_ROOT = join(TOOL_ROOT, "..", "..");
const ARTEFACT = join(
  TOOL_ROOT,
  "governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json",
);

interface FrozenCase {
  readonly brief_id: string;
  readonly graph?: unknown;
  readonly record_disclosures?: readonly unknown[];
  readonly output_tokens?: number;
  readonly latency_ms?: number;
  readonly finish_reason?: string;
}

interface FrozenScore {
  readonly brief_id: string;
  readonly canonical_ready: boolean;
  readonly canonical_blocking_codes: readonly string[];
}

interface Readiness {
  safeToAnalyse: boolean;
  analysisReady?: { status?: unknown };
  blockingIssues: readonly { code?: unknown }[];
}

async function loadProduction(): Promise<{
  assess(graph: unknown): Readiness;
  transform(
    response: { graph: unknown; record_disclosures?: readonly unknown[] },
    context: { brief: string },
  ): unknown;
  sweep(ctx: unknown): Promise<void>;
}> {
  const [readiness, transform, sweep] = await Promise.all([
    import(pathToFileURL(join(REPO_ROOT, "src/orchestrator/tools/analysis-ready-helper.ts")).href),
    import(pathToFileURL(join(REPO_ROOT, "src/cee/transforms/schema-v3.ts")).href),
    import(
      pathToFileURL(join(REPO_ROOT, "src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts"))
        .href
    ),
  ]);
  return {
    assess: readiness.assessCanonicalAnalysisReadiness,
    transform: transform.transformResponseToV3,
    sweep: sweep.runDeterministicSweep,
  };
}

/** The pack's own canonical-shape sniff, restated only because it is not exported. */
function looksLikeCanonicalV3(graph: unknown): boolean {
  if (!graph || typeof graph !== "object") return false;
  const record = graph as Record<string, unknown>;
  if (record.schema_version === "3.0") return true;
  if (!Array.isArray(record.edges) || record.edges.length === 0) return false;
  const first = record.edges[0] as Record<string, unknown> | undefined;
  return Boolean(first && typeof first === "object" && first.strength && typeof first.strength === "object");
}

async function briefBody(briefId: string): Promise<string> {
  try {
    return await readFile(join(TOOL_ROOT, "briefs", `${briefId}.md`), "utf8");
  } catch {
    return "";
  }
}

function tally(codes: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of codes) out[c] = (out[c] ?? 0) + 1;
  return out;
}

function renderCodes(codes: readonly string[]): string {
  return Object.entries(tally([...codes].sort()))
    .map(([k, v]) => (v > 1 ? `${k}x${v}` : k))
    .join(", ");
}

async function assessArm(
  production: Awaited<ReturnType<typeof loadProduction>>,
  capture: FrozenCase,
  brief: string,
  applySweep: boolean,
): Promise<{ ready: boolean; status: string | null; codes: string[]; nodes: number; edges: number }> {
  // Deep clone so the two arms cannot contaminate one another: the sweep MUTATES
  // the graph it is handed. A shared reference here would make the pre-sweep arm
  // a function of whether the post-sweep arm ran first.
  const graph = structuredClone(capture.graph);
  let subject: unknown = graph;

  if (applySweep) {
    const ctx = {
      graph,
      requestId: `rederive-${capture.brief_id}`,
      coaching: undefined,
      causalClaims: undefined,
      detectedEdgeFormat: undefined,
      deterministicRepairs: [] as unknown[],
      llmRepairNeeded: false,
      remainingViolations: [] as unknown[],
      repairTrace: undefined,
    };
    await production.sweep(ctx);
    subject = ctx.graph;
  }

  const canonical = looksLikeCanonicalV3(subject)
    ? subject
    : production.transform(
        {
          graph: subject,
          ...(capture.record_disclosures ? { record_disclosures: capture.record_disclosures } : {}),
        },
        { brief },
      );
  const readiness = production.assess(canonical);
  const g = subject as { nodes?: unknown[]; edges?: unknown[] } | undefined;
  return {
    ready: readiness.safeToAnalyse,
    status: typeof readiness.analysisReady?.status === "string" ? readiness.analysisReady.status : null,
    codes: readiness.blockingIssues.map((i) => String(i.code ?? "UNKNOWN")).sort(),
    nodes: g?.nodes?.length ?? 0,
    edges: g?.edges?.length ?? 0,
  };
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const artefact = JSON.parse(await readFile(ARTEFACT, "utf8")) as {
    run: { cases: readonly FrozenCase[]; scores: readonly FrozenScore[] };
  };
  const production = await loadProduction();
  const frozenById = new Map(artefact.run.scores.map((s) => [s.brief_id, s]));

  type Arm = Awaited<ReturnType<typeof assessArm>>;
  interface Row {
    brief_id: string;
    pre: Arm;
    post: Arm;
    frozen_ready: boolean;
    frozen_codes: string[];
    output_tokens: number | null;
    latency_ms: number | null;
    finish_reason: string | null;
  }
  const rows: Row[] = [];
  for (const capture of artefact.run.cases) {
    if (capture.graph === undefined) continue;
    const brief = await briefBody(capture.brief_id);
    const pre = await assessArm(production, capture, brief, false);
    const post = await assessArm(production, capture, brief, true);
    const frozen = frozenById.get(capture.brief_id);
    rows.push({
      brief_id: capture.brief_id,
      pre,
      post,
      frozen_ready: frozen?.canonical_ready ?? false,
      frozen_codes: [...(frozen?.canonical_blocking_codes ?? [])].sort(),
      output_tokens: capture.output_tokens ?? null,
      latency_ms: capture.latency_ms ?? null,
      finish_reason: capture.finish_reason ?? null,
    });
  }

  const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
  const classes = (pick: (r: Row) => readonly string[]) =>
    Object.fromEntries(
      Object.entries(tally(rows.flatMap((r) => [...pick(r)]))).sort((a, b) => b[1] - a[1]),
    );

  const summary = {
    cases: rows.length,
    // ⭐ THE OUTCOME METRIC, both arms. Reported first and always together with
    // the findings counts, which are the SYMPTOM metric (estate trap 23).
    pre_sweep_canonical_ready_count: rows.filter((r) => r.pre.ready).length,
    post_sweep_canonical_ready_count: rows.filter((r) => r.post.ready).length,
    frozen_canonical_ready_count: rows.filter((r) => r.frozen_ready).length,
    pre_sweep_blocking_issue_count: sum((r) => r.pre.codes.length),
    post_sweep_blocking_issue_count: sum((r) => r.post.codes.length),
    frozen_blocking_issue_count: sum((r) => r.frozen_codes.length),
    pre_sweep_findings_by_class: classes((r) => r.pre.codes),
    post_sweep_findings_by_class: classes((r) => r.post.codes),
    // Positive control for the instrument: this MUST be empty, or the
    // re-derivation disagrees with the artefact it claims to reproduce.
    pre_sweep_disagrees_with_frozen: rows
      .filter(
        (r) =>
          r.pre.ready !== r.frozen_ready || r.pre.codes.join(",") !== r.frozen_codes.join(","),
      )
      .map((r) => r.brief_id),
    // Distributions, not just rates (estate trap 23): a fix that forces a shape
    // while the model keeps terminating early shows the same signature in both
    // arms, so these travel with every readiness claim.
    output_token_distribution: {
      min: Math.min(...rows.map((r) => r.output_tokens ?? 0)),
      max: Math.max(...rows.map((r) => r.output_tokens ?? 0)),
      mean: Math.round(sum((r) => r.output_tokens ?? 0) / rows.length),
    },
    latency_ms_distribution: {
      min: Math.min(...rows.map((r) => r.latency_ms ?? 0)),
      max: Math.max(...rows.map((r) => r.latency_ms ?? 0)),
      mean: Math.round(sum((r) => r.latency_ms ?? 0) / rows.length),
    },
    finish_reasons: tally(rows.map((r) => r.finish_reason ?? "unknown")),
  };

  if (json) {
    process.stdout.write(`${JSON.stringify({ summary, rows }, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `\nRE-DERIVED canonical readiness — frozen graphs, assessor at this tip\n\n` +
      `${"brief".padEnd(28)} ${"PRE".padEnd(4)} ${"POST".padEnd(5)} ${"n_pre".padEnd(6)} ${"n_post".padEnd(7)} post-sweep codes\n`,
  );
  for (const r of rows) {
    process.stdout.write(
      `${r.brief_id.padEnd(28)} ${(r.pre.ready ? "RDY" : "—").padEnd(4)} ${(r.post.ready ? "RDY" : "—").padEnd(5)} ` +
        `${String(r.pre.codes.length).padEnd(6)} ${String(r.post.codes.length).padEnd(7)} ${renderCodes(r.post.codes)}\n`,
    );
  }
  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
