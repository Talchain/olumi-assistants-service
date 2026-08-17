/**
 * COUNTERFACTUAL BOUND — what is closing `NO_GOAL` actually worth?
 *
 * ⚠⚠ THIS IS A BOUND, NOT A FIX, AND NOT A MEASUREMENT OF ONE. It answers one
 * question and nothing else: *if the completion turn's new `no_goal` ask succeeds
 * and the model files the objective it already demonstrably knows, how many of
 * the frozen 14 briefs become canonically analysable?*
 *
 * It answers that by INJECTING a goal node into the three goal-less graphs and
 * re-assessing. The injected label is a deliberately inert placeholder, never a
 * candidate objective read off the graph — the product must never do this, and
 * this script is not the product. It exists so the lane can report the VALUE of
 * the ask rather than assert it, and so a reader can see the ceiling without a
 * live LLM spend.
 *
 * The second arm answers the same question for the duplicate-goal collapse, which
 * CANNOT be replayed from the frozen artefact: the artefact stores projector
 * OUTPUT (graphs), not the record sets the projector consumes, so the fix's real
 * input is not in the file. Merging byte-identical goal nodes post-hoc is the
 * closest observable equivalent, and it is labelled as a simulation throughout.
 *
 * Every arm starts from the POST-SWEEP graph, because that is the product path
 * (see `rederive-canonical-readiness.ts` for why the governed pre-sweep number is
 * not the user's number).
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

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

async function load() {
  const [readiness, transform, sweep] = await Promise.all([
    import(pathToFileURL(join(REPO_ROOT, "src/orchestrator/tools/analysis-ready-helper.ts")).href),
    import(pathToFileURL(join(REPO_ROOT, "src/cee/transforms/schema-v3.ts")).href),
    import(
      pathToFileURL(join(REPO_ROOT, "src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts"))
        .href
    ),
  ]);
  return {
    assess: readiness.assessCanonicalAnalysisReadiness as (g: unknown) => {
      safeToAnalyse: boolean;
      blockingIssues: readonly { code?: unknown }[];
    },
    transform: transform.transformResponseToV3 as (r: unknown, c: { brief: string }) => unknown,
    sweep: sweep.runDeterministicSweep as (ctx: unknown) => Promise<void>,
  };
}

/**
 * Merge goal nodes that share a byte-identical label, rewiring every edge onto the
 * survivor. The observable equivalent of the projector's stated-goal collapse.
 */
function mergeIdenticalGoals(graph: Graph): Graph {
  const survivorByLabel = new Map<string, string>();
  const remap = new Map<string, string>();
  const kept: Array<Record<string, unknown>> = [];
  for (const node of graph.nodes) {
    if (node.kind !== "goal") {
      kept.push(node);
      continue;
    }
    const label = String(node.label ?? "");
    const survivor = survivorByLabel.get(label);
    if (survivor === undefined) {
      survivorByLabel.set(label, String(node.id));
      kept.push(node);
    } else {
      remap.set(String(node.id), survivor);
    }
  }
  const edges = graph.edges
    .map((e) => ({
      ...e,
      from: remap.get(String(e.from)) ?? e.from,
      to: remap.get(String(e.to)) ?? e.to,
    }))
    .filter((e) => e.from !== e.to);
  return { nodes: kept, edges };
}

/** Inject an inert goal and link every terminal outcome/risk to it. */
function injectGoal(graph: Graph): Graph {
  if (graph.nodes.some((n) => n.kind === "goal")) return graph;
  const goalId = "counterfactual_goal";
  const nodes = [
    ...graph.nodes,
    { id: goalId, kind: "goal", label: "(counterfactual placeholder objective)" },
  ];
  const hasOutbound = new Set(graph.edges.map((e) => String(e.from)));
  const bridges = graph.nodes.filter(
    (n) => (n.kind === "outcome" || n.kind === "risk") && !hasOutbound.has(String(n.id)),
  );
  const edges = [
    ...graph.edges,
    ...bridges.map((n) => ({
      id: `cf_${String(n.id)}`,
      from: String(n.id),
      to: goalId,
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: "positive",
    })),
  ];
  return { nodes, edges };
}

