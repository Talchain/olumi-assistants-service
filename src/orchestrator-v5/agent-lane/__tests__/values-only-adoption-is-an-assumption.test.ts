/**
 * ⛔ OLUMI'S FIGURES, ADOPTED WITHOUT LEVELS, ARE STORED AS ASSUMPTIONS — by the REAL writer
 * (review of #1851, B2; RC #63 5825007295; served defect `caf7d1a` pricing S2p, a values-only
 * approval, both figures stamped as the user's own).
 *
 * The fake dispatch hands each `factor_value_edit` to the PRODUCT'S OWN writer
 * (`applyFactorValueEdit` → `set_factor_value`) in-process, the way the route's `app.inject`
 * does, so the stamp under test is the one the served writer decides. The approved-adoption
 * identity is server-internal (`approved-adoption-context.ts`, AsyncLocalStorage — measured to
 * survive `app.inject`, `stage-stream-context.ts:30`); nothing on the wire can claim it.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { runWithApprovedAdoption } from '../approved-adoption-context.js';
import { censusConfidenceParameters } from '../../admission/analysis-admission.js';
import { earnsAuthorshipCredit, structureProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';

const SCENARIO = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
/** What the user wrote in these rows: a figure is recorded as theirs only when it is here (`stated-by-user.ts`). */
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-v', request_id: 'r', user_text: 'Team size is 6 FTE. The monthly budget is 300, or 1,234,564,999, or 1,234,564,999,999.' };

type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown>; scale_frame?: number };
const BASE: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE', source: 'user_override' } },
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
];
const EDGES = [
  { from: 'hire_two', to: 'team_size', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  { from: 'team_size', to: 'velocity', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  { from: 'coordination_load', to: 'velocity', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
];

/** The product double whose value writer IS the served writer. */
function product(opts: { refuse?: string; extra?: Node[]; thenOtherWriter?: { target: string; raw: number } } = {}) {
  let nodes: Node[] = [...BASE, ...(opts.extra ?? [])].map((n) => ({ ...n, ...(n.observed_state ? { observed_state: { ...n.observed_state } } : {}) }));
  let rev = 0;
  let writes = 0;
  const registers: unknown[] = [];
  const graph = () => ({ nodes, edges: EDGES });
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind !== 'factor_value_edit') return { status: 400, json: {} };
      // A refusal as served: HTTP 200, committed as a turn, no graph_patch (another writer won).
      if (opts.refuse !== undefined && ev.target_id === opts.refuse) return { status: 200, json: { assistant_text: 'Not changed: the model changed after this was proposed.' } };
      const res = await applyFactorValueEdit({
        payload: { kind: 'system_event', turn_id: String(b.turn_id), scenario_id: SCENARIO, stage: 'frame', event: ev } as never,
        event: ev as never,
        requestId: `w${writes}`,
        persistedGraph: graph() as never,
        priorFacts: [],
      });
      if (res.kind !== 'mutated') return { status: 200, json: { assistant_text: 'Not changed.' } };
      writes += 1;
      nodes = ((res as unknown as { mutatedGraph: { nodes: Node[] } }).mutatedGraph.nodes);
      rev += 1;
      // The served committed shape (`valueWriteCommittedByThisRequest`), with this write's OWN `after`
      // from its handler fact, as `compose.ts` builds it.
      const fact = (res as unknown as { handlerFacts: { fact_type: string; result: { after?: unknown } }[] }).handlerFacts.find((f) => f.fact_type === 'set_factor_value');
      const committed = { status: 200, json: { assistant_text: 'Saved.', graph_hash: `h${rev}`, blocks: [{ type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: String(ev.target_id), after: fact?.result.after }] } };
      // A collaborator writes the SAME target after our commit, before our read-back — through the real writer.
      const other = opts.thenOtherWriter;
      if (other !== undefined && other.target === ev.target_id) {
        const oev = { kind: 'factor_value_edit', target_id: other.target, value: other.raw };
        const ores = await applyFactorValueEdit({
          payload: { kind: 'system_event', turn_id: '7e1d2c3b-4a5f-4e6d-8c7b-9a0f1e2d3c4b', scenario_id: SCENARIO, stage: 'frame', event: oev } as never,
          event: oev as never, requestId: 'other-writer', persistedGraph: graph() as never, priorFacts: [],
        });
        if (ores.kind === 'mutated') { nodes = ((ores as unknown as { mutatedGraph: { nodes: Node[] } }).mutatedGraph.nodes); rev += 1; }
      }
      return committed;
    }
    if (path.endsWith('/graph/register')) registers.push(body);
    return { status: 200, json: { graph: graph(), graph_hash: `h${rev}` } };
  };
  return { d, byId: () => Object.fromEntries(nodes.map((n) => [n.id, n])), graph, writes: () => writes, registers: () => registers };
}

