/**
 * ⭐ R1 S4-core — A LIMIT STATED AS A CHANGE FROM TODAY IS WRITTEN AS ONE (`@talchain/schemas` 0.61.0).
 *
 * Before: the drafter could say only `level | delta`, and admission copied `delta` to `value_frame`. The contract's
 * `delta` means a change from the MODEL'S ORIGIN, not from today (0.61.0 CHANGELOG, "Legacy `delta`"), so "cost no
 * more than 10% higher than today" reached ISL in the wrong frame, and a relative change had no way to be said at all.
 *
 * Now (design MG #72 5871257542 §3.1-3.2; wire R3 5872798858; meaning AIQ 5871459631 / 5876151887):
 *   · the drafter types `level | change_abs | change_rel` from the user's words;
 *   · `change_rel` is written as the FRACTION r ("10% higher" → 0.10, "cut by 15%" → −0.15) with NO unit, because PLoT
 *     forwards r untouched and its '%' rung would refuse a '%' limit on a £ quantity (PLoT #403 `intervention-normaliser`);
 *   · `change_abs` is the change in the quantity's own unit ("2 points higher" → 2), which PLoT scales by the node's span;
 *   · a `change_rel` limit NEEDS today's level (ISL: GOAL_BASE_MISSING without it), so it is asked for like a level
 *     limit, in words about the change; a `change_abs` limit does not (ISL pairs each option with the status quo).
 * Never guessed: a `change_rel` whose unit is not a percent is left unframed (ISL refuses it by name).
 */
import { describe, expect, it, vi } from 'vitest';
import { buildCandidateSchema, buildModelFromBrief, findCoverageGaps, type CallStructuredModel, type CandidateModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { limitedLevelAsks } from '../limited-level-ask.js';

const SCENARIO = '88888888-8888-4888-8888-888888888888';
const BRIEF = 'Our monthly cloud bill is £45,000. Should we move steady workloads to reserved instances or renegotiate with our provider? Total monthly cloud cost must not rise more than 10% above today.';

const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });
function candidate(limit: Record<string, unknown>) {
  return {
    goal: { metric: 'Cloud savings', operator: '>', target_stated: false, value: null, unit: null, horizon_months: 6, provenance: 'inferred' },
    constraints: [{ metric: 'Total monthly cloud cost', operator: '<=', provenance: 'explicit', ...limit }],
    options: [
      { label: 'Reserved instances', provenance: 'explicit', changes: ['Reserved share'], interventions: [], is_status_quo: false },
      { label: 'Renegotiate contract', provenance: 'explicit', changes: ['Contract discount'], interventions: [], is_status_quo: false },
    ],
    factors: [
      { label: 'Reserved share', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 100 },
      { label: 'Contract discount', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 100 },
      { label: 'Total monthly cloud cost', role: 'observable', baseline_known: true, baseline_value: 45000, unit: 'GBP', provenance: 'explicit', plausible_max: 90000 },
    ],
    risks: [],
    outcomes: [],
    links: [
      link('Reserved share', 'Total monthly cloud cost'), link('Contract discount', 'Total monthly cloud cost'),
      link('Total monthly cloud cost', 'Cloud savings'),
    ],
    unknowns: [],
  };
}
type Registered = { goal_constraints?: Record<string, unknown>[] } | null;
function run(payload: unknown) {
  let registered: Registered = null;
  const reqs: { instructions: string }[] = [];
  const fn = vi.fn(async (req: { instructions: string; input: string }) => {
    reqs.push(req); return { text: JSON.stringify(payload) };
  }) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: Registered }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  return buildModelFromBrief(SCENARIO, BRIEF, dispatch, fn).then((r) => ({ r: r as Record<string, unknown>, reqs, registered: registered as Registered }));
}

describe('S4L — the drafter types a limit as a level, an absolute change or a relative change', () => {
  it('S4L-1: the schema REQUIRES a frame on every limit, from the contract\'s three writable values (no `delta`)', () => {
    const items = (buildCandidateSchema() as { properties: { constraints: { items: { properties: Record<string, { enum?: string[] }>; required: string[] } } } })
      .properties.constraints.items;
    expect(items.properties['frame']?.enum).toEqual(['level', 'change_abs', 'change_rel']);
    expect(items.required).toContain('frame');
  });

  it('S4L-2: the drafter is told what each frame means and how to write a relative change', async () => {
    const { reqs } = await run(candidate({ value: 10, unit: '%', frame: 'change_rel' }));
    const said = reqs[0]!.instructions;
    expect(said).toMatch(/"level" when the user limits the value itself/);
    expect(said).toMatch(/"change_abs" when they limit a CHANGE from today in the quantity\u2019s own unit \("churn no more than 2 points higher than now"\)/);
    expect(said).toMatch(/"change_rel" when they limit a PERCENTAGE change from today \("cost no more than 10% above today", "cut spend by at least 15%"\): give `value` as that signed percentage \(10, or -15\) and `unit` "%"/);
    expect(said).not.toMatch(/"delta" only when/);
  });
});

