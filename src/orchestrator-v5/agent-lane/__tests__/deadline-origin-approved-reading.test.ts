/**
 * ⭐ S7 B2 — APPROVAL IS NOT AUTHORSHIP, FOR THE DEADLINE TOO (hiring e2e c1e944a4/2c43f563, judge item 6). The card offered
 * "Is your deadline 15 January 2027 (3 months from 15 October 2026)?" as Olumi's interpretation of "three months"; the user
 * approved it; a later reply listed "a 15 January 2027 deadline" under "What you supplied". The AI's goal now carries WHO set
 * the date (`deadline_set_by`: Olumi's reading of the user's words, approved by the user), through the real get_canonical_state,
 * on the served hiring read after the press and on a second served brief (marketing 7f5659fd, "six months").
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { approvedDeadlineReadingOf } from '../../goal-target/goal-horizon-write.js';
import { HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';

type Rec = Record<string, any>;
const ctx = { scenario_id: '11111111-1111-1111-1111-111111111111', authenticated_user_id: 'user-a', request_id: 'req-1' };
const HIRING = (JSON.parse(readFileSync('tests/fixtures/deadline-origin/served-hiring-c1e944a4-after-deadline-approve.json', 'utf8')) as Rec).body as Rec;
const MARKETING = JSON.parse(readFileSync('tests/fixtures/reply-face-p2/legacy-7f5659fd-reopen.json', 'utf8')) as Rec;
const FUNDING = JSON.parse(readFileSync('tests/fixtures/c1/served-funding-run3-20261014.json', 'utf8')) as Rec;

const goalsSeen = async (body: Rec): Promise<Rec[]> => {
  const caps = createAgentCapabilities((async () => ({ status: 200, json: structuredClone(body) })) as never, new ProposalStore());
  const r = (await dispatchTool('get_canonical_state', '{}', ctx, caps)) as Rec;
  expect(r.ok).toBe(true);
  return [...(r.goal !== undefined ? [r.goal] : []), ...(r.goals ?? [])] as Rec[];
};

describe('S7 B2: the AI is told a deadline it approved is Olumi’s reading of the user’s words', () => {
  it('hiring (e2e turn 05’s state): 15 January 2027, read from "three months" counted from 15 October 2026, approved by the user', async () => {
    const goal = (await goalsSeen(HIRING)).find((g) => g.id === 'productivity')!;
    expect(goal.deadline).toBe('15 January 2027');
    expect(goal.deadline_set_by).toEqual({ origin: 'olumi_reading', approved_by_user: true, from_words: 'three months', months: 3,
      counted_from: '15 October 2026' });
    // By identity: the AI's fact IS the reader's answer on the same served graph.
    expect(goal.deadline_set_by).toEqual(approvedDeadlineReadingOf(HIRING.graph, 'productivity'));
  });

  it('marketing 7f5659fd (a second brief): 14 April 2027 from "six months", approved', async () => {
    const goal = (await goalsSeen(MARKETING)).find((g) => g.id === 'event_goal')!;
    expect(goal.deadline_set_by).toEqual({ origin: 'olumi_reading', approved_by_user: true, from_words: 'six months', months: 6,
      counted_from: '14 October 2026' });
  });

  it('funding run 3: the held words ("12 months") do not read to the approved date, so no words are quoted as the source', () => {
    expect(approvedDeadlineReadingOf(FUNDING.graph, 'development_speed')).toEqual({ origin: 'olumi_reading', approved_by_user: true,
      months: 6, counted_from: '14 October 2026' });
  });

  it('CONTRAST: a deadline held with no stated month count (a calendar date) carries no reading; no deadline carries nothing', async () => {
    const calendar = structuredClone(HIRING);
    delete calendar.graph.nodes.find((n: Rec) => n.id === 'productivity').goal_horizon_stated_months;
    const goal = (await goalsSeen(calendar)).find((g) => g.id === 'productivity')!;
    expect(goal.deadline).toBe('15 January 2027');
    expect(goal).not.toHaveProperty('deadline_set_by');
    const none = structuredClone(HIRING);
    delete none.graph.nodes.find((n: Rec) => n.id === 'productivity').goal_horizon;
    expect((await goalsSeen(none)).find((g) => g.id === 'productivity')).not.toHaveProperty('deadline_set_by');
  });

  // ⭐ Hiring e2e 62e94f27 turn 05 (DL 08:03Z): the fact reached the AI (above) and the reply still put "a 15 January deadline"
  // under "What you supplied". The instructions the AI reads now say what the fact means, naming the SAME keys the state carries.
  it('the instructions say an approved Olumi reading is never a date the user supplied, by the same keys the state carries', async () => {
    const rule = 'A goal\u2019s deadline_set_by olumi_reading means Olumi read that date from the user\u2019s words (from_words) and the user approved it: say it that way, never as a date the user supplied.';
    expect(HOST_TOOL_CONTRACT.split(rule)).toHaveLength(2);
    const goal = (await goalsSeen(HIRING)).find((g) => g.id === 'productivity')!;
    expect(Object.keys(goal)).toContain('deadline_set_by');
    expect(goal.deadline_set_by.origin).toBe('olumi_reading');
    expect(goal.deadline_set_by).toHaveProperty('from_words', 'three months');
  });
});
