/**
 * V5 TURN FENCE — the ingress SLOT + the post-admission claim.
 *
 * `POST /orchestrate/v2/turn` is the SINGLE ingress for every path that can
 * write `scenarios.graph`: `/proxy/v5/turn`, `/proxy/v5/turn/stream` and
 * `/orchestrate/v2/turn/stream` all reach it through `app.inject()`, and
 * `app.inject()` runs the target route's hooks, so an injected turn is fenced
 * exactly like a direct one. Binding here therefore covers draft, edit,
 * chip-click, clarify, system-event and route-v2's own commit branches by
 * CONSTRUCTION rather than by a hand-listed set of call sites (CLAUDE.md trap
 * 12).
 *
 * ── CLAIM AFTER ADMISSION (2.174 fix b — Codex round-2 P1) ──────────────────
 * The hook used to claim a generation from the RAW body, BEFORE the handler's
 * `runPreFlight` (auth 401 → extension parse → B1 422 → scenario upsert). That
 * meant a request the service was about to REJECT still advanced the
 * scenario's fence: anyone who could reach the ingress with a scenario UUID
 * and an invalid body could make a legitimate in-flight draft evaluate
 * `superseded` and lose its graph write — and every rejected retry grew the
 * fence table. Now the hook only BINDS a pending slot (synchronous, no DB
 * write), and the claim runs in `admitCurrentTurnFence`, called by route-v2
 * immediately after `runPreFlight` succeeds — the one admission gate every
 * dispatch branch already shares. Rejected requests are fence-neutral by
 * construction: the claim call site is behind the gate.
 *
 * ── WHY A HOOK AND NOT A WRAPPER INSIDE THE HANDLER ─────────────────────────
 * The fence slot has to be visible to `SupabaseSessionStore.append()`, ~50 s
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
 *   succeeds and only the fence disappears. Since the claim moved behind the
 *   admission gate the hook is fully synchronous, which makes the callback
 *   discipline trivial to keep. `turn-fence-ingress-coverage.test.ts` pins that
 *   a handler downstream of this hook can read the admitted handle.
 */

import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

import { getSessionStore } from '../orchestrator-v5/session/index.js';
import {
  currentTurnFenceSlot,
  errMessage,
  runWithPendingTurnFence,
  unclaimedTurnFenceHandle,
} from '../orchestrator-v5/session/turn-fence.js';
import { log } from '../utils/telemetry.js';

/**
 * Pull the ingress identity out of the raw body.
 *
 * Deliberately defensive: the hook runs ahead of the handler's `runPreFlight`,
 * so a malformed body reaches here. A body without a usable
 * `(scenario_id, turn_id)` pair binds no slot — B1 is about to reject the
 * request anyway, and the graph-write refusal at the commit covers the
 * impossible case where it does not.
 *
 * ⚠ THE ONE BODY PARSE FOR BOTH FENCE INGRESSES (R-12/R-8). The turn SLOT
 *   (this hook) and the Stop TOMBSTONE (`routes/turn-stop.ts`) key the SAME
 *   `v5_turn_fence` row, so the identities they parse MUST agree — two
 *   implementations of this parse would be the drift shape: a body one accepts
 *   and the other rejects strands a tombstone the claim can never match. Any
 *   future ingress that names a fence row parses its identity HERE.
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
 * Bind the PENDING fence slot for this turn, then continue the request INSIDE
 * the fence context. No database write happens here — see the header.
 *
 * Never fails the request: a body without a usable identity simply binds no
 * slot, and the commit chokepoint's `no_ingress_fence` branch (turn-fence.ts
 * arrival 12) covers the impossible case where such a request still writes a
 * graph.
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
  // `done()` is called INSIDE the context — see the header warning.
  runWithPendingTurnFence(identity.scenarioId, identity.turnId, done);
}

/**
 * ADMISSION — claim the current request's place in its scenario's start
 * order. Called by route-v2 immediately after `runPreFlight` succeeds; the
 * single claim call site, and it is BEHIND the admission gate, which is the
 * whole of fix (b).
 *
 * Outcomes, mirroring the pre-fix prehandler exactly (the P0 protection is
 * unweakened — pinned by turn-fence-admission.test.ts):
 *   · claim lands       → the slot carries the admitted handle;
 *   · claim returns null / THROWS → the slot carries an UNCLAIMED handle and
 *     any graph write is REFUSED at the commit (#759 fail-closed, unchanged);
 *   · the store cannot claim (`claimTurnFence` absent — a test double) → the
 *     slot stays pending. There is nothing to fail closed about: the claiming
 *     store and the enforcing store are the same object in production
 *     (`turn-fence-guards.test.ts` pins the class), so a double that lacks
 *     the claim never reaches the real enforcement either;
 *   · no slot (not the fenced ingress, or an identity-less body) → no-op.
 *
 * Idempotent: a slot whose handle is already set is left alone, so a retryed
 * admission (or a test that pre-bound a handle) never double-claims.
 */
export async function admitCurrentTurnFence(): Promise<void> {
  const slot = currentTurnFenceSlot();
  if (slot === undefined || slot.handle !== null) return;

  const store = getSessionStore();
  if (typeof store.claimTurnFence !== 'function') return;

  try {
    const handle = await store.claimTurnFence(slot.scenarioId, slot.turnId);
    slot.handle = handle ?? unclaimedTurnFenceHandle(slot.scenarioId, slot.turnId);
  } catch (err) {
    log.error(
      {
        event: 'v5.turn_fence.claim_threw',
        scenario_id: slot.scenarioId,
        turn_id: slot.turnId,
        err: errMessage(err),
      },
      'V5 turn fence — the admission claim THREW; this turn is UNCLAIMED and any graph write it makes will be REFUSED at the commit',
    );
    slot.handle = unclaimedTurnFenceHandle(slot.scenarioId, slot.turnId);
  }
}
