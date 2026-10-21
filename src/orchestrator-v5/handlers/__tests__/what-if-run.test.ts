/**
 * A WHAT-IF ON THE CANVAS, NOTHING SAVED (canvas scenario comparison, DL 21 Oct).
 *
 * Part 1, the REAL variant path (`runVariant`: real snapshot loader, real `run_analysis` handler, the served c96fc4bb
 * graph; the PLoT double echoes a caller seed, else derives one from the graph, as PLoT `resolveSeed`):
 *   S1 a prior Run committed by the real chip dispatcher → a what-if variant with NO explicit seed sends that Run's own
 *      seed echo to PLoT, and nothing is written (the chip Run's own append is the positive control).
 *   S2 (contrast) the stress path's explicit seed wins: a what-if must never pass one, or it stops pairing with the Run.
 * Part 2, `runWhatIf` on the real edit chain (`applyExplicitEdit` + mapper on `KNOWN_ANSWER`), the PLoT run faked.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { HandlerFact, SessionTurn } from '@talchain/schemas/orchestrator';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';
import type { SessionStore, SessionTurnWrite } from '../../session/store.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { KNOWN_ANSWER } from '../../path-b/living-model/__tests__/fixtures.js';
import type { StressChance } from '../../path-b/tools/stress-tool.js';

const storeHolder: { current: SessionStore } = { current: createNoopSessionStore() };
vi.mock('../../session/index.js', () => ({ getSessionStore: () => storeHolder.current, resetSessionStoreForTests: () => {} }));

const { dispatchChipClickRunAnalysis } = await import('../chip-click-dispatch.js');
const { loadScenarioSnapshotForRunAnalysis } = await import('../../build-turn-context.js');
const { createRunAnalysisHandler } = await import('../../tools/handlers/run-analysis.js');
const { runVariant } = await import('../stress-variant-run.js');
const { runWhatIf, VARIATION_WORDS, NO_RESULT_WORDS, NOT_IN_RUN_WORDS } = await import('../what-if-run.js');
const { mapLivingModel } = await import('../../path-b/living-model/mapper.js');
const { computeExpectedGraphCasHashes } = await import('../../context/graph-cas-conflict.js');

type Rec = Record<string, any>;
const SCENARIO = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const served = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as { graph: Rec };
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;

function realPath() {
  const graph = structuredClone(served.graph);
  graph.nodes.find((n: Rec) => n.id === 'keep_current_price')!.interventions = {
    pro_plan_price: { value: 0.245, raw_value: 49, unit: 'GBP/month', source: 'brief_extraction' },
  };
  const sentSeeds: unknown[] = [];
  const plotClient = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      sentSeeds.push(body.seed);
      const response = structuredClone(happy) as Rec;
      response.results = (body.options as Rec[]).map((o, index) => ({
        option_id: o.option_id, option_label: o.label, win_probability: [0.6, 0.4][index] ?? 0, percentile_p10: 0.1, percentile_p90: 0.9,
      }));
      response.fact_objects = [];
      response.review_cards = [];
      const derived = String(parseInt(createHash('sha256').update(JSON.stringify(body.graph)).digest('hex').slice(0, 7), 16));
      response.meta = { ...(response.meta as Rec), seed_used: body.seed !== undefined ? String(body.seed) : derived };
      response._meta = { builds: { plot: 'p1', isl: 'i1' }, evidence: { isl_draw_structure_key: 'd'.repeat(64) } };
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'wi-chip', createNoopSessionStore({ loadGraphResult: structuredClone(graph) })),
  });
  const writes: SessionTurnWrite[] = [];
  const window: HandlerFact[] = [];
  /** Point the store at the committed Runs (newest first), counting every append. */
  const useWindow = () => {
    const priorTurns = window.map((_, i) => ({
      id: `row-run-${i}`, scenario_id: SCENARIO, user_id: null, turn_id: `turn-run-${i}`, turn_class: 'handler', handler_id: 'run_analysis',
      request_hash: 'sha256:run', response_emitted: true, llm_calls_used: 0, duration_ms: 1, created_at: '2026-10-21T10:00:00.000Z',
    })) as unknown as SessionTurn[];
    storeHolder.current = { ...createNoopSessionStore({ priorTurns, facts: [...window] }),
      append: async (w: SessionTurnWrite) => { writes.push(w); return { id: `row-${writes.length}` }; } };
  };
  const payload = (turnId: string, extra: Rec = {}) => makeMessagePayload({ scenario_id: SCENARIO, turn_id: turnId, stage: 'analyse', message: 'Run analysis.', turn_class: 'decide', ...extra });
  const savedRun = async () => {
    useWindow();
    await dispatchChipClickRunAnalysis({
      payload: payload('turn-a', { source: 'chip_click', chip: { action_type: 'run_analysis' } }), requestId: 'turn-a',
      handlerRegistry: new Map([['run_analysis', handler]]) as never,
    });
    const fact = writes.flatMap((w) => w.handler_facts ?? []).find((f) => f.fact_type === 'run_analysis') as Rec | undefined;
    expect(fact, 'PRECONDITION: the chip Run commits one Run fact').toBeDefined();
    window.unshift(fact as HandlerFact);
    useWindow();
    return fact!.result.enrichment.meta.seed_used as string;
  };
  const whatIfGraph = () => {
    const g = structuredClone(graph);
    const node = g.nodes.find((n: Rec) => n.id === 'raise_price_to_59')!;
    node.interventions.pro_plan_price = { ...node.interventions.pro_plan_price, value: 0.3, raw_value: 60 };
    return g;
  };
  return { sentSeeds, plotClient, writes, savedRun, whatIfGraph, payload };
}

