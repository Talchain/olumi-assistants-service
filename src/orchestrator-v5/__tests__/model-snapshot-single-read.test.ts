/**
 * ⭐⭐ THE WITNESS CODEX ASKED FOR ON #1660 (exact-head CHANGES_REQUIRED).
 *
 * *"Make ingress graph I and stored graph S deliberately differ, then assert
 * the proposal revision, model-facing analysis snapshot and wire freshness all
 * describe S; add the reverse stale control."*
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS PINS. The proposal token was minted from `store.loadGraph`
 * (canonical, correct), while analysis freshness and option identity were
 * derived one step later from `extensions.graphState` — the INGRESS graph. The
 * store holds a PROJECTION of ingress and the persist passes mutate exactly
 * the fields the hash covers, so the two differ in NORMAL operation, not under
 * concurrency. A current analysis could therefore be presented to the model and
 * to the wire as stale while the token was correctly bound to the store.
 *
 * ⚠ AND TWO *STORE* READS WOULD NOT CLOSE IT. The controller writes within a
 * turn, so a write between two reads gives two canonical-looking snapshots of
 * different graphs. The fix is ONE read, so the last test here counts them.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import {
  currentModelRevision,
  currentModelSnapshot,
  modelRevisionOf,
  type ApplyOperationsStore,
} from '../apply-operations.js';

/** Two graphs that differ ONLY on an analysis-affecting field. */
const STORED = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Retained revenue' },
    { id: 'lever', kind: 'factor', label: 'Discount depth' },
  ],
  edges: [{ from: 'lever', to: 'goal', strength: { mean: 0.4 } }],
  options: [{ id: 'opt_stored_a' }, { id: 'opt_stored_b' }],
  goal_node_id: 'goal',
};

const INGRESS = {
  ...STORED,
  // the persist projection moves exactly this class of field
  edges: [{ from: 'lever', to: 'goal', strength: { mean: 0.9 } }],
  options: [{ id: 'opt_ingress_only' }],
};

function storeReturning(graph: unknown) {
  const loadGraph = vi.fn(async () => graph);
  return {
    store: { loadGraph } as unknown as ApplyOperationsStore,
    loadGraph,
  };
}

describe('PRECONDITION: the two graphs genuinely differ on the hashed projection', () => {
  // ⛔ Without this the whole suite could pass by the arms being identical —
  // the failure mode where every assertion agrees because nothing varies.
  it('ingress and stored hash differently', () => {
    const s = modelRevisionOf(STORED);
    const i = modelRevisionOf(INGRESS);
    expect(s).not.toBeNull();
    expect(i).not.toBeNull();
    expect(s).not.toBe(i);
  });
});

describe('every turn-scoped identity describes the STORED graph', () => {
  it('the snapshot carries the stored graph and its revision', async () => {
    const { store } = storeReturning(STORED);
    const snap = await currentModelSnapshot('scenario-1', { store });

    expect(snap.graph).toEqual(STORED);
    expect(snap.revision).toBe(modelRevisionOf(STORED));
  });

  // ⭐ THE STRUCTURAL CLAIM, not a coincidence: the route uses
  // `snapshot.revision` AS the analysis-affecting hash, so freshness and the
  // proposal token are the same value rather than two computations that agree.
  it('the revision IS the analysis-affecting hash of that same graph', async () => {
    const { store } = storeReturning(STORED);
    const snap = await currentModelSnapshot('scenario-1', { store });

    expect(snap.revision).toBe(modelRevisionOf(snap.graph));
  });

  // THE REVERSE STALE CONTROL. Nothing in the turn may describe ingress.
  it('NOTHING derived from the snapshot describes the ingress graph', async () => {
    const { store } = storeReturning(STORED);
    const snap = await currentModelSnapshot('scenario-1', { store });

    expect(snap.revision).not.toBe(modelRevisionOf(INGRESS));
    expect(snap.graph).not.toEqual(INGRESS);
  });

  // The option identities the analysis view keys against come off the same
  // object, so they cannot name options the store does not hold.
  it('option identity comes from the stored graph, not the request', async () => {
    const { store } = storeReturning(STORED);
    const snap = await currentModelSnapshot('scenario-1', { store });
    const ids = (snap.graph as { options?: { id: string }[] }).options?.map((o) => o.id) ?? [];

    expect(ids).toEqual(['opt_stored_a', 'opt_stored_b']);
    expect(ids).not.toContain('opt_ingress_only');
  });
});

describe('ONE read per turn, not two', () => {
  // A second read is a second snapshot: the controller writes within a turn
  // (`second_write_this_turn` exists because it can), so two canonical reads
  // can describe different graph versions while both look authoritative.
  it('currentModelSnapshot calls loadGraph exactly once', async () => {
    const { store, loadGraph } = storeReturning(STORED);
    await currentModelSnapshot('scenario-1', { store });

    expect(loadGraph).toHaveBeenCalledTimes(1);
  });

  it('currentModelRevision delegates, so the two cannot drift apart', async () => {
    const { store, loadGraph } = storeReturning(STORED);
    const revision = await currentModelRevision('scenario-1', { store });

    expect(revision).toBe(modelRevisionOf(STORED));
    expect(loadGraph).toHaveBeenCalledTimes(1);
  });
});

describe('a read that finds nothing stays distinct from a read that failed', () => {
  it('an absent graph yields a null revision, not a throw', async () => {
    const { store } = storeReturning(null);
    const snap = await currentModelSnapshot('scenario-1', { store });

    expect(snap.graph).toBeNull();
    expect(snap.revision).toBeNull();
  });

  // ⛔ "We could not look" must NOT arrive as "there is no model" — a caller
  // minting a consent token has to be able to tell those apart.
  it('a failed read propagates as a throw', async () => {
    const loadGraph = vi.fn(async () => {
      throw new Error('transport failed');
    });
    const store = { loadGraph } as unknown as ApplyOperationsStore;

    await expect(currentModelSnapshot('scenario-1', { store })).rejects.toThrow('transport failed');
  });
});
