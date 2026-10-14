/**
 * ⭐ (A) A RATE × COUNT DRAWN AS TWO ADDED LINKS IS THEIR PRODUCT, WORKED OUT EXACTLY (Science d5 #87 6008551439 (A); MC
 * G1b ceiling on Acceptance's 14 served T1b drafts, CEE 231affbe).
 *
 * Served draft 7: ‘Starter-tier MRR’ was drawn from ‘Starter tier monthly price’ (£ per subscriber per month) and ‘Starter
 * subscribers’ as two ADDED links, both placeholders, and the withhold asked the user to size them. No honest size exists
 * for either: price × subscribers is not a sum, and sizing the price link on top of the £49 per subscriber double-counts
 * it. When the units prove the product (`unitsCompose` 'proof': the rate's denominator names the count), the outcome is
 * declared Olumi's product of the two (`provenance: 'inferred'`, so `stated_in_brief: false`), and ISL works it out
 * exactly; one it cannot evaluate is withdrawn and the Run goes ahead as before (PLoT variants (a)/(b)).
 *
 * Only when:
 *  · the outcome is not the goal, carries no declaration already, and its ONLY non-option parents are the rate and the count;
 *  · the outcome has no level of its own (ISL rule 3: with no stated level a 0 part is an ordinary level). The candidate
 *    wire gives an outcome no level field (`buildCandidateSchema`: label, provenance, unit, plausible_max), so the one
 *    route a level reaches its node is a FACTOR of the same label, which admission makes the same node: refused (Desk 6b
 *    #2644 Q1);
 *  · BOTH links into it are drawn positive: a product of a rate and a count rises with each, so a negative link is the
 *    drafter saying something else, and its sign is never overwritten by Olumi's + product (Desk 6b #2644 Q2);
 *  · every option setting the COUNT carries the user's admitted likely range (Science: "a point 150 gives Starter
 *    100%"). A count fed by a link keeps that link's spread; a bare point-set count is still refused;
 *  · every option level on a part is a figure the brief writes ABOUT that part or its option, in that part's unit (the
 *    user's own option levels; `figureTheUserWroteFor`, never the same number about another quantity).
 * Admission then judges the declaration like any other (`markProductIdentities`). Pure.
 */
import type { CandidateModel } from './admit-model.js';
import { unitsCompose } from './reconciling-product.js';
import { readCount, readMoney } from './same-unit.js';
import { figureTheUserWroteForSpan, sameWord, wordsOf } from './stated-by-user.js';
import { canonicalLabel } from './model-primitives.js';
import { admitInterventionRange } from '../intervention-range.js';

export interface RateCountProduct {
  readonly outcome: string;
  readonly rate: string;
  readonly count: string;
}

