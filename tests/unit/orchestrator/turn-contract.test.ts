/**
 * Turn Contract Tests (Task 4)
 *
 * Tests turn-type inference, contract field validation, and partial field diagnostics.
 * Minimum 20 test cases covering the full turn-type × field matrix.
 */
import { describe, it, expect } from "vitest";
import {
  inferTurnType,
  validateTurnContract,
  TURN_FIELD_CONTRACT,
  TURN_CONTRACT_VERSION,
} from "../../../src/orchestrator/turn-contract.js";
import type { TurnType, ContractField } from "../../../src/orchestrator/turn-contract.js";

// ============================================================================
// Helpers
// ============================================================================

function makeBaseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message: 'Hello',
    scenario_id: 'sc-1',
    client_turn_id: 'ct-1',
    ...overrides,
  };
}

const VALID_ANALYSIS_STATE = {
  meta: { response_hash: 'rh-1', seed_used: 1, n_samples: 1000 },
  results: [{ option_id: 'a', win_probability: 0.6 }],
  analysis_status: 'completed',
};

const VALID_SYSTEM_EVENT = {
  event_type: 'direct_analysis_run',
  timestamp: '2026-03-12T00:00:00Z',
  event_id: 'evt-1',
  details: {},
};

// ============================================================================
// Turn Type Inference
// ============================================================================

describe("inferTurnType", () => {
  it("returns 'system_event' when system_event is present", () => {
    const body = makeBaseBody({ system_event: VALID_SYSTEM_EVENT });
    expect(inferTurnType(body)).toBe('system_event');
  });

  it("returns 'explicit_generate' when generate_model is true", () => {
    const body = makeBaseBody({ generate_model: true });
    expect(inferTurnType(body)).toBe('explicit_generate');
  });

  it("returns 'run_analysis' when message matches analysis intent pattern", () => {
    const body = makeBaseBody({ message: 'run the analysis' });
    expect(inferTurnType(body)).toBe('run_analysis');
  });

  it("returns 'explain' when message matches explain intent pattern", () => {
    const body = makeBaseBody({ message: 'explain' });
    expect(inferTurnType(body)).toBe('explain');
  });

  it("returns 'conversation' for a bare message with no special fields", () => {
    const body = makeBaseBody({ message: 'What should I consider?' });
    expect(inferTurnType(body)).toBe('conversation');
  });

  it("returns 'clarification_response' when pending_clarification exists in conversational_state", () => {
    const body = makeBaseBody({
      context: {
        conversational_state: {
          pending_clarification: { tool: 'edit_graph', question: 'Which node?' },
        },
      },
    });
    expect(inferTurnType(body)).toBe('clarification_response');
  });

  it("returns 'patch_followup' when message is a confirmation and pending_proposal exists", () => {
    const body = makeBaseBody({
      message: 'yes',
      context: {
        conversational_state: {
          pending_proposal: { tool: 'edit_graph', original_edit_request: 'add X' },
        },
      },
    });
    expect(inferTurnType(body)).toBe('patch_followup');
  });

  it("returns 'patch_followup' when message is 'apply it' with recent edit_graph tool call in history", () => {
    const body = makeBaseBody({
      message: 'apply it',
      conversation_history: [
        { role: 'user', content: 'add a cost factor' },
        { role: 'assistant', content: null, tool_calls: [{ name: 'edit_graph', input: {} }] },
      ],
    });
    expect(inferTurnType(body)).toBe('patch_followup');
  });

  it("returns 'conversation' when graph_state is present but no patch signal", () => {
    // Correction: graph_state alone does NOT trigger patch_followup
    const body = makeBaseBody({
      graph_state: { nodes: [{ id: 'g1', kind: 'goal' }], edges: [] },
    });
    expect(inferTurnType(body)).toBe('conversation');
  });

  it("system_event takes priority over generate_model", () => {
    const body = makeBaseBody({
      system_event: VALID_SYSTEM_EVENT,
      generate_model: true,
    });
    expect(inferTurnType(body)).toBe('system_event');
  });
});

// ============================================================================
// Contract Validation — Per Turn Type
// ============================================================================

