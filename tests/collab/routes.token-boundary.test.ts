/**
 * 2.909 N-suite — ROUTE-GRAIN TOKEN BOUNDARY — RED pre-DDL by construction.
 *
 * The HTTP boundary of the participant capability (F-3/F-4): token transport
 * is the `x-collab-participant-token` header; missing/forged tokens and
 * unknown rounds answer the SAME refusal (no existence oracle — the
 * scenario-graph route's "every refusal answers the same bytes" discipline);
 * a participant token is worthless on owner routes.
 *
 * Contract F-1 (route testability): collab route modules are default-export
 * async registrars (repo convention), registrable on a BARE Fastify instance,
 * and read their store from the `app.collabStore` decoration when present —
 * absent owner/service auth context they refuse, never crash.
 *
 * RED signature today (every test): "RED (pre-DDL): seam not implemented:
 * src/routes/collab.v1.packet.ts" (collab.v1.rounds.ts for N-R3).
 */
import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  importSeam,
  seededOpenRoundStore,
  type FixtureCollabStore,
  FIXTURE_ROUND_ID,
  SENTINELS,
  jsonContains,
} from "./contracts.js";

type RouteModule = { default: (app: FastifyInstance) => Promise<void> };

async function appWithRoute(seam: "src/routes/collab.v1.packet.ts" | "src/routes/collab.v1.rounds.ts", store: FixtureCollabStore): Promise<FastifyInstance> {
  const mod = await importSeam<RouteModule>(seam);
  const app = Fastify({ logger: false });
  app.decorate("collabStore", store);
  await app.register(mod.default);
  await app.ready();
  return app;
}

describe("N-R route-grain token boundary (F-3/F-4)", () => {
  it("N-R1: packet GET without a token → 401 collab_token_invalid; the refusal leaks no round/scenario/participant detail", async () => {
    const store = seededOpenRoundStore();
    const app = await appWithRoute("src/routes/collab.v1.packet.ts", store);
    try {
      const res = await app.inject({
        method: "GET",
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}`,
      });
      expect(res.statusCode).toBe(401);
      const body = res.json() as { code?: string };
      expect(body.code).toBe("collab_token_invalid");
      expect(jsonContains(body, FIXTURE_ROUND_ID)).toBe(false);
      expect(jsonContains(body, SENTINELS.A_PARTICIPANT_ID)).toBe(false);
      expect(jsonContains(body, SENTINELS.B_PARTICIPANT_ID)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("N-R2: forged token on a REAL round and a well-formed token on an UNKNOWN round answer the SAME status + code — no existence oracle", async () => {
    const store = seededOpenRoundStore();
    const app = await appWithRoute("src/routes/collab.v1.packet.ts", store);
    try {
      const forgedOnReal = await app.inject({
        method: "GET",
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}`,
        headers: { "x-collab-participant-token": "f".repeat(32) },
      });
      const tokenOnUnknown = await app.inject({
        method: "GET",
        url: "/collab/v1/packet/round-that-does-not-exist",
        headers: { "x-collab-participant-token": "f".repeat(32) },
      });
      expect(forgedOnReal.statusCode).toBe(401);
      expect(tokenOnUnknown.statusCode).toBe(401);
      const a = forgedOnReal.json() as { code?: string };
      const b = tokenOnUnknown.json() as { code?: string };
      expect(a.code).toBe("collab_token_invalid");
      expect(b.code).toBe(a.code);
      // Neither body distinguishes the cases by naming what exists.
      expect(jsonContains(a, FIXTURE_ROUND_ID)).toBe(false);
      expect(jsonContains(b, "round-that-does-not-exist")).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("N-R3: a participant token grants NOTHING on owner routes — close refuses without owner auth, no transition lands, and the event POST rejects graph-mutation-shaped payloads (INV-B)", async () => {
    const store = seededOpenRoundStore();
    const roundsApp = await appWithRoute("src/routes/collab.v1.rounds.ts", store);
    try {
      const res = await roundsApp.inject({
        method: "POST",
        url: `/collab/v1/rounds/${FIXTURE_ROUND_ID}/close`,
        headers: { "x-collab-participant-token": "f".repeat(32) },
      });
      expect([401, 403]).toContain(res.statusCode);
      expect(store.state.roundEvents).toEqual([]);
      expect((await store.getRound(FIXTURE_ROUND_ID))?.status).toBe("open");
    } finally {
      await roundsApp.close();
    }

    // INV-B at the route: a mutation-shaped payload through the packet event
    // POST is refused loud — participants have NO path to the canonical graph.
    const packetApp = await appWithRoute("src/routes/collab.v1.packet.ts", store);
    try {
      const res = await packetApp.inject({
        method: "POST",
        url: `/collab/v1/packet/${FIXTURE_ROUND_ID}/events`,
        headers: { "x-collab-participant-token": "f".repeat(32) },
        payload: {
          kind: "belief_submitted",
          target: { kind: "factor", id: "factor-churn-risk" },
          belief: { value: 0.5, expression_raw: "even", confidence: 0.5 },
          graph: { nodes: [], edges: [] },
          operations: [{ op: "set_factor_value", value: 0.99 }],
        },
      });
      expect([400, 401, 403, 422]).toContain(res.statusCode);
      expect(store.state.events.filter((e) => e.participant_id !== SENTINELS.B_PARTICIPANT_ID)).toEqual([]);
    } finally {
      await packetApp.close();
    }
  });
});
