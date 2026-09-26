/**
 * ⛔ ONE USER OPERATION → ONE APPROVAL → ONE ATOMIC COMMIT → ONE RECEIPT (ChatGPT #70 5847200462; Paul's programme
 * focus: "#2004 is useful interim progress, but partial link/value persistence is not A-complete").
 *
 * BF5's real request carries TWO option levels, one of which needs its option → factor link. #2004 writes the link,
 * then each level, each its own commit: a refused second level leaves the link and the first level committed
 * (reported exactly, `partially_applied`). The contract is stricter: the approved scope lands WHOLE or NOT AT ALL,
 * as ONE commit with ONE receipt; a retry never repeats it; a reload agrees.
 *
 * The seam (Canonical #70 5847348206, port 5847356444): the product's N-ary level writer behind an in-process port.
 * The fake below implements that contract — all or nothing, one commit, idempotent on `turn_id` — so these rows prove
 * the AGENT sends the whole approved scope in ONE call and never walks a per-event chain. The writer's own
 * all-or-nothing is Canonical's (its RED rows); the served BF5 witness proves the two together.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult as CommitOptionLevelsOutcome } from '../../system-events/dispatch.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown>; scale_frame?: number; interventions?: Record<string, unknown> };
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });
type Edge = ReturnType<typeof edge>;

const NODES: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
  { id: 'internal_trial', kind: 'option', label: 'Internal Lead Trial' },
];
// hire_two acts on Team size; internal_trial does NOT yet (its level needs the link).
const EDGES = [edge('hire_two', 'team_size'), edge('team_size', 'velocity')];

/** The product behind the port: the whole scope commits at once or not at all; any per-event write is recorded as a violation. */
function product(opts: { refuseLevelOf?: string; trialLinked?: boolean; claimsWithoutWriting?: boolean } = {}) {
  let edges: Edge[] = [...EDGES, ...(opts.trialLinked === true ? [edge('internal_trial', 'team_size')] : [])].map((e) => ({ ...e }));
  let nodes: Node[] = NODES.map((n) => ({ ...n }));
  let rev = 0;
  const commits: string[] = [];
  const calls: CommitOptionLevelsInput[] = [];
  const perEvent: string[] = [];
  const done = new Map<string, CommitOptionLevelsOutcome>();
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      perEvent.push(String((b.event as { kind?: unknown }).kind));
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes, edges }, graph_hash: `h${rev}` } };
  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsOutcome> => {
    calls.push(input);
    const seen = done.get(input.turn_id);
    if (seen !== undefined) return seen.status === 'committed' ? { ...seen, already_applied: true } : seen;
    if (input.base_graph_hash !== `h${rev}`) return { status: 'stale' };
    const nextEdges = [...edges, ...input.links.map((k) => edge(k.option_id, k.factor_id))];
    for (const l of input.levels) {
      if (opts.refuseLevelOf === l.option_id || !nextEdges.some((e) => e.from === l.option_id && e.to === l.factor_id)) {
        return { status: 'refused', reason: 'unresolved_effect_relationship', pair: { option_id: l.option_id, factor_id: l.factor_id } };
      }
    }
    // A writer that reports a commit its model does not hold: the Agent's read-back is the second check.
    if (opts.claimsWithoutWriting === true) {
      rev += 1;
      return { status: 'committed', graph_hash: `h${rev}`, receipt: null, already_applied: false, committed_levels: input.levels.map((l) => ({ option_id: l.option_id, factor_id: l.factor_id, value: l.value })) };
    }
    edges = nextEdges;
    nodes = nodes.map((n) => {
      const mine = input.levels.filter((l) => l.option_id === n.id);
      return mine.length === 0 ? n : { ...n, interventions: { ...(n.interventions ?? {}), ...Object.fromEntries(mine.map((l) => [l.factor_id, { value: l.value }])) } };
    });
    rev += 1;
    commits.push(`${input.links.length} links + ${input.levels.length} levels`);
    const out: CommitOptionLevelsOutcome = { status: 'committed', graph_hash: `h${rev}`, receipt: { version: rev, version_id: `v${rev}`, mutation_id: `m${rev}`, source_turn_id: input.turn_id }, already_applied: false, committed_levels: input.levels.map((l) => ({ option_id: l.option_id, factor_id: l.factor_id, value: l.value })) };
    done.set(input.turn_id, out);
    return out;
  };
  const state = () => ({ rev: `h${rev}`, edges: edges.map((e) => `${e.from}::${e.to}`).sort(), levels: Object.fromEntries(nodes.filter((n) => n.interventions).map((n) => [n.id, n.interventions])) });
  return { d, commitOptionLevels, commits, calls, perEvent, state };
}

