import { describe, it, expect } from "vitest";
import {
  isDraftGraphResponse,
  isErrorResponse,
  getDiagnosticsFromEvent,
  getGraphCaps,
  getStandardQuota,
  getSseQuota,
} from "./helpers.js";
import type {
  DraftGraphResponse,
  ErrorResponse,
  SseStageEvent,
  SseCompleteEvent,
  SseEvent,
  LimitsResponse,
} from "./types.js";

describe("helpers", () => {
  it("identifies DraftGraphResponse and ErrorResponse by schema", () => {
    const graphResponse: DraftGraphResponse = {
      schema: "draft-graph.v1",
      graph: {
        schema: "graph.v1",
        nodes: [{ id: "n1", kind: "goal", label: "G" }],
        edges: [],
      },
      rationales: [],
      diagnostics: {
        resumes: 0,
        trims: 0,
        recovered_events: 0,
        correlation_id: "req_1",
      },
    };

    const errorResponse: ErrorResponse = {
      schema: "error.v1",
      code: "BAD_INPUT",
      message: "invalid",
    };

    expect(isDraftGraphResponse(graphResponse)).toBe(true);
    expect(isDraftGraphResponse(errorResponse)).toBe(false);
    expect(isErrorResponse(errorResponse)).toBe(true);
    expect(isErrorResponse(graphResponse)).toBe(false);
  });

  it("extracts diagnostics from stage events with DraftGraphResponse payload", () => {
    const response: DraftGraphResponse = {
      schema: "draft-graph.v1",
      graph: {
        schema: "graph.v1",
        nodes: [{ id: "n1", kind: "goal", label: "G" }],
        edges: [],
      },
      rationales: [],
      diagnostics: {
        resumes: 1,
        trims: 2,
        recovered_events: 3,
        correlation_id: "req_diag",
      },
    };

    const event: SseStageEvent = {
      type: "stage",
      data: {
        stage: "COMPLETE",
        payload: response,
      },
    };

    const diagnostics = getDiagnosticsFromEvent(event as SseEvent);
    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.resumes).toBe(1);
    expect(diagnostics?.trims).toBe(2);
    expect(diagnostics?.recovered_events).toBe(3);
    expect(diagnostics?.correlation_id).toBe("req_diag");
  });

  it("returns null diagnostics for non-draft responses", () => {
    const error: ErrorResponse = {
      schema: "error.v1",
      code: "BAD_INPUT",
      message: "invalid",
    };

    const stageWithError: SseStageEvent = {
      type: "stage",
      data: {
        stage: "COMPLETE",
        payload: error,
      },
    };

    const completeWithError: SseCompleteEvent = {
      type: "complete",
      data: error,
    };

    const heartbeat: SseEvent = { type: "heartbeat", data: null };

    expect(getDiagnosticsFromEvent(stageWithError as SseEvent)).toBeNull();
    expect(getDiagnosticsFromEvent(completeWithError as SseEvent)).toBeNull();
    expect(getDiagnosticsFromEvent(heartbeat)).toBeNull();
  });

  it("normalizes graph caps from LimitsResponse", () => {
    const limitsWithGraphCaps: LimitsResponse = {
      schema: "limits.v1",
      key_id: "key_1",
      rate_limit_rpm: 120,
      sse_rate_limit_rpm: 20,
      quota_backend: "redis",
      graph_max_nodes: 50,
      graph_max_edges: 200,
      max_nodes: 40,
      max_edges: 150,
    };

    const caps1 = getGraphCaps(limitsWithGraphCaps);
    expect(caps1.maxNodes).toBe(50);
    expect(caps1.maxEdges).toBe(200);

    const limitsLegacyOnly: LimitsResponse = {
      schema: "limits.v1",
      key_id: "key_2",
      rate_limit_rpm: 120,
      sse_rate_limit_rpm: 20,
      quota_backend: "memory",
      graph_max_nodes: NaN as any,
      graph_max_edges: NaN as any,
      max_nodes: 60,
      max_edges: 240,
    };

    const caps2 = getGraphCaps(limitsLegacyOnly);
    expect(caps2.maxNodes).toBe(60);
    expect(caps2.maxEdges).toBe(240);
  });

  it("normalizes standard and SSE quota snapshots", () => {
    const limits: LimitsResponse = {
      schema: "limits.v1",
      key_id: "key_3",
      rate_limit_rpm: 120,
      sse_rate_limit_rpm: 20,
      quota_backend: "redis",
      graph_max_nodes: 50,
      graph_max_edges: 200,
      max_nodes: 50,
      max_edges: 200,
      standard_quota: {
        capacity_rpm: 120,
        tokens: 10,
        refill_rate_per_sec: 2,
        retry_after_seconds: 5,
      },
      sse_quota: {
        capacity_rpm: 20,
        tokens: 3,
        refill_rate_per_sec: 1,
        retry_after_seconds: 7,
      },
    };

    const standard = getStandardQuota(limits);
    const sse = getSseQuota(limits);

    expect(standard).not.toBeNull();
    expect(standard?.capacityRpm).toBe(120);
    expect(standard?.tokens).toBe(10);
    expect(standard?.refillRatePerSec).toBe(2);
    expect(standard?.retryAfterMs).toBe(5000);

    expect(sse).not.toBeNull();
    expect(sse?.capacityRpm).toBe(20);
    expect(sse?.tokens).toBe(3);
    expect(sse?.refillRatePerSec).toBe(1);
    expect(sse?.retryAfterMs).toBe(7000);
  });
});
