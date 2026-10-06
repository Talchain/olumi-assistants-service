/**
 * ⛔ C1 ON THE PATH THE USER'S RUN ACTUALLY TAKES (R3 #85 5939245408; DL ruling 5939278824).
 *
 * The Run chip, the Agent's Run fast path and its `run_analysis` tool all post a typed `chip_click` / `run_analysis`
 * turn, which route-v2 sends to `dispatchChipClickRunAnalysis` — never `runTurnExecutor`. #2410 bound the prior Run's
 * seed only in the executor, so on served 4e53dfa5 (journey 2, 1 Oct 19:42–19:45Z) every Run logged
 * `run_analysis.seed_reuse` `no_prior_run` although `v5_turn_context_facts` showed `run_analysis` facts in the same
 * request's window. "Change that link to slight" → Re-run then paired as `C2_unpaired` and M2 could not say why it moved.
 *
 * Real dispatcher, real `run_analysis` handler, the served c96fc4bb graph; the PLoT double echoes a caller seed and
 * otherwise derives one from the graph's values (PLoT `resolveSeed`), so a value edit moves an unlent seed.
 *
 *   B1 a prior Run in the window → the chip Run sends that Run's own seed echo to PLoT, and the pair is C1.
 *   B2 (control) an empty window → no seed sent; the binding is present and says `no_prior_run` for the real reason.
 *   B3 the read-A guard is unchanged: bound as `NO_CLAIM`, which stands it down exactly as no binding did.
 * ONE HISTORY FOR THE SEED AND THE PAIR (F1b lease #85 5947561416; R3 5945463416: after 20+ turns the turn said
 * `insufficient_runs` while the cold read paired A→B):
 *   B9  A aged out → the dispatch hands the finaliser [B, A]: freshness selects B, the turn's run_delta pairs A→B (C1),
 *       and the paired prior IS the Run that lent the seed.
 *   B9c (control) aged out AND the durable read down → [B] only → honest `insufficient_runs` (today's answer).
 *   B10 (control) the window holds a Run → the window, never durable Runs mixed in.
 * CODEX on 84f47072 (freshness stays on the window; only the PAIR reads the history):
 *   B11 durable Runs dated in the FUTURE (clock skew) → through the real finaliser the turn ships NO run_delta that
 *       leaves out THIS Run (the identity binding withholds it), never A1→A2.
 *   B13 the prior SHOWN Run aged out → no "first analysis" coaching and no FIRST_ANALYSIS_COMPLETE on this Run's fact.
 *   B13c (control) a genuinely first Run → FIRST_ANALYSIS_COMPLETE as today.
 *   B13p the aged-out shown prior was PARTIAL → still no "first analysis" (CODEX r2 surviving mutant).
 * CODEX on 6b053a8b (a durable Run dated after THIS Run):
 *   B14 durable [A, partial P dated 2099] → the finaliser never sees the durable history: priorFacts = [B], no pair
 *       (staging's answer), so neither C2 nor F-LIMIT can be evaded by a Run newer than this one.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { HandlerFact, SessionTurn } from '@talchain/schemas/orchestrator';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import { makeMessagePayload } from './fixtures.js';

const storeHolder: { current: SessionStore } = { current: createNoopSessionStore() };
vi.mock('../session/index.js', () => ({
  getSessionStore: () => storeHolder.current,
  resetSessionStoreForTests: () => {},
}));

const { dispatchChipClickRunAnalysis } = await import('../handlers/chip-click-dispatch.js');
const { loadScenarioSnapshotForRunAnalysis } = await import('../build-turn-context.js');
const { createRunAnalysisHandler } = await import('../tools/handlers/run-analysis.js');
const { buildRunDelta } = await import('../coaching/build-run-delta.js');
const { currentBoundAnalysisSnapshot, NO_CLAIM } = await import('../run-analysis-snapshot-binding.js');
const { finaliseV5Response } = await import('../response-finaliser.js');

type Rec = Record<string, any>;
const SCENARIO = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const served = JSON.parse(readFileSync(new URL('../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as { graph: Rec };
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;
const DRAW_KEY = 'd'.repeat(64);

function harness(opts: { goalLevelOlumis?: boolean } = {}) {
  const graph = structuredClone(served.graph);
  // MC D1 (b): the served goal level is the USER's, so Gate 5 withholds every comparison on this graph (no leader, so no
  // "explore the leading option"). The first-analysis rows need a Run whose leader CAN be named: the same graph with the
  // goal's level Olumi's, which Gate 5 does not read as the user's product.
  if (opts.goalLevelOlumis === true) {
    for (const n of graph.nodes as Rec[]) if (n.kind === 'goal' && n.observed_state) n.observed_state = { ...n.observed_state, source: 'cee_inference' };
  }
  graph.nodes.find((n: Rec) => n.id === 'keep_current_price')!.interventions = {
    pro_plan_price: { value: 0.245, raw_value: 49, unit: 'GBP/month', source: 'brief_extraction' },
  };
  const sentSeeds: unknown[] = [];
  const seenBindings: unknown[] = [];
  const plotClient = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      sentSeeds.push(body.seed);
      const response = structuredClone(happy) as Rec;
      response.results = (body.options as Rec[]).map((o, index) => ({
        option_id: o.option_id, option_label: o.label,
        win_probability: [0.6, 0.4][index] ?? 0, percentile_p10: 0.1, percentile_p90: 0.9,
      }));
      response.fact_objects = [];
      response.review_cards = [];
      // PLoT `resolveSeed`: a caller seed wins, echoed as a string; else a digest of the graph's values.
      const derived = String(parseInt(createHash('sha256').update(JSON.stringify(body.graph)).digest('hex').slice(0, 7), 16));
      response.meta = { ...(response.meta as Rec), seed_used: body.seed !== undefined ? String(body.seed) : derived };
      // A value edit keeps PLoT's draw-structure key (PLoT `isl-draw-structure-key` rows); one opaque key for both Runs.
      response._meta = { builds: { plot: 'p1', isl: 'i1' }, evidence: { isl_draw_structure_key: DRAW_KEY } };
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'c1-chip', createNoopSessionStore({ loadGraphResult: structuredClone(graph) })),
  });
  const registry = new Map([['run_analysis', async (invocation: never) => {
    seenBindings.push(currentBoundAnalysisSnapshot());
    return handler(invocation);
  }]]) as never;

  /** Committed Run facts, newest first — what the next turn's window reads back. */
  const window: HandlerFact[] = [];
  /** The last dispatch result — what route-v2 hands the finaliser (`priorFacts`, `freshness`). */
  const last: { out?: Rec } = {};
  /**
   * `agedOut`: the prior Run's turn has left the 20-turn hot window — the window reads back NO turns or facts, while the
   * scenario's durable analysis read still holds every committed Run (+ `durableExtra`, newest first). `durableDown`: the
   * durable read throws (the reconciled set degrades).
   */
  const run = async (turnId: string, opts: { agedOut?: boolean; durableExtra?: HandlerFact[]; durableDown?: boolean; hotAfterAgeOut?: HandlerFact[] } = {}) => {
    const hot = opts.agedOut === true ? [...(opts.hotAfterAgeOut ?? [])] : window;
    const priorTurns = hot.map((_, i) => ({
      id: `row-run-${i}`, scenario_id: SCENARIO, user_id: null, turn_id: `turn-run-${i}`, turn_class: 'handler',
      handler_id: 'run_analysis', request_hash: 'sha256:run', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
      created_at: '2026-10-01T19:42:00.000Z',
    })) as unknown as SessionTurn[];
    const writes: SessionTurnWrite[] = [];
    const base = createNoopSessionStore({
      priorTurns, facts: [...hot],
      ...(opts.agedOut === true || opts.durableExtra !== undefined ? { scenarioAnalysisFacts: [...(opts.durableExtra ?? []), ...window] } : {}),
      ...(opts.durableDown === true ? { throwOnScenarioAnalysisFactRead: new Error('durable read down') } : {}),
    });
    storeHolder.current = { ...base, append: async (w: SessionTurnWrite) => { writes.push(w); return { id: `row-${turnId}` }; } };
    last.out = await dispatchChipClickRunAnalysis({
      payload: makeMessagePayload({
        scenario_id: SCENARIO, turn_id: turnId, stage: 'analyse', message: 'Run analysis.', turn_class: 'decide',
        source: 'chip_click', chip: { action_type: 'run_analysis' },
      }),
      requestId: turnId,
      handlerRegistry: registry,
    });
    const fact = writes.flatMap((w) => w.handler_facts ?? []).find((f) => f.fact_type === 'run_analysis') as Rec | undefined;
    expect(fact, 'the chip Run commits one Run fact').toBeDefined();
    window.unshift(fact as HandlerFact);
    return fact!;
  };
  const setPrice = (raw: number) => {
    const node = graph.nodes.find((n: Rec) => n.id === 'raise_price_to_59')!;
    node.interventions.pro_plan_price = { ...node.interventions.pro_plan_price, value: raw / 200, raw_value: raw };
  };
  return { sentSeeds, seenBindings, run, setPrice, window, last };
}

