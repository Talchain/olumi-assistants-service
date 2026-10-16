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

import { beforeEach,describe,expect,it,vi } from 'vitest';


import { MonotonicRollingSummaryStoreFake } from '../../../../tests/utils/rolling-summary-store-fake.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';
import type { ConversationHistoryReader } from '../capture.js';
import {
maintainRollingSummaryForCommit,
resetRollingSummarySingleFlightForTests,
} from '../capture.js';
import type { RollingSummaryStorePort } from '../store-adapter.js';
import type { SummariserModel } from '../summariser.js';

const SCENARIO = 'aaaaaaaa-0000-4000-8000-000000000000';

/** The load-bearing early fact: stated in TURN 1, never repeated. */

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


beforeEach(() => {
  resetRollingSummarySingleFlightForTests();
});

// ---------------------------------------------------------------------------
// The cliff, and its removal
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Positive control — below the window the activation is inert
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Honesty at the marker when the summary earns no coverage claim
// ---------------------------------------------------------------------------



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
