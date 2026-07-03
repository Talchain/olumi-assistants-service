/**
 * Track 2 — pending-confirmation truth threading (red-first).
 *
 * Baseline defect: the turn-executor never threaded pending-confirmation
 * state into `assembleContextPackWithSummary` or `buildFrame`, so the
 * ContextPack's `conversation.pending_confirmation` (LLM-routing-visible)
 * and the frame's `conversation.pendingConfirmation` (diagnostics) were
 * CONSTANT FALSE regardless of persisted pending actions.
 *
 * These tests are deliberately discriminating — they must fail against:
 *   - the baseline (live proposal → both seams still false), and
 *   - a naive `length > 0` fix (wall-expired / turn-exhausted entries DO
 *     reach `most_recent_pending_actions` because the store read does not
 *     filter expiry — they must NOT read as pending), and
 *   - an unscoped-kind fix (a live `what_would_flip` chip offer is a
 *     suggestion, not a pending change awaiting confirmation).
 *
 * Pack capture: the assembled ContextPack is JSON-serialised into the
 * routing user message (`buildUserMessage`), so the mocked routing
 * adapter's call args are the observable seam. The frame is read off the
 * `runTurnExecutor` result. Agreement between the two seams is asserted
 * in every case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { config } from '../../config/index.js';
import { makeMessagePayload } from './fixtures.js';
import type { PendingAction } from '../session/pending-action.js';

const SCENARIO_ID = randomUUID();

/** Mutable per-test seed — the mock store closure reads it at call time. */
let seededPendings: readonly PendingAction[] = [];

function liveProposal(overrides?: Partial<Pick<PendingAction, 'expires_at_iso' | 'expires_at_turn_count'>>): PendingAction {
  const ref = `chip_proposal_${randomUUID()}`;
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: 'set_factor_value',
        params: { factor_id: 'fac_x', value: 10, operator: 'set' },
        target_entity_ids: ['fac_x'],
      },
      public_label: 'Set Delivery Cost to 10',
      public_message: 'Would you like me to set Delivery Cost to 10?',
    },
    preconditions: { graph_hash: 'hash-at-emit', target_entity_ids: ['fac_x'] },
    expires_at_turn_count: overrides?.expires_at_turn_count ?? 2,
    expires_at_iso: overrides?.expires_at_iso ?? '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-03T00:00:00.000Z',
  };
}

function liveChipOffer(): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_action_what_would_flip_TEST',
    action: { kind: 'what_would_flip' },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-03T00:00:00.000Z',
  };
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [...seededPendings],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  });
}

function textRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text: 'Some Sonnet text.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

/**
 * A message that trips NO deterministic pre-route (not a short-confirm,
 * dismissal, ordinal/label pick, state query, or edit verb) so the turn
 * reaches LLM routing and the assembled pack is observable on the adapter.
 */
const NEUTRAL_MESSAGE = 'why is this close?';

function packUserContent(adapter: ReturnType<typeof textRoutingAdapter>): string {
  expect(adapter.chatWithTools).toHaveBeenCalled();
  const args = adapter.chatWithTools.mock.calls[0]![0];
  const first = args.messages[0];
  expect(typeof first?.content).toBe('string');
  return first!.content as string;
}

function setFlag(on: boolean): void {
  (config.cee as { pendingConfirmationTruthEnabled: boolean }).pendingConfirmationTruthEnabled = on;
}

let originalFlag = true;

