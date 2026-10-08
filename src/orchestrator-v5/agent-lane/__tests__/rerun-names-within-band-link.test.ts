/**
 * ⭐ SD-1 INTERIM (DL 0df0e1 ruling, 6 Oct, cut 5; words c6): S7 NAMES a link whose size moved inside its band.
 *
 * Acceptance rehearsal10 (CEE 7049b01, wire turn-006 → 008): the user restated "Existing-customer price rise →
 * Customers lost from price rise" (natural effect 2 → 3; mean 0.4 → 0.6, both "strong"; source user_specified). The next
 * Run's `run_delta` was `{ attribution_case: C1_attributable, input_coverage: partial, input_changes: [] }` (verbatim
 * below), so S7 said "Olumi can’t say what changed between these two runs." No row can state an in-band move until
 * schemas 0.78's `effect` (cut 6). The interim reads the pair's OWN persisted Run snapshots and names the link; coverage
 * stays partial, so the case line never credits the change with a cause.
 *
 * Outcome metric (named before the fix): on that pair, S7's code line names the link instead of "can’t say what changed".
 * Rows: the producer → S7 chain on the real `buildRunDelta`; the author rule (DL: "You" only on a recorded user write;
 * c6: Olumi's figure is Olumi's; otherwise no author); binding by the delta's run ids, fail closed; the band/sign/same-
 * mean controls; no double naming beside a typed row.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HandlerFact, RunInputSnapshot } from '@talchain/schemas/orchestrator';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { buildRunDelta, withinBandLinkMovesForRunPair } from '../../coaching/build-run-delta.js';
import { linksMovedWithinBand } from '../../coaching/run-input-changes.js';
import { RERUN_NO_CHANGE_LINES, RERUN_FALLBACK_LINES, rerunExplanationPlan, rerunRecordForModel } from '../rerun-explanation.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';

const FROM = 'existing_customer_price_rise';
const TO = 'customers_lost_from_price_rise';
const LABELS: Record<string, string> = { [FROM]: 'Existing-customer price rise', [TO]: 'Customers lost from price rise' };
const labelOf = (id: string) => LABELS[id];
const NAMED_USER = 'You changed how much Existing-customer price rise changes Customers lost from price rise; it is still strong.';
const NAMED_OLUMI = 'Olumi’s estimate for how much Existing-customer price rise changes Customers lost from price rise changed; it is still strong.';
const NAMED_NEUTRAL = 'How much Existing-customer price rise changes Customers lost from price rise changed; it is still strong.';

type Link = RunInputSnapshot['links'][number];
const BRIEF_DIGEST = 'b'.repeat(64);
const EDIT_DIGEST = 'e'.repeat(64);
const link = (over: Partial<Link>): Link => ({ from: FROM, to: TO, mean: 0.4, std: 0.2, band: 'strong', sizing: 'user', authorship_digest: BRIEF_DIGEST, ...over });
const snap = (l: Link, residual: string): RunInputSnapshot => ({
  snapshot_version: 1,
  sent_digest: 'a'.repeat(64),
  residual_digest: residual,
  goal: { node_id: 'goal_mrr', label: 'MRR', target_raw: 150000, unit: '£/month', operator: '>=' },
  options: [
    { option_id: 'opt-a', label: 'Raise price', settings: [] },
    { option_id: 'opt-b', label: 'Hold', is_baseline: true, settings: [] },
  ],
  options_not_sent: [],
  factors: [],
  constraints: [],
  links: [l],
});
const fact = (runId: string, at: string, hash: string, snapshot: RunInputSnapshot): HandlerFact => ({
  fact_type: 'run_analysis',
  noop: false,
  result: {
    enrichment: {
      analysis_status: 'completed',
      results: [
        { option_id: 'opt-a', option_label: 'Raise price', win_probability: 0.45 },
        { option_id: 'opt-b', option_label: 'Hold', win_probability: 0.55 },
      ],
      meta: { seed_used: '7', n_samples: 10_000 },
      _meta: { builds: { plot: 'p1', isl: 'i1' } },
    },
    computed_at: at,
    graph_hash_at_run: hash,
    constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    run_id: runId,
    input_snapshot: snapshot,
  },
} as unknown as HandlerFact);

/** The user write's own persisted receipt (`link-effect-edit.ts`: an applied `adjust_edge_strength`, keyed `from→to`). */
const receipt = (beforeMean: number, afterMean: number, from = FROM, to = TO): HandlerFact => ({
  fact_type: 'adjust_edge_strength',
  fact_version: 1,
  noop: false,
  result: { target_id: `${from}→${to}`, status: 'applied', before: { from, to, strength: { mean: beforeMean, std: 0.2 } },
    after: { from, to, strength: { mean: afterMean, std: 0.3 } } },
} as unknown as HandlerFact);

