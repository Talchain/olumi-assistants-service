/**
 * ⭐ F1 — A BAND EDIT NEVER SILENTLY DROPS THE USER'S OWN FIGURE (red team #87 6006627551; DL lease to c6; Science d5
 * CONFIRMED 6006667946).
 *
 * WHY. A band write that moves a link's strength made the strength the user's and dropped Olumi's sizing with it
 * (`adjust-edge-strength.ts`, magnitude contract). On a link whose size the USER stated ("Each lost customer removes
 * £300 a month") that sizing IS the user's figure: three served shapes (canvas pill in band, canvas pill across bands,
 * chat "make … weak") deleted `natural_effect` + `magnitude`, kept a stale `source_quote`, told the user only "Its
 * strength is still strong", and the next Run asked again for the size they had given. MC P0 made every brief link
 * `user_stated`, so every band click on a brief link hit it.
 *
 * RULE. A write that would MOVE the strength (mean or direction) of a link holding the user's figure is refused, with
 * their figure quoted, and the link stays byte-identical — unless the user explicitly asked to replace it, in their own
 * words, this turn. A replace drops the figure, its magnitude and its quote together, and the receipt names what was
 * replaced. A review (`confirm_current`, an in-band pick that keeps the strength) changes nothing and is never refused.
 *
 * Pure. One predicate and one set of words for every door: the canvas adapter (`edge-strength-edit.ts`), the Agent's
 * `propose_link_strength` / `propose_link_strengths`, and the writer itself (`adjust-edge-strength.ts`).
 */
import { CANVAS_BAND_WORD, edgeBandFromMagnitude } from '../../orchestrator-v5/format/edge-strength-bands.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

export interface UserFigureHeld {
  /** The user's figure as they can recognise it: their own sentence, else the range they wrote, else the stored figure. */
  readonly quote: string;
}

/**
 * The user's own figure on this link, or `null` when the link holds none. A figure is the user's when the link's size
 * is `user_stated` (magnitude contract D9: from their brief, or typed in the figure editor) AND it still carries that
 * size in natural units (`natural_effect`). A band the user picked earlier carries no figure, so a later band edit
 * loses nothing and is not refused.
 */
/**
 * Does the edge's stored natural size (`provenance.natural_effect`) still DESCRIBE it (buddy r1 #6)?
 * `natural_effect.strength_mean` is the β it was written for, and every reader trusts it only while the edge's mean equals
 * it (R&C 5845818897) — or while a stored clamp records that β (`refit-frames.ts` `clampForPersist`: mean ±1,
 * `clamped_from` = the full β). A stale carrier states nothing. Served T1b (red team c89f5126, 4/4 brief links): exactly
 * equal. Shared by this file's F1 guard and the Run's input snapshot (schemas 0.78 `natural_effect`), so the two never
 * disagree about which size is current.
 */
export function naturalEffectDescribesEdge(edge: unknown): boolean {
  const p = isRec(edge) && isRec(edge.provenance) ? edge.provenance : undefined;
  const ne = p !== undefined && isRec(p.natural_effect) ? p.natural_effect : undefined;
  const mean = isRec(edge) && isRec(edge.strength) ? edge.strength.mean : undefined;
  const written = ne?.strength_mean;
  if (p === undefined || typeof mean !== 'number' || typeof written !== 'number') return false;
  return Math.abs(written - mean) <= 1e-9
    || (typeof p.clamped_from === 'number' && Math.abs(p.clamped_from - written) <= 1e-9
      && Math.abs(mean) === 1 && Math.sign(mean) === Math.sign(written));
}

export function userFigureHeld(edge: unknown): UserFigureHeld | null {
  const p = isRec(edge) && isRec(edge.provenance) ? edge.provenance : undefined;
  if (p?.magnitude !== 'user_stated') return null;
  const ne = isRec(p.natural_effect) ? p.natural_effect : undefined;
  if (ne === undefined) return null;
  // ⭐ Only a figure that still DESCRIBES the link: a stale carrier states nothing a write could lose, so it is not refused.
  if (!naturalEffectDescribesEdge(edge)) return null;
  const range = isRec(ne.stated_range) ? text(ne.stated_range.text) : undefined;
  // The stored-figure fallback is the display `grouped-link-sizing.ts` already serves for a link's natural size.
  const quote = text(p.source_quote) ?? range
    ?? `${String(ne.amount)} ${String(ne.amount_unit)} per ${String(ne.per_source_change)} ${String(ne.per_source_change_unit)}`;
  return { quote };
}