describe('pending-confirmation truth — ContextPack and frame from one authority', () => {
  beforeEach(() => {
    seededPendings = [];
    originalFlag = config.cee.pendingConfirmationTruthEnabled === true;
    setFlag(true);
  });
  afterEach(() => {
    setFlag(originalFlag);
    vi.clearAllMocks();
  });

  it('live apply_proposed_change → pack pending_confirmation TRUE and frame pendingConfirmation TRUE (red on baseline)', async () => {
    seededPendings = [liveProposal()];
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-live-proposal', {
      routingAdapter: adapter,
    });
    expect(packUserContent(adapter)).toContain('"pending_confirmation": true');
    expect(result.frame).toBeDefined();
    expect(result.frame!.conversation.pendingConfirmation).toBe(true);
  });

  it('wall-expired proposal → FALSE at both seams (store read does not filter expiry; length>0 would lie)', async () => {
    seededPendings = [liveProposal({ expires_at_iso: '2020-01-01T00:00:00.000Z' })];
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-wall-expired', {
      routingAdapter: adapter,
    });
    expect(packUserContent(adapter)).toContain('"pending_confirmation": false');
    expect(result.frame).toBeDefined();
    expect(result.frame!.conversation.pendingConfirmation).toBe(false);
  });

  it('turn-count-exhausted proposal (expires_at_turn_count 0) → FALSE at both seams', async () => {
    seededPendings = [liveProposal({ expires_at_turn_count: 0 })];
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-turn-expired', {
      routingAdapter: adapter,
    });
    expect(packUserContent(adapter)).toContain('"pending_confirmation": false');
    expect(result.frame).toBeDefined();
    expect(result.frame!.conversation.pendingConfirmation).toBe(false);
  });

  it('live what_would_flip chip offer → FALSE at both seams (suggestion, not a pending change) but visible in frame pending counts', async () => {
    seededPendings = [liveChipOffer()];
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-chip-offer-kind-scope', {
      routingAdapter: adapter,
    });
    expect(packUserContent(adapter)).toContain('"pending_confirmation": false');
    expect(result.frame).toBeDefined();
    expect(result.frame!.conversation.pendingConfirmation).toBe(false);
    // Diagnostics honesty: the offer is still observable.
    expect(result.frame!.pending).toBeDefined();
    expect(result.frame!.pending!.liveCount).toBe(1);
    expect(result.frame!.pending!.kinds.what_would_flip).toBe(1);
    expect(result.frame!.pending!.confirmationExpectingLiveCount).toBe(0);
  });

  it('kill-switch OFF + live proposal → FALSE at both seams (code-free rollback), diagnostics still carry truth', async () => {
    seededPendings = [liveProposal()];
    setFlag(false);
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-kill-switch-off', {
      routingAdapter: adapter,
    });
    expect(packUserContent(adapter)).toContain('"pending_confirmation": false');
    expect(result.frame).toBeDefined();
    expect(result.frame!.conversation.pendingConfirmation).toBe(false);
    expect(result.frame!.pending).toBeDefined();
    expect(result.frame!.pending!.confirmationExpectingLiveCount).toBe(1);
    expect(result.frame!.pending!.threaded).toBe(false);
  });

  it('no pending actions at all → FALSE at both seams with zero counts', async () => {
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-no-pending', {
      routingAdapter: adapter,
    });
    expect(packUserContent(adapter)).toContain('"pending_confirmation": false');
    expect(result.frame).toBeDefined();
    expect(result.frame!.conversation.pendingConfirmation).toBe(false);
    expect(result.frame!.pending).toBeDefined();
    expect(result.frame!.pending!.liveCount).toBe(0);
    expect(result.frame!.pending!.confirmationExpectingLiveCount).toBe(0);
  });

  it('REDACTION: a hostile proposal (sentinel label / message / patch) reduces to counts only — no prose reaches the frame pending block or pack pending_confirmation', async () => {
    const SENTINEL_LABEL = 'XQSENTINEL_PROPOSAL_LABEL_user_prose';
    const SENTINEL_MESSAGE = 'XQSENTINEL_PROPOSAL_MESSAGE_user_prose';
    const SENTINEL_FACTOR = 'fac_XQSENTINEL_FACTOR_ID';
    const ref = `chip_proposal_${randomUUID()}`;
    const hostile: PendingAction = {
      id: `pa-${randomUUID()}`,
      scenario_id: SCENARIO_ID,
      chip_id: ref,
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: ref,
        inline_patch: {
          handler_id: 'set_factor_value',
          params: { factor_id: SENTINEL_FACTOR, value: 10, operator: 'set' },
          target_entity_ids: [SENTINEL_FACTOR],
        },
        public_label: SENTINEL_LABEL,
        public_message: SENTINEL_MESSAGE,
      },
      preconditions: { graph_hash: 'hash-at-emit', target_entity_ids: [SENTINEL_FACTOR] },
      expires_at_turn_count: 2,
      expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-07-03T00:00:00.000Z',
    };
    seededPendings = [hostile];
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-redaction', {
      routingAdapter: adapter,
    });
    // Fixture liveness: the sentinels genuinely entered the pipeline (the
    // pending action is what the executor derived truth from).
    expect(result.frame).toBeDefined();
    expect(result.frame!.pending!.liveCount).toBe(1);
    expect(result.frame!.pending!.confirmationExpectingLiveCount).toBe(1);
    // Redaction: no sentinel prose in the frame's pending block …
    const pendingJson = JSON.stringify(result.frame!.pending);
    for (const s of [SENTINEL_LABEL, SENTINEL_MESSAGE, SENTINEL_FACTOR]) {
      expect(pendingJson, `LEAK: ${s} surfaced in frame.pending`).not.toContain(s);
    }
    // … nor anywhere in the frame's conversation projection …
    expect(JSON.stringify(result.frame!.conversation)).not.toContain('XQSENTINEL');
    // … nor in the LLM-routing-visible pack (only the boolean flag crosses).
    const packContent = packUserContent(adapter);
    expect(packContent).not.toContain('XQSENTINEL');
    expect(packContent).toContain('"pending_confirmation": true');
  });

  it('agreement invariant: pack and frame never disagree (live proposal, flag ON)', async () => {
    seededPendings = [liveProposal(), liveChipOffer()];
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-agreement', {
      routingAdapter: adapter,
    });
    const packSaysTrue = packUserContent(adapter).includes('"pending_confirmation": true');
    expect(result.frame).toBeDefined();
    expect(result.frame!.conversation.pendingConfirmation).toBe(packSaysTrue);
    expect(packSaysTrue).toBe(true);
  });

  it('lifecycle: a live prior proposal carries forward → frame.pending.lifecycle shows it survived (post-commit tally)', async () => {
    seededPendings = [liveProposal()];
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-lifecycle-survive', {
      routingAdapter: adapter,
    });
    expect(result.frame!.pending!.lifecycle).toBeDefined();
    expect(result.frame!.pending!.lifecycle).toMatchObject({
      priorCount: 1,
      survivedCount: 1,
      consumedCount: 0,
      expiredWallCount: 0,
    });
  });

  it('lifecycle: a wall-expired prior proposal → frame.pending.lifecycle attributes it to expiredWallCount', async () => {
    seededPendings = [liveProposal({ expires_at_iso: '2020-01-01T00:00:00.000Z' })];
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-lifecycle-expired', {
      routingAdapter: adapter,
    });
    expect(result.frame!.pending!.lifecycle).toMatchObject({
      priorCount: 1,
      expiredWallCount: 1,
      survivedCount: 0,
    });
    // ORIENT-time counts agree: the expired entry was seen but not live.
    expect(result.frame!.pending!.liveCount).toBe(0);
    expect(result.frame!.pending!.expiredCount).toBe(1);
  });

  it('rerun readiness: a no-prior-run turn reports 0 successful runs and comparison NOT ready', async () => {
    const adapter = textRoutingAdapter();
    const result = await runTurnExecutor(payload(NEUTRAL_MESSAGE), 'req-rerun-readiness', {
      routingAdapter: adapter,
    });
    expect(result.frame!.diagnostics.rerun).toBeDefined();
    expect(result.frame!.diagnostics.rerun!.priorSuccessfulRunCount).toBe(0);
    expect(result.frame!.diagnostics.rerun!.comparisonCandidatesReady).toBe(false);
  });
});
