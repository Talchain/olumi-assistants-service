/**
 * V5 Signature Loop — unit tests for `computeSurvivingPriorPendings`
 * (pending-proposal carry-forward, behaviour #2 + the #4 invalidation paths).
 *
 * Pure function, clock injected — no session store, no LLM. Pins the survival
 * rules enumerated in the consumption-path matrix
 * (Docs/v5/v5-signature-loop-reliability.md): wall/turn TTL, graph-hash
 * invalidation, supersession (newer wins), and consumed (applied / dismissed).
 */
import { describe, it, expect } from 'vitest';

import { computeSurvivingPriorPendings } from '../commit.js';
import type { PendingAction } from '../session/pending-action.js';

const NOW = Date.parse('2026-06-10T12:00:00.000Z');
const SCENARIO = 'sc-carry-forward';
const GRAPH_HASH = 'graph_hash_aaaa';

function proposal(overrides: {
  ref: string;
  graphHash?: string;
  turnCount?: number;
  expiresAtIso?: string;
}): PendingAction {
  const ref = overrides.ref;
  return {
    id: `pa-${ref}`,
    scenario_id: SCENARIO,
    chip_id: ref, // proposal_ref == chip_id for apply_proposed_change
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: 'set_factor_value',
        params: { value: 20 },
        target_entity_ids: ['fac-1'],
      },
      public_label: 'Apply the change',
      public_message: 'Apply the change.',
    },
    preconditions: { graph_hash: overrides.graphHash ?? GRAPH_HASH },
    expires_at_turn_count: overrides.turnCount ?? 2,
    expires_at_iso: overrides.expiresAtIso ?? '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-06-10T11:59:00.000Z',
  } as PendingAction;
}

describe('computeSurvivingPriorPendings — carry-forward survival', () => {
  it('survives ONE non-consuming turn and decrements the turn-count TTL (2 → 1)', () => {
    const prior = [proposal({ ref: 'prop_a', turnCount: 2 })];
    const out = computeSurvivingPriorPendings(prior, [], [], GRAPH_HASH, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.chip_id).toBe('prop_a');
    expect(out[0]!.expires_at_turn_count).toBe(1); // decremented exactly once
  });

  it('is dropped after the turn-count TTL is exhausted (1 → 0)', () => {
    const prior = [proposal({ ref: 'prop_a', turnCount: 1 })];
    const out = computeSurvivingPriorPendings(prior, [], [], GRAPH_HASH, NOW);
    expect(out).toHaveLength(0);
  });

  it('is dropped when wall-clock expired', () => {
    const prior = [
      proposal({ ref: 'prop_a', expiresAtIso: '2026-06-10T11:00:00.000Z' }), // 1h in the past
    ];
    const out = computeSurvivingPriorPendings(prior, [], [], GRAPH_HASH, NOW);
    expect(out).toHaveLength(0);
  });

  it('is dropped when a malformed wall-clock expiry cannot be parsed (fail-safe)', () => {
    const prior = [proposal({ ref: 'prop_a', expiresAtIso: 'not-a-date' })];
    const out = computeSurvivingPriorPendings(prior, [], [], GRAPH_HASH, NOW);
    expect(out).toHaveLength(0);
  });

  it('is dropped when the graph-hash precondition no longer matches (graph moved)', () => {
    const prior = [proposal({ ref: 'prop_a', graphHash: 'stale_hash' })];
    const out = computeSurvivingPriorPendings(prior, [], [], GRAPH_HASH, NOW);
    expect(out).toHaveLength(0);
  });

  it('survives when the current graph hash is UNKNOWN (defer to apply-time check)', () => {
    const prior = [proposal({ ref: 'prop_a', graphHash: 'some_hash' })];
    const out = computeSurvivingPriorPendings(prior, [], [], undefined, NOW);
    expect(out).toHaveLength(1); // absence of a current hash is not invalidation
  });

  it('is dropped when its ref was consumed this turn (applied / dismissed)', () => {
    const prior = [proposal({ ref: 'prop_a' })];
    const out = computeSurvivingPriorPendings(prior, [], ['prop_a'], GRAPH_HASH, NOW);
    expect(out).toHaveLength(0);
  });

  it('is dropped when superseded by a this-turn pending with the same ref (newer wins)', () => {
    const prior = [proposal({ ref: 'prop_a', turnCount: 2 })];
    const thisTurn = [proposal({ ref: 'prop_a', turnCount: 2 })]; // re-offered fresh
    const out = computeSurvivingPriorPendings(prior, thisTurn, [], GRAPH_HASH, NOW);
    expect(out).toHaveLength(0); // the fresh this-turn copy owns the ref
  });

  it('keeps an unrelated prior proposal while dropping a consumed one', () => {
    const prior = [proposal({ ref: 'prop_a' }), proposal({ ref: 'prop_b' })];
    const out = computeSurvivingPriorPendings(prior, [], ['prop_a'], GRAPH_HASH, NOW);
    expect(out.map((p) => p.chip_id)).toEqual(['prop_b']);
  });

  it('is a no-op when there are no prior pendings', () => {
    expect(computeSurvivingPriorPendings([], [], [], GRAPH_HASH, NOW)).toHaveLength(0);
  });
});
