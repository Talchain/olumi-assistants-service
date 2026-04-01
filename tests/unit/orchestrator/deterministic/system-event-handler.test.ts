/**
 * Tests for the deterministic system event handler.
 *
 * Verifies that system events produce valid envelopes without LLM calls.
 * Events without a user message → silent (null assistant_text).
 * Events with a user message → brief acknowledgement from template.
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
      framing: { stage: 'ideate' },
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

  // ── Silent behavior: no user message → null assistant_text ───────────────

  it("direct_graph_edit without user message → silent", () => {
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
    expect(result!.envelope.assistant_text).toBeNull();
  });

  it("patch_accepted without user message → silent", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('patch_accepted', { patch_id: 'p-1', operations: [] }),
      message: '',
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBeNull();
  });

  it("patch_dismissed without user message → silent", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('patch_dismissed', { patch_id: 'p-1', reason: 'user_rejected' }),
      message: '',
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBeNull();
  });

  it("direct_analysis_run without user message → silent", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('direct_analysis_run', {}),
      message: '',
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBeNull();
  });

  it("feedback_submitted → always silent regardless of message", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('feedback_submitted', { turn_id: 't-1', rating: 'up' }),
      message: 'I liked that response',
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBeNull();
  });

  // ── Acknowledgement behavior: with user message → template text ──────────

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

  it("patch_accepted with user message → acknowledgement text", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('patch_accepted', { patch_id: 'p-1', operations: [] }),
      message: 'Accept the changes',
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBe('Changes applied.');
  });

  it("direct_analysis_run with user message → informational message", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('direct_analysis_run', {}),
      message: 'Run the analysis',
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toContain('Analysis is running');
  });

  // ── Unknown event type ────────────────────────────────────────────────────

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

  it("unknown event type with user message → still silent", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('totally_unknown_event', {}),
      message: 'Some message',
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result).not.toBeNull();
    expect(result!.envelope.assistant_text).toBeNull();
  });

  // ── Envelope structure ────────────────────────────────────────────────────

  it("all responses have valid envelope structure", () => {
    const events = ['patch_accepted', 'patch_dismissed', 'direct_graph_edit', 'direct_analysis_run', 'feedback_submitted'];
    for (const eventType of events) {
      const req = makeTurnRequest({
        system_event: makeEvent(eventType, {
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

  it("stage_indicator uses context framing stage, not hardcoded frame", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('patch_accepted', { patch_id: 'p-1', operations: [] }),
      context: {
        graph: null,
        analysis_response: null,
        framing: { stage: 'evaluate' },
        messages: [],
        scenario_id: 'test-scenario',
      },
    });
    const result = handleSystemEvent(req, 'turn-1', 'req-1');
    expect(result!.envelope.stage_indicator).toBe('evaluate');
  });

  // ── Logging ───────────────────────────────────────────────────────────────

  it("logs silent response_type for no-message events", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('patch_accepted', { patch_id: 'p-1', operations: [] }),
      message: '',
    });
    handleSystemEvent(req, 'turn-1', 'req-1');
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'patch_accepted',
        has_user_message: false,
        response_type: 'silent',
      }),
      'deterministic.system_event_handled',
    );
  });

  it("logs acknowledgement response_type for message events", () => {
    const req = makeTurnRequest({
      system_event: makeEvent('patch_accepted', { patch_id: 'p-1', operations: [] }),
      message: 'Apply the patch',
    });
    handleSystemEvent(req, 'turn-1', 'req-1');
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'patch_accepted',
        has_user_message: true,
        response_type: 'acknowledgement',
      }),
      'deterministic.system_event_handled',
    );
  });

  // ── No LLM call ──────────────────────────────────────────────────────────

  it("system event handler never calls LLM (0 prompt chars)", () => {
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
    expect(result!._quality?.prompt_char_count).toBe(0);
  });
});
