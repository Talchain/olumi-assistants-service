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

import { describe, it, expect, vi } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';

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

describe('⛔ an orphaned goal is NOT repaired with a sign nobody stated (#63 5793252993)', () => {
  // ⛔ MEASURED ON A REAL BRIEF. Goal metric "Productivity change", while every
  // causal chain terminated on an invented near-synonym outcome "Productivity
  // Improvement". 35 nodes, 40 edges, every count healthy — and 0 of 6 options
  // could reach the goal, so the model could never be analysed.
  //
  // ⛔ THESE TESTS USED TO PIN A REPAIR THE RULING FORBIDS. Admission connected
  // each dangling terminal outcome to the goal as `positive`, `defaulted`, with
  // NO provenance — and it did so even over an outcome -> goal link the drafter
  // had explicitly stated as `unknown` (Panel review 5793954535, B1, probe P1:
  // readiness `ready` while the server told the user the same question was still
  // open). Release Control #63 5793252993: no default sign on a link to the goal;
  // disclosure does not make an arbitrary sign sound; where direction is unknown,
  // ASK. So the goal is left unreached, the analysis is honestly blocked by the
  // readiness authority, and the gap is named for the Agent to ask about.
  const nearSynonym = {
    ...CANDIDATE,
    goal: { metric: 'Productivity change', operator: '>=', value: 10, unit: '%', horizon_months: 3, provenance: 'explicit' },
    // Two options, so FEWER_THAN_TWO_OPTIONS cannot be what blocks the analysis.
    options: [
      ...(CANDIDATE as unknown as { options: unknown[] }).options,
      { label: 'Hold Pro Price', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 49, unit: 'GBP', provenance: 'explicit' }] },
    ],
    outcomes: [{ label: 'Productivity Improvement', provenance: 'inferred' }],
    links: [{ from: 'Pro plan price', to: 'Productivity Improvement', direction: 'positive', provenance: 'inferred' }],
  } as unknown as CandidateModel;
  const STRUCTURAL = ['ORPHAN_NODE', 'NO_PATH_TO_GOAL'];
  const QUESTION = 'Does a productivity improvement raise or lower the productivity change you are aiming for?';
  const unknownToGoal = {
    ...nearSynonym,
    links: [
      ...(nearSynonym as unknown as { links: unknown[] }).links,
      { from: 'Productivity Improvement', to: 'Productivity change', direction: 'unknown', provenance: 'inferred' },
    ],
    unknowns: [QUESTION],
  } as unknown as CandidateModel;
  const directedToGoal = {
    ...nearSynonym,
    links: [
      ...(nearSynonym as unknown as { links: unknown[] }).links,
      { from: 'Productivity Improvement', to: 'Productivity change', direction: 'positive', provenance: 'inferred' },
    ],
  } as unknown as CandidateModel;
  const blockers = (m: ReturnType<typeof admitCandidateModel>) => {
    const r = assessCanonicalAnalysisReadiness({ nodes: m.nodes, edges: m.edges });
    return { codes: r.blockingIssues.map((i) => i.code), safe: r.safeToAnalyse, status: r.analysisReady?.status };
  };

  it('invents NO link into the goal — the option is honestly left unable to reach it', () => {
    const m = admitCandidateModel(nearSynonym, {});
    const goal = m.nodes.find((n) => n.kind === 'goal')!;
    const options = m.nodes.filter((n) => n.kind === 'option');
    expect(options).toHaveLength(2);
    expect(m.edges.filter((e) => e.to === goal.id), 'no edge into the goal may be supplied by admission').toEqual([]);
    for (const o of options) expect(reaches(m.edges, o.id, goal.id), o.label).toBe(false);
    expect(m.loss.find((l) => String(l.reason).includes('could not be analysed at all'))).toBeUndefined();
  });

  it('the readiness authority blocks the analysis, and every unreached node is NAMED so the Agent asks', () => {
    const m = admitCandidateModel(nearSynonym, {});
    const b = blockers(m);
    expect(b.safe).toBe(false);
    expect(b.status).toBe('blocked');
    expect(b.codes).toContain('NO_PATH_TO_GOAL');
    expect(b.codes.filter((c) => !STRUCTURAL.includes(c)), 'vacuity: only the structural gap blocks it').toEqual([]);
    const named = m.loss.filter((l) => /no chain of causes runs from it/.test(String(l.reason))).map((l) => l.before);
    expect(named).toEqual(expect.arrayContaining(['Productivity Improvement', 'Raise Pro Price', 'Hold Pro Price', 'Pro plan price']));
  });

  it('an outcome -> goal link stated UNKNOWN is withheld and ASKED — never signed', async () => {
    const m = admitCandidateModel(unknownToGoal, {});
    const goal = m.nodes.find((n) => n.kind === 'goal')!;
    const outcome = m.nodes.find((n) => n.label === 'Productivity Improvement')!;
    // Vacuity guard: the drafter really did state the link, as `unknown`.
    expect(m.withheld).toContainEqual(expect.objectContaining({ from: outcome.id, to: goal.id, reason: 'no_authored_direction' }));
    expect(m.edges.filter((e) => e.to === goal.id), 'the unknown link must not come back with a default sign').toEqual([]);
    expect(blockers(m).safe).toBe(false);
    expect(blockers(m).codes).toContain('NO_PATH_TO_GOAL');

    // And the build result — what the Agent reads — carries the withheld pair
    // AND the question, with nothing registered into the goal.
    const bodies: unknown[] = [];
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) bodies.push(body);
      return { status: 200, json: { registered: true } };
    };
    const fn = vi.fn(async () => ({ text: JSON.stringify(unknownToGoal) })) as unknown as CallStructuredModel;
    const out = await buildModelFromBrief('55555555-5555-4555-8555-555555555555', 'Raise the Pro price?', d, fn) as Record<string, unknown>;
    expect(out.ok, JSON.stringify(out).slice(0, 300)).toBe(true);
    expect(bodies).toHaveLength(1);
    const reg = (bodies[0] as { graph: { edges: { to: string }[] } }).graph;
    expect(reg.edges.filter((e) => e.to === goal.id)).toEqual([]);
    expect(out.withheld).toContainEqual({ from: outcome.id, to: goal.id, reason: 'no_authored_direction' });
    // The fixture's stated 3-month deadline is asked first (construction-goal-losses-are-said.test.ts).
    expect(out.open_questions).toEqual(['Does "Productivity change" get there within 3 months? The model holds no deadline yet, so no result answers that.', QUESTION]);
  });

  it('CONTRAST: an outcome -> goal link with a STATED direction still reaches the goal, with that sign', () => {
    const m = admitCandidateModel(directedToGoal, {});
    const goal = m.nodes.find((n) => n.kind === 'goal')!;
    const outcome = m.nodes.find((n) => n.label === 'Productivity Improvement')!;
    for (const o of m.nodes.filter((n) => n.kind === 'option')) expect(reaches(m.edges, o.id, goal.id), o.label).toBe(true);
    const into = m.edges.filter((e) => e.to === goal.id);
    expect(into.map((e) => [e.from, e.effect_direction, e.provenance?.source])).toEqual([[outcome.id, 'positive', 'cee_hypothesis']]);
    expect(blockers(m).codes.filter((c) => STRUCTURAL.includes(c))).toEqual([]);
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