describe('the real variant path: a what-if draws the saved Run\'s samples and writes nothing', () => {
  it('S1: no explicit seed → PLoT receives the saved Run\'s own seed echo; the variant echoes it; 0 writes', async () => {
    const h = realPath();
    const seedA = await h.savedRun();
    expect(h.writes.length, 'POSITIVE CONTROL: the real chip Run does write').toBe(1);
    const out = await runVariant({ payload: h.payload('turn-wi'), requestId: 'turn-wi', variantGraph: h.whatIfGraph(), plotClient: h.plotClient });
    expect(out.kind).toBe('rows');
    expect(h.sentSeeds.at(-1), 'the what-if sends the saved Run\'s seed, verbatim').toBe(seedA);
    expect((out as { seedUsed: string | null }).seedUsed).toBe(seedA);
    expect(h.writes.length, 'NOTHING WRITTEN: no turn, no Run fact').toBe(1);
  });

  it('S2 (contrast): the stress path\'s explicit seed wins, so it does NOT pair with the saved Run', async () => {
    const h = realPath();
    const seedA = await h.savedRun();
    const out = await runVariant({ payload: h.payload('turn-st'), requestId: 'turn-st', variantGraph: h.whatIfGraph(), plotClient: h.plotClient, seed: 123 });
    expect(h.sentSeeds.at(-1)).toBe(123);
    expect((out as { seedUsed: string | null }).seedUsed).toBe('123');
    expect((out as { seedUsed: string | null }).seedUsed).not.toBe(seedA);
  });
});

// ── Part 2: runWhatIf on the real edit chain ──────────────────────────────────────────────────────────────────────────
const stored = () => ({ ...mapLivingModel(structuredClone(KNOWN_ANSWER)).graph, living_model: structuredClone(KNOWN_ANSWER) });
const BASE = computeExpectedGraphCasHashes(stored()).expectedGraphAnalysisHash as string;
it('PRECONDITION: the saved fixture has an analysis hash, so the stale rows test a real comparison', () => expect(BASE).toMatch(/\S/));
const chance = (display: string, pct: number | null = 42): StressChance => ({ display, pct, provisional: false, not_shown: null });
const VALUE = { kind: 'factor_value_edit', target_id: 'f', value: 0.7, raw_value: 0.7 };
const LINK = { kind: 'edge_strength_edit', from: 'f', to: 'g', magnitude: 0.2, direction_intent: 'preserve', base_graph_hash: BASE };

