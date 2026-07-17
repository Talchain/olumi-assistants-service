/**
 * TRUST-SPINE RED — T6 / board item #6 (roadmap 1.53): per-turn cap split-path.
 *
 * Acceptance floor (Paul-approved plan agile-finding-harp.md §3 item 6):
 *   ">15-op edit gets a split/continuation or an honest bounded refusal with a
 *    next step. Test: 20-op edit → no dead end."
 *
 * DEFECT (plan §1 CONFIRMED DEFECT #2): an over-cap edit (config.cee.maxPatchOperations
 * default 15) rejects the WHOLE batch with a bare `MAX_OPERATIONS_EXCEEDED`
 * (edit-graph.ts:2146-2172 → buildRejectionResult(...,'MAX_OPERATIONS_EXCEEDED')).
 * Nothing is applied, there is no split/continuation anywhere in the file, and the
 * user-facing copy is a static deflection that asks the USER to re-scope — a dead
 * end, not a bounded refusal that carries a concrete next step for THIS batch.
 *
 * it.fails semantics: the body asserts the HONEST-FUTURE behaviour (the over-cap
 * edit is NOT answered with the bare whole-batch MAX_OPERATIONS_EXCEEDED), which
 * THROWS today (the code IS exactly that) — so `it.fails` reports GREEN while the
 * defect stands. When board #6 lands (a split/continuation OR a distinct bounded
 * refusal), the body passes, `it.fails` fails loudly, and the fixer converts it to
 * `it()`.
 *
 * In-process: the LLM adapter is a fake returning a fixed 20-op array; the config is
 * proxied (cap 15, retries 0, pre-validation/budget off). No network, no DB — runs
 * in the required gate. (Mock header + helpers mirror the sibling
 * edit-graph-max-ops.test.ts.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks — must be declared before imports (vi.mock is hoisted, file-scoped) ──

vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
}));

let mockMaxPatchOperations = 15;

vi.mock('../../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'maxRepairRetries') return 0;
              if (ceeProp === 'maxPatchOperations') return mockMaxPatchOperations;
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
import type { ConversationContext, GraphPatchBlockData } from '../../../../src/orchestrator/types.js';
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
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
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

// 20 non-structural update_node ops → skips the structural intent guard and lands
// squarely on the cap check (cap 15).
const TWENTY_OPS = Array.from({ length: 20 }, (_, i) => ({
  op: 'update_node',
  path: 'factor_1',
  value: { label: `Label ${i}` },
}));

describe('TRUST-SPINE T6 — over-cap edit gets a split/continuation, not a dead end (board #6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaxPatchOperations = 15;
  });

  // POSITIVE CONTROL (regular it — GREEN today): a within-cap edit is accepted and
  // applied. Proves the harness drives the real edit path and the cap boundary is
  // real — so the RED assertion below (over-cap dead end) is not vacuous.
  it('positive control: a 15-op edit (at the cap) is accepted (proposed), not rejected', async () => {
    mockMaxPatchOperations = 15;
    const ops = Array.from({ length: 15 }, (_, i) => ({
      op: 'update_node',
      path: 'factor_1',
      value: { label: `Label ${i}` },
    }));
    const result = await handleEditGraph(
      makeContext(),
      'Batch edit',
      makeAdapter(ops),
      'req-cap-ok',
      'turn-cap-ok',
    );
    const data = result.blocks[0].data as GraphPatchBlockData;
    expect(data.status).toBe('proposed');
    expect(data.operations).toHaveLength(15);
  });

  // TRUST-SPINE RED: flips to it() when board-item 6 lands.
  // Honest future: a 20-op edit does NOT dead-end on the bare whole-batch
  // MAX_OPERATIONS_EXCEEDED rejection — it splits/continues, or refuses with a
  // concrete next step under a distinct signal. TODAY the rejection code IS exactly
  // 'MAX_OPERATIONS_EXCEEDED' with nothing applied, so the assertion throws → RED.
  it.fails(
    'a 20-op edit is not answered with the bare whole-batch MAX_OPERATIONS_EXCEEDED',
    async () => {
      mockMaxPatchOperations = 15;
      const result = await handleEditGraph(
        makeContext(),
        'Bulk edit',
        makeAdapter(TWENTY_OPS),
        'req-cap-split',
        'turn-cap-split',
        { maxRetries: 0 },
      );
      const data = result.blocks[0].data as GraphPatchBlockData;
      expect(data.rejection?.code).not.toBe('MAX_OPERATIONS_EXCEEDED');
      // Corollary: the diagnostics failure_code is set exclusively on this cap
      // dead-end path; an honest split/continuation would not carry it.
      expect(result.diagnostics?.failure_code).not.toBe('max_operations_exceeded');
    },
  );
});
