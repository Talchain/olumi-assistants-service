/**
 * COLLAB U-S0 — shared route support: store resolution, refusal envelope, and
 * the single path every collab route is mounted at.
 *
 * ── ⚠ WHY THE PINNED PREFIX WAS DARK (A CORRECTED PREMISE) ────────────────
 * The seam contract pins the canonical paths `/collab/v1/...`, and the N-suite
 * injects exactly those against a bare Fastify instance. But NO existing
 * browser→CEE path reaches a CEE route under `/collab/v1/`:
 *
 *   • `/bff/cee/*`         → rewritten to `/assist/v1/*`
 *   • `/bff/orchestrate/*` → rewritten to CEE `/orchestrate/*`
 *   • `VITE_V5_ENDPOINT`   → a DIRECT cross-origin call pinned to the single
 *                            `/proxy/v5/turn` route family
 *
 * (Manifest scope: UI `netlify.toml` edge-function + redirect declarations, and
 * a sweep of `ui/src/**` for absolute CEE hosts, at UI `538677ff`.)
 *
 * NONE of the three maps to `/collab/v1/*`. So a route registered at its pinned
 * path was registered and unreachable — green in every test in both repos, and
 * dark for every user. The fix is a FOURTH seam that maps to it:
 * `netlify/edge-functions/collab-proxy.ts`, `/bff/collab/*` → `/collab/v1/*`,
 * forwarding the participant token header and injecting the caller key exactly
 * as its three siblings do. NO new public CEE route, NO CEE CORS entry, NO CSP
 * change, NO Render dashboard dependency.
 *
 * ── AND WHY THAT DOES NOT WEAKEN THE AUTH POSTURE ─────────────────────────
 * `/collab/v1/*` is NOT in the auth plugin's public-route list, so it stays
 * caller-authenticated by the service key, which the new edge function injects
 * server-side. A participant request therefore carries TWO independent
 * credentials: the injected caller key (proving it came through our own front
 * door) and their participant token (proving who they are). Neither substitutes
 * for the other, and `Origin` is not treated as either — a forged Origin reaches
 * validation on this service, measured, and still meets the token check.
 *
 * ⚠ IF a public-route carve-out is ever taken, it must be `/collab/v1/packet`
 * and NEVER `/collab`: the matcher is `path.startsWith(route + "/")`, so
 * `/collab` would silently un-authenticate the owner mint/close routes too.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { getOrGenerateRequestId } from '../utils/request-id.js';
import { isCollabRefusal, type CollabRefusalCode, type CollabStore } from './types.js';

/** The header the participant capability travels in (contract F-3). */
export const COLLAB_TOKEN_HEADER = 'x-collab-participant-token';

/** The single, contract-pinned prefix. */
export const COLLAB_V1_PREFIX = '/collab/v1';

/**
 * The one path each route mounts at.
 *
 * ⚠ EXACTLY ONE. An earlier draft also aliased every route under
 * `/assist/v1/collab/*` to reach the browser through the existing `/bff/cee/*`
 * seam. That is withdrawn: a dedicated `/bff/collab/*` edge function reaches
 * `/collab/v1/*` directly, which adds no second CEE surface to reason about and
 * no second place an auth posture could drift. Two entrances to one room is one
 * entrance too many when the room is a privacy boundary.
 */
export function collabPaths(suffix: string): readonly [string] {
  return [`${COLLAB_V1_PREFIX}${suffix}`];
}

export interface CollabRefusalBody {
  readonly error: string;
  readonly code: string;
  readonly message: string;
  readonly request_id: string;
}

/**
 * ⚠ THE ROUTE GRAIN IS NOT AN EXISTENCE ORACLE (contract F-4).
 *
 * Missing token, forged token, revoked token, unknown round and
 * not-a-participant ALL answer 401 with the SAME code and the SAME generic
 * message. The service grain distinguishes them for the operator; the boundary
 * does not, because a caller who can tell "wrong token" from "no such round"
 * can enumerate rounds.
 *
 * The message is a CONSTANT. It must never interpolate the round id, a
 * participant id, or a scenario id — the N-suite scans the refusal body for
 * exactly those.
 */
const TOKEN_REFUSAL_MESSAGE =
  'That link is not valid. Ask whoever invited you for a fresh one.';

const TOKEN_FAMILY: readonly CollabRefusalCode[] = [
  'collab_token_invalid',
  'collab_token_revoked',
  'collab_not_a_participant',
];

export function sendRefusal(
  reply: FastifyReply,
  req: FastifyRequest,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  const body: CollabRefusalBody = {
    error: code,
    code,
    message,
    request_id: getOrGenerateRequestId(req),
  };
  return reply.code(status).send(body);
}

export function sendTokenRefusal(reply: FastifyReply, req: FastifyRequest): FastifyReply {
  return sendRefusal(reply, req, 401, 'collab_token_invalid', TOKEN_REFUSAL_MESSAGE);
}

/**
 * Map a thrown service refusal onto the HTTP boundary.
 *
 * Anything that is NOT a typed refusal is re-thrown to Fastify's error handler:
 * an unexpected error must not be laundered into a tidy 4xx that looks like a
 * decision we made.
 */
export function replyForRefusal(
  reply: FastifyReply,
  req: FastifyRequest,
  err: unknown,
): FastifyReply {
  if (!isCollabRefusal(err)) throw err;

  if (TOKEN_FAMILY.includes(err.code)) {
    return sendTokenRefusal(reply, req);
  }
  switch (err.code) {
    case 'collab_owner_only':
      return sendRefusal(reply, req, 403, err.code, err.message);
    case 'collab_round_closed':
    case 'collab_round_open':
    case 'collab_owner_unsubmitted':
    case 'collab_guest_scenario':
      return sendRefusal(reply, req, 409, err.code, err.message);
    case 'collab_payload_invalid':
      return sendRefusal(reply, req, 422, err.code, err.message);
    default:
      return sendRefusal(reply, req, 400, err.code, err.message);
  }
}

/** Read the participant token header. Never logged, never echoed. */
export function readParticipantToken(req: FastifyRequest): string {
  const raw = req.headers[COLLAB_TOKEN_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve the store: the `app.collabStore` decoration when a caller injected one
 * (tests, and any future in-process composition), otherwise the production
 * Supabase-backed store, constructed LAZILY.
 *
 * ⚠ Lazy by design, mirroring the decision-records and model-management stores:
 * importing a route module must never require SUPABASE_* to be set, or the
 * service cannot boot in any context that does not use this feature. This is
 * also what makes the CEE half safe to deploy BEFORE the migration runs —
 * nothing touches the new tables until a request arrives.
 */
export type CollabStoreHolder = { collabStore?: CollabStore };

export function resolveInjectedStore(app: unknown): CollabStore | null {
  const holder = app as CollabStoreHolder | null;
  const injected = holder?.collabStore;
  return injected !== undefined && injected !== null ? injected : null;
}
