/**
 * ⭐ STEP 8 ROUTE A (DL-3, 18 Oct; AIE 2500d66f `step8_science`): A VALIDATED DEFINITION INTO THE GOAL IS WORKED OUT EXACTLY.
 *
 * A brief states today's level, a target and each option's exact net change in the goal's own unit. The drafter encodes "adds"
 * as a net-change factor linked to the goal +1 per 1 by definition. Where Science d5's `validatedDefinition` holds that link (the
 * Run's own definition authority), the Run used to send it as a causal link at 1.0 / 0.01, and PLoT floors that spread to 0.05:
 * an exact +20 on a gap of 20 read 50%. Compiled into the existing declared-sum path, the goal is worked out as its level today
 * plus each option's change (ISL's exact sum: no operand strength is drawn). Anything d5 does not hold stays exactly as today.
 *
 * Every hop is real: stub drafter → `buildModelFromBrief` → the `/graph/register` body → `GraphV3.parse` → the production
 * snapshot loader → the Run handler's probe, which is the exact PLoT request body. Expectations are by hand, in natural
 * units. Synthetic briefs only.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../../../agent-lane/runtime/build-model.js';
import type { InternalDispatch } from '../../../agent-lane/runtime/agent-capabilities.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { deriveDecisionContextGraphHash, loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import { canonicaliseForAnalysis } from '../analysis-ready-core.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { whoSized } from '../../../agent-lane/strength-authorship-words.js';
import minimalFixture from '../../../../../tests/fixtures/plot/v2-run-golden-minimal.json';
import { labelHoldsQuantity } from '../../../goal-target/held-user-links.js';

type Rec = Record<string, any>;
const SCENARIO = '5e8e8e8e-0000-4000-8000-0000000000a8';

async function build(wire: Rec, brief: string): Promise<Rec> {
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SCENARIO, brief, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return GraphV3.parse(registered) as Rec;
}

/** The PLoT request the Run handler builds from the stored bytes. */
async function request(stored: Rec): Promise<Rec> {
  const bytes = JSON.stringify(stored);
  const port = { loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: null, revision: 2 })),
    readMostRecentPendingActions: vi.fn(async () => []) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-step8a', port as never);
  let payload: Rec | undefined;
  const handler = createRunAnalysisHandler({ plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    scenarioReader: async () => snapshot, probe: async (sent) => { payload = sent.plotPayload as Rec; } });
  await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO,
      request_id: 'req-step8a', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-step8a', scenario_id: SCENARIO, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-step8a', signal: new AbortController().signal, orientationText: '',
  } as never);
  expect(payload, 'the Run handler built a PLoT request').toBeDefined();
  return payload!;
}

const node = (g: Rec, id: string): Rec | undefined => (g.nodes as Rec[]).find((n) => n.id === id);
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const edge = (g: Rec, from: string, to: string): Rec => {
  const found = (g.edges as Rec[]).filter((e) => e.from === from && e.to === to);
  expect(found, `${from} → ${to}`).toHaveLength(1);
  return found[0]!;
};
const setting = (p: Rec, option: string, factor: string): number => {
  const v = ((p.options as Rec[]).find((o) => o.id === option)!.interventions as Rec)[factor];
  return typeof v === 'number' ? v : v.value;
};
const raw = (n: Rec): number => n.observed_state.raw_value as number;

