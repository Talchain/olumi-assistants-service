/**
 * Integration test — orphan-option replay through handleEditGraph.
 *
 * Pins the end-to-end behaviour for "Add an option" requests when the LLM
 * emits an incomplete option (only `add_node` + `decision → option` edge,
 * no `option → factor` edge). The new `OPTION_NO_FACTOR_EDGES` rule in
 * `validateGraphStructure` catches this in the post-apply structural
 * validation cascade, and edit-graph.ts:1905 now allows the structural
 * intent path to enter the repair loop specifically for this code.
 *
 * Behaviour pinned:
 *
 *   1. **Repair-then-fix:** LLM emits orphan option on attempt 1
 *      (only `add_node` + decision-edge, no factor-edge) → validator
 *      returns `OPTION_NO_FACTOR_EDGES` → repair attempt fed back to LLM
 *      → attempt 2 emits the complete option with the missing
 *      option → factor edge → validation passes, graph applied.
 *
 *   2. **Repair exhausted:** LLM emits orphan option on every attempt
 *      → final attempt rejects via the structural-intent rejection
 *      envelope; `result.wasRejected === true`, `appliedGraph === null`,
 *      and `diagnostics.validation_violation_codes` includes
 *      `'OPTION_NO_FACTOR_EDGES'`. The V5 dispatch composer reads this
 *      diagnostics field to synthesise the wire error block.
 *
 *   3. **Sanity:** LLM emits the complete option on attempt 1 → accepted,
 *      no `OPTION_NO_FACTOR_EDGES` violation.
 *
 * NOTE on the repair-eligible set: at edit-graph.ts:1905, the structural
 * intent path enters the repair loop only when ALL new violations are
 * in `STRUCTURAL_REPAIRABLE_CODES` (currently just `OPTION_NO_FACTOR_EDGES`).
 * Other structural failures (NO_GOAL, CYCLE_DETECTED, etc.) keep the
 * pre-existing immediate-reject behaviour, preserving the safety contract.
 *
 * Test setup:
 * - `patchPreValidationEnabled = true` so the post-apply structural
 *   validation block runs.
 * - `maxRepairRetries = 1` allows one repair attempt (so totalAttempts = 2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────────────────

let patchPreValidationEnabledForTest = true;

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
              if (ceeProp === 'patchPreValidationEnabled') return patchPreValidationEnabledForTest;
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

import { handleEditGraph } from '../../../src/orchestrator/tools/edit-graph.js';
import type { ConversationContext } from '../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../src/adapters/llm/types.js';

beforeEach(() => {
  patchPreValidationEnabledForTest = true;
});

// ────────────────────────────────────────────────────────────────────
// Hiring-scenario context (decision + 2 existing options + factor + goal)
// ────────────────────────────────────────────────────────────────────

function makeHiringContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'dec_hiring', kind: 'decision', label: 'Hiring decision' },
        { id: 'opt_hire_fte', kind: 'option', label: 'Hire FTE' },
        { id: 'opt_freeze', kind: 'option', label: 'Freeze hiring' },
        { id: 'fac_payroll', kind: 'factor', label: 'Payroll cost' },
        { id: 'goal_growth', kind: 'goal', label: 'Growth' },
      ],
      edges: [
        { from: 'dec_hiring', to: 'opt_hire_fte', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'dec_hiring', to: 'opt_freeze', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_hire_fte', to: 'fac_payroll', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_freeze', to: 'fac_payroll', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'fac_payroll', to: 'goal_growth', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.85, effect_direction: 'negative' },
      ],
    } as unknown as ConversationContext['graph'],
    analysis_response: null,
    framing: null,
    messages: [],
    conversational_state: {
      active_entities: [],
      stated_constraints: [],
      current_topic: 'editing',
      last_failed_action: null,
    },
    scenario_id: 'test-scenario-orphan-option',
  };
}

// LLM payload: incomplete option (no option → factor edge).
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
      rationale: 'Adds a contract hiring option as a third alternative.',
    },
    {
      op: 'add_edge',
      path: '/edges/dec_hiring->opt_contract_hiring',
      value: {
        from: 'dec_hiring',
        to: 'opt_contract_hiring',
        strength: { mean: 1.0, std: 0.01 },
        exists_probability: 1.0,
        effect_direction: 'positive',
      },
      impact: 'moderate',
      rationale: 'Wires decision to the new option.',
    },
    // INTENTIONALLY MISSING: opt_contract_hiring → fac_payroll structural edge.
  ],
  removed_edges: [],
  warnings: [],
  coaching: { summary: 'Added contract hiring option.', rerun_recommended: true },
};

// LLM payload: complete option (with the option → factor structural edge).
const COMPLETE_OPTION_RESPONSE = {
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
      rationale: 'Adds a contract hiring option as a third alternative.',
    },
    {
      op: 'add_edge',
      path: '/edges/dec_hiring->opt_contract_hiring',
      value: {
        from: 'dec_hiring',
        to: 'opt_contract_hiring',
        strength: { mean: 1.0, std: 0.01 },
        exists_probability: 1.0,
        effect_direction: 'positive',
      },
      impact: 'moderate',
      rationale: 'Wires decision to the new option.',
    },
    {
      op: 'add_edge',
      path: '/edges/opt_contract_hiring->fac_payroll',
      value: {
        from: 'opt_contract_hiring',
        to: 'fac_payroll',
        strength: { mean: 1.0, std: 0.01 },
        exists_probability: 1.0,
        effect_direction: 'positive',
      },
      impact: 'moderate',
      rationale: 'Connects new option to payroll factor.',
    },
  ],
  removed_edges: [],
  warnings: [],
  coaching: { summary: 'Added contract hiring option with payroll wiring.', rerun_recommended: true },
};

function makeAdapter(response: object): LLMAdapter {
  return {
    name: 'test',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({ content: JSON.stringify(response) }),
    draftGraph: vi.fn(),
    repairGraph: vi.fn(),
    suggestOptions: vi.fn(),
    clarifyBrief: vi.fn(),
    critiqueGraph: vi.fn(),
    explainDiff: vi.fn(),
  } as unknown as LLMAdapter;
}

function makeReplayAdapter(responses: object[]): LLMAdapter {
  let attemptIdx = 0;
  return {
    name: 'test',
    model: 'test-model',
    chat: vi.fn().mockImplementation(async () => {
      const payload = responses[Math.min(attemptIdx, responses.length - 1)];
      attemptIdx += 1;
      return { content: JSON.stringify(payload) };
    }),
    draftGraph: vi.fn(),
    repairGraph: vi.fn(),
    suggestOptions: vi.fn(),
    clarifyBrief: vi.fn(),
    critiqueGraph: vi.fn(),
    explainDiff: vi.fn(),
  } as unknown as LLMAdapter;
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('edit_graph orphan-option replay', () => {
  it('LLM emits orphan option, fixes on repair → patch passes validation, no rejection', async () => {
    // Attempt 1: LLM produces orphan option (no factor edge)
    //   → OPTION_NO_FACTOR_EDGES fires
    //   → repair-eligible structural code → enters repair loop (continue)
    // Attempt 2: LLM produces complete option (with factor edge)
    //   → validation passes → patch returned as proposed (not rejected).
    //
    // NOTE: `appliedGraph` is only populated when PLoT validation approves
    // the patch. In this test PLoT is not configured, so `appliedGraph` is
    // null on the success path too — we assert `wasRejected: false` and
    // inspect the V4 patch block for the operations instead.
    const adapter = makeReplayAdapter([ORPHAN_OPTION_RESPONSE, COMPLETE_OPTION_RESPONSE]);
    const ctx = makeHiringContext();

    const result = await handleEditGraph(
      ctx,
      'Add an option for contract hiring',
      adapter,
      'req-replay-fixed',
      'turn-replay-1',
    );

    expect(adapter.chat).toHaveBeenCalledTimes(2);
    expect(result.wasRejected).toBe(false);
    // Repair succeeded — diagnostics don't carry the violation code on
    // the final attempt.
    expect(result.diagnostics?.validation_violation_codes ?? []).not.toContain('OPTION_NO_FACTOR_EDGES');
    // V4 patch block was produced (proposed patch).
    expect(result.blocks).toHaveLength(1);
    const block = result.blocks[0]!;
    expect(block.block_type).toBe('graph_patch');
    if (block.block_type === 'graph_patch') {
      // Repair attempt produced 3 ops (option node + 2 structural edges).
      expect(block.data.status).not.toBe('rejected');
      expect(block.data.operations.length).toBe(3);
      // The new option node and at least one option → factor edge are
      // present in the operations payload (path format may be normalised
      // by enforceStructuralEdgeDefaults / field normalisation, so we
      // match by op kind + entity rather than exact path).
      const opKinds = block.data.operations.map((o) => o.op);
      expect(opKinds.filter((k) => k === 'add_node').length).toBeGreaterThanOrEqual(1);
      expect(opKinds.filter((k) => k === 'add_edge').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('LLM emits orphan option on every attempt → final rejection carries OPTION_NO_FACTOR_EDGES', async () => {
    // Both attempts emit the same orphan response. Repair exhausts;
    // final attempt rejects via the structural-intent rejection envelope.
    // diagnostics carries the specific violation code for V5 wire surfacing.
    const adapter = makeAdapter(ORPHAN_OPTION_RESPONSE);
    const ctx = makeHiringContext();

    const result = await handleEditGraph(
      ctx,
      'Add an option for contract hiring',
      adapter,
      'req-replay-rejected',
      'turn-replay-2',
    );

    // 2 attempts (initial + 1 repair, per maxRepairRetries=1 mock).
    expect(adapter.chat).toHaveBeenCalledTimes(2);
    expect(result.wasRejected).toBe(true);
    expect(result.appliedGraph).toBeNull();
    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics!.validation_violation_codes).toContain('OPTION_NO_FACTOR_EDGES');
    expect(result.diagnostics!.failure_code).toBe('OPTION_NO_FACTOR_EDGES');
  });

  it('LLM emits complete option (decision-edge + factor-edge) → accepted, no orphan-option violation', async () => {
    // Sanity: the new rule does not over-fire on valid edits.
    const adapter = makeAdapter(COMPLETE_OPTION_RESPONSE);
    const ctx = makeHiringContext();

    const result = await handleEditGraph(
      ctx,
      'Add an option for contract hiring',
      adapter,
      'req-replay-accepted',
      'turn-replay-3',
    );

    expect(adapter.chat).toHaveBeenCalledTimes(1);
    expect(result.wasRejected).toBe(false);
    expect(result.diagnostics?.validation_violation_codes ?? []).not.toContain('OPTION_NO_FACTOR_EDGES');
  });
});

// fac_payroll in makeHiringContext() has NO observed_state → no cap → an
// intervention on it cannot be encoded. A complete option that REQUESTS such an
// intervention is the COMBINED-BUILD live failure shape; it must defer.
const ADD_OPTION_REQUESTS_UNCAPPABLE_RESPONSE = {
  operations: [
    { op: 'add_node', path: '/nodes/opt_contract_hiring', value: { id: 'opt_contract_hiring', kind: 'option', label: 'Contract hiring', data: { interventions: { fac_payroll: { unit: '£', raw_value: 50000 } } } }, impact: 'moderate', rationale: 'Adds a contract hiring option requesting a payroll change.' },
    { op: 'add_edge', path: '/edges/dec_hiring->opt_contract_hiring', value: { from: 'dec_hiring', to: 'opt_contract_hiring', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' }, impact: 'moderate', rationale: 'Wires decision to the new option.' },
    { op: 'add_edge', path: '/edges/opt_contract_hiring->fac_payroll', value: { from: 'opt_contract_hiring', to: 'fac_payroll', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' }, impact: 'moderate', rationale: 'Connects new option to payroll factor.' },
  ],
  removed_edges: [], warnings: [], coaching: { summary: 'Added contract hiring option with a payroll change.', rerun_recommended: true },
};

// Same add, but the requested intervention carries its OWN cap so it CAN encode.
const ADD_OPTION_REQUESTS_ENCODABLE_RESPONSE = {
  operations: [
    { op: 'add_node', path: '/nodes/opt_contract_hiring', value: { id: 'opt_contract_hiring', kind: 'option', label: 'Contract hiring', data: { interventions: { fac_payroll: { unit: '£', raw_value: 50000, cap: 100000 } } } }, impact: 'moderate', rationale: 'Adds a contract hiring option requesting a payroll change.' },
    { op: 'add_edge', path: '/edges/dec_hiring->opt_contract_hiring', value: { from: 'dec_hiring', to: 'opt_contract_hiring', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' }, impact: 'moderate', rationale: 'Wires decision to the new option.' },
    { op: 'add_edge', path: '/edges/opt_contract_hiring->fac_payroll', value: { from: 'opt_contract_hiring', to: 'fac_payroll', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' }, impact: 'moderate', rationale: 'Connects new option to payroll factor.' },
  ],
  removed_edges: [], warnings: [], coaching: { summary: 'Added contract hiring option with a payroll change.', rerun_recommended: true },
};

describe('edit_graph P0-A add-option configure-or-don\'t-persist (real handleEditGraph)', () => {
  it('add REQUESTING an intervention on an uncappable factor → deferred, graph not committed', async () => {
    // The live failure shape: an added option that requested a £ change on a
    // factor with no cap. It is structurally complete (has its factor edge), so
    // it is NOT an OPTION_NO_FACTOR_EDGES reject — it must defer on the encoder.
    const adapter = makeAdapter(ADD_OPTION_REQUESTS_UNCAPPABLE_RESPONSE);
    const ctx = makeHiringContext();

    const result = await handleEditGraph(
      ctx,
      'Add a contract hiring option costing £50,000',
      adapter,
      'req-p0a-defer',
      'turn-p0a-defer',
    );

    expect(result.wasRejected).toBe(true);
    expect(result.appliedGraph).toBeNull();
    expect(result.diagnostics?.failure_code).toBe('OPTION_INTERVENTIONS_UNRESOLVABLE');
    // NOT an orphan-edge rejection — it reached and failed the encoder net.
    expect(result.diagnostics?.validation_violation_codes ?? []).not.toContain('OPTION_NO_FACTOR_EDGES');
  });

  it('CONTROL: add REQUESTING an intervention that CAN encode (intervention carries a cap) → accepted', async () => {
    const adapter = makeAdapter(ADD_OPTION_REQUESTS_ENCODABLE_RESPONSE);
    const ctx = makeHiringContext();

    const result = await handleEditGraph(
      ctx,
      'Add a contract hiring option costing £50,000',
      adapter,
      'req-p0a-encode',
      'turn-p0a-encode',
    );

    expect(result.wasRejected).toBe(false);
    expect(result.diagnostics?.failure_code ?? null).not.toBe('OPTION_INTERVENTIONS_UNRESOLVABLE');
  });
});
