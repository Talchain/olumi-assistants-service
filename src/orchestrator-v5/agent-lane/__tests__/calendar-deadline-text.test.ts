/**
 * ⭐ GEN D4 ITEM B (DL 14 Oct; the AIE's text, packet fc17c200): A CALENDAR DEADLINE IS
 * NOT A MONTH COUNT. T5-integrated (staging 14b1e544) D4, both runs: "…by the end of that quarter" was drafted as
 * horizon_months 3 and basis.period_months 3, a count that needs today's date and a fiscal calendar to be true.
 *
 * ⛔ SHIPS ONLY WITH HIRING's calendar-point admission pair: `horizon-attestation.ts` CALENDAR_POINT misses "that quarter",
 * so on this brief a null horizon would leave no deadline question at all (attestHorizon returns `absent`, probe at
 * 14b1e544). The combined candidate adds the row that the brief's words are asked.
 *
 * The text is bound by identity (`tests/fixtures/calendar-deadline-text/calendar-deadline-text.json`); the corpus is
 * T5-integrated D4 r2's registered brief and recorded drafter answer (`_source`), through the real `buildModelFromBrief`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const TEXT = (JSON.parse(readFileSync('tests/fixtures/calendar-deadline-text/calendar-deadline-text.json', 'utf8')) as { calendar_deadline: string }).calendar_deadline;
const D4 = JSON.parse(readFileSync('tests/fixtures/calendar-deadline-text/t5-integrated-d4-r2.json', 'utf8')) as { brief: string; text: string };
const ANCHOR = 'A deadline or period label alone does not establish the timing basis.';
const sid = '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e';

async function firstRequest(): Promise<Rec> {
  let sent: Rec | undefined;
  await buildModelFromBrief(sid, D4.brief, (async (path: string) => {
    if (path.endsWith('/graph/register')) return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async (req: Rec) => { sent ??= structuredClone(req); return { text: D4.text, status: 'completed' }; }) as never);
  if (sent === undefined) throw new Error('the drafter was never called');
  return sent;
}

describe('GEN D4 item B: a calendar deadline is not drafted as a month count', () => {
  it('PRECONDITION: the brief\'s deadline is a calendar point, and the recorded answer drafted it as 3 months', () => {
    expect(D4.brief).toContain('by the end of that quarter');
    const goal = (JSON.parse(D4.text) as { goal: Rec }).goal;
    expect([goal.horizon_months, goal.basis.period_months]).toEqual([3, 3]);
  });

  it('RED: the SENT instructions carry the text directly after the timing-basis rule', async () => {
    const instructions = (await firstRequest()).instructions as string;
    const at = instructions.indexOf(ANCHOR);
    expect(at, 'contrast: the TARGET SEMANTICS rule is sent').toBeGreaterThan(-1);
    expect(instructions.indexOf(TEXT)).toBe(at + ANCHOR.length + 1);
  });
});
