/**
 * ⭐ DL-3 14:21Z item 5 (G3 #4, a75de9cb): "by the end of June next year" was held as "by the end of June" (the calendar point
 * matched a month and an optional four-digit year only), so the year was lost and the deadline was asked again at T1. The year
 * the user writes after a month or quarter is part of the point, and the date reader places it against the reference date.
 * SYNTHETIC sentences (never the unseen brief).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attestHorizon } from '../../agent-lane/horizon-attestation.js';
import { buildModelFromBrief } from '../../agent-lane/runtime/build-model.js';
import { readStatedDeadline } from '../deadline-date.js';

const TODAY = '2026-10-16';
describe('a year written after a month or quarter stays with the deadline', () => {
  it('⭐ RED→GREEN: the attestation keeps "next year", and the date is that month of the reference year\u2019s next', () => {
    const brief = 'Our churn is 5% a month today. We want it below 3% by the end of March next year.';
    const attested = attestHorizon(brief, { horizon_months: null });
    expect(attested).toMatchObject({ status: 'unresolved', wording: 'by the end of March next year' });
    expect(readStatedDeadline(attested.wording, TODAY)).toMatchObject({ date: '2027-03-31', form: 'month_end' });
  });
  it('the same for a later month, a quarter and "this year"', () => {
    expect(readStatedDeadline('by the end of June next year', TODAY)).toMatchObject({ date: '2027-06-30' });
    expect(readStatedDeadline('by the end of Q2 next year', TODAY)).toMatchObject({ date: '2027-06-30' });
    expect(readStatedDeadline('by December this year', TODAY)).toMatchObject({ date: '2026-12-31' });
    expect(attestHorizon('Sales must double by Q3 next year.', { horizon_months: null })).toMatchObject({ wording: 'by Q3 next year' });
  });
  it('NEGATIVE: "this year" for a month that has passed is never rolled on to next year (the user is asked)', () => {
    expect(readStatedDeadline('by the end of March this year', TODAY)).toBeNull();
  });
  it('CONTROL: without a year, a passed month is next year\u2019s, and a written year wins, as before', () => {
    expect(readStatedDeadline('by the end of March', TODAY)).toMatchObject({ date: '2027-03-31' });
    expect(readStatedDeadline('by the end of March 2028', TODAY)).toMatchObject({ date: '2028-03-31' });
    expect(attestHorizon('We want it below 3% by the end of March 2028.', { horizon_months: null })).toMatchObject({ wording: 'by the end of March 2028' });
  });
});

type Rec = Record<string, any>;
describe('through the real build: the goal holds the deadline words with their year', () => {
  // The committed served G3 #2 draft (row d8522790): its verified target sentence is "I want to bring it down to 4% or lower by the
  // end of June next year." (already seen; not the unseen G3 #4 brief).
  const SCRAP = JSON.parse(readFileSync('src/routes/__tests__/fixtures/g3-unseen-1663fe34-first-draft.json', 'utf8')) as { brief_text: string; raw_text: string };
  it('⭐ RED→GREEN: goal_deadline_as_stated is "by the end of June next year", never the month alone', async () => {
    let graph: Rec | undefined;
    const result = await buildModelFromBrief('6e6e6e6e-6e6e-4e6e-8e6e-6e6e6e6e6e6e', SCRAP.brief_text, (async (path: string, body: Rec) => {
      if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
    }) as never, (async () => ({ text: SCRAP.raw_text, status: 'completed' })) as never) as Rec;
    expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
    const goal = (graph!.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    expect(goal.goal_deadline_as_stated).toBe('by the end of June next year');
    expect(readStatedDeadline(goal.goal_deadline_as_stated, TODAY)).toMatchObject({ date: '2027-06-30' });
  });
});