/** A fake PLoT run: each call's graph is recorded; `f`'s value decides the display, so a change is visible by identity. */
type FakeOpts = { pushPct?: (number | null)[]; n?: number | null; step?: 'whole' | 'nearest_5' };
function fakeRun(seeds: (string | null)[] = [], opts: FakeOpts = {}) {
  const calls: { graph: Rec; seed: unknown }[] = [];
  const run = vi.fn(async (p: { variantGraph: Rec; seed?: number }) => {
    calls.push({ graph: p.variantGraph, seed: p.seed });
    // Read from the MAPPED graph PLoT receives, never the living model beside it (Codex #3591: a variant that sent the saved
    // graph under an edited living model must not pass).
    const f = (p.variantGraph.nodes as Rec[]).find((n) => n.id === 'f')!.observed_state.value;
    const strength = Math.round((p.variantGraph.edges as Rec[]).find((e) => e.from === 'f' && e.to === 'g')!.strength.mean * 100) / 100;
    const pushPct = opts.pushPct === undefined ? 42 : opts.pushPct[calls.length - 1] ?? null;
    return { kind: 'rows' as const, seedUsed: calls.length <= seeds.length ? seeds[calls.length - 1]! : 'seed-a',
      nSamples: opts.n === undefined ? 10000 : opts.n, displayStep: new Map([['push', opts.step ?? 'whole']]),
      rows: new Map([['push', chance(`push f=${f} s=${strength}`, pushPct)], ['hold', chance('hold')]]) };
  });
  return { run, calls };
}
const ask = (changes: Rec[], crux = false) => ({ payload: makeMessagePayload({ scenario_id: SCENARIO }), requestId: 'wi', changes, crux });