const T1 = '2026-10-06T01:10:30.878Z';
const T2 = '2026-10-06T01:13:09.266Z';
/** The receipt row's DB-stamped `created_at`: between the two Runs, as rehearsal10's turn-007 was. */
const BETWEEN = '2026-10-06T01:12:00.000Z';
const timed = (f: HandlerFact, created_at = BETWEEN) => ({ fact: f, created_at });
const PRIOR_RUN = '3f7b2f1af0062d70a6940a7f4c4c53bc32fe744e602b8548220cf34a1aec8fc8';
const CURRENT_RUN = '5731955b7bb4b30cf97b1dbcf369724d45a7e4fa9aa08b86870f8341ca81ab98';
/** rehearsal10's pair: the user's restatement moves the mean in band AND its authorship (natural_effect lives there). */
const REHEARSAL10_FACTS = [
  fact(CURRENT_RUN, T2, 'h-2', snap(link({ mean: 0.6, std: 0.3, authorship_digest: EDIT_DIGEST }), 'd'.repeat(64))),
  receipt(0.4, 0.6),
  fact(PRIOR_RUN, T1, 'h-1', snap(link({}), 'c'.repeat(64))),
];
/** turn-008's `run_delta`, verbatim (cut5-rehearsal10-t1b/wire/turn-008-1791249198396.json). */
const WIRE_DELTA = {
  attribution_case: 'C1_attributable',
  pair_provenance: { seed_equal: true, hash_equal: false, builds_equal: 'equal', n_equal: true },
  leader: { changed: false, noise_verdict: 'not_noise_qualified' },
  win_probabilities: [],
  flip_thresholds: [],
  endpoints: { prior: { run_id: PRIOR_RUN, computed_at: T1 }, current: { run_id: CURRENT_RUN, computed_at: T2 } },
  input_coverage: 'partial',
  input_changes: [],
};

describe('the producer → S7 chain on rehearsal10’s pair', () => {
  it('⭐ the real buildRunDelta still says partial + [] (nothing on the wire changes), and S7 now names the link', () => {
    const built = buildRunDelta({ priorFacts: REHEARSAL10_FACTS, mayNameLeadingOption: true });
    expect(built.kind).toBe('ok');
    const delta = (built as { delta: Record<string, unknown> }).delta;
    expect(delta.input_coverage).toBe('partial');
    expect(delta.input_changes).toEqual([]);
    expect(delta).not.toHaveProperty('within_band');
    const moves = withinBandLinkMovesForRunPair(REHEARSAL10_FACTS, delta, [timed(receipt(0.4, 0.6))]);
    expect(moves).toEqual([{ from: FROM, to: TO, band: 'strong', author: 'user' }]);
    const plan = rerunExplanationPlan(delta, labelOf, ['Raise price', 'Hold'], true, Object.values(LABELS), moves)!;
    expect(plan.codeLine).toContain(NAMED_USER);
    expect(plan.codeLine).not.toContain(RERUN_NO_CHANGE_LINES.unknown);
  });

  it('on turn-008’s wire delta: the named line, then "can’t confirm nothing else differed" — never a cause', () => {
    const moves = withinBandLinkMovesForRunPair(REHEARSAL10_FACTS, WIRE_DELTA, [timed(receipt(0.4, 0.6))]);
    const plan = rerunExplanationPlan(WIRE_DELTA, labelOf, ['Raise price', 'Hold'], true, Object.values(LABELS), moves)!;
    expect(plan.codeLine).toBe(`${NAMED_USER} ${RERUN_FALLBACK_LINES.unverified}`);
    expect(plan.inputs.attribution_case).not.toBe('C1_attributable');
  });

  it('CONTROL (the defect, as served): without the pair’s moves S7 says it can’t say what changed', () => {
    const plan = rerunExplanationPlan(WIRE_DELTA, labelOf, ['Raise price', 'Hold'], true, Object.values(LABELS))!;
    expect(plan.codeLine).toBe(RERUN_NO_CHANGE_LINES.unknown);
  });

  it('the typed Agent record carries the same line (rerunRecordForModel)', () => {
    const nodes = Object.entries(LABELS).map(([id, label]) => ({ id, label, kind: 'factor' }));
    const moves = withinBandLinkMovesForRunPair(REHEARSAL10_FACTS, WIRE_DELTA, [timed(receipt(0.4, 0.6))]);
    expect(rerunRecordForModel(WIRE_DELTA, false, nodes, [], moves)?.code_line).toBe(`${NAMED_USER} ${RERUN_FALLBACK_LINES.unverified}`);
  });
});

