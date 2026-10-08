/** Explicit turn Stop.
 * HTTP identity and scenario ownership are admitted by the single global hook.
 * This helper retains body validation, admitted-turn checks and recording.
 * Scenario existence is checked in the hook before ownership. Unknown scenario/non-owner/unknown-turn refusals stay identical.
 * Clean missing rows refuse; the existing existence/admitted-turn outage
 * hardening remains fail-open; ownership reads still fail closed in the hook. */

import type { FastifyRequest } from "fastify";

import { parseRequestExtensions } from "../orchestrator-v5/boundary/request-extensions.js";
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

/**
 * 2.236 — the caller-chosen `turn_id` is written verbatim into a permanent TEXT
 * column, and before this bound there was none: `readIngressTurnIdentity` asks
 * only for a non-empty string.
 *
 * DERIVED, not guessed. The UI generates `crypto.randomUUID()` (36 chars);
 * measured on staging 2026-08-01, `v5_turn_fence.turn_id` is 36 chars for all
 * 727 rows and `v5_conversation_turns.turn_id` spans 36–42 over 6,160 rows (the
 * long tail is prefixed harness ids). 128 leaves ~3× headroom over the widest
 * id the system has ever produced while removing the unbounded case.
 */
export const MAX_TURN_ID_LENGTH = 128;

/**
 * THE ONE REFUSAL. Unknown scenario, scenario owned by someone else, unknown
 * turn, over-long turn id — all four answer these exact bytes, so a caller
 * probing ids learns nothing about which of the four it hit. See the header.
 *
 * 404 and the `TURN_STOP_UNKNOWN_SCENARIO` code are inherited from 2.174 so the
 * wire shape does not move; the MESSAGE is neutral because the code's name is
 * now narrower than the set of cases that answer it. On the UI this is a
 * non-200, which maps to the honest "we could not confirm" terminal notice
 * (`Docs/v5/turn-fence.md`) — the same copy a 502 already produced.
 */
function stopRefusedReply(requestId: string): TurnStopReply {
  return {
    status: 404,
    body: {
      error: {
        code: "TURN_STOP_UNKNOWN_SCENARIO",
        message: "That turn could not be stopped.",
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
 *
 * ⚠ 2.236 — TAKES THE REQUEST, NOT THE BODY. The signature widened from
 *   `(body, requestId)` because authorization needs the CALLER, and the caller
 *   lives in the headers (`Authorization`) as well as the body (`user_id`). Both
 *   ingresses already had the request in hand.
 */
export async function recordExplicitTurnStop(
  req: FastifyRequest,
  requestId: string,
): Promise<TurnStopReply> {
  const body = req.body;

  // The global hook resolves identity before any scenario read.

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

  // ── 2.236: bound the caller-chosen turn id ──────────────────────────────
  // Answers the ONE refusal, not a distinct "too long", so it cannot be used
  // to probe the boundary of anything else.
  if (turnId.length > MAX_TURN_ID_LENGTH) {
    log.warn(
      {
        event: "v5.turn_fence.stop_refused",
        request_id: requestId,
        reason: "turn_id_too_long",
        turn_id_length: turnId.length,
      },
      "V5 turn fence — Stop refused: turn id exceeds the permitted length",
    );
    return stopRefusedReply(requestId);
  }

  // Non-UUID ids still refuse without a scenario read. The global hook
  // handles existence (clean absence refuses, a throw proceeds to ownership)
  // before admitting this handler; do not repeat that read here.
  if (!UUID_PATTERN.test(scenarioId)) {
    log.warn(
      {
        event: "v5.turn_fence.stop_refused_unknown_scenario",
        request_id: requestId,
        reason: "non_uuid_scenario_id",
      },
      "V5 turn fence — Stop refused: scenario id is not a UUID, so it cannot exist",
    );
    return stopRefusedReply(requestId);
  }
  try {
    const store = getSessionStore();
    const extensions = parseRequestExtensions(body, requestId);
    if (!extensions.ok) {
      log.warn(
        {
          event: "v5.turn_fence.stop_refused",
          request_id: requestId,
          reason: "invalid_identity_extension",
        },
        "V5 turn fence — Stop refused: the request extensions did not parse",
      );
      return stopRefusedReply(requestId);
    }

    // ── 2.236 step 4: the turn must have been ADMITTED ─────────────────────
    // This is the check that removes the DAMAGE. `v5_mark_turn_stopped` upserts
    // and `generation` is a BIGSERIAL, so an INVENTED turn id INSERTS a row at a
    // higher generation and supersedes every in-flight turn on the scenario;
    // an EXISTING row takes the ON CONFLICT branch, which never touches
    // `generation`. Refusing here is therefore the difference between a Stop
    // that can only tombstone its own turn and one that can destroy a
    // stranger's graph write.
    //
    // Same error discipline as the existence check in the hook, and for the same
    // reason: a clean `false` is a FACT and refuses; a THROWN read is an
    // UNKNOWN and fails OPEN, because a DB blip must not cost a legitimate
    // user their Stop. A store double without the method skips the check.
    //
    // Priced residual, stated rather than hidden: a Stop that lands in the
    // window between the turn's scenario upsert and its fence claim — both
    // inside `runPreFlight`+`admitCurrentTurnFence`, milliseconds apart, versus
    // ≥1 s for a human Stop click — is refused, and the UI's non-200 "we could
    // not confirm" copy is the honest surface. The pre-emptive tombstone that
    // window used to buy is worth less than it looks: a turn whose claim has
    // not landed is UNCLAIMED, and an unclaimed turn's graph write is already
    // refused at the commit (#759 fail-closed).
    if (typeof store.turnFenceRowExists === "function") {
      let admitted = true;
      try {
        admitted = await store.turnFenceRowExists(scenarioId, turnId);
      } catch (err) {
        log.warn(
          {
            event: "v5.turn_fence.stop_admission_read_failed",
            request_id: requestId,
            scenario_id: scenarioId,
            err: errMessage(err),
          },
          "V5 turn fence — admitted-turn read failed; failing OPEN and recording the Stop",
        );
      }
      if (!admitted) {
        log.warn(
          {
            event: "v5.turn_fence.stop_refused_unadmitted_turn",
            request_id: requestId,
            scenario_id: scenarioId,
            reason: "turn_not_admitted",
          },
          "V5 turn fence — Stop refused: no admitted turn with that id on this scenario; nothing was written",
        );
        return stopRefusedReply(requestId);
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
