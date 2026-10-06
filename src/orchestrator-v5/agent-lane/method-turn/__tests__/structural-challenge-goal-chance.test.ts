/** Y1 round 2: shared screen/Agent words on the byte-for-byte witnessed T1b Run.
 * No served Challenge pair is claimed. The pair, execution metadata/snapshot, earned-one,
 * nearest-five and refusal variants are explicit controls around the captured result block.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { StructuralChallengeResultV1Schema, type StructuralChallengeResultV1 } from '@talchain/schemas';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { compareStructuralChallenge, NOT_COMPARED, type StructuralChallengeCertainty } from '../../../coaching/structural-challenge-compare.js';
import { goalChanceDisplayForAgent } from '../../../goal-target/goal-chance-licence.js';
import { readStoredGoalCertainty } from '../../../tools/handlers/run-goal-certainty.js';
import { goalCertaintyForAgent } from '../../goal-certainty-for-agent.js';
import { analysisResultForAgent } from '../../decision-sensitivity.js';
import { claimPermissionsFrom } from '../../first-analysis.js';
import type { StructuralChallengeFinalRead } from '../../../handlers/structural-challenge-dispatch.js';
import { composeStructuralChallengeReply, structuralChallengePressId, structuralChallengeReplay,
  structuralChallengeTurnFor, structuralChallengeTurnUnderLicence } from '../structural-challenge-turn.js';

type Json = Record<string, any>;
const WIRE = JSON.parse(readFileSync(new URL('../../__tests__/fixtures/served-w3-f440be4a-t1b-7ab6c1af.json', import.meta.url), 'utf8')) as Json;
const BLOCK = WIRE.blocks.find((b: Json) => b.type === 'analysis_result') as Json;
const KEEP = 'keep_pricing_as_it_is';
const RAISE = 'raise_prices_by_10';
const STARTER = 'launch_starter_tier';
const GOAL = 'monthly_recurring_revenue';
const LABELS = new Map<string, string>(BLOCK.enrichment.option_comparison.map((r: Json) => [r.option_id, r.option_label]));
const IDENTITY = { scenario_id: 'y1-control', run_id: 'baseline-control', graph_hash_at_run: 'a'.repeat(16),
  computed_at: '2026-10-06T19:20:31.396Z' };
const BASELINE = { scenario_id: IDENTITY.scenario_id, run_id: IDENTITY.run_id,
  graph_hash_at_run: IDENTITY.graph_hash_at_run, seed_used: '1', n_samples: 10_000, sent_digest: 'd'.repeat(64) };
const copy = (): Json => structuredClone(BLOCK);
const licence = (block: Json): Json => block.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
const HEADLINE = 'chance of meeting the goal, in this model, on current information.';
const say = (display: string) => `${display} ${HEADLINE}`;
const stored = readStoredGoalCertainty(WIRE.goal_certainty);

/** Controls supply execution-only fields absent from the served block; result rows/licence stay captured. */
function fact(block: Json, decisions: unknown = WIRE.goal_certainty, candidate = false): HandlerFact {
  return { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
    ...IDENTITY, ...(candidate ? { run_id: 'candidate-control', graph_hash_at_run: 'b'.repeat(16) } : {}),
    summary: block.summary, leading_option_id: null,
    enrichment: { ...block.enrichment, meta: { seed_used: '1', n_samples: 10_000 },
      _meta: { builds: { plot: 'p1', isl: 'i1' } } }, // Synthetic equal-build control, as in identical-arms.
    ...(block.inference_warnings !== undefined ? { inference_warnings: block.inference_warnings } : {}),
    goal_certainty: decisions,
    input_snapshot: { snapshot_version: 1, sent_digest: BASELINE.sent_digest,
      goal: { node_id: GOAL, target_raw: 126000, frame: 'level', unit: '£/month' },
      options: block.enrichment.option_comparison.map((r: Json) => ({ option_id: r.option_id, settings: [] })),
      options_not_sent: [], factors: [], links: [], constraints: [] },
  } } as unknown as HandlerFact;
}
function pair(a = copy(), b = copy(), decisionsA: unknown = WIRE.goal_certainty, decisionsB: unknown = WIRE.goal_certainty) {
  const baselineFact = fact(a, decisionsA);
  const out = compareStructuralChallenge({ baselineFact, candidateFact: fact(b, decisionsB, true),
    turnMayNameLeader: false, reachable: new Set([GOAL]), goalNodeId: GOAL, goalLevelTarget: null });
  if (!out.ok) throw new Error(out.reason);
  const result = StructuralChallengeResultV1Schema.parse({
    method: 'full_recompute_unpaired_v1', perturbation_class: 'topology', attribution_case: 'C2_unpaired', retention: 'not_retained',
    recompute_key: '0'.repeat(64), baseline: BASELINE,
    alternative: { op: 'remove_link', from_id: 'customers_lost_from_price_rise', to_id: GOAL, origin: 'user_selected', sizing: 'unmarked' },
    status: 'completed', reason: null, pair_provenance: out.pair_provenance, claims: out.claims, not_compared: [...NOT_COMPARED],
  });
  return { result, certainty: out.certainty, baselineFact };
}
function receipt(baselineFact: HandlerFact): StructuralChallengeFinalRead {
  const state = { run_state: { kind: 'complete_current' }, requires_rerun: false, leader_claim: { permitted: false, separation: 'near_tie' } };
  return { read: { analysis_state: state, analysis_result: { type: 'analysis_result' }, current_read: {
    run_state: state.run_state, result: { type: 'analysis_result' }, figures: [],
    computed_against_hash: IDENTITY.graph_hash_at_run, current_analysis_hash: IDENTITY.graph_hash_at_run,
  } } as unknown as StructuralChallengeFinalRead['read'], currentness: {
    readOk: true, fact: baselineFact,
    permissions: claimPermissionsFrom(state, { analysis_admission: {
      structurally_analysable: true, permitted_analysis_mode: 'comparative_leader',
    } }, { requested: true }),
  } };
}
const render = (result: StructuralChallengeResultV1, certainty: StructuralChallengeCertainty) =>
  composeStructuralChallengeReply({ result, labels: LABELS, certainty });

