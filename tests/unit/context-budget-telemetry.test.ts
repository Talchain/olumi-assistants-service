/**
 * Context Architecture v2 — S0 "measure first" (ROADMAP 1.73).
 *
 * Design of record: docs-designs/CONTEXT-ARCHITECTURE-V2-2026-07-13/
 *   - 03-budgets-and-telemetry §2 — `v5.context_budget` +
 *     `v5.context_truncation` field sets;
 *   - 05-build-plan S0 — events at the turn-executor sibling + cut sites
 *     (`truncateGraphJson`, `capConversationText`, window slice, brief
 *     slice), usage-token capture into the events.
 *
 * The tests below pin the cut-site telemetry field sets (03 §2) AND the
 * now-unconditional in-band disclosure: the turn-path cut sites emit
 * `disclosed:true` and the edit-lane graph header reports post-truncation
 * counts (the pre-disclosure misreporting header is fixed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as telemetry from '../../src/utils/telemetry.js';
import { TelemetryEvents } from '../../src/utils/telemetry.js';
import {
  emitContextBudget,
  emitContextTruncation,
  computeOverBudget,
  CONTEXT_SECTION_BUDGETS,
} from '../../src/orchestrator-v5/context/context-budget-telemetry.js';
import {
  projectBrief,
  projectConversation,
  CONTEXT_PACK_RECENT_TURNS_CAP,
} from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { SessionTurnWithContent } from '../../src/orchestrator-v5/session/conversation-content.js';
import { capConversationText, CONVERSATION_TEXT_CAP } from '../../src/orchestrator-v5/commit.js';

let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function eventsNamed(name: string): Record<string, unknown>[] {
  return emitSpy.mock.calls
    .filter((c: readonly unknown[]) => c[0] === name)
    .map((c: readonly unknown[]) => c[1] as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// v5.context_budget — emitter unit (03 §2 exact field set)
// ---------------------------------------------------------------------------

describe('emitContextBudget (v5.context_budget)', () => {
  it('emits the exact 03 §2 field set for a routing fixture pack', () => {
    emitContextBudget({
      call_site: 'routing',
      model: 'claude-sonnet-5',
      prompt_version: 'v42.2j',
      prompt_hash: 'abc123',
      request_id: 'req_1',
      scenario_id: 'scn_1',
      section_chars: {
        conversation: 16_000,
        brief: 1_200,
        display_analysis: 3_000,
        display_graph: 2_200,
        rest: 900,
      },
      total_chars: 23_300,
      truncations: [
        { section: 'brief', original_chars: 4_000, kept_chars: 1_200, disclosed: true },
      ],
      summary_lag_turns: null,
      ui_narrowed: null,
      usage: {
        input_tokens: 9_000,
        output_tokens: 700,
        cache_read_input_tokens: 5_000,
        cache_creation_input_tokens: 0,
      },
    });

    const events = eventsNamed(TelemetryEvents.V5ContextBudget);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.call_site).toBe('routing');
    expect(ev.model).toBe('claude-sonnet-5');
    expect(ev.prompt_version).toBe('v42.2j');
    expect(ev.prompt_hash).toBe('abc123');
    expect(ev.request_id).toBe('req_1');
    expect(ev.scenario_id).toBe('scn_1');
    expect(ev.section_chars).toEqual({
      conversation: 16_000,
      brief: 1_200,
      display_analysis: 3_000,
      display_graph: 2_200,
      rest: 900,
    });
    expect(ev.total_chars).toBe(23_300);
    // Routing budget total per 03 §1: ≤ 55,000 chars.
    expect(ev.budget_chars).toBe(55_000);
    expect(ev.over_budget).toEqual([]);
    expect(ev.truncations).toEqual([
      { section: 'brief', original_chars: 4_000, kept_chars: 1_200, disclosed: true },
    ]);
    expect(ev.summary_lag_turns).toBeNull();
    expect(ev.ui_narrowed).toBeNull();
    expect(ev.usage).toEqual({
      input_tokens: 9_000,
      output_tokens: 700,
      cache_read_input_tokens: 5_000,
      cache_creation_input_tokens: 0,
    });
    // chars_per_token = total_chars / usage.input_tokens.
    expect(ev.chars_per_token).toBeCloseTo(23_300 / 9_000, 2);
  });

  it('flags over-budget sections by name and total when the pack blows the budget', () => {
    const over = computeOverBudget('routing', {
      conversation: 35_000, // budget 34,000
      brief: 1_000,
      display_graph: 9_500, // budget 8,000
      display_analysis: 1_000,
    }, 60_000);
    expect(over).toContain('conversation');
    expect(over).toContain('display_graph');
    expect(over).toContain('total'); // 60,000 > 55,000
    expect(over).not.toContain('brief');
  });

  it('is null-safe when usage is unavailable (no tokens → chars_per_token null)', () => {
    emitContextBudget({
      call_site: 'draft_graph',
      model: null,
      prompt_version: null,
      prompt_hash: null,
      request_id: 'req_2',
      scenario_id: null,
      section_chars: { brief: 500 },
      total_chars: 500,
      truncations: [],
      summary_lag_turns: null,
      ui_narrowed: null,
      usage: undefined,
    });

    const [ev] = eventsNamed(TelemetryEvents.V5ContextBudget);
    expect(ev.usage).toEqual({
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    });
    expect(ev.chars_per_token).toBeNull();
    // draft_graph is instrumented but NOT budgeted (03 §1) → null budget.
    expect(ev.budget_chars).toBeNull();
    expect(ev.over_budget).toEqual([]);
  });

  it('never throws even on a hostile payload', () => {
    expect(() =>
      emitContextBudget({
        call_site: 'edit_graph',
        model: null,
        prompt_version: null,
        prompt_hash: null,
        request_id: 'req_3',
        scenario_id: null,
        section_chars: { graph_json: Number.NaN },
        total_chars: Number.NaN,
        truncations: [],
        summary_lag_turns: null,
        ui_narrowed: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    ).not.toThrow();
  });

  it('exposes the 03 §1 per-site budget tables', () => {
    expect(CONTEXT_SECTION_BUDGETS.routing.total).toBe(55_000);
    expect(CONTEXT_SECTION_BUDGETS.routing.sections.conversation).toBe(34_000);
    expect(CONTEXT_SECTION_BUDGETS.routing.sections.display_graph).toBe(8_000);
    expect(CONTEXT_SECTION_BUDGETS.edit_graph.sections.graph_json).toBe(8_000);
    expect(CONTEXT_SECTION_BUDGETS.edit_graph.sections.brief).toBe(1_000);
    expect(CONTEXT_SECTION_BUDGETS.decision_review.sections.graph_json).toBe(16_000);
    expect(CONTEXT_SECTION_BUDGETS.decision_review.sections.isl_results).toBe(16_000);
  });
});

// ---------------------------------------------------------------------------
// v5.context_truncation — emitter unit
// ---------------------------------------------------------------------------

describe('emitContextTruncation (v5.context_truncation)', () => {
  it('emits {site, section, original_chars, kept_chars, strategy, disclosed}', () => {
    emitContextTruncation({
      site: 'serialise.truncateGraphJson',
      section: 'graph_json',
      original_chars: 20_000,
      kept_chars: 7_800,
      strategy: 'drop_edges_then_nodes',
      disclosed: false,
      request_id: 'req_4',
      scenario_id: 'scn_4',
    });

    const events = eventsNamed(TelemetryEvents.V5ContextTruncation);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      site: 'serialise.truncateGraphJson',
      section: 'graph_json',
      original_chars: 20_000,
      kept_chars: 7_800,
      strategy: 'drop_edges_then_nodes',
      disclosed: false,
      request_id: 'req_4',
      scenario_id: 'scn_4',
    });
  });
});

// ---------------------------------------------------------------------------
// Cut site 3: brief slice (context-pack-assembler projectBrief)
// ---------------------------------------------------------------------------

describe('cut site: brief slice (projectBrief)', () => {
  it('emits a DISCLOSED brief truncation event with exact original_chars', () => {
    const brief = 'b'.repeat(4_321);
    const projected = projectBrief(brief);
    expect(projected).not.toBeNull();
    expect(projected!.truncated).toBe(true);

    const briefCuts = eventsNamed(TelemetryEvents.V5ContextTruncation).filter(
      (e) => e.section === 'brief',
    );
    expect(briefCuts).toHaveLength(1);
    expect(briefCuts[0]).toMatchObject({
      site: 'context-pack-assembler.projectBrief',
      original_chars: 4_321,
      kept_chars: 2_000,
      strategy: 'hard_slice',
      disclosed: true, // the pack carries truncated/original_chars in-band
    });
  });

  it('emits nothing when the brief fits', () => {
    projectBrief('short brief');
    expect(eventsNamed(TelemetryEvents.V5ContextTruncation)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cut site 4: window slice (context-pack-assembler projectConversation)
// ---------------------------------------------------------------------------

function turnFixture(i: number): SessionTurnWithContent {
  return {
    id: `row_${i}`,
    scenario_id: 'scenario_fixture',
    user_id: null,
    turn_id: `turn_${i}`,
    turn_class: 'handler',
    handler_id: 'run_analysis',
    request_hash: 'sha256:test',
    response_emitted: true,
    llm_calls_used: 0,
    duration_ms: 0,
    created_at: new Date(2026, 0, 1, 0, i).toISOString(),
    user_message: `question ${i}`,
    assistant_message: `answer ${i}`,
  };
}

describe('cut site: window slice (projectConversation)', () => {
  it('emits a DISCLOSED window-slice truncation event when prior turns exceed the cap', () => {
    const turns = Array.from({ length: 9 }, (_, i) => turnFixture(i));
    const projected = projectConversation(turns, false);
    expect(projected.recent_turns).toHaveLength(CONTEXT_PACK_RECENT_TURNS_CAP);

    const cuts = eventsNamed(TelemetryEvents.V5ContextTruncation).filter(
      (e) => e.section === 'conversation',
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0].site).toBe('context-pack-assembler.projectConversation');
    expect(cuts[0].strategy).toBe('window_slice');
    // Disclosure is now unconditional — the pack carries {shown, available}.
    expect(cuts[0].disclosed).toBe(true);
    // Chars accounting: message content of ALL prior turns vs the kept 5.
    const chars = (t: ReturnType<typeof turnFixture>) =>
      (t.user_message?.length ?? 0) + (t.assistant_message?.length ?? 0);
    expect(cuts[0].original_chars).toBe(turns.reduce((a, t) => a + chars(t), 0));
    expect(cuts[0].kept_chars).toBe(turns.slice(0, CONTEXT_PACK_RECENT_TURNS_CAP).reduce((a, t) => a + chars(t), 0));
  });

  it('emits nothing at or under the cap', () => {
    projectConversation(Array.from({ length: 5 }, (_, i) => turnFixture(i)), false);
    expect(eventsNamed(TelemetryEvents.V5ContextTruncation)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cut site 5: capConversationText (commit.ts persistence cap)
// ---------------------------------------------------------------------------

describe('cut site: capConversationText (commit.ts)', () => {
  it('emits a DISCLOSED hard-slice event with the exact original length', () => {
    const long = 'z'.repeat(CONVERSATION_TEXT_CAP + 777);
    const capped = capConversationText(long, 'user_message');
    expect(capped).toHaveLength(CONVERSATION_TEXT_CAP);

    const cuts = eventsNamed(TelemetryEvents.V5ContextTruncation);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({
      site: 'commit.capConversationText',
      section: 'user_message',
      original_chars: CONVERSATION_TEXT_CAP + 777,
      kept_chars: CONVERSATION_TEXT_CAP,
      strategy: 'hard_slice',
      // Disclosure is unconditional — projectConversation marks the at-cap
      // turn truncated:true, so downstream LLMs can see this cut.
      disclosed: true,
    });
  });

  it('emits nothing for short / empty / null input and preserves semantics', () => {
    expect(capConversationText('hello', 'assistant_message')).toBe('hello');
    expect(capConversationText('   ', 'user_message')).toBeUndefined();
    expect(capConversationText(null, 'user_message')).toBeUndefined();
    expect(capConversationText(undefined, 'assistant_message')).toBeUndefined();
    expect(eventsNamed(TelemetryEvents.V5ContextTruncation)).toHaveLength(0);
  });
});
