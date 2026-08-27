import { describe, expect, it, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { buildTurnContext } from '../build-turn-context.js';
import { assembleContextPackWithSummary } from '../context/context-pack-assembler.js';
import { RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT } from '../context/reconcile-recent-mutation-facts.js';
import { makeMessagePayload } from './fixtures.js';
import { SessionReadError } from '../session/store.js';
import { log, setTestSink } from '../../utils/telemetry.js';
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

function identified(
  fact: HandlerFact,
  factRowId = '40000000-0000-4000-8000-000000000001',
  factCreatedAt = '2026-08-27T10:00:00.000Z',
) {
  return {
    fact,
    fact_row_id: factRowId,
    fact_created_at: factCreatedAt,
  } as const;
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
    const readDurable = vi.fn(async () => [identified(receipt)]);
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

  it('never logs or emits malformed eligible-row content when the durable read degrades', async () => {
    const secretKey = 'SECRET_PERSISTED_KEY_DO_NOT_LOG';
    const secretLabel = 'SECRET_STRATEGY_LABEL_DO_NOT_LOG';
    const secretId = 'secret-node-id-do-not-log';
    const secretSummary = 'SECRET_MUTATION_SUMMARY_DO_NOT_LOG';
    const malformedRowDiagnostic = JSON.stringify({
      id: secretId,
      handler_id: 'add_constraint',
      noop: false,
      payload: {
        fact_type: 'add_constraint',
        fact_version: 1,
        result: {
          status: 'applied',
          target_id: secretId,
          label: secretLabel,
          summary: secretSummary,
          [secretKey]: 'secret-content',
        },
      },
    });
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    setTestSink((name, data) => events.push({ name, data }));

    try {
      const context = await buildTurnContext(payload, 'req-malformed-receipt-canary', {
        sessionStore: createMockSessionStore({
          readRecent: async () => hotTurns(20),
          countTurns: async () => 41,
          readFactsWithTurnFor: async () => [],
          readRecentAppliedMutationFactsFor: async () => {
            throw new SessionReadError(
              `readRecentAppliedMutationFactsFor(${SCENARIO}): payload failed HandlerFactSchema — ${malformedRowDiagnostic}`,
              {
                code: 'mutation_fact_corrupt',
                cause: new Error(malformedRowDiagnostic),
              },
            );
          },
        }),
      });

      expect(context.prior_facts.recent_changes_status).toBe('degraded');
      const logBytes = JSON.stringify(warnSpy.mock.calls);
      const eventBytes = JSON.stringify(events);
      for (const canary of [
        secretKey,
        secretLabel,
        secretId,
        secretSummary,
        'secret-content',
      ]) {
        expect(logBytes).not.toContain(canary);
        expect(eventBytes).not.toContain(canary);
      }
      const warning = warnSpy.mock.calls.find((call) =>
        String(call[1]).includes('mutation-receipt read failed'),
      );
      expect(warning?.[0]).toEqual({
        request_id: 'req-malformed-receipt-canary',
        scenario_id: SCENARIO,
        error_code: 'mutation_fact_corrupt',
        error_class: 'session_read_error',
        outcome: 'degraded',
      });
      expect(events).toContainEqual({
        name: 'session.read_degraded',
        data: {
          request_id: 'req-malformed-receipt-canary',
          scenario_id: SCENARIO,
          error_code: 'mutation_fact_corrupt',
          severity: 'warning',
        },
      });
    } finally {
      setTestSink(null);
      warnSpy.mockRestore();
    }
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
          fact_row_id: '40000000-0000-4000-8000-000000000002',
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
          fact_row_id: '40000000-0000-4000-8000-000000000003',
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
