/**
 * Context Architecture v2 — S4 rolling summary: PURE summariser input builder
 * (the anti-compounding / regeneration-horizon logic, 01 §2 / 07 R1).
 *
 * Two modes:
 *  - INCREMENTAL (most turns): prior summary + the turns after its watermark.
 *    Cheap, bounded drift because a REGEN caps it every N turns.
 *  - REGEN (every N=10 turns, first-ever, or a schema-version change):
 *    rebuild from the FULL persisted turn history — NOT a summary-of-summary,
 *    NOT the 20-turn read window. This is what stops turn-1 constraints from
 *    silently exiting the summary at the first regen past the window (the exact
 *    cliff this whole layer removes; rev-1's most dangerous gap, per 07 R1).
 *
 *    Capped-input fallback: when the full history exceeds the summariser input
 *    budget, the input degrades to prior-summary + the verbatim tail + EVERY
 *    turn cited by the current summary's provenance (R3 makes those anchor
 *    turns retrievable exactly) — so even a degraded regen re-reads the ground
 *    truth behind every standing slot entry, never the slot text alone.
 *
 * Turn ordinals: in INCREMENTAL mode the prior summary's cited turns are
 * labelled first (t1..tJ — provenance carry: carried entries render with
 * their stamps so the model can echo them and the maintainer resolves them
 * back to real ids), then shown turns continue tJ+1..tK (oldest SHOWN first).
 * In REGEN mode ordinals label shown turns only (full history re-anchors).
 * The model cites them in `[tN]` stamps; resolveProvenance (parse-summary
 * consumer, in the maintainer) maps ordinals → real turn ids via `ordinalMap`.
 * Refs the model invents that aren't in the map are dropped — stored
 * source_turn_ids are therefore ALWAYS real and resolvable.
 */

import {
  ROLLING_SUMMARY_SLOT_LABELS,
  SUMMARY_INPUT_TAIL_TURNS,
  SUMMARY_REGEN_INPUT_CHAR_BUDGET,
  SUMMARY_REGEN_INTERVAL,
  SUMMARY_SCHEMA_VERSION,
} from './summary-types.js';
import type { RollingSummary } from './summary-types.js';

/** The turn shape the builder needs (a normalised, chronological slice of
 *  SessionTurnWithContent — the maintainer reverses readRecent's newest-first). */
export interface SummariserTurn {
  readonly turn_id: string;
  readonly created_at: string;
  readonly user_message: string | null;
  readonly assistant_message: string | null;
}

export type SummariserMode = 'regen' | 'incremental';

export interface SummariserInput {
  readonly mode: SummariserMode;
  /** The user message fed to the summariser model (turns + prior summary). */
  readonly userMessage: string;
  /** ordinal ('t1'…) → the real turn it labels; used to resolve provenance. */
  readonly ordinalMap: ReadonlyMap<string, { turn_id: string; created_at: string }>;
  /** The newest turn absorbed — the write watermark. Null only when there are
   *  no turns at all (the maintainer skips the write in that case). */
  readonly watermark: { turn_id: string; created_at: string } | null;
  /** true when the regen degraded to the capped-input fallback. */
  readonly cappedFallback: boolean;
}

/**
 * Regenerate (rather than incrementally update) when: no prior summary, the
 * turn count hits the N-turn horizon, or the stored schema version is stale.
 */
export function shouldRegenerate(turnCount: number, prior: RollingSummary | null): boolean {
  if (prior === null) return true;
  if (prior.schema_version !== SUMMARY_SCHEMA_VERSION) return true;
  return turnCount > 0 && turnCount % SUMMARY_REGEN_INTERVAL === 0;
}

function turnChars(t: SummariserTurn): number {
  return (t.user_message?.length ?? 0) + (t.assistant_message?.length ?? 0);
}

