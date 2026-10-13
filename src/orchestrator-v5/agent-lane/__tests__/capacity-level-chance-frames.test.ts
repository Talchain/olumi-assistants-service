/**
 * ⭐ RECOVERY BATCH C (construction contract) — A LEVEL TARGET WITH A USER-STATED EFFECT LARGER THAN THE CURRENT FRAME STILL
 * GETS ITS CHANCE. Adjudication (c) on served CEE c85817f2 (`recovery/bA/adjudicate-c/ADJUDICATION-c.md`); science
 * conditions `recovery/bA/REPORT-F5-science.md` ("Required conditions", "Required CEE test").
 *
 * The capacity brief ("existing team 80 tickets per week … each additional specialist resolves about 20 … at least 100")
 * withheld its chance twice on the served build:
 *  · GOAL_FIGURES_USER_EFFECT_CLAMPED — the user's 20 tickets per specialist (specialists' frame 10, outcome frame 125) is
 *    β 1.6; construction's frame fit refused to widen the goal (its own target row) and so could not widen the outcome;
 *  · GOAL_FIGURES_MISSING_CURRENT_LEVEL — the drafter typed the goal's level 80 as "inferred", and admission withheld it as
 *    "Olumi's own estimate" although the brief defines the goal as the existing 80 tickets plus the additional
 *    specialists' capacity (none added today).
 *    ⛔ RE-SCOPED OUT OF C (DL after independent check r2, BLOCKING 1): the defined-by-parts credit trusted drafted flags and
 *    credited 80 even beside "90 = 80 + 10 outsourced". It is removed; this level stays withheld, with its true reason.
 *
 * The fixture is the SERVED drafter response (`cee_drafter_raw_responses` row 470fa988, sha256 pinned below) and the graph
 * the served build stored from it. Expectations are written by hand in NATURAL units, never read back from the code.
 * 0 LLM calls; PLoT is never called (the Run handler's own probe captures the exact request body).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { clampForPersist, refitFramesForOlumiEstimates, refitFramesForStatedEffects, withStatedStrengths } from '../refit-frames.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { assessRouteAdmission } from '../../../cee/graph-readiness/canonical-readiness.js';
import { resolveGoalThresholdCapWithProvenance } from '../../../utils/goal-threshold-cap.js';
import { retireNormalisingGoalFrame, rederiveGoalInLinks } from '../normalising-goal-frame.js';

type Rec = Record<string, any>;

const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-c85817f2-construction.json', import.meta.url), 'utf8')) as {
  source: Rec; brief: string; raw_text: string; stored_graph: Rec;
};
const SCENARIO = 'cd3d9c25-0000-4000-8000-0000000c8581';
/** The honest reason a level the drafter typed as its own inference is not used (admission's level limb, unchanged). */
const WITHHELD_LEVEL = 'Olumi\'s own estimate of the current level of "Weekly support capacity" (80) was not used, so no chance of reaching 100 '
  + 'is shown: that figure would rest on a guess, not on anything you said. Tell me the current level of "Weekly support capacity" '
  + 'and the chance of reaching it can be shown.';
const GOAL = 'weekly_support_capacity';
const OUTCOME = 'additional_specialist_capacity';
const USER_LINK = ['additional_specialists', OUTCOME] as const;
const STRUCTURAL = new Set(['option', 'decision']);
const TOL = 1e-9;
const close = (a: number, b: number): boolean => Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b));

const node = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;
const edge = (g: Rec, from: string, to: string): Rec => (g.edges as Rec[]).find((e) => e.from === from && e.to === to)!;

/** A node's frame, written here from the contract (scale_frame → cap → goal cap → raw/value); a frameless quantity is 1. */
function frameHere(n: Rec | undefined): number | undefined {
  if (n === undefined || STRUCTURAL.has(n.kind)) return undefined;
  const os = n.observed_state ?? {};
  if (n.scale_frame > 1) return n.scale_frame;
  if (os.cap > 1) return os.cap;
  if (n.kind === 'goal' && n.goal_threshold_cap > 1) return n.goal_threshold_cap;
  if (typeof os.raw_value === 'number' && typeof os.value === 'number' && os.value !== 0) return os.raw_value / os.value;
  return 1; // an implicit frame (a 0–1 risk): fixed, whatever happens to its neighbours' frames
}

