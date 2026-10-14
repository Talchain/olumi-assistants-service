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
import { attestHorizon } from '../horizon-attestation.js';
import servedBikeShare from '../../../../tests/fixtures/deadline-card-d2.json';

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

  it('CONTRAST (served bike-share brief, tests/fixtures/deadline-card-d2.json): no count claimed → the FIRST span stays, "ten months", never the later "month 3"', () => {
    const goal = (servedBikeShare.graph.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    expect(goal.goal_deadline_as_stated, 'PRECONDITION: what was served').toBe('ten months');
    expect(attestHorizon(servedBikeShare.brief, null)).toEqual({ months: null, proposed_months: 10, wording: 'ten months', status: 'unresolved' });
  });
});

describe('GEN #2: a question is never deleted for a figure the USER wrote that equals a size Olumi set aside (D3 A r2)', () => {
  const unknowns = (e: Episode): string[] => (JSON.parse(e.calls[0]!.text) as { unknowns: string[] }).unknowns;

  it('⭐ RED→GREEN: the interviews\' "10–20% churn" question and the "400 customers and £20 monthly price" question are asked', async () => {
    const e = ep('D3_noBase_r2');
    const [mrr, , churn] = unknowns(e);
    expect(churn).toContain('10–20% churn range');
    expect(mrr).toContain('400 customers and £20 monthly price');
    const { result, questions } = await build(e);
    // PRECONDITION: Olumi set aside sizes of 60, 400 and 20 on this build (the equal numbers that deleted them).
    expect(((result.set_aside_estimates ?? []) as Rec[]).map((s) => s.estimate)).toEqual(expect.arrayContaining([
      expect.stringContaining('by 400 £ per month'), expect.stringContaining('by 20 £ per month'), expect.stringContaining('by 60 customers')]));
    expect(questions).toContain(churn);
    expect(questions).toContain(mrr);
  });

  it('CONTRAST: a drafter question quoting Olumi\'s own set-aside figure (60, which the user never wrote) is still not shown', async () => {
    const e = structuredClone(ep('D3_noBase_r2'));
    const raw = JSON.parse(e.calls[0]!.text) as { unknowns: string[] };
    const olumis = 'Is the provisional estimate of 60 customers lost per £2 rise right?';
    raw.unknowns.push(olumis);
    e.calls[0]!.text = JSON.stringify(raw);
    const { questions } = await build(e);
    expect(questions).not.toContain(olumis);
    expect(questions).toContain(unknowns(ep('D3_noBase_r2'))[2]);
  });
});

describe('L2: a base the drafter produced is Olumi\'s unless the brief attests it — never dropped (D3: £8,000)', () => {
  it('PRECONDITION: the raw answers give today\'s MRR as 8000 with a basis; the brief never writes it; T5 saved none', () => {
    for (const key of ['D3_r1', 'D3_r2']) {
      const g = rawGoal(ep(key));
      expect([g.frame, g.baseline_known, g.baseline_value, g.baseline_provenance], key).toEqual(['change_rel', true, 8000, 'explicit']);
      expect(g.basis, key).not.toBeNull();
      expect(ep(key).t5_saved_goal.observed_state, `${key}: T5 saved none`).toBeNull();
      expect(ep(key).brief).not.toMatch(/8,?000|8k/i);
    }
  });

  it.each(['D3_r1', 'D3_r2'])('⭐ RED %s: the saved goal keeps £8,000 as OLUMI\'s starting value (estimate_only), never the user\'s', async (key) => {
    const { goal, result } = await build(ep(key));
    expect(goal.observed_state).toMatchObject({ raw_value: 8000, source: 'cee_inference' });
    expect(goal.goal_threshold, 'a relative change is scored on that base').toBe(0.15);
    expect(Object.hasOwn(goal, 'goal_level_reading'), 'not a reading of a brief figure').toBe(false);
    expect(Object.hasOwn(goal, 'goal_target_basis'), 'the drafted basis is kept').toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/held as today's level of/);
  });

  it('CONTRAST: a base the drafter did NOT produce stays absent and is never invented (A′ D3 r2)', async () => {
    const e = ep('D3_noBase_r2');
    expect([rawGoal(e).baseline_known, rawGoal(e).baseline_value], 'PRECONDITION').toEqual([false, null]);
    const { goal } = await build(e);
    expect(Object.hasOwn(goal, 'observed_state')).toBe(false);
    expect(Object.hasOwn(goal, 'goal_threshold')).toBe(false);
    expect(JSON.stringify(goal)).not.toMatch(/8000/);
  });

  it('CONTRAST: a base the brief states ("8 weeks") stays the user\'s (D4)', async () => {
    expect(ep('D4_r1').t5_saved_goal.observed_state, 'PRECONDITION: T5 saved it').toMatchObject({ raw_value: 8, source: 'brief_extraction' });
    const { goal } = await build(ep('D4_r1'));
    expect(goal.observed_state).toMatchObject({ raw_value: 8, source: 'brief_extraction' });
  });
});