describe('who changed it: the pair’s persisted record, never a guess (DL; c6 words; buddy r1)', () => {
  const plan = (prior: Link, current: Link, receipts: readonly HandlerFact[] = []) => {
    const facts = [fact(CURRENT_RUN, T2, 'h-2', snap(current, 'd'.repeat(64))), fact(PRIOR_RUN, T1, 'h-1', snap(prior, 'c'.repeat(64)))];
    const moves = withinBandLinkMovesForRunPair(facts, WIRE_DELTA, receipts.map((r) => timed(r)));
    return rerunExplanationPlan(WIRE_DELTA, labelOf, [], true, Object.values(LABELS), moves)!.codeLine;
  };
  const edited = link({ mean: 0.6, authorship_digest: EDIT_DIGEST });
  it('user-sized now, authorship moved, AND the write’s receipt for exactly 0.4 → 0.6: "You changed …"', () => {
    expect(plan(link({}), edited, [receipt(0.4, 0.6)])).toContain(NAMED_USER);
  });
  it('the same move with NO receipt (a moved digest proves metadata changed, not who wrote it): no author', () => {
    const line = plan(link({}), edited);
    expect(line).toContain(NAMED_NEUTRAL);
    expect(line).not.toContain('You changed');
  });
  it('a receipt for ANOTHER move of the same link (0.4 → 0.5), or another link, never counts', () => {
    expect(plan(link({}), edited, [receipt(0.4, 0.5)])).toContain(NAMED_NEUTRAL);
    expect(plan(link({}), edited, [receipt(0.4, 0.6, FROM, 'other_node')])).toContain(NAMED_NEUTRAL);
  });
  it('⭐ buddy r2 (c): the same 0.4 → 0.6 receipt written BEFORE the prior Run, or AFTER the current one, never counts', () => {
    const facts = [fact(CURRENT_RUN, T2, 'h-2', snap(edited, 'd'.repeat(64))), fact(PRIOR_RUN, T1, 'h-1', snap(link({}), 'c'.repeat(64)))];
    const lineWith = (created_at: string) => rerunExplanationPlan(WIRE_DELTA, labelOf, [], true, Object.values(LABELS),
      withinBandLinkMovesForRunPair(facts, WIRE_DELTA, [timed(receipt(0.4, 0.6), created_at)]))!.codeLine;
    expect(lineWith('2026-10-06T01:00:00.000Z')).toContain(NAMED_NEUTRAL);
    expect(lineWith('2026-10-06T01:20:00.000Z')).toContain(NAMED_NEUTRAL);
    expect(lineWith('not a time')).toContain(NAMED_NEUTRAL);
    expect(lineWith(BETWEEN)).toContain(NAMED_USER);
  });
  it('a noop or refused receipt never counts', () => {
    const noop = { ...(receipt(0.4, 0.6) as Record<string, unknown>), noop: true } as unknown as HandlerFact;
    expect(plan(link({}), edited, [noop])).toContain(NAMED_NEUTRAL);
  });
  it('user-sized, receipt present, but the authorship did NOT move: no author', () => {
    const line = plan(link({}), link({ mean: 0.6 }), [receipt(0.4, 0.6)]);
    expect(line).toContain(NAMED_NEUTRAL);
    expect(line).not.toContain('You changed');
  });
  // Science 393023 LICENCE ruling 3, re-derived: estimate/accepted/placeholder → estimate/accepted only;
  // a recorded placeholder means nobody sized the link, so its in-band prior move supplies no estimate or band words.
  it.each(['olumi_estimate', 'olumi_accepted'] as const)('CONTROL: Olumi-sized now (%s): the figure is said to be Olumi’s', (sizing) => {
    expect(plan(link({ sizing }), link({ mean: 0.6, sizing, authorship_digest: EDIT_DIGEST }), [receipt(0.4, 0.6)])).toContain(NAMED_OLUMI);
  });
  it('a recorded placeholder move is omitted, with no sized band or estimate attribution', () => {
    expect(plan(link({ sizing: 'placeholder' }), link({ mean: 0.6, sizing: 'placeholder' }), [receipt(0.4, 0.6)])).toBe(RERUN_NO_CHANGE_LINES.unknown);
  });
  it('unmarked, or sizing not recorded: no author', () => {
    expect(plan(link({ sizing: 'unmarked' }), link({ mean: 0.6, sizing: 'unmarked' }))).toContain(NAMED_NEUTRAL);
    const { sizing: _a, ...noSizingPrior } = link({});
    const { sizing: _b, ...noSizingCurrent } = link({ mean: 0.6, authorship_digest: EDIT_DIGEST });
    expect(plan(noSizingPrior as Link, noSizingCurrent as Link, [receipt(0.4, 0.6)])).toContain(NAMED_NEUTRAL);
  });
});

