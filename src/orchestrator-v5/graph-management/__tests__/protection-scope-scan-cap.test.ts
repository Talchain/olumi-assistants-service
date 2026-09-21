/**
 * Codex #5 — the protection scanner truncated at 4,000 chars while ingress
 * accepts 10,000, so a protection clause past char 4,000 was SILENTLY dropped
 * and the op targeting the protected entity auto-applied (the exact
 * silent-wrong-write F-3 exists to stop).
 *
 * Fix under test:
 *   (a) MESSAGE_SCAN_CAP raised to the ingress cap (10,000) so a well-formed
 *       message is scanned in full — the "x".repeat(4001) + protection case is
 *       now caught; and
 *   (b) FAIL-CLOSED on overflow: a message LONGER than the cap has an
 *       unscannable tail that may protect any target, so EVERY would_apply is
 *       demoted to held rather than silently applied.
 *
 * Positive controls prove the demotion still DISCRIMINATES: a short,
 * unprotected message leaves would_apply intact, and the within-4,000 case
 * that always worked still works.
 */
import { describe, it, expect } from 'vitest';

import {
  extractProtectedEntities,
  demoteProtectedEntityTargets,
} from '../protection-scope.js';
import { USER_PROTECTED_ENTITY } from '../reason-codes.js';
import type { CandidateMutationEnvelope, RefereeVerdict } from '../types.js';

const GRAPH = {
  nodes: [
    { id: 'opt_b', label: 'Option B' },
    { id: 'opt_a', label: 'Option A' },
  ],
};

function updateOptionB(): CandidateMutationEnvelope {
  return {
    envelope_version: 1,
    candidate_id: '00000000-0000-0000-0000-000000000001',
    kind: 'update_node_field',
    base_graph_hash: 'h',
    payload: { node_id: 'opt_b', field: 'data/label', from: 'x', to: 'y' },
    provenance: { source: 'edit_graph_llm', evidence_pointer: 'p' },
    identity: { scenario_id: 's', turn_id: 't' },
  } as CandidateMutationEnvelope;
}

function wouldApplyOptionB(): RefereeVerdict {
  return {
    verdict: 'would_apply',
    kind: 'update_node_field',
    candidate_id: '00000000-0000-0000-0000-000000000001',
    mutation_class: 'tunable',
    base_hash_match: true,
  };
}

describe('protection-scope scan cap (Codex #5)', () => {
  it('POSITIVE CONTROL — a protection clause WITHIN the old 4,000 bound is still caught', () => {
    const found = extractProtectedEntities('Do not touch Option B.', GRAPH);
    expect(found.map((e) => e.nodeId)).toContain('opt_b');
  });

  it('a protection clause PAST char 4,000 is caught (was silently truncated)', () => {
    const message = 'x'.repeat(4001) + ' Do not touch Option B.';
    const found = extractProtectedEntities(message, GRAPH);
    expect(found.map((e) => e.nodeId)).toContain('opt_b');
  });

  it('demotes a would_apply op whose protection clause sits past char 4,000', () => {
    const message = 'x'.repeat(4001) + ' Do not touch Option B.';
    const result = demoteProtectedEntityTargets(
      [wouldApplyOptionB()],
      [updateOptionB()],
      message,
      GRAPH,
    );
    expect(result.demotedIndices).toEqual([0]);
    expect(result.verdicts[0]!.verdict).toBe('held');
    expect(result.verdicts[0]!.blocker?.code).toBe(USER_PROTECTED_ENTITY);
    expect(result.demotedEntityLabels).toContain('Option B');
  });

  it('scans the full 10,000-char ingress message (protection just under the cap)', () => {
    // Clause end lands at ~9,999 — inside the cap, so it must be seen.
    const prefix = 'y'.repeat(10_000 - 'do not touch Option B.'.length - 1);
    const message = prefix + ' do not touch Option B.';
    expect(message.length).toBeLessThanOrEqual(10_000);
    const found = extractProtectedEntities(message, GRAPH);
    expect(found.map((e) => e.nodeId)).toContain('opt_b');
  });
});

describe('protection-scope FAIL-CLOSED on overflow (Codex #5)', () => {
  it('demotes EVERY would_apply when the message overflows the scannable bound', () => {
    // 10,001 chars, no readable protection cue at all — the unscannable tail
    // may protect anything, so nothing may auto-apply.
    const message = 'z'.repeat(10_001);
    const result = demoteProtectedEntityTargets(
      [wouldApplyOptionB()],
      [updateOptionB()],
      message,
      GRAPH,
    );
    expect(result.demotedIndices).toEqual([0]);
    expect(result.verdicts[0]!.verdict).toBe('held');
    expect(result.verdicts[0]!.blocker?.code).toBe(USER_PROTECTED_ENTITY);
  });

  it('POSITIVE CONTROL — a short, unprotected message leaves would_apply intact', () => {
    const result = demoteProtectedEntityTargets(
      [wouldApplyOptionB()],
      [updateOptionB()],
      'Set Option B to 0.5.',
      GRAPH,
    );
    expect(result.demotedIndices).toEqual([]);
    expect(result.verdicts[0]!.verdict).toBe('would_apply');
  });

  it('POSITIVE CONTROL — an at-cap (10,000) unprotected message does NOT fail closed', () => {
    const message = 'q'.repeat(10_000);
    const result = demoteProtectedEntityTargets(
      [wouldApplyOptionB()],
      [updateOptionB()],
      message,
      GRAPH,
    );
    expect(result.demotedIndices).toEqual([]);
    expect(result.verdicts[0]!.verdict).toBe('would_apply');
  });
});
