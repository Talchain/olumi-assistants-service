/**
 * ⭐ S4 NET LOSS (DL 15 Oct 06:43Z; unseen brief R4 blocked every Run): a brief that states a net monthly LOSS had it admitted as
 * Olumi's unverified guess (`cee_inference`, `user_material_unverified`), because the one statement verifier read only the
 * magnitude ("15") and refused the drafter's −15 as no figure of the quote. Rows: real drafter raws for two briefs PROMPT wrote
 * (never R4's), through the real `buildModelFromBrief`. A figure written straight after a loss direction is also stated as its
 * negative; without such words a negative stays refused.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { userStatementsOn } from '../../statement-door/statements.js';
import { withDeclaredStance } from './helpers/declared-stance.js';

type Rec = Record<string, any>;
type Case = { brief: string; call1_text: string; call2_text: string; _source: Rec };
const GYM = JSON.parse(readFileSync('tests/fixtures/sys2/s4-net-loss-gym.json', 'utf8')) as Case;
const CAFE = JSON.parse(readFileSync('tests/fixtures/sys2/s4-net-loss-cafe.json', 'utf8')) as Case;
const AT = '2026-10-15T07:00:00.000Z';
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(AT)); });
afterEach(() => { vi.useRealTimers(); });

async function registered(c: Case, edit: (raw: Rec) => Rec = (r) => r, brief = c.brief): Promise<Rec> {
  let graph: Rec | undefined;
  // INPUT CHANGE (stance, AIE 543db8bb): the served drafts predate the field; each statement gets the stance its sentence states.
  const answers = [c.call1_text, c.call2_text].map((t) => JSON.stringify(edit(withDeclaredStance(JSON.parse(t)))));
  let call = 0;
  const result = await buildModelFromBrief('6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c', brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: answers[Math.min(call++, answers.length - 1)]!, status: 'completed' })) as never) as Rec;
  if (result.ok !== true || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return graph;
}
const node = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((n) => n.label === label)!;
const levels = (n: Rec): [string, number | undefined][] => userStatementsOn(n).filter((r) => r.field === 'level')
  .flatMap((r) => r.statements.map((s) => [s.quote, s.low] as [string, number | undefined]));
const LOSS = "Our community gym has 320 members, and we're losing a net 15 members a month at the moment.";

describe('S4: a stated net loss is the user\'s own figure, read as its negative', () => {
  it('PRECONDITION (as captured on 87d5f90e): the gym\'s −15 was admitted as Olumi\'s unverified guess', () => {
    expect(GYM._source.registered_as_captured.net_monthly_member_change_observed_state)
      .toMatchObject({ value: -15, source: 'cee_inference', extractionType: 'inferred', user_material_unverified: true });
    expect(CAFE._source.registered_as_captured.goal_user_statements_fields).toEqual([]);
  });

  it('GYM: "losing a net 15 members a month" is the user\'s −15, recorded on its factor', async () => {
    const n = node(await registered(GYM), 'Net monthly member change');
    expect(n.observed_state).toMatchObject({ raw_value: -15, source: 'brief_extraction', extractionType: 'explicit' });
    expect(n.observed_state.user_material_unverified).toBeUndefined();
    expect(levels(n)).toEqual([[LOSS, -15]]);
  });

  it('CAFE: "losing a net £2,000 a month" is recorded on the goal as the user\'s level, −2000', async () => {
    const goal = (await registered(CAFE)).nodes.find((n: Rec) => n.kind === 'goal');
    expect(levels(goal)).toEqual([["Right now we're losing a net £2,000 a month after all costs.", -2000]]);
  });

  it('CONTROL: the opposite direction ("gaining a net 15") never verifies −15; it stays retained, unverified', async () => {
    const gaining = LOSS.replace('losing', 'gaining');
    const edit = (r: Rec): Rec => ({ ...r, statements: r.statements.map((s: Rec) => (s.quote === LOSS ? { ...s, quote: gaining } : s)) });
    const n = node(await registered(GYM, edit, GYM.brief.replace(LOSS, gaining)), 'Net monthly member change');
    expect(levels(n)).toEqual([]);
    expect(n.observed_state).toMatchObject({ raw_value: -15, source: 'cee_inference', user_material_unverified: true });
  });

  const GROSS = "Our community gym has 320 members, and we lose 15 members a month at the moment.";
  const asGross = (r: Rec): Rec => ({ ...r, statements: r.statements.map((s: Rec) => (s.quote === LOSS ? { ...s, quote: GROSS } : s)) });
  it('AIE 6187351293: a GROSS loss ("we lose 15 members a month") never verifies −15 for a net change; it stays retained, unverified', async () => {
    const n = node(await registered(GYM, asGross, GYM.brief.replace(LOSS, GROSS)), 'Net monthly member change');
    expect(levels(n)).toEqual([]);
    expect(n.observed_state).toMatchObject({ raw_value: -15, source: 'cee_inference', user_material_unverified: true });
  });

  it('CONTRAST: the same gross words keep their count: "Members lost per month" at 15 is the user\'s 15', async () => {
    const asCount = (r: Rec): Rec => asGross({
      ...r,
      factors: r.factors.map((f: Rec) => (f.label === 'Net monthly member change' ? { ...f, label: 'Members lost per month', baseline_value: 15 } : f)),
      links: r.links.map((l: Rec) => ({ ...l, from: l.from === 'Net monthly member change' ? 'Members lost per month' : l.from,
        to: l.to === 'Net monthly member change' ? 'Members lost per month' : l.to })),
      statements: r.statements.map((s: Rec) => (s.subject.label === 'Net monthly member change'
        ? { ...s, subject: { ...s.subject, label: 'Members lost per month' }, value: 15 } : s)),
    });
    const n = node(await registered(GYM, asCount, GYM.brief.replace(LOSS, GROSS)), 'Members lost per month');
    expect(levels(n)).toEqual([[GROSS, 15]]);
  });

  it('CONTROL: a count of losses keeps its magnitude: "Members lost per month" at 15 is still the user\'s 15', async () => {
    const asCount = (r: Rec): Rec => ({
      ...r,
      factors: r.factors.map((f: Rec) => (f.label === 'Net monthly member change' ? { ...f, label: 'Members lost per month', baseline_value: 15 } : f)),
      links: r.links.map((l: Rec) => ({ ...l, from: l.from === 'Net monthly member change' ? 'Members lost per month' : l.from,
        to: l.to === 'Net monthly member change' ? 'Members lost per month' : l.to })),
      statements: r.statements.map((s: Rec) => (s.subject.label === 'Net monthly member change'
        ? { ...s, subject: { ...s.subject, label: 'Members lost per month' }, value: 15 } : s)),
    });
    const n = node(await registered(GYM, asCount), 'Members lost per month');
    expect(levels(n)).toEqual([[LOSS, 15]]);
  });
});
