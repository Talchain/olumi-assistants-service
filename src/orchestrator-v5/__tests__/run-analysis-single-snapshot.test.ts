/**
 * ⭐⭐⭐ ONE TURN, ONE PERSISTED SNAPSHOT.
 *
 * ── THE DEFECT THIS PINS ──────────────────────────────────────────────────
 * A `run_analysis` turn reads `scenarios.graph` TWICE, and nothing joins the
 * two reads — no snapshot, no version pin, no row lock, and the store is
 * explicitly uncached:
 *
 *   read A  build-turn-context.ts `fetchPersistedScenarioState`
 *           → `loadPersistedScenarioStateStrict` → `store.loadGraphAndBriefText`
 *           → feeds the turn's FRESHNESS verdict (`current_graph_hash`,
 *             turn-executor `currentAnalysisGraphHashForTurn`).
 *
 *   read B  tools/registry.ts `DEFAULT_SCENARIO_READER`
 *           → `loadScenarioSnapshotForRunAnalysis` → the SAME strict read again
 *           → `snapshot.rawPersistedGraph` stamps `graph_hash_at_run` on the
 *             run_analysis fact (tools/handlers/run-analysis.ts).
 *
 * A write that lands between A and B makes the turn's freshness verdict and the
 * fact it just stamped describe DIFFERENT persisted states — silently, with no
 * refusal. The consumer then compares `computed_against_hash` against a
 * `graph_hash` that was never the graph the analysis actually ran on.
 *
 * `loadScenarioSnapshotForRunAnalysis` even documents the intent —
 * "`rawPersistedGraph` … stay[s] byte-identical to what every freshness hash
 * site reads" — but that is an intent about ONE read, and there are two.
 *
 * ── WHY A CAPTURE, NOT A FIXTURE ──────────────────────────────────────────
 * The graph is `../replacement/__tests__/captures/journey-witness-20260921-graph.json`,
 * lifted verbatim from a real 21 Sep journey witness (14 nodes, 25 edges). A
 * hand-written graph encodes the author's model of the producer and confirms it
 * instead of testing it — a real intervention is a RICH OBJECT
 * (`{ value, raw_value, unit, source, … }`), never a bare number, and a
 * self-authored one has already cost this estate four wasted probes.
 * ⛔ APPEND-ONLY: a record of what the product emitted on a dated build.
 *
 * ── THE CONTRACT ASSERTED ─────────────────────────────────────────────────
 * For ONE turn, the graph that stamps `graph_hash_at_run` MUST be the graph the
 * turn's freshness verdict was derived from — or the read MUST refuse. Both are
 * acceptable fixes, so the assertion admits either and fails only on the third
 * outcome: silently proceeding on a different graph.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadPersistedScenarioStateStrict,
  loadScenarioSnapshotForRunAnalysis,
} from '../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE_PATH = join(
  HERE,
  '..',
  'replacement',
  '__tests__',
  'captures',
  'journey-witness-20260921-graph.json',
);
const CAPTURED_GRAPH = JSON.parse(readFileSync(CAPTURE_PATH, 'utf8')) as Record<string, unknown>;

const SCENARIO = '00000000-0000-4000-8000-00000000cafe';

/**
 * A store double that serves a DIFFERENT graph on each successive read, which is
 * exactly what a concurrent write looks like to a caller that reads twice.
 * Only `loadGraphAndBriefText` is needed: both reads funnel through it.
 */
function makeShiftingStore(graphs: readonly unknown[]) {
  let calls = 0;
  return {
    store: {
      loadGraphAndBriefText: async (): Promise<{ graph: unknown; briefText: string | null }> => {
        const graph = graphs[Math.min(calls, graphs.length - 1)];
        calls += 1;
        return { graph, briefText: 'captured brief' };
      },
    },
    reads: () => calls,
  };
}

/** Change ONE analysis-affecting intervention value, preserving the real rich shape. */
function withShiftedIntervention(graph: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(graph)) as Record<string, unknown>;
  const nodes = clone.nodes as Array<Record<string, unknown>>;
  for (const node of nodes) {
    const data = (node.data ?? node) as Record<string, unknown>;
    const interventions = data.interventions as Record<string, unknown> | undefined;
    if (!interventions) continue;
    for (const key of Object.keys(interventions)) {
      const iv = interventions[key];
      if (iv && typeof iv === 'object' && 'value' in (iv as Record<string, unknown>)) {
        const current = Number((iv as Record<string, unknown>).value);
        (iv as Record<string, unknown>).value = Number.isFinite(current) ? current + 0.11 : 0.11;
        return clone;
      }
    }
  }
  throw new Error('capture carries no object-shaped intervention — the capture changed shape');
}

describe('one turn, one persisted snapshot', () => {
  it('CONTROL: an unchanging store yields the SAME hash from both reads', async () => {
    const { store, reads } = makeShiftingStore([CAPTURED_GRAPH, CAPTURED_GRAPH]);

    const readA = await loadPersistedScenarioStateStrict(SCENARIO, store as never);
    const hashA = computeAnalysisAffectingGraphHash(readA.graph as never);

    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-control', store as never);
    const hashB = computeAnalysisAffectingGraphHash(snapshot.rawPersistedGraph as never);

    // Bind by IDENTITY (the exact token), never by "the hashes differ" — a
    // value predicate another object could satisfy proves nothing. This control
    // also proves the two hashing routes are COMPARABLE at all: without it, a
    // RED below could be the double or the projection rather than the race.
    expect(hashA, 'the capture must hash to a real token').toBeTruthy();
    expect(hashB).toBe(hashA);
    expect(reads(), 'the turn really does read the store twice').toBe(2);
  });

  it('a write between the two reads must not silently re-point the analysis', async () => {
    const shifted = withShiftedIntervention(CAPTURED_GRAPH);
    const { store } = makeShiftingStore([CAPTURED_GRAPH, shifted]);

    // Read A — what the turn's freshness verdict will be derived from.
    const readA = await loadPersistedScenarioStateStrict(SCENARIO, store as never);
    const freshnessHash = computeAnalysisAffectingGraphHash(readA.graph as never);

    // Sanity: the shift really is analysis-affecting, so a divergence below is
    // a real divergence and not an inert edit the projection discards.
    expect(computeAnalysisAffectingGraphHash(shifted as never)).not.toBe(freshnessHash);

    // Read B — what will stamp `graph_hash_at_run` on the run_analysis fact.
    let refused: unknown = null;
    let factHash: string | null = null;
    try {
      const snapshot = await loadScenarioSnapshotForRunAnalysis(
        SCENARIO,
        'req-race',
        store as never,
      );
      factHash = computeAnalysisAffectingGraphHash(snapshot.rawPersistedGraph as never);
    } catch (error) {
      refused = error;
    }

    // Either fix is acceptable: reuse the graph the turn already loaded, or
    // refuse. What is NOT acceptable is stamping a fact against a graph the
    // turn never saw, which is what happens today.
    if (refused === null) {
      expect(
        factHash,
        'the fact was stamped against a DIFFERENT persisted graph than the turn’s freshness verdict, with no refusal',
      ).toBe(freshnessHash);
    }
  });
});
