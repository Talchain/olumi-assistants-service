/**
 * A DEGRADED RESTORE-INVALIDATION READ MUST NOT ABORT THE USER'S TURN — PINNED.
 *
 * ## The defect this file pins
 *
 * `buildTurnContext` reads the restore-invalidation marker inside the shared
 * `Promise.all` as:
 *
 *     store?.readAnalysisInvalidatedAt?.(scenario_id) ?? Promise.resolve(null)
 *
 * ⛔ `??` substitutes only when the method is ABSENT (`undefined`). It CANNOT
 * catch a REJECTION. The production Supabase implementation throws
 * `SessionReadError` on a database error or on a malformed timestamp, so either
 * failure rejected the whole batch and ABORTED THE TURN — the user gets nothing
 * because an optional, best-effort freshness hint could not be read.
 *
 * The source comment at that line already promised the opposite — "a store that
 * lacks the method, OR A READ THAT FAILS, degrades to exactly today" — and the
 * store interface documents "resolves `null` on a failed read". The
 * implementation contradicted both. This file makes the promise executable.
 *
 * ## Why `null` is the correct degraded value
 *
 * `null` means "no restore invalidation", which is byte-identical to every
 * consumer's behaviour before the read existed. The opposite failure — treating
 * an unreadable marker as `stale` — would tell a user their analysis is out of
 * date when it is not. Failing open is right here; failing at all is not.
 *
 * ## The discrimination
 *
 * ARM 2 is the control: a store that simply LACKS the method already resolved
 * before this fix, and must still resolve after it. It shares every line of the
 * harness with ARM 1 and differs only in whether the read throws, so a harness
 * that silently stopped exercising `buildTurnContext` would take both arms down
 * together rather than leaving ARM 1 passing for the wrong reason.
 */

import { describe, it, expect } from 'vitest';

import { buildTurnContext } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { SessionReadError } from '../session/store.js';
import { makeMessagePayload } from './fixtures.js';

const BASE = makeMessagePayload({ message: 'where did we land on this?' });

describe('buildTurnContext — a degraded restore-invalidation read must not abort the turn', () => {
  it('ARM 1 (the defect): readAnalysisInvalidatedAt THROWS ⇒ the turn still completes', async () => {
    const store = {
      ...createNoopSessionStore({}),
      readAnalysisInvalidatedAt: async () => {
        throw new SessionReadError('DB offline', { code: '57P03' });
      },
    };

    // Before the fix this REJECTS: the unhandled rejection inside the shared
    // `Promise.all` takes the whole batch — and the turn — down with it.
    const ctx = await buildTurnContext(BASE, 'req-invalidation-degraded', {
      sessionStore: store,
    });

    expect(ctx).toBeDefined();
    // PRECONDITION (trap 13b): the harness really did run a turn, so the
    // assertion above is about a completed turn rather than a vacuous object.
    expect(ctx.prior_turns).toBeDefined();
  });

  it('ARM 2 CONTROL: a store LACKING the method still completes (unchanged behaviour)', async () => {
    const store = { ...createNoopSessionStore({}) };
    const ctx = await buildTurnContext(BASE, 'req-invalidation-absent', {
      sessionStore: store,
    });
    expect(ctx).toBeDefined();
    expect(ctx.prior_turns).toBeDefined();
  });
});
