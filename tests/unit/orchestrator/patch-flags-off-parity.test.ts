/**
 * Flags-off parity tests (Fix 7).
 *
 * Prove that disabling CEE_PATCH_BUDGET_ENABLED / CEE_PATCH_PRE_VALIDATION_ENABLED
 * restores pre-cf-v11.1 behaviour: patches that would be rejected by the new guards
 * pass through handleEditGraph and produce a graph_patch block.
 *
 * Both tests use a mock LLM adapter (no real LLM calls) and null PLoT client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
}));

let mockPatchBudgetEnabled = false;
let mockPatchPreValidationEnabled = false;

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'maxRepairRetries') return 0;
              if (ceeProp === 'patchBudgetEnabled') return mockPatchBudgetEnabled;
              if (ceeProp === 'patchPreValidationEnabled') return mockPatchPreValidationEnabled;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { handleEditGraph } from '../../../src/orchestrator/tools/edit-graph.js';
import type { ConversationContext, GraphPatchBlockData } from '../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../src/adapters/llm/types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Revenue' },
        { id: 'dec_1', kind: 'decision', label: 'Choose' },
        { id: 'opt_a', kind: 'option', label: 'Option A' },
        { id: 'opt_b', kind: 'option', label: 'Option B' },
        { id: 'fac_1', kind: 'factor', label: 'Price' },
      ],
      edges: [
        { from: 'dec_1', to: 'opt_a' },
        { from: 'dec_1', to: 'opt_b' },
        { from: 'opt_a', to: 'fac_1' },
        { from: 'opt_b', to: 'fac_1' },
        { from: 'fac_1', to: 'goal_1' },
      ],
    } as unknown as ConversationContext['graph'],
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'test-scenario',
  };
}

function makeAdapter(responseJson: unknown): LLMAdapter {
  return {
    name: 'test',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({ content: JSON.stringify(responseJson) }),
    draftGraph: vi.fn(),
    repairGraph: vi.fn(),
    suggestOptions: vi.fn(),
    clarifyBrief: vi.fn(),
    critiqueGraph: vi.fn(),
    explainDiff: vi.fn(),
  } as unknown as LLMAdapter;
}

// ============================================================================
// Tests
// ============================================================================

describe('Flags-off parity: CEE_PATCH_BUDGET_ENABLED=false', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatchBudgetEnabled = false;
    mockPatchPreValidationEnabled = false;
  });

  it('5 node ops passes through handleEditGraph without rejection when budget flag is off', async () => {
    // 5 node ops — would exceed the 3-node budget
    const ops = [
      { op: 'update_node', path: 'goal_1', value: { label: 'Revenue v2' } },
      { op: 'update_node', path: 'dec_1', value: { label: 'Choose v2' } },
      { op: 'update_node', path: 'opt_a', value: { label: 'Option A v2' } },
      { op: 'update_node', path: 'opt_b', value: { label: 'Option B v2' } },
      { op: 'update_node', path: 'fac_1', value: { label: 'Price v2' } },
    ];
    const adapter = makeAdapter(ops);

    const result = await handleEditGraph(
      makeContext(),
      'Rename everything',
      adapter,
      'req-1',
      'turn-1',
      { maxRetries: 0 },
    );

    // GraphPatchBlock IS returned — no rejection envelope
    expect(result.wasRejected).not.toBe(true);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe('proposed');
    expect(data.operations.length).toBeGreaterThanOrEqual(5);
  });
});

describe('Flags-off parity: CEE_PATCH_PRE_VALIDATION_ENABLED=false', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatchBudgetEnabled = false;
    mockPatchPreValidationEnabled = false;
  });

  it('orphan-creating patch passes through handleEditGraph without rejection when pre-validation flag is off', async () => {
    // add_node with no edges → would create an orphan (ORPHAN_NODE violation)
    const ops = [
      { op: 'add_node', path: 'orphan_1', value: { id: 'orphan_1', kind: 'factor', label: 'Disconnected' } },
    ];
    const adapter = makeAdapter(ops);

    const result = await handleEditGraph(
      makeContext(),
      'Add disconnected factor',
      adapter,
      'req-2',
      'turn-2',
      { maxRetries: 0 },
    );

    // GraphPatchBlock IS returned — no rejection envelope
    expect(result.wasRejected).not.toBe(true);
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe('proposed');
    expect(data.operations.some((o) => o.path === 'orphan_1')).toBe(true);
  });
});
