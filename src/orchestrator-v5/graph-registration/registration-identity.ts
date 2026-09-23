/**
 * The identity of a graph registration — ONE definition, shared by the route that
 * writes it and by every caller that needs to find it again.
 *
 * ⛔ Why this is its own module: the Agent lane has to derive the SAME turn id the
 * route derives, in order to look up a construction it may already have committed
 * (a lost-response retry). A second copy of the derivation in the lane would be a
 * twin that drifts silently — and a drifted twin looks up the wrong key and
 * reports "nothing committed" when a version exists.
 */
import { createHash } from "node:crypto";

/**
 * `turn_id` for the registration commit.
 *
 * Prefixed so the turn log says WHY the graph moved without anyone having to
 * join it against another table.
 *
 * ⛔ REPLAY-STABLE WHEN THE CALLER NAMES THE OPERATION. This was
 * `randomUUID()` on every request, and the RPC's idempotency key is
 * `(scenario_id, turn_id)` — so a lost-response retry was a brand-new write to
 * every layer beneath it, the store's replay classifier (`classifyPriorTurn`)
 * could never match a prior row, and a retry could mint a SECOND version
 * instead of recovering the first receipt. Measured signed-in on staging
 * 9c16e8cd: construction wrote `graph_registration:<random>`.
 *
 * With an `operation_id`, the turn id is DERIVED — the same (scenario, operation)
 * always yields the same key, so an exact retry reaches the replay arm and gets
 * the original receipt back. Without one, nothing changes: every request is
 * still distinct, which is the UI import's behaviour today.
 */
export function registrationTurnId(scenarioId: string, operationId?: string): string {
  if (operationId === undefined) return `graph_registration:${globalThis.crypto.randomUUID()}`;
  const h = createHash("sha256").update(`graph_registration:${scenarioId}:${operationId}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString("hex");
  return `graph_registration:${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/**
 * The request_hash for a registration: a digest of WHAT is being registered.
 *
 * ⛔ It used to be the turn id itself. The store's replay classifier answers
 * "is this the same request replaying?" by comparing `request_hash` against the
 * row already under `(scenario_id, turn_id)` — so with the turn id as the hash,
 * an identical retry and the same operation id reused for a DIFFERENT graph were
 * indistinguishable. Digesting the projected bytes and the brief makes the
 * first a replay and the second a conflict, which is what they are.
 */
export function registrationRequestHash(graphForStore: unknown, brief: string | undefined): string {
  return `graph_registration:${createHash("sha256").update(JSON.stringify({ graph: graphForStore, brief: brief ?? null })).digest("hex")}`;
}

