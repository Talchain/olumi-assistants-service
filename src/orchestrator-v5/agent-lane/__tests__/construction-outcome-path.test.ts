import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as construction from '../runtime/build-model.js';
import { modelFacingToolResult } from '../licensed-run-view.js';
import * as validator from '../../../orchestrator/graph-structure-validator.js';
import { admitCandidateModel, type AdmittedModel, type CandidateModel } from '../admit-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

const BASE_GAP_RESULT = {
  "ok": true,
  "mutated": true,
  "model_version": {
    "version_number": 1
  },
  "nodes": 8,
  "edges": 8,
  "within_compact_limits": true,
  "size_retried": false,
  "construction_retried": true,
  "options": 2,
  "withheld": [],
  "projected_field_count": 18,
  "options_that_change_nothing": [],
  "goal_constraints_carried": 0,
  "open_questions": [
    "How much does \"Senior engineers\" change \"Annual salary spend\"? Nobody has said, so Olumi uses a placeholder sized to keep \"Annual salary spend\" within its range until you do."
  ],
  "not_represented": [
    "The goal direction (\">=\") is not carried by `goal_threshold`, which is a bare number. A consumer cannot tell a floor from a ceiling from the projection alone.",
    "Olumi's own hypothesis that \"Hire four junior engineers\" changes \"Hiring delay\" is kept, but nothing in the model says HOW — and a bare option-to-risk link stops the WHOLE model being analysed, not just that option. It has not been deleted, and no mediator or strength has been invented for it. Say which factor \"Hire four junior engineers\" changes that drives \"Hiring delay\" and the link can be redrawn through it — or say the link should go."
  ]
}; // Actual 2cf61b60 replay; no random pending-action fields in this fixture.
const SCENARIO = '00000000-0000-4000-8000-000000000044';
const BRIEF = 'Should we hire two senior engineers or four junior engineers? Keep annual salary spend under £400k. Hiring delay is a risk.';
const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });
const factor = (label: string) => ({ label, role: 'controllable', baseline_known: false, baseline_value: 0, unit: 'points', plausible_max: 100, provenance: 'inferred' });
function candidate(connected = false, extras = 0): CandidateModel {
  const names = Array.from({ length: extras }, (_, i) => `Added context ${i}`);
  return {
    goal: { metric: 'Platform completion', operator: '>=', value: null, unit: null, horizon_months: null, provenance: 'explicit' },
    options: [
      { label: 'Hire two senior engineers', provenance: 'explicit', changes: [], interventions: [{ factor_label: 'Senior engineers', value: 2, value_kind: 'absolute', unit: 'points', provenance: 'ai_proposed' }] },
      { label: 'Hire four junior engineers', provenance: 'explicit', changes: [], interventions: [{ factor_label: 'Junior engineers', value: 4, value_kind: 'absolute', unit: 'points', provenance: 'ai_proposed' }] },
    ],
    factors: [factor('Senior engineers'), factor('Junior engineers'), { ...factor('Annual salary spend'), role: 'observable', unit: 'GBP', plausible_max: 1000000 }, ...names.map(n => ({ ...factor(n), role: 'observable' }))],
    risks: [{ label: 'Hiring delay', provenance: 'explicit' }], outcomes: [], constraints: [], unknowns: [],
    links: [link('Senior engineers', 'Annual salary spend'), link('Junior engineers', 'Platform completion'), link('Hiring delay', 'Platform completion'),
      ...(connected ? [link('Senior engineers', 'Platform completion')] : []), ...names.map(n => link(n, 'Platform completion'))],
  } as CandidateModel;
}
type Graph = Pick<AdmittedModel, 'nodes' | 'edges' | 'goal_constraints'>;
function issues(g: Graph) {
  expect(construction, 'M3 path issue function exists').toHaveProperty('pathIssues');
  return (construction as typeof construction & { pathIssues: (g: Graph) => { option: string; dead_ends: string[]; issue: string }[] }).pathIssues(g);
}
async function replay(first: CandidateModel, retry = first) {
  const requests: { instructions: string; input: string }[] = [];
  let registered: Graph | undefined;
  let trace: construction.ConstructionTrace | undefined;
  const call = (async (req: { instructions: string; input: string }) => {
    requests.push(req); return { text: JSON.stringify(requests.length === 1 ? first : retry) };
  }) as construction.CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: Graph }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, versions: [] } };
  };
  const out = await construction.buildModelFromBrief(SCENARIO, BRIEF, dispatch, call, t => { trace = t; });
  return { requests, registered: registered!, trace, out };
}

