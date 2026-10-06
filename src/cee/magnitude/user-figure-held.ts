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
export function userFigureHeld(edge: unknown): UserFigureHeld | null {
  const p = isRec(edge) && isRec(edge.provenance) ? edge.provenance : undefined;
  if (p?.magnitude !== 'user_stated') return null;
  const ne = isRec(p.natural_effect) ? p.natural_effect : undefined;
  if (ne === undefined) return null;
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

const REPLACE_WORDS = /\breplace\s+(?:my|our|the)\s+(?:own\s+)?figure\b/iu;
const NEGATED_REPLACE = /\b(?:don['’]?t|do\s+not|never|not|no\s+need\s+to)\s+(?:\w+\s+){0,2}replace\s+(?:my|our|the)\s+(?:own\s+)?figure\b/iu;

/**
 * The user asked, in THIS turn's own typed words, to replace their figure ("replace my figure with slight"). The only
 * authority for a replace on the Agent's route: the Agent cannot write it, and a negated ask ("don't replace my
 * figure") is no ask.
 */
export function replaceFigureTheUserWrote(turnText: unknown): boolean {
  return typeof turnText === 'string' && REPLACE_WORDS.test(turnText) && !NEGATED_REPLACE.test(turnText);
}

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
