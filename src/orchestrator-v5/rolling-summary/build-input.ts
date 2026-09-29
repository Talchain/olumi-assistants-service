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
 * Ordinals label UTTERANCES, not turns (see turnUnits): a turn carrying both a
 * user and an assistant message consumes TWO ordinals, so every `[tN]` names
 * exactly one speaker and provenance can record WHO said a thing.
 * In INCREMENTAL mode the prior summary's cited turns are
 * labelled first (t1..tJ — provenance carry: carried entries render with
 * their stamps so the model can echo them and the maintainer resolves them
 * back to real ids), then shown utterances continue tJ+1..tK (oldest SHOWN
 * first). In REGEN mode ordinals label shown utterances only (full history
 * re-anchors).
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
import type { RollingSummary, SummarySpeaker } from './summary-types.js';

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
  /** ordinal ('t1'…) → the real UTTERANCE it labels; used to resolve
   *  provenance. `speaker` is present for every shown utterance (one speaker
   *  per ordinal — see turnUnits) and ABSENT for a carried prior-summary
   *  citation, which refers to a turn rather than to one utterance. Absent
   *  therefore means UNKNOWN, never "no speaker" — the attribution gate
   *  declines to fire on unknowns rather than guessing. */
  readonly ordinalMap: ReadonlyMap<
    string,
    { turn_id: string; created_at: string; speaker?: SummarySpeaker }
  >;
  /** The newest turn absorbed — the write watermark. Null only when there are
   *  no turns at all (the maintainer skips the write in that case). */
  readonly watermark: { turn_id: string; created_at: string } | null;
  /** true when the regen degraded to the capped-input fallback. */
  readonly cappedFallback: boolean;
}

/**
 * Regenerate (rather than incrementally update) when: no prior summary, the
 * prior is a deterministic FLOOR, the turn count hits the N-turn horizon, or
 * the stored schema version is stale.
 *
 * FLOOR ⇒ REGEN (M1): a floor absorbed NO conversation history (brief/goal
 * only) and its watermark is the newest turn at floor-write time. Building
 * incrementally on it would show only the turns AFTER that watermark and
 * strand every pre-floor turn's content out of the summary until the next
 * horizon regen — a maintain-path memory hole. Forcing a full-history regen
 * makes the floor a transient placeholder the next pass fully rebuilds from
 * ground truth (and keeps re-trying regen while the floor persists).
 */
export function shouldRegenerate(turnCount: number, prior: RollingSummary | null): boolean {
  if (prior === null) return true;
  if (prior.generator === 'floor') return true;
  if (prior.schema_version !== SUMMARY_SCHEMA_VERSION) return true;
  return turnCount > 0 && turnCount % SUMMARY_REGEN_INTERVAL === 0;
}

function turnChars(t: SummariserTurn): number {
  return (t.user_message?.length ?? 0) + (t.assistant_message?.length ?? 0);
}

/**
 * SPEAKER-SCOPED CITATION UNITS (2026-07-25 attribution fix).
 *
 * A turn is NOT the citation atom — an UTTERANCE is. Previously one `[tN]`
 * label covered a turn containing BOTH `USER: …` and `ASSISTANT: …`, so:
 *   - the model was handed a unit with two speakers in it and could fuse them
 *     (the observed defect fused a user's challenge with an unrelated
 *     assistant reply into "The assistant acknowledged it cannot back up those
 *     names" — a concession the assistant never made); and
 *   - provenance was speaker-blind BY CONSTRUCTION: a stored entry's
 *     source_turn_ids could never say WHICH speaker a claim came from, so no
 *     layer could check an attribution against anything.
 *
 * Now each utterance gets its OWN ordinal. The `t\d+` grammar is unchanged —
 * parse-summary.ts and every stored shape are untouched — but every ordinal
 * now names exactly one speaker, so the model cannot cite a two-speaker unit
 * and assemble.ts can DERIVE the speaker set for each entry.
 */
function turnUnits(t: SummariserTurn): Array<{ speaker: SummarySpeaker; text: string }> {
  const units: Array<{ speaker: SummarySpeaker; text: string }> = [];
  if (t.user_message) units.push({ speaker: 'user', text: t.user_message });
  if (t.assistant_message) units.push({ speaker: 'assistant', text: t.assistant_message });
  return units;
}

