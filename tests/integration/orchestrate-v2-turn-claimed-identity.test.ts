/**
 * `/orchestrate/v2/turn` — A SHARED-KEY CALLER MAY NOT NAME THE USER IT ACTS AS.
 *
 * ── THE WITNESSED DEFECT (staging, 28 Aug 2026) ────────────────────────────
 * `POST /bff/orchestrate/v2/turn`, anonymous (no Authorization header), body
 * `{scenario_id: <A's>, user_id: <A's sub>}` → HTTP 200, and a full ~6.5 s LLM
 * turn ran on user A's OWNED scenario. The discriminating control — the same
 * request with a DIFFERENT `user_id` — returned 422
 * `scenario_owned_by_other_user` in ~260 ms, so the acceptance was
 * specifically the ownership hole and not a generally permissive route.
 *
 * Mechanism: `authorizeScenarioOwnership` starts `effectiveUserId =
 * claimedUserId` and only overwrites it from the verified JWT subject when
 * `identity.mode === 'verified'`. With `CEE_REQUIRE_USER_JWT` off (staging
 * today) the mode is `off` for everyone, so the caller-supplied body `user_id`
 * WAS the ownership authority. The edge injected the shared assist key
 * server-side, so an anonymous browser inherited a full-trust service
 * credential and could act as any user it could name.
 *
 * The browser-reachable half is closed at the edge (UI #927). This suite pins
 * the CEE half, so the hole cannot be re-inherited by a future edge route, a
 * new proxy, or anything else that holds the shared key.
 *
 * ── WHY THIS SUITE USES THE REAL SERVER, NOT A BARE FASTIFY ────────────────
 * The rule is "only a VERIFIED HMAC caller may assert an identity", and
 * `hmacAuth` is computed by `plugins/auth.ts`. A bare `Fastify()` with only the
 * route registered has no auth plugin, so it CANNOT tell an admissible caller
 * from an inadmissible one — it would pass for the wrong reason. `build()` runs
 * the real auth hooks, which is the only way case 2 below is meaningful at all.
 *
 * ── THE PAIR THAT MAKES THIS A BINDING, NOT A LOCKOUT ──────────────────────
 * A refusal test alone cannot distinguish a fix from a blanket denial. Every
 * refusal here is paired with a caller that MUST still succeed:
 *   refused  — assist key naming the owner            (case 1)
 *   refused  — assist key + forged empty signature    (case 2)
 *   ALLOWED  — verified HMAC naming the same owner    (case 3)
 *   ALLOWED  — assist key on a GUEST scenario         (case 4)
 * Cases 3 and 4 are green BEFORE and AFTER the fix. If a future change makes
 * them red, it has over-corrected into a lockout, and this file says so.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHash, createHmac, randomUUID } from "node:crypto";

const ASSIST_KEY = "claimed-identity-assist-key";
const HMAC_SECRET = "claimed-identity-hmac-secret";

vi.stubEnv("LLM_PROVIDER", "fixtures");
vi.stubEnv("ASSIST_API_KEY", ASSIST_KEY);
vi.stubEnv("ASSIST_API_KEYS", ASSIST_KEY);
vi.stubEnv("HMAC_SECRET", HMAC_SECRET);
// Staging's posture, and the posture the defect was witnessed under.
vi.stubEnv("CEE_REQUIRE_USER_JWT", "false");

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCENARIO_OWNED = "e0000000-0000-4000-8000-0000000000a1";
const SCENARIO_GUEST = "e0000000-0000-4000-8000-0000000000a2";

/** scenario_id → authoritative owner (null = guest/unowned). */
const rows = new Map<string, string | null>();

/** Records what the ownership oracle was actually asked, per request. */
const ensureCalls: Array<{ scenarioId: string; userId: string | null }> = [];

vi.mock("../../src/orchestrator-v5/session/index.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/orchestrator-v5/session/index.js")>();
  const { createMockSessionStore } = await import("../utils/mock-session-store.js");
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: async () => ({ id: "mock-row-id" }),
        ensureScenarioExists: async (
          scenarioId: string,
          userId: string | null,
        ): Promise<{ user_id: string | null }> => {
          ensureCalls.push({ scenarioId, userId });
          const existing = rows.get(scenarioId);
          if (existing !== undefined) return { user_id: existing };
          rows.set(scenarioId, userId);
          return { user_id: userId };
        },
      }),
    resetSessionStoreForTests: () => {},
  };
});

