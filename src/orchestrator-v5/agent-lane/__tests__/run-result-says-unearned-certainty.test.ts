/**
 * ⛔ THE AGENT NEVER SAYS AN UNEARNED GOAL CERTAINTY AS 100% (DL 5887061638, route A; AIQ 5882366427; MG's producer #2270).
 *
 * SERVED (R3's strict journey on CEE 5411da8): "Raise price to £59" reads P(goal) = 1, but the only path that can pull
 * MRR down runs through links nobody sized. `run_analysis` now carries, per option at exactly 0 or 1, the EXECUTED Run's
 * own stored decision (#2280) — `earned`, and for an unearned one the producer's sentence — with a rule to say it
 * instead of a certainty. One writer (DL 5887593253): attributed to this Run by its run-fact identity, followed verbatim,
 * never recomputed; otherwise `unchecked`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { goalCertaintyOfStoredResult } from '../goal-certainty.js';
import { projectGoalProbabilitiesForTransport } from '../../compose/goal-probability-transport.js';

type Json = Record<string, any>;
const FX = JSON.parse(
  readFileSync(new URL('../../__tests__/fixtures/served-strict-journey-5411da8-goal-certainty.json', import.meta.url), 'utf8'),
) as { paul: { graph: Json; option_comparison: Json[]; analysis_identity_evaluated_node_ids: string[]; identity_evaluations: Json[] } };
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c9', authenticated_user_id: null, request_id: 'r' };
// The Run's identity as the estate writes it: `graph_hash_at_run` (16 hex, the block's `computed_against_hash`) and its
// own `computed_at` stamp (served 0497e52: three Runs of one graph share the hash and differ only here).
const RUN_HASH = '8d463e248f9ff996';
const RUN_AT = '2026-09-29T09:28:45.852Z';
const OTHER_RUN_AT = '2026-09-29T09:28:46.107Z';
// The leader is PERMITTED on this run, so the certainty read cannot ride on the withheld-leader graph read.
const STATE = { run_state: { kind: 'complete_current', computed_at: RUN_AT }, leader_claim: { permitted: true } };
// What #2280's writer RECORDS for this Run: the producer on the stored graph and the whole PLoT body (level_source included).
const STORED = goalCertaintyOfStoredResult(FX.paul.graph, { enrichment: { option_comparison: FX.paul.option_comparison, identity_evaluations: FX.paul.identity_evaluations } });
// `hash: null` = the block carries no Run stamp.
const block = (rows: Json[], hash: string | null = RUN_HASH): Json => ({
  type: 'analysis_result', leading_option_id: 'raise_price_to_59', summary: 's', enrichment: { option_comparison: rows },
  ...(hash !== null ? { computed_against_hash: hash } : {}),
});
// A run whose leader may be named (the wire permits it AND the admission's mode is comparative), so no withheld-leader read.
const READY_NAMED = { status: 'ready', analysis_admission: { admitted: true, permitted_analysis_mode: 'comparative_leader' } };

interface World {
  rows?: Json[];
  /** The read's `analysis_goal_certainty`; default: THIS Run's stored array. `null` = not on the read (not recorded). */
  recorded?: unknown;
  /** Overrides on the read's body (its result block, its state, …). */
  read?: Json;
  readStatus?: number;
  leaderPermitted?: boolean;
}
function world(w: World = {}) {
  const rows = w.rows ?? FX.paul.option_comparison;
  const state = w.leaderPermitted === false ? { ...STATE, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } : STATE;
  const reads: string[] = [];
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) {
      reads.push(path);
      if (w.readStatus !== undefined) return { status: w.readStatus, json: {} };
      return { status: 200, json: { graph: FX.paul.graph, graph_hash: 'h1', analysis_state: state, analysis_result: block(rows),
        analysis_identity_evaluated_node_ids: FX.paul.analysis_identity_evaluated_node_ids,
        ...(w.recorded === null ? {} : { analysis_goal_certainty: w.recorded ?? STORED }), ...(w.read ?? {}) } };
    }
    if (path === '/orchestrate/v2/turn') {
      return { status: 200, json: { assistant_text: '', analysis_state: state, analysis_ready: w.leaderPermitted === false ? { status: 'ready' } : READY_NAMED, blocks: [block(rows)] } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { caps: createAgentCapabilities(d, new ProposalStore()), reads };
}
const run = async (w: World = {}): Promise<Json> => await world(w).caps.runAnalysis(ctx, { reason: 'Run it.' }) as Json;
type Certainty = { option: string; option_id: string; probability_of_goal?: 0 | 1; earned: boolean; say?: string };
const p59 = (r: Json): Certainty => (r.goal_certainty.options as Certainty[]).find((x) => x.option_id === 'raise_price_to_59')!;

describe('the EXECUTED Run\'s own stored decision (#2280), attributed by its run-fact identity', () => {
  it('RED (served 5411da8): £59 at P = 1 is UNEARNED — the STORED sentence verbatim (break-even included) and the rule', async () => {
    const stored = STORED.find((d) => d.option_id === 'raise_price_to_59')!;
    expect(stored.break_even, 'precondition: the stored decision carries the stated-level break-even').toBeDefined();
    const r = await run();
    expect(r.goal_certainty?.options, JSON.stringify(Object.keys(r))).toBeDefined();
    expect(p59(r)).toEqual(expect.objectContaining({ option: 'Raise price to £59', earned: false, say: stored.say }));
    expect(p59(r)).not.toHaveProperty('probability_of_goal');
    expect(p59(r).say).toMatch(/5\.9%/);
    expect(r.goal_certainty.note).toMatch(/never .*100%.*certain/i);
  });

  it('an EARNED certainty carries no sentence — every surface says it as today', async () => {
    const earned = ((await run()).goal_certainty.options as Certainty[]).filter((x) => x.earned);
    expect(earned.map((x) => x.option_id).sort()).toEqual(['carry_on_as_now', 'raise_price_to_54']);
    for (const x of earned) expect(x).not.toHaveProperty('say');
  });

  it('an all-unearned transport-stripped immediate Run reads its stored sentence once and never restores its exact chance', async () => {
    const rows = FX.paul.option_comparison.filter((o) => o.option_id === 'raise_price_to_59');
    const stripped = projectGoalProbabilitiesForTransport({ option_comparison: rows }, STORED)!;
    const projectedRows = stripped.option_comparison as Json[];
    expect(projectedRows[0]).not.toHaveProperty('probability_of_goal');
    const w = world({ rows: projectedRows });
    const r = await w.caps.runAnalysis(ctx, { reason: 'Run it.' }) as Json;
    expect(p59(r)).toMatchObject({ earned: false, say: STORED.find((d) => d.option_id === 'raise_price_to_59')!.say });
    expect(p59(r)).not.toHaveProperty('probability_of_goal');
    expect(w.reads).toHaveLength(1);
  });

  it('CONTROL: no option at exactly 0 or 1 → nothing carried, and no graph read spent on it', async () => {
    const w = world({ rows: FX.paul.option_comparison.map((o) => ({ ...o, probability_of_goal: 0.6 })) });
    const r = await w.caps.runAnalysis(ctx, { reason: 'Run it.' }) as Json;
    expect(r).not.toHaveProperty('goal_certainty');
    expect(w.reads).toHaveLength(0);
  });

  it('ONE graph read: a named leader reads once for the rule; a withheld leader\'s read is the one the rule uses', async () => {
    const named = world();
    const r = await named.caps.runAnalysis(ctx, { reason: 'Run it.' }) as Json;
    expect(r.claim_permissions.leader_may_be_named, 'precondition: no withheld-leader read').toBe(true);
    expect(p59(r).earned).toBe(false);
    expect(named.reads).toHaveLength(1);
    const withheld = world({ leaderPermitted: false });
    const w = await withheld.caps.runAnalysis(ctx, { reason: 'Run it.' }) as Json;
    expect(w.claim_permissions.leader_may_be_named).not.toBe(true);
    expect(p59(w).earned).toBe(false);
    expect(withheld.reads).toHaveLength(1);
  });

  it('the RECORDED words are followed verbatim, never re-derived (one writer: the Run\'s own)', async () => {
    const recorded = STORED.map((d) => (d.option_id === 'raise_price_to_59' ? { ...d, say: 'RECORDED SENTENCE.' } : d));
    expect(p59(await run({ recorded }))).toEqual(expect.objectContaining({ earned: false, say: 'RECORDED SENTENCE.' }));
  });
});

describe('never said as certain unless THIS Run\'s own record says so (DL: "never state 0/100")', () => {
  it('NOT RECORDED (an older Run, a Run whose writer refused) → unchecked; nothing is recomputed', async () => {
    const r = await run({ recorded: null });
    expect(r.goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
    expect(r.goal_certainty).not.toHaveProperty('options');
  });

  it('RECORDED `[]` is a record, not an absence: it covers no certainty → unchecked', async () => {
    expect((await run({ recorded: [] })).goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
  });

  it('a record the writer\'s contract refuses reads as not recorded (#2280\'s ONE reader) → unchecked', async () => {
    // An unearned decision with its sentence but neither its unsized path nor its identity mismatch: the writer's
    // contract refuses it (it would otherwise be followed — the shape alone looks complete).
    const refused = STORED.map((d) => (d.option_id === 'raise_price_to_59'
      ? { option_id: d.option_id, probability_of_goal: d.probability_of_goal, earned: false, say: 'UNATTESTED SENTENCE.' } : d));
    const r = await run({ recorded: refused });
    expect(r.goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
    expect(JSON.stringify(r)).not.toContain('UNATTESTED SENTENCE.');
  });

  it('a record at another P → unchecked; an unearned one with no sentence is refused by the writer\'s contract → unchecked', async () => {
    const otherP = STORED.map((d) => (d.option_id === 'raise_price_to_59' ? { ...d, probability_of_goal: 0 } : d));
    expect((await run({ recorded: otherP })).goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
    const mute = STORED.map((d) => (d.option_id === 'raise_price_to_59' ? { ...d, say: undefined } : d));
    expect((await run({ recorded: mute })).goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
  });

  it('⛔ TWO RUNS, ONE GRAPH (PR Review CR @ d3a7a96b): the read carries ANOTHER Run\'s record — same hash, same P, a different verdict → unchecked', async () => {
    const otherRun = STORED.map((d) => (d.option_id === 'raise_price_to_59' ? { option_id: d.option_id, probability_of_goal: d.probability_of_goal, earned: true } : d));
    const other = { analysis_state: { ...STATE, run_state: { kind: 'complete_current', computed_at: OTHER_RUN_AT } } };
    const r = await run({ recorded: otherRun, read: other });
    expect(r.goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
    expect(r.goal_certainty).not.toHaveProperty('options');
    // Contrast: the SAME record on a read of THIS Run is followed — the stamp is what decides.
    expect(p59(await run({ recorded: otherRun })).earned).toBe(true);
  });

  it.each([
    ['the read selected another Run of the same graph (same hash, same P, another stamp)', { read: { analysis_state: { ...STATE, run_state: { kind: 'complete_current', computed_at: OTHER_RUN_AT } } } }],
    ['the Run carries no stamp of its own', { read: { analysis_state: { ...STATE, run_state: { kind: 'complete_current' } } } }],
    ['the read selected a Run of another graph (another computed_against_hash)', { read: { analysis_result: block(FX.paul.option_comparison, 'b'.repeat(16)) } }],
    ['the read withholds its Run (no analysis_result)', { read: { analysis_result: null } }],
    ['the read calls its Run stale', { read: { analysis_state: { ...STATE, run_state: { kind: 'complete_stale', computed_at: RUN_AT } } } }],
    ['the Run carries no computed_against_hash', { read: { analysis_result: block(FX.paul.option_comparison, null) } }],
    ['the graph read failed', { readStatus: 500 }],
  ] as Array<[string, World]>)('%s → unchecked, no options, the never-certain rule', async (_name, w) => {
    const r = await run(w);
    expect(r.goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
    expect(r.goal_certainty).not.toHaveProperty('options');
    expect(r.goal_certainty.note).toMatch(/Never call any of them\s+100% or 0%/);
  });
});
