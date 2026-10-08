/**
 * CEE #4 through the REAL door: `buildModelFromBrief` registers the drafter's accumulation on the derived node only on
 * the deadline the brief attests, and the registered graph survives the cold read (GraphV3).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Rec = Record<string, unknown>;
const SCENARIO = '62626262-6262-4626-8626-626262626262';
const BRIEF = 'Given our goal of reaching £20k Pro MRR within 12 months, should we raise the Pro plan price from £49 to £59? '
  + 'We have 250 Pro subscribers, lose 3% a month and add about 20 new Pro subscribers a month.';
const SUBS12 = 'Pro subscribers at month 12';

function candidate(identities: unknown[]): CandidateModel {
  return {
    goal: {
      metric: 'Pro MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: 12,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: null, scope: null,
    },
    constraints: [],
    options: [
      { label: 'Raise the Pro plan price to £59', provenance: 'explicit', is_status_quo: false, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Keep the Pro plan price at £49', provenance: 'explicit', is_status_quo: true, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 100 },
      { label: 'Pro subscribers', role: 'external', baseline_known: true, baseline_value: 250, unit: 'subscribers', provenance: 'explicit', plausible_max: 1000 },
      { label: 'Monthly churn', role: 'external', baseline_known: true, baseline_value: 3, unit: '%', provenance: 'explicit', plausible_max: 100 },
      { label: 'New Pro subscribers per month', role: 'external', baseline_known: true, baseline_value: 20, unit: 'subscribers/month', provenance: 'explicit', plausible_max: 200 },
    ],
    risks: [],
    outcomes: [{ label: SUBS12, provenance: 'inferred' }],
    links: [
      ['Pro subscribers', SUBS12, 'positive'], ['Monthly churn', SUBS12, 'negative'], ['New Pro subscribers per month', SUBS12, 'positive'],
      [SUBS12, 'Pro MRR', 'positive'], ['Pro plan price', 'Pro MRR', 'positive'], ['Pro plan price', 'Monthly churn', 'positive'],
    ].map(([from, to, direction]) => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null })),
    identities, unknowns: [],
  } as unknown as CandidateModel;
}
const ACC = { outcome: SUBS12, operation: 'accumulation', factors: ['Pro subscribers', 'Monthly churn', 'New Pro subscribers per month'], provenance: 'inferred' };

async function build(brief: string, c: CandidateModel): Promise<{ result: Rec; nodes: Rec[] }> {
  let stored: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)));
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(c) });
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 2000)).toBe(true);
  return { result, nodes: GraphV3.parse(JSON.parse(stored!)).nodes as Rec[] };
}
const carrierOn = (nodes: Rec[], label: string): unknown => nodes.find((n) => n.label === label)?.nonlinear_identity;
const said = (r: Rec): string => JSON.stringify(r);

describe('the accumulation reaches the registered graph only on an attested deadline', () => {
  it('⭐ RED: registered on the derived node, positional, horizon 12, rate_scale 0.01, Olumi\'s reading', async () => {
    const { nodes } = await build(BRIEF, candidate([ACC]));
    const id = (label: string) => nodes.find((n) => n.label === label)!.id;
    expect(carrierOn(nodes, SUBS12)).toEqual({
      operation: 'accumulation',
      factor_ids: [id('Pro subscribers'), id('Monthly churn'), id('New Pro subscribers per month')],
      horizon_months: 12, rate_scale: 0.01, stated_in_brief: false,
    });
  });

  it('CONTRAST: the same declaration on a brief with no deadline is refused, said, and nothing is carried', async () => {
    const { nodes, result } = await build(BRIEF.replace(' within 12 months', ''), candidate([ACC]));
    expect(carrierOn(nodes, SUBS12)).toBeUndefined();
    expect(said(result)).toMatch(/states no deadline to work it out to/);
  });

  it('CONTROL: no accumulation declared → no carrier and no refusal', async () => {
    const { nodes, result } = await build(BRIEF, candidate([]));
    expect(carrierOn(nodes, SUBS12)).toBeUndefined();
    expect(said(result)).not.toMatch(/worked out month by month/);
  });

  // Bound at ADMISSION: its ledger is where the product checker's refusal lands (the build result does not echo it).
  it('the product checker no longer refuses an accumulation; CONTROL: an unknown operation still is', () => {
    const refusedAs = (identities: unknown[]): string[] => (admitCandidateModel(candidate(identities), {}, BRIEF) as { loss: { field_path: string; reason: string }[] }).loss
      .filter((l) => /nonlinear_identity_rejected$/.test(l.field_path)).map((l) => l.reason);
    expect(refusedAs([ACC]).filter((r) => /is not a relationship Olumi can check/.test(r))).toEqual([]);
    expect(refusedAs([{ ...ACC, operation: 'ratio' }]).filter((r) => /"ratio" is not a relationship Olumi can check/.test(r))).toHaveLength(1);
  });
});
