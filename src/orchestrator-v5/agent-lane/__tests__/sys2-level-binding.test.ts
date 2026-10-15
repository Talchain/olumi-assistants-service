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
import { projectEntity } from '../runtime/agent-capabilities.js';
import { statementBindsFactorLevel } from '../verified-option-setting.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { valueProvenanceOf } from '../../../cee/provenance/provenance-of.js';
import { goalLevelIsOlumisEstimate } from '../../goal-target/goal-chance-licence.js';
import { goalReadingsOf } from '../../coaching/goal-reading-disclosure.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync('tests/fixtures/sys2/served-capacity-e4ff6039.json', 'utf8')) as { brief: string; raw_text: string };
const RAW = JSON.parse(SERVED.raw_text) as Rec;
const LEGACY = JSON.parse(readFileSync('tests/fixtures/drafter-capacity-chain/served-c1494f4d.json', 'utf8')) as { brief: string; draft: Rec };
const HIRING = { brief: (JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007.json', 'utf8')) as Rec).brief as string,
  draft: JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007-draft.json', 'utf8')) as Rec };
const EIGHTY = 'Our existing team resolves 80 tickets per week.';
const sid = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';

async function registered(draft: Rec): Promise<Rec> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, SERVED.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: JSON.stringify(draft), status: 'completed' })) as never) as Rec;
  if (result.ok !== true || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return graph;
}
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const asksForToday = (g: Rec): boolean => JSON.stringify(targetTestabilityOf(g)).includes('missing_goal_baseline');
const withoutStatusQuoZero = (): Rec => ({ ...RAW, statements: RAW.statements.filter((s: Rec) => s.quote !== 'Keep current staffing adds no specialist.') });
const DERIVED = 'Today’s level of ‘Weekly support capacity’ is derived from your figures, by your definition: ‘Existing team support capacity’ is 80 tickets per week; ‘Additional specialist capacity’ is none today, because it counts only what is added';

