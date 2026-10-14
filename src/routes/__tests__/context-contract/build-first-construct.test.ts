/** REAL /agent/v1/turn -> capability -> buildModelFromBrief -> route callStructured -> provider fetch.
 * Doubles ONLY: SessionStore storage and graph snapshot read (empty fresh scenario).
 * Provider returns no structured output AFTER first-construct input is captured: no graph-write,
 * PLoT or validation execution is substituted. This tests first-construct, not a completed build.
 * R1 N/A: this fresh request selects no Run. Specialist retry/validation/review/widening calls are NEXT.
 */
import { describe, it, expect } from 'vitest';
import { capture, seedOf, object, keysDeep, type Witness, type Obj } from './provider-harness.js';

export const BUILD_BRIEF = 'S8_FIRST_CONSTRUCT: Reach £20,000 MRR within 12 months. Keep £49 price or raise price to £59. Paul assumes churn stays at 3%; Maya disagrees. What evidence would settle this?';
let memo: Promise<Witness> | undefined;
function run(): Promise<Witness> {
  memo ??= capture('ordinary-converse', 'run2', {
    evidenceLabel: 'build-first-construct', expectedCalls: null,
    payload: { message: 'Help structure this strategic brief.', },
    storage: { readExistingScenario: async () => ({ userId: null, graph: { nodes: [], edges: [] }, briefText: BUILD_BRIEF, revision: 4402 }) },
    readSnapshot: async () => ({ graph: { nodes: [], edges: [] }, graph_hash: 'empty',
      analysis_state: { run_state: { kind: 'never_run' }, leader_claim: { permitted: false, withheld_reason: 'no_analysis' } } }),
    providerReply: (body: Obj, index: number) => {
      if (object(object(body.text).format).name === 'whole_candidate') return { status: 'completed', output: [] };
      if (index === 1) return { status: 'completed', output: [{ type: 'function_call', name: 'build_model_from_brief',
        call_id: 'contract-build-first', arguments: JSON.stringify({ brief: BUILD_BRIEF }) }] };
      return { status: 'completed', output: [{ type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: 'The construction returned no model.' }] }] };
    },
  });
  return memo;
}
function construction(w: Witness) {
  const calls = w.calls.filter(c => object(object(c.body.text).format).name === 'whole_candidate');
  expect(calls, 'planted positive proves the REAL construction transport was reached').toHaveLength(1);
  return calls[0]!;
}
describe('build/draft first-construct exact provider body', () => {
  it('R2 planted positive: first construction carries exact brief, options and qualitative reasoning', async () => {
    const body = construction(await run()).body;
    expect(body.input).toBe(BUILD_BRIEF);
    expect(body.input).toContain('Keep £49 price or raise price to £59');
    expect(body.input).toContain('Paul assumes churn stays at 3%; Maya disagrees.');
    expect(body.input).toContain('What evidence would settle this?');
  }, 60_000);
  it('R2/R3 no selected-Run licence claims, raw result or stale Run facts on first-construct', async () => {
    const call = construction(await run()), keys = keysDeep(call.body);
    for (const key of ['analysis_result', 'enrichment', 'pct_by_option', 'driver_by_option', 'flip_thresholds', 'warnings',
      'probability_of_goal', 'goal_chance_display', 'goal_chance_driver_display', 'tipping_point', 'win_probability']) {
      expect(keys).not.toContain(key);
    }
    for (const fixture of ['run1', 'run2'] as const) {
      expect(call.sentBody).not.toContain(seedOf(fixture).captured_execution_run_id);
      expect(call.sentBody).not.toContain(seedOf(fixture).captured_run_reference);
    }
  }, 60_000);
});
