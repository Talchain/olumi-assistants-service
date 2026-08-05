/**
 * ROADMAP 2.474 — **ORCHESTRATOR RULING J2, A DELIBERATE BEHAVIOUR CHANGE.**
 *
 * `threshold_source` (who set the goal threshold) joins the referee's
 * pipeline-owned set. It is the same integrity class as `observed_state.source`
 * — a producer that can stamp it can relabel an AI-chosen threshold as
 * user-set — and it had no row in CEE's owned list because the match is
 * EXACT-SEGMENT and `threshold_source !== source`.
 *
 * WHAT CHANGES FOR A CALLER (the disclosure this file exists to make
 * executable, so the change is witnessed rather than absorbed into a wiring
 * commit):
 *
 *   (a) REASON CODE. A candidate naming `threshold_source` directly was already
 *       refused, but with the vaguer FIELD_NOT_ALLOWED ("a field it may not
 *       set"). It is now refused with PIPELINE_OWNED_FIELD ("an
 *       analysis-derived, pipeline-owned field"). A caller that switches on the
 *       code — the readable message, a retry policy, a telemetry bucket — sees
 *       a different value for the same input. No verdict changes: rejected
 *       before, rejected after.
 *
 *   (b) THE SUBSTANTIVE CHANGE — previously-ACCEPTED spellings are now
 *       REFUSED. Owned segments are screened on EVERY path segment and at every
 *       depth of an object payload. Before J2, `threshold_source` was neither,
 *       so it rode through as a segment of an allowed root and inside any
 *       object payload. Those two shapes flip from accepted to rejected.
 *
 * RED-first: at pristine (`threshold_source` absent from PIPELINE_OWNED_ROOTS)
 * the (a) tests fail on the code and the (b) tests fail on the verdict.
 */
import { describe, it, expect } from 'vitest';
import { refereeMutation } from '../referee.js';
import { FIELD_NOT_ALLOWED, PIPELINE_OWNED_FIELD } from '../reason-codes.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from './fixtures.js';

const G = buildReadyGraph();

function nodeUpdate(field: string, to: unknown) {
  return refereeMutation(
    makeEnvelope(
      'update_node_field',
      { node_id: 'f-spend', field, from: null, to },
      { base_graph_hash: hashOf(G) },
    ),
    G,
    frameFor(G),
  );
}

describe('J2 (a) — the reason code for a direct `threshold_source` write changes', () => {
  it('bare `threshold_source` is refused as PIPELINE_OWNED_FIELD, not FIELD_NOT_ALLOWED', () => {
    const v = nodeUpdate('threshold_source', 'user');
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
    expect(v.blocker?.code).not.toBe(FIELD_NOT_ALLOWED);
  });

  it('the readable message is the pipeline-owned one (what the user is actually told)', () => {
    const v = nodeUpdate('threshold_source', 'user');
    expect(v.blocker?.readable).toBe(
      'The candidate targets an analysis-derived, pipeline-owned field.',
    );
  });
});

describe('J2 (b) — spellings that were ACCEPTED before this change are now REFUSED', () => {
  it('`threshold_source` as a SEGMENT of an allowed root is refused', () => {
    const v = nodeUpdate('goal_constraints.threshold_source', 'user');
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('`threshold_source` in the slash-keyed producer spelling is refused', () => {
    const v = nodeUpdate('data/threshold_source', 'user');
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('`threshold_source` SMUGGLED inside an object payload is refused', () => {
    const v = nodeUpdate('goal_constraints', { target: 1000, threshold_source: 'user' });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('`threshold_source` buried two objects deep in a payload is refused (recursive, not depth-1)', () => {
    const v = nodeUpdate('goal_constraints', { meta: { deep: { threshold_source: 'user' } } });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });
});

describe('J2 — the four edge provenance stamps adopted in the same union', () => {
  const edgeUpdate = (field: string, to: unknown) =>
    refereeMutation(
      makeEnvelope(
        'update_edge_field',
        { from_node: 'f-spend', to_node: 'g-profit', field, from: null, to },
        { base_graph_hash: hashOf(G) },
      ),
      G,
      frameFor(G),
    );

  for (const stamp of ['weightSource', 'directionSource', 'strengthStdSource', 'beliefExistsSource']) {
    it(`edge \`${stamp}\` is refused as PIPELINE_OWNED_FIELD`, () => {
      const v = edgeUpdate(stamp, 'user');
      expect(v.verdict).toBe('rejected');
      expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
    });
  }
});

describe('J2 — the change is NARROWING only: nothing previously refused became allowed', () => {
  it('a lookalike root is still NOT swept in (exact-segment match preserved)', () => {
    // `threshold_source_label` is not a segment match; it must fail on the
    // allowlist, not on the owned screen — proving the union did not become a
    // substring match while nobody was looking.
    const v = nodeUpdate('threshold_source_label', 'x');
    expect(v.blocker?.code).toBe(FIELD_NOT_ALLOWED);
  });

  it('the live option-configure write still passes the screen (no capability revoked)', () => {
    const v = nodeUpdate('data/interventions/f-spend', {
      value: 25000,
      raw_value: 25000,
      unit: 'GBP',
      cap: 50000,
    });
    expect(v.blocker?.code).not.toBe(PIPELINE_OWNED_FIELD);
    expect(v.blocker?.code).not.toBe(FIELD_NOT_ALLOWED);
  });
});