describe('SYSTEM 2 step 2: the stated level is the user\'s, and the goal\'s level today is DERIVED from their figures (80 + 0)', () => {
  it('RED (served raw): the user\'s 80 is theirs; the goal\'s level today is derived from their figures, never a measured total', async () => {
    const g = await registered(RAW);
    expect(node(g, 'existing_team_support_capacity').observed_state).toMatchObject({ raw_value: 80, source: 'brief_extraction', extractionType: 'explicit' });
    expect(node(g, 'existing_team_support_capacity').observed_state.user_material_unverified).toBeUndefined();
    const goal = node(g, 'weekly_support_capacity');
    expect(goal.observed_state).toMatchObject({ raw_value: 80, baseline: 0.16, source: 'brief_extraction' });
    expect(goal.observed_state.extractionType).toBeUndefined(); // never presented as an explicitly measured total
    expect(goal.goal_level_reading).toEqual({ level: 80, level_unit: 'tickets per week', lead: DERIVED, derived: true,
      quote: 'Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity.' });
  });

  it('CONSUMERS use it: the licence (not Olumi\'s estimate; its readings say "derived"), readiness (no re-ask), the Run\'s words and the AI\'s goal', async () => {
    const g = await registered(RAW);
    const goal = node(g, 'weekly_support_capacity');
    expect(goalLevelIsOlumisEstimate(g, 'weekly_support_capacity')).toBe(false);
    expect(valueProvenanceOf(goal.observed_state).origin).toBe('human');
    // The licence's typed readings (the UI says them beside the chance) and the Run reply's tail are this one list.
    expect(goalReadingsOf(g, 'weekly_support_capacity')).toEqual([{ kind: 'level', node_id: 'weekly_support_capacity', words: `${DERIVED}.` }]);
    expect(asksForToday(g)).toBe(false);
    const entity = projectEntity(goal as Parameters<typeof projectEntity>[0]);
    // The AI's goal: the user's figures (system 3's one authority), and how today's level was reached, in the reading's words.
    expect(entity).toMatchObject({ kind: 'goal', raw_value: 80, value_provenance: { origin: 'user' }, level_today_reading: `${DERIVED}.` });
  });

  it('the 0 is by the user\'s DEFINITION ("additional"), never the status quo\'s setting: without "adds no specialist" it still holds', async () => {
    const g = await registered(withoutStatusQuoZero());
    expect(node(g, 'weekly_support_capacity').goal_level_reading?.lead).toBe(DERIVED);
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

  // S4 SHORTCUT (Paul 15 Oct 09:15Z; DL): admission TRUSTS the drafter's statement as filed. The four tests and the context roles
  // (rival label word, one subject per figure, frame, the goal-target sentence, neighbours) are switched off; what stays is
  // the quote check: a whole sentence of the brief that writes the figure, on the drafter's own subject and field.
  it('S4 SHORTCUT: the drafter\'s statement binds as filed; the ambiguity and context checks are off', () => {
    const factor = RAW.factors.find((f: Rec) => f.label === 'Existing team support capacity');
    expect(statementBindsFactorLevel(RAW as never, factor, SERVED.brief)).toBe(true);
    const rival = { ...RAW, outcomes: [...RAW.outcomes, { label: 'Existing team overtime', provenance: 'inferred', unit: 'tickets per week' }] };
    expect(statementBindsFactorLevel(rival as never, factor, SERVED.brief)).toBe(true);
    expect(statementBindsFactorLevel({ ...RAW, goal: { ...RAW.goal, value: 80 } } as never, factor, SERVED.brief)).toBe(true);
  });

  it('S4 SHORTCUT, kept negatives: no statement, a quote not in the brief, a quote not writing the figure, or another figure is never bound', () => {
    const factor = RAW.factors.find((f: Rec) => f.label === 'Existing team support capacity');
    const eighty = RAW.statements.find((s: Rec) => s.quote === EIGHTY);
    const only = (s: Rec): Rec => ({ ...RAW, statements: [s] });
    expect(statementBindsFactorLevel({ ...RAW, statements: [] } as never, factor, SERVED.brief)).toBe(false);
    expect(statementBindsFactorLevel(only({ ...eighty, quote: 'Our existing team resolves 80 tickets per week, roughly.' }) as never, factor, SERVED.brief)).toBe(false);
    expect(statementBindsFactorLevel(only({ ...eighty, value: 90 }) as never, { ...factor, baseline_value: 90 }, SERVED.brief)).toBe(false);
    expect(statementBindsFactorLevel(only(eighty) as never, { ...factor, baseline_value: 70 }, SERVED.brief)).toBe(false);
    expect(statementBindsFactorLevel(only({ ...eighty, negated: true }) as never, factor, SERVED.brief)).toBe(false);
  });

  it('SECOND BRIEF (Paul\'s served hiring brief post3007, served labels): "six mid-weight developers" binds 6 to "Mid-weight developers"', () => {
    const stmt = (label: string, quote: string, value: number, unit: string): Rec => ({ quote, subject: { kind: 'factor', label, to_label: null, factor_label: null },
      field: 'level', form: 'point', value, low: null, high: null, unit, qualifier: null, conditions: null });
    const devs = HIRING.draft.factors.find((f: Rec) => f.label === 'Mid-weight developers');
    expect(statementBindsFactorLevel({ ...HIRING.draft, statements: [stmt(devs.label, devs.baseline_evidence.quote, 6, 'developers')] } as never, devs, HIRING.brief)).toBe(true);
    // S4 SHORTCUT: the drafter's own subject is trusted, so the legacy brief's neighbour check no longer holds it unknown.
    const lDevs = LEGACY.draft.factors.find((f: Rec) => f.label === 'Mid-weight developers');
    expect(statementBindsFactorLevel({ ...LEGACY.draft, statements: [stmt(lDevs.label, lDevs.baseline_evidence.quote, 6, 'developers')] } as never, lDevs, LEGACY.brief)).toBe(true);
  });
});
