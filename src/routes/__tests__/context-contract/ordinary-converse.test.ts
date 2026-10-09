/**
 * REAL /agent/v1/turn route: ordinary-converse.
 * Doubles: getSessionStore (in-memory storage reads/append), internal POST
 * /assist/v1/scenarios/:scenario/graph snapshot read. Provider fetch intercepted;
 * exact sentBody bytes + sha256 written under out/provider/ordinary-converse/. No network.
 * Fixture run1/run2 come verbatim from prior seed manifests. All mutations and
 * synthetic revision probes are documented in fixtures/README.md.
 */
import { installContract } from './contract-rows.js';
import { it, expect } from 'vitest';
import { capture, findState, object, valueAt } from './provider-harness.js';
installContract('ordinary-converse');

it('default ordinary-converse run2 canonical_state has no run_explanation key', async () => {
  const w = await capture('ordinary-converse', 'run2');
  for (const call of w.calls) {
    const canonicalState = findState(call.payloads);
    expect(canonicalState.graph_revision).toBe(w.seed.revision);
    expect(canonicalState).not.toHaveProperty('run_explanation');
  }
  // #2900 positive control: run-explanation-turn-parity.test.ts checks the original
  // provider SHAs in fixtures/staging-turn-sha256.json; one-assembly checks opt-in presence.
}, 60_000);


it('C2 stale context retains selected revision and independently advances current revision', async () => {
  const w = await capture('ordinary-converse', 'stale');
  expect(w.state.scenario_revision).toBe(4403);
  expect(object(w.state.analysis)).toMatchObject({ selected_run_revision: 4402, selected_run_revision_source: 'recorded' });
  expect(valueAt(w.calls.flatMap(call => call.payloads), 'selected_run_revision')).toEqual([4402]);
}, 60_000);

it.each(['legacy', 'malformed'] as const)('C2 %s occurrence never becomes recorded zero in the provider body', async variant => {
  const w = await capture('ordinary-converse', 'run2', { readSnapshot: async snapshot => {
    const view = object(snapshot.canonical_analysis_view);
    view.staleness = { ...object(view.staleness), run_revision: variant === 'legacy' ? null : '4402',
      run_revision_source: variant === 'legacy' ? 'legacy_unknown' : 'recorded' };
    return snapshot;
  } });
  const analysis = object(w.state.analysis);
  if (variant === 'legacy') expect(analysis).toMatchObject({ selected_run_revision: null, selected_run_revision_source: 'legacy_unknown' });
  else expect(analysis).not.toHaveProperty('selected_run_revision');
  expect(w.state.scenario_revision).toBe(4402);
  expect(w.state).not.toHaveProperty('run_revision');
}, 60_000);

it('C2 Explain carries the selected revision in one analysis location', async () => {
  const w = await capture('Run-explanation', 'run2');
  for (const call of w.calls) {
    const state = findState(call.payloads);
    expect(object(state.analysis)).toMatchObject({ selected_run_revision: 4402, selected_run_revision_source: 'recorded' });
    expect(valueAt(call.payloads, 'selected_run_revision')).toEqual([4402]);
    expect(object(state.run_explanation)).not.toHaveProperty('selected_run_revision');
  }
}, 60_000);
