/**
 * ⛔ ONE APPROVAL MUST BE ABLE TO MAKE THE MODEL COMPARABLE — AND ONLY THE
 * MODEL THE USER APPROVED.
 *
 * Every proposal is bound to the revision it was made against. Offered
 * separately, starting values and option levels could never both be applied
 * from one "yes": applying the first superseded the second. Measured on the
 * replay of Paul's 22 Sep journey (output/paul-test-20260923/repro).
 *
 * ⛔ AND THE FIRST COMPOUND WAS WRONG IN THE OTHER DIRECTION. Independent review
 * of #1712 (CHANGES_REQUIRED at 3674539 and ecb45282): it re-read the graph
 * before each part and re-bound to whatever it found, so an UNRELATED edit
 * after the approval was absorbed and the approved levels landed on a model
 * the user never saw, reported as applied. The controls (A) and (B) below are
 * the reviewer's; (P) is the own-write chain that must stay green.
 *
 * The fake product models the two conditional primitives the compound now
 * rests on: `/graph/register` honouring `expected_graph_hash` (409 GRAPH_STALE
 * on a moved model, nothing written) and CAS-gated `option_intervention_edit`.
 * Values are applied by the REAL `applyFactorValueEdit` inside the capability,
 * so the fixture is a GraphV3-valid model.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { committedValueWrite } from './fixtures/served-value-write.js';
import { narrateWriteOutcome } from '../write-outcome.js';

/**
 * Every option wired to every factor. The real product only records a level on
 * a factor the option is linked to (`linkedFactorsOf`, the write's own rule), so
 * a fake that returns NO edges would model an impossible graph. These cases are
 * not about links; the link rule has its own discriminating test.
 */
const wired = (ns: { id: string; kind: string }[]) =>
  // `coordination_load` is only ever a VALUE target here: an option wired to it would need a level too
  // (#1719: a starting point must cover every factor each option acts on).
  ns.filter((o) => o.kind === 'option').flatMap((o) => ns.filter((f) => f.kind === 'factor' && f.id !== 'coordination_load').map((f) => ({
    from: o.id, to: f.id, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive',
  })));


const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const USER = 'user-a';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'r' };

type Node = {
  id: string; kind: string; label: string;
  category?: string;
  observed_state?: Record<string, unknown>;
  scale_frame?: number;
  interventions?: Record<string, unknown> | null;
};

const BASE: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
  // No value yet, and the range construction stores for it (#1708).
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
  { id: 'hire_lead', kind: 'option', label: 'Hire a Tech Lead' },
];

type Posted = { kind: string; target: string; base?: string; at_rev: number };

