/**
 * ⭐ S7 PR-B (B1): A LICENSED CHANCE LINE IS NOT A RANKING (DL 15 Oct ~02:4xZ, the S7 root cause). The leader gate reads
 * "N% chance" as ranking vocabulary, so on a Run whose leader is withheld it deleted the AI's own per-option chance lines, and
 * the host then inserted its own (`goal-chance-screen-lines.ts` records the loop). This is the one check that lets the AI say
 * an option's chance in its own words: a sentence keeps its figures only when it names ONE option and every percentage in it
 * equals THAT option's licensed goal-chance display on the same current Run, it speaks of a chance (never a share of runs),
 * and any window it states is the goal's own (PL contract: figure type, option, window, licence, Run). Anything else in the
 * sentence is classified exactly as before, so a ranking word beside the figure still drops it. Pure.
 */
import { goalChanceFactsForAgent } from '../goal-target/goal-chance-range-agent.js';
import { goalTargetBasisOf } from '../goal-target/goal-target-basis.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One option's licensed goal-chance figures on the selected current Run (a point, or a range's two ends). */
export interface LicensedChance {
  readonly label: string;
  readonly figures: readonly number[];
}
export interface LicensedChances {
  readonly options: readonly LicensedChance[];
  /** The goal's own window, in months, when it has one; a sentence's stated window must be this. */
  readonly periodMonths?: number;
}

const PCT = /(?<![\w.])(\d+(?:[.,]\d+)?)\s?(?:%|per\s?cent\b)/gi;
/** The percentages a text states, as numbers. */
export const figuresIn = (text: string): number[] => [...text.matchAll(PCT)].map((m) => Number(m[1]!.replace(',', '.')));

/** The selected Run's licensed chances, by option label, or undefined when it licenses none or is not current. */
export function licensedChancesOf(analysisResult: unknown, graph: unknown, current: boolean): LicensedChances | undefined {
  if (!current) return undefined;
  const facts = goalChanceFactsForAgent(analysisResult, graph, true);
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const labelOf = (id: string): string | undefined => {
    const label = nodes.find((n) => n.id === id)?.label;
    return typeof label === 'string' && label.trim() !== '' ? label : undefined;
  };
  const ids = new Set([...Object.keys(facts.goal_chance_display ?? {}), ...Object.keys(facts.goal_chance_range_display ?? {})]);
  const options = [...ids].flatMap((id): LicensedChance[] => {
    const label = labelOf(id);
    const figures = [...figuresIn(facts.goal_chance_display?.[id] ?? ''), ...figuresIn(facts.goal_chance_range_display?.[id]?.range ?? '')];
    return label === undefined || figures.length === 0 ? [] : [{ label, figures }];
  });
  if (options.length === 0) return undefined;
  const goal = nodes.find((n) => n.kind === 'goal');
  const period = goalTargetBasisOf(goal)?.period_months;
  return { options, ...(typeof period === 'number' ? { periodMonths: period } : {}) };
}

const key = (s: string): string => s.replace(/[‘’']/g, "'").replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const CHANCE = /\b(?:chance|likel(?:y|ihood)|probab(?:ility|le|ly))\b/i;
const SHARE = /\b(?:of\s+(?:the\s+)?(?:runs|simulations|draws|samples)|share|shares|wins?|won|winning|on\s+top|out\s+on\s+top)\b/i;
const WORD_MONTHS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, eighteen: 18, 'twenty-four': 24 };
const NUM = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty-four)`;
/** "month 3" / "month three", and "3 months" / "three-month": every stated window, each read on its own. */
const MONTH_WINDOWS = [new RegExp(String.raw`\bmonth\s+${NUM}\b`, 'gi'), new RegExp(String.raw`\b${NUM}[\s-]+months?\b`, 'gi')];
const DATE = /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i;

/**
 * Is this sentence one option's licensed chance, said as a chance at the goal's own window? Only then may the gate set its
 * figures aside; the rest of the sentence is still classified.
 */
export function isLicensedChanceLine(sentence: string, chances: LicensedChances | undefined, optionLabels: readonly string[]): boolean {
  if (chances === undefined || typeof sentence !== 'string') return false;
  const k = key(sentence);
  const named = chances.options.filter((o) => key(o.label).length > 0 && k.includes(key(o.label)));
  if (named.length !== 1) return false;
  const own = key(named[0]!.label);
  // Another option named beside it makes it a comparison, which this exemption never covers.
  if (optionLabels.some((l) => { const lk = key(l); return lk.length > 0 && lk !== own && !own.includes(lk) && k.includes(lk); })) return false;
  // The option's own label may hold a percentage ("Raise prices 10%"): only the figures outside it are the chance.
  const labelRe = new RegExp(named[0]!.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[‘’']/g, "['‘’]"), 'gi');
  const figures = figuresIn(sentence.replace(labelRe, ' '));
  if (figures.length === 0 || !figures.every((f) => named[0]!.figures.includes(f))) return false;
  if (!CHANCE.test(sentence) || SHARE.test(sentence)) return false;
  if (DATE.test(sentence)) return false;
  for (const m of MONTH_WINDOWS.flatMap((re) => [...sentence.matchAll(re)])) {
    const raw = (m[1] ?? '').toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : WORD_MONTHS[raw];
    if (n === undefined) continue;
    if (chances.periodMonths === undefined || n !== chances.periodMonths) return false;
  }
  return true;
}

/** The sentence with its licensed percentages set aside, so only its other words are classified. */
export function withoutLicensedFigures(text: string, blank: string): string {
  return text.replace(PCT, blank);
}
