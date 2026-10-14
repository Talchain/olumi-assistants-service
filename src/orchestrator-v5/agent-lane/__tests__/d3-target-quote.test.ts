/**
 * ⭐ D3 STRICT COMPARATOR (T5 D3; AIE item 4), on the AI-quote contract (as T2A5): "We want monthly recurring revenue to
 * RISE by at least 15%" lost its held target and `goal_direction` on C r2 and A r2, because `figureTheUserWroteForSpan`
 * gave the figure to another node whose label holds "rise" ("Customers lost to price rise"). The drafter now quotes the
 * target's own sentence (`goal.source_quote`); the host verifies it literally (`targetTheQuoteStates`).
 *
 * Every row drives the REAL `buildModelFromBrief` with the EXACT T5 raw responses (`fixtures/s3-t5-admission-loss-20261012.json`).
 * "+ quote" adds ONLY `goal.source_quote` to that raw answer: the one field the drafter is now asked for. Nothing else is
 * authored; the model call is faked, nothing is sent.
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
import { targetTheQuoteStates } from '../stated-by-user.js';

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


const TARGET = 'We want monthly recurring revenue to rise by at least 15% within three months.';
/** The T5 raw answer, plus ONE field: the drafter's quote of the target's own sentence (and, for a negative, its operator). */
const withQuote = (e: Episode, quote: string, operator?: string): Episode => ({ ...e, calls: e.calls.map((c, i) => {
  if (i !== 0) return c;
  const draft = JSON.parse(c.text) as { goal: Rec };
  return { ...c, text: JSON.stringify({ ...draft, goal: { ...draft.goal, source_quote: quote, ...(operator === undefined ? {} : { operator }) } }) };
}) });
const held = (goal: Rec) => ({ source: goal.threshold_source, direction: goal.goal_direction });

describe('D3: the drafter quotes the target\u2019s own sentence, the host verifies the literal', () => {
  it.each(['D3_r1', 'D3_r2', 'D3_noBase_r2'])('⭐ %s + quote: the stated target and its comparator are held (>= 15%%); RED today on C r2 and A r2, C r1 the control', async (key) => {
    const { goal } = await build(withQuote(ep(key), TARGET));
    expect(held(goal)).toEqual({ source: 'brief_extraction', direction: '>=' });
    expect(goal.goal_threshold_raw).toBe(0.15);
  });
  it.each([['D3_r1', 100000], ['D3_r2', 200000]] as const)('%s + quote keeps its cap (%d), beside the held direction', async (key, cap) => {
    const { goal } = await build(withQuote(ep(key), TARGET));
    expect({ cap: goal.goal_threshold_cap, direction: goal.goal_direction }).toEqual({ cap, direction: '>=' });
  });
  // KNOWN GAP, not this loss: A r2's drafter produced no base (today's MRR) and no basis, so no cap or normalised threshold
  // can exist on that draft whatever the attestation; the quote holds its target and comparator only.
  it('KNOWN GAP A r2 + quote: target and direction held; no cap (the draft has no base)', async () => {
    const { goal } = await build(withQuote(ep('D3_noBase_r2'), TARGET));
    expect({ cap: goal.goal_threshold_cap, basis: goal.goal_target_basis, observed: goal.observed_state }).toEqual({ cap: undefined, basis: undefined, observed: undefined });
  });
  it('the recorded C r2 answer (no quote) is today\u2019s loss, unchanged: no held target, no direction', async () => {
    expect(held((await build(ep('D3_r2'))).goal)).toEqual({ source: undefined, direction: undefined });
  });
  it('CONTROL: C r1 (no colliding label) holds them with or without the quote', async () => {
    expect(held((await build(ep('D3_r1'))).goal)).toEqual({ source: 'brief_extraction', direction: '>=' });
  });
  it.each([
    ['a quote the brief never wrote', 'We want monthly recurring revenue to rise by at least 15% within six months.', undefined],
    ['a verbatim fragment naming the goal without the figure', 'We want monthly recurring revenue to rise', undefined],
    ['a verbatim quote of another sentence', 'We could raise the price to \u00a322, keep the price and improve onboarding, or offer annual contracts.', undefined],
    ['a comparator other than the drafter\u2019s (strict ">" against "at least")', TARGET, '>'],
  ] as const)('NEGATIVE C r2 + %s: nothing is held', async (_case, quote, operator) => {
    expect(held((await build(withQuote(ep('D3_r2'), quote, operator))).goal)).toEqual({ source: undefined, direction: undefined });
  });
  it('NEGATIVE: a quote that names another quantity, not the goal, is not the goal\u2019s target', () => {
    const brief = 'Churn must fall by at least 15% this quarter. We want monthly recurring revenue to grow.';
    expect(targetTheQuoteStates('Churn must fall by at least 15% this quarter.', brief, { figure: 15, unit: '%', operator: '>=', label: 'monthly recurring revenue' })).toBe(false);
    expect(targetTheQuoteStates(TARGET, ep('D3_r2').brief, { figure: 15, unit: '%', operator: '>=', label: 'monthly recurring revenue' }), 'control').toBe(true);
  });
});
