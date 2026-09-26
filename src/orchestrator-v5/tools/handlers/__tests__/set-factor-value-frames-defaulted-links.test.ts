/**
 * ⭐ A LEVEL THAT ARRIVES AFTER CONSTRUCTION SIZES OLUMI'S OWN LINKS ON IT (C, DL #70 5849216942).
 *
 * ⚠ SERVED (`f-20260926T190952Z`, CEE 3fdd9c3, OpenAI): the draft gave monthly churn no level, so admission kept both
 * links into it at the ±0.5 default. The approved starting point then set churn to 5% (step 02), and later the user
 * said 12% (step 13). Both links stayed ±0.5 at all 16 steps, and every option was withheld as out of domain
 * (0.77 / 0.77 / 0.34). Engine-direct on PLoT 1f6ad52, re-sizing ONLY those two links by D6 made 3/3 options
 * decision-grade (`quality-evidence/c-run1-resize-20260926/`).
 *
 * Every row runs the real chain (`applyFactorValueEdit` → `set_factor_value` → persistence merge → parse), starts from
 * the SERVED graph (`tests/fixtures/magnitude/c-run1-served-graphs.json`, verbatim), and binds each link by its ids.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { applyFactorValueEdit } from '../../../system-events/factor-value-edit.js';
import { frameDefaultedLinks } from '../../../../cee/magnitude/frame-defaulted-links.js';

type Edge = { from: string; to: string; strength: { mean: number; std: number }; provenance?: Record<string, unknown> };
type Graph = { nodes: Array<Record<string, unknown>>; edges: Edge[]; goal_constraints?: unknown[] };

const SERVED = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf-8')) as Record<string, Graph>;
const served = (key: string): Graph => structuredClone(SERVED[key]);
const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';

async function setLevel(graph: Graph, targetId: string, raw: number, unit: string) {
  const event = { kind: 'factor_value_edit', target_id: targetId, value: raw, unit, field: 'value' } as Extract<
    SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }>;
  const result = await applyFactorValueEdit({
    payload: { kind: 'system_event', scenario_id: SCENARIO_ID, turn_id: '77777777-7777-4777-8777-777777777777', stage: 'frame', event } as unknown as SystemEventTurnPayload,
    event,
    requestId: `req-frame-links-${targetId}-${raw}`,
    persistedGraph: graph,
    priorFacts: [],
  });
  expect(result.kind, `edit was not applied: ${JSON.stringify(result).slice(0, 400)}`).toBe('mutated');
  if (result.kind !== 'mutated') throw new Error('unreachable');
  return result;
}

/** The link by its ids, in BOTH carriers of the committed write (the merged graph and its parse). */
function links(result: Awaited<ReturnType<typeof setLevel>>, from: string, to: string): Edge[] {
  return [result.mutatedGraph, result.graph].map((g) => {
    const e = (g as unknown as Graph).edges.find((x) => x.from === from && x.to === to);
    expect(e, `${from}→${to} is committed`).toBeDefined();
    return e!;
  });
}
const churnLevel = (result: Awaited<ReturnType<typeof setLevel>>) =>
  ((result.mutatedGraph as unknown as Graph).nodes.find((n) => n.id === 'monthly_churn')!.observed_state as Record<string, unknown>);

const CHURN_UNIT = '% of Pro subscribers per month';