describe('C1 on the chip Run path — the prior Run lends its seed (R3 #85 5939245408)', () => {
  it('B1: a prior Run in the window → the chip Run sends that Run\'s own seed echo → the pair is C1', async () => {
    const h = harness();
    const a = await h.run('turn-a');
    const seedA = a.result.enrichment.meta.seed_used as string;
    expect(h.sentSeeds[0], 'Run A has no prior: PLoT derives its seed').toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    await h.run('turn-b');
    expect(h.sentSeeds[1], 'Run B sends Run A\'s seed echo, verbatim').toBe(seedA);
    const built = buildRunDelta({ priorFacts: h.window as never, mayNameLeadingOption: true });
    expect(built.kind, JSON.stringify(built).slice(0, 300)).toBe('ok');
    const delta = (built as { delta: Rec }).delta;
    expect(delta.pair_provenance).toMatchObject({ seed_equal: true, hash_equal: false });
    expect(delta.attribution_case).toBe('C1_attributable');
  });

  it('B2 (control): an empty window → no seed sent; the binding is present and says no_prior_run', async () => {
    const h = harness();
    await h.run('turn-only');
    expect(h.sentSeeds[0]).toBeUndefined();
    expect(h.seenBindings[0], 'the chip turn is bound — absence is the real reason, not a missing binding').toMatchObject({
      scenarioId: SCENARIO, priorRunSeed: 'no_prior_run',
    });
  });

  it('B3: the read-A guard is unchanged — bound as NO_CLAIM, which stands it down as no binding did', async () => {
    const h = harness();
    await h.run('turn-a');
    await h.run('turn-b');
    for (const bound of h.seenBindings) expect((bound as Rec).analysisGraphHash).toBe(NO_CLAIM);
    const a = h.window[1] as Rec;
    expect((h.seenBindings[1] as Rec).priorRunSeed, 'the EXACT seed Run A echoed').toMatchObject({ seedUsed: a.result.enrichment.meta.seed_used });
  });
});

