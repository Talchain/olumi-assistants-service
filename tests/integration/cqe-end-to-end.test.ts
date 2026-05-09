import { describe, expect, it } from 'vitest';
import { assembleContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import { routeWithToolUse } from '../../src/orchestrator-v5/routing/route-with-tool-use.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../src/adapters/llm/types.js';
import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';

// End-to-end integration: confirm parsed_quantities populated by CQE
// reaches the ContextPack produced by assembleContextPack(), traverses
// routeWithToolUse(), lands inside the JSON.stringify'd user message that
// Sonnet receives, and preserves optional value_origin through every
// hop. Covers brief §6 Gate 10 (liveness) and §7 acceptance criterion
// for the assembleContextPack → routeWithToolUse → JSON.stringify chain.

const basePayload = makeMessagePayload({
  turn_id: '11111111-1111-4111-8111-111111111111',
  scenario_id: '22222222-2222-4222-8222-222222222222',
  message: 'placeholder',
  turn_class: 'decide',
  stage: 'analyse',
});

describe('CQE end-to-end via assembleContextPack', () => {
  it('populates parsed_quantities for a quantity-bearing message', () => {
    const pack = assembleContextPack({
      payload: { ...basePayload, message: 'set churn to 5% and cost to 50000' },
      priorTurns: [],
    });
    expect(pack.parsed_quantities.length).toBeGreaterThan(0);
    const first = pack.parsed_quantities[0]!;
    expect(first.value).toBeCloseTo(0.05);
    expect(first.unit).toBe('percentage');
    expect(first.operator).toBe('set');
  });

  it('yields empty parsed_quantities for a quantity-free message', () => {
    const pack = assembleContextPack({
      payload: { ...basePayload, message: 'what about churn?' },
      priorTurns: [],
    });
    expect(pack.parsed_quantities).toEqual([]);
  });

  it('preserves value_origin after JSON.stringify (Sonnet serialisation path)', () => {
    const pack = assembleContextPack({
      payload: { ...basePayload, message: 'the budget is £150k' },
      priorTurns: [],
    });
    const serialised = JSON.stringify(pack, null, 2);
    const roundTripped = JSON.parse(serialised) as typeof pack;
    expect(roundTripped.parsed_quantities[0]?.value_origin).toBe(
      'suffix_expansion',
    );
    expect(serialised).toContain('"value_origin": "suffix_expansion"');
  });

  it('runs for non-action turns (coach / converse) just as for action turns', () => {
    const coachPack = assembleContextPack({
      payload: { ...basePayload, message: 'at least 3 developers', turn_class: 'direct_answer' as const },
      priorTurns: [],
    });
    expect(coachPack.parsed_quantities.length).toBeGreaterThan(0);
  });

  it('value_origin survives assembleContextPack → routeWithToolUse → JSON.stringify (brief §7)', async () => {
    // Capture the exact user-message string the routing layer hands to
    // Sonnet. This is the end-to-end production serialisation path: no
    // hand-rolled JSON.stringify, no narrowing transform.
    let capturedContent: string | null = null;
    const mockAdapter = {
      chatWithTools: async (args: ChatWithToolsArgs): Promise<ChatWithToolsResult> => {
        capturedContent = args.messages[0]?.content as string;
        return {
          content: [
            {
              type: 'text' as const,
              text: 'mock orientation',
            },
          ],
          stop_reason: 'end_turn' as const,
          usage: { input_tokens: 1, output_tokens: 1 },
          model: 'test-model',
          latencyMs: 1,
        };
      },
    };

    const pack = assembleContextPack({
      payload: { ...basePayload, message: 'the budget is £150k' },
      priorTurns: [],
    });

    await routeWithToolUse(pack, 'the budget is £150k', {
      requestId: 'test-req-1',
      adapter: mockAdapter,
    });

    expect(capturedContent).not.toBeNull();
    // The Sonnet-facing user message contains the JSON-serialised ContextPack.
    // `value_origin: "suffix_expansion"` must survive the path.
    expect(capturedContent!).toContain('"parsed_quantities"');
    expect(capturedContent!).toContain('"value_origin": "suffix_expansion"');
    expect(capturedContent!).toContain('150000');
  });
});