/** Every causal link's size and spread in NATURAL units (β·F_to/F_from), with who sized it. */
function naturalLinks(g: Rec): Map<string, Rec> {
  const byId = new Map((g.nodes as Rec[]).map((n) => [n.id, n]));
  const out = new Map<string, Rec>();
  for (const e of g.edges as Rec[]) {
    const [s, t] = [frameHere(byId.get(e.from)), frameHere(byId.get(e.to))];
    if (s === undefined || t === undefined) continue; // decision/option scaffolding: no causal size
    out.set(`${e.from}→${e.to}`, {
      mean: (e.strength.mean * t) / s, std: (e.strength.std * t) / s, sizing: linkSizing(e),
      magnitude: e.provenance?.magnitude, source: e.provenance?.source, definitional: e.provenance?.definitional === true,
      natural: e.provenance?.natural_effect === undefined ? undefined
        : { amount: e.provenance.natural_effect.amount, per: e.provenance.natural_effect.per_source_change,
          amount_unit: e.provenance.natural_effect.amount_unit, per_unit: e.provenance.natural_effect.per_source_change_unit },
    });
  }
  return out;
}

/** Construction from the served drafter response: the real path, one scripted drafter call, the registered graph. */
async function construct(rawText = FX.raw_text, brief = FX.brief): Promise<{ graph: Rec; result: Rec }> {
  let registered: unknown;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const call = (async () => ({ text: rawText })) as unknown as CallStructuredModel;
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  return { graph: GraphV3.parse(registered) as unknown as Rec, result };
}

/** Store → the production snapshot loader → the real Run handler; the exact PLoT request body, before any network. */
async function runRequest(graph: Rec): Promise<Rec> {
  const bytes = JSON.stringify(GraphV3.parse(graph));
  const port = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: FX.brief, revision: 2 })),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-capacity-frames', port as never);
  let payload: Rec | undefined;
  const handler = createRunAnalysisHandler({
    plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    scenarioReader: async () => snapshot,
    probe: async (sent) => { payload = sent.plotPayload as Rec; },
  });
  await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-capacity-frames', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-capacity', scenario_id: SCENARIO, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-capacity-frames', signal: new AbortController().signal, orientationText: '',
  } as never);
  expect(payload, 'the Run handler built a PLoT request').toBeDefined();
  return payload!;
}

describe('the served fixture is what it says it is', () => {
  it('the drafter response and the brief hash to the served row', () => {
    expect(createHash('sha256').update(FX.raw_text).digest('hex')).toBe(FX.source.drafter_raw.raw_sha256);
    expect(FX.source.drafter_raw.raw_sha256).toBe('91a3a03df3f5e1243d71d5376acdcfcd5c82016ee6da0c8393ae3af32b323bad');
    expect(createHash('sha256').update(FX.brief).digest('hex')).toBe('c5f2dacf88474c22ba4f84d82d1a5e5eb6904485cda15d7946490fd33bccef4f');
    expect(FX.source.cee_build).toBe('c85817f2f77a21813dcad833e1d631c21ed95de3');
  });

  it('EVIDENCE (kept, PL): the served graph clamped the user\'s 20 per specialist (β 1.6) and held no goal level', () => {
    const g = FX.stored_graph;
    const e = edge(g, ...USER_LINK);
    expect(e.provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { amount: 20, per_source_change: 1 } });
    expect(e.provenance.clamped_from).toBeCloseTo(1.6, 12);
    expect(e.strength.mean).toBe(1);
    expect(node(g, GOAL).observed_state).toBeUndefined();
    expect(node(g, GOAL).goal_threshold_cap).toBe(125);
    expect(node(g, OUTCOME).scale_frame).toBe(125);
  });
});

