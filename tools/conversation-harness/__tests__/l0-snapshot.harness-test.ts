/**
 * Self-test for the L0 snapshot payload-hash normalisation (l0-snapshot.mjs,
 * C9): volatile per-request fields (computed_at, request ids…) must be
 * stripped before hashing so two executions of the SAME semantic commit hash
 * identically — the D10 double-commit compare was blind to real double
 * executions that differed only in timestamps.
 *
 * Run: pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — untyped harness-local .mjs module (tool-local, not src/)
import { sha256Canonical, sha256Semantic, stripVolatile } from '../l0-snapshot.mjs';

const PAYLOAD_A = {
  fact_type: 'analysis_result',
  win_probabilities: { 'Option A': 0.78, 'Option B': 0.22 },
  computed_at: '2026-07-12T10:00:10.123Z',
  request_id: 'req-aaaa',
  nested: { p50: 0.4, created_at: '2026-07-12T10:00:10.100Z', items: [{ v: 1, trace_id: 't-1' }] },
};
// Same semantic commit, re-executed: only volatile fields differ.
const PAYLOAD_B = {
  fact_type: 'analysis_result',
  win_probabilities: { 'Option A': 0.78, 'Option B': 0.22 },
  computed_at: '2026-07-12T10:00:11.999Z',
  request_id: 'req-bbbb',
  nested: { p50: 0.4, created_at: '2026-07-12T10:00:11.900Z', items: [{ v: 1, trace_id: 't-2' }] },
};
// Semantically DIFFERENT result (win-% moved).
const PAYLOAD_C = {
  ...PAYLOAD_A,
  win_probabilities: { 'Option A': 0.4, 'Option B': 0.6 },
};

describe('stripVolatile', () => {
  it('deep-strips volatile timestamp/id keys and keeps semantic fields', () => {
    const s = stripVolatile(PAYLOAD_A) as Record<string, unknown>;
    expect(s.computed_at).toBeUndefined();
    expect(s.request_id).toBeUndefined();
    expect((s.nested as Record<string, unknown>).created_at).toBeUndefined();
    expect(((s.nested as { items: Record<string, unknown>[] }).items[0]).trace_id).toBeUndefined();
    expect(s.fact_type).toBe('analysis_result');
    expect((s.nested as Record<string, unknown>).p50).toBe(0.4);
  });

  it('passes through arrays and scalars', () => {
    expect(stripVolatile([1, 'a', null])).toEqual([1, 'a', null]);
    expect(stripVolatile('x')).toBe('x');
  });
});

describe('sha256Semantic (the D10 double-commit identity) [fix C9]', () => {
  it('two executions of the SAME commit hash IDENTICALLY despite volatile fields', () => {
    // Pre-fix: raw canonical hashes differ -> D10 sha-compare blind.
    expect(sha256Canonical(PAYLOAD_A)).not.toBe(sha256Canonical(PAYLOAD_B));
    expect(sha256Semantic(PAYLOAD_A)).toBe(sha256Semantic(PAYLOAD_B));
  });

  it('a semantically different payload still hashes differently', () => {
    expect(sha256Semantic(PAYLOAD_A)).not.toBe(sha256Semantic(PAYLOAD_C));
  });
});