interface Shape {
  readonly goal: string; readonly unit: string; readonly today: number; readonly target: number; readonly cap: number;
  readonly net: string; readonly a: number; readonly b: number; readonly say: (a: number, b: number) => string;
  readonly netToday?: number; readonly netUnit?: string; readonly definitional?: boolean | null; readonly todayBy?: 'explicit' | 'ai_proposed';
}
const netId = (s: Shape): string => s.net.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
/** The drafter's synthetic candidate: options set a net-change factor, which reaches the goal by a drafted identity. */
const candidate = (s: Shape): Rec => ({
  goal: { metric: s.goal, operator: '>=', target_stated: true, value: s.target, unit: s.unit, horizon_months: null, provenance: 'explicit',
    frame: 'level', baseline_known: true, baseline_value: s.today, baseline_provenance: s.todayBy ?? 'explicit', scope: null },
  constraints: [],
  options: [
    { label: 'Option A', provenance: 'explicit', is_status_quo: null, interventions: [{ factor_label: s.net, value: s.a, value_kind: 'absolute', unit: s.netUnit ?? s.unit, provenance: 'explicit' }] },
    { label: 'Option B', provenance: 'explicit', is_status_quo: null, interventions: [{ factor_label: s.net, value: s.b, value_kind: 'absolute', unit: s.netUnit ?? s.unit, provenance: 'explicit' }] },
    { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, interventions: [] },
  ],
  factors: [{ label: s.net, role: 'controllable', baseline_known: true, baseline_value: s.netToday ?? 0, unit: s.netUnit ?? s.unit, provenance: 'explicit', plausible_max: s.cap }],
  risks: [], outcomes: [],
  links: [{ from: s.net, to: s.goal, direction: 'positive', provenance: 'explicit', effect_amount: 1, effect_per_source_change: 1,
    effect_provenance: 'explicit', definitional: s.definitional === undefined ? true : s.definitional, basis: null, source_quote: null }],
  identities: [], unknowns: [], decision_question: null,
});

const WIDGETS: Shape = {
  goal: 'Widgets per hour', unit: 'widgets/hour', today: 40, target: 60, cap: 50, net: 'Net change in widgets per hour', a: 30, b: 10,
  say: (a, b) => `Today we make 40 widgets per hour. We need at least 60 widgets per hour. Option A adds exactly ${a} widgets per hour; `
    + `option B adds exactly ${b} widgets per hour.`,
};
const REVENUE: Shape = {
  goal: 'Monthly revenue', unit: '£/month', today: 200000, target: 250000, cap: 100000, net: 'Net change in monthly revenue', a: 50000, b: 49999,
  say: (a, b) => `Revenue is £200,000 a month today and must reach at least £250,000 a month. Option A adds exactly £${a.toLocaleString('en-GB')} `
    + `a month; option B adds exactly £${b.toLocaleString('en-GB')} a month.`,
};

/** The compiled sum on the request: the goal is worked out as its level today + the option's change, nothing drawn. */
function expectExactSum(p: Rec, s: Shape, a: number, b: number): void {
  const goal = goalOf(p.graph);
  const identity = goal.nonlinear_identity as Rec | undefined;
  expect(identity, 'the goal carries the sum').toMatchObject({ operation: 'sum', stated_in_brief: false });
  expect(identity!.factor_ids).toEqual([`${goal.id}_today`, netId(s)]);
  const today = node(p.graph, `${goal.id}_today`)!;
  // Today's part IS the goal's level today: the same figure, never a new one.
  expect(today.label).toBe(`${s.goal} today`);
  expect(raw(today)).toBe(s.today);
  expect(raw(goal)).toBe(s.today);
  expect(goal.goal_threshold_raw).toBe(s.target);
  // Each part reaches the goal by one +1 definitional link at existence 1; ISL never draws an operand's strength.
  for (const id of identity!.factor_ids as string[]) expect(edge(p.graph, id, goal.id)).toMatchObject({ exists_probability: 1, provenance: { definitional: true } });
  // The engine's own conditions for an exact change (PLoT `pinnedLeverIds`): the change factor is a lever the status quo holds at
  // today's 0, so it is never sampled; and CEE sends no factor correlations (which would replace that hold with a spread).
  const x = node(p.graph, netId(s))!;
  expect(x.category).toBe('controllable');
  expect(raw(x)).toBe(0);
  expect(setting(p, 'carry_on_as_now', netId(s))).toBe(0);
  expect(p.factor_correlations).toBeUndefined();
  expect([setting(p, 'option_a', netId(s)), setting(p, 'option_b', netId(s))]).toEqual([a, b]);
  // By hand: level = today + the option's change; it meets the target iff that is ≥ the target.
  expect(s.today + a >= s.target).toBe(true);
  expect(s.today + b >= s.target).toBe(false);
}

