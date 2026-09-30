import type { CandidateModel } from './admit-model.js';
import { countedNoun } from './counted-nouns.js';
import { sourceOfM1Claim } from './m1-claim-lineage.js';

/** A named subgroup cannot borrow a current count stated only for its unqualified population. */
export function unboundM1CountScope(factor: CandidateModel['factors'][number], candidate: CandidateModel, brief: string): { neutralLabel: string; quote: string } | null {
  if (factor.provenance !== 'explicit' || factor.baseline_known !== true || typeof factor.baseline_value !== 'number'
    || factor.unit === null || !countedNoun(factor.unit.trim())) return null;
  const source = sourceOfM1Claim(brief, { entity: factor.label, others: candidate.factors.filter((f) => f !== factor).map((f) => f.label), value: factor.baseline_value, unit: factor.unit, role: 'current' });
  if (source === null) return null;
  const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z]+/g) ?? [];
  const label = tokens(factor.label);
  const afterCount = tokens(brief.slice(source.number_end, source.end));
  if (!countedNoun(label.at(-1) ?? '')) return null;
  // Read only the counted noun phrase immediately following this exact source occurrence. Words in the price
  // clause, or elsewhere in the brief, cannot supply its population scope. No role/unit/denominator is inferred.
  for (let cut = 0; cut < label.length; cut += 1) {
    const suffix = label.slice(cut);
    if (!suffix.every((word, i) => afterCount[i] === word)) continue;
    if (cut === 0) return null;
    const prefix = label.slice(0, cut);
    if (prefix.every((word) => /^(?:the|our|current|total|number|count|of|monthly|weekly|annual|average)$/.test(word))) return null;
    const neutralLabel = brief.slice(source.number_end, source.end).trim().split(/\s+/).slice(0, suffix.length).join(' ');
    return { neutralLabel: neutralLabel[0]!.toUpperCase() + neutralLabel.slice(1), quote: source.quote };
  }
  return null;
}