describe('LICENCE finding 2: the real Monthly churn level writer → the pair’s within-band words', () => {
  it('ai_feature_availability → monthly_churn refits at 5% → 12%; its unsized prior never becomes an estimate sentence', async () => {
    type Graph = { nodes: Record<string, unknown>[]; edges: Array<{ from: string; to: string; strength: { mean: number; std: number }; provenance?: Record<string, unknown> }> };
    const served = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf8')) as Record<string, Graph>;
    const set = async (graph: Graph, value: number): Promise<Graph> => {
      const event = { kind: 'factor_value_edit', target_id: 'monthly_churn', value, unit: '% of Pro subscribers per month', field: 'value' } as const;
      const result = await applyFactorValueEdit({ payload: { kind: 'system_event', scenario_id: '11111111-1111-4111-8111-111111111111',
        turn_id: '77777777-7777-4777-8777-777777777777', stage: 'frame', event } as unknown as SystemEventTurnPayload,
        event, requestId: `licence-r7-churn-${value}`, persistedGraph: graph, priorFacts: [] });
      expect(result.kind).toBe('mutated');
      if (result.kind !== 'mutated') throw new Error('level edit refused');
      return result.mutatedGraph as unknown as Graph;
    };
    const at5 = await set(structuredClone(served.run1_step01!), 5);
    const at12 = await set(at5, 12);
    const recorded = (g: Graph): Link => {
      const e = g.edges.find(e => e.from === 'ai_feature_availability' && e.to === 'monthly_churn')!;
      expect(linkSizing(e)).toBe('placeholder');
      return { from: e.from, to: e.to, ...e.strength, sizing: linkSizing(e), band: 'slight' };
    };
    const before = recorded(at5); const after = recorded(at12);
    expect(before.mean).toBe(-0.0125); expect(after.mean).toBe(-0.03);
    // Science 393023 LICENCE ruling 3, re-derived: "Olumi’s estimate … changed; it is still slight" → silence;
    // the exact writer retains olumi_placeholder on this link. No natural effect was recorded in these Run carriers.
    const facts = [fact(CURRENT_RUN, T2, 'h-2', snap(after, 'd'.repeat(64))), fact(PRIOR_RUN, T1, 'h-1', snap(before, 'c'.repeat(64)))];
    const moves = withinBandLinkMovesForRunPair(facts, WIRE_DELTA);
    expect(moves).toEqual([]);
    const names: Record<string, string> = { ai_feature_availability: 'AI feature availability', monthly_churn: 'Monthly churn' };
    const line = rerunExplanationPlan(WIRE_DELTA, id => names[id], [], true, Object.values(names), moves)!.codeLine;
    expect(line).toBe(RERUN_NO_CHANGE_LINES.unknown);
    expect(line).not.toContain('estimate'); expect(line).not.toContain('slight');
    const otherPair = { ...WIRE_DELTA, endpoints: { prior: { run_id: 'other-run' }, current: { run_id: CURRENT_RUN } } };
    expect(withinBandLinkMovesForRunPair(facts, otherPair)).toEqual([]);
  });
});

