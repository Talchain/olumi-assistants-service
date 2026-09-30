/**
 * ⭐ ORIGIN ≠ ACCEPTANCE, at every reader of a whole `observed_state` (52f8cd; DL CR on #2412 5921764485; R3 5921833180;
 * AIQ 5921822609).
 *
 * `user_assumption` has two writers: the user marking a figure as their assumption, and the approved adoption of
 * Olumi's proposed figure (`set-factor-value.ts`), which ALSO records the approval as `reviewed_by_user`. The first is
 * the user's number; the second is Olumi's, accepted. The literal alone cannot tell them apart, so the display branches
 * on the adoption fact the writer stores — and a bare literal keeps its old projection.
 *
 * The pair below differs ONLY in that fact (same literal, same value): a reader keyed on the literal, or on the value,
 * gives both rows one answer.
 */
import { describe, it, expect } from 'vitest';
import { compactGraph } from '../../../../src/orchestrator/context/graph-compact.js';
import {
  isAcceptedOlumiEstimate,
  observedValueAuthorship,
  valueSourceAuthorship,
} from '../../../../src/cee/transforms/provenance-display.js';
import { projectRunGraphForDecisionReview } from '../../../../src/orchestrator-v5/coaching/decision-review-graph-projection.js';
import type { GraphV3T } from '../../../../src/schemas/cee-v3.js';

const AT = '2026-09-30T23:00:00.000Z';
/** The approved adoption's stored pair (the writer's own shape: `values-only-adoption-is-an-assumption.test.ts`). */
const ADOPTED = { value: 0.3, raw_value: 30, source: 'user_assumption', extractionType: 'inferred', reviewed_by_user: { intent: 'confirm', at: AT } };
/** The DL's negative: a figure from the user's own brief, marked as their assumption — no review. */
const BRIEF_MARKED = { value: 0.3, raw_value: 30, source: 'user_assumption', extractionType: 'explicit' };

const factor = (id: string, observed_state: Record<string, unknown>) => ({ id, kind: 'factor', label: id, observed_state });
const graph = { nodes: [factor('fac_adopted', ADOPTED), factor('fac_brief_marked', BRIEF_MARKED)], edges: [] };
const compacted = (id: string) => compactGraph(graph as unknown as GraphV3T).nodes.find((n) => n.id === id)!;

describe('the shared projection', () => {
  it('RED: Olumi\'s figure the user ACCEPTED projects Olumi\'s pair — never user_set', () => {
    expect(isAcceptedOlumiEstimate(ADOPTED)).toBe(true);
    expect(observedValueAuthorship(ADOPTED)).toEqual({ source: 'assumption', provenance: 'ai_inferred' });
  });

  it('NEGATIVE (DL 5921764485): the brief\'s own figure, marked as the user\'s assumption with no review, stays THEIRS', () => {
    expect(isAcceptedOlumiEstimate(BRIEF_MARKED)).toBe(false);
    expect(observedValueAuthorship(BRIEF_MARKED)).toEqual({ source: 'user', provenance: 'user_set' });
  });

  it('NEGATIVE: a link-pairing quote (`confirm_pairing`) is not the acceptance of a figure', () => {
    const pairing = { ...BRIEF_MARKED, reviewed_by_user: { intent: 'confirm_pairing', quote: 'q' } };
    expect(observedValueAuthorship(pairing)).toEqual({ source: 'user', provenance: 'user_set' });
  });

  it('NEGATIVE: a review on any OTHER literal is left to that literal\'s own row (a typed figure stays the user\'s)', () => {
    expect(observedValueAuthorship({ source: 'user_override', reviewed_by_user: { intent: 'confirm', at: AT } }))
      .toEqual({ source: 'user', provenance: 'user_set' });
    expect(observedValueAuthorship({ source: 'cee_inference', reviewed_by_user: { intent: 'confirm', at: AT } }))
      .toEqual(valueSourceAuthorship('cee_inference'));
  });

  it('CONTROL: the bare literal\'s own row is unchanged, and a non-record reads as nothing', () => {
    expect(valueSourceAuthorship('user_assumption')).toEqual({ source: 'user', provenance: 'user_set' });
    expect(observedValueAuthorship(undefined)).toBeUndefined();
    expect(observedValueAuthorship('user_assumption')).toBeUndefined();
  });
});

describe('what the model is given (the real compactor)', () => {
  it('RED: the adopted figure reaches the model as Olumi\'s', () => {
    expect(compacted('fac_adopted')).toMatchObject({ source: 'assumption', provenance: 'ai_inferred' });
  });

  it('NEGATIVE: the brief figure the user marked as their assumption reaches it as the user\'s', () => {
    expect(compacted('fac_brief_marked')).toMatchObject({ source: 'user', provenance: 'user_set' });
  });

  it('the pair is indistinguishable by literal and value (the rows above would be vacuous otherwise)', () => {
    expect(ADOPTED.source).toBe(BRIEF_MARKED.source);
    expect(compacted('fac_adopted').value).toBe(compacted('fac_brief_marked').value);
  });
});

describe('the decision review\'s run-graph projection, both arms', () => {
  it('strict arm (the compactor): Olumi\'s accepted figure vs the user\'s own', () => {
    const p = projectRunGraphForDecisionReview({}, graph);
    expect(p.via).toBe('run_snapshot_strict');
    const byId = new Map((p.graph.nodes as Array<Record<string, unknown>>).map((n) => [n.id, n]));
    expect(byId.get('fac_adopted')).toMatchObject({ source: 'assumption', provenance: 'ai_inferred' });
    expect(byId.get('fac_brief_marked')).toMatchObject({ source: 'user', provenance: 'user_set' });
  });

  it('preserving arm (a graph the strict schema refuses): the same two answers', () => {
    const loose = { ...graph, edges: [{ id: 'e1', from: 'fac_adopted', to: 'fac_brief_marked', strength: 'not-a-number' }] };
    const p = projectRunGraphForDecisionReview({}, loose);
    expect(p.via).toBe('run_snapshot_preserving');
    const byId = new Map((p.graph.nodes as Array<Record<string, unknown>>).map((n) => [n.id, n]));
    expect(byId.get('fac_adopted')).toMatchObject({ source: 'assumption', provenance: 'ai_inferred' });
    expect(byId.get('fac_brief_marked')).toMatchObject({ source: 'user', provenance: 'user_set' });
  });
});
