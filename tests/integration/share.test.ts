/**
 * Share-for-Review Integration Tests (v1.5.0 - PR I)
 *
 * Tests core share functionality:
 * - Share creation with signed tokens
 * - Redaction options
 * - Expiration handling
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import shareRoute from "../../src/routes/assist.share.js";

describe("Share-for-Review Integration (v1.5.0)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    vi.stubEnv("SHARE_TOKEN_SECRET", "a".repeat(32));
    vi.stubEnv("PUBLIC_BASE_URL", "https://example.com");

    app = Fastify();
    await shareRoute(app);
  });

  it("creates a shareable link for a decision graph", async () => {
    const graph = {
      version: "v2",
      default_seed: 42,
      meta: {
        brief: "Should we expand?",
        title: "Expansion Decision",
      },
      nodes: [
        { id: "goal_1", kind: "goal" as const, label: "Expand" },
      ],
      edges: [],
    };

    const res = await app.inject({
      method: "POST",
      url: "/assist/share",
      payload: { graph },
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.schema).toBe("share.v1");
    expect(body.share_id).toBeDefined();
    expect(body.share_url).toMatch(/^https:\/\/example\.com\/share\/.+/);
    expect(body.expires_at).toBeDefined();
  });

  it("honors redaction options", async () => {
    const graph = {
      version: "v2",
      default_seed: 42,
      meta: { brief: "Public brief" },
      nodes: [{ id: "n1", kind: "goal" as const, label: "Goal" }],
      edges: [],
    };

    const res = await app.inject({
      method: "POST",
      url: "/assist/share",
      payload: {
        graph,
        redaction_options: {
          keep_brief: true,
        },
      },
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.redacted.brief).toBe(false); // Kept
  });

  it("rejects invalid token format", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/share/invalid-token",
    });

    expect(res.statusCode).toBe(400);
  });
});
