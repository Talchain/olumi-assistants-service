import { describe, it, expect, vi } from 'vitest';
import { routeSystemEvent } from '../../../src/orchestrator/system-event-router.js';
import type { SystemEvent, OrchestratorTurnRequest, ConversationMessage } from '../../../src/orchestrator/types.js';

// Suppress log output
vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

function makeRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  return {
    message: 'hello',
    scenario_id: 'scenario-1',
    client_turn_id: 'turn-1',
    context: {
      graph: null,
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: 'scenario-1',
    },
    ...overrides,
  } as OrchestratorTurnRequest;
}

describe('System event validation (Task 6)', () => {
  it('patch_accepted with no pending patch → logs warning, returns silent envelope (no error)', async () => {
    const { log } = await import('../../../src/utils/telemetry.js');

    const event: SystemEvent = {
      event_type: 'patch_accepted',
      timestamp: '2026-03-09T00:00:00Z',
      event_id: 'evt-1',
      details: {
        patch_id: 'patch-1',
        operations: [{ op: 'add_node', path: '/nodes/-', value: {} }],
      },
    } as SystemEvent;

    // No messages → no pending patch
    const request = makeRequest();

    const result = await routeSystemEvent({
      event,
      turnRequest: request,
      turnId: 'turn-1',
      requestId: 'req-1',
      plotClient: null,
    });

    // Silent envelope — no error, no assistant text
    expect(result.httpStatus).toBe(200);
    expect(result.assistantText).toBeNull();
    expect(result.blocks).toHaveLength(0);
    expect(result.error).toBeUndefined();

    // Warning logged
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'no_pending_patch' }),
      expect.any(String),
    );
  });

  it('direct_analysis_run with no graph → returns helpful conversational response', async () => {
    const event: SystemEvent = {
      event_type: 'direct_analysis_run',
      timestamp: '2026-03-09T00:00:00Z',
      event_id: 'evt-2',
      details: {},
    } as SystemEvent;

    // No graph_state anywhere
    const request = makeRequest({
      graph_state: undefined,
      context: {
        graph: null,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: 'scenario-1',
      },
    } as Partial<OrchestratorTurnRequest>);

    const result = await routeSystemEvent({
      event,
      turnRequest: request,
      turnId: 'turn-2',
      requestId: 'req-2',
      plotClient: null,
    });

    expect(result.httpStatus).toBe(200);
    expect(result.assistantText).toBeTruthy();
    expect(result.assistantText).toContain('model');
    expect(result.error).toBeUndefined();
  });
});