function fakeProduct(opts: {
  failOn?: string[];
  /** An unrelated actor edits the model at this moment. */
  foreignEditAfterReads?: number;
  foreignEditAfterRegister?: boolean;
  /** A different starting model, for cases the shared one cannot express. */
  base?: Node[];
  /**
   * The level write for this `option::factor` answers 200 with NO revision (it committed nothing), while ANOTHER
   * writer makes the model hold exactly that level and moves the revision (round-2 review, blocker 2's class).
   */
  levelHeldByAnotherWriter?: string;
  /** The level write for this target answers 200 with no revision and NOTHING else moves (the writer's verified no-op). */
  levelNoOp?: string;
} = {}) {
  const posted: Posted[] = [];
  let nodes: Node[] = (opts.base ?? BASE).map((n) => ({ ...n, ...(n.observed_state ? { observed_state: { ...n.observed_state } } : {}) }));
  let rev = 0;
  let reads = 0;
  const foreign = () => {
    // Another actor re-frames Team size from 0-10 to 0-100.
    nodes = nodes.map((n) => (n.id === 'team_size' ? { ...n, observed_state: { value: 0.05, raw_value: 5, cap: 100, unit: 'FTE' } } : n));
    rev += 1;
  };
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      posted.push({ kind: 'register', target: 'graph', base: typeof b.expected_graph_hash === 'string' ? b.expected_graph_hash : undefined, at_rev: rev });
      if (typeof b.expected_graph_hash === 'string' && b.expected_graph_hash !== `h${rev}`) {
        return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      }
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      const reported = `h${rev}`;
      if (opts.foreignEditAfterRegister === true) foreign();
      return { status: 200, json: { registered: true, graph_hash: reported } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind === 'factor_value_edit') {
        const target = String(ev.target_id);
        posted.push({ kind: 'factor_value_edit', target, at_rev: rev });
        if (opts.failOn?.includes(target) === true) return { status: 422, json: {} };
        nodes = nodes.map((n) => (n.id === target ? { ...n, observed_state: { ...n.observed_state, value: ev.value as number } } : n));
        rev += 1;
        return { status: 200, json: committedValueWrite(target, { graph_hash: `h${rev}` }) };
      }
      if (ev.kind === 'option_intervention_edit') {
        const target = `${String(ev.option_id)}::${String(ev.factor_id)}`;
        posted.push({ kind: 'option_intervention_edit', target, base: String(ev.base_graph_hash), at_rev: rev });
        if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
        if (opts.failOn?.includes(target) === true) return { status: 422, json: {} };
        nodes = nodes.map((n) => (n.id === ev.option_id
          ? { ...n, interventions: { ...(n.interventions ?? {}), [String(ev.factor_id)]: { value: ev.value } } } : n));
        if (opts.levelNoOp === target) return { status: 200, json: { assistant_text: 'That level is already set.' } };
        rev += 1;
        if (opts.levelHeldByAnotherWriter === target) return { status: 200, json: { assistant_text: 'That level is already set.' } };
        return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${rev}` } };
      }
      return { status: 400, json: {} };
    }
    // The graph read.
    reads += 1;
    const out = { status: 200, json: { graph: { nodes, edges: wired(nodes) }, graph_hash: `h${rev}` } };
    if (opts.foreignEditAfterReads !== undefined && reads === opts.foreignEditAfterReads) foreign();
    return out;
  };
  return { d, posted, read: () => nodes, rev: () => rev, reads: () => reads };
}

const ASSUMPTIONS = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'a five-person team with one lead' }];
const LEVELS = [
  { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five today plus two hires' },
  { option_label: 'Hire a Tech Lead', factor_label: 'Team size', value: 6, basis: 'five today plus one hire' },
];

/** Propose on a clean model, THEN arm the foreign edit relative to the authorisation. */
async function proposed(opts: Parameters<typeof fakeProduct>[0] = {}) {
  const p = fakeProduct();
  const store = new ProposalStore();
  const caps = createAgentCapabilities(p.d, store);
  const r = await caps.proposeStartingPoint(ctx, { assumptions: ASSUMPTIONS, option_levels: LEVELS });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  // Re-wire the same product state behind a fresh dispatcher carrying the fault.
  const q = fakeProduct(opts);
  // Carry nothing over: the proposal was made against h0 on an identical model.
  const caps2 = createAgentCapabilities(q.d, store);
  return { p: q, store, caps: caps2, id: String(r.proposal_id) };
}

describe('the dead end this closes — two proposals, one approval', () => {
  it('CHARACTERISATION: the second of two separate proposals is refused after the first applies', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const a = await caps.proposeAssumptions(ctx, { assumptions: ASSUMPTIONS });
    const b = await caps.proposeOptionInterventions(ctx, { interventions: LEVELS });
    expect(a.ok && b.ok, JSON.stringify({ a, b })).toBe(true);
    expect((await caps.authoriseChange(ctx, { proposal_id: String(a.proposal_id) })).ok).toBe(true);
    const second = await caps.authoriseChange(ctx, { proposal_id: String(b.proposal_id) });
    expect(second.ok).toBe(false);
    expect(second.refusal).toBe('superseded');
  });
});

describe('propose_starting_point', () => {
  it('leaves exactly ONE proposal awaiting approval, carrying both values and levels', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, { assumptions: ASSUMPTIONS, option_levels: LEVELS });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.mutated).toBe(false);
    expect(p.posted).toHaveLength(0);
    const waiting = store.outstanding(SCENARIO, USER);
    expect(waiting.map((w) => w.proposal_id)).toEqual([r.proposal_id]);
    const kinds = new Set(store.get(String(r.proposal_id))!.operations.map((o) => o.op));
    expect([...kinds].sort()).toEqual(['set_factor_value', 'set_option_intervention']);
    expect(String(r.public_label)).toMatch(/Coordination load = 40/);
    expect(String(r.public_label)).toMatch(/Hire Two Developers sets Team size to 7/);
  });

  it('(P) RED-first: ONE approval = ONE conditional values write, then each level CAS-gated on OUR previous write', async () => {
    const { p, store, caps, id } = await proposed();
    const applied = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.applied).toBe(true);
    expect(applied.mutated).toBe(true);
    // Values as ONE registration bound to the approved base, then the levels.
    expect(p.posted.map((x) => x.kind)).toEqual(['register', 'option_intervention_edit', 'option_intervention_edit']);
    expect(p.posted[0].base).toBe('h0');
    // Each level carries the revision our own preceding write reported.
    expect(p.posted.slice(1).map((x) => x.base)).toEqual(['h1', 'h2']);
    // No value went through the non-conditional event.
    expect(p.posted.some((x) => x.kind === 'factor_value_edit')).toBe(false);
    const byId = Object.fromEntries(p.read().map((n) => [n.id, n]));
    // The value was normalised by the product's own path against the stored range.
    expect(byId.coordination_load.observed_state?.value).toBeCloseTo(0.4, 6);
    expect(byId.coordination_load.observed_state?.raw_value).toBe(40);
    expect(Object.keys(byId.hire_two.interventions ?? {})).toEqual(['team_size']);
    expect(Object.keys(byId.hire_lead.interventions ?? {})).toEqual(['team_size']);
    expect(store.outstanding(SCENARIO, USER)).toEqual([]);
    const again = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(again.already_applied).toBe(true);
    expect(p.posted).toHaveLength(3);
  });

  it('(A) an UNRELATED edit after the approval, before the first write → ZERO writes, not_applied', async () => {
    // Read 1 is authoriseChange's own authorisation read; the foreign edit lands right after it.
    const { p, store, caps, id } = await proposed({ foreignEditAfterReads: 1 });
    const out = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(out.ok).toBe(false);
    expect(out.applied).toBe(false);
    expect(out.mutated).toBe(false);
    expect(out.refusal).toBe('not_applied');
    // The single conditional write was attempted on the APPROVED base and refused; nothing else was sent.
    expect(p.posted.map((x) => [x.kind, x.base])).toEqual([['register', 'h0']]);
    expect(p.posted.some((x) => x.kind === 'option_intervention_edit')).toBe(false);
    // The model holds only the foreign change.
    const byId = Object.fromEntries(p.read().map((n) => [n.id, n]));
    expect(byId.coordination_load.observed_state).toBeUndefined();
    expect(store.outstanding(SCENARIO, USER).map((w) => w.proposal_id)).toEqual([id]);
  });

  it('(B) an UNRELATED edit after the values, before the levels → values landed, ZERO level writes, partially_applied', async () => {
    const { p, store, caps, id } = await proposed({ foreignEditAfterRegister: true });
    const out = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(out.ok).toBe(false);
    expect(out.applied).toBe(false);
    expect(out.mutated).toBe(true);
    expect(out.refusal).toBe('partially_applied');
    const parts = out.parts as { part: string; ok: boolean; recorded_count: number }[];
    expect(parts.map((x) => [x.part, x.ok, x.recorded_count])).toEqual([['values', true, 1], ['option_levels', false, 0]]);
    // The first level was sent on OUR revision (h1), found the model moved (h2), and was refused — no level landed.
    const levels = p.posted.filter((x) => x.kind === 'option_intervention_edit');
    expect(levels.map((x) => x.base)).toEqual(['h1']);
    const byId = Object.fromEntries(p.read().map((n) => [n.id, n]));
    expect(byId.hire_two.interventions ?? undefined).toBeUndefined();
    expect(byId.hire_lead.interventions ?? undefined).toBeUndefined();
    // Never listed as done; only the object the user was shown can await approval.
    expect(store.outstanding(SCENARIO, USER).map((w) => w.proposal_id)).toEqual([id]);
  });

  /**
   * ⛔ A LEVEL IS A NUMBER ON ITS FACTOR'S FRAME — independent review of #1712
   * at 286240fa (M6): removing the frame refusal turned nothing RED, yet one
   * approval then stored a level SHOWN as 1 FTE as 10 FTE and reported
   * `applied: true`. The level is proposed while its factor has no range (so it
   * is read against the range derived from its own figure); this SAME approval's
   * value then gives the factor a range of 0-10. Applied as-is, 1.0 of 0-10 = 10.
   */
  it('a level whose factor THIS approval would re-frame is REFUSED before any write — 1 FTE is never stored as 10', async () => {
    const base: Node[] = [
      { id: 'velocity', kind: 'goal', label: 'Velocity' },
      { id: 'tech_leads', kind: 'factor', label: 'Tech leads hired', category: 'controllable' },
      { id: 'hire_lead', kind: 'option', label: 'Hire a Tech Lead' },
    ];
    const p = fakeProduct({ base });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Tech leads hired', value: 3, unit: 'FTE', basis: 'three leads across the org today' }],
      option_levels: [{ option_label: 'Hire a Tech Lead', factor_label: 'Tech leads hired', value: 1, basis: 'one hire' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const kinds = new Set(store.get(String(r.proposal_id))!.operations.map((o) => o.op));
    expect([...kinds].sort(), 'both halves must be in the ONE proposal for this case to mean anything').toEqual(['set_factor_value', 'set_option_intervention']);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok).toBe(false);
    expect(out.applied).toBe(false);
    expect(out.mutated).toBe(false);
    expect(out.refusal).toBe('not_applied');
    expect(out.reason).toBe('level_frame_changed_by_values');
    // ZERO writes attempted — refused before the one conditional registration.
    expect(p.posted).toEqual([]);
    const byId = Object.fromEntries(p.read().map((n) => [n.id, n]));
    expect(byId.hire_lead.interventions).toBeUndefined();
    expect(byId.tech_leads.observed_state).toBeUndefined();
  });

  it('a level that refuses is reported as PARTIAL, and never listed as a second thing to approve', async () => {
    // Levels apply in id order (hire_lead, then hire_two); the SECOND refuses.
    const { p, store, caps, id } = await proposed({ failOn: ['hire_two::team_size'] });
    const out = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(out.ok).toBe(false);
    expect(out.refusal).toBe('partially_applied');
    const parts = out.parts as { part: string; ok: boolean; recorded_count: number }[];
    expect(parts.map((x) => [x.part, x.ok, x.recorded_count])).toEqual([['values', true, 1], ['option_levels', false, 1]]);
    expect(p.posted.filter((x) => x.kind === 'option_intervention_edit')).toHaveLength(2);
    expect(store.outstanding(SCENARIO, USER).map((w) => w.proposal_id)).toEqual([id]);
  });

  /**
   * ⛔ ROUND-2 REVIEW, BLOCKER 1, ON THE REAL CAPABILITY: the second level refuses, so 1 of the 2 levels WAS saved.
   * The user read "Not saved: 1 of 2 option levels." — the count of what landed, printed under "Not saved".
   */
  it('RED (round-2 blocker 1): the second level refuses → the user reads that 1 of 2 levels WAS saved and 1 was not', async () => {
    const { caps, id } = await proposed({ failOn: ['hire_two::team_size'] });
    const out = await caps.authoriseChange(ctx, { proposal_id: id });
    expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [out]).status)
      .toBe('Saved 1 of 1 starting values. Saved 1 of 2 option levels; 1 was not saved.');
  });

  /**
   * ⛔ ROUND-2 REVIEW, BLOCKER 2'S CLASS, IN THE COMPOUND: a level write that answers 200 with no revision is a verified
   * no-op only if the model holds exactly the approved level. That was decided by HASH EQUALITY first, so when another
   * writer had moved the model the level was "not recorded" although the model holds exactly what was approved. The
   * rule is the link writer's: the read-back holding exactly the approved level is LANDED; the chain still never
   * writes a further level on a revision it cannot prove.
   */
  it('RED (round-2 blocker 2 class): the LAST level\'s write committed nothing but the model holds exactly the approved level after another writer moved it → recorded, the approval marked applied', async () => {
    const { p, store, caps, id } = await proposed({ levelHeldByAnotherWriter: 'hire_two::team_size' });
    const out = await caps.authoriseChange(ctx, { proposal_id: id });
    const parts = out.parts as { part: string; ok: boolean; recorded_count: number }[];
    expect(parts.map((x) => [x.part, x.ok, x.recorded_count]), JSON.stringify(out)).toEqual([['values', true, 1], ['option_levels', true, 2]]);
    expect(out.ok).toBe(true);
    expect(out.applied).toBe(true);
    expect(p.posted.filter((x) => x.kind === 'option_intervention_edit').map((x) => x.target)).toEqual(['hire_lead::team_size', 'hire_two::team_size']);
    expect(store.outstanding(SCENARIO, USER)).toEqual([]);
    expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [out]).status).toBe('Saved 1 of 1 starting values. Saved 2 of 2 option levels.');
  });

  it('RED (round-2 blocker 2 class): the FIRST level held that way → counted, and NO further level is written on a revision the chain cannot prove', async () => {
    const { p, store, caps, id } = await proposed({ levelHeldByAnotherWriter: 'hire_lead::team_size' });
    const out = await caps.authoriseChange(ctx, { proposal_id: id });
    const parts = out.parts as { part: string; ok: boolean; recorded_count: number }[];
    expect(parts.map((x) => [x.part, x.ok, x.recorded_count]), JSON.stringify(out)).toEqual([['values', true, 1], ['option_levels', false, 1]]);
    expect(out.refusal).toBe('partially_applied');
    expect(p.posted.filter((x) => x.kind === 'option_intervention_edit').map((x) => x.target)).toEqual(['hire_lead::team_size']);
    expect(store.outstanding(SCENARIO, USER).map((w) => w.proposal_id)).toEqual([id]);
  });

  it('CONTROL (passes at base): the same no-revision answer with NO other writer and the level held → a verified no-op, recorded', async () => {
    const { store, caps, id } = await proposed({ levelNoOp: 'hire_two::team_size' });
    const out = await caps.authoriseChange(ctx, { proposal_id: id });
    const parts = out.parts as { part: string; ok: boolean; recorded_count: number }[];
    expect(parts.map((x) => [x.part, x.ok, x.recorded_count]), JSON.stringify(out)).toEqual([['values', true, 1], ['option_levels', true, 2]]);
    expect(store.outstanding(SCENARIO, USER)).toEqual([]);
  });

  it('CONTRAST: with only one kind it is an ordinary single proposal', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, { assumptions: [], option_levels: LEVELS });
    expect(r.ok).toBe(true);
    const kinds = new Set(store.get(String(r.proposal_id))!.operations.map((o) => o.op));
    expect([...kinds]).toEqual(['set_option_intervention']);
    expect(store.outstanding(SCENARIO, USER)).toHaveLength(1);
  });

  it('is a MUTATION tool: the read-only preview refuses it before any capability runs', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await dispatchTool('propose_starting_point', JSON.stringify({ assumptions: ASSUMPTIONS, option_levels: LEVELS }), ctx, caps, 'preview');
    expect(r.refusal).toBe('read_only_preview');
    expect(p.posted).toHaveLength(0);
  });
});
