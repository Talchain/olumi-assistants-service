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
 * Item 2 (commit.ts `recordModelVersionForCommit`, `isExpectedGuestVersionRefusal`):
 * `sign_in_required` (SQLSTATE MV001) is the DESIGNED outcome for every
 * commit against an unowned (guest) scenario, not a fault — it was logged
 * at `warn` on every guest commit, drowning out genuine MM faults.
 */

import { describe, it, expect } from 'vitest';
import { graphWasProvided, isExpectedGuestVersionRefusal } from '../../../src/orchestrator-v5/commit.js';
import type { ModelManagementResult, VersionWriteOutcome } from '../../../src/orchestrator-v5/model-management/index.js';

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

describe('MM P1 item 2: isExpectedGuestVersionRefusal (debug-vs-warn log demotion)', () => {
  const okResult: ModelManagementResult<VersionWriteOutcome> = {
    status: 'ok',
    value: {
      version_id: 'v1',
      version_number: 1,
      graph_identity_hash: 'abc123',
      deduped: false,
      event_id: 'evt_1',
    },
  };

  it('is true for the expected guest refusal (sign_in_required)', () => {
    const result: ModelManagementResult<VersionWriteOutcome> = {
      status: 'error',
      error: { code: 'sign_in_required', recoverable: true, message: 'Version history requires sign-in.' },
    };
    expect(isExpectedGuestVersionRefusal(result)).toBe(true);
  });

  it('is false for a genuine store_error (still warn-worthy)', () => {
    const result: ModelManagementResult<VersionWriteOutcome> = {
      status: 'error',
      error: { code: 'store_error', recoverable: false, message: 'db unavailable' },
    };
    expect(isExpectedGuestVersionRefusal(result)).toBe(false);
  });

  it('is false for a CAS conflict (still warn-worthy)', () => {
    const result: ModelManagementResult<VersionWriteOutcome> = {
      status: 'conflict',
      conflict: {
        kind: 'analysis_affecting_conflict',
        expected_graph_identity_hash: 'zzz',
        message: 'stale write',
      },
    };
    expect(isExpectedGuestVersionRefusal(result)).toBe(false);
  });

  it('is false for a successful write', () => {
    expect(isExpectedGuestVersionRefusal(okResult)).toBe(false);
  });
});
