/**
 * System Event Router Tests (Brief C)
 *
 * Tests: routing, handler logic, silent envelope invariant, path equivalence,
 * [system] context injection, guidance refresh, PLoT integration paths.
 */

import { describe, it, expect, vi } from "vitest";
import { routeSystemEvent, appendSystemMessages } from "../../../src/orchestrator/system-event-router.js";
import type { SystemEvent, OrchestratorTurnRequest, ConversationMessage } from "../../../src/orchestrator/types.js";
import type { PLoTClient, ValidatePatchResult } from "../../../src/orchestrator/plot-client.js";
import type { V2RunResponseEnvelope } from "../../../src/orchestrator/types.js";

// ============================================================================
// Fixtures
// ============================================================================

const SCENARIO_ID = 'scenario-abc';
const CLIENT_TURN_ID = 'client-turn-1';
const REQUEST_ID = 'req-1';
const TURN_ID = 'turn-1';

const BASE_GRAPH = {
  nodes: [{ id: 'n1', kind: 'factor', label: 'Revenue' }],
  edges: [],
};

/** A message containing a pending graph_patch block (status: 'proposed'). */
const PENDING_PATCH_MESSAGE: ConversationMessage = {
  role: 'assistant',
  content: {
    blocks: [
      { block_type: 'graph_patch', data: { patch_type: 'edit', operations: [], status: 'proposed' } },
    ],
  },
} as unknown as ConversationMessage;

function makeRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  return {
    message: 'hello',
    scenario_id: SCENARIO_ID,
    client_turn_id: CLIENT_TURN_ID,
    context: {
      graph: null,
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: SCENARIO_ID,
    },
    ...overrides,
  } as OrchestratorTurnRequest;
}

/** makeRequest with a pending patch in context.messages (for patch_accepted/dismissed tests). */
function makeRequestWithPendingPatch(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  const base = makeRequest(overrides);
  base.context.messages = [PENDING_PATCH_MESSAGE, ...base.context.messages];
  return base;
}

function makePatchAccepted(overrides?: Record<string, unknown>): SystemEvent {
  return {
    event_type: 'patch_accepted',
    timestamp: '2026-03-03T00:00:00Z',
    event_id: 'evt-1',
    details: {
      patch_id: 'patch-1',
      operations: [{ op: 'add_node', path: '/nodes/-', value: {} }],
      ...overrides,
    },
  } as SystemEvent;
}

function makeAnalysisState(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 100, response_hash: 'rh-abc' },
    results: [],
    fact_objects: [],
    review_cards: [],
    response_hash: 'rh-abc',
  } as unknown as V2RunResponseEnvelope;
}

function makePlotClient(result: ValidatePatchResult): PLoTClient {
  return {
    validatePatch: vi.fn().mockResolvedValue(result),
    run: vi.fn(),
  } as unknown as PLoTClient;
}

// ============================================================================
// appendSystemMessages
// ============================================================================

describe('appendSystemMessages', () => {
  it('returns new array with system messages appended', () => {
    const messages: ConversationMessage[] = [{ role: 'user', content: 'hi' }];
    const result = appendSystemMessages(messages, ['[system] Something happened.']);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: 'hi' });
    expect(result[1]).toEqual({ role: 'user', content: '[system] Something happened.' });
  });

  it('returns same array reference when entries is empty', () => {
    const messages: ConversationMessage[] = [{ role: 'user', content: 'hi' }];
    const result = appendSystemMessages(messages, []);
    expect(result).toBe(messages);
  });

  it('does not mutate the original messages array', () => {
    const messages: ConversationMessage[] = [{ role: 'user', content: 'hi' }];
    appendSystemMessages(messages, ['[system] foo']);
    expect(messages).toHaveLength(1);
  });
});

// ============================================================================
// Silent envelope invariant
// ============================================================================

