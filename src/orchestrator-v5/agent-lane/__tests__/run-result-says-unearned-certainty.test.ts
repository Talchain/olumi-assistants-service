/**
 * ⛔ THE AGENT NEVER SAYS AN UNEARNED GOAL CERTAINTY AS 100% (DL 5887061638, route A; AIQ 5882366427; MG's producer #2270).
 *
 * SERVED (R3's strict journey on CEE 5411da8): "Raise price to £59" reads P(goal) = 1, but the only path that can pull
 * MRR down runs through links nobody sized. `run_analysis` now carries, per option at exactly 0 or 1, the Run's decision
 * — `earned`, and for an unearned one the producer's own sentence — with a rule to say it instead of a certainty.
 * Recorded (#2280's `analysis_goal_certainty`) is followed verbatim; not recorded, the SAME producer runs on the Run's
 * exact graph, bound through the read's own result block; a Run that cannot be bound is `unchecked`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { goalCertaintyDecisions, goalCertaintyOfStoredResult } from '../goal-certainty.js';

type Json = Record<string, any>;
const FX = JSON.parse(
  readFileSync(new URL('../../__tests__/fixtures/served-strict-journey-5411da8-goal-certainty.json', import.meta.url), 'utf8'),
) as { paul: { graph: Json; option_comparison: Json[]; analysis_identity_evaluated_node_ids: string[]; identity_evaluations: Json[] } };
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c9', authenticated_user_id: null, request_id: 'r' };
const RUN_HASH = 'a'.repeat(64);
// The leader is PERMITTED on this run, so the certainty read cannot ride on the withheld-leader graph read.
const STATE = { run_state: { kind: 'complete_current' }, leader_claim: { permitted: true } };
// What the graph read attests: the ids THIS run evaluated — no `level_source`.
const READ_EVALUATIONS = FX.paul.analysis_identity_evaluated_node_ids.map((node_id) => ({ node_id, evaluated: true }));
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
  /** The read's `analysis_goal_certainty`; `undefined` = not on the read (not recorded). */
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
        ...(w.recorded !== undefined ? { analysis_goal_certainty: w.recorded } : {}), ...(w.read ?? {}) } };
    }
    if (path === '/orchestrate/v2/turn') {
      return { status: 200, json: { assistant_text: '', analysis_state: state, analysis_ready: w.leaderPermitted === false ? { status: 'ready' } : READY_NAMED, blocks: [block(rows)] } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { caps: createAgentCapabilities(d, new ProposalStore()), reads };
}
const run = async (w: World = {}): Promise<Json> => await world(w).caps.runAnalysis(ctx, { reason: 'Run it.' }) as Json;
type Certainty = { option: string; option_id: string; probability_of_goal: 0 | 1; earned: boolean; say?: string };
const p59 = (r: Json): Certainty => (r.goal_certainty.options as Certainty[]).find((x) => x.option_id === 'raise_price_to_59')!;

describe('route A — not recorded: the SAME producer on the Run\'s exact graph, bound through the read', () => {
  it('RED (served 5411da8): £59 at P = 1 is UNEARNED — the producer\'s own sentence and the rule, never 100%', async () => {
    const r = await run();
    expect(r.goal_certainty?.options, JSON.stringify(Object.keys(r))).toBeDefined();
    const expected = goalCertaintyDecisions(FX.paul.graph, FX.paul.option_comparison, READ_EVALUATIONS);
    expect(p59(r)).toEqual(expect.objectContaining({ option: 'Raise price to £59', probability_of_goal: 1, earned: false }));
    expect(p59(r).say).toBe(expected.find((d) => d.option_id === 'raise_price_to_59')!.say); // the producer's words, verbatim
    expect(r.goal_certainty.note).toMatch(/never .*100%.*certain/i);
  });

  it('an EARNED certainty carries no sentence — every surface says it as today', async () => {
    const earned = ((await run()).goal_certainty.options as Certainty[]).filter((x) => x.earned);
    expect(earned.map((x) => x.option_id).sort()).toEqual(['carry_on_as_now', 'raise_price_to_54']);
    for (const x of earned) expect(x).not.toHaveProperty('say');
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
});

describe('route A — a Run that cannot be bound is never said as certain (DL: "do not emit a 0/100 claim")', () => {
  it.each([
    ['the read selected another Run (another computed_against_hash)', { read: { analysis_result: block(FX.paul.option_comparison, 'b'.repeat(64)) } }],
    ['the read withholds its Run (no analysis_result)', { read: { analysis_result: null } }],
    ['the read calls its Run stale', { read: { analysis_state: { ...STATE, run_state: { kind: 'complete_stale' } } } }],
    ['the read\'s Run reports another P for a certain option', { read: { analysis_result: block(FX.paul.option_comparison.map((o) => ({ ...o, probability_of_goal: 0.5 }))) } }],
    ['the Run carries no computed_against_hash', { read: { analysis_result: block(FX.paul.option_comparison, null) } }],
    ['the graph read failed', { readStatus: 500 }],
  ] as Array<[string, World]>)('%s → unchecked, no options, the never-certain rule', async (_name, w) => {
    const r = await run(w);
    expect(r.goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
    expect(r.goal_certainty).not.toHaveProperty('options');
    expect(r.goal_certainty.note).toMatch(/Never call any of them\s+100% or 0%/);
  });
});

describe('route A — RECORDED (#2280\'s `analysis_goal_certainty`) is preferred, verbatim, and never recomputed', () => {
  it('the RECORDED sentence verbatim, break-even included (the ids-only recomputation cannot give it)', async () => {
    const stored = STORED.find((d) => d.option_id === 'raise_price_to_59')!;
    expect(stored.break_even, 'precondition: the recorded decision carries the stated-level break-even').toBeDefined();
    const r = await run({ recorded: STORED });
    expect(p59(r)).toEqual(expect.objectContaining({ earned: false, say: stored.say }));
    expect(p59(r).say).toMatch(/5\.9%/);
    // Contrast: not recorded, the same Run gives the producer's sentence without it.
    expect(p59(await run()).say).not.toMatch(/5\.9%/);
  });

  it('RECORDED `[]` is a record, not an absence: it covers no certainty → unchecked, never recomputed', async () => {
    const r = await run({ recorded: [] });
    expect(r.goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
    expect(r.goal_certainty).not.toHaveProperty('options');
  });

  it('a recorded decision a recomputation would contradict is FOLLOWED (one rule: the Run\'s own)', async () => {
    const tampered = STORED.map((d) => (d.option_id === 'raise_price_to_54' ? { ...d, earned: false, say: 'RECORDED SENTENCE.' } : d));
    const p54 = ((await run({ recorded: tampered })).goal_certainty.options as Certainty[]).find((x) => x.option_id === 'raise_price_to_54')!;
    expect(p54).toEqual(expect.objectContaining({ earned: false, say: 'RECORDED SENTENCE.' }));
  });

  it('a record at another P, or an unearned one with no sentence → unchecked (fail closed)', async () => {
    const otherP = STORED.map((d) => (d.option_id === 'raise_price_to_59' ? { ...d, probability_of_goal: 0 } : d));
    expect((await run({ recorded: otherP })).goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
    const mute = STORED.map((d) => (d.option_id === 'raise_price_to_59' ? { ...d, say: '' } : d));
    expect((await run({ recorded: mute })).goal_certainty).toEqual(expect.objectContaining({ unchecked: true }));
  });
});
