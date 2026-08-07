/**
 * Lane 8 — live-wiring adapters + §6.7 supersession (module-local, pure).
 *
 *  1. CanonicalContextFrame → MutationFrame adapter (Part 2b): fail-closed
 *     projection of the V6 frame authorities into the referee's frame.
 *  2. edit_graph PatchOperation → CandidateMutationEnvelope producer
 *     (Part 2c): validated ops project to R1-parseable envelopes; malformed
 *     input degrades to R1-rejectable envelopes, never throws/drops.
 *  3. §6.7 supersession (Part 1b): a newer candidate targeting the same
 *     entity supersedes the older held one — module-local, no persistence.
 */
import { describe, expect, it } from 'vitest';

import {
  contextFrameToMutationFrame,
  narrowFrameFreshness,
} from '../adapters/context-frame.js';
import {
  editOperationsToCandidateEnvelopes,
  parseEdgeTargetPath,
} from '../adapters/edit-graph-producer.js';
import {
  collapseSupersededHeld,
  mutationTargetKey,
  supersedesHeldCandidate,
} from '../pending-projection.js';
import { parseEnvelope } from '../parse-envelope.js';
import { refereeMutationBatch } from '../referee.js';
import { PROPOSAL_CAP, type CandidateMutationEnvelope } from '../types.js';
import { BATCH_CAP_EXCEEDED } from '../reason-codes.js';
import type { CanonicalContextFrame } from '../../context/frame/types.js';
import { makeEnvelope, SAMPLE_PAYLOADS, buildReadyGraph, frameFor } from './fixtures.js';

// ── helpers ─────────────────────────────────────────────────────────────────

function frameStub(overrides: {
  graphHash?: string | null;
  verdict?: string;
  status?: string | null;
}): CanonicalContextFrame {
  return {
    version: '0.3.0',
    model: {
      graphHash: 'graphHash' in overrides ? (overrides.graphHash ?? null) : 'a1b2c3d4e5f6a1b2',
      graphHashAtRun: null,
    },
    analysis: {
      status: (overrides.status ?? 'ready') as never,
      usableForProse: true,
      usableForChips: true,
      usableForFollowupContext: true,
      requiresRerun: false,
      blockedUnusable: false,
      source: 'turn_executor' as never,
    },
    freshness: {
      verdict: (overrides.verdict ?? 'fresh') as never,
      reason: 'graph_hash_match' as never,
      computedAt: null,
    },
    changes: [],
    conversation: { priorTurnCount: 0, recentChangeCount: 0, pendingConfirmation: false },
    intent: { deterministicMatch: false },
    evidence: {},
    claimPermissions: {} as never,
    actions: {},
    uiTargets: {},
    diagnostics: {},
  };
}

