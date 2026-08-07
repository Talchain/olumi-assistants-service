/**
 * ADVERSARIAL REVIEW of PR #751 — HMAC auth-parity attack. NOT part of the PR.
 *
 * The route's own comment claims forwarding headers + raw body verbatim means
 * "the inner request must authenticate as the outer one did", and specifically
 * that raw-byte forwarding keeps HMAC clients working. But the HMAC canonical
 * string is PATH-BOUND (`METHOD\nPATH\n[TS\nNONCE\n]BODYHASH`, verified over
 * `request.url` in plugins/auth.ts preHandler) and the nonce is CONSUMED by the
 * outer verification. The inner injected request has a different path
 * (/orchestrate/v2/turn), so its verification must fail — meaning a pure-HMAC
 * client that authenticates fine against the buffered turn cannot use the
 * streamed sibling at all.
  *
 * ── PROVENANCE ─────────────────────────────────────────────────────────────
 * ADOPTED FROM THE ADVERSARIAL REVIEW OF PR #751 (reviewer lane, 29 Jul).
 *
 * Pins the HMAC incompatibility the review proved: the canonical string is
 * PATH-BOUND, so a signature computed over `/orchestrate/v2/turn/stream` can
 * never verify against the inner `/orchestrate/v2/turn`. The route's own comment
 * previously claimed the opposite. This suite is the reason that claim cannot
 * quietly return: it holds the positive control (the same client construction
 * DOES authenticate against the buffered turn) beside the negative result.
 */

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

const STREAM_URL = "/orchestrate/v2/turn/stream";
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

interface StageFrame {
  stage: string;
  status_code?: number;
  payload?: unknown;
  [k: string]: unknown;
}

function parseStageFrames(body: string): StageFrame[] {
  const frames: StageFrame[] = [];
  for (const block of body.split("\n\n")) {
    if (!block.includes("event: stage")) continue;
    const line = block.split("\n").find((l) => l.startsWith("data: "));
    if (line) frames.push(JSON.parse(line.slice(6)) as StageFrame);
  }
  return frames;
}

describe("ADVERSARIAL: HMAC client parity between buffered and streamed turn", () => {
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

  it("DOCUMENTED INCOMPATIBILITY: the same HMAC client on the STREAMED route is refused by the inner turn", async () => {
    const res = await app.inject({
      method: "POST",
      url: STREAM_URL,
      headers: sign("POST", STREAM_URL, payload),
      payload,
    });
    // The OUTER route authenticates — the signature does cover its own path.
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/event-stream");

    const frames = parseStageFrames(res.body);
    const complete = frames.find((f) => f.stage === "COMPLETE");
    expect(complete, "no terminal frame").toBeDefined();

    // ⚠ THIS ASSERTS THE DEFECT, DELIBERATELY, AND THE DIRECTION MATTERS.
    //
    // The reviewer wrote this test asserting 200 — the parity the route's own
    // comment claimed. It failed, and that failure IS the finding: the HMAC
    // canonical string is PATH-BOUND (`METHOD\nPATH\n[TS\nNONCE\n]BODYHASH`,
    // verified over `request.url`), so a signature computed over
    // `/orchestrate/v2/turn/stream` cannot verify against the inner
    // `/orchestrate/v2/turn`. HMAC falls through to the API-key path, no key is
    // present, and the inner turn 401s inside the terminal frame.
    //
    // The lane is NOT fixing that here (no known live HMAC caller of the turn
    // routes; the UI uses the public proxy and testers use an assist key) — it is
    // ROWED, and the route header now states the incompatibility instead of
    // claiming the opposite. So the test pins REALITY rather than the aspiration:
    // keeping the reviewer's 200 would ship a permanently-red suite, and deleting
    // the test would let the false claim quietly return.
    //
    // ⇒ When someone DOES make HMAC work across the seam, this test goes RED and
    // forces the row to be closed and the header comment corrected. That is the
    // point of asserting it this way round.
    expect(
      complete!.status_code,
      "the inner turn now accepts a forwarded HMAC signature — the path-bound incompatibility " +
        "has been fixed. Close the row, correct the route header, and invert this assertion.",
    ).toBe(401);
    // And the reason is specifically the missing key after the HMAC fallthrough,
    // not some other 401 — otherwise this test would pass for the wrong reason.
    expect(JSON.stringify(complete!.payload)).toContain("UNAUTHENTICATED");
  }, 60_000);
});
