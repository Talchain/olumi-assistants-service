/**
 * Knowledge-over-time (ROADMAP 1.199, P6) — the SILENT DECISION-RECORD DROP,
 * pinned at the REAL seam: TurnExecutor → decision-records read → projection →
 * assembler → routing adapter → `v5.context_budget`.
 *
 * The defect, verified live on deployed build `55c64ed` (2026-07-25): a
 * scenario holding NINE decision records answered "That's 8 prior decisions on
 * record" and called the list "the full record". Three cuts, none of them
 * visible: the SQL `LIMIT 8` dropped record 9 before the process saw it; the
 * projection derived `omitted` from the POST-cap array so it could only ever
 * report char-budget drops; and the call site discarded the projection's
 * `truncated`/`totalCount` entirely, so `v5.context_budget.truncations` read
 * `[]` on the very turn a record was evicted.
 *
 * This file proves the whole chain end-to-end:
 *   1. the prompt the model actually receives states the TRUE total, and
 *   2. the drop is observable in telemetry WITHOUT reading model prose.
 * Plus the negative control at a FULL cap (8 stored / 8 read), where neither
 * may appear — an absence assertion that cannot see a presence is vacuous.
 *
 * ONLY `getDecisionRecordStore` is faked. The projection, the loader, the
 * assembler and the telemetry are the real modules: the mock factory spreads
 * `importOriginal()` rather than hand-listing exports, because a hand-listed
 * mock factory REPLACES the module and silently loses everything it forgot.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';
import type { DecisionRecordRead } from '../decision-records/store-adapter.js';

import { setTestSink } from '../../utils/telemetry.js';
import { OLDER_RELEVANT_FACTS_INSTRUCTION } from '../routing/route-with-tool-use.js';

const SCENARIO_ID = randomUUID();

/** Nine stored records, newest-first, exactly as `created_at DESC` returns them. */
function storedRecords(n: number): DecisionRecordRead[] {
  return Array.from({ length: n }, (_, i) => ({
    record_id: `rrrrrrrr-0000-4000-8000-${String(i).padStart(12, '0')}`,
    scenario_id: SCENARIO_ID,
    created_at: new Date(Date.UTC(2026, 6, 20 - i, 10, 0, 0)).toISOString(),
    decision: {
      chosen_option_label: `Option ${n - i}`,
      chosen_option_id: `opt-${n - i}`,
      graph_hash: 'aag_v1:sha256:x',
    },
    prediction: {
      statement: `Rationale for option ${n - i}.`,
      confidence_source: 'model_derived',
    },
  }));
}

// Mutable per-test: how many records the scenario HOLDS.
let recordsHeld: DecisionRecordRead[] = storedRecords(9);

vi.mock('../decision-records/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../decision-records/index.js')>();
  return {
    // Spread the real module: `loadOlderRelevantFactsSection`,
    // `projectDecisionRecords` and every future export stay REAL.
    ...actual,
    getDecisionRecordStore: () => ({
      createRecord: async () => ({ record_id: 'x', deduped: false, event_id: null }),
      // Models the live SQL at the bytes: the LIMIT is applied to the ROWS,
      // while `count: 'exact'` reports the total BEHIND the limit.
      retrieveRecords: async (_scenarioId: string, opts?: { limit?: number }) => ({
        records: recordsHeld.slice(0, opts?.limit ?? recordsHeld.length),
        totalCount: recordsHeld.length,
      }),
    }),
  };
});

vi.mock('../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({ summarise: async () => ({ text: 'DECISION FRAME: noop.' }) }),
  resetRollingSummaryForTests: () => undefined,
}));

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: 'Supplier decision brief.' }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function textOnlyAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> };
  calls: ChatWithToolsArgs[];
} {
  const calls: ChatWithToolsArgs[] = [];
  return {
    calls,
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        calls.push(args);
        return {
          content: [{ type: 'text', text: 'Here is what I would focus on.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 40 } as ChatWithToolsResult['usage'],
          model: 'claude-sonnet-4-6',
          latencyMs: 25,
        };
      },
    },
  };
}

interface SunkEvent {
  event: string;
  payload: Record<string, unknown>;
}
let events: SunkEvent[];

function routingUserMessage(calls: ChatWithToolsArgs[]): string {
  expect(calls.length).toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user).toBeDefined();
  return typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content);
}

/**
 * The `older_relevant_facts` section AS SERIALISED into the routing prompt.
 *
 * Scoping matters: the pack now carries a SECOND, unrelated honesty
 * disclosure — the conversation window's own `[INCOMPLETE …]` line — so a
 * whole-prompt `not.toContain('INCOMPLETE')` would fail on a disclosure about
 * a different field entirely. Asserting on this section's own bytes keeps the
 * negative control measuring the thing it names.
 */