describe('construction from the served draft: the user\'s size fits, the brief\'s current level is kept', () => {
  it('RED (clamp): the user\'s 20 tickets per specialist is held in contract, unclamped, at its natural size and spread', async () => {
    const { graph } = await construct();
    const e = edge(graph, ...USER_LINK);
    expect(e.provenance.clamped_from).toBeUndefined();
    expect(Math.abs(e.strength.mean)).toBeLessThanOrEqual(1);
    const nat = naturalLinks(graph).get(USER_LINK.join('→'))!;
    expect(nat.magnitude).toBe('user_stated');
    expect(nat.mean).toBeCloseTo(20, 9); // tickets per week per specialist
    expect(nat.std).toBeCloseTo(10, 9); // the user's spread at its natural size (σ = β/2 on the frame it was sized on)
    expect(nat.natural).toEqual({ amount: 20, per: 1, amount_unit: 'tickets per week', per_unit: 'specialists' });
    for (const x of graph.edges as Rec[]) {
      expect(x.provenance?.clamped_from, `${x.from}→${x.to}`).toBeUndefined();
      expect(Math.abs(x.strength.mean), `${x.from}→${x.to}`).toBeLessThanOrEqual(1);
    }
  });

  it('RED (frames): the goal is fitted 125 → 500 and the intermediate outcome 125 → 200 (units only)', async () => {
    const { graph } = await construct();
    expect(node(graph, GOAL)).toMatchObject({ goal_threshold_cap: 500, goal_threshold_raw: 100, goal_threshold_cap_provenance: 'stated_effect_fit' });
    expect(node(graph, GOAL).goal_threshold).toBeCloseTo(100 / 500, 12);
    expect(node(graph, OUTCOME).scale_frame).toBe(200);
    expect(graph.goal_constraints).toEqual([expect.objectContaining({ node_id: GOAL, operator: '>=', value: 100, unit: 'tickets per week' })]);
  });

  // ⛔ Batch C RE-SCOPE (DL after independent check r2, BLOCKING 1): the defined-by-parts goal-level credit is REMOVED from C.
  // It trusted drafted definition flags and checked only one part's figure: with "90 = the existing 80 + 10 outsourced" it
  // still credited 80 "as your brief defines it". The frame refit stays (it passed); the capacity goal's level is NOT the
  // user's, so its chance is withheld for that true reason, with its next step.
  it('WITHHOLD (baseline): the drafter\'s "inferred" 80 is not the user\'s — no current level is held, and the reason says so', async () => {
    const { graph, result } = await construct();
    expect(node(graph, GOAL).observed_state).toEqual({ value: 0.16, baseline: 0.16, raw_value: 80, cap: 500, unit: 'tickets per week', source: 'cee_inference', extractionType: 'inferred' });
    expect(JSON.stringify(result.not_represented ?? [])).not.toContain('as your brief defines it');
  });

  it('RED on 2ecbae5 (independent check r2 BLOCKING 1): "90 = the existing 80 + 10 outsourced" never credits 80 as the user\'s level', async () => {
    const brief = FX.brief.replace('Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity.',
      'Total weekly support capacity is 90 tickets per week today: the existing 80 tickets per week plus 10 tickets per week outsourced, plus the additional specialist capacity.');
    expect(brief).not.toBe(FX.brief);
    const { graph, result } = await construct(FX.raw_text, brief); // the unchanged served draft
    expect(node(graph, GOAL).observed_state).toEqual({ value: 0.18, baseline: 0.18, raw_value: 90, cap: 500, unit: 'tickets per week', source: 'brief_extraction', extractionType: 'explicit' });
    expect(JSON.stringify(graph)).not.toContain('"raw_value":80,"cap":500');
    expect(JSON.stringify(result.not_represented ?? [])).not.toContain('as your brief defines it');
  });

  it('RED (Run request): PLoT is sent the user\'s 20 per specialist unclamped and the 100 target, in raw units — and NO baseline (re-scope)', async () => {
    const { graph } = await construct();
    const sent = await runRequest(graph);
    const wire = sent.graph as Rec;
    const nat = naturalLinks(wire).get(USER_LINK.join('→'))!;
    expect(nat.mean).toBeCloseTo(20, 9);
    expect(Math.abs(edge(wire, ...USER_LINK).strength.mean)).toBeLessThanOrEqual(1);
    const goal = node(wire, GOAL);
    const F = frameHere(goal)!;
    // Batch C re-scope: the level is not the user's, so none is sent (never a guessed 80).
    expect(goal.observed_state).toEqual({ value: 0.16, baseline: 0.16, raw_value: 80, cap: 500, unit: 'tickets per week', source: 'cee_inference', extractionType: 'inferred' });
    expect(goal.goal_threshold * F).toBeCloseTo(100, 9);
  });
});