describe('Silent envelope invariant', () => {
  it('patch_dismissed: returns blocks:[] and guidanceItems:[]', async () => {
    const event: SystemEvent = {
      event_type: 'patch_dismissed',
      timestamp: '2026-03-03T00:00:00Z',
      event_id: 'evt-d1',
      details: { patch_id: 'p1' },
    };

    // Must use makeRequestWithPendingPatch so hasPendingPatch guard passes
    const result = await routeSystemEvent({
      event,
      turnRequest: makeRequestWithPendingPatch(),
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      plotClient: null,
    });

    // patch_dismissed now produces a confirmation string (not null)
    expect(typeof result.assistantText).toBe('string');
    expect(result.blocks).toEqual([]);
    expect(result.guidanceItems).toEqual([]);
    expect(result.httpStatus).toBe(200);
    expect(result.error).toBeUndefined();
  });

  it('feedback_submitted: returns blocks:[] and guidanceItems:[], no context injection', async () => {
    const event: SystemEvent = {
      event_type: 'feedback_submitted',
      timestamp: '2026-03-03T00:00:00Z',
      event_id: 'evt-f1',
      details: { turn_id: 'turn-1', rating: 'up' },
    };

    const result = await routeSystemEvent({
      event,
      turnRequest: makeRequest(),
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      plotClient: null,
    });

    // feedback_submitted now produces a confirmation string (not null)
    expect(typeof result.assistantText).toBe('string');
    expect(result.blocks).toEqual([]);
    expect(result.guidanceItems).toEqual([]);
    expect(result.systemContextEntries).toEqual([]);  // No context injection for feedback
    expect(result.httpStatus).toBe(200);
  });
});

// ============================================================================
// patch_accepted
// ============================================================================

describe('patch_accepted', () => {
  describe('Path A (applied_graph_hash present + graph_state present)', () => {
    it('does NOT call PLoT validate-patch', async () => {
      const mockClient = makePlotClient({ kind: 'success', data: {} });
      const event = makePatchAccepted({ applied_graph_hash: 'graph-hash-123' });

      await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: mockClient,
      });

      expect(mockClient.validatePatch).not.toHaveBeenCalled();
    });

    it('uses applied_graph_hash for graphHash output', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-from-ui' });

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.graphHash).toBe('gh-from-ui');
      expect(result.httpStatus).toBe(200);
      expect(result.error).toBeUndefined();
    });

    it('refreshes guidance from graph_state', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-from-ui' });

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      // guidanceItems may be [] if the simple graph has no structural issues — that is acceptable
      expect(Array.isArray(result.guidanceItems)).toBe(true);
    });

    it('injects [system] context entry with patch_id and graph_hash', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-abc' });

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.systemContextEntries).toHaveLength(1);
      expect(result.systemContextEntries[0]).toContain('[system]');
      expect(result.systemContextEntries[0]).toContain('patch-1');
      expect(result.systemContextEntries[0]).toContain('gh-abc');
    });

    it('produces a graph_patch block', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-abc' });

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].block_type).toBe('graph_patch');
    });

    it('GUARD: applied_graph_hash present but graph_state missing → 400 MISSING_GRAPH_STATE', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-abc' });

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: undefined }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.httpStatus).toBe(400);
      expect(result.error?.code).toBe('MISSING_GRAPH_STATE');
      // Silent envelope invariant still holds
      expect(result.assistantText).toBeNull();
      expect(result.blocks).toEqual([]);
      expect(result.guidanceItems).toEqual([]);
    });
  });

  describe('Path B (no applied_graph_hash)', () => {
    it('calls PLoT validate-patch', async () => {
      const mockClient = makePlotClient({ kind: 'success', data: { graph_hash: 'gh-plot' } });
      const event = makePatchAccepted();

      await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: mockClient,
      });

      expect(mockClient.validatePatch).toHaveBeenCalledOnce();
    });

    it('applied: returns graph_hash from PLoT and patch block', async () => {
      const mockClient = makePlotClient({ kind: 'success', data: { graph_hash: 'gh-from-plot' } });
      const event = makePatchAccepted();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: mockClient,
      });

      expect(result.graphHash).toBe('gh-from-plot');
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].block_type).toBe('graph_patch');
      // patch_accepted Path B now produces a confirmation string
      expect(typeof result.assistantText).toBe('string');
    });

    it('rejection: returns rejection block and deterministic text', async () => {
      const mockClient = makePlotClient({ kind: 'rejection', status: 'rejected', code: 'CYCLE_DETECTED', message: 'Cycle in graph' });
      const event = makePatchAccepted();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: mockClient,
      });

      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].block_type).toBe('graph_patch');
      expect((result.blocks[0].data as unknown as Record<string, unknown>).status).toBe('rejected');
      expect(result.assistantText).toContain('Cycle in graph');
      expect(result.graphHash).toBeUndefined();
    });

    it('feature_disabled: returns "unavailable" message, no applied block', async () => {
      const mockClient = makePlotClient({ kind: 'feature_disabled' });
      const event = makePatchAccepted();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: mockClient,
      });

      expect(result.assistantText).toContain('unavailable');
      expect(result.blocks).toEqual([]);
      expect(result.graphHash).toBeUndefined();
    });

    it('plotClient=null: returns "unavailable" message, no applied block', async () => {
      const event = makePatchAccepted();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.assistantText).toContain('unavailable');
      expect(result.blocks).toEqual([]);
      expect(result.graphHash).toBeUndefined();
    });

    it('graph_state missing → 400 MISSING_GRAPH_STATE', async () => {
      const event = makePatchAccepted(); // no applied_graph_hash

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: undefined }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.httpStatus).toBe(400);
      expect(result.error?.code).toBe('MISSING_GRAPH_STATE');
    });
  });
});