/**
 * ⭐ C1 DURABLE HISTORY (DL lease 5944383317, narrowed to the seed; DL conditions): a user who talks for 20+ turns between
 * Runs loses the prior Run from the turn's hot window. The seed is then lent from the scenario's reconciled DURABLE set —
 * attested for THIS scenario, `complete | capped` — never from a foreign scenario, a non-Run fact, or a failed Run, and the
 * window always wins when it holds a Run. Through the REAL chip dispatcher (every Run goes route-v2 → this exit).
 */
describe('C1 durable history — a Run that aged out of the hot window still lends its seed', () => {
  const seedOf = (f: Rec) => f.result.enrichment.meta.seed_used as string;
  const runFact = (seed: string, extra: Rec = {}) => {
    const f = structuredClone(happyFact) as Rec;
    f.result.enrichment.meta.seed_used = seed;
    f.result.computed_at = '2099-01-01T00:00:00.000Z';
    Object.assign(f.result, extra);
    return f as unknown as HandlerFact;
  };
  let happyFact: Rec;

  it('B4 (RED): Run A aged out of the window, the durable set holds it → Run B sends A\'s EXACT seed → the pair is C1', async () => {
    const h = harness();
    const a = await h.run('turn-a');
    happyFact = structuredClone(a);
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    await h.run('turn-b', { agedOut: true });
    expect(h.sentSeeds[1], 'Run B sends Run A\'s seed echo, verbatim').toBe(seedOf(a));
    expect((h.seenBindings[1] as Rec).priorRunSeed).toMatchObject({ seedUsed: seedOf(a) });
    // The COLD read pairs from the durable set (scenario-graph-analysis-read.ts:341), which holds A and B: C1. (The turn's own
    // delta reads the hot window, which lost A, and honestly emits none: CODEX-confirmed `insufficient_runs`.)
    const built = buildRunDelta({ priorFacts: h.window as never, mayNameLeadingOption: true });
    expect((built as { delta: Rec }).delta.attribution_case).toBe('C1_attributable');
  });

  it('B4b (CODEX r2): the window still holds a FAILED Run after A aged out (non-empty, no success) → the durable set lends A\'s EXACT seed', async () => {
    const h = harness();
    const a = await h.run('turn-a');
    happyFact = structuredClone(a);
    const failed = runFact('555555');
    (((failed as unknown as Rec).result.enrichment) as Rec).analysis_status = 'failed';
    await h.run('turn-b', { agedOut: true, hotAfterAgeOut: [failed], durableExtra: [failed] });
    expect(h.sentSeeds[1], 'Run B sends Run A\'s seed echo, verbatim').toBe(seedOf(a));
  });

  it('B5 (control): aged out AND the durable read is down → no seed; the binding says no_prior_run (today\'s answer)', async () => {
    const h = harness();
    await h.run('turn-a');
    await h.run('turn-b', { agedOut: true, durableDown: true });
    expect(h.sentSeeds[1]).toBeUndefined();
    expect((h.seenBindings[1] as Rec).priorRunSeed).toBe('no_prior_run');
  });

  // Each intruder's EXACT outcome: the successful-Run selector skips a failed Run (Run A lends); the reconciler refuses a
  // durable page carrying a non-Run fact or another scenario's Run (degraded → the window → `no_prior_run`, fail-closed).
  it.each([
    ['a NEWER failed Run (same writer, not successful) → skipped: Run A lends', (f: HandlerFact) => { (((f as unknown as Rec).result.enrichment) as Rec).analysis_status = 'failed'; return f; }, 'A'],
    ['a NEWER non-Run fact → the durable page is refused → no_prior_run', (f: HandlerFact) => ({ ...(f as unknown as Rec), fact_type: 'explain_results' }) as unknown as HandlerFact, 'none'],
    ['a NEWER Run of ANOTHER scenario → the durable page is refused → no_prior_run', (f: HandlerFact) => { ((f as unknown as Rec).result as Rec).scenario_id = '22222222-2222-4222-8222-222222222222'; return f; }, 'none'],
  ] as const)('B6 (writer identity): %s', async (_n, mutate, expected) => {
    const h = harness();
    const a = await h.run('turn-a');
    happyFact = structuredClone(a);
    await h.run('turn-b', { agedOut: true, durableExtra: [mutate(runFact('777777'))] });
    if (expected === 'A') {
      expect(h.sentSeeds[1]).toBe(seedOf(a));
      expect((h.seenBindings[1] as Rec).priorRunSeed).toMatchObject({ seedUsed: seedOf(a) });
    } else {
      expect(h.sentSeeds[1]).toBeUndefined();
      expect((h.seenBindings[1] as Rec).priorRunSeed).toBe('no_prior_run');
    }
  });

  it('B7 (DL condition 1): the window holds the NEWEST Run → the window lends it, never an older durable seed', async () => {
    const h = harness();
    const a = await h.run('turn-a');
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    // Run B draws FRESH (aged out + durable down), so its seed differs from A's and the donor is identifiable.
    const b = await h.run('turn-b', { agedOut: true, durableDown: true });
    expect(seedOf(b), 'precondition: B and A carry different seeds').not.toBe(seedOf(a));
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(61);
    await h.run('turn-c');
    expect(h.sentSeeds[2], 'Run C borrows the NEWEST prior Run (B), from the window').toBe(seedOf(b));
  });

  it('B8 (CODEX on 30bb9170): a Run IN the window lends even when the durable read is down — the window is the first authority', async () => {
    const h = harness();
    const a = await h.run('turn-a');
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    await h.run('turn-b', { durableDown: true });
    expect(h.sentSeeds[1]).toBe(seedOf(a));
});

  const runIdOf = (f: Rec) => f.result.run_id as string;
  const runIdsOf = (facts: readonly Rec[]) => facts.filter((f) => f.fact_type === 'run_analysis').map(runIdOf);

  it('B9 (RED, R3 5945463416): A1, A2 aged out → the turn pairs A2→B; seed donor = live prior = cold prior, by identity', async () => {
    const h = harness();
    const a1 = await h.run('turn-a1');
    happyFact = structuredClone(a1);
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    // A2 draws FRESH (as B7's B: aged out + durable down), so A1 and A2 carry different seeds and the donor is identifiable.
    const a2 = await h.run('turn-a2', { agedOut: true, durableDown: true });
    expect(seedOf(a2), 'precondition: the two earlier Runs drew different seeds').not.toBe(seedOf(a1));
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(61);
    const b = await h.run('turn-b', { agedOut: true });
    const out = h.last.out!;
    expect(runIdsOf(out.priorFacts), 'the post-dispatch history: this Run, then the durable Runs newest first').toEqual([runIdOf(b), runIdOf(a2), runIdOf(a1)]);
    expect(runIdOf(out.priorFacts[out.freshness.selected_fact_index]), 'freshness selects THIS Run').toBe(runIdOf(b));
    expect(h.sentSeeds[2], 'the seed donor is A2 (not A1)').toBe(seedOf(a2));
    const live = buildRunDelta({ priorFacts: out.priorFacts, mayNameLeadingOption: true }) as { kind: string; delta: Rec };
    expect(live.kind).toBe('ok');
    expect([live.delta.endpoints?.prior?.run_id, live.delta.endpoints?.current?.run_id], 'the live pair: A2 → B').toEqual([runIdOf(a2), runIdOf(b)]);
    expect(live.delta.attribution_case).toBe('C1_attributable');
    // The cold read pairs from the durable set, which holds every committed Run (`h.window`): the SAME prior.
    const cold = buildRunDelta({ priorFacts: h.window as never, mayNameLeadingOption: true }) as { kind: string; delta: Rec };
    expect(cold.delta.endpoints?.prior?.run_id, 'cold prior = live prior = seed donor').toBe(live.delta.endpoints?.prior?.run_id);
  });

  it('B9c (control): aged out AND the durable read down → [B] only → the turn honestly says insufficient_runs', async () => {
    const h = harness();
    await h.run('turn-a');
    const b = await h.run('turn-b', { agedOut: true, durableDown: true });
    const out = h.last.out!;
    expect(runIdsOf(out.priorFacts)).toEqual([runIdOf(b)]);
    expect(buildRunDelta({ priorFacts: out.priorFacts, mayNameLeadingOption: true })).toMatchObject({ kind: 'none', reason: 'insufficient_runs' });
  });

  it('B10 (control): the window holds a Run → the turn pairs from the window, no durable Run mixed in', async () => {
    const h = harness();
    const a = await h.run('turn-a');
    const extra = { ...structuredClone(a), result: { ...structuredClone(a).result, run_id: 'f'.repeat(64) } } as Rec;
    const b = await h.run('turn-b', { durableExtra: [extra as HandlerFact] });
    expect(runIdsOf(h.last.out!.priorFacts), 'the newer durable-only Run is never paired while the window holds one').toEqual([runIdOf(b), runIdOf(a)]);
  });

  /** The chip exit's finaliser, fed exactly as route-v2 feeds it (`route-v2.ts` chip `ok` exit). */
  const finaliseChip = (out: Rec) => finaliseV5Response(out.response, {
    scenarioId: SCENARIO, analysisReady: out.analysisReady, graph: out.graph, mayNameLeadingOption: out.mayNameLeadingOption,
    ...(out.freshness ? { freshness: out.freshness } : {}), ...(out.priorFacts ? { priorFacts: out.priorFacts } : {}),
  } as never) as unknown as Rec;

  it('B11 (CODEX P1-1): durable Runs dated in the FUTURE → the turn never ships a pair that leaves out THIS Run', async () => {
    const h = harness();
    await h.run('turn-a1');
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    await h.run('turn-a2', { agedOut: true, durableDown: true });
    (h.window[1] as Rec).result.computed_at = '2098-01-01T00:00:00.000Z';
    (h.window[0] as Rec).result.computed_at = '2099-01-01T00:00:00.000Z';
    h.setPrice(61);
    const b = await h.run('turn-b', { agedOut: true });
    const body = finaliseChip(h.last.out!);
    const shipped = body.run_delta as Rec | undefined;
    expect(shipped === undefined || shipped.endpoints?.current?.run_id === runIdOf(b), 'no pair without THIS Run').toBe(true);
    expect(shipped, 'the skewed pair is withheld, not shown').toBeUndefined();
  });

  it('B13 (CODEX P2-4): the prior SHOWN Run aged out → no "first analysis" coaching on the Run that pairs with it', async () => {
    const h = harness({ goalLevelOlumis: true });
    await h.run('turn-a');
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    const b = await h.run('turn-b', { agedOut: true });
    expect(runIdsOf(h.last.out!.priorFacts).length, 'precondition: the turn pairs with the aged-out Run').toBe(2);
    expect(JSON.stringify(b), 'no FIRST_ANALYSIS_COMPLETE on this Run').not.toContain('FIRST_ANALYSIS_COMPLETE');
    expect(JSON.stringify(h.last.out!.response).toLowerCase()).not.toContain('first analysis');
  });

  it('B13c (control): a genuinely first Run → FIRST_ANALYSIS_COMPLETE as today', async () => {
    const h = harness({ goalLevelOlumis: true });
    const a = await h.run('turn-a');
    expect(JSON.stringify(a)).toContain('FIRST_ANALYSIS_COMPLETE');
  });

  it('B13p (CODEX r2 mutant): the aged-out shown prior was PARTIAL → still no "first analysis"', async () => {
    const h = harness();
    await h.run('turn-a');
    (h.window[0] as Rec).result.enrichment.analysis_status = 'partial';
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    const b = await h.run('turn-b', { agedOut: true });
    expect(JSON.stringify(b), 'no FIRST_ANALYSIS_COMPLETE on this Run').not.toContain('FIRST_ANALYSIS_COMPLETE');
  });

  it('B14 (CODEX r2 P1-1/P1-2): a durable partial dated AFTER this Run → the finaliser never sees the durable history', async () => {
    const h = harness();
    await h.run('turn-a');
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    await h.run('turn-p', { agedOut: true, durableDown: true });
    const p = h.window[0] as Rec;
    p.result.enrichment.analysis_status = 'partial';
    p.result.computed_at = '2099-01-01T00:00:00.000Z';
    h.setPrice(61);
    const b = await h.run('turn-b', { agedOut: true });
    expect(runIdsOf(h.last.out!.priorFacts), 'the window (empty) — not the history holding a Run newer than this one').toEqual([runIdOf(b)]);
    expect(finaliseChip(h.last.out!).run_delta, 'no pair').toBeUndefined();
  });
});
