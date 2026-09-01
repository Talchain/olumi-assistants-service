import { describe, expect, it } from 'vitest';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { PendingAction } from '../../session/pending-action.js';
import { resolveRecordedOptionEffectAnswer } from '../repair-value-binding.js';

const now = Date.parse('2026-08-30T20:00:00Z');
const graph = {
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Approach' },
    { id: 'goal', kind: 'goal', label: 'Retention' },
    { id: 'first', kind: 'option', label: 'Current approach' },
    { id: 'second', kind: 'option', label: 'Current approach' },
    { id: 'factor', kind: 'factor', label: 'Completion' },
  ],
  edges: [ ['decision', 'first'], ['decision', 'second'], ['first', 'factor'],
    ['second', 'factor'], ['factor', 'goal'] ].map(([from, to]) => ({
    from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1,
    effect_direction: 'positive',
  })),
};
const graphHash = computeAnalysisAffectingGraphHash(graph);
if (graphHash === null) throw new Error('Fixture graph must have a canonical hash');
const pending: PendingAction = {
  id: '00000000-0000-4000-8000-000000000001', scenario_id: 'scenario',
  chip_id: 'chip_configure_option_clarify',
  action: { kind: 'elicit_option_effect', option_id: 'second',
    option_label: 'Current approach', factor_id: 'factor', factor_label: 'Completion' },
  preconditions: { graph_hash: graphHash },
  emitted_at_iso: new Date(now).toISOString(),
  expires_at_iso: new Date(now + 600000).toISOString(), expires_at_turn_count: 2,
};
const resolve = (message: string, pendings: readonly PendingAction[] | null = [pending],
  currentGraph = graph) => resolveRecordedOptionEffectAnswer({
  message, pendings, graph: currentGraph, scenarioId: 'scenario', nowMs: now,
  readiness: buildCanonicalAnalysisReadyFromGraph(currentGraph),
});

describe('recorded option-effect answer identity', () => {
  it.each(['Set it to about 0.9.', '0.9', '90%'])('binds %s to recorded second ID, not first/duplicate label', message => {
    const result = resolve(message);
    expect(result.kind).toBe('bind');
    if (result.kind === 'bind') {
      expect(result.answer.pair.optionId).toBe('second');
      expect(result.answer.pair.factorId).toBe('factor');
      expect(result.answer.valueText).toBe('0.9');
    }
  });
  it('withholds bare 20 without losing the known pair; explicit 20% remains valid', () => {
    const refused = resolve('20');
    expect(refused.kind).toBe('ask');
    if (refused.kind === 'ask') expect(refused.pair.optionId).toBe('second');
    expect(resolve('20%').kind).toBe('bind');
  });
  it('a pending for the other object changes the binding, not the number', () => {
    const other = { ...pending, action: { ...pending.action, option_id: 'first' } } as PendingAction;
    const result = resolve('0.9', [other]);
    expect(result.kind).toBe('bind');
    if (result.kind === 'bind') expect(result.answer.pair.optionId).toBe('first');
  });
  it.each(['Make it better', 'Run the analysis', 'Set Some other factor to 0.9'])('does not claim unrelated %s', message => {
    expect(resolve(message).kind).toBe('unrelated');
  });
  it('distinguishes unavailable pending history from proven absence', () => {
    expect(resolve('0.9', null).kind).toBe('unavailable');
    expect(resolve('0.9', []).kind).toBe('unrecorded');
  });
  it('does not replace a stale recorded pair with the current blocker head', () => {
    expect(resolve('0.9', [{ ...pending, preconditions: { graph_hash: 'stale' } }]).kind).toBe('stale');
    expect(resolve('0.9', [{ ...pending, expires_at_turn_count: 0 }]).kind).toBe('stale');
  });
  it('another numerical question blocks inference, but a run offer does not', () => {
    const baseline = { ...pending, id: '00000000-0000-4000-8000-000000000002',
      action: { kind: 'elicit_target_baseline', target_id: 'goal', target_label: 'Retention', constraint_type: 'at_most', value: 0.2 } } as PendingAction;
    expect(resolve('0.9', [pending, baseline]).kind).toBe('ambiguous');
    expect(resolve('0.9', [baseline]).kind).toBe('other_question');
    const run = { ...pending, action: { kind: 'run_analysis' } } as PendingAction;
    expect(resolve('0.9', [pending, run]).kind).toBe('bind');
  });
  it('rejects foreign scenario and duplicate IDs even with a matching graph hash', () => {
    expect(resolve('0.9', [{ ...pending, scenario_id: 'foreign' }]).kind).toBe('unavailable');
    const duplicate = { ...graph, nodes: [...graph.nodes, graph.nodes[3]!] };
    const duplicateHash = computeAnalysisAffectingGraphHash(duplicate);
    if (duplicateHash === null) throw new Error('Duplicate-ID fixture must still have a hash');
    expect(resolve('0.9', [{ ...pending, preconditions: {
      graph_hash: duplicateHash,
    } }], duplicate).kind).toBe('stale');
  });
});

