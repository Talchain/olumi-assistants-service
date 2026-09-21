/**
 * Real draft dispatch -> real atomic commit -> captured store write -> fresh
 * canonical selection/compaction -> next-turn conversation. Only the draft
 * tool and external store/read ports are isolated; no provider or DB calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';
import type { SessionStore, SessionTurnWrite } from '../../session/store.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';
import type { PendingAction } from '../../session/pending-action.js';

const ports = vi.hoisted(() => ({
  draft: vi.fn(),
  pendingRead: vi.fn(),
  sessionStore: vi.fn(),
}));
vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({ handleDraftGraph: ports.draft }));
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../build-turn-context.js')>(),
  loadMostRecentPendingActions: ports.pendingRead,
}));
vi.mock('../../session/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../session/index.js')>(),
  getSessionStore: ports.sessionStore,
}));
// The real post-commit maintainer contains a failed external-store lookup.
// Prevent its off-turn summary work from constructing a DB/provider client.
vi.mock('../../rolling-summary/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../rolling-summary/index.js')>(),
  getRollingSummaryStore: () => { throw new Error('Summary store isolated in continuity test'); },
}));

import { _resetConfigCache } from '../../../config/index.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { projectDraftRecords } from '../../../cee/draft/records/seam.js';
import { reconcileDraftOptionFraming } from '../../../cee/draft/records/option-framing.js';
import { OPTION_FRAMING_WARNING_ID, optionFramingWarnings } from '../../../cee/draft/records/option-framing-recovery.js';
import { transformResponseToV3 } from '../../../cee/transforms/schema-v3.js';
import { CEEGraphResponseV3 } from '../../../schemas/cee-v3.js';
import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';
import { parseConversationContent } from '../../session/conversation-content.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { selectContextGraphSnapshot } from '../../context/context-graph-snapshot.js';
import { compactSelectedGraphForContextPack } from '../../context/compact-graph-for-contextpack.js';
import { assembleContextPack } from '../../context/context-pack-assembler.js';
import { ContextPackSchema } from '../../context/context-pack-schema.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const QUESTION = 'Should we expand delivery capacity?';
const BRIEF = `${QUESTION} Compare opening a second warehouse with partnering with a fulfilment provider. Our goal is to improve delivery reliability.`;
const GAP_REASON = 'decision_framing_not_an_option';
const PAYLOAD = makeMessagePayload({
  scenario_id: SCENARIO_ID, turn_id: TURN_ID, message: 'Build the model.',
});

function producerFixture() {
  const seam = projectDraftRecords({
    stated_items: [
      { kind: 'goal', source_quote: 'improve delivery reliability' },
      { kind: 'option', source_quote: QUESTION, is_baseline: true },
      { kind: 'option', source_quote: 'opening a second warehouse', is_baseline: false },
      { kind: 'option', source_quote: 'partnering with a fulfilment provider', is_baseline: false },
    ],
    claims: [
      { claim_kind: 'factor', label: 'Fulfilment capacity', category: 'controllable', basis: [2, 3] },
      { claim_kind: 'causal_link', label: 'Warehouse expands capacity', from_stated: 2, to_claim: 0, sets_to: 0.8 },
      { claim_kind: 'causal_link', label: 'Partner supplies capacity', from_stated: 3, to_claim: 0, sets_to: 0.6 },
      { claim_kind: 'causal_link', label: 'Capacity improves delivery', from_claim: 0, to_stated: 0, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Question option holds capacity', from_stated: 1, to_claim: 0, sets_to: 0.4 },
    ],
  }, BRIEF);
  if (!seam.ok) throw new Error(`Invalid source fixture: ${JSON.stringify(seam)}`);
  const reconciled = reconcileDraftOptionFraming(seam.records, seam.projection);
  if (reconciled.unresolved.length !== 1) throw new Error('Expected exactly one producer-owned framing gap');
  const disclosures = [...reconciled.projection.dropped, ...reconciled.unresolved];
  const warnings = optionFramingWarnings(disclosures);
  const graph = CEEGraphResponseV3.parse(transformResponseToV3({
    graph: reconciled.projection.graph,
    record_disclosures: disclosures,
    draft_warnings: warnings,
  } as never, { brief: BRIEF }));
  return { graph, warnings, gap: reconciled.unresolved[0]! };
}

function draftResult(graph: DraftGraphResult['graphOutput'], warnings: DraftGraphResult['draftWarnings']): DraftGraphResult {
  return {
    blocks: [], assistantText: 'Draft output available.', latencyMs: 1,
    strengthenItems: [], coachingSummary: null, coachingWideningLog: null,
    coachingBiasSignals: null, draftWarnings: warnings, graphOutput: graph,
  };
}

function captureStore(failAppend = false) {
  const attempts: SessionTurnWrite[] = [];
  const committed: SessionTurnWrite[] = [];
  const store: SessionStore = {
    ...createNoopSessionStore(),
    async append(write) {
      attempts.push(structuredClone(write));
      if (failAppend) throw new Error('Controlled atomic append failure');
      committed.push(structuredClone(write));
      return { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    },
  };
  ports.sessionStore.mockReturnValue(store);
  return { attempts, committed };
}

function freshPack(write: SessionTurnWrite) {
  // The read-side content parser consumes ONLY what the real commit handed
  // to append. Never substitute the immediate response for the durable text.
  const turn: SessionTurnWithContent = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    scenario_id: write.scenario_id, turn_id: write.turn_id,
    user_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    turn_class: write.turn_class, handler_id: write.handler_id,
    request_hash: write.request_hash, response_emitted: write.response_emitted,
    llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms,
    created_at: '2026-08-31T12:00:00.000Z',
    ...parseConversationContent({ user_message: write.userMessage, assistant_message: write.assistantMessage }),
  };
  const selection = selectContextGraphSnapshot({
    canonicalRead: { status: 'ok_present', graph: structuredClone(write.graph) },
    requestGraph: null,
  });
  expect(selection.status).toBe('canonical');
  const compacted = compactSelectedGraphForContextPack(selection, { requestId: 'framing-next-turn' });
  if (compacted.kind !== 'compacted') throw new Error(`Canonical compaction failed: ${JSON.stringify(compacted)}`);
  const pack = assembleContextPack({
    payload: makeMessagePayload({
      scenario_id: write.scenario_id, turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      message: 'What needs clarifying before we compare?',
    }),
    graph: undefined, compactedGraph: compacted.compact,
    graphContext: { status: selection.status },
    priorTurns: [turn], priorFacts: [],
  });
  expect(ContextPackSchema.safeParse(pack).success).toBe(true);
  return { compacted: compacted.compact, pack };
}

function occurrenceCount(text: string | null | undefined, needle: string): number {
  return (text ?? '').split(needle).length - 1;
}

async function dispatch() {
  return dispatchDraftGraph({
    payload: PAYLOAD, briefOverride: BRIEF,
    requestId: 'framing-continuity', request: { headers: {} } as FastifyRequest,
  });
}

function pendingHold(ref: string, label: string, graphHash: string, turns: number): PendingAction {
  return {
    id: `pending-${ref}`, scenario_id: SCENARIO_ID, chip_id: ref,
    action: {
      kind: 'apply_proposed_change', proposal_ref: ref,
      inline_patch: { handler_id: 'set_factor_value', params: { value: 0.7 }, target_entity_ids: [] },
      public_label: label, public_message: 'Apply the change.',
    },
    preconditions: { graph_hash: graphHash }, expires_at_turn_count: turns,
    expires_at_iso: '2099-12-31T23:59:59.000Z', emitted_at_iso: '2026-08-31T11:59:00.000Z',
  } as PendingAction;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'false');
  vi.stubEnv('CEE_V6_DUAL_DRAFT_ENABLED', 'false');
  _resetConfigCache();
  setTestSink(() => undefined);
  ports.pendingRead.mockResolvedValue([]);
});
afterEach(() => {
  setTestSink(null);
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('draft option framing continuity through the real commit', () => {
  it('retains the exact producer gap in next-turn conversation even though graph compaction drops it', async () => {
    const fixture = producerFixture();
    ports.draft.mockResolvedValue(draftResult(fixture.graph, fixture.warnings));
    const store = captureStore();
    const result = await dispatch();

    expect(result.commitPerformed).toBe(true);
    expect(store.attempts).toHaveLength(1);
    expect(store.committed).toHaveLength(1);
    const write = store.committed[0]!;
    const warning = fixture.warnings[0]!;
    expect(write.userMessage).toBe('Build the model.');
    expect(write.assistantMessage).toContain(warning.explanation);
    expect(write.assistantMessage).toContain(warning.fix_hint);
    expect(occurrenceCount(write.assistantMessage, warning.explanation)).toBe(1);
    expect(occurrenceCount(result.response.assistant_text, warning.explanation)).toBe(1);
    expect(occurrenceCount(result.response.assistant_text, warning.fix_hint)).toBe(1);
    const saved = write.graph as typeof fixture.graph;
    expect(saved.nodes.some(node => node.id === fixture.gap.node_id)).toBe(false);
    expect(saved.nodes.filter(node => node.kind === 'option').map(node => node.id))
      .toEqual(fixture.graph.nodes.filter(node => node.kind === 'option').map(node => node.id));
    expect(JSON.stringify(saved)).toContain(GAP_REASON);

    const { compacted, pack } = freshPack(write);
    expect(JSON.stringify(compacted)).not.toContain(GAP_REASON);
    expect(JSON.stringify(compacted)).not.toContain(OPTION_FRAMING_WARNING_ID);
    const remembered = pack.conversation.recent_turns[0]!.assistant_message;
    expect(remembered).toBe(write.assistantMessage);
    expect(remembered).toContain(QUESTION);
    expect(remembered).toContain(warning.explanation);
    expect(remembered).toContain(warning.fix_hint);
  });

  it('keeps mutation and commit-time TTL lapse notices without duplicating the framing warning', async () => {
    const fixture = producerFixture();
    ports.draft.mockResolvedValue(draftResult(fixture.graph, fixture.warnings));
    const hash = computeAnalysisAffectingGraphHash(projectGraphForPersistence(fixture.graph));
    if (hash === null) throw new Error('Expected a real projected graph hash');
    const moved = pendingHold('held_moved', 'Capacity change', 'different-old-graph', 4);
    const expired = pendingHold('held_expired', 'Earlier proposal', hash, 1);
    ports.pendingRead.mockResolvedValue([moved, expired]);
    const store = captureStore();
    const result = await dispatch();
    expect(result.commitPerformed).toBe(true);
    expect(store.committed).toHaveLength(1);
    const write = store.committed[0]!;
    const notices = [
      "The held change 'Capacity change' has lapsed because the model changed, say the word if you still want it.",
      "The held change 'Earlier proposal' has lapsed, say the word if you still want it.",
    ];
    for (const notice of notices) {
      expect(occurrenceCount(write.assistantMessage, notice)).toBe(1);
      expect(occurrenceCount(result.response.assistant_text, notice)).toBe(1);
    }
    expect(occurrenceCount(result.response.assistant_text, fixture.warnings[0]!.explanation)).toBe(1);
    expect(write.pending_actions?.map(pending => pending.chip_id)).not.toContain(moved.chip_id);
    expect(write.pending_actions?.map(pending => pending.chip_id)).not.toContain(expired.chip_id);
  });

  it.each(['clean', 'unrelated warning'] as const)('does not invent a gap for a %s draft', async kind => {
    const fixture = producerFixture();
    const { record_disclosures: _disclosures, draft_warnings: _warnings, ...cleanGraph } = fixture.graph;
    const warnings = kind === 'clean' ? [] : [{
      id: 'UNRELATED_WARNING', severity: 'medium' as const,
      explanation: 'Question whether the delivery assumptions need evidence.', fix_hint: 'Review the evidence.',
    }];
    ports.draft.mockResolvedValue(draftResult(cleanGraph, warnings));
    const store = captureStore();
    const result = await dispatch();
    expect(result.commitPerformed).toBe(true);
    expect(store.committed).toHaveLength(1);
    const write = store.committed[0]!;
    const { pack } = freshPack(write);
    for (const text of [result.response.assistant_text, write.assistantMessage, pack.conversation.recent_turns[0]!.assistant_message]) {
      expect(text ?? '').not.toContain(fixture.warnings[0]!.explanation);
      expect(text ?? '').not.toContain(fixture.warnings[0]!.fix_hint);
      expect(text ?? '').not.toContain('excluded from the comparison');
    }
  });

  it('returns failure without advancing or claiming a saved draft when the atomic append fails', async () => {
    const fixture = producerFixture();
    ports.draft.mockResolvedValue(draftResult(fixture.graph, fixture.warnings));
    const store = captureStore(true);
    const result = await dispatch();
    expect(store.attempts).toHaveLength(1);
    expect(store.committed).toHaveLength(0);
    expect(result.commitPerformed).toBe(false);
    expect(result.response.stage_indicator).toBe(PAYLOAD.stage);
    expect(result.analysisReady).toBeUndefined();
    expect(result.response.assistant_text).toBe('Draft output available.');
    expect(result.response.assistant_text).not.toMatch(/saved|I've built|excluded from the comparison/i);
  });
});