// ── The F5 "Required CEE test", bounded: one draft's natural quantities, several frames ────────────────────────────────

/**
 * The SAME model in other units: node `id` re-expressed on frame `F`, written here from the science rule (F' = kF: every
 * link into it β/k and σ/k, every link out of it β·k and σ·k, its level, baseline, spread and normalised target ÷ k). An
 * implicit-frame neighbour (a frameless risk) is a quantity like any other; only decision/option scaffolding is passed over.
 */
function reexpress(g: Rec, id: string, F: number): Rec {
  const out = structuredClone(g);
  const n = node(out, id);
  const k = frameHere(n)! / F;
  const os = n.observed_state;
  if (os !== undefined) {
    for (const f of ['value', 'baseline', 'std'] as const) if (typeof os[f] === 'number') os[f] *= k;
    if (typeof os.cap === 'number') os.cap = F;
  }
  if (n.scale_frame !== undefined) n.scale_frame = F;
  if (n.kind === 'goal') { n.goal_threshold_cap = F; if (typeof n.goal_threshold === 'number') n.goal_threshold *= k; }
  for (const e of out.edges as Rec[]) {
    if (e.from !== id && e.to !== id) continue;
    if (STRUCTURAL.has(node(out, e.from === id ? e.to : e.from)?.kind)) continue;
    const s = e.from === id ? 1 / k : k;
    e.strength.mean *= s;
    e.strength.std *= s;
    if (typeof e.provenance?.natural_effect?.strength_mean === 'number') e.provenance.natural_effect.strength_mean *= s;
  }
  return out;
}

/** The admitted model before construction's fit: the served graph, its clamps undone, the brief's level on the target cap. */
function admittedBeforeFit(): Rec {
  const g = withStatedStrengths(structuredClone(FX.stored_graph)) as Rec;
  node(g, GOAL).observed_state = { value: 80 / 125, baseline: 80 / 125, unit: 'tickets per week', source: 'brief_extraction', raw_value: 80, cap: 125 };
  return g;
}

/**
 * Construction's frame fit exactly as `build-model.ts` calls it (the user's sizes with the goal's own rows, then Olumi's
 * pending estimates); the row "the real construction stores exactly this fit" holds the two together.
 */
function fitFramesAtConstruction(g: Rec): { graph: Rec; stated: { refits: Rec[]; refused: Rec[] } } {
  const stated = refitFramesForStatedEffects(g, { goalOwnRows: true });
  return { graph: refitFramesForOlumiEstimates(stated.graph).graph, stated: { refits: stated.refits, refused: stated.refused } };
}
/** What construction stores: its frame fit, then the clamp at persist. */
const fitAndPersist = (g: Rec): Rec => clampForPersist(fitFramesAtConstruction(g).graph);

function expectSameNatural(actual: Map<string, Rec>, frozen: Map<string, Rec>, where: string): void {
  expect([...actual.keys()].sort(), where).toEqual([...frozen.keys()].sort());
  for (const [k, f] of frozen) {
    const a = actual.get(k)!;
    expect(close(a.mean, f.mean), `${where}: ${k} natural size ${a.mean} vs ${f.mean}`).toBe(true);
    expect(close(a.std, f.std), `${where}: ${k} natural spread ${a.std} vs ${f.std}`).toBe(true);
    expect({ ...a, mean: 0, std: 0 }, `${where}: ${k} who sized it`).toEqual({ ...f, mean: 0, std: 0 });
  }
}

