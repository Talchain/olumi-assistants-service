/**
 * Decision Records — the RECORDING SEAM (calibration R0, ROADMAP 2.727).
 *
 * Two write paths, both owner-authenticated, both always-on:
 *
 *   POST /assist/v1/decision-records/commit
 *        The user commits a decision they MADE, with the confidence THEY
 *        stated. Writes `committed_by_user: true` +
 *        `confidence_source: 'user_stated'` — the first user-stated
 *        calibration population the product has ever had.
 *
 *   POST /assist/v1/decision-records/:record_id/outcome
 *        The other end of the loop: what actually happened, plus the first
 *        `outcome.brier_component` anything in this estate has ever written.
 *
 * ── WHY `/assist/v1` AND NOT `/v5` — A CORRECTED PREMISE ──────────────────
 * The design brief specified `src/routes/v5.decision-records.ts` at
 * `POST /v5/decision-records/commit`. Measured in the UI at `a81121d1`, that
 * path is UNREACHABLE from the browser: the only same-origin seam that reaches
 * CEE with a user token is `/bff/cee/*`, whose Netlify edge function rewrites
 * the prefix to **`/assist/v1`** and injects `X-Olumi-Assist-Key` server-side
 * (`netlify/edge-functions/cee-proxy.ts`, bound in `netlify.toml:255-257`).
 * A `/v5/...` route would have needed either a new edge binding or a new
 * `isPublicRoute()` carve-out — i.e. a new seam and a weaker auth posture — to
 * do what the existing seam already does correctly. Mounting under
 * `/assist/v1` needs neither.
 *
 * ── THE AUTH POSTURE, AND WHY IT IS TWO INDEPENDENT CHECKS ────────────────
 * 1. CALLER auth (`X-Olumi-Assist-Key`) is handled by the auth plugin exactly
 *    as for every other `/assist/v1` route. The edge function injects it; it
 *    never enters the browser bundle.
 * 2. USER identity is verified HERE, ALWAYS-ON, from
 *    `Authorization: Bearer <supabase access token>` via the hardened
 *    `verifySupabaseUserJwt` util — and DELIBERATELY INDEPENDENT of
 *    `CEE_REQUIRE_USER_JWT`. That flag gates the TURN path, whose identity is
 *    otherwise a claimed `x-user-id` header; a decision record is a durable,
 *    owner-scoped, long-horizon claim about a person's judgement and must
 *    never be writable on a claimed identity. There is no configuration in
 *    which this endpoint trusts a header.
 *
 * The edge function forwards `authorization` as the USER-token slot and sets
 * `X-Olumi-Assist-Key` separately, so the two never collide
 * (`cee-proxy.ts` ALLOWED_FORWARD_HEADERS).
 *
 * ── NO FLAGS, BY RULING ───────────────────────────────────────────────────
 * This route registers UNCONDITIONALLY. The design pack's "every slice merges
 * flag-gated dark" sequencing is withdrawn: Paul's standing rulings are *no
 * dark launches* (ship ON; rollback = code revert) and *no new flag/env
 * gates*, and the estate already applied both to THIS feature by deleting
 * `CEE_DECISION_RECORD_CAPTURE` in #539. A new gate here would re-introduce
 * the exact thing that was removed.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getDecisionRecordStore } from '../orchestrator-v5/decision-records/index.js';
import {
  DecisionRecordNotFoundError,
  DecisionRecordOutcomeConflictError,
  DecisionRecordSignInRequiredError,
} from '../orchestrator-v5/decision-records/store-adapter.js';
import type {
  DecisionRecordStorePort,
  RecordDecisionOutcomeWrite,
} from '../orchestrator-v5/decision-records/store-adapter.js';
import { buildUserCommitWrite } from '../orchestrator-v5/decision-records/user-commit.js';
import {
  computeBrierComponent,
  isDecisionOutcomeResult,
} from '../orchestrator-v5/decision-records/scoring.js';
import { verifySupabaseUserJwt } from '../utils/supabase-user-jwt.js';
import type { SupabaseUserJwtRefusalReason } from '../utils/supabase-user-jwt.js';
import { getRequestId } from '../utils/request-id.js';
import { log } from '../utils/telemetry.js';

export const DECISION_RECORDS_COMMIT_PATH = '/assist/v1/decision-records/commit';
export const DECISION_RECORDS_OUTCOME_PATH =
  '/assist/v1/decision-records/:record_id/outcome';

/** UUID shape — `scenario_id` and `record_id` are UUID columns. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RefusalBody {
  readonly error: string;
  readonly code: string;
  readonly message: string;
  readonly request_id: string;
}

function refuse(
  reply: FastifyReply,
  req: FastifyRequest,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  const body: RefusalBody = {
    error: code,
    code,
    message,
    request_id: getRequestId(req),
  };
  return reply.code(status).send(body);
}

/** Map the JWT util's stable failure taxonomy onto the 401 envelope. */
function jwtRefusalCode(reason: SupabaseUserJwtRefusalReason): string {
  return reason;
}

