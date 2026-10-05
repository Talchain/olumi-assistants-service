/**
 * "What would change this?" turn (SCIENCE ROBUSTNESS, EXPERIMENT; #85 lease 5950283606). The corpus is OUTSIDE this
 * author's head: R3's served D3 response (`rc-served-signal-cases.json`, sha-pinned to its capture) and REAL ISL
 * decision-flip blocks (ISL #220 @51bab705: D3 for the served case's first two goal-path links; D1). RC's link copy is
 * bound to its contract bytes at RC @a4992165 (`fixtures/rc-what-changes-link-copy-a4992165.json`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DecisionFlipDispatchResult, FlipLinkRef } from '../../../handlers/decision-flip-dispatch.js';
import type { MethodReadback } from '../method-turn.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import {
  FRACTION_LADDER, LINK_COPY, WHAT_CHANGES_PRESS_ID, WHAT_CHANGES_REPLY, fractionOf, renderLinkTippingPoints, whatChangesTurnFor,
} from '../what-changes-turn.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('../../turn-context/__tests__/fixtures/rc-served-signal-cases.json', import.meta.url), 'utf8')) as { cases: { id: string; capture_sha_matches_case: boolean; body: Rec; expected_state: Rec }[] };
const served = (id: string) => SERVED.cases.find((c) => c.id === id)!;
const RC = JSON.parse(readFileSync(new URL('./fixtures/rc-what-changes-link-copy-a4992165.json', import.meta.url), 'utf8')).link_tipping_points_copy as Rec;
const ISL_D3_BLOCK = {"method":"affine_crn_replicates_v1","leader_option_id":"switch_to_gcp","replicates":4,"bound_abs":0.01,"bound_rel":0.15,"grid_step":0.0025,"links":[{"from_id":"monthly_cloud_savings","to_id":"monthly_spend","status":"quoted","reason":null,"current_mean":-0.3555555555555555,"threshold":-0.09324009324009322,"replicate_thresholds":[-0.09324009324009322,-0.09572649572649569,-0.08578088578088575,-0.09324009324009322],"replicate_range":0.009945609945609946,"to_option_id":"stay_on_aws"},{"from_id":"monthly_cloud_overspend_during_migration","to_id":"monthly_spend","status":"no_change","reason":null,"current_mean":0.17777777777777776,"threshold":null,"replicate_thresholds":[null,null,null,null],"replicate_range":null,"to_option_id":null}]};
const ISL_D1_BLOCK = {"method":"affine_crn_replicates_v1","leader_option_id":"ai_reporting_module_sprint","replicates":4,"bound_abs":0.01,"bound_rel":0.15,"grid_step":0.0025,"links":[{"from_id":"sprint_capacity_for_ai_reporting","to_id":"ai_reporting_module_availability","status":"quoted","reason":null,"current_mean":0.25,"threshold":0.0625,"replicate_thresholds":[0.06125,0.06375,0.06125,0.06625],"replicate_range":0.0050000000000000044,"to_option_id":"integration_bug_fix_sprint"},{"from_id":"ai_reporting_module_availability","to_id":"enterprise_prospect_signing_likelihood","status":"absent","reason":"replicates_spread","current_mean":0.6,"threshold":null,"replicate_thresholds":[0.14125000000000001,0.15125,0.15624999999999997,0.15874999999999997],"replicate_range":0.01749999999999996,"to_option_id":null},{"from_id":"enterprise_prospect_signing_likelihood","to_id":"quarterly_revenue","status":"quoted","reason":null,"current_mean":0.5,"threshold":0.08875000000000002,"replicate_thresholds":[0.08625000000000002,0.09125000000000003,0.08875000000000002,0.08875000000000002],"replicate_range":0.0050000000000000044,"to_option_id":"integration_bug_fix_sprint"}]};

const D3 = served('A-WHAT-CHANGES-NONE-MEASURABLE-SILENT');
// The capture carries no `analysis_ready`; the licence fails CLOSED without an admission (#2533, P0 SHARED DATA matrix
// M6). The route's readback derives it from the graph (`readBackState` → `buildCanonicalAnalysisReadyFromGraph`), so
// these rows state that same producer-minted admission: D3's is M2 (quantified_provisional → permitted_with_caveat).
const rbOf = (c: { body: Rec }, over: Partial<MethodReadback> = {}): MethodReadback => ({
  graph: c.body.draft_graph, analysisState: c.body.analysis_state, analysisResult: c.body.analysis_result,
  optionParticipation: c.body.option_participation, analysisReady: buildCanonicalAnalysisReadyFromGraph(c.body.draft_graph), ...over,
});
// A measurement names the Run it was taken for; by default the served D3 Run (its own computed_against_hash + computed_at).
const D3_RUN = { graph_hash_at_run: D3.body.analysis_result.computed_against_hash as string, computed_at: D3.body.analysis_state.run_state.computed_at as string };
const measured = (block: unknown, links: FlipLinkRef[], run: { graph_hash_at_run: string | null; computed_at: string | null } = D3_RUN): DecisionFlipDispatchResult =>
  ({ status: 'measured', block: block as never, links, run });

describe('RC\'s contract, bound', () => {
  it('the copy and the ladder are RC @a4992165, with the neutral verb DL 6002469285 ruled (same slots, same claim)', () => {
    // RC's own words stay the provenance; only "would come out ahead" / "would still lead" moved (Paul: never a winner).
    const neutral = (rc: string) => rc.replace('{other} would come out ahead', 'More runs would support {other}');
    expect(LINK_COPY.quoted).toBe(neutral(RC.quoted as string));
    expect(LINK_COPY.quoted).toBe("More runs would support {other} if {from}'s effect on {to} fell below about {fraction} of what it is now.");
    expect(RC.fraction_rule).toContain(`"${LINK_COPY.below_a_tenth.replace('More runs would support {other}', '{other} would come out ahead')}"`);
    expect(LINK_COPY.below_a_tenth).toBe("More runs would support {other} only if {from}'s effect on {to} all but disappeared.");
    for (const copy of Object.values(LINK_COPY)) expect(copy).not.toMatch(/\b(?:ahead|best|lead|leads|winner|wins?)\b/);
    // PTL #85/5972624659: RC's "had no effect" overclaims (#220 zeroes the link's mean, not its uncertainty). The ruled
    // wording keeps RC's slots and claim shape; only the over-claim moves.
    expect(RC.no_change).toBe('{leader} would still lead even if {from} had no effect on {to}.');
    expect(LINK_COPY.no_change).toBe("Most runs would still support {leader} even if {from}'s average effect on {to} fell to zero.");
    expect(LINK_COPY.no_change).not.toMatch(/had no effect/);
    const named = [...(RC.fraction_rule as string).matchAll(/([a-z]+(?: [a-z]+)?) (0\.\d+|1\/3|2\/3)/g)]
      .map(([, name, v]) => [v === '1/3' ? 1 / 3 : v === '2/3' ? 2 / 3 : Number(v), name.replace(/^(?:round DOWN, so the claim is always a sufficient condition and never false\): )/, '')] as const);
    expect(named.length).toBe(11);
    expect([...FRACTION_LADDER].sort((a, b) => a[0] - b[0])).toEqual(named.sort((a, b) => a[0] - b[0]));
  });

  it('the fraction rounds DOWN (RC\'s rows): D1 0.064/0.25 → a quarter; on a rung; just under it; under a tenth; no claim', () => {
    expect(fractionOf(0.064, 0.25)).toBe('a quarter');
    expect(fractionOf(0.05, 0.25)).toBe('a fifth'); // exactly on a rung
    expect(fractionOf(0.0499, 0.25)).toBe('a tenth'); // just under it: the next rung down, never up
    expect(fractionOf(-0.09324009324009322, -0.3555555555555555)).toBe('a quarter'); // a negative link weakens toward 0
    expect(fractionOf(0.02, 0.25)).toBe('below_a_tenth');
    for (const [t, c] of [[0.25, 0.25], [0.3, 0.25], [0.1, 0], [Number.NaN, 0.25]] as const) expect(fractionOf(t, c)).toBeNull();
  });
});

describe('the served D3 case + ISL\'s real D3 block', () => {
  it('the corpus is the capture', () => expect(D3.capture_sha_matches_case).toBe(true));

  it('a measured answer: RC\'s sentence per link, in goal-distance order, with no model call', async () => {
    const ask = vi.fn(async (links: readonly FlipLinkRef[]) => measured(ISL_D3_BLOCK, links.slice(0, 2)));
    const turn = await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(D3), ask);
    expect(ask.mock.calls[0][0].slice(0, 2)).toEqual([
      { from_id: 'monthly_cloud_savings', to_id: 'monthly_spend' },
      { from_id: 'monthly_cloud_overspend_during_migration', to_id: 'monthly_spend' },
    ]);
    expect(turn?.outcome).toBe('measured');
    // RT-14 (DL #87 5993111927): the answer names options only inside the model's frame, opened once.
    expect(turn?.reply).toBe(
      "In this model, more runs would support ‘Stay on AWS’ if monthly cloud savings's effect on monthly spend fell below about a quarter of what it is now. "
      + "Most runs would still support ‘Switch to GCP’ even if monthly cloud overspend during migration's average effect on monthly spend fell to zero.",
    );
    expect(turn?.reply).not.toMatch(/\d|%|no single (assumption|factor)|nothing would change/i);
  });

  it('every non-measured outcome is RC\'s honest limit (never a figure, never "nothing would change")', async () => {
    for (const result of [
      { status: 'unavailable', reason: 'timeout' }, { status: 'no_run' }, { status: 'no_links' },
    ] as DecisionFlipDispatchResult[]) {
      const turn = await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(D3), async () => result);
      expect(turn?.outcome).toBe('honest_limit');
      expect(turn?.reply).toMatch(/^Olumi can't yet measure what would change this choice in this model\./);
      expect(turn?.reply).not.toMatch(/no single (assumption|factor)|nothing would change/i);
    }
    const thrown = await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(D3), async () => { throw new Error('read failed'); });
    expect(thrown?.outcome).toBe('honest_limit');
    const allAbsent = { ...ISL_D3_BLOCK, links: ISL_D3_BLOCK.links.map((l: Rec) => ({ ...l, status: 'absent', reason: 'leader_unstable', threshold: null, to_option_id: null, replicate_thresholds: null, replicate_range: null })) };
    expect((await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(D3), async (l) => measured(allAbsent, l.slice(0, 2))))?.outcome).toBe('honest_limit');
  });

  it('a model changed since its Run says so; tipping points about another leader are never shown', async () => {
    expect(await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(D3), async () => ({ status: 'stale' })))
      .toMatchObject({ outcome: 'stale', reply: WHAT_CHANGES_REPLY.stale });
    const other = { ...ISL_D3_BLOCK, leader_option_id: 'stay_on_aws', links: ISL_D3_BLOCK.links.map((l: Rec) => (l.status === 'quoted' ? { ...l, to_option_id: 'switch_to_gcp' } : l)) };
    expect((await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(D3), async (l) => measured(other, l.slice(0, 2))))?.outcome).toBe('honest_limit');
  });

  it('a block measured for ANOTHER Run is never shown, even with the same model and leader (Codex P1 #2542)', async () => {
    expect(D3_RUN.graph_hash_at_run).toMatch(/^[0-9a-f]{16}$/);
    for (const run of [
      { ...D3_RUN, computed_at: '2026-10-01T12:30:00.000Z' }, // Run B on the same model: same hash, a newer Run
      { ...D3_RUN, graph_hash_at_run: '0123456789abcdef' }, // a Run on another model
      { graph_hash_at_run: null, computed_at: null }, // a Run with no recorded identity
    ]) {
      const turn = await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(D3), async (l) => measured(ISL_D3_BLOCK, l.slice(0, 2), run));
      expect(turn?.outcome, JSON.stringify(run)).toBe('honest_limit');
    }
    // The readback with no Run identity cannot be matched either.
    const { computed_against_hash: _h, ...unbound } = D3.body.analysis_result;
    expect((await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(D3, { analysisResult: unbound }), async (l) => measured(ISL_D3_BLOCK, l.slice(0, 2))))?.outcome).toBe('honest_limit');
  });

  it('gates: no press → null; an unread model → its reply; no licensed leader or not current → honest limit, PLoT never asked', async () => {
    const ask = vi.fn(async () => ({ status: 'no_run' }) as DecisionFlipDispatchResult);
    expect(await whatChangesTurnFor('agent-next-pre-mortem', rbOf(D3), ask)).toBeNull();
    expect(await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(D3, { graph: null }), ask)).toMatchObject({ outcome: 'model_unread' });
    expect((await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(served('A-Q-D1-BUILD')), ask))?.outcome).toBe('honest_limit'); // unlicensed
    expect((await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(served('A-STALE-SILENT')), ask))?.outcome).toBe('honest_limit'); // complete_stale
    // The served D3 case with ONE field changed: its Run is no longer current, though its leader is still licensed.
    const staleState = { ...D3.body.analysis_state, run_state: { ...D3.body.analysis_state.run_state, kind: 'complete_stale' } };
    expect((await whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbOf(D3, { analysisState: staleState }), ask))?.outcome).toBe('honest_limit');
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('renderLinkTippingPoints', () => {
  const labels = { node: { a: 'Sprint capacity', b: 'AI module availability', c: 'Signing likelihood', d: 'Quarterly revenue' },
    option: { L: 'AI module', O: 'Bug fixes' }, leaderId: 'L' };
  const link = (over: Rec) => ({ from_id: 'a', to_id: 'b', status: 'quoted', threshold: 0.0625, current_mean: 0.25, to_option_id: 'O', ...over });
  it('an absent link and a link without a label are silent; under a tenth has its own sentence', () => {
    expect(renderLinkTippingPoints([link({ status: 'absent', threshold: null, to_option_id: null })], labels)).toEqual([]);
    expect(renderLinkTippingPoints([link({ to_option_id: 'nobody' })], labels)).toEqual([]);
    expect(renderLinkTippingPoints([link({ from_id: 'zz' })], labels)).toEqual([]);
    expect(renderLinkTippingPoints([link({ threshold: 0.02 })], labels)).toEqual(
      ["More runs would support ‘Bug fixes’ only if sprint capacity's effect on AI module availability all but disappeared."]);
  });
  it('ids are data: `constructor`, `toString`, `__proto__` never read an inherited member as an option or a factor (Codex P2 #2542)', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(renderLinkTippingPoints([link({ to_option_id: id })], labels), id).toEqual([]);
      expect(renderLinkTippingPoints([link({ from_id: id })], labels), id).toEqual([]);
      expect(renderLinkTippingPoints([link({ status: 'no_change', threshold: null, to_option_id: null })], { ...labels, leaderId: id }), id).toEqual([]);
    }
    // A graph whose node id IS `__proto__` keeps it as a label, never as the map's prototype.
    const proto = { nodes: [{ id: '__proto__', label: 'Proto factor' }, { id: 'b', label: 'Outcome' }] };
    const turn = renderLinkTippingPoints([link({ from_id: '__proto__' })], { ...labels, node: Object.fromEntries(proto.nodes.map((n) => [n.id, n.label])) });
    expect(turn).toEqual(["More runs would support ‘Bug fixes’ if proto factor's effect on outcome fell below about a quarter of what it is now."]);
  });

  it('ISL\'s real D1 block: two quoted links, the spread absence silent', () => {
    const d1 = { node: { sprint_capacity_for_ai_reporting: 'Sprint capacity for AI reporting', ai_reporting_module_availability: 'AI reporting module availability',
      enterprise_prospect_signing_likelihood: 'Enterprise prospect signing likelihood', quarterly_revenue: 'Quarterly revenue' },
      option: { ai_reporting_module_sprint: 'AI reporting module sprint', integration_bug_fix_sprint: 'Integration bug-fix sprint' },
      leaderId: 'ai_reporting_module_sprint' };
    expect(renderLinkTippingPoints(ISL_D1_BLOCK.links as never, d1)).toEqual([
      "More runs would support ‘Integration bug-fix sprint’ if sprint capacity for AI reporting's effect on AI reporting module availability fell below about a quarter of what it is now.",
      // 0.08875 / 0.5 = 0.1775: the largest rung at or below it is a tenth (rounded DOWN, never up to a fifth).
      "More runs would support ‘Integration bug-fix sprint’ if enterprise prospect signing likelihood's effect on quarterly revenue fell below about a tenth of what it is now.",
    ]);
  });
});