describe('what counts as an in-band move (controls)', () => {
  const moves = (prior: Link, current: Link) => linksMovedWithinBand(snap(prior, 'c'.repeat(64)), snap(current, 'c'.repeat(64)));
  it('a band move is the `strength` row’s, never this list', () => {
    expect(moves(link({}), link({ mean: 0.8, band: 'very_strong', authorship_digest: EDIT_DIGEST }))).toEqual([]);
  });
  it('the same mean is no move', () => {
    expect(moves(link({}), link({ authorship_digest: EDIT_DIGEST }))).toEqual([]);
  });
  it('a sign flip is a direction change, never "its size changed"', () => {
    expect(moves(link({}), link({ mean: -0.5, authorship_digest: EDIT_DIGEST }))).toEqual([]);
  });
  it('a band not recorded on either Run: not counted', () => {
    const { band: _b, ...noBand } = link({});
    expect(moves(noBand as Link, link({ mean: 0.6 }))).toEqual([]);
  });
});

describe('bound to the delta’s own Run pair, fail closed', () => {
  it('a delta naming other run ids finds nothing', () => {
    const other = { ...WIRE_DELTA, endpoints: { prior: { run_id: 'r-x' }, current: { run_id: CURRENT_RUN } } };
    expect(withinBandLinkMovesForRunPair(REHEARSAL10_FACTS, other)).toEqual([]);
  });
  it('a complete or not_recorded delta never carries an in-band move', () => {
    expect(withinBandLinkMovesForRunPair(REHEARSAL10_FACTS, { ...WIRE_DELTA, input_coverage: 'complete' })).toEqual([]);
    expect(withinBandLinkMovesForRunPair(REHEARSAL10_FACTS, { ...WIRE_DELTA, input_coverage: 'not_recorded' })).toEqual([]);
  });
  it('two facts for one run id that disagree on its snapshot: nothing', () => {
    const conflicting = [...REHEARSAL10_FACTS, fact(CURRENT_RUN, T2, 'h-2', snap(link({ mean: 0.5 }), 'd'.repeat(64)))];
    expect(withinBandLinkMovesForRunPair(conflicting, WIRE_DELTA)).toEqual([]);
  });
  it('a Run with no snapshot: nothing', () => {
    const noSnap = [REHEARSAL10_FACTS[0]!, { ...REHEARSAL10_FACTS[1]!, result: { ...(REHEARSAL10_FACTS[1] as { result: Record<string, unknown> }).result, input_snapshot: undefined } } as unknown as HandlerFact];
    expect(withinBandLinkMovesForRunPair(noSnap, WIRE_DELTA)).toEqual([]);
  });
});

describe('c6: one sentence per link, after the typed rows, inside the cap', () => {
  it('a link that already has a sizing row is said by that row, never twice', () => {
    const withRow = { ...WIRE_DELTA, input_changes: [{ entity_kind: 'link', entity_id: `${FROM}->${TO}`, link: { from: FROM, to: TO }, field: 'sizing',
      before: { raw: 'olumi_estimate' }, after: { raw: 'user' }, change: 'changed' }] };
    const moves = [{ from: FROM, to: TO, band: 'strong' as const, author: 'user' as const }];
    const line = rerunExplanationPlan(withRow, labelOf, [], true, Object.values(LABELS), moves)!.codeLine;
    expect(line).toContain('You gave your own estimate for how much Existing-customer price rise changes Customers lost from price rise.');
    expect(line).not.toContain(NAMED_USER);
  });
  it('an unlabelled link goes unsaid (coverage is partial anyway)', () => {
    const moves = [{ from: 'ghost_a', to: 'ghost_b', band: 'strong' as const, author: 'user' as const }];
    expect(rerunExplanationPlan(WIRE_DELTA, labelOf, [], true, [], moves)!.codeLine).toBe(RERUN_NO_CHANGE_LINES.unknown);
  });
});


