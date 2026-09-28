/**
 * ⭐ THE USER'S OWN CHANGE, CARRIED BESIDE OLUMI'S LEVEL (AI Quality ruling (A), #72 5870443419; MG 5870385109;
 * Baseline v1 defect 3).
 *
 * "Hire two developers" on a headcount whose today is Olumi's estimate 5: construction registers the option's level 7,
 * stamped Olumi's (`cee_hypothesis`: it rests on Olumi's 5), and carries the user's "2" on the SAME level cell as
 * `stated_change: 2` with `stated_change_source: 'brief_extraction'` (`build-model.ts` `prepareProvisionalCandidate`,
 * `admit-model.ts` at the option-level write). The engine reads an option on a non-root as status quo + (level − today)
 * (ISL `SCMEvaluatorV2._in_model_frame`), so the level already IS the user's +2; the field is the record of whose
 * figure it was, and this is the one reader that says it.
 *
 * ⛔ READ, NEVER TRUSTED BLIND. The change is said only while the stored facts still add up: the level less today's
 * level is the change. A later writer that re-sets the level carries the cell's other fields forward
 * (`native-quantity-operation.ts` keeps all but `value`, `display_value` and `source`), and a corrected today moves
 * under a level that stays; either way the old "2" no longer explains the level, so it is left unsaid rather than
 * attributed to a figure it does not explain. Only a change whose source is the user's is said as "your".
 */
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { sayFigure, sayFigureRead } from './say-figure.js';

export interface StatedChangeReading {
  /** The user's figure, in the factor's own unit. */
  readonly change: number;
  /** Whose it is, as stored (`stated_change_source`). */
  readonly source: string;
  /** "your 2 more on Olumi's estimate of 5 today" */
  readonly because: string;
  /** "7 developers: your 2 more on Olumi's estimate of 5 today" */
  readonly words: string;
}

type Factor = { readonly observed_state?: unknown; readonly scale_frame?: unknown } | undefined;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const USERS: ReadonlySet<string> = new Set(['user_stated', 'user_ratified']);
const OLUMIS: ReadonlySet<string> = new Set(['ai_drafted', 'system_repaired']);

/**
 * A level cell's and a factor's figures in the factor's OWN unit — `raw_value` when stored; else the stored value, but
 * only on a factor with no range (`observed_state.cap`, or a `scale_frame` above 1), where the value is the figure.
 * Anything else is `undefined`: never a figure multiplied back up by a guessed range.
 */
function framed(factor: Factor): boolean {
  const os = (factor?.observed_state ?? {}) as Record<string, unknown>;
  return (num(os.cap) && os.cap > 0) || (num(factor?.scale_frame) && factor.scale_frame > 1);
}
function ownUnitFigure(carrier: Record<string, unknown>, factor: Factor): number | undefined {
  if (num(carrier.raw_value)) return carrier.raw_value;
  return !framed(factor) && num(carrier.value) ? carrier.value : undefined;
}

/**
 * The user's stated change on one option level cell, when the cell carries one that is the user's AND still adds up on
 * this factor; otherwise `undefined` (and nothing is said). Pure.
 */
export function readStatedChange(cell: unknown, factor: Factor): StatedChangeReading | undefined {
  if (cell === null || typeof cell !== 'object') return undefined;
  const c = cell as Record<string, unknown>;
  const change = c.stated_change;
  const source = c.stated_change_source;
  if (!num(change) || change === 0 || typeof source !== 'string' || !USERS.has(classifyValueSource(source))) return undefined;
  const os = (factor?.observed_state ?? {}) as Record<string, unknown>;
  const level = ownUnitFigure(c, factor);
  const today = ownUnitFigure(os, factor);
  if (level === undefined || today === undefined) return undefined;
  if (Math.abs(level - today - change) > 1e-9 * Math.max(1, Math.abs(level), Math.abs(today))) return undefined;

  const unit = typeof c.unit === 'string' && c.unit.trim() !== '' ? c.unit.trim()
    : typeof os.unit === 'string' ? os.unit.trim() : '';
  // A word unit ("developers") is said once, on the level; a symbol or percent ("£", "%") belongs to every figure.
  const wordUnit = unit !== '' && sayFigure(1, unit) === `1 ${unit}`;
  const bare = (x: number): string => sayFigureRead(x, wordUnit ? '' : unit);
  const more = change > 0 ? 'more' : wordUnit ? 'fewer' : 'less';
  const whose = classifyValueSource(os.source);
  const todaySaid = USERS.has(whose) ? `your ${bare(today)}` : OLUMIS.has(whose) ? `Olumi's estimate of ${bare(today)}` : bare(today);
  const because = `your ${bare(Math.abs(change))} ${more} on ${todaySaid} today`;
  return { change, source, because, words: `${sayFigureRead(level, unit)}: ${because}` };
}
