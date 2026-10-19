/**
 * THE GOAL'S CURRENT LEVEL ON PATH-B (VERIFIER first loss 19:33Z: "Correction: about 110 a week, not 120" refused `not_a_factor`,
 * because the stated baseline lives on the GOAL node; DL-3 ruling (a), BOUNDED). `set_goal_current_level` is prepared by the
 * existing goal-level door (`proposeGoalCurrentLevel`, its rules unchanged) and applied by its own writer (`applyGoalCurrentLevel`,
 * ONE registration), then PATH-B's own receipt and readback. It is held as the user's own figure ONLY where the AI declares the
 * user as its speaker, as their current level, and the figure is in their typed words; anything else is BLOCKED-SCHEMA
 * (`goal_level_unverified`): the goal carrier holds no "unverified" stamp, so nothing is guessed or stamped.
 * Real door and writer; only the scenario's routes are doubles. SYNTHETIC wording.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { authorisationTurnId } from '../../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { provenanceOf } from '../../../../cee/provenance/provenance-of.js';
import { applyChange, proposeChange } from '../change-tools.js';
import { statedGoalLevelInUsersWords } from '../../../agent-lane/goal-current-level.js';

type Rec = Record<string, unknown>;
const SCN = '5c5c5c5c-0000-4000-8000-000000000039';
let persisted: Rec;
const registered: Rec[] = [];
/** A registration that answers with no version of its own (no receipt to read). */
let noVersion = false;
const identityOf = (g: unknown): string => {
  const h = computeGraphIdentityHash(g as never) as unknown;
  return typeof h === 'string' ? h : String((h as { value?: unknown })?.value ?? '');
};
const dispatch = vi.fn(async (path: string, body?: unknown): Promise<{ status: number; json: Rec }> => {
  if (path === `/assist/v1/scenarios/${SCN}/graph`) {
    return { status: 200, json: { graph: structuredClone(persisted), brief_text: null, graph_hash: computeAnalysisAffectingGraphHash(persisted as never),
      graph_identity_hash: { kind: 'graph_identity', value: identityOf(persisted), algorithm: 'sha256' } } };
  }
  if (path === `/assist/v1/scenarios/${SCN}/graph/register`) {
    const b = body as Rec;
    if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(persisted as never) || b.expected_graph_identity_hash !== identityOf(persisted)) {
      return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
    }
    registered.push(b);
    persisted = structuredClone(b.graph) as Rec;
    return { status: 200, json: { graph_hash: computeAnalysisAffectingGraphHash(persisted as never), ...(noVersion ? {} : {
      model_version: { version_number: 100 + registered.length, version_id: `v_reg_${registered.length}`, mutation_id: `m_reg_${registered.length}` } }) } };
  }
  if (path === `/assist/v1/scenarios/${SCN}/versions`) {
    return { status: 200, json: { versions: noVersion ? [] : registered.map((b, i) => ({ version_id: `v_reg_${i + 1}`, sequence: 101 + i,
      creation: { kind: 'committed_mutation', mutation_id: `m_reg_${i + 1}`, source_turn_id: registrationTurnId(SCN, String(b.operation_id)) } })) } };
  }
  throw new Error(`unscripted ${path}`);
});