// Stored 086e4624 shape transcribed from accel-b3-data/STORED.md, not a fabricated raw candidate.
const b3: Graph = {
  goal_constraints: [],
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Staffing' }, { id: 'platform_completion', kind: 'goal', label: 'Platform completion' },
    ...[['current_team', 'Current team'], ['hire_2_senior_engineers', 'Hire two senior engineers'], ['hire_4_junior_engineers', 'Hire four junior engineers'], ['hire_1_senior_and_2_junior', 'Hire one senior and two junior engineers']].map(([id, label]) => ({ id, kind: 'option', label })),
    ...[['senior_engineers_hired', 'Senior engineers hired'], ['junior_engineers_hired', 'Junior engineers hired'], ['annual_salary_spend', 'Annual salary spend']].map(([id, label]) => ({ id, kind: 'factor', label })),
    { id: 'hiring_lead_time_delay', kind: 'risk', label: 'Hiring lead time delay' },
  ],
  edges: [
    ...['current_team', 'hire_2_senior_engineers', 'hire_4_junior_engineers', 'hire_1_senior_and_2_junior'].map(to => ({ from: 'decision', to })),
    ...['current_team', 'hire_2_senior_engineers', 'hire_1_senior_and_2_junior'].map(from => ({ from, to: 'senior_engineers_hired' })),
    ...['current_team', 'hire_4_junior_engineers', 'hire_1_senior_and_2_junior'].map(from => ({ from, to: 'junior_engineers_hired' })),
    { from: 'senior_engineers_hired', to: 'annual_salary_spend' }, { from: 'junior_engineers_hired', to: 'annual_salary_spend' },
    { from: 'hiring_lead_time_delay', to: 'platform_completion' },
  ],
} as Graph;

