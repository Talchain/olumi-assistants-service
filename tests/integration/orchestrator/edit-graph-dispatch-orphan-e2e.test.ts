/**
 * End-to-end integration test — orphan-option replay through
 * `dispatchEditGraph`.
 *
 * Unlike the `handleEditGraph`-level test in
 * `edit-graph-orphan-option-replay.test.ts`, this exercises the full
 * V5 dispatch path: real `handleEditGraph`, real composer, mocked LLM,
 * mocked commit. Asserts the wire envelope (boundary OlumiResponseSchema)
 * carries the rejection block + violation_codes when repair exhausts.
 *
 * What this pins:
 *   1. `dispatchEditGraph` invokes `handleEditGraph` with the ingress
 *      graph, the LLM emits orphan responses, repair exhausts, and the
 *      final result reaches `editResultToOlumiResponse`.
 *   2. The wire `OlumiResponse` carries:
 *      - `blocks`: 1 boundary `error` block with
 *        `details.rejection_code === 'OPTION_NO_FACTOR_EDGES'` and
 *        `details.violation_codes === ['OPTION_NO_FACTOR_EDGES']`.
 *      - `suggested_actions`: recovery chips (Try a simpler change /
 *        Start fresh — from the V4 rejection envelope).
 *      - `assistant_text`: user-friendly message (raw violator text
 *        suppressed).
 *   3. `analysisReady` is undefined (no graph commit on rejection).
 *   4. `metadata.graph` passed to `commitDirectAnswer` is undefined.
 *   5. Final response passes `OlumiResponseSchema.parse` without throwing.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

// ────────────────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────────────────

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You edit causal decision graphs'),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'maxRepairRetries') return 1;
              if (ceeProp === 'patchPreValidationEnabled') return true;
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

const { llmChatMock } = vi.hoisted(() => ({ llmChatMock: vi.fn() }));
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    name: 'test',
    model: 'test-model',
    chat: llmChatMock,
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../src/orchestrator-v5/commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

// ────────────────────────────────────────────────────────────────────
// Imports after mocks
// ────────────────────────────────────────────────────────────────────

import { dispatchEditGraph } from '../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';
import { commitDirectAnswer } from '../../../src/orchestrator-v5/commit.js';
import type { GraphStateIngress } from '../../../src/orchestrator-v5/boundary/request-extensions.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// ────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

const HIRING_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_hiring', kind: 'decision', label: 'Hiring decision' },
    { id: 'opt_hire_fte', kind: 'option', label: 'Hire FTE' },
    { id: 'opt_freeze', kind: 'option', label: 'Freeze hiring' },
    { id: 'fac_payroll', kind: 'factor', label: 'Payroll cost' },
    { id: 'goal_growth', kind: 'goal', label: 'Growth' },
  ],
  edges: [
    { from: 'dec_hiring', to: 'opt_hire_fte' },
    { from: 'dec_hiring', to: 'opt_freeze' },
    { from: 'opt_hire_fte', to: 'fac_payroll' },
    { from: 'opt_freeze', to: 'fac_payroll' },
    { from: 'fac_payroll', to: 'goal_growth' },
  ],
};

const ORPHAN_OPTION_RESPONSE = {
  operations: [
    {
      op: 'add_node',
      path: '/nodes/opt_contract_hiring',
      value: {
        id: 'opt_contract_hiring',
        kind: 'option',
        label: 'Contract hiring',
        data: { interventions: {} },
      },
      impact: 'moderate',
      rationale: 'Adds contract hiring option.',
    },
    {
      op: 'add_edge',
      path: '/edges/dec_hiring->opt_contract_hiring',
      value: {
        from: 'dec_hiring',
        to: 'opt_contract_hiring',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
      impact: 'moderate',
      rationale: 'Wires decision to new option.',
    },
    // INTENTIONALLY MISSING: opt_contract_hiring → fac_payroll edge.
  ],
  removed_edges: [],
  warnings: [],
  coaching: { summary: 'Added contract hiring option.', rerun_recommended: true },
};

function makePayload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Add an option for contract hiring',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  };
}

beforeEach(() => {
  llmChatMock.mockReset();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockReset();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
    .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);
});

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('dispatchEditGraph e2e — orphan-option replay', () => {
  it('LLM emits orphan option, repair exhausts → wire envelope carries OPTION_NO_FACTOR_EDGES + boundary-valid', async () => {
    // Both attempts (initial + 1 repair) emit the same orphan response.
    llmChatMock.mockResolvedValue({ content: JSON.stringify(ORPHAN_OPTION_RESPONSE) });

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-e2e-orphan',
      request: STUB_REQUEST,
      graphState: HIRING_GRAPH,
      analysisState: null,
    });

    // Repair was attempted (LLM called twice).
    expect(llmChatMock).toHaveBeenCalledTimes(2);

    // Wire envelope: error block carries the specific code.
    expect(result.response.blocks).toHaveLength(1);
    const block = result.response.blocks[0]!;
    expect(block.type).toBe('error');
    if (block.type === 'error') {
      expect(block.error_code).toBe('INTERNAL_ERROR');
      expect(block.severity).toBe('warn');
      expect(block.details!.source).toBe('edit_graph');
      expect(block.details!.rejection_code).toBe('OPTION_NO_FACTOR_EDGES');
      expect(block.details!.violation_codes).toEqual(['OPTION_NO_FACTOR_EDGES']);
      // Raw failure_message must NOT be on the wire — stable codes only.
      expect(block.details!.reason).toBeUndefined();
    }

    // Recovery chips from rejection envelope.
    expect(result.response.suggested_actions.length).toBeGreaterThan(0);

    // No graph commit on rejection.
    const [, metadata] = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls[0]!;
    expect(metadata.graph).toBeUndefined();

    // analysis_ready undefined on rejection.
    expect(result.analysisReady).toBeUndefined();

    // Boundary validity pinned end-to-end.
    expect(() => OlumiResponseSchema.parse(result.response)).not.toThrow();
  });
});
