/**
 * Tests for the deterministic system event handler.
 *
 * Verifies that system events produce valid envelopes without LLM calls,
 * with appropriate acknowledgement text or silent responses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { handleSystemEvent } from "../../../../src/orchestrator/deterministic/system-event-handler.js";
import { log } from "../../../../src/utils/telemetry.js";
import type { OrchestratorTurnRequest, SystemEvent } from "../../../../src/orchestrator/types.js";

function makeTurnRequest(overrides: Partial<OrchestratorTurnRequest> = {}): OrchestratorTurnRequest {
  return {
    message: '',
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: 'frame' },
      messages: [],
      scenario_id: 'test-scenario',
    },
    scenario_id: 'test-scenario',
    client_turn_id: 'test-turn',
    ...overrides,
  };
}

function makeEvent(type: string, details: Record<string, unknown> = {}): SystemEvent {
  return {
    event_type: type,
    timestamp: new Date().toISOString(),
    event_id: 'evt-1',
    details,
  } as unknown as SystemEvent;
}

describe("handleSystemEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no system_event is present", () => {
    const req = makeTurnRequest();
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).toBeNull();
  });

  // ── direct_graph_edit ────────────────────────────────────────────────────

  it("direct_graph_edit without user message → acknowledgement text", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('direct_graph_edit', {
        changed_node_ids: ['fac_1'],
        changed_edge_ids: [],
        operations: ['update_node'],
      }),
      message: '',
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBe('Noted the changes to your model.');
    expect(result!.httpStatus).toBe(200);
    expect(result!.envelope.blocks).toEqual([]);
  });

  it("direct_graph_edit with user message → acknowledgement text", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('direct_graph_edit', {
        changed_node_ids: ['fac_1'],
        changed_edge_ids: [],
        operations: ['update_node'],
      }),
      message: 'I changed the cost factor',
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBe('Noted the changes to your model.');
  });

  // ── patch_accepted ────────────────────────────────────────────────────────

  it("patch_accepted → acknowledgement text", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('patch_accepted', {
        patch_id: 'p-1',
        operations: [{ op: 'add_node' }],
      }),
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBe('Changes applied.');
    expect(result!.httpStatus).toBe(200);
  });

  // ── patch_dismissed ───────────────────────────────────────────────────────

  it("patch_dismissed → acknowledgement text", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('patch_dismissed', {
        patch_id: 'p-1',
        reason: 'user_rejected',
      }),
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBe('Changes dismissed.');
  });

  // ── direct_analysis_run ───────────────────────────────────────────────────

  it("direct_analysis_run → informational message", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('direct_analysis_run', {}),
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toContain('Analysis is running');
  });

  // ── feedback_submitted ────────────────────────────────────────────────────

  it("feedback_submitted → silent response (no assistant_text)", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('feedback_submitted', {
        turn_id: 't-1',
        rating: 'up',
      }),
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBeNull();
  });

  // ── unknown event type ────────────────────────────────────────────────────

  it("unknown event type → silent response with warning log", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('totally_unknown_event', {}),
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'totally_unknown_event' }),
      'deterministic.system_event.unknown_type',
    );
  });

  // ── envelope validity ─────────────────────────────────────────────────────

  it("all responses have valid envelope structure", () => {
    const events = ['patch_accepted', 'patch_dismissed', 'direct_graph_edit', 'direct_analysis_run', 'feedback_submitted'];
    for (const eventType of events) {
      const req = makeTurnRequest({
        system_event: makeEvent(eventType, {
          // Provide minimal details for each type
          changed_node_ids: [],
          changed_edge_ids: [],
          operations: [],
          patch_id: 'p-1',
          turn_id: 't-1',
          rating: 'up',
        }),
      });
      const result = handleSystemEvent(req, 'turn-1', 'req-1');
      expect(result).not.toBeNull();
      expect(result!.envelope).toHaveProperty('turn_id', 'turn-1');
      expect(result!.envelope).toHaveProperty('blocks');
      expect(Array.isArray(result!.envelope.blocks)).toBe(true);
      expect(result!.envelope).toHaveProperty('turn_plan');
      expect(result!.envelope.turn_plan.routing).toBe('deterministic');
      expect(result!.httpStatus).toBe(200);
    }
  });

  // ── logging ───────────────────────────────────────────────────────────────

  it("logs deterministic.system_event_handled for all events", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('patch_accepted', { patch_id: 'p-1', operations: [] }),
    });
    handleSystemEvent(req, 'turn-1', 'req-1');
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'req-1',
        event_type: 'patch_accepted',
        response_type: 'acknowledgement',
      }),
      'deterministic.system_event_handled',
    );
  });

  // ── temperature verification ──────────────────────────────────────────────

  it("system event handler never calls LLM (no temperature value in result)", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('direct_graph_edit', {
        changed_node_ids: ['fac_1'],
        changed_edge_ids: [],
        operations: ['update_node'],
      }),
      message: 'Tell me about the changes',
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    // System events have 0 prompt chars — no LLM call
    expect(result!._quality?.prompt_char_count).toBe(0);
  });
});
