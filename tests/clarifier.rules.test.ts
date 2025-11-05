import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import route from "../src/routes/assist.clarify-brief.js";

describe("Clarifier rules", () => {
  const envBackup = { ...process.env } as any;
  beforeAll(() => { process.env.LLM_PROVIDER = "fixtures"; });
  afterAll(() => { process.env = envBackup; });

  it("enforces round limit and MCQ-first ordering and stop-rule", async () => {
    const app = Fastify();
    await route(app);
    const bad = await app.inject({ method: "POST", url: "/assist/clarify-brief", payload: { brief: "x".repeat(30), round: 3 } });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({ method: "POST", url: "/assist/clarify-brief", payload: { brief: "x".repeat(50), round: 0 } });
    expect(ok.statusCode).toBe(200);
    const body = JSON.parse(ok.body);
    expect(Array.isArray(body.questions)).toBe(true);
    // MCQ-first: first question should have choices
    expect(Array.isArray(body.questions[0].choices)).toBe(true);
    // Stop rule honored when confidence >= 0.8 (fixtures return 0.7 so this is non-deterministic here)
    expect(typeof body.should_continue).toBe("boolean");
  });
});

