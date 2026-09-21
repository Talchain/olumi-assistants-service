/**
 * MM P1 set (ROADMAP 1.25, hygiene batch, PR "MM P1 set").
 *
 * Item 1 (commit.ts:~691/~702, `graphWasProvided`): a null-vs-undefined gate
 * bug — `metadata.graph !== undefined` let an explicit `null` graph through
 * as if a graph had been persisted (`null !== undefined` is `true`),
 * producing a contradiction: the MM version hook fired with `graph: null`
 * (a spurious `empty_graph` fault — nothing was ever meant to be written)
 * AND `graphPersisted: true` was returned on the same commit.
 *
 * ── Item 2 REMOVED (C8-A), and why this is a deletion and not a repair ──────
 * This file also covered `isExpectedGuestVersionRefusal` — a log-demotion
 * helper that classified a `saveVersion` result as the DESIGNED guest outcome
 * (SQLSTATE MV001 / `sign_in_required`) so it logged at `debug` rather than
 * `warn`. Its only consumer was `recordModelVersionForCommit`, the old
 * fire-and-forget commit-seam version hook.
 *
 * C8 commit `1bc0f23e` ("feat(model-versions): make semantic versioning
 * atomic") replaced that hook with the atomic carrier folded into
 * `append_turn_atomic_v5`, and deleted BOTH functions. Derived, not assumed:
 * both symbols are present in `commit.ts` at the merge-base `77e2e7d9` and on
 * `origin/staging`, and absent from `1bc0f23e` onward; this test file's blob
 * is byte-identical at every one of those commits, so it was never updated to
 * follow. The import therefore resolved to `undefined` at runtime and these
 * four cases failed with "is not a function" — a STALE TEST, not an
 * incomplete branch.
 *
 * The helper is not reinstated because the commit seam no longer calls
 * `saveVersion`, so there is no `ModelManagementResult` to classify here and a
 * restored export would have zero callers. The guest outcome itself is still
 * pinned, at the seam that now owns it: `atomic-model-version-commit.test.ts`
 * → "keeps guest/no-version success honest and propagates append failure"
 * asserts the turn commits (`performed: true`) with a null receipt and no
 * `model_version_receipt` on the wire. The routes that surface
 * `sign_in_required` to a user keep their own explicit handling in
 * `assist.v1.scenario-versions.ts`.
 */

import { describe, it, expect } from 'vitest';
import { graphWasProvided } from '../../../src/orchestrator-v5/commit.js';

describe('MM P1 item 1: graphWasProvided (null-vs-undefined gate fix)', () => {
  it('is false for undefined (graph omitted — the common non-draft-turn case)', () => {
    expect(graphWasProvided(undefined)).toBe(false);
  });

  it('is false for an explicit null (the bug: previously treated as "provided")', () => {
    expect(graphWasProvided(null)).toBe(false);
  });

  it('is true for an actual graph object', () => {
    expect(graphWasProvided({ nodes: [], edges: [] })).toBe(true);
  });

  it('is true for falsy-but-provided primitives (0, empty string) — only null/undefined mean "not provided"', () => {
    expect(graphWasProvided(0)).toBe(true);
    expect(graphWasProvided('')).toBe(true);
  });
});
