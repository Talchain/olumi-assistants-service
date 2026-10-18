import { describe, expect, it } from 'vitest';
import { correctionWorld, type Rec } from './corrections-stage2-world.js';
import { userStatementRecord, userStatementFor } from '../../statement-door/statements.js';
import { createProposal } from '../proposal.js';

const cases = [
  { name: 'warehousing', goal: 'Average dispatch delay', value: 6, unit: 'days', comparator: '<=',
    aim: 'Understand delivery priorities', message: 'Change Average dispatch delay to understanding competing delivery priorities before testing process changes.' },
  { name: 'procurement', goal: 'Supplier resilience', value: 80, unit: 'score', comparator: '>=',
    aim: 'Understand disputed partner assumptions', message: 'Change Supplier resilience to understanding which assumptions our partners dispute before setting a threshold.' },
];
function fixture(row: typeof cases[number]) {
  const oldSource = `${row.goal} must be ${row.comparator} ${row.value} ${row.unit}.`;
  const source = userStatementRecord({ kind: 'goal', id: 'old_goal', field: 'target' }, [{ quote: oldSource, source: oldSource,
    speaker: 'user', reading: 'olumi', subject: { quantity: row.goal, node_id: 'old_goal' }, form: row.comparator === '<=' ? 'upper_bound' : 'lower_bound',
    ...(row.comparator === '<=' ? { high: row.value } : { low: row.value }), unit: row.unit }], '2026-08-01T00:00:00Z', { recorded_by: 'construction' });
  const graph: Rec = { goal_node_id: 'old_goal', nodes: [
    { id: 'old_goal', kind: 'goal', label: row.goal, provenance: 'from_brief', user_statements: [source],
      goal_direction: row.comparator, goal_threshold_raw: row.value, goal_threshold_unit: row.unit, goal_threshold_frame: 'level',
      goal_horizon: { deadline: '2027-01-01' }, goal_deadline_as_stated: 'before the annual review' },
    { id: 'factor', kind: 'factor', label: 'Process coverage', observed_state: { value: 0.5, raw_value: 50, unit: '%', source: 'cee_inference' } },
    { id: 'option_a', kind: 'option', label: 'Explore workflow changes', provenance: 'from_brief', interventions: { factor: { value: 0.8, raw_value: 80, unit: '%' } } },
    { id: 'option_b', kind: 'option', label: 'Keep current workflow', provenance: 'from_brief', interventions: { factor: { value: 0.5, raw_value: 50, unit: '%' } } },
    { id: 'dissent', kind: 'risk', label: 'Team reservation', provenance: 'unverified_brief', already_true_quote: 'The evening team disputes the mechanism.' },
  ], edges: [ { from: 'factor', to: 'old_goal', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.7, effect_direction: 'positive' },
    ...['option_a', 'option_b'].map(from => ({ from, to: 'factor', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' })) ],
    goal_constraints: [{ constraint_id: 'old_target', role: 'goal_target', node_id: 'old_goal', operator: row.comparator,
      value: row.value, unit: row.unit, value_frame: 'level', provenance: 'explicit', source_quote: oldSource }] };
  return { graph, request: { goal_id: 'old_goal', quote: row.message, label: row.aim } };
}
const withoutRef = ({ ref: _ref, ...node }: Rec) => node;

describe.each(cases)('$name: qualitative reframe on repoint_goal', row => {
  it('own card → one real register → readback → cold native read; numeric retirement is explicit', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, row.message);
    const result = await w.offer('propose_goal_target', { reframe: f.request });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(w.writes).toHaveLength(0);
    const pid = String(result.proposal_id), proposal = w.proposals.get(pid)!;
    expect(proposal.operations.map(o => o.op)).toEqual(['repoint_goal']);
    const chips = w.chips('propose_goal_target', result);
    expect(chips[0]!.id).toBe(`agent-approve-proposal:${pid}`); expect(chips[0]!.detail).toBe(result.public_label);
    expect(result.public_label).toContain('Earlier limits no longer apply to the new aim');
    expect(result.public_label).toContain(String(row.value));
    expect(result.public_label).toContain(row.unit);
    expect(result.public_label).toContain('no numeric target, baseline, unit, date, distribution');
    const restored = w.restoreCard(proposal, result, 'propose_goal_target');
    expect(restored.get(pid)).toEqual(proposal);
    const applied = await w.press(pid, restored);
    expect(applied, JSON.stringify({ applied, responses: w.responses })).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.registers).toHaveLength(1); expect(w.writes).toHaveLength(1);
    const goals = w.graph().nodes.filter((n: Rec) => n.kind === 'goal');
    expect(goals).toHaveLength(1); const goal = goals[0]!;
    expect(goal.label).toBe(row.aim);
    for (const key of ['goal_threshold_raw', 'goal_threshold', 'goal_threshold_unit', 'goal_threshold_cap', 'goal_threshold_frame', 'goal_direction', 'goal_period', 'success_threshold', 'goal_target_basis', 'goal_horizon', 'observed_state', 'distribution']) expect(goal).not.toHaveProperty(key);
    expect(w.graph().goal_constraints).toEqual([]);
    expect(w.graph().nodes.find((n: Rec) => n.id === 'old_goal')).toMatchObject({ kind: 'outcome', analysis_participation: 'retained_excluded',
      goal_threshold_raw: row.value, goal_threshold_unit: row.unit });
    expect(w.graph().nodes.find((n: Rec) => n.id === 'old_goal').user_statements).toEqual(f.graph.nodes[0].user_statements);
    expect(userStatementFor(w.graph(), { kind: 'goal', id: goal.id, field: 'measure' })?.statements[0]).toMatchObject({
      source: row.message, quote: row.message, speaker: 'user', reading: 'olumi', form: 'describes' });
    for (const id of ['factor', 'option_a', 'option_b', 'dissent']) expect(withoutRef(w.graph().nodes.find((n: Rec) => n.id === id))).toEqual(f.graph.nodes.find((n: Rec) => n.id === id));
    expect(w.graph().edges).toEqual(f.graph.edges);
    const saved = structuredClone(w.graph()), cold = await w.cold();
    expect(cold.status, JSON.stringify(cold.body)).toBe(200); expect(cold.body.graph).toEqual(saved);
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, already_applied: true }); expect(w.writes).toHaveLength(1);
  });

  it('an unrelated quote with an incidental number does not author a reframe', async () => {
    const f = fixture(row), quote = 'Revenue was £2m as of 2026-09-01; the filing deadline is next month.';
    const w = await correctionWorld(f.graph, quote);
    expect((await w.offer('propose_goal_target', { reframe: { ...f.request, quote } })).ok).toBe(false);
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(f.graph);
  });

  it('a numeric target supplied beside the qualitative request is refused rather than silently omitted', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, row.message);
    const result = await w.offer('propose_goal_target', { reframe: f.request, value: 99, unit: '%', constraint_type: 'at_least' });
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'mixed_goal_changes' }); expect(w.writes).toHaveLength(0);
  });

  it('stale source/goal state and a different card’s press do not write', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, row.message);
    const result = await w.offer('propose_goal_target', { reframe: f.request });
    expect(result.ok, JSON.stringify(result)).toBe(true); const pid = String(result.proposal_id);
    expect(await w.press(pid, w.proposals, false)).toMatchObject({ ok: false, mutated: false, refusal: 'approval_required' });
    w.change(g => { g.nodes.find((n: Rec) => n.id === 'old_goal').user_statements[0].recorded_at = '2026-08-02T00:00:00Z'; });
    expect(await w.press(pid)).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' }); expect(w.writes).toHaveLength(0);
  });

  it('a frozen candidate that loses another person’s dissent is refused at the native boundary', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, row.message);
    const result = await w.offer('propose_goal_target', { reframe: f.request });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const original = w.proposals.get(String(result.proposal_id))!, operations = structuredClone(original.operations);
    const candidate = (operations[0]!.value as Rec).candidate;
    candidate.nodes = candidate.nodes.filter((n: Rec) => n.id !== 'dissent');
    // Re-mint this exact altered card so its own identity and approval pass; the native postimage check must refuse it.
    const tampered = createProposal({ ...original, operations });
    w.proposals.put(tampered);
    const native = await w.press(tampered.proposal_id);
    expect(native).toMatchObject({ ok: false, mutated: false, refusal: 'incomplete_goal_postimage' }); expect(w.writes).toHaveLength(0);
  });

  it('Lane A B2: a quoted sentence inside a longer typed line keeps that complete source on approval and cold read', async () => {
    const f = fixture(row), line = `Thanks, that helps. ${row.message} Revenue was £2m as of 2026-09-01.`;
    const w = await correctionWorld(f.graph, line), result = await w.offer('propose_goal_target', { reframe: f.request });
    expect(result).toMatchObject({ ok: true, mutated: false });
    const pid = String(result.proposal_id), proposal = w.proposals.get(pid)!;
    const restored = w.restoreCard(proposal, result, 'propose_goal_target');
    expect(await w.press(pid, restored)).toMatchObject({ ok: true, applied: true });
    expect((proposal.operations[0]!.value as Rec).qualitative_reframe.source_line).toBe(line);
    expect(w.registers).toHaveLength(1); expect(w.writes).toHaveLength(1);
    const cold = await w.cold(), goal = cold.body.graph.nodes.find((n: Rec) => n.kind === 'goal');
    expect(userStatementFor(cold.body.graph, { kind: 'goal', id: goal.id, field: 'measure' })!.statements[0])
      .toMatchObject({ source: line, quote: row.message, speaker: 'user', reading: 'olumi' });
    expect(goal).not.toHaveProperty('goal_threshold_raw'); expect(goal).not.toHaveProperty('goal_horizon');
  });

  it('N4 shows plain retirement and source words on the card and in the reopened earlier aim', async () => {
    const f = fixture(row), w = await correctionWorld(f.graph, row.message), result = await w.offer('propose_goal_target', { reframe: f.request });
    expect(result.ok).toBe(true);
    expect(result.public_label).toContain(`Earlier saved bound:`);
    expect(result.public_label).toContain('Your quote stays yours; the reading remains Olumi’s');
    expect(result.public_label).not.toMatch(/\{"|constraint_id|node_id|value_frame|retained_excluded|goal_threshold|Earlier target\/measurement|active constraints/u);
    expect((await w.press(String(result.proposal_id))).ok).toBe(true);
    const cold = await w.cold(), old = cold.body.graph.nodes.find((n: Rec) => n.id === 'old_goal');
    expect(old.description).toContain(`Earlier saved bound:`);
    expect(old.description).toContain(`${row.value} ${row.unit}`);
    expect(old.description).toContain(f.graph.goal_constraints[0].source_quote);
    expect(old.description).not.toMatch(/\{"|constraint_id|node_id|value_frame|Complete earlier bound records/u);
  });
});
