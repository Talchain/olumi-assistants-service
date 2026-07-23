/**
 * Stage 4.5 post-draft coaching pass (v12, lean-draft contract 1.197).
 *
 * The pass re-produces coaching/causal_claims after the structure-only draft
 * call. Its load-bearing invariant is REGRESSION-SAFETY: it must NEVER fail the
 * draft. These pins assert:
 *   - non-fatal: a chat failure leaves ctx.coaching undefined (→ Stage 5 emits
 *     canonical-empty) and does not throw;
 *   - idempotent: pre-existing coaching (prompt-only fallback path) is kept;
 *   - success: valid coaching/causal JSON is attached to ctx;
 *   - budget-gated: skipped when the request budget cannot fit another call.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { runStageCoachingPass } from "../../src/cee/unified-pipeline/stages/coaching-pass.js";

// Minimal StageContext factory — only the fields the pass reads.
function makeCtx(overrides: Record<string, unknown> = {}): any {
  return {
    requestId: "req-test",
    start: Date.now(),
    effectiveBrief: "Should we hire two engineers or build self-serve?",
    graph: { nodes: [{ id: "n1", kind: "goal", label: "G" }], edges: [] },
    coaching: undefined,
    causalClaims: undefined,
    draftAdapter: undefined,
    opts: { requestStartMs: Date.now() },
    ...overrides,
  };
}

function adapterReturning(content: string): any {
  return {
    chat: vi.fn().mockResolvedValue({
      content,
      usage: { output_tokens: 42 },
      model: "claude-sonnet-4-6",
      latencyMs: 10,
    }),
  };
}

function adapterThrowing(err: Error): any {
  return { chat: vi.fn().mockRejectedValue(err) };
}

describe("runStageCoachingPass — regression-safety invariants", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is NON-FATAL: a chat failure leaves coaching undefined and does not throw", async () => {
    const ctx = makeCtx({ draftAdapter: adapterThrowing(new Error("upstream 500")) });
    await expect(runStageCoachingPass(ctx)).resolves.toBeUndefined();
    expect(ctx.coaching).toBeUndefined();
    expect(ctx.causalClaims).toBeUndefined();
  });

  it("is NON-FATAL on unparseable output: leaves coaching undefined", async () => {
    const ctx = makeCtx({ draftAdapter: adapterReturning("not json at all") });
    await runStageCoachingPass(ctx);
    expect(ctx.coaching).toBeUndefined();
  });

  it("is IDEMPOTENT: does not overwrite coaching the draft already produced", async () => {
    const existing = { summary: "already here", strengthen_items: [] };
    const adapter = adapterReturning('{"coaching":{"summary":"NEW"}}');
    const ctx = makeCtx({ coaching: existing, draftAdapter: adapter });
    await runStageCoachingPass(ctx);
    expect(ctx.coaching).toBe(existing);
    expect(adapter.chat).not.toHaveBeenCalled();
  });

  it("attaches coaching AND causal_claims from a valid response", async () => {
    const adapter = adapterReturning(
      JSON.stringify({
        coaching: {
          summary: "Consider a status-quo option.",
          strengthen_items: [
            { id: "add-sq", label: "Add status quo", detail: "…", action_type: "add_option" },
          ],
          widening_log: { elements_added: [], elements_considered_but_excluded: [], brief_completeness: "partial" },
          bias_signals: [],
        },
        causal_claims: [{ type: "direct", from: "n1", to: "n1", stated_strength: "moderate" }],
      }),
    );
    const ctx = makeCtx({ draftAdapter: adapter });
    await runStageCoachingPass(ctx);
    expect(ctx.coaching).toBeDefined();
    expect((ctx.coaching as any).summary).toBe("Consider a status-quo option.");
    expect(Array.isArray(ctx.causalClaims)).toBe(true);
    expect(adapter.chat).toHaveBeenCalledTimes(1);
  });

  it("is BUDGET-GATED: skips the call when the request budget is nearly exhausted", async () => {
    const adapter = adapterReturning('{"coaching":{"summary":"x"}}');
    // requestStartMs 115s ago → remaining ≈ 120 - 115 - 10 = -5s, below the 20s floor.
    const ctx = makeCtx({
      draftAdapter: adapter,
      opts: { requestStartMs: Date.now() - 115_000 },
    });
    await runStageCoachingPass(ctx);
    expect(adapter.chat).not.toHaveBeenCalled();
    expect(ctx.coaching).toBeUndefined();
  });

  it("no-ops safely when there is no adapter or no graph", async () => {
    await expect(runStageCoachingPass(makeCtx({ draftAdapter: undefined }))).resolves.toBeUndefined();
    await expect(
      runStageCoachingPass(makeCtx({ draftAdapter: adapterReturning("{}"), graph: undefined })),
    ).resolves.toBeUndefined();
  });
});
