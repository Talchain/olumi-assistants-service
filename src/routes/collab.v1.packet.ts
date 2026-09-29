/**
 * COLLAB U-S0 — PARTICIPANT routes (seam pinned by contracts.ts:84).
 *
 *   GET  /collab/v1/packet/:round_id              → the blind packet
 *   POST /collab/v1/packet/:round_id/events       → contribute a belief, or attach evidence
 *   GET  /collab/v1/packet/:round_id/reveal       → post-close, everyone's answers
 *   GET  /collab/v1/packet/:round_id/disagreement → post-close, WHERE and HOW they differ
 *
 * ⚠ EVIDENCE RIDES `/events`, IT DID NOT GET AN ENDPOINT OF ITS OWN. Attaching
 * evidence is a participant appending an attributed, append-only, round-scoped,
 * target-bound row — the same act with the same authorisation and the same
 * blindness properties as submitting a belief. A second endpoint would have been
 * a second copy of the token check, the revocation re-read and the round-open
 * gate, i.e. three more places for this path to disagree with the first about
 * who may write. The append seam splits on `kind` INSIDE the one door.
 *
 * Reachable from the browser via the `/bff/collab/*` edge function, which
 * rewrites to this prefix — see `route-support.ts`.
 *
 * ── AUTHORISATION ─────────────────────────────────────────────────────────
 * The participant token, and ONLY the participant token, resolves identity
 * here. Specifically NOT:
 *   • `Origin` — origin gating is a CORS control, not authentication. A forged
 *     Origin reaches request validation on this service, measured. Every route
 *     below therefore does its own token check and would refuse an attacker who
 *     had cleared the edge.
 *   • `x-user-id` — a claimed header.
 *   • A decoded-but-unverified JWT `sub`.
 *
 * ── EVERY REFUSAL ON THE TOKEN PATH ANSWERS THE SAME BYTES ────────────────
 * 401 + `collab_token_invalid` + one constant message, for missing / forged /
 * revoked / unknown-round / not-a-participant alike. Anything else lets a
 * caller enumerate rounds by reading the difference.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { assembleDisagreementView } from '../collab/disagreement-read-model.js';
import { appendParticipantEvent } from '../collab/elicitation-append.js';
import { assembleOpenPacket, assembleRevealView } from '../collab/packet-read-model.js';
import { verifyParticipantToken } from '../collab/participant-tokens.js';
import { getCollabStore } from '../collab/store.js';
import {
  collabPaths,
  readParticipantToken,
  replyForRefusal,
  resolveInjectedStore,
  sendTokenRefusal,
} from '../collab/route-support.js';
import type { CollabParticipant, CollabStore } from '../collab/types.js';
import { emit, TelemetryEvents } from '../utils/telemetry.js';

interface RoundParams {
  round_id?: string;
}

function roundIdOf(req: FastifyRequest): string {
  const params = req.params as RoundParams | undefined;
  const id = params?.round_id;
  return typeof id === 'string' ? id : '';
}

export default async function route(
  app: FastifyInstance,
  deps?: { readonly store?: CollabStore },
): Promise<void> {
  const resolveStore = (): CollabStore =>
    deps?.store ?? resolveInjectedStore(app) ?? getCollabStore();

  /**
   * Resolve the caller, or send the one-and-only token refusal.
   *
   * ⚠ Returns null AFTER replying. Callers must return immediately — a handler
   * that continued would run the service with no identity.
   */
  async function requireParticipant(
    req: FastifyRequest,
    reply: FastifyReply,
    store: CollabStore,
  ): Promise<CollabParticipant | null> {
    const token = readParticipantToken(req);
    const roundId = roundIdOf(req);
    if (token === '' || roundId === '') {
      sendTokenRefusal(reply, req);
      return null;
    }
    try {
      return await verifyParticipantToken(store, { round_id: roundId, token });
    } catch {
      // Deliberately swallows the SERVICE-grain distinction (invalid vs revoked
      // vs unknown round). That distinction is real and is tested at the service
      // grain; surfacing it here would be the oracle.
      sendTokenRefusal(reply, req);
      return null;
    }
  }

  for (const path of collabPaths('/packet/:round_id')) {
    app.get(path, async (req, reply) => {
      const store = resolveStore();
      const participant = await requireParticipant(req, reply, store);
      if (participant === null) return reply;
      try {
        // The blind packet. Everything withheld is withheld inside here, by the
        // shape of the queries it is allowed to make.
        const packet = await assembleOpenPacket(store, {
          round_id: roundIdOf(req),
          participant_id: participant.participant_id,
        });
        return reply.code(200).send(packet);
      } catch (err) {
        return replyForRefusal(reply, req, err);
      }
    });
  }

  for (const path of collabPaths('/packet/:round_id/events')) {
    app.post(path, async (req, reply) => {
      const store = resolveStore();
      const participant = await requireParticipant(req, reply, store);
      if (participant === null) return reply;
      try {
        const row = await appendParticipantEvent(store, {
          round_id: roundIdOf(req),
          participant,
          // Raw body. The append seam validates it against a STRICT key
          // allowlist, which is what refuses smuggled provenance and
          // graph-mutation-shaped payloads alike.
          payload: req.body as never,
        });
        // The receipt names what was recorded and WHO it is attributed to, so a
        // client cannot quietly believe it authored something it did not.
        return reply.code(201).send({
          event_id: row.event_id,
          round_id: row.round_id,
          target: row.target,
          kind: row.kind,
          event_version: row.event_version,
          authored_by: row.provenance.authored_by,
          created_at: row.created_at,
        });
      } catch (err) {
        // One frozen, pre-minted observability name. Records THAT a write was
        // refused and its code — never the token, never the belief.
        emit(TelemetryEvents.V5CollabWriteRefused, {
          code: (err as { code?: string })?.code ?? 'unknown',
          surface: 'participant_event',
        });
        return replyForRefusal(reply, req, err);
      }
    });
  }

  for (const path of collabPaths('/packet/:round_id/reveal')) {
    app.get(path, async (req, reply) => {
      const store = resolveStore();
      const participant = await requireParticipant(req, reply, store);
      if (participant === null) return reply;
      try {
        const view = await assembleRevealView(store, {
          round_id: roundIdOf(req),
          requested_by: { kind: 'participant', participant_id: participant.participant_id },
        });
        return reply.code(200).send(view);
      } catch (err) {
        return replyForRefusal(reply, req, err);
      }
    });
  }

  // ── DISAGREEMENT ─────────────────────────────────────────────────────────
  //
  // ⭐ PARTICIPANTS GET THIS TOO, AND THAT IS THE COLLABORATION POINT rather
  // than a permissions oversight. Interrogating why two people differ is
  // something they do TOGETHER; a view of the disagreement available only to
  // the owner would make it a management report about a team rather than a
  // shared surface for that team. It exposes nothing new to a participant —
  // they already receive the full reveal, and evidence is what they wrote.
  //
  // Same gate as the reveal, inherited from `assembleRevealView` inside the
  // projection rather than restated here.
  for (const path of collabPaths('/packet/:round_id/disagreement')) {
    app.get(path, async (req, reply) => {
      const store = resolveStore();
      const participant = await requireParticipant(req, reply, store);
      if (participant === null) return reply;
      try {
        const view = await assembleDisagreementView(store, {
          round_id: roundIdOf(req),
          requested_by: { kind: 'participant', participant_id: participant.participant_id },
        });
        return reply.code(200).send(view);
      } catch (err) {
        return replyForRefusal(reply, req, err);
      }
    });
  }
}