let seq = 0;
function makeId(): string {
  seq += 1;
  return `${String(seq).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
}

const PRODUCER_CTX = {
  base_graph_hash: 'hash-base-16hex',
  scenario_id: 'scn-1',
  turn_id: 'turn-1',
  makeCandidateId: makeId,
};

function parsedEnvelope(kind: keyof typeof SAMPLE_PAYLOADS, overrides = {}): CandidateMutationEnvelope {
  const parsed = parseEnvelope(makeEnvelope(kind, SAMPLE_PAYLOADS[kind], overrides));
  if (!parsed.ok) throw new Error(`fixture envelope for ${kind} must parse`);
  return parsed.envelope;
}

// ── 1. CanonicalContextFrame → MutationFrame ────────────────────────────────

describe('contextFrameToMutationFrame (Part 2b)', () => {
  it('null/undefined frame → null (referee resolves FRAME_UNAVAILABLE → held)', () => {
    expect(contextFrameToMutationFrame(null)).toBeNull();
    expect(contextFrameToMutationFrame(undefined)).toBeNull();
  });

  it('projects hash + freshness + canonical readiness from the frame authorities', () => {
    const mf = contextFrameToMutationFrame(frameStub({ graphHash: 'abc123', verdict: 'fresh' }));
    expect(mf).toEqual({
      currentGraphHash: 'abc123',
      graphReadable: true,
      freshness: 'fresh',
      canonicalReady: true,
    });
  });

  it('null graphHash → graphReadable=false (fail-closed to CURRENT_GRAPH_UNREADABLE)', () => {
    const mf = contextFrameToMutationFrame(frameStub({ graphHash: null }));
    expect(mf?.currentGraphHash).toBeNull();
    expect(mf?.graphReadable).toBe(false);
  });

  it('empty-string graphHash is treated as unreadable, never a matchable hash', () => {
    const mf = contextFrameToMutationFrame(frameStub({ graphHash: '' }));
    expect(mf?.currentGraphHash).toBeNull();
    expect(mf?.graphReadable).toBe(false);
  });

  it('unknown freshness vocabulary narrows to "unknown" (fail-closed to stale)', () => {
    expect(narrowFrameFreshness('fresh')).toBe('fresh');
    expect(narrowFrameFreshness('none')).toBe('none');
    expect(narrowFrameFreshness('unconfirmed')).toBe('unknown');
    expect(narrowFrameFreshness(undefined)).toBe('unknown');
    const mf = contextFrameToMutationFrame(frameStub({ verdict: 'weird_future_value' }));
    expect(mf?.freshness).toBe('unknown');
  });

  it('non-ready analysis status → canonicalReady=false (diagnostic only)', () => {
    const mf = contextFrameToMutationFrame(frameStub({ status: 'incomplete' }));
    expect(mf?.canonicalReady).toBe(false);
  });
});

// ── 2. edit_graph producer projection ───────────────────────────────────────

describe('editOperationsToCandidateEnvelopes (Part 2c)', () => {
  it('projects the six validated op shapes into R1-parseable envelopes', () => {
    const raw = editOperationsToCandidateEnvelopes(
      [
        { op: 'add_node', path: 'n-new', value: { id: 'n-new', kind: 'factor', label: 'New factor' } },
        { op: 'update_node', path: 'f-spend', value: { label: 'Ad spend' }, old_value: { label: 'Marketing spend' } },
        { op: 'update_node', path: 'f-spend', value: { description: 'Quarterly' } },
        { op: 'add_edge', path: 'f-spend::g-profit', value: { from: 'f-spend', to: 'g-profit' } },
        { op: 'remove_node', path: 'f-reach' },
        { op: 'remove_edge', path: 'f-reach::g-profit' },
        { op: 'update_edge', path: 'f-spend->g-profit', value: { exists_probability: 0.8 }, old_value: { exists_probability: 0.9 } },
      ],
      PRODUCER_CTX,
    );
    expect(raw).toHaveLength(7);
    const kinds = raw.map((r) => {
      const parsed = parseEnvelope(r);
      expect(parsed.ok, `envelope must parse: ${JSON.stringify(r)}`).toBe(true);
      return parsed.ok ? parsed.envelope.kind : null;
    });
    expect(kinds).toEqual([
      'add_node',
      'rename_node', // update_node.label → rename_node (the only would_apply-eligible kind)
      'update_node_field',
      'add_edge',
      'remove_node',
      'remove_edge',
      'update_edge_field',
    ]);
  });

  it('a multi-field update_node fans out one envelope per field (one reviewable unit each)', () => {
    const raw = editOperationsToCandidateEnvelopes(
      [{ op: 'update_node', path: 'f-spend', value: { label: 'Ad spend', category: 'cost' } }],
      PRODUCER_CTX,
    );
    expect(raw).toHaveLength(2);
  });

  it('carries provenance source=edit_graph_llm + identity + base hash on every envelope', () => {
    const raw = editOperationsToCandidateEnvelopes(
      [{ op: 'remove_node', path: 'f-reach' }],
      PRODUCER_CTX,
    );
    const parsed = parseEnvelope(raw[0]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.provenance.source).toBe('edit_graph_llm');
    expect(parsed.envelope.base_graph_hash).toBe('hash-base-16hex');
    expect(parsed.envelope.identity).toEqual({ scenario_id: 'scn-1', turn_id: 'turn-1' });
  });

  it('malformed input degrades to R1-rejectable envelopes — never throws, never drops', () => {
    const raw = editOperationsToCandidateEnvelopes(
      [
        { op: 'remove_edge', path: 'no-separator-here' }, // unparseable edge path
        { op: 'exotic_future_op', path: 'x' }, // unknown op
        { op: 'update_node', path: 'f-spend', value: { label: 42 } }, // non-string label
      ],
      PRODUCER_CTX,
    );
    expect(raw).toHaveLength(3);
    for (const r of raw) {
      expect(parseEnvelope(r).ok).toBe(false); // R1 is the fail-closed gate
    }
  });

  it('edge identity fields are never updatable via update_edge', () => {
    const raw = editOperationsToCandidateEnvelopes(
      [{ op: 'update_edge', path: 'a::b', value: { from: 'x', to: 'y', exists_probability: 0.5 } }],
      PRODUCER_CTX,
    );
    expect(raw).toHaveLength(1); // from/to skipped, only the real field
  });

  it('parseEdgeTargetPath handles both canonical separators and rejects malformed paths', () => {
    expect(parseEdgeTargetPath('a::b')).toEqual({ from: 'a', to: 'b' });
    expect(parseEdgeTargetPath('a->b')).toEqual({ from: 'a', to: 'b' });
    expect(parseEdgeTargetPath('a-b')).toBeNull();
    expect(parseEdgeTargetPath('::b')).toBeNull();
  });

  it('over-cap batches are NOT truncated by the producer — refereeMutationBatch rejects the whole batch (BATCH_CAP_EXCEEDED)', () => {
    const ops = Array.from({ length: PROPOSAL_CAP + 1 }, (_, i) => ({
      op: 'remove_node',
      path: `n-${i}`,
    }));
    const raw = editOperationsToCandidateEnvelopes(ops, PRODUCER_CTX);
    expect(raw.length).toBe(PROPOSAL_CAP + 1);
    const graph = buildReadyGraph();
    const verdicts = refereeMutationBatch(raw, graph, frameFor(graph));
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]!.verdict).toBe('rejected');
    expect(verdicts[0]!.blocker?.code).toBe(BATCH_CAP_EXCEEDED);
  });
});

// ── 3. §6.7 supersession ────────────────────────────────────────────────────

describe('held-candidate supersession (Part 1b, §6.7)', () => {
  it('a newer candidate targeting the SAME entity supersedes the older held one', () => {
    const older = parsedEnvelope('update_node_field', { candidate_id: '11111111-1111-4111-8111-111111111111' });
    const newer = parsedEnvelope('update_node_field', { candidate_id: '22222222-2222-4222-8222-222222222222' });
    expect(supersedesHeldCandidate(older, newer)).toBe(true);
    expect(collapseSupersededHeld([older, newer])).toEqual([newer]);
  });

  it('a newer candidate targeting a DIFFERENT entity does not supersede', () => {
    const older = parsedEnvelope('update_node_field');
    const other = parsedEnvelope('remove_node'); // targets f-reach, not f-spend
    expect(supersedesHeldCandidate(older, other)).toBe(false);
    expect(collapseSupersededHeld([older, other])).toEqual([older, other]);
  });

  it('a re-presented IDENTICAL candidate_id is not supersession (that is the idempotency path)', () => {
    const env = parsedEnvelope('update_node_field', { candidate_id: '33333333-3333-4333-8333-333333333333' });
    expect(supersedesHeldCandidate(env, env)).toBe(false);
  });

  it('rename and field-update against the same node share a target key (compete for the entity)', () => {
    const rename = parsedEnvelope('rename_node'); // g-profit
    const fieldUpdate = parseEnvelope(
      makeEnvelope('update_node_field', { node_id: 'g-profit', field: 'description', from: 'a', to: 'b' }),
    );
    if (!fieldUpdate.ok) throw new Error('fixture must parse');
    expect(mutationTargetKey(rename)).toBe(mutationTargetKey(fieldUpdate.envelope));
  });

  it('edge mutations key on the directed pair; node mutations on the node id', () => {
    const edgeUpdate = parsedEnvelope('update_edge_field');
    const edgeRemove = parsedEnvelope('remove_edge');
    expect(mutationTargetKey(edgeUpdate)).toBe('edge:f-spend->g-profit');
    expect(mutationTargetKey(edgeRemove)).toBe('edge:f-reach->g-profit');
    expect(mutationTargetKey(parsedEnvelope('remove_node'))).toBe('node:f-reach');
    expect(mutationTargetKey(parsedEnvelope('add_option'))).toBe('node:o-c');
    expect(mutationTargetKey(parsedEnvelope('clarification'))).toBe('ref:o-a');
  });
});
