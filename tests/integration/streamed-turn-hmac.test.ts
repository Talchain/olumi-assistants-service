import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHash, createHmac, randomUUID } from "node:crypto";

const HMAC_SECRET = "streamed-turn-hmac-secret";

vi.stubEnv("LLM_PROVIDER", "fixtures");
vi.stubEnv("HMAC_SECRET", HMAC_SECRET);
// No ASSIST_API_KEY(S): a pure-HMAC deployment — on HMAC failure auth fails
// hard instead of falling through to an API key the client never sent.
vi.stubEnv("ASSIST_API_KEY", "");
vi.stubEnv("ASSIST_API_KEYS", "");

const { build } = await import("../../src/server.js");

const BUFFERED_URL = "/orchestrate/v2/turn";

function sign(method: string, path: string, body: string) {
  const ts = Date.now().toString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`;
  const signature = createHmac("sha256", HMAC_SECRET).update(canonical).digest("hex");
  return {
    "x-olumi-signature": signature,
    "x-olumi-timestamp": ts,
    "x-olumi-nonce": nonce,
    "content-type": "application/json",
  };
}

const payload = JSON.stringify({
  kind: "message",
  turn_id: "60000001-2222-4222-8222-222222222222",
  scenario_id: "50000001-1111-4111-8111-111111111111",
  stage: "frame",
  message: "Should we expand into the German market next quarter or hold?",
  turn_class: "frame",
  source: "composer",
  explicit_generate: true,
});

describe("HMAC authentication on the buffered turn", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it("POSITIVE CONTROL: a signed request to the BUFFERED turn authenticates", async () => {
    const res = await app.inject({
      method: "POST",
      url: BUFFERED_URL,
      headers: sign("POST", BUFFERED_URL, payload),
      payload,
    });
    // Auth must pass — anything but 401/403 proves the signature scheme works
    // against the buffered route for this exact client construction.
    expect([401, 403]).not.toContain(res.statusCode);
  }, 60_000);

});

// Auth parity uses an existing guest scenario; persistency is not this suite's subject.
vi.mock('../../src/orchestrator-v5/session/index.js', async load => {
  const actual = await load<typeof import('../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../utils/mock-session-store.js');
  return { ...actual, getSessionStore: () => createMockSessionStore() };
});
