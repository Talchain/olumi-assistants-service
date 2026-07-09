/**
 * Edge-Stability Harness (Sci-1A) — v0 report runner.
 *
 *   npx tsx src/run.ts --run-dir ../bakeoff-v6/results/es-v0 --label es-v0 [--attribution-ref <sha>]
 *
 * Consumes a bakeoff-v6 run directory (candidates in the standard record shape:
 * one arm x brief x seed, drafted graph in `candidate`), groups drafts by brief,
 * computes deterministic stability metrics, and writes a markdown + JSON report
 * artifact. The multi-seed draft run itself is produced by the bakeoff runner
 * (`run.ts --arms A --seeds a,b,c,d,e`); this tool measures it.
 *
 * Outcome-stability (recommended-option flip via live PLoT /v2/run) is phase 2,
 * added once the read-only draft->PLoT adapter lands (pinned ISL seed).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { briefStability, type Draft, type BriefStability } from "./metrics.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Candidate {
  brief_id: string; seed: number; arm: string;
  candidate: { nodes?: Array<{ id: string; kind: string; label: string }>; edges?: Array<Record<string, unknown>> } | null;
  served_models?: string[];
  prompt_hashes?: Record<string, string>;
}

function toDraft(c: Candidate): Draft {
  const g = c.candidate ?? {};
  const nodes = g.nodes ?? [];
  const idToLabel = new Map(nodes.map((n) => [n.id, n.label ?? n.id]));
  const nodeLabelsByKind: Record<string, string[]> = {};
  for (const n of nodes) (nodeLabelsByKind[n.kind] ??= []).push(n.label ?? n.id);
  const edges = (g.edges ?? []).map((e) => {
    const strength = (e.strength as { mean?: number; std?: number }) ?? {};
    return {
      fromLabel: idToLabel.get(e.from as string) ?? String(e.from),
      toLabel: idToLabel.get(e.to as string) ?? String(e.to),
      strengthMean: Number(strength.mean ?? e.strength_mean ?? 0),
      strengthStd: Number(strength.std ?? e.strength_std ?? 0),
      existsProbability: Number(e.exists_probability ?? 1),
    };
  });
  return { seed: c.seed, nodeLabelsByKind, nodeCount: nodes.length, edgeCount: edges.length, edges };
}

function loadRun(runDir: string): { byBrief: Map<string, Draft[]>; attribution: { models: string[]; promptHashes: Set<string>; arm: string } } {
  const dir = join(runDir, "candidates");
  const byBrief = new Map<string, Draft[]>();
  const models = new Set<string>(); const promptHashes = new Set<string>(); let arm = "A";
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const c = JSON.parse(readFileSync(join(dir, f), "utf-8")) as Candidate;
    if (c.arm && c.arm !== "A") continue; // edge-stability measures the draft (arm A / arm-c M1)
    arm = c.arm ?? "A";
    (byBrief.get(c.brief_id) ?? byBrief.set(c.brief_id, []).get(c.brief_id)!).push(toDraft(c));
    for (const m of c.served_models ?? []) models.add(m);
    const ph = c.prompt_hashes ?? {};
    if (ph["arm-a.system.txt"]) promptHashes.add(ph["arm-a.system.txt"]);
  }
  return { byBrief, attribution: { models: [...models], promptHashes, arm } };
}

function pct(x: number): string { return `${Math.round(x * 100)}%`; }
function fmtCV(x: number | null): string { return x === null ? "—" : `${(x * 100).toFixed(0)}%`; }

function report(runLabel: string, briefs: BriefStability[], attribution: { models: string[]; promptHashes: Set<string>; arm: string }, ref: string): string {
  const seeds = briefs[0]?.seeds ?? [];
  const L: string[] = [];
  L.push(`# Edge-Stability v0 — ${runLabel}\n`);
  L.push(`**The parameter lottery, measured.** Each brief drafted ${seeds.length}× (seeds ${seeds.join(", ")} — independent draws). Deterministic metrics only; no semantic judging.\n`);
  L.push(`**Change attribution:** model \`${attribution.models.join(", ") || "?"}\` · served prompt hash(es) \`${[...attribution.promptHashes].map((h) => h.slice(0, 12)).join(", ") || "?"}\` · harness ref \`${ref}\`. Outcome-stability (PLoT flip-rate) is phase 2 (adapter pending).\n`);
  // Completeness guard: a brief with <2 draws cannot have stability measured; uneven counts = an incomplete run.
  const maxDraws = Math.max(...briefs.map((b) => b.seeds.length), 0);
  const incomplete = briefs.filter((b) => b.seeds.length < maxDraws);
  const degenerate = briefs.filter((b) => b.seeds.length < 2);
  if (incomplete.length || degenerate.length) {
    L.push(`> ⚠ **INCOMPLETE RUN.** Expected ${maxDraws} draws/brief. ${incomplete.map((b) => `${b.briefId}=${b.seeds.length}`).join(", ") || "—"}. Briefs with <2 draws report no stability (single-draw metrics are trivially "100% reproducible" and are excluded from the top-line). Re-run to complete before trusting the verdict.\n`);
  }
  // Top-line verdict — computed only over briefs with >=2 draws (single-draw briefs are trivially "100%").
  const M = briefs.filter((b) => b.seeds.length >= 2);
  const denom = Math.max(M.length, 1);
  const avgSharedFuzzy = M.reduce((a, b) => a + b.sharedNodeLabelRateFuzzy, 0) / denom;
  const avgSharedExact = M.reduce((a, b) => a + b.sharedNodeLabelRate, 0) / denom;
  const avgEdgeCV = M.reduce((a, b) => a + (b.edgeCount.cv ?? 0), 0) / denom;
  const totCausal = M.reduce((a, b) => a + b.causalRecurring, 0);
  const totCausalStable = M.reduce((a, b) => a + b.causalStable, 0);
  const totSignFlips = M.reduce((a, b) => a + b.signFlips, 0);
  L.push(`## Top-line`);
  L.push(`- **Cleanest finding (method-INSENSITIVE) — ${totSignFlips} sign flip${totSignFlips === 1 ? "" : "s"}.** ${totSignFlips === 0 ? "No causal edge reversed direction across draws." : `A causal edge was drawn with a positive coefficient in some draws and a negative one in others — the effect DIRECTION reversed. This does not depend on the label-matching method (same edge identity, opposite sign), so it is the most robust single result. See the flagged ⚠SIGN-FLIP row(s) below.`}`);
  L.push(`- **Structural churn dominates (method-SENSITIVE — see caveat).** Under this canonicalisation (fuzzy token-Jaccard ≥ 0.6, n = ${seeds.length} draws × ${briefs.length} briefs), node-label reproducibility across all draws is **${pct(avgSharedFuzzy)}** fuzzy / ${pct(avgSharedExact)} exact, and most edges appear in only 1 of ${seeds.length} draws. The model re-issues node ids and rewords labels each draw. A stricter or looser matcher moves these numbers, so treat them as method-relative until the canonicalisation is reviewed.`);
  L.push(`- **Coefficient reproducibility (causal edges recurring in ≥2 draws; structural edges pinned at 1.0 by the grammar excluded):** ${totCausalStable}/${totCausal} numerically stable (strength.mean CV ≤ 15%). When a causal edge recurs, its coefficient is usually steady; recurrence is the scarce resource.`);
  L.push(`- **Edge-count variability:** mean CV ${fmtCV(avgEdgeCV)} across briefs.`);
  L.push(`\n> **Public-claims discipline:** no external claim about draft reliability until the outcome-stability flip-rate (phase 2) exists — structural churn may be fully absorbed by the analysis (same decision, different wording) or may move the answer; only the flip-rate settles that. The reproducibility percentages above are method-relative and pre-Neil-review.\n`);

  L.push(`## Per-brief structural stability`);
  L.push(`| brief | nodes (mean·cv) | edges (mean·cv) | node-label reprod. (fuzzy/exact) | edges in ALL ${seeds.length} | edges in 1 only | median appearance |`);
  L.push(`|---|---|---|---|---|---|---|`);
  for (const b of briefs) {
    L.push(`| ${b.briefId} | ${b.nodeCount.mean.toFixed(1)}·${fmtCV(b.nodeCount.cv)} | ${b.edgeCount.mean.toFixed(1)}·${fmtCV(b.edgeCount.cv)} | ${pct(b.sharedNodeLabelRateFuzzy)}/${pct(b.sharedNodeLabelRate)} | ${b.edgesInAllDrafts} | ${b.edgesInOneDraftOnly} | ${pct(b.medianAppearanceRate)} |`);
  }
  L.push("");

  L.push(`## Per-edge instability heatmap (edges recurring in ≥2 draws, worst CV first)`);
  L.push(`Only edges whose canonical (from-label → to-label) identity recurs are numerically comparable. High strength.mean CV = the drafted coefficient swings between draws.\n`);
  for (const b of briefs) {
    // causal edges first (structural pinned-1.0 edges are trivially stable), then sign-flips/high-CV to the top
    const causal = b.canonicalEdges.filter((e) => e.seedsPresent.length >= 2 && !e.structural)
      .sort((x, y) => Number(y.signFlip) - Number(x.signFlip) || (y.meanCV ?? -1) - (x.meanCV ?? -1));
    if (causal.length === 0) { L.push(`**${b.briefId}** — no causal edge recurred in ≥2 draws (total structural churn on the coefficients).\n`); continue; }
    L.push(`**${b.briefId}** (${b.causalRecurring} recurring causal edges; ${b.signFlips} sign-flip)`);
    L.push(`| from → to | appears | strength.mean CV | means |`);
    L.push(`|---|---|---|---|`);
    for (const e of causal.slice(0, 10)) {
      const flag = e.signFlip ? " ⚠SIGN-FLIP" : "";
      L.push(`| ${e.fromLabel} → ${e.toLabel} | ${e.seedsPresent.length}/${seeds.length} | ${fmtCV(e.meanCV)}${flag} | ${e.meanValues.join(", ")} |`);
    }
    L.push("");
  }
  L.push(`## Method notes`);
  L.push(`- Canonical edge identity = normalised (from-label → to-label), exact tier + deterministic fuzzy tier (token Jaccard ≥ 0.6 on both endpoints). Semantic matching is out of scope (deterministic-only mandate); non-recurrence is reported as low appearance rate, not silently dropped.`);
  L.push(`- CV = std/|mean| over the draws where the canonical edge is present (≥2). "Numerically stable" = strength.mean CV ≤ 15% (a v0 provisional threshold; the defensible threshold is a Neil-review item).`);
  L.push(`- Seeds are independent-draw labels (Anthropic exposes no sampling seed); variance is inherent draft nondeterminism under the served-like config (arm A, no temperature / adaptive thinking).`);
  return L.join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    "run-dir": { type: "string" },
    label: { type: "string" },
    "attribution-ref": { type: "string" },
    "out-dir": { type: "string" },
  } });
  const runDir = resolve(process.cwd(), (values["run-dir"] as string) ?? "");
  if (!values["run-dir"]) throw new Error("--run-dir <bakeoff run dir> is required");
  const label = (values.label as string) ?? "es-run";
  const ref = (values["attribution-ref"] as string) ?? "unversioned";
  const outDir = resolve(process.cwd(), (values["out-dir"] as string) ?? join(HERE, "../reports"));
  mkdirSync(outDir, { recursive: true });

  const { byBrief, attribution } = loadRun(runDir);
  const briefs = [...byBrief.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, drafts]) => briefStability(id, drafts));

  const md = report(label, briefs, attribution, ref);
  const jsonArtifact = {
    label, attribution: { models: attribution.models, promptHashes: [...attribution.promptHashes], armMeasured: attribution.arm, ref },
    briefs,
  };
  writeFileSync(join(outDir, `${label}.md`), md);
  writeFileSync(join(outDir, `${label}.json`), JSON.stringify(jsonArtifact, null, 2));
  console.log(`edge-stability report: ${join(outDir, `${label}.md`)}`);
  console.log(`briefs: ${briefs.length} | seeds/brief: ${briefs[0]?.seeds.length ?? 0}`);
  for (const b of briefs) console.log(`  ${b.briefId}: node-label reprod ${pct(b.sharedNodeLabelRateFuzzy)} fuzzy, edges-in-all ${b.edgesInAllDrafts}, causal-recurring ${b.causalRecurring} (stable ${b.causalStable}, sign-flips ${b.signFlips})`);
}

main().catch((err) => { console.error(`edge-stability failed: ${(err as Error).message}`); process.exit(1); });