const OLUMIS = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'a five-person team with one lead' }];

async function adoptValuesOnly() {
  const p = product();
  const store = new ProposalStore();
  const caps = createAgentCapabilities(p.d, store);
  const proposed = await caps.proposeAssumptions(ctx, { assumptions: OLUMIS });
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  const shown = store.get(String(proposed.proposal_id))!;
  expect(shown.provenance.authored_by, 'precondition: Olumi authored it').toBe('model_proposed');
  expect(new Set(shown.operations.map((o) => o.op)), 'precondition: values only — the single-kind path').toEqual(new Set(['set_factor_value']));
  const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  return { p, caps, proposalId: String(proposed.proposal_id) };
}

describe('values-only approval of Olumi’s figures, through the real writer', () => {
  it('RED: the stored source is user_assumption, and the value itself is the approved one', async () => {
    const { p } = await adoptValuesOnly();
    const os = p.byId().coordination_load.observed_state ?? {};
    expect(os.source).toBe('user_assumption');
    expect(os.raw_value).toBe(40);
  });

  it('RED: the admission census does not count it as user-stated (only the figure the user typed counts)', async () => {
    const { p } = await adoptValuesOnly();
    const g = p.graph();
    const adopted = g.nodes.find((n) => n.id === 'coordination_load');
    expect(earnsAuthorshipCredit(structureProvenance(adopted, g))).toBe(false);
    expect(censusConfidenceParameters(g as never).confidence_parameters_user_stated).toBe(1);
  });

  it('what the approval tells the Agent: Olumi’s figure, stored as the user’s assumption', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, { assumptions: OLUMIS });
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(String(applied.not_represented)).toContain('Coordination load is Olumi’s figure that the user adopted as an assumption');
    expect(String(applied.not_represented)).not.toContain('the user’s own');
  });

  it('NEGATIVE: a replayed approval writes nothing more and relabels nothing', async () => {
    const { p, caps, proposalId } = await adoptValuesOnly();
    const before = { writes: p.writes(), os: p.byId().coordination_load.observed_state };
    const again = await caps.authoriseChange(ctx, { proposal_id: proposalId });
    expect(again).toMatchObject({ already_applied: true });
    expect(p.writes()).toBe(before.writes);
    expect(p.byId().coordination_load.observed_state).toEqual(before.os);
  });
});

describe('an approval that is not verified never enters the adoption context', () => {
  it('NEGATIVE: ANOTHER user approving the proposal writes nothing and stamps nothing', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, { assumptions: OLUMIS });
    const other = await caps.authoriseChange({ ...ctx, authenticated_user_id: 'someone-else' }, { proposal_id: String(proposed.proposal_id) });
    expect(other.ok).not.toBe(true);
    expect(p.writes()).toBe(0);
    expect(p.byId().coordination_load.observed_state).toBeUndefined();
  });

  it('NEGATIVE: a STALE approval (the model moved since it was proposed) writes nothing and stamps nothing', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, { assumptions: OLUMIS });
    // Another writer moves the model after the proposal was made.
    const ev = { kind: 'factor_value_edit', target_id: 'team_size', value: 0.7, raw_value: 7 };
    await p.d('/orchestrate/v2/turn', { kind: 'system_event', turn_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f', scenario_id: SCENARIO, stage: 'frame', event: ev });
    // PRECONDITION, proven not assumed: the foreign write landed, so the model really moved.
    expect(p.writes()).toBe(1);
    const writesBefore = p.writes();
    const stale = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(stale.ok).not.toBe(true);
    expect(p.writes()).toBe(writesBefore);
    expect(p.byId().coordination_load.observed_state).toBeUndefined();
  });
});

