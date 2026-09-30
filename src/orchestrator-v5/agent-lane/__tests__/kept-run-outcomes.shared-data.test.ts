import { describe, expect, it } from 'vitest';
import {
  EARLIER_RUN_ATTEMPT_NOTE, EARLIER_RUN_NOTE, SUPERSEDED_OUTPUT, pruneSupersededToolOutputs,
} from '../history-store.js';

const WHEN = '2026-09-29T13:07:48.159Z';
const run = {
  ok: true, ran: true, status: 'complete',
  run_identity: { scenario_id: 's1', graph_hash_at_run: 'same-hash', computed_at: WHEN },
  result: { computed_against_hash: 'same-hash', summary: '£26k winner',
    option_comparison: [{ option_id: 'p59', outcome: { low: 0, high: 1 }, probability_of_goal: 1 }] },
  goal_chance: { probability_of_goal: 1, say: 'Certain' },
  claim_permissions: { leader_may_be_named: true },
  goal_certainty: { options: [{ option_id: 'p59', earned: true, probability_of_goal: 1 }] },
  what_is_missing: ['Caveat from an earlier run'],
};
const pair = (id: string, value: unknown) => [
  { type: 'function_call', name: 'run_analysis', call_id: id, arguments: '{}' },
  { type: 'function_call_output', call_id: id, output: JSON.stringify(value) },
];
const output = (items: readonly unknown[], index: number) =>
  JSON.parse((items[index] as { output: string }).output) as Record<string, unknown>;

// The canonical readback is the only authority for facts on the next turn. History is a pointer.
describe('retained Run history contains no analysis facts', () => {
  it('a proven Run retains only its time marker, regardless of selected, stale, or missing readback', () => {
    const source = pair('run-1', run);
    const selected = { scenarioId: 's1', analysisState: { run_state: { kind: 'complete_current', computed_at: WHEN } },
      analysisResult: run.result };
    const current = pruneSupersededToolOutputs(source, [], selected);
    const stale = pruneSupersededToolOutputs(source, [], { ...selected,
      analysisState: { run_state: { kind: 'complete_stale', computed_at: WHEN } } });
    const unreadable = pruneSupersededToolOutputs(source);
    const marker = { note: `Earlier analysis ran at ${WHEN}; see the current Run in CURRENT MODEL STATE.` };
    expect(output(current, 1)).toEqual(marker);
    expect(output(stale, 1)).toEqual(marker);
    expect(output(unreadable, 1)).toEqual(marker);
    expect(pruneSupersededToolOutputs(current, [], selected)).toEqual(current);
    for (const items of [current, stale, unreadable]) {
      expect(items[0]).toEqual(source[0]); // Responses API pair remains valid.
      expect(JSON.stringify(output(items, 1))).not.toMatch(/£26k|p59|probability|result|claim_permissions|certainty|what_is_missing|Caveat|same-hash/);
    }
  });

  it('two Runs of the same graph leave zero old figures; only the latest neutral marker remains', () => {
    const newer = { ...run, run_identity: { ...run.run_identity, computed_at: '2026-09-29T13:08:48.159Z' },
      result: { ...run.result, summary: 'Different old winner' } };
    const items = pruneSupersededToolOutputs([...pair('run-1', run), ...pair('run-2', newer)]);
    expect((items[1] as { output: string }).output).toBe(SUPERSEDED_OUTPUT);
    expect(output(items, 3)).toEqual({ note: 'Earlier analysis ran at 2026-09-29T13:08:48.159Z; see the current Run in CURRENT MODEL STATE.' });
    expect(JSON.stringify(items)).not.toMatch(/£26k|Different old winner|probability_of_goal|leader_may_be_named/);
  });

  it('an unproven or malformed Run says attempt, without inventing a successful run or echoing an untrusted time', () => {
    for (const old of [{ ran: false, result: run.result, run_identity: run.run_identity },
      { ran: true, result: run.result, run_identity: { computed_at: 'not a time' } },
      { ran: true, result: run.result }]) {
      const marker = output(pruneSupersededToolOutputs(pair('run-1', old)), 1);
      expect(marker).toEqual({ note: old.ran === true ? EARLIER_RUN_NOTE : EARLIER_RUN_ATTEMPT_NOTE });
    }
  });
});