/** BF5's shape: two levels in ONE proposal; Internal Lead Trial's needs its link. */
const TWO_LEVELS = { interventions: [
  { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
  { option_label: 'Internal Lead Trial', factor_label: 'Team size', value: 6, basis: 'a trial adds one' },
] };

describe('the approved scope commits WHOLE or NOT AT ALL, as ONE commit (A complete)', () => {
  it('the second level is refused → NOTHING of the approved scope stays committed (no link, no first level), in ONE call', async () => {
    const p = product({ refuseLevelOf: 'internal_trial' });
    const before = p.state();
    const caps = createAgentCapabilities(p.d, new ProposalStore(), undefined, 'full', undefined, { commitOptionLevels: p.commitOptionLevels });
    const r = await caps.proposeOptionInterventions(ctx, TWO_LEVELS);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok).toBe(false);
    expect(out.mutated, 'nothing of the approved scope may remain').toBe(false);
    expect(p.state(), 'the model is exactly as it was').toEqual(before);
    expect(p.commits).toEqual([]);
    expect(p.calls, 'the whole scope in ONE call').toHaveLength(1);
    expect(p.calls[0]!.links).toEqual([{ option_id: 'internal_trial', factor_id: 'team_size' }]);
    expect(p.calls[0]!.levels.map((l) => l.option_id)).toEqual(['hire_two', 'internal_trial']);
    expect(p.perEvent, 'never a per-event write').toEqual([]);
  });

  it('success is ONE commit with ONE receipt, and the model holds the link and both levels', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore(), undefined, 'full', undefined, { commitOptionLevels: p.commitOptionLevels });
    const r = await caps.proposeOptionInterventions(ctx, TWO_LEVELS);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(p.commits, 'one commit for the whole operation').toHaveLength(1);
    expect(p.state().rev).toBe('h1');
    expect(p.state().edges).toContain('internal_trial::team_size');
    expect(Object.keys(p.state().levels).sort()).toEqual(['hire_two', 'internal_trial']);
    expect(out.receipts).toHaveLength(1);
    expect(p.perEvent).toEqual([]);
  });

  it('no level port → refused and NOTHING written — never the old per-level loop', async () => {
    const p = product();
    const before = p.state();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, TWO_LEVELS);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok).toBe(false);
    expect(out.mutated).toBe(false);
    expect(p.perEvent).toEqual([]);
    expect(p.state()).toEqual(before);
  });

  it('LEVELS ONLY (no link needed): the second level is refused → NOTHING committed, in ONE call (Canvas #2010 N2)', async () => {
    const p = product({ trialLinked: true, refuseLevelOf: 'internal_trial' });
    const before = p.state();
    const caps = createAgentCapabilities(p.d, new ProposalStore(), undefined, 'full', undefined, { commitOptionLevels: p.commitOptionLevels });
    const r = await caps.proposeOptionInterventions(ctx, TWO_LEVELS);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok).toBe(false);
    expect(p.state(), 'the model is exactly as it was').toEqual(before);
    expect(p.calls, 'the whole scope in ONE call').toHaveLength(1);
    expect(p.calls[0]!.links).toEqual([]);
    expect(p.calls[0]!.levels.map((l) => l.option_id)).toEqual(['hire_two', 'internal_trial']);
    expect(p.perEvent).toEqual([]);
  });

  it('the writer reports committed but the model read back does not hold it → not_verified, never "saved" (Canvas #2010 N1)', async () => {
    const p = product({ claimsWithoutWriting: true });
    const caps = createAgentCapabilities(p.d, new ProposalStore(), undefined, 'full', undefined, { commitOptionLevels: p.commitOptionLevels });
    const r = await caps.proposeOptionInterventions(ctx, TWO_LEVELS);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_verified' }));
  });

  it('a retry of the same approval writes nothing again, and the reload still agrees', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore(), undefined, 'full', undefined, { commitOptionLevels: p.commitOptionLevels });
    const r = await caps.proposeOptionInterventions(ctx, TWO_LEVELS);
    await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    const after = p.state();
    const n = p.commits.length;
    await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(p.commits).toHaveLength(n);
    expect(p.state()).toEqual(after);
  });
});
