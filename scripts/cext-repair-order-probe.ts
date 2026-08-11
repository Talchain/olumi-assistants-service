/**
 * P5 — THE REPAIR-ORDER COUNTERFACTUAL PROBE. ⚠ POST-GATE INSTRUMENT.
 *
 * `C-EXT-BUILD-3`: the model complied with the C-ext appendix and emitted
 * factor→goal links, and `simpleRepair` (`services/repair.ts:395-402`) DELETED
 * them before the deterministic sweep's `fixFactorGoalEdges`
 * (`deterministic-sweep.ts:956`, called unconditionally at :1898 with the comment
 * "ALWAYS run regardless of violations") could split them into
 * factor→outcome→goal. Measured on every C-ext run: `factor_goal_splits: 0`.
 *
 * This probe asks the counterfactual at the bytes, with the REAL functions:
 *
 *   A  project → normalise kinds → validateGraph                (what happens)
 *   B  project → normalise kinds → fixFactorGoalEdges → validate (what would
 *                                                                happen if the
 *                                                                splitter ran
 *                                                                FIRST)
 *
 * If B clears the classes A fails on, the diagnosis is an ORDERING defect
 * between two repairs with opposite policies for one edge pattern — not an
 * inadequacy of the instruction. If B does NOT clear them, the instruction is
 * still short and the ordering is a red herring. The probe is written to be able
 * to return either answer.
 *
 * CONTROL: run A must reproduce the codes the LIVE runs reported, or the probe is
 * not measuring the failure it names.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { projectRecordsToGraph } from "../src/spike-c/project.js";
import type { SpikeCRecordSet } from "../src/spike-c/records-schema.js";
import { validateGraph } from "../src/validators/graph-validator.js";
import { NODE_KIND_MAP } from "../src/adapters/llm/normalisation.js";
import { fixFactorGoalEdges } from "../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import { detectEdgeFormat } from "../src/cee/unified-pipeline/utils/edge-format.js";
import { ALLOWED_EDGES } from "../src/validators/graph-validator.types.js";
import type { GraphT } from "../src/schemas/graph.js";

const RUNS = "/Users/paulslee/Documents/GitHub/olumi-docs/PHASE0-EVIDENCE-2026-07-28/arch-decision-2026-08-11/spike/runs/arm-C_EXT";

function decodeRecords(runDir: string): SpikeCRecordSet | null {
  const provDir = join(runDir, "provider");
  let best: string | null = null;
  let bestBytes = -1;
  for (const f of readdirSync(provDir)) {
    const rec = JSON.parse(readFileSync(join(provDir, f), "utf8"));
    const bytes = rec?.response?.body_bytes ?? 0;
    if (bytes > bestBytes) { bestBytes = bytes; best = join(provDir, f); }
  }
  if (!best) return null;
  const rec = JSON.parse(readFileSync(best, "utf8"));
  let buf = "";
  for (const line of String(rec?.response?.body_text ?? "").split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const frame = JSON.parse(line.slice(6));
      buf += frame?.delta?.partial_json ?? frame?.delta?.text ?? "";
    } catch { /* non-JSON frame */ }
  }
  try { return JSON.parse(buf) as SpikeCRecordSet; } catch { return null; }
}

function normaliseKinds<T extends { nodes: { kind: string }[] }>(g: T): T {
  for (const n of g.nodes) n.kind = NODE_KIND_MAP[n.kind.toLowerCase().trim()] ?? "option";
  return g;
}

/**
 * `simpleRepair`'s exact filter (`services/repair.ts:395-402`): remove every edge
 * whose (fromKind,toKind) is not in ALLOWED_EDGES. Category is NOT consulted there
 * (`isEdgeAllowed(fromKind,toKind)` takes kinds only), so this reproduces the
 * deletion the live pipeline performs BEFORE the sweep.
 */
function applySimpleRepairEdgeFilter(g: { nodes: { id: string; kind: string }[]; edges: { from: string; to: string }[] }) {
  const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const before = g.edges.length;
  g.edges = g.edges.filter((e) => {
    const f = kind.get(e.from), t = kind.get(e.to);
    if (!f || !t) return true;
    return ALLOWED_EDGES.some((r) => r.fromKind === f && r.toKind === t);
  });
  return before - g.edges.length;
}

function codes(graph: unknown) {
  const res = validateGraph({ graph: graph as GraphT, requestId: "p5-order-probe", phase: "post_repair" });
  const c: Record<string, number> = {};
  for (const i of res.errors) c[i.code] = (c[i.code] ?? 0) + 1;
  return c;
}

const dirs: string[] = [];
for (const brief of readdirSync(RUNS)) for (const run of readdirSync(join(RUNS, brief))) dirs.push(join(RUNS, brief, run));

console.log("== P5 REPAIR-ORDER COUNTERFACTUAL — A: as the pipeline runs it · B: splitter FIRST ==\n");
let splitFired = 0;
for (const d of dirs.sort()) {
  let rs: SpikeCRecordSet | null = null;
  try { rs = decodeRecords(d); } catch { rs = null; }
  if (!rs?.stated_items) { console.log(`SKIP ${d.split("/").pop()} — no decodable record set (run in flight?)`); continue; }
  const a = normaliseKinds(projectRecordsToGraph(rs).graph);
  const live = normaliseKinds(projectRecordsToGraph(rs).graph);
  const deleted = applySimpleRepairEdgeFilter(live as never);
  const b = normaliseKinds(projectRecordsToGraph(rs).graph);
  const fmt = detectEdgeFormat(b.edges as never);
  const split = fixFactorGoalEdges(b as unknown as GraphT, fmt);
  if (split.splitCount > 0) splitFired++;
  console.log(`--- ${d.split("/").slice(-2).join("/")}`);
  console.log(`    A  (projection)      edges=${a.edges.length}  ${JSON.stringify(codes(a))}`);
  console.log(`    A' (simpleRepair)    edges=${live.edges.length} (deleted ${deleted})  ${JSON.stringify(codes(live))}   <- what the LIVE gate sees`);
  console.log(`    B  (splitter 1st)    edges=${b.edges.length}  splits=${split.splitCount}  ${JSON.stringify(codes(b))}`);
}
console.log(`\n[control] the splitter fired on ${splitFired}/${dirs.length} runs — if 0, the counterfactual is vacuous and B proves nothing`);
