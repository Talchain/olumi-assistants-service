/**
 * 0.71.0 — `input_coverage: 'complete'` means VERIFIED, on the REAL wire (DL ruling on #2482, 5939864517).
 *
 * Real `run_analysis` handler, real snapshot builder and residual, the served c96fc4bb graph (Paul's MRR journey). Each
 * row edits the STORED graph between two Runs, proves the request PLoT received actually moved (or did not), and reads
 * the pair's coverage through `diffRunInputs`.
 *
 *   R0  identical Runs → equal residuals → complete, [] (control).
 *   R1  CODEX repro: a factor's σ only (not recorded) → residuals differ → partial, [].
 *   R2  CODEX repro: the goal's ENCODED threshold only (not recorded) → partial, [].
 *   R3  a link's sign flips → partial (the band row never absorbs it).
 *   R4  the Accept step (Olumi's placeholder → the estimate the user accepted, no number moved) → complete + ONE sizing row.
 *   R5  a band move with the writer's own spread (who sized it unchanged) → complete + ONE strength row.
 *   R6  £59 → £60 on an option → complete + ONE option_setting row.
 *   R7  a factor value edit (churn 3% → 4%) → complete + ONE factor row.
 * CODEX pre-review on r2 — inputs the snapshot records but the diff does not compare, or does not record at all:
 *   R8  a factor's `source` only (`cee_inference → user_override`, same value) → partial, [].
 *   R9  a link's `provenance.source` only (`cee_hypothesis → user_specified` under `magnitude: user_stated`; sizing `user`
 *       both Runs, yet the placeholder-parts reader moves) → partial, [].
 *   R10 `observed_state.std_source` only (`olumi → user`, same σ; PLoT moves spread ownership) → partial, [].
 *   R11 a node label only (PLoT's binary classifier reads labels) → partial, [].
 * WRITER → RUN (DL ruling #2482 r3, schemas 0.72.0 `authorship_digest`) — the REAL `adjust_edge_strength` writer:
 *   W1  the user names a band → the band's own σ + authorship → strength + sizing rows, complete (the investor step).
 *   W2  the Accept of Olumi's placeholder → ONE sizing row, complete.
 *   W3  the Accept of a PREVIOUSLY REVIEWED placeholder → ONE sizing row, complete (review metadata on neither end).
 *   W4  a user-owned link confirmed as it is → only the review moves → complete, [].
 *   W5  a factor confirmed as it is → complete, [].
 * FACTOR AUTHORSHIP (F1b lease #85 5945475375, schemas 0.73.0) — the REAL `factor_value_edit` writer:
 *   F1  the user types a figure (served 5945463610) → the wire moves exactly the measured member set → complete + ONE row.
 *   F2  authorship moves on one factor, the value on ANOTHER → partial (a row explains only its own factor).
 *   F3  the user's edit plus a STATED σ (not the stated-level carry's) → partial: a σ is authorship only at that spread.
 *   F4  an older Run that recorded no factor digest → partial.
 * CODEX on 4c043a64 (P1-1, P1-2) — the credit needs the value writer's EXACT output and this Run's own carry:
 *   F5  the user's edit plus an independently STORED σ of exactly 1e-4 (not carried) → partial.
 *   F6  the user's edit plus an independent `extractionType: 'explicit'` on the same factor → partial.
 *   F7  an approved ADOPTION of Olumi's figure through the real writer (`user_assumption`, node `ai_inferred`) → complete.
 *   F8  the user's edit plus an independent node `display_value` (not the writer's) → partial.
 *   F9  the user types 3% → 4% → 3% between Runs (the writer's exact shape, SAME figure; σ now exact) → partial, [].
 *   F10 a colleague's figure: only WHO gave it changes (`elicited_from.participant_id`), same value → partial, [].
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { RunInputSnapshot } from '@talchain/schemas/orchestrator';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { diffRunInputs } from '../../../coaching/run-input-changes.js';
import { olumiSpreadForMean } from '../../../../cee/magnitude/olumi-spread.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';
import { edgeBandStd } from '../../../format/edge-strength-bands.js';
import { sentDigest } from '../run-input-snapshot.js';
import { applyFactorValueEdit } from '../../../system-events/factor-value-edit.js';
import { STATED_LEVEL_STD } from '../stated-level-spread.js';
import { VALUE_WRITE_USER_SOURCE } from '../run-input-residual.js';
import { USER_EDIT_SOURCE } from '../../../../orchestrator/canonicalise-value-ops.js';
import { APPROVED_ADOPTION_SOURCE, runWithApprovedAdoption } from '../../../agent-lane/approved-adoption-context.js';

type Rec = Record<string, any>;
const SCENARIO = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const served = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as { graph: Rec };
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;

function invocation(turnId: string): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO,
      request_id: turnId, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: turnId, scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: turnId, signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
}

/** Run the real handler on `graph`; return the Run's recorded snapshot and the request PLoT received. */
async function runOn(graph: Rec, turn: string): Promise<{ snapshot: RunInputSnapshot; sent: Rec }> {
  const bodies: Rec[] = [];
  const plotClient = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      bodies.push(structuredClone(body));
      const response = structuredClone(happy) as Rec;
      response.results = (body.options as Rec[]).map((o, index) => ({
        option_id: o.option_id, option_label: o.label, win_probability: [0.6, 0.4][index] ?? 0, percentile_p10: 0.1, percentile_p90: 0.9,
      }));
      response.fact_objects = [];
      response.review_cards = [];
      response.meta = { ...(response.meta as Rec), seed_used: '1' };
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'residual', createNoopSessionStore({ loadGraphResult: structuredClone(graph) })),
  });
  const out = await handler(invocation(turn));
  const fact = out.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec | undefined;
  const snapshot = fact?.result?.input_snapshot as RunInputSnapshot | undefined;
  expect(snapshot, 'the Run recorded its inputs').toBeDefined();
  expect(snapshot!.residual_digest, 'and its residual').toMatch(/^[0-9a-f]{64}$/);
  return { snapshot: snapshot!, sent: bodies[0]! };
}

