import { createHash } from 'node:crypto';
import { canonicalLabel, type CandidateModel } from './admit-model.js';
import { optionQuotes } from './option-lineage.js';
import { figureTheUserWroteFor, withdrawUnstatedBaselineStamps } from './stated-by-user.js';

export interface M1Proposal {
  readonly id: string;
  readonly kind: 'option' | 'factor' | 'risk' | 'outcome' | 'value' | 'relationship' | 'definition' | 'constraint';
  readonly label: string;
  readonly field_path: string;
  readonly reason: string;
  readonly actions: readonly ['explore', 'add', 'dismiss'];
  readonly payload: unknown;
}

export interface M1Partition {
  readonly candidate: CandidateModel;
  readonly proposals: readonly M1Proposal[];
  readonly option_quotes: ReadonlyMap<string, string>;
  /** Names retained only to carry an explicit option, limit or relationship; never re-authored as user facts. */
  readonly placeholders: readonly string[];
}

/**
 * A bounded authority partition of the existing candidate, not another semantic interpreter.
 * The candidate's explicit declarations still pass the existing source/numeric admission checks.
 * A quote supports option ownership only when it binds an enumerated option or an explicit modal action.
 * Generated additions and values never enter admission; referenced missing quantities remain unvalued.
 */
export function partitionM1Candidate(candidate: CandidateModel, brief: string): M1Partition {
  const proposals: M1Proposal[] = [];
  const propose = (kind: M1Proposal['kind'], label: string, field_path: string, payload: unknown, reason: string): void => {
    const id = `m1_${createHash('sha256').update(JSON.stringify([kind, field_path, payload])).digest('hex').slice(0, 16)}`;
    proposals.push({ id, kind, label, field_path, payload, reason, actions: ['explore', 'add', 'dismiss'] });
  };
  const listed = optionQuotes(candidate, brief);
  const option_quotes = new Map<string, string>();
  const sourceOption = (o: CandidateModel['options'][number]): string | undefined => {
    const listedQuote = listed.get(canonicalLabel(o.label));
    if (listedQuote !== undefined) return listedQuote;
    const words = (o as { brief_words?: unknown }).brief_words;
    if (typeof words !== 'string' || words.trim() === '') return undefined;
    const at = brief.indexOf(words);
    if (at < 0 || brief.indexOf(words, at + 1) !== -1) return undefined;
    // This deliberately small grammar recognises a USER-PROPOSED ACTION, not any text containing its number.
    // E.g. "Should we switch ... to GCP?" supports "Switch to GCP"; "£49" never supports "Keep £49".
    if (!/(?:^|[.!?]\s*)(?:should|could|can|shall)\s+we\s+$/i.test(brief.slice(0, at))) return undefined;
    const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const source = tokens(words); const label = tokens(o.label);
    if (label.length < 2 || label[0] !== source[0]) return undefined;
    // Matching meaningful label words in order also rules out reusing a correct action quote for another option.
    let cursor = 0;
    for (const word of label.filter((w) => !['our', 'the', 'a', 'an', 'per'].includes(w))) {
      const next = source.indexOf(word, cursor);
      if (next < 0) return undefined;
      cursor = next + 1;
    }
    // Two candidate options may not claim one source action.
    if (candidate.options.filter((other) => (other as { brief_words?: unknown }).brief_words === words).length !== 1) return undefined;
    return words;
  };
  const options = candidate.options.flatMap((o) => {
    const quote = sourceOption(o);
    if (quote !== undefined) option_quotes.set(canonicalLabel(o.label), quote);
    if (o.provenance === 'explicit' || quote !== undefined) return [{ ...o, provenance: 'explicit' as const }];
    propose('option', o.label, `options[${o.label}]`, o, 'This alternative was added by Olumi; adopt it before adding it to the model.');
    return [];
  });
  const constraints = candidate.constraints.filter((c) => {
    if (c.provenance === 'explicit') return true;
    propose('constraint', c.metric, `constraints[${c.metric}]`, c, 'This limit was not stated by the user.');
    return false;
  });
  const required = new Set<string>([canonicalLabel(candidate.goal.metric), ...constraints.map((c) => canonicalLabel(c.metric))]);
  for (const option of options) {
    for (const i of option.interventions ?? []) if (i.provenance === 'explicit') required.add(canonicalLabel(i.factor_label));
    for (const label of option.changes ?? []) required.add(canonicalLabel(label));
  }
  for (const link of candidate.links) if (link.provenance === 'explicit') {
    required.add(canonicalLabel(link.from)); required.add(canonicalLabel(link.to));
  }
  const placeholders: string[] = [];
  const keepEntity = (kind: 'factor' | 'risk' | 'outcome', entity: { label: string; provenance: string }): boolean => {
    if (entity.provenance === 'explicit') return true;
    propose(kind, entity.label, `${kind}s[${entity.label}]`, entity, 'This modelling addition needs user adoption.');
    if (!required.has(canonicalLabel(entity.label))) return false;
    placeholders.push(entity.label);
    return true;
  };
  const factors = candidate.factors.filter((f) => keepEntity('factor', f)).map((f) => {
    // Existing admission only downgrades invented zero's author, then uses 0 + a supplied addition as an absolute
    // setting. M1 leaves that current level unset: prepareProvisionalCandidate preserves the addition in its existing
    // additions_without_total carrier. Reuse MG's baseline attestation (including spelled zero), not a new parser.
    const baselineStamp = withdrawUnstatedBaselineStamps([{ kind: 'factor', label: f.label, observed_state: { value: f.baseline_value, unit: f.unit, source: 'brief_extraction' } }], brief)[0]!;
    const zeroStamp = withdrawUnstatedBaselineStamps([{ kind: 'factor', label: f.label, observed_state: { value: 0, unit: f.unit, source: 'brief_extraction' } }], brief.replace(/\b0(?:\.0+)?\b/g, ''))[0]!;
    const zeroWritten = figureTheUserWroteFor(0, f.unit, brief, { target: [f.label], others: candidate.factors.filter((other) => other !== f).map((other) => other.label), strict: true })
      || (/\bzero\b/i.test(brief) && zeroStamp.observed_state.source === 'brief_extraction');
    if (f.baseline_known === true && f.provenance === 'explicit' && baselineStamp.observed_state.source === 'brief_extraction' && (f.baseline_value !== 0 || zeroWritten)) return f;
    if (typeof f.baseline_value === 'number') propose('value', f.label, `factors[${f.label}].baseline_value`, { value: f.baseline_value, unit: f.unit }, 'The user has not supplied this current level.');
    return { ...f, baseline_known: false, baseline_value: null };
  });
  const risks = candidate.risks.filter((r) => keepEntity('risk', r));
  const outcomes = candidate.outcomes.filter((o) => keepEntity('outcome', o));
  const quantities = new Set([canonicalLabel(candidate.goal.metric), ...factors.map((f) => canonicalLabel(f.label)), ...risks.map((r) => canonicalLabel(r.label)), ...outcomes.map((o) => canonicalLabel(o.label))]);
  const keptOptions = options.map((o) => {
    const changes = [...(o.changes ?? [])].filter((label) => quantities.has(canonicalLabel(label)));
    const interventions = (o.interventions ?? []).filter((i) => {
      if (i.provenance === 'explicit' && quantities.has(canonicalLabel(i.factor_label))) return true;
      propose('value', `${o.label}: ${i.factor_label}`, `options[${o.label}].interventions[${i.factor_label}]`, i, 'This option setting was not supplied by the user.');
      // Keep a qualitative mapping only to an independently retained quantity, never manufacture a factor for a guess.
      if (quantities.has(canonicalLabel(i.factor_label)) && !changes.includes(i.factor_label)) changes.push(i.factor_label);
      return false;
    });
    return { ...o, interventions, changes };
  });
  const identities = (candidate.identities ?? []).filter((i) => {
    if (i.provenance !== 'ai_proposed' && quantities.has(canonicalLabel(i.outcome)) && i.factors.every((label) => quantities.has(canonicalLabel(label)))) return true;
    propose('definition', i.outcome, `identities[${i.outcome}]`, i, 'This definition depends on modelling additions outside the user model.');
    return false;
  });
  const entities = new Set([...quantities, ...keptOptions.map((o) => canonicalLabel(o.label))]);
  const links = candidate.links.flatMap((l) => {
    const definition = identities.some((i) => canonicalLabel(i.outcome) === canonicalLabel(l.to) && i.factors.some((f) => canonicalLabel(f) === canonicalLabel(l.from)));
    if (!entities.has(canonicalLabel(l.from)) || !entities.has(canonicalLabel(l.to)) || (l.provenance !== 'explicit' && !definition)) {
      propose('relationship', `${l.from} → ${l.to}`, `links[${l.from}->${l.to}]`, l, 'This relationship needs adoption; no guessed mechanism is added for connectivity.');
      return [];
    }
    if ((l.effect_provenance ?? l.provenance) === 'explicit') return [l];
    if ([l.effect_amount, l.effect_per_source_change, l.strength_mean, l.strength_std, l.existence_probability].some((v) => typeof v === 'number')) {
      propose('value', `${l.from} → ${l.to}`, `links[${l.from}->${l.to}].magnitude`, l, 'The user has not supplied this relationship size.');
    }
    return [{ ...l, effect_amount: null, effect_per_source_change: null, effect_provenance: null, strength_mean: undefined, strength_std: undefined, existence_probability: undefined }];
  });
  const goal = { ...candidate.goal };
  if (!(goal.baseline_known === true && (goal.baseline_provenance ?? goal.provenance) === 'explicit')) {
    if (typeof goal.baseline_value === 'number') propose('value', goal.metric, 'goal.baseline_value', { value: goal.baseline_value, unit: goal.unit }, 'The user has not supplied this current level.');
    goal.baseline_known = false; goal.baseline_value = null;
  }
  if (goal.provenance !== 'explicit' && typeof goal.value === 'number') {
    propose('value', goal.metric, 'goal.value', { value: goal.value, unit: goal.unit }, 'The user has not supplied this target.');
    goal.value = null; goal.target_stated = false;
  }
  // The drafter's free text can still describe discarded guesses as active assumptions.
  // M1 keeps the existing structured scope/limit/deadline questions, plus unmapped user options.
  const sourceUnknowns = (candidate as CandidateModel & { readonly unknowns?: readonly string[] }).unknowns ?? [];
  const scopeQuestions = candidate.goal.scope?.stated_in_brief === false
    ? sourceUnknowns.filter((q) => q.includes(candidate.goal.metric) && /scope|plans?|revenue/i.test(q) && !/provision|estimat|assum/i.test(q))
    : [];
  const unknowns = [...scopeQuestions, ...keptOptions
    .filter((o) => (o.interventions ?? []).length === 0 && (o.changes ?? []).length === 0 && o.is_status_quo !== true)
    .map((o) => `What change should "${o.label}" make in the model?`)];
  const model = { ...candidate, goal, constraints, options: keptOptions, factors, risks, outcomes, links, identities, unknowns };
  return { candidate: model, proposals, placeholders, option_quotes };
}
