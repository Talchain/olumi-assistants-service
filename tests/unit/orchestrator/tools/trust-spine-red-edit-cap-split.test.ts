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
 * DEFAULT FLIPPED ON 18 Jul (Paul-ratified): CEE_EDIT_CAP_SPLIT now defaults ON,
 * so an over-cap edit takes the split branch by default. The former default-path
 * `it.fails` (which reported GREEN while the bare-dead-end defect stood) is
 * converted to a real `it()` asserting the split behaviour on the default path;
 * the mock DERIVES the default from the real config (no mirror to drift), and a
 * kill-switch `it()` pins the env-override-OFF legacy dead end.
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
// POC-BOARD #6 (default flipped ON 18 Jul, Paul-ratified). `undefined` = DERIVE
// from the real config default (no mirror to drift — CLAUDE.md trap #12): the
// default-path test leaves this undefined so it exercises the actual shipped
// default (now ON) and would fail loudly if that default were ever reverted; the
// kill-switch test sets it `false` to pin the env-override-OFF legacy dead end.
let mockEditCapSplitEnabled: boolean | undefined;

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
              // undefined → fall through to the REAL config default (derive, not mirror).
              if (ceeProp === 'editCapSplitEnabled')
                return mockEditCapSplitEnabled ?? Reflect.get(ceeTarget, ceeProp);
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
    mockEditCapSplitEnabled = undefined; // default path exercises the real config default
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

  // DEFAULT PATH (cap-split ON by default since 18 Jul, Paul-ratified): converted
  // from the former `it.fails`. With the flag left UNSET the mock derives the real
  // config default (now ON), so the over-cap edit takes the split branch. The
  // former RED criterion (NOT the bare whole-batch MAX_OPERATIONS_EXCEEDED dead
  // end) now holds by default, and the body asserts the full honest-future shape:
  // a DISTINCT bounded refusal carrying a concrete split next-step.
  //
  // Chosen mechanism = bounded refusal (not apply-first-N): a true "apply the first
  // N, continue with the rest" needs the remainder PERSISTED (a new pending-action
  // kind + route-v2 resumer + DB constraint), outside handleEditGraph and this
  // lane's scope fence. An arbitrary index-15 truncation of an LLM op array also
  // risks an incoherent partial batch. The acceptance floor explicitly permits a
  // bounded refusal with a next step as the alternative.
  it('default path: a 20-op edit gets a distinct bounded refusal with a concrete next step (not the bare dead end)', async () => {
    mockMaxPatchOperations = 15;
    // mockEditCapSplitEnabled left undefined → real config default (ON) drives.
    const result = await handleEditGraph(
      makeContext(),
      'Bulk edit',
      makeAdapter(TWENTY_OPS),
      'req-cap-split-default',
      'turn-cap-split-default',
      { maxRetries: 0 },
    );
    const data = result.blocks[0].data as GraphPatchBlockData;

    // The former RED criterion — now GREEN on the default path: the bare dead-end
    // code and failure_code are gone.
    expect(data.rejection?.code).not.toBe('MAX_OPERATIONS_EXCEEDED');
    expect(result.diagnostics?.failure_code).not.toBe('max_operations_exceeded');

    // Positive shape of the honest future: a DISTINCT bounded-refusal signal…
    expect(data.rejection?.code).toBe('MAX_OPERATIONS_SPLIT_SUGGESTED');
    expect(result.diagnostics?.failure_code).toBe('max_operations_split_suggested');
    expect(result.diagnostics?.failure_branch).toBe('max_operations_split');
    expect(result.diagnostics?.branch_taken).toBe('rejection');

    // …that carries a CONCRETE next step: user-facing prose + at least one chip the
    // user can act on now (the "not a dead end" property).
    expect(result.wasRejected).toBe(true);
    expect(result.assistantText).toBeTruthy();
    expect((result.assistantText ?? '').length).toBeGreaterThan(20);
    expect(result.suggestedActions?.length ?? 0).toBeGreaterThanOrEqual(1);

    // The structured count/cap survive for the turn trace (raw reason, never
    // user-surfaced): the batch was 20 against a cap of 15.
    expect(data.rejection?.reason).toContain('20');
    expect(data.rejection?.reason).toContain('15');

    // Prose stays banned-token clean (mirrors edit-rejection-text.test.ts): no raw
    // counts / schema language leaks to the user.
    const prose = result.assistantText ?? '';
    expect(prose).not.toMatch(/\boperation(s)?\b/i);
    expect(prose).not.toMatch(/\bpatch\b/i);
    expect(prose).not.toMatch(/\b\d+\s+(?:operation|edge|node)/i);
    expect(prose).not.toMatch(/\bmax(?:imum)?\s+(?:of\s+)?\d+/i);
  });

  // KILL-SWITCH (CEE_EDIT_CAP_SPLIT=false): the env-override OFF restores the
  // byte-identical legacy path — the over-cap edit dead-ends on the bare
  // whole-batch MAX_OPERATIONS_EXCEEDED rejection, exactly as before the flip.
  it('kill-switch: with CEE_EDIT_CAP_SPLIT off, a 20-op edit falls back to the bare whole-batch MAX_OPERATIONS_EXCEEDED dead end', async () => {
    mockMaxPatchOperations = 15;
    mockEditCapSplitEnabled = false; // env-override OFF → legacy path
    const result = await handleEditGraph(
      makeContext(),
      'Bulk edit',
      makeAdapter(TWENTY_OPS),
      'req-cap-legacy',
      'turn-cap-legacy',
      { maxRetries: 0 },
    );
    const data = result.blocks[0].data as GraphPatchBlockData;
    // Legacy bare dead end: the whole batch is refused under the cap code, and the
    // distinct split signal is NOT taken.
    expect(data.rejection?.code).toBe('MAX_OPERATIONS_EXCEEDED');
    expect(result.diagnostics?.failure_code).toBe('max_operations_exceeded');
    expect(result.diagnostics?.failure_branch).toBe('max_operations');
  });
});