// ============================================================================
// patch_dismissed
// ============================================================================

describe('patch_dismissed', () => {
  it('returns confirmation text and context entry', async () => {
    const event: SystemEvent = {
      event_type: 'patch_dismissed',
      timestamp: '2026-03-03T00:00:00Z',
      event_id: 'evt-d1',
      details: { patch_id: 'p1', reason: 'not needed' },
    };

    const result = await routeSystemEvent({
      event,
      turnRequest: makeRequestWithPendingPatch(),
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      plotClient: null,
    });

    expect(result.assistantText).toBe('Suggested changes dismissed. The model is unchanged.');
    expect(result.blocks).toEqual([]);
    expect(result.guidanceItems).toEqual([]);
    expect(result.systemContextEntries).toHaveLength(1);
    expect(result.systemContextEntries[0]).toContain('[system]');
    expect(result.systemContextEntries[0]).toContain('p1');
    expect(result.httpStatus).toBe(200);
  });

  it('uses block_id as fallback for patch_id in context entry', async () => {
    const event: SystemEvent = {
      event_type: 'patch_dismissed',
      timestamp: '2026-03-03T00:00:00Z',
      event_id: 'evt-d2',
      details: { block_id: 'blk-abc' },
    };

    const result = await routeSystemEvent({
      event,
      turnRequest: makeRequestWithPendingPatch(),
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      plotClient: null,
    });

    expect(result.systemContextEntries[0]).toContain('blk-abc');
  });
});

// ============================================================================
// direct_graph_edit
// ============================================================================

