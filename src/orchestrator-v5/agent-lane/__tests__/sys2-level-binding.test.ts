/**
 * ⭐ SYSTEM 2 step 2: a stated level is the user's through ONE construction source map (DL-adopted rule, 15 Oct; AIE "labels
 * propose, never verify"). The UI's joined-flow witness (CEE 880b35b4, scenario d22dfc28) built the capacity brief with no
 * level today on the goal: "Our existing team resolves 80 tickets per week." failed the label-word binder, so the goal's
 * "80 + 0, by your definition" was withheld as Olumi's estimate and coaching asked again for a figure the user had given.
 * The corpus is not the author's: the served drafter raw (`served-capacity-e4ff6039.json`, md5 = the DB's) through the real
 * `buildModelFromBrief`; the second brief is Paul's served legacy brief c1494f4d with the drafter's served labels.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { statementBindsFactorLevel } from '../verified-option-setting.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { valueProvenanceOf } from '../../../cee/provenance/provenance-of.js';
import { goalLevelIsOlumisEstimate } from '../../goal-target/goal-chance-licence.js';
import { withDeclaredStance } from './helpers/declared-stance.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync('tests/fixtures/sys2/served-capacity-e4ff6039.json', 'utf8')) as { brief: string; raw_text: string };
// INPUT CHANGE (stance, AIE 543db8bb): the served sentences are current assertions or targets, declared as the drafter now does.
const RAW = withDeclaredStance(JSON.parse(SERVED.raw_text) as Rec);
const LEGACY = JSON.parse(readFileSync('tests/fixtures/drafter-capacity-chain/served-c1494f4d.json', 'utf8')) as { brief: string; draft: Rec };
const HIRING = { brief: (JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007.json', 'utf8')) as Rec).brief as string,
  draft: JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007-draft.json', 'utf8')) as Rec };
const EIGHTY = 'Our existing team resolves 80 tickets per week.';
const sid = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';

async function registered(draft: Rec, brief = SERVED.brief): Promise<Rec> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: JSON.stringify(draft), status: 'completed' })) as never) as Rec;
  if (result.ok !== true || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return graph;
}
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const asksForToday = (g: Rec): boolean => JSON.stringify(targetTestabilityOf(g)).includes('missing_goal_baseline');
/** The user states the total's level today directly (DL-3's genuine affirmative), as the SYSTEM 2 drafter records it. */
const HANDLE = 'Today we handle 80 tickets per week (60 + 20).';
const handled = (): Rec => ({ ...RAW, statements: [...RAW.statements, { quote: HANDLE, subject: { kind: 'goal', label: 'Weekly support capacity', to_label: null,
  factor_label: null }, field: 'level', form: 'point', value: 80, low: null, high: null, unit: 'tickets per week', qualifier: null, conditions: null, stance: 'stated_current' }] });

/**
 * ⛔ CHANGED (Codex #3440 R3; DL-3 ruling by measurement): the goal's level today was DERIVED from the user's quoted sum (80 + 0).
 * Measured, a supposed sum ("In a world where …", "Let's say …") derived it too. While user-declared exact sums are owed, no level
 * is derived from a quoted sum: the goal's level is withheld and readiness asks. A level the user states directly is theirs.
 */
