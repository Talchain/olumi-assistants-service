/**
 * THE EXPLICIT USER STOP — one handler, two ingresses.
 *
 * Until this shipped there was NO cancel surface anywhere in CEE. Pressing Stop
 * aborted the browser's own fetch and nothing else, and
 * `streamed-turn-sse.ts:71-78` deliberately does not cancel a turn when the
 * client hangs up. Live-reproduced consequence
 * (`PHASE0-EVIDENCE-2026-07-28/fix-stop-fence.md`): a draft stopped at +4.0s ran
 * its full 52.7s, committed, and overwrote the graph of a later turn the user had
 * sent in the meantime.
 *
 * ⚠ THIS DOES NOT CANCEL THE TURN, AND THAT IS THE DESIGN. It records a
 *   tombstone in `v5_turn_fence`; the turn keeps running and its WRITE is refused
 *   at the commit chokepoint (`turn-fence.ts`). Destroying the in-flight pipeline
 *   is what the #751 arc rejected — a turn killed mid-flight can leave a scenario
 *   half-applied. So the ONE observable difference between an explicit Stop and
 *   an incidental disconnect is whether a tombstone exists: a disconnect sends
 *   nothing, has no tombstone, and still commits.
 *
 * ── WHY TWO INGRESSES AND ONE IMPLEMENTATION ────────────────────────────────
 * The UI's endpoint ladder (`v5Adapter.resolveEndpoint`) resolves to EITHER the
 * browser proxy (`…/proxy/v5/turn`, what staging bakes) or the Netlify edge
 * rung (`/bff/orchestrate/v2/turn`, which the edge function rewrites onto CEE's
 * `/orchestrate/*` with the service key injected). The stop URL is derived as
 * `<buffered endpoint>/stop` — the same derivation the streamed transport uses —
 * so BOTH rungs must exist or one of them 404s and the UI can never confirm a
 * Stop on it.
 *
 * They differ ONLY in ingress (who may call, and how they are authenticated).
 * Everything after that is this module, once — the same reasoning
 * `streamed-turn-sse.ts` gives for the two streamed turn routes. Two copies of
 * the stop handler would be CLAUDE.md trap 12 with a persistence-integrity
 * blast radius, and the drift would be silent: a divergent copy still answers
 * 200.
 */

import { readIngressTurnIdentity } from "../orchestrator/turn-fence-prehandler.js";
import { getSessionStore } from "../orchestrator-v5/session/index.js";
import { errMessage } from "../orchestrator-v5/session/turn-fence.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";

export interface TurnStopReply {
  readonly status: number;
  readonly body: unknown;
}

/**
 * 2.174 fix a — `scenarios.id` is a UUID column, so a non-UUID scenario id
 * CANNOT name an existing scenario. Refusing it here costs no round trip and
 * keeps garbage out of the fence entirely (pre-fix, a non-UUID reached the
 * RPC, failed with 22P02, and surfaced as an untyped 502).
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unknownScenarioReply(requestId: string): TurnStopReply {
  return {
    status: 404,
    body: {
      error: {
        code: "TURN_STOP_UNKNOWN_SCENARIO",
        message: "No scenario exists with that id.",
        source: "cee",
        request_id: requestId,
      },
    },
  };
}

/**
 * Record an explicit user Stop.
 *
 * The 200 body describes WHAT WAS RECORDED, in the past tense, and nothing
 * else. `already_committed` is derived server-side from `v5_conversation_turns`,
 * so it is a fact about a row that exists — never a prediction about whether the
 * fence will hold. The UI's three terminal-notice states are keyed on exactly
 * these outcomes; see `Docs/v5/turn-fence.md`.
 *
 * A stop that could NOT be recorded answers 502, never a 200 with a flag: the
 * UI must be able to tell "cancelled" from "we could not tell", and a 200 would
 * collapse those two into one.
 */