/** Same identity-bound Agent certainty reader, with the existing certainty fixture shapes. */
function agentCertainty(block: Json, decisions: unknown): Json | undefined {
  const state = { run_state: { kind: 'complete_current', computed_at: IDENTITY.computed_at } };
  return goalCertaintyForAgent(block, { scenario_id: IDENTITY.scenario_id, analysis_state: state }, {
    raw: WIRE.draft_graph, analysis_result: block, analysis_state: state, goal_certainty: decisions as readonly unknown[],
  });
}

describe('Y1 goal-chance display equals the same-input Agent authority', () => {
  it('RED at base: captured 46/52/earned zero are shared-helper words through comparison and turn replay', async () => {
    const before = JSON.stringify(BLOCK);
    const { result, certainty, baselineFact } = pair(BLOCK, BLOCK);
    const displays = goalChanceDisplayForAgent(BLOCK)!;
    expect(displays).toEqual({ [RAISE]: 'about 46%', [STARTER]: 'about 52%', [KEEP]: 'less than 1%' });
    expect((analysisResultForAgent(BLOCK) as Json).goal_chance_display).toEqual(displays);
    expect(certainty.baseline).toEqual(stored);
    expect(certainty.baselineDisplay).toEqual(displays);
    expect(certainty.alternativeDisplay).toEqual(displays);
    expect(agentCertainty(BLOCK, WIRE.goal_certainty)?.options).toContainEqual(expect.objectContaining({ option_id: KEEP, earned: true }));
    const turn = await structuralChallengeTurnFor(structuralChallengePressId(result.alternative), async () => ({
      kind: 'result', result, labels: LABELS, certainty, finalRead: receipt(baselineFact),
      baselineRunIdentity: IDENTITY, candidateLeaderLicence: 'withheld',
    }));
    if (turn === null) throw new Error('missing Challenge turn');
    expect(turn.outcome).toBe('completed');
    for (const reply of [render(result, certainty), turn.reply,
      structuralChallengeTurnUnderLicence(turn, receipt(baselineFact)).reply,
      structuralChallengeReplay(turn, receipt(baselineFact)).reply]) {
      for (const id of [RAISE, STARTER, KEEP]) expect(reply).toContain(`${LABELS.get(id)} — baseline: ${say(displays[id])} Without the link: ${say(displays[id])}`);
      expect(reply).not.toContain('of model runs');
      expect(reply).not.toContain('Reaches the target in');
    }
    expect(JSON.stringify(BLOCK)).toBe(before);
  });

  it.each(['baseline', 'alternative'] as const)('RED at base: %s uses its OWN nearest-five licence, not raw rounding or the other side', (side) => {
    const a = copy(), b = copy();
    const changed = side === 'baseline' ? a : b;
    licence(changed).display_rounding_by_option[RAISE] = 'nearest_5';
    licence(changed).pct_by_option[RAISE] = 45; // explicit screen-rounding control, raw remains 0.4643
    const { result, certainty } = pair(a, b);
    const reply = render(result, certainty);
    expect(reply).toContain(`${LABELS.get(RAISE)} — baseline: ${say(goalChanceDisplayForAgent(a)![RAISE])} Without the link: ${say(goalChanceDisplayForAgent(b)![RAISE])}`);
    expect(reply).toContain(say('about 45%'));
    expect(reply).toContain(say('about 46%'));
  });

  it.each(['baseline', 'alternative'] as const)('RED at base: %s earned 0/1 follows the shared edge words', (side) => {
    for (const value of [0, 1] as const) {
      const a = copy(), b = copy(), changed = side === 'baseline' ? a : b;
      changed.enrichment.option_comparison.find((r: Json) => r.option_id === KEEP).probability_of_goal = value;
      licence(changed).pct_by_option[KEEP] = value * 100;
      const decisions = [{ option_id: KEEP, probability_of_goal: value, earned: true }];
      const { result, certainty } = pair(a, b, side === 'baseline' ? decisions : WIRE.goal_certainty, side === 'alternative' ? decisions : WIRE.goal_certainty);
      expect(agentCertainty(changed, decisions)?.options).toContainEqual(expect.objectContaining({ option_id: KEEP, earned: true, probability_of_goal: value }));
      expect(render(result, certainty)).toContain(say(goalChanceDisplayForAgent(changed)![KEEP]));
      expect(render(result, certainty)).not.toMatch(/\b(?:0|100)%/);
    }
  });

  it.each(['baseline', 'alternative'] as const)('control: %s unearned/withheld keeps the SAME Agent stored say verbatim, even beside a display', (side) => {
    for (const value of [0, 1] as const) for (const withheld of [false, true]) {
      const a = copy(), b = copy(), changed = side === 'baseline' ? a : b;
      const row = changed.enrichment.option_comparison.find((r: Json) => r.option_id === KEEP);
      if (withheld) {
        delete row.probability_of_goal;
        changed.enrichment.inference_warnings.push({ code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED' });
      } else row.probability_of_goal = value;
      licence(changed).pct_by_option[KEEP] = value * 100;
      const storedSay = 'Olumi can’t yet say how likely this option is to meet the goal: the relevant link isn’t sized.';
      const decisions = [{ option_id: KEEP, probability_of_goal: value, earned: false, say: storedSay,
        unsized_path: { from: 'customers_lost_from_price_rise', enters_goal_through: GOAL }, no_break_even: 'no_exact_figure' }];
      const { result, certainty } = pair(a, b, side === 'baseline' ? decisions : WIRE.goal_certainty, side === 'alternative' ? decisions : WIRE.goal_certainty);
      const agentSay = agentCertainty(changed, decisions)?.options.find((o: Json) => o.option_id === KEEP)?.say;
      expect(agentSay).toBe(storedSay);
      const line = render(result, certainty).split('\n').find((line) => line.startsWith(`- ${LABELS.get(KEEP)} —`))!;
      expect(line).toContain(`${side === 'baseline' ? 'baseline' : 'Without the link'}: ${agentSay}`);
      expect(line).not.toContain(`${side === 'baseline' ? 'baseline' : 'Without the link'}: ${say(goalChanceDisplayForAgent(changed)![KEEP])}`);
    }
  });

  it.each(['absent', 'duplicate', 'malformed', 'withheld_option'] as const)('control: %s licence cannot be reconstructed from raw goal figures', (kind) => {
    const a = copy(), b = copy();
    if (kind === 'absent') a.enrichment.inference_warnings = a.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_LICENSED');
    if (kind === 'duplicate') a.inference_warnings = [licence(a)];
    if (kind === 'malformed') licence(a).leader_option_id = RAISE;
    if (kind === 'withheld_option') licence(a).withheld_option_ids = [RAISE];
    const { result, certainty } = pair(a, b);
    expect(certainty.baselineDisplay?.[RAISE]).toBeUndefined();
    const reply = render(result, certainty);
    expect(reply).toContain(`${LABELS.get(RAISE)} — baseline: The target frequency was unavailable. Without the link: ${say(goalChanceDisplayForAgent(b)![RAISE])}`);
  });

  it.each(['unrecorded', 'duplicate', 'mismatch'] as const)('control: %s certainty never earns the captured zero from its display alone', (kind) => {
    const decisions = kind === 'unrecorded' ? undefined : kind === 'duplicate' ? [stored![0], stored![0]] : [{ ...stored![0], probability_of_goal: 1 }];
    const { result, certainty } = pair();
    const reply = render(result, { ...certainty, baseline: readStoredGoalCertainty(decisions) });
    expect(reply).toContain(`${LABELS.get(KEEP)} — baseline: This is what this model gives, not a certainty; whether that certainty is earned could not be checked.`);
    expect(reply).not.toContain(`${LABELS.get(KEEP)} — baseline: ${say('less than 1%')}`);
  });

  it('control: stale receipt removes carried figures and certainty before replay', async () => {
    const { result, certainty, baselineFact } = pair();
    const turn = await structuralChallengeTurnFor(structuralChallengePressId(result.alternative), async () => ({
      kind: 'result', result, labels: LABELS, certainty, finalRead: receipt(baselineFact),
      baselineRunIdentity: IDENTITY, candidateLeaderLicence: 'withheld',
    }));
    if (turn === null) throw new Error('missing Challenge turn');
    const stale = receipt(fact(copy()));
    (stale.currentness!.fact as Json).result.run_id = 'newer-control';
    const narrowed = structuralChallengeTurnUnderLicence(turn, stale);
    expect(narrowed.certainty).toBeUndefined();
    expect(narrowed.reply).not.toContain(HEADLINE);
    expect(structuralChallengeReplay(turn, stale).reply).not.toContain(HEADLINE);
  });
});
