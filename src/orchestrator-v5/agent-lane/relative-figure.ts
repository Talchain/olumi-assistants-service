/**
 * ⛔ A CORRECTION LANDS FIRST TIME (DL lease 5907111773; AIQ rows 5907128716 + amendments 5907227964; MG SUCCESSOR
 * 5907210631).
 *
 * Served share build `2366977` (R3 joined run 05:52Z, `ccalt` r1): the user wrote "Our team's quote shows GCP would be
 * about 25% cheaper than AWS for our workload." The Agent proposed `{25, "%"}` for ‘GCP saving rate’, a factor measured
 * as a 0–1 `proportion` (Olumi's 0.2). The card read "GCP saving rate: 0.2% → 25%" and the user's press was refused at
 * write ("Not saved: none of it was applied"): 25 is not a proportion.
 *
 * Two readings, both pure:
 *   · `inShareFrame`: a percentage on a 0–1 share factor is the SAME quantity on another scale, read in the factor's frame
 *     (25% → 0.25). Never a re-frame, and never percentage POINTS (`pp`). A "%" figure of 1 or less is AMBIGUOUS there
 *     (0.5% → 0.005, or a mislabelled 0.5 share = 50%?): the writer would store 0.5 as 50%, a 100× false figure behind a
 *     card saying "0.5%", so it is refused and the user asked (AIQ amendment A).
 *   · `relativeFigureAgainst`: a figure written as a COMPARISON is the factor's only in the factor's own direction. The
 *     opposite direction ("AWS costs 25% MORE" against a GCP saving, which is 20%) or a comparison against the factor's
 *     own subject ("AWS is 25% cheaper than GCP") is not the factor's figure by ANY author: the user is asked, nothing is
 *     written (AIQ amendment B). A comparison whose direction or concept cannot be read gives no credit (Olumi's, said).
 */
import { unitPhraseHead } from './unit-conflict.js';

const SHARE_UNITS = new Set(['proportion', 'proportions', 'share', 'fraction', 'ratio']);
const PERCENT_UNITS = new Set(['%', 'percent', 'percentage']);

export type ShareFrameReading =
  | { readonly kind: 'as_given' }
  | { readonly kind: 'converted'; readonly value: number; readonly unit: string }
  | { readonly kind: 'ambiguous'; readonly asPercent: number; readonly asShare: number };

/** A figure the Agent gave in percent, read against a factor measured as a 0–1 share. */
export function inShareFrame(value: number, unit: unknown, factorUnit: unknown): ShareFrameReading {
  const head = (unitPhraseHead(factorUnit) ?? '').toLowerCase();
  const stated = (unitPhraseHead(unit) ?? '').toLowerCase();
  if (!Number.isFinite(value) || !SHARE_UNITS.has(head) || !PERCENT_UNITS.has(stated)) return { kind: 'as_given' };
  // Over 100% is no share at all: left as given (the existing checks and the writer decide, as today).
  if (value > 100) return { kind: 'as_given' };
  if (value <= 1) return { kind: 'ambiguous', asPercent: Number((value / 100).toPrecision(12)), asShare: value };
  return { kind: 'converted', value: Number((value / 100).toPrecision(12)), unit: String(factorUnit) };
}

type Direction = 'reduction' | 'increase';
// AFTER the figure: the comparative itself ("25% cheaper", "25% more expensive", "25% less").
const AFTER_REDUCTION = new Set(['cheaper', 'lower', 'less', 'fewer', 'smaller', 'off', 'saving', 'savings', 'discount',
  'reduction', 'cut', 'decrease', 'drop']);
const AFTER_INCREASE = new Set(['more', 'higher', 'greater', 'bigger', 'pricier', 'dearer', 'costlier', 'increase', 'premium',
  'markup', 'surcharge', 'extra', 'rise', 'uplift']);
