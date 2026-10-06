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
import type { HandlerFact, RunInputSnapshot } from '@talchain/schemas/orchestrator';

import { buildRunDelta, withinBandLinkMovesForRunPair } from '../../coaching/build-run-delta.js';
import { linksMovedWithinBand } from '../../coaching/run-input-changes.js';
import { RERUN_NO_CHANGE_LINES, RERUN_FALLBACK_LINES, rerunExplanationPlan, rerunRecordForModel } from '../rerun-explanation.js';

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

const T1 = '2026-10-06T01:10:30.878Z';
const T2 = '2026-10-06T01:13:09.266Z';
const PRIOR_RUN = '3f7b2f1af0062d70a6940a7f4c4c53bc32fe744e602b8548220cf34a1aec8fc8';
const CURRENT_RUN = '5731955b7bb4b30cf97b1dbcf369724d45a7e4fa9aa08b86870f8341ca81ab98';
/** rehearsal10's pair: the user's restatement moves the mean in band AND its authorship (natural_effect lives there). */
const REHEARSAL10_FACTS = [
  fact(CURRENT_RUN, T2, 'h-2', snap(link({ mean: 0.6, std: 0.3, authorship_digest: EDIT_DIGEST }), 'd'.repeat(64))),
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
    const moves = withinBandLinkMovesForRunPair(REHEARSAL10_FACTS, delta);
    expect(moves).toEqual([{ from: FROM, to: TO, band: 'strong', author: 'user' }]);
    const plan = rerunExplanationPlan(delta, labelOf, ['Raise price', 'Hold'], true, Object.values(LABELS), moves)!;
    expect(plan.codeLine).toContain(NAMED_USER);
    expect(plan.codeLine).not.toContain(RERUN_NO_CHANGE_LINES.unknown);
  });

  it('on turn-008’s wire delta: the named line, then "can’t confirm nothing else differed" — never a cause', () => {
    const moves = withinBandLinkMovesForRunPair(REHEARSAL10_FACTS, WIRE_DELTA);
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
    const moves = withinBandLinkMovesForRunPair(REHEARSAL10_FACTS, WIRE_DELTA);
    expect(rerunRecordForModel(WIRE_DELTA, false, nodes, [], moves)?.code_line).toBe(`${NAMED_USER} ${RERUN_FALLBACK_LINES.unverified}`);
  });
});

describe('who changed it: the pair’s persisted record, never a guess (DL; c6 words)', () => {
  const plan = (prior: Link, current: Link) => {
    const moves = linksMovedWithinBand(snap(prior, 'c'.repeat(64)), snap(current, 'd'.repeat(64)));
    return rerunExplanationPlan(WIRE_DELTA, labelOf, [], true, Object.values(LABELS), moves)!.codeLine;
  };
  it('user-sized now AND its authorship moved (a recorded user write): "You changed …"', () => {
    expect(plan(link({}), link({ mean: 0.6, authorship_digest: EDIT_DIGEST }))).toContain(NAMED_USER);
  });
  it('user-sized but the authorship did NOT move (e.g. an Olumi repair of the number): no author is claimed', () => {
    const line = plan(link({}), link({ mean: 0.6 }));
    expect(line).toContain(NAMED_NEUTRAL);
    expect(line).not.toContain('You changed');
  });
  it.each(['olumi_estimate', 'olumi_accepted', 'placeholder'] as const)('Olumi-sized now (%s): the figure is said to be Olumi’s', (sizing) => {
    expect(plan(link({ sizing }), link({ mean: 0.6, sizing, authorship_digest: EDIT_DIGEST }))).toContain(NAMED_OLUMI);
  });
  it('unmarked, or sizing not recorded: no author', () => {
    expect(plan(link({ sizing: 'unmarked' }), link({ mean: 0.6, sizing: 'unmarked' }))).toContain(NAMED_NEUTRAL);
    const { sizing: _a, ...noSizingPrior } = link({});
    const { sizing: _b, ...noSizingCurrent } = link({ mean: 0.6, authorship_digest: EDIT_DIGEST });
    expect(plan(noSizingPrior as Link, noSizingCurrent as Link)).toContain(NAMED_NEUTRAL);
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
