/**
 * DETERMINISTIC COVERAGE FACTS — the continuous draft-quality metric.
 *
 * Pure, LLM-free, sub-millisecond, and computed on EVERY draft whether or not
 * anything else in this module fires. That is deliberate and it is the most
 * valuable half of this lane: the estate currently cannot answer "is the
 * drafter getting better or worse?" without a bespoke multi-draw experiment,
 * and a repair pass WITHOUT this measurement would convert a visible problem
 * into an invisible one.
 *
 * ⛔ NOTHING HERE IS A VERDICT, AND NOTHING HERE IS A QUOTA.
 *
 * `causal_waist <= 1` NOMINATES a draft for semantic review by a judge that
 * has read the brief. It never rejects. A genuinely single-factor decision —
 * "should we raise the price, yes or no?" — produces `causal_waist === 1`,
 * is nominated, and is passed by the judge, and the graph ships byte-identical.
 * That is not a hoped-for property: it is the opposite-direction control in
 * `__tests__/draft-quality.single-factor-control.test.ts`, which was written
 * and made to pass BEFORE any judging logic existed, precisely so that
 * under-generation could not be "fixed" by fabricating filler.
 *
 * ## Why the WAIST and not a factor count
 *
 * The motivating failure (funding brief, 2026-09-01) was NOT "too few
 * factors". It was five options funnelling through ONE factor — a bowtie with
 * a single waist, where every option was distinguishable only by one number on
 * one shared node. `factor_count` alone cannot see that (a graph can carry six
 * factors and still route every option through one of them), and a
 * `factor_count >= N` rule would reject legitimate simple models while missing
 * the actual defect. The waist is a property of the OPTION→GOAL structure, so
 * it measures the thing that went wrong: how many causal dimensions the model
 * allows the options to differ along at all.
 */

import type { DraftCoverageFacts } from './types.js';

/** Node kinds this module reasons about. Mirrors `NodeKindV3` (cee-v3.ts:32)
 *  loosely on purpose: the extractor is shape-TOLERANT because it reads a body
 *  that has already been through the V3/V2/V1 boundary transform, and an
 *  unrecognised shape must degrade to `null` (no facts, no nomination, draft
 *  ships) rather than throw inside the draft path. */
const FACTOR_KINDS = new Set(['factor']);
const OPTION_KINDS = new Set(['option']);
const OUTCOME_KINDS = new Set(['outcome']);
const RISK_KINDS = new Set(['risk']);
const GOAL_KINDS = new Set(['goal']);

interface ReadNode {
  readonly id: string;
  readonly kind: string;
}

interface ReadEdge {
  readonly from: string;
  readonly to: string;
}

interface ReadGraph {
  readonly nodes: readonly ReadNode[];
  readonly edges: readonly ReadEdge[];
}

/**
 * Shape-tolerant read of a drafted graph.
 *
 * Returns null — never throws — for anything it cannot read. Every caller
 * treats null as "no facts available", which fails OPEN.
 */
export function readGraph(value: unknown): ReadGraph | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const g = value as Record<string, unknown>;
  // `draft-graph.ts:424` reads `body.graph ?? body`; mirror that tolerance.
  const candidate =
    g.nodes !== undefined || g.edges !== undefined
      ? g
      : g.graph && typeof g.graph === 'object' && !Array.isArray(g.graph)
        ? (g.graph as Record<string, unknown>)
        : null;
  if (!candidate) return null;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return null;

  const nodes: ReadNode[] = [];
  for (const raw of candidate.nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const n = raw as Record<string, unknown>;
    const id = typeof n.id === 'string' ? n.id : null;
    const kind = typeof n.kind === 'string' ? n.kind : typeof n.type === 'string' ? n.type : null;
    if (id === null || kind === null) continue;
    nodes.push({ id, kind });
  }
  const edges: ReadEdge[] = [];
  for (const raw of candidate.edges) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const from = typeof e.from === 'string' ? e.from : null;
    const to = typeof e.to === 'string' ? e.to : null;
    if (from === null || to === null) continue;
    edges.push({ from, to });
  }
  // A graph with no readable nodes tells us nothing; treat as unreadable.
  if (nodes.length === 0) return null;
  return { nodes, edges };
}