/**
 * Verify the caller's Supabase access token. ALWAYS-ON — never consults
 * `CEE_REQUIRE_USER_JWT`. Returns the user id, or sends the 401 and returns
 * null.
 *
 * The `aud` guard inside `verifySupabaseUserJwt` is load-bearing here: the
 * project's anon and service_role API keys are themselves HS256 JWTs on the
 * SAME shared secret, and only the `authenticated` audience separates a real
 * user token from them.
 */
async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const header = req.headers.authorization;
  const token =
    typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : '';
  if (token === '') {
    refuse(
      reply,
      req,
      401,
      'sign_in_required',
      'Decision records are personal: sign in and retry with your access token.',
    );
    return null;
  }
  const result = await verifySupabaseUserJwt(token);
  if (!result.ok) {
    refuse(
      reply,
      req,
      401,
      jwtRefusalCode(result.reason),
      result.reason === 'expired_token'
        ? 'Your session has expired. Sign in again and retry.'
        : 'That token could not be verified.',
    );
    return null;
  }
  return result.userId;
}

function asRecord(x: unknown): Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : {};
}

function readString(source: Record<string, unknown>, key: string): string {
  const raw = source[key];
  return typeof raw === 'string' ? raw : '';
}

export default async function route(
  app: FastifyInstance,
  /** Test seam: inject a hand-rolled store port; production resolves the
   *  service-role singleton lazily, per-request, exactly like the capture
   *  hook does (so importing this module never requires SUPABASE_* env). */
  deps?: { readonly store?: DecisionRecordStorePort; readonly now?: () => Date },
): Promise<void> {
  const resolveStore = (): DecisionRecordStorePort => deps?.store ?? getDecisionRecordStore();
  const nowFn = deps?.now ?? (() => new Date());

  // -------------------------------------------------------------------------
  // COMMIT — the user's own decision + their own confidence.
  // -------------------------------------------------------------------------
  app.post(DECISION_RECORDS_COMMIT_PATH, async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (userId === null) return reply;

    const body = asRecord(req.body);
    const scenarioId = readString(body, 'scenario_id').trim();
    if (!UUID_RE.test(scenarioId)) {
      return refuse(reply, req, 400, 'invalid_scenario_id', 'scenario_id must be a UUID');
    }

    const store = resolveStore();

    // OWNERSHIP FIRST, BEFORE ANY RPC. The RPC would answer authoritatively
    // (DR001 for a guest scenario), but it would ALSO have written for a
    // scenario belonging to somebody else — `create_decision_record` is
    // SECURITY DEFINER and derives owner_user_id from scenarios.user_id
    // without ever consulting the caller. The caller check is therefore ours
    // to make, and it must happen before the write, not after it.
    const owner = await store.readScenarioOwner(scenarioId);
    if (owner === undefined) {
      return refuse(reply, req, 404, 'scenario_not_found', 'No such scenario.');
    }
    if (owner === null) {
      // Guest scenario — the RPC's designed DR001 refusal, taken here so no
      // owner is ever defaulted.
      return refuse(
        reply,
        req,
        403,
        'DR001',
        'Decision records require sign-in: this scenario has no owner.',
      );
    }
    if (owner !== userId) {
      return refuse(reply, req, 403, 'not_scenario_owner', 'This scenario belongs to someone else.');
    }

    // THE ANCHOR IS OURS TO DERIVE, NOT THE CLIENT'S TO SUPPLY — see
    // user-commit.ts. No analysis ⇒ nothing to anchor the decision to ⇒
    // refuse, rather than record a decision against a hash nobody can
    // re-derive.
    const anchor = await store.readNewestAnalysisAnchor(scenarioId);
    if (anchor === null) {
      return refuse(
        reply,
        req,
        409,
        'no_analysed_graph',
        'Run an analysis before recording the decision — a record has to be anchored to the graph it was made against.',
      );
    }

    const built = buildUserCommitWrite({
      scenarioId,
      userId,
      chosenOptionId: readString(body, 'chosen_option_id'),
      chosenOptionLabel: readString(body, 'chosen_option_label'),
      confidence0to100: body.confidence_0_100,
      expectationStatement: readString(body, 'expectation_statement'),
      revisitTriggerOrDate: typeof body.revisit_trigger_or_date === 'string'
        ? body.revisit_trigger_or_date
        : undefined,
      graphHashAtRun: anchor.graphHashAtRun,
      // A stable client nonce makes a network retry replay through the RPC's
      // dedupe branch; its absence makes every commit a NEW record rather
      // than one silently swallowed by a previous one.
      commitNonce: readString(body, 'client_commit_id').trim() || nowFn().toISOString(),
      now: nowFn(),
    });
    if (built.kind === 'refuse') {
      // NO RPC CALL on a refusal — asserted by the specs.
      return refuse(reply, req, 400, built.code, built.message);
    }

    try {
      const outcome = await store.createRecord(built.write);
      return reply.code(201).send({
        record_id: outcome.record_id,
        deduped: outcome.deduped,
        event_id: outcome.event_id,
        // The rung is DISCLOSED, never silent: the user needs to know whether
        // the date they see is the one they set or our 90-day default.
        review_date: built.write.review_date,
        review_date_source: built.reviewDateSource,
        confidence_source: built.write.prediction.confidence_source,
        committed_by_user: built.write.decision.committed_by_user,
        request_id: getRequestId(req),
      });
    } catch (err) {
      if (err instanceof DecisionRecordSignInRequiredError) {
        return refuse(reply, req, 403, 'DR001', 'Decision records require sign-in.');
      }
      log.warn(
        {
          event: 'v5.decision_records.commit_failed',
          scenario_id: scenarioId,
          err: err instanceof Error ? err.message : String(err),
        },
        'DecisionRecords — commit write failed',
      );
      return refuse(reply, req, 502, 'store_error', 'We could not save that decision. Nothing was recorded.');
    }
  });

  // -------------------------------------------------------------------------
  // OUTCOME — write-once, and the first brier_component producer.
  // -------------------------------------------------------------------------
  app.post(DECISION_RECORDS_OUTCOME_PATH, async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (userId === null) return reply;

    const params = asRecord(req.params);
    const recordId = readString(params, 'record_id').trim();
    if (!UUID_RE.test(recordId)) {
      return refuse(reply, req, 400, 'invalid_record_id', 'record_id must be a UUID');
    }

    const body = asRecord(req.body);
    const result = body.result;
    if (!isDecisionOutcomeResult(result)) {
      return refuse(
        reply,
        req,
        400,
        'invalid_result',
        'result must be one of better | as_expected | worse | abandoned',
      );
    }
    const rawNotes = body.notes;
    // The RPC rejects an EMPTY-string `notes` outright (its whitelist demands
    // a non-empty string when the key is present), so an empty note is
    // OMITTED rather than sent — a 22023 on an optional field would refuse
    // the whole outcome.
    const notes =
      typeof rawNotes === 'string' && rawNotes.trim() !== '' ? rawNotes.trim() : undefined;

    const store = resolveStore();
    const record = await store.readRecordForOutcome(recordId);
    if (record === null) {
      return refuse(reply, req, 404, 'DR404', 'No such decision record.');
    }
    if (record.owner_user_id !== userId) {
      // 404-not-403 is deliberate here in one respect only: we still refuse
      // BEFORE any RPC. The code is explicit so the UI can distinguish.
      return refuse(reply, req, 403, 'not_record_owner', 'This record belongs to someone else.');
    }

    // ⭐ THE FIRST brier_component PRODUCER. Omitted — never 0, never null —
    // when the record staked no confidence or the result is `abandoned`.
    const brierComponent = computeBrierComponent(record.confidence, result);

    const write: RecordDecisionOutcomeWrite = {
      record_id: recordId,
      outcome: {
        recorded_at: nowFn().toISOString(),
        result,
        ...(notes !== undefined ? { notes } : {}),
        ...(brierComponent !== undefined ? { brier_component: brierComponent } : {}),
      },
      event_id: `decision_outcome_recorded_${recordId}`,
    };

    try {
      const outcome = await store.recordOutcome(write);
      return reply.code(200).send({
        record_id: outcome.record_id,
        deduped: outcome.deduped,
        event_id: outcome.event_id,
        result,
        // Absent when the record is reviewed-UNSCORED. The key is omitted
        // rather than sent as null so the response cannot be read as "scored
        // zero" — which is the best possible score.
        ...(brierComponent !== undefined ? { brier_component: brierComponent } : {}),
        scored: brierComponent !== undefined,
        request_id: getRequestId(req),
      });
    } catch (err) {
      if (err instanceof DecisionRecordNotFoundError) {
        return refuse(reply, req, 404, 'DR404', 'No such decision record.');
      }
      if (err instanceof DecisionRecordOutcomeConflictError) {
        return refuse(
          reply,
          req,
          409,
          'DR409',
          'This decision already has a recorded outcome. Outcomes are write-once.',
        );
      }
      log.warn(
        {
          event: 'v5.decision_records.outcome_failed',
          record_id: recordId,
          err: err instanceof Error ? err.message : String(err),
        },
        'DecisionRecords — outcome write failed',
      );
      return refuse(reply, req, 502, 'store_error', 'We could not save that outcome. Nothing was recorded.');
    }
  });
}
