/**
 * ROADMAP 2.474 / AMENDMENT A1 — ONE ENTRY SEAM, ONE APPLIER.
 *
 * The tool's grounded batch enters `handleEditGraph` through
 * `opts.preComposedOperations`. That replaces THIS handler's own composition
 * (its LLM call + parse) and nothing else: normalisation, the structural-edge
 * defaults, Zod validation, the PLoT gate, apply and receipts are the same
 * code on both paths.
 *
 * Why that matters more than it sounds: a tool that reached the graph through
 * its own applier would be a SECOND referee↔applier agreement surface — 2.380's
 * parity defect, built on purpose. The assertions below are the ones that stay
 * true only while there is exactly one applier:
 *   · no composition call is made (the adapter would THROW if touched);
 *   · repair is off (the composer's contract is reject-don't-repair);
 *   · the operations that come out are the ones that went in, by op+path
 *     IDENTITY — not "some operations of the right shape".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
  getSystemPromptMeta: vi.fn().mockReturnValue(null),
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
              // Repair budget deliberately GENEROUS: if the pre-composed path
              // ever repaired, this is what would let it, and the
              // no-second-call assertion below would catch it.
              if (ceeProp === 'maxRepairRetries') return 3;
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
import type { ConversationContext, PatchOperation } from '../../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../../src/adapters/llm/types.js';

function makeContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Revenue' },
        { id: 'factor_1', kind: 'factor', label: 'Price', observed_state: { value: 0.4, std: 0.1 } },
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
    messages: [{ role: 'user', content: 'raise the price factor' }],
    scenario_id: '11111111-2222-3333-4444-555555555555',
    framing: { stage: 'evaluate' },
    analysis_response: null,
  };
}

/** An adapter that FAILS THE TEST if the handler composes anything itself. */
function makeForbiddenAdapter(): { adapter: LLMAdapter; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn().mockImplementation(() => {
    throw new Error('composition adapter must not be called on the pre-composed path');
  });
  return {
    adapter: { name: 'mock', model: 'mock', chat, chatWithTools: vi.fn() } as unknown as LLMAdapter,
    chat,
  };
}

/**
 * A value-shaped user sentence with a STRUCTURAL batch. This pairing is the
 * headline capability and it is also the one the narrow-intent guard used to
 * kill: "give each option its own driver" classifies as `parameter_update`
 * (an edit verb plus "option"), so a grounded restructure composed for it
 * would fail the guard — and with repair off on this path, fail with no
 * recourse.
 */
const STRUCTURAL_BATCH: PatchOperation[] = [
  { op: 'add_node', path: 'factor_2', value: { id: 'factor_2', kind: 'factor', label: 'Referral rate' } },
  {
    op: 'add_edge',
    path: 'factor_2::goal_1',
    value: {
      from: 'factor_2',
      to: 'goal_1',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  },
];

describe('A1 — the pre-composed seam', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSITIVE CONTROL — without the option, the handler DOES call its composer', async () => {
    // The negative assertions below are worthless unless this harness can
    // observe a composition call at all (trap 13).
    const { adapter, chat } = makeForbiddenAdapter();
    await expect(
      handleEditGraph(makeContext(), 'raise the price factor', adapter, 'req', 'turn'),
    ).rejects.toThrow(/composition adapter must not be called/);
    expect(chat).toHaveBeenCalled();
  });

  it('makes NO composition call when the batch is supplied', async () => {
    const { adapter, chat } = makeForbiddenAdapter();
    const result = await handleEditGraph(
      makeContext(),
      'raise the price factor',
      adapter,
      'req',
      'turn',
      { preComposedOperations: STRUCTURAL_BATCH },
    );
    expect(chat).not.toHaveBeenCalled();
    expect(result.wasRejected).toBe(false);
  });

  it('the operations that come out are the ones that went in, bound by op+path IDENTITY', async () => {
    const { adapter } = makeForbiddenAdapter();
    const result = await handleEditGraph(
      makeContext(),
      'raise the price factor',
      adapter,
      'req',
      'turn',
      { preComposedOperations: STRUCTURAL_BATCH },
    );
    expect((result.operations ?? []).map((o) => `${o.op}:${o.path}`)).toEqual([
      'add_node:factor_2',
      'add_edge:factor_2::goal_1',
    ]);
  });

  it('the narrow-intent guard does not fire on this path — the headline restructure survives a value-shaped sentence', async () => {
    const { adapter } = makeForbiddenAdapter();
    const result = await handleEditGraph(
      makeContext(),
      // classifies `parameter_update`, carries a structural batch
      'change each option so it has its own driver',
      adapter,
      'req',
      'turn',
      { preComposedOperations: STRUCTURAL_BATCH },
    );
    expect(result.wasRejected).toBe(false);
    expect((result.operations ?? []).length).toBe(2);
  });

  it('the caller’s array is never mutated by the pipeline’s normalisation', async () => {
    const { adapter } = makeForbiddenAdapter();
    const batch: PatchOperation[] = JSON.parse(JSON.stringify(STRUCTURAL_BATCH));
    const before = JSON.stringify(batch);
    await handleEditGraph(makeContext(), 'raise the price factor', adapter, 'req', 'turn', {
      preComposedOperations: batch,
    });
    expect(JSON.stringify(batch)).toBe(before);
  });

  it('REPAIR IS OFF — an INVALID pre-composed batch fails once, with zero repair attempts', async () => {
    // The discriminating fixture for `totalAttempts = 1` on this path. A valid
    // batch cannot tell the two apart (the composition branch is skipped on
    // every iteration, so extra attempts are invisible); an INVALID one can,
    // because the repair counter is on the diagnostics. Repairing here would be
    // the pipeline arguing with a decision the grounding validator already made
    // against the persisted graph — and it would burn the user's latency doing
    // it, since no new composition can happen on this path anyway.
    const { adapter, chat } = makeForbiddenAdapter();
    const invalid: PatchOperation[] = [
      // add_edge with no strength / exists_probability / effect_direction —
      // rejected by AddEdgeValue in the canonical schema.
      { op: 'add_edge', path: 'factor_1::goal_1', value: { from: 'factor_1', to: 'goal_1' } },
    ];
    const result = await handleEditGraph(makeContext(), 'raise the price factor', adapter, 'req', 'turn', {
      preComposedOperations: invalid,
    });
    expect(chat).not.toHaveBeenCalled();
    expect(result.diagnostics?.repair_attempts).toBe(0);
  });

  it('an EMPTY pre-composed batch takes the honest no-op path — it never falls back to composing', async () => {
    const { adapter, chat } = makeForbiddenAdapter();
    const result = await handleEditGraph(makeContext(), 'raise the price factor', adapter, 'req', 'turn', {
      preComposedOperations: [],
    });
    expect(chat).not.toHaveBeenCalled();
    expect(result.wasRejected).toBe(false);
    expect(result.operations ?? []).toEqual([]);
  });
});
