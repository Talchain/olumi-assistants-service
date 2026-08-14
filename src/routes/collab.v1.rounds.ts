/**
 * COLLAB U-S0 — OWNER routes (seam pinned by contracts.ts:83).
 *
 *   POST /collab/v1/rounds                        → mint a round + participants
 *   POST /collab/v1/rounds/:round_id/close        → close it; reveal becomes possible
 *   GET  /collab/v1/rounds/:round_id/preview      → roster + targets, NO beliefs
 *   GET  /collab/v1/rounds/:round_id/reveal       → post-close, everyone's answers
 *   GET  /collab/v1/rounds/:round_id/disagreement → post-close, WHERE and HOW they differ
 *
 * Reachable from the browser via the `/bff/collab/*` edge function, which
 * rewrites to this prefix — see `route-support.ts`.
 *
 * ── AUTH: THE UNCONDITIONAL-JWT PATTERN, COPIED DELIBERATELY ──────────────
 * User identity is verified HERE, ALWAYS, from `Authorization: Bearer <supabase
 * access token>`, and is DELIBERATELY INDEPENDENT of `CEE_REQUIRE_USER_JWT`.
 * That flag gates the turn path, whose identity is otherwise a claimed header.
 * Opening a round names real people and pins a version of someone's model; it
 * must never be writable on a claimed identity. There is no configuration in
 * which these endpoints trust a header.
 *
 * The `aud` guard inside `verifySupabaseUserJwt` is load-bearing: the project's
 * `anon` and `service_role` API keys are themselves HS256 JWTs on the SAME
 * secret, and only the `authenticated` audience separates a real user token
 * from them. `extractJwtSub` is decode-only and must never be used here.
 *
 * ⚠ A PARTICIPANT TOKEN GRANTS NOTHING ON THESE ROUTES. It is not consulted at
 * all: the only credential these handlers read is the owner's verified JWT.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { assembleDisagreementView } from '../collab/disagreement-read-model.js';
import { mintParticipantToken } from '../collab/participant-tokens.js';
import { assembleRevealView } from '../collab/packet-read-model.js';
import { closeRound, mintRound, ownerPreview } from '../collab/rounds-service.js';
import { getCollabStore } from '../collab/store.js';
import {
  collabPaths,
  replyForRefusal,
  resolveInjectedStore,
  sendRefusal,
} from '../collab/route-support.js';
import type { CollabStore, PacketTarget } from '../collab/types.js';
import { verifySupabaseUserJwt } from '../utils/supabase-user-jwt.js';
import { emit, TelemetryEvents } from '../utils/telemetry.js';

interface RoundParams {
  round_id?: string;
}

function roundIdOf(req: FastifyRequest): string {
  const params = req.params as RoundParams | undefined;
  const id = params?.round_id;
  return typeof id === 'string' ? id : '';
}

function asRecord(x: unknown): Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : {};
}

/**
 * Verify the owner's Supabase access token. ALWAYS-ON. Sends the 401 and
 * returns null on failure — callers must return immediately.
 */
async function requireOwnerUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const header = req.headers.authorization;
  const token =
    typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : '';
  if (token === '') {
    sendRefusal(
      reply,
      req,
      401,
      'sign_in_required',
      'Opening or closing a round is owner-only: sign in and retry.',
    );
    return null;
  }
  const result = await verifySupabaseUserJwt(token);
  if (!result.ok) {
    sendRefusal(
      reply,
      req,
      401,
      result.reason,
      result.reason === 'expired_token'
        ? 'Your session has expired. Sign in again and retry.'
        : 'That token could not be verified.',
    );
    return null;
  }
  return result.userId;
}

/** Parse the owner-supplied target manifest. Strict: no value-bearing fields. */
function parseTargets(raw: unknown): PacketTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const t = asRecord(item);
    const target = asRecord(t.target);
    return {
      target: {
        kind: target.kind === 'edge' ? ('edge' as const) : ('factor' as const),
        id: typeof target.id === 'string' ? target.id : '',
      },
      label: typeof t.label === 'string' ? t.label : '',
      description: typeof t.description === 'string' ? t.description : null,
      unit: typeof t.unit === 'string' ? t.unit : null,
      // ⚠ NOTE THE ABSENCE: no value / prior / model_value is read from the
      // owner's payload, so the owner cannot seed an anchor into the packet
      // even by mistake. Blindness item 2 holds at the intake, not only at the
      // read model.
    };
  });
}

