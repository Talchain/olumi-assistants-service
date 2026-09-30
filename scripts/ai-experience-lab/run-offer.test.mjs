import { test } from 'vitest';
import assert from 'node:assert/strict';
import { visibleLabActions, runDeltaForDisplay } from './rehearsal-ui.mjs';

test('carries only explicitly offered starting-assumption, approval and typed Run actions', () => {
  const actions = [
    { id: 'agent-suggest-starting-assumptions', label: 'Suggest starting assumptions', message: 'Suggest assumptions.' },
    { id: 'agent-approve-proposal:p1', label: 'Apply change', message: 'Yes, apply it.' },
    { id: 'agent-approve-proposal:no-words', label: 'No approval words' },
    { id: 'agent-suggest-starting-assumptions-copy', label: 'Forged suggestion', message: 'Suggest assumptions.' },
    { id: 'agent-run-analysis', action_type: 'run_analysis', label: 'Run analysis' },
    { id: 'agent-run-analysis', action_type: 'research', label: 'Wrong action' },
    { id: 'agent-run-analysis-copy', action_type: 'run_analysis', label: 'Forged Run' },
  ];
  assert.deepEqual(visibleLabActions(actions).map(a => a.label), ['Suggest starting assumptions', 'Apply change', 'Run analysis']);
  assert.deepEqual(visibleLabActions([]), []);
});

test('shows only a bound server delta without calculating a comparison', () => {
  const delta = { prior_run_id: 'one', current_run_id: 'two', example_value: 0.37 };
  assert.deepEqual(runDeltaForDisplay({ run_delta: delta }, true), { kind: 'delta', value: delta });
  assert.deepEqual(runDeltaForDisplay({ run_delta: delta }, false), {
    kind: 'absence', value: 'No verified before/after delta returned',
  });
});

test('a producer absence reason wins over a contradictory delta and is displayed exactly', () => {
  const response = { run_delta: { example_value: 0.37 },
    analysis_state: { leader_claim: { withheld_reason: 'analysis_run_identity_conflict' } },
    analysis_ready: { run_delta_absence_reason: 'echoes_incomplete' } };
  assert.deepEqual(runDeltaForDisplay(response, true), { kind: 'absence', value: 'echoes_incomplete' });
});