/** A synthetic model: the goal "Weekly orders" at least 150 a week, today 120 from the brief. */
function stored(): Rec {
  const options = [
    { id: 'add_vans', kind: 'option', label: 'Lease two more vans', interventions: { vans: { value: 0.5, source: 'brief_extraction', extractionType: 'explicit' } } },
    { id: 'carry_on', kind: 'option', label: 'Carry on as now', interventions: { vans: { value: 0.25, source: 'cee_inference' } }, is_baseline: true },
  ];
  const g = {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Delivery capacity' },
      { id: 'orders', kind: 'goal', label: 'Weekly orders', goal_threshold: 0.8, goal_threshold_raw: 150, goal_threshold_cap: 187.5,
        goal_threshold_unit: 'orders a week', goal_threshold_frame: 'level', goal_direction: 'at_least', goal_threshold_cap_provenance: 'target_derived_headroom',
        observed_state: { value: 0.64, baseline: 0.64, raw_value: 120, unit: 'orders a week', cap: 187.5, source: 'brief_extraction' } },
      { id: 'vans', kind: 'factor', label: 'Vans on the road', category: 'controllable', observed_state: { value: 0.25, raw_value: 2, unit: 'vans', cap: 8 } },
      ...options,
    ],
    edges: [
      ...options.map((o) => ({ from: 'decision', to: o.id, strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      ...options.map((o) => ({ from: o.id, to: 'vans', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      { from: 'vans', to: 'orders', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
    goal_node_id: 'orders',
  };
  return projectGraphForPersistence({ ...GraphV3.parse(g), options: [] as Rec[] }) as Rec;
}
const goal = (): Rec => (persisted.nodes as Rec[]).find((n) => n.id === 'orders')!;

const SAID = 'Correction: about 110 a week, not 120.';
const ctxSaying = (words: string) => ({ scenario_id: SCN, authenticated_user_id: 'user-a', turn_id: 'turn-gl', user_turn_text: words, verified_user_messages: [words] });
const level = (origin: string, stance: string, quote: string | null, named: string | null = null) => ({ op: 'set_goal_current_level', goal_id: 'orders',
  value: 110, unit: 'orders a week', stance, source: { origin, quote, named_source: named } });
const deps = (proposals = new ProposalStore()) => ({ dispatch, proposals });
const propose = (d: ReturnType<typeof deps>, ops: readonly unknown[], words = SAID) =>
  proposeChange(d, ctxSaying(words), { public_label: 'Record today’s weekly orders', basis: 'The user corrected the baseline.', ops } as never);

beforeEach(() => {
  persisted = stored();
  registered.length = 0;
  noVersion = false;
  dispatch.mockClear();
});

describe('the goal’s current level: the existing goal-level door, ONE registration, PATH-B’s own receipt and readback', () => {
  it('RED (the VERIFIER loss): the user’s typed correction of the baseline → ONE card, ONE save, read back as their figure', async () => {
    const d = deps();
    const out = await propose(d, [level('user', 'stated_current', 'about 110 a week')]);
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect(d.proposals.size()).toBe(1);
    const id = String((out as { data: Rec }).data.proposal_id);
    const applied = await applyChange(d, ctxSaying(SAID), { proposal_id: id });
    const receiptTurn = registrationTurnId(SCN, authorisationTurnId(`${id}#goal_current_level`));
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ok', mutated: true, data: { saved: true, receipt: { source_turn_id: receiptTurn },
      written: [{ op: 'set_goal_current_level', goal_id: 'orders', figure: 110, unit: 'orders a week', not_kept: [{ what: 'words', declared: 'about 110 a week' }] }] } });
    expect(registered, 'ONE registration').toHaveLength(1);
    expect((goal().observed_state as Rec).raw_value).toBe(110);
    expect(provenanceOf({ value: goal().observed_state }).origin).toBe('human');
    // Exactly once: the same press again reads its own receipt and writes nothing.
    const again = await applyChange(d, { ...ctxSaying(SAID), turn_id: 'turn-gl-2' }, { proposal_id: id });
    expect(again).toMatchObject({ status: 'ok', mutated: false, data: { already_saved: true, receipt: { source_turn_id: receiptTurn } } });
    expect(registered).toHaveLength(1);
  });

  it('"my manager says 110" (a third party’s figure): BLOCKED-SCHEMA goal_level_unverified, nothing proposed or saved', async () => {
    const words = 'My manager says it is about 110 a week.';
    const d = deps();
    const out = await propose(d, [level('third_party', 'stated_current', 'about 110 a week', 'my manager')], words);
    expect(out).toMatchObject({ status: 'unavailable', reason: 'goal_level_unverified', write: 'none' });
    expect(d.proposals.size()).toBe(0);
    expect(registered).toHaveLength(0);
  });

  it.each([['hypothetical'], ['target'], ['estimate']])('a figure put forward as %s is not the goal’s level today: goal_level_unverified, nothing saved', async (stance) => {
    const d = deps();
    expect(await propose(d, [level('user', stance, 'about 110 a week')])).toMatchObject({ status: 'unavailable', reason: 'goal_level_unverified' });
    expect(d.proposals.size()).toBe(0);
  });

  it.each([['olumi', null], ['unknown', 'about 110 a week']])('declared %s: goal_level_unverified, nothing saved', async (origin, quote) => {
    const d = deps();
    expect(await propose(d, [level(origin, 'stated_current', quote)])).toMatchObject({ status: 'unavailable', reason: 'goal_level_unverified' });
    expect(d.proposals.size()).toBe(0);
  });

  it('a figure that is not in the user’s typed words: refused, nothing proposed', async () => {
    const d = deps();
    expect(await propose(d, [level('user', 'stated_current', 'about 115 a week')])).toMatchObject({ status: 'refused', reason: 'quote_not_in_users_words' });
    expect(d.proposals.size()).toBe(0);
  });

  it('beside another change: truthfully not available together, nothing proposed', async () => {
    const d = deps();
    const vans = { op: 'set_factor_value', factor_id: 'vans', value: 3, unit: 'vans', stance: 'estimate', source: { origin: 'olumi', quote: null, named_source: null } };
    expect(await propose(d, [level('user', 'stated_current', 'about 110 a week'), vans])).toMatchObject({ status: 'unavailable', reason: 'mixed_change_not_available' });
    expect(d.proposals.size()).toBe(0);
  });

  it('a save with no receipt of its own is never reported saved: not verified, unknown, and a fresh-turn retry stays unknown (Codex R1)', async () => {
    const d = deps();
    const out = await propose(d, [level('user', 'stated_current', 'about 110 a week')]);
    const id = String((out as { data: Rec }).data.proposal_id);
    noVersion = true;
    expect(await applyChange(d, ctxSaying(SAID), { proposal_id: id })).toEqual({ status: 'unavailable', reason: 'not_verified', write: 'unknown' });
    expect(registered).toHaveLength(1);
    // ONE applied-state authority: the writer's own mark is private; with no receipt the shared store never says "already saved".
    expect(d.proposals.isApplied(id)).toBe(false);
    const retried = await applyChange(d, { ...ctxSaying(SAID), turn_id: 'retry-no-receipt' }, { proposal_id: id });
    expect(retried).toMatchObject({ status: 'unavailable', write: 'unknown' });
    expect(registered, 'never a second registration').toHaveLength(1);
  });

  it('UNIT (Codex R1): "110 orders a month" for a goal in orders a week is refused unit_mismatch, never stamped weekly as the user\u2019s', async () => {
    const words = 'We currently have 110 orders a month.';
    const d = deps();
    const out = await propose(d, [{ ...level('user', 'stated_current', '110 orders a month'), unit: 'orders a month' }], words);
    expect(out).toMatchObject({ status: 'refused', reason: 'unit_mismatch' });
    expect(d.proposals.size()).toBe(0);
    expect(registered).toHaveLength(0);
    expect((goal().observed_state as Rec).raw_value).toBe(120);
  });

  it.each([['widgets', 'unit_mismatch'], ['', 'unit_unstated']])('an unknown or missing declared unit (%j) is refused %s, nothing proposed', async (unit, reason) => {
    const d = deps();
    const out = await propose(d, [{ ...level('user', 'stated_current', 'about 110 a week'), unit }]);
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'refused', reason });
    expect(d.proposals.size()).toBe(0);
  });

  it('B\u2019s rule, bytes only (DL-3 AMEND 20:01Z): the user\u2019s own words holding the figure are enough; the door does not re-read them for meaning', async () => {
    const words = 'Weekly orders are 110 these days.';
    const d = deps();
    const out = await propose(d, [level('user', 'stated_current', 'Weekly orders are 110 these days')], words);
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    const applied = await applyChange(d, ctxSaying(words), { proposal_id: String((out as { data: Rec }).data.proposal_id) });
    expect(applied).toMatchObject({ status: 'ok', mutated: true, data: { saved: true } });
    expect((goal().observed_state as Rec).raw_value).toBe(110);
  });

  it('NUMBER (Codex R1): a quoted 110 cannot support a declared 115: figure_not_in_quote, nothing proposed', async () => {
    const d = deps();
    expect(await propose(d, [{ ...level('user', 'stated_current', 'about 110 a week'), value: 115 }])).toMatchObject({ status: 'refused', reason: 'figure_not_in_quote' });
    expect(d.proposals.size()).toBe(0);
  });

  it('A LANE UNCHANGED: without B\u2019s typed quote, the door still reads the user\u2019s words for the figure; with it, only the unit', () => {
    const goalUnit = { label: 'Weekly orders', unit: 'orders a week' };
    expect(statedGoalLevelInUsersWords(110, 'orders a week', goalUnit, 'We have about 120 a week.')).toMatchObject({ ok: false, refusal: 'figure_not_in_users_words' });
    expect(statedGoalLevelInUsersWords(110, 'orders a week', goalUnit, 'We have about 120 a week.', 'about 110 a week')).toMatchObject({ ok: true, raw: 110, quote: 'about 110 a week' });
    expect(statedGoalLevelInUsersWords(110, 'orders a month', goalUnit, '', 'about 110 a month')).toMatchObject({ ok: false, refusal: 'unit_mismatch' });
    // DL-3 (19 Oct): NO unit stated stays A's base (its words carry the figure); only B's typed caller refuses it.
    expect(statedGoalLevelInUsersWords(110, '', goalUnit, 'We have about 110 orders a week.')).toMatchObject({ ok: true, raw: 110 });
    expect(statedGoalLevelInUsersWords(110, '', goalUnit, 'We have about 110 orders a week.', 'about 110 orders a week')).toMatchObject({ ok: false, refusal: 'unit_unstated' });
  });

  it('a model that moved since the card: superseded, nothing written', async () => {
    const d = deps();
    const out = await propose(d, [level('user', 'stated_current', 'about 110 a week')]);
    const id = String((out as { data: Rec }).data.proposal_id);
    (persisted.nodes as Rec[]).find((n) => n.id === 'vans')!.observed_state = { value: 0.375, raw_value: 3, unit: 'vans', cap: 8 };
    expect(await applyChange(d, ctxSaying(SAID), { proposal_id: id })).toEqual({ status: 'refused', reason: 'superseded' });
    expect(registered).toHaveLength(0);
  });
});
