/**
 * Edge-Stability Harness (Sci-1A) — deterministic metrics core.
 *
 * Measures the "parameter lottery": run one brief through the draft path N times
 * (different seeds = independent draws; Anthropic has no sampling-seed param, so
 * the variance is inherent LLM nondeterminism) and quantify how reproducible the
 * drafted numbers and structure are. DETERMINISTIC ONLY — no semantic judging.
 *
 * Consumes bakeoff-v6 candidate records directly (identical record shape): each
 * file is one arm x brief x seed, with the drafted graph in `candidate`.
 *
 * The hard finding driving the design: independent draws re-issue different node
 * IDs and reword labels, so edges are keyed by CANONICAL (from-label -> to-label)
 * identity, with an exact tier and a deterministic fuzzy tier (token Jaccard).
 * Edges that do not recur are not failures to match — non-recurrence IS the
 * instability, captured as appearance rate. Semantic matching stays out of scope.
 */

export interface DraftEdge {
  fromLabel: string;
  toLabel: string;
  strengthMean: number;
  strengthStd: number;
  existsProbability: number;
}
export interface Draft {
  seed: number;
  nodeLabelsByKind: Record<string, string[]>;
  nodeCount: number;
  edgeCount: number;
  edges: DraftEdge[];
}

export function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).join(" ");
}
function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter(Boolean));
}
export function jaccard(a: string, b: string): number {
  const sa = tokens(a), sb = tokens(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

const FUZZY_THRESHOLD = 0.6;

/** Deterministic mean/std/cv. cv = std/|mean|; null when mean ~ 0 or n < 2. */
export function stats(xs: number[]): { mean: number; std: number; cv: number | null; n: number } {
  const n = xs.length;
  if (n === 0) return { mean: 0, std: 0, cv: null, n };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  const std = Math.sqrt(variance);
  const cv = n >= 2 && Math.abs(mean) > 1e-9 ? std / Math.abs(mean) : null;
  return { mean, std, cv, n };
}

export interface CanonicalEdge {
  fromLabel: string; // representative (first-seen) label
  toLabel: string;
  seedsPresent: number[];
  appearanceRate: number; // seedsPresent / totalDrafts
  meanCV: number | null; // CV of strength.mean across drafts where present
  stdCV: number | null;
  existsCV: number | null;
  meanValues: number[];
  structural: boolean; // strength pinned ~1.0 by the grammar (decision->option, option->factor); trivially stable
  signFlip: boolean; // the drawn coefficient is positive in some draws and negative in others (direction reversed)
}

/**
 * Cluster edges across drafts by canonical identity. Deterministic: drafts are
 * processed in ascending seed order and edges in sorted (from,to) label order, so
 * cluster representatives and assignments are stable across runs.
 */
export function canonicalEdges(drafts: Draft[]): CanonicalEdge[] {
  const ordered = [...drafts].sort((a, b) => a.seed - b.seed);
  const total = ordered.length;
  interface Cluster { fromLabel: string; toLabel: string; bySeed: Map<number, DraftEdge>; }
  const clusters: Cluster[] = [];

  const match = (e: DraftEdge, c: Cluster): boolean => {
    if (norm(e.fromLabel) === norm(c.fromLabel) && norm(e.toLabel) === norm(c.toLabel)) return true;
    return jaccard(e.fromLabel, c.fromLabel) >= FUZZY_THRESHOLD && jaccard(e.toLabel, c.toLabel) >= FUZZY_THRESHOLD;
  };

  for (const d of ordered) {
    const edges = [...d.edges].sort((x, y) =>
      (norm(x.fromLabel) + norm(x.toLabel)).localeCompare(norm(y.fromLabel) + norm(y.toLabel)));
    for (const e of edges) {
      // one edge maps to at most one cluster; a cluster takes at most one edge per seed
      const c = clusters.find((cl) => !cl.bySeed.has(d.seed) && match(e, cl));
      if (c) c.bySeed.set(d.seed, e);
      else clusters.push({ fromLabel: e.fromLabel, toLabel: e.toLabel, bySeed: new Map([[d.seed, e]]) });
    }
  }

  return clusters.map((c) => {
    const present = [...c.bySeed.keys()].sort((a, b) => a - b);
    const means = present.map((s) => c.bySeed.get(s)!.strengthMean);
    const stdsv = present.map((s) => c.bySeed.get(s)!.strengthStd);
    const exists = present.map((s) => c.bySeed.get(s)!.existsProbability);
    const structural = means.every((m) => Math.abs(Math.abs(m) - 1) < 0.05);
    const signFlip = means.some((m) => m > 0.05) && means.some((m) => m < -0.05);
    return {
      fromLabel: c.fromLabel, toLabel: c.toLabel,
      seedsPresent: present, appearanceRate: present.length / total,
      meanCV: stats(means).cv, stdCV: stats(stdsv).cv, existsCV: stats(exists).cv,
      meanValues: means.map((m) => Number(m.toFixed(4))),
      structural, signFlip,
    };
  }).sort((a, b) => b.appearanceRate - a.appearanceRate || (b.meanCV ?? -1) - (a.meanCV ?? -1));
}

export interface BriefStability {
  briefId: string;
  seeds: number[];
  nodeCount: ReturnType<typeof stats>;
  edgeCount: ReturnType<typeof stats>;
  sharedNodeLabelRate: number; // EXACT: fraction of a draft's node labels present verbatim in ALL drafts (strict lower bound)
  sharedNodeLabelRateFuzzy: number; // FUZZY: same, allowing token-Jaccard >= 0.6 matches (structural-anchor rate)
  canonicalEdges: CanonicalEdge[];
  edgesInAllDrafts: number;
  edgesInOneDraftOnly: number;
  medianAppearanceRate: number;
  numericallyStableEdges: number; // present in >=2 drafts AND meanCV <= 0.15 (all edges incl. structural)
  cvMeasurableEdges: number; // present in >=2 drafts
  causalRecurring: number; // non-structural edges present in >=2 drafts (the meaningful coefficient sample)
  causalStable: number; // of causalRecurring, strength.mean CV <= 0.15
  signFlips: number; // causal edges whose drawn coefficient flips sign across draws
}

export function briefStability(briefId: string, drafts: Draft[]): BriefStability {
  const seeds = drafts.map((d) => d.seed).sort((a, b) => a - b);
  const nodeCount = stats(drafts.map((d) => d.nodeCount));
  const edgeCount = stats(drafts.map((d) => d.edgeCount));
  // shared node labels across ALL drafts (exact + fuzzy)
  const labelLists = drafts.map((d) => Object.values(d.nodeLabelsByKind).flat().map(norm));
  const labelSets = labelLists.map((ls) => new Set(ls));
  const first = labelLists[0] ?? [];
  let sharedExact = 0, sharedFuzzy = 0;
  for (const l of first) {
    if (labelSets.every((s) => s.has(l))) sharedExact++;
    if (labelLists.every((list) => list.some((o) => o === l || jaccard(l, o) >= FUZZY_THRESHOLD))) sharedFuzzy++;
  }
  const sharedNodeLabelRate = first.length ? sharedExact / first.length : 0;
  const sharedNodeLabelRateFuzzy = first.length ? sharedFuzzy / first.length : 0;

  const ce = canonicalEdges(drafts);
  const total = drafts.length;
  const measurable = ce.filter((e) => e.seedsPresent.length >= 2);
  const causal = measurable.filter((e) => !e.structural);
  return {
    briefId, seeds, nodeCount, edgeCount, sharedNodeLabelRate, sharedNodeLabelRateFuzzy,
    canonicalEdges: ce,
    edgesInAllDrafts: ce.filter((e) => e.seedsPresent.length === total).length,
    edgesInOneDraftOnly: ce.filter((e) => e.seedsPresent.length === 1).length,
    medianAppearanceRate: median(ce.map((e) => e.appearanceRate)),
    cvMeasurableEdges: measurable.length,
    numericallyStableEdges: measurable.filter((e) => (e.meanCV ?? 1) <= 0.15).length,
    causalRecurring: causal.length,
    causalStable: causal.filter((e) => (e.meanCV ?? 1) <= 0.15).length,
    signFlips: causal.filter((e) => e.signFlip).length,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
