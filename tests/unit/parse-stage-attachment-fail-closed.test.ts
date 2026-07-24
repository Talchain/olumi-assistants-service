/**
 * Pipeline fail-closed pin (D-59-7): an oversize attached document must halt the
 * draft with a TYPED 4xx early-return — never a silent drop, never a 500. Proves
 * the DraftAttachmentError → 413 wiring in runStageParse (Step 1b), which returns
 * BEFORE any adapter/LLM call.
 */
import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import { runStageParse } from "../../src/cee/unified-pipeline/stages/parse.js";
import { DRAFT_ATTACHMENT_MAX_BYTES } from "../../src/adapters/llm/draft-attachment.js";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";

function makeCtx(overrides: Partial<StageContext>): StageContext {
  return {
    requestId: "req-fail-closed",
    request: {} as never,
    opts: {} as never,
    start: Date.now(),
    effectiveBrief: "",
    ...overrides,
  } as unknown as StageContext;
}

describe("runStageParse — oversize attachment fails closed with a typed 4xx (D-59-7)", () => {
  it("returns a 413 early-return (not a silent drop, not a 500)", async () => {
    const oversize = Buffer.alloc(DRAFT_ATTACHMENT_MAX_BYTES + 1, 0x41).toString("base64");
    const brief = "Should we extend the free trial to lift conversion this quarter?";
    const ctx = makeCtx({
      input: {
        brief,
        attachments: [{ id: "a1", kind: "pdf", name: "big.pdf" }],
        // grounding flag unset ⇒ native path (default). Oversize must be caught here.
      } as unknown as StageContext["input"],
      rawBody: { attachment_payloads: { a1: oversize } },
      effectiveBrief: brief,
    });

    await runStageParse(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn?.statusCode).toBe(413);
    // The typed error copy is surfaced (honest rejection), and the graph was never drafted.
    expect(ctx.graph).toBeUndefined();
    const body = ctx.earlyReturn?.body as { code?: string; message?: string } | undefined;
    expect(String(body?.message ?? "")).toMatch(/limit/i);
  });
});