describe("validateTurnContract", () => {
  describe("contract_version", () => {
    it("includes the contract version in diagnostics", () => {
      const result = validateTurnContract('conversation', makeBaseBody());
      expect(result.contract_version).toBe(TURN_CONTRACT_VERSION);
      expect(result.contract_version).toBe('1.0');
    });
  });

  describe("conversation turn", () => {
    it("valid payload passes with no issues", () => {
      const body = makeBaseBody();
      const result = validateTurnContract('conversation', body);
      expect(result.inferred_turn_type).toBe('conversation');
      expect(result.forbidden_fields_present).toEqual([]);
      expect(result.missing_required_fields).toEqual([]);
    });

    it("flags system_event as forbidden", () => {
      const body = makeBaseBody({ system_event: VALID_SYSTEM_EVENT });
      const result = validateTurnContract('conversation', body);
      expect(result.forbidden_fields_present).toContain('system_event');
    });

    it("flags missing message as required", () => {
      const body = { scenario_id: 'sc-1', client_turn_id: 'ct-1' };
      const result = validateTurnContract('conversation', body);
      expect(result.missing_required_fields).toContain('message');
    });
  });

  describe("system_event turn", () => {
    it("valid payload passes with no issues", () => {
      const body = makeBaseBody({ system_event: VALID_SYSTEM_EVENT });
      const result = validateTurnContract('system_event', body);
      expect(result.forbidden_fields_present).toEqual([]);
      expect(result.missing_required_fields).toEqual([]);
    });

    it("flags missing system_event as required", () => {
      const body = makeBaseBody();
      const result = validateTurnContract('system_event', body);
      expect(result.missing_required_fields).toContain('system_event');
    });
  });

  describe("explicit_generate turn", () => {
    it("valid payload passes", () => {
      const body = makeBaseBody({ generate_model: true });
      const result = validateTurnContract('explicit_generate', body);
      expect(result.forbidden_fields_present).toEqual([]);
      expect(result.missing_required_fields).toEqual([]);
    });

    it("flags analysis_state as forbidden", () => {
      const body = makeBaseBody({
        generate_model: true,
        analysis_state: VALID_ANALYSIS_STATE,
      });
      const result = validateTurnContract('explicit_generate', body);
      expect(result.forbidden_fields_present).toContain('analysis_state');
    });

    it("flags system_event as forbidden", () => {
      const body = makeBaseBody({
        generate_model: true,
        system_event: VALID_SYSTEM_EVENT,
      });
      const result = validateTurnContract('explicit_generate', body);
      expect(result.forbidden_fields_present).toContain('system_event');
    });
  });

  describe("run_analysis turn", () => {
    it("flags missing graph_state and analysis_inputs as required", () => {
      const body = makeBaseBody({ message: 'run the analysis' });
      const result = validateTurnContract('run_analysis', body);
      expect(result.missing_required_fields).toContain('graph_state');
      expect(result.missing_required_fields).toContain('analysis_inputs');
    });
  });

  describe("explain turn", () => {
    it("flags missing analysis_state as required", () => {
      const body = makeBaseBody({ message: 'explain the results' });
      const result = validateTurnContract('explain', body);
      expect(result.missing_required_fields).toContain('analysis_state');
    });
  });

  describe("patch_followup turn", () => {
    it("flags missing conversation_history as required", () => {
      const body = makeBaseBody({ message: 'yes' });
      const result = validateTurnContract('patch_followup', body);
      expect(result.missing_required_fields).toContain('conversation_history');
    });
  });

  describe("clarification_response turn", () => {
    it("flags missing conversation_history as required", () => {
      const body = makeBaseBody();
      const result = validateTurnContract('clarification_response', body);
      expect(result.missing_required_fields).toContain('conversation_history');
    });
  });
});

// ============================================================================
// Partial Field Diagnostics
// ============================================================================

describe("validateTurnContract — partial_fields", () => {
  it("detects partial analysis_state with missing meta", () => {
    const body = makeBaseBody({
      analysis_state: {
        analysis_status: 'completed',
        results: [],
        // meta is missing entirely
      },
    });
    const result = validateTurnContract('conversation', body);
    expect(result.partial_fields).toHaveProperty('analysis_state');
    expect(result.partial_fields.analysis_state!.missing).toContain('meta');
    expect(result.partial_fields.analysis_state!.missing).toContain('meta.response_hash');
  });

  it("analysis_state with meta.response_hash but no results/option_comparison is not flagged as partial (schema refine handles this)", () => {
    const body = makeBaseBody({
      analysis_state: {
        meta: { response_hash: 'rh-1' },
        // results and option_comparison both missing — Zod refine rejects,
        // but turn-contract diagnostic only checks structural keys (meta).
      },
    });
    const result = validateTurnContract('conversation', body);
    // meta is present and complete → no partial diagnostic (Zod is authoritative)
    expect(result.partial_fields).not.toHaveProperty('analysis_state');
  });

  it("detects partial analysis_state with meta present but missing response_hash", () => {
    const body = makeBaseBody({
      analysis_state: {
        meta: { seed_used: 1 },
        results: [],
      },
    });
    const result = validateTurnContract('conversation', body);
    expect(result.partial_fields).toHaveProperty('analysis_state');
    expect(result.partial_fields.analysis_state!.missing).toContain('meta.response_hash');
    expect(result.partial_fields.analysis_state!.present).toContain('meta');
  });

  it("complete analysis_state produces no partial_fields entry", () => {
    const body = makeBaseBody({
      analysis_state: VALID_ANALYSIS_STATE,
    });
    const result = validateTurnContract('conversation', body);
    expect(result.partial_fields).not.toHaveProperty('analysis_state');
  });

  it("null analysis_state produces no partial_fields entry", () => {
    const body = makeBaseBody({ analysis_state: null });
    const result = validateTurnContract('conversation', body);
    expect(result.partial_fields).not.toHaveProperty('analysis_state');
  });
});

// ============================================================================
// Contract Completeness
// ============================================================================

describe("TURN_FIELD_CONTRACT completeness", () => {
  const ALL_TURN_TYPES: TurnType[] = [
    'conversation', 'explicit_generate', 'run_analysis',
    'system_event', 'patch_followup', 'explain', 'clarification_response',
  ];

  const ALL_FIELDS: ContractField[] = [
    'message', 'scenario_id', 'client_turn_id', 'conversation_history',
    'graph_state', 'analysis_state', 'analysis_inputs', 'system_event',
    'selected_elements',
  ];

  it("every turn type has an entry for every field", () => {
    for (const turnType of ALL_TURN_TYPES) {
      const contract = TURN_FIELD_CONTRACT[turnType];
      expect(contract, `Missing contract for turn type: ${turnType}`).toBeDefined();
      for (const field of ALL_FIELDS) {
        expect(contract[field], `Missing field '${field}' in contract for '${turnType}'`).toBeDefined();
        expect(['required', 'optional', 'forbidden']).toContain(contract[field]);
      }
    }
  });

  it("scenario_id and client_turn_id are required for all turn types", () => {
    for (const turnType of ALL_TURN_TYPES) {
      expect(TURN_FIELD_CONTRACT[turnType].scenario_id).toBe('required');
      expect(TURN_FIELD_CONTRACT[turnType].client_turn_id).toBe('required');
    }
  });
});
