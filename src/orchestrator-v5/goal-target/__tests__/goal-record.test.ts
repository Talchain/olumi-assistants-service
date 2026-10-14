import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGoalRecord, GOAL_RECORD_PRECEDENCE, type GoalRecord } from '../goal-record.js';
import { statedGoalTargetOf } from '../stated-goal-target.js';
import { goalDeadlineFromRecord, goalUnitOf, soleGoalOf } from '../goal-kind.js';
import { readHeldGoalComparator } from '../goal-direction.js';
import { scoredGoalIdOf } from '../../admission/target-testability.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

// Some historical text captures contain multiple JSON responses separated by
// prose. Decode each balanced JSON container, retaining its byte offset.
function decoded(text: string): Array<{ value: unknown; path: string }> {
  try { return [{ value: JSON.parse(text), path: '$' }]; } catch { /* historical multi-response capture */ }
  const values: Array<{ value: unknown; path: string }> = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < text.length; end++) {
      const c = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      if (depth !== 0) continue;
      try { values.push({ value: JSON.parse(text.slice(start, end + 1)), path: `$@${start}` }); start = end; } catch { /* try next container */ }
      break;
    }
  }
  return values;
}

interface Capture { file: string; path: string; graph: Rec; goal: Rec & { id: string } }
const captures: Capture[] = [];
// Fixed review scope: repository additions do not change this parity suite.
const manifest: string[] = JSON.parse(readFileSync(new URL('./fixtures/goal-record-parity-manifest.json', import.meta.url), 'utf8'));
function visit(value: unknown, file: string, path: string, container?: Rec): void {
  if (isRec(value)) {
    if (Array.isArray(value.nodes)) {
      const goals = value.nodes.filter((n): n is Rec & { id: string } => isRec(n) && n.kind === 'goal' && typeof n.id === 'string');
      for (const goal of goals) captures.push({ file, path, graph: value, goal });
      for (const [key, child] of Object.entries(value)) if (key !== 'nodes') visit(child, file, `${path}.${key}`, value);
      return;
    }
    // Real standalone node captures: wrap only to satisfy the graph API;
    // preserve any own constraint rows beside the capture, never fabricate IDs.
    if (value.kind === 'goal' && typeof value.id === 'string') {
      captures.push({ file, path, graph: { nodes: [value], ...(container?.goal_constraints !== undefined ? { goal_constraints: container.goal_constraints } : {}) }, goal: value as Rec & { id: string } });
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, file, `${path}.${key}`, value);
  } else if (Array.isArray(value)) {
    if (value.some(n => isRec(n) && n.kind === 'goal' && typeof n.id === 'string')) {
      visit({ nodes: value, ...(container?.goal_constraints !== undefined ? { goal_constraints: container.goal_constraints } : {}) }, file, path);
    } else value.forEach((child, i) => visit(child, file, `${path}[${i}]`, container));
  } else if (typeof value === 'string' && /^\s*[{[]/.test(value)) {
    for (const item of decoded(value)) visit(item.value, file, `${path}(JSON)${item.path}`);
  }
}
for (const file of manifest) for (const item of decoded(readFileSync(file, 'utf8'))) visit(item.value, file, item.path);

// Findings are exact, identity-bound exceptions. No conditional acceptance of
// arbitrary disagreement: any new mismatch fails the exhaustive findings row.
const KNOWN_FINDINGS: Array<{ reader: string; fixture: string; field: string; reader_value: unknown; record_value: unknown }> = [];
const observations: typeof KNOWN_FINDINGS = [];
const parity = captures.flatMap(c => {
  const stated = statedGoalTargetOf(c.graph, c.goal);
  const record = readGoalRecord(c.graph, c.goal.id);
  const values: Array<{ reader: string; field: string; expected: unknown; actual: unknown }> = [
    ...(['value', 'unit', 'frame', 'held'] as const).filter(k => stated?.[k] !== undefined).map(k => ({
      reader: 'statedGoalTargetOf', field: k, expected: stated?.[k],
      actual: record?.target?.[({ value: 'raw', unit: 'unit', frame: 'frame', held: 'comparator' } as const)[k]],
    })),
    { reader: 'goalDeadlineFromRecord', field: 'deadline', expected: goalDeadlineFromRecord(c.graph, c.goal.id), actual: record?.horizon?.deadline },
    { reader: 'goalUnitOf', field: 'unit', expected: goalUnitOf(c.goal), actual: record?.target?.unit },
    { reader: 'readHeldGoalComparator', field: 'comparator', expected: readHeldGoalComparator(c.graph, c.goal.id), actual: record?.target?.comparator },
    { reader: 'soleGoalOf', field: 'identity', expected: soleGoalOf(c.graph)?.id, actual: record?.goal_id },
    { reader: 'scoredGoalIdOf', field: 'identity', expected: scoredGoalIdOf(c.graph), actual: record?.goal_id },
  ];
  return values.filter(v => v.expected !== undefined && v.expected !== null).map(v => {
    const fixture = `${c.file}:${c.path}:${c.goal.id}`;
    if (v.expected !== v.actual) observations.push({ reader: v.reader, fixture, field: v.field, reader_value: v.expected, record_value: v.actual });
    return { ...v, fixture };
  });
});

describe('goal record: real stored parity', () => {
  it('pins the manifest scope and requires a goal capture from every listed file', () => {
    expect(manifest).toHaveLength(350);
    expect(new Set(manifest).size).toBe(manifest.length);
    for (const file of manifest) {
      // readFileSync above also fails if any listed file is missing.
      expect(captures.some(c => c.file === file), file).toBe(true);
    }
    expect(captures.every(c => typeof c.goal.id === 'string')).toBe(true);
  });
  it('pins every reader disagreement to exact fixture, identity and values', () => {
    console.log('FINDINGS', JSON.stringify(observations));
    expect(observations).toEqual(KNOWN_FINDINGS);
  });
  it.each(parity)('PARITY $reader $fixture $field', row => {
    const known = KNOWN_FINDINGS.find(f => f.reader === row.reader && f.fixture === row.fixture && f.field === row.field);
    if (known !== undefined) {
      expect(row.expected).toEqual(known.reader_value);
      expect(row.actual).toEqual(known.record_value);
      expect(row.actual).not.toEqual(row.expected);
    } else expect(row.actual).toEqual(row.expected);
  });
  it('horizon_basis present count is exactly zero, in storage and records', () => {
    expect(captures.filter(c => Object.hasOwn(c.goal, 'horizon_basis'))).toHaveLength(0);
    expect(captures.filter(c => Object.hasOwn(readGoalRecord(c.graph, c.goal.id) ?? {}, 'horizon_basis'))).toHaveLength(0);
  });
  it.each(captures)('retains input bytes and selects $goal.id in $file:$path', c => {
    const before = JSON.stringify(c.graph);
    const record = readGoalRecord(c.graph, c.goal.id);
    expect(record?.goal_id).toBe(c.goal.id);
    expect(record?.label).toBe(typeof c.goal.label === 'string' ? c.goal.label : '');
    expect(JSON.stringify(c.graph)).toBe(before);
  });
});

const multi = {
  goal_node_id: 'A', nodes: [
    { id: 'A', kind: 'goal', label: 'at least 100', goal_threshold_raw: 100, goal_direction: '>=' },
    { id: 'B', kind: 'goal', label: 'at least 999', goal_horizon: { deadline: '2027-01-01' }, goal_horizon_months: 12, goal_deadline_as_stated: 'by January', threshold_source: 'user', provenance: 'user_set' },
  ], goal_constraints: [
    { node_id: 'A', operator: '>=', value: 100, unit: 'customers', value_frame: 'level' },
    { node_id: 'B', operator: '<=', value: 7, deadline_metadata: {} },
    { node_id: 'B', operator: '<=', operator_as_stated: '<', value: 40, unit: '£', value_frame: 'level' },
  ],
};
describe('identity, precedence, absence and typed future basis', () => {
  it('MULTI-GOAL reads only B and B own non-deadline constraint, contrasting soleGoalOf', () => {
    expect(soleGoalOf(multi)).toBeUndefined();
    expect(scoredGoalIdOf(multi)).toBe('A');
    expect(goalDeadlineFromRecord(multi, 'B')).toBe('2027-01-01');
    expect(readGoalRecord(multi, 'B')?.horizon?.deadline).toBe(goalDeadlineFromRecord(multi, 'B'));
    expect(readGoalRecord(multi, 'B')).toEqual({
      goal_id: 'B', label: 'at least 999',
      target: { raw: 40, unit: '£', frame: 'level', comparator: '<', comparator_source: 'row_operator_as_stated', source: 'user' },
      horizon: { deadline: '2027-01-01', months: 12, as_stated: 'by January' }, provenance: 'user_set',
    });
  });
  it('horizon approved months precede legacy months (synthetic discriminator)', () => {
    const graph = { nodes: [{ id: 'B', kind: 'goal', label: 'B', goal_horizon: { months: 3 }, goal_horizon_months: 12 }] };
    expect(readGoalRecord(graph, 'B')?.horizon).toEqual({ months: 3 });
    expect(GOAL_RECORD_PRECEDENCE.horizon).toEqual(['goal_horizon', 'goal_horizon_months']);
  });
  // a2 ruling (S5, 9 Oct): horizon_basis sits BESIDE horizon and is never merged inside the reader; slice 2b's door rules.
  it.each([
    ['months', { goal_horizon: { months: 12 } }],
    ['deadline', { goal_horizon: { deadline: '2027-03-31' } }],
    ['legacy months', { goal_horizon_months: 9 }],
  ] as const)('horizon (%s) is byte-identical with and without a horizon_basis whose bound_months differs', (_name, fields) => {
    const basis = { basis: 'user_attestation', source: 'user', bound_months: 6, metric: 'MRR' };
    const without = readGoalRecord({ nodes: [{ id: 'B', kind: 'goal', label: 'B', ...fields }] }, 'B');
    const withBasis = readGoalRecord({ nodes: [{ id: 'B', kind: 'goal', label: 'B', ...fields, horizon_basis: basis }] }, 'B');
    expect(JSON.stringify(withBasis?.horizon)).toBe(JSON.stringify(without?.horizon));
    expect(withBasis?.horizon).not.toBeNull();
    expect(withBasis?.horizon_basis).toEqual(basis);
    expect(without?.horizon_basis).toBeUndefined();
    expect(GOAL_RECORD_PRECEDENCE.horizon_basis).toEqual(['horizon_basis (exact key, well-formed only): not merged; horizon = goal_horizon → goal_horizon_months']);
  });
  it('raw target row matches raw by identity and value, never a separate limit', () => {
    const graph = { nodes: [{ id: 'B', kind: 'goal', label: 'under 1', goal_threshold_raw: 40 }], goal_constraints: [
      { node_id: 'A', value: 40, operator: '<=' }, { node_id: 'B', value: 1, operator: '<=' },
      { node_id: 'B', value: 40, operator: '>=', operator_as_stated: '<', provenance: 'explicit' },
    ] };
    expect(readGoalRecord(graph, 'B')).toEqual({ goal_id: 'B', label: 'under 1', target: { raw: 40, comparator: '>=', comparator_source: 'row_operator' }, horizon: null, provenance: 'explicit' });
  });
  it('pins the documented node/row conflict rather than bending the record', () => {
    const goal = { id: 'B', kind: 'goal', label: 'B', goal_direction: '>=', goal_threshold_unit: 'customers' };
    const graph = { nodes: [goal], goal_constraints: [{ node_id: 'B', value: 40, operator: '<=', unit: '£' }] };
    expect(statedGoalTargetOf(graph, goal)).toEqual({ value: 40, held: '<=', unit: '£' });
    expect(readGoalRecord(graph, 'B')?.target).toEqual({ raw: 40, comparator: '>=', comparator_source: 'goal_direction', unit: 'customers' });
    expect(readHeldGoalComparator(graph, 'B')).toBe('>=');
    expect(goalUnitOf(goal)).toBe('customers');
  });
  it('pins blank unit conflict and observed unit fallback', () => {
    const goal = { id: 'B', kind: 'goal', label: 'B', goal_threshold_raw: 40, goal_threshold_unit: ' ', observed_state: { unit: '£' } };
    const graph = { nodes: [goal] };
    expect(statedGoalTargetOf(graph, goal)?.unit).toBe(' ');
    expect(goalUnitOf(goal)).toBe('£');
    expect(readGoalRecord(graph, 'B')?.target?.unit).toBe('£');
  });
  it('retains legacy months and words without inventing a deadline', () => {
    const graph = { nodes: [{ id: 'B', kind: 'goal', label: 'B', goal_horizon: { months: -1 }, goal_horizon_months: 12, goal_deadline_as_stated: 'within 12 months' }] };
    expect(readGoalRecord(graph, 'B')?.horizon).toEqual({ months: 12, as_stated: 'within 12 months' });
    expect(goalDeadlineFromRecord(graph, graph.nodes[0].id)).toBeUndefined();
  });
  it.each([null, 'graph', { nodes: {} }, { nodes: null }, { nodes: [null, 1, 'goal', { id: 'B', kind: 'factor' }] }])('ABSENT malformed graph %j', graph => {
    expect(() => readGoalRecord(graph, 'B')).not.toThrow();
    expect(readGoalRecord(graph, 'B')).toBeNull();
  });
  it('ABSENT unknown id; empty goal carries no invented facts', () => {
    expect(readGoalRecord(multi, 'missing')).toBeNull();
    expect(readGoalRecord({ nodes: [{ id: 'B', kind: 'goal', label: 'under 10' }] }, 'B')).toEqual({ goal_id: 'B', label: 'under 10', target: null, horizon: null });
  });
  it('is total for hostile getters, revoked proxies and malformed optional facts', () => {
    expect(readGoalRecord({ get nodes() { throw Error('bad'); } }, 'B')).toBeNull();
    const proxy = Proxy.revocable({}, {}); proxy.revoke();
    expect(readGoalRecord(proxy.proxy, 'B')).toBeNull();
    expect(readGoalRecord({ nodes: [{ id: 'B', kind: 'goal', label: 'B', goal_threshold_raw: Infinity, goal_direction: 'minimise', goal_threshold_unit: ' ', goal_horizon: { months: -1 }, goal_horizon_months: 0, goal_deadline_as_stated: ' ', threshold_source: 3 }] }, 'B')).toEqual({ goal_id: 'B', label: 'B', target: null, horizon: null });
  });
  it('reads well-formed horizon_basis typed, only from that exact key, without aliases', () => {
    const basis: NonNullable<GoalRecord['horizon_basis']> = { basis: 'user_attestation', source: 'user', bound_months: 12, metric: 'MRR' };
    const graph = { nodes: [{ id: 'B', kind: 'goal', label: 'B', horizon_basis: basis }] };
    expect(readGoalRecord(graph, 'B')?.horizon_basis).toEqual(basis);
    expect(readGoalRecord(graph, 'B')?.horizon_basis).not.toBe(basis);
    expect(readGoalRecord({ nodes: [{ id: 'B', kind: 'goal', label: 'B', goal_horizon_basis: basis }] }, 'B')).not.toHaveProperty('horizon_basis');
  });
  it.each([null, 'basis', {}, { basis: 'x', source: 'user', bound_months: '12', metric: 'MRR' }, { basis: 'x', source: 'user', bound_months: NaN, metric: 'MRR' }, { basis: '', source: 'user', bound_months: 12, metric: 'MRR' }, { basis: 'x', source: 'user', bound_months: -1, metric: 'MRR' }, { basis: 'x', source: 'user', bound_months: 12 }])('malformed horizon_basis %j is absent', horizon_basis => {
    expect(readGoalRecord({ nodes: [{ id: 'B', kind: 'goal', label: 'B', horizon_basis }] }, 'B')).not.toHaveProperty('horizon_basis');
  });
});