describe('the user’s own figure stays theirs', () => {
  it('TWIN: a revision the USER named (revise: true) is stored as user_override', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Team size', value: 6, unit: 'FTE', basis: 'the user said six', revise: true }],
    } as never);
    expect(store.get(String(proposed.proposal_id))!.provenance.authored_by).toBe('user_stated');
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(p.byId().team_size.observed_state?.source).toBe('user_override');
    // Codex 5825564214: what the approval tells the Agent matches that stamp.
    const said = String(applied.not_represented);
    expect(said).toContain('Team size is the user’s own figure, stored as theirs.');
    expect(said).not.toContain('adopted');
    expect(said).not.toContain('records no mark');
  });
});

/**
 * ⛔ A PARTIAL APPROVAL (Codex pre-review of #1851, 5825603926): one value lands, the other is refused.
 * Nothing after the writes may touch or describe the refused one as stored — not the range framing
 * (a second write), not the note the Agent repeats.
 */
/**
 * ⛔ SAVED BY THIS APPROVAL, THEN CHANGED BY SOMEONE ELSE (Codex pre-review of #1851, 5825735512): our
 * write commits, a collaborator writes the SAME target before our read-back. Nothing after the write
 * may frame the collaborator's figure, call it a rescale, or describe it as this approval's.
 */
describe('a collaborator changes the same target after our write', () => {
  const BUDGET: Node = { id: 'monthly_budget', kind: 'factor', label: 'Monthly budget', category: 'controllable', observed_state: { value: 250, raw_value: 250, source: 'user_override' } };
  /** ⛔ The same class on the value path (pre-review 5828080522): a relative 1e-9 band hid a £1 change on £1.2bn. */
  it.each([
    [1_234_564_999, 1_234_565_000],
    [1_234_564_999_999, 1_234_565_000_000],
  ])('RED: a collaborator moves our %s by £1 — reported exactly, never absorbed by a magnitude band', async (ours, theirs) => {
    const p = product({ extra: [BUDGET], thenOtherWriter: { target: 'monthly_budget', raw: theirs } });
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const proposed = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Monthly budget', value: ours, basis: 'the user said it', revise: true }] } as never);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(p.byId().monthly_budget.observed_state?.value, 'PRECONDITION: theirs is what the model holds').toBe(theirs);
    expect(applied.changed_since_by_another_writer).toEqual([{ factor: 'Monthly budget', saved: ours, now: theirs }]);
  });

  it('RED: no range is derived from their figure; the result keeps ours and reports theirs separately', async () => {
    const p = product({ extra: [BUDGET], thenOtherWriter: { target: 'monthly_budget', raw: 800 } });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Monthly budget', value: 300, basis: 'the user said 300', revise: true }] } as never);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    // PRECONDITIONS, proven: our write landed, and the collaborator's figure is what the model now holds.
    expect(p.writes(), 'our one write').toBe(1);
    expect(p.byId().monthly_budget.observed_state?.value).toBe(800);
    expect(p.registers(), 'no range derived from the collaborator’s 800').toEqual([]);
    expect(p.byId().monthly_budget.observed_state, 'their figure untouched').not.toHaveProperty('cap');
    expect(applied.values).toEqual([expect.objectContaining({ factor: 'Monthly budget', requested: 300, recorded: 300 })]);
    expect(applied, 'their change is not a model rescale').not.toHaveProperty('rescaled_by_the_model');
    expect(applied.changed_since_by_another_writer).toEqual([{ factor: 'Monthly budget', saved: 300, now: 800 }]);
    const said = String(applied.not_represented);
    expect(said).toContain('Monthly budget was saved by this approval as 300, but someone else has since changed it to 800');
    expect(said).not.toContain('Monthly budget is the user’s own figure');
  });

  it('CONTROL: with no other writer, the same approval is described as the user’s own and nothing is reported as changed since', async () => {
    const p = product({ extra: [BUDGET] });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Monthly budget', value: 300, basis: 'the user said 300', revise: true }] } as never);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(applied).not.toHaveProperty('changed_since_by_another_writer');
    expect(String(applied.not_represented)).toContain('Monthly budget is the user’s own figure, stored as theirs.');
  });
});

