import { describe, it, expect } from "vitest";

const { currentStageEmitter } = await import(
"../../src/cee/unified-pipeline/stage-stream-context.js"
);

describe("additive guarantee — the buffered turn is untouched", () => {
  it("the stage emitter is ABSENT outside a streamed turn — the mechanism behind the guarantee", () => {
    // This is why the buffered path cannot regress: there is no store to read,
    // so `handleDraftGraph` never spreads `onStage` into the pipeline opts. Not
    // a flag, not a URL check — an empty async context.
    expect(currentStageEmitter()).toBeUndefined();
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 7. AUTH SURFACE
// ═══════════════════════════════════════════════════════════════════════════

describe("auth surface", () => {
  it("the BROWSER route is public — derived, not mirrored", async () => {
    // F7 (review): this test used to restate `auth.ts`'s `publicRoutes` array
    // and admit it in its own comment. That is a trap-12 mirror — it would keep
    // asserting the old answer after the real list moved. The predicate is now
    // exported, so this DERIVES each route's posture from the code that decides
    // it.
    const { isPublicRoute } = await import("../../src/plugins/auth.js");
    const { PROXY_STREAMED_TURN_ROUTE } = await import(
      "../../src/routes/proxy-v5-turn-stream.js"
    );

    // The browser sibling must be exactly as public as the proxy it wraps —
    // by prefix INHERITANCE, without a new allowlist entry.
    expect(isPublicRoute(PROXY_STREAMED_TURN_ROUTE, "POST")).toBe(
      isPublicRoute("/proxy/v5/turn", "POST"),
    );
    expect(isPublicRoute(PROXY_STREAMED_TURN_ROUTE, "POST")).toBe(true);

    // Positive control: the predicate discriminates at all.
    expect(isPublicRoute("/assist/v1/draft-graph", "POST")).toBe(false);
  });

});