const base = () => {
  const g = structuredClone(served.graph);
  g.nodes.find((n: Rec) => n.id === 'keep_current_price')!.interventions = {
    pro_plan_price: { value: 0.245, raw_value: 49, unit: 'GBP/month', source: 'brief_extraction' },
  };
  return g;
};
const node = (g: Rec, id: string) => g.nodes.find((n: Rec) => n.id === id)!;
const edge = (g: Rec, from: string, to: string) => g.edges.find((e: Rec) => e.from === from && e.to === to)!;
const LINK = ['pro_plan_price', 'monthly_churn'] as const;
const LINK_ID = 'pro_plan_price->monthly_churn';
const LINK_ENDS = { from: 'pro_plan_price', to: 'monthly_churn' };

/** Two Runs: `edit` changes the stored graph between them. */
/** Two Runs: `edit` changes the stored graph between them (in place, or by returning the writer's new graph). */
async function pair(edit: (g: Rec) => void | Rec | Promise<void | Rec>, setup: (g: Rec) => void = () => {}) {
  const g = base();
  setup(g);
  const a = await runOn(g, 'turn-a');
  const written = await edit(g);
  const bGraph = (written ?? g) as Rec;
  const b = await runOn(bGraph, 'turn-b');
  return { a, b, bGraph, ...diffRunInputs(a.snapshot, b.snapshot), wireMoved: sentDigest(a.sent) !== sentDigest(b.sent) };
}