describe('STEP 8 Route A — a validated definition into the goal is worked out exactly (real path)', () => {
  for (const [a, b] of [[20, 19], [30, 10]] as const) {
    it(`RED: widgets, +${a} / +${b} on a gap of 20 — the goal is today + the change, so A meets and B does not`, async () => {
      expectExactSum(await request(await build(candidate({ ...WIDGETS, a, b }), WIDGETS.say(a, b))), WIDGETS, a, b);
    });
  }

  it('RED: £ a month, +£50,000 / +£49,999 on a gap of £50,000 (second brief)', async () => {
    expectExactSum(await request(await build(candidate(REVENUE), REVENUE.say(REVENUE.a, REVENUE.b))), REVENUE, REVENUE.a, REVENUE.b);
  });

  // ⭐ THE REVISION → REQUEST BOUNDARY (DL-3 ruling on Codex R2): whatever is stored — an Undo to a legacy row, a canvas save
  // straight to the database — the Run derives the today part from the goal's current level and drops an option's setting of it.
  const snapshotNotes = async (stored: Rec): Promise<readonly string[]> => {
    const bytes = JSON.stringify(stored);
    const port = { loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: null, revision: 2 })), readMostRecentPendingActions: vi.fn(async () => []) };
    return (await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-step8a', port as never)).todayPartNotes ?? [];
  };
  it('RED: Undo to a legacy row where Option B set the today part to 50 — the request uses 40 and B\'s own +19 (59, short of 60), and says so', async () => {
    const stored = await build(candidate({ ...WIDGETS, a: 20, b: 19 }), WIDGETS.say(20, 19));
    const legacy = structuredClone(stored);
    const os = node(legacy, 'widgets_per_hour_today')!.observed_state;
    const b = (legacy.nodes as Rec[]).find((n) => n.id === 'option_b')!;
    b.interventions = { ...b.interventions, widgets_per_hour_today: { ...os, raw_value: 50, value: 50 / os.cap } };
    const p = await request(legacy);
    expect(raw(node(p.graph, 'widgets_per_hour_today')!)).toBe(40);
    expect(((p.options as Rec[]).find((o) => o.id === 'option_b')!.interventions as Rec).widgets_per_hour_today).toBeUndefined();
    expect(setting(p, 'option_b', netId(WIDGETS))).toBe(19);
    expect(40 + 19 >= 60).toBe(false);
    expect(await snapshotNotes(legacy)).toEqual(['"Option B" sets "Widgets per hour today" to 50 widgets/hour in the saved model; that is not valid and no Run uses it: "Widgets per hour today" changes only with the current level of "Widgets per hour".']);
  });

  it('RED: a canvas save straight to the database left the today part at 41 — the request uses the goal\'s 40, and says so', async () => {
    const stored = await build(candidate({ ...WIDGETS, a: 20, b: 19 }), WIDGETS.say(20, 19));
    const canvas = structuredClone(stored);
    const os = node(canvas, 'widgets_per_hour_today')!.observed_state;
    node(canvas, 'widgets_per_hour_today')!.observed_state = { ...os, raw_value: 41, value: 41 / os.cap, baseline: 41 / os.cap };
    const p = await request(canvas);
    expect(raw(node(p.graph, 'widgets_per_hour_today')!)).toBe(40);
    expectExactSum(p, WIDGETS, 20, 19);
    expect(await snapshotNotes(canvas)).toEqual(['"Widgets per hour today" is the current level of "Widgets per hour": the 41 widgets/hour saved on it is not valid, and every Run uses 40 widgets/hour.']);
  });

  it('RED: the Run\'s own readback says what it used — the stored 41 is named and the goal\'s 40 is the figure used', async () => {
    const stored = await build(candidate({ ...WIDGETS, a: 20, b: 19 }), WIDGETS.say(20, 19));
    const canvas = structuredClone(stored);
    const os = node(canvas, 'widgets_per_hour_today')!.observed_state;
    node(canvas, 'widgets_per_hour_today')!.observed_state = { ...os, raw_value: 41, value: 41 / os.cap, baseline: 41 / os.cap };
    const bytes = JSON.stringify(canvas);
    const port = { loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: null, revision: 3 })), readMostRecentPendingActions: vi.fn(async () => []) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-step8-readback', port as never);
    const row = (id: string, p: number): Rec => ({ option_id: id, probability_of_goal: p, outcome: { mean: 0, std: 0, p10: 0, p50: 0, p90: 0 } });
    const run = vi.fn(async () => ({ ...structuredClone(minimalFixture), option_comparison: [row('option_a', 1), row('option_b', 0), row('carry_on_as_now', 0)] }));
    const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn() } as never, scenarioReader: async () => snapshot });
    const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 't-step8-readback' }, requestId: 'req-step8-readback',
      signal: new AbortController().signal, context: {}, orientationText: '' } as never) as Rec;
    expect(run).toHaveBeenCalledTimes(1);
    const sent = (run.mock.calls[0] as unknown as [Rec])[0];
    expect(raw(node(sent.graph, 'widgets_per_hour_today')!)).toBe(40);
    expect(String((outcome.handler_facts[0] as Rec).result.summary)).toContain(
      '"Widgets per hour today" is the current level of "Widgets per hour": the 41 widgets/hour saved on it is not valid, and every Run uses 40 widgets/hour.');
  });

  it('RED: a saved link into the today part never reaches the engine request (the operand has no setter but its goal)', async () => {
    const stored = await build(candidate({ ...WIDGETS, a: 20, b: 19 }), WIDGETS.say(20, 19));
    const linked = structuredClone(stored);
    (linked.edges as Rec[]).push({ ...structuredClone(edge(linked, netId(WIDGETS), 'widgets_per_hour')), to: 'widgets_per_hour_today' });
    const p = await request(linked);
    expect((p.graph.edges as Rec[]).filter((e) => e.to === 'widgets_per_hour_today')).toEqual([]);
    expectExactSum(p, WIDGETS, 20, 19);
  });

  it('RED: an old Run stamped on a legacy override is never current — its stamp is not the derived analysis identity; a valid graph\'s is unchanged', async () => {
    const stored = await build(candidate({ ...WIDGETS, a: 20, b: 19 }), WIDGETS.say(20, 19));
    const legacy = structuredClone(stored);
    const os = node(legacy, 'widgets_per_hour_today')!.observed_state;
    const b = (legacy.nodes as Rec[]).find((n) => n.id === 'option_b')!;
    b.interventions = { ...b.interventions, widgets_per_hour_today: { ...os, raw_value: 50, value: 50 / os.cap } };
    // The stamp an old Run carried: the analysis hash over the stored bytes as they were (no derivation).
    const oldStamp = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(canonicaliseForAnalysis(legacy)) as never);
    expect(deriveDecisionContextGraphHash(legacy)).not.toBe(oldStamp);
    // A new Run on the same stored bytes stamps the derived identity, so it — not the old one — is current.
    const port = { loadGraphAndBriefText: vi.fn(async () => ({ graph: structuredClone(legacy), briefText: null, revision: 3 })), readMostRecentPendingActions: vi.fn(async () => []) };
    const snap = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-step8-stamp', port as never);
    expect(computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(snap.rawPersistedGraph) as never)).toBe(deriveDecisionContextGraphHash(legacy));
    // CONTRAST: on the graph as built nothing is derived, so every historical stamp keeps its identity.
    expect(deriveDecisionContextGraphHash(stored)).toBe(computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(canonicaliseForAnalysis(stored)) as never));
  });

  it('CONTRAST: the graph as built is used as stored, with nothing said', async () => {
    const stored = await build(candidate({ ...WIDGETS, a: 20, b: 19 }), WIDGETS.say(20, 19));
    expect(await snapshotNotes(stored)).toEqual([]);
  });

  it('RED: the definition keeps every authorship tag and reads as a definition; the sum is Olumi\'s reading', async () => {
    const g = await build(candidate(WIDGETS), WIDGETS.say(30, 10));
    const e = edge(g, netId(WIDGETS), 'widgets_per_hour');
    expect(e.provenance).toMatchObject({ magnitude: 'olumi_estimate', definitional: true });
    expect(whoSized(e)).toBe('definition');
    expect(goalOf(g).nonlinear_identity).toMatchObject({ stated_in_brief: false });
    // The today part carries the goal's own stamp: the same figure, the person's.
    expect(node(g, 'widgets_per_hour_today')!.observed_state).toEqual(goalOf(g).observed_state);
  });
});

