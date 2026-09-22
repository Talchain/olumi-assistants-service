/**
 * The goal must be reachable from the options, or the model cannot be analysed.
 *
 * ⛔ MEASURED FAILURE THIS FIX ADDRESSES. On a real build the goal metric
 * "monthly recurring revenue" and the outcome "Monthly Recurring Revenue" were
 * admitted as TWO nodes, the second suffixed `_2`. Every causal link named the
 * outcome spelling, so the chain terminated on the duplicate: 6 of 6 options
 * could not reach the goal and 16 of 38 nodes carried no edge at all. The model
 * was honest about every number in it and completely unanalysable.
 *
 * A node-count or edge-count assertion would not have caught it — both looked
 * healthy. Only reachability does.
 */

import { describe, it, expect } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';

const CANDIDATE = {
  goal: { metric: 'monthly recurring revenue', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
  constraints: [],
  options: [{
    label: 'Raise Pro Price', provenance: 'explicit',
    // The option must SET something, or it has no edge into the model at all.
    interventions: [{ factor_label: 'Pro plan price', value: 59, unit: 'GBP', provenance: 'explicit' }],
  }],
  factors: [{ label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit' }],
  risks: [],
  // The SAME quantity as the goal, spelled the way a model naturally writes it.
  outcomes: [{ label: 'Monthly Recurring Revenue', provenance: 'inferred' }],
  links: [{ from: 'Pro plan price', to: 'Monthly Recurring Revenue', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
} as unknown as CandidateModel;

function reaches(edges: readonly { from: string; to: string }[], from: string, to: string): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const x = stack.pop()!;
    if (x === to) return true;
    for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  }
  return false;
}

describe('goal reachability', () => {
  it('admits ONE node when the goal and an outcome name the same quantity', () => {
    const m = admitCandidateModel(CANDIDATE, {});
    const named = m.nodes.filter((n) => n.label.trim().toLowerCase() === 'monthly recurring revenue');
    expect(named, JSON.stringify(m.nodes.map((n) => [n.id, n.kind, n.label]))).toHaveLength(1);
    expect(named[0].kind).toBe('goal');
  });

  it('leaves every option able to reach the goal', () => {
    const m = admitCandidateModel(CANDIDATE, {});
    const goal = m.nodes.find((n) => n.kind === 'goal')!;
    const options = m.nodes.filter((n) => n.kind === 'option');
    expect(options.length).toBeGreaterThan(0);
    const dead = options.filter((o) => !reaches(m.edges, o.id, goal.id));
    expect(dead.map((o) => o.label), 'options with no path to the goal').toEqual([]);
  });

  it('still separates entities that are genuinely different — the contrast control', () => {
    // Same run, one difference: an outcome that is NOT the goal. If the merge
    // were indiscriminate, this would collapse too and the test above would be
    // measuring nothing.
    const other = { ...CANDIDATE, outcomes: [{ label: 'Customer Retention', provenance: 'inferred' }] } as unknown as CandidateModel;
    const m = admitCandidateModel(other, {});
    const labels = m.nodes.map((n) => n.label.trim().toLowerCase());
    expect(labels).toContain('monthly recurring revenue');
    expect(labels).toContain('customer retention');
  });
});

describe('an option that states no level', () => {
  const qualitative = {
    ...CANDIDATE,
    options: [
      // Acts on a factor, states no number. The real build produced three of
      // these — grandfathering, phasing, testing — and all three were orphans.
      { label: 'Grandfather Existing Customers', provenance: 'inferred', changes: ['Pro plan price'], interventions: [] },
      { label: 'Names Nothing At All', provenance: 'inferred', changes: [], interventions: [] },
    ],
  } as unknown as CandidateModel;

  it('still reaches the goal, without a level being invented for it', () => {
    const m = admitCandidateModel(qualitative, {});
    const goal = m.nodes.find((n) => n.kind === 'goal')!;
    const opt = m.nodes.find((n) => n.label.startsWith('Grandfather'))!;
    expect(reaches(m.edges, opt.id, goal.id)).toBe(true);

    // And no number was put on it: the option carries no interventions bundle.
    expect(opt.interventions).toBeUndefined();
  });

  it('is still a dead end when it names nothing — the contrast control', () => {
    // If `changes` merely connected everything, the test above would prove
    // nothing. An option that acts on nothing genuinely has no path.
    const m = admitCandidateModel(qualitative, {});
    const goal = m.nodes.find((n) => n.kind === 'goal')!;
    const orphan = m.nodes.find((n) => n.label === 'Names Nothing At All')!;
    expect(reaches(m.edges, orphan.id, goal.id)).toBe(false);
  });

  it('withholds a change naming a factor that does not exist', () => {
    const bad = {
      ...CANDIDATE,
      options: [{ label: 'Acts On A Ghost', provenance: 'inferred', changes: ['No Such Factor'], interventions: [] }],
    } as unknown as CandidateModel;
    const m = admitCandidateModel(bad, {});
    expect(m.withheld.some((w) => w.reason === 'unresolved_change_target')).toBe(true);
  });
});
