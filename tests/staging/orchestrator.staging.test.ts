/**
 * Staging smoke tests: CEE /orchestrate/v1/turn
 *
 * Black-box HTTP tests against a live staging deployment.
 * No src/ runtime imports — validates the public HTTP contract only.
 *
 * Gating:
 *   - RUN_STAGING_SMOKE=1      (explicit opt-in)
 *   - CEE_BASE_URL configured  (staging CEE URL)
 *   - CEE_API_KEY configured   (X-Olumi-Assist-Key header)
 *
 * Run with: pnpm test:staging
 * (or: RUN_STAGING_SMOKE=1 CEE_BASE_URL=<url> vitest run tests/staging/)
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MINIMAL_GRAPH } from "./fixtures/minimal-graph.js";
import { makeAuthedRequest } from "./helpers/make-request.js";
import { ensureServerWarmed } from "./helpers/warmup.js";

// ============================================================================
// Gating — skip entire suite if conditions not met
// ============================================================================

const RUN_STAGING_SMOKE = process.env.RUN_STAGING_SMOKE === "1";
const CEE_BASE_URL = process.env.CEE_BASE_URL;
const CEE_API_KEY = process.env.CEE_API_KEY;

const SKIP_REASON = !RUN_STAGING_SMOKE
  ? "Skipping staging smoke: RUN_STAGING_SMOKE not set"
  : !CEE_BASE_URL
    ? "Skipping staging smoke: CEE_BASE_URL not configured"
    : !CEE_API_KEY
      ? "Skipping staging smoke: CEE_API_KEY not configured"
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
  return makeAuthedRequest(url, CEE_API_KEY!, body);
}

/**
 * Contract-grade envelope validator for 200 turn responses.
 * Does NOT import Zod from src/ — manual runtime checks only.
 *
 * Validates:
 *  1. turn_id: string
 *  2. assistant_text: string | null
 *  3. blocks: array, each element has block_type or type string
 *  4. guidance_items: array
 *  5. turn_plan: object with routing string; selected_tool string|null when present
 *  6. lineage (when present): context_hash string; response_hash non-empty string when present
 *  7. analysis_status branch: meta.request_id + retryable/critiques/results invariants
 *  8. Negative: no error.v1 shape (code+message) on 200 envelopes
 */