describe('a partial approval: one value lands, one is refused', () => {
  const BUDGET: Node = { id: 'monthly_budget', kind: 'factor', label: 'Monthly budget', category: 'controllable', observed_state: { value: 250, raw_value: 250, source: 'user_override' } };
  async function approve(refuse: string, assumptions: unknown[]) {
    const p = product({ refuse, extra: [BUDGET] });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, { assumptions } as never);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    return { p, applied };
  }

  it('RED: the refused, unframed factor gets NO range written, and the note does not call it stored', async () => {
    const { p, applied } = await approve('monthly_budget', [
      { factor_label: 'Monthly budget', value: 300, basis: 'the user said 300', revise: true },
      { factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'Olumi suggested forty' },
    ]);
    // PRECONDITIONS, proven: exactly one value landed, and the refused factor is the unframed >1 kind.
    expect(p.writes(), 'only Coordination load landed').toBe(1);
    expect(applied.adopted_count).toBe(1);
    expect(p.byId().monthly_budget.observed_state, 'the refused factor is byte-identical').toEqual(BUDGET.observed_state);
    expect(p.registers(), 'no range write at all: Coordination load already has a range, and Monthly budget was refused').toEqual([]);
    const said = String(applied.not_represented);
    expect(said).toContain('Coordination load is Olumi’s figure that the user adopted as an assumption');
    expect(said).toContain('Monthly budget was NOT recorded by this approval.');
    expect(said).not.toContain('Monthly budget is the user’s own figure');
  });

  it('RED: the reverse — the user’s revision lands, Olumi’s figure is refused — says each truthfully', async () => {
    const { p, applied } = await approve('coordination_load', [
      { factor_label: 'Team size', value: 6, unit: 'FTE', basis: 'the user said six', revise: true },
      { factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'Olumi suggested forty' },
    ]);
    expect(p.writes()).toBe(1);
    expect(p.byId().coordination_load.observed_state).toBeUndefined();
    const said = String(applied.not_represented);
    expect(said).toContain('Team size is the user’s own figure, stored as theirs.');
    expect(said).toContain('Coordination load was NOT recorded by this approval.');
    expect(said).not.toContain('Coordination load is Olumi’s figure');
  });
});

/**
 * ⛔ A MIXED PROPOSAL (Codex pre-review of #1851, 5825286731): one `propose_assumptions` call can
 * hold the user's own revision beside Olumi's figure, and the proposal-wide `authored_by` is then
 * `model_proposed`. Authorship is decided per value, so each figure keeps its own author.
 */
