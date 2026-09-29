/**
 * ⭐ R1 (0.61.0) — the drafter's typed change-created marker reaches the node as `quantity_frame: 'change'`.
 * AIQ #72 5881263293 / 5881419717: the zero anchor comes ONLY from a typed construction marker, never from "computed and
 * held at 0". PLoT #407 reads the marker (a level limit on a marked node is checked as its own change).
 */
import { describe, expect, it, vi } from 'vitest';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { markChangeCreatedQuantities } from '../admit-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });
function candidate(over: { change_created?: string[]; downtimeToday?: number; downtimeProvenance?: string } = {}) {
  return {
    goal: { metric: 'Cloud savings', operator: '>', target_stated: false, frame: 'level', value: null, unit: null, horizon_months: 6, provenance: 'inferred' },
    constraints: [
      { metric: 'Migration downtime', operator: '<=', value: 2, unit: 'weeks', frame: 'level', provenance: 'explicit' },
      { metric: 'Annual salary spend', operator: '<', value: 400000, unit: 'GBP', frame: 'level', provenance: 'explicit' },
    ],
    options: [
      { label: 'Switch to GCP', provenance: 'explicit', changes: ['Migration complexity'], interventions: [], is_status_quo: false },
      { label: 'Stay on AWS', provenance: 'explicit', changes: [], interventions: [], is_status_quo: true },
    ],
    factors: [
      { label: 'Migration complexity', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 10 },
      { label: 'Migration downtime', role: 'observable', baseline_known: over.downtimeToday !== undefined, baseline_value: over.downtimeToday ?? 0, unit: 'weeks', provenance: over.downtimeProvenance ?? 'inferred', plausible_max: 8 },
      // AIQ's anti-false-pass shape (served eng-hiring): a spend with a REAL level, held at a placeholder 0, computed.
      { label: 'Annual salary spend', role: 'observable', baseline_known: false, baseline_value: 0, unit: 'GBP', provenance: 'inferred', plausible_max: 2000000 },
    ],
    risks: [], outcomes: [],
    links: [link('Migration complexity', 'Migration downtime'), link('Migration complexity', 'Annual salary spend'),
      link('Migration downtime', 'Cloud savings'), link('Annual salary spend', 'Cloud savings'), link('Migration complexity', 'Cloud savings')],
    unknowns: [],
    ...(over.change_created !== undefined ? { change_created: over.change_created } : {}),
  };
}
async function build(c: unknown, brief = 'Should we switch our cloud provider from AWS to GCP? No more than 2 weeks of migration downtime, and keep annual salary spend under £400k.') {
  let registered: { nodes: Record<string, any>[]; goal_constraints: Record<string, any>[] } | null = null;
  const fn = vi.fn(async () => ({ text: JSON.stringify(c) })) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: typeof registered }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  const r = await buildModelFromBrief('55555555-5555-4555-8555-555555555555', brief, dispatch, fn);
  expect(registered, JSON.stringify(r).slice(0, 400)).not.toBeNull();
  const g = registered as unknown as { nodes: Record<string, any>[]; goal_constraints: Record<string, any>[] };
  return { g, node: (label: string) => g.nodes.find((n) => n.label === label)! };
}

describe('CM — the drafter declares change-created quantities; admission writes quantity_frame change', () => {
  it('CM-1 RED: "Migration downtime" listed → quantity_frame change on its node; its limit is stored exactly as stated (level, same id)', async () => {
    const { g, node } = await build(candidate({ change_created: ['Migration downtime'] }));
    const downtime = node('Migration downtime');
    expect(downtime.quantity_frame).toBe('change');
    expect(g.goal_constraints.find((c) => c.node_id === downtime.id)).toMatchObject({ constraint_id: `agent-lane:${downtime.id}:<=`, value_frame: 'level', value: 2 });
  });

  it('CM-2 (AIQ anti-false-pass): the computed salary spend held at a placeholder 0 is NOT marked — nothing is inferred from "computed + 0"', async () => {
    const { node } = await build(candidate({ change_created: ['Migration downtime'] }));
    expect(node('Annual salary spend').observed_state?.raw_value, 'PRECONDITION: held at 0').toBe(0);
    expect(node('Annual salary spend')).not.toHaveProperty('quantity_frame');
  });

  it('CM-3: a stated NON-ZERO level today makes the reading yield — listed, but "1 week of downtime a year" today → not marked', async () => {
    const { node } = await build(candidate({ change_created: ['Migration downtime'], downtimeToday: 1, downtimeProvenance: 'explicit' }),
      'Should we switch from AWS to GCP? We have 1 week of downtime a year today and want no more than 2 weeks of migration downtime.');
    expect(node('Migration downtime').observed_state?.raw_value).toBe(1);
    expect(node('Migration downtime')).not.toHaveProperty('quantity_frame');
  });

  it('CM-4 CONTROL: a draft with no change_created (every pre-marker capture) marks nothing', async () => {
    const { g } = await build(candidate());
    expect(g.nodes.filter((n) => 'quantity_frame' in n)).toEqual([]);
  });

  it('CM-5: the schema REQUIRES change_created (strict output must say "none"), and the drafter is told what it means', async () => {
    const schema = buildCandidateSchema() as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toContain('change_created');
    const reqs: { instructions: string }[] = [];
    const fn = vi.fn(async (req: { instructions: string }) => { reqs.push(req); return { text: JSON.stringify(candidate({ change_created: [] })) }; }) as unknown as CallStructuredModel;
    await buildModelFromBrief('55555555-5555-4555-8555-555555555556', 'x', (async (path: string) => (path.endsWith('/graph') ? { status: 200, json: { graph: { nodes: [] } } } : { status: 200, json: { model_version: { version_number: 1 } } })) as unknown as InternalDispatch, fn);
    expect(reqs[0]!.instructions).toMatch(/List in `change_created` the exact label of every factor or outcome that exists ONLY because of the decision/);
    expect(reqs[0]!.instructions).toMatch(/Never list a quantity that has a real level today/);
  });

  it('pure: markChangeCreatedQuantities matches labels canonically and only on factors / outcomes', () => {
    const nodes = [{ id: 'd', kind: 'factor', label: 'Migration  Downtime' }, { id: 'o', kind: 'option', label: 'Migration downtime' }];
    const out = markChangeCreatedQuantities(nodes, ['migration downtime']);
    expect(out[0]).toMatchObject({ quantity_frame: 'change' });
    expect(out[1]).toBe(nodes[1]);
  });
});