function renderUnit(ordinal: string, unit: { speaker: SummarySpeaker; text: string }): string {
  return `[${ordinal}] ${unit.speaker === 'user' ? 'USER' : 'ASSISTANT'}: ${unit.text}`;
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
 * Codex finding 4 — the honest write watermark for a CHARACTER-capped regen.
 *
 * The scalar watermark means "every turn up to here is absorbed", and the
 * next incremental pass only re-reads turns AFTER it. When the capped fallback
 * drops turns, advancing the watermark to the newest turn would strand every
 * dropped turn older than the tail. The honest watermark is the newest turn
 * that has NO *unabsorbed* dropped turn behind it.
 *
 * A turn is already absorbed (and therefore safe to drop from the re-read)
 * when a REAL prior summary (generator !== 'floor') covered it — i.e. it is at
 * or before that prior's watermark under the store's total order. The store's
 * order is COMPOSITE (created_at, turn_id), so a timestamp comparison alone
 * cannot place a same-millisecond sibling; conservative at ties (mirrors the
 * incremental path and lag.ts): a turn sharing the prior watermark's
 * created_at that is NOT the watermark turn itself is treated as UNABSORBED —
 * treating it as absorbed would let the watermark advance past a cap-dropped
 * sibling the model never saw. A FLOOR absorbed no conversation history, and
 * an absent prior absorbed nothing, so in both cases every turn is treated as
 * fresh. Walk oldest-first: skip the
 * pre-absorbed prefix, then stop at the first UNABSORBED dropped turn; the
 * watermark is the newest included/absorbed turn before it. If the very first
 * unabsorbed turn is itself dropped, no honest advance is possible → null (the
 * maintainer then keeps the prior summary rather than write a false-complete
 * one). Cannot regress a real prior watermark: the pre-absorbed prefix always
 * keeps it as a candidate, and the monotonic store guard no-ops any stale land.
 */
function cappedRegenWatermark(
  chronological: readonly SummariserTurn[],
  shown: readonly SummariserTurn[],
  prior: RollingSummary | null,
): { turn_id: string; created_at: string } | null {
  const shownIds = new Set(shown.map((t) => t.turn_id));
  const realPrior = prior !== null && prior.generator !== 'floor' ? prior : null;
  const priorAbsorbedMs = realPrior ? Date.parse(realPrior.updated_turn_created_at) : NaN;
  let newestHonest: SummariserTurn | null = null;
  for (const t of chronological) {
    const ts = Date.parse(t.created_at);
    // Composite-order tie rule (mirrors incremental + lag.ts): at the prior
    // watermark's exact millisecond, only the watermark turn ITSELF is
    // absorbed — a same-ms sibling is unabsorbed (conservative at ties).
    const alreadyAbsorbed =
      Number.isFinite(priorAbsorbedMs) &&
      Number.isFinite(ts) &&
      (ts < priorAbsorbedMs ||
        (ts === priorAbsorbedMs && t.turn_id === realPrior?.updated_turn_id));
    if (alreadyAbsorbed) {
      // Pre-absorbed by a real prior summary — safe to drop; keep it as the
      // running boundary candidate so an all-absorbed prefix still yields the
      // prior watermark (never a regression).
      newestHonest = t;
      continue;
    }
    if (!shownIds.has(t.turn_id)) {
      // First unabsorbed turn omitted from the re-read — the watermark must
      // not advance to or past it.
      break;
    }
    newestHonest = t;
  }
  return newestHonest === null
    ? null
    : { turn_id: newestHonest.turn_id, created_at: newestHonest.created_at };
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
  let watermark: { turn_id: string; created_at: string } | null = {
    turn_id: watermarkTurn.turn_id,
    created_at: watermarkTurn.created_at,
  };

  let shown: SummariserTurn[];
  let capped = false;
  if (mode === 'regen') {
    const sel = selectRegenTurns(chronologicalTurns, priorSummary);
    shown = sel.shown;
    capped = sel.capped;
    if (capped) {
      // Codex finding 4 — do NOT advance the absorbed watermark past omitted
      // history. `selectRegenTurns` keeps the verbatim tail ∪ provenance-cited
      // anchors and DROPS the remaining (older, non-anchored) turns from the
      // model input. Advancing the scalar watermark to the newest turn would
      // silently mark those dropped turns as absorbed — but the model never
      // saw them, and the next INCREMENTAL pass only shows turns AFTER the
      // watermark, so a dropped turn older than the tail is never re-read (a
      // maintain-path memory hole). The disclosure (history_capped) is set by
      // the maintainer when this fallback fires; the watermark must also stay
      // honest.
      watermark = cappedRegenWatermark(chronologicalTurns, shown, priorSummary);
    }
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

  const ordinalMap = new Map<
    string,
    { turn_id: string; created_at: string; speaker?: SummarySpeaker }
  >();

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

  // One ordinal per UTTERANCE (not per turn) — see turnUnits. A turn with both
  // a user and an assistant message therefore consumes two ordinals, and every
  // ordinal names exactly one speaker.
  const renderedTurns: string[] = [];
  let nextOrdinal = carriedOrdinalByTurnId.size + 1;
  for (const t of shown) {
    const rendered: string[] = [];
    for (const unit of turnUnits(t)) {
      const ordinal = `t${nextOrdinal++}`;
      ordinalMap.set(ordinal, {
        turn_id: t.turn_id,
        created_at: t.created_at,
        speaker: unit.speaker,
      });
      rendered.push(renderUnit(ordinal, unit));
    }
    if (rendered.length > 0) renderedTurns.push(rendered.join('\n'));
  }

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
