/**
 * ⭐ A PERIOD IS THE GOAL'S DEADLINE ONLY WHERE IT GOVERNS THE GOAL'S ACHIEVEMENT (AIE #94 6184383302; #3208, AIE 6183705670, was
 * the containment). In the v2 GEN pre-H0/H1 raws (head c515cfcb), D5r1's drafter claimed no deadline and stated "We have two months
 * to learn, and are not choosing a final strategy today." as a goal MEASURE (never its target), in both arms; admission saved
 * `goal_deadline_as_stated: "two months"`. A learning window is not a deadline for achieving customer trust, whether the drafter
 * files it in unknowns or not, and whatever the goal's quote holds. The role comes from the one statement contract: with no claim,
 * only a span inside the goal's own verified `target` statement is its deadline; anything else keeps its words and asks the reading.
 *
 * Every row drives the REAL `buildModelFromBrief` with the EXACT raw responses (`fixtures/v2-unknowns-deadline-20261015.json`,
 * copied with their sha256; never authored). The model call is faked, nothing is sent.
 * Brief 1: D5 (collaborative exploration), arms A and C: the negatives. Brief 2: D3 (pricing), arm A: the supported positive.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { isDraftWideningRequest } from '../runtime/widen-draft.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { attestHorizon } from '../horizon-attestation.js';

type Rec = Record<string, unknown>;
interface Episode {
  readonly arm: string;
  readonly brief: string;
  readonly calls: readonly { readonly raw: string; readonly raw_sha256: string; readonly status: string; readonly text: string }[];
  readonly saved_goal_deadline_as_stated: string | null;
}
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/v2-unknowns-deadline-20261015.json', import.meta.url), 'utf8')) as {
  episodes: Record<string, Episode>;
};
const ep = (key: string): Episode => FIXTURE.episodes[key]!;
const draft = (e: Episode, i = 0): Rec => JSON.parse(e.calls[i]!.text) as Rec;
const SCENARIO = '74747474-7474-4747-8747-747474747474';
const LEARNING = 'We have two months to learn, and are not choosing a final strategy today.';
const D3_GOAL = 'We want monthly recurring revenue to rise by at least 15% within three months.';
const UNBOUND = 'Is "two months" the period by which "customer trust" should be achieved? Your brief does not say, so the model holds no deadline for it.';

/** One build: the raw answers in the order the run received them, optionally rewritten; a request past them fails the row. */
async function build(e: Episode, edit: (d: Rec) => Rec = (d) => d): Promise<{ goal: Rec; questions: string[] }> {
  let stored: Rec | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)) as Rec;
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  let next = 0;
  const call: CallStructuredModel = async (req) => {
    if (isDraftWideningRequest(req)) throw new Error('no widening answer recorded');
    const c = e.calls[next++];
    if (c === undefined) throw new Error('a call the run never answered');
    return { text: JSON.stringify(edit(JSON.parse(c.text) as Rec)), status: c.status };
  };
  const result = await buildModelFromBrief(SCENARIO, e.brief, dispatch, call, undefined, undefined, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  expect(next, 'every recorded answer is consumed').toBe(e.calls.length);
  const goals = ((stored?.nodes ?? []) as Rec[]).filter((n) => n.kind === 'goal');
  expect(goals).toHaveLength(1);
  return { goal: goals[0]!, questions: (result.open_questions ?? []) as string[] };
}