/** Raw-unit reading of one Run request: links, levels, the goal's baseline and target, every option's setting. */
function rawUnitsOf(sent: Rec): Rec {
  const g = sent.graph as Rec;
  const levels: Rec = {};
  for (const n of g.nodes as Rec[]) {
    const F = frameHere(n);
    if (F === undefined || n.observed_state === undefined) continue;
    levels[n.id] = { raw: n.observed_state.value * F, ...(typeof n.observed_state.baseline === 'number' ? { baseline: n.observed_state.baseline * F } : {}) };
  }
  const goal = node(g, GOAL);
  const settings = Object.fromEntries((sent.options as Rec[]).map((o) => [o.id, Object.fromEntries(Object.entries(o.interventions as Rec)
    .map(([f, v]) => [f, (v as number) * frameHere(node(g, f))!]))]));
  return { links: naturalLinks(g), levels, target: goal.goal_threshold * frameHere(goal)!, settings, limits: sent.goal_constraints };
}

const roundRec = (r: Rec): Rec => JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === 'number' ? Number(v.toPrecision(10)) : v)));

describe('F5 invariance: the same draft on several goal frames is the same model, the same admission, the same Run inputs', () => {
  const FROZEN = naturalLinks(admittedBeforeFit()); // the draft's natural quantities, before any fit
  const VARIANTS: readonly [string, () => Rec][] = [
    ['as served (goal 125, outcome 125)', () => admittedBeforeFit()],
    ['goal 250', () => reexpress(admittedBeforeFit(), GOAL, 250)],
    ['goal 160, outcome 150', () => reexpress(reexpress(admittedBeforeFit(), GOAL, 160), OUTCOME, 150)],
    ['goal 1000, outcome 400 (nothing to fit)', () => reexpress(reexpress(admittedBeforeFit(), GOAL, 1000), OUTCOME, 400)],
  ];

  it('PRECONDITION: the frozen draft holds the user\'s 20 ± 10 per specialist and Olumi\'s two placeholders at their natural sizes', () => {
    const user = FROZEN.get(USER_LINK.join('→'))!;
    expect([user.mean, user.std].map((x) => Number(x.toPrecision(12)))).toEqual([20, 10]);
    expect(FROZEN.get(`specialist_underperformance→${OUTCOME}`)).toMatchObject({ mean: -62.5, sizing: 'placeholder' });
    expect(FROZEN.get('additional_specialists→specialist_underperformance')).toMatchObject({ sizing: 'placeholder' });
  });

  it.each(VARIANTS)('RED-able: %s — every natural size and spread, provenance and placeholder status held; nothing clamped', (_name, make) => {
    const fit = fitAndPersist(make());
    expectSameNatural(naturalLinks(fit), FROZEN, _name);
    for (const e of fit.edges as Rec[]) {
      expect(e.provenance?.clamped_from, `${_name}: ${e.from}→${e.to}`).toBeUndefined();
      expect(Math.abs(e.strength.mean), `${_name}: ${e.from}→${e.to}`).toBeLessThanOrEqual(1 + TOL);
    }
    const goal = node(fit, GOAL);
    const F = frameHere(goal)!;
    expect([goal.goal_threshold * F, goal.observed_state.baseline * F, goal.observed_state.raw_value].map((x) => Number(x.toPrecision(12)))).toEqual([100, 80, 80]);
    expect(goal.observed_state.source).toBe('brief_extraction');
    expect(fit.goal_constraints).toEqual(FX.stored_graph.goal_constraints);
  });

  it('the same admission outcome on every frame (route admission and the target\'s testability)', () => {
    const outcomes = VARIANTS.map(([, make]) => { const fit = fitAndPersist(make()); return { route: assessRouteAdmission(fit), target: targetTestabilityOf(fit) }; });
    for (const o of outcomes.slice(1)) expect(o).toEqual(outcomes[0]);
  });

  it('the actual Run request carries the same raw-unit quantities on every frame', async () => {
    const reads = await Promise.all(VARIANTS.map(async ([, make]) => rawUnitsOf(await runRequest(fitAndPersist(make())))));
    expectSameNatural(reads[0]!.links, FROZEN, 'wire');
    for (const [i, r] of reads.entries()) {
      expectSameNatural(r.links, reads[0]!.links, `wire ${VARIANTS[i]![0]}`);
      expect(roundRec({ ...r, links: null }), VARIANTS[i]![0]).toEqual(roundRec({ ...reads[0]!, links: null }));
    }
    expect(roundRec(reads[0]!.levels[GOAL])).toEqual({ raw: 80, baseline: 80 });
    expect(Number(reads[0]!.target.toPrecision(12))).toBe(100);
    expect(roundRec(reads[0]!.settings)).toEqual({ keep_current_staffing: { additional_specialists: 0 }, add_one_specialist: { additional_specialists: 1 } });
  });

  it('|β| = 1 BOUNDARY: a user size exactly at the contract\'s edge is neither refit nor marked, and reaches the Run at 1', async () => {
    const g = reexpress(reexpress(admittedBeforeFit(), GOAL, 500), OUTCOME, 200);
    Object.assign(edge(g, ...USER_LINK), { strength: { mean: 1, std: 0.5 } });
    edge(g, ...USER_LINK).provenance.natural_effect.strength_mean = 1;
    const r = fitFramesAtConstruction(g);
    expect(r.stated.refits).toEqual([]);
    const fit = clampForPersist(r.graph);
    expect(edge(fit, ...USER_LINK).strength).toEqual({ mean: 1, std: 0.5 });
    expect(edge(fit, ...USER_LINK).provenance.clamped_from).toBeUndefined();
    expectSameNatural(naturalLinks(fit), FROZEN, 'boundary');
    expect(edge((await runRequest(fit)).graph, ...USER_LINK).strength.mean).toBe(1);
  });

  it('MIXED PLACEHOLDERS keep their status: tagged, projected, and only their coordinates move with the outcome', () => {
    const fit = fitAndPersist(admittedBeforeFit());
    for (const [from, to] of [['additional_specialists', 'specialist_underperformance'], ['specialist_underperformance', OUTCOME]] as const) {
      const e = edge(fit, from, to);
      expect(linkSizing(e), `${from}→${to}`).toBe('placeholder');
      expect(e.provenance).toMatchObject({ magnitude: 'olumi_placeholder', mean_projected: true });
    }
    expect(edge(fit, 'specialist_underperformance', OUTCOME).strength.mean).toBeCloseTo(-0.5 * 125 / 200, 12);
  });

  it('the real construction stores exactly this fit (one function, no second path)', async () => {
    const { graph } = await construct();
    expectSameNatural(naturalLinks(graph), FROZEN, 'construction');
    const fit = fitAndPersist(admittedBeforeFit());
    for (const id of [GOAL, OUTCOME]) expect(frameHere(node(graph, id))).toBe(frameHere(node(fit, id)));
  });
});