function assertEnvelopeSchema(body: unknown, label: string): void {
  const snippet = () => JSON.stringify(body).slice(0, 500);

  if (typeof body !== "object" || body === null) {
    throw new Error(`[${label}] body is not a non-null object. body: ${snippet()}`);
  }
  const b = body as Record<string, unknown>;

  // 1. turn_id: string
  if (typeof b.turn_id !== "string") {
    throw new Error(`[${label}] expected turn_id to be string, got ${typeof b.turn_id}. body: ${snippet()}`);
  }

  // 2. assistant_text: string | null
  if (!("assistant_text" in b)) {
    throw new Error(`[${label}] assistant_text missing from response. body: ${snippet()}`);
  }
  if (b.assistant_text !== null && typeof b.assistant_text !== "string") {
    throw new Error(`[${label}] expected assistant_text to be string|null, got ${typeof b.assistant_text}. body: ${snippet()}`);
  }

  // 3. blocks: array; each has block_type or type string
  if (!Array.isArray(b.blocks)) {
    throw new Error(`[${label}] blocks must be array. body: ${snippet()}`);
  }
  for (const block of b.blocks) {
    const blk = block as Record<string, unknown>;
    if (typeof blk.block_type !== "string" && typeof blk.type !== "string") {
      throw new Error(`[${label}] each block must have string block_type or type. block: ${JSON.stringify(block)}. body: ${snippet()}`);
    }
  }

  // 4. guidance_items: array
  if (!Array.isArray(b.guidance_items)) {
    throw new Error(`[${label}] guidance_items must be array. body: ${snippet()}`);
  }

  // 5. turn_plan: object with routing string
  if (typeof b.turn_plan !== "object" || b.turn_plan === null) {
    throw new Error(`[${label}] turn_plan must be object. body: ${snippet()}`);
  }
  const tp = b.turn_plan as Record<string, unknown>;
  if (typeof tp.routing !== "string") {
    throw new Error(`[${label}] turn_plan.routing must be string. body: ${snippet()}`);
  }
  // selected_tool: checked only when present (some ack modes may omit)
  if ("selected_tool" in tp && tp.selected_tool !== null && typeof tp.selected_tool !== "string") {
    throw new Error(`[${label}] turn_plan.selected_tool must be string|null when present. body: ${snippet()}`);
  }

  // 6. lineage (when present)
  if ("lineage" in b && b.lineage !== null && typeof b.lineage === "object") {
    const lin = b.lineage as Record<string, unknown>;
    if (typeof lin.context_hash !== "string") {
      throw new Error(`[${label}] lineage.context_hash must be string. body: ${snippet()}`);
    }
    if ("response_hash" in lin && (typeof lin.response_hash !== "string" || lin.response_hash === "")) {
      throw new Error(`[${label}] lineage.response_hash must be non-empty string when present. body: ${snippet()}`);
    }
  }

  // 7. analysis_status branch (when present)
  if ("analysis_status" in b) {
    const as_ = b.analysis_status as string;
    const meta = b.meta as Record<string, unknown> | null | undefined;
    if (typeof meta !== "object" || meta === null) {
      throw new Error(`[${label}] meta must be object when analysis_status present. body: ${snippet()}`);
    }
    if (typeof meta.request_id !== "string") {
      throw new Error(`[${label}] meta.request_id must be string. body: ${snippet()}`);
    }
    if (as_ === "computed" || as_ === "partial") {
      for (const f of ["seed_used", "response_hash", "computed_at", "n_samples"] as const) {
        if (!(f in meta)) {
          throw new Error(`[${label}] meta.${f} missing for analysis_status=${as_}. body: ${snippet()}`);
        }
      }
    } else if (as_ === "blocked") {
      if (b.retryable !== false) {
        throw new Error(`[${label}] retryable must be false for blocked. body: ${snippet()}`);
      }
      if (!Array.isArray(b.critiques) || b.critiques.length === 0) {
        throw new Error(`[${label}] critiques must be non-empty array for blocked. body: ${snippet()}`);
      }
      if ("results" in b) {
        throw new Error(`[${label}] results must not be present for blocked. body: ${snippet()}`);
      }
    } else if (as_ === "failed") {
      if (typeof b.retryable !== "boolean") {
        throw new Error(`[${label}] retryable must be boolean for failed. body: ${snippet()}`);
      }
      if ("results" in b) {
        throw new Error(`[${label}] results must not be present for failed. body: ${snippet()}`);
      }
    }
  }

  // 8. Negative: no error.v1 shape on 200 envelopes
  if ("error" in b && b.error !== null && typeof b.error === "object") {
    const err = b.error as Record<string, unknown>;
    if (typeof err.code === "string" && typeof err.message === "string") {
      throw new Error(`[${label}] unexpected error.v1 shape (code+message) in 200 envelope. body: ${snippet()}`);
    }
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
  analysisInputs: unknown = null,
): Record<string, unknown> {
  return {
    graph,
    analysis_response: null,
    framing,
    messages: [],
    scenario_id: scenarioId,
    ...(analysisInputs !== null && { analysis_inputs: analysisInputs }),
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

    // Warmup: poll /healthz until the server is awake (handles Render cold-start).
    await ensureServerWarmed(CEE_BASE_URL!);
  }, 90_000);

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
  // Test 2: Message → run_analysis (or conversational recovery if LLM
  //   determines interventions are incomplete)
  // --------------------------------------------------------------------------

  it(
    "Test 2: 'run the analysis' with graph triggers run_analysis tool or conversational recovery",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-t2-${randomUUID()}`;
      // interventions must reference factor/outcome nodes (not option nodes)
      const analysisInputs = {
        options: [
          { id: "opt_senior", option_id: "opt_senior",  label: "Hire senior developer",       interventions: { fac_cost: 1, fac_productivity: 1 } },
          { id: "opt_junior", option_id: "opt_junior",  label: "Hire two junior developers",  interventions: { fac_cost: 0.5, fac_productivity: 0.6 } },
        ],
        goal_node_id: "goal_main",
      };
      const result = await makeRequest(ORCHESTRATE_URL, {
        message: "run the analysis",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(
          scenarioId,
          MINIMAL_GRAPH,
          { stage: "evaluate", goal: "Maximise team output" },
          analysisInputs,
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

      if (tp.selected_tool === "run_analysis") {
        // Path (a): LLM routed to run_analysis — full assertion chain
        const blocks = b.blocks as Array<Record<string, unknown>>;
        const hasFact = blocks.some(
          (blk) => blk.block_type === "fact" || blk.type === "fact",
        );
        expect(hasFact, `Expected at least one fact block. Diagnostics: ${JSON.stringify(diag)}`).toBe(true);

        const lineage = b.lineage as Record<string, unknown> | undefined;
        const hasV2Analysis =
          typeof lineage?.response_hash === "string" && lineage.response_hash.length > 0;
        const hasV1Analysis = b.analysis_response != null;

        expect(
          hasV2Analysis || hasV1Analysis,
          `Expected lineage.response_hash (V2) or analysis_response (V1) to be present. ` +
          `Diagnostics: ${JSON.stringify(diag)}`,
        ).toBe(true);
      } else {
        // Path (b): LLM determined interventions incomplete — conversational recovery
        expect(
          typeof b.assistant_text === "string" && (b.assistant_text as string).length > 0,
          `Expected non-empty assistant_text for conversational recovery. Diagnostics: ${JSON.stringify(diag)}`,
        ).toBe(true);
      }
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

  // --------------------------------------------------------------------------
  // Test E1: invalid analysis_inputs (bad goal_node_id) → 200 with either:
  //   (a) pipeline-level analysis_status blocked/failed, OR
  //   (b) LLM conversational recovery (assistant_text present, no tool routed)
  // --------------------------------------------------------------------------

  it(
    "Test E1: run_analysis with invalid goal_node_id returns 200 with blocked/failed or conversational recovery",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-e1-${randomUUID()}`;
      const reqBody = {
        message: "run the analysis",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(
          scenarioId,
          MINIMAL_GRAPH,
          { stage: "evaluate" },
          {
            options: [
              { id: "opt_x", option_id: "opt_x", label: "Bad option A", interventions: { fac_cost: 1 } },
              { id: "opt_y", option_id: "opt_y", label: "Bad option B", interventions: { fac_cost: 0.5 } },
            ],
            goal_node_id: "goal_nonexistent",
          },
        ),
      };
      const result = await makeRequest(ORCHESTRATE_URL, reqBody);
      const diag = {
        url: ORCHESTRATE_URL, status: result.status,
        req: JSON.stringify(reqBody).slice(0, 600), res: JSON.stringify(result.body).slice(0, 600),
      };

      expect(result.status, `Expected 200. Diag: ${JSON.stringify(diag)}`).toBe(200);

      const b = result.body as Record<string, unknown>;

      // Accept EITHER pipeline-level analysis_status OR conversational recovery
      if ("analysis_status" in b) {
        // Path (a): pipeline ran and returned blocked/failed
        const as_ = b.analysis_status as string;
        if (as_ === "blocked") {
          expect(b.retryable, `Expected retryable=false for blocked. Diag: ${JSON.stringify(diag)}`).toBe(false);
          expect(
            Array.isArray(b.critiques) && (b.critiques as unknown[]).length > 0,
            `Expected non-empty critiques for blocked. Diag: ${JSON.stringify(diag)}`,
          ).toBe(true);
          expect("results" in b, `Expected no results for blocked. Diag: ${JSON.stringify(diag)}`).toBe(false);
        } else if (as_ === "failed") {
          expect(typeof b.retryable, `Expected retryable boolean for failed. Diag: ${JSON.stringify(diag)}`).toBe("boolean");
          expect("results" in b, `Expected no results for failed. Diag: ${JSON.stringify(diag)}`).toBe(false);
        } else {
          throw new Error(`[Test E1] unexpected analysis_status: ${as_}. Diag: ${JSON.stringify(diag)}`);
        }

        expect(
          typeof b.status_reason === "string" && (b.status_reason as string).length > 0,
          `Expected non-empty status_reason. Diag: ${JSON.stringify(diag)}`,
        ).toBe(true);
      } else {
        // Path (b): LLM handled it conversationally — valid recovery
        expect(
          typeof b.assistant_text === "string" && (b.assistant_text as string).length > 0,
          `Expected non-empty assistant_text for conversational recovery. Diag: ${JSON.stringify(diag)}`,
        ).toBe(true);
      }

      // V2 envelope uses _route_metadata (not meta); meta only present on analysis path
      if ("meta" in b) {
        const meta = b.meta as Record<string, unknown>;
        expect(typeof meta.request_id, `Expected meta.request_id string. Diag: ${JSON.stringify(diag)}`).toBe("string");
      } else {
        // Conversational recovery: _route_metadata should exist instead
        expect("_route_metadata" in b || "turn_id" in b,
          `Expected _route_metadata or turn_id. Diag: ${JSON.stringify(diag)}`).toBe(true);
      }

      // Negative: no error.v1 shape
      if ("error" in b && b.error !== null && typeof b.error === "object") {
        const err = b.error as Record<string, unknown>;
        expect(
          typeof err.code === "string" && typeof err.message === "string",
          `Expected no error.v1 shape. Diag: ${JSON.stringify(diag)}`,
        ).toBe(false);
      }
    },
  );

  // --------------------------------------------------------------------------
  // Test E2: missing analysis_inputs → 200 with either:
  //   (a) pipeline-level analysis_status blocked, OR
  //   (b) LLM conversational recovery (assistant_text present, no tool routed)
  // --------------------------------------------------------------------------

  it(
    "Test E2: run_analysis without analysis_inputs returns 200 with blocked or conversational recovery",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const scenarioId = `staging-e2-${randomUUID()}`;
      const reqBody = {
        message: "run the analysis",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        // no analysis_inputs — 4th arg omitted
        context: makeContext(scenarioId, MINIMAL_GRAPH, { stage: "evaluate" }),
      };
      const result = await makeRequest(ORCHESTRATE_URL, reqBody);
      const diag = {
        url: ORCHESTRATE_URL, status: result.status,
        req: JSON.stringify(reqBody).slice(0, 600), res: JSON.stringify(result.body).slice(0, 600),
      };

      expect(result.status, `Expected 200. Diag: ${JSON.stringify(diag)}`).toBe(200);

      const b = result.body as Record<string, unknown>;

      // Accept EITHER pipeline-level analysis_status OR conversational recovery
      if ("analysis_status" in b) {
        // Path (a): pipeline ran and returned blocked
        expect(b.analysis_status, `Expected analysis_status=blocked. Diag: ${JSON.stringify(diag)}`).toBe("blocked");
        expect(b.retryable, `Expected retryable=false. Diag: ${JSON.stringify(diag)}`).toBe(false);
        expect(
          Array.isArray(b.critiques) && (b.critiques as unknown[]).length > 0,
          `Expected non-empty critiques. Diag: ${JSON.stringify(diag)}`,
        ).toBe(true);
        expect("results" in b, `Expected no results. Diag: ${JSON.stringify(diag)}`).toBe(false);

        expect(
          typeof b.status_reason === "string" && (b.status_reason as string).length > 0,
          `Expected non-empty status_reason. Diag: ${JSON.stringify(diag)}`,
        ).toBe(true);
      } else {
        // Path (b): LLM handled it conversationally — valid recovery
        expect(
          typeof b.assistant_text === "string" && (b.assistant_text as string).length > 0,
          `Expected non-empty assistant_text for conversational recovery. Diag: ${JSON.stringify(diag)}`,
        ).toBe(true);
      }

      // V2 envelope uses _route_metadata (not meta); meta only present on analysis path
      if ("meta" in b) {
        const meta = b.meta as Record<string, unknown>;
        expect(typeof meta.request_id, `Expected meta.request_id string. Diag: ${JSON.stringify(diag)}`).toBe("string");
      } else {
        expect("_route_metadata" in b || "turn_id" in b,
          `Expected _route_metadata or turn_id. Diag: ${JSON.stringify(diag)}`).toBe(true);
      }

      // Negative: no error.v1 shape
      if ("error" in b && b.error !== null && typeof b.error === "object") {
        const err = b.error as Record<string, unknown>;
        expect(
          typeof err.code === "string" && typeof err.message === "string",
          `Expected no error.v1 shape. Diag: ${JSON.stringify(diag)}`,
        ).toBe(false);
      }
    },
  );

  // --------------------------------------------------------------------------
  // Test E3: missing required scenario_id → 400 with error body
  // --------------------------------------------------------------------------

  it(
    "Test E3: request missing required scenario_id returns 400 with error body",
    { timeout: 60_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const reqBody = {
        // scenario_id intentionally omitted
        client_turn_id: randomUUID(),
        message: "test",
        context: makeContext(randomUUID()),
      } as Record<string, unknown>;
      const result = await makeRequest(ORCHESTRATE_URL, reqBody);
      const diag = {
        url: ORCHESTRATE_URL, status: result.status,
        req: JSON.stringify(reqBody).slice(0, 600), res: JSON.stringify(result.body).slice(0, 600),
      };

      expect(result.status, `Expected 400. Diag: ${JSON.stringify(diag)}`).toBe(400);

      const b = result.body as Record<string, unknown>;
      expect(typeof b === "object" && b !== null, `Expected body to be object. Diag: ${JSON.stringify(diag)}`).toBe(true);

      // Positive: body contains an error indicator (Fastify validation or CEE envelope)
      const hasErrorObj = typeof b.error === "object" && b.error !== null;
      const hasFastifyMessage = typeof b.message === "string" || typeof b.statusCode === "number";
      expect(
        hasErrorObj || hasFastifyMessage,
        `Expected error object or message/statusCode fields. Diag: ${JSON.stringify(diag)}`,
      ).toBe(true);

      // Negative: not an analysis response
      expect("analysis_status" in b, `Expected no analysis_status on 400. Diag: ${JSON.stringify(diag)}`).toBe(false);

      // Do NOT call assertEnvelopeSchema on 400 responses
    },
  );
});