/**
 * ⭐⭐⭐ THE SIGN, END TO END ON THE REPO'S OWN BINDING FIXTURE.
 *
 * ⚠⚠ MEASURED AT `e777309f`, THROUGH THIS EXACT `resolve` HELPER:
 *
 *     "-0.9"                 ->  bind  valueText=0.9
 *     "set it to -0.9"       ->  bind  valueText=0.9
 *     "make it -90% please"  ->  bind  valueText=0.9
 *
 * At base every one of those returned `null` from the reader and never bound —
 * a safe LOSS. The slot contract converted that loss into a WRONG WRITE: the
 * product would have recorded the OPPOSITE DIRECTION of what the user said, on
 * a domain where negative effects are ordinary. Pinned here rather than only at
 * the pure resolver, because "the pure function refuses it" and "no bind
 * reaches the writer" are different claims and only the second one is the harm.
 */
describe('a stated NEGATIVE never reaches the write path', () => {
  it.each([
    '-0.9',
    'set it to -0.9',
    'make it -90% please',
    '−0.9',
    'minus 0.9',
    'negative 0.9',
    'put it at -0.25',
  ])('%s does not bind', message => {
    const result = resolve(message);
    expect(result.kind).not.toBe('bind');
  });

  /**
   * ⚠ THE POSITIVE CONTROL. Every assertion above is satisfied by a resolver
   * that binds nothing at all, so on its own the block proves nothing about
   * this fixture (trap 13). These are the same sentences with the sign removed:
   * they MUST bind, and to the recorded pair by identity.
   */
  it.each([
    ['0.9', '0.9'],
    ['set it to 0.9', '0.9'],
    ['make it 90% please', '0.9'],
    ['put it at 0.25', '0.25'],
  ])('CONTRAST — %s still binds to the recorded pair', (message, expected) => {
    const result = resolve(message);
    expect(result.kind).toBe('bind');
    if (result.kind !== 'bind') return;
    expect(result.answer.valueText).toBe(expected);
    expect(result.answer.pair.optionId).toBe('second');
    expect(result.answer.pair.factorId).toBe('factor');
  });
});

/**
 * ⭐⭐ THE ATTEMPT COUNT ADVANCES — the half that made the whole counter dark.
 *
 * ⚠⚠ THE RESOLVER USED TO RETURN THE RECORDED ASK'S OWN COUNT. Combined with
 * the route's `pending_actions: []` carry-forward, which replays the recorded
 * row VERBATIM, the stored count never moved: every re-ask composed at attempt
 * 1, the attempt-2 copy was unreachable in production, and two identical
 * unreadable replies produced BYTE-IDENTICAL re-asks — the exact repetition
 * this exit exists to end, surviving inside its own fix.
 *
 * Emitting the re-ask IS the next attempt, so the verdict carries the recorded
 * count PLUS ONE, and hands back the row the route must rewrite.
 */
describe('the confirm verdict advances the attempt it will be recorded under', () => {
  it('a first ask (no attempt field) yields the SECOND attempt', () => {
    const result = resolve('a third');
    expect(result.kind).toBe('confirm');
    if (result.kind !== 'confirm') return;
    expect(result.attempt).toBe(2);
    // The route rewrites THIS row in its carry-forward list; without the row it
    // cannot find which pending to advance.
    expect(result.pending.id).toBe(pending.id);
  });

  it.each([[1, 2], [2, 3], [4, 5]])(
    'a row recorded at attempt %i yields %i',
    (recorded, expected) => {
      const row = { ...pending, action: { ...pending.action, attempt: recorded } } as PendingAction;
      const result = resolve('a third', [row]);
      expect(result.kind).toBe('confirm');
      if (result.kind !== 'confirm') return;
      expect(result.attempt).toBe(expected);
    },
  );
});
