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

    // ⭐ THE VALUE, NOT JUST SURVIVAL. Review caught that asserting only
    // "the turn completed" leaves the degraded VALUE unpinned: a catch handler
    // returning `new Date().toISOString()` would satisfy everything above,
    // make `invalidatedAtMs` finite in `freshness.ts` and fire the stale
    // branch — a FALSE `stale` on EVERY degraded read, which is precisely the
    // harm the fix exists to prevent and the worse direction of the two.
    //
    // `null` is load-bearing because `freshness.ts` tests
    // `opts?.analysisInvalidatedAt == null`, and its stale branch requires
    // `invalidatedAtMs !== null`. So `null` takes the identical branch to an
    // absent read. ARM 3 pins that equivalence behaviourally.
    expect(ctx.analysis_invalidated_at).toBeNull();
  });

  it('ARM 2 CONTROL: a store LACKING the method still completes (unchanged behaviour)', async () => {
    const store = { ...createNoopSessionStore({}) };
    const ctx = await buildTurnContext(BASE, 'req-invalidation-absent', {
      sessionStore: store,
    });
    expect(ctx).toBeDefined();
    expect(ctx.prior_turns).toBeDefined();
    expect(ctx.analysis_invalidated_at).toBeNull();
  });

  it('ARM 3 EQUIVALENCE: a degraded read is INDISTINGUISHABLE from an absent one', async () => {
    // The claim the fix rests on, stated as a comparison rather than a
    // constant: "a read that fails degrades to exactly today". If the two ever
    // diverge, some consumer can tell them apart — and the first consumer that
    // can is `freshness.ts`, which would report a restored-model staleness that
    // never happened.
    const throwing = {
      ...createNoopSessionStore({}),
      readAnalysisInvalidatedAt: async () => {
        throw new SessionReadError('DB offline', { code: '57P03' });
      },
    };
    const absent = { ...createNoopSessionStore({}) };

    const degradedCtx = await buildTurnContext(BASE, 'req-equiv-degraded', { sessionStore: throwing });
    const absentCtx = await buildTurnContext(BASE, 'req-equiv-absent', { sessionStore: absent });

    expect(degradedCtx.analysis_invalidated_at).toEqual(absentCtx.analysis_invalidated_at);
    // PRECONDITION: both really are the `== null` branch, so the equality above
    // is not two identical non-null timestamps agreeing by accident.
    expect(absentCtx.analysis_invalidated_at ?? null).toBeNull();
  });
});
