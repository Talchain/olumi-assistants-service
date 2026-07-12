/**
 * Self-test for the A/B swap primitive (arm/make-candidate-store.mjs). Proves the
 * fair-A/B invariant: patching one task changes ONLY that task's served content
 * and leaves every other byte identical, without mutating the caller's baseline.
 *
 * Run: pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs module (JSDoc only, no .d.ts); runtime import is fine
import { patchStore, findEntryKey, expectedSentHash, normalizeContent } from '../arm/make-candidate-store.mjs';

function baselineStore() {
  return {
    version: 1,
    lastModified: '2026-07-12T00:00:00Z',
    prompts: {
      orchestrator_default: {
        id: 'orchestrator_default',
        taskId: 'orchestrator_default',
        status: 'production',
        versions: [{ version: 42, content: 'BASE orchestrator', createdBy: 'staging-mirror', createdAt: '2026-07-12T00:00:00Z', changeNote: 'mirror' }],
        activeVersion: 42,
        stagingVersion: 42,
        createdAt: '2026-07-12T00:00:00Z',
        updatedAt: '2026-07-12T00:00:00Z',
      },
      decision_review: {
        id: 'decision_review_prompt',
        taskId: 'decision_review',
        status: 'production',
        versions: [{ version: 7, content: 'BASE decision review', createdBy: 'staging-mirror', createdAt: '2026-07-12T00:00:00Z', changeNote: 'mirror' }],
        activeVersion: 7,
        stagingVersion: 7,
        createdAt: '2026-07-12T00:00:00Z',
        updatedAt: '2026-07-12T00:00:00Z',
      },
    },
  };
}

describe('findEntryKey', () => {
  it('resolves by store key and by taskId', () => {
    const s = baselineStore();
    expect(findEntryKey(s, 'orchestrator_default')).toBe('orchestrator_default');
    // decision_review is both the store key AND the taskId here; test a taskId-only lookup:
    s.prompts.decision_review.id = 'decision_review_prompt';
    expect(findEntryKey(s, 'decision_review')).toBe('decision_review');
    expect(findEntryKey(s, 'no_such_task')).toBeNull();
  });
});

describe('patchStore (fair-A/B invariant)', () => {
  it('swaps only the target task and leaves every other prompt byte-identical', () => {
    const base = baselineStore();
    const snapshot = JSON.stringify(base);
    const { store: cand, key, servedVersion } = patchStore(base, 'decision_review', 'CANDIDATE decision review v43');
    expect(key).toBe('decision_review');
    expect(servedVersion).toBe(7); // served version preserved by default
    // The other prompt is untouched, byte-for-byte.
    expect(JSON.stringify(cand.prompts.orchestrator_default)).toBe(JSON.stringify(base.prompts.orchestrator_default));
    // The target now serves the candidate content.
    expect(cand.prompts.decision_review.versions).toHaveLength(1);
    expect(cand.prompts.decision_review.versions[0].content).toBe('CANDIDATE decision review v43');
    expect(cand.prompts.decision_review.activeVersion).toBe(7);
    expect(cand.prompts.decision_review.stagingVersion).toBe(7);
    // The caller's baseline object is NOT mutated (deep clone).
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('honours a version override', () => {
    const { store: cand, servedVersion } = patchStore(baselineStore(), 'orchestrator_default', 'NEW', 120);
    expect(servedVersion).toBe(120);
    expect(cand.prompts.orchestrator_default.activeVersion).toBe(120);
    expect(cand.prompts.orchestrator_default.versions[0].version).toBe(120);
  });

  it('throws on an unknown task', () => {
    expect(() => patchStore(baselineStore(), 'ghost', 'x')).toThrow(/not found/);
  });
});

describe('expectedSentHash / normalizeContent', () => {
  it('normalizes CRLF, trailing whitespace and outer trim before hashing', () => {
    expect(normalizeContent('a  \r\n b \n\n')).toBe('a\n b');
    // Identical after normalization -> identical hash.
    expect(expectedSentHash('hello\n')).toBe(expectedSentHash('hello   \r\n'));
    // Different content -> different hash.
    expect(expectedSentHash('hello')).not.toBe(expectedSentHash('goodbye'));
  });
});