/**
 * Compute the coverage facts. Returns null when the graph cannot be read.
 *
 * Complexity is O(options × (V + E)) — one forward reachability sweep per
 * option over a graph that is, by the pipeline's own caps, small. Measured at
 * well under a millisecond on the drafts this path produces; it is not budgeted
 * against the request timeout because it cannot meaningfully consume it.
 */
export function computeDraftCoverage(value: unknown): DraftCoverageFacts | null {
  const graph = readGraph(value);
  if (graph === null) return null;

  const kindById = new Map<string, string>();
  for (const n of graph.nodes) kindById.set(n.id, n.kind);

  const adjacency = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!kindById.has(e.from) || !kindById.has(e.to)) continue;
    const list = adjacency.get(e.from);
    if (list) list.push(e.to);
    else adjacency.set(e.from, [e.to]);
  }

  const optionIds = graph.nodes.filter((n) => OPTION_KINDS.has(n.kind)).map((n) => n.id);
  const goalIds = new Set(graph.nodes.filter((n) => GOAL_KINDS.has(n.kind)).map((n) => n.id));

  // Which factors lie on an option → … → goal path, and which options reach
  // each of them. `reachesGoal` is memoised across options — the same
  // downstream subgraph is walked once, not once per option.
  const reachesGoalMemo = new Map<string, boolean>();
  const reachesGoal = (start: string): boolean => {
    const memo = reachesGoalMemo.get(start);
    if (memo !== undefined) return memo;
    // Iterative DFS with an on-stack marker so a cycle cannot loop forever.
    // A node currently on the stack is provisionally false; the deterministic
    // sweep upstream removes cycles, but this module must not depend on that.
    const seen = new Set<string>([start]);
    const stack = [start];
    let found = false;
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      if (goalIds.has(cur)) {
        found = true;
        break;
      }
      for (const next of adjacency.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    reachesGoalMemo.set(start, found);
    return found;
  };

  /** option id → the set of waist factors it can reach. */
  const waistByOption = new Map<string, Set<string>>();
  for (const optionId of optionIds) {
    const reached = new Set<string>();
    const seen = new Set<string>([optionId]);
    const stack = [optionId];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      const kind = kindById.get(cur);
      if (kind !== undefined && FACTOR_KINDS.has(kind) && reachesGoal(cur)) {
        reached.add(cur);
      }
      for (const next of adjacency.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    waistByOption.set(optionId, reached);
  }

  const waist = new Set<string>();
  const optionsPerWaistFactor = new Map<string, number>();
  for (const reached of waistByOption.values()) {
    for (const factorId of reached) {
      waist.add(factorId);
      optionsPerWaistFactor.set(factorId, (optionsPerWaistFactor.get(factorId) ?? 0) + 1);
    }
  }

  let privateFactorCount = 0;
  let sharedFactorCount = 0;
  for (const count of optionsPerWaistFactor.values()) {
    if (count === 1) privateFactorCount += 1;
    if (optionIds.length > 0 && count === optionIds.length) sharedFactorCount += 1;
  }

  return {
    option_count: optionIds.length,
    factor_count: graph.nodes.filter((n) => FACTOR_KINDS.has(n.kind)).length,
    outcome_count: graph.nodes.filter((n) => OUTCOME_KINDS.has(n.kind)).length,
    risk_count: graph.nodes.filter((n) => RISK_KINDS.has(n.kind)).length,
    goal_count: goalIds.size,
    edge_count: graph.edges.length,
    causal_waist: waist.size,
    private_factor_count: privateFactorCount,
    shared_factor_count: sharedFactorCount,
    max_causal_depth: longestOptionToGoalDepth(optionIds, adjacency, goalIds),
  };
}

/** Longest option → … → goal chain in edges. Bounded by node count so a cycle
 *  cannot make it diverge. Returns 0 when no option reaches a goal. */
function longestOptionToGoalDepth(
  optionIds: readonly string[],
  adjacency: ReadonlyMap<string, string[]>,
  goalIds: ReadonlySet<string>,
): number {
  let best = 0;
  for (const optionId of optionIds) {
    // BFS gives the SHORTEST path; we want the longest simple path, which is
    // NP-hard in general. A bounded DFS over a small DAG is the honest
    // approximation, and the bound is what keeps it terminating on a cycle.
    const stack: Array<{ node: string; depth: number; path: Set<string> }> = [
      { node: optionId, depth: 0, path: new Set([optionId]) },
    ];
    let iterations = 0;
    const MAX_ITERATIONS = 20_000;
    while (stack.length > 0 && iterations < MAX_ITERATIONS) {
      iterations += 1;
      const cur = stack.pop() as { node: string; depth: number; path: Set<string> };
      if (goalIds.has(cur.node)) {
        if (cur.depth > best) best = cur.depth;
        continue;
      }
      for (const next of adjacency.get(cur.node) ?? []) {
        if (cur.path.has(next)) continue;
        const nextPath = new Set(cur.path);
        nextPath.add(next);
        stack.push({ node: next, depth: cur.depth + 1, path: nextPath });
      }
    }
  }
  return best;
}

/**
 * ⭐ THE PRE-FILTER. Does this draft warrant a semantic review call?
 *
 * ⛔ THIS IS NOT A REJECTION AND MUST NEVER BECOME ONE. It answers "is it worth
 * spending a judge call here?", not "is this model bad?". The only authority
 * that may call a model impoverished is the judge, which has read the brief.
 *
 * The condition is the single-waist bowtie signature: two or more options that
 * between them act through at most ONE causal dimension. Note what it is NOT:
 *   · it is not `factor_count < N` — a graph with six factors that routes every
 *     option through one of them still nominates, and a two-factor graph where
 *     the options act through both does not;
 *   · it is not conditioned on graph size at all.
 *
 * ## The recall limitation, stated plainly rather than buried
 *
 * Gating the judge on structure means a draft that is semantically impoverished
 * while structurally healthy is NEVER JUDGED. That is a real hole and it is a
 * deliberate PoC cost trade: judging every draft would add its latency and
 * tokens to all of them, and the observed failure class has this signature.
 * The hole is made MEASURABLE rather than hidden — `not_nominated` is emitted
 * on every un-nominated draft alongside the full coverage facts, so the
 * pre-filter's recall can be estimated later from the telemetry without
 * re-running the experiment.
 */
export function nominatesForReview(facts: DraftCoverageFacts | null): boolean {
  if (facts === null) return false;
  return facts.option_count >= 2 && facts.causal_waist <= 1;
}

/**
 * Deterministic tie-break between two draws when BOTH have been judged
 * impoverished. Used only on that arm — never to override a judge verdict.
 *
 * Returns true when `b` is a materially richer model than `a`. Ordered by the
 * dimension the defect is about (waist), then by how many of those dimensions
 * are option-specific, then by the count of distinct causal chains. Ties keep
 * `a` — the FIRST draw — so a redraw that buys nothing cannot silently replace
 * a draft the user would have got anyway.
 */
export function isMaterallyRicher(
  a: DraftCoverageFacts | null,
  b: DraftCoverageFacts | null,
): boolean {
  if (b === null) return false;
  if (a === null) return true;
  if (b.causal_waist !== a.causal_waist) return b.causal_waist > a.causal_waist;
  if (b.private_factor_count !== a.private_factor_count) {
    return b.private_factor_count > a.private_factor_count;
  }
  if (b.max_causal_depth !== a.max_causal_depth) return b.max_causal_depth > a.max_causal_depth;
  return false;
}
