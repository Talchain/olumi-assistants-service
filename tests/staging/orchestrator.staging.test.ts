/**
 * Staging smoke tests: CEE /orchestrate/v1/turn
 *
 * Black-box HTTP tests against a live staging deployment.
 * No src/ runtime imports — validates the public HTTP contract only.
 *
 * Gating:
 *   - RUN_STAGING_SMOKE=1      (explicit opt-in)
 *   - CEE_BASE_URL configured  (staging CEE URL)
 *
 * Run with: pnpm test:staging
 * (or: RUN_STAGING_SMOKE=1 CEE_BASE_URL=<url> vitest run tests/staging/)
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MINIMAL_GRAPH } from "./fixtures/minimal-graph.js";

// ============================================================================
// Gating — skip entire suite if conditions not met
// ============================================================================

const RUN_STAGING_SMOKE = process.env.RUN_STAGING_SMOKE === "1";
const CEE_BASE_URL = process.env.CEE_BASE_URL;

const SKIP_REASON = !RUN_STAGING_SMOKE
  ? "Skipping staging smoke: RUN_STAGING_SMOKE not set"
  : !CEE_BASE_URL
    ? "Skipping staging smoke: CEE_BASE_URL not configured"
    : null;

// ============================================================================
// Helpers
// ============================================================================

const ORCHESTRATE_URL = `${CEE_BASE_URL ?? ""}/orchestrate/v1/turn`;

/**
 * POST to the orchestrator turn endpoint.
 * Records elapsed_ms. Returns { status, body, elapsed_ms } for ALL responses
 * including 4xx/5xx — fetch() does not throw on non-2xx.
 * Throws only on network errors (server unreachable).
 */