describe('M3 outcome paths in the existing construction retry (0 LLM)', () => {
  it('row 1: B3 names exactly its four dead-end options and Annual salary spend; connected CONTROL', () => {
    const missing = issues(b3);
    expect(missing.map(x => x.option)).toEqual(['Current team', 'Hire two senior engineers', 'Hire four junior engineers', 'Hire one senior and two junior engineers']);
    for (const x of missing) { expect(x.dead_ends).toEqual(['Annual salary spend']); expect(x.issue).toContain(x.option); expect(x.issue).toContain('Platform completion'); expect(x.issue).toContain('Annual salary spend'); }
    const single = issues(admitCandidateModel(candidate()));
    expect(single.map(x => x.option)).toEqual(['Hire two senior engineers']);
    expect(single[0]!.issue).toContain('Senior engineers');
    expect(issues(admitCandidateModel(candidate(true)))).toEqual([]);
  });

  it('row 2: a limited terminal is harmless when the option reaches the goal another way; status quo excluded', () => {
    const model = candidate(true);
    model.constraints = [{ metric: 'Annual salary spend', operator: '<=', value: 400000, unit: 'GBP', provenance: 'explicit' }];
    expect(issues(admitCandidateModel(model))).toEqual([]);
    const g = { ...b3, nodes: b3.nodes.map(n => n.kind === 'option' ? { ...n, is_baseline: true } : n) };
    expect(issues(g)).toEqual([]);
  });

  it('row 3a: a retry connecting the option is asked and adopted', async () => {
    const r = await replay(candidate(), candidate(true));
    expect(r.requests).toHaveLength(2);
    expect(r.requests[1]!.input).toContain('Annual salary spend');
    expect(r.requests[1]!.input).toContain('nothing it changes reaches');
    expect(r.trace).toMatchObject({ outcome: 'adopted' });
    expect(issues(r.registered)).toEqual([]);
  });

  it('row 3b: connecting but dropping a user risk keeps the first draft and records the gap', async () => {
    const retry = candidate(true); retry.risks = []; retry.links = retry.links.filter(l => l.from !== 'Hiring delay');
    const r = await replay(candidate(), retry);
    expect(r.requests[1]!.input).toContain('nothing it changes reaches');
    expect(r.trace).toMatchObject({ outcome: 'kept_first' });
    expect(r.registered.nodes.some(n => n.label === 'Hiring delay')).toBe(true);
    expect(issues(r.registered).map(x => x.option)).toEqual(['Hire two senior engineers']);
    expect(r.out.construction_gaps).toEqual({ path_missing: [{ option: 'Hire two senior engineers', dead_ends: ['Annual salary spend'] }] });
  });

  it('row 3c: a path-only retry without strictly greater option reachability keeps the first', async () => {
    const r = await replay(candidate());
    expect(r.trace).toMatchObject({ outcome: 'kept_first' });
    expect(issues(r.registered)).toHaveLength(1);
  });

  it('row 3d: oversize drafts never ask path issues and preserve the size-only route bytes', async () => {
    const first = candidate(false, 20), retry = candidate(false, 2);
    const r = await replay(first, retry);
    expect(r.out.size_retried).toBe(true); expect(r.out.ok).toBe(true);
    expect(r.requests).toHaveLength(2);
    expect(r.requests[1]!.input).toBe(`${BRIEF}\n\nYour previous model, to shrink: ${JSON.stringify(first)}`);
    expect(r.requests[1]!.instructions).not.toContain('Repair only the listed construction issues');
    expect(r.trace).toMatchObject({ outcome: 'adopted' });
    if (process.env.M3_SIZE_BYTES) writeFileSync(process.env.M3_SIZE_BYTES, JSON.stringify(r));
  });

  it('r1 mixed mechanism and path: fixing only the mechanism is adopted', async () => {
    const first = candidate(); first.links.push(link('Hire four junior engineers', 'Hiring delay'));
    expect(construction.prepareProvisionalCandidate(first, BRIEF).mechanism_issues).toHaveLength(1);
    const retry = candidate(); retry.links.push(link('Junior engineers', 'Hiring delay'));
    expect(construction.prepareProvisionalCandidate(retry, BRIEF).mechanism_issues).toHaveLength(0);
    const r = await replay(first, retry);
    expect(r.trace).toMatchObject({ reasons: { mechanism: 1 }, outcome: 'adopted' });
    expect(r.requests[1]!.input).toContain('nothing it changes reaches');
    expect(issues(r.registered).map(x => x.option)).toEqual(['Hire two senior engineers']);
  });

  it('r1 mixed coverage and path: a retry must never reduce reached options', async () => {
    const first = candidate(); first.options[0]!.interventions = []; first.options[0]!.changes = ['Senior engineers'];
    const retry = candidate(); retry.links = retry.links.filter(l => l.from !== 'Junior engineers'); retry.links.push(link('Junior engineers', 'Annual salary spend'));
    const r = await replay(first, retry);
    expect(r.trace).toMatchObject({ outcome: 'kept_first' });
    expect(issues(r.registered)).toHaveLength(1);
  });

  it('r1 limit-only option: sink branch exempt; removing its constraint is a refusal', () => {
    const model = candidate(); model.constraints = [{ metric: 'Annual salary spend', operator: '<=', value: 400000, unit: 'GBP', provenance: 'explicit' }];
    const admitted = admitCandidateModel(model);
    expect(admitted.goal_constraints.map(c => c.node_id)).toContain('annual_salary_spend');
    expect(issues(admitted)).toEqual([]);
    expect(validator.validateGraphStructure(admitted as GraphV3T).violations.filter(v => v.option_id === 'hire_two_senior_engineers' && v.code === 'NO_PATH_TO_GOAL')).toEqual([]);
    const without = { ...admitted, goal_constraints: [] };
    expect(issues(without).map(x => x.option)).toEqual(['Hire two senior engineers']);
    expect(validator.validateGraphStructure(without as GraphV3T).violations.some(v => v.code === 'NO_PATH_TO_GOAL' && v.option_id === 'hire_two_senior_engineers')).toBe(true);
    expect([...validator.optionsWithoutGoalPath(without, new Set(['hire_two_senior_engineers']))]).toEqual([]);
  });

  it('r1 gap fields: base result bytes unchanged except typed construction gap', async () => {
    const first = candidate(); first.links.push(link('Hire four junior engineers', 'Hiring delay'));
    const r = await replay(first);
    expect(r.out.ok).toBe(true);
    if (process.env.M3_RECORD_BASE) { writeFileSync(process.env.M3_RECORD_BASE, JSON.stringify(r.out, null, 2)); return; }
    const { construction_gaps, ...visible } = r.out;
    expect(construction_gaps).toEqual({ path_missing: [{ option: 'Hire two senior engineers', dead_ends: ['Annual salary spend'] }] });
    expect(JSON.stringify(visible)).toBe(JSON.stringify(BASE_GAP_RESULT));
  });

  it('the reply model receives the path gap', async () => {
    const first = candidate(); first.links.push(link('Hire four junior engineers', 'Hiring delay'));
    const { out } = await replay(first);
    expect(out.ok).toBe(true);
    const result = { ...out };
    // The agent loop serialises this exact projection into its function_call_output.
    const payload = JSON.stringify(modelFacingToolResult('build_model_from_brief', result));
    const modelFacing = JSON.parse(payload) as typeof out;
    expect(modelFacing.construction_gaps).toEqual({ path_missing: [{ option: 'Hire two senior engineers', dead_ends: ['Annual salary spend'] }] });
    expect(payload).toContain('Hire two senior engineers');
    expect(payload).toContain('Annual salary spend');
    // Check figures in strings as well as numeric fields; none may be added in transport.
    const figures = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    expect(payload.match(figures)).toEqual(JSON.stringify(out).match(figures));
    expect(payload).toBe(JSON.stringify(out));
  });

  it('r2 progress uses exemptions: linking only an exempt option does not repair the asked option', async () => {
    const first = candidate();
    first.factors.push({ ...factor('Delivery readiness'), role: 'observable' } as CandidateModel['factors'][number]);
    first.constraints = [{ metric: 'Annual salary spend', operator: '<=', value: 400000, unit: 'GBP', provenance: 'explicit' }];
    first.links = [link('Senior engineers', 'Delivery readiness'), link('Junior engineers', 'Annual salary spend'), link('Hiring delay', 'Platform completion')];
    const prepared = construction.prepareProvisionalCandidate(first, BRIEF);
    expect([...prepared.mechanism_issues, ...prepared.level_gaps, ...prepared.baseline_gaps]).toEqual([]);
    const firstAdmitted = admitCandidateModel(first);
    expect(issues(firstAdmitted).map(x => x.option)).toEqual(['Hire two senior engineers']);
    expect([...validator.optionsWithoutGoalPath(firstAdmitted)]).toEqual(['hire_two_senior_engineers']);
    const retry = structuredClone(first);
    retry.links.push(link('Junior engineers', 'Platform completion'));
    expect([...validator.optionsWithoutGoalPath(admitCandidateModel(retry))]).toEqual(['hire_two_senior_engineers']);
    const r = await replay(first, retry);
    expect(r.requests).toHaveLength(2);
    const asked = JSON.parse(r.requests[1]!.input.match(/Construction issues: (\[[^\n]+\])\nCandidate to repair/)![1]!) as string[];
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('Hire two senior engineers');
    expect(asked[0]).not.toContain('Hire four junior engineers');
    expect(r.trace).toMatchObject({ outcome: 'kept_first' });
    expect(r.registered.edges.some(e => e.from === 'junior_engineers' && e.to === 'platform_completion')).toBe(false);
    expect(r.out.construction_gaps).toEqual({ path_missing: [{ option: 'Hire two senior engineers', dead_ends: ['Delivery readiness'] }] });
  });

  it('row 4: shared directed reachability and validator refusal/control agree (cycles, bidirected, multiple roots)', () => {
    expect(validator).toHaveProperty('reachableNodeIds');
    const reach = (validator as typeof validator & { reachableNodeIds: (e: { from: string; to: string; edge_type?: string }[], roots: string[], reverse?: boolean) => Set<string> }).reachableNodeIds;
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'b', to: 'goal' }, { from: 'dead', to: 'goal', edge_type: 'bidirected' }];
    expect([...reach(edges, ['goal'], true)].sort()).toEqual(['a', 'b', 'goal']);
    expect([...reach(edges, ['a', 'other'])].sort()).toEqual(['a', 'b', 'goal', 'other']);
    expect(validator.validateGraphStructure(b3 as GraphV3T).violations.some(v => v.code === 'NO_PATH_TO_GOAL')).toBe(true);
    const connected = { ...b3, goal_constraints: [{ constraint_id: 'salary', node_id: 'annual_salary_spend', operator: '<=', value: 400000, unit: 'GBP', provenance: 'explicit' }], edges: [...b3.edges, { from: 'senior_engineers_hired', to: 'platform_completion' }, { from: 'junior_engineers_hired', to: 'platform_completion' }] };
    expect(validator.validateGraphStructure(connected as GraphV3T).violations.filter(v => v.code === 'NO_PATH_TO_GOAL')).toEqual([]);
  });
});

