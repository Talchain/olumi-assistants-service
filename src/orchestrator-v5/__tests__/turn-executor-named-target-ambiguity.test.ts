/**
 * ⭐⭐ SENDABLE FAILURE 2 AT THE CHOKEPOINT — the LLM proposes a write to ONE of
 * two entities the user named in the same sentence, and the product must ask
 * instead of guessing.
 *
 * These drive the executor with a REAL routing proposal (the LLM adapter is
 * mocked; the guard, validator and composer are the shipped ones), because the
 * unit spec beside `named-target-ambiguity.ts` proves the PREDICATE and says
 * nothing about whether the turn is actually refused. The two are not
 * redundant: the unit spec is blind to the wiring, and this spec is blind to
 * the predicate's breadth.
 *
 * ⚠ EVERY POSITIVE HAS ITS OPPOSITE-DIRECTION TWIN IN THE SAME FILE
 * (CLAUDE.md trap 22b). A guard that asks when the user was clear is its own
 * defect, and this estate has burned four consecutive rounds on exactly that
 * axis. The twins assert the write STILL LANDS.
 */
import { describe, it, expect, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: {}, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockRoutingAdapter(result: ChatWithToolsResult) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(result),
  };
}

/**
 * Two factors that are genuine rivals for one value, plus an option and a goal
 * so the subtraction set is real. "Key Account" is shared by both factors and
 * therefore identifies NEITHER — that is the derivation doing its job.
 */
const GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_retention', kind: 'decision', label: 'Retention Programme Choice' },
    {
      id: 'fac_renewal',
      kind: 'factor',
      label: 'Key Account Renewal Risk',
      observed_state: { value: 0.5, raw_value: 0.5, unit: undefined, cap: 1 },
    },
    {
      id: 'fac_churn',
      kind: 'factor',
      label: 'Key Account Churn Exposure',
      observed_state: { value: 0.4, raw_value: 0.4, unit: undefined, cap: 1 },
    },
    { id: 'goal_revenue', kind: 'goal', label: 'Protect recurring revenue' },
    { id: 'opt_success', kind: 'option', label: 'Invest in a dedicated success team' },
  ],
  edges: [],
} as unknown as GraphStateIngress;

function setFactorValueProposal(entityId: string, entityLabel: string, value: number) {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'set_factor_value',
      entity: {
        id: entityId,
        kind: 'node',
        label: entityLabel,
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [{ name: 'value', value, source: 'user_explicit' }],
      cited_context_fields: ['graph.nodes'],
    },
  };
}

let seq = 0;
async function runTurn(message: string, proposal: unknown) {
  seq += 1;
  const suffix = String(seq).padStart(2, '0');
  return runTurnExecutor(
    makeMessagePayload({
      turn_id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${suffix}`,
      scenario_id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb${suffix}`,
      message,
    }),
    `req-named-target-${suffix}`,
    { routingAdapter: mockRoutingAdapter(mkToolUseResult(proposal)), graphState: GRAPH },
  );
}

/**
 * ⭐ HOW "THE GUARD LET IT THROUGH" IS OBSERVED, AND WHY IT IS NOT "the write
 * landed".
 *
 * The session store is mocked (it has to be — this spec exercises routing, not
 * persistence), so a turn that reaches the handler fails at COMMIT with
 * `INTERNAL_ERROR / phase: 'commit'`. **That failure is the harness's, not the
 * product's**, and it is stated here rather than hidden behind a helper name,
 * because a reader who thinks this asserts a successful write would trust it
 * for something it cannot see.
 *
 * What it DOES prove is exactly what these twins need: the turn got PAST the
 * named-target guard into execution, instead of being turned into a question.
 * A refused turn never reaches commit — it composes a direct_answer.
 */
function reachedExecution(response: unknown): boolean {
  const text = JSON.stringify(response);
  return text.includes('"phase":"commit"');
}

