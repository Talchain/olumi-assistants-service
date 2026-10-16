/**
 * ⛔ AN OWNERSHIP REFUSAL STOPS THE HANDLER (DL-3, 16 Oct; found while moving #3283's identity rows).
 *
 * plugins/scenario-ownership.ts sends the 422 from an ASYNC preHandler. Fastify only stops the chain when an async
 * hook RETURNS the reply; `await admitOwner(...)` returned false and the hook returned undefined, so the turn handler
 * still ran for a refused caller: it claimed the turn fence and wrote through `append` while the wire said 422.
 * Bound by IDENTITY: the store's own write log, not the status code. CONTROL: a verified HMAC caller on the same
 * shape does write (the probe can see a write).
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
const ownerCalls: string[] = [];
const ensureCalls: Array<{ scenarioId: string; userId: string | null }> = [];
/** Every store write the turn handler attempted. A refused caller must leave this EMPTY. */
const appends: unknown[][] = [];

vi.mock("../../src/orchestrator-v5/session/index.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/orchestrator-v5/session/index.js")>();
  const { createMockSessionStore } = await import("../utils/mock-session-store.js");
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        readExistingScenario: async scenarioId => {
          ownerCalls.push(scenarioId);
          const owner = rows.get(scenarioId);
          return owner === undefined ? null : { userId: owner, graph: null, briefText: null, analysisInvalidatedAt: null };
        },
        append: async (...args: unknown[]) => { appends.push(args); return { id: "mock-row-id" }; },
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

/**
 * A KEPT `/orchestrate/v2/turn` shape: a canvas system event (`patch_accepted`).
 *
 * #3283 retired the free-text conversation shape on this route (it now answers
 * 410 `conventional_conversation_retired` after admission). The ownership
 * refusal this suite pins is a route-level preHandler
 * (`plugins/scenario-ownership.ts`) and does not depend on the body shape, so
 * every row runs on a shape the route still serves — system events are what
 * the browser's canvas edits and the AI lane's `app.inject` calls send here.
 * Refusals and their over-correction controls share this ONE shape, so each
 * pair still differs only in the caller.
 */
function turnBody(scenarioId: string, userId?: string) {
  return {
    kind: "system_event" as const,
    turn_id: randomUUID(),
    scenario_id: scenarioId,
    event: { kind: "patch_accepted" as const, patch_id: "claimed-identity-suite" },
    stage: "analyse" as const,
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
  app.addHook('onSend', async (req, reply, payload) => { reply.header('x-ownership-caller', req.scenarioAccess?.callerUserId ?? ''); return payload; });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  ensureCalls.length = 0;
  appends.length = 0;
  ownerCalls.length = 0;
  rows.clear();
  rows.set(SCENARIO_OWNED, OWNER);
  rows.set(SCENARIO_GUEST, null);
});

describe("/orchestrate/v2/turn — a refused caller writes nothing", () => {
  it("REFUSED: an assist-key caller naming the owner gets 422 and the handler never writes", async () => {
    const res = await app.inject({
      method: "POST",
      url: TURN_URL,
      headers: { "x-olumi-assist-key": ASSIST_KEY, "content-type": "application/json" },
      payload: turnBody(SCENARIO_OWNED, OWNER),
    });
    expect(res.statusCode).toBe(422);
    expect(refusalReason(res.payload)).toBe("scenario_requires_authenticated_owner");
    // Let any handler that wrongly continued after the reply finish its writes before we look.
    await new Promise((r) => setTimeout(r, 200));
    expect(appends).toEqual([]);
  });

  it("CONTROL: a verified HMAC caller naming the same owner reaches the handler and writes", async () => {
    const body = JSON.stringify(turnBody(SCENARIO_OWNED, OWNER));
    const res = await app.inject({ method: "POST", url: TURN_URL, headers: hmacHeaders("POST", TURN_URL, body), payload: body });
    expect(refusalReason(res.payload)).toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    expect(appends.length).toBeGreaterThan(0);
  });
});