describe('STEP 8 Route A — what d5 does not hold as a definition stays exactly as today', () => {
  const unchanged = async (s: Shape, why: string): Promise<Rec> => {
    const p = await request(await build(candidate(s), s.say(s.a, s.b)));
    expect(goalOf(p.graph).nonlinear_identity, why).toBeUndefined();
    expect((p.graph.nodes as Rec[]).some((n) => String(n.label).endsWith(' today')), why).toBe(false);
    return p;
  };

  it('NEGATIVE (d5): "Pipeline value" → "Monthly revenue", +£1 per £1 flagged definitional, with a level today, stays Olumi\'s estimate', async () => {
    const s: Shape = { ...REVENUE, net: 'Pipeline value', netToday: 300000, cap: 1000000, a: 500000, b: 400000,
      say: () => 'Revenue is £200,000 a month today and must reach at least £250,000 a month. Our pipeline is worth £300,000. '
        + 'Option A grows the pipeline to £500,000; option B grows it to £400,000.' };
    const p = await unchanged(s, 'a causal conversion is not a definition');
    const e = edge(p.graph, 'pipeline_value', 'monthly_revenue');
    expect(e.provenance.magnitude).toBe('olumi_estimate');
    expect(e.exists_probability).toBe(0.8);
    expect(e.defaulted).toBe(true);
  });

  it('NEGATIVE (zero-baseline pure-delta lookalike): "Additional pipeline" (0 today, set only by options) → "Monthly revenue"', async () => {
    const s: Shape = { ...REVENUE, net: 'Additional pipeline', say: () => 'Revenue is £200,000 a month today and must reach at least £250,000 '
      + 'a month. Option A adds exactly £50,000 of pipeline; option B adds exactly £49,999 of pipeline.' };
    const e = edge((await unchanged(s, 'pipeline added is not revenue')).graph, 'additional_pipeline', 'monthly_revenue');
    expect(e.exists_probability).toBe(0.8);
  });

  it('LIMITATION (reported): a label d5 cannot bind ("Net effect" → "Widget output") keeps today\'s numbers', async () => {
    const s: Shape = { ...WIDGETS, goal: 'Widget output', net: 'Net effect' };
    expect(edge((await unchanged(s, 'd5 does not hold it')).graph, 'net_effect', 'widget_output').exists_probability).toBe(0.8);
  });

  it('NEGATIVE: today\'s level is Olumi\'s estimate, not the person\'s figure — no baseline is supplied for the sum', () =>
    unchanged({ ...WIDGETS, todayBy: 'ai_proposed', say: () => 'We need at least 60 widgets per hour. Option A adds exactly 30 widgets per hour; '
      + 'option B adds exactly 10 widgets per hour.' }, 'no supplied baseline'));
  it('NEGATIVE: read in another unit', () => unchanged({ ...WIDGETS, netUnit: 'widgets/day' }, 'another unit'));
  it('NEGATIVE: the drafter did not say definitional', () => unchanged({ ...WIDGETS, definitional: null }, 'no flag'));

  // The retained conditions (Codex PAIR3 3): "today + the option's change" is the engine's arithmetic only for a lever nothing but
  // the options moves, 0 today. Each row asserts its own precondition on the graph so it cannot pass vacuously.
  it('NEGATIVE (retained): the part is not 0 today (+1 today, within reconciliation) — not compiled', async () => {
    const s: Shape = { ...WIDGETS, netToday: 1, say: (a, b) => `Today we make 40 widgets per hour and the net change today is 1 widget per hour. `
      + `We need at least 60 widgets per hour. Option A adds exactly ${a} widgets per hour; option B adds exactly ${b} widgets per hour.` };
    const p = await unchanged(s, 'a part with a level today of its own');
    expect(raw(node(p.graph, netId(s))!)).toBe(1);
  });

  it('NEGATIVE (retained): the part has a causal parent besides the options — not compiled', async () => {
    const wire = candidate(WIDGETS);
    (wire.factors as Rec[]).push({ label: 'Machine availability', role: 'observable', baseline_known: true, baseline_value: 90, unit: '%',
      provenance: 'explicit', plausible_max: 100 });
    (wire.links as Rec[]).push({ from: 'Machine availability', to: WIDGETS.net, direction: 'positive', provenance: 'ai_proposed', effect_amount: null,
      effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
    const p = await request(await build(wire, `Machine availability is 90%. ${WIDGETS.say(WIDGETS.a, WIDGETS.b)}`));
    expect((p.graph.edges as Rec[]).some((e) => e.from === 'machine_availability' && e.to === netId(WIDGETS)), 'precondition: the parent is admitted').toBe(true);
    expect(goalOf(p.graph).nonlinear_identity).toBeUndefined();
    expect((p.graph.nodes as Rec[]).some((n) => String(n.label).endsWith(' today'))).toBe(false);
  });
});

/**
 * ⛔ THE SHAPE THE DRAFTER ACTUALLY WRITES (DL-3 relay of the verifier's local-stack run on #3421 @04c63519, synthetic): one
 * "<Option> net effect" factor per option in the goal's unit, 0 today, set only by that option, linked to the goal +1 per 1,
 * flagged definitional, `effect_provenance: explicit`, with the drafter's basis "the brief defines this as <Option>'s complete
 * net effect on <goal> relative to today's level". MEASURED: nothing is compiled. d5 (`labelHoldsQuantity`) cannot bind
 * "Option A net effect" to "Widgets per hour", and no existing authority binds the stated figure's SUBJECT, reference or
 * timing from the user's sentence (`construction-source-map.ts`: "which subject and role the figure has stays the AI's
 * reading"). It stays exactly as today (Olumi's estimate at 0.8). Pinned so the limitation is visible, not hidden.
 * ⛔ Binding the part's quantity from the brief's figure words instead was BUILT AND WITHDRAWN (4340c2dc, Codex head review
 * round 2 BLOCK): "adds exactly 20 widgets per hour before maintenance losses. Maintenance removes 10 widgets per hour under
 * Option A" compiled an exact +20 where the complete change is +10, and an unrelated "Last year we made 20 widgets per hour"
 * bound a figure that never named the goal. A figure's quantity is not the option's COMPLETE effect on the goal.
 * A single-occurrence binding (v4: the link's own located quote, complete by its figures) was then BLOCKED at the approach by
 * the Codex pair (PAIR4): a figure-free condition ("before maintenance losses") cannot be read by any existing reader without a
 * phrase matcher, so no compliant binding exists for this shape. Fail-safe: it stays Olumi's disclosed estimate.
 */
describe('STEP 8 Route A — LIMITATION (measured): the drafted per-option "net effect" shape is not compiled', () => {
  it('"Option A net effect" / "Option B net effect" → "Widgets per hour", flagged definitional with a basis, keeps today\'s numbers', async () => {
    const wire = candidate({ ...WIDGETS, a: 20, b: 19 });
    const basis = (o: string) => `the brief defines this as ${o}'s complete net effect on Widgets per hour relative to today's level`;
    wire.factors = ['Option A', 'Option B'].map((o) => ({ label: `${o} net effect`, role: 'controllable', baseline_known: true, baseline_value: 0,
      unit: 'widgets/hour', provenance: 'explicit', plausible_max: 50 }));
    (wire.options as Rec[])[0].interventions[0].factor_label = 'Option A net effect';
    (wire.options as Rec[])[1].interventions[0].factor_label = 'Option B net effect';
    wire.links = ['Option A', 'Option B'].map((o) => ({ from: `${o} net effect`, to: 'Widgets per hour', direction: 'positive', provenance: 'explicit',
      effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'explicit', definitional: true, basis: basis(o), source_quote: null }));
    const p = await request(await build(wire, WIDGETS.say(20, 19)));
    expect(goalOf(p.graph).nonlinear_identity).toBeUndefined();
    expect((p.graph.nodes as Rec[]).some((n) => String(n.label).endsWith(' today'))).toBe(false);
    for (const from of ['option_a_net_effect', 'option_b_net_effect']) {
      const e = edge(p.graph, from, 'widgets_per_hour');
      expect(e).toMatchObject({ exists_probability: 0.8, defaulted: true, provenance: { magnitude: 'olumi_estimate', definitional: true } });
    }
    expect(labelHoldsQuantity('Option A net effect', 'Widgets per hour')).toBe(false);
  });
});