export async function recordExplicitTurnStop(
  body: unknown,
  requestId: string,
): Promise<TurnStopReply> {
  // R-12/R-8: the SAME parse as the ingress claim (`readIngressTurnIdentity`)
  // — the tombstone this records and the claim the turn made key one
  // `v5_turn_fence` row, so the two identities must be read by ONE function
  // or they can drift apart silently (a Stop the fence can never match).
  const identity = readIngressTurnIdentity(body);
  if (identity === null) {
    return {
      status: 400,
      body: {
        error: {
          code: "TURN_STOP_INVALID_BODY",
          message: "scenario_id and turn_id are both required.",
          source: "cee",
          request_id: requestId,
        },
      },
    };
  }

  const { scenarioId, turnId } = identity;

  // ── 2.174 fix a: the scenario must EXIST before anything is written ──────
  // The public rung is reachable with any UUID and fence rows are never
  // deleted, so an unchecked upsert let outsiders grow the table without
  // bound and tombstone-spray guessed scenarios. A non-UUID id cannot exist
  // (column type) — refused without a read. An unknown UUID is refused on a
  // clean no-row read. A FAILED read fails OPEN and records the Stop anyway:
  // the P0 protection (a legitimate user's Stop must land) outranks the
  // hardening, and the pre-existing turn on that scenario proves the row
  // existed moments ago. Priced residual, documented: a Stop that arrives
  // before the turn's own pre-flight scenario upsert commits (sub-100 ms
  // into the turn, vs ≥1 s for a human Stop click) would be refused — the
  // UI's non-200 copy ("we could not confirm") is the honest surface there.
  if (!UUID_PATTERN.test(scenarioId)) {
    log.warn(
      {
        event: "v5.turn_fence.stop_refused_unknown_scenario",
        request_id: requestId,
        reason: "non_uuid_scenario_id",
      },
      "V5 turn fence — Stop refused: scenario id is not a UUID, so it cannot exist",
    );
    return unknownScenarioReply(requestId);
  }
  try {
    const store = getSessionStore();
    if (typeof store.scenarioExists === "function") {
      let exists = true;
      try {
        exists = await store.scenarioExists(scenarioId);
      } catch (err) {
        log.warn(
          {
            event: "v5.turn_fence.stop_existence_read_failed",
            request_id: requestId,
            scenario_id: scenarioId,
            err: errMessage(err),
          },
          "V5 turn fence — scenario existence read failed; failing OPEN and recording the Stop",
        );
      }
      if (!exists) {
        log.warn(
          {
            event: "v5.turn_fence.stop_refused_unknown_scenario",
            request_id: requestId,
            scenario_id: scenarioId,
            reason: "scenario_not_found",
          },
          "V5 turn fence — Stop refused: no scenario exists with that id; nothing was written",
        );
        return unknownScenarioReply(requestId);
      }
    }
    if (typeof store.markTurnStopped !== "function") {
      // The production store always implements it (pinned from the class by
      // turn-fence-guards.test.ts). Reaching here means the store is a double,
      // so say so rather than reporting a Stop that was never recorded.
      throw new Error("session store does not implement markTurnStopped");
    }
    const outcome = await store.markTurnStopped(scenarioId, turnId);
    emit(TelemetryEvents.V5TurnStopRequested, {
      request_id: requestId,
      scenario_id: scenarioId,
      turn_id: turnId,
      claimed: outcome.claimed,
      already_committed: outcome.alreadyCommitted,
    });
    log.info(
      {
        event: "v5.turn_fence.stop_requested",
        request_id: requestId,
        scenario_id: scenarioId,
        turn_id: turnId,
        claimed: outcome.claimed,
        already_committed: outcome.alreadyCommitted,
      },
      "V5 turn fence — explicit user Stop recorded",
    );
    return {
      status: 200,
      body: {
        stopped: outcome.stopped,
        claimed: outcome.claimed,
        already_committed: outcome.alreadyCommitted,
        scenario_id: scenarioId,
        turn_id: turnId,
        request_id: requestId,
      },
    };
  } catch (err) {
    log.error(
      {
        event: "v5.turn_fence.stop_failed",
        request_id: requestId,
        scenario_id: scenarioId,
        turn_id: turnId,
        err: errMessage(err),
      },
      "V5 turn fence — could not record the explicit user Stop",
    );
    return {
      status: 502,
      body: {
        error: {
          code: "TURN_STOP_NOT_RECORDED",
          message: "The stop request could not be recorded.",
          source: "cee",
          request_id: requestId,
        },
      },
    };
  }
}
