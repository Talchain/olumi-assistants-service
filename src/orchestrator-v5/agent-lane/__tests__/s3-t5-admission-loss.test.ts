/**
 * ⛔ S3 T5 ADMISSION LOSSES (recovery Batch B, DL 12 Oct 2026): what the drafter produced is lost between its answer and
 * the saved model. Both T5 arms (served A′ c85817f2 and C) show them, so they are live defects.
 *
 * L1 (wrong period): D2's brief says "…during the first three months after launch. We plan to launch six months from
 *    today." The drafter typed the goal's horizon as 6; the saved goal held `goal_deadline_as_stated: "three months"`
 *    (3/3 saved models) and the reply asked "within 3 months". `attestHorizon` took the FIRST number-word span in the
 *    brief, whatever the candidate claimed.
 * L2 (meaning loss): D3's drafter produced today's MRR as £8,000 (400 customers × £20; the brief never writes £8,000)
 *    with a valid change basis; the saved goal held no `observed_state` (3/3 where the drafter produced it). Admission
 *    refused it because the drafter typed it `explicit`: only an `ai_proposed` base reached Batch C's `estimate_only`.
 *    C's rule is "human only by positive attestation", so an unattested base is Olumi's, never dropped.
 *
 * Every row drives the REAL `buildModelFromBrief` with the EXACT T5 raw responses (`fixtures/s3-t5-admission-loss-20261012.json`,
 * copied with their sha256; never authored). The model call is faked, nothing is sent.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Rec = Record<string, unknown>;
interface Episode {
  readonly episode: string;
  readonly brief: string;
  readonly calls: readonly { readonly raw: string; readonly status: string; readonly text: string }[];
  readonly t5_saved_goal: Rec;
}
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/s3-t5-admission-loss-20261012.json', import.meta.url), 'utf8')) as {
  episodes: Record<string, Episode>;
};
const ep = (key: string): Episode => FIXTURE.episodes[key]!;
const rawGoal = (e: Episode): Rec => (JSON.parse(e.calls[0]!.text) as { goal: Rec }).goal;
const SCENARIO = '73737373-7373-4737-8737-737373737373';

/** One build: the raw answers in the order T5 received them; a request past them fails the row (nothing is invented). */
async function build(e: Episode): Promise<{ result: Rec; goal: Rec; questions: string[] }> {
  let stored: Rec | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)) as Rec;
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  let next = 0;
  const call: CallStructuredModel = async () => {
    const c = e.calls[next++];
    if (c === undefined) throw new Error(`${e.episode}: a call T5 never answered`);
    return { text: c.text, status: c.status };
  };
  const result = await buildModelFromBrief(SCENARIO, e.brief, dispatch, call, undefined, undefined, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  expect(next, 'every T5 answer kept for this build is consumed').toBe(e.calls.length);
  const goals = ((stored?.nodes ?? []) as Rec[]).filter((n) => n.kind === 'goal');
  expect(goals).toHaveLength(1);
  return { result, goal: goals[0]!, questions: (result.open_questions ?? []) as string[] };
}

describe('L1: the drafter\'s horizon picks the brief\'s own span (D2: six months, never "three months")', () => {
  it('PRECONDITION: the raw answers say 6 months, and the brief writes "three months" before "six months"', () => {
    for (const key of ['D2_r1', 'D2_r2']) {
      expect(rawGoal(ep(key)).horizon_months, key).toBe(6);
      expect(ep(key).t5_saved_goal.goal_deadline_as_stated, `${key}: T5 saved it`).toBe('three months');
    }
    const brief = ep('D2_r1').brief;
    expect(brief.indexOf('three months')).toBeGreaterThan(-1);
    expect(brief.indexOf('three months')).toBeLessThan(brief.indexOf('six months'));
  });

  it.each(['D2_r1', 'D2_r2'])('⭐ RED %s: the saved goal holds "six months", the count is not held silently, and no "within 3 months" is asked', async (key) => {
    const { goal, questions } = await build(ep(key));
    expect(goal.goal_deadline_as_stated).toBe('six months');
    expect(Object.hasOwn(goal, 'goal_horizon_months'), 'a number-word count is proposed, never held silently').toBe(false);
    expect(questions.some((q) => /within 3 months/.test(q)), JSON.stringify(questions)).toBe(false);
    expect(questions).toContain('Does "Feature launch" get there within 6 months? The model holds no deadline yet, so no result answers that.');
  });

  it.each([['D3_r1', 'three months'], ['D3_r2', 'three months'], ['D5_r1', 'two months']])(
    'CONTRAST %s: a brief whose stated horizon really is %s keeps it', async (key, words) => {
      expect(ep(key).t5_saved_goal.goal_deadline_as_stated, 'PRECONDITION: T5 saved it').toBe(words);
      const { goal } = await build(ep(key));
      expect(goal.goal_deadline_as_stated).toBe(words);
      expect(Object.hasOwn(goal, 'goal_horizon_months')).toBe(false);
    },
  );
});
