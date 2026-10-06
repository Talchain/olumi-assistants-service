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
 *  · the outcome is not the goal, has no level of its own (ISL rule 3: with no stated level a 0 part is an ordinary
 *    level), carries no declaration already, and its ONLY non-option parents are the rate and the count;
 *  · no option sets the COUNT to a single figure: the brief's range must survive (Science: "a point 150 gives Starter
 *    100%"). A count fed by a link keeps that link's spread; a point-set count waits for the range reshape (a8's hold);
 *  · every option level on a part is a figure the brief writes, in that part's unit (the user's own option levels).
 * Admission then judges the declaration like any other (`markProductIdentities`). Pure.
 */
import type { CandidateModel } from './admit-model.js';
import { unitsCompose } from './reconciling-product.js';
import { figureTheUserWrote } from './stated-by-user.js';

export interface RateCountProduct {
  readonly outcome: string;
  readonly rate: string;
  readonly count: string;
}

export function withRateCountProducts(candidate: CandidateModel, brief: string): { model: CandidateModel; minted: RateCountProduct[] } {
  const options = new Set(candidate.options.map((o) => o.label));
  const declared = new Set((candidate.identities ?? []).map((i) => i.outcome));
  const unitOf = (label: string): unknown =>
    candidate.factors.find((f) => f.label === label)?.unit ?? candidate.outcomes.find((o) => o.label === label)?.unit;
  const levelsSet = (label: string) => candidate.options.flatMap((o) => (o.interventions ?? []).filter((i) => i.factor_label === label));
  const minted: RateCountProduct[] = [];
  for (const outcome of candidate.outcomes) {
    const label = outcome.label;
    if (label === candidate.goal.metric || declared.has(label)) continue;
    const parents = [...new Set(candidate.links.filter((l) => l.to === label).map((l) => l.from))].filter((p) => !options.has(p));
    if (parents.length !== 2) continue;
    const [a, b] = parents as [string, string];
    const composed = unitsCompose(candidate.goal.unit, candidate.goal.metric, { unit: unitOf(a), label: a }, { unit: unitOf(b), label: b });
    if (composed.kind !== 'proof') continue;
    // The count's range survives only through a link: an option that sets it to one figure is a point (Science (A)).
    if (levelsSet(composed.count).length > 0) continue;
    if (![a, b].every((part) => levelsSet(part).every((i) => typeof i.value === 'number' && figureTheUserWrote(i.value, unitOf(part), brief)))) continue;
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