async function makeRequest(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown; elapsed_ms: number }> {
  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `fetch() network error — server unreachable:\n` +
      `  url: ${url}\n` +
      `  error: ${err instanceof Error ? err.message : String(err)}\n` +
      `  request_snippet: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  const elapsed_ms = Date.now() - t0;
  let responseBody: unknown = null;
  try {
    responseBody = await response.json();
  } catch {
    // non-JSON body (rare — leave as null)
  }
  return { status: response.status, body: responseBody, elapsed_ms };
}

/**
 * Lightweight critical-fields envelope validator (Test 8 cross-cutting check).
 * Does NOT import Zod from src/ — manual runtime checks only.
 *
 * Accepts either block_type or type per block element (V1/V2 compat).
 */
function assertEnvelopeSchema(body: unknown, label: string): void {
  if (typeof body !== "object" || body === null) {
    throw new Error(`[${label}] Response body is not an object: ${JSON.stringify(body)}`);
  }
  const b = body as Record<string, unknown>;

  // assistant_text: string | null (must be present, not undefined)
  if (!("assistant_text" in b)) {
    throw new Error(`[${label}] assistant_text is missing from response`);
  }
  if (b.assistant_text !== null && typeof b.assistant_text !== "string") {
    throw new Error(`[${label}] assistant_text must be string | null, got: ${JSON.stringify(b.assistant_text)}`);
  }

  // blocks: array, each element has block_type (string) OR type (string)
  if (!Array.isArray(b.blocks)) {
    throw new Error(`[${label}] blocks must be array, got: ${JSON.stringify(b.blocks)}`);
  }
  for (const block of b.blocks) {
    const blk = block as Record<string, unknown>;
    const hasBlockType = typeof blk.block_type === "string";
    const hasType = typeof blk.type === "string";
    if (!hasBlockType && !hasType) {
      throw new Error(
        `[${label}] Each block must have a string "block_type" or "type" field. Got: ${JSON.stringify(block)}`,
      );
    }
  }

  // guidance_items: array
  if (!Array.isArray(b.guidance_items)) {
    throw new Error(`[${label}] guidance_items must be array, got: ${JSON.stringify(b.guidance_items)}`);
  }

  // turn_plan: object with selected_tool (string | null) and routing (string)
  if (typeof b.turn_plan !== "object" || b.turn_plan === null) {
    throw new Error(`[${label}] turn_plan must be object, got: ${JSON.stringify(b.turn_plan)}`);
  }
  const tp = b.turn_plan as Record<string, unknown>;
  if (!("selected_tool" in tp)) {
    throw new Error(`[${label}] turn_plan.selected_tool is missing`);
  }
  if (tp.selected_tool !== null && typeof tp.selected_tool !== "string") {
    throw new Error(`[${label}] turn_plan.selected_tool must be string | null, got: ${JSON.stringify(tp.selected_tool)}`);
  }
  if (typeof tp.routing !== "string") {
    throw new Error(`[${label}] turn_plan.routing must be string, got: ${JSON.stringify(tp.routing)}`);
  }
}

/**
 * Build a ConversationContextSchema-compliant context object.
 * Both context.scenario_id and the request-level scenario_id must match.
 */
function makeContext(
  scenarioId: string,
  graph: unknown = null,
  framing: unknown = null,
): Record<string, unknown> {
  return {
    graph,
    analysis_response: null,
    framing,
    messages: [],
    scenario_id: scenarioId,
  };
}

// ============================================================================
// Suite
// ============================================================================

describe("Orchestrator /orchestrate/v1/turn staging smoke", { timeout: 60_000 }, () => {
  let originalCeeBaseUrl: string | undefined;

  beforeAll(async () => {
    if (SKIP_REASON) return;

    originalCeeBaseUrl = process.env.CEE_BASE_URL;
    process.env.CEE_BASE_URL = CEE_BASE_URL!;
    // No _resetConfigCache() — pure HTTP tests, no src/ config Proxy used

    // Warmup: fire a request so the server is awake before the timed tests.
    // Result intentionally ignored — failure is non-fatal.
    const wId = randomUUID();
    await fetch(ORCHESTRATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "",
        scenario_id: wId,
        client_turn_id: randomUUID(),
        context: makeContext(wId),
      }),
    }).catch(() => {/* non-fatal */});
  });

  afterAll(() => {
    if (SKIP_REASON) return;
    if (originalCeeBaseUrl !== undefined) {
      process.env.CEE_BASE_URL = originalCeeBaseUrl;
    } else {
      delete process.env.CEE_BASE_URL;
    }
  });

  // --------------------------------------------------------------------------
  // Test 1: Message → draft_graph (or clarification)
  // --------------------------------------------------------------------------

  it(
    "Test 1: hiring decision message returns 200 with graph_patch block or assistant text",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-t1-${randomUUID()}`;
      const result = await makeRequest(ORCHESTRATE_URL, {
        message: "I need to decide whether to hire a senior developer or two junior developers for my startup",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(scenarioId),
      });

      const diag = {
        url: ORCHESTRATE_URL,
        status: result.status,
        elapsed_ms: result.elapsed_ms,
        body_snippet: JSON.stringify(result.body).slice(0, 600),
      };

      expect(result.status, `Expected 200. Diagnostics: ${JSON.stringify(diag)}`).toBe(200);

      // Test 8: envelope schema
      assertEnvelopeSchema(result.body, "Test 1");

      const b = result.body as Record<string, unknown>;
      const blocks = b.blocks as Array<Record<string, unknown>>;

      // Draft path: graph_patch block present
      const hasGraphPatch = blocks.some(
        (blk) => blk.block_type === "graph_patch" || blk.type === "graph_patch",
      );
      // Clarification path: non-empty assistant_text, no error
      const hasAssistantText =
        typeof b.assistant_text === "string" && b.assistant_text.length > 0;

      expect(
        hasGraphPatch || hasAssistantText,
        `Expected graph_patch block or non-empty assistant_text. Diagnostics: ${JSON.stringify(diag)}`,
      ).toBe(true);
    },
  );

  // --------------------------------------------------------------------------
  // Test 2: Message → run_analysis
  // --------------------------------------------------------------------------

  it(
    "Test 2: 'run the analysis' with graph triggers run_analysis tool",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-t2-${randomUUID()}`;
      const result = await makeRequest(ORCHESTRATE_URL, {
        message: "run the analysis",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(
          scenarioId,
          MINIMAL_GRAPH,
          { stage: "evaluate", goal: "Maximise team output" },
        ),
      });

      const diag = {
        url: ORCHESTRATE_URL,
        status: result.status,
        elapsed_ms: result.elapsed_ms,
        body_snippet: JSON.stringify(result.body).slice(0, 600),
      };

      expect(result.status, `Expected 200. Diagnostics: ${JSON.stringify(diag)}`).toBe(200);

      // Test 8: envelope schema
      assertEnvelopeSchema(result.body, "Test 2");

      const b = result.body as Record<string, unknown>;
      const tp = b.turn_plan as Record<string, unknown>;

      // turn_plan.selected_tool === 'run_analysis'
      expect(
        tp.selected_tool,
        `Expected turn_plan.selected_tool='run_analysis'. Diagnostics: ${JSON.stringify(diag)}`,
      ).toBe("run_analysis");

      // At least one fact block
      const blocks = b.blocks as Array<Record<string, unknown>>;
      const hasFact = blocks.some(
        (blk) => blk.block_type === "fact" || blk.type === "fact",
      );
      expect(hasFact, `Expected at least one fact block. Diagnostics: ${JSON.stringify(diag)}`).toBe(true);

      // analysis_response present:
      // V2 pipeline (expected path): lineage.response_hash is a non-empty string
      // V1 pipeline (fallback): analysis_response is non-null
      const lineage = b.lineage as Record<string, unknown> | undefined;
      const hasV2Analysis =
        typeof lineage?.response_hash === "string" && lineage.response_hash.length > 0;
      const hasV1Analysis = b.analysis_response != null;

      expect(
        hasV2Analysis || hasV1Analysis,
        `Expected lineage.response_hash (V2) or analysis_response (V1) to be present. ` +
        `Diagnostics: ${JSON.stringify(diag)}`,
      ).toBe(true);
    },
  );

  // --------------------------------------------------------------------------
  // Test 3a: System event → patch_accepted Path A (applied_graph_hash set)
  // --------------------------------------------------------------------------

  it(
    "Test 3a: patch_accepted with applied_graph_hash returns 200 silent envelope",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-t3a-${randomUUID()}`;
      const result = await makeRequest(ORCHESTRATE_URL, {
        message: "",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(scenarioId, MINIMAL_GRAPH, { stage: "evaluate", goal: "Test goal" }),
        graph_state: MINIMAL_GRAPH,
        system_event: {
          event_type: "patch_accepted",
          event_id: randomUUID(),
          timestamp: new Date().toISOString(),
          details: {
            patch_id: `patch-${randomUUID()}`,
            operations: [
              {
                op: "update_node",
                path: "nodes/fac_cost",
                value: { id: "fac_cost", kind: "factor", label: "Salary cost (updated)" },
              },
            ],
            applied_graph_hash: "staging-test-hash-abc123",
          },
        },
      });

      const diag = {
        url: ORCHESTRATE_URL,
        status: result.status,
        elapsed_ms: result.elapsed_ms,
        body_snippet: JSON.stringify(result.body).slice(0, 600),
      };
      console.log(`[Test 3a] elapsed_ms: ${result.elapsed_ms}`);

      expect(result.status, `Expected 200. Diagnostics: ${JSON.stringify(diag)}`).toBe(200);

      // Test 8: envelope schema
      assertEnvelopeSchema(result.body, "Test 3a");

      const b = result.body as Record<string, unknown>;

      expect(
        b.assistant_text,
        `Expected assistant_text null. Diagnostics: ${JSON.stringify(diag)}`,
      ).toBeNull();

      expect(
        Array.isArray(b.blocks),
        `Expected blocks array. Diagnostics: ${JSON.stringify(diag)}`,
      ).toBe(true);

      expect(
        Array.isArray(b.guidance_items),
        `Expected guidance_items array. Diagnostics: ${JSON.stringify(diag)}`,
      ).toBe(true);
    },
  );

  // --------------------------------------------------------------------------
  // Test 3b: patch_accepted missing graph_state → 400 MISSING_GRAPH_STATE
  // --------------------------------------------------------------------------

  it(
    "Test 3b: patch_accepted with applied_graph_hash but no graph_state returns 400",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-t3b-${randomUUID()}`;
      const result = await makeRequest(ORCHESTRATE_URL, {
        message: "",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(scenarioId, MINIMAL_GRAPH, { stage: "evaluate", goal: "Test goal" }),
        // graph_state intentionally omitted
        system_event: {
          event_type: "patch_accepted",
          event_id: randomUUID(),
          timestamp: new Date().toISOString(),
          details: {
            patch_id: `patch-${randomUUID()}`,
            operations: [{ op: "update_node", path: "nodes/fac_cost", value: {} }],
            applied_graph_hash: "staging-test-hash-missing-graph",
          },
        },
      });

      const diag = {
        url: ORCHESTRATE_URL,
        status: result.status,
        body_snippet: JSON.stringify(result.body).slice(0, 600),
      };

      expect(result.status, `Expected 400. Diagnostics: ${JSON.stringify(diag)}`).toBe(400);

      const b = result.body as Record<string, unknown>;
      const error = b.error as Record<string, unknown> | undefined;
      expect(
        error?.code,
        `Expected error.code MISSING_GRAPH_STATE. Diagnostics: ${JSON.stringify(diag)}`,
      ).toBe("MISSING_GRAPH_STATE");
    },
  );

  // --------------------------------------------------------------------------
  // Test 4: System event → patch_dismissed
  // --------------------------------------------------------------------------

  it(
    "Test 4: patch_dismissed returns 200 with null assistant_text and empty blocks",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-t4-${randomUUID()}`;
      const result = await makeRequest(ORCHESTRATE_URL, {
        message: "",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(scenarioId, MINIMAL_GRAPH),
        system_event: {
          event_type: "patch_dismissed",
          event_id: randomUUID(),
          timestamp: new Date().toISOString(),
          details: {
            patch_id: `patch-${randomUUID()}`,
          },
        },
      });

      const diag = {
        url: ORCHESTRATE_URL,
        status: result.status,
        elapsed_ms: result.elapsed_ms,
        body_snippet: JSON.stringify(result.body).slice(0, 600),
      };
      console.log(`[Test 4] elapsed_ms: ${result.elapsed_ms}`);

      expect(result.status, `Expected 200. Diagnostics: ${JSON.stringify(diag)}`).toBe(200);

      // Test 8: envelope schema
      assertEnvelopeSchema(result.body, "Test 4");

      const b = result.body as Record<string, unknown>;

      expect(
        b.assistant_text,
        `Expected assistant_text null. Diagnostics: ${JSON.stringify(diag)}`,
      ).toBeNull();

      expect(
        b.blocks,
        `Expected empty blocks array. Diagnostics: ${JSON.stringify(diag)}`,
      ).toEqual([]);
    },
  );

  // --------------------------------------------------------------------------
  // Test 5: System event → feedback_submitted
  // --------------------------------------------------------------------------

  it(
    "Test 5: feedback_submitted returns 200 with null assistant_text and empty blocks/guidance_items",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-t5-${randomUUID()}`;
      const result = await makeRequest(ORCHESTRATE_URL, {
        message: "",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(scenarioId),
        system_event: {
          event_type: "feedback_submitted",
          event_id: randomUUID(),
          timestamp: new Date().toISOString(),
          details: {
            turn_id: `turn-${randomUUID()}`,
            rating: "up",
          },
        },
      });

      const diag = {
        url: ORCHESTRATE_URL,
        status: result.status,
        elapsed_ms: result.elapsed_ms,
        body_snippet: JSON.stringify(result.body).slice(0, 600),
      };
      console.log(`[Test 5] elapsed_ms: ${result.elapsed_ms}`);

      expect(result.status, `Expected 200. Diagnostics: ${JSON.stringify(diag)}`).toBe(200);

      // Test 8: envelope schema
      assertEnvelopeSchema(result.body, "Test 5");

      const b = result.body as Record<string, unknown>;

      expect(
        b.assistant_text,
        `Expected assistant_text null. Diagnostics: ${JSON.stringify(diag)}`,
      ).toBeNull();

      expect(
        b.blocks,
        `Expected empty blocks array. Diagnostics: ${JSON.stringify(diag)}`,
      ).toEqual([]);

      expect(
        b.guidance_items,
        `Expected empty guidance_items array. Diagnostics: ${JSON.stringify(diag)}`,
      ).toEqual([]);
    },
  );

  // --------------------------------------------------------------------------
  // Test 6: Invalid request → 400 with error object
  // --------------------------------------------------------------------------

  it(
    "Test 6: unknown system event_type returns 400 with error object",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-t6-${randomUUID()}`;
      const result = await makeRequest(ORCHESTRATE_URL, {
        message: "",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(scenarioId),
        system_event: {
          event_type: "unknown_event_type_xyz",
          event_id: randomUUID(),
          timestamp: new Date().toISOString(),
          details: {},
        },
      });

      const diag = {
        url: ORCHESTRATE_URL,
        status: result.status,
        body_snippet: JSON.stringify(result.body).slice(0, 600),
      };

      expect(result.status, `Expected 400. Diagnostics: ${JSON.stringify(diag)}`).toBe(400);

      // Response must contain an error object (code not asserted — any error shape accepted)
      const b = result.body as Record<string, unknown>;
      expect(
        typeof b.error === "object" && b.error !== null,
        `Expected response to contain an error object. Diagnostics: ${JSON.stringify(diag)}`,
      ).toBe(true);
    },
  );

  // --------------------------------------------------------------------------
  // Test 7: Idempotency — same (scenario_id, client_turn_id) returns identical core fields
  // --------------------------------------------------------------------------

  it(
    "Test 7: identical (scenario_id, client_turn_id) returns same assistant_text, blocks, guidance_items, turn_plan",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-t7-${randomUUID()}`;
      const clientTurnId = randomUUID(); // same for both calls

      const requestBody = {
        message: "",
        scenario_id: scenarioId,
        client_turn_id: clientTurnId,
        context: makeContext(scenarioId, MINIMAL_GRAPH),
        system_event: {
          event_type: "patch_dismissed",
          event_id: randomUUID(),
          timestamp: new Date().toISOString(),
          details: {
            patch_id: `patch-${randomUUID()}`,
          },
        },
      };

      const result1 = await makeRequest(ORCHESTRATE_URL, requestBody);
      const result2 = await makeRequest(ORCHESTRATE_URL, requestBody);

      const diag = {
        url: ORCHESTRATE_URL,
        status1: result1.status,
        status2: result2.status,
        body1_snippet: JSON.stringify(result1.body).slice(0, 400),
        body2_snippet: JSON.stringify(result2.body).slice(0, 400),
      };

      expect(result1.status, `First call: expected 200. Diagnostics: ${JSON.stringify(diag)}`).toBe(200);
      expect(result2.status, `Second call: expected 200. Diagnostics: ${JSON.stringify(diag)}`).toBe(200);

      // Test 8: envelope schema on both
      assertEnvelopeSchema(result1.body, "Test 7 (call 1)");
      assertEnvelopeSchema(result2.body, "Test 7 (call 2)");

      // Compare core fields only — timestamps and transient fields may differ.
      // Idempotency cache keyed on (scenario_id, client_turn_id) must return
      // the same assistant_text, blocks, guidance_items, and turn_plan.
      const pick = (body: unknown) => {
        const b = body as Record<string, unknown>;
        return {
          assistant_text: b.assistant_text,
          blocks: b.blocks,
          guidance_items: b.guidance_items,
          turn_plan: b.turn_plan,
        };
      };

      expect(
        pick(result2.body),
        `Expected identical core fields for same client_turn_id. ` +
        `Call 1: ${JSON.stringify(pick(result1.body)).slice(0, 400)} ` +
        `Call 2: ${JSON.stringify(pick(result2.body)).slice(0, 400)}`,
      ).toEqual(pick(result1.body));
    },
  );
});
