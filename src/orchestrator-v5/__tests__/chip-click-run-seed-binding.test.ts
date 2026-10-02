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

type Rec = Record<string, any>;
const SCENARIO = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const served = JSON.parse(readFileSync(new URL('../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as { graph: Rec };
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;
const DRAW_KEY = 'd'.repeat(64);

function harness() {
  const graph = structuredClone(served.graph);
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
  /**
   * `agedOut`: the prior Run's turn has left the 20-turn hot window — the window reads back NO turns or facts, while the
   * scenario's durable analysis read still holds every committed Run (+ `durableExtra`, newest first). `durableDown`: the
   * durable read throws (the reconciled set degrades).
   */
  const run = async (turnId: string, opts: { agedOut?: boolean; durableExtra?: HandlerFact[]; durableDown?: boolean } = {}) => {
    const hot = opts.agedOut === true ? [] : window;
    const priorTurns = hot.map((_, i) => ({
      id: `row-run-${i}`, scenario_id: SCENARIO, user_id: null, turn_id: `turn-run-${i}`, turn_class: 'handler',
      handler_id: 'run_analysis', request_hash: 'sha256:run', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
      created_at: '2026-10-01T19:42:00.000Z',
    })) as unknown as SessionTurn[];
    const writes: SessionTurnWrite[] = [];
    const base = createNoopSessionStore({
      priorTurns, facts: [...hot],
      ...(opts.agedOut === true ? { scenarioAnalysisFacts: [...(opts.durableExtra ?? []), ...window] } : {}),
      ...(opts.durableDown === true ? { throwOnScenarioAnalysisFactRead: new Error('durable read down') } : {}),
    });
    storeHolder.current = { ...base, append: async (w: SessionTurnWrite) => { writes.push(w); return { id: `row-${turnId}` }; } };
    await dispatchChipClickRunAnalysis({
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
  return { sentSeeds, seenBindings, run, setPrice, window };
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
    const built = buildRunDelta({ priorFacts: h.window as never, mayNameLeadingOption: true });
    expect((built as { delta: Rec }).delta.attribution_case).toBe('C1_attributable');
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

  it('B7 (DL condition 1): the window holds the NEWEST Run → the window lends, never an older durable seed', async () => {
    const h = harness();
    await h.run('turn-a');
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    const b = await h.run('turn-b');
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(61);
    await h.run('turn-c');
    expect(h.sentSeeds[2], 'Run C borrows the NEWEST prior Run (B), from the window').toBe(seedOf(b));
  });
});
