/** Science goals §(r)(b), PR-1: keep Olumi's unsized unitless risks visible, outside the chance. Candidate-level and pure. */
import type { CandidateModel } from './admit-model.js';
import { canonicalLabel } from './model-primitives.js';
import { usersRisk } from './product-goal-extra-parent.js';
import { holdStatedEventRisks } from './stated-event-risk-draft.js';

/**
 * Conservative limit veto: any shared metric word protects the risk. We need not prove that the risk IS the limit;
 * ambiguity keeps it in. All declared constraints protect, even when their stated provenance is uncertain.
 * `metric` is accepted for callers with one; the draft risk schema gains no field.
 */
export function riskMatchesLimit(
  risk: { readonly label: string; readonly metric?: string },
  constraints: readonly { readonly metric: string }[],
): boolean {
  const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const names = [risk.label, ...(typeof risk.metric === 'string' ? [risk.metric] : [])];
  const namedWords = new Set(names.flatMap(words));
  return constraints.some(c => {
    const metric = canonicalLabel(c.metric);
    return metric === '' || names.some(name => canonicalLabel(name) === metric)
      || words(c.metric).some(word => namedWords.has(word));
  });
}

export function excludeAddedUnitlessRisks<M extends CandidateModel>(model: M, brief?: string): { model: M; excluded: string[] } {
  if (model.risks.length === 0) return { model, excluded: [] };
  // Use the same stated-event-risk hold as the stored draft. Its plural matching can recognise likelihoods that
  // usersRisk's deliberately broad brief-word check does not. Label identities suffice before node ids are assigned.
  const held = holdStatedEventRisks(
    model.risks.map(r => ({ id: canonicalLabel(r.label), kind: 'risk', label: r.label })),
    model.links.map(l => ({ from: canonicalLabel(l.from), to: canonicalLabel(l.to) })), brief ?? '',
  );
  const likelihoods = new Set([...held.held, ...held.refused].map(r => r.risk_id));
  const targets = new Set(model.options.flatMap(o => [
    ...(o.interventions ?? []).map(i => canonicalLabel(i.factor_label)), ...(o.changes ?? []).map(canonicalLabel),
  ]));
  const excluded: string[] = [];
  const risks = model.risks.map(r => {
    const id = canonicalLabel(r.label);
    // Never-exclude classes veto before stamping. Existing exclusions belong to the adjacent producer family and
    // keep their own disclosure; this step neither reverses nor repeats them.
    if (usersRisk(r, brief) || r.unit !== null || likelihoods.has(id) || riskMatchesLimit(r, model.constraints)
      || targets.has(id) || model.links.some(l => (canonicalLabel(l.from) === id || canonicalLabel(l.to) === id)
        && (l.provenance === 'explicit' || l.effect_provenance === 'explicit' || l.definitional === true))
      || r.analysis_participation === 'retained_excluded') return r;
    excluded.push(r.label);
    return { ...r, analysis_participation: 'retained_excluded' as const };
  });
  return excluded.length === 0 ? { model, excluded } : { model: { ...model, risks }, excluded };
}

export function sayUnitlessRiskExcluded(label: string): string {
  return `Olumi added ‘${label}’ as a risk but can't size it in your goal's units yet, so it's shown as a risk to weigh and kept out of the chance.`;
}