// Kit census2.ts's recorded-output replay, with an independent option-path oracle and complete bytes for contrast.
it.skipIf(!process.env.M3_CENSUS_MANIFEST)('116-draft recorded census (0 LLM)', async () => {
  const files = JSON.parse(readFileSync(process.env.M3_CENSUS_MANIFEST!, 'utf8')) as string[];
  expect(files).toHaveLength(116);
  const rows: unknown[] = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const calls = (j.provider_calls ?? []).filter((p: { output_text?: string }) => typeof p.output_text === 'string' && p.output_text.length > 0);
    const brief = j.provider_calls?.[0]?.request?.input;
    if (!calls.length || typeof brief !== 'string') { rows.push({ f, skipped: true }); continue; }
    let i = 0, g: Graph | undefined;
    const reqs: unknown[] = []; let trace: construction.ConstructionTrace | undefined;
    const dispatch: InternalDispatch = async (p, b) => {
      if (p.endsWith('/graph/register')) { g = (b as { graph: Graph }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, versions: [] } };
    };
    try {
      const out = await construction.buildModelFromBrief(SCENARIO, brief, dispatch, (async req => { reqs.push(req); return { text: calls[Math.min(i++, calls.length - 1)].output_text, status: 'completed' }; }) as construction.CallStructuredModel, t => { trace = t; });
      // Deliberately independent oracle: contrast cannot depend on the implementation being added.
      const missing = (g?.nodes ?? []).filter(n => n.kind === 'option' && n.is_baseline !== true).filter(n => {
        const seen = new Set<string>(), pending = [n.id];
        while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); if (g!.nodes.some(x => x.id === id && x.kind === 'goal')) return false;
          pending.push(...g!.edges.filter(e => e.from === id && (e as { edge_type?: string }).edge_type !== 'bidirected').map(e => e.to)); }
        return true;
      }).map(n => n.label);
      const refused = g ? validator.validateGraphStructure(g as GraphV3T, { leaveOutInertRisks: true }).violations
        .filter(v => v.code === 'NO_PATH_TO_GOAL' && v.option_id !== undefined && !g!.nodes.some(n => n.id === v.option_id && n.is_baseline === true))
        .map(v => v.option_label) : [];
      rows.push({ f, ok: out.ok, graph_sha: g ? createHash('sha256').update(JSON.stringify(g)).digest('hex') : null,
        path_issues: refused.length, refused, goal_less_options: missing.length, missing, graph: g ?? null, out, requests: reqs, trace });
    } catch (e) { rows.push({ f, threw: String(e) }); }
  }
  writeFileSync(process.env.M3_CENSUS_OUT!, JSON.stringify(rows, null, 2));
}, 900000);