async function main(): Promise<void> {
  const artefact = JSON.parse(await readFile(ARTEFACT, "utf8")) as {
    run: { cases: Array<{ brief_id: string; graph?: Graph; record_disclosures?: unknown[] }> };
  };
  const p = await load();

  const arms = {
    post_sweep: 0,
    post_sweep_plus_goal_merge: 0,
    post_sweep_plus_goal_injection: 0,
    post_sweep_plus_both: 0,
  };
  const perBrief: Array<Record<string, unknown>> = [];

  for (const c of artefact.run.cases) {
    if (!c.graph) continue;
    const brief = await readFile(join(TOOL_ROOT, "briefs", `${c.brief_id}.md`), "utf8").catch(() => "");

    const sweptOnce = async (): Promise<Graph> => {
      const graph = structuredClone(c.graph!);
      const ctx = {
        graph,
        requestId: `cf-${c.brief_id}`,
        coaching: undefined,
        causalClaims: undefined,
        detectedEdgeFormat: undefined,
        deterministicRepairs: [] as unknown[],
        llmRepairNeeded: false,
        remainingViolations: [] as unknown[],
        repairTrace: undefined,
      };
      await p.sweep(ctx);
      return ctx.graph as Graph;
    };

    const score = (g: Graph) => {
      const canonical = p.transform(
        { graph: g, ...(c.record_disclosures ? { record_disclosures: c.record_disclosures } : {}) },
        { brief },
      );
      const r = p.assess(canonical);
      // ⭐ CODES, not just a count. A count cannot say WHICH blocker a change
      // revealed or introduced, and both questions matter here: brief 05's
      // post-injection findings are CONNECTIVITY, brief 10's are OPTION-VALUE, and
      // a bare "1 → 4" reads as one phenomenon when it is two. It also exposes
      // class changes that a net count MASKS — brief 08 loses two mapping codes
      // and gains `NO_PATH_TO_GOAL` across the sweep while its total merely falls.
      const codes: Record<string, number> = {};
      for (const i of r.blockingIssues) {
        const k = String(i.code ?? "UNKNOWN");
        codes[k] = (codes[k] ?? 0) + 1;
      }
      return { ready: r.safeToAnalyse, n: r.blockingIssues.length, codes };
    };

    const base = score(await sweptOnce());
    const merged = score(mergeIdenticalGoals(await sweptOnce()));
    const injected = score(injectGoal(await sweptOnce()));
    const both = score(injectGoal(mergeIdenticalGoals(await sweptOnce())));

    if (base.ready) arms.post_sweep += 1;
    if (merged.ready) arms.post_sweep_plus_goal_merge += 1;
    if (injected.ready) arms.post_sweep_plus_goal_injection += 1;
    if (both.ready) arms.post_sweep_plus_both += 1;

    perBrief.push({
      brief_id: c.brief_id,
      post_sweep: base,
      plus_goal_merge: merged,
      plus_goal_injection: injected,
      plus_both: both,
    });
  }

  process.stdout.write(
    `\nCOUNTERFACTUAL BOUND — canonical_ready_count out of ${perBrief.length}\n` +
      `${JSON.stringify(arms, null, 2)}\n\n`,
  );
  process.stdout.write(
    `${"brief".padEnd(28)} ${"post".padEnd(6)} ${"+merge".padEnd(8)} ${"+goal".padEnd(8)} ${"+both".padEnd(8)} codes after goal injection\n`,
  );
  const f = (x: unknown) => {
    const v = x as { ready: boolean; n: number };
    return `${v.ready ? "RDY" : "—"}/${v.n}`;
  };
  for (const r of perBrief) {
    const inj = r.plus_goal_injection as { codes: Record<string, number> };
    const codes = Object.entries(inj.codes)
      .map(([k, v]) => (v > 1 ? `${k}x${v}` : k))
      .join(", ");
    process.stdout.write(
      `${String(r.brief_id).padEnd(28)} ${f(r.post_sweep).padEnd(6)} ${f(r.plus_goal_merge).padEnd(8)} ${f(r.plus_goal_injection).padEnd(8)} ${f(r.plus_both).padEnd(8)} ${codes}\n`,
    );
  }
  process.stdout.write(`\nCLASS CHANGE ACROSS THE SWEEP (post-sweep codes, for masking attribution)\n`);
  for (const r of perBrief) {
    const base = r.post_sweep as { codes: Record<string, number> };
    const codes = Object.entries(base.codes)
      .map(([k, v]) => (v > 1 ? `${k}x${v}` : k))
      .join(", ");
    process.stdout.write(`${String(r.brief_id).padEnd(28)} ${codes}\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