describe('a target added after construction', () => {
  const WITHOUT_TARGET_BRIEF = FX.brief.replace(' Goal: weekly support capacity of at least 100 tickets per week. This target is an absolute level, with no deadline.', '');
  const withoutTarget = (): string => {
    const c = JSON.parse(FX.raw_text) as Rec;
    Object.assign(c.goal, { target_stated: false, value: null });
    c.constraints = [];
    return JSON.stringify(c);
  };
  /** The target as the add_constraint writer stamps it (one cap rule), then F4's retirement or the in-link re-derivation. */
  function addTarget(built: Rec): Rec {
    const g = structuredClone(built);
    const goal = node(g, GOAL);
    const before = frameHere(goal);
    const cap = resolveGoalThresholdCapWithProvenance(goal.goal_threshold_cap, 100, 'tickets per week', goal.goal_threshold_unit)!.cap;
    Object.assign(goal, { goal_threshold_raw: 100, goal_threshold_cap: cap, goal_threshold: 100 / cap, goal_threshold_unit: 'tickets per week', goal_threshold_frame: 'level' });
    g.goal_constraints = structuredClone(FX.stored_graph.goal_constraints);
    const retired = retireNormalisingGoalFrame(g);
    return retired !== g ? retired : before === undefined || before === 1 ? g : rederiveGoalInLinks(g, GOAL, before);
  }

  it('PRECONDITION: the brief without its goal sentence still hashes apart and drafts no target', () => {
    expect(WITHOUT_TARGET_BRIEF).not.toContain('at least 100');
    expect(WITHOUT_TARGET_BRIEF.length).toBeLessThan(FX.brief.length);
  });

  it('the user\'s own size and Olumi\'s estimate read exactly as in a construction with the target present; placeholders stay placeholders', async () => {
    const after = addTarget((await construct(withoutTarget(), WITHOUT_TARGET_BRIEF)).graph);
    const { graph: withTarget } = await construct();
    const sized = (m: Map<string, Rec>): Map<string, Rec> => new Map([...m].filter(([k, v]) => !k.endsWith(`→${GOAL}`) && v.sizing !== 'placeholder'));
    expectSameNatural(sized(naturalLinks(after)), sized(naturalLinks(withTarget)), 'target after construction');
    expect(sized(naturalLinks(after)).has(USER_LINK.join('→'))).toBe(true);
    for (const [from, to] of [['additional_specialists', 'specialist_underperformance'], ['specialist_underperformance', OUTCOME]] as const) {
      expect(linkSizing(edge(after, from, to)), `${from}→${to}`).toBe('placeholder');
    }
    for (const e of after.edges as Rec[]) expect(e.provenance?.clamped_from, `${e.from}→${e.to}`).toBeUndefined();
    const goal = node(after, GOAL);
    expect(Number((goal.goal_threshold * frameHere(goal)!).toPrecision(12))).toBe(100);
  });

  it('NAMED RESIDUAL (pinned, outside this seam): a no-target build of a non-money goal has no goal frame, so its definitions and level cannot follow a later target', async () => {
    // With no target the goal has no frame (the normalising frame is for a money goal only), so admission sets the two
    // ±1 definitions aside as placeholders and holds no current level (its level limb runs only beside a stated target);
    // F4 cannot re-derive what was never kept. A construction WITH the target holds both definitions (and, since the Batch C
    // re-scope, no current level either: the drafter's "inferred" 80 is not the user's).
    const built = (await construct(withoutTarget(), WITHOUT_TARGET_BRIEF)).graph;
    expect(frameHere(node(built, GOAL))).toBe(1);
    const after = addTarget(built);
    const { graph: withTarget } = await construct();
    for (const from of ['existing_team_capacity', OUTCOME]) {
      expect(linkSizing(edge(after, from, GOAL)), `${from}→goal after`).toBe('placeholder');
      expect(edge(withTarget, from, GOAL).provenance.definitional, `${from}→goal with target`).toBe(true);
    }
    expect(node(after, GOAL).observed_state).toBeUndefined();
    expect(node(withTarget, GOAL).observed_state).toEqual({ value: 0.16, baseline: 0.16, raw_value: 80, cap: 500, unit: 'tickets per week', source: 'cee_inference', extractionType: 'inferred' });
    // Admission also frames the outcome on 300 with no target (125 beside it), and Olumi's ±0.5 placeholder into it is set
    // on whichever frame admission chose (Science F5: "Fixed 0.5 placeholders … prevent general invariance").
    expect(naturalLinks(after).get(`specialist_underperformance→${OUTCOME}`)!.mean).toBeCloseTo(-150, 9);
    expect(naturalLinks(withTarget).get(`specialist_underperformance→${OUTCOME}`)!.mean).toBeCloseTo(-62.5, 9);
  });
});

