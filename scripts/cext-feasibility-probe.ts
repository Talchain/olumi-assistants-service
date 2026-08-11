/**
 * C-EXT PRE-REGISTRATION FEASIBILITY PROBE (post-gate instrument, named as such).
 *
 * ⚠ NOT the approved classifier. It answers ONE mechanical question, at the
 * CONSUMER's bytes, BEFORE any C-ext token is spent:
 *
 *   if the model emitted the option-origin and goal-terminating causal links the
 *   C-ext appendix asks for, WHICH structural validator errors would remain?
 *
 * It runs the REAL `validateGraph` on the REAL `projectRecordsToGraph` output,
 * AFTER applying the pipeline's own `normaliseNodeKind` (adapters/llm/
 * normalisation.ts:88) — WITHOUT which the probe measures a graph no consumer
 * ever sees. ⚠ THE FIRST CUT OMITTED THAT STEP and therefore reported every
 * stated `constraint` as an unconditionally-invalid node; the live path maps
 * `constraint → risk` (NODE_KIND_MAP:47), which is a legal bridge kind. The
 * correction is recorded rather than smoothed: a probe pointed at the wrong
 * graph agrees with itself perfectly.
 *
 * It does NOT run the repair sweep (that needs a StageContext); every remaining
 * code is therefore REMAINING-AT-PROJECTION, an UPPER BOUND on what the live
 * enforcement gate would see, and the sweep functions known to address each are
 * NAMED at file:line rather than assumed to work.
 *
 * CONTROLS (trap 13/13e), in the same invocation:
 *   · BASELINE   — a real captured arm-C record set, unchanged. Must reproduce
 *                  the live failure classes, or the probe is not measuring the
 *                  thing that failed.
 *   · CONTRAST   — the same set with the C-ext links added. A different answer
 *                  is the discrimination; an identical answer would mean the
 *                  probe is blind (trap 20).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { projectRecordsToGraph } from "../src/spike-c/project.js";
import type { SpikeCRecordSet, SpikeCInferenceClaim } from "../src/spike-c/records-schema.js";
import { validateGraph } from "../src/validators/graph-validator.js";
import { NODE_KIND_MAP } from "../src/adapters/llm/normalisation.js";
import type { GraphT } from "../src/schemas/graph.js";

const RUNS = "/Users/paulslee/Documents/GitHub/olumi-docs/PHASE0-EVIDENCE-2026-07-28/arch-decision-2026-08-11/spike/runs/arm-C";

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
  const body: string = rec?.response?.body_text ?? "";
  let buf = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const frame = JSON.parse(line.slice(6));
      buf += frame?.delta?.partial_json ?? frame?.delta?.text ?? "";
    } catch { /* non-JSON frame */ }
  }
  try { return JSON.parse(buf) as SpikeCRecordSet; } catch { return null; }
}

/** The pipeline's own kind normalisation — the material half for a structural probe. */
function normaliseKinds<T extends { nodes: { kind: string }[] }>(graph: T): T {
  for (const n of graph.nodes) n.kind = NODE_KIND_MAP[n.kind.toLowerCase().trim()] ?? "option";
  return graph;
}

function codesOf(graph: unknown) {
  const res = validateGraph({ graph: graph as GraphT, requestId: "cext-probe", phase: "post_repair" });
  const counts: Record<string, number> = {};
  for (const i of res.errors) counts[i.code] = (counts[i.code] ?? 0) + 1;
  return counts;
}

function kindCounts(graph: { nodes: { kind: string }[] }) {
  const c: Record<string, number> = {};
  for (const n of graph.nodes) c[n.kind] = (c[n.kind] ?? 0) + 1;
  return c;
}

/** MIN variant: one option-origin link per option into ONE shared factor, plus that factor → goal. */
function cextMin(rs: SpikeCRecordSet): SpikeCRecordSet {
  const stated = rs.stated_items ?? [];
  const claims: SpikeCInferenceClaim[] = [...(rs.claims ?? [])];
  const optionIdx = stated.map((s, i) => [s, i] as const).filter(([s]) => s.kind === "option").map(([, i]) => i);
  const goalIdx = stated.findIndex((s) => s.kind === "goal");
  let f = claims.findIndex((c) => c.claim_kind === "factor");
  if (f < 0) { claims.push({ claim_kind: "factor", label: "Delivery capacity", category: "controllable" }); f = claims.length - 1; }
  for (const oi of optionIdx) claims.push({ claim_kind: "causal_link", label: `option ${oi} moves the factor`, from_ref: `s${oi}`, to_ref: `c${f}`, effect: "positive", strength: 0.5 });
  if (goalIdx >= 0) claims.push({ claim_kind: "causal_link", label: "the factor moves the goal", from_ref: `c${f}`, to_ref: `s${goalIdx}`, effect: "positive", strength: 0.5 });
  return { stated_items: stated, claims };
}