/** The REAL strength writer on the served link (`approved-band-sizes-a-placeholder.test.ts`'s invocation shape). */
async function writeStrength(g: Rec, strength: number, band?: 'very strong' | 'strong' | 'moderate' | 'weak'): Promise<Rec> {
  const proposal = {
    handler_id: 'adjust_edge_strength',
    entity: { id: `${LINK[0]}→${LINK[1]}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'strength', value: strength, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: [],
  };
  const invocation = {
    context: { session_id: SCENARIO, stage: 'frame', request_id: 'req-w', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: { kind: 'message', scenario_id: SCENARIO, turn_id: '11111111-1111-4111-8111-111111111499', stage: 'frame', message: 'set that link' },
    requestId: 'req-w', signal: new AbortController().signal, orientationText: '', proposal, graphForTurn: structuredClone(g),
    ...(band !== undefined ? { edgeStrengthBandAuthority: band } : {}),
  } as unknown as HandlerInvocation;
  const outcome = await createAdjustEdgeStrengthHandler()(invocation);
  expect(outcome.mutated_graph, 'the writer committed a graph').toBeDefined();
  return outcome.mutated_graph as Rec;
}

describe('0.71.0 residual on the real wire — complete means verified', () => {
  it('R0 (control): identical Runs → equal residuals → complete, []', async () => {
    const p = await pair(() => {});
    expect(p.wireMoved).toBe(false);
    expect(p.a.snapshot.residual_digest).toBe(p.b.snapshot.residual_digest);
    expect([p.complete, p.rows]).toEqual([true, []]);
  });

  it('R1 (CODEX repro): a factor\'s σ only — the wire moves, no recorded field does → partial, []', async () => {
    const p = await pair((g) => { node(g, 'monthly_churn').observed_state.std = 0.02; });
    expect(p.wireMoved, 'precondition: the σ reached PLoT').toBe(true);
    expect([p.complete, p.rows]).toEqual([false, []]);
  });

  it('R2 (CODEX repro): the goal\'s ENCODED threshold only → partial, []', async () => {
    const p = await pair((g) => { node(g, 'mrr').goal_threshold = 0.82; });
    expect(p.wireMoved, 'precondition: the encoded threshold reached PLoT').toBe(true);
    expect([p.complete, p.rows]).toEqual([false, []]);
  });

  it('R3: a link\'s sign flips (+0.1 → −0.4, direction negative) → partial', async () => {
    const p = await pair((g) => {
      const e = edge(g, ...LINK);
      e.strength = { mean: -0.4, std: olumiSpreadForMean({ oldMean: 0.1, oldStd: 0.05, newMean: -0.4 }) };
      e.effect_direction = 'negative';
    });
    expect(p.wireMoved).toBe(true);
    expect(p.complete).toBe(false);
  });

  it('R4 (the Accept step): Olumi\'s placeholder → the estimate the user accepted → complete + ONE sizing row', async () => {
    const p = await pair(
      (g) => {
        const e = edge(g, ...LINK);
        e.provenance = { ...e.provenance, magnitude: 'olumi_estimate', reviewed_by_user: { at: '2026-10-01T19:17:12.809Z', intent: 'confirm' } };
      },
      (g) => {
        const e = edge(g, ...LINK);
        e.provenance = { ...e.provenance, magnitude: 'olumi_placeholder' };
      },
    );
    expect(p.wireMoved, 'precondition: the magnitude literal reached PLoT').toBe(true);
    expect(p.complete).toBe(true);
    expect(p.rows.map((r) => [r.entity_id, r.link, r.field, r.before, r.after])).toEqual([
      [LINK_ID, LINK_ENDS, 'sizing', { raw: 'placeholder' }, { raw: 'olumi_accepted' }],
    ]);
  });

  it('R5: a band move with the writer\'s own spread (who sized it unchanged) → complete + ONE strength row', async () => {
    const p = await pair((g) => {
      edge(g, ...LINK).strength = { mean: 0.6, std: olumiSpreadForMean({ oldMean: 0.1, oldStd: 0.05, newMean: 0.6 }) };
    });
    expect(p.wireMoved).toBe(true);
    expect(p.complete).toBe(true);
    expect(p.rows.map((r) => [r.entity_id, r.link, r.field, r.before, r.after])).toEqual([
      [LINK_ID, LINK_ENDS, 'strength', { raw: 'slight' }, { raw: 'strong' }],
    ]);
  });

  it('R6: £59 → £60 on an option → complete + ONE option_setting row', async () => {
    const p = await pair((g) => {
      const iv = node(g, 'raise_price_to_59').interventions.pro_plan_price;
      node(g, 'raise_price_to_59').interventions.pro_plan_price = { ...iv, value: 0.3, raw_value: 60 };
    });
    expect(p.wireMoved).toBe(true);
    expect(p.complete).toBe(true);
    expect(p.rows.map((r) => [r.entity_kind, r.option_id, r.entity_id, r.before?.raw, r.after?.raw])).toEqual([
      ['option_setting', 'raise_price_to_59', 'pro_plan_price', 59, 60],
    ]);
  });

  it('R7 (measured): a factor value edit (churn 3% → 4%) — one factor row; coverage as the wire supports', async () => {
    const p = await pair((g) => {
      node(g, 'monthly_churn').observed_state = { ...node(g, 'monthly_churn').observed_state, value: 0.04, raw_value: 4 };
    });
    expect(p.wireMoved).toBe(true);
    expect(p.rows.map((r) => [r.entity_kind, r.entity_id, r.before?.raw, r.after?.raw])).toEqual([['factor_value', 'monthly_churn', 3, 4]]);
    expect(p.complete).toBe(true);
  });

  it('R8 (CODEX r2): a factor\'s source only (cee_inference → user_override) → partial, []', async () => {
    // σ stated on both Runs (CODEX's construction): a user source otherwise also derives a σ on the wire, which would
    // make this row pass for the σ, not the source (measured: `std: 0.0001` appears).
    const p = await pair(
      (g) => { node(g, 'monthly_churn').observed_state.source = 'user_override'; },
      (g) => { node(g, 'monthly_churn').observed_state.std = 0.02; },
    );
    expect(p.wireMoved).toBe(true);
    expect(p.a.sent.graph.nodes.find((n: Rec) => n.id === 'monthly_churn').observed_state.std, 'precondition: σ identical on the wire')
      .toBe(p.b.sent.graph.nodes.find((n: Rec) => n.id === 'monthly_churn').observed_state.std);
    expect([p.complete, p.rows]).toEqual([false, []]);
  });

  it('R9 (CODEX r2): a link\'s provenance.source only, sizing `user` on both Runs → partial, []', async () => {
    const p = await pair(
      (g) => { edge(g, ...LINK).provenance.source = 'user_specified'; },
      (g) => { edge(g, ...LINK).provenance = { ...edge(g, ...LINK).provenance, magnitude: 'user_stated' }; },
    );
    expect(p.wireMoved).toBe(true);
    expect(p.a.snapshot.links.find((l) => l.from === LINK[0] && l.to === LINK[1])?.sizing).toBe('user');
    expect([p.complete, p.rows]).toEqual([false, []]);
  });

  it('R10 (CODEX r2): observed_state.std_source only (olumi → user), same σ → partial, []', async () => {
    const p = await pair(
      (g) => { node(g, 'monthly_churn').observed_state.std_source = 'user'; },
      (g) => { node(g, 'monthly_churn').observed_state = { ...node(g, 'monthly_churn').observed_state, std: 0.02, std_source: 'olumi' }; },
    );
    expect(p.wireMoved).toBe(true);
    expect([p.complete, p.rows]).toEqual([false, []]);
  });

  it('R11 (CODEX r2): a node label only (Monthly churn → Monthly churn yes/no) → partial, []', async () => {
    const p = await pair((g) => { node(g, 'monthly_churn').label = 'Monthly churn yes/no'; });
    expect(p.wireMoved).toBe(true);
    expect([p.complete, p.rows]).toEqual([false, []]);
  });

  // ⭐ WRITER → RUN (DL ruling #2482 r3): the REAL `adjust_edge_strength` writer edits the stored link, then the Run.
  it('W1 (P1-1, the investor step): the user names a band ("strong") → band σ + authorship move with it → both rows, complete', async () => {
    const p = await pair(async (g) => writeStrength(g, 0.6, 'strong'));
    const after = edge(p.bGraph, ...LINK);
    expect(after.strength.std, 'precondition: the writer set the typed band\'s own spread').toBe(edgeBandStd('strong'));
    expect(after.provenance.source, 'precondition: the writer took authorship').toBe('user_specified');
    expect(p.rows.map((r) => [r.entity_id, r.link, r.field, r.before, r.after])).toEqual([
      [LINK_ID, LINK_ENDS, 'strength', { raw: 'slight' }, { raw: 'strong' }],
      [LINK_ID, LINK_ENDS, 'sizing', { raw: 'olumi_estimate' }, { raw: 'user' }],
    ]);
    expect(p.complete).toBe(true);
  });

  it('W2 (the Accept): Olumi\'s placeholder approved at its own band → ONE sizing row, complete', async () => {
    const p = await pair(async (g) => writeStrength(g, 0.1, 'weak'), (g) => { edge(g, ...LINK).provenance.magnitude = 'olumi_placeholder'; });
    expect(p.rows.map((r) => [r.entity_id, r.field, r.before, r.after])).toEqual([[LINK_ID, 'sizing', { raw: 'placeholder' }, { raw: 'olumi_accepted' }]]);
    expect(p.complete).toBe(true);
  });

  it('W3 (P1-2): Accept of a PREVIOUSLY REVIEWED placeholder (served 96c6f5f4 09:25 shape) → ONE sizing row, complete', async () => {
    const p = await pair(async (g) => writeStrength(g, 0.1, 'weak'), (g) => {
      edge(g, ...LINK).provenance = { ...edge(g, ...LINK).provenance, magnitude: 'olumi_placeholder', reviewed_by_user: { intent: 'confirm', at: '2026-10-01T09:25:10.219Z' } };
    });
    expect(p.rows.map((r) => [r.entity_id, r.field, r.before, r.after])).toEqual([[LINK_ID, 'sizing', { raw: 'placeholder' }, { raw: 'olumi_accepted' }]]);
    expect(p.complete).toBe(true);
  });

  it('W4 (P1-2): a user-owned link confirmed as it is (confirm_current) → only the review moves → complete, []', async () => {
    const p = await pair(async (g) => writeStrength(g, 0.1), (g) => { edge(g, ...LINK).provenance = { source: 'user_specified' }; });
    expect(edge(p.bGraph, ...LINK).provenance.reviewed_by_user?.intent, 'precondition: the writer recorded the review').toBe('confirm');
    expect([p.complete, p.rows]).toEqual([true, []]);
  });

  it('W5 (P1-2): a factor confirmed as it is (observed_state review only) → complete, []', async () => {
    const p = await pair((g) => { node(g, 'monthly_churn').observed_state.reviewed_by_user = { intent: 'confirm_current', at: '2026-10-01T22:00:00.000Z' }; });
    expect(p.wireMoved, 'precondition: the review reached PLoT').toBe(true);
    expect([p.complete, p.rows]).toEqual([true, []]);
  });
});

/** The REAL value writer, as the inspector's edit reaches it (`factor-value-edit-confirm-is-review.test.ts` shape). */
async function writeFactor(g: Rec, target: string, event: Rec): Promise<Rec> {
  const payload = { kind: 'system_event', scenario_id: SCENARIO, turn_id: '77777777-7777-4777-8777-777777777777', stage: 'analyse',
    event: { kind: 'factor_value_edit', target_id: target, field: 'value', ...event } } as Rec;
  const r = await applyFactorValueEdit({ payload, event: payload.event, requestId: 'req-f', persistedGraph: structuredClone(g), priorFacts: [] } as never);
  expect(r.kind, 'the writer committed the edit').toBe('mutated');
  return (r as { mutatedGraph: Rec }).mutatedGraph;
}

/** Every member of node `id` that differs between the two requests PLoT received. */
function movedMembers(a: Rec, b: Rec, id: string): string[] {
  const na = a.graph.nodes.find((n: Rec) => n.id === id);
  const nb = b.graph.nodes.find((n: Rec) => n.id === id);
  const out: string[] = [];
  for (const k of new Set([...Object.keys(na), ...Object.keys(nb)])) {
    if (k !== 'observed_state' && JSON.stringify(na[k]) !== JSON.stringify(nb[k])) out.push(k);
  }
  for (const k of new Set([...Object.keys(na.observed_state ?? {}), ...Object.keys(nb.observed_state ?? {})])) {
    if (JSON.stringify(na.observed_state?.[k]) !== JSON.stringify(nb.observed_state?.[k])) out.push(`observed_state.${k}`);
  }
  return out.sort();
}

describe('0.73.0 factor authorship — a user\'s value edit is credited pairwise, on the real writer and wire', () => {
  it('F1 (served 5945463610): the user types a figure (churn 3% → 4%) → complete + ONE factor row', async () => {
    const p = await pair((g) => writeFactor(g, 'monthly_churn', { value: 4, raw_value: 4 }));
    // The class, measured: the figure (recorded + compared) and the authorship members, nothing else.
    expect(movedMembers(p.a.sent, p.b.sent, 'monthly_churn')).toEqual([
      'display_value', 'observed_state.extractionType', 'observed_state.raw_value', 'observed_state.source',
      'observed_state.std', 'observed_state.value', 'provenance',
    ]);
    expect(p.b.sent.graph.nodes.find((n: Rec) => n.id === 'monthly_churn').observed_state.std, 'the stated-level carry').toBe(STATED_LEVEL_STD);
    expect(p.rows.map((r) => [r.entity_kind, r.entity_id, r.before?.raw, r.after?.raw])).toEqual([['factor_value', 'monthly_churn', 3, 4]]);
    expect(p.complete).toBe(true);
  });

  it('F2: churn\'s authorship moves (same figure) while ANOTHER factor\'s value is typed → partial', async () => {
    const p = await pair(async (g) => {
      const written = await writeFactor(g, 'monthly_gross_additions', { value: 70, raw_value: 70 });
      node(written, 'monthly_churn').observed_state.source = 'user_override';
      return written;
    });
    expect(p.rows.map((r) => [r.entity_kind, r.entity_id])).toEqual([['factor_value', 'monthly_gross_additions']]);
    expect(p.complete).toBe(false);
  });

  it('F3: the user\'s edit AND a stated σ (0.02, not the carry\'s spread) → partial', async () => {
    const p = await pair(async (g) => {
      const written = await writeFactor(g, 'monthly_churn', { value: 4, raw_value: 4 });
      node(written, 'monthly_churn').observed_state.std = 0.02;
      return written;
    });
    expect(p.b.sent.graph.nodes.find((n: Rec) => n.id === 'monthly_churn').observed_state.std, 'precondition: the stated σ was sent').toBe(0.02);
    expect(p.rows.map((r) => [r.entity_kind, r.entity_id])).toEqual([['factor_value', 'monthly_churn']]);
    expect(p.complete).toBe(false);
  });

  it('F4: an older Run that recorded no factor digest → partial (never credited by default)', async () => {
    const p = await pair((g) => writeFactor(g, 'monthly_churn', { value: 4, raw_value: 4 }));
    const older = { ...p.a.snapshot, factors: p.a.snapshot.factors.map(({ authorship_digest: _d, ...f }) => f) };
    expect(diffRunInputs(older, p.b.snapshot).complete).toBe(false);
  });

  it('F5 (CODEX P1-1): the user\'s edit plus an independently STORED σ of exactly 1e-4 → partial (equality is not origin)', async () => {
    const p = await pair(async (g) => {
      const written = await writeFactor(g, 'monthly_churn', { value: 4, raw_value: 4 });
      node(written, 'monthly_churn').observed_state.std = STATED_LEVEL_STD;
      return written;
    });
    expect(p.b.sent.graph.nodes.find((n: Rec) => n.id === 'monthly_churn').observed_state.std, 'precondition: the same σ number').toBe(STATED_LEVEL_STD);
    expect(p.rows.map((r) => [r.entity_kind, r.entity_id])).toEqual([['factor_value', 'monthly_churn']]);
    expect(p.complete).toBe(false);
  });

  it('F6 (CODEX P1-2): the user\'s edit plus an independent extractionType on the same factor → partial', async () => {
    const p = await pair(async (g) => {
      const written = await writeFactor(g, 'monthly_churn', { value: 4, raw_value: 4 });
      node(written, 'monthly_churn').observed_state.extractionType = 'explicit';
      return written;
    });
    expect(p.rows.map((r) => [r.entity_kind, r.entity_id])).toEqual([['factor_value', 'monthly_churn']]);
    expect(p.complete).toBe(false);
  });

  it('F7: an approved ADOPTION of Olumi\'s figure through the real writer → complete + ONE factor row', async () => {
    const p = await pair((g) => runWithApprovedAdoption(
      { scenarioId: SCENARIO, proposalId: 'prop_f7', targetId: 'monthly_churn', rawValue: 4 },
      () => writeFactor(g, 'monthly_churn', { value: 4, raw_value: 4 }),
    ));
    const os = node(p.bGraph, 'monthly_churn').observed_state;
    expect([os.source, node(p.bGraph, 'monthly_churn').provenance], 'precondition: the writer stored an adoption').toEqual([APPROVED_ADOPTION_SOURCE, 'ai_inferred']);
    expect(p.rows.map((r) => [r.entity_kind, r.entity_id, r.before?.raw, r.after?.raw])).toEqual([['factor_value', 'monthly_churn', 3, 4]]);
    expect(p.complete).toBe(true);
  });

  it('F8: the user\'s edit plus an independent display_value on the same factor → partial', async () => {
    const p = await pair(async (g) => {
      const written = await writeFactor(g, 'monthly_churn', { value: 4, raw_value: 4 });
      node(written, 'monthly_churn').display_value = 'about four per cent';
      return written;
    });
    expect(p.rows.map((r) => [r.entity_kind, r.entity_id])).toEqual([['factor_value', 'monthly_churn']]);
    expect(p.complete).toBe(false);
  });

  it('F9: the user types 3% → 4% → 3% between Runs — writer\'s shape at the SAME figure, σ now exact → partial, []', async () => {
    const p = await pair(async (g) => writeFactor(await writeFactor(g, 'monthly_churn', { value: 4, raw_value: 4 }), 'monthly_churn', { value: 3, raw_value: 3 }));
    expect(node(p.bGraph, 'monthly_churn').observed_state.source, 'precondition: the writer restamped it').toBe(VALUE_WRITE_USER_SOURCE);
    expect(p.b.sent.graph.nodes.find((n: Rec) => n.id === 'monthly_churn').observed_state.std, 'precondition: σ now exact on the wire').toBe(STATED_LEVEL_STD);
    expect([p.complete, p.rows]).toEqual([false, []]);
  });

  it('F10 (CODEX surviving mutant): only the colleague who gave the figure changes → partial, []', async () => {
    const from = (participant: string) => ({ round_id: '11111111-1111-4111-8111-111111111111', participant_id: participant });
    const p = await pair(
      (g) => { node(g, 'monthly_churn').observed_state.elicited_from = from('33333333-3333-4333-8333-333333333333'); },
      (g) => {
        const os = node(g, 'monthly_churn').observed_state;
        Object.assign(os, { source: 'panel_elicited', std: 0.02, elicited_from: from('22222222-2222-4222-8222-222222222222') });
      },
    );
    expect(p.wireMoved, 'precondition: who gave it reached the request').toBe(true);
    expect([p.complete, p.rows]).toEqual([false, []]);
  });

  it('the typed-figure stamp the digest matches IS the value writer\'s own constant', () => {
    expect(VALUE_WRITE_USER_SOURCE).toBe(USER_EDIT_SOURCE);
  });
});
