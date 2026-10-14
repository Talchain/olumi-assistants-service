import { findStatedAmounts, readUnit, type StatedAmount } from "./stated-amounts.js";
import { readUnitParts, statedTailParts } from "../../orchestrator-v5/agent-lane/same-unit.js";

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * ⭐ A LEVEL CHANGE STATES A SIZE (MC, DL bench DIAGNOSIS §2a, 6 Oct 2026). The bench bank's briefs state a switch's
 * effect as the level it moves FROM and TO, never as the amount: "it would lift our enterprise win rate from 20% to about
 * 30%" and "about 30% of trial users abandon at that step today, and fixing it should roughly halve that" (investor, 7
 * served drafts), "a central kitchen would cut waste from 12% of output to 6%" (bakery). The literal reader needs the
 * amount written, so these stayed Olumi's guesses and Olumi asked for sizes the user had already given.
 */
export interface StatedLevelChange {
  /** B − A in the level's OWN unit: a percentage level moves in POINTS ("from 20% to 30%" is +10), never relatively. */
  readonly delta: number;
  /** Where the change is said: the level it moves TO ("30%"), or the verb ("halve"). Never the level it moves FROM. */
  readonly said: TextSpan;
  /** Where the quantity whose level changes is named: the clause before "from", or the clause "that" points back to. */
  readonly names: TextSpan;
  /** The share's base when a level writes one ("12% of output" → [output]), else null. */
  readonly base: readonly string[] | null;
}

