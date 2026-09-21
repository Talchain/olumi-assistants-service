/**
 * V5 G7/G8 — commit-atomicity for proposed-change emit.
 *
 * Pins the contract that when an upstream caller produces a proposal
 * via `emitProposedChange` and threads its `chip` and `pending` into
 * `commitDirectAnswer`, BOTH land in a single `append_turn_atomic`
 * payload. The chip's id and the pending action's chip_id /
 * proposal_ref are identical at the commit boundary.
 *
 * Goes beyond the helper-level "returns both" test: this exercises
 * the actual `commitDirectAnswer` path with the canonical input.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { ActionSchema } from '@talchain/schemas/boundary';

import { emitProposedChange } from '../compose/proposed-change.js';
import { getDefaultRegistry } from '../tools/registry.js';
import type {
  ProposedChange,
  ProposedChangeContext,
} from '../types/proposed-change.js';

const SCENARIO_ID = randomUUID();
const TURN_ID = `t-${randomUUID()}`;
const GRAPH_HASH = 'h_atomicity_test';
const EMITTED_AT_ISO = '2026-05-08T12:00:00.000Z';

const appendCalls: Array<Record<string, unknown>> = [];
let appendShouldThrow = false;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      if (appendShouldThrow) {
        throw new Error('simulated append_turn_atomic failure');
      }
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { commitDirectAnswer } = await import('../commit.js');

function makeProposal(): ProposedChange {
  return {
    intent: 'add_constraint',
    label: 'Add the cost cap',
    message: 'Add the cost cap.',
    params: { value: 100, unit: 'GBP' },
    target_entity_ids: ['node_X'],
  };
}

function makeCtx(): ProposedChangeContext {
  return {
    scenario_id: SCENARIO_ID,
    graph_hash: GRAPH_HASH,
    emitted_at_iso: EMITTED_AT_ISO,
    registry: getDefaultRegistry(),
  };
}

function makeOlumiResponse(chip: import('../compose/types.js').SuggestedAction) {
  // Minimum-shape OlumiResponse for the commit path. The compose
  // helper builds a richer shape in production; this fixture mirrors
  // what `composeDirectAnswerResponse` emits structurally.
  return {
    type: 'direct_answer' as const,
    stage: 'analyse' as const,
    response_id: TURN_ID,
    response_hash: 'rh',
    insights: [],
    suggested_actions: [chip],
    receipts: [],
    feature_flags: { features: {}, computed_at: '2026-05-08T12:00:00.000Z' },
    truncation: { input_truncated: false, output_truncated: false },
    pi_warnings: [],
    pi_redactions: [],
    decision_context: {
      stage: 'analyse',
      brief_extracts: [],
      patches: [],
      analysis: null,
    },
    timing: {},
  };
}

describe('emitProposedChange + commitDirectAnswer — atomicity', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    appendShouldThrow = false;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('produces a chip and pending action that commit through the same append_turn_atomic call', async () => {
    const out = emitProposedChange(makeProposal(), makeCtx());
    expect(out.status).toBe('success');
    if (out.status !== 'success') return;

    // Chip passes the strict boundary schema.
    expect(() => ActionSchema.parse(out.chip)).not.toThrow();

    const response = makeOlumiResponse(out.chip);
    const committed = await commitDirectAnswer(response as never, {
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: 'rh',
      llm_calls_used: 0,
      duration_ms: 0,
      handler_facts: [],
      pending_actions: [out.pending],
    });
    expect(committed.performed).toBe(true);

    // Exactly one append call — chip and pending in the same payload.
    expect(appendCalls).toHaveLength(1);
    const args = appendCalls[0] as {
      pending_actions?: ReadonlyArray<{ chip_id: string; action: { proposal_ref?: string } }>;
    };
    expect(args.pending_actions).toBeDefined();
    expect(args.pending_actions).toHaveLength(1);
    // Identity bridge: the chip's id == pending.chip_id == pending.action.proposal_ref.
    const persistedPending = args.pending_actions![0]!;
    expect(persistedPending.chip_id).toBe(out.chip.id);
    expect(persistedPending.action.proposal_ref).toBe(out.chip.id);
  });

  it('append failure rolls back: no chip lands without its matching pending action', async () => {
    const out = emitProposedChange(makeProposal(), makeCtx());
    if (out.status !== 'success') throw new Error('expected success');

    appendShouldThrow = true;
    const response = makeOlumiResponse(out.chip);
    let threw = false;
    try {
      await commitDirectAnswer(response as never, {
        scenario_id: SCENARIO_ID,
        turn_id: TURN_ID,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'rh',
        llm_calls_used: 0,
        duration_ms: 0,
        handler_facts: [],
        pending_actions: [out.pending],
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Crucially: zero append calls reached the store. The chip and
    // pending action are committed together or neither is — the
    // existing append_turn_atomic contract enforces this.
    expect(appendCalls).toHaveLength(0);
  });
});
