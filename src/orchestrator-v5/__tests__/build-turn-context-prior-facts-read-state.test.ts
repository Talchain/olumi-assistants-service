/**
 * CONTEXT/MEMORY V5 defect 4 — THE PRODUCTION LINE THAT ARMS THE CHAIN.
 *
 * WHY THIS FILE EXISTS, MEASURED RATHER THAN ASSUMED. After wiring
 * `prior_facts_read_ok` end to end, a mutation replacing the catch's
 * `readOk: false` with `readOk: true` — i.e. the fact store throws and
 * `buildTurnContext` reports a healthy read — was applied (1 insertion,
 * 1 deletion, verified) and **survived 1050 passing tests**. The unit and
 * canonical-selector specs could not see it: both call the derivation
 * directly and never drive `fetchPriorFacts`.
 *
 * That single line is the only thing that distinguishes the four empties in
 * production. Everything downstream — the `unknown` verdict, the honest
 * `derivation_failed` reason, the withheld chip/prose licence — is inert if
 * it lies. A survivor here is not an equivalent mutant; it is an unguarded
 * production seam, so it gets a test that fails when the seam does.
 *
 * The distinction the assertions below pin is deliberately BOTH-WAYS: a
 * degraded read must report `false`, and the three genuinely-empty paths must
 * report `true`. One direction alone would let a fix that hard-codes either
 * value pass — the same one-door-guard shape that has cost this estate a
 * defect and its exact inverse in consecutive rounds.
 */

import { describe, it, expect } from 'vitest';

import { buildTurnContext } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { SessionReadError } from '../session/store.js';
import { makeMessagePayload } from './fixtures.js';

const BASE = makeMessagePayload({ message: 'hello' });

/** A handler turn whose facts the loader will try to read. */
function handlerTurn() {
  return {
    turn_id: 'client-turn-uuid',
    id: 'db-row-uuid',
    created_at: '2026-08-15T11:00:00.000+00:00',
    turn_class: 'handler' as const,
    handler_id: 'run_analysis' as const,
  };
}

describe('buildTurnContext — prior_facts_read_ok', () => {
  it('reports FALSE when the fact read throws', async () => {
    const store = {
      ...createNoopSessionStore({ priorTurns: [handlerTurn() as never] }),
      readFactsFor: async () => {
        throw new SessionReadError('DB offline', { code: '57P03' });
      },
    };
    const ctx = await buildTurnContext(BASE, 'req-degraded', { sessionStore: store });

    // Precondition: the facts really are empty, so this is the ambiguous case
    // the flag exists to disambiguate. Without this the assertion below could
    // pass on a turn that simply had facts.
    expect(ctx.prior_facts).toEqual([]);
    expect(ctx.prior_facts_read_ok).toBe(false);
  });

  it('reports TRUE when the read succeeds and genuinely returns nothing', async () => {
    // The discriminating twin. A fix that hard-coded `false` — or that treated
    // "empty" as "degraded" — would satisfy the test above and fail here,
    // making every never-analysed scenario claim its freshness was underivable.
    const store = {
      ...createNoopSessionStore({ priorTurns: [handlerTurn() as never] }),
      readFactsFor: async () => [],
    };
    const ctx = await buildTurnContext(BASE, 'req-empty', { sessionStore: store });
    expect(ctx.prior_facts).toEqual([]);
    expect(ctx.prior_facts_read_ok).toBe(true);
  });

  it('reports TRUE on the no-prior-turns early return', async () => {
    // The third empty. `fetchPriorFacts` returns its `empty` sentinel before
    // any read happens; that is successful emptiness, not ignorance.
    const ctx = await buildTurnContext(BASE, 'req-no-turns', {
      sessionStore: createNoopSessionStore(),
    });
    expect(ctx.prior_facts).toEqual([]);
    expect(ctx.prior_facts_read_ok).toBe(true);
  });
});
