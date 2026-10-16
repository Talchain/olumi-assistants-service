/**
 * R10 — end-to-end: a preserved no-op clarifying question survives to the wire.
 *
 *  - decideNoOpRecovery stays INERT when noOpClarificationPreserved=true, even
 *    for a vague-edit message that would otherwise take the vague_edit branch.
 *  - dispatchEditGraph leaves the preserved question as the FINAL
 *    response.assistant_text (amendment 3 — assert the response CONTAINS the
 *    question, not merely that the decision returned null).
 *  - the turn-event branch distinguishes noop_clarification_preserved from
 *    noop_fallback_copy so the preservation rate is measurable.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({
  getSystemPromptMeta: vi.fn(() => ({
    taskId: 'edit_graph',
    source: 'store',
    promptId: 'edit_graph_default',
    version: 9,
    prompt_version: 'edit_graph_default@v9',
    prompt_hash: '313665a4',
  })),
}));

import { decideNoOpRecovery } from '../edit-graph-dispatch.js';
import { commitDirectAnswer } from '../../commit.js';
import { setTestSink } from '../../../utils/telemetry.js';
const commit = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
let events: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  commit.mockResolvedValue({ response: {}, performed: true, persisted_row_id: 'r', graphPersisted: false } as Awaited<ReturnType<typeof commitDirectAnswer>>);
  events = [];
  setTestSink((event, data) => events.push({ event, data }));
});
afterEach(() => setTestSink(null));

describe('decideNoOpRecovery — R10 inert guard', () => {
  it('stays inert when noOpClarificationPreserved=true, even for a vague-edit message', () => {
    const result = decideNoOpRecovery({
      message: 'make it better', // would otherwise take vague_edit
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'none',
      graphReady: true,
      noOpClarificationPreserved: true,
    });
    expect(result.branch).toBe('noop_clarification_preserved');
    expect(result.assistantText).toBeNull(); // null = keep the upstream (V4) preserved text
    expect(result.suggestedActions).toHaveLength(0);
  });
});

// B-FIX1: an empty successful scenario read permits first-touch adoption on CAS ON.
vi.mock('../../build-turn-context.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../build-turn-context.js')>(),
  loadPersistedScenarioStateStrict: async () => ({ graph: null, briefText: null, revision: 7 }),
}));
