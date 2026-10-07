/**
 * `_method_result` v:1 (accel P24 / SCI-10). The corpus is OUTSIDE this author's head:
 *   - SCI-DEEP: the byte-for-byte witnessed T1b Run (`served-w3-f440be4a-t1b-7ab6c1af.json`), through the real comparer,
 *     dispatch adapter and presentation licence (the construction `structural-challenge-goal-chance.test.ts` uses);
 *   - SCI-CHANGE: R3's served D3 response and ISL #220's real D3 block (as `what-changes-turn.test.ts`).
 * Rows are bound by IDENTITY (row ids, item refs, run stamps); every "absent" row has a present control.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StructuralChallengeResultV1Schema, type StructuralChallengeResultV1 } from '@talchain/schemas';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { compareStructuralChallenge, NOT_COMPARED } from '../../../coaching/structural-challenge-compare.js';
import { claimPermissionsFrom } from '../../first-analysis.js';
import type { StructuralChallengeFinalRead } from '../../../handlers/structural-challenge-dispatch.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import type { DecisionFlipDispatchResult, FlipLinkRef } from '../../../handlers/decision-flip-dispatch.js';
import type { MethodReadback } from '../../method-turn/method-turn.js';
import { STRUCTURAL_CHALLENGE_LINES, structuralChallengePressId, structuralChallengeTurnFor, type StructuralChallengeTurn } from '../../method-turn/structural-challenge-turn.js';
import { WHAT_CHANGES_PRESS_ID, whatChangesTurnFor } from '../../method-turn/what-changes-turn.js';
import { changeRowsAgreeWithHero, methodResultForEgress, testLinkMethodResult, whatChangesMethodResult } from '../method-result.js';

type Json = Record<string, any>;
const CTX = { scenarioId: 'scn-p24', turnId: 'turn-p24' };
const LEADS = /\blead(s|ing|er)?\b|\bwinner\b|\bbest\b|\brecommend|\bahead\b/i;

// ── SCI-DEEP corpus: the served T1b Run ───────────────────────────────────────────────────────────────────────────────
const WIRE = JSON.parse(readFileSync(new URL('../../__tests__/fixtures/served-w3-f440be4a-t1b-7ab6c1af.json', import.meta.url), 'utf8')) as Json;
const BLOCK = WIRE.blocks.find((b: Json) => b.type === 'analysis_result') as Json;
const KEEP = 'keep_pricing_as_it_is';
const RAISE = 'raise_prices_by_10';
const STARTER = 'launch_starter_tier';
const GOAL = 'monthly_recurring_revenue';
const L1 = { from_id: 'customers_lost_from_price_rise', to_id: GOAL };
const LABELS = new Map<string, string>(BLOCK.enrichment.option_comparison.map((r: Json) => [r.option_id, r.option_label]));
const IDENTITY = { scenario_id: 'y1-control', run_id: 'baseline-control', graph_hash_at_run: 'a'.repeat(16), computed_at: '2026-10-06T19:20:31.396Z' };
const BASELINE = { scenario_id: IDENTITY.scenario_id, run_id: IDENTITY.run_id, graph_hash_at_run: IDENTITY.graph_hash_at_run, seed_used: '1', n_samples: 10_000, sent_digest: 'd'.repeat(64) };

function fact(block: Json, candidate = false): HandlerFact {
  return { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
    ...IDENTITY, ...(candidate ? { run_id: 'candidate-control', graph_hash_at_run: 'b'.repeat(16) } : {}),
    summary: block.summary, leading_option_id: null,
    enrichment: { ...block.enrichment, meta: { seed_used: '1', n_samples: 10_000 }, _meta: { builds: { plot: 'p1', isl: 'i1' } } },
    ...(block.inference_warnings !== undefined ? { inference_warnings: block.inference_warnings } : {}),
    goal_certainty: WIRE.goal_certainty,
    input_snapshot: { snapshot_version: 1, sent_digest: BASELINE.sent_digest,
      goal: { node_id: GOAL, target_raw: 126000, frame: 'level', unit: '£/month' },
      options: block.enrichment.option_comparison.map((r: Json) => ({ option_id: r.option_id, settings: [] })),
      options_not_sent: [], factors: [], links: [], constraints: [] },
  } } as unknown as HandlerFact;
}

async function testLinkTurn(link = L1, status: StructuralChallengeResultV1['status'] = 'completed'): Promise<StructuralChallengeTurn> {
  const baselineFact = fact(BLOCK);
  const out = compareStructuralChallenge({ baselineFact, candidateFact: fact(BLOCK, true),
    turnMayNameLeader: false, reachable: new Set([GOAL]), goalNodeId: GOAL, goalLevelTarget: null });
  if (!out.ok) throw new Error(out.reason);
  const completed = status === 'completed';
  const result = StructuralChallengeResultV1Schema.parse({
    method: 'full_recompute_unpaired_v1', perturbation_class: 'topology', attribution_case: 'C2_unpaired', retention: 'not_retained',
    recompute_key: '0'.repeat(64), baseline: BASELINE,
    alternative: { op: 'remove_link', ...link, origin: 'user_selected', sizing: 'unmarked' },
    status, reason: completed ? null : 'run_not_current', pair_provenance: completed ? out.pair_provenance : null,
    claims: completed ? out.claims : [], not_compared: completed ? [...NOT_COMPARED] : [],
  });
  const state = { run_state: { kind: 'complete_current' }, requires_rerun: false, leader_claim: { permitted: false, separation: 'near_tie' } };
  const finalRead = { read: { analysis_state: state, analysis_result: { type: 'analysis_result' }, current_read: {
    run_state: state.run_state, result: { type: 'analysis_result' }, figures: [],
    computed_against_hash: IDENTITY.graph_hash_at_run, current_analysis_hash: IDENTITY.graph_hash_at_run,
  } } as unknown as StructuralChallengeFinalRead['read'], currentness: {
    readOk: true, fact: baselineFact,
    permissions: claimPermissionsFrom(state, { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } }, { requested: true }),
  } } satisfies StructuralChallengeFinalRead;
  const turn = await structuralChallengeTurnFor(structuralChallengePressId(result.alternative), async () => ({
    kind: 'result', result, labels: LABELS, certainty: out.certainty, finalRead, baselineRunIdentity: IDENTITY, candidateLeaderLicence: 'withheld',
  }));
  if (turn === null) throw new Error('missing turn');
  return turn;
}

// ── SCI-CHANGE corpus: R3's served D3 + ISL's real D3 block ───────────────────────────────────────────────────────────
const SERVED = JSON.parse(readFileSync(new URL('../../turn-context/__tests__/fixtures/rc-served-signal-cases.json', import.meta.url), 'utf8')) as { cases: { id: string; body: Json }[] };
const D3 = SERVED.cases.find((c) => c.id === 'A-WHAT-CHANGES-NONE-MEASURABLE-SILENT')!;
const ISL_D3_BLOCK = {"method":"affine_crn_replicates_v1","leader_option_id":"switch_to_gcp","replicates":4,"bound_abs":0.01,"bound_rel":0.15,"grid_step":0.0025,"links":[{"from_id":"monthly_cloud_savings","to_id":"monthly_spend","status":"quoted","reason":null,"current_mean":-0.3555555555555555,"threshold":-0.09324009324009322,"replicate_thresholds":[-0.09324009324009322,-0.09572649572649569,-0.08578088578088575,-0.09324009324009322],"replicate_range":0.009945609945609946,"to_option_id":"stay_on_aws"},{"from_id":"monthly_cloud_overspend_during_migration","to_id":"monthly_spend","status":"no_change","reason":null,"current_mean":0.17777777777777776,"threshold":null,"replicate_thresholds":[null,null,null,null],"replicate_range":null,"to_option_id":null}]};
const rbD3 = (): MethodReadback => ({ graph: D3.body.draft_graph, analysisState: D3.body.analysis_state, analysisResult: D3.body.analysis_result,
  optionParticipation: D3.body.option_participation, analysisReady: buildCanonicalAnalysisReadyFromGraph(D3.body.draft_graph) });
const D3_RUN = { graph_hash_at_run: D3.body.analysis_result.computed_against_hash as string, computed_at: D3.body.analysis_state.run_state.computed_at as string };
const measured = (links: FlipLinkRef[]): DecisionFlipDispatchResult => ({ status: 'measured', block: ISL_D3_BLOCK as never, links, run: D3_RUN });
const whatChanges = () => whatChangesTurnFor(WHAT_CHANGES_PRESS_ID, rbD3(), async (links) => measured(links.slice(0, 2)));

describe('"Test without this link": rows are the reply\'s allowlisted lines, bound to the tested link', () => {
  it('completed on the served T1b Run: what was tested, each option\'s goal chance with its figures, not saved — in reply order', async () => {
    const turn = await testLinkTurn();
    const m = testLinkMethodResult(turn, CTX)!;
    expect(m).toMatchObject({ v: 1, action_id: 'test_link', outcome: 'completed', scenario_id: 'scn-p24', turn_id: 'turn-p24',
      run: { graph_hash_at_run: IDENTITY.graph_hash_at_run, run_id: IDENTITY.run_id } });
    const ids = m.rows.map((r) => r.row_id);
    expect(ids).toEqual(expect.arrayContaining(['tested', `goal:${RAISE}`, `goal:${STARTER}`, `goal:${KEEP}`, 'not_saved']));
    // Every row is a line of the reply, in the reply's order; the goal rows carry the screen's display strings.
    const at = m.rows.map((r) => turn.reply.indexOf(r.text));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(m.rows.find((r) => r.row_id === 'tested')!.text).toBe(STRUCTURAL_CHALLENGE_LINES.tested);
    expect(m.rows.find((r) => r.row_id === `goal:${STARTER}`)!.figures).toEqual(['about 52%', 'about 52%']);
    expect(m.rows.find((r) => r.row_id === `goal:${KEEP}`)!.figures).toEqual(['less than 1%', 'less than 1%']);
    // Bound to L1 by id: the tested row names only the link; a goal row names its option and the link.
    expect(m.rows.find((r) => r.row_id === 'tested')!.item_refs).toEqual([{ kind: 'link', ...L1 }]);
    expect(m.rows.find((r) => r.row_id === `goal:${RAISE}`)!.item_refs).toEqual([{ kind: 'option', id: RAISE }, { kind: 'link', ...L1 }]);
    // Never the headline, a lead line or the next step (ruling 2): the card is a subset of the chat, not the chat.
    const headline = turn.reply.split('\n')[0]!;
    for (const row of m.rows) {
      expect(row.text).not.toBe(headline);
      expect(row.text).not.toMatch(LEADS);
      expect(row.text).not.toMatch(/^Next step/);
      expect(row.provenance).toBe('server_built');
    }
    expect(methodResultForEgress(m, turn.reply)).toBe(m);
  });

  it('identity pair: the same test on L2 binds every link ref to L2 and none to L1 (and vice versa)', async () => {
    const L2 = { from_id: 'price_rise', to_id: 'customers_lost_from_price_rise' };
    const refsOf = (m: ReturnType<typeof testLinkMethodResult>) => m!.rows.flatMap((r) => r.item_refs.filter((ref) => ref.kind === 'link'));
    const r1 = refsOf(testLinkMethodResult(await testLinkTurn(L1), CTX));
    const r2 = refsOf(testLinkMethodResult(await testLinkTurn(L2), CTX));
    expect(r1.length).toBeGreaterThan(0);
    expect(r1.every((ref) => ref.kind === 'link' && ref.from_id === L1.from_id && ref.to_id === L1.to_id)).toBe(true);
    expect(r2.every((ref) => ref.kind === 'link' && ref.from_id === L2.from_id && ref.to_id === L2.to_id)).toBe(true);
  });

  it('control pair: a stale test is a sidecar with no rows (completed has rows)', async () => {
    const stale = testLinkMethodResult(await testLinkTurn(L1, 'stale'), CTX)!;
    expect(stale).toMatchObject({ outcome: 'stale', rows: [] });
    expect(testLinkMethodResult(await testLinkTurn(L1), CTX)!.rows.length).toBeGreaterThan(0);
  });
});

describe('"What would change this?": RC\'s measured lines only, and only beside a hero that agrees (ruling 4)', () => {
  it('measured on the served D3 case: the quoted line, bound to its link and option; never the no_change line', async () => {
    const turn = (await whatChanges())!;
    expect(turn.outcome).toBe('measured');
    const m = whatChangesMethodResult(turn, { ...CTX, run: null, analysisResult: D3.body.analysis_result })!;
    expect(m).toMatchObject({ v: 1, action_id: 'what_changes', outcome: 'measured', run: D3_RUN });
    expect(m.rows.map((r) => r.row_id)).toEqual(['flip:monthly_cloud_savings->monthly_spend']);
    expect(m.rows[0]!.item_refs).toEqual([{ kind: 'link', from_id: 'monthly_cloud_savings', to_id: 'monthly_spend' }, { kind: 'option', id: 'stay_on_aws' }]);
    expect(turn.reply).toContain(m.rows[0]!.text);
    expect(m.rows.some((r) => /would still be supported/.test(r.text))).toBe(false);
    expect(turn.reply).toMatch(/would still be supported/); // control: the chat still says it
    expect(methodResultForEgress(m, turn.reply)).toBe(m);
  });

  it('ruling 4 on the served T1b Run (displayed points 46 / 52 / <1): the top is the run-share top → rows; another → none', () => {
    const options = [RAISE, STARTER, KEEP];
    expect(changeRowsAgreeWithHero(BLOCK, options, STARTER)).toBe(true);
    expect(changeRowsAgreeWithHero(BLOCK, options, RAISE)).toBe(false);
    // Withheld for one option: no order to compare → none. No goal chance shown at all (D3) → rows.
    const withheld = structuredClone(BLOCK);
    const lic = withheld.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
    lic.withheld_option_ids = [KEEP];
    delete lic.pct_by_option[KEEP];
    expect(changeRowsAgreeWithHero(withheld, options, STARTER)).toBe(false);
    expect(changeRowsAgreeWithHero(D3.body.analysis_result, ['switch_to_gcp', 'stay_on_aws'], 'switch_to_gcp')).toBe(true);
    // A tie at the top and an option list without the top: none.
    const tied = structuredClone(BLOCK);
    tied.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED').pct_by_option[RAISE] = 52;
    expect(changeRowsAgreeWithHero(tied, options, STARTER)).toBe(false);
    expect(changeRowsAgreeWithHero(BLOCK, [RAISE, KEEP], STARTER)).toBe(false);
  });

  it('a hero that disagrees withholds every row (the chat reply is untouched)', async () => {
    const turn = (await whatChanges())!;
    const disagree = whatChangesMethodResult(turn, { ...CTX, run: null, analysisResult: BLOCK })!;
    expect(disagree).toMatchObject({ outcome: 'withheld', rows: [] });
  });
});

describe('egress: a sidecar is sent only with the words it carries', () => {
  it('a row or figure the final reply does not contain sends nothing (control: the reply that contains them sends it)', async () => {
    const turn = await testLinkTurn();
    const m = testLinkMethodResult(turn, CTX)!;
    expect(methodResultForEgress(m, turn.reply.replace('about 52%', 'about 53%'))).toBeNull();
    expect(methodResultForEgress(m, turn.reply.replace(STRUCTURAL_CHALLENGE_LINES.not_saved, ''))).toBeNull();
    expect(methodResultForEgress(m, turn.reply)).toBe(m);
    expect(methodResultForEgress(null, turn.reply)).toBeNull();
  });
});
