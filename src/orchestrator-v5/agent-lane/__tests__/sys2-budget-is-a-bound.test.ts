/**
 * ⭐ DL 15 Oct (marketing e2e on c1e944a4, S4): "Our budget for the year is £100,000." was saved as a statement of TODAY'S LEVEL
 * of `Total annual campaign spend` (field level, point 100000). A budget is a ceiling on spend, and the same draft says so: it
 * declares the limit `Total annual campaign spend <= 100000`. A point level statement of a subject whose draft-declared limit
 * has that exact figure is now that limit's bound (`draftStatements`): recorded as the level's upper bound, never as the current
 * level. The role is the draft's own declared limit, never a word list. Rows: the served marketing raw (md5 = the DB's) through
 * the real build, and D3r1's "We have £1,000 available for one-off research." Controls: no limit, or another figure, stays a point.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { draftStatements } from '../construction-source-map.js';
import { userStatementsOn } from '../../statement-door/statements.js';

type Rec = Record<string, any>;
const MARKETING = JSON.parse(readFileSync('tests/fixtures/sys2/served-marketing-5f56d086.json', 'utf8')) as { brief: string; raw_text: string };
const D3 = JSON.parse(readFileSync('tests/fixtures/sys2/pre-h0h1-d3r1.json', 'utf8')) as { brief: string; call1_text: string; call2_text: string };
const CAPACITY = JSON.parse(readFileSync('tests/fixtures/sys2/served-capacity-e4ff6039.json', 'utf8')) as { brief: string; raw_text: string };
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-15T06:01:00.000Z')); });
afterEach(() => { vi.useRealTimers(); });

async function registered(brief: string, answers: string[]): Promise<Rec> {
  let graph: Rec | undefined; let call = 0;
  const result = await buildModelFromBrief('9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f', brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: answers[Math.min(call++, answers.length - 1)]!, status: 'completed' })) as never) as Rec;
  if (result.ok !== true || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return graph;
}
const recorded = (g: Rec, label: string): [string, string, number | undefined, number | undefined][] => userStatementsOn((g.nodes as Rec[]).find((n) => n.label === label))
  .flatMap((r) => r.statements.map((s): [string, string, number | undefined, number | undefined] => [r.field, s.form, s.low, s.high]));
const formOf = (raw: Rec, quote: string): unknown => (draftStatements(raw) as Rec[]).find((s) => s.quote === quote)?.form;

describe('a budget the draft declares as a limit is its bound, never today\'s level (DL 15 Oct, marketing e2e)', () => {
  it('PRECONDITION (served 5f56d086): a point level on the spend, beside the draft\'s own limit of the same figure', () => {
    const raw = JSON.parse(MARKETING.raw_text) as Rec;
    expect(raw.statements[0]).toMatchObject({ quote: 'Our budget for the year is £100,000.', field: 'level', form: 'point', value: 100000,
      subject: { kind: 'factor', label: 'Total annual campaign spend' } });
    expect(raw.constraints).toContainEqual(expect.objectContaining({ metric: 'Total annual campaign spend', operator: '<=', value: 100000, role: 'limit' }));
  });

  it('RED (marketing, real build): the spend holds the budget as its UPPER BOUND, and no current level', async () => {
    const g = await registered(MARKETING.brief, [MARKETING.raw_text]);
    expect(recorded(g, 'Total annual campaign spend')).toEqual([['level', 'upper_bound', undefined, 100000]]);
  });

  it('D3r1 (second budget brief): "We have £1,000 available for one-off research." is the research spend\'s upper bound', async () => {
    const raw = JSON.parse(D3.call2_text) as Rec;
    expect(formOf(raw, 'We have £1,000 available for one-off research.')).toBe('upper_bound');
    const g = await registered(D3.brief, [D3.call1_text, D3.call2_text]);
    expect(recorded(g, 'One-off research spend')).toEqual([['level', 'upper_bound', undefined, 1000]]);
  });

  it('CONTROLS: a level with no declared limit stays a point (capacity\'s 80); a limit with another figure re-forms nothing', () => {
    const cap = JSON.parse(CAPACITY.raw_text) as Rec;
    expect(formOf(cap, 'Our existing team resolves 80 tickets per week.')).toBe('point');
    const raw = JSON.parse(MARKETING.raw_text) as Rec;
    const other = { ...raw, constraints: raw.constraints.map((c: Rec) => (c.metric === 'Total annual campaign spend' ? { ...c, value: 90000 } : c)) };
    expect(formOf(other, 'Our budget for the year is £100,000.')).toBe('point');
    const notLimit = { ...raw, constraints: raw.constraints.map((c: Rec) => (c.metric === 'Total annual campaign spend' ? { ...c, role: 'target' } : c)) };
    expect(formOf(notLimit, 'Our budget for the year is £100,000.')).toBe('point');
  });
});
