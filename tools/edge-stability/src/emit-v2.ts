/**
 * Edge-Stability phase 2 — offline: adapt every draft in a bakeoff run dir into a
 * PLoT /v2/run request and validate the shape. NO network. Writes the requests so
 * the live flip-rate pass consumes fixed inputs with a PINNED seed.
 *
 *   npx tsx src/emit-v2.ts --run-dir ../bakeoff-v6/results/es-v0 --seed 424242 --out-dir ./v2-requests/es-v0
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { adaptDraftToV2, type V2RunRequest } from "./plot-adapter.ts";

function validate(req: V2RunRequest | null, skip?: string): string[] {
  const errs: string[] = [];
  if (!req) { errs.push(`SKIP: ${skip}`); return errs; }
  if (!req.graph?.nodes?.length) errs.push("empty graph.nodes");
  if (!req.graph?.edges?.length) errs.push("empty graph.edges");
  if (!Array.isArray(req.options) || req.options.length < 2) errs.push(`<2 options (${req.options?.length ?? 0})`);
  if (!req.goal_node_id) errs.push("missing goal_node_id");
  if (!req.seed) errs.push("missing seed");
  // goal must be a graph node
  if (req.goal_node_id && !req.graph.nodes.some((n) => n.id === req.goal_node_id)) errs.push("goal_node_id not in graph.nodes");
  // every intervention factor must be a graph node
  for (const o of req.options ?? []) {
    for (const fid of Object.keys(o.interventions)) {
      if (!req.graph.nodes.some((n) => n.id === fid)) errs.push(`option ${o.id} intervenes on non-graph factor ${fid}`);
    }
  }
  return errs;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    "run-dir": { type: "string" }, seed: { type: "string" }, "out-dir": { type: "string" }, rule: { type: "string" },
  } });
  const runDir = resolve(process.cwd(), (values["run-dir"] as string) ?? "");
  const seed = (values.seed as string) ?? "424242";
  const outDir = resolve(process.cwd(), (values["out-dir"] as string) ?? "./v2-requests");
  const rule = ((values.rule as string) ?? "categorical-and-magnitude-cap") as "categorical-only" | "categorical-and-magnitude-cap";
  mkdirSync(outDir, { recursive: true });

  const dir = join(runDir, "candidates");
  const byBrief: Record<string, { ok: number; total: number; issues: string[] }> = {};
  let totalOk = 0, totalReq = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const c = JSON.parse(readFileSync(join(dir, f), "utf-8")) as { brief_id: string; seed: number; arm?: string; candidate: { nodes: []; edges: [] } | null };
    if (c.arm && c.arm !== "A") continue;
    const b = (byBrief[c.brief_id] ??= { ok: 0, total: 0, issues: [] });
    b.total++; totalReq++;
    const { request, skipReason, synthNotes } = adaptDraftToV2(c.candidate as any, seed, rule);
    const errs = validate(request, skipReason);
    if (errs.length === 0) { b.ok++; totalOk++; writeFileSync(join(outDir, `${c.brief_id}_s${c.seed}.json`), JSON.stringify(request, null, 2)); }
    else b.issues.push(`s${c.seed}: ${errs.join("; ")}`);
    for (const n of synthNotes) b.issues.push(`s${c.seed} note: ${n}`);
  }
  console.log(`V2 requests: ${totalOk}/${totalReq} valid, written to ${outDir} (seed pinned = ${seed}, rule=${rule})`);
  for (const [b, s] of Object.entries(byBrief).sort()) {
    console.log(`  ${b}: ${s.ok}/${s.total} valid${s.issues.length ? " | " + s.issues.slice(0, 6).join(" | ") : ""}`);
  }
}

main().catch((err) => { console.error(`emit-v2 failed: ${(err as Error).message}`); process.exit(1); });
