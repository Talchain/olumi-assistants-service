/**
 * "Ask about this comparison", the input half (`comparison-block.ts`; lease #85 5949274551, split 5950639713). Every pair
 * is a SERVED cold graph read (`fixtures/comparison/*.json`, trimmed to graph + analysis_state + analysis_admission +
 * current_read, each with its source path and sha256). Rows bind by identity: the block equals what the read's own
 * `current_read.run_delta` says, through the explanation's own plan.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPARISON_BLOCK_RULE, comparisonBlockOf } from '../comparison-block.js';
import { checkMethodTurn } from '../guidance/index.js';
import { rerunPlanForGraph } from '../rerun-explanation.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Node = { id: string; kind: string; label: string };
type Row = { option_id: string; prior: number; current: number; noise_verdict: string };
type Read = { _source: string; json: { graph: { nodes: Node[] }; analysis_state: Record<string, unknown>;
  current_read: { run_delta?: Record<string, unknown> & { win_probabilities?: Row[] } } } };
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/comparison/${name}.json`, import.meta.url), 'utf8')) as Read;
const planOf = (r: Read) => rerunPlanForGraph(r.json.current_read.run_delta, r.json.graph, false);
const blockOf = (r: Read, leaderLicensed: boolean) => comparisonBlockOf(r.json.current_read.run_delta, planOf(r), r.json.graph, leaderLicensed);
/** The served pair's beyond-noise rows, each with its own direction, by the option's current label. */
const movedOf = (r: Read) => (r.json.current_read.run_delta!.win_probabilities ?? [])
  .filter((w) => w.noise_verdict === 'signal' && w.prior !== w.current)
  .map((w) => ({ option: r.json.graph.nodes.find((n) => n.id === w.option_id)!.label, direction: w.current > w.prior ? 'up' : 'down' }));

const C1_COMPLETE = read('c1-complete');
const C1_PARTIAL = read('c1-partial');
const C2_PARTIAL = read('c2-partial');
const C2_COMPLETE = read('c2-complete');
const C0 = read('c0');
const C3 = read('c3');
const NO_PAIR = read('stale-no-pair');

