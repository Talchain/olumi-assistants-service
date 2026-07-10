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

import {
  computeSurvivingPriorPendings,
  computeSurvivingPriorPendingsDetailed,
  finaliseLifecycleAgainstCap,
} from '../commit.js';
import type { PendingAction, PendingLifecycleSummary } from '../session/pending-action.js';

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

describe('computeSurvivingPriorPendingsDetailed — lifecycle drop-reason tally (Track 2)', () => {
  it('the survivors are byte-identical to the wrapper (single implementation, no drift)', () => {
    const prior = [proposal({ ref: 'a', turnCount: 2 }), proposal({ ref: 'b', turnCount: 2 })];
    const detailed = computeSurvivingPriorPendingsDetailed(prior, [], ['a'], GRAPH_HASH, NOW);
    const wrapped = computeSurvivingPriorPendings(prior, [], ['a'], GRAPH_HASH, NOW);
    expect(detailed.survivors).toEqual(wrapped);
  });

  it('attributes a consumed pending to consumedCount', () => {
    const { summary } = computeSurvivingPriorPendingsDetailed(
      [proposal({ ref: 'a' })], [], ['a'], GRAPH_HASH, NOW,
    );
    expect(summary).toMatchObject({ priorCount: 1, consumedCount: 1, survivedCount: 0 });
  });

  it('attributes a superseded pending to supersededCount', () => {
    const { summary } = computeSurvivingPriorPendingsDetailed(
      [proposal({ ref: 'a' })], [proposal({ ref: 'a' })], [], GRAPH_HASH, NOW,
    );
    expect(summary).toMatchObject({ supersededCount: 1, survivedCount: 0 });
  });

  it('attributes wall-clock and malformed expiry to expiredWallCount', () => {
    const { summary } = computeSurvivingPriorPendingsDetailed(
      [
        proposal({ ref: 'a', expiresAtIso: '2026-06-10T11:00:00.000Z' }),
        proposal({ ref: 'b', expiresAtIso: 'not-a-date' }),
      ],
      [], [], GRAPH_HASH, NOW,
    );
    expect(summary).toMatchObject({ priorCount: 2, expiredWallCount: 2, survivedCount: 0 });
  });

  it('attributes a graph-hash mismatch to hashInvalidatedCount', () => {
    const { summary } = computeSurvivingPriorPendingsDetailed(
      [proposal({ ref: 'a', graphHash: 'stale' })], [], [], GRAPH_HASH, NOW,
    );
    expect(summary).toMatchObject({ hashInvalidatedCount: 1, survivedCount: 0 });
  });

  it('attributes an exhausted turn-count TTL to expiredTurnsCount', () => {
    const { summary } = computeSurvivingPriorPendingsDetailed(
      [proposal({ ref: 'a', turnCount: 1 })], [], [], GRAPH_HASH, NOW,
    );
    expect(summary).toMatchObject({ expiredTurnsCount: 1, survivedCount: 0 });
  });

  it('counts a survivor in survivedCount', () => {
    const { summary } = computeSurvivingPriorPendingsDetailed(
      [proposal({ ref: 'a', turnCount: 2 })], [], [], GRAPH_HASH, NOW,
    );
    expect(summary).toMatchObject({ priorCount: 1, survivedCount: 1 });
  });

  it('first-match attribution: a pending that is BOTH consumed and expired counts once, as consumed', () => {
    const { summary } = computeSurvivingPriorPendingsDetailed(
      [proposal({ ref: 'a', expiresAtIso: '2026-06-10T11:00:00.000Z' })],
      [], ['a'], GRAPH_HASH, NOW,
    );
    expect(summary.consumedCount).toBe(1);
    expect(summary.expiredWallCount).toBe(0);
  });

  it('PARTITION invariant: the six outcome counts sum to priorCount for a mixed set', () => {
    const prior = [
      proposal({ ref: 'consumed' }),
      proposal({ ref: 'superseded' }),
      proposal({ ref: 'wall', expiresAtIso: '2026-06-10T11:00:00.000Z' }),
      proposal({ ref: 'hash', graphHash: 'stale' }),
      proposal({ ref: 'turns', turnCount: 1 }),
      proposal({ ref: 'survivor', turnCount: 2 }),
    ];
    const { summary } = computeSurvivingPriorPendingsDetailed(
      prior, [proposal({ ref: 'superseded' })], ['consumed'], GRAPH_HASH, NOW,
    );
    const {
      priorCount, consumedCount, supersededCount, expiredWallCount,
      expiredTurnsCount, hashInvalidatedCount, capDroppedCount, survivedCount,
    } = summary;
    expect(priorCount).toBe(6);
    expect(
      consumedCount + supersededCount + expiredWallCount +
      expiredTurnsCount + hashInvalidatedCount + capDroppedCount + survivedCount,
    ).toBe(priorCount);
    expect(summary).toEqual({
      priorCount: 6,
      consumedCount: 1,
      supersededCount: 1,
      expiredWallCount: 1,
      expiredTurnsCount: 1,
      hashInvalidatedCount: 1,
      // Pre-cap pass applies no per-turn cap → capDroppedCount is 0 here.
      capDroppedCount: 0,
      survivedCount: 1,
    });
  });
});