const HEDGE = String.raw`(?:about|around|roughly|approximately|approx\.?|nearly|almost|some|~)`;
/** "from [about] A": what must come right before the level a from-to change starts at. */
const FROM_BEFORE = new RegExp(String.raw`\bfrom\s+(?:${HEDGE}\s*)?$`, "iu");
/** What may sit between A and B: A's own base ("of output"), then "to" or an arrow, then a hedge. */
const BASE_OF = String.raw`(?:\s+of(?:\s+[A-Za-z][A-Za-z'-]*){1,4})?`;
const FROM_TO_BETWEEN = new RegExp(String.raw`^${BASE_OF}\s+to\s+(?:${HEDGE}\s*)?$`, "iu");
const ARROW_BETWEEN = new RegExp(String.raw`^${BASE_OF}\s*(?:→|->|=>|⇒)\s*(?:${HEDGE}\s*)?$`, "u");
/** "halve that", "double it", "cut that in half": a pronoun that points back at ONE stated level, never a named object. */
const HALVE_OR_DOUBLE = /\b(?:(halve|halves)|(double|doubles))\s+(?:that|it|this)\b|\b(?:cut|cuts|reduce|reduces)\s+(?:that|it|this)\s+(?:in|by)\s+half\b/giu;
const NEGATED = /\b(?:not|never|no\s+longer|\w+n['’]t|doesnt|dont|wont|wouldnt|cannot)\b/iu;
/** A change said as what WOULD happen; "fell from 62% to 54%" is history, never an effect of an option. */
const PROSPECTIVE = /\b(?:would|will|should|could|might|may|can|shall)\b|['’](?:d|ll)\b|\bgoing\s+to\b|\bexpect(?:s|ed)?\s+(?:it\s+)?to\b/iu;
const SAYS_UP = /\b(?:lift|lifts|raise|raises|increase|increases|grow|grows|boost|boosts|rise|rises|up)\b/iu;
const SAYS_DOWN = /\b(?:cut|cuts|reduce|reduces|lower|lowers|decrease|decreases|drop|drops|fall|falls|shrink|shrinks|down)\b/iu;
const CLAUSE_BREAK = /[.,;:!?()\n–—]/u;

const valueOf = (a: StatedAmount): number => a.magnitude * readUnit(a.matchedText).multiplier;
const clauseStartBefore = (text: string, at: number): number => {
  for (let i = at - 1; i >= 0; i -= 1) if (CLAUSE_BREAK.test(text[i]!)) return i + 1;
  return 0;
};
const clauseEndAfter = (text: string, at: number): number => {
  for (let i = at; i < text.length; i += 1) if (CLAUSE_BREAK.test(text[i]!)) return i;
  return text.length;
};
/** The verb's own clause says the change prospectively and never the other way from its numbers. */
const directionHolds = (governing: string, delta: number): boolean => {
  if (!PROSPECTIVE.test(governing)) return false;
  const up = SAYS_UP.test(governing);
  const down = SAYS_DOWN.test(governing);
  return !(up && down) && !(up && delta < 0) && !(down && delta > 0);
};
const baseOf = (text: string, a: StatedAmount): readonly string[] | null => {
  const base = statedTailParts(text, a)?.base ?? null;
  return base !== null && base.length > 0 ? base : null;
};
const sameWords = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((w, i) => w === b[i]);

/**
 * Every level change `quote` states, by these rules only. A percentage LEVEL moves in points, so the change is B − A in
 * raw percent; nothing is ever read relatively. Nothing at all is read when:
 *  · the quote negates anything ("would not lift"), or the changes it states run both ways ("either halve that or
 *    double it"): the direction is not the user's to guess;
 *  · a change's own clause does not say it WOULD happen ("our gross margin fell from 62% to 54%" is history), or says
 *    the other way from its numbers ("would cut … from 20% to 30%");
 *  · a level is not a percentage: a count or money change keeps today's behaviour (Olumi asks);
 *  · "halve that" has not exactly ONE percentage before it to point at;
 *  · the two levels name different bases ("from 20% of leads to 30% of revenue").
 * It says WHERE the quantity is named (`names`); which quantity that is, is the caller's check.
 */
export function statedLevelChanges(quote: string): StatedLevelChange[] {
  if (quote.trim().length === 0 || NEGATED.test(quote)) return [];
  const percents = findStatedAmounts(quote).filter((a) => a.kind === "percent");
  const changes: StatedLevelChange[] = [];
  for (let i = 0; i + 1 < percents.length; i += 1) {
    const a = percents[i]!;
    const b = percents[i + 1]!;
    const between = quote.slice(a.index + a.matchedText.length, b.index);
    const fromTo = FROM_TO_BETWEEN.test(between) && FROM_BEFORE.test(quote.slice(0, a.index));
    if (!fromTo && !ARROW_BETWEEN.test(between)) continue;
    const baseA = baseOf(quote, a);
    const baseB = baseOf(quote, b);
    if (baseA !== null && baseB !== null && !sameWords(baseA, baseB)) continue;
    const delta = valueOf(b) - valueOf(a);
    // The clause the change is said in, up to where it starts: "it would lift our enterprise win rate" before "from".
    const startsAt = fromTo ? quote.slice(0, a.index).search(FROM_BEFORE) : a.index;
    const names = { start: clauseStartBefore(quote, startsAt), end: startsAt };
    if (delta === 0 || !Number.isFinite(delta) || !directionHolds(quote.slice(names.start, names.end), delta)) continue;
    changes.push({ delta, said: { start: b.index, end: b.index + b.matchedText.length }, names, base: baseA ?? baseB });
  }
  for (const m of quote.matchAll(HALVE_OR_DOUBLE)) {
    const before = percents.filter((p) => p.index + p.matchedText.length <= m.index);
    if (before.length !== 1) continue;
    const referent = before[0]!;
    const level = valueOf(referent);
    const delta = m[2] !== undefined ? level : -level / 2;
    const verbClause = quote.slice(clauseStartBefore(quote, m.index), m.index + m[0].length);
    if (delta === 0 || !Number.isFinite(delta) || !directionHolds(verbClause, delta)) continue;
    const verb = m[0].match(/^\S+/u)![0];
    changes.push({
      delta,
      said: { start: m.index, end: m.index + verb.length },
      names: { start: clauseStartBefore(quote, referent.index), end: clauseEndAfter(quote, referent.index + referent.matchedText.length) },
      base: baseOf(quote, referent),
    });
  }
  return changes.some((c) => c.delta > 0) && changes.some((c) => c.delta < 0) ? [] : changes;
}

/**
 * The ONE level change in `quote` that states `amount` in `amountUnit`, or undefined. The unit must say the change in
 * points: "percentage points" (`naturalAmountUnitOf` for a percentage level), or the share itself with its base ("% of
 * output", whose raw unit on its 100 frame IS a point). A bare "%" is the relative spelling and is never read here: a
 * +10 "%" of a 20% level would be 22%, not 30%. A base the sentence writes must be the unit's own.
 */
export function levelChangeStating(quote: string, amount: number, amountUnit: string): StatedLevelChange | undefined {
  const unit = readUnitParts(amountUnit);
  if (unit === null || !Number.isFinite(amount) || amount === 0) return undefined;
  const points = unit.kind === "points" && unit.base === null && unit.qualifiers === null && unit.per === null;
  const share = unit.kind === "percent" && unit.base !== null && unit.base.length > 0 && unit.qualifiers === null;
  if (!points && !share) return undefined;
  const matches = statedLevelChanges(quote).filter((c) =>
    Math.abs(c.delta - amount) <= Math.max(Math.abs(c.delta), Math.abs(amount), 1) * 1e-9
      && (!share || c.base === null || sameWords(c.base, unit.base!)));
  return matches.length === 1 ? matches[0] : undefined;
}