describe('the served pairs are what the rows say they are (controls)', () => {
  it.each([
    [C1_COMPLETE, 'C1_attributable', 'complete'], [C1_PARTIAL, 'C1_attributable', 'partial'], [C2_PARTIAL, 'C2_unpaired', 'partial'],
    [C2_COMPLETE, 'C2_unpaired', 'complete'], [C0, 'C0_identical', 'complete'], [C3, 'C3_engine_drift', 'complete'],
  ] as const)('%#: %s', (r, wireCase, coverage) => {
    expect(r._source).toMatch(/^output\/r3-successor-996ec64d\/f5\//u);
    expect(r.json.current_read.run_delta).toMatchObject({ attribution_case: wireCase, input_coverage: coverage });
  });
  it('the stale read carries no pair', () => {
    expect((NO_PAIR.json.analysis_state as { run_state: { kind: string } }).run_state.kind).toBe('complete_stale');
    expect(NO_PAIR.json.current_read.run_delta).toBeUndefined();
  });
  it('C1 + complete: two options moved beyond noise, in OPPOSITE directions (the reversed-direction control)', () => {
    expect(movedOf(C1_COMPLETE)).toEqual([
      { option: 'AI Reporting Module Sprint', direction: 'down' }, { option: 'Integration Bug Fix Sprint', direction: 'up' }]);
  });
});

describe('the block: the read\'s own pair, in Olumi\'s words, with what may be said', () => {
  it('IDENTITY: endpoints, case and coverage are the read\'s; what_changed is the plan\'s code line; no figure, no leader id', () => {
    const d = C2_PARTIAL.json.current_read.run_delta as { endpoints: { prior: { computed_at: string }; current: { computed_at: string } } };
    const block = blockOf(C2_PARTIAL, true);
    expect(block).toEqual({
      endpoints: { prior: { computed_at: d.endpoints.prior.computed_at }, current: { computed_at: d.endpoints.current.computed_at } },
      attribution_case: 'C2_unpaired', input_coverage: 'partial',
      what_changed: planOf(C2_PARTIAL)!.codeLine,
      cause_licensed: false, movement_licensed: true, moved_beyond_noise: movedOf(C2_PARTIAL),
      beyond_noise: false, rule: COMPARISON_BLOCK_RULE,
    });
    expect(block!.what_changed).toContain('Split Sprint Capacity');
    expect(JSON.stringify(block)).not.toMatch(/win_probabilit|leading_option|run_id/u);
    const numbers: number[] = [];
    JSON.stringify(block, (_k, v: unknown) => { if (typeof v === 'number') numbers.push(v); return v; });
    expect(numbers, 'no figure travels in the block').toEqual([]);
  });
  it('cause: licensed ONLY on C1 + complete coverage', () => {
    expect(blockOf(C1_COMPLETE, true)!.cause_licensed).toBe(true);
    for (const r of [C1_PARTIAL, C2_PARTIAL, C2_COMPLETE, C0, C3]) expect(blockOf(r, true)!.cause_licensed).toBe(false);
  });
  it.each([
    ['C1 + complete, leader withheld → no movement (the direction would rank the options)', C1_COMPLETE, false, 'leader_withheld'],
    ['C1 + complete, leader may be named → each moved option with its own direction', C1_COMPLETE, true, undefined],
    ['C1 + partial: no matched figures', C1_PARTIAL, true, 'no_matched_figures'],
    ['C0: every row within noise', C0, true, 'within_noise'],
    ['C3 (engine drift): every row within noise', C3, true, 'within_noise'],
  ] as const)('movement: %s', (_n, r, leader, unavailable) => {
    const block = blockOf(r, leader)!;
    expect(block.movement_unavailable).toBe(unavailable);
    expect(block.movement_licensed).toBe(unavailable === undefined);
    expect(block.moved_beyond_noise).toEqual(unavailable === undefined ? movedOf(r) : []);
  });
  it('no pair → no block', () => {
    expect(planOf(NO_PAIR)).toBeNull();
    expect(comparisonBlockOf(NO_PAIR.json.current_read.run_delta, planOf(NO_PAIR), NO_PAIR.json.graph, true)).toBeUndefined();
  });
});

describe('the CURRENT MODEL STATE carries the block from the SAME graph read', () => {
  const ctx = { scenario_id: '34276a19-0000-4000-8000-0000000000c1', authenticated_user_id: 'user-a', request_id: 'r' };
  const capsOver = (r: Read) =>
    createAgentCapabilities(async () => ({ status: 200, json: r.json as unknown as Record<string, unknown> }), new ProposalStore());
  it.each([
    ['leader withheld (served C1 + complete)', C1_COMPLETE, false],
    ['leader may be named (served C2 + partial)', C2_PARTIAL, true],
  ] as const)('IDENTITY, %s: state.comparison is exactly the block of the read\'s pair under the read\'s own leader licence', async (_n, r, leader) => {
    expect(r.json.analysis_state.leader_claim, 'the control: the served licence').toMatchObject({ permitted: leader });
    const st = await capsOver(r).getCanonicalState(ctx as never) as Record<string, unknown>;
    expect(st.ok).toBe(true);
    expect(st.comparison).toEqual(blockOf(r, leader));
  });
  it('a stale read with no pair → no comparison key at all', async () => {
    const st = await capsOver(NO_PAIR).getCanonicalState(ctx as never) as Record<string, unknown>;
    expect(st.ok).toBe(true);
    expect('comparison' in st).toBe(false);
  });
});

describe('a Run made in the turn hands the model the NEW pair (never the turn-start one)', () => {
  const ctx = { scenario_id: '34276a19-0000-4000-8000-0000000000c2', authenticated_user_id: 'user-a', request_id: 'r' };
  const J = C1_PARTIAL.json as unknown as Record<string, unknown>;
  /** The run turn answers with C1_PARTIAL's own result and delta; the canonical read afterwards selects the same pair. */
  const runCaps = (runDelta: unknown) => createAgentCapabilities(async (path: string) => path === '/orchestrate/v2/turn'
    ? { status: 200, json: { analysis_state: J.analysis_state, analysis_ready: { status: 'ready' }, blocks: [J.analysis_result],
      ...(runDelta !== undefined ? { run_delta: runDelta } : {}) } }
    : { status: 200, json: J }, new ProposalStore());
  it('IDENTITY: the run result carries exactly the block of the canonical read\'s pair', async () => {
    const out = await runCaps(C1_PARTIAL.json.current_read.run_delta).runAnalysis(ctx as never, { reason: 'compare' } as never) as Record<string, unknown>;
    expect(out.ran).toBe(true);
    expect(out.comparison).toEqual(blockOf(C1_PARTIAL, false));
  });
  it('CONTROL: a Run that made no pair (a first Run) carries no block', async () => {
    const out = await runCaps(undefined).runAnalysis(ctx as never, { reason: 'compare' } as never) as Record<string, unknown>;
    expect(out.ran).toBe(true);
    expect('comparison' in out).toBe(false);
  });
});

describe('RC 5949965940 (contract a4992165): RX-NO-CONTRARY-SAME keys on RECORDED rows (served crn-final2 11-cold-s4)', () => {
  const inputs = planOf(C2_COMPLETE)!.inputs;
  it('the control: one presence row, no template → no named change, one recorded', () => {
    expect(inputs.change_labels).toEqual([]);
    expect(inputs.changes_recorded).toBe(1);
  });
  it('"Nothing changed between the two runs." → RX-NO-CONTRARY-SAME; "Nothing else changed." passes it', () => {
    expect(checkMethodTurn('RERUN-EXPLANATION', 'Nothing changed between the two runs.', inputs).failed).toContain('RX-NO-CONTRARY-SAME');
    expect(checkMethodTurn('RERUN-EXPLANATION', 'Nothing else changed.', inputs).failed).not.toContain('RX-NO-CONTRARY-SAME');
  });
});
