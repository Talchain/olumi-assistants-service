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

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync('tests/fixtures/sys2/served-capacity-e4ff6039.json', 'utf8')) as { brief: string; raw_text: string };
const RAW = JSON.parse(SERVED.raw_text) as Rec;
const LEGACY = JSON.parse(readFileSync('tests/fixtures/drafter-capacity-chain/served-c1494f4d.json', 'utf8')) as { brief: string; draft: Rec };
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

describe('SYSTEM 2 step 2: the stated level is the user\'s, and the goal\'s level today is "80 + 0, by your definition"', () => {
  it('RED (served raw): the user\'s 80 and the goal\'s level today are recorded as the user\'s', async () => {
    const g = await registered(RAW);
    expect(node(g, 'existing_team_support_capacity').observed_state).toMatchObject({ raw_value: 80, source: 'brief_extraction', extractionType: 'explicit' });
    expect(node(g, 'existing_team_support_capacity').observed_state.user_material_unverified).toBeUndefined();
    expect(node(g, 'weekly_support_capacity').observed_state).toMatchObject({ raw_value: 80, baseline: 0.16, source: 'brief_extraction', extractionType: 'explicit' });
  });

  it('CONSUMERS read the same recorded level: the licence\'s provenance authority, readiness (no re-ask) and the AI\'s goal context', async () => {
    const g = await registered(RAW);
    const goal = node(g, 'weekly_support_capacity');
    expect(valueProvenanceOf(goal.observed_state).origin).toBe('human');
    expect(asksForToday(g)).toBe(false);
    expect(projectEntity(goal as Parameters<typeof projectEntity>[0])).toMatchObject({ kind: 'goal', raw_value: 80, value_provenance: { source: 'brief_extraction', extraction_type: 'explicit' } });
  });

  it('CONTRAST (no default 0): without the status quo\'s "adds no specialist", the goal keeps no level and readiness still asks', async () => {
    const g = await registered(withoutStatusQuoZero());
    expect(node(g, 'weekly_support_capacity').observed_state).toBeUndefined();
    expect(asksForToday(g)).toBe(true);
    // The factor's own 80 is still the user's: it never depended on the zero.
    expect(node(g, 'existing_team_support_capacity').observed_state).toMatchObject({ source: 'brief_extraction', extractionType: 'explicit' });
  });

  it('CONTRAST: a status quo that sets the factor to another figure gives no explicit zero', async () => {
    const quoSets = { ...RAW, options: RAW.options.map((o: Rec) => (o.is_status_quo === true
      ? { ...o, interventions: [{ factor_label: 'Additional specialists', value: 1, value_kind: 'absolute', unit: 'specialists', provenance: 'explicit' }] } : o)) };
    const g = await registered(quoSets);
    expect(node(g, 'weekly_support_capacity').observed_state).toBeUndefined();
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
  });

  it('SECOND BRIEF (Paul\'s legacy c1494f4d, served labels): "six mid-weight developers" binds 6 to "Mid-weight developers"', () => {
    const stmt = (label: string, quote: string, value: number, unit: string): Rec => ({ quote, subject: { kind: 'factor', label, to_label: null, factor_label: null },
      field: 'level', form: 'point', value, low: null, high: null, unit, qualifier: null, conditions: null });
    const devs = LEGACY.draft.factors.find((f: Rec) => f.label === 'Mid-weight developers');
    const devQuote = devs.baseline_evidence.quote;
    expect(statementBindsFactorLevel({ ...LEGACY.draft, statements: [stmt(devs.label, devQuote, 6, 'developers')] } as never, devs, LEGACY.brief)).toBe(true);
    // CONTRAST, same brief: "25% of THEIR time" does not write the factor's frame ("% of development time"), so the frame test
    // (2) holds it unknown, retained, however the drafter labels it: the rule never binds by the label alone.
    const legacy = LEGACY.draft.factors.find((f: Rec) => f.label === 'Time on legacy fixes');
    const legacyQuote = legacy.baseline_evidence.quote;
    expect(statementBindsFactorLevel({ ...LEGACY.draft, statements: [stmt(legacy.label, legacyQuote, 25, '% of development time')] } as never, legacy, LEGACY.brief)).toBe(false);
  });
});
