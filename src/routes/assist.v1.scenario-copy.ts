/**
 * A guest's decision follows them into their account (ACCOUNTS B3, DL 380e54 #85 5942022182).
 *
 *   POST /assist/v1/scenarios/:scenario_id/copy
 *        Copies the GUEST scenario `:scenario_id` into a NEW scenario owned by the signed-in caller: `graph` and `title`
 *        only, no Run (the UI offers "Run again"). Idempotent per (source, user): a retry returns the same copy.
 *        200 { scenario_id, created }.
 *
 * ── WHY A COPY, NEVER A CLAIM ─────────────────────────────────────────────
 * A guest scenario id is a bearer capability: whoever holds it can already read it as a guest. Nothing proves the
 * person signing in is the guest who built it, so ownership never MOVES (`claim_guest_scenario` is not called). A copy
 * grants nothing the id did not already grant, and the guest row is never written.
 *
 * ── AUTH: two independent checks, as `assist.v1.decision-records.ts` ─────
 * 1. CALLER: `X-Olumi-Assist-Key`, injected by the `/bff/cee/*` edge function (auth plugin, as every /assist/v1 route).
 * 2. USER: `Authorization: Bearer <supabase access token>` verified HERE, ALWAYS-ON, independent of
 *    `CEE_REQUIRE_USER_JWT`. The owner of the copy is the token's verified `sub` and nothing else; there is no body.
 *
 * ── ONE REFUSAL FOR ANYTHING SCENARIO-SHAPED (DL brief @1529656) ────────
 * Absent, owned by anyone, no model yet, too large, malformed id: all answer the SAME 404 bytes (the read and register
 * routes' rule), so this route is never an oracle over whether a decision exists or whose it is. Each is TERMINAL for
 * that id: the UI forgets it. The reason is logged server-side only. A 401 is about the caller, a 503 is "retry".
 *
 * ── RATE LIMIT: KEYED BY THE VERIFIED USER (CODEX overflow P1 on #2493) ──
 * `CEE_SCENARIO_COPY_RATE_LIMIT_RPM`, `coach` tier: a write, so it fails CLOSED when the limiter is blind. The JWT is
 * verified FIRST, in this route's own `preHandler`; the limiter runs after it in the same hook and keys on the verified
 * `sub`. So two people behind one NAT or proxy each get their own quota, and one person cannot widen theirs by
 * changing IP. A request whose token does not verify is answered 401 before it reaches the limiter (verification is a
 * local signature check against the cached JWKS).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getGuestCopyStore } from '../orchestrator-v5/guest-copy/index.js';
import type { GuestCopyRefusal, GuestCopyStorePort } from '../orchestrator-v5/guest-copy/index.js';
import { resolveCeeRateLimit } from '../cee/config/limits.js';
import { verifySupabaseUserJwt } from '../utils/supabase-user-jwt.js';
import { getRequestId } from '../utils/request-id.js';
import { log } from '../utils/telemetry.js';

export const SCENARIO_COPY_PATH = '/assist/v1/scenarios/:scenario_id/copy';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refuse(reply: FastifyReply, req: FastifyRequest, status: number, code: string, message: string): FastifyReply {
  return reply.code(status).send({ error: code, code, message, request_id: getRequestId(req) });
}

const NOT_COPYABLE = [404, 'scenario_not_copyable', 'There is no guest decision with that id to copy.'] as const;

const REFUSAL_REPLY: Readonly<Record<GuestCopyRefusal, readonly [number, string, string]>> = {
  not_copyable: NOT_COPYABLE,
  no_model: NOT_COPYABLE,
  too_large: NOT_COPYABLE,
  unknown_user: [401, 'sign_in_required', 'Your account could not be found. Sign in again and retry.'],
};

/** The verified `sub` for a request that passed this route's JWT check (set in `preHandler`, read by the limiter key). */
const verifiedUserOf = new WeakMap<FastifyRequest, string>();

/** The limiter key: the verified user. The `ip:` fallback is never reached in practice (unverified requests stop at 401). */
export function scenarioCopyRateKey(req: FastifyRequest): string {
  const userId = verifiedUserOf.get(req);
  return userId !== undefined ? `scenario_copy:user:${userId}` : `scenario_copy:ip:${req.ip}`;
}

export default async function route(
  app: FastifyInstance,
  /** Test seam: a hand-rolled store port. Production resolves the service-role singleton lazily, per request. */
  deps?: { readonly store?: GuestCopyStorePort },
): Promise<void> {
  const resolveStore = (): GuestCopyStorePort => deps?.store ?? getGuestCopyStore();
  const RATE_LIMIT_MAX = resolveCeeRateLimit('CEE_SCENARIO_COPY_RATE_LIMIT_RPM');

  app.post<{ Params: { scenario_id: string } }>(
    SCENARIO_COPY_PATH,
    {
      // JWT FIRST: this route-level hook is in place before the limiter attaches its own `preHandler`, so it runs first.
      preHandler: async (req, reply) => {
        const header = req.headers.authorization;
        const token = typeof header === 'string' && header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
        if (token === '') {
          return refuse(reply, req, 401, 'sign_in_required', 'Sign in to keep this decision in your account.');
        }
        const verified = await verifySupabaseUserJwt(token);
        if (!verified.ok) {
          return refuse(
            reply, req, 401, verified.reason,
            verified.reason === 'expired_token' ? 'Your session has expired. Sign in again and retry.' : 'That token could not be verified.',
          );
        }
        verifiedUserOf.set(req, verified.userId);
      },
      config: {
        rateLimit: { max: RATE_LIMIT_MAX, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: scenarioCopyRateKey },
      },
    },
    async (req, reply) => {
      const userId = verifiedUserOf.get(req);
      if (userId === undefined) {
        // Unreachable: the preHandler either set it or answered 401. Refuse rather than act without an owner.
        return refuse(reply, req, 401, 'sign_in_required', 'Sign in to keep this decision in your account.');
      }

      const sourceId = req.params.scenario_id;
      // A malformed id is not a scenario either: the same 404 bytes, never a distinct 400.
      if (!UUID_RE.test(sourceId)) {
        const [status, code, message] = REFUSAL_REPLY.not_copyable;
        return refuse(reply, req, status, code, message);
      }

      let outcome;
      try {
        outcome = await resolveStore().copyGuestScenario(sourceId, userId);
      } catch (err) {
        log.warn({ event: 'scenario_guest_copy.store_failed', request_id: getRequestId(req), error: err instanceof Error ? err.message : String(err) }, 'guest copy store failed');
        return refuse(reply, req, 503, 'copy_unavailable', 'Your decision could not be copied just now. Try again shortly.');
      }
      if (outcome.kind === 'refused') {
        const [status, code, message] = REFUSAL_REPLY[outcome.reason];
        log.info({ event: 'scenario_guest_copy.refused', request_id: getRequestId(req), reason: outcome.reason }, 'guest copy refused');
        return refuse(reply, req, status, code, message);
      }
      log.info({ event: 'scenario_guest_copy.copied', request_id: getRequestId(req), created: outcome.created }, 'guest copy');
      return reply.code(200).send({ scenario_id: outcome.scenarioId, created: outcome.created });
    },
  );
}