/** The refusal every door says, in the DL's words: the figure quoted, and the two ways forward. */
export function userFigureHeldRefusalText(held: UserFigureHeld, bandWord: string): string {
  return `This link holds your figure: ‘${held.quote}’. Change the figure, or say ‘replace my figure with ${bandWord}’.`;
}

/** The receipt of an explicit replace (d5 6006667946): names exactly what was replaced, and with what. */
export function userFigureReplacedReceipt(held: UserFigureHeld, bandWord: string): string {
  return `Replaced your figure (‘${held.quote}’) with ‘${bandWord}’.`;
}

const REPLACE_WORDS = /\breplace\s+(?:my|our|the)\s+(?:own\s+)?figures?\b/iu;
/** Any negator earlier in the same clause cancels the ask, however far back ("I don't want you to replace my figure"). */
const NEGATOR = /\b(?:don['’]?t|do\s+not|doesn['’]?t|didn['’]?t|never|not|no|without|rather\s+than|instead\s+of|stop|won['’]?t|wouldn['’]?t|shouldn['’]?t|can['’]?t|cannot)\b/iu;

/**
 * The CLAUSE in which the user asked, in THIS turn's own typed words, to replace their figure ("replace my figure with
 * slight") — or `null`. The only authority for a replace on the Agent's route: the Agent cannot write it. A clause runs
 * from the last sentence or clause break before the ask to the next one; any negator before the ask within it cancels
 * it (buddy r1 #2). The caller binds the clause to ONE link and ONE band (buddy r1 #3).
 */
export function replaceClauseOf(turnText: unknown): string | null {
  if (typeof turnText !== 'string') return null;
  const m = REPLACE_WORDS.exec(turnText);
  if (m === null) return null;
  // A break is a semicolon, a sentence end (".", "!", "?" before a capital or the end of the text) or a blank line —
  // never an abbreviation's period ("Do not, e.g., replace…") or a single line break ("Do not\nreplace…"), which would
  // cut a negation off its ask (buddy r2 #2).
  const breaks = /;|[.!?](?=\s+\p{Lu}|\s*$)|\n\s*\n/gu;
  let start = 0;
  let end = turnText.length;
  for (let b = breaks.exec(turnText); b !== null; b = breaks.exec(turnText)) {
    if (b.index < m.index) start = b.index + 1;
    else { end = b.index; break; }
  }
  if (NEGATOR.test(turnText.slice(start, m.index))) return null;
  return turnText.slice(start, end).trim();
}

/** Whether THIS turn's own words ask to replace a figure, un-negated (see {@link replaceClauseOf}). */
export function replaceFigureTheUserWrote(turnText: unknown): boolean {
  return replaceClauseOf(turnText) !== null;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/** `label` named in `text` as whole words, case-insensitive. */
export function mentionsLabel(text: string, label: string): boolean {
  const l = label.trim();
  return l !== '' && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(l)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/** What every door says when a replace would also reverse the link (buddy r1 #5; d5: the sign is kept). */
export const REPLACE_KEEPS_DIRECTION_TEXT =
  'Replacing your figure keeps the link’s direction. To reverse it, change the figure itself.';

/**
 * The GENERIC merges' check (`patch-applier.ts` `applyUpdateEdge`, the graph-management referee's
 * `buildUpdateEdgeFieldCandidate`; DL Review Desk class check on the F1 lease): a write that moved the strength (mean or
 * direction) of a link that held the user's figure. Those merges keep `natural_effect` while the strength moves — a
 * figure that no longer describes the link — and neither carries the user's replace, which only the link writer
 * (`adjust_edge_strength`) can honour. Returns the refusal to say, or `null` when the write leaves the figure's strength
 * as it was or the link held no figure of the user's.
 */
export function userFigureMovedRefusal(before: unknown, after: unknown): string | null {
  const held = userFigureHeld(before);
  if (held === null) return null;
  const mean = (e: unknown): unknown => (isRec(e) && isRec(e.strength) ? e.strength.mean : undefined);
  const direction = (e: unknown): unknown => (isRec(e) ? e.effect_direction : undefined);
  if (mean(before) === mean(after) && direction(before) === direction(after)) return null;
  const m = mean(after);
  const bandWord = typeof m === 'number' && Number.isFinite(m) ? CANVAS_BAND_WORD[edgeBandFromMagnitude(Math.abs(m))] : 'another strength';
  return userFigureHeldRefusalText(held, bandWord);
}

/** Thrown by a candidate builder that refuses on {@link userFigureMovedRefusal}; carries the words to show. */
export class UserFigureHeldError extends Error {
  constructor(readonly refusal: string) {
    super(refusal);
    this.name = 'UserFigureHeldError';
  }
}