describe('direct_graph_edit', () => {
  it('injects [system] context entry with node/edge counts', async () => {
    const event: SystemEvent = {
      event_type: 'direct_graph_edit',
      timestamp: '2026-03-03T00:00:00Z',
      event_id: 'evt-ge1',
      details: {
        changed_node_ids: ['n1', 'n2'],
        changed_edge_ids: ['e1'],
        operations: ['add', 'update'],
      },
    };

    const result = await routeSystemEvent({
      event,
      turnRequest: makeRequest(),
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      plotClient: null,
    });

    expect(result.systemContextEntries).toHaveLength(1);
    expect(result.systemContextEntries[0]).toContain('[system]');
    expect(result.systemContextEntries[0]).toContain('2 node');
    expect(result.systemContextEntries[0]).toContain('1 edge');
  });

  it('refreshes guidance when graph_state is present', async () => {
    const event: SystemEvent = {
      event_type: 'direct_graph_edit',
      timestamp: '2026-03-03T00:00:00Z',
      event_id: 'evt-ge2',
      details: {
        changed_node_ids: ['n1'],
        changed_edge_ids: [],
        operations: ['update'],
      },
    };

    const result = await routeSystemEvent({
      event,
      turnRequest: makeRequest({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      plotClient: null,
    });

    expect(Array.isArray(result.guidanceItems)).toBe(true);
  });

  it('returns empty guidance when graph_state absent', async () => {
    const event: SystemEvent = {
      event_type: 'direct_graph_edit',
      timestamp: '2026-03-03T00:00:00Z',
      event_id: 'evt-ge3',
      details: {
        changed_node_ids: ['n1'],
        changed_edge_ids: [],
        operations: ['update'],
      },
    };

    const result = await routeSystemEvent({
      event,
      turnRequest: makeRequest({ graph_state: undefined }),
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      plotClient: null,
    });

    expect(result.guidanceItems).toEqual([]);
  });
});

// ============================================================================
// direct_analysis_run
// ============================================================================

describe('direct_analysis_run', () => {
  const makeDirectAnalysisEvent = (): SystemEvent => ({
    event_type: 'direct_analysis_run',
    timestamp: '2026-03-03T00:00:00Z',
    event_id: 'evt-dar1',
    details: {},
  });

  // direct_analysis_run requires graph_state or context.graph (cf-v11.1 guard)
  const withGraph = { graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] };

  describe('Path A (analysis_state present)', () => {
    it('does NOT set delegateToTool', async () => {
      const event = makeDirectAnalysisEvent();
      const analysisState = makeAnalysisState();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequest({ analysis_state: analysisState, ...withGraph }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.delegateToTool).toBeUndefined();
    });

    it('returns blocks and guidance from pure transformer', async () => {
      const event = makeDirectAnalysisEvent();
      const analysisState = makeAnalysisState();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequest({ analysis_state: analysisState, ...withGraph }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(Array.isArray(result.blocks)).toBe(true);
      expect(Array.isArray(result.guidanceItems)).toBe(true);
      expect(result.analysisResponse).toBe(analysisState);
    });

    it('injects [system] context entry', async () => {
      const event = makeDirectAnalysisEvent();
      const analysisState = makeAnalysisState();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequest({ analysis_state: analysisState, ...withGraph }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.systemContextEntries).toHaveLength(1);
      expect(result.systemContextEntries[0]).toContain('[system]');
      expect(result.systemContextEntries[0]).toContain('Play button');
    });

    it('no narration needed when message is trivial (≤5 chars)', async () => {
      const event = makeDirectAnalysisEvent();
      const analysisState = makeAnalysisState();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequest({ message: 'hi', analysis_state: analysisState, ...withGraph }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.needsNarration).toBeFalsy();
    });

    it('needsNarration=true when meaningful message accompanies', async () => {
      const event = makeDirectAnalysisEvent();
      const analysisState = makeAnalysisState();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequest({ message: 'What does this mean?', analysis_state: analysisState, ...withGraph }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.needsNarration).toBe(true);
    });
  });

  describe('Path B (no analysis_state)', () => {
    it('returns delegateToTool: run_analysis', async () => {
      const event = makeDirectAnalysisEvent();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequest({ analysis_state: undefined, ...withGraph }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.delegateToTool).toBe('run_analysis');
      // Silent envelope invariant for the returned shell
      expect(result.assistantText).toBeNull();
      expect(result.blocks).toEqual([]);
      expect(result.guidanceItems).toEqual([]);
    });

    it('injects [system] context entry even when delegating', async () => {
      const event = makeDirectAnalysisEvent();

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequest({ analysis_state: undefined, ...withGraph }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.systemContextEntries).toHaveLength(1);
      expect(result.systemContextEntries[0]).toContain('[system]');
    });
  });
});

// ============================================================================
// feedback_submitted
// ============================================================================

describe('feedback_submitted', () => {
  it('logs and returns confirmation text, no context injection', async () => {
    const event: SystemEvent = {
      event_type: 'feedback_submitted',
      timestamp: '2026-03-03T00:00:00Z',
      event_id: 'evt-fb1',
      details: { turn_id: 'turn-x', rating: 'down', comment: 'not helpful' },
    };

    const result = await routeSystemEvent({
      event,
      turnRequest: makeRequest(),
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      plotClient: null,
    });

    expect(result.assistantText).toBe('Thanks for your feedback.');
    expect(result.blocks).toEqual([]);
    expect(result.guidanceItems).toEqual([]);
    expect(result.systemContextEntries).toEqual([]);
    expect(result.httpStatus).toBe(200);
    expect(result.error).toBeUndefined();
  });
});

// ============================================================================
// Path equivalence test
// ============================================================================

describe('Path equivalence: direct_analysis_run Path B vs run_analysis message', () => {
  it('direct_analysis_run Path B returns delegateToTool=run_analysis (same routing as message)', async () => {
    // Both paths route to run_analysis tool handler — verified by checking delegateToTool signal.
    // The actual response_hash and lineage equality is verified in integration tests where
    // the tool handler runs with the same fixture seed.
    const event: SystemEvent = {
      event_type: 'direct_analysis_run',
      timestamp: '2026-03-03T00:00:00Z',
      event_id: 'evt-eq1',
      details: {},
    };

    const result = await routeSystemEvent({
      event,
      turnRequest: makeRequest({ analysis_state: undefined, graph_state: { nodes: [{ id: 'n1', kind: 'factor', label: 'Rev' }], edges: [] } as unknown as OrchestratorTurnRequest['graph_state'] }),
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      plotClient: null,
    });

    // Path B must delegate to the exact same tool handler as "run the analysis" message
    expect(result.delegateToTool).toBe('run_analysis');
  });
});

// ============================================================================
// assistant_text null serialisation
// ============================================================================

describe('assistant_text null serialisation', () => {
  it('delegating events have assistant_text as null (not undefined, not omitted)', async () => {
    // direct_analysis_run Path B (delegateToTool) still returns assistantText: null
    // — the tool handler produces the final text. Verify null serialisation holds.
    const event: SystemEvent = {
      event_type: 'direct_analysis_run',
      timestamp: '2026-03-03T00:00:00Z',
      event_id: 'evt-null1',
      details: { message: 'run it' },
    };

    const result = await routeSystemEvent({
      event,
      turnRequest: makeRequest({
        analysis_state: undefined,
        graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'],
      }),
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      plotClient: null,
    });

    // Must be null, not undefined
    expect(result.assistantText).toBeNull();

    // JSON serialisation: null should appear in output (not be omitted)
    const serialised = JSON.stringify({ assistant_text: result.assistantText });
    expect(serialised).toContain('"assistant_text":null');
  });
});

// ============================================================================
// Confirmation text — Task 2
// ============================================================================

describe('Confirmation text (Task 2)', () => {
  describe('patch_accepted — Path A', () => {
    it('returns non-null assistantText containing "applied"', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-abc' });
      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.assistantText).not.toBeNull();
      expect(result.assistantText).toContain('applied');
    });

    it('assistantText does not contain em dashes', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-abc' });
      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.assistantText).not.toMatch(/\u2014/); // em dash
    });

    it('includes stale-analysis entry when analysis is present', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-abc' });
      const analysisState = makeAnalysisState();
      const request = makeRequestWithPendingPatch({
        graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'],
      });
      request.context.analysis_response = analysisState;

      const result = await routeSystemEvent({
        event,
        turnRequest: request,
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      const staleEntry = result.systemContextEntries.find(e => e.includes('stale'));
      expect(staleEntry).toBe('[system] Analysis is now stale. Rerun recommended.');
    });

    it('does not include stale-analysis entry when no analysis', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-abc' });
      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      const staleEntry = result.systemContextEntries.find(e => e.includes('stale'));
      expect(staleEntry).toBeUndefined();
    });

    it('sets rerun_recommended: true when analysis is present', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-abc' });
      const analysisState = makeAnalysisState();
      const request = makeRequestWithPendingPatch({
        graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'],
      });
      request.context.analysis_response = analysisState;

      const result = await routeSystemEvent({
        event,
        turnRequest: request,
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.rerun_recommended).toBe(true);
    });

    it('rerun_recommended is undefined when no analysis', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-abc' });
      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.rerun_recommended).toBeUndefined();
    });

    it('assistantText is a single well-formed sentence (no doubled punctuation)', async () => {
      const event = makePatchAccepted({ applied_graph_hash: 'gh-abc' });
      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      // Must end with exactly one period and not contain '. applied' (doubled punctuation)
      expect(result.assistantText).toMatch(/\.$/);
      expect(result.assistantText).not.toMatch(/\.\s+applied/i);
    });
  });

  describe('patch_accepted — Path B success', () => {
    it('returns non-null assistantText containing "applied"', async () => {
      const mockClient = makePlotClient({ kind: 'success', data: { graph_hash: 'gh-plot' } });
      const event = makePatchAccepted();
      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch({ graph_state: BASE_GRAPH as unknown as OrchestratorTurnRequest['graph_state'] }),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: mockClient,
      });

      expect(result.assistantText).not.toBeNull();
      expect(result.assistantText).toContain('applied');
    });
  });

  describe('patch_dismissed', () => {
    it('returns exact confirmation string', async () => {
      const event: SystemEvent = {
        event_type: 'patch_dismissed',
        timestamp: '2026-03-03T00:00:00Z',
        event_id: 'evt-pd-conf',
        details: { patch_id: 'p2' },
      };
      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequestWithPendingPatch(),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.assistantText).toBe('Suggested changes dismissed. The model is unchanged.');
    });
  });

  describe('direct_graph_edit', () => {
    it('returns exact confirmation string', async () => {
      const event: SystemEvent = {
        event_type: 'direct_graph_edit',
        timestamp: '2026-03-03T00:00:00Z',
        event_id: 'evt-dge-conf',
        details: {
          changed_node_ids: ['n1'],
          changed_edge_ids: [],
          operations: ['update'],
        },
      };
      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequest(),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.assistantText).toBe('Your graph changes have been noted.');
    });
  });

  describe('feedback_submitted', () => {
    it('returns exact confirmation string', async () => {
      const event: SystemEvent = {
        event_type: 'feedback_submitted',
        timestamp: '2026-03-03T00:00:00Z',
        event_id: 'evt-fb-conf',
        details: { turn_id: 'turn-1', rating: 'up' },
      };
      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequest(),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.assistantText).toBe('Thanks for your feedback.');
    });
  });

  describe('unknown event_type', () => {
    it('returns 200 with silent envelope and does not crash', async () => {
      const event = {
        event_type: 'unknown_future_event',
        timestamp: '2026-03-03T00:00:00Z',
        event_id: 'evt-unk1',
        details: {},
      } as unknown as SystemEvent;

      const result = await routeSystemEvent({
        event,
        turnRequest: makeRequest(),
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        plotClient: null,
      });

      expect(result.httpStatus).toBe(200);
      expect(result.assistantText).toBeNull();
      expect(result.blocks).toEqual([]);
      expect(result.guidanceItems).toEqual([]);
      expect(result.error).toBeUndefined();
    });
  });
});