describe('proposed_concept kind-level supersession — diagnosis D2a (live 2026-07-10 stale-resume specimen)', () => {
  // Each proposal-continuation capture mints a fresh UUID chip_id, so
  // key-level supersession can never fire for `proposed_concept`. Before
  // this fix, a carried stale concept survived alongside the fresh
  // capture and (with the end-first read) even won over it — a 2-turn-old
  // proposal resumed over the immediately-preceding turn's offer.
  function proposedConcept(overrides: {
    id: string;
    concept: string;
    turnCount?: number;
  }): PendingAction {
    return {
      id: overrides.id,
      scenario_id: SCENARIO,
      chip_id: overrides.id, // chip_id == id for server-only proposed_concept
      action: {
        kind: 'proposed_concept',
        concept: overrides.concept,
        preferred_kind: 'factor',
        public_label: 'Continue with the proposed update',
        public_message: `Continue with ${overrides.concept}.`,
      },
      preconditions: { graph_hash: GRAPH_HASH },
      expires_at_turn_count: overrides.turnCount ?? 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-06-10T11:59:00.000Z',
    };
  }

  it('a fresh capture this turn supersedes a carried stale concept (different chip_id)', () => {
    const prior = [proposedConcept({ id: 'stale-uuid', concept: 'legacy stale concept' })];
    const thisTurn = [proposedConcept({ id: 'fresh-uuid', concept: 'marketing budget' })];
    const { survivors, summary } = computeSurvivingPriorPendingsDetailed(
      prior, thisTurn, [], GRAPH_HASH, NOW,
    );
    expect(survivors).toHaveLength(0);
    expect(summary).toMatchObject({ priorCount: 1, supersededCount: 1, survivedCount: 0 });
  });

  it('supersedes EVERY carried concept when a fresh capture exists (single-slot memory)', () => {
    const prior = [
      proposedConcept({ id: 'stale-1', concept: 'concept one', turnCount: 2 }),
      proposedConcept({ id: 'stale-2', concept: 'concept two', turnCount: 1 }),
    ];
    const thisTurn = [proposedConcept({ id: 'fresh-uuid', concept: 'marketing budget' })];
    const { survivors, summary } = computeSurvivingPriorPendingsDetailed(
      prior, thisTurn, [], GRAPH_HASH, NOW,
    );
    expect(survivors).toHaveLength(0);
    expect(summary.supersededCount).toBe(2);
  });

  it('a carried concept still survives (TTL-decremented) when this turn makes NO capturable offer', () => {
    const prior = [proposedConcept({ id: 'carried-uuid', concept: 'team morale', turnCount: 2 })];
    const thisTurn: PendingAction[] = [{
      id: 'chip-run',
      scenario_id: SCENARIO,
      chip_id: 'chip-run',
      action: { kind: 'run_analysis' },
      preconditions: {},
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-06-10T11:59:30.000Z',
    }];
    const { survivors } = computeSurvivingPriorPendingsDetailed(
      prior, thisTurn, [], GRAPH_HASH, NOW,
    );
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.chip_id).toBe('carried-uuid');
    expect(survivors[0]!.expires_at_turn_count).toBe(1);
  });

  it('kind-level supersession is scoped to proposed_concept: other carried kinds survive', () => {
    const prior = [proposal({ ref: 'prop_a', turnCount: 2 })]; // apply_proposed_change
    const thisTurn = [proposedConcept({ id: 'fresh-uuid', concept: 'marketing budget' })];
    const { survivors } = computeSurvivingPriorPendingsDetailed(
      prior, thisTurn, [], GRAPH_HASH, NOW,
    );
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.chip_id).toBe('prop_a');
  });
});

describe('finaliseLifecycleAgainstCap — post-cap survivor/cap-drop split (Track 2)', () => {
  const preCap: PendingLifecycleSummary = {
    priorCount: 2,
    consumedCount: 0,
    supersededCount: 0,
    expiredWallCount: 0,
    expiredTurnsCount: 0,
    hashInvalidatedCount: 0,
    capDroppedCount: 0,
    survivedCount: 2, // two eligible survivors before the cap
  };

  it('no cap pressure: all eligible survivors persist, capDroppedCount stays 0', () => {
    expect(finaliseLifecycleAgainstCap(preCap, 2)).toMatchObject({
      survivedCount: 2,
      capDroppedCount: 0,
    });
  });

  it('cap fully binds: this-turn pendings fill the cap, every eligible survivor is cap-dropped', () => {
    // finalPendings.length - chipDerivedPending.length == 0 → persisted 0.
    const out = finaliseLifecycleAgainstCap(preCap, 0);
    expect(out.survivedCount).toBe(0);
    expect(out.capDroppedCount).toBe(2);
    // Partition still exact: prior == sum of the seven fates.
    expect(
      out.consumedCount + out.supersededCount + out.expiredWallCount +
      out.expiredTurnsCount + out.hashInvalidatedCount + out.capDroppedCount +
      out.survivedCount,
    ).toBe(out.priorCount);
  });

  it('cap partially binds: one of two eligible survivors persists', () => {
    const out = finaliseLifecycleAgainstCap(preCap, 1);
    expect(out).toMatchObject({ survivedCount: 1, capDroppedCount: 1 });
  });

  it('clamps defensively: a persisted count above eligibility cannot make capDroppedCount negative', () => {
    const out = finaliseLifecycleAgainstCap(preCap, 5);
    expect(out.survivedCount).toBe(2);
    expect(out.capDroppedCount).toBe(0);
  });
});