function renderTurn(ordinal: string, t: SummariserTurn): string {
  const parts = [`[${ordinal}]`];
  if (t.user_message) parts.push(`USER: ${t.user_message}`);
  if (t.assistant_message) parts.push(`ASSISTANT: ${t.assistant_message}`);
  return parts.join('\n');
}

/** All source_turn_ids cited across the prior summary's slots (R3 anchors). */
function priorCitedTurnIds(prior: RollingSummary | null): Set<string> {
  const ids = new Set<string>();
  if (prior === null) return ids;
  for (const block of prior.slots) {
    for (const entry of block.entries) {
      for (const id of entry.source_turn_ids) ids.add(id);
    }
  }
  return ids;
}

/**
 * Select the turns to SHOW for a regen, applying the capped-input fallback.
 * `chronological` is oldest-first. Returns oldest-first shown turns.
 */
function selectRegenTurns(
  chronological: readonly SummariserTurn[],
  prior: RollingSummary | null,
): { shown: SummariserTurn[]; capped: boolean } {
  let total = 0;
  for (const t of chronological) total += turnChars(t);
  if (total <= SUMMARY_REGEN_INPUT_CHAR_BUDGET) {
    return { shown: [...chronological], capped: false };
  }
  // Fallback: verbatim tail ∪ provenance-cited anchor turns, chronological.
  const cited = priorCitedTurnIds(prior);
  const tailStart = Math.max(0, chronological.length - SUMMARY_INPUT_TAIL_TURNS);
  const keep = new Set<number>();
  for (let i = tailStart; i < chronological.length; i++) keep.add(i);
  for (let i = 0; i < chronological.length; i++) {
    if (cited.has(chronological[i]!.turn_id)) keep.add(i);
  }
  const shown = [...keep].sort((a, b) => a - b).map((i) => chronological[i]!);
  return { shown, capped: true };
}

/**
 * Render the prior summary for the incremental input. When `ordinalByTurnId`
 * assigns ordinals to the prior's cited turns, entries render WITH their
 * `[tN]` stamps (provenance carry — the model echoes the stamp on entries it
 * carries forward, so `resolveProvenance` keeps the real turn ids across
 * incremental rounds instead of silently dropping them until the next regen).
 * With no citations to carry, the stored prompt-ready text renders unchanged.
 */
function renderPriorSummaryBlock(
  prior: RollingSummary | null,
  ordinalByTurnId?: ReadonlyMap<string, string>,
): string {
  if (prior === null) return '';
  const header = '## Prior summary (update it — do not simply restate it)';
  if (!ordinalByTurnId || ordinalByTurnId.size === 0) {
    return [header, prior.text, ''].join('\n');
  }
  const carryNote =
    '(citation labels like [t1] below refer to the earlier turns they came from — keep them on entries you carry forward)';
  const lines: string[] = [];
  for (const block of prior.slots) {
    const rendered =
      block.entries.length > 0
        ? block.entries
            .map((e) => {
              const ords = e.source_turn_ids
                .map((id) => ordinalByTurnId.get(id))
                .filter((o): o is string => o !== undefined);
              return ords.length > 0 ? `${e.text} [${ords.join(', ')}]` : e.text;
            })
            .join(' ')
        : block.slot === 'FRAME'
          ? ''
          : '(none)';
    lines.push(`${ROLLING_SUMMARY_SLOT_LABELS[block.slot]}: ${rendered}`);
  }
  return [header, carryNote, lines.join('\n'), ''].join('\n');
}

/**
 * Build the summariser input for one maintenance pass.
 * `chronologicalTurns` is oldest-first (the maintainer reverses readRecent).
 */
