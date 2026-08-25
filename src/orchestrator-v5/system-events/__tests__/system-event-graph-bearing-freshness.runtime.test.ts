/**
 * ⭐ THE RUNTIME HALF OF THE GRAPH-BEARING-FRESHNESS INVARIANT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS, AND WHY THE EXISTING GUARD COULD NOT HAVE CAUGHT THE DEFECT.
 *
 * `route-egress-analysis-state-freshness.drift.test.ts` already states this
 * invariant — and it is a STATIC SOURCE SCAN. It reads `route-v2.ts` and asks
 * whether each `sendFinalised200` call SITE mentions `freshness:`. Its own
 * comment records that it "deliberately accepts" a conditional spread, and that
 * whether any exit can actually produce a graph WITHOUT a derivation was "not
 * established — the review found it unproven in both directions, and nothing
 * tested it".
 *
 * It was reachable. `dispatchFactorValueEdit`'s success return — the turn that
 * writes the user's factor edit to the store — carried a non-null graph and NO
 * derivation, so `route-v2.ts`'s `system_event` spread contributed nothing and
 * the finaliser fell through to `NO_ANALYSIS_CONTEXT_DERIVATION` →
 * `unknown_degraded` / `no_graph_this_turn`. The route's call site passes the
 * static scan the whole time: the TEXT `freshness: sysResult.freshness` is
 * present; the VALUE is `undefined`.
 *
 * ⚠ THAT IS THE WHOLE GAP, AND IT IS NOT CLOSEABLE BY A BETTER REGEX. The hole
 * is a runtime branch inside a PRODUCER in a different file from the one the
 * scanner reads. So this guard does not read source at all: it CALLS THE REAL
 * DISPATCHERS and inspects the values they actually return.
 *
 * THE INVARIANT (written against the SPEC, not against the symptom):
 *   a result that will reach a 200 with a graph in scope must carry a freshness
 *   derivation — because `exitDerivationFor` in `response-finaliser.ts`
 *   deliberately refuses the persisted-graph fallback whenever a graph is in
 *   scope, so such a result has no honest verdict left to fall back to.
 *
 * ⚠ KNOWN GAPS ARE PINNED, NOT HIDDEN. Two graph-bearing REFUSAL returns still
 * thread no derivation. They are listed in {@link KNOWN_GAPS} and this suite
 * REDs if that set GROWS **or** SHRINKS — so the gap is visible in the suite
 * rather than invisible to it, and closing one is a deliberate edit here rather
 * than a silent change in behaviour.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

const SCENARIO_ID = '66666666-6666-4666-8666-666666666666';

/** The same analysable shape the route-level freshness suite uses. */
function buildPersistedGraph() {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      { id: 'd-spend', kind: 'decision', label: 'How much to spend' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now', interventions: { 'f-budget': { value: 0.6 } } },
      { id: 'o-wait', kind: 'option', label: 'Wait a quarter', interventions: { 'f-budget': { value: 0.2 } } },
    ],
    edges: [
      { from: 'f-budget', to: 'g-revenue', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
      { from: 'd-spend', to: 'o-launch', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
      { from: 'd-spend', to: 'o-wait', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
      { from: 'o-launch', to: 'f-budget', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
      { from: 'o-wait', to: 'f-budget', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
    ],
  };
}

const PRIOR_TURN_ROW = {
  id: 'row-prior-runtime-1',
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-runtime-1',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-runtime-1',
  response_emitted: true,
  llm_calls_used: 0,
  duration_ms: 8,
  created_at: '2026-05-01T01:00:00.000Z',
  user_message: 'Run the analysis.',
  assistant_message: 'Analysis complete.',
};

const PRIOR_RUN_ANALYSIS_FACT = {
  fact_type: 'run_analysis' as const,
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'o-launch',
    summary: 'prior analysis',
    enrichment: { analysis_status: 'complete' },
    graph_hash_at_run: 'a-hash-from-an-earlier-model',
    computed_at: '2026-05-01T02:00:00.000Z',
  },
};

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
let persisted: unknown = buildPersistedGraph();

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [PRIOR_TURN_ROW],
    readFactsFor: async () => [PRIOR_RUN_ANALYSIS_FACT],
    readMostRecentPendingActions: async () => [],
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { dispatchSystemEvent } = await import('../dispatch.js');

/**
 * THE PINNED KNOWN GAPS — graph-bearing results that still thread no
 * derivation. Each is a REFUSAL whose `graph` is carried only so the egress
 * id-leak scrub can resolve entity ids to labels; no mutation occurred.
 *
 * ⚠ Listed so the suite stays green FOR THE RIGHT REASON and REDs if the set
 * moves in EITHER direction. Closing one means deleting its entry here, which
 * is a reviewable edit rather than a silent behaviour change.
 */
const KNOWN_GAPS: ReadonlySet<string> = new Set([
  'structural_delete/refused',
]);

interface Probe {
  readonly name: string;
  readonly event: Record<string, unknown>;
  /** What this probe is FOR — so a probe that stops discriminating is visible. */
  readonly expectGraphInScope: boolean;
}

/**
 * The server's own base hash for the fixture. Supplying it is what gets the
 * delete probe PAST the CAS conflict gate (a 409, which never reaches the
 * finaliser) and into the domain-refusal branch this probe is actually for.
 * A null hash would make the probe vacuous, so it fails loudly instead.
 */
function currentBaseHash(): string {
  const hash = computeAnalysisAffectingGraphHash(buildPersistedGraph() as never);
  if (hash === null) throw new Error('fixture produced no analysis-affecting hash — the delete probe would be vacuous');
  return hash;
}

const PROBES: readonly Probe[] = [
  {
    // THE FIXED PATH: a real mutation, persisted. Graph in scope, and it must
    // now carry its own derivation.
    name: 'factor_value_edit/applied',
    event: { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
    expectGraphInScope: true,
  },
  {
    // A refusal that writes nothing and declares NO graph — the honest
    // `no_graph_this_turn` case, and the contrast that proves this probe is
    // discriminating rather than reporting one answer for everything.
    name: 'factor_value_edit/refused',
    event: { kind: 'factor_value_edit', target_id: 'f-budget', value: 1.5, raw_value: 150000, unit: '£' },
    expectGraphInScope: false,
  },
  {
    // A DIFFERENT dispatcher, still graph-bearing — this is the probe that
    // proves the guard bites beyond the exit that was fixed.
    name: 'structural_delete/refused',
    event: {
      kind: 'structural_delete',
      removed_node_ids: ['no-such-node'],
      removed_edges: [],
      // ⚠ THE CORRECT base hash, deliberately. Omitting it lands on the CAS
      // conflict branch, which the route turns into a 409 — a result that never
      // reaches the finaliser and therefore cannot ship the false cause. The
      // probe would then observe "no violation" and agree with a healthy tree
      // for entirely the wrong reason.
      base_graph_hash: currentBaseHash(),
    },
    expectGraphInScope: true,
  },
];

interface Observation {
  readonly name: string;
  readonly reaches200: boolean;
  readonly graphInScope: boolean;
  readonly threadsFreshness: boolean;
}

async function observe(probe: Probe, suffix: string): Promise<Observation> {
  persisted = buildPersistedGraph();
  const result = await dispatchSystemEvent({
    payload: {
      kind: 'system_event',
      turn_id: `77777777-7777-4777-8777-7777777777${suffix}`,
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      event: probe.event,
    },
    requestId: `req-${probe.name}`,
  } as never);

  const r = result as {
    commitPerformed: boolean;
    graph: unknown;
    freshness?: unknown;
    graphConflict?: unknown;
    commitSkippedReason?: string;
  };

  // The route's own ladder, mirrored: a graph conflict is a 409 and a failed
  // commit is a 500 — neither reaches the finaliser, so neither can ship the
  // false cause. Only a 200 can.
  const reaches200 =
    r.graphConflict === undefined &&
    (r.commitPerformed || r.commitSkippedReason === 'client_only_event');

  return {
    name: probe.name,
    reaches200,
    graphInScope: r.graph !== null && r.graph !== undefined,
    threadsFreshness: r.freshness !== undefined,
  };
}

describe('runtime — a system-event exit that carries a graph must carry a freshness derivation', () => {
  let observations: Observation[] = [];

  beforeEach(async () => {
    appendMock.mockClear();
    observations = [];
    let i = 0;
    for (const probe of PROBES) {
      observations.push(await observe(probe, String(i)));
      i += 1;
    }
  });

  it('THE PROBE IS NOT BLIND — every dispatch reached a 200 and was observed', () => {
    // Trap 13: an absence claim over an empty or erroring population is not a
    // finding. If a dispatcher started throwing, every assertion below would
    // pass by observing nothing.
    expect(observations).toHaveLength(PROBES.length);
    expect(observations.every((o) => o.reaches200)).toBe(true);
  });

  it('THE PROBE DISCRIMINATES — it sees BOTH graph-bearing and graph-less results', () => {
    // Trap 20: when a per-item probe returns the same answer for every item,
    // suspect the probe. Each probe declares which class it is FOR, and the
    // observation must match — so a probe that silently stops reaching its
    // intended branch fails here rather than quietly agreeing.
    for (const probe of PROBES) {
      const o = observations.find((x) => x.name === probe.name)!;
      expect(`${probe.name}:${o.graphInScope}`).toBe(`${probe.name}:${probe.expectGraphInScope}`);
    }
    expect(observations.some((o) => o.graphInScope)).toBe(true);
    expect(observations.some((o) => !o.graphInScope)).toBe(true);
  });

  it('THE FIX — the applied factor edit carries its own derivation', () => {
    const applied = observations.find((o) => o.name === 'factor_value_edit/applied')!;
    expect(applied.graphInScope).toBe(true);
    // The assertion that was FALSE before this change.
    expect(applied.threadsFreshness).toBe(true);
  });

  it('THE INVARIANT — violations equal the pinned KNOWN_GAPS, exactly', () => {
    const violations = observations
      .filter((o) => o.reaches200 && o.graphInScope && !o.threadsFreshness)
      .map((o) => o.name)
      .sort();

    expect(
      violations,
      'A system-event dispatch returned a NON-NULL graph and no freshness derivation, and it ' +
        'reaches a 200. `response-finaliser.ts` will compose ' +
        '`unknown_degraded` / `no_graph_this_turn` for it — a cause whose contract text asserts ' +
        '"no graph was in scope", which is FALSE for this result, and a degraded verdict that ' +
        "outranks the UI's retained state. Derive the verdict at the return site the way " +
        '`dispatchEdgeStrengthEdit`, `dispatchStructuralDelete` and `dispatchFactorValueEdit` ' +
        'do on their success returns. Do NOT reach for `exitFreshness`: `exitDerivationFor` ' +
        'refuses it whenever a graph is in scope, deliberately. If you have CLOSED one of ' +
        'these, delete its entry from KNOWN_GAPS in this file.',
    ).toEqual([...KNOWN_GAPS].sort());
  });

  it('KNOWN_GAPS IS NOT A DUMPING GROUND — every pinned gap is still observed as one', () => {
    // The other direction (doctrine 22f): the set must RED if a gap silently
    // CLOSES too, so nobody can leave a stale entry standing in for work that
    // was already done — or add an entry for a probe that no longer runs.
    const observedNames = new Set(observations.map((o) => o.name));
    for (const gap of KNOWN_GAPS) {
      expect(observedNames.has(gap), `KNOWN_GAPS lists "${gap}" but no probe observes it`).toBe(true);
    }
  });
});
