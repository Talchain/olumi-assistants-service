/**
 * V5 edit lifecycle recovery v1 — PR #194 review correction.
 *
 * The V4 `handleEditGraph` no-op branch (edit-graph.ts:1852)
 * previously only logged `"edit_graph returned empty operations
 * (no-op)"` via `log.info`. The V4 PIPELINE emits
 * `edit_graph.no_operations` as a telemetry event
 * (pipeline/phase4-tools/index.ts:203), but the V5 dispatcher
 * never reaches that pipeline code path — so on the V5 dispatch
 * the event was V4-only. Dashboards counting no-op edit_graph
 * rates need the V5 number too.
 *
 * This test pins the emit alongside the existing log line. The
 * `deterministic_chips_emitted` payload field is also asserted so
 * dashboards can split anchored-recovery vs. unanchored
 * (PLoT-only-failure) no-ops.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Capture telemetry emits — wrap the real module so the underlying
// emit still runs (preserves other test invariants) AND we get a
// record of every event name + payload.
const capturedEvents: Array<{ name: string; payload: Record<string, unknown> }> = [];
vi.mock('../../../../src/utils/telemetry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/utils/telemetry.js')>();
  return {
    ...original,
    emit: (name: string, payload: Record<string, unknown>) => {
      capturedEvents.push({ name, payload });
      return original.emit(name as never, payload as never);
    },
  };
});

import { handleEditGraph } from '../../../../src/orchestrator/tools/edit-graph.js';
import type { ConversationContext } from '../../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../../src/adapters/llm/types.js';

function makeContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Revenue' },
        { id: 'factor_1', kind: 'factor', label: 'Price' },
      ],
      edges: [
        {
          from: 'factor_1',
          to: 'goal_1',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 1,
          effect_direction: 'positive',
        },
      ],
    },
    messages: [{ role: 'user', content: 'Make Price more important' }],
    scenario_id: '11111111-2222-3333-4444-555555555555',
    framing: { stage: 'analyse' },
  };
}

function makeNoOpAdapter(): LLMAdapter {
  return {
    name: 'mock',
    model: 'mock',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        operations: [],
        removed_edges: [],
        warnings: [],
      }),
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    chatWithTools: vi.fn(),
  } as unknown as LLMAdapter;
}

describe('handleEditGraph no-op branch — edit_graph.no_operations emit (PR #194 review)', () => {
  beforeEach(() => {
    capturedEvents.length = 0;
    vi.clearAllMocks();
  });

  it('emits TelemetryEvents.EditGraphNoOperations with scenario_id + deterministic_chips_emitted', async () => {
    const ctx = makeContext();
    const adapter = makeNoOpAdapter();

    const result = await handleEditGraph(ctx, 'Make Price more important', adapter, 'req-noop', 'turn-noop');
    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).toBeNull();

    const noOpEvent = capturedEvents.find((e) => e.name === 'edit_graph.no_operations');
    expect(noOpEvent).toBeDefined();
    expect(noOpEvent!.payload.scenario_id).toBe(ctx.scenario_id);
    expect(typeof noOpEvent!.payload.deterministic_chips_emitted).toBe('number');
    // First-attempt LLM no-op with no prior validator failure → no
    // referential-error anchors. Lane 22: the branch now falls back to
    // the shared clarify label chips (never zero-chip canned copy), so
    // the count reflects those chips instead of the pre-Lane-22 zero.
    expect(noOpEvent!.payload.deterministic_chips_emitted).toBeGreaterThan(0);
    expect(noOpEvent!.payload.warnings_dropped).toBe(false);
    expect(noOpEvent!.payload.coaching_dropped).toBe(false);
    expect(noOpEvent!.payload.preceded_by_plot_rejection).toBe(false);
    expect(noOpEvent!.payload.preceded_by_validation_failure).toBe(false);
  });
});
