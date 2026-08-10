/**
 * `JudgementSignals` — the human-JUDGEMENT input class for lens selection.
 *
 * ROADMAP 2.692 slice 2 + 2.690 CH-B1. Designs:
 * `parallel-briefs/NEXT-BEST-ISSUE-DESIGN-2026-08-08.md` §1.4/§1.7/§3 and
 * `parallel-briefs/GENERATION-AND-CHALLENGE-POLICY-DESIGN-2026-08-07.md` §B.5
 * (the ratified FEED architecture: derived ONCE per turn in the compose caller,
 * passed to both same-turn `selectLens` call sites, STRIPPED in the lens-history
 * replay).
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * A deterministic, zero-LLM, zero-IO signal bag derived from two inputs compose
 * ALREADY holds for every turn — `prior_facts` and the persisted graph. No new
 * DB read, no new persistence, no new wire type; this type never crosses a
 * service boundary. It exists because `selectLens`'s fact input carries neither
 * conversation judgements nor the persisted graph (the same structural blindness
 * `conversation-text-signals.ts` names for text), so the design's
 * `resolve_disagreement` tier was declared MEMBERLESS at #887 — the inputs
 * could not reach the evaluators. This module is the missing input class.
 *
 * ── THE TWO SIGNAL CLASSES ──────────────────────────────────────────────────
 * 1. `overriddenUnanswered` (T1, 2.690 CH-1): `edge_adjudication` facts with
 *    `verdict: 'overridden'` NEWER than the latest claim-bearing `run_analysis`
 *    fact. I-B5's fire-once-by-fact-ordering: the first analysis after the
 *    override answers it, then the trigger is structurally spent — no ledger.
 *    A re-override after a newer analysis re-arms (a repeated override is a
 *    fresh, stronger signal — the design's own words).
 *
 *    ⚠ ORDERING AUTHORITY: ARRAY POSITION in `prior_facts`, which
 *    `build-turn-context` delivers NEWEST-FIRST. Adjudication facts carry no
 *    timestamp (`buildJudgementFact` mints none), so cross-fact-type recency is
 *    not derivable from `computed_at` — position is the platform's one shared
 *    ordering. The reference analysis is `selectClaimBearingRunAnalysisFact`'s
 *    head (the SAME entitlement selector the lens history walks), compared by
 *    ITS `.index`: an adjudication at a SMALLER index is newer.
 *
 * 2. `contestedUnadjudicated` (T2, 2.692 §1.4 I-DISAGREE — "the heart of
 *    2.692"): edges whose persisted `validation.status === 'contested'`
 *    (the two-pass pipeline's verdict, `validation-pipeline/comparison.ts`)
 *    with NO `edge_adjudication` fact for their `(from,to)` in `prior_facts` —
 *    ANY verdict adjudicates; the join is the fire-once (an adjudication fact
 *    removes the edge from the set — structurally spent, replay-safe).
 *
 * ── FAIL-CLOSED READS (2.690 I-B6) ──────────────────────────────────────────
 * Every read is defensive: an absent/malformed graph, a node with no label, an
 * edge with no endpoints ⇒ the SIGNAL is dropped, never defaulted. A dropped
 * signal costs a recommendation; a fabricated one costs trust. Labels are
 * resolved HERE (from the same persisted graph) because the offer must name the
 * relationship in the user's own words — an id never reaches user-facing prose,
 * and a lens selected without a nameable subject would be un-mintable (the
 * 2.1024 composability class, pushed one step earlier).
 *
 * ── REPLAY COMPATIBILITY (why the replay STRIPS this) ───────────────────────
 * `selectLens` stays a pure, total function of `(fact, options)`. The contested
 * set AS OF an earlier turn is UNRECONSTRUCTIBLE (the persisted graph is
 * current-state only), so `lens-history.ts` strips `judgementSignals` from its
 * replay rather than feeding it future information. Cost, one-directional and
 * disclosed there: a judgement-lens win is invisible to the next turn's
 * no-repeat history — at most one extra turn of monotony, never a suppressed or
 * invented lens. Omitted signals ⇒ selection byte-identical to pre-change
 * (pinned in `__tests__/next-best-judgement-tier.test.ts` §4).
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { selectClaimBearingRunAnalysisFact } from '../context/freshness.js';

/** An edge identity + its user-facing endpoint labels, resolved fail-closed. */
export interface JudgementEdgeRef {
  readonly fromId: string;
  readonly toId: string;
  readonly fromLabel: string;
  readonly toLabel: string;
}

/** T1 — an overridden adjudication no analysis has yet absorbed. Newest-first. */
export type OverriddenAdjudicationSignal = JudgementEdgeRef;

/** T2 — a contested edge with no adjudication fact. */
export interface ContestedUnadjudicatedSignal extends JudgementEdgeRef {
  /** `validation.max_divergence` (0–1) — the ordering fallback when no e-value
   *  joins. `null` when absent/non-finite (absent ≠ zero). */
  readonly maxDivergence: number | null;
}

export interface JudgementSignals {
  readonly overriddenUnanswered: readonly OverriddenAdjudicationSignal[];
  readonly contestedUnadjudicated: readonly ContestedUnadjudicatedSignal[];
}

const EMPTY_SIGNALS: JudgementSignals = Object.freeze({
  overriddenUnanswered: Object.freeze([]),
  contestedUnadjudicated: Object.freeze([]),
});

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** node id → label from the persisted graph (canvas/CEE shape: `nodes[]` with
 *  `id`/`label`). Empty map on any malformed shape — every consumer then drops
 *  its signal (fail closed). */
