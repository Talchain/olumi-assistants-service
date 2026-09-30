import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialRehearsal, transition, evidenceFor } from './rehearsal.mjs';

const data = JSON.parse(readFileSync(new URL('./rehearsal.json', import.meta.url), 'utf8'));

test('explore and dismiss do not change the model or authorise a later edit', () => {
  const initial = initialRehearsal();
  const explored = transition(initial, 'explore');
  assert.equal(explored.phase, 'before');
  const dismissed = transition(explored, 'dismiss');
  assert.deepEqual(transition(dismissed, 'approve_change'), dismissed);
  assert.deepEqual(transition(dismissed, 'add'), dismissed);
  assert.deepEqual(initial, initialRehearsal());
});

test('add retains a note; explicit approval alone moves to the recorded edited state', () => {
  let state = transition(initialRehearsal(), 'add');
  assert.equal(state.phase, 'before');
  assert.deepEqual(transition(state, 'approve_change'), state);
  state = transition(state, 'propose_change');
  assert.equal(transition(state, 'cancel_change').phase, 'before');
  state = transition(state, 'approve_change');
  assert.equal(state.phase, 'stale');
  assert.deepEqual(evidenceFor(data, state), []);
  assert.deepEqual(transition(state, 'approve_change'), state);
});

test('rerun switches to its own card; old evidence is never current after an edit or rerun', () => {
  let state = initialRehearsal();
  assert.deepEqual(transition(state, 'replay_rerun'), state);
  for (const event of ['add', 'propose_change', 'approve_change', 'replay_rerun']) state = transition(state, event);
  assert.equal(state.phase, 'after');
  assert.deepEqual(evidenceFor(data, state), data.states.after.card.lines);
  assert.notDeepEqual(evidenceFor(data, state), data.states.before.card.lines);
  assert.equal(data.card_currentness.before.stale[0], false);
  assert.equal(data.card_currentness.before.after[0], false);
  assert.equal(data.states.after.card.run_binding.computed_against_hash, data.states.after.graph_hash);
});

test('recorded change and receipt match; unavailable threshold status never becomes a number', () => {
  const price = phase => data.states[phase].graph.nodes.find(n => n.id === 'pro_plan_price').observed_state.raw_value;
  assert.equal(price('before'), 49);
  assert.equal(price('stale'), 50);
  assert.equal(price('after'), 50);
  for (const key of ['nodes', 'edges', 'goal_constraints']) {
    assert.deepEqual(data.change.receipt.graph[key], data.states.stale.graph[key]);
  }
  assert.equal(data.states.before.threshold_status, null);
  assert.equal(data.states.after.threshold_status, null);
  assert.equal(data.mode, 'recorded_rehearsal');
});