const mockAdapter = {
  name: "claimed-identity-mock",
  chat: async () => ({
    content: "ok",
    usage: { input_tokens: 1, output_tokens: 1 },
    model: "claimed-identity-mock",
    latencyMs: 0,
  }),
  chatWithTools: async () => ({
    content: [{ type: "text", text: "claimed-identity happy path" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
    model: "claimed-identity-mock",
    latencyMs: 0,
  }),
};
// importOriginal-spread rather than a hand-listed surface (CLAUDE.md trap 12):
// a bare factory REPLACES the module, so every export this suite does not name
// disappears — and `build()` reaches for several of them at startup. Spreading
// the original means a new export cannot silently break this file.
vi.mock("../../src/adapters/llm/router.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/adapters/llm/router.js")>();
  return {
    ...original,
    getAdapter: () => mockAdapter,
    getAdapterWithResolution: (task?: string) => ({
      adapter: mockAdapter,
      resolution: {
        task: task ?? "orchestrator",
        resolved_model: "claimed-identity-mock",
        resolution_source: "task_default" as const,
      },
    }),
  };
});
vi.mock("../../src/adapters/llm/prompt-loader.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/adapters/llm/prompt-loader.js")>();
  return { ...original, getSystemPrompt: async () => "test system prompt" };
});

const { build } = await import("../../src/server.js");

const TURN_URL = "/orchestrate/v2/turn";

function turnBody(scenarioId: string, userId?: string) {
  return {
    kind: "message" as const,
    turn_id: randomUUID(),
    scenario_id: scenarioId,
    message: "claimed-identity suite turn",
    turn_class: "frame" as const,
    stage: "analyse" as const,
    source: "composer" as const,
    ...(userId !== undefined ? { user_id: userId } : {}),
  };
}