describe('runWhatIf: the canvas gestures, held, applied to a COPY and run beside the saved model', () => {
  it('CONTROL: the current base hash runs (the stale rows below differ only by the hash)', async () => {
    const { run } = fakeRun();
    expect(await runWhatIf({ ...ask([VALUE, LINK]), baseGraphHash: BASE }, { loadSaved: async () => ({ graph: stored() }), run: run as never })).toMatchObject({ kind: 'ran' });
  });

  it('runs the saved model and the what-if, both with NO explicit seed; cells say no raw figure; the saved row is untouched', async () => {
    const row = stored();
    const before = structuredClone(row);
    const { run, calls } = fakeRun();
    const out = await runWhatIf(ask([VALUE]), { loadSaved: async () => ({ graph: row }), run: run as never });
    expect(out).toMatchObject({ kind: 'ran', persisted: false, changes_applied: [{ index: 0, target: { node_id: 'f' } }], changes_refused: [] });
    expect(calls.map((c) => c.seed), 'never an explicit seed: the Run lends the saved Run\'s').toEqual([undefined, undefined]);
    expect((calls[0]!.graph.living_model as typeof KNOWN_ANSWER).factors[0]!.value, 'first run = the saved model').toBe(0.5);
    expect((calls[1]!.graph.living_model as typeof KNOWN_ANSWER).factors[0]!.value, 'second = the what-if').toBe(0.7);
    const v = (out as Rec).variants[0];
    expect(v).toMatchObject({ change_index: 'all', paired: true });
    expect(v.options.find((o: Rec) => o.option_id === 'push')).toEqual({
      option_id: 'push', saved: { display: 'push f=0.5 s=0.4', provisional: false, not_shown: null }, what_if: { display: 'push f=0.7 s=0.4', provisional: false, not_shown: null },
      variation: 'not_judged', variation_words: VARIATION_WORDS.not_judged,
    });
    expect(JSON.stringify(out)).not.toContain('"pct"');
    expect(row, 'the saved row is never mutated').toEqual(before);
  });

  it('paired is PROVEN from the echoes: different seeds → not like-for-like (contrast: equal → paired)', async () => {
    const { run } = fakeRun(['seed-a', 'seed-b']);
    const out = await runWhatIf(ask([VALUE]), { loadSaved: async () => ({ graph: stored() }), run: run as never });
    expect((out as Rec).variants[0].paired).toBe(false);
    const { run: nullEcho } = fakeRun([null, null]);
    expect(((await runWhatIf(ask([VALUE]), { loadSaved: async () => ({ graph: stored() }), run: nullEcho as never })) as Rec).variants[0].paired,
      'no echo is never "paired"').toBe(false);
  });

  it('crux: all changes, then each change alone, all against the one saved run; a link is named by its ends', async () => {
    const { run, calls } = fakeRun();
    const out = await runWhatIf(ask([VALUE, LINK], true), { loadSaved: async () => ({ graph: stored() }), run: run as never });
    expect(calls).toHaveLength(4);
    expect((out as Rec).changes_applied).toEqual([{ index: 0, target: { node_id: 'f' } }, { index: 1, target: { from: 'f', to: 'g' } }]);
    const push = (i: number | 'all') => (out as Rec).variants.find((v: Rec) => v.change_index === i).options.find((o: Rec) => o.option_id === 'push').what_if.display;
    expect(push('all')).toBe('push f=0.7 s=0.2');
    expect(push(0), 'the value change alone keeps the saved link').toBe('push f=0.7 s=0.4');
    expect(push(1), 'the link change alone keeps the saved value').toBe('push f=0.5 s=0.2');
    // CONTROL: without crux, one what-if run only.
    const { run: one, calls: oneCalls } = fakeRun();
    await runWhatIf(ask([VALUE, LINK]), { loadSaved: async () => ({ graph: stored() }), run: one as never });
    expect(oneCalls).toHaveLength(2);
  });

  it.each([
    ['a gesture built on a model that has since changed (its own hash)', [VALUE, { ...LINK, base_graph_hash: 'stale' }], 'stale_base'],
    ['the canvas\'s own base hash is stale (a value-only what-if carries none per gesture)', [VALUE], 'stale_base', 'stale'],
    ['no value gesture applies', [{ kind: 'factor_value_edit', target_id: 'nope', value: 0.3 }], 'no_change_applied'],
    ['a structural edit is not a what-if', [{ kind: 'structural_rename', node_id: 'f', label: 'x', expected_label: 'f' }], 'no_change_applied'],
  ])('%s → refused, nothing run', async (_, changes, reason, baseGraphHash?: string) => {
    const { run, calls } = fakeRun();
    const out = await runWhatIf({ ...ask(changes), ...(baseGraphHash === undefined ? {} : { baseGraphHash }) }, { loadSaved: async () => ({ graph: stored() }), run: run as never });
    expect(out).toMatchObject({ kind: 'refused', reason });
    expect(calls).toHaveLength(0);
  });

  it('a cell with neither a figure nor the Run\'s reason says why; an option missing from one run says so (Codex #3591)', async () => {
    const run = vi.fn(async (p: { variantGraph: Rec }) => ({
      kind: 'rows' as const, seedUsed: 's', nSamples: 10000, displayStep: new Map(),
      rows: (p.variantGraph.nodes as Rec[]).find((n) => n.id === 'f')!.observed_state.value === 0.5
        ? new Map([['push', { display: null, pct: null, provisional: false, not_shown: null }], ['hold', chance('hold')]])
        : new Map([['push', chance('push')]]),
    }));
    const out = await runWhatIf(ask([VALUE]), { loadSaved: async () => ({ graph: stored() }), run: run as never });
    const opts = (out as Rec).variants[0].options as Rec[];
    expect(opts.find((o) => o.option_id === 'push')!.saved.not_shown).toBe(NO_RESULT_WORDS);
    expect(opts.find((o) => o.option_id === 'hold')!.what_if.not_shown).toBe(NOT_IN_RUN_WORDS);
    // CONTROL: a shown figure keeps not_shown null.
    expect(opts.find((o) => o.option_id === 'push')!.what_if).toEqual({ display: 'push', provisional: false, not_shown: null });
  });

  it('a scenario with no living model is refused (contrast: the core one above runs)', async () => {
    const { run } = fakeRun();
    expect(await runWhatIf(ask([VALUE]), { loadSaved: async () => ({ graph: served.graph }), run: run as never })).toEqual({ kind: 'refused', reason: 'not_a_core_scenario' });
  });

  it('one refused gesture is named and left out; the others still run', async () => {
    const { run } = fakeRun();
    const out = await runWhatIf(ask([{ kind: 'factor_value_edit', target_id: 'nope', value: 0.3 }, VALUE]), { loadSaved: async () => ({ graph: stored() }), run: run as never });
    expect(out).toMatchObject({ kind: 'ran', changes_applied: [{ index: 1 }] });
    expect((out as Rec).changes_refused).toEqual([{ index: 0, reason: expect.any(String) }]);
  });
});

