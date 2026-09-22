/**
 * A DEGRADED READ A MUST NOT ARM THE SNAPSHOT GUARD.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * The bind site passes `analysisGraphIdentityOf(context.persistedGraph)`, and
 * that maps `graph == null` to `null`. But `context.persistedGraph` is `null`
 * in THREE different situations, and only one of them is "this scenario has no
 * graph":
 *
 *   build-turn-context.ts:1840-1846  store unavailable  -> graph: null, read: degraded
 *   build-turn-context.ts:1873-1879  read threw         -> graph: null, read: degraded
 *   (genuine absence)                                    -> graph: null, read: ok_absent
 *
 * Read B does NOT swallow — `loadPersistedScenarioStateStrict` either throws or
 * returns the real graph. So a transient blip that hits read A and not read B
 * gives `observed = <real hash>` against `expected = null`, and the guard
 * refuses a turn on which NOTHING CONCURRENT HAPPENED.
 *
 * ⛔ THIS IS THE CONFLATION THE ESTATE ALREADY PAID TO REMOVE, and this module's
 *    own docblock forbids it: "`NO_CLAIM` IS NOT `null`, AND CONFLATING THEM
 *    WOULD BE THE DEFECT AGAIN. `null` means 'this scenario has no graph', a
 *    fact two reads can agree on." A degraded read is not that fact.
 *    `build-turn-context.ts:104-117` records the earlier removal verbatim.
 *
 * The discriminator already rides the context as `persistedGraphRead`
 * (`build-turn-context.ts:356`, set at `:1223`). The binding simply ignored it.
 *
 * DIRECTION OF THE FIX: a degraded read yields NO_CLAIM, so the guard STANDS
 * DOWN. It can therefore only ever refuse FEWER turns than before — it cannot
 * mask a real divergence, because a real divergence requires read A to have
 * SUCCEEDED and produced a hash to disagree with.
 */
import { describe, it, expect } from 'vitest';

import {
  analysisGraphIdentityOf,
  analysisGraphIdentityForRead,
  NO_CLAIM,
} from '../run-analysis-snapshot-binding.js';

/** A graph the analysis hash can actually derive from. */
const GRAPH = { nodes: [{ id: 'n1', kind: 'factor', label: 'F' }], edges: [] };

describe('a degraded read A stands the guard down rather than arming it', () => {
  it('RED: a DEGRADED read yields NO_CLAIM, not null', () => {
    expect(
      analysisGraphIdentityForRead(null, { status: 'degraded', errorCode: 'store_unavailable' }),
      'a degraded read is not the fact "this scenario has no graph" — arming the guard ' +
        'with null refuses a turn where read B simply succeeded',
    ).toBe(NO_CLAIM);
  });

  it('CONTROL — a GENUINE absence still yields null, so two reads can agree on it', () => {
    expect(analysisGraphIdentityForRead(null, { status: 'ok_absent' })).toBeNull();
  });

  it('CONTROL — a successful read still yields the real hash, so divergence is still caught', () => {
    const direct = analysisGraphIdentityOf(GRAPH);
    expect(analysisGraphIdentityForRead(GRAPH, { status: 'ok_present', graph: GRAPH })).toBe(direct);
    expect(typeof direct).toBe('string');
  });

  it('CONTROL — an ABSENT read state (legacy/hand-built context) is unchanged', () => {
    expect(analysisGraphIdentityForRead(null, undefined)).toBeNull();
    expect(analysisGraphIdentityForRead(GRAPH, undefined)).toBe(analysisGraphIdentityOf(GRAPH));
  });
});
