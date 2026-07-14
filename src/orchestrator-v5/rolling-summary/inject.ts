/**
 * Context Architecture v2 — S4-INJECT (ROADMAP 1.73): the assembly-time
 * injector — the consumption half of the rolling summary. Design of record:
 * CONTEXT-ARCHITECTURE-V2-2026-07-13/ 01 §2 (injected where) + §4 (staleness
 * invariant), 04 §3 (precedence & honesty rules), 05 §S4 inject row, 07 R2.
 *
 * What this module does (and the maintain half — capture.ts — does not):
 *   READS `scenarios.rolling_summary` at ContextPack-assembly time and
 *   projects it into the `conversation_summary` pack section, ONLY when
 *   CEE_ROLLING_SUMMARY = 'inject' (the third rung of the two-stage flag —
 *   'off' and 'maintain' are byte-inert here by early return, pinned by
 *   __tests__/inject.test.ts).
 *
 * Safety properties:
 *  - NEVER a turn failure: store construction and the RPC read are inside a
 *    catch-all; every failure degrades to "no block" (loader returns null).
 *  - NEVER silently stale (01 §4): lag = committed turns after the summary's
 *    watermark, computed against the injector's window turns. When lag ≥ the
 *    verbatim window depth the invariant `window_depth ≥ lag + 1` is violated
 *    — the block still injects (degraded beats absent) but carries an IN-BAND
 *    staleness note, and `v5.summary.lag` (pre-registered with the maintain
 *    half) fires so an outage is loud.
 *  - NEVER a lying coverage claim (Codex r2 blocker 1): the staleness note's
 *    "the latest N turns are shown verbatim" is asserted ONLY when the
 *    watermark is provably covered by the window AND the gap fits inside the
 *    verbatim slice. Otherwise turns exist that are in NEITHER the summary
 *    NOR the prompt — the four-slot block is REFUSED and a disclosed-absence
 *    note injects instead (`v5.summary.lag` fires with refused:true).
 *  - READ-ONLY: the injector never writes (04 §3.4 — no layer writes to
 *    another; memory can be wrong, it cannot corrupt ground truth).
 *
 * Provenance [R3]: entries render with compact `[t:xxxxxxxx]` stamps derived
 * from the stored `source_turn_ids` (first 8 chars of the turn id — the same
 * ids the pack's `conversation.recent_turns[].turn_id` carries, so recent
 * stamps have an in-prompt referent). The pack's `[tN]` ordinal form is
 * summariser-input-relative and is NOT reconstructible at assembly time
 * (assemble.ts resolves ordinals to real ids at store time by design), so the
 * id-prefix form is the injected rendering; structural provenance for the
 * harness fidelity dim stays in the stored JSONB.
 *
 * NOTE (grep/telemetry hygiene, 01 §2 errata): `conversation_summary` also
 * exists as a V4 prompt-zones registry name (src/orchestrator/prompt-zones/*).
 * This V5 ContextPack section is unrelated — key on the V5 pack path.
 */

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';

import { HISTORY_CAP_DISCLOSURE } from './assemble.js';
import { getRollingSummaryStore } from './index.js';
import { computeSummaryLag, isSummaryStale, isWatermarkCovered } from './lag.js';
import type { LagTurn } from './lag.js';
import { ROLLING_SUMMARY_SLOT_LABELS, ROLLING_SUMMARY_SLOTS } from './summary-types.js';
import type { RollingSummary } from './summary-types.js';
import type { RollingSummaryStorePort } from './store-adapter.js';

// ---------------------------------------------------------------------------
// The ContextPack section shape (mirrored by ContextPackConversationSummary-
// Schema in ../context/context-pack-schema.ts — strict there).
// ---------------------------------------------------------------------------

