import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGoalRecord } from '../goal-record.js';
import { heldGoalPointsUp, readHeldGoalComparator } from '../goal-direction.js';

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

// Frozen base at ae3ed2049079438c40e61eb49c1b9a4fc912c2df:
// readNodes and readHeldGoalComparator copied verbatim, with local names only.
type HeldComparator = '>=' | '<=' | '>' | '<';
const HELD_COMPARATORS: readonly string[] = ['>=', '<=', '>', '<'];
function baseReadNodes(graph: unknown): readonly Record<string, unknown>[] {
  if (graph === null || typeof graph !== 'object') return [];
  const nodes = (graph as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter(
    (n): n is Record<string, unknown> =>
      n !== null && typeof n === 'object' && !Array.isArray(n),
  );
}
function baseReadHeldGoalComparator(graph: unknown, goalNodeId: unknown): HeldComparator | null {
  if (typeof goalNodeId !== 'string' || goalNodeId === '') return null;
  for (const node of baseReadNodes(graph)) {
    if (node.id !== goalNodeId) continue;
    const held = node.goal_direction;
    return typeof held === 'string' && HELD_COMPARATORS.includes(held) ? (held as HeldComparator) : null;
  }
  return null;
}

const parity = captures.map(c => ({ ...c, before: baseReadHeldGoalComparator(c.graph, c.goal.id) }));
describe('held comparator record projection', () => {
  it('pins whole-manifest coverage, including null answers', () => {
    expect(manifest).toHaveLength(350);
    expect(new Set(manifest).size).toBe(manifest.length);
    for (const file of manifest) expect(captures.some(c => c.file === file), file).toBe(true);
    const nonNull = parity.filter(c => c.before !== null).length;
    const nulls = parity.length - nonNull;
    expect(nonNull).toBeGreaterThanOrEqual(198);
    expect(nulls).toBeGreaterThan(0);
    expect({ captures: parity.length, nonNull, nulls }).toEqual({ captures: 498, nonNull: 198, nulls: 300 });
    console.log('HELD PARITY', JSON.stringify({ files: manifest.length, captures: parity.length, nonNull, nulls }));
  });
  it.each(parity)('PARITY $file:$path:$goal.id', c => {
    const bytes = JSON.stringify(c.graph);
    expect(JSON.stringify(readHeldGoalComparator(c.graph, c.goal.id))).toBe(JSON.stringify(c.before));
    expect(JSON.stringify(c.graph)).toBe(bytes);
  });
  it('SYNTHETIC B conflict retains the node comparator', () => {
    const graph = { nodes: [{ id: 'B', kind: 'goal', label: 'B', goal_direction: '>=', goal_threshold_unit: 'customers' }],
      goal_constraints: [{ node_id: 'B', value: 40, operator: '<=', unit: '£' }] };
    expect(baseReadHeldGoalComparator(graph, 'B')).toBe('>=');
    expect(readHeldGoalComparator(graph, 'B')).toBe('>=');
    expect(readGoalRecord(graph, 'B')?.target).toEqual({ raw: 40, unit: 'customers', comparator: '>=', comparator_source: 'goal_direction' });
  });
  it.each([
    ['row_operator', { operator: '<=' }, '<='],
    ['row_operator_as_stated', { operator: '<=', operator_as_stated: '<' }, '<'],
    ['row_operator_as_stated', { operator: '>=', operator_as_stated: '>' }, '>'],
    ['row_operator', { operator: '<=', operator_as_stated: '>' }, '<='],
    ['row_operator', { operator: '<=', operator_as_stated: '<=' }, '<='],
  ] as const)('NEW ROW record source %s for %j stays absent in held reader', (source, operator, comparator) => {
    const graph = { nodes: [{ id: 'B', kind: 'goal', label: 'B' }],
      goal_constraints: [{ node_id: 'B', value: 40, ...operator }] };
    expect(readGoalRecord(graph, 'B')?.target).toEqual({ raw: 40, comparator, comparator_source: source });
    expect(baseReadHeldGoalComparator(graph, 'B')).toBeNull();
    expect(readHeldGoalComparator(graph, 'B')).toBeNull();
  });
  it('record comparator_source is absent exactly when comparator is absent', () => {
    for (const c of captures) {
      const target = readGoalRecord(c.graph, c.goal.id)?.target;
      expect(target?.comparator_source !== undefined).toBe(target?.comparator !== undefined);
      if (baseReadHeldGoalComparator(c.graph, c.goal.id) !== null) expect(target?.comparator_source).toBe('goal_direction');
    }
    expect(readGoalRecord({ nodes: [{ id: 'B', kind: 'goal', label: 'B', goal_threshold_unit: '£' }] }, 'B')?.target)
      .toEqual({ unit: '£' });
  });
  it('STRAY ROW narrows the frozen base to goals, including the helper', () => {
    const graph = { nodes: [{ id: 'factor-stray', kind: 'factor', label: 'Input', goal_direction: '>=' }] };
    expect(baseReadHeldGoalComparator(graph, 'factor-stray')).toBe('>=');
    expect(readGoalRecord(graph, 'factor-stray')).toBeNull();
    expect(readHeldGoalComparator(graph, 'factor-stray')).toBeNull();
    expect(heldGoalPointsUp(graph, 'factor-stray')).toBe(false);
  });
  it('duplicate goal ids still choose the first goal; a preceding factor is skipped', () => {
    const goals = [
      { id: 'B', kind: 'goal', label: 'First', goal_direction: '<=' },
      { id: 'B', kind: 'goal', label: 'Second', goal_direction: '>=' },
    ];
    expect(baseReadHeldGoalComparator({ nodes: goals }, 'B')).toBe('<=');
    expect(readHeldGoalComparator({ nodes: goals }, 'B')).toBe('<=');
    expect(readGoalRecord({ nodes: goals }, 'B')?.label).toBe('First');
    const graph = { nodes: [{ id: 'B', kind: 'factor', label: 'Stray', goal_direction: '>=' }, ...goals] };
    expect(baseReadHeldGoalComparator(graph, 'B')).toBe('>=');
    expect(readHeldGoalComparator(graph, 'B')).toBe('<=');
    expect(readGoalRecord(graph, 'B')?.label).toBe('First');
  });
  it.each([null, 42, '', undefined])('invalid id %j stays null', id => {
    const graph = { nodes: [{ id, kind: 'goal', label: 'B', goal_direction: '>=' }] };
    expect(baseReadHeldGoalComparator(graph, id)).toBeNull();
    expect(readHeldGoalComparator(graph, id)).toBeNull();
  });
});
