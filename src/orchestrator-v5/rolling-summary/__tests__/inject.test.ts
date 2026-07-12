/**
 * Context Architecture v2 — S4-INJECT (ROADMAP 1.73): the assembly-time
 * injector. RED-first pins (design pack 01 §2/§4, 04 §3, 05 §S4 inject row):
 *
 *  - flag 'off' / 'maintain' → NO section, NO store construction, NO lag —
 *    the injection half is byte-inert below 'inject' (two-stage flag).
 *  - 'inject' + no stored summary → no block, no error (loader returns null).
 *  - 'inject' + store error → no block, no error (never a turn failure).
 *  - 'inject' + stored summary → the four-slot block renders EXACTLY
 *    (golden), with [t:xxxxxxxx] provenance stamps riding along [R3].
 *  - staleness invariant (01 §4): lag ≥ windowDepth → stale:true + in-band
 *    disclosure note + v5.summary.lag emitted. Never silently stale.
 *  - lag is computed against the injector's window turns and surfaced for
 *    the v5.context_budget wiring (summary_lag_turns).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as telemetry from '../../../utils/telemetry.js';
import { TelemetryEvents } from '../../../utils/telemetry.js';

import {
  buildConversationSummarySection,
  loadConversationSummaryForInjection,
} from '../inject.js';
import type { RollingSummary } from '../summary-types.js';
import type { RollingSummaryStorePort } from '../store-adapter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T1 = { turn_id: 'aaaaaaaa-1111-4111-8111-111111111111', created_at: '2026-07-10T10:00:00.000Z' };
const T2 = { turn_id: 'bbbbbbbb-2222-4222-8222-222222222222', created_at: '2026-07-10T10:01:00.000Z' };
const T3 = { turn_id: 'cccccccc-3333-4333-8333-333333333333', created_at: '2026-07-10T10:02:00.000Z' };

function summaryFixture(): RollingSummary {
  return {
    text: [
      'DECISION FRAME: Choosing a supplier for the new product line.',
      'CONSTRAINTS & PREFERENCES: Keep Maria on the team.',
      'RESOLVED: (none)',
      'OPEN: Which region to launch first?',
    ].join('\n'),
    slots: [
      {
        slot: 'FRAME',
        entries: [
          { text: 'Choosing a supplier for the new product line.', source_turn_ids: [] },
        ],
      },
      {
        slot: 'CONSTRAINTS',
        entries: [
          { text: 'Keep Maria on the team.', source_turn_ids: [T1.turn_id, T2.turn_id] },
        ],
      },
      { slot: 'RESOLVED', entries: [] },
      {
        slot: 'OPEN',
        entries: [{ text: 'Which region to launch first?', source_turn_ids: [T2.turn_id] }],
      },
    ],
    updated_turn_id: T2.turn_id,
    updated_turn_created_at: T2.created_at,
    version: 3,
    generator: 'incremental',
    schema_version: 1,
  };
}

/** A store whose methods explode — proves the off/maintain paths never touch it. */
function explodingStore(): RollingSummaryStorePort {
  return {
    upsertSummary: vi.fn(async () => {
      throw new Error('upsertSummary must not be called by the injector');
    }),
    loadSummary: vi.fn(async () => {
      throw new Error('loadSummary must not be called below inject');
    }),
  };
}

function storeReturning(summary: RollingSummary | null): RollingSummaryStorePort & {
  loadSummary: ReturnType<typeof vi.fn>;
} {
  const loadSummary = vi.fn(async () => summary);
  return {
    loadSummary,
    upsertSummary: vi.fn(async () => {
      throw new Error('injector must never write');
    }),
  } as RollingSummaryStorePort & { loadSummary: ReturnType<typeof vi.fn> };
}

let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});

afterEach(() => {
  emitSpy.mockRestore();
});

function lagEmits(): unknown[][] {
  return emitSpy.mock.calls.filter((c) => c[0] === TelemetryEvents.V5SummaryLag);
}

// ---------------------------------------------------------------------------
// Flag ladder: off / maintain are byte-inert (no section, no store touch)
// ---------------------------------------------------------------------------

