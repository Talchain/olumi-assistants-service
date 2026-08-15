/**
 * O-2 — S4 rolling-summary ACTIVATION acceptance: kills the 5-turn
 * conversation cliff (ROADMAP 1.73; DROPPED-COMMITMENTS row 5).
 *
 * RED-first evidence (recorded in the PR): before the activation wiring, an
 * 8-turn conversation loses turns 1–3 ENTIRELY — a load-bearing early fact
 * ("Manchester") appears nowhere in the assembled routing prompt. After
 * wiring, the rolling summary carries it, with the `conversation.window`
 * marker (#536) extended to disclose summarised-vs-included honestly.
 *
 * The chain under test is the PRODUCTION composition, seam for seam:
 *   8-turn history → maintainer (full-history read → summariser input) →
 *   monotonic store → injection loader → ContextPack assembly →
 *   buildUserMessage (the exact routing prompt bytes).
 *
 * ANTI-THEATRE NOTES (traps 4/11/13):
 *  - The fake summariser DERIVES its slots from the INPUT the maintainer
 *    actually feeds it — it never hardcodes the probe fact. If the wiring
 *    fails to feed turn 1 to the model, the summary CANNOT contain
 *    "Manchester" and the assertion goes RED (the chain is real).
 *  - The absence assertion ("the verbatim window does not carry the fact")
 *    has a positive control in the same test: the SAME probe string IS
 *    found in the summary section, so the probe channel provably
 *    discriminates.
 *  - Quality check, not just presence: the assertion is on the named value
 *    inside the summary text, never on "a summary string exists".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import {
  assembleContextPackWithSummary,
  CONTEXT_PACK_RECENT_TURNS_CAP,
} from '../../context/context-pack-assembler.js';
import type { AssembleContextPackInput } from '../../context/context-pack-assembler.js';
import { buildUserMessage, SUMMARY_PRECEDENCE_INSTRUCTION } from '../../routing/route-with-tool-use.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';
import {
  maintainRollingSummaryForCommit,
  resetRollingSummarySingleFlightForTests,
} from '../capture.js';
import type { ConversationHistoryReader } from '../capture.js';
import { buildConversationSummarySection, loadConversationSummaryForInjection } from '../inject.js';
import type { RollingSummaryStorePort } from '../store-adapter.js';
import type { SummariserModel } from '../summariser.js';
import { MonotonicRollingSummaryStoreFake } from '../../../../tests/utils/rolling-summary-store-fake.js';

const SCENARIO = 'aaaaaaaa-0000-4000-8000-000000000000';

/** The load-bearing early fact: stated in TURN 1, never repeated. */
const EARLY_FACT = 'Manchester';
const EARLY_FACT_SENTENCE = 'The venue must be in Manchester, that is non-negotiable.';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function turn(n: number, userMessage: string): SessionTurnWithContent {
  return {
    id: `row-${n}`,
    scenario_id: SCENARIO,
    user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    turn_id: `tttttttt-0000-4000-8000-${String(n).padStart(12, '0')}`,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:turn-${n}`,
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 100,
    created_at: new Date(Date.UTC(2026, 6, 19, 10, n, 0)).toISOString(),
    user_message: userMessage,
    assistant_message: `Noted (turn ${n}).`,
  };
}

/** turns 1..n, turn 1 carrying the early fact; NEWEST-FIRST (readRecent order). */
function historyNewestFirst(n: number): SessionTurnWithContent[] {
  const turns: SessionTurnWithContent[] = [];
  for (let i = 1; i <= n; i++) {
    turns.push(
      turn(i, i === 1 ? EARLY_FACT_SENTENCE : `Some later point number ${i} about budget shape.`),
    );
  }
  return turns.reverse();
}

/**
 * R-2: the store is the SHARED monotonic fake
 * (tests/utils/rolling-summary-store-fake.ts). This suite used to carry its
 * own `InMemoryStore` twin whose comment claimed "monotonic" while its upsert
 * applied UNCONDITIONALLY — a regressing write the unit tests forbid would
 * have been silently accepted here and read as green. One definition, all
 * consumers; the guard's bite in THIS suite is pinned by the positive control
 * at the bottom of the file.
 */

/**
 * A summariser that DERIVES its four slots from the input it is given —
 * the constraint slot echoes the "must be" sentence (and its [tN] ordinal)
 * ONLY if the maintainer actually fed it the turn that contains it.
 *
 * NAMED DEPENDENCY (2026-07-25): this fake reads the summariser input's
 * RENDERING, so it is coupled to build-input.ts's `renderUnit`. That coupling
 * was invisible until speaker-scoped citation units changed the layout from
 *     [t1]\nUSER: …\nASSISTANT: …      (one ordinal, two speakers)
 * to  [t1] USER: …\n[t2] ASSISTANT: …  (one ordinal per speaker)
 * and this fixture silently stopped matching — "(none)" instead of the
 * constraint, so the acceptance assertion went RED. The separator is now
 * `\s*` so both layouts match, and this note exists so the next renderer
 * change is a visible decision rather than a surprise RED.
 */
function derivingModel(): SummariserModel {
  return {
    summarise: vi.fn(async (userMessage: string) => {
      const m = /\[(t\d+)\]\s*USER: ([^\n]*must be[^\n]*)/.exec(userMessage);
      const constraints = m
        ? `CONSTRAINTS & PREFERENCES: ${m[2]} [${m[1]}]`
        : 'CONSTRAINTS & PREFERENCES: (none)';
      return {
        text: [
          'DECISION FRAME: Choosing a venue for the product launch.',
          constraints,
          'RESOLVED: (none)',
          'OPEN: (none)',
        ].join('\n'),
      };
    }),
  };
}

/**
 * Incremental supersession control: choose the LAST user constraint in the
 * actual summariser input. On an update pass that input contains the prior
 * summary first and the newly committed turn last, so this fake models the
 * contract's "only change what the new turns actually changed" rule without
 * hard-coding either location. If the new turn is not threaded, the old value
 * wins and the supersession assertion below goes red.
 */
function latestConstraintModel(): SummariserModel {
  return {
    summarise: vi.fn(async (userMessage: string) => {
      const matches = [
        ...userMessage.matchAll(/\[(t\d+)\]\s*USER: ([^\n]*must be[^\n]*)/g),
      ];
      const latest = matches.at(-1);
      return {
        text: [
          'DECISION FRAME: Choosing a venue for the product launch.',
          latest
            ? `CONSTRAINTS & PREFERENCES: ${latest[2]} [${latest[1]}]`
            : 'CONSTRAINTS & PREFERENCES: (none)',
          'RESOLVED: (none)',
          'OPEN: (none)',
        ].join('\n'),
      };
    }),
  };
}

function reader(turnsNewestFirst: readonly SessionTurnWithContent[]): ConversationHistoryReader {
  return { readRecent: async () => turnsNewestFirst };
}

/** Run the maintainer exactly as commit.ts fires it (fire-and-forget seam). */
async function maintain(
  turnsNewestFirst: readonly SessionTurnWithContent[],
  store: RollingSummaryStorePort,
  model: SummariserModel,
): Promise<void> {
  const newest = turnsNewestFirst[0]!;
  await maintainRollingSummaryForCommit({
    scenarioId: SCENARIO,
    turnId: newest.turn_id,
    persistedRowId: newest.id,
    historyReader: reader(turnsNewestFirst),
    summaryStore: store,
    model,
  });
}

/** Assemble the pack + the exact routing prompt, as the turn-executor does. */
async function assembleLive(
  turnsNewestFirst: readonly SessionTurnWithContent[],
  store: RollingSummaryStorePort,
  message: string,
): Promise<{ pack: ReturnType<typeof assembleContextPackWithSummary>['contextPack']; prompt: string }> {
  const outcome = await loadConversationSummaryForInjection({
    scenarioId: SCENARIO,
    windowTurnsNewestFirst: turnsNewestFirst,
    windowDepth: CONTEXT_PACK_RECENT_TURNS_CAP,
    summaryStore: store,
  });
  const input: AssembleContextPackInput = {
    payload: makeMessagePayload({ message, scenario_id: SCENARIO }),
    priorTurns: turnsNewestFirst,
    priorFacts: [],
    conversationSummary: outcome.section ?? undefined,
    summarisedTurns: outcome.summarisedTurns,
  };
  const { contextPack } = assembleContextPackWithSummary(input);
  return { pack: contextPack, prompt: buildUserMessage(contextPack, message) };
}

beforeEach(() => {
  resetRollingSummarySingleFlightForTests();
});

// ---------------------------------------------------------------------------
// The cliff, and its removal
// ---------------------------------------------------------------------------

describe('S4 activation — the 5-turn cliff is closed by the rolling summary', () => {
  it('beyond-window conversation: turn-1 fact falls off the verbatim window but arrives via the summary, disclosed', async () => {
    const store = new MonotonicRollingSummaryStoreFake();
    // cap+3 turns → exactly 3 fall off the window whatever the cap (derive-don't-mirror).
    const history = historyNewestFirst(CONTEXT_PACK_RECENT_TURNS_CAP + 3);

    // Maintain half — the REAL input-builder feeds the full history to the
    // summariser (regen: no prior). The deriving model can only echo the
    // fact if the maintainer actually showed it turn 1.
    await maintain(history, store, derivingModel());
    expect(store.stored).not.toBeNull();

    const { pack, prompt } = await assembleLive(history, store, 'So where should we hold it?');

    // THE CLIFF (pre-activation this was the WHOLE story): the verbatim
    // window does NOT carry the turn-1 fact...
    expect(JSON.stringify(pack.conversation)).not.toContain(EARLY_FACT);

    // ...but the summary section now does (QUALITY: the named value itself,
    // not merely "a summary exists"). This line is the RED-first pivot:
    // before the wiring the prompt contained no trace of the fact at all.
    expect(pack.conversation_summary).toBeDefined();
    expect(pack.conversation_summary!.text).toContain(EARLY_FACT);
    expect(prompt).toContain(EARLY_FACT);

    // Fresh summary (watermark = newest turn): not stale, no note.
    expect(pack.conversation_summary!.stale).toBe(false);

    // DISCLOSURE (#536 extension): the "N of M turns included" marker now
    // says how many of the not-shown turns arrive as the summary.
    expect(pack.conversation.window?.shown).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(pack.conversation.window?.available).toBe(CONTEXT_PACK_RECENT_TURNS_CAP + 3);
    expect(pack.conversation.window?.summarised).toBe(3);

    // The code-owned facts-beat-summary precedence instruction rides along.
    expect(prompt).toContain(SUMMARY_PRECEDENCE_INSTRUCTION);

    // CONTEXT-FAMILY ABLATION: remove ONLY the durable summary family while
    // keeping the same scenario, history window and user turn. The turn-1
    // truth disappears from the exact routing prompt. This proves the memory
    // layer contributes material context rather than decorative bytes.
    const { contextPack: summaryAblated } = assembleContextPackWithSummary({
      payload: makeMessagePayload({ message: 'So where should we hold it?', scenario_id: SCENARIO }),
      priorTurns: history,
      priorFacts: [],
    });
    const ablatedPrompt = buildUserMessage(summaryAblated, 'So where should we hold it?');
    expect(ablatedPrompt).not.toContain(EARLY_FACT);
    expect(ablatedPrompt).not.toBe(prompt);
  });

  it('a later explicit replacement supersedes the turn-1 constraint in durable memory and after reload', async () => {
    const store = new MonotonicRollingSummaryStoreFake();
    const initial = historyNewestFirst(CONTEXT_PACK_RECENT_TURNS_CAP + 3);
    await maintain(initial, store, derivingModel());
    expect(store.stored!.text).toContain(EARLY_FACT);

    // One later turn explicitly replaces the location constraint. This is an
    // incremental pass: the summariser sees the prior summary plus only the
    // new turn. A retention guard that blindly resurrected the old non-empty
    // slot would leave Manchester in the durable prompt.
    const replacementTurnNumber = CONTEXT_PACK_RECENT_TURNS_CAP + 4;
    const updated = [
      turn(
        replacementTurnNumber,
        'The venue must be in Leeds; replace the earlier location constraint.',
      ),
      ...initial,
    ];
    await maintain(updated, store, latestConstraintModel());

    const reloaded = await store.loadSummary(SCENARIO);
    expect(reloaded!.text).toContain('Leeds');
    expect(reloaded!.text).not.toContain(EARLY_FACT);

    const { prompt } = await assembleLive(updated, store, 'Where is the venue now?');
    expect(prompt).toContain('Leeds');
    expect(prompt).not.toContain(EARLY_FACT);
  });

  it('the summary is byte-bounded and passes the budget seam untouched (precedence: never trimmed)', async () => {
    const store = new MonotonicRollingSummaryStoreFake();
    const history = historyNewestFirst(CONTEXT_PACK_RECENT_TURNS_CAP + 3);
    await maintain(history, store, derivingModel());

    const { pack } = await assembleLive(history, store, 'And the catering?');
    // The budget module budgets graph/analysis only; the summary section is
    // bounded at WRITE time (SUMMARY_HARD_CAP_CHARS) and must arrive in the
    // pack EXACTLY as the injector renders it from the stored slots (with
    // [t:xxxxxxxx] provenance stamps) — untrimmed by the budget seam.
    const independentRender = buildConversationSummarySection(
      store.stored!,
      0,
      CONTEXT_PACK_RECENT_TURNS_CAP,
    );
    expect(pack.conversation_summary!.text).toBe(independentRender.text);
    expect(pack.conversation_summary!.text.length).toBeGreaterThan(0);
    expect('context_budget' in pack).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Positive control — below the window the activation is inert
// ---------------------------------------------------------------------------

describe('S4 activation — positive control (≤ window: byte-identical, no store read)', () => {
  it('4-turn conversation: no section, no summarised marker, no store read, prompt carries the fact verbatim', async () => {
    const store = new MonotonicRollingSummaryStoreFake();
    const history = historyNewestFirst(4);
    await maintain(history, store, derivingModel());
    expect(store.stored).not.toBeNull(); // the maintain half DOES run below the window
    store.loadCalls = 0;

    const { pack, prompt } = await assembleLive(history, store, 'What next?');

    // Below the window every turn is verbatim — nothing to inject, and the
    // loader must not even read the store.
    expect(store.loadCalls).toBe(0);
    expect('conversation_summary' in pack).toBe(false);
    expect(pack.conversation.window).toEqual({ shown: 4, available: 4 });
    expect(prompt).not.toContain(SUMMARY_PRECEDENCE_INSTRUCTION);

    // The fact is fully present VERBATIM (turn 1 is inside the window) —
    // this is also the positive control proving the probe string is visible
    // to the assertions when it genuinely reaches the prompt.
    expect(JSON.stringify(pack.conversation)).toContain(EARLY_FACT);
    expect(prompt).toContain(EARLY_FACT);
  });

  it('EXACTLY at the window (5 prior turns): gate holds — no store read, no section, no summarised key', async () => {
    // Boundary pin (review gap on #551): the activation gate is `<=`, not
    // `<`. A summary EXISTS in the store with its watermark at the newest
    // turn, so a `<`-mutated gate would read the store and inject a fresh
    // section end-to-end — the loadCalls / key-absence assertions below all
    // die under that exact mutation. NOTE the marker contract: at
    // exactly-window there is NO block in the prompt, so the window marker
    // carries NO `summarised` key at all — `summarised: 0` is reserved for
    // a PRESENT block that earned no coverage (floor / withheld); stamping
    // 0 here would falsely imply a block was injected.
    const store = new MonotonicRollingSummaryStoreFake();
    const history = historyNewestFirst(CONTEXT_PACK_RECENT_TURNS_CAP);
    await maintain(history, store, derivingModel());
    expect(store.stored).not.toBeNull();
    store.loadCalls = 0;

    const { pack, prompt } = await assembleLive(history, store, 'What next?');

    expect(store.loadCalls).toBe(0);
    expect('conversation_summary' in pack).toBe(false);
    expect(pack.conversation.window).toEqual({
      shown: CONTEXT_PACK_RECENT_TURNS_CAP,
      available: CONTEXT_PACK_RECENT_TURNS_CAP,
    });
    expect(JSON.stringify(pack.conversation.window)).not.toContain('summarised');
    expect(prompt).not.toContain(SUMMARY_PRECEDENCE_INSTRUCTION);
    // All five turns verbatim — the turn-1 fact is present without any block.
    expect(JSON.stringify(pack.conversation)).toContain(EARLY_FACT);
  });

  it('byte-identity: a ≤window assembly equals an assembly with no summary machinery threaded at all', async () => {
    const store = new MonotonicRollingSummaryStoreFake();
    const history = historyNewestFirst(4);
    await maintain(history, store, derivingModel());

    const { pack } = await assembleLive(history, store, 'What next?');
    const { contextPack: bare } = assembleContextPackWithSummary({
      payload: makeMessagePayload({ message: 'What next?', scenario_id: SCENARIO }),
      priorTurns: history,
      priorFacts: [],
    });
    expect(JSON.stringify(pack)).toBe(JSON.stringify(bare));
  });
});

// ---------------------------------------------------------------------------
// Honesty at the marker when the summary earns no coverage claim
// ---------------------------------------------------------------------------

describe('S4 activation — summarised marker never overclaims', () => {
  it('floor summary (model failed at bootstrap): section discloses itself, summarised is 0', async () => {
    const store = new MonotonicRollingSummaryStoreFake();
    const history = historyNewestFirst(CONTEXT_PACK_RECENT_TURNS_CAP + 3);
    const failing: SummariserModel = {
      summarise: vi.fn(async () => {
        throw new Error('model down');
      }),
    };
    await maintain(history, store, failing);
    expect(store.stored!.generator).toBe('floor');

    const { pack } = await assembleLive(history, store, 'Where were we?');
    expect(pack.conversation_summary).toBeDefined();
    expect(pack.conversation_summary!.stale).toBe(true);
    expect(pack.conversation_summary!.note).toContain('NOT yet summarised');
    // A floor absorbed NO conversation history — claiming summarised:3
    // would be the exact lying-coverage class this lane must not ship.
    expect(pack.conversation.window?.shown).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(pack.conversation.window?.available).toBe(CONTEXT_PACK_RECENT_TURNS_CAP + 3);
    expect(pack.conversation.window?.summarised).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R-2 positive control — the shared fake's guard BITES in this suite
// ---------------------------------------------------------------------------

describe('R-2 — the monotonic guard is live in this suite (not a comment)', () => {
  it('a regressing maintain (older watermark) is REFUSED; the newer summary stands', async () => {
    const store = new MonotonicRollingSummaryStoreFake();
    const model = derivingModel();

    // Advance the watermark to turn 8…
    await maintain(historyNewestFirst(8), store, model);
    expect(store.stored).not.toBeNull();
    const newerWatermark = store.stored!.updated_turn_created_at;

    // …then replay a maintain whose newest turn is OLDER (turn 6). The old
    // local `InMemoryStore` twin applied this unconditionally — the exact
    // regressing write the unit tests forbid. The shared fake refuses it.
    resetRollingSummarySingleFlightForTests();
    await maintain(historyNewestFirst(6), store, model);
    expect(store.stored!.updated_turn_created_at).toBe(newerWatermark);

    // Direct non-vacuity check on the same store instance: the refusal is
    // reported, not silent.
    const regressed = await store.upsertSummary(SCENARIO, {
      ...store.stored!,
      updated_turn_created_at: new Date(Date.UTC(2026, 6, 19, 10, 1, 0)).toISOString(),
      updated_turn_id: 'tttttttt-0000-4000-8000-000000000001',
    });
    expect(regressed.applied).toBe(false);
    expect(regressed.regressed).toBe(true);
  });
});
