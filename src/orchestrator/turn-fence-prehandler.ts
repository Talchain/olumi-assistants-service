/**
 * V5 TURN FENCE — the ingress claim, as a route-scoped Fastify `preHandler`.
 *
 * `POST /orchestrate/v2/turn` is the SINGLE ingress for every path that can
 * write `scenarios.graph`: `/proxy/v5/turn`, `/proxy/v5/turn/stream` and
 * `/orchestrate/v2/turn/stream` all reach it through `app.inject()`, and
 * `app.inject()` runs the target route's hooks, so an injected turn is claimed
 * exactly like a direct one. Claiming here therefore covers draft, edit,
 * chip-click, clarify, system-event and route-v2's own commit branches by
 * CONSTRUCTION rather than by a hand-listed set of call sites (CLAUDE.md trap
 * 12).
 *
 * ── WHY A HOOK AND NOT A WRAPPER INSIDE THE HANDLER ─────────────────────────
 * The fence handle has to be visible to `SupabaseSessionStore.append()`, ~50 s
 * and many frames later, without being threaded through the commit metadata —
 * see turn-fence.ts on why `metadata.turn_id` is not one identity. That means
 * AsyncLocalStorage, and the ONLY correct place to open an ALS context for a
 * Fastify request is a hook that calls `done()` INSIDE `storage.run(...)`:
 * everything Fastify does next for this request is a child async context and
 * inherits the store. Wrapping the route handler's body instead would mean
 * re-indenting a ~4,000-line function — a diff nobody could review for the
 * behaviour change it actually contains.
 *
 * ⚠ CALLBACK STYLE IS LOAD-BEARING. An `async` preHandler cannot open a context
 *   that survives its own return: the `await` unwinds and the handler runs in a
 *   sibling context with no store. Same failure mode as
 *   `streamed-turn-sse.ts:263-272`, and just as silent — every commit still
 *   succeeds and only the fence disappears. `turn-fence-ingress-coverage.test.ts`
 *   pins that a handler downstream of this hook can read the handle.
 */

import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

import { getSessionStore } from '../orchestrator-v5/session/index.js';
import { runWithTurnFence, type TurnFenceHandle } from '../orchestrator-v5/session/turn-fence.js';
import { log } from '../utils/telemetry.js';

/**
 * Pull the ingress identity out of the raw body.
 *
 * Deliberately defensive and deliberately BEFORE B1 validation: the hook runs
 * ahead of the handler's `runPreFlight`, so a malformed body reaches here. A
 * body without a usable `(scenario_id, turn_id)` pair is not claimed — B1 is
 * about to reject the request anyway, and the graph-write refusal at the commit
 * covers the impossible case where it does not.
 */
export function readIngressTurnIdentity(
  body: unknown,
): { scenarioId: string; turnId: string } | null {
  if (body === null || typeof body !== 'object') return null;
  const b = body as { scenario_id?: unknown; turn_id?: unknown };
  if (typeof b.scenario_id !== 'string' || b.scenario_id.length === 0) return null;
  if (typeof b.turn_id !== 'string' || b.turn_id.length === 0) return null;
  return { scenarioId: b.scenario_id, turnId: b.turn_id };
}

/**
 * Claim the fence for this turn, then continue the request INSIDE the fence
 * context.
 *
 * Never fails the request. A claim that cannot be made leaves the turn unfenced
 * and is logged at ERROR by the store; the protection that matters still
 * happens at the write, where an unclaimed graph write is refused (turn-fence.ts
 * arrival 11). Refusing the turn here instead would convert a fence outage into
 * a total outage — including for the many turns that write no graph at all.
 */
export function turnFencePreHandler(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  const identity = readIngressTurnIdentity(request.body);
  if (identity === null) {
    done();
    return;
  }

  const claim = async (): Promise<TurnFenceHandle | null> => {
    const store = getSessionStore();
    // Optional on the SessionStore interface (mirrors `countTurns`), so a test
    // double without it degrades to unfenced rather than throwing a TypeError
    // into the request lifecycle.
    if (typeof store.claimTurnFence !== 'function') return null;
    return await store.claimTurnFence(identity.scenarioId, identity.turnId);
  };

  claim()
    .then((handle) => {
      if (handle === null) {
        done();
        return;
      }
      // `done()` is called INSIDE the context — see the header warning.
      runWithTurnFence(handle, done);
    })
    .catch((err: unknown) => {
      log.error(
        {
          event: 'v5.turn_fence.claim_threw',
          scenario_id: identity.scenarioId,
          turn_id: identity.turnId,
          err: err instanceof Error ? err.message : String(err),
        },
        'V5 turn fence — the ingress claim threw; this turn runs UNFENCED and any graph write it makes will be refused at the commit',
      );
      done();
    });
}
