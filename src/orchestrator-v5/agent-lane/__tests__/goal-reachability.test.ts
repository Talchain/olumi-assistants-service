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

describe('an orphaned goal is repaired AND disclosed', () => {
  // ⛔ MEASURED ON A REAL BRIEF. Goal metric "Productivity change", while every
  // causal chain terminated on an invented near-synonym outcome "Productivity
  // Improvement". 35 nodes, 40 edges, every count healthy — and 0 of 6 options
  // could reach the goal, so the model could never be analysed.
  const nearSynonym = {
    ...CANDIDATE,
    goal: { metric: 'Productivity change', operator: '>=', value: 10, unit: '%', horizon_months: 3, provenance: 'explicit' },
    outcomes: [{ label: 'Productivity Improvement', provenance: 'inferred' }],
    links: [{ from: 'Pro plan price', to: 'Productivity Improvement', direction: 'positive', provenance: 'inferred' }],
  } as unknown as CandidateModel;

  it('connects the terminal outcome to the goal so the model can be analysed', () => {
    const m = admitCandidateModel(nearSynonym, {});
    const goal = m.nodes.find((n) => n.kind === 'goal')!;
    const opt = m.nodes.find((n) => n.kind === 'option')!;
    expect(reaches(m.edges, opt.id, goal.id), 'the option must reach the goal').toBe(true);
  });

  it('RECORDS it as an assumption — a silent connection would be worse', () => {
    const m = admitCandidateModel(nearSynonym, {});
    const entry = m.loss.find((l) => String(l.reason).includes('could not be analysed at all'));
    expect(entry, 'the repair must be disclosed in the loss ledger').toBeDefined();
    expect(String(entry!.reason)).toMatch(/ASSUMPTION/);
    expect(String(entry!.reason)).toMatch(/Productivity Improvement/);
  });

  it('marks the invented edge as defaulted, never as authored', () => {
    const m = admitCandidateModel(nearSynonym, {});
    const goal = m.nodes.find((n) => n.kind === 'goal')!;
    const into = m.edges.filter((e) => e.to === goal.id);
    expect(into.length).toBeGreaterThan(0);
    for (const e of into) expect(e.defaulted).toBe(true);
  });

  it('does NOT fire when the model connected the goal itself — contrast control', () => {
    // CANDIDATE already terminates on the goal metric's own label. If the
    // repair fired here it would be adding causality nobody asked for.
    const m = admitCandidateModel(CANDIDATE, {});
    const entry = m.loss.find((l) => String(l.reason).includes('could not be analysed at all'));
    expect(entry, 'repair must not fire on a well-connected goal').toBeUndefined();
  });
});

describe('an option that changes nothing is recorded, not silently admitted', () => {
  // ⛔ MEASURED: 0 of 7 options on a real 35-node model carried an intervention.
  // Every option reached the goal, every count looked healthy, and the analysis
  // could still never tell "direct sales hiring" from "channel partnerships" —
  // because nothing said what either DOES. Filling in the 17 missing factor
  // values would not have helped: the defect is structural, not numeric.
  const inert = {
    ...CANDIDATE,
    options: [
      { label: 'Does Something', provenance: 'inferred', changes: ['Pro plan price'], interventions: [] },
      { label: 'Does Nothing', provenance: 'inferred', changes: [], interventions: [] },
    ],
  } as unknown as CandidateModel;

  it('names the inert option so the Agent can ask about it', () => {
    const m = admitCandidateModel(inert, {});
    const flagged = m.withheld.filter((w) => w.reason === 'option_changes_nothing').map((w) => w.from);
    expect(flagged).toEqual(['Does Nothing']);
  });

  it('does NOT flag an option that acts on something — the contrast control', () => {
    // Without this, flagging everything would look identical to flagging the
    // right thing.
    const m = admitCandidateModel(inert, {});
    const flagged = m.withheld.filter((w) => w.reason === 'option_changes_nothing').map((w) => w.from);
    expect(flagged).not.toContain('Does Something');
  });

  it('still admits the inert option rather than deleting the user’s choice', () => {
    // Dropping it would be worse: the user named it, and silently losing an
    // option is a bigger failure than carrying one that cannot be compared.
    const m = admitCandidateModel(inert, {});
    expect(m.nodes.filter((n) => n.kind === 'option').map((n) => n.label)).toContain('Does Nothing');
  });
});