// BEFORE the figure only a word of CHANGE counts ("save 25%", "cut costs by 25%"): "under 5%", "over 25%" and "more than
// 3%" are LEVELS the user states and keep today's reading.
const BEFORE_REDUCTION = new Set(['save', 'saves', 'saving', 'savings', 'cut', 'cuts', 'reduce', 'reduces', 'reduced', 'discount', 'decrease']);
const BEFORE_INCREASE = new Set(['increase', 'increases', 'increased', 'raise', 'raises', 'raised', 'markup', 'premium', 'surcharge', 'uplift']);
const REDUCTION_CONCEPT = /\b(?:saving|savings|discount|advantage|reduction|cheaper|cut|lower|decrease)\b/i;
const INCREASE_CONCEPT = /\b(?:premium|increase|uplift|markup|mark-up|surcharge|higher|rise|growth)\b/i;
const STOP = new Set(['for', 'in', 'on', 'per', 'at', 'with', 'and', 'but', 'when', 'if', 'so', 'because']);
const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+(?:[.'-][a-z0-9]+)*%?/g) ?? [];
const pick = (w: string | undefined, r: Set<string>, i: Set<string>): Direction | null =>
  w === undefined ? null : r.has(w) ? 'reduction' : i.has(w) ? 'increase' : null;

/**
 * The comparison around each PERCENT figure the user wrote, read against the factor ‘label’:
 *   'none'     — no comparison around it ("churn is 3.5%"): this rule does not apply;
 *   'same'     — its direction is the factor's concept, and "than" names nothing of the factor's own;
 *   'opposite' — the other direction, or compared against the factor's own subject: not this factor's figure;
 *   'unknown'  — a comparison whose direction or whose factor concept cannot be read.
 */
export type RelativeReading = 'none' | 'same' | 'opposite' | 'unknown';

function readAt(ws: readonly string[], at: number, label: string): RelativeReading {
  let next = at + 1;
  while (next < ws.length && (ws[next] === 'percent' || ws[next] === 'per' || ws[next] === 'cent')) next += 1;
  const after = pick(ws[next], AFTER_REDUCTION, AFTER_INCREASE);
  // "save 25%", "a saving of 25%", "cut costs by 25%": up to three words back, over "of"/"by" and one noun.
  const back = (w: string | undefined) => pick(w, BEFORE_REDUCTION, BEFORE_INCREASE);
  const before = back(ws[at - 1]) ?? back(ws[at - 2]) ?? (['by', 'of'].includes(ws[at - 1] ?? '') ? back(ws[at - 3]) : null);
  const than = ws.indexOf('than', at);
  const nearThan = than !== -1 && than - at <= 4;
  if (after === null && before === null && !nearThan) return 'none';
  const said = after ?? before;
  const r = REDUCTION_CONCEPT.test(label);
  const i = INCREASE_CONCEPT.test(label);
  const concept: Direction | null = r === i ? null : r ? 'reduction' : 'increase';
  if (said === null || concept === null) return 'unknown';
  if (said !== concept) return 'opposite';
  if (nearThan) {
    const own = new Set(words(label));
    for (const w of ws.slice(than + 1, than + 4)) {
      if (STOP.has(w)) break;
      if (w.length >= 2 && own.has(w)) return 'opposite';
    }
  }
  return 'same';
}

/** Where each percent figure sits in the words ("25%", "25 percent", "25 per cent"), with its value as written. */
function percentFigures(ws: readonly string[]): { at: number; value: number }[] {
  const out: { at: number; value: number }[] = [];
  ws.forEach((w, at) => {
    const n = Number.parseFloat(w.replace(/%$/, ''));
    if (!Number.isFinite(n) || !/^\d/.test(w)) return;
    if (w.endsWith('%') || ws[at + 1] === 'percent' || (ws[at + 1] === 'per' && ws[at + 2] === 'cent')) out.push({ at, value: n });
  });
  return out;
}

/**
 * The comparison around the percent figure `percent` in `text` (a figure not written there: 'none'), or, with no
 * `percent`, 'opposite' when ANY percent figure in `text` is compared the other way from the factor (the ask covers a
 * value the Agent worked out from it, too: "25% more" as a 20% saving is a conversion, never made on the card).
 */
export function relativeFigureAgainst(label: string, text: string | null | undefined, percent?: number): RelativeReading {
  if (typeof text !== 'string' || text.trim() === '') return 'none';
  const ws = words(text);
  const figures = percentFigures(ws);
  if (percent !== undefined) {
    const f = figures.find((x) => Math.abs(x.value - percent) < 1e-9);
    return f === undefined ? 'none' : readAt(ws, f.at, label);
  }
  return figures.some((f) => readAt(ws, f.at, label) === 'opposite') ? 'opposite' : 'none';
}