function olderRelevantFactsSection(prompt: string): string {
  const json = prompt.slice(prompt.indexOf('{'), prompt.lastIndexOf('}') + 1);
  const pack = JSON.parse(json) as { older_relevant_facts?: string };
  return pack.older_relevant_facts ?? '';
}

function budgetTruncations(): Array<Record<string, unknown>> {
  return events
    .filter((e) => e.event === 'v5.context_budget')
    .flatMap((e) => (e.payload.truncations as Array<Record<string, unknown>>) ?? []);
}

async function runTurn(): Promise<ChatWithToolsArgs[]> {
  const { adapter, calls } = textOnlyAdapter();
  await runTurnExecutor(payload('List every prior decision and how many there are.'), `req-${randomUUID()}`, {
    routingAdapter: adapter,
  });
  return calls;
}

describe('decision-records cap — route-level: a dropped record is disclosed AND observable', () => {
  beforeEach(() => {
    events = [];
    setTestSink((event, p) => {
      events.push({ event, payload: p as Record<string, unknown> });
    });
  });

  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  it('9 stored / 8 read — the ROUTING PROMPT states the true total 9, and v5.context_budget records the drop', async () => {
    recordsHeld = storedRecords(9);
    const calls = await runTurn();
    const prompt = routingUserMessage(calls);

    // (1) The model-facing shape. Pre-fix this section listed 8 records under a
    // header reading as a complete record, with no disclosure of any kind.
    expect(prompt).toContain('Prior decisions recorded on this scenario');
    // Scoped to THIS section's bytes: the pack also carries a conversation-
    // window disclosure using the same [INCOMPLETE …] marker, so an
    // unscoped match would no longer prove the RECORDS section disclosed.
    const section = olderRelevantFactsSection(prompt);
    expect(section).toContain('INCOMPLETE');
    expect(section).toContain('9 decisions are on record');
    expect(section).toContain('the true total is 9');

    // (1b) And the CODE-OWNED sanction telling the model how to read that
    // section rides the same turn. Until 2026-07-25 this rule lived only in
    // the PMS-served prompt, where it drifted to the OPPOSITE claim ("it is
    // the complete set you hold", v120) within twenty minutes of the
    // [INCOMPLETE …] line landing. Asserting it HERE — through the real
    // turn-executor → routing chain — is what proves the emission is
    // reachable, not merely defined.
    expect(prompt).toContain(OLDER_RELEVANT_FACTS_INSTRUCTION);
    expect(prompt).not.toContain('the complete set you hold');

    // (2) The telemetry shape. Pre-fix `truncations` was `[]` on this exact
    // turn, because the call site discarded the projection's `truncated` flag.
    const olderFactsCuts = budgetTruncations().filter(
      (t) => t.section === 'older_relevant_facts',
    );
    expect(olderFactsCuts).toHaveLength(1);
    expect(olderFactsCuts[0].original_records).toBe(9);
    expect(olderFactsCuts[0].kept_records).toBe(8);
    expect(olderFactsCuts[0].disclosed).toBe(true);

    // (3) And the cut-site stream carries it too.
    const cutSite = events.filter(
      (e) =>
        e.event === 'v5.context_truncation' &&
        e.payload.section === 'older_relevant_facts',
    );
    expect(cutSite).toHaveLength(1);
    expect(cutSite[0].payload.strategy).toBe('record_drop');
  });

  it('NEGATIVE CONTROL — 8 stored / 8 read (a FULL cap): no disclosure in the prompt, no truncation on the wire', async () => {
    recordsHeld = storedRecords(8);
    const calls = await runTurn();
    const prompt = routingUserMessage(calls);

    // Proof this assertion can see a presence: the section IS there, with all
    // eight records — so "no disclosure" is a measured absence, not a blind one.
    expect(prompt).toContain('Prior decisions recorded on this scenario');
    expect(prompt).toContain('Option 8');
    expect(prompt).toContain('Option 1'); // the oldest at a full cap
    // Scoped to THIS section's bytes — see olderRelevantFactsSection. The
    // positive control above proves the instrument sees a presence, so these
    // are measured absences.
    const section = olderRelevantFactsSection(prompt);
    expect(section).toContain('Option 1');
    expect(section).not.toContain('INCOMPLETE');
    expect(section).not.toContain('the true total is');

    expect(budgetTruncations().filter((t) => t.section === 'older_relevant_facts')).toHaveLength(0);
    expect(
      events.filter(
        (e) =>
          e.event === 'v5.context_truncation' &&
          e.payload.section === 'older_relevant_facts',
      ),
    ).toHaveLength(0);
  });
});