describe('loadConversationSummaryForInjection — flag ladder', () => {
  it("flag 'off' → no section, null lag, store NEVER constructed/touched", async () => {
    const store = explodingStore();
    const outcome = await loadConversationSummaryForInjection({
      flag: 'off',
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 5,
      summaryStore: store,
    });
    expect(outcome.section).toBeNull();
    expect(outcome.lagTurns).toBeNull();
    expect(store.loadSummary).not.toHaveBeenCalled();
    expect(lagEmits()).toHaveLength(0);
  });

  it("flag 'maintain' → identical to off: write-only shadow, nothing injects", async () => {
    const store = explodingStore();
    const outcome = await loadConversationSummaryForInjection({
      flag: 'maintain',
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 5,
      summaryStore: store,
    });
    expect(outcome.section).toBeNull();
    expect(outcome.lagTurns).toBeNull();
    expect(store.loadSummary).not.toHaveBeenCalled();
  });

  it("'inject' + no stored summary → no block, no error, null lag", async () => {
    const store = storeReturning(null);
    const outcome = await loadConversationSummaryForInjection({
      flag: 'inject',
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 5,
      summaryStore: store,
    });
    expect(outcome.section).toBeNull();
    expect(outcome.lagTurns).toBeNull();
    expect(store.loadSummary).toHaveBeenCalledTimes(1);
    expect(lagEmits()).toHaveLength(0);
  });

  it("'inject' + store error → no block, no error (never fails the turn)", async () => {
    const store: RollingSummaryStorePort = {
      loadSummary: vi.fn(async () => {
        throw new Error('RPC down');
      }),
      upsertSummary: vi.fn(),
    };
    const outcome = await loadConversationSummaryForInjection({
      flag: 'inject',
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 5,
      summaryStore: store,
    });
    expect(outcome.section).toBeNull();
    expect(outcome.lagTurns).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Injection: golden block, provenance stamps, lag
// ---------------------------------------------------------------------------

describe('loadConversationSummaryForInjection — inject renders the block', () => {
  it('fresh summary (watermark = newest window turn) → lag 0, not stale, golden text', async () => {
    const store = storeReturning(summaryFixture());
    const outcome = await loadConversationSummaryForInjection({
      flag: 'inject',
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 5,
    summaryStore: store,
    });
    expect(outcome.lagTurns).toBe(0);
    const section = outcome.section;
    expect(section).not.toBeNull();
    // Golden four-slot block with [t:xxxxxxxx] provenance stamps riding along.
    expect(section!.text).toBe(
      [
        'DECISION FRAME: Choosing a supplier for the new product line.',
        'CONSTRAINTS & PREFERENCES: Keep Maria on the team. [t:aaaaaaaa, t:bbbbbbbb]',
        'RESOLVED: (none)',
        'OPEN: Which region to launch first? [t:bbbbbbbb]',
      ].join('\n'),
    );
    expect(section!.current_to_turn_id).toBe(T2.turn_id);
    expect(section!.lag_turns).toBe(0);
    expect(section!.stale).toBe(false);
    expect(section!.note).toBeUndefined();
    expect(lagEmits()).toHaveLength(0);
  });

  it('stale summary (lag ≥ windowDepth) → disclosed in-band + v5.summary.lag emitted', async () => {
    // Watermark T1; window shows 3 newer turns; windowDepth 3 ⇒ lag 3 ≥ 3 ⇒ stale.
    const newer1 = { turn_id: 'dddddddd-4444-4444-8444-444444444444', created_at: '2026-07-10T10:03:00.000Z' };
    const summary = summaryFixture({});
    const staleSummary: RollingSummary = {
      ...summary,
      updated_turn_id: T1.turn_id,
      updated_turn_created_at: T1.created_at,
    };
    const store = storeReturning(staleSummary);
    const outcome = await loadConversationSummaryForInjection({
      flag: 'inject',
      scenarioId: 'scn-1',
      requestId: 'req-9',
      windowTurnsNewestFirst: [newer1, T3, T2],
      windowDepth: 3,
      summaryStore: store,
    });
    expect(outcome.lagTurns).toBe(3);
    const section = outcome.section;
    expect(section).not.toBeNull();
    expect(section!.stale).toBe(true);
    // The staleness disclosure the pack specs (01 §4) — never silently stale.
    expect(section!.note).toContain('current to an earlier turn');
    expect(section!.note).toContain('conversation');
    const lag = lagEmits();
    expect(lag).toHaveLength(1);
    expect(lag[0]![1]).toMatchObject({
      scenario_id: 'scn-1',
      request_id: 'req-9',
      lag_turns: 3,
      window_depth: 3,
      watermark_turn_id: T1.turn_id,
    });
  });

  it('below-threshold lag (lag < windowDepth) → fresh-enough: no note, no lag event', async () => {
    const staleSummary: RollingSummary = {
      ...summaryFixture(),
      updated_turn_id: T1.turn_id,
      updated_turn_created_at: T1.created_at,
    };
    const store = storeReturning(staleSummary);
    const outcome = await loadConversationSummaryForInjection({
      flag: 'inject',
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T3, T2, T1],
      windowDepth: 5,
      summaryStore: store,
    });
    expect(outcome.lagTurns).toBe(2);
    expect(outcome.section!.stale).toBe(false);
    expect(outcome.section!.note).toBeUndefined();
    expect(lagEmits()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pure renderer details
// ---------------------------------------------------------------------------

describe('buildConversationSummarySection — rendering rules', () => {
  it('renders from slots: empty non-FRAME slots show (none); no stamp when no ids', () => {
    const summary: RollingSummary = {
      ...summaryFixture(),
      slots: [
        { slot: 'FRAME', entries: [{ text: 'Frame only.', source_turn_ids: [] }] },
        { slot: 'CONSTRAINTS', entries: [] },
        { slot: 'RESOLVED', entries: [{ text: 'Budget settled.', source_turn_ids: [] }] },
        { slot: 'OPEN', entries: [] },
      ],
    };
    const section = buildConversationSummarySection(summary, 0, 5);
    expect(section.text).toBe(
      [
        'DECISION FRAME: Frame only.',
        'CONSTRAINTS & PREFERENCES: (none)',
        'RESOLVED: Budget settled.',
        'OPEN: (none)',
      ].join('\n'),
    );
    expect(section.stale).toBe(false);
  });

  it('multiple entries in one slot each carry their own stamps', () => {
    const summary: RollingSummary = {
      ...summaryFixture(),
      slots: [
        { slot: 'FRAME', entries: [{ text: 'Frame.', source_turn_ids: [] }] },
        {
          slot: 'CONSTRAINTS',
          entries: [
            { text: 'Keep Maria.', source_turn_ids: [T1.turn_id] },
            { text: 'Budget under $120k.', source_turn_ids: [T3.turn_id] },
          ],
        },
        { slot: 'RESOLVED', entries: [] },
        { slot: 'OPEN', entries: [] },
      ],
    };
    const section = buildConversationSummarySection(summary, 0, 5);
    expect(section.text).toContain(
      'CONSTRAINTS & PREFERENCES: Keep Maria. [t:aaaaaaaa] Budget under $120k. [t:cccccccc]',
    );
  });
});
