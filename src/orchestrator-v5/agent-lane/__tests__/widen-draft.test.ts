/** P05b automatic draft widening: parallel passes, conservative merge, inert risks and exact fallback. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as admission from '../admit-model.js';
import type { AdmittedModel, CandidateModel } from '../admit-model.js';
import * as widening from '../runtime/widen-draft.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { risksTurnFromSignals, widenGate, widenTurnFromSignals } from '../method-turn/widen-turn.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { inertRiskBranch, preconditionRiskIds, withoutPreconditionRisks } from '../../../graph/inert-risk.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { CONSTRUCTION_TAIL_RESERVE_MS } from '../../../routes/agent-v1-turn.js';
import { log } from '../../../utils/telemetry.js';
import { recordingDrafter } from '../../drafter-raw/record.js';

type Rec = Record<string, any>;
const BRIEF = 'We want to deliver 20 features in six months. I propose Hire a Tech Lead. Today we have 0 Developer hires, 0 Tech lead hires, and 0 Contractor hours. Developer hires can range up to 10 people; Tech lead hires up to 10 people; Contractor hours up to 100 hours. Background demand is 10 enquiries, up to 100 enquiries.';
const SCENARIO = '99999999-9999-4999-8999-999999999999';
const RATIONALE = 'RATIONALE MUST NEVER REACH ANY USER VISIBLE GRAPH FIELD';
const ADMIT = admission.admitCandidateModel;
const factor = (label: string, unit = 'people', baseline = 0, max = 10): CandidateModel['factors'][number] => ({
  label, role: 'observable', baseline_known: true, baseline_value: baseline, unit, provenance: 'explicit', plausible_max: max,
});
const opt = (label: string, factorLabel: string, value: number, unit = 'people', provenance = 'explicit'): CandidateModel['options'][number] => ({
  label, provenance, changes: [], is_status_quo: false,
  interventions: [{ factor_label: factorLabel, value, unit, provenance: 'ai_proposed' }],
});
function candidate({ risks = 2, sameLever = false, nonSq = 3 }: { risks?: number; sameLever?: boolean; nonSq?: number } = {}): CandidateModel {
  const options = sameLever
    ? [opt('Hire a Tech Lead', 'Developer hires', 2), opt('Grow engineering team', 'Developer hires', 3, 'people', 'inferred'), opt('Recruit more developers', 'Developer hires', 4, 'people', 'inferred')]
    : [opt('Hire a Tech Lead', 'Tech lead hires', 1), opt('Hire Two Developers', 'Developer hires', 2, 'people', 'inferred'), opt('Use contractors', 'Contractor hours', 20, 'hours', 'inferred')];
  return {
    goal: { metric: 'Features delivered', operator: '>=', value: 20, unit: 'features', horizon_months: 6, provenance: 'explicit' },
    constraints: [],
    options: [{ label: 'Carry on as now', provenance: 'explicit', changes: [], interventions: [], is_status_quo: true }, ...options.slice(0, nonSq)],
    factors: [factor('Developer hires'), factor('Tech lead hires'), factor('Contractor hours', 'hours', 0, 100), { ...factor('Background demand', 'enquiries', 10, 100), role: 'external' }],
    risks: Array.from({ length: risks }, (_, i) => ({ label: i === 0 ? 'Supplier interruption' : 'Customer delay', provenance: 'explicit' })),
    outcomes: [{ label: 'Feature delivery capacity', provenance: 'inferred', unit: 'features', plausible_max: 100 }],
    links: ['Developer hires', 'Tech lead hires', 'Contractor hours'].map((from) => ({ from, to: 'Feature delivery capacity', direction: 'positive', provenance: 'inferred' })).concat([
      { from: 'Feature delivery capacity', to: 'Features delivered', direction: 'positive', provenance: 'inferred' },
    ]),
  };
}
const fixture = (args: Parameters<typeof candidate>[0] = {}) => {
  const c = candidate(args);
  return { candidate: c, admitted: ADMIT(c, {}, BRIEF), brief: BRIEF, deadlineAt: Date.now() + 60_000 };
};
const riskSuggestions = (sameLever = false) => [
  { label: 'Recruitment delay', category: 'timing', hits_id: 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'filling both developer roles quickly', watch_for: 'offers remain unaccepted' },
  { label: 'Coordination drag', category: 'people', mechanism: 'drives', hits_id: 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'new developers joining without slowing the team', watch_for: 'senior time spent on onboarding' },
  { label: 'Supplier disruption', category: 'external', mechanism: 'drives', hits_id: 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'tools remaining available during onboarding', watch_for: 'tool outages during delivery' },
  { label: 'Wrong bottleneck', category: 'dependency', hits_id: 'hire_a_tech_lead', through_id: sameLever ? 'developer_hires' : 'tech_lead_hires', through_direction: 'positive', affects_id: 'features_delivered', direction: 'negative', relies_on: 'a Tech Lead removing the main delivery blocker', watch_for: 'delays persist after the lead starts' },
];
const level = (value: number, unit = 'people', basis = 'A bounded pilot for the team to test') => ({ value, unit, estimate: true, basis });
const optionsArgs = () => ({ options: [
  { label: 'Combine lead and developer hires', acts_on: [{ factor_label: 'Developer hires', direction: 'positive', level: level(1) }, { factor_label: 'Tech lead hires', direction: 'positive', level: level(1) }], rationale: RATIONALE },
  { label: 'Try a contractor pilot', acts_on: [{ factor_label: 'Developer hires', direction: 'positive', level: level(1) }, { factor_label: 'Contractor hours', direction: 'positive', level: level(10, 'hours') }], rationale: RATIONALE },
] });
const isRisks = (req: Parameters<CallStructuredModel>[0]) => req.instructions.includes('suggest risks they have not considered');
const isOptions = (req: Parameters<CallStructuredModel>[0]) => req.instructions.startsWith('METHOD TURN:') && req.instructions.includes('propose_new_option');
function generator(risks: unknown = riskSuggestions(), options: unknown = optionsArgs()) {
  return vi.fn<CallStructuredModel>(async (req) => ({ text: JSON.stringify(isRisks(req) ? { risk_suggestions: risks } : options) }));
}
const addedNodes = (before: AdmittedModel, after: AdmittedModel, kind: string): Rec[] => {
  const ids = new Set(before.nodes.map((n) => n.id));
  return (after.nodes as unknown as Rec[]).filter((n) => n.kind === kind && !ids.has(n.id));
};
const graphOf = (a: AdmittedModel): Rec => ({ nodes: a.nodes, edges: a.edges, ...(a.goal_constraints.length ? { goal_constraints: a.goal_constraints } : {}) });
function expectOriginalIdentity(before: AdmittedModel, after: AdmittedModel) {
  for (const n of before.nodes) expect(after.nodes.find((x) => x.id === n.id), n.id).toEqual(n);
  for (const e of before.edges) expect(after.edges.find((x) => x.from === e.from && x.to === e.to), `${e.from}->${e.to}`).toEqual(e);
}
function builder(c: CandidateModel, pass: CallStructuredModel, brief = BRIEF, deadlineAt = Date.now() + 60_000) {
  let graph: Rec | undefined;
  const callStructured = vi.fn<CallStructuredModel>(async (req) => isRisks(req) || isOptions(req) ? pass(req) : { text: JSON.stringify(c) });
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, versions: [] } };
  };
  const promise = buildModelFromBrief(SCENARIO, brief, dispatch, callStructured, undefined, deadlineAt).then((out) => ({ out: out as Rec, graph, callStructured }));
  return { promise, callStructured };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('P05b automatic widening, rows bound to graph identity', () => {
  it('aw-rich: a rich draft still runs both passes and every existing node and edge stays byte-identical', async () => {
    const input = fixture();
    const bytes = JSON.stringify(input);
    const callStructured = generator();
    const out = await widening.widenDraft({ ...input, callStructured });
    expect(out).not.toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(out!.calls).toBe(2);
    expect(out).not.toHaveProperty('triggered');
    expect(out!.counts).toEqual({ options: 2, risks: 3 });
    expectOriginalIdentity(input.admitted, out!.admitted);
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it('aw-risks-only: both calls, empty options still ship at most three zero-edge risks with retained attachments', async () => {
    const input = fixture({ risks: 1 });
    const callStructured = generator(riskSuggestions(), { options: [] });
    const out = await widening.widenDraft({ ...input, callStructured });
    expect(out).not.toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(out!.calls).toBe(2);
    expect(out).not.toHaveProperty('triggered');
    const added = addedNodes(input.admitted, out!.admitted, 'risk');
    expect(added).toHaveLength(3);
    expect(out!.counts).toEqual({ options: 0, risks: 3 });
    expect(added.some((n) => n.draft_widening.hits.id === 'hire_a_tech_lead')).toBe(true);
    for (const risk of added) {
      expect(['from_brief', 'ai_inferred', 'user_set']).toContain(risk.provenance);
      expect(risk.proposed_by).toBe('olumi');
      expect(risk.analysis_participation).toBe('retained_excluded');
      expect(risk.draft_widening).toMatchObject({ provenance: 'ai_suggested_widen', hits: { kind: 'option' }, through: { id: expect.any(String) }, affects: { id: expect.any(String) }, mechanism: expect.any(String), relies_on: expect.any(String), watch_for: expect.any(String) });
      expect(out!.admitted.edges.filter((e) => e.from === risk.id || e.to === risk.id)).toEqual([]);
    }
    const g = graphOf(out!.admitted);
    const exempt = preconditionRiskIds(g.nodes, g.edges, []);
    const branch = inertRiskBranch(g.nodes, g.edges, []);
    for (const risk of added) { expect(exempt.has(risk.id)).toBe(true); expect(branch.has(risk.id)).toBe(true); }
    const compute = withoutPreconditionRisks(g) as Rec;
    expect(compute.nodes.filter((n: Rec) => added.some((r) => r.id === n.id))).toEqual([]);
    const beforeIssues = validateGraphStructure(graphOf(input.admitted) as never, { leaveOutInertRisks: true }).violations;
    const afterIssues = validateGraphStructure(g as never, { leaveOutInertRisks: true }).violations;
    expect(afterIssues).toEqual(beforeIssues);
    expect(out!.admitted.withheld).toEqual(input.admitted.withheld);
    expectOriginalIdentity(input.admitted, out!.admitted);
    expect(GraphV3.safeParse(g).success).toBe(true);
  });

  it('aw-shared-risk: an explicitly attached shared driver also stays out of the calculation', async () => {
    const input = fixture({ risks: 1 });
    const shared = { label: 'Demand disruption', category: 'external', mechanism: 'drives', hits_id: 'background_demand', through_id: 'background_demand', through_direction: 'positive', affects_id: 'features_delivered', direction: 'negative', relies_on: 'customer demand staying steady', watch_for: 'fewer enquiries arriving' };
    const out = await widening.widenDraft({ ...input, callStructured: generator([shared], { options: [] }) });
    expect(out).not.toBeNull();
    const added = addedNodes(input.admitted, out!.admitted, 'risk');
    expect(added).toHaveLength(1);
    expect(added[0]!.draft_widening.hits).toMatchObject({ id: 'background_demand', kind: 'factor' });
    const g = graphOf(out!.admitted);
    expect(preconditionRiskIds(g.nodes, g.edges, []).has(added[0]!.id)).toBe(true);
    expect((withoutPreconditionRisks(g) as Rec).nodes.some((n: Rec) => n.id === added[0]!.id)).toBe(false);
    expect(out!.admitted.edges.filter((e) => e.from === added[0]!.id || e.to === added[0]!.id)).toEqual([]);
  });

  it('aw-risk-exemption: malformed stamps, incident edges, limits, duplicates and unmarked orphans get no exemption', async () => {
    const input = fixture({ risks: 1 });
    const out = await widening.widenDraft({ ...input, callStructured: generator() });
    expect(out).not.toBeNull();
    const added = addedNodes(input.admitted, out!.admitted, 'risk')[0]!;
    const g = graphOf(out!.admitted);
    const check = (risk: Rec, nodes = g.nodes, edges = g.edges, limits: string[] = []) => preconditionRiskIds(nodes.map((n: Rec) => n.id === added.id ? risk : n), edges, limits).has(added.id);
    expect(check(added)).toBe(true);
    expect(check(added, g.nodes, [...g.edges, { from: added.id, to: 'features_delivered' }])).toBe(false);
    expect(check(added, g.nodes, g.edges, [added.id])).toBe(false);
    expect(check(added, [...g.nodes, added])).toBe(false);
    // Display provenance can be recomputed by the graph projection; the retained nested stamp is authoritative.
    expect(check({ ...added, provenance: 'ai_inferred' })).toBe(true);
    expect(check({ ...added, proposed_by: undefined })).toBe(false);
    expect(check({ ...added, analysis_participation: undefined })).toBe(false);
    expect(check({ ...added, draft_widening: undefined })).toBe(false);
    expect(check({ ...added, draft_widening: { ...added.draft_widening, hits: { id: 'missing_option', label: 'Missing option', kind: 'option' } } })).toBe(false);
    expect(check({ ...added, draft_widening: { ...added.draft_widening, through: { id: 'features_delivered', label: 'Features delivered', direction: 'positive' } } })).toBe(false);
    expect(check({ ...added, draft_widening: { ...added.draft_widening, affects: { id: 'developer_hires', label: 'Developer hires', direction: 'negative' } } })).toBe(false);
  });

  it('aw-options-only: both calls, empty risks still ship grounded estimates with basis and Olumi authorship', async () => {
    const input = fixture({ sameLever: true });
    const callStructured = generator([]);
    const out = await widening.widenDraft({ ...input, callStructured });
    expect(out).not.toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(out!.calls).toBe(2);
    expect(out).not.toHaveProperty('triggered');
    const added = addedNodes(input.admitted, out!.admitted, 'option');
    expect(added).toHaveLength(2);
    expect(out!.counts).toEqual({ options: 2, risks: 0 });
    const goalPath = new Set(['developer_hires', 'tech_lead_hires', 'contractor_hours']);
    for (const n of added) {
      expect(n.proposed_by).toBe('olumi');
      expect(['from_brief', 'ai_inferred', 'user_set']).toContain(n.provenance);
      expect(n.draft_widening.provenance).toBe('ai_suggested_widen');
      expect(Object.keys(n.interventions).some((id) => goalPath.has(id))).toBe(true);
      for (const setting of Object.values(n.interventions) as Rec[]) expect(setting).toMatchObject({ estimate: true, basis: expect.any(String), source: 'cee_hypothesis' });
    }
    expect(JSON.stringify(out!.admitted)).not.toContain(RATIONALE);
    expect(JSON.stringify(out!.admitted)).not.toContain('rationale');
    expectOriginalIdentity(input.admitted, out!.admitted);
    expect(GraphV3.safeParse(graphOf(out!.admitted)).success).toBe(true);
  });

  it('aw-both: B1 one-risk/two-option draft starts both calls before either resolves', async () => {
    const input = fixture({ risks: 1, nonSq: 2 });
    const releases: (() => void)[] = [];
    const callStructured = vi.fn<CallStructuredModel>((req) => new Promise((resolve) => {
      releases.push(() => resolve({ text: JSON.stringify(isRisks(req) ? { risk_suggestions: riskSuggestions() } : optionsArgs()) }));
    }));
    const promise = widening.widenDraft({ ...input, callStructured });
    await Promise.resolve();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(releases).toHaveLength(2);
    for (const release of releases) release();
    const out = await promise;
    expect(out!.calls).toBe(2);
    expect(out).not.toHaveProperty('triggered');
    expect(out!.counts.options).toBeGreaterThan(0);
    expect(out!.counts.risks).toBeGreaterThan(0);
    expect(out!.counts.options).toBeLessThanOrEqual(3);
    expect(out!.counts.risks).toBeLessThanOrEqual(3);
  });

  it.each(['risks', 'options'] as const)('aw-partial-%s-empty-or-invalid: the other pass ships after an empty, invalid or failed pass', async (dropped) => {
    for (const failure of ['empty', 'invalid', 'throw', 'incomplete'] as const) {
      const input = fixture({ risks: 1, nonSq: 2 });
      const bytes = JSON.stringify(input);
      const events = vi.spyOn(log, 'info').mockImplementation(() => {});
      const callStructured = vi.fn<CallStructuredModel>(async (req) => {
        const failed = dropped === 'risks' ? isRisks(req) : isOptions(req);
        if (failed && failure === 'throw') throw new Error('only this pass failed');
        if (failed && failure === 'invalid') return { text: 'not valid JSON' };
        if (failed && failure === 'incomplete') return { text: '', status: 'incomplete' };
        return { text: JSON.stringify(isRisks(req)
          ? { risk_suggestions: failed ? [] : riskSuggestions() }
          : failed ? { options: [] } : optionsArgs()) };
      });
      const out = await widening.widenDraft({ ...input, callStructured });
      expect(out, `${dropped} ${failure} must preserve the successful pass`).not.toBeNull();
      expect(callStructured).toHaveBeenCalledTimes(2);
      expect(out!.counts).toEqual(dropped === 'risks' ? { options: 2, risks: 0 } : { options: 0, risks: 3 });
      expectOriginalIdentity(input.admitted, out!.admitted);
      expect(JSON.stringify(input)).toBe(bytes);
      const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
      expect(event).toMatchObject({ outcome: 'widened', calls: 2, partial: true, enrichment_incomplete: false, counts: out!.counts });
      expect(event).not.toHaveProperty('triggered');
      events.mockRestore();
    }
  });

  it.each(['risks', 'options'] as const)('aw-partial-readmit-%s-refused: retry admission with only the surviving pass', async (dropped) => {
    const input = fixture({ risks: 1, nonSq: 2 });
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const spy = vi.spyOn(admission, 'admitCandidateModel').mockImplementation((c, ...rest) => {
      if (dropped === 'risks' ? c.risks.length > input.candidate.risks.length : c.options.length > input.candidate.options.length) {
        throw new Error(`${dropped} re-admission refused`);
      }
      return ADMIT(c, ...rest);
    });
    const callStructured = generator();
    const out = await widening.widenDraft({ ...input, callStructured });
    expect(out).not.toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(out!.counts).toEqual(dropped === 'risks' ? { options: 2, risks: 0 } : { options: 0, risks: 3 });
    const accepted = spy.mock.calls.find(([c]) => dropped === 'risks'
      ? c.risks.length === input.candidate.risks.length && c.options.length > input.candidate.options.length
      : c.options.length === input.candidate.options.length && c.risks.length > input.candidate.risks.length);
    expect(accepted, 'the surviving items must be re-admitted alone').toBeDefined();
    expectOriginalIdentity(input.admitted, out!.admitted);
    const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
    expect(event).toMatchObject({ outcome: 'widened', partial: true, enrichment_incomplete: false });
  });

  it('aw-all-empty: both calls still run, no additions return null and incomplete telemetry is explicit', async () => {
    const input = fixture();
    const bytes = JSON.stringify(input);
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const callStructured = generator([], { options: [] });
    expect(await widening.widenDraft({ ...input, callStructured })).toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(input)).toBe(bytes);
    const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
    expect(event).toMatchObject({ calls: 2, outcome: 'empty_gate', enrichment_incomplete: true, counts: { options: 0, risks: 0 } });
    expect(event).not.toHaveProperty('triggered');
  });

  it('aw-no-budget: less than five seconds in the real turn tail skips both calls byte-identically', async () => {
    const input = fixture();
    const now = 1_800_000_000_000;
    input.deadlineAt = now - CONSTRUCTION_TAIL_RESERVE_MS + 8_000 + 4_999;
    const bytes = JSON.stringify(input);
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const callStructured = generator();
    expect(await widening.widenDraft({ ...input, clock: () => now, callStructured })).toBeNull();
    expect(callStructured).toHaveBeenCalledTimes(0);
    expect(JSON.stringify(input)).toBe(bytes);
    const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
    expect(event).toMatchObject({ calls: 0, outcome: 'no_budget', enrichment_incomplete: true, counts: { options: 0, risks: 0 } });
    expect(event).not.toHaveProperty('triggered');
  });

  it('aw-deadline-cap: a real construction deadline preserves the eight-second tail under fake timers', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const input = fixture({ risks: 1, nonSq: 2 });
    input.deadlineAt = now - CONSTRUCTION_TAIL_RESERVE_MS + 8_000 + 6_000;
    let settled = false;
    let result: unknown;
    const events = vi.spyOn(log, 'info').mockImplementation(() => {});
    const callStructured = vi.fn<CallStructuredModel>(() => new Promise(() => {}));
    const promise = widening.widenDraft({ ...input, callStructured: recordingDrafter(callStructured, []) }).then((out) => { settled = true; result = out; });
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(callStructured.mock.calls.map(([, deadlineAt]) => deadlineAt)).toEqual([now + 6_000, now + 6_000]);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled, 'the 6 s deadline budget must cap the default 20 s timeout').toBe(true);
    expect(result).toBeNull();
    const event = events.mock.calls.find(([, message]) => message === 'agent_draft_widen')![0] as Rec;
    expect(event).toMatchObject({ outcome: 'timeout', calls: 2, ms: 6_000, enrichment_incomplete: true });
    if (settled) await promise;
  });

  it('aw-timeout: a never-resolving call closes at exactly the default 20 second cap', async () => {
    vi.useFakeTimers();
    const input = fixture({ risks: 1 });
    const bytes = JSON.stringify(input);
    let settled = false;
    let result: unknown;
    const promise = widening.widenDraft({ ...input, callStructured: vi.fn<CallStructuredModel>(() => new Promise(() => {})) }).then((out) => { settled = true; result = out; });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled, 'deadline must settle even when the provider never does').toBe(true);
    expect(result).toBeNull();
    expect(JSON.stringify(input)).toBe(bytes);
    if (settled) await promise;
  });

  it('aw-injected-timeout: a shorter injected cap and clock close a pending pass', async () => {
    vi.useFakeTimers();
    let settled = false;
    const input = fixture({ risks: 1 });
    const clock = vi.fn(() => 42);
    const promise = widening.widenDraft({ ...input, timeoutMs: 7, clock, callStructured: vi.fn<CallStructuredModel>(() => new Promise(() => {})) }).then((out) => { settled = true; expect(out).toBeNull(); });
    await vi.advanceTimersByTimeAsync(7);
    expect(settled).toBe(true);
    expect(clock).toHaveBeenCalled();
    if (settled) await promise;
  });

  it('aw-late-timeout: a provider resolving after the cap cannot trigger readmission', async () => {
    vi.useFakeTimers();
    const input = fixture({ risks: 1 });
    const bytes = JSON.stringify(input);
    const spy = vi.spyOn(admission, 'admitCandidateModel');
    let release: (() => void) | undefined;
    const callStructured = vi.fn<CallStructuredModel>(() => new Promise((resolve) => {
      release = () => resolve({ text: JSON.stringify({ risk_suggestions: riskSuggestions() }) });
    }));
    const promise = widening.widenDraft({ ...input, callStructured });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await promise).toBeNull();
    expect(spy).toHaveBeenCalledTimes(0);
    expect(release).toBeDefined();
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(spy, 'late generation must stop before admission or telemetry can change').toHaveBeenCalledTimes(0);
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it('aw-same-admission: widening forwards the brief and every original admission callback', async () => {
    const input = fixture({ risks: 1 });
    const goalLevelStated = () => false;
    const writtenAgain = () => false;
    const goalFromBrief = () => null;
    const sizeWritten = () => false;
    const sizeRangeEnd = () => null;
    const spy = vi.spyOn(admission, 'admitCandidateModel');
    const admissionArgs = [goalLevelStated, writtenAgain, goalFromBrief, sizeWritten, sizeRangeEnd] as const;
    const out = await widening.widenDraft({ ...input, admissionArgs: [...admissionArgs], callStructured: generator() });
    expect(out).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]!.slice(1)).toEqual([{}, BRIEF, ...admissionArgs]);
  });

  it.each(['throw', 'empty-gate', 'readmit-refusal', 'graph-invalid'] as const)('aw-%s: fail closed without mutating the original graph', async (failure) => {
    const input = fixture({ risks: 1 });
    const bytes = JSON.stringify(input);
    const callStructured = failure === 'throw' ? vi.fn<CallStructuredModel>(async () => { throw new Error('provider failed'); }) : generator(failure === 'empty-gate' ? [] : riskSuggestions(), failure === 'empty-gate' ? { options: [] } : optionsArgs());
    if (failure === 'readmit-refusal') vi.spyOn(admission, 'admitCandidateModel').mockImplementation(() => { throw new Error('readmission refused'); });
    if (failure === 'graph-invalid') vi.spyOn(admission, 'admitCandidateModel').mockImplementation((c, ...rest) => {
      const admitted = ADMIT(c, ...rest);
      return { ...admitted, nodes: [...admitted.nodes, { id: 'invalid', kind: 'invalid', label: 'Invalid added entity' } as never] };
    });
    expect(await widening.widenDraft({ ...input, callStructured })).toBeNull();
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it('aw-existing-unchanged: refuse any readmission that changes one pre-existing node or edge', async () => {
    const input = fixture({ risks: 1 });
    const bytes = JSON.stringify(input);
    vi.spyOn(admission, 'admitCandidateModel').mockImplementation((c, ...rest) => {
      const a = ADMIT(c, ...rest);
      return { ...a, nodes: a.nodes.map((n, i) => i === 0 ? { ...n, label: 'Silently changed original label' } : n) };
    });
    expect(await widening.widenDraft({ ...input, callStructured: generator() })).toBeNull();
    expect(JSON.stringify(input)).toBe(bytes);
  });

  it('aw-existing-edge-unchanged: refuse a pre-existing edge whose mean changes', async () => {
    const input = fixture({ risks: 1 });
    vi.spyOn(admission, 'admitCandidateModel').mockImplementation((c, ...rest) => {
      const a = ADMIT(c, ...rest);
      return { ...a, edges: a.edges.map((e, i) => i === 0 ? { ...e, strength: { ...e.strength, mean: 0.123 } } : e) };
    });
    expect(await widening.widenDraft({ ...input, callStructured: generator() })).toBeNull();
  });

  it('aw-existing-demotion: refuse a new option that would change an original context factor category', async () => {
    const c = candidate({ sameLever: true });
    const original: CandidateModel = { ...c, factors: c.factors.map((f) => f.label === 'Tech lead hires' || f.label === 'Contractor hours' ? { ...f, role: 'controllable' as const } : f) };
    const admitted = ADMIT(original, {}, BRIEF);
    expect(admitted.nodes.find((n) => n.id === 'contractor_hours')!.category).toBe('external');
    expect(await widening.widenDraft({ candidate: original, admitted, brief: BRIEF, deadlineAt: Date.now() + 60_000, callStructured: generator([]) })).toBeNull();
  });

  it('aw-convention: never set or overwrite an Olumi-convention factor cap', async () => {
    const input = fixture({ sameLever: true });
    input.admitted = { ...input.admitted, nodes: input.admitted.nodes.map((n) => n.id === 'developer_hires' ? { ...n, observed_state: { ...n.observed_state!, frame_source: 'olumi_convention' as const, value: 0, cap: 37 } } : n) };
    const cap = input.admitted.nodes.find((n) => n.id === 'developer_hires');
    const out = await widening.widenDraft({ ...input, callStructured: generator() });
    // A readmission that cannot reproduce the original cap must discard the widening.
    if (out !== null) expect(out.admitted.nodes.find((n) => n.id === 'developer_hires')).toEqual(cap);
    expect(input.admitted.nodes.find((n) => n.id === 'developer_hires')).toEqual(cap);
  });

  it('aw-nonpath-option: background-only intervention is dropped', async () => {
    const input = fixture({ sameLever: true });
    const callStructured = generator([], { options: [{ label: 'Watch background demand', acts_on: [{ factor_label: 'Background demand', direction: 'positive', level: level(20, 'enquiries') }], rationale: RATIONALE }] });
    expect(await widening.widenDraft({ ...input, callStructured })).toBeNull();
  });

  it.each(['label', 'basis'] as const)('aw-option-ranking-%s: generated suggestions never claim superiority', async (field) => {
    const input = fixture({ sameLever: true });
    const args = optionsArgs();
    if (field === 'label') {
      args.options[0]!.label = 'Better contractor pilot';
      args.options[1]!.label = 'Better hiring pilot';
    } else {
      for (const option of args.options) for (const act of option.acts_on) act.level.basis = 'This is the best choice';
    }
    expect(await widening.widenDraft({ ...input, callStructured: generator([], args) })).toBeNull();
  });

  it.each([undefined, '', '   '])('aw-basis: drop levels with missing or empty basis %s', async (basis) => {
    const input = fixture({ sameLever: true });
    const args = optionsArgs();
    for (const o of args.options) for (const a of o.acts_on) (a.level as Rec).basis = basis;
    expect(await widening.widenDraft({ ...input, callStructured: generator([], args) })).toBeNull();
  });

  it('aw-directive-pin: each pass uses the existing route directive byte for byte and a bounded JSON schema', async () => {
    const input = fixture({ risks: 1, nonSq: 2 });
    const s = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [], graph: graphOf(input.admitted), analysisState: undefined, analysisResult: undefined, optionParticipation: undefined, leaderLicensed: false });
    const risksTurn = risksTurnFromSignals(s, graphOf(input.admitted), BRIEF);
    const optionsTurn = widenTurnFromSignals(s, graphOf(input.admitted));
    expect(risksTurn.kind).toBe('run_risks');
    expect(optionsTurn.kind).toBe('run');
    const callStructured = generator();
    await widening.widenDraft({ ...input, callStructured });
    const requests = callStructured.mock.calls.map(([req]) => req);
    expect(requests.find(isRisks)!.instructions).toBe((risksTurn as Rec).directive);
    expect(requests.find(isOptions)!.instructions).toBe((optionsTurn as Rec).directive);
    for (const req of requests) { expect(req.schema.type).toBe('object'); expect(req.max_output_tokens).toBeLessThanOrEqual(3000); }
  });

  it('aw-option-lever-classification: only a goal-path factor moved by no other option is a new lever', async () => {
    const input = fixture({ risks: 1, nonSq: 2 });
    const out = await widening.widenDraft({ ...input, callStructured: generator() });
    expect(out).not.toBeNull();
    const added = addedNodes(input.admitted, out!.admitted, 'option');
    const mix = added.find((n) => n.id === 'combine_lead_and_developer_hires')!;
    const pilot = added.find((n) => n.id === 'try_a_contractor_pilot')!;
    expect(mix).toBeDefined();
    expect(pilot).toBeDefined();
    const graph = graphOf(out!.admitted);
    const bytes = JSON.stringify(graph);
    expect(widening.classifyWidenedOptions(graph)).toEqual({ [mix.id]: 'SAME_LEVER', [pilot.id]: 'NEW_LEVER' });
    expect(JSON.stringify(graph)).toBe(bytes);
    // Another option moving that same factor removes its uniqueness, regardless of display wording.
    const shared = { ...graph, nodes: [...graph.nodes, { ...pilot, id: 'another_contractor_pilot', draft_widening: undefined }] };
    expect(widening.classifyWidenedOptions(shared)[pilot.id]).toBe('SAME_LEVER');
    const nonpath = { ...graph, nodes: [...graph.nodes, { ...pilot, id: 'background_only', interventions: { background_demand: { value: 0.2 } } }] };
    expect(widening.classifyWidenedOptions(nonpath).background_only).toBe('SAME_LEVER');
    expect(widening.classifyWidenedOptions(graphOf(input.admitted))).toEqual({});
  });

  it('aw-schema-origin: NodeV3 keeps existing provenance values and strict optional widening metadata', async () => {
    const input = fixture({ risks: 1, nonSq: 2 });
    const out = await widening.widenDraft({ ...input, callStructured: generator() });
    const graph = graphOf(out!.admitted);
    const addedRisk = addedNodes(input.admitted, out!.admitted, 'risk')[0]!;
    expect(GraphV3.safeParse(graph).success).toBe(true);
    const withRisk = (patch: Rec) => ({ ...graph, nodes: graph.nodes.map((n: Rec) => n.id === addedRisk.id ? { ...n, ...patch } : n) });
    expect(GraphV3.safeParse(withRisk({ provenance: 'ai_suggested_widen' })).success).toBe(false);
    expect(GraphV3.safeParse(withRisk({ draft_widening: { ...addedRisk.draft_widening, unrecognised: true } })).success).toBe(false);
    expect(GraphV3.safeParse(withRisk({ draft_widening: { ...addedRisk.draft_widening,
      affects: { ...addedRisk.draft_widening.affects, direction: 'sideways' } } })).success).toBe(false);
  });
});

describe('P05b build seam and words', () => {
  it('aw-build-no-budget: zero widening calls and byte-identical persisted graph when the turn tail is exhausted', async () => {
    const c = candidate({ risks: 1, nonSq: 2 });
    vi.spyOn(widening, 'widenDraft').mockResolvedValueOnce(null);
    const baseline = await builder(c, generator()).promise;
    vi.restoreAllMocks();
    const pass = generator();
    const deadlineAt = Date.now() - CONSTRUCTION_TAIL_RESERVE_MS + 8_000 + 4_000;
    const actual = await builder(c, pass, BRIEF, deadlineAt).promise;
    expect(actual.out.ok).toBe(true);
    expect(pass).toHaveBeenCalledTimes(0);
    expect(actual.out).not.toHaveProperty('widened');
    expect(JSON.stringify(actual.graph)).toBe(JSON.stringify(baseline.graph));
  });

  it('aw-build-timeout: draft ships byte-identical after provider hangs for 20 seconds', async () => {
    const c = candidate({ risks: 1 });
    vi.spyOn(widening, 'widenDraft').mockResolvedValueOnce(null);
    const baseline = await builder(c, generator()).promise;
    vi.restoreAllMocks();
    vi.useFakeTimers();
    let actual: Awaited<ReturnType<typeof builder>['promise']> | undefined;
    const run = builder(c, vi.fn<CallStructuredModel>(() => new Promise(() => {})));
    run.promise.then((out) => { actual = out; });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(actual, 'build must finish when widening times out').toBeDefined();
    expect(actual!.out.ok).toBe(true);
    expect(JSON.stringify(actual!.graph)).toBe(JSON.stringify(baseline.graph));
  });

  it.each(['throw', 'empty-gate'] as const)('aw-build-%s: fail-closed persisted graph is byte-identical', async (failure) => {
    const c = candidate({ risks: 1 });
    vi.spyOn(widening, 'widenDraft').mockResolvedValueOnce(null);
    const baseline = await builder(c, generator()).promise;
    vi.restoreAllMocks();
    const pass = failure === 'throw' ? vi.fn<CallStructuredModel>(async () => { throw new Error('provider failed'); }) : generator([], { options: [] });
    const actual = await builder(c, pass).promise;
    expect(actual.out.ok).toBe(true);
    expect(JSON.stringify(actual.graph)).toBe(JSON.stringify(baseline.graph));
  });

  it('aw-build-widened: counted options and risks reach registered GraphV3 and ToolResult', async () => {
    const pass = generator();
    const actual = await builder(candidate({ risks: 1, nonSq: 2 }), pass).promise;
    expect(actual.out.ok, JSON.stringify(actual.out)).toBe(true);
    expect(pass).toHaveBeenCalledTimes(2);
    expect(actual.out.widened).toEqual({ options: expect.any(Number), risks: 3 });
    expect(actual.out.widened.options).toBeGreaterThan(0);
    const added = actual.graph!.nodes.filter((n: Rec) => n.draft_widening?.provenance === 'ai_suggested_widen');
    expect(added.filter((n: Rec) => n.kind === 'risk')).toHaveLength(actual.out.widened.risks);
    expect(added.filter((n: Rec) => n.kind === 'option')).toHaveLength(actual.out.widened.options);
    expect(GraphV3.safeParse(actual.graph).success).toBe(true);
    expect(JSON.stringify(actual.graph)).not.toContain(RATIONALE);
  });

  const goldenDrafts = (JSON.parse(readFileSync(new URL('./fixtures/keep-risks-live-drafts-20260930.json', import.meta.url), 'utf8')) as { drafts: { id: string; brief: string; raw: string }[] }).drafts.filter((d) => ['mrr-12m', 'hiring', 'funding'].includes(d.id));
  it.each(goldenDrafts)('aw-golden-census $id: widening adds no withheld link or new risk readiness failure', async (d) => {
    const c = JSON.parse(d.raw) as CandidateModel;
    vi.spyOn(widening, 'widenDraft').mockResolvedValueOnce(null);
    const baseline = await builder(c, generator(), d.brief).promise;
    vi.restoreAllMocks();
    expect(baseline.out.ok, JSON.stringify(baseline.out)).toBe(true);
    const pass = vi.fn<CallStructuredModel>(async (req) => {
      if (!isRisks(req)) {
        const graph = JSON.parse(req.input).graph as Rec;
        const signals = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [], graph, analysisState: undefined, analysisResult: undefined, optionParticipation: undefined, leaderLicensed: false });
        const turn = widenTurnFromSignals(signals, graph);
        if (turn.kind !== 'run') throw new Error('golden has no options turn');
        const pathIds = new Set(signals['model.goal_path_factor_ids']);
        const settings: Rec[] = graph.nodes.filter((n: Rec) => n.kind === 'factor' && pathIds.has(n.id)).flatMap((n: Rec) => {
          const frame = n.observed_state?.cap ?? n.scale_frame ?? 1;
          const unit = n.observed_state?.unit ?? '';
          return [0.25, 0.75].flatMap((fraction) => ['positive', 'negative'].map((direction) => ({ factor_label: n.label, direction, level: level(frame * fraction, unit, 'A bounded setting to test this pathway') })));
        });
        const combinations = [...settings.map((a) => [a]), ...settings.flatMap((a, i) => settings.slice(i + 1).filter((b) => b.factor_label !== a.factor_label).map((b) => [a, b]))];
        for (const acts_on of combinations) {
          const options = [{ label: 'Test a different working pattern', acts_on, rationale: RATIONALE }];
          if (widenGate(turn, { options }).ok) return { text: JSON.stringify({ options }) };
        }
        return { text: JSON.stringify({ options: [] }) };
      }
      const optionsLine = req.instructions.split('\n').find((l) => l.startsWith("The user's options and the factors each one changes: "))!;
      const options = JSON.parse(optionsLine.slice(optionsLine.indexOf(': ') + 2).replace(/\.$/, '')) as { id: string; changes: { id: string }[] }[];
      const option = options.find((o) => o.changes.length > 0)!;
      const goalLine = req.instructions.split('\n').find((l) => l.startsWith('The goal: '))!;
      const goal = JSON.parse(goalLine.slice('The goal: '.length).replace(/\.$/, '')) as { id: string };
      const risk = { label: 'Delivery dependency', category: 'dependency', hits_id: option.id, through_id: option.changes[0]!.id, affects_id: goal.id, direction: 'negative', relies_on: 'the planned action taking effect', watch_for: 'progress stalls after the action' };
      return { text: JSON.stringify({ risk_suggestions: [risk] }) };
    });
    const actual = await builder(c, pass, d.brief).promise;
    expect(actual.out.ok, JSON.stringify(actual.out)).toBe(true);
    expect(actual.out.withheld).toEqual(baseline.out.withheld);
    if (actual.out.widened !== undefined) expect(actual.out.widened.risks).toBe(1);
    else expect(JSON.stringify(actual.graph)).toBe(JSON.stringify(baseline.graph));
    const newRiskIds = actual.graph!.nodes.filter((n: Rec) => n.kind === 'risk' && n.draft_widening?.provenance === 'ai_suggested_widen').map((n: Rec) => n.id);
    expect(newRiskIds).toHaveLength(actual.out.widened?.risks ?? 0);
    for (const id of newRiskIds) expect(actual.graph!.edges.filter((e: Rec) => e.from === id || e.to === id)).toEqual([]);
    const beforeFailures = validateGraphStructure(baseline.graph as never, { leaveOutInertRisks: true }).violations;
    const afterFailures = validateGraphStructure(actual.graph as never, { leaveOutInertRisks: true }).violations;
    expect(afterFailures).toEqual(beforeFailures);
  });

  it('aw-words: exact per-kind copy, singular forms, omitted zeros and excluded-risk caveat', () => {
    const tail = " for you to consider. They're Olumi's suggestions, not yours; remove any that don't fit.";
    const variants = [
      [{ options: 2, risks: 3 }, `Olumi added 2 options and 3 risks${tail}`],
      [{ options: 1, risks: 1 }, `Olumi added 1 option and 1 risk${tail}`],
      [{ options: 0, risks: 3 }, `Olumi added 3 risks${tail}`],
      [{ options: 2, risks: 0 }, `Olumi added 2 options${tail}`],
      [{ options: 0, risks: 0 }, null],
    ] as const;
    for (const [counts, words] of variants) expect(widening.widenedLine(counts)).toBe(words);
    expect(widening.widenedRiskNote({ options: 2, risks: 3 })).toBe("Risks Olumi added aren't in the chance yet, so it may be too high.");
    expect(widening.widenedRiskNote({ options: 2, risks: 0 })).toBeNull();
    const words = variants.flatMap(([counts]) => [widening.widenedLine(counts), widening.widenedRiskNote(counts)]).filter(Boolean).join(' ');
    expect(words).not.toMatch(/you missed|\bimproved\b|\bcomplete\b|\bbetter\b|\bbest\b/i);
  });

  it('aw-risk-marker: typed negative effects select DOWN; mixed or positive effects select MOVE; none returns null', () => {
    expect(widening.WIDENED_RISK_MARKER_DOWN).toBe("Leaves out Olumi's added risks; may be too high");
    expect(widening.WIDENED_RISK_MARKER_MOVE).toBe("Leaves out Olumi's added risks; may move");
    const risk = (id: string, direction: 'positive' | 'negative') => ({ id, kind: 'risk' as const, label: 'Same display wording',
      draft_widening: { provenance: 'ai_suggested_widen' as const, affects: { id: 'features_delivered', label: 'Features delivered', direction } } });
    expect(widening.widenedRiskMarker([])).toBeNull();
    expect(widening.widenedRiskMarker([risk('added_risk_a', 'negative')])).toBe(widening.WIDENED_RISK_MARKER_DOWN);
    expect(widening.widenedRiskMarker([risk('added_risk_a', 'negative'), risk('added_risk_b', 'negative')])).toBe(widening.WIDENED_RISK_MARKER_DOWN);
    expect(widening.widenedRiskMarker([risk('added_risk_a', 'positive')])).toBe(widening.WIDENED_RISK_MARKER_MOVE);
    expect(widening.widenedRiskMarker([risk('added_risk_a', 'negative'), risk('added_risk_b', 'positive')])).toBe(widening.WIDENED_RISK_MARKER_MOVE);
    expect(`${widening.WIDENED_RISK_MARKER_DOWN} ${widening.WIDENED_RISK_MARKER_MOVE}`).not.toMatch(/you missed|\bimproved\b|\bcomplete\b|\bbetter\b|\bbest\b/i);
  });
});