describe('SYSTEM 2 step 2: the stated level is the user\'s; the goal\'s level today is never derived from a quoted sum (owed)', () => {
  it('served raw: the user\'s 80 is theirs; the goal\'s level today is not derived from the quoted sum: withheld, readiness asks', async () => {
    const g = await registered(RAW);
    expect(node(g, 'existing_team_support_capacity').observed_state).toMatchObject({ raw_value: 80, source: 'brief_extraction', extractionType: 'explicit' });
    expect(node(g, 'existing_team_support_capacity').observed_state.user_material_unverified).toBeUndefined();
    const goal = node(g, 'weekly_support_capacity');
    expect(goal.observed_state ?? null).toBeNull();
    expect(goal.goal_level_reading).toBeUndefined();
    expect(asksForToday(g)).toBe(true);
  });

  it('⭐ POSITIVE (DL-3): the user states the total today, "Today we handle 80 tickets per week (60 + 20).": the goal\'s 80 is theirs, no re-ask', async () => {
    const g = await registered(handled(), `${SERVED.brief} ${HANDLE}`);
    const goal = node(g, 'weekly_support_capacity');
    expect(goal.observed_state).toMatchObject({ raw_value: 80, source: 'brief_extraction' });
    expect(goalLevelIsOlumisEstimate(g, 'weekly_support_capacity')).toBe(false);
    expect(valueProvenanceOf(goal.observed_state).origin).toBe('human');
    expect(goal.goal_level_reading?.derived).toBeUndefined();
    expect(asksForToday(g)).toBe(false);
  });

  it('CONTRAST (no default 0): a part the definition does not name as additional gives no level, and readiness still asks', async () => {
    const rename = (v: unknown): unknown => (typeof v === 'string' ? v.split('Additional specialist capacity').join('Specialist capacity') : v);
    const swap = (x: Rec): Rec => JSON.parse(JSON.stringify(x), (_k, v) => rename(v));
    const g = await registered({ ...swap(RAW), statements: RAW.statements });
    expect(node(g, 'weekly_support_capacity').observed_state).toBeUndefined();
    expect(asksForToday(g)).toBe(true);
    // The factor's own 80 is still the user's: it never depended on the zero.
    expect(node(g, 'existing_team_support_capacity').observed_state).toMatchObject({ source: 'brief_extraction', extractionType: 'explicit' });
  });

  it('the four tests, each a contrast: frame, distinctive word, and one subject per figure', () => {
    const factor = RAW.factors.find((f: Rec) => f.label === 'Existing team support capacity');
    expect(statementBindsFactorLevel(RAW as never, factor, SERVED.brief)).toBe(true);
    // (3) a same-frame rival whose label also says "existing team": no distinctive word, so unknown.
    const rival = { ...RAW, outcomes: [...RAW.outcomes, { label: 'Existing team overtime', provenance: 'inferred', unit: 'tickets per week' }] };
    expect(statementBindsFactorLevel(rival as never, factor, SERVED.brief)).toBe(false);
    // (4) the same sentence's 80 also bound to another subject (the goal's level): unknown.
    const twice = { ...RAW, statements: [...RAW.statements, { ...RAW.statements.find((s: Rec) => s.quote === EIGHTY), subject: { kind: 'goal', label: 'Weekly support capacity', to_label: null, factor_label: null } }] };
    expect(statementBindsFactorLevel(twice as never, factor, SERVED.brief)).toBe(false);
    // (2) the sentence bound to a factor of another frame (tickets per week PER SPECIALIST): unknown.
    const per = RAW.factors.find((f: Rec) => f.label === 'Tickets resolved per additional specialist');
    const misbound = { ...RAW, statements: [{ ...RAW.statements.find((s: Rec) => s.quote === EIGHTY), subject: { kind: 'factor', label: per.label, to_label: null, factor_label: null } }] };
    expect(statementBindsFactorLevel(misbound as never, { ...per, baseline_value: 80 }, SERVED.brief)).toBe(false);
    // AIE 6181498097: the four tests are ambiguity checks ONLY; the existing context checks still hold. A sentence that also
    // writes the goal's target figure never attests a current level, however uniquely it names the factor.
    expect(statementBindsFactorLevel({ ...RAW, goal: { ...RAW.goal, value: 80 } } as never, factor, SERVED.brief)).toBe(false);
  });

  it('SECOND BRIEF (Paul\'s served hiring brief post3007, served labels): "six mid-weight developers" binds 6 to "Mid-weight developers"', () => {
    const stmt = (label: string, quote: string, value: number, unit: string): Rec => ({ quote, subject: { kind: 'factor', label, to_label: null, factor_label: null },
      field: 'level', form: 'point', value, low: null, high: null, unit, qualifier: null, conditions: null, stance: 'stated_current' });
    const devs = HIRING.draft.factors.find((f: Rec) => f.label === 'Mid-weight developers');
    expect(statementBindsFactorLevel({ ...HIRING.draft, statements: [stmt(devs.label, devs.baseline_evidence.quote, 6, 'developers')] } as never, devs, HIRING.brief)).toBe(true);
    // CONTRAST, same brief: bound to another same-frame-free factor ("Tech lead hires", people) the frame test refuses it.
    const leads = HIRING.draft.factors.find((f: Rec) => f.label === 'Tech lead hires');
    expect(statementBindsFactorLevel({ ...HIRING.draft, statements: [stmt(leads.label, devs.baseline_evidence.quote, 6, 'people')] } as never, { ...leads, baseline_value: 6 }, HIRING.brief)).toBe(false);
    // CONTEXT KEPT (AIE 6181498097), Paul's legacy brief c1494f4d: the same sentence there sits beside "the next SIX months", a
    // repeated figure in its paragraph, so the existing neighbour check holds it unknown, however uniquely it names the factor.
    const lDevs = LEGACY.draft.factors.find((f: Rec) => f.label === 'Mid-weight developers');
    expect(statementBindsFactorLevel({ ...LEGACY.draft, statements: [stmt(lDevs.label, lDevs.baseline_evidence.quote, 6, 'developers')] } as never, lDevs, LEGACY.brief)).toBe(false);
  });
});