describe('TurnExecutor — two entities named in one sentence', () => {
  /**
   * ⚠⚠ THE FULL-LABEL SENTENCE IS ALREADY ASKED — BY A DIFFERENT MECHANISM,
   * AND SAYING SO IS THE POINT.
   *
   * Measured at pristine `53eb8d03`: `tryDeterministicValueUpdate` returns
   * `{dispatch: 'clarify', candidates: 2}` when both labels appear IN FULL, so
   * this turn never reaches the new guard at all — the copy below is the
   * PRE-ROUTE's (`chip_clarify_factor_*`). This test is kept because it pins
   * the requirement, and it is labelled honestly because a test that claims
   * the wrong mechanism is how the next lane deletes the wrong thing.
   *
   * The witnessed staging sentence therefore cannot have matched both labels
   * in full — drafted labels are long and users type shortened forms. That is
   * the PARTIAL-reference case below, and it is the one this lane closes.
   */
  it('the witnessed shape ASKS and names both — via the pre-route, which already owned it', async () => {
    const { response } = await runTurn(
      'Key Account Renewal Risk and Key Account Churn Exposure both look off to me — set it to 0.8.',
      setFactorValueProposal('fac_renewal', 'Key Account Renewal Risk', 0.8),
    );
    const text = JSON.stringify(response);
    // BOTH entities named — the product understood them both and says so.
    expect(text).toContain('Key Account Renewal Risk');
    expect(text).toContain('Key Account Churn Exposure');
    // DISCRIMINATION: this is the pre-route's chip family, NOT the new
    // guard's. If this ever flips to `chip_entity_named_*`, the ownership of
    // this sentence has moved and the comment above is stale.
    expect(text).toContain('chip_clarify_factor_0');
    expect(text).not.toContain('I have not changed the model');
    // Each chip replays a COMPLETE instruction, so the 0.8 is not lost.
    const chips = (response as { suggested_actions?: { message?: string }[] }).suggested_actions ?? [];
    expect(chips.map((c) => c.message)).toEqual(
      expect.arrayContaining([
        'Set Key Account Renewal Risk to 0.8.',
        'Set Key Account Churn Exposure to 0.8.',
      ]),
    );
  });

  it('TWIN: ONE entity named — the write still lands SILENTLY, no question', async () => {
    const { response } = await runTurn(
      'Key Account Renewal Risk looks off to me — set it to 0.8.',
      setFactorValueProposal('fac_renewal', 'Key Account Renewal Risk', 0.8),
    );
    const text = JSON.stringify(response);
    expect(text).not.toContain('I have not changed the model');
    expect(text).not.toContain('Key Account Churn Exposure');
    expect(reachedExecution(response)).toBe(true);
  });

  it('TWIN: the plainest instruction of all still executes', async () => {
    const { response } = await runTurn(
      'Set Key Account Renewal Risk to 0.8.',
      setFactorValueProposal('fac_renewal', 'Key Account Renewal Risk', 0.8),
    );
    expect(JSON.stringify(response)).not.toContain('I have not changed the model');
    expect(reachedExecution(response)).toBe(true);
  });

  it('PARTIAL references — the shape that reaches the LLM — are refused too', async () => {
    // Measured at pristine 53eb8d03: `tryDeterministicValueUpdate` SKIPS this
    // sentence with `no_candidate_match`, so nothing upstream asks the
    // ambiguity question and the LLM's pick would land.
    const { response } = await runTurn(
      'Renewal Risk and Churn Exposure both look off to me — set it to 0.8.',
      setFactorValueProposal('fac_renewal', 'Key Account Renewal Risk', 0.8),
    );
    const text = JSON.stringify(response);
    expect(text).toContain('I have not changed the model');
    expect(text).toContain('Key Account Churn Exposure');
    // DISCRIMINATION, the other half of the pair: this IS the new guard's chip
    // family. Together with the pre-route assertion above, the two tests prove
    // the two mechanisms are distinguishable — a single test could not.
    expect(text).toContain('chip_entity_named-factor-0');
    // The user's own number survives the clarify turn.
    expect(text).toContain('Set Key Account Renewal Risk to 0.8.');
    expect(text).toContain('Set Key Account Churn Exposure to 0.8.');
  });

  it('TWIN: ONE partial reference still executes silently', async () => {
    const { response } = await runTurn(
      'Renewal Risk looks off to me — set it to 0.8.',
      setFactorValueProposal('fac_renewal', 'Key Account Renewal Risk', 0.8),
    );
    expect(JSON.stringify(response)).not.toContain('I have not changed the model');
    expect(reachedExecution(response)).toBe(true);
  });

  it('TWIN: a shared word names neither factor — the subtraction keeps the write silent', async () => {
    const { response } = await runTurn(
      'The key account numbers look off to me — set it to 0.8.',
      setFactorValueProposal('fac_renewal', 'Key Account Renewal Risk', 0.8),
    );
    expect(JSON.stringify(response)).not.toContain('I have not changed the model');
    expect(reachedExecution(response)).toBe(true);
  });

  it('TWIN: naming the OPTION alongside one factor is not an ambiguous factor write', async () => {
    const { response } = await runTurn(
      'Under Invest in a dedicated success team, Key Account Renewal Risk looks off — set it to 0.8.',
      setFactorValueProposal('fac_renewal', 'Key Account Renewal Risk', 0.8),
    );
    expect(JSON.stringify(response)).not.toContain('I have not changed the model');
    expect(reachedExecution(response)).toBe(true);
  });
});