describe('negatives: what cannot fit without changing meaning still withholds, with its true reason', () => {
  /** "Each specialist raises satisfaction by 2 points" on a 5-point scale with up to 10 specialists: 20 points cannot fit. */
  function bounded(): Rec {
    return {
      nodes: [
        { id: 'csat', kind: 'goal', label: 'Customer satisfaction', goal_threshold: 0.8, goal_threshold_raw: 4, goal_threshold_cap: 5,
          goal_threshold_unit: 'out of 5', goal_threshold_frame: 'level',
          observed_state: { value: 0.6, baseline: 0.6, raw_value: 3, cap: 5, unit: 'out of 5', source: 'brief_extraction' } },
        { id: 'keep', kind: 'option', label: 'Keep', is_baseline: true },
        { id: 'hire', kind: 'option', label: 'Hire one', interventions: { specialists: { value: 0.1, raw_value: 1, unit: 'specialists', source: 'brief_extraction' } } },
        { id: 'specialists', kind: 'factor', label: 'Specialists', category: 'controllable',
          observed_state: { value: 0, raw_value: 0, cap: 10, unit: 'specialists', source: 'brief_extraction' } },
      ],
      edges: [
        { from: 'hire', to: 'specialists', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } },
        { from: 'specialists', to: 'csat', strength: { mean: 4, std: 2 }, exists_probability: 0.8, effect_direction: 'positive',
          provenance: { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: { amount: 2, amount_unit: 'out of 5', per_source_change: 1,
            per_source_change_unit: 'specialists', strength_mean: 4, strength_mean_frame: 'edge_strength' } } },
      ],
      goal_constraints: [{ constraint_id: 'c:csat', node_id: 'csat', operator: '>=', value: 4, unit: 'out of 5', label: 'Customer satisfaction' }],
    };
  }

  it('a size a bounded scale cannot hold is refused (bounded_scale), stored clamped with its full size, and sent at full size', async () => {
    const r = fitFramesAtConstruction(bounded());
    expect(r.stated.refits).toEqual([]);
    expect(r.stated.refused).toEqual([{ link: 'specialists→csat', reason: 'bounded_scale' }]);
    const stored = clampForPersist(r.graph);
    expect(edge(stored, 'specialists', 'csat').strength.mean).toBe(1);
    expect(edge(stored, 'specialists', 'csat').provenance.clamped_from).toBe(4);
    expect(node(stored, 'csat').goal_threshold_cap).toBe(5);
    // The Run is sent the user's full size (`withStatedStrengths`), so PLoT clamps it and withholds
    // GOAL_FIGURES_USER_EFFECT_CLAMPED: the true reason, never a silently shrunk effect.
    expect(edge(withStatedStrengths(stored) as Rec, 'specialists', 'csat').strength.mean).toBe(4);
  });

  it('a limit on the OUTCOME (not the goal\'s own row) still refuses the widen: the clamp and its withhold stay', () => {
    const g = admittedBeforeFit();
    g.goal_constraints = [...g.goal_constraints, { constraint_id: 'c:outcome', node_id: OUTCOME, operator: '<=', value: 150, unit: 'tickets per week' }];
    const r = fitFramesAtConstruction(g);
    expect(r.stated.refused).toContainEqual({ link: USER_LINK.join('→'), reason: 'levels_set_on_node' });
    expect(edge(clampForPersist(r.graph), ...USER_LINK).provenance.clamped_from).toBeCloseTo(1.6, 12);
  });

  it('an implicit-frame neighbour the widen would push out of contract refuses the whole fit (new_cut), never a cut at persist', () => {
    const sized = (amount: number, mean: number, magnitude: string, extra: Rec = {}): Rec => ({ source: 'brief_extraction', magnitude, ...extra,
      natural_effect: { amount, amount_unit: 'units', per_source_change: 1, per_source_change_unit: 'units', strength_mean: mean, strength_mean_frame: 'edge_strength' } });
    const g: Rec = {
      nodes: [
        { id: 'g', kind: 'goal', label: 'G', goal_threshold: 0.5, goal_threshold_raw: 50, goal_threshold_cap: 100, goal_threshold_unit: 'units', goal_threshold_frame: 'level' },
        { id: 'x', kind: 'factor', label: 'X', observed_state: { value: 0, raw_value: 0, cap: 10, unit: 'units', source: 'brief_extraction' } },
        { id: 'o', kind: 'outcome', label: 'O', scale_frame: 100 },
        { id: 'r', kind: 'risk', label: 'R' },
      ],
      edges: [
        { from: 'x', to: 'o', strength: { mean: 3, std: 1.5 }, exists_probability: 0.8, effect_direction: 'positive', provenance: sized(30, 3, 'user_stated') },
        { from: 'o', to: 'g', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: sized(1, 1, 'olumi_estimate', { definitional: true }) },
        { from: 'o', to: 'r', strength: { mean: 0.5, std: 0.25 }, exists_probability: 0.8, effect_direction: 'positive', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } },
      ],
    };
    const r = fitFramesAtConstruction(g);
    expect(r.stated.refits).toEqual([]);
    expect(r.stated.refused).toEqual([{ link: 'x→o', reason: 'new_cut', detail: 'o→r' }]);
    expect([node(r.graph, 'o').scale_frame, node(r.graph, 'g').goal_threshold_cap]).toEqual([100, 100]);
    expect(edge(r.graph, 'o', 'r').strength.mean).toBe(0.5);
  });


});
