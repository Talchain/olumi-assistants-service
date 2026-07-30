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

import { getSessionStore } from "../orchestrator-v5/session/index.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";

export interface TurnStopReply {
  readonly status: number;
  readonly body: unknown;
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
  const fields =
    body !== null && typeof body === "object"
      ? (body as { scenario_id?: unknown; turn_id?: unknown })
      : {};
  const scenarioId = typeof fields.scenario_id === "string" ? fields.scenario_id : "";
  const turnId = typeof fields.turn_id === "string" ? fields.turn_id : "";
  if (scenarioId.length === 0 || turnId.length === 0) {
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

  try {
    const store = getSessionStore();
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
        err: err instanceof Error ? err.message : String(err),
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