describe('set_factor_value: a level that arrives after construction sizes Olumi\'s own links on it', () => {
  it('RED (served step 02): churn gets 5% → both default links into it are sized by D6 (±0.0125), stamped olumi_placeholder', async () => {
    const result = await setLevel(served('run1_step01'), 'monthly_churn', 5, CHURN_UNIT);
    expect(churnLevel(result).value, 'the served level: 5% on its 0–100 frame').toBeCloseTo(0.05, 12);
    for (const e of links(result, 'price_sensitivity', 'monthly_churn')) {
      expect(e.strength).toEqual({ mean: 0.0125, std: 0.00625 });
      expect(e.provenance?.magnitude).toBe('olumi_placeholder');
    }
    for (const e of links(result, 'ai_feature_availability', 'monthly_churn')) {
      expect(e.strength).toEqual({ mean: -0.0125, std: 0.00625 });
      expect(e.provenance?.magnitude).toBe('olumi_placeholder');
      expect((e.provenance?.natural_effect as { amount?: number } | undefined)?.amount, 'said in points on the canvas').toBe(-1.25);
    }
  });

  it('RED (served step 13): the user says 12% on the served Run graph (links still ±0.5) → ±0.03', async () => {
    const result = await setLevel(served('run1_step05'), 'monthly_churn', 12, CHURN_UNIT);
    for (const e of links(result, 'price_sensitivity', 'monthly_churn')) expect(e.strength).toEqual({ mean: 0.03, std: 0.015 });
    for (const e of links(result, 'ai_feature_availability', 'monthly_churn')) expect(e.strength).toEqual({ mean: -0.03, std: 0.015 });
  });

  it('RED (the placeholder follows the level): sized at 5%, then the level moves to 12% → re-sized to ±0.03', async () => {
    const at5 = await setLevel(served('run1_step01'), 'monthly_churn', 5, CHURN_UNIT);
    const at12 = await setLevel(at5.mutatedGraph as unknown as Graph, 'monthly_churn', 12, CHURN_UNIT);
    for (const e of links(at12, 'ai_feature_availability', 'monthly_churn')) expect(e.strength).toEqual({ mean: -0.03, std: 0.015 });
  });

  it('CONTRAST (run 2): Olumi\'s own ESTIMATED sizes (olumi_estimate) are never re-derived when the level moves', async () => {
    const before = served('run2_step01');
    const result = await setLevel(before, 'monthly_churn_rate', 9, '%');
    for (const from of ['pro_plan_price', 'next_ai_feature_availability']) {
      const was = before.edges.find((e) => e.from === from && e.to === 'monthly_churn_rate')!;
      expect(was.provenance?.magnitude).toBe('olumi_estimate');
      for (const e of links(result, from, 'monthly_churn_rate')) expect(e.strength).toEqual(was.strength);
    }
  });

  it('CONTROL: a DELTA limit in % gives no domain (only a LEVEL limit is judged on [0,1]) → the links keep the default', async () => {
    const graph = served('run1_step01');
    const limit = (graph.goal_constraints as Array<Record<string, unknown>>).find((c) => c.node_id === 'monthly_churn')!;
    limit.value_frame = 'delta';
    const result = await setLevel(graph, 'monthly_churn', 5, CHURN_UNIT);
    for (const e of links(result, 'ai_feature_availability', 'monthly_churn')) expect(e.strength).toEqual({ mean: -0.5, std: 0.125 });
  });

  it('CONTROL: an option that sets the limited quantity BELOW ZERO makes it a change, not a level → the links keep the default', async () => {
    const graph = served('run1_step01');
    const option = graph.nodes.find((n) => n.id === 'raise_to_59_at_release')!;
    option.interventions = { ...(option.interventions as Record<string, unknown>), monthly_churn: { value: -0.02, source: 'brief_extraction' } };
    const result = await setLevel(graph, 'monthly_churn', 5, CHURN_UNIT);
    for (const e of links(result, 'price_sensitivity', 'monthly_churn')) expect(e.strength).toEqual({ mean: 0.5, std: 0.125 });
  });

  it('RED (ONE RULE, R&C #2034 B1): a 0.5 "% per month" level limit is NOT a percentage level on this path either (admission agrees) → default kept', async () => {
    const graph = served('run1_step01');
    const limit = (graph.goal_constraints as Array<Record<string, unknown>>).find((c) => c.node_id === 'monthly_churn')!;
    Object.assign(limit, { value: 0.5, unit: '% per month' });
    const result = await setLevel(graph, 'monthly_churn', 5, CHURN_UNIT);
    for (const e of links(result, 'ai_feature_availability', 'monthly_churn')) expect(e.strength).toEqual({ mean: -0.5, std: 0.125 });
  });

  it('ONE RULE: a 10 "% change" level limit pins a 0–100 frame but the canonicaliser keeps it a change → NOT a level, default kept', async () => {
    const graph = served('run1_step01');
    const limit = (graph.goal_constraints as Array<Record<string, unknown>>).find((c) => c.node_id === 'monthly_churn')!;
    Object.assign(limit, { value: 10, unit: '% change' });
    const result = await setLevel(graph, 'monthly_churn', 5, CHURN_UNIT);
    for (const e of links(result, 'ai_feature_availability', 'monthly_churn')) expect(e.strength).toEqual({ mean: -0.5, std: 0.125 });
  });

  it('CONTROL: a size the USER gave (user_specified) on the same link is never touched', async () => {
    const graph = served('run1_step01');
    const userLink = graph.edges.find((e) => e.from === 'ai_feature_availability' && e.to === 'monthly_churn')!;
    userLink.provenance = { source: 'user_specified' };
    const result = await setLevel(graph, 'monthly_churn', 5, CHURN_UNIT);
    for (const e of links(result, 'ai_feature_availability', 'monthly_churn')) expect(e.strength).toEqual({ mean: -0.5, std: 0.125 });
    // The Olumi-sized sibling on the same target still is.
    for (const e of links(result, 'price_sensitivity', 'monthly_churn')) expect(e.strength).toEqual({ mean: 0.0125, std: 0.00625 });
  });

  it('CONTROL: a sizeable link that does not touch the edited factor keeps its default', async () => {
    // Give the neighbouring risk a bounded level so its own incoming default COULD be sized: editing churn must not.
    const graph = served('run1_step01');
    const risk = graph.nodes.find((n) => n.id === 'price_sensitivity')!;
    risk.observed_state = { value: 0.3, raw_value: 30, unit: '%', source: 'brief_extraction' };
    risk.scale_frame = 100;
    expect(frameDefaultedLinks(graph, 'price_sensitivity').sized, 'the positive control: it IS sizeable').toContain('pro_plan_price::price_sensitivity');
    const result = await setLevel(graph, 'monthly_churn', 5, CHURN_UNIT);
    for (const e of links(result, 'pro_plan_price', 'price_sensitivity')) expect(e.strength).toEqual({ mean: 0.5, std: 0.125 });
  });

  it('CONTROL: an edit that does not move the level re-sizes nothing (the graph hash must not move on a no-op)', async () => {
    const result = await setLevel(served('run1_step05'), 'monthly_churn', 5, CHURN_UNIT);
    for (const e of links(result, 'ai_feature_availability', 'monthly_churn')) expect(e.strength).toEqual({ mean: -0.5, std: 0.125 });
  });

  it('CONTROL: the re-size is idempotent (a second pass over the committed graph sizes nothing)', async () => {
    const result = await setLevel(served('run1_step01'), 'monthly_churn', 5, CHURN_UNIT);
    expect(frameDefaultedLinks(result.mutatedGraph, 'monthly_churn').sized).toEqual([]);
  });
});
