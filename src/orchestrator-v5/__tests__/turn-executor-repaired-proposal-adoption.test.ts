/**
 * TurnExecutor — CONSUME the validator's repaired proposal.
 *
 * DEFECT (adversarial review F4 + altitude): `validateToolCall` returns
 * `effectiveProposal` — the copy carrying the GRAPH's kind (and, since the
 * resolved-label adoption, the graph's label) — and its own comment claimed
 * "Hand the handler the REPAIRED proposal". Neither caller did. The executor
 * passed `proposal: action`, the unrepaired object, and the compound chain
 * discarded `validation.proposal` outright.
 *
 * No handler produced wrong output from it (handlers read only `entity.id`
 * and `parameters`, re-resolving everything else from the graph), so this was
 * a trap-14 comment plus a loaded gun. But the executor ALSO raises two of
 * its own validation errors AFTER the validate call, and both stamp
 * `factor_label` straight off the proposal entity:
 *
 *   VALUE_UNIT_UNRESOLVED       → "I wasn't sure what value to use for
 *                                  the {label} factor"
 *   OPTION_INTERVENTION_MISROUTE → "…rather than the {label} factor's own
 *                                  value"
 *
 * So an unconsumed repair is directly user-visible: a routing model that
 * resolved the right factor under an invented name made us repeat the
 * invented name back to the user as though it were a name in their own model.
 * These pin the prose against the GRAPH's label.
 */
import { describe, it, expect, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';

import { log } from '../../utils/telemetry.js';
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

function mkToolUseResult(input: unknown, textBefore?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (textBefore) content.push({ type: 'text', text: textBefore });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
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

/** Factor carries a £ unit, so a headcount value trips the unit guard. */
const GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_laptops', kind: 'decision', label: 'Engineering Team Laptop Selection' },
    {
      id: 'fac_unit_cost',
      kind: 'factor',
      label: 'Hardware Unit Cost per Device',
      observed_state: { value: 1200, raw_value: 1200, unit: '£', cap: 5000 },
    },
    { id: 'goal_effectiveness', kind: 'goal', label: 'Maximise Team Effectiveness' },
    { id: 'opt_dell', kind: 'option', label: 'Standardise on Dell XPS' },
    { id: 'out_tco_efficiency', kind: 'outcome', label: 'Three-Year TCO Efficiency' },
  ],
  edges: [],
} as unknown as GraphStateIngress;

const INVENTED_LABEL = 'the laptop budget';

const MISLABELLED_SET_FACTOR_VALUE = {
  intent_class: 'execute',
  action: {
    handler_id: 'set_factor_value',
    entity: {
      // The RIGHT id, under a name that appears nowhere in the graph.
      id: 'fac_unit_cost',
      kind: 'node',
      label: INVENTED_LABEL,
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value: 5, source: 'user_explicit' }],
    cited_context_fields: ['graph.nodes'],
  },
};

describe('TurnExecutor — the repaired proposal reaches the executor’s own error details', () => {
  it("names the GRAPH's label, not the model's invention, in VALUE_UNIT_UNRESOLVED prose", async () => {
    const routingAdapter = mockRoutingAdapter(
      mkToolUseResult(MISLABELLED_SET_FACTOR_VALUE, 'Updating…'),
    );

    const { response } = await runTurnExecutor(
      makeMessagePayload({
        turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        // "5 agents" on a £ factor — a headcount value the guard refuses to
        // coerce, which is what routes this turn to VALUE_UNIT_UNRESOLVED.
        message: 'Set the laptop budget to 5 agents',
      }),
      'req-repaired-proposal-1',
      { routingAdapter, graphState: GRAPH },
    );

    const text = JSON.stringify(response);
    expect(text).toContain('Hardware Unit Cost per Device');
    // The model's invented name must not be quoted back at the user as though
    // it were something in their model.
    expect(text).not.toContain(INVENTED_LABEL);
  });
});

describe('TurnExecutor — entity-kind repair telemetry carries a source discriminator', () => {
  it("stamps repair_source 'model_proposal' and repaired_attributes on an LLM-routed repair", async () => {
    const mislabelledKind = {
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: {
          // Real option id, proposed as a 'goal' — the live staging shape.
          id: 'opt_dell',
          kind: 'goal',
          label: 'Dell',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [],
        cited_context_fields: ['graph.options'],
      },
    };
    const routingAdapter = mockRoutingAdapter(mkToolUseResult(mislabelledKind, 'Running…'));
    const infoSpy = vi.spyOn(log, 'info');

    await runTurnExecutor(
      makeMessagePayload({
        turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
        scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
        message: 'analyse options',
      }),
      'req-repaired-proposal-2',
      { routingAdapter, graphState: GRAPH },
    );

    const repairCall = infoSpy.mock.calls.find(
      (c) => (c[0] as { event?: string } | undefined)?.event === 'v5.entity_kind_repaired',
    );
    expect(repairCall).toBeDefined();
    const payload = repairCall![0] as Record<string, unknown>;
    // The routing model produced this proposal — this is the population the
    // routing prompt is tuned against.
    expect(payload.repair_source).toBe('model_proposal');
    // Both attributes were wrong ('Dell' is not the graph's label).
    expect(payload.repaired_attributes).toEqual(['kind', 'label']);
    // Privacy contract unchanged: attribute NAMES and enum kinds only.
    expect(JSON.stringify(payload)).not.toContain('Standardise on Dell XPS');
    expect(JSON.stringify(payload)).not.toContain('"Dell"');
    infoSpy.mockRestore();
  });
});
