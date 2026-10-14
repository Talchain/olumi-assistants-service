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
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { goalLevelTheUserWrote } from '../stated-by-user.js';
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

describe('GEN #3: the user\'s level for a goal with no target is asked, never dropped silently (D6: "about 80 features per week")', () => {
  const D6 = (JSON.parse(readFileSync(new URL('./fixtures/s3-t5-d6-raw-20261012.json', import.meta.url), 'utf8')) as {
    episodes: Record<string, Episode>;
  }).episodes.D6_r1!;
  /** The user's own sentence, verbatim from the brief (the attestation's span, widened to its sentence). */
  const QUOTE = 'Our team currently completes about 80 features per week';
  const ASK = `Your brief says “${QUOTE}”, but with no target the model holds no level for ‘Features completed per week’. `
    + 'What level would count as success, and by when?';

  it('PRECONDITION: the raw draft gives 80 as today\'s level with no target, and T5 saved no level and asked nothing', () => {
    expect(rawGoal(D6)).toMatchObject({ value: null, target_stated: false, baseline_known: true, baseline_value: 80 });
    expect(D6.t5_saved_goal).toMatchObject({ goal_threshold_raw: null, observed_state: null });
  });

  it('⭐ RED→GREEN: the build asks ONE question quoting the user\'s 80, and the goal still holds no figure', async () => {
    const { goal, questions } = await build(D6);
    expect(questions).toContain(ASK);
    expect(questions.filter((q) => q === ASK)).toHaveLength(1);
    // No figure in the model: no level, no threshold (a level with no scale would be renormalised by a guess later).
    expect(goal.observed_state ?? null).toBeNull();
    expect(goal.goal_threshold_raw ?? null).toBeNull();
  });

  it('the ledger keeps what the user said — value, unit and their sentence — and invents no cap or threshold (real admission)', () => {
    const candidate = JSON.parse(D6.calls[0]!.text) as CandidateModel;
    const admitted = admitCandidateModel(candidate, {}, D6.brief, goalLevelTheUserWrote(candidate, D6.brief));
    const entries = admitted.loss.filter((l) => /\.observed_state\.magnitude_question$/.test(l.field_path));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ before: { value: 80, unit: 'features per week', quote: QUOTE }, after: null, reason: ASK, severity: 'warn' });
    expect(D6.brief).toContain(QUOTE);
    const goal = admitted.nodes.find((n) => n.kind === 'goal') as unknown as Rec;
    expect(goal.goal_threshold_cap ?? null).toBeNull();
    expect(goal.goal_threshold ?? null).toBeNull();
  });

  it('CONTRAST: a level the brief does not write (the drafter\'s own 80) is not quoted as the user\'s, and nothing is asked', async () => {
    const e: Episode = { ...D6, brief: D6.brief.replace('Our team currently completes about 80 features per week. ', '') };
    const { questions } = await build(e);
    expect(questions.some((q) => q.startsWith('Your brief says') || q.startsWith('Your brief puts'))).toBe(false);
  });
});

describe('GEN #2 by entity: a drafter question is left out only when it is ABOUT a link Olumi set aside (D3 r2 raw + `unknown_concerns`)', () => {
  const RAW = ep('D3_noBase_r2');
  const raw = (): { unknowns: string[]; [k: string]: unknown } => JSON.parse(RAW.calls[0]!.text);
  const [MRR, , CHURN] = raw().unknowns;
  const ASIDE_LINK = 'Price per paying customer per month → Customer loss after price rise';
  const ASIDE_Q = 'Is the provisional estimate of 60 customers lost per £2 rise right?';
  const ASIDE_NO_FIGURE = 'How sure are we that the price rise drives customer loss?';
  // The #3000 Codex check's own over-deletions: a figure equal to Olumi's withheld 60, about something else.
  const CHURN_60 = 'Is 60% churn over a year plausible for this customer base?';
  const SUPPORT_60 = 'Would a £60 support add-on change anything?';
  const NEW_60 = 'Could we win 60 new customers in the first month?';
  /** The raw answer with the drafter's questions and what each is about added, in the shape PROMPT's constructor text asks. */
  const withConcerns = (extra: readonly string[], tags: Record<string, readonly string[]>): Episode => {
    const r = raw();
    r.unknowns = [...r.unknowns, ...extra];
    r.unknown_concerns = Object.entries(tags).map(([question, concerns]) => ({ question, concerns }));
    return { ...RAW, calls: [{ ...RAW.calls[0]!, text: JSON.stringify(r) }, ...RAW.calls.slice(1)] };
  };

  it('⭐ the set-aside link\'s questions are left out, figure or not; every other question is asked, whatever figures it writes', async () => {
    const { result, questions } = await build(withConcerns([ASIDE_Q, ASIDE_NO_FIGURE, CHURN_60, SUPPORT_60, NEW_60], {
      [MRR!]: ['monthly recurring revenue'],
      [CHURN!]: ['Customer loss after price rise'],
      [ASIDE_Q]: [ASIDE_LINK],
      [ASIDE_NO_FIGURE]: [ASIDE_LINK],
      [CHURN_60]: ['Monthly customer churn'],
      [SUPPORT_60]: [],
    }));
    // PRECONDITION: Olumi set that link aside on this build (and two others).
    expect(((result.set_aside_estimates ?? []) as Rec[]).map((s) => `${s.from}\u0000${s.to}`))
      .toContain('price_per_paying_customer_per_month\u0000customer_loss_after_price_rise');
    expect(questions).not.toContain(ASIDE_Q);
    expect(questions).not.toContain(ASIDE_NO_FIGURE);
    for (const q of [MRR!, CHURN!, CHURN_60, SUPPORT_60, NEW_60]) expect(questions, q).toContain(q);
  });

  it('a concern naming no node by its exact label is not about the set-aside link: the question is asked', async () => {
    const { questions } = await build(withConcerns([ASIDE_Q], { [ASIDE_Q]: ['Price → Loss'] }));
    expect(questions).toContain(ASIDE_Q);
  });

  it('CONTRAST: a draft without `unknown_concerns` keeps staging\'s rule until its producer is live (the churn question writes 20)', async () => {
    const { questions } = await build(RAW);
    expect(questions).not.toContain(CHURN);
  });
});
