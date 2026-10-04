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
 * 3. `statedDissentUnanswered` (T3): `finding_dissent` facts — a human's
 *    STATED objection to a finding, in their own words (schemas 0.55.0) —
 *    NEWER than the latest claim-bearing `run_analysis` fact. Same
 *    fire-once-by-fact-ordering as T1, for the same reason: the first analysis
 *    after the objection is the one it stands against, and the turn after that
 *    it is structurally spent. No ledger, replay-safe.
 *
 *    ⭐ WHY THIS IS A SIGNAL AND NOT A CHANGE. Until this class existed a user
 *    could disagree, type why, watch the words reach the server — and nothing
 *    downstream read them. `context/recent-changes.ts` skips the fact
 *    deliberately and correctly (a dissent changes no graph state), and that
 *    skip is the whole reason nothing else could see it: the ONE projection
 *    every coaching path reads answers "what changed in the MODEL?", and this
 *    is not an answer to that question. It is an answer to a different one —
 *    *what has a human contested that nothing has answered?* — so it gets its
 *    own class here rather than a widened `recent_changes` (trap 21: two
 *    questions under one name is what this estate pays for).
 *
 *    ⚠ AND THE CONSEQUENCE IS DELIBERATELY NOT AN ADJUSTMENT. Nothing in this
 *    module or its consumers moves a number because a human objected. The
 *    objection becomes VISIBLE and stays OPEN; absorbing it into the model
 *    would remove the disagreement from view, which is the opposite of what a
 *    shared reasoning record is for.
 *
 *    ⚠ NO GRAPH IS NEEDED FOR T3, and that is why the label gate below moved.
 *    T1/T2 name an EDGE and are unnameable without the persisted graph's
 *    labels; T3's subject is a finding whose id is an opaque, UI-namespaced
 *    string (`strengthen:flip:edge_9` — derived at the UI bytes, not a closed
 *    set CEE may respell), so the only honest naming material is the user's
 *    OWN words, which ride on the fact. A missing/malformed graph must
 *    therefore drop T1 and T2 and MUST NOT drop T3.
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

/**
 * T3 — a human's stated objection to a finding that no later analysis has
 * stood against yet.
 *
 * `statement` is the user's reason VERBATIM, exactly as the contract persisted
 * it: never trimmed, collapsed or normalised HERE. A consumer that renders it
 * inside a sentence may quote it (see `coaching/stated-dissent-offer-text.ts`,
 * which names that question apart), but the record this carries is the record.
 */
export interface StatedDissentSignal {
  readonly findingId: string;
  readonly analysisId: string;
  readonly statement: string;
}

export interface JudgementSignals {
  readonly overriddenUnanswered: readonly OverriddenAdjudicationSignal[];
  readonly contestedUnadjudicated: readonly ContestedUnadjudicatedSignal[];
  /** T3 — newest-first, one entry per (finding, analysis) address. */
  readonly statedDissentUnanswered: readonly StatedDissentSignal[];
}

