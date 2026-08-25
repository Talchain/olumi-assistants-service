/**
 * Explain Diff Integration Tests
 *
 * Tests POST /assist/explain-diff with fixtures adapter
 * Verifies:
 * - Route responds correctly to valid inputs
 * - Schema validation works
 * - Deterministic sorting (by target alphabetically)
 * - Non-mutating behavior
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import explainRoute from "../../src/routes/assist.explain-diff.js";

// Use fixtures adapter for deterministic tests without API keys
vi.stubEnv("LLM_PROVIDER", "fixtures");

describe("POST /assist/explain-diff", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await explainRoute(app);
  });

  it("accepts valid patch with added nodes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/explain-diff",
      payload: {
        patch: {
          adds: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Increase revenue" }
            ],
            edges: []
          },
          updates: [],
          removes: []
        }
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.rationales).toBeDefined();
    expect(Array.isArray(body.rationales)).toBe(true);
    expect(body.rationales.length).toBeGreaterThan(0);
  });

  it("returns rationales with required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/explain-diff",
      payload: {
        patch: {
          adds: {
            nodes: [{ id: "goal_1", kind: "goal", label: "Test" }],
            edges: [{ id: "edge_1", from: "goal_1", to: "dec_1" }]
          },
          updates: [],
          removes: []
        }
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const firstRationale = body.rationales[0];

    expect(firstRationale.target).toBeDefined();
    expect(typeof firstRationale.target).toBe("string");
    expect(firstRationale.why).toBeDefined();
    expect(typeof firstRationale.why).toBe("string");
    expect(firstRationale.why.length).toBeLessThanOrEqual(280);
  });

  it("sorts rationales deterministically by target", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/explain-diff",
      payload: {
        patch: {
          adds: {
            nodes: [
              { id: "zebra", kind: "goal", label: "Z" },
              { id: "apple", kind: "decision", label: "A" }
            ],
            edges: []
          },
          updates: [],
          removes: []
        }
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    
    const targets = body.rationales.map((r: any) => r.target);
    const sortedTargets = [...targets].sort();
    expect(targets).toEqual(sortedTargets); // Should already be sorted
  });

  it("rejects empty patch", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/explain-diff",
      payload: {
        patch: {
          adds: { nodes: [], edges: [] },
          updates: [],
          removes: []
        }
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
    expect(body.message).toContain("no changes");
  });

  it("rejects missing patch field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/explain-diff",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("error.v1");
  });

  /**
   * BROWSER-REACHABILITY REGISTRATION — the defect this pins.
   *
   * The handler above has been live and correct since it shipped, and was
   * nonetheless unreachable from any browser. It mounts on the LEGACY
   * `/assist/*` surface; the UI's only CEE seam is the `/bff/cee/*` edge
   * function, which rewrites `/bff/cee/<x>` -> `/assist/v1/<x>` unconditionally.
   * No value of `<x>` yields `/assist/explain-diff`, so the capability was dark
   * with a complete server half — measured, not inferred: a live probe of
   * `/bff/assist/explain-diff` on staging returned the SPA catch-all, byte-identical
   * (3449 bytes) to a deliberately fabricated path, while `/bff/cee/graph-readiness`
   * returned live CEE JSON in the same run.
   *
   * These tests bind to the V1 PATH BY IDENTITY. A registration that exists in
   * source but not on the reachable surface is the whole defect class, so
   * asserting "the handler works" is not enough — the PATH is the claim.
   */
  describe("POST /assist/v1/explain-diff (browser-reachable surface)", () => {
    const VALID_PATCH = {
      patch: {
        adds: { nodes: [{ id: "goal_1", kind: "goal", label: "Increase revenue" }], edges: [] },
        updates: [],
        removes: [],
      },
    };

    it("is registered and answers on the v1 path", async () => {
      const res = await app.inject({ method: "POST", url: "/assist/v1/explain-diff", payload: VALID_PATCH });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.rationales)).toBe(true);
      expect(body.rationales.length).toBeGreaterThan(0);
    });

    it("enforces the same validation as the legacy path (empty patch -> 400)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/explain-diff",
        payload: { patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] } },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
      expect(body.message).toContain("no changes");
    });

    /**
     * ONE HANDLER, TWO PATHS — asserted, not assumed.
     *
     * Two copies of a handler is the hand-maintained-mirror defect: they drift,
     * and the drift reads as green on whichever path the suite happens to
     * exercise. This asserts the two surfaces agree on the SAME input, so a
     * future edit that forks them REDs here.
     */
    it("routes both paths to the same handler (no forked copy)", async () => {
      const [legacy, v1] = await Promise.all([
        app.inject({ method: "POST", url: "/assist/explain-diff", payload: VALID_PATCH }),
        app.inject({ method: "POST", url: "/assist/v1/explain-diff", payload: VALID_PATCH }),
      ]);

      expect(legacy.statusCode).toBe(v1.statusCode);
      expect(JSON.parse(v1.body)).toEqual(JSON.parse(legacy.body));
    });

    /**
     * THE UI'S REAL PAYLOAD SHAPE (coordinator item 3) — and the limit of what
     * THIS SEAM can promise about it.
     *
     * The UI host is the applied-edit receipt card, whose block is
     * `{ operation, target_id, before, after }` with operation in
     * `set_factor_value | add_constraint | adjust_edge_strength`. NONE of those
     * is a node/edge ADD, so the client maps every one of them into `updates[]`.
     *
     * `updates` is `z.array(z.any())`. A permissive schema accepts a wrong
     * mapping silently, so the claim is pinned here rather than left as a note.
     * What this route OWNS and therefore what is asserted: the change-count gate
     * (`patch.updates.length`) must COUNT the mapped entry as a real change. A
     * mapping that dropped or mis-nested it would fall through to the
     * "no changes to explain" 400 — which is exactly the discrimination below.
     *
     * ⚠ WHAT THIS DELIBERATELY DOES NOT ASSERT: that a rationale comes back. That
     * depends on the ADAPTER, not this route — see the KNOWN GAP test below.
     * Asserting 200 here would be asserting a provider's behaviour from a route
     * test, and it would have to be weakened or deleted the moment the provider
     * changed.
     */
    it("counts a V5 updates-only patch as a real change (not 'no changes')", async () => {
      const v5Shaped = {
        patch: {
          adds: { nodes: [], edges: [] },
          updates: [
            {
              target_id: "factor_7",
              operation: "set_factor_value",
              before: { value: 0.2 },
              after: { value: 0.45 },
            },
          ],
          removes: [],
        },
        graph_summary: { node_count: 6, edge_count: 5 },
      };
      const emptyPatch = {
        patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] },
      };

      const [mapped, empty] = await Promise.all([
        app.inject({ method: "POST", url: "/assist/v1/explain-diff", payload: v5Shaped }),
        app.inject({ method: "POST", url: "/assist/v1/explain-diff", payload: emptyPatch }),
      ]);

      // The DISCRIMINATION is the evidence: the same route, two payloads,
      // different verdicts. The empty patch is rejected by the change gate; the
      // UI's mapped patch is not. If the mapping were wrong (dropped entry,
      // wrong key nesting) both would look identical here.
      expect(empty.statusCode).toBe(400);
      expect(JSON.parse(empty.body).message).toContain("no changes");

      expect(mapped.statusCode).not.toBe(400);
      expect(mapped.body).not.toContain("no changes");
    });

    /**
     * ⚠ KNOWN GAP, PINNED DELIBERATELY — the fixtures adapter cannot explain an
     * updates-only patch.
     *
     * `FixturesAdapter.explainDiff` (src/adapters/llm/router.ts) builds rationales
     * from `patch.adds.nodes` and `patch.adds.edges` ONLY. It ignores `updates`
     * and `removes` entirely, so a V5 applied-edit patch — which is ALWAYS
     * updates-only — yields zero rationales, and `ExplainDiffOutput.rationales`
     * is `.min(1)`, so the route's own output parse throws and returns 500.
     *
     * This is recorded as a test rather than a comment because a gap invisible to
     * the suite is how this capability was dark in the first place. The
     * assertion is EXACT: it REDs if the gap closes (adapter learns `updates`)
     * AND if it widens. Closing it is out of this lane's seam — the fix is ~12
     * lines in the fixtures adapter, mirroring the existing adds loops for
     * `updates`/`removes`.
     *
     * ⚠ CONSEQUENCE FOR REACHABILITY — SETTLED, no longer an open question.
     *
     * Which provider serves this task decides whether it works at all:
     *   anthropic → implemented (explainDiffWithAnthropic), any patch shape
     *   fixtures  → 0 rationales on an updates-only patch (this test)
     *   openai    → does not implement explainDiff at all
     *
     * DERIVED, not assumed: LLM_PROVIDER is ABSENT from all 118 cee-staging env
     * vars (Render API, fully paginated), so the schema default in
     * src/config/index.ts governs — and it is "openai". The task therefore
     * resolved to a provider that cannot execute it, on every request.
     *
     * FIXED by giving explain_diff a first-class checked-in task default
     * (TASK_MODEL_DEFAULTS.explain_diff = claude-haiku-4-5), which outranks the
     * global fallback and carries its provider through MODEL_REGISTRY. Pinned by
     * tests/unit/explain-diff-provider-assignment.test.ts, which also REDs if the
     * assignment is ever lost.
     *
     * The fixtures gap below is unrelated to that fix and remains real: it is a
     * property of the test double, not of the deployed provider.
     */
    it("KNOWN GAP: fixtures adapter yields no rationales for an updates-only patch", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/explain-diff",
        payload: {
          patch: {
            adds: { nodes: [], edges: [] },
            updates: [{ target_id: "factor_7", operation: "set_factor_value", before: {}, after: {} }],
            removes: [],
          },
        },
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("INTERNAL");
      // The specific cause: output parse rejected an empty rationale list.
      expect(body.message).toContain("rationales");

      // CONTRAST CONTROL — the same adapter DOES serve an adds-shaped patch, so
      // the 500 above is about the `updates` blind spot specifically and not a
      // dead adapter or a broken harness.
      const control = await app.inject({
        method: "POST",
        url: "/assist/v1/explain-diff",
        payload: {
          patch: {
            adds: { nodes: [{ id: "goal_1", kind: "goal", label: "Increase revenue" }], edges: [] },
            updates: [],
            removes: [],
          },
        },
      });
      expect(control.statusCode).toBe(200);
      expect(JSON.parse(control.body).rationales.length).toBeGreaterThan(0);
    });
  });
});
