/**
 * Deterministic UUID v5 helper tests — supports the PR 3 contract that
 * `block_id` is stable across re-emissions of the same logical block
 * (so the UI can dedupe stale/fresh re-renders).
 *
 * Spec items covered (per the approved PR 3 plan):
 *   - same logical block identity produces the same UUID;
 *   - different logical block identities produce different UUIDs;
 *   - generated IDs pass the vendored schema validator (`z.string().uuid()`);
 *   - re-emitted prior blocks retain stable `block_id`s across turns.
 *
 * The fourth item (cross-turn stability) is also covered by the
 * lifecycle composer tests; here we prove the helper-level guarantee
 * the lifecycle tests rely on.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  deterministicBlockId,
  uuidV5,
  V5_PHASE3_BLOCK_ID_NAMESPACE,
} from '../block-id.js';

const UUID_VALIDATOR = z.string().uuid();
const UUID_V5_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('deterministicBlockId — UUID v5 derivation from signal_id', () => {
  it('same input → same UUID (deterministic across calls)', () => {
    const a = deterministicBlockId('review:narrative::gh_a1b2c3d4');
    const b = deterministicBlockId('review:narrative::gh_a1b2c3d4');
    expect(a).toBe(b);
  });

  it('different inputs → different UUIDs (across kind / key / graph_hash)', () => {
    const narrativeA = deterministicBlockId('review:narrative::gh_a1b2c3d4');
    const narrativeB = deterministicBlockId('review:narrative::gh_DIFFERENT');
    const biasA = deterministicBlockId('review:bias:CONFIRMATION:gh_a1b2c3d4');
    const coachingA = deterministicBlockId('coach:assumption:1:gh_a1b2c3d4');

    expect(narrativeA).not.toBe(narrativeB);
    expect(narrativeA).not.toBe(biasA);
    expect(narrativeA).not.toBe(coachingA);
    expect(biasA).not.toBe(coachingA);
  });

  it('output passes the vendored z.string().uuid() validator', () => {
    const inputs = [
      'review:narrative::gh_a1b2c3d4',
      'coach:assumption:1:gh_a1b2c3d4',
      'evidence:fac_delivery_risk:gh_a1b2c3d4',
      'coach:stale_rerun::gh_legacy_hash',
      '',
      'a',
      'review:robustness::',
    ];
    for (const name of inputs) {
      const uuid = deterministicBlockId(name);
      expect(UUID_VALIDATOR.safeParse(uuid).success).toBe(true);
    }
  });

  it('output matches the UUID v5 shape (version=5, variant=10xx)', () => {
    const uuid = deterministicBlockId('review:narrative::gh_a1b2c3d4');
    expect(uuid).toMatch(UUID_V5_FORMAT);
  });

  it('cross-call stability under the same namespace (PR 3 dedupe contract)', () => {
    // Simulate the PR 3 contract: a logical block whose signal_id is
    // `coach:assumption:1:gh_a1b2c3d4` is re-emitted across N turns.
    // Each re-emission MUST produce the same block_id so the UI can
    // dedupe. We model that here by deriving the same id 10 times
    // and confirming every result matches.
    const ids = Array.from({ length: 10 }, () =>
      deterministicBlockId('coach:assumption:1:gh_a1b2c3d4'),
    );
    const unique = new Set(ids);
    expect(unique.size).toBe(1);
    expect(ids[0]).toMatch(UUID_V5_FORMAT);
  });

  it('namespace UUID itself is a valid UUID string (sanity)', () => {
    expect(UUID_VALIDATOR.safeParse(V5_PHASE3_BLOCK_ID_NAMESPACE).success).toBe(true);
  });
});

describe('uuidV5 — RFC 4122 §4.3 exposure for tests', () => {
  it('matches a known v5 derivation against the standard DNS namespace', () => {
    // Known test vector: UUID v5 of "www.example.org" under the
    // standard DNS namespace (6ba7b810-9dad-11d1-80b4-00c04fd430c8)
    // is 74738ff5-5367-5958-9aee-98fffdcd1876 per RFC 4122. Proves
    // the helper produces standards-conformant output, not just
    // "any deterministic string with the right shape".
    const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const result = uuidV5('www.example.org', DNS_NAMESPACE);
    expect(result).toBe('74738ff5-5367-5958-9aee-98fffdcd1876');
  });

  it('throws on an invalid namespace UUID string', () => {
    expect(() => uuidV5('any-name', 'not-a-uuid')).toThrow(/invalid namespace UUID/);
    expect(() => uuidV5('any-name', '')).toThrow(/invalid namespace UUID/);
  });
});