const EMPTY_SIGNALS: JudgementSignals = Object.freeze({
  overriddenUnanswered: Object.freeze([]),
  contestedUnadjudicated: Object.freeze([]),
  statedDissentUnanswered: Object.freeze([]),
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

/**
 * ONE composite-key spelling for the (from,to) join. `JSON.stringify` makes
 * the key collision-proof for ANY id contents (an id containing the separator
 * cannot forge a different pair), and there is exactly one definition so the
 * three join sites cannot drift apart. (The first byte of this file carried a
 * NUL as the separator — the exact trap-17 class that makes a source file
 * silently invisible to grep; caught by a NUL sweep with a positive control
 * and replaced with this helper.)
 */
function pairKey(first: string, second: string): string {
  return JSON.stringify([first, second]);
}

/** The (from,to) edge join. */
function edgeKey(fromId: string, toId: string): string {
  return pairKey(fromId, toId);
}

/**
 * The (finding,analysis) dissent join — named apart from {@link edgeKey}
 * because it addresses a different kind of thing, and a shared spelling would
 * invite a future reader to join the two sets (they are not joinable).
 */
function dissentKey(findingId: string, analysisId: string): string {
  return pairKey(findingId, analysisId);
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

  // ── The latest claim-bearing analysis. ONE read, shared by T1 and T3: both
  // are "a human judgement no analysis has stood against yet", so two
  // derivations of the same reference point is the twins shape (trap 12).
  const latestAnalysis = selectClaimBearingRunAnalysisFact(priorFacts);
  const latestAnalysisIndex = latestAnalysis?.index ?? Number.POSITIVE_INFINITY;

  // ── T3 FIRST, AND DELIBERATELY ABOVE THE LABEL GATE. T1/T2 are unnameable
  // without the persisted graph; T3 is named by the user's own words, which
  // ride on the fact. Deriving it below the gate would make a concurrent-writer
  // hash miss silently swallow a human's stated objection — the exact
  // fail-closed-on-the-wrong-input class trap 16 names.
  const statedDissentUnanswered = deriveStatedDissent(priorFacts, latestAnalysisIndex);

  if (labels.size === 0) {
    return statedDissentUnanswered.length === 0
      ? EMPTY_SIGNALS
      : { ...EMPTY_SIGNALS, statedDissentUnanswered };
  }

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
  const overriddenSeen = new Set<string>();
  const overriddenUnanswered: OverriddenAdjudicationSignal[] = [];
  for (const adj of adjudications) {
    if (adj.verdict !== 'overridden') continue;
    if (adj.index >= latestAnalysisIndex) continue; // answered — structurally spent
    const key = edgeKey(adj.fromId, adj.toId);
    if (overriddenSeen.has(key)) continue; // newest per edge (array order = newest-first)
    overriddenSeen.add(key);
    const ref = resolveRef(adj.fromId, adj.toId);
    if (ref === null) continue; // unnameable ⇒ dropped, never defaulted
    overriddenUnanswered.push(ref);
  }

  // ── T2: contested in the persisted graph AND no adjudication fact (ANY
  // verdict, ANY recency in the window) for the same (from,to).
  const adjudicatedEdges = new Set<string>(
    adjudications.map((a) => edgeKey(a.fromId, a.toId)),
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
      if (adjudicatedEdges.has(edgeKey(fromId, toId))) continue; // spent by the join
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

  if (
    overriddenUnanswered.length === 0 &&
    contestedUnadjudicated.length === 0 &&
    statedDissentUnanswered.length === 0
  ) {
    return EMPTY_SIGNALS;
  }
  return { overriddenUnanswered, contestedUnadjudicated, statedDissentUnanswered };
}

/**
 * T3 — the stated-dissent bag.
 *
 * `latestAnalysisIndex` is the index of the latest claim-bearing `run_analysis`
 * fact in the SAME newest-first array (`Number.POSITIVE_INFINITY` when there is
 * none, so every dissent counts as unanswered — the first analysis after it is
 * the one it stands against).
 *
 * ⚠ ORDERING AUTHORITY IS ARRAY POSITION, identical to T1 and for the identical
 * reason: `buildJudgementFact` mints no timestamp on a judgement receipt, so
 * `computed_at` cannot order these against an analysis fact.
 *
 * ⚠ DEDUPE IS BY BOTH IDS, NEVER BY `finding_id` ALONE. Finding ids are fixed
 * literals the UI repeats across decisions and runs (derived at the UI bytes:
 * `StrengthenTheReasoning` sends `rec.id`, and its own copy guard records that
 * "recommendation ids are fixed literals repeated in every decision"), so a
 * bare-id key would let one run's objection stand in for another's. The
 * contract makes `analysis_id` the OTHER HALF of the address for exactly this
 * reason, and this join honours that rather than re-reading it as context.
 *
 * Fail-closed on every read: a malformed result, a blank statement or a missing
 * id drops the signal rather than defaulting it.
 */
function deriveStatedDissent(
  priorFacts: readonly HandlerFact[],
  latestAnalysisIndex: number,
): readonly StatedDissentSignal[] {
  const seen = new Set<string>();
  const out: StatedDissentSignal[] = [];
  for (let i = 0; i < priorFacts.length; i += 1) {
    if (i >= latestAnalysisIndex) break; // answered — structurally spent
    const fact = priorFacts[i]!;
    if (fact.fact_type !== 'finding_dissent') continue;
    const result = readRecord((fact as { result?: unknown }).result);
    if (result === null) continue;
    const findingId = nonEmptyString(result.finding_id);
    const analysisId = nonEmptyString(result.analysis_id);
    const statement = nonEmptyString(result.statement);
    if (findingId === null || analysisId === null || statement === null) continue;
    // The contract already refuses a whitespace-only statement at the wire;
    // this asks the same question of the PERSISTED value rather than trusting
    // it, because a fact row outlives the schema version that wrote it.
    if (statement.trim().length === 0) continue;
    const key = dissentKey(findingId, analysisId);
    if (seen.has(key)) continue; // newest per address (array order = newest-first)
    seen.add(key);
    out.push({ findingId, analysisId, statement });
  }
  return out;
}