export interface ContextPackConversationSummary {
  /** The four-slot block (FRAME / CONSTRAINTS / RESOLVED / OPEN) with
   *  `[t:xxxxxxxx]` provenance stamps riding along. Doctrine P text (04
   *  §3.3): the summariser is forbidden raw floats, so this block is too.
   *  EMPTY on a memory-hole refusal (Codex r2 blocker 1) — the withheld
   *  block is replaced by the disclosed-absence `note`. */
  readonly text: string;
  /** The watermark turn — the newest committed turn the summary absorbed. */
  readonly current_to_turn_id: string;
  /** Committed turns after the watermark (01 §4). */
  readonly lag_turns: number;
  /** True ⇔ the staleness invariant is violated (lag ≥ window depth) — AND
   *  forced true for a generator:'floor' summary regardless of lag
   *  (1.73-pre b): a floor absorbed NO conversation history, so lag-derived
   *  freshness is vacuous for it and the section always discloses itself as
   *  degraded. */
  readonly stale: boolean;
  /** In-band staleness disclosure — present IFF stale (never silently stale). */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Pure rendering
// ---------------------------------------------------------------------------

function stampFor(sourceTurnIds: readonly string[]): string {
  if (sourceTurnIds.length === 0) return '';
  return ` [${sourceTurnIds.map((id) => `t:${id.slice(0, 8)}`).join(', ')}]`;
}

/**
 * Render the injected block from the STRUCTURED slots (not the stored
 * `text`) so the R3 provenance stamps ride along. Mirrors assemble.ts's
 * rendering rules exactly: FRAME renders empty when absent; other empty
 * slots render `(none)` so the block shape is stable and complete
 * (stable block = cache-friendly, 01 §2).
 */
export function buildConversationSummarySection(
  summary: RollingSummary,
  lagTurns: number,
  windowDepth: number,
): ContextPackConversationSummary {
  const bySlot = new Map(summary.slots.map((b) => [b.slot, b] as const));
  // FLOOR honesty (M1): a generator:'floor' summary absorbed NO conversation
  // history — it is the brief/goal seed. Its empty non-FRAME slots must read
  // "(none captured yet)" (nothing processed) rather than the bare "(none)" a
  // real summary uses to mean "the summariser looked and found none". The bare
  // form on a floor is a coverage claim it never earned.
  const emptyMarker = summary.generator === 'floor' ? '(none captured yet)' : '(none)';
  const lines: string[] = [];
  for (const slot of ROLLING_SUMMARY_SLOTS) {
    const entries = bySlot.get(slot)?.entries ?? [];
    const rendered =
      entries.length > 0
        ? entries.map((e) => `${e.text}${stampFor(e.source_turn_ids)}`).join(' ')
        : slot === 'FRAME'
          ? ''
          : emptyMarker;
    lines.push(`${ROLLING_SUMMARY_SLOT_LABELS[slot]}: ${rendered}`);
  }
  // Honest-partiality disclosure (Codex r2 fix 4a): the injected block
  // renders from slots, so the stored-text cap note must be re-rendered
  // here or it would silently drop out of the prompt.
  if (summary.history_capped === true) lines.push(HISTORY_CAP_DISCLOSURE);
  const stale = isSummaryStale(lagTurns, windowDepth);
  return {
    text: lines.join('\n'),
    current_to_turn_id: summary.updated_turn_id,
    lag_turns: lagTurns,
    stale,
    // 01 §4 disclosure, adapted: the watermark's conversation ordinal is not
    // reconstructible at assembly, so the note names the lag + points at the
    // verbatim `conversation` section instead of "turn N".
    ...(stale
      ? {
          note: `(summary current to an earlier turn; the latest ${lagTurns} turns are shown verbatim in the conversation section)`,
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// The flag-gated loader (turn-executor's one call site)
// ---------------------------------------------------------------------------

export interface SummaryInjectionArgs {
  /** config.features.rollingSummary — the two-stage flag. */
  readonly flag: 'off' | 'maintain' | 'inject';
  readonly scenarioId: string;
  /** The assembler's prior turns, newest-first (readRecent order). */
  readonly windowTurnsNewestFirst: readonly LagTurn[];
  /** The verbatim window depth the pack projects
   *  (CONTEXT_PACK_RECENT_TURNS_CAP — 5 today, 8 after the S5 flip). */
  readonly windowDepth: number;
  readonly requestId?: string | null;
  /** Test seam — production defaults to the singleton store. */
  readonly summaryStore?: RollingSummaryStorePort;
}

export interface SummaryInjectionOutcome {
  /** The pack section, or null (flag below inject / no stored summary /
   *  store error). Null ⇒ no block, no error — the prompt is byte-identical
   *  to pre-S4. */
  readonly section: ContextPackConversationSummary | null;
  /** For `v5.context_budget.summary_lag_turns`: the computed lag when a
   *  summary was injected; null when no summary layer entered this prompt. */
  readonly lagTurns: number | null;
}

const NO_INJECTION: SummaryInjectionOutcome = Object.freeze({
  section: null,
  lagTurns: null,
});

/**
 * Load + project the stored rolling summary for injection. Non-throwing by
 * contract: any failure returns NO_INJECTION (the turn must never fail or
 * slow beyond the one RPC read this performs at 'inject').
 *
 * Flag ladder: 'off' and 'maintain' return immediately — no store
 * construction, no env reads, no RPC — so both stages stay byte-identical
 * at the prompt seam (the task's two-stage guarantee).
 */
export async function loadConversationSummaryForInjection(
  args: SummaryInjectionArgs,
): Promise<SummaryInjectionOutcome> {
  if (args.flag !== 'inject') return NO_INJECTION;
  try {
    const store = args.summaryStore ?? getRollingSummaryStore();
    const summary = await store.loadSummary(args.scenarioId);
    if (summary === null) return NO_INJECTION;

    const lag = computeSummaryLag(summary, args.windowTurnsNewestFirst);

    // ------------------------------------------------------------------
    // FLOOR guard (M1 / Codex r2 blocker 1). A generator:'floor' summary is
    // the deterministic seed written when the FIRST-ever maintenance pass hit
    // a parse-reject or model error with no prior to keep. It absorbed NO
    // conversation history — only the brief/goal-derived FRAME. Its watermark
    // is stamped at the newest turn (the DB monotonic guard needs a finite,
    // ordered key; a null watermark would violate RS001 + the composite CAS),
    // so the memory-hole guard below would see lag≈0 + covered and render the
    // empty slots as bare "(none)" — a coverage claim the floor never earned
    // (the exact lying-coverage class fix 1 removes). Render the FRAME
    // (legitimately seed-derived; buildConversationSummarySection marks the
    // empty slots "(none captured yet)" for a floor) but DISCLOSE that the
    // conversation is not yet summarised, and emit v5.summary.lag with
    // refused:false (the block IS injected — refused strictly means
    // "withheld", 1.73-pre a) + generator:'floor', the disambiguator a
    // consumer keys on so a stuck summariser (a floor that persists) stays
    // loud without conflating it with a genuine memory-hole refusal.
    //
    // The note names the floor's whole source ladder (brief → goal →
    // opening message → generic; see buildDeterministicFloor) rather than
    // asserting "drawn from the brief" — the stored floor does not record
    // which rung won, and most floors on brief-less scenarios are NOT
    // brief-derived (1.73-pre b).
    // ------------------------------------------------------------------
    if (summary.generator === 'floor') {
      emitSummaryLag(args, summary, lag, false);
      const base = buildConversationSummarySection(summary, lag, args.windowDepth);
      return {
        section: {
          ...base,
          stale: true,
          note: '(conversation summary not yet generated: the decision frame above is a deterministic seed from whichever was available of the decision brief, the goal, or the opening user message; nothing else has been captured yet — recent turns are shown verbatim in the conversation section and any earlier turns are NOT yet summarised)',
        },
        lagTurns: lag,
      };
    }

    // ------------------------------------------------------------------
    // MEMORY-HOLE guard (Codex r2 blocker 1). The window turns are the
    // persisted-history hot read (newest-first, ≤ the session read window,
    // typically 20); the pack shows only the newest `windowDepth` of them
    // verbatim. The stale-disclosure claim "the latest N turns are shown
    // verbatim" is TRUE only when (a) the watermark is provably covered by
    // the window (watermark turn or an older turn visible — otherwise the
    // true gap may extend arbitrarily past the window) AND (b) the gap fits
    // inside the verbatim slice. Otherwise turns exist that are in NEITHER
    // the summary NOR the prompt: REFUSE the four-slot block and inject a
    // disclosed-absence note instead (honesty doctrine — a disclosed
    // absence beats a lying coverage claim).
    // ------------------------------------------------------------------
    const covered = isWatermarkCovered(summary, args.windowTurnsNewestFirst);
    const verbatimCount = Math.min(args.windowDepth, args.windowTurnsNewestFirst.length);
    if (!covered || lag > verbatimCount) {
      emitSummaryLag(args, summary, lag, true);
      const gapLowerBound = Math.max(lag, args.windowTurnsNewestFirst.length);
      const gapPhrase = covered
        ? `${lag} turns out of date`
        : gapLowerBound > 0
          ? `at least ${gapLowerBound} turns out of date (coverage unverifiable)`
          : 'out of date by an unverifiable number of turns';
      return {
        section: {
          text: '',
          current_to_turn_id: summary.updated_turn_id,
          lag_turns: lag,
          stale: true,
          note: `(conversation summary withheld: it is ${gapPhrase} and only the latest ${verbatimCount} turns are shown verbatim in the conversation section — turns in between are NOT shown; do not assume knowledge of earlier turns)`,
        },
        lagTurns: lag,
      };
    }

    const section = buildConversationSummarySection(summary, lag, args.windowDepth);
    if (section.stale) {
      emitSummaryLag(args, summary, lag, false);
    }
    return { section, lagTurns: lag };
  } catch (err) {
    log.debug(
      {
        scenario_id: args.scenarioId,
        request_id: args.requestId ?? null,
        err: err instanceof Error ? err.message : String(err),
      },
      'RollingSummary — injection read failed (no block injected; turn unaffected)',
    );
    return NO_INJECTION;
  }
}

/** Content-free staleness signal (frozen-registry member v5.summary.lag,
 *  pre-registered with the maintain half). `refused` strictly means the
 *  four-slot block was WITHHELD (memory-hole refusal); a floor placeholder
 *  IS injected so it emits refused:false (1.73-pre a). `generator` carries
 *  the stored summary's generator so consumers can segment without
 *  overloading `refused`: a persistent generator:'floor' stream = stuck
 *  summariser; refused:true = genuine memory hole. Never throws. */
function emitSummaryLag(
  args: SummaryInjectionArgs,
  summary: RollingSummary,
  lag: number,
  refused: boolean,
): void {
  try {
    emit(TelemetryEvents.V5SummaryLag, {
      scenario_id: args.scenarioId,
      request_id: args.requestId ?? null,
      lag_turns: lag,
      window_depth: args.windowDepth,
      watermark_turn_id: summary.updated_turn_id,
      summary_version: summary.version,
      refused,
      generator: summary.generator,
    });
  } catch (emitErr) {
    log.debug(
      {
        scenario_id: args.scenarioId,
        err: emitErr instanceof Error ? emitErr.message : String(emitErr),
      },
      'RollingSummary — v5.summary.lag emit failed (swallowed)',
    );
  }
}