describe('S4L — WIRE: the frame and value the drafter typed reach /graph/register in the contract\'s shape', () => {
  it('S4L-3: "no more than 10% above today" registers as change_rel 0.10, with no "%" unit', async () => {
    const { r, registered } = await run(candidate({ value: 10, unit: '%', frame: 'change_rel' }));
    expect(r.goal_constraints_carried, 'PRECONDITION: the limit attached').toBe(1);
    const row = registered!.goal_constraints![0]!;
    expect(row['value_frame']).toBe('change_rel');
    expect(row['value']).toBeCloseTo(0.1, 12);
    expect(Object.keys(row)).not.toContain('unit');
  });

  it('S4L-4: a cut ("-15 %") registers as change_rel -0.15, sign kept', async () => {
    const { registered } = await run(candidate({ value: -15, unit: '%', frame: 'change_rel' }));
    const row = registered!.goal_constraints![0]!;
    expect(row['value_frame']).toBe('change_rel');
    expect(row['value']).toBeCloseTo(-0.15, 12);
  });

  it('S4L-5: an absolute change ("£5,000 more") registers as change_abs 5000 in the quantity\'s unit', async () => {
    const { registered } = await run(candidate({ value: 5000, unit: 'GBP', frame: 'change_abs' }));
    const row = registered!.goal_constraints![0]!;
    expect(row['value_frame']).toBe('change_abs');
    expect(row['value']).toBe(5000);
  });

  it('S4L-6: a legacy drafter "delta" (a change from today, as the old prompt defined it) registers as change_abs, never as delta', async () => {
    const { registered } = await run(candidate({ value: 2, unit: 'GBP', frame: 'delta' }));
    const row = registered!.goal_constraints![0]!;
    expect(row['value_frame']).toBe('change_abs');
    expect(row['value']).toBe(2);
  });

  it('S4L-7: NEVER GUESSED — a relative change whose unit is not a percent is registered unframed', async () => {
    const { r, registered } = await run(candidate({ value: 10, unit: 'GBP', frame: 'change_rel' }));
    expect(r.goal_constraints_carried, 'PRECONDITION: the limit attached').toBe(1);
    expect(Object.keys(registered!.goal_constraints![0]!)).not.toContain('value_frame');
  });
});

describe('S4L — which limits need today\'s level', () => {
  const model = (frame: string): CandidateModel => {
    const c = candidate({ value: 10, unit: '%', frame });
    return { ...c, factors: c.factors.map((f) => (f.label === 'Total monthly cloud cost' ? { ...f, baseline_known: false, baseline_value: null } : f)) } as unknown as CandidateModel;
  };

  it('S4L-8: a change_rel limit on a quantity with no level is a baseline gap (relative to what?); a change_abs limit is not', () => {
    expect(findCoverageGaps(model('change_rel'), []).baseline_gaps).toContainEqual({ factor: 'Total monthly cloud cost', because: 'limit' });
    expect(findCoverageGaps(model('change_abs'), []).baseline_gaps.filter((g) => g.factor === 'Total monthly cloud cost')).toEqual([]);
    expect(findCoverageGaps(model('level'), []).baseline_gaps, 'CONTROL: a level limit is a gap').toContainEqual({ factor: 'Total monthly cloud cost', because: 'limit' });
  });

  it('S4L-9: the level ask for a change_rel limit says the change in words, never the raw fraction', () => {
    const graph = {
      nodes: [{ id: 'fac_cost', kind: 'factor', label: 'Total monthly cloud cost', observed_state: { value: 0.5, raw_value: 45000, unit: 'GBP', source: 'cee_inference' } }],
      goal_constraints: [
        { constraint_id: 'c1', node_id: 'fac_cost', operator: '<=', value: 0.1, value_frame: 'change_rel' as const },
      ],
    };
    const asks = limitedLevelAsks(graph);
    expect(asks).toHaveLength(1);
    expect(asks[0]!.question).toContain('no more than 10% above today');
    expect(asks[0]!.question).not.toMatch(/0\.1\b/);
  });

  it('S4L-10: a change_abs limit raises no level ask (the change is read against the status quo, not a level)', () => {
    const graph = {
      nodes: [{ id: 'fac_cost', kind: 'factor', label: 'Total monthly cloud cost', observed_state: { value: 0.5, raw_value: 45000, unit: 'GBP', source: 'cee_inference' } }],
      goal_constraints: [{ constraint_id: 'c1', node_id: 'fac_cost', operator: '<=', value: 5000, value_frame: 'change_abs' as const }],
    };
    expect(limitedLevelAsks(graph)).toEqual([]);
  });
});
