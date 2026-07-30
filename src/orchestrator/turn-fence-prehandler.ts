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
import {
  runWithTurnFence,
  unclaimedTurnFenceHandle,
  type TurnFenceHandle,
} from '../orchestrator-v5/session/turn-fence.js';
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
 * Never fails the request. A claim that cannot be made binds an UNCLAIMED handle
 * and is logged at ERROR; the protection then happens at the write, where an
 * unclaimed graph write is REFUSED (turn-fence.ts arrival 11). Refusing the turn
 * here instead would convert a fence outage into a total outage — including for
 * the many turns that write no graph at all.
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

  // ⚠ TWO DIFFERENT ABSENCES, AND CONFLATING THEM WAS THE #759 REVIEW'S SEVERE
  //   FINDING. `null` here used to mean both "this store cannot claim" and "the
  //   claim failed", and both bound NO handle — so a failed claim reached the
  //   commit as `no_ingress_fence` and the write was ALLOWED. The fail-closed
  //   branch could never fire, while four doc sites promised it would.
  //
  //   · store has no `claimTurnFence`  → the store is a DOUBLE. There is nothing
  //     to fail closed about; bind no handle (the commit's `no_ingress_fence`
  //     branch, unchanged). Production always implements it, pinned from the
  //     class by `turn-fence-guards.test.ts`.
  //   · claim returned nothing, or THREW → the turn DID come through the fenced
  //     ingress and we could not order it. Bind an UNCLAIMED handle so the
  //     graph write is refused at the commit.
  const store = getSessionStore();
  if (typeof store.claimTurnFence !== 'function') {
    done();
    return;
  }
  const claimer = store.claimTurnFence.bind(store);

  claimer(identity.scenarioId, identity.turnId)
    .then((handle: TurnFenceHandle | null) => {
      // `done()` is called INSIDE the context — see the header warning.
      runWithTurnFence(handle ?? unclaimedTurnFenceHandle(identity.scenarioId, identity.turnId), done);
    })
    .catch((err: unknown) => {
      log.error(
        {
          event: 'v5.turn_fence.claim_threw',
          scenario_id: identity.scenarioId,
          turn_id: identity.turnId,
          err: err instanceof Error ? err.message : String(err),
        },
        'V5 turn fence — the ingress claim THREW; this turn is UNCLAIMED and any graph write it makes will be REFUSED at the commit',
      );
      runWithTurnFence(unclaimedTurnFenceHandle(identity.scenarioId, identity.turnId), done);
    });
}
