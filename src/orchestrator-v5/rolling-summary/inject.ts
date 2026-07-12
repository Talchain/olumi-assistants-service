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

import { getRollingSummaryStore } from './index.js';
import { computeSummaryLag, isSummaryStale } from './lag.js';
import type { LagTurn } from './lag.js';
import { ROLLING_SUMMARY_SLOTS } from './summary-types.js';
import type { RollingSummary, RollingSummarySlot } from './summary-types.js';
import type { RollingSummaryStorePort } from './store-adapter.js';

// ---------------------------------------------------------------------------
// The ContextPack section shape (mirrored by ContextPackConversationSummary-
// Schema in ../context/context-pack-schema.ts — strict there).
// ---------------------------------------------------------------------------

export interface ContextPackConversationSummary {
  /** The four-slot block (FRAME / CONSTRAINTS / RESOLVED / OPEN) with
   *  `[t:xxxxxxxx]` provenance stamps riding along. Doctrine P text (04
   *  §3.3): the summariser is forbidden raw floats, so this block is too. */
  readonly text: string;
  /** The watermark turn — the newest committed turn the summary absorbed. */
  readonly current_to_turn_id: string;
  /** Committed turns after the watermark (01 §4). */
  readonly lag_turns: number;
  /** True ⇔ the staleness invariant is violated (lag ≥ window depth). */
  readonly stale: boolean;
  /** In-band staleness disclosure — present IFF stale (never silently stale). */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Pure rendering
// ---------------------------------------------------------------------------

/** Same labels assemble.ts renders into the stored text — one vocabulary. */
const SLOT_LABEL: Record<RollingSummarySlot, string> = {
  FRAME: 'DECISION FRAME',
  CONSTRAINTS: 'CONSTRAINTS & PREFERENCES',
  RESOLVED: 'RESOLVED',
  OPEN: 'OPEN',
};

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
  const lines: string[] = [];
  for (const slot of ROLLING_SUMMARY_SLOTS) {
    const entries = bySlot.get(slot)?.entries ?? [];
    const rendered =
      entries.length > 0
        ? entries.map((e) => `${e.text}${stampFor(e.source_turn_ids)}`).join(' ')
        : slot === 'FRAME'
          ? ''
          : '(none)';
    lines.push(`${SLOT_LABEL[slot]}: ${rendered}`);
  }
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
    const section = buildConversationSummarySection(summary, lag, args.windowDepth);
    if (section.stale) {
      emitSummaryLag(args, summary, lag);
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
 *  pre-registered with the maintain half). Never throws. */
function emitSummaryLag(
  args: SummaryInjectionArgs,
  summary: RollingSummary,
  lag: number,
): void {
  try {
    emit(TelemetryEvents.V5SummaryLag, {
      scenario_id: args.scenarioId,
      request_id: args.requestId ?? null,
      lag_turns: lag,
      window_depth: args.windowDepth,
      watermark_turn_id: summary.updated_turn_id,
      summary_version: summary.version,
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