describe('brief 1 (D5): a statement the drafter filed as an unknown is never the goal\'s deadline', () => {
  it.each(['D5_r1_A', 'D5_r1_C'])('PRECONDITION %s: no deadline claimed, the learning statement filed whole in unknowns, and the run saved "two months"', (key) => {
    const e = ep(key);
    for (let i = 0; i < e.calls.length; i += 1) {
      const d = draft(e, i);
      const goal = d.goal as Rec;
      expect([goal.horizon_months, goal.deadline_words ?? null], `${key} call ${i + 1}`).toEqual([null, null]);
      expect(d.unknowns as string[], `${key} call ${i + 1}`).toContain(LEARNING);
      // Stated about the goal as a MEASURE (a learning window), never as its target: the contract's role, not a keyword.
      expect((d.statements as Rec[]).filter((st) => st.quote === LEARNING).map((st) => [(st.subject as Rec).kind, st.field]), `${key} call ${i + 1}`)
        .toEqual([['goal', 'measure']]);
      expect((d.statements as Rec[]).some((st) => st.field === 'target'), `${key} call ${i + 1}`).toBe(false);
    }
    expect(e.brief).toContain(LEARNING);
    expect(e.saved_goal_deadline_as_stated).toBe('two months');
  });

  it.each(['D5_r1_A', 'D5_r1_C'])('⭐ RED %s: the saved goal holds no deadline, and no deadline question is asked about "two months"', async (key) => {
    const { goal, questions } = await build(ep(key));
    expect(Object.hasOwn(goal, 'goal_deadline_as_stated'), JSON.stringify(goal.goal_deadline_as_stated)).toBe(false);
    expect(Object.hasOwn(goal, 'goal_horizon_months')).toBe(false);
    expect(questions.some((q) => /deadline your brief sets/.test(q)), JSON.stringify(questions)).toBe(false);
    // The words are kept, with the exact missing reading (never silently dropped).
    expect(questions).toContain(UNBOUND);
  });

  it.each(['D5_r1_A_corrected', 'D5_r1_C_corrected'])('PRECONDITION %s (corrected v2 run, c1e944a4, #3208 in): the learning statement is a goal measure, NOT filed in unknowns, and the run still saved "two months"', (key) => {
    const e = ep(key);
    for (let i = 0; i < e.calls.length; i += 1) {
      const d = draft(e, i);
      expect([(d.goal as Rec).horizon_months, (d.goal as Rec).deadline_words ?? null], `${key} call ${i + 1}`).toEqual([null, null]);
      expect(d.unknowns as string[], `${key} call ${i + 1}`).not.toContain(LEARNING);
      expect((d.statements as Rec[]).filter((st) => st.quote === LEARNING).map((st) => [(st.subject as Rec).kind, st.field]), `${key} call ${i + 1}`)
        .toEqual([['goal', 'measure']]);
      expect((d.statements as Rec[]).some((st) => st.field === 'target'), `${key} call ${i + 1}`).toBe(false);
    }
    expect(e.saved_goal_deadline_as_stated).toBe('two months');
  });

  it.each(['D5_r1_A_corrected', 'D5_r1_C_corrected'])('⭐ RED %s (the residual #3208 could not contain): no deadline is held; the words and the missing reading are asked', async (key) => {
    const { goal, questions } = await build(ep(key));
    expect(Object.hasOwn(goal, 'goal_deadline_as_stated'), JSON.stringify(goal.goal_deadline_as_stated)).toBe(false);
    const metric = String((draft(ep(key)).goal as Rec).metric);
    expect(questions).toContain(UNBOUND.replace('"customer trust"', `"${metric}"`));
  });

  it('⭐ D5_r1_A UNFILED (the original failure, #3208 left it): the same answers with the learning statement not in unknowns still hold no deadline', async () => {
    const { goal, questions } = await build(ep('D5_r1_A'), (d) => ({ ...d,
      unknowns: (d.unknowns as string[]).filter((u) => u !== LEARNING),
      unknown_concerns: (d.unknown_concerns as Rec[]).filter((c) => c.unknown !== LEARNING) }));
    expect(Object.hasOwn(goal, 'goal_deadline_as_stated'), JSON.stringify(goal.goal_deadline_as_stated)).toBe(false);
    expect(questions).toContain(UNBOUND);
  });

  it('⭐ D5_r1_A SOURCE QUOTE: the learning statement as the goal\'s quote is still no deadline (a quote does not prove the role)', async () => {
    const { goal } = await build(ep('D5_r1_A'), (d) => ({ ...d, goal: { ...(d.goal as Rec), source_quote: LEARNING } }));
    expect(Object.hasOwn(goal, 'goal_deadline_as_stated'), JSON.stringify(goal.goal_deadline_as_stated)).toBe(false);
  });

  it('unit: attestHorizon on the D5 brief: no governing target statement → no deadline, the words unbound; no statement map → as before', () => {
    const brief = ep('D5_r1_A').brief;
    expect(attestHorizon(brief, { horizon_months: null }, [])).toEqual({ months: null, wording: '', status: 'absent', unbound: 'two months' });
    expect(attestHorizon(brief, { horizon_months: null }, ['Help our team explore how to rebuild customer trust.']).status).toBe('absent');
    expect(attestHorizon(brief, { horizon_months: null })).toEqual({ months: null, proposed_months: 2, wording: 'two months', status: 'unresolved' });
    // A learning task whose completion IS the goal's target keeps its period (no keyword list).
    expect(attestHorizon(brief, { horizon_months: null }, [LEARNING])).toEqual({ months: null, proposed_months: 2, wording: 'two months', status: 'unresolved' });
  });
});

describe('brief 2 (D3): the goal\'s own achievement period is kept, wherever else it is quoted', () => {
  it('PRECONDITION D3_r1_A: the drafter claims 3, quotes the goal statement, and its unknowns mention "three months" without filing that statement', () => {
    const d = draft(ep('D3_r1_A'));
    const goal = d.goal as Rec;
    expect([goal.horizon_months, goal.source_quote]).toEqual([3, D3_GOAL]);
    expect((d.unknowns as string[]).some((u) => u.includes('three months'))).toBe(true);
    expect((d.unknowns as string[]).some((u) => u.includes(D3_GOAL))).toBe(false);
    expect(ep('D3_r1_A').saved_goal_deadline_as_stated).toBe('three months');
  });

  it('CONTRAST D3_r1_A as recorded: "three months" stays the goal\'s deadline', async () => {
    const { goal } = await build(ep('D3_r1_A'));
    expect(goal.goal_deadline_as_stated).toBe('three months');
  });

  it('CONTRAST D3_r1_A, the goal statement also copied whole into unknowns: the goal\'s own statement keeps its deadline', async () => {
    const { goal } = await build(ep('D3_r1_A'), (d) => ({ ...d, unknowns: [...(d.unknowns as string[]), `${D3_GOAL} Is that realistic?`] }));
    expect(goal.goal_deadline_as_stated).toBe('three months');
  });

  it('⭐ D3_r1_A, no count claimed: the period inside the goal\'s own verified target statement is still its deadline (the supported positive)', async () => {
    const { goal } = await build(ep('D3_r1_A'), (d) => ({ ...d, goal: { ...(d.goal as Rec), horizon_months: null } }));
    expect(goal.goal_deadline_as_stated).toBe('three months');
  });

  it('⭐ D3_r1_A, no count claimed and its target statement removed: the period is not written as a deadline; its words and reading are asked', async () => {
    const { goal, questions } = await build(ep('D3_r1_A'), (d) => ({ ...d,
      goal: { ...(d.goal as Rec), horizon_months: null },
      statements: (d.statements as Rec[]).filter((st) => st.field !== 'target') }));
    expect(Object.hasOwn(goal, 'goal_deadline_as_stated'), JSON.stringify(goal.goal_deadline_as_stated)).toBe(false);
    expect(questions).toContain('Is "three months" the period by which "monthly recurring revenue" should be achieved? Your brief does not say, so the model holds no deadline for it.');
  });
});