/** A genuine HMAC caller: signs METHOD\nPATH\nTS\nNONCE\nSHA256(body). */
function hmacHeaders(method: string, path: string, body: string) {
  const ts = Date.now().toString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`;
  return {
    "x-olumi-signature": createHmac("sha256", HMAC_SECRET).update(canonical).digest("hex"),
    "x-olumi-timestamp": ts,
    "x-olumi-nonce": nonce,
    "content-type": "application/json",
  };
}

/**
 * The reason carried by a pre-flight refusal, or null when the turn was
 * admitted. Read from the typed BoundaryError the route returns.
 */
function refusalReason(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as {
      validator?: string;
      details?: { reason?: string };
    };
    return parsed.validator === "scenario_preflight" ? (parsed.details?.reason ?? null) : null;
  } catch {
    return null;
  }
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await build();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  ensureCalls.length = 0;
  rows.clear();
  rows.set(SCENARIO_OWNED, OWNER);
  rows.set(SCENARIO_GUEST, null);
});

describe("/orchestrate/v2/turn — caller-asserted identity is inadmissible on a shared key", () => {
  // ── CASE 1 — THE WITNESSED EXPLOIT ────────────────────────────────────────
  // This is the request that returned 200 on staging. It must now be refused.
  //
  // Bound by IDENTITY, not by a value predicate: the assertion is that the
  // ownership oracle was asked about `null` — i.e. the claim was DISCARDED —
  // not merely that some refusal happened. A 422 for an unrelated reason
  // (schema drift, a bad turn id) would satisfy a status-only assertion while
  // leaving the hole wide open.
  it("REFUSES an assist-key caller that names the OWNER of an owned scenario", async () => {
    const res = await app.inject({
      method: "POST",
      url: TURN_URL,
      headers: { "x-olumi-assist-key": ASSIST_KEY, "content-type": "application/json" },
      payload: turnBody(SCENARIO_OWNED, OWNER),
    });

    expect(res.statusCode).toBe(422);
    expect(refusalReason(res.payload)).toBe("scenario_requires_authenticated_owner");

    // The claim never reached the ownership decision.
    expect(ensureCalls).toHaveLength(1);
    expect(ensureCalls[0]).toEqual({ scenarioId: SCENARIO_OWNED, userId: null });
  });

  // ── CASE 2 — THE CONTROL MUST NOT BE FORGEABLE BY ONE HEADER ──────────────
  // Before this PR, `plugins/auth.ts` computed
  //   hmacAuth = hasSignature !== undefined && config.auth.hmacSecret !== undefined
  // while the branch that defers to real HMAC verification tests TRUTHINESS.
  // An EMPTY `x-olumi-signature: ""` is falsy-but-defined: it skipped
  // verification entirely and still set the flag TRUE. Measured on the
  // pre-PR code, an assist-key request carrying that header emitted
  // `assist.auth.success ... hmac_auth:true`.
  //
  // Without this case, case 1 would pass while the control it depends on could
  // be reopened by adding one empty header — a control that reads as closed and
  // is not. That is the failure mode this file exists to prevent.
  it("REFUSES an assist-key caller that forges an EMPTY x-olumi-signature header", async () => {
    const res = await app.inject({
      method: "POST",
      url: TURN_URL,
      headers: {
        "x-olumi-assist-key": ASSIST_KEY,
        "x-olumi-signature": "",
        "content-type": "application/json",
      },
      payload: turnBody(SCENARIO_OWNED, OWNER),
    });

    expect(res.statusCode).toBe(422);
    expect(refusalReason(res.payload)).toBe("scenario_requires_authenticated_owner");
    expect(ensureCalls[0]).toEqual({ scenarioId: SCENARIO_OWNED, userId: null });
  });

  // ── CASE 3 — OVER-CORRECTION CONTROL: the documented carve-out SURVIVES ───
  // A genuinely HMAC-signed service caller is a identified service, not a
  // shared bearer token, and `user-identity.ts` documents that such a caller
  // may act on a user's behalf. It must still be able to.
  //
  // GREEN BEFORE AND AFTER. If this goes red, the change has become a lockout
  // rather than a binding, and the pairing with case 1 is what shows the
  // difference: same scenario, same claimed user, different caller.
  it("ALLOWS a VERIFIED HMAC caller naming the same owner (carve-out preserved)", async () => {
    const body = JSON.stringify(turnBody(SCENARIO_OWNED, OWNER));
    const res = await app.inject({
      method: "POST",
      url: TURN_URL,
      headers: hmacHeaders("POST", TURN_URL, body),
      payload: body,
    });

    expect(refusalReason(res.payload)).toBeNull();
    expect(res.statusCode).not.toBe(422);
    // The claim WAS honoured — the oracle was asked about the owner.
    expect(ensureCalls[0]).toEqual({ scenarioId: SCENARIO_OWNED, userId: OWNER });
  });

  // ── CASE 4 — OVER-CORRECTION CONTROL: guest scenarios are untouched ───────
  // Guest (unowned) scenarios are a product feature, and staging's real turn
  // traffic runs on them. Discarding an inadmissible claim must not disturb
  // the anonymous path. GREEN BEFORE AND AFTER.
  it("ALLOWS an assist-key caller on a GUEST scenario (unowned path unchanged)", async () => {
    const res = await app.inject({
      method: "POST",
      url: TURN_URL,
      headers: { "x-olumi-assist-key": ASSIST_KEY, "content-type": "application/json" },
      payload: turnBody(SCENARIO_GUEST),
    });

    expect(refusalReason(res.payload)).toBeNull();
    expect(ensureCalls[0]).toEqual({ scenarioId: SCENARIO_GUEST, userId: null });
  });

  // ── CASE 5 — the cross-tenant refusal is NOT the one doing the work ───────
  // The staging control returned `scenario_owned_by_other_user` for a
  // MISMATCHED claim, which already refused before this PR. Pinning that the
  // OWNER-claim case now answers a DIFFERENT reason
  // (`scenario_requires_authenticated_owner`) proves the new refusal comes from
  // the admissibility rule and not from the pre-existing mismatch check —
  // otherwise case 1 could pass for entirely the old reason.
  it("distinguishes the NEW refusal from the pre-existing cross-tenant one", async () => {
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const res = await app.inject({
      method: "POST",
      url: TURN_URL,
      headers: { "x-olumi-assist-key": ASSIST_KEY, "content-type": "application/json" },
      payload: turnBody(SCENARIO_OWNED, other),
    });

    expect(res.statusCode).toBe(422);
    // Not `scenario_owned_by_other_user`: the claim is discarded BEFORE the
    // comparison, so a shared-key caller can no longer probe ownership by
    // watching which reason comes back.
    expect(refusalReason(res.payload)).toBe("scenario_requires_authenticated_owner");
  });
});
