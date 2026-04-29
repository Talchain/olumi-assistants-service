import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
}));

vi.mock('../../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'maxRepairRetries') return 1;
              if (ceeProp === 'patchPreValidationEnabled') return false;
              if (ceeProp === 'patchBudgetEnabled') return false;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { handleEditGraph } from '../../../../src/orchestrator/tools/edit-graph.js';
import { log } from '../../../../src/utils/telemetry.js';
import type { ConversationContext } from '../../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../../src/adapters/llm/types.js';
import type { PLoTClient, ValidatePatchResult } from '../../../../src/orchestrator/plot-client.js';

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'fac_delivery_cost', kind: 'factor', label: 'Delivery Cost' },
        { id: 'opt_offshore_partner', kind: 'option', label: 'Offshore Partner' },
      ],
      edges: [
        {
          from: 'fac_delivery_cost',
          to: 'goal_revenue',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'negative',
        },
      ],
    } as unknown as ConversationContext['graph'],
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'test-scenario',
    ...overrides,
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

function makePlotClientSuccess(): PLoTClient {
  const result: ValidatePatchResult = {
    kind: 'success',
    data: { verdict: 'accepted' },
  };
  return {
    run: vi.fn().mockResolvedValue({}),
    validatePatch: vi.fn().mockResolvedValue(result),
  };
}

const VALID_UPDATE_OP = {
  op: 'update_node',
  path: 'fac_delivery_cost',
  value: { label: 'Delivery Cost (updated)' },
};

// ============================================================================
// Tests — Layer 1 entity-ID leak guard
// ============================================================================

describe('handleEditGraph — Layer 1 entity-ID leak guard', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(log, 'info').mockImplementation(() => log);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('replaces fac_delivery_cost in coaching.summary with "Delivery Cost"', async () => {
    const adapter = makeAdapter({
      operations: [VALID_UPDATE_OP],
      warnings: [],
      coaching: {
        summary: 'I updated fac_delivery_cost — this should reduce risk on goal_revenue.',
        rerun_recommended: false,
      },
    });

    const result = await handleEditGraph(
      makeContext(),
      'Update delivery cost',
      adapter,
      'req-leak-1',
      'turn-1',
      { plotClient: makePlotClientSuccess() },
    );

    expect(result.assistantText).toBeTruthy();
    expect(result.assistantText).not.toContain('fac_delivery_cost');
    expect(result.assistantText).toContain('Delivery Cost');
    expect(result.assistantText).toContain('Revenue');
  });

  it('replaces opt_offshore_partner in warnings[] with "Offshore Partner"', async () => {
    const adapter = makeAdapter({
      operations: [VALID_UPDATE_OP],
      warnings: ['Note: opt_offshore_partner may need re-evaluation.'],
      coaching: null,
    });

    const result = await handleEditGraph(
      makeContext(),
      'Update something',
      adapter,
      'req-leak-2',
      'turn-1',
      { plotClient: makePlotClientSuccess() },
    );

    expect(result.assistantText).toBeTruthy();
    expect(result.assistantText).not.toContain('opt_offshore_partner');
    expect(result.assistantText).toContain('Offshore Partner');
  });

  it('falls back to prefix-aware generic when ID is not in graph', async () => {
    // Graph has fac_delivery_cost but coaching references a missing fac_unknown_thing.
    const adapter = makeAdapter({
      operations: [VALID_UPDATE_OP],
      warnings: [],
      coaching: {
        summary: 'Adjust fac_unknown_thing to see the impact.',
        rerun_recommended: false,
      },
    });

    const result = await handleEditGraph(
      makeContext(),
      'Adjust unknown',
      adapter,
      'req-leak-3',
      'turn-1',
      { plotClient: makePlotClientSuccess() },
    );

    expect(result.assistantText).not.toContain('fac_unknown_thing');
    expect(result.assistantText).toContain('the relevant factor');
  });

  it('clean coaching → no rewrite, no leak telemetry', async () => {
    const adapter = makeAdapter({
      operations: [VALID_UPDATE_OP],
      warnings: [],
      coaching: {
        summary: 'I made the change — please re-run analysis to confirm.',
        rerun_recommended: true,
      },
    });

    const result = await handleEditGraph(
      makeContext(),
      'Update',
      adapter,
      'req-clean-1',
      'turn-1',
      { plotClient: makePlotClientSuccess() },
    );

    expect(result.assistantText).toContain('I made the change');
    const leakCall = infoSpy.mock.calls.find(
      (c) => (c[0] as Record<string, unknown> | undefined)?.event === 'v5.internal_id_leak_caught',
    );
    expect(leakCall).toBeUndefined();
  });

  it('emits v5.internal_id_leak_caught telemetry with handler_id="edit_graph"', async () => {
    const adapter = makeAdapter({
      operations: [VALID_UPDATE_OP],
      warnings: [],
      coaching: {
        summary: 'fac_delivery_cost is the lever.',
        rerun_recommended: false,
      },
    });

    await handleEditGraph(
      makeContext(),
      'Update',
      adapter,
      'req-telemetry-1',
      'turn-1',
      { plotClient: makePlotClientSuccess() },
    );

    const leakCall = infoSpy.mock.calls.find(
      (c) => (c[0] as Record<string, unknown> | undefined)?.event === 'v5.internal_id_leak_caught',
    );
    expect(leakCall).toBeDefined();
    const payload = leakCall?.[0] as Record<string, unknown>;
    expect(payload.handler_id).toBe('edit_graph');
    expect(payload.prefix).toBe('fac');
    expect(payload.resolution).toBe('label');
    // Layer 1 includes the raw text snippet for triage — asymmetry vs Layer 2.
    expect(payload.snippet).toContain('fac_delivery_cost');
  });
});