export default async function route(
  app: FastifyInstance,
  deps?: { readonly store?: CollabStore },
): Promise<void> {
  const resolveStore = (): CollabStore =>
    deps?.store ?? resolveInjectedStore(app) ?? getCollabStore();

  // ── MINT ─────────────────────────────────────────────────────────────────
  for (const path of collabPaths('/rounds')) {
    app.post(path, async (req, reply) => {
      const userId = await requireOwnerUser(req, reply);
      if (userId === null) return reply;

      const body = asRecord(req.body);
      const scenarioId = typeof body.scenario_id === 'string' ? body.scenario_id.trim() : '';
      if (scenarioId === '') {
        return sendRefusal(reply, req, 400, 'invalid_scenario_id', 'scenario_id is required.');
      }
      const store = resolveStore();
      const actor = { kind: 'owner' as const, user_id: userId };

      try {
        const round = await mintRound(store, {
          scenario_id: scenarioId,
          actor,
          target_manifest: parseTargets(body.targets),
          context_note: typeof body.context_note === 'string' ? body.context_note : null,
        });

        // Mint the panel. The RAW tokens are returned EXACTLY ONCE, to the owner
        // who is about to hand out the links. Nothing persists them and there is
        // no read-back route: a lost link is re-minted, never recovered.
        const names = Array.isArray(body.participants) ? body.participants : [];
        const panel: Array<{ participant_id: string; display_name: string; token: string }> = [];
        for (const entry of names) {
          const p = asRecord(entry);
          const displayName = typeof p.display_name === 'string' ? p.display_name : '';
          const minted = await mintParticipantToken(store, {
            round_id: round.round_id,
            scenario_id: scenarioId,
            display_name: displayName,
            supabase_user_id:
              typeof p.supabase_user_id === 'string' ? p.supabase_user_id : null,
            actor,
          });
          panel.push({
            participant_id: minted.participant.participant_id,
            display_name: minted.participant.display_name,
            token: minted.token,
          });
        }

        return reply.code(201).send({
          round_id: round.round_id,
          scenario_id: round.scenario_id,
          status: round.status,
          // The EXPLICIT version this round is pinned to (ROADMAP 2.910).
          graph_version_ref: round.graph_version_ref,
          context_note: round.context_note,
          targets: round.target_manifest,
          participants: panel,
        });
      } catch (err) {
        emit(TelemetryEvents.V5CollabWriteRefused, {
          code: (err as { code?: string })?.code ?? 'unknown',
          surface: 'round_mint',
        });
        return replyForRefusal(reply, req, err);
      }
    });
  }

  // ── CLOSE ────────────────────────────────────────────────────────────────
  for (const path of collabPaths('/rounds/:round_id/close')) {
    app.post(path, async (req, reply) => {
      const userId = await requireOwnerUser(req, reply);
      if (userId === null) return reply;
      const store = resolveStore();
      try {
        await closeRound(store, {
          round_id: roundIdOf(req),
          actor: { kind: 'owner', user_id: userId },
        });
        return reply.code(200).send({ round_id: roundIdOf(req), status: 'closed' });
      } catch (err) {
        emit(TelemetryEvents.V5CollabWriteRefused, {
          code: (err as { code?: string })?.code ?? 'unknown',
          surface: 'round_close',
        });
        return replyForRefusal(reply, req, err);
      }
    });
  }

  // ── PREVIEW (pre-close: roster only, deliberately no beliefs) ────────────
  for (const path of collabPaths('/rounds/:round_id/preview')) {
    app.get(path, async (req, reply) => {
      const userId = await requireOwnerUser(req, reply);
      if (userId === null) return reply;
      const store = resolveStore();
      try {
        const preview = await ownerPreview(store, {
          round_id: roundIdOf(req),
          actor: { kind: 'owner', user_id: userId },
        });
        return reply.code(200).send(preview);
      } catch (err) {
        return replyForRefusal(reply, req, err);
      }
    });
  }

  // ── REVEAL (owner view; refuses while the round is open, like everyone) ──
  for (const path of collabPaths('/rounds/:round_id/reveal')) {
    app.get(path, async (req, reply) => {
      const userId = await requireOwnerUser(req, reply);
      if (userId === null) return reply;
      const store = resolveStore();
      try {
        const view = await assembleRevealView(store, {
          round_id: roundIdOf(req),
          requested_by: { kind: 'owner', user_id: userId },
        });
        return reply.code(200).send(view);
      } catch (err) {
        return replyForRefusal(reply, req, err);
      }
    });
  }

  // ── DISAGREEMENT (post-close: WHERE views differ, and on what basis) ─────
  //
  // ⚠ SAME GATE AS THE REVEAL, INHERITED RATHER THAN RESTATED. The refusal
  // comes from `assembleRevealView` inside the projection, so there is no
  // second open-round check here that could drift and let this endpoint become
  // an early peek at a blind round.
  for (const path of collabPaths('/rounds/:round_id/disagreement')) {
    app.get(path, async (req, reply) => {
      const userId = await requireOwnerUser(req, reply);
      if (userId === null) return reply;
      const store = resolveStore();
      try {
        const view = await assembleDisagreementView(store, {
          round_id: roundIdOf(req),
          requested_by: { kind: 'owner', user_id: userId },
        });
        return reply.code(200).send(view);
      } catch (err) {
        return replyForRefusal(reply, req, err);
      }
    });
  }
}
