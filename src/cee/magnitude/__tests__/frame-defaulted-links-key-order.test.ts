/**
 * ⛔ A PERSISTED LINK IS THE SAME SIZE WHATEVER ORDER ITS KEYS COME BACK IN (MG; disclosed on #2193).
 *
 * `frameDefaultedLinks` keeps a link that is already at its D6 size as it is (the SAME object, `sized: []`). It compared
 * `provenance.natural_effect` with `JSON.stringify`, which is key-order-sensitive — and a graph read back from Postgres
 * `jsonb` does not keep insertion order (jsonb stores object keys shortest-first). So on a persisted graph every
 * Olumi-sized link that touches the factor read as re-sized: re-written, and named in `sized` (the level door's
 * `linksSized`), though not one number moved.
 *
 * Rows start from the SERVED graph (`c-run1-served-graphs.json`), size churn's links through the real door
 * (`applyFactorValueEdit`, 5%), then re-order `natural_effect` the way jsonb does.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { applyFactorValueEdit } from '../../../orchestrator-v5/system-events/factor-value-edit.js';
import { frameDefaultedLinks } from '../frame-defaulted-links.js';

type Edge = { from: string; to: string; strength: { mean: number; std: number }; provenance?: Record<string, unknown> };
type Graph = { nodes: Array<Record<string, unknown>>; edges: Edge[] };

const SERVED = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf-8')) as Record<string, Graph>;

async function sizedAt5(): Promise<Graph> {
  const event = { kind: 'factor_value_edit', target_id: 'monthly_churn', value: 5, unit: '% of Pro subscribers per month', field: 'value' } as Extract<
    SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }>;
  const result = await applyFactorValueEdit({
    payload: { kind: 'system_event', scenario_id: '11111111-1111-4111-8111-111111111111', turn_id: '77777777-7777-4777-8777-777777777777', stage: 'frame', event } as unknown as SystemEventTurnPayload,
    event,
    requestId: 'req-key-order',
    persistedGraph: structuredClone(SERVED.run1_step01),
    priorFacts: [],
  });
  if (result.kind !== 'mutated') throw new Error(`edit was not applied: ${JSON.stringify(result).slice(0, 300)}`);
  return structuredClone(result.mutatedGraph) as unknown as Graph;
}

/** Postgres jsonb's object-key order: shorter keys first, then bytewise — never insertion order. */
function jsonbOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value === null || typeof value !== 'object') return value;
  const keys = Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(keys.map((k) => [k, jsonbOrder((value as Record<string, unknown>)[k])]));
}

const churnLinks = (g: Graph) => g.edges.filter((e) => e.to === 'monthly_churn' && e.provenance?.magnitude === 'olumi_placeholder');
/** The links that carry `natural_effect` (the served price link is sized with none: no natural phrase for it). */
const withNatural = (g: Graph) => churnLinks(g).filter((e) => e.provenance?.natural_effect !== undefined);

describe('frameDefaultedLinks: a link already at its D6 size stays as it is, whatever its key order', () => {
  it('PRECONDITION: the door sized both links into churn; the AI link carries natural_effect (the field this is about)', async () => {
    const g = await sizedAt5();
    expect(churnLinks(g).map((e) => `${e.from}::${e.to}`).sort()).toEqual(['ai_feature_availability::monthly_churn', 'price_sensitivity::monthly_churn']);
    expect(withNatural(g).map((e) => `${e.from}::${e.to}`)).toEqual(['ai_feature_availability::monthly_churn']);
  });

  it('CONTROL: in insertion order, a second pass is a fixed point (same object, nothing sized)', async () => {
    const g = await sizedAt5();
    const again = frameDefaultedLinks(g, 'monthly_churn');
    expect(again.sized).toEqual([]);
    expect(again.graph).toBe(g);
  });

  it('⭐ RED: read back in jsonb key order, a second pass is STILL a fixed point — no link named re-sized, none re-written', async () => {
    const persisted = jsonbOrder(await sizedAt5()) as Graph;
    const keysBefore = withNatural(persisted).map((e) => Object.keys(e.provenance!.natural_effect as object).join(','));
    const inserted = withNatural(await sizedAt5()).map((e) => Object.keys(e.provenance!.natural_effect as object).join(','));
    expect(keysBefore, 'the fixture really is re-ordered').not.toEqual(inserted);
    const again = frameDefaultedLinks(persisted, 'monthly_churn');
    expect(again.sized).toEqual([]);
    expect(again.graph).toBe(persisted);
  });

  it('CONTRAST: a link whose natural_effect really differs is still re-sized (the check did not go blind)', async () => {
    const persisted = jsonbOrder(await sizedAt5()) as Graph;
    const e = persisted.edges.find((x) => x.from === 'ai_feature_availability' && x.to === 'monthly_churn')!;
    (e.provenance!.natural_effect as Record<string, unknown>).amount = -9;
    const again = frameDefaultedLinks(persisted, 'monthly_churn');
    expect(again.sized).toEqual(['ai_feature_availability::monthly_churn']);
  });
});
