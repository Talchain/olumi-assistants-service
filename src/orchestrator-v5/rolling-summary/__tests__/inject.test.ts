/**
 * Context Architecture v2 — S4-INJECT (ROADMAP 1.73): the assembly-time
 * injector. RED-first pins (design pack 01 §2/§4, 04 §3, 05 §S4 inject row;
 * activation condition rewritten by O-2, which DELETED CEE_ROLLING_SUMMARY):
 *
 *  - conversation fits the verbatim window (turns ≤ windowDepth) → NO
 *    section, NO store construction, NO lag — the injection half is
 *    byte-inert below the window (the O-2 activation gate).
 *  - beyond window + no stored summary → no block, no error (loader null).
 *  - beyond window + store error → no block, no error (never a turn failure).
 *  - beyond window + stored summary → the four-slot block renders EXACTLY
 *    (golden), with [t:xxxxxxxx] provenance stamps riding along [R3], and
 *    `summarisedTurns` counts the not-shown turns the block absorbs (the
 *    #536 window-marker extension); a floor / refusal stamps an honest 0.
 *  - staleness invariant (01 §4): lag ≥ windowDepth → stale:true + in-band
 *    disclosure note + v5.summary.lag emitted. Never silently stale.
 *  - lag is computed against the injector's window turns and surfaced for
 *    the v5.context_budget wiring (summary_lag_turns).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as telemetry from '../../../utils/telemetry.js';
import { TelemetryEvents } from '../../../utils/telemetry.js';

import { buildDeterministicFloor } from '../deterministic-floor.js';
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

/** A store whose methods explode — proves the below-window gate never touches it. */
function explodingStore(): RollingSummaryStorePort {
  return {
    upsertSummary: vi.fn(async () => {
      throw new Error('upsertSummary must not be called by the injector');
    }),
    loadSummary: vi.fn(async () => {
      throw new Error('loadSummary must not be called below the window');
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
  return emitSpy.mock.calls.filter((c: readonly unknown[]) => c[0] === TelemetryEvents.V5SummaryLag);
}

// ---------------------------------------------------------------------------
// Activation gate (O-2): below the window the loader is byte-inert
// (no section, no store touch) — every committed turn is already verbatim.
// ---------------------------------------------------------------------------

describe('loadConversationSummaryForInjection — below-window activation gate', () => {
  it('turns ≤ windowDepth → no section, null lag, store NEVER constructed/touched', async () => {
    const store = explodingStore();
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 5,
      summaryStore: store,
    });
    expect(outcome.section).toBeNull();
    expect(outcome.lagTurns).toBeNull();
    expect(outcome.summarisedTurns).toBeNull();
    expect(store.loadSummary).not.toHaveBeenCalled();
    expect(lagEmits()).toHaveLength(0);
  });

  it('empty window (fresh conversation) → identical: nothing to summarise, store untouched', async () => {
    const store = explodingStore();
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [],
      windowDepth: 5,
      summaryStore: store,
    });
    expect(outcome.section).toBeNull();
    expect(outcome.lagTurns).toBeNull();
    expect(store.loadSummary).not.toHaveBeenCalled();
  });

  it('beyond window + no stored summary → no block, no error, null lag', async () => {
    const store = storeReturning(null);
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 1,
      summaryStore: store,
    });
    expect(outcome.section).toBeNull();
    expect(outcome.lagTurns).toBeNull();
    expect(outcome.summarisedTurns).toBeNull();
    expect(store.loadSummary).toHaveBeenCalledTimes(1);
    expect(lagEmits()).toHaveLength(0);
  });

  it('beyond window + store error → no block, no error (never fails the turn)', async () => {
    const store: RollingSummaryStorePort = {
      loadSummary: vi.fn(async () => {
        throw new Error('RPC down');
      }),
      upsertSummary: vi.fn(),
    };
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 1,
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
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 1,
      summaryStore: store,
    });
    expect(outcome.lagTurns).toBe(0);
    // #536 marker extension: one window turn (T1) sits outside the verbatim
    // slice and is absorbed by the block.
    expect(outcome.summarisedTurns).toBe(1);
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
    // Watermark T1; window shows 3 newer turns PLUS the watermark turn itself
    // (coverage verified), windowDepth 3 ⇒ lag 3 ≥ 3 ⇒ stale — but every
    // missing turn IS verbatim-visible, so the block injects with disclosure.
    const newer1 = { turn_id: 'dddddddd-4444-4444-8444-444444444444', created_at: '2026-07-10T10:03:00.000Z' };
    const summary = summaryFixture();
    const staleSummary: RollingSummary = {
      ...summary,
      updated_turn_id: T1.turn_id,
      updated_turn_created_at: T1.created_at,
    };
    const store = storeReturning(staleSummary);
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      requestId: 'req-9',
      windowTurnsNewestFirst: [newer1, T3, T2, T1],
      windowDepth: 3,
      summaryStore: store,
    });
    expect(outcome.lagTurns).toBe(3);
    expect(outcome.summarisedTurns).toBe(1);
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
      // 1.73-pre (a): the block WAS injected — refused strictly means
      // "withheld". generator rides along so consumers can segment.
      refused: false,
      generator: 'incremental',
    });
  });

  it('below-threshold lag (lag < windowDepth) → fresh-enough: no note, no lag event', async () => {
    // Watermark T2: one newer turn (T3) — lag 1 < depth 2, verbatim-covered.
    const store = storeReturning(summaryFixture());
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T3, T2, T1],
      windowDepth: 2,
      summaryStore: store,
    });
    expect(outcome.lagTurns).toBe(1);
    expect(outcome.summarisedTurns).toBe(1);
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

  it('renders an honest partiality note when the summary was built from capped history', () => {
    const summary: RollingSummary = {
      ...summaryFixture(),
      history_capped: true,
    };
    const section = buildConversationSummarySection(summary, 0, 5);
    expect(section.text).toContain('most recent');
    expect(section.text).toContain('1000');
    expect(section.text.toLowerCase()).toContain('earlier turns');
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

// ---------------------------------------------------------------------------
// MEMORY-HOLE guard (Codex r2 blocker 1): the injector must never claim the
// unabsorbed turns are "shown verbatim" when they are not. The window the
// injector receives is the persisted-history hot read (newest-first, ≤ the
// session read window); the pack shows only the newest `windowDepth` of it
// verbatim. When the summary's watermark is not provably covered by the
// window, or the gap exceeds the verbatim count, injection is REFUSED: no
// four-slot block, a disclosed absence note instead (honesty doctrine — a
// disclosed absence beats a lying claim).
// ---------------------------------------------------------------------------

describe('loadConversationSummaryForInjection — memory-hole guard (true gap)', () => {
  /** n turns strictly newer than the fixture watermark T2, newest-first. */
  function newerTurns(n: number): { turn_id: string; created_at: string }[] {
    const out: { turn_id: string; created_at: string }[] = [];
    for (let i = n; i >= 1; i--) {
      out.push({
        turn_id: `eeeeee${String(i).padStart(2, '0')}-5555-4555-8555-555555555555`,
        created_at: new Date(Date.parse(T2.created_at) + i * 60_000).toISOString(),
      });
    }
    return out;
  }

  it('REFUSES a 20-behind summary: no four-slot text, no lag-5 verbatim claim', async () => {
    // Watermark T2; the 20-deep window holds 20 newer turns; watermark not
    // covered. Old behaviour: inject with lag 20 claiming "the latest 20 turns
    // are shown verbatim" while the pack shows only 5 — a lie about the 15
    // turns that are NOWHERE. New behaviour: refuse + absence note.
    const store = storeReturning(summaryFixture());
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      requestId: 'req-hole',
      windowTurnsNewestFirst: newerTurns(20),
      windowDepth: 5,
      summaryStore: store,
    });
    // A withheld block summarises NOTHING — the window marker must say 0.
    expect(outcome.summarisedTurns).toBe(0);
    const section = outcome.section;
    expect(section).not.toBeNull();
    // The four-slot block must NOT inject.
    expect(section!.text).not.toContain('DECISION FRAME');
    expect(section!.text).not.toContain('CONSTRAINTS');
    // The absence is disclosed, and the note never claims the missing turns
    // are shown verbatim.
    expect(section!.stale).toBe(true);
    expect(section!.note).toBeDefined();
    expect(section!.note!.toLowerCase()).toContain('withheld');
    expect(section!.note!.toLowerCase()).toContain('not shown');
    // The staleness signal fires, marked as a refusal. generator rides along
    // (1.73-pre a): refused:true + a non-floor generator = genuine memory-hole.
    const lag = lagEmits();
    expect(lag).toHaveLength(1);
    expect(lag[0]![1]).toMatchObject({
      scenario_id: 'scn-1',
      refused: true,
      generator: 'incremental',
    });
  });

  it('REFUSES when the gap exceeds verbatim coverage even though the watermark is visible', async () => {
    // Watermark T2 covered by the window (T2 present), but 7 newer turns exist
    // and only 5 are verbatim → 2 turns are neither summarised nor shown.
    const store = storeReturning(summaryFixture());
    const window = [...newerTurns(7), T2, T1];
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: window,
      windowDepth: 5,
      summaryStore: store,
    });
    expect(outcome.lagTurns).toBe(7);
    expect(outcome.summarisedTurns).toBe(0);
    const section = outcome.section;
    expect(section).not.toBeNull();
    expect(section!.text).not.toContain('DECISION FRAME');
    expect(section!.stale).toBe(true);
    expect(section!.note).toContain('7');
    expect(section!.note!.toLowerCase()).toContain('not shown');
    expect(lagEmits()).toHaveLength(1);
    expect(lagEmits()[0]![1]).toMatchObject({ refused: true, generator: 'incremental' });
  });

  it('REFUSES an uncovered watermark even on a shallow window (coverage unverifiable)', async () => {
    // One newer turn, watermark nowhere in the window: the true gap may
    // extend arbitrarily past the window — refuse, disclose the absence.
    const store = storeReturning(summaryFixture());
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: newerTurns(2),
      windowDepth: 1,
      summaryStore: store,
    });
    const section = outcome.section;
    expect(section).not.toBeNull();
    expect(section!.text).not.toContain('DECISION FRAME');
    expect(section!.stale).toBe(true);
    expect(section!.note!.toLowerCase()).toContain('withheld');
    expect(outcome.summarisedTurns).toBe(0);
  });

  it('still injects when the gap is fully verbatim-covered (no false refusal)', async () => {
    // Watermark T2, 3 newer turns, all within the 4-verbatim window, watermark
    // visible → lag 3 < depth 4 → normal injection, no note, no lag event.
    const store = storeReturning(summaryFixture());
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [...newerTurns(3), T2, T1],
      windowDepth: 4,
      summaryStore: store,
    });
    expect(outcome.lagTurns).toBe(3);
    expect(outcome.summarisedTurns).toBe(1);
    expect(outcome.section!.text).toContain('DECISION FRAME');
    expect(outcome.section!.stale).toBe(false);
    expect(outcome.section!.note).toBeUndefined();
    expect(lagEmits()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FLOOR honesty (M1 / Codex r2 blocker 1): a generator:'floor' summary is the
// deterministic seed written on the FIRST-ever maintenance pass when a
// parse-reject / model error hit with no prior to keep. It absorbed NO
// conversation history — only the brief/goal-derived FRAME. Its watermark is
// stamped at the newest turn (the DB monotonic guard needs a finite, ordered
// key), so the lag/coverage machinery computes lag≈0 + covered and — pre-fix —
// renders the empty CONSTRAINTS/RESOLVED/OPEN slots as bare "(none)", a
// coverage claim the floor never earned (the exact lying-coverage class fix 1
// removes). The injector must render the FRAME but mark the empty slots
// "(none captured yet)" and disclose the not-yet-summarised state — never a
// bare "(none)" coverage claim.
// ---------------------------------------------------------------------------

describe('loadConversationSummaryForInjection — floor honesty (M1)', () => {
  function floorFixture(): RollingSummary {
    return buildDeterministicFloor({
      briefText: 'Choosing an HQ city for the new office. Budget is tight.',
      goalLabel: 'Pick HQ',
      // Newest turn watermark — exactly what writeFloor stamps.
      watermark: { turn_id: T2.turn_id, created_at: T2.created_at },
      version: 1,
      latestUserMessage: null,
    });
  }

  it('injects the FRAME but NEVER a bare "(none)" coverage claim (first-ever maintenance, parse reject)', async () => {
    const store = storeReturning(floorFixture());
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      requestId: 'req-floor',
      // Watermark T2 covered, lag 0 — pre-fix this sailed past the memory-hole
      // guard and rendered bare "(none)".
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 1,
      summaryStore: store,
    });
    const section = outcome.section;
    expect(section).not.toBeNull();
    // A floor absorbed NO history — the window marker must say 0, not 1.
    expect(outcome.summarisedTurns).toBe(0);
    // FRAME (brief-derived) still rides along — it is legitimately known.
    expect(section!.text).toContain('DECISION FRAME');
    // The empty slots must be HONEST: "not captured yet", never a bare
    // "(none)" that reads as "the summariser processed the conversation and
    // found none".
    expect(section!.text).toContain('(none captured yet)');
    expect(section!.text).not.toContain('(none)');
    // The not-yet-summarised state is disclosed in-band.
    expect(section!.stale).toBe(true);
    expect(section!.note).toBeDefined();
    expect(section!.note!.toLowerCase()).toContain('not yet');
    // 1.73-pre (b): the note must not claim the FRAME is "drawn from the
    // brief" — buildDeterministicFloor's source ladder is brief → goal →
    // opening message → generic, and the stored floor does not record which
    // source won, so the disclosure has to name the ladder, not assert one rung.
    expect(section!.note!).not.toContain('drawn from the brief');
    // A persistent floor means a stuck summariser — it must be loud. But the
    // block IS injected, so refused stays FALSE (refused strictly means
    // "withheld" — 1.73-pre a); generator:'floor' is the disambiguator a
    // v5.summary.lag consumer keys on for the stuck-summariser alarm.
    const lag = lagEmits();
    expect(lag).toHaveLength(1);
    expect(lag[0]![1]).toMatchObject({
      scenario_id: 'scn-1',
      refused: false,
      generator: 'floor',
    });
  });

  it('floor note stays honest when the FRAME came from the goal, not the brief (1.73-pre b)', async () => {
    // No brief anywhere: the floor FRAME derives from the goal label. The
    // pre-fix note claimed the frame was "drawn from the brief" — a
    // provenance misstatement for this floor (and for the opening-message
    // and generic rungs below it).
    const floor = buildDeterministicFloor({
      briefText: null,
      goalLabel: 'Pick HQ',
      watermark: { turn_id: T2.turn_id, created_at: T2.created_at },
      version: 1,
      latestUserMessage: 'Help me choose a city for the office.',
    });
    const store = storeReturning(floor);
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 1,
      summaryStore: store,
    });
    const section = outcome.section;
    expect(section).not.toBeNull();
    expect(section!.text).toContain('Goal: Pick HQ');
    expect(section!.stale).toBe(true);
    expect(section!.note!).not.toContain('drawn from the brief');
    expect(section!.note!.toLowerCase()).toContain('not yet');
    expect(lagEmits()[0]![1]).toMatchObject({ refused: false, generator: 'floor' });
  });

  it('a real (non-floor) summary with the same empty shape still renders bare "(none)" (no over-reach)', async () => {
    // Guardrail: the honesty rewrite is scoped to floors. A genuine
    // incremental/regen summary that legitimately found no constraints keeps
    // the terse "(none)" — that IS an earned coverage statement.
    const realEmpty: RollingSummary = {
      ...summaryFixture(),
      slots: [
        { slot: 'FRAME', entries: [{ text: 'Choosing a supplier.', source_turn_ids: [] }] },
        { slot: 'CONSTRAINTS', entries: [] },
        { slot: 'RESOLVED', entries: [] },
        { slot: 'OPEN', entries: [] },
      ],
    };
    const store = storeReturning(realEmpty);
    const outcome = await loadConversationSummaryForInjection({
      scenarioId: 'scn-1',
      windowTurnsNewestFirst: [T2, T1],
      windowDepth: 1,
      summaryStore: store,
    });
    expect(outcome.section!.text).toContain('CONSTRAINTS & PREFERENCES: (none)');
    expect(outcome.section!.text).not.toContain('(none captured yet)');
    expect(outcome.section!.stale).toBe(false);
    expect(lagEmits()).toHaveLength(0);
  });
});