/**
 * FULL variant: what FULL COMPLIANCE with the C-ext appendix looks like —
 * every option links to a distinct controllable factor claim; every factor claim
 * and every stated figure/constraint links onward to the goal. Nothing is
 * dropped from the record set; only links are added.
 */
function cextFull(rs: SpikeCRecordSet): SpikeCRecordSet {
  const stated = rs.stated_items ?? [];
  const claims: SpikeCInferenceClaim[] = [...(rs.claims ?? [])];
  const optionIdx = stated.map((s, i) => [s, i] as const).filter(([s]) => s.kind === "option").map(([, i]) => i);
  const goalIdx = stated.findIndex((s) => s.kind === "goal");
  const factorClaimIdx = claims.map((c, i) => [c, i] as const).filter(([c]) => c.claim_kind === "factor" || c.claim_kind === "prior").map(([, i]) => i);
  // ensure at least one factor claim per option
  while (factorClaimIdx.length < optionIdx.length) {
    claims.push({ claim_kind: "factor", label: `Mechanism ${factorClaimIdx.length + 1}`, category: "controllable" });
    factorClaimIdx.push(claims.length - 1);
  }
  optionIdx.forEach((oi, k) => {
    claims.push({ claim_kind: "causal_link", label: `option ${oi} moves mechanism ${k}`, from_ref: `s${oi}`, to_ref: `c${factorClaimIdx[k % factorClaimIdx.length]}`, effect: "positive", strength: 0.5 });
  });
  if (goalIdx >= 0) {
    for (const fi of factorClaimIdx) claims.push({ claim_kind: "causal_link", label: `mechanism ${fi} moves the goal`, from_ref: `c${fi}`, to_ref: `s${goalIdx}`, effect: "positive", strength: 0.5 });
    stated.forEach((s, i) => {
      if (s.kind === "figure" || s.kind === "constraint") {
        claims.push({ claim_kind: "causal_link", label: `stated ${s.kind} ${i} bears on the goal`, from_ref: `s${i}`, to_ref: `s${goalIdx}`, effect: "positive", strength: 0.4 });
      }
    });
  }
  return { stated_items: stated, claims };
}

const runDirs: string[] = [];
for (const brief of readdirSync(RUNS)) for (const run of readdirSync(join(RUNS, brief))) runDirs.push(join(RUNS, brief, run));

console.log("== C-EXT FEASIBILITY PROBE — validator-only, WITH pipeline node-kind normalisation ==\n");
let baselineNonEmpty = 0, minDiffered = 0, fullDiffered = 0, fullClean = 0;
for (const dir of runDirs.sort()) {
  const rs = decodeRecords(dir);
  if (!rs?.stated_items) { console.log(`SKIP ${dir.split("/").pop()}`); continue; }
  const b = normaliseKinds(projectRecordsToGraph(rs).graph);
  const m = normaliseKinds(projectRecordsToGraph(cextMin(structuredClone(rs))).graph);
  const f = normaliseKinds(projectRecordsToGraph(cextFull(structuredClone(rs))).graph);
  const bc = codesOf(b), mc = codesOf(m), fc = codesOf(f);
  if (Object.keys(bc).length) baselineNonEmpty++;
  if (JSON.stringify(bc) !== JSON.stringify(mc)) minDiffered++;
  if (JSON.stringify(bc) !== JSON.stringify(fc)) fullDiffered++;
  if (!Object.keys(fc).length) fullClean++;
  console.log(`--- ${dir.split("/").slice(-2).join("/")}  stated=${rs.stated_items.length} claims=${(rs.claims ?? []).length}`);
  console.log(`    BASELINE  ${JSON.stringify(kindCounts(b))} e=${b.edges.length}  ${JSON.stringify(bc)}`);
  console.log(`    C-EXT-MIN ${JSON.stringify(kindCounts(m))} e=${m.edges.length}  ${JSON.stringify(mc)}`);
  console.log(`    C-EXT-FULL${JSON.stringify(kindCounts(f))} e=${f.edges.length}  ${JSON.stringify(fc)}`);
}
console.log(`\n[control] BASELINE non-empty on ${baselineNonEmpty}/${runDirs.length} (must be >0)`);
console.log(`[control] C-EXT-MIN differed from BASELINE on ${minDiffered}/${runDirs.length} (must be >0)`);
console.log(`[control] C-EXT-FULL differed from BASELINE on ${fullDiffered}/${runDirs.length} (must be >0)`);
console.log(`[result ] C-EXT-FULL validator-CLEAN at projection on ${fullClean}/${runDirs.length}`);
