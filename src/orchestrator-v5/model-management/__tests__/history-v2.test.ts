import { describe, expect, it } from 'vitest';

import {
  decodeModelVersionsCursor,
  encodeModelVersionsCursor,
  ModelVersionsListV2LocalSchema,
} from '../history-v2.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSION_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERSION_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function summary(versionId: string, sequence: number, fullHash: string) {
  return {
    version_id: versionId,
    scenario_id: SCENARIO,
    sequence,
    label: null,
    created_at: '2026-08-24T12:00:00.000Z',
    actor: { kind: 'unknown' as const },
    creation: {
      kind: 'unknown' as const,
      mutation_id: null,
      source_turn_id: null,
    },
    lineage: { kind: 'unknown' as const },
    full_hash: fullHash,
    analysis_affecting_hash: HASH_A,
  };
}

describe('ModelVersionsListV2 local release overlay', () => {
  it('accepts a descending page whose authoritative head is outside the page', () => {
    expect(
      ModelVersionsListV2LocalSchema.safeParse({
        schema: 'model_versions_list.v2',
        request_id: 'request-1',
        scenario_id: SCENARIO,
        current_version_id: VERSION_B,
        versions: [summary(VERSION_A, 4, HASH_A)],
        next_cursor: null,
      }).success,
    ).toBe(true);
  });

  it('fails closed on duplicate/order drift and on rows without a head', () => {
    const base = {
      schema: 'model_versions_list.v2' as const,
      request_id: null,
      scenario_id: SCENARIO,
      current_version_id: VERSION_B,
      versions: [summary(VERSION_A, 2, HASH_A), summary(VERSION_B, 1, HASH_B)],
      next_cursor: null,
    };
    expect(ModelVersionsListV2LocalSchema.safeParse(base).success).toBe(true);
    expect(
      ModelVersionsListV2LocalSchema.safeParse({
        ...base,
        versions: [summary(VERSION_A, 1, HASH_A), summary(VERSION_B, 2, HASH_B)],
      }).success,
    ).toBe(false);
    expect(
      ModelVersionsListV2LocalSchema.safeParse({ ...base, current_version_id: null }).success,
    ).toBe(false);
  });
});

describe('opaque model-version cursors', () => {
  it('round-trips positive sequences and refuses forged shapes', () => {
    const cursor = encodeModelVersionsCursor(42);
    expect(cursor).not.toContain('42');
    expect(decodeModelVersionsCursor(cursor)).toBe(42);
    expect(decodeModelVersionsCursor('42')).toBeNull();
    expect(decodeModelVersionsCursor('mv2.')).toBeNull();
    expect(decodeModelVersionsCursor('mv2.MA')).toBeNull();
  });
});