describe('a proposal holding BOTH the user’s revision and Olumi’s figure', () => {
  async function adoptMixed() {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, {
      assumptions: [
        { factor_label: 'Team size', value: 6, unit: 'FTE', basis: 'the user said six', revise: true },
        { factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'Olumi suggested forty' },
      ],
    } as never);
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const shown = store.get(String(proposed.proposal_id))!;
    // PRECONDITIONS, proven not assumed: one proposal, Olumi-authored as a whole, values only.
    expect(shown.provenance.authored_by).toBe('model_proposed');
    expect(shown.operations.map((o) => o.path).sort()).toEqual(['coordination_load', 'team_size']);
    expect(new Set(shown.operations.map((o) => o.op))).toEqual(new Set(['set_factor_value']));
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(p.writes(), 'both values landed').toBe(2);
    return p;
  }

  it('RED: the user’s revised figure stays user_override; Olumi’s figure is user_assumption', async () => {
    const p = await adoptMixed();
    expect(p.byId().team_size.observed_state).toMatchObject({ raw_value: 6, source: 'user_override' });
    expect(p.byId().coordination_load.observed_state).toMatchObject({ raw_value: 40, source: 'user_assumption' });
  });

  it('RED: the census still credits the user’s own figure and does not credit Olumi’s', async () => {
    const p = await adoptMixed();
    const g = p.graph();
    expect(earnsAuthorshipCredit(structureProvenance(g.nodes.find((n) => n.id === 'team_size'), g))).toBe(true);
    expect(earnsAuthorshipCredit(structureProvenance(g.nodes.find((n) => n.id === 'coordination_load'), g))).toBe(false);
    expect(censusConfidenceParameters(g as never).confidence_parameters_user_stated).toBe(1);
  });

  it('RED: what the approval tells the Agent separates the two authors, as the stamps do (Codex 5825446207)', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const proposed = await caps.proposeAssumptions(ctx, {
      assumptions: [
        { factor_label: 'Team size', value: 6, unit: 'FTE', basis: 'the user said six', revise: true },
        { factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'Olumi suggested forty' },
      ],
    } as never);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposed.proposal_id) });
    const said = String(applied.not_represented);
    expect(said).toContain('Team size is the user’s own figure, stored as theirs.');
    expect(said).toContain('Coordination load is Olumi’s figure that the user adopted as an assumption, not a measurement, stored as the user’s assumption.');
    expect(said, 'the stamps now DO distinguish them').not.toContain('records no mark');
  });

  it('each value op records its own author, inside the proposal’s integrity hash', async () => {
    const store = new ProposalStore();
    const caps = createAgentCapabilities(product().d, store);
    const proposed = await caps.proposeAssumptions(ctx, {
      assumptions: [
        { factor_label: 'Team size', value: 6, unit: 'FTE', basis: 'the user said six', revise: true },
        { factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'Olumi suggested forty' },
      ],
    } as never);
    const ops = store.get(String(proposed.proposal_id))!.operations;
    const authorOf = (path: string) => ((ops.find((o) => o.path === path)?.value ?? {}) as { authored_by?: string }).authored_by;
    expect(authorOf('team_size')).toBe('user_stated');
    expect(authorOf('coordination_load')).toBe('model_proposed');
  });
});

describe('nothing outside the verified approval can claim the adoption stamp', () => {
  const edit = async (graph: unknown, value: number) => {
    const ev = { kind: 'factor_value_edit' as const, target_id: 'coordination_load', value };
    const res = await applyFactorValueEdit({
      payload: { kind: 'system_event', turn_id: '0b0f6a1e-9f7c-4d5e-8a1b-2c3d4e5f6a7b', scenario_id: SCENARIO, stage: 'frame', event: ev } as never,
      event: ev as never, requestId: 'x', persistedGraph: graph as never, priorFacts: [],
    });
    expect(res.kind, JSON.stringify(res)).toBe('mutated');
    return ((res as unknown as { mutatedGraph: { nodes: Node[] } }).mutatedGraph.nodes).find((n) => n.id === 'coordination_load')?.observed_state?.source;
  };
  it('NEGATIVE: a direct system event (no server context — the inspector, or any client) keeps user_override', async () => {
    expect(await edit(product().graph(), 40)).toBe('user_override');
  });
  it('NEGATIVE: a context naming ANOTHER target keeps user_override', async () => {
    const src = await runWithApprovedAdoption({ scenarioId: SCENARIO, proposalId: 'p', targetId: 'team_size', rawValue: 40 }, () => edit(product().graph(), 40));
    expect(src).toBe('user_override');
  });
  it('NEGATIVE: a context naming ANOTHER value keeps user_override', async () => {
    const src = await runWithApprovedAdoption({ scenarioId: SCENARIO, proposalId: 'p', targetId: 'coordination_load', rawValue: 41 }, () => edit(product().graph(), 40));
    expect(src).toBe('user_override');
  });
  it('NEGATIVE: a context naming ANOTHER scenario keeps user_override', async () => {
    const src = await runWithApprovedAdoption({ scenarioId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', proposalId: 'p', targetId: 'coordination_load', rawValue: 40 }, () => edit(product().graph(), 40));
    expect(src).toBe('user_override');
  });
  it('CONTROL: the matching context DOES stamp user_assumption (the negatives are not vacuous)', async () => {
    const src = await runWithApprovedAdoption({ scenarioId: SCENARIO, proposalId: 'p', targetId: 'coordination_load', rawValue: 40 }, () => edit(product().graph(), 40));
    expect(src).toBe('user_assumption');
  });
});