describe('beyond ordinary variation: claimed only when it holds for any covariance and any rounding (Codex #3591 r2)', () => {
  const judge = async (pushPct: (number | null)[], opts: FakeOpts = {}) => {
    const { run } = fakeRun([], { pushPct, ...opts });
    const out = await runWhatIf(ask([VALUE]), { loadSaved: async () => ({ graph: stored() }), run: run as never });
    return (out as Rec).variants[0].options.find((o: Rec) => o.option_id === 'push');
  };
  it.each([
    ['40% → 60% on 10,000 draws', [40, 60], {}, 'beyond_ordinary_variation'],
    ['60% → 40% (a fall, judged the same way)', [60, 40], {}, 'beyond_ordinary_variation'],
    ['50% → 54%: 3 points clear of rounding, above the 2-point any-covariance band', [50, 54], {}, 'beyond_ordinary_variation'],
    ['50% → 52%: inside the band', [50, 52], {}, 'not_judged'],
    ['CODEX r2 (1): 45% → 50% shown at nearest 5 (712 vs 713 of 1,500)', [45, 50], { n: 1500, step: 'nearest_5' }, 'not_judged'],
    ['CODEX r2 (2): 51% → 49% on 30,000 opposite-moving paired draws', [51, 49], { n: 30000 }, 'not_judged'],
    ['a withheld chance on one side', [40, null], {}, 'not_judged'],
    ['no sample count from PLoT', [40, 60], { n: null }, 'not_judged'],
  ])('%s → %s', async (_, pcts, opts, expected) => {
    const o = await judge(pcts as (number | null)[], opts as FakeOpts);
    expect(o.variation).toBe(expected);
    expect(o.variation_words).toBe(VARIATION_WORDS[expected as keyof typeof VARIATION_WORDS]);
  });

  it('CONTROL for the nearest-5 row: the same 45% → 50% shown to the whole point on 1,500 draws is still not judged, 40% → 60% is beyond', async () => {
    expect((await judge([45, 50], { n: 1500 })).variation).toBe('not_judged');
    expect((await judge([40, 60], { n: 1500, step: 'nearest_5' })).variation).toBe('beyond_ordinary_variation');
  });

  it('the display step decides it: 45% → 50% on 10,000 draws is beyond when shown to the point, not when shown to the nearest 5', async () => {
    expect((await judge([45, 50], { step: 'nearest_5' })).variation).toBe('not_judged');
    expect((await judge([45, 50], { step: 'whole' })).variation).toBe('beyond_ordinary_variation');
  });

  it('near the extremes the spread is taken at the most variable value the rounding allows: 2% → 5% on 1,400 draws is not judged', async () => {
    // Gap 2 points; the band is 2.05 points at each interval's most variable value, but only 1.91 at the shown figures.
    expect((await judge([2, 5], { n: 1400 })).variation).toBe('not_judged');
    // CONTROL: 2% → 6% clears it.
    expect((await judge([2, 6], { n: 1400 })).variation).toBe('beyond_ordinary_variation');
  });

  it('the words never rank, recommend or say "significant"', () => {
    expect(JSON.stringify(VARIATION_WORDS)).not.toMatch(/\b(best|winner|recommend|significant|better|worse)\b/i);
  });
});