describe('the overflow line past the cap (buddy r1 FAIL; words c6)', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const labels: Record<string, string> = Object.fromEntries(ids.flatMap((x) => [[`f_${x}`, `From ${x}`], [`t_${x}`, `To ${x}`]]));
  const four = (author: 'user' | 'olumi' | 'unknown') => ids.map((x) => ({ from: `f_${x}`, to: `t_${x}`, band: 'strong' as const, author }));
  const line = (moves: ReturnType<typeof four>) =>
    rerunExplanationPlan(WIRE_DELTA, (id) => labels[id], [], true, Object.values(labels), moves)!.codeLine;
  it('four moves with no recorded user write: three named, then "One other input also differs between the two Runs."', () => {
    const l = line(four('unknown'));
    expect(l).toContain('One other input also differs between the two Runs.');
    expect(l).not.toContain('You also made');
  });
  it('an Olumi move past the cap is never "You also made …"', () => {
    expect(line(four('olumi'))).toContain('One other input also differs between the two Runs.');
  });
  it('CONTROL: four receipt-backed user writes keep "You also made 1 other change."', () => {
    expect(line(four('user'))).toContain('You also made 1 other change.');
  });
});

describe('rehearsal12: a band edit AND a figure restated in band, on two links (DL required row)', () => {
  const R12_LABELS: Record<string, string> = {
    price_rise_from_current_price: 'Price rise from current price', customers_lost_to_price_rise: 'Customers lost to price rise',
    starter_monthly_price: 'Starter monthly price', starter_tier_mrr: 'Starter-tier MRR',
  };
  const R12_DELTA = { ...WIRE_DELTA, input_changes: [
    { entity_kind: 'link', entity_id: 'starter_monthly_price->starter_tier_mrr', link: { from: 'starter_monthly_price', to: 'starter_tier_mrr' },
      field: 'strength', before: { raw: 'strong' }, after: { raw: 'moderate' }, change: 'changed' },
    { entity_kind: 'link', entity_id: 'starter_monthly_price->starter_tier_mrr', link: { from: 'starter_monthly_price', to: 'starter_tier_mrr' },
      field: 'sizing', before: { raw: 'olumi_estimate' }, after: { raw: 'user' }, change: 'changed' },
  ] };
  const chatFigure = { from: 'price_rise_from_current_price', to: 'customers_lost_to_price_rise', band: 'strong' as const, author: 'user' as const };
  it('⭐ S7 names BOTH changes and says it can’t confirm nothing else differed — never that one edit caused it', () => {
    const plan = rerunExplanationPlan(R12_DELTA, (id) => R12_LABELS[id], [], true, Object.values(R12_LABELS), [chatFigure])!;
    expect(plan.codeLine).toBe('You gave your own estimate for how much Starter monthly price changes Starter-tier MRR: strong → moderate. '
      + 'You changed how much Price rise from current price changes Customers lost to price rise; it is still strong. '
      + RERUN_FALLBACK_LINES.unverified);
    expect(plan.inputs.attribution_case).not.toBe('C1_attributable');
    const nodes = Object.entries(R12_LABELS).map(([id, label]) => ({ id, label, kind: 'factor' }));
    expect(rerunRecordForModel(R12_DELTA, false, nodes, [], [chatFigure])?.attribution_case).toBe('C2_unpaired');
  });
  it('CONTROL (as served): without the in-band move, S7 names only the band edit — but still never a cause', () => {
    const plan = rerunExplanationPlan(R12_DELTA, (id) => R12_LABELS[id], [], true, Object.values(R12_LABELS))!;
    expect(plan.codeLine).toContain(RERUN_FALLBACK_LINES.unverified);
    expect(plan.codeLine).not.toContain('Price rise from current price');
  });
});
