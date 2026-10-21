/**
 * ⭐ WHAT EACH OPTION MOST LIKELY GIVES, IN THE GOAL'S OWN UNITS (Paul, 21 Oct: drop the win / on top / share-of-runs
 * framing; DL rulings 21 Oct). One sentence per option, built HERE and nowhere else:
 *
 *   "With the data provided, Option A most likely gives about 170 orders a week (likely 140–200), about 78% chance of
 *    meeting your goal."
 *
 * then ONE separation sentence over the options' likely ranges (p10–p90, no overlap: conservative and simple, DL (b)):
 *   "Their likely ranges clearly separate." / "Their likely ranges overlap, so this model can't clearly separate them."
 *
 *  · "most likely about M" is the option's p50 (DL (a): Paul's own words); "likely L–H" is its p10–p90.
 *  · NUMBERS ONLY IN THE GOAL'S REAL UNITS: a level goal whose dispatched threshold converts exactly to the stated target
 *    (`goal_threshold × cap = raw`, the licence's own check) and whose starting level is not Olumi's guess. Otherwise —
 *    a normalised run, a change goal, no target — no option sentence at all, only the separation sentence (the overlap
 *    test holds on any monotone scale).
 *  · The goal chance is the licence's own display (`goalChanceDisplayFromLicence`), never re-derived; no licence, no chance.
 *  · No ranking word: no "best", "winner", "top", "leads". The UI renders these words by identity.
 *
 * Carried like the goal-chance licence: ONE `info` entry in the Run's `inference_warnings` (the keep-listed carrier, no new
 * field, no schemas release), stored with the Run, so the turn and the reload read the same words. Pure.
 */
import { readOptionResultSources } from '../../orchestrator/context/option-result-source.js';
import { sayFigure } from '../agent-lane/say-figure.js';
import { GOAL_CHANCE_LICENSED, goalChanceDisplayFromLicence, goalLevelIsOlumisEstimate, type SentGoalThreshold } from './goal-chance-licence.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const OPTION_OUTCOME_WORDS = 'OPTION_OUTCOME_WORDS';
export const RANGES_SEPARATE = 'Their likely ranges clearly separate.';
export const RANGES_OVERLAP = "Their likely ranges overlap, so this model can't clearly separate them.";

export interface OptionOutcomeWords {
  readonly code: typeof OPTION_OUTCOME_WORDS;
  readonly severity: 'info';
  readonly message: string;
  readonly options: ReadonlyArray<{ readonly option_id: string; readonly words: string }>;
  readonly separation: 'separate' | 'overlap' | null;
}

/** Two significant figures, as "about" says them; three where two would collapse the range onto one figure. */
const about = (v: number, sig: number): number => Number(v.toPrecision(sig));

/** "140–200 orders a week", "£140–£200 / month": a unit that follows both figures is said once. */
function rangeWords(low: string, high: string): string {
  let k = 0;
  while (k < low.length && k < high.length && low[low.length - 1 - k] === high[high.length - 1 - k]) k++;
  const space = low.slice(low.length - k).indexOf(' ');
  const shared = space < 0 ? '' : low.slice(low.length - k + space);
  return `${shared === '' ? low : low.slice(0, -shared.length)}–${high}`;
}

/** The factor that turns the Run's outcome figures into the goal's real units, or null where none exists exactly. */
function toGoalUnits(goal: Rec, sent: SentGoalThreshold | undefined): number | null {
  if (sent === undefined || sent.frame !== 'level' || goal[sent.field] !== sent.value) return null;
  if (sent.field === 'goal_threshold_raw') return 1;
  const { goal_threshold_cap: cap, goal_threshold_raw: raw, goal_threshold: t } = goal;
  return finite(cap) && cap > 0 && finite(raw) && finite(t) && Math.abs(t * cap - raw) <= 1e-9 * Math.abs(raw) ? cap : null;
}

export function optionOutcomeWordsOf(envelope: unknown, graph: unknown, goalId: unknown, sent: SentGoalThreshold | undefined): OptionOutcomeWords | null {
  if (!isRec(envelope) || !isRec(graph) || !Array.isArray(graph.nodes)) return null;
  const nodes = graph.nodes.filter(isRec);
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  const records = readOptionResultSources(envelope).find((s) => s.length > 0) ?? [];
  const ranged = records.flatMap((r) => {
    const o = isRec(r.outcome) ? r.outcome : undefined;
    const id = typeof r.option_id === 'string' ? r.option_id : undefined;
    return id !== undefined && finite(o?.p10) && finite(o?.p50) && finite(o?.p90) && o.p10 <= o.p50 && o.p50 <= o.p90
      ? [{ id, p10: o.p10, p50: o.p50, p90: o.p90 }] : [];
  });
  if (ranged.length === 0) return null;
  const separation = ranged.length < 2 ? null
    : ranged.every((a, i) => ranged.every((b, j) => i >= j || a.p90 < b.p10 || b.p90 < a.p10)) ? 'separate' : 'overlap';
  const unit = typeof goal?.goal_threshold_unit === 'string' ? goal.goal_threshold_unit.trim() : '';
  const scale = goal === undefined || unit === '' || goalLevelIsOlumisEstimate(graph, goalId) ? null : toGoalUnits(goal, sent);
  const licence = (Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : [])
    .find((w): w is Rec => isRec(w) && w.code === GOAL_CHANCE_LICENSED && Array.isArray(w.option_ids));
  const chance = licence === undefined ? undefined : goalChanceDisplayFromLicence(licence);
  const options = scale === null ? [] : ranged.flatMap(({ id, p10, p50, p90 }) => {
    const label = nodes.find((n) => n.id === id && n.kind === 'option')?.label;
    if (typeof label !== 'string' || label.trim() === '' || /[\r\n]/.test(label)) return [];
    const sig = about(p10 * scale, 2) === about(p90 * scale, 2) ? 3 : 2;
    const [m, l, h] = [p50, p10, p90].map((v) => sayFigure(about(v * scale, sig), unit));
    const p = chance?.[id];
    return [{ option_id: id, words: `With the data provided, ${label.trim()} most likely gives about ${m} (likely ${rangeWords(l, h)})`
      + `${p === undefined ? '' : `, ${p} chance of meeting your goal`}.` }];
  });
  return { code: OPTION_OUTCOME_WORDS, severity: 'info', message: separation === null ? '' : separation === 'separate' ? RANGES_SEPARATE : RANGES_OVERLAP,
    options, separation };
}

/** Appends the words to the Run's `inference_warnings` when there are any; otherwise the envelope itself. Pure. */
export function withOptionOutcomeWords<E>(envelope: E, graph: unknown, goalId: unknown, sent: SentGoalThreshold | undefined): E {
  const words = optionOutcomeWordsOf(envelope, graph, goalId, sent);
  if (words === null || !isRec(envelope)) return envelope;
  const warnings = Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : [];
  return { ...envelope, inference_warnings: [...warnings, words] } as E;
}