function buildNodeLabelLookup(graph: Record<string, unknown> | null): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  if (graph === null) return lookup;
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) return lookup;
  for (const raw of nodes) {
    const node = readRecord(raw);
    if (node === null) continue;
    const id = nonEmptyString(node.id);
    const label = nonEmptyString(node.label);
    if (id === null || label === null) continue;
    lookup.set(id, label);
  }
  return lookup;
}

/** Canonical (from,to) tie-break used by both signal classes. */
function compareEdgeIdentity(a: JudgementEdgeRef, b: JudgementEdgeRef): number {
  if (a.fromId !== b.fromId) return a.fromId < b.fromId ? -1 : 1;
  if (a.toId !== b.toId) return a.toId < b.toId ? -1 : 1;
  return 0;
}

/**
 * Derive the judgement signal bag for this turn.
 *
 * `priorFacts` MUST be the turn's PRIOR fact array
 * (`EnrichedTurnContext.prior_facts`, newest-first) — the same array and the
 * same caveat as `derivePreviousAnalysisLens`: never the unified
 * `[...currentTurnFacts, ...prior_facts]` array, whose head is THIS turn's own
 * analysis and would mark every override spent one turn early.
 *
 * `persistedGraph` is the HASH-GATED persisted snapshot the compose branch
 * already trusts for label resolution (`fallbackForFact`) — when the gate
 * failed (concurrent writer), the caller passes `undefined` and this returns
 * the empty bag: identity over availability, byte-identical to pre-change.
 */
export function deriveJudgementSignals(
  priorFacts: readonly HandlerFact[],
  persistedGraph: unknown,
): JudgementSignals {
  const graph = readRecord(persistedGraph);
  const labels = buildNodeLabelLookup(graph);
  if (labels.size === 0) return EMPTY_SIGNALS;

  const resolveRef = (fromId: string, toId: string): JudgementEdgeRef | null => {
    const fromLabel = labels.get(fromId);
    const toLabel = labels.get(toId);
    if (fromLabel === undefined || toLabel === undefined) return null;
    return { fromId, toId, fromLabel, toLabel };
  };

  // ── All adjudication facts, by position (newest-first ⇒ smaller index = newer)
  const adjudications: { index: number; fromId: string; toId: string; verdict: string }[] = [];
  for (let i = 0; i < priorFacts.length; i += 1) {
    const fact = priorFacts[i]!;
    if (fact.fact_type !== 'edge_adjudication') continue;
    const result = readRecord((fact as { result?: unknown }).result);
    if (result === null) continue;
    const fromId = nonEmptyString(result.from);
    const toId = nonEmptyString(result.to);
    const verdict = nonEmptyString(result.verdict);
    if (fromId === null || toId === null || verdict === null) continue;
    adjudications.push({ index: i, fromId, toId, verdict });
  }

  // ── T1: overridden AND newer (smaller index) than the latest claim-bearing
  // analysis. No prior analysis ⇒ every override is unanswered (the first
  // analysis after it is the one that answers it — 2.690 §B.4).
  const latestAnalysis = selectClaimBearingRunAnalysisFact(priorFacts);
  const latestAnalysisIndex = latestAnalysis?.index ?? Number.POSITIVE_INFINITY;
  const overriddenSeen = new Set<string>();
  const overriddenUnanswered: OverriddenAdjudicationSignal[] = [];
  for (const adj of adjudications) {
    if (adj.verdict !== 'overridden') continue;
    if (adj.index >= latestAnalysisIndex) continue; // answered — structurally spent
    const key = `${adj.fromId} ${adj.toId}`;
    if (overriddenSeen.has(key)) continue; // newest per edge (array order = newest-first)
    overriddenSeen.add(key);
    const ref = resolveRef(adj.fromId, adj.toId);
    if (ref === null) continue; // unnameable ⇒ dropped, never defaulted
    overriddenUnanswered.push(ref);
  }

  // ── T2: contested in the persisted graph AND no adjudication fact (ANY
  // verdict, ANY recency in the window) for the same (from,to).
  const adjudicatedEdges = new Set<string>(
    adjudications.map((a) => `${a.fromId} ${a.toId}`),
  );
  const contestedUnadjudicated: ContestedUnadjudicatedSignal[] = [];
  const edges = graph === null ? null : graph.edges;
  if (Array.isArray(edges)) {
    for (const raw of edges) {
      const edge = readRecord(raw);
      if (edge === null) continue;
      const fromId = nonEmptyString(edge.from);
      const toId = nonEmptyString(edge.to);
      if (fromId === null || toId === null) continue;
      const validation = readRecord(edge.validation);
      if (validation === null) continue;
      if (validation.status !== 'contested') continue;
      if (adjudicatedEdges.has(`${fromId} ${toId}`)) continue; // spent by the join
      const ref = resolveRef(fromId, toId);
      if (ref === null) continue;
      const rawDivergence = validation.max_divergence;
      contestedUnadjudicated.push({
        ...ref,
        maxDivergence:
          typeof rawDivergence === 'number' && Number.isFinite(rawDivergence)
            ? rawDivergence
            : null,
      });
    }
  }
  // Stable canonical base order; the selector's evaluator applies the design's
  // value ordering (e-value join, then max_divergence) over this.
  contestedUnadjudicated.sort(compareEdgeIdentity);

  if (overriddenUnanswered.length === 0 && contestedUnadjudicated.length === 0) {
    return EMPTY_SIGNALS;
  }
  return { overriddenUnanswered, contestedUnadjudicated };
}