export function withRateCountProducts(candidate: CandidateModel, brief: string): { model: CandidateModel; minted: RateCountProduct[] } {
  // Every label is compared as admission MERGES it (`canonicalLabel`: case and spacing), so a respelling never slips past
  // a check that its merged node would fail (Codex buddy r1 F1, #2644).
  const k = canonicalLabel;
  const options = new Set(candidate.options.map((o) => k(o.label)));
  const declared = new Set((candidate.identities ?? []).map((i) => k(i.outcome)));
  const unitOf = (label: string): unknown =>
    candidate.factors.find((f) => k(f.label) === k(label))?.unit ?? candidate.outcomes.find((o) => k(o.label) === k(label))?.unit;
  const settingOf = (label: string) => candidate.options.flatMap((o) => (o.interventions ?? [])
    .filter((i) => k(i.factor_label) === k(label)).map((i) => ({ option: o.label, level: i })));
  const levelsSet = (label: string) => settingOf(label).map((s) => s.level);
  const quantityLabels = [...candidate.factors.map((f) => f.label), ...candidate.outcomes.map((o) => o.label), ...(candidate.risks ?? []).map((r) => r.label)];
  const minted: RateCountProduct[] = [];
  for (const outcome of candidate.outcomes) {
    const label = outcome.label;
    if (k(label) === k(candidate.goal.metric) || declared.has(k(label))) continue;
    // A same-labelled factor is this node's level (`buildCandidateSchema` gives an outcome none of its own).
    if (candidate.factors.some((f) => k(f.label) === k(label))) continue;
    const into = candidate.links.filter((l) => k(l.to) === k(label) && !options.has(k(l.from)));
    const parents = [...new Map(into.map((l) => [k(l.from), l.from] as const)).values()];
    if (parents.length !== 2) continue;
    // Both drawn positive, or the drafter's sign would be replaced by the product's.
    if (!into.every((l) => l.direction === 'positive')) continue;
    const [a, b] = parents as [string, string];
    const plain = unitsCompose(candidate.goal.unit, candidate.goal.metric, { unit: unitOf(a), label: a }, { unit: unitOf(b), label: b });
    // ⭐ G1b price × count (2): "£ per STARTER subscriber per month" × ‘Starter subscribers’ counted in "subscribers" (3 of
    // the bench's 23 price × count drafts) proved nothing twice over: the shared currency reader takes ONE word after "per"
    // (`readCurrencyUnitWithQualifiers`), so the rate was not read as money at all, and the denominator's qualifier is in
    // the count's LABEL, not its unit. Read again with both (`rateDenominatorAsOnePhrase`, `countQualifiedByLabel`):
    // `unitsCompose`'s own rule still decides, so every word of the denominator must be in the count.
    const readable = (part: string): unknown => countQualifiedByLabel(part, rateDenominatorAsOnePhrase(unitOf(part)));
    const composed = plain.kind === 'proof' ? plain
      : unitsCompose(candidate.goal.unit, candidate.goal.metric, { unit: readable(a), label: a }, { unit: readable(b), label: b });
    if (composed.kind !== 'proof') continue;
    // EVERY setting must keep a sampled range beside its own point; one bare point still refuses the product.
    if (!levelsSet(composed.count).every((level) => {
      const verdict = admitInterventionRange(level);
      return verdict !== undefined && 'range' in verdict && verdict.range.meaning === 'likely_range';
    })) continue;
    // The user's figure FOR THAT PART (or the option setting it), never the same number written about another quantity
    // ("Pro subscribers pay £49"; Codex buddy r1 F6).
    const theirs = (part: string): boolean => settingOf(part).every(({ option, level }) => {
      if (typeof level.value !== 'number') return false;
      const span = figureTheUserWroteForSpan(level.value, unitOf(part), brief, { target: [part, option], others: quantityLabels.filter((q) => k(q) !== k(part)) });
      if (span === null) return false;
      // The clause the figure is written in names the part or the option that sets it, by ANY of their words ("launch a
      // starter tier at £49"), so a clause about something the model does not hold ("Pro subscribers pay £49") is not it.
      const before = brief.slice(0, span.start).search(/[^.!?;,:\n]*$/u);
      const after = brief.slice(span.end).search(/[.!?;,:\n]/u);
      // The figure's own unit names no entity ("£49 … per month" is not ‘monthly price’), as the shared reader holds.
      const unitWords = typeof unitOf(part) === 'string' ? wordsOf(unitOf(part) as string) : [];
      const clause = wordsOf(brief.slice(before, after === -1 ? brief.length : span.end + after))
        .filter((c) => !unitWords.some((u) => sameWord(u, c)));
      const own = [...wordsOf(part), ...wordsOf(option)];
      const ownWord = (c: string): boolean => own.some((w) => sameWord(c, w));
      // A shared head word qualified by ANOTHER entity's word ("PRO tier costs £49") names that entity, not this part
      // (Codex buddy r2 F6): an occurrence counts only when the word before it is this part's own, or none at all.
      return clause.some((c, i) => ownWord(c) && (i === 0 || ownWord(clause[i - 1]!) || GENERIC.has(clause[i - 1]!)));
    });
    if (![a, b].every(theirs)) continue;
    minted.push({ outcome: label, rate: composed.rate, count: composed.count });
  }
  if (minted.length === 0) return { model: candidate, minted };
  return {
    model: {
      ...candidate,
      identities: [...(candidate.identities ?? []), ...minted.map((m) => ({ outcome: m.outcome, operation: 'product' as const, factors: [m.rate, m.count], provenance: 'inferred' as const }))],
    },
    minted,
  };
}

/**
 * A money rate whose denominator is a PHRASE ("£ per starter subscriber per month"), read as one noun phrase ("£ per
 * starter-subscriber per month"), only where that is what stops it reading as money. The words are unchanged (the
 * hyphen splits again in `unitsCompose`'s reader), so the proof asks MORE of the count, never less. Anything else, and
 * any unit that still does not read as money, is returned as it was.
 */
function rateDenominatorAsOnePhrase(unit: unknown): unknown {
  if (typeof unit !== 'string' || readMoney(unit, '') !== null) return unit;
  const joined = unit.replace(/(\bper\s+)([a-z]+(?:\s+[a-z]+)+?)(?=\s+per\b|\s*$)/giu, (_whole, per: string, phrase: string) => per + phrase.split(/\s+/u).join('-'));
  return joined !== unit && readMoney(joined, '') !== null ? joined : unit;
}

/**
 * A count's unit, QUALIFIED by its own label: the label ("Starter subscribers") where the unit reads as a count
 * ("subscribers") and the label reads as a count of that SAME noun that keeps EVERY word of the unit, so the label only
 * adds qualifiers and a rate "per starter subscriber" names it. Anything else keeps its unit: a money or unread unit, a
 * label naming another noun (‘Starter subscribers’ counted in "customers"), or a unit whose own qualifier the label does
 * not carry (‘Starter subscribers’ counted in "pro subscribers": Codex buddy r1 P1). `unitsCompose`'s own rule (the
 * denominator's noun is the count's, every word of it in the count) then decides.
 */
function countQualifiedByLabel(label: string, unit: unknown): unknown {
  const byUnit = readCount(unit);
  const byLabel = readCount(label);
  return byUnit !== null && byLabel !== null && byLabel[byLabel.length - 1] === byUnit[byUnit.length - 1]
    && byUnit.every((w) => byLabel.includes(w)) ? label : unit;
}

/** Words that qualify nothing ("launch A new starter tier", "keep THE price"): never another entity's name. */
const GENERIC = new Set(['the', 'our', 'its', 'their', 'this', 'that', 'these', 'those', 'each', 'every', 'any', 'new', 'own', 'one', 'launch', 'introduce', 'start']);
