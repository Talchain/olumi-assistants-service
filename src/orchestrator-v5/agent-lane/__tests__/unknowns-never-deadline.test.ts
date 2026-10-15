/**
 * ⛔ TEXT FROM UNKNOWNS IS NEVER A DEADLINE (AIE #94 6183705670; DL 15 Oct). In the v2 GEN pre-H0/H1 raws (head c515cfcb),
 * D5r1's drafter left the goal's `horizon_months` and `deadline_words` null and filed the brief's statement "We have two
 * months to learn, and are not choosing a final strategy today." WHOLE in `unknowns`, in both arms. Admission still saved
 * `goal_deadline_as_stated: "two months"`: `attestHorizon` read the span from the brief as an allotted deadline.
 *
 * Every row drives the REAL `buildModelFromBrief` with the EXACT raw responses (`fixtures/v2-unknowns-deadline-20261015.json`,
 * copied with their sha256; never authored). The model call is faked, nothing is sent.
 * Brief 1: D5 (collaborative exploration), arms A and C. Brief 2: D3 (pricing), arm A: its goal's own deadline is kept.
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
    }
    expect(e.brief).toContain(LEARNING);
    expect(e.saved_goal_deadline_as_stated).toBe('two months');
  });

  it.each(['D5_r1_A', 'D5_r1_C'])('⭐ RED %s: the saved goal holds no deadline, and no deadline question is asked about "two months"', async (key) => {
    const { goal, questions } = await build(ep(key));
    expect(Object.hasOwn(goal, 'goal_deadline_as_stated'), JSON.stringify(goal.goal_deadline_as_stated)).toBe(false);
    expect(Object.hasOwn(goal, 'goal_horizon_months')).toBe(false);
    expect(questions.some((q) => /two months/.test(q) && /deadline/i.test(q)), JSON.stringify(questions)).toBe(false);
  });

  it('CONTRAST D5_r1_A: the SAME answers with the learning statement no longer filed as an unknown read it exactly as before', async () => {
    const { goal } = await build(ep('D5_r1_A'), (d) => ({ ...d,
      unknowns: (d.unknowns as string[]).filter((u) => u !== LEARNING),
      unknown_concerns: (d.unknown_concerns as Rec[]).filter((c) => c.unknown !== LEARNING) }));
    expect(goal.goal_deadline_as_stated).toBe('two months');
  });

  it('unit: attestHorizon on the D5 brief: filed → absent; not filed → the allotted span, as before', () => {
    const brief = ep('D5_r1_A').brief;
    expect(attestHorizon(brief, { horizon_months: null }, [LEARNING])).toEqual({ months: null, wording: '', status: 'absent' });
    expect(attestHorizon(brief, { horizon_months: null })).toEqual({ months: null, proposed_months: 2, wording: 'two months', status: 'unresolved' });
    // A question that only mentions the span is not the statement filed: the deadline reading stands.
    expect(attestHorizon(brief, { horizon_months: null }, ['What can we test in two months?']).status).toBe('unresolved');
  });
});

describe('brief 2 (D3): the goal\'s own deadline is kept, whatever unknowns quote', () => {
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

  it('⭐ D3_r1_A with the goal\'s quote dropped and the statement filed whole as an unknown: no deadline is held from it', async () => {
    const { goal } = await build(ep('D3_r1_A'), (d) => ({ ...d,
      goal: { ...(d.goal as Rec), horizon_months: null, source_quote: null },
      unknowns: [...(d.unknowns as string[]), D3_GOAL] }));
    expect(Object.hasOwn(goal, 'goal_deadline_as_stated'), JSON.stringify(goal.goal_deadline_as_stated)).toBe(false);
  });
});
