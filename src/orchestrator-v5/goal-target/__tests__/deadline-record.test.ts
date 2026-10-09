import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalDeadlineFromRecord, isIsoDate } from '../goal-kind.js';
import { admitEventByDate, draftedTeamPartOf, teamTimeAsk } from '../event-by-date-model.js';

import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { CandidateModel } from '../../agent-lane/admit-model.js';

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


// Frozen old body, copied before any deletion.
export function baseGoalDeadlineOf(goal: unknown): string | undefined {
  const h = isRec(goal) && isRec(goal.goal_horizon) ? goal.goal_horizon : undefined;
  const d = h?.deadline;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

const synthetics: Array<{ name: string; fields: Rec }> = [
  ...['2027-03-01', '2027-3-1', '', ' ', 20270301, null, 'March 2027', '2027-99-99'].map(deadline => ({ name: `deadline ${JSON.stringify(deadline)}`, fields: { goal_horizon: { deadline } } })),
  { name: 'months only', fields: { goal_horizon: { months: 3 } } },
  { name: 'array horizon', fields: { goal_horizon: [] } },
  { name: 'array horizon with deadline property', fields: { goal_horizon: Object.assign([], { deadline: '2027-03-01' }) } },
  { name: 'null horizon', fields: { goal_horizon: null } },
  { name: 'missing horizon', fields: {} },
  { name: 'legacy months and words', fields: { goal_horizon_months: 3, goal_deadline_as_stated: '2027-03-01' } },
  { name: 'invalid deadline with legacy months', fields: { goal_horizon: { deadline: 'March 2027' }, goal_horizon_months: 3 } },
];
const narrowing = [
  { name: 'both deadline and months', fields: { goal_horizon: { deadline: '2027-03-01', months: 3 } } },
  { name: 'deadline and invalid months', fields: { goal_horizon: { deadline: '2027-03-01', months: -1 } } },
  { name: 'deadline and extra key', fields: { goal_horizon: { deadline: '2027-03-01', extra: true } } },
];
const positiveDates = ['2027-03-01', '2027-04-07', '2028-02-29'];
// The 498 manifest captures have no drafted team part. Build the committed
// event-by-date-typed-flag B3 shape deterministically and set a held deadline.
const eventCandidate: CandidateModel = {
  goal: { kind: 'event_by_date', deliverable: 'the new platform', metric: 'Platform completion',
    operator: '>=', unit: '%', value: null, target_stated: false, frame: 'level',
    baseline_known: false, baseline_value: null, horizon_months: null, provenance: 'inferred' },
  options: [
    { label: 'Current team', provenance: 'ai_proposed', is_status_quo: true, added_capacity: null },
    { label: 'Hire two senior engineers', provenance: 'explicit',
      added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Hire four junior engineers', provenance: 'explicit',
      added_capacity: { monthly_share_pct: 10, lead_months_low: 3, lead_months_high: 5 } },
  ], factors: [], constraints: [], risks: [], outcomes: [], links: [], identities: [],
};
function positiveEventGraph() {
  const graph = GraphV3.parse(admitEventByDate(eventCandidate));
  const goal = graph.nodes.find(n => n.kind === 'goal')!;
  goal.goal_horizon = { deadline: '2028-02-29' };
  return graph;
}
const rows = [
  ...captures.map(c => ({ name: `${c.file}:${c.path}:${c.goal.id}`, graph: c.graph, goal: c.goal })),
  ...synthetics.map(c => { const goal = { id: 'B', kind: 'goal', ...c.fields }; return { name: c.name, graph: { nodes: [goal] }, goal }; }),
];
const identityPaths = ['event-by-date-model.ts:226', 'event-by-date-model.ts:342', 'decision-input-ask.ts:381', 'team-share-write.ts:72', 'runtime/agent-capabilities.ts:3157', 'runtime/agent-capabilities.ts:4612', 'goal-horizon-write.ts:73', 'goal-horizon-write.ts:108'];
const identityRows = captures.flatMap(c => {
  const part = draftedTeamPartOf(c.graph);
  return part === null ? [] : identityPaths.map(path => ({ path, capture: `${c.file}:${c.path}`, goal: part.goal, graph: c.graph }));
});
describe('deadline record canonical parity', () => {
  it('reports every difference without exceptions', () => {
    const differences = rows.flatMap(r => {
      const oldValue = baseGoalDeadlineOf(r.goal), newValue = goalDeadlineFromRecord(r.graph, r.goal.id);
      return oldValue === newValue ? [] : [{ input: r.name, node: r.goal, old: oldValue ?? '<undefined>', new: newValue ?? '<undefined>' }];
    });
    console.log('DEADLINE_PARITY', JSON.stringify({ captures: captures.length, synthetics: synthetics.length, positiveDates: positiveDates.length, narrowing: narrowing.length, differences }));
    console.log('PART_IDENTITY', JSON.stringify({ rows: identityRows.length, captures: identityRows.length / identityPaths.length, paths: identityPaths }));
    expect(differences).toEqual([]);
  });
  it.each(rows)('PARITY $name', r => {
    expect(goalDeadlineFromRecord(r.graph, r.goal.id)).toBe(baseGoalDeadlineOf(r.goal));
  });
  it.each(identityPaths)('part.goal identity real-fixture path %s', path => {
    const eligible = identityRows.filter(r => r.path === path);
    console.log('PART_IDENTITY_PATH', JSON.stringify({ path, captures: captures.length, eligible: eligible.length }));
    for (const r of eligible) expect(r.goal).toBe((r.graph.nodes as Rec[]).find(n => n.id === r.goal.id));
  });
  it.each(positiveDates)('POSITIVE deadline-only graph %s', deadline => {
    const goal = { id: 'B', kind: 'goal', goal_horizon: { deadline } };
    const graph = { nodes: [{ id: 'first', kind: 'factor' }, goal] };
    expect(baseGoalDeadlineOf(goal)).toBe(deadline);
    expect(goalDeadlineFromRecord(graph, goal.id)).toBe(deadline);
  });
  it.each(narrowing)('NARROWING $name', row => {
    const goal = { id: 'B', kind: 'goal', ...row.fields };
    expect(baseGoalDeadlineOf(goal)).toBe('2027-03-01');
    expect(goalDeadlineFromRecord({ nodes: [goal] }, goal.id)).toBeUndefined();
    // NodeV3 already enforces the same strict schema at graph ingress.
    const parsed = GraphV3.parse({ nodes: [{ ...goal, id: 'b', label: 'Launch' }], edges: [] });
    expect(parsed.nodes[0]!.goal_horizon).toBeUndefined();
  });
  it.each(identityPaths)('POSITIVE part.goal identity and deadline path %s', path => {
    const graph = positiveEventGraph();
    const part = draftedTeamPartOf(graph);
    expect(part, path).not.toBeNull();
    expect(part!.goal).toBe(graph.nodes.find(n => n.id === part!.goal.id));
    expect(baseGoalDeadlineOf(part!.goal)).toBe('2028-02-29');
    expect(goalDeadlineFromRecord(graph, part!.goal.id)).toBe(baseGoalDeadlineOf(part!.goal));
  });
  it('MOVED teamTimeAsk reads its goal id, with a non-goal first-node control', () => {
    const graph = positiveEventGraph();
    const part = draftedTeamPartOf(graph)!;
    graph.nodes.sort((a, b) => Number(a.kind === 'goal') - Number(b.kind === 'goal'));
    expect(graph.nodes[0]!.id).not.toBe(part.goal.id);
    expect(teamTimeAsk(graph)).toBe('How long would the new platform take with the team you have now?');
  });
  it.each(['2027-03-01', '2028-02-29', '2027-99-99'])('format-only validator accepts %s', value => {
    expect(isIsoDate(value)).toBe(true);
  });
  it.each(['2027-3-1', '', ' ', 20270301, null, 'March 2027'])('format-only validator rejects %j', value => {
    expect(isIsoDate(value)).toBe(false);
  });
  it.each([undefined, null, '', 3, {}, []])('invalid goal id %j', goalId => {
    expect(goalDeadlineFromRecord({ nodes: [{ id: 'B', kind: 'goal', goal_horizon: { deadline: '2027-03-01' } }] }, goalId)).toBeUndefined();
  });
});
