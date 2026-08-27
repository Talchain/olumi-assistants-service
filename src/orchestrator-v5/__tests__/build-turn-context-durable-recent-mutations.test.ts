import { describe, expect, it, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { buildTurnContext } from '../build-turn-context.js';
import { assembleContextPackWithSummary } from '../context/context-pack-assembler.js';
import { RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT } from '../context/reconcile-recent-mutation-facts.js';
import { makeMessagePayload } from './fixtures.js';
import {
  createMockSessionStore,
  makeSessionTurnRow,
} from '../../../tests/utils/mock-session-store.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const payload = makeMessagePayload({
  scenario_id: SCENARIO,
  message: 'What accepted model change still stands?',
});

function acceptedChange(): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: {
      target_id: 'factor_support_capacity',
      status: 'applied',
      before: {
        value: 30,
        raw_value: 30,
        label: 'Support capacity',
        unit: 'specialists',
      },
      after: {
        value: 42,
        raw_value: 42,
        label: 'Support capacity',
        unit: 'specialists',
      },
    },
  };
}

function hotTurns(count: number) {
  return Array.from({ length: count }, (_, index) =>
    makeSessionTurnRow({
      id: `10000000-0000-4000-8000-${String(index + 22).padStart(12, '0')}`,
      scenario_id: SCENARIO,
      turn_id: `20000000-0000-4000-8000-${String(index + 22).padStart(12, '0')}`,
      turn_class: 'direct_answer',
      handler_id: null,
      created_at: `2026-08-27T10:${String(index).padStart(2, '0')}:00.000Z`,
    }),
  ).reverse();
}

function packFromContext(
  context: Awaited<ReturnType<typeof buildTurnContext>>,
) {
  return assembleContextPackWithSummary({
    payload,
    priorTurns: context.prior_turns,
    priorTurnsTotal: context.prior_turns_total,
    priorFacts: context.prior_facts,
    priorFactsReadOk: context.prior_facts_read_ok,
  }).contextPack;
}

describe('buildTurnContext durable recent-mutation binding', () => {
  it('calls the scenario reader with the exact cap+1 lookahead and reaches ContextPack', async () => {
    const receipt = acceptedChange();
    const readDurable = vi.fn(async () => [receipt]);
    const context = await buildTurnContext(payload, 'req-durable-41', {
      sessionStore: createMockSessionStore({
        readRecent: async () => hotTurns(20),
        countTurns: async () => 41,
        readFactsWithTurnFor: async () => [],
        readRecentAppliedMutationFactsFor: readDurable,
      }),
    });

    expect(readDurable).toHaveBeenCalledWith(
      SCENARIO,
      RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
    );
    expect(RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT).toBe(4);
    expect(context.prior_facts).toEqual([]);
    expect(JSON.stringify(context.prior_facts)).toBe('[]');
    expect(context.prior_facts.recent_mutation_facts).toEqual([receipt]);
    expect(context.prior_facts.recent_changes_status).toBe('complete');

    const pack = packFromContext(context);
    expect(pack.recent_changes_status).toBe('complete');
    expect(pack.recent_changes).toEqual([
      expect.objectContaining({
        action: 'factor_value_updated',
        target_label: 'Support capacity',
      }),
    ]);
  });

  it('keeps a failed scenario-wide read degraded on a truncated 41-turn return', async () => {
    const context = await buildTurnContext(payload, 'req-durable-degraded', {
      sessionStore: createMockSessionStore({
        readRecent: async () => hotTurns(20),
        countTurns: async () => 41,
        readFactsWithTurnFor: async () => [],
        readRecentAppliedMutationFactsFor: async () => {
          throw new Error('durable read unavailable');
        },
      }),
    });

    expect(context.prior_facts.recent_mutation_facts).toEqual([]);
    expect(context.prior_facts.recent_changes_status).toBe('degraded');
    expect(packFromContext(context)).toMatchObject({
      recent_changes: [],
      recent_changes_status: 'degraded',
    });
  });

  it('recovers complete history from a healthy hot window when every turn is loaded', async () => {
    const receipt = acceptedChange();
    const turn = makeSessionTurnRow({
      id: '30000000-0000-4000-8000-000000000001',
      scenario_id: SCENARIO,
      turn_class: 'handler',
      handler_id: 'set_factor_value',
    });
    const context = await buildTurnContext(payload, 'req-hot-complete', {
      sessionStore: createMockSessionStore({
        readRecent: async () => [turn],
        countTurns: async () => 1,
        readFactsWithTurnFor: async () => [{
          fact: receipt,
          turn_id: turn.id,
          fact_created_at: turn.created_at,
        }],
        readRecentAppliedMutationFactsFor: async () => {
          throw new Error('durable read unavailable');
        },
      }),
    });

    expect(context.prior_facts.recent_mutation_facts).toEqual([receipt]);
    expect(context.prior_facts.recent_changes_status).toBe('complete');
  });

  it('degrades rather than erasing a hot receipt when durable zero contradicts it', async () => {
    const receipt = acceptedChange();
    const turn = makeSessionTurnRow({
      id: '30000000-0000-4000-8000-000000000002',
      scenario_id: SCENARIO,
      turn_class: 'handler',
      handler_id: 'set_factor_value',
    });
    const context = await buildTurnContext(payload, 'req-zero-conflict', {
      sessionStore: createMockSessionStore({
        readRecent: async () => [turn],
        countTurns: async () => 1,
        readFactsWithTurnFor: async () => [{
          fact: receipt,
          turn_id: turn.id,
          fact_created_at: turn.created_at,
        }],
        readRecentAppliedMutationFactsFor: async () => [],
      }),
    });

    expect(context.prior_facts.recent_mutation_facts).toEqual([receipt]);
    expect(context.prior_facts.recent_changes_status).toBe('degraded');
    expect(packFromContext(context).recent_changes).toHaveLength(1);
  });
});
