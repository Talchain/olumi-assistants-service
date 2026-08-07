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
 *
 * ── ROADMAP 2.236 — THE STOP ROUTE NOW AUTHORIZES (Codex audit C, C-1) ──────
 * Until this landed, this handler checked UUID SYNTAX and SCENARIO EXISTENCE
 * and NOTHING ELSE. It read no identity at all. The public rung's only other
 * defences were a forgeable `Origin` allowlist and a 30/min per-IP limit, and
 * the module header above argued that was acceptable because "a caller who can
 * stop a turn on a scenario is already a caller who can APPEND turns to it".
 *
 * ⚠ THAT ARGUMENT WAS FALSE, AND IT IS THE WHOLE DEFECT. Appending is gated by
 *   the turn route's scenario-ownership pre-flight, which REFUSES an anonymous
 *   caller on an OWNED scenario (`scenario_requires_authenticated_owner`).
 *   Stopping was gated by nothing. So on an owned scenario the Stop rung
 *   granted strictly MORE authority than the turn rung, not less — the exact
 *   inverse of the claim. The harm is not a nuisance tombstone: `generation` is
 *   a `BIGSERIAL` and the Stop RPC UPSERTS, so an INVENTED `turn_id` inserted a
 *   row with a HIGHER generation than every in-flight turn, and a legitimate
 *   graph-bearing turn admitted at G then hit `OLTF2` at its commit and LOST
 *   ITS GRAPH WRITE. No JWT and no knowledge of the victim's turn id required.
 *
 * The fix, in the order the checks run below:
 *   1. bound `turn_id` LENGTH — an unbounded caller-chosen string went
 *      straight into a permanent TEXT column;
 *   2. scenario UUID syntax, then scenario EXISTENCE (2.174, unchanged, and
 *      deliberately BEFORE the ownership pre-flight, whose `ensureScenarioExists`
 *      UPSERTS — checking existence first is what stops a Stop from CREATING
 *      the scenario it claims to stop);
 *   3. the SAME verified-identity + scenario-ownership pre-flight the turn
 *      route runs — literally the same two functions, `resolveVerifiedIdentityOrRefuse`
 *      and `authorizeScenarioOwnership` from route-v2-preflight.ts, NOT a second
 *      ownership rule written here (that would be trap 12 with an authorization
 *      blast radius);
 *   4. the turn must have been ADMITTED — a fence row must already exist for
 *      (scenario, turn). This is what makes a caller-INVENTED `turn_id`
 *      unable to allocate a new generation, and therefore unable to supersede
 *      anything.
 *
 * ⚠ EVERY REFUSAL ABOVE ANSWERS THE SAME BYTES. "no such scenario", "not your
 *   scenario", "no such turn" and "turn id too long" are INDISTINGUISHABLE:
 *   one status, one code, one message. The pre-fix route answered 200 with
 *   `claimed` / `already_committed` for ANY guessed turn id, which was a free
 *   oracle over another user's turn state; a refusal that named its reason
 *   would rebuild that oracle one bit at a time.
 *
 * ⚠ WHAT THIS DOES NOT DO. Guest (unowned) scenarios stay addressable by
 *   anyone holding the UUID — `preflightEnsureScenario` carves them out BY
 *   DESIGN and the turn route does the same, so closing that here would fork
 *   the two rungs' authorization models rather than align them. That posture is
 *   the accepted PoC one, announced in the proxy's boot log. What changed is
 *   that Stop no longer grants MORE than a turn does.
 *
 * ── WHY THIS CANNOT REGRESS THE OWNER'S STOP ────────────────────────────────
 * The authorization inputs are identical to the turn route's — the same
 * identity resolver over the same headers, the same `user_id` extension parse,
 * the same ownership function. So the guarantee is structural: ANY TURN THAT
 * COULD BE ADMITTED ON A SCENARIO CAN BE STOPPED ON THAT SCENARIO. A refused
 * Stop is a Stop for a turn that could never have been admitted.
 */

import type { FastifyRequest } from "fastify";

import { parseRequestExtensions } from "../orchestrator-v5/boundary/request-extensions.js";
import {
  authorizeScenarioOwnership,
  resolveVerifiedIdentityOrRefuse,
} from "../orchestrator/route-v2-preflight.js";
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

  // ── 2.236 STEP 0, AND IT IS FIRST FOR A REASON ──────────────────────────
  // `runPreFlight` resolves identity BEFORE body validation so that an
  // unauthenticated caller learns nothing about the request it sent or the
  // state of the service. This rung must match that ordering EXACTLY, because
  // ordering is the whole of the alignment claim between the two rungs.
  //
  // ⚠ AN EARLIER REVISION OF THIS FIX PUT THIS CALL AFTER THE SCENARIO-EXISTENCE
  //   READ, and wrote a comment claiming identity ran "strictly before anything
  //   that reads the scenario". It did not, and the comment made the gap look
  //   reviewed — the exact defect shape this whole PR exists to correct, in the
  //   correction. Measured on the un-hoisted code with the JWT flag on and a
  //   junk token: an EXISTING scenario answered 401 while an ABSENT one
  //   answered 404, so the refusal status was a free scenario-existence oracle
  //   for any caller willing to present a deliberately bad token. Hoisted here,
  //   both answer 401 and `scenarioExists` is never reached.
  //
  // Hoisting is free: this call reads only `req.headers`, writes nothing, and
  // touches no store — so the "existence before the ownership upsert" ordering
  // that keeps a Stop from CREATING a scenario is untouched.
  const resolved = await resolveVerifiedIdentityOrRefuse(req, requestId);
  if (!resolved.ok) {
    return { status: resolved.status, body: resolved.error };
  }

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
    return stopRefusedReply(requestId);
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
        return stopRefusedReply(requestId);
      }
    }

    // ── 2.236 step 3: THE SAME PRE-FLIGHT THE TURN ROUTE RUNS ──────────────
    // Two calls, both into route-v2-preflight.ts, both shared verbatim with
    // `runPreFlight`. Nothing about ownership is decided in this file. Step 0
    // (`resolveVerifiedIdentityOrRefuse`) already ran at the top of the handler,
    // before ANY read of server state — see the ordering note there.
    //
    // The caller-supplied `user_id`, read by the SAME parser the turn route
    // uses — not a hand-rolled `body.user_id` read, which would drift the day
    // the extension contract moves. With `CEE_REQUIRE_USER_JWT` on, the
    // verified `sub` overrides it inside `authorizeScenarioOwnership`; with the
    // flag off (staging today) it IS the identity, exactly as on a turn.
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

    const owned = await authorizeScenarioOwnership(
      scenarioId,
      extensions.value.userId,
      resolved.identity,
      requestId,
    );
    if (!owned.ok) {
      // Every ownership reason collapses to the ONE refusal — including
      // `scenario_ownership_unverifiable`, which is the oracle-down case. That
      // is fail-CLOSED and it matches the turn route: when the oracle is down
      // the turn cannot be admitted either, so no admissible turn loses its
      // Stop. The reason is logged, never returned.
      log.warn(
        {
          event: "v5.turn_fence.stop_refused_not_owner",
          request_id: requestId,
          scenario_id: scenarioId,
          reason: owned.reason,
        },
        "V5 turn fence — Stop refused: caller is not authorized for this scenario; nothing was written",
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
    // Same error discipline as the existence check above, and for the same
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
