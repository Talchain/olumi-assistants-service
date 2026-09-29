/**
 * A LIMIT THE MODEL HOLDS IS "IN THE MODEL" (MG construction sweep, 27 Sep; served CEE e7d28fd).
 *
 * Paul's brief states "keeping monthly churn under 10%". The agent lane admits it as a live `goal_constraints[]` row
 * ({value 10, unit "%", node monthly churn}) and PLoT scores it (decision-grade). The manifest's candidates are node and
 * option values only, so "10%" read `absent` in 4/4 served runs, and "What I was given" told the user their churn limit
 * was not modelled. A live limit row is a value the model carries: it is a candidate, matched by value AND unit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deriveNotModelledManifest } from '../not-modelled-manifest.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/served-agent-lane-limit-paul-1.json', import.meta.url), 'utf8')) as {
  brief: string; graph: { goal_constraints: Record<string, unknown>[] } & Record<string, unknown>;
};
const item = (m: ReturnType<typeof deriveNotModelledManifest>, literal: string) =>
  (m as unknown as { quantities?: { items: { literal: string; verdict: string; matched_node_id: string | null }[] } }).quantities?.items.find((i) => i.literal === literal);

describe('not_modelled: a live limit row carries its figure', () => {
  it('RED (served paul-1): the brief\'s "10%" churn limit is in the model, bound to the limit\'s own node', () => {
    const limit = served.graph.goal_constraints[0]!;
    expect(limit).toMatchObject({ value: 10, unit: '%' });
    const m = deriveNotModelledManifest(served.brief, served.graph);
    expect(item(m, '10%')).toMatchObject({ verdict: 'in_model', matched_node_id: limit.node_id });
  });

  it('CONTRAST: a limit row whose value does not corroborate the figure leaves it absent', () => {
    const g = structuredClone(served.graph);
    g.goal_constraints = [{ ...g.goal_constraints[0]!, value: 12 }];
    expect(item(deriveNotModelledManifest(served.brief, g), '10%')?.verdict).toBe('absent');
  });

  it('CONTRAST: a limit row in another unit leaves it absent (value alone never matches)', () => {
    const g = structuredClone(served.graph);
    g.goal_constraints = [{ ...g.goal_constraints[0]!, unit: 'GBP' }];
    expect(item(deriveNotModelledManifest(served.brief, g), '10%')?.verdict).toBe('absent');
  });

  it('RED (served enghiring-1): the brief\'s "£400k" salary limit is in the model (a currency limit, same rule)', () => {
    const eng = JSON.parse(readFileSync(new URL('./fixtures/served-agent-lane-limit-enghiring-1.json', import.meta.url), 'utf8')) as typeof served;
    const limit = eng.graph.goal_constraints[0]!;
    expect(limit).toMatchObject({ value: 400000 });
    expect(item(deriveNotModelledManifest(eng.brief, eng.graph), '£400k')).toMatchObject({ verdict: 'in_model', matched_node_id: limit.node_id });
  });

  it('CONTROL: "12 months", which the model has no place for, stays absent', () => {
    expect(item(deriveNotModelledManifest(served.brief, served.graph), '12 months')?.verdict).toBe('absent');
  });
});
