/**
 * B2 — ROADMAP 2.1003. The identical-replay regression fixture.
 *
 * RED-first. At pristine `6b8698a4` `composeEditFallbackText` does not exist
 * and the composer's fallback was:
 *
 *   result.appliedGraph
 *     ? `Applied edit. Graph now has N nodes and M edges.`
 *     : 'Edit processed.'
 *
 * whose truth condition is PRESENCE OF A GRAPH — true of a no-change apply and
 * true of a wrong-object apply. Measured on deployed staging: the identical
 * second request produced no new graph identity and still read
 * "Applied edit. Graph now has 21 nodes and 43 edges."
 */
import { describe, it, expect } from 'vitest';

import { composeEditFallbackText, selectEditAssistantText } from '../edit-graph-dispatch.js';
import { deriveEditTurnFieldsFromResult } from '../edit-graph-turn-event.js';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

function result(overrides: Partial<EditGraphResult> = {}): EditGraphResult {
  return {
    blocks: [],
    assistantText: null,
    latencyMs: 10,
    appliedGraph: {
      nodes: Array.from({ length: 21 }, (_, i) => ({ id: `n${i}` })),
      edges: Array.from({ length: 43 }, (_, i) => ({ from: 'n0', to: `n${i}` })),
    } as never,
    wasRejected: false,
    operations: [{ op: 'update_node', path: '/nodes/fac_cs', value: {} }] as never,
    ...overrides,
  } as EditGraphResult;
}

describe('B2 — an applied-but-unchanged turn never claims a change', () => {
  it('THE MEASURED SENTENCE IS GONE on a proven no-change apply', () => {
    const text = composeEditFallbackText(result({ modelUnchanged: true }));
    expect(text).not.toContain('Applied edit');
    expect(text).not.toMatch(/21 nodes/);
    expect(text.toLowerCase()).toContain('no change');
  });

  it('a REAL change is described by the deterministic receipt, not a node/edge count', () => {
    const text = composeEditFallbackText(result({
      modelUnchanged: false,
      appliedChanges: {
        summary: 'Customer Success Coverage Depth: 20% -> 40%',
        changes: [],
        rerun_recommended: true,
      },
    }));
    expect(text).toBe('Customer Success Coverage Depth: 20% -> 40%');
    expect(text).not.toContain('Applied edit');
  });

  it('A GUESS IS NOT A VERDICT: `undefined` keeps today\'s behaviour byte-identical', () => {
    // The no-verdict case must NOT render "no change" copy. It falls through
    // to the pre-existing count sentence, which is what pristine produced.
    const text = composeEditFallbackText(result({ modelUnchanged: undefined }));
    expect(text).toBe('Applied edit. Graph now has 21 nodes and 43 edges.');
  });

  it('rejection copy is unchanged', () => {
    expect(composeEditFallbackText(result({ wasRejected: true })))
      .toBe('The proposed edit was rejected.');
  });

  it('no applied graph is unchanged', () => {
    expect(composeEditFallbackText(result({ appliedGraph: null })))
      .toBe('Edit processed.');
  });

  it('WHOLESALE REPLACEMENT: LLM prose claiming a change is REPLACED, not appended to', () => {
    // Measured gap: without this the wholesale-replacement rule was unguarded
    // — a mutant that let `assistantText` win again left the whole suite
    // green. The LLM authors its prose before the applied graph returns, so
    // on the replay it confidently narrated a change that did not happen.
    const lie = 'I have increased Customer Success Coverage Depth to 40%.';
    const honest = composeEditFallbackText(result({ modelUnchanged: true }));
    expect(selectEditAssistantText(result({ modelUnchanged: true, assistantText: lie }), honest))
      .toBe(honest);
    // …and the lie is GONE, not merely followed by a correction.
    expect(selectEditAssistantText(result({ modelUnchanged: true, assistantText: lie }), honest))
      .not.toContain('increased');
  });

  it('NON-EQUIVALENCE of the replacement rule: with a verdict of changed, LLM prose still wins', () => {
    // The other half — proving the rule is scoped, not a blanket takeover of
    // the assistant text.
    const prose = 'I have increased Customer Success Coverage Depth to 40%.';
    expect(selectEditAssistantText(result({ modelUnchanged: false, assistantText: prose }), 'fb'))
      .toBe(prose);
    expect(selectEditAssistantText(result({ modelUnchanged: undefined, assistantText: prose }), 'fb'))
      .toBe(prose);
  });

  it('the turn event reports applied_unchanged, NOT success', () => {
    const fields = deriveEditTurnFieldsFromResult(result({ modelUnchanged: true }), {
      successfulAppliedMutation: true,
      graphNodesBefore: 21,
      graphEdgesBefore: 43,
    });
    // The measured signature was `outcome: success, operations_count: 1`.
    // operations_count stays 1 — the operation WAS proposed and applied; what
    // changes is that the outcome stops calling it a success.
    expect(fields.outcome).toBe('applied_unchanged');
    expect(fields.operations_count).toBe(1);
    expect(fields.model_changed).toBe(false);
  });

  it('a real change still reports success with model_changed true', () => {
    const fields = deriveEditTurnFieldsFromResult(result({ modelUnchanged: false }), {
      successfulAppliedMutation: true,
      graphNodesBefore: 21,
      graphEdgesBefore: 43,
    });
    expect(fields.outcome).toBe('success');
    expect(fields.model_changed).toBe(true);
  });

  it('NON-EQUIVALENCE OBLIGATION: no verdict => model_changed null, outcome unchanged from today', () => {
    // Demonstrated, not asserted (trap 13c): `undefined` must not be counted
    // as either a change or a no-change.
    const fields = deriveEditTurnFieldsFromResult(result({ modelUnchanged: undefined }), {
      successfulAppliedMutation: true,
      graphNodesBefore: 21,
      graphEdgesBefore: 43,
    });
    expect(fields.model_changed).toBeNull();
    expect(fields.outcome).toBe('success');
  });
});