export function buildSummariserInput(args: {
  readonly mode: SummariserMode;
  readonly priorSummary: RollingSummary | null;
  readonly chronologicalTurns: readonly SummariserTurn[];
  readonly briefText?: string | null;
}): SummariserInput {
  const { mode, priorSummary, chronologicalTurns, briefText } = args;

  if (chronologicalTurns.length === 0) {
    return {
      mode,
      userMessage: renderPriorSummaryBlock(priorSummary).trim(),
      ordinalMap: new Map(),
      watermark: null,
      cappedFallback: false,
    };
  }

  const watermarkTurn = chronologicalTurns[chronologicalTurns.length - 1]!;
  const watermark = { turn_id: watermarkTurn.turn_id, created_at: watermarkTurn.created_at };

  let shown: SummariserTurn[];
  let capped = false;
  if (mode === 'regen') {
    const sel = selectRegenTurns(chronologicalTurns, priorSummary);
    shown = sel.shown;
    capped = sel.capped;
  } else {
    // Incremental: the turns after the prior watermark under the store's
    // COMPOSITE total order (created_at, turn_id) — NOT created_at alone
    // (Codex r2 fix 3). The store permits same-timestamp turns; a `>` on the
    // timestamp alone permanently skips a same-timestamp sibling of the
    // watermark turn. Conservative at ties (mirrors lag.ts): a turn sharing
    // the watermark's created_at that is not the watermark turn itself is
    // treated as unabsorbed — over-showing is safe (the summariser dedups),
    // under-showing is the memory hole. An unparseable created_at is also
    // shown (cannot be placed → assume unabsorbed). If the prior watermark
    // is unknown/absent, fall back to the single newest turn (still bounded).
    const watermarkMs = priorSummary ? Date.parse(priorSummary.updated_turn_created_at) : NaN;
    const after = Number.isFinite(watermarkMs)
      ? chronologicalTurns.filter((t) => {
          const ts = Date.parse(t.created_at);
          if (!Number.isFinite(ts)) return true;
          if (ts > watermarkMs) return true;
          return ts === watermarkMs && t.turn_id !== priorSummary!.updated_turn_id;
        })
      : [];
    shown = after.length > 0 ? after : [watermarkTurn];
  }

  const ordinalMap = new Map<string, { turn_id: string; created_at: string }>();

  // Provenance carry (incremental only): assign ordinals to the prior
  // summary's cited turns FIRST, so carried entries keep resolvable stamps
  // (regen re-anchors from the real turns instead). created_at is looked up
  // from the read history when available; resolution needs only the id.
  const carriedOrdinalByTurnId = new Map<string, string>();
  if (mode === 'incremental' && priorSummary !== null) {
    const createdAtById = new Map(chronologicalTurns.map((t) => [t.turn_id, t.created_at]));
    for (const block of priorSummary.slots) {
      for (const entry of block.entries) {
        for (const id of entry.source_turn_ids) {
          if (carriedOrdinalByTurnId.has(id)) continue;
          const ordinal = `t${carriedOrdinalByTurnId.size + 1}`;
          carriedOrdinalByTurnId.set(id, ordinal);
          ordinalMap.set(ordinal, { turn_id: id, created_at: createdAtById.get(id) ?? '' });
        }
      }
    }
  }

  const renderedTurns: string[] = [];
  shown.forEach((t, i) => {
    const ordinal = `t${carriedOrdinalByTurnId.size + i + 1}`;
    ordinalMap.set(ordinal, { turn_id: t.turn_id, created_at: t.created_at });
    renderedTurns.push(renderTurn(ordinal, t));
  });

  const sections: string[] = [];
  if (mode === 'incremental') {
    sections.push(renderPriorSummaryBlock(priorSummary, carriedOrdinalByTurnId));
  }
  if (briefText && briefText.trim().length > 0) {
    sections.push(['## Decision brief (background)', briefText.trim(), ''].join('\n'));
  }
  sections.push(
    mode === 'regen'
      ? '## Full conversation (oldest first)'
      : '## New turns since the prior summary (oldest first)',
  );
  sections.push(renderedTurns.join('\n\n'));

  return {
    mode,
    userMessage: sections.filter((s) => s.length > 0).join('\n'),
    ordinalMap,
    watermark,
    cappedFallback: capped,
  };
}
