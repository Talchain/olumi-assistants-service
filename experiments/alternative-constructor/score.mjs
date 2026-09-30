/** Independent, provider-free semantic scorer. It never imports a constructor or admission helper. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const manifest = JSON.parse(readFileSync(new URL('./four-cases.json', import.meta.url), 'utf8'));
const USER = new Set(['user', 'user_set', 'from_brief', 'explicit', 'brief_extraction', 'user_specified']);
const matches = (pattern, text) => new RegExp(pattern, 'i').test(String(text ?? ''));
// Descriptions can contain source quotes naming other entities; they are not entity identity.
const label = (n) => [n?.label, n?.id].filter(Boolean).join(' ');
const numberEqual = (a, b) => typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= 1e-7;
const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
export function unitMatches(wanted, actual) {
  const u = String(actual ?? '').toLowerCase().replaceAll('/', ' per ');
  if (wanted === 'GBP') return /^(£|gbp|pounds?)$/.test(u.trim());
  if (wanted.startsWith('GBP/')) {
    const period = wanted.endsWith('month') ? /month|monthly|\bmo\b/ : /year|annual|annum|\byr\b/;
    return /£|\bgbp\b|pound/.test(u) && period.test(u);
  }
  if (wanted === 'percent') return /%|percent|pct|percentage/.test(u);
  if (wanted === 'weeks') return /\bweeks?\b/.test(u);
  const [object, period] = wanted.slice('count:'.length).split('/');
  const singular = object.replace(/s$/, '');
  return new RegExp(`\\b${singular}s?\\b`, 'i').test(u) && (!period || new RegExp(period, 'i').test(u));
}
function quotesOf(value) {
  if (!value || typeof value !== 'object') return [];
  const out = [];
  for (const [key, child] of Object.entries(value)) {
    if (['source_quote', 'quote', 'exact_quote'].includes(key) && typeof child === 'string') out.push(child);
    if (child && typeof child === 'object' && /source|provenance|citation|evidence|binding|lineage/.test(key)) {
      for (const item of Array.isArray(child) ? child : [child]) out.push(...quotesOf(item));
    }
  }
  return out;
}
function sourceResult(objects, fact, brief) {
  const quotes = objects.flatMap(quotesOf);
  const valid = quotes.filter((q) => brief.text.includes(q));
  // A whole-brief quote is not specific enough to prove a claim. This also rejects a number found in another item.
  const bound = valid.some((q) => {
    if (!(q !== brief.text && (q.includes(fact.quote) || fact.quote.includes(q)) && q.length >= 5)) return false;
    const occurrences = brief.text.split(q).length - 1;
    if (occurrences === 1) return true;
    // Repeated text needs an exact span identifying this occurrence, not just a matching quote.
    const spans = objects.flatMap((o) => [o?.source_span, o?.source, ...(Array.isArray(o?.sources) ? o.sources : [])]).filter(Boolean);
    return spans.some((span) => Number.isInteger(span.start) && Number.isInteger(span.end) && brief.text.slice(span.start, span.end) === q && span.start >= fact.source_span.start && span.end <= fact.source_span.end);
  });
  return { bound, quoted: quotes.length > 0, invalid_quotes: quotes.filter((q) => !brief.text.includes(q)) };
}
function observations(graph) {
  const nodes = graph.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = [];
  for (const n of nodes) {
    const state = n.observed_state ?? {};
    if (typeof state.raw_value === 'number') out.push({ node: n, owner: n, entity: label(n), role: 'current', value: state.raw_value, unit: state.unit, sources: [state, n], user: USER.has(state.source), frame: 'level' });
    if (typeof n.goal_threshold_raw === 'number') out.push({ node: n, owner: n, entity: label(n), role: n.goal_threshold_frame === 'change_rel' ? 'relative_change' : n.goal_threshold_frame === 'change_abs' ? 'absolute_change' : 'target', value: n.goal_threshold_raw, unit: n.goal_threshold_unit, operator: n.goal_operator_as_stated ?? n.goal_direction, sources: [n], user: USER.has(n.threshold_source) || USER.has(n.provenance), frame: n.goal_threshold_frame });
    for (const [fid, iv] of Object.entries(n.interventions ?? n.data?.interventions ?? {})) {
      if (typeof iv !== 'object' || iv === null) continue;
      out.push({ node: byId.get(fid) ?? {}, owner: n, entity: label(byId.get(fid)), role: 'intervention', value: iv.raw_value, unit: iv.unit, sources: [iv, n], user: USER.has(iv.source), target_exists: byId.has(fid) });
    }
  }
  for (const c of graph.goal_constraints ?? []) out.push({ node: byId.get(c.node_id) ?? {}, owner: c, entity: label(byId.get(c.node_id)) || c.label, role: 'limit', value: c.value, unit: c.unit, operator: c.operator_as_stated ?? c.operator, sources: [c], user: USER.has(c.provenance), frame: c.value_frame, target_exists: byId.has(c.node_id) });
  return out;
}
function cloudRelativeBinding(record, brief, graph, obs) {
  if (brief.id !== 'cloud') return { applicable: false, verified: false, status: 'not_applicable', redundant_question: false };
  const currentFact = brief.facts.find((fact) => fact.id === 'spend-current');
  const targetFact = brief.facts.find((fact) => fact.id === 'cost-reduction');
  const currentObservations = obs.filter((item) => item.role === 'current'
    && matches(currentFact.entity, item.entity) && numberEqual(item.value, currentFact.value)
    && unitMatches(currentFact.unit, item.unit)
    && sourceResult(item.sources, currentFact, brief).bound);
  const currentIds = [...new Set(currentObservations.map((item) => item.node.id))];
  const targetObservations = obs.filter((item) => item.role === 'relative_change'
    && matches(targetFact.entity, item.entity) && numberEqual(item.value, targetFact.value)
    && unitMatches(targetFact.unit, item.unit)
    && sourceResult(item.sources, targetFact, brief).bound);
  // A text-only target is still evidence of the provider's metric reference;
  // it does not earn numeric-target credit or license a label-based merge.
  const pendingGoals = (graph.nodes ?? []).filter((node) => node.kind === 'goal'
    && matches(targetFact.entity, label(node)) && sourceResult([node], targetFact, brief).bound);
  const targetIds = [...new Set((targetObservations.length ? targetObservations.map((item) => item.node.id)
    : pendingGoals.map((node) => node.id)))];
  const shared = currentIds.length === 1 && targetIds.length === 1 && currentIds[0] === targetIds[0];
  const verified = shared && targetObservations.length > 0;
  const status = currentIds.length !== 1 ? 'current_missing_or_ambiguous'
    : targetIds.length !== 1 ? 'target_missing_or_ambiguous'
      : verified ? 'source_bound_shared_reference'
        : shared ? 'pending_on_shared_reference' : 'split_references';
  const questions = [record.assistant_text, ...(record.questions ?? []),
    ...(record.constructor_diagnostics?.unresolved ?? []).map((finding) => finding.question)]
    .map((question) => typeof question === 'string' ? question : question?.question ?? '')
    .filter(Boolean);
  const redundant_question = currentIds.length === 1 && targetIds.length === 1
    && questions.some((question) => /\b(?:what|which)\b.{0,100}\b(?:current|today|baseline)\b.{0,100}\b(?:quantity|value|level|amount|unit|spend|cost)\b/i.test(question));
  return { applicable: true, verified, status, current_ref: currentIds[0] ?? null,
    target_ref: targetIds[0] ?? null, redundant_question };
}
function initialRecoveryScore(record, brief, graph, facts, optionRows, failures, relativeBinding, sizedWithoutUserEvidence) {
  // This scores whether the saved first output preserves the source and asks a
  // useful, truthful clarification. A recovery answer in the manifest is sealed gold;
  // it is never treated as a reply that the constructor has actually processed.
  const check = (id, passed) => ({ id, passed: Boolean(passed) });
  const count = (checks) => ({ passed: checks.filter((item) => item.passed).length, total: checks.length, checks });
  const hasFailure = (kind) => failures.some((failure) => failure.kind === kind);
  const fidelity = [
    ...facts.map((fact) => check(`fact:${fact.id}`, fact.retained && fact.source_bound)),
    ...optionRows.map((option) => check(`option:${option.id}`, option.retained && option.source_bound)),
  ];
  if (brief.horizon_months) fidelity.push(check('stated_horizon', !hasFailure('goal_horizon_lost')));
  if (brief.deadline_quote) fidelity.push(check('stated_deadline', !hasFailure('deadline_lost')));
  for (const limit of brief.qualitative_limits ?? []) fidelity.push(check(`qualitative_limit:${limit}`, !hasFailure('qualitative_limit_lost')));
  if (relativeBinding.applicable) fidelity.push(check('current_and_relative_goal_same_source_metric', relativeBinding.verified));

  const questions = [...new Set([...(record.questions ?? []), ...(record.constructor_diagnostics?.unresolved?.map((item) => item.question) ?? [])]
    .map((item) => typeof item === 'string' ? item : item?.question ?? item?.message ?? '')
    .map((item) => item.trim()).filter(Boolean))];
  const questionText = questions.join(' ');
  const visibleText = `${questionText} ${record.assistant_text ?? ''}`;
  const redundant = questions.filter((question) => {
    if (brief.id === 'paul-mrr') return /(?:\b(?:what|how much|provide|tell me)\b.{0,100}\b(?:current|today|baseline|existing)\b.{0,80}\b(?:MRR|monthly recurring revenue)\b|\b(?:what|how much)\b.{0,100}\b(?:MRR|monthly recurring revenue)\b.{0,40}\b(?:current|today|baseline|existing)\b|\bwhat is (?:our |your |the )?(?:MRR|monthly recurring revenue)\b)/i.test(question);
    if (brief.id === 'cloud') return /\b(?:what|which|provide|tell me)\b.{0,100}\b(?:current|today|baseline|existing)\b.{0,100}\b(?:quantity|value|level|amount|unit|spend|cost)\b/i.test(question);
    return false;
  });
  const nodes = graph.nodes ?? [];
  const allProAssumed = brief.id === 'paul-mrr' && (
    nodes.some((node) => node.observed_state?.raw_value === 1500 && /\bpro\b/i.test(label(node)))
    || nodes.some((node) => node.nonlinear_identity?.operation === 'product'
      && (node.nonlinear_identity.factor_ids ?? []).some((id) => {
        const factor = nodes.find((candidate) => candidate.id === id);
        return factor?.observed_state?.raw_value === 1500 && /subscriber|customer/i.test(label(factor));
      }))
  );
  const unsupportedNumber = failures.some((failure) => ['invented_or_misassigned_user_number', 'unstated_canonical_number', 'known_fabrication'].includes(failure.kind));
  const unsupportedEffect = sizedWithoutUserEvidence.length > 0;
  const noUnstatedClaim = !allProAssumed && !unsupportedNumber && !unsupportedEffect && !hasFailure('identity_applied_before_scope_resolved');
  const needed = {
    'paul-mrr': /(?:\bMRR\b.{0,110}\b(?:Pro|all plans|same|scope|population)\b|\b(?:Pro|all plans|scope|population)\b.{0,110}\bMRR\b)/i,
    cloud: /(?:\bGCP\b.{0,110}\b(?:cost|bill|spend|saving|price)\b|\b(?:cost|bill|spend|saving|price)\b.{0,110}\bGCP\b)/i,
    E: /(?:\b(?:senior|junior)\b.{0,110}\b(?:salar(?:y|ies)|cost|capacity|delivery|productivity)\b|\b(?:salar(?:y|ies)|cost|capacity|delivery|productivity)\b.{0,110}\b(?:senior|junior)\b)/i,
    support: /(?:\b(?:chat|live chat)\b.{0,110}\b(?:CSAT|satisfaction|effect|capacity|concurrency)\b|\b(?:CSAT|satisfaction|effect|capacity|concurrency)\b.{0,110}\b(?:chat|live chat)\b)/i,
  }[brief.id];
  const targetedQuestion = questions.some((question) => needed.test(question)
    && /\?|\b(?:ask|provide|confirm|clarify|tell me|validate)\b/i.test(question));
  const uncertaintyExposed = needed.test(visibleText);
  const withholding = [
    check('no_unstated_scope_or_causal_claim', noUnstatedClaim),
    check('missing_evidence_surfaced', uncertaintyExposed),
  ];
  const clarification = [
    check('asks_for_decisive_missing_input', targetedQuestion),
    check('one_nonredundant_question', targetedQuestion && questions.length === 1 && redundant.length === 0),
  ];
  const dimensions = { fidelity: count(fidelity), truthful_withholding: count(withholding), smallest_useful_clarification: count(clarification) };
  return {
    basis: 'saved_initial_output_only',
    dimensions,
    total: { passed: Object.values(dimensions).reduce((sum, part) => sum + part.passed, 0),
      possible: Object.values(dimensions).reduce((sum, part) => sum + part.total, 0) },
    question_count: questions.length, redundant_questions: redundant,
    unsupported_scope_assumption: allProAssumed, unsupported_numeric_claim: unsupportedNumber,
    unsupported_sized_causal_edges: sizedWithoutUserEvidence.length,
    correct_initial_response: Object.values(dimensions).every((part) => part.passed === part.total),
    withholding_status: noUnstatedClaim ? (uncertaintyExposed ? 'truthful_missing_evidence_exposed' : 'truthful_but_missing_evidence_not_exposed') : 'unsupported_claims_present',
  };
}
export function scoreRecord(record, cases = manifest.briefs) {
  const brief = cases.find((b) => b.id === record.brief);
  if (!brief) throw new Error(`Unknown case ${record.brief}; no silent fallback scoring`);
  if (hash(brief.text) !== brief.source_sha256) throw new Error(`Frozen source bytes changed: ${brief.id}`);
  if (record.source_sha256 && record.source_sha256 !== brief.source_sha256) throw new Error(`Record source differs: ${brief.id}`);
  const graph = record.canonical_graph ?? record.graph ?? { nodes: [], edges: [] };
  const obs = observations(graph);
  const failures = [];
  const facts = brief.facts.map((f) => {
    const semantic = obs.filter((o) => o.role === f.role && matches(f.entity, o.entity) && (!f.option || matches(f.option, label(o.owner))));
    const value = semantic.filter((o) => numberEqual(o.value, f.value));
    const correct = value.filter((o) => unitMatches(f.unit, o.unit) && (!f.operator || o.operator === f.operator));
    const source = correct.map((o) => sourceResult(o.sources, f, brief));
    const retained = correct.length > 0;
    if (!retained) failures.push({ kind: 'omission_or_semantic_error', fact: f.id, expected: { role: f.role, value: f.value, unit: f.unit, operator: f.operator }, observed: semantic.map(({ role, value, unit, operator }) => ({ role, value, unit, operator })) });
    if (retained && !source.some((s) => s.bound)) failures.push({ kind: 'source_unbound', fact: f.id });
    return { id: f.id, retained, source_bound: source.some((s) => s.bound), invalid_quotes: source.flatMap((s) => s.invalid_quotes) };
  });
  // A supplied addition with no known baseline can survive as a typed pending claim.
  // It is deliberately not credited as a canonical absolute intervention or a proved recovery journey.
  const pending = record.constructor_diagnostics?.additions_without_total ?? record.additions_without_total ?? record.pending_user_changes ?? record.result?.additions_without_total;
  const pendingFacts = brief.facts.filter((f) => f.role === 'intervention').map((f) => {
    const found = (Array.isArray(pending) ? pending : []).filter((p) => matches(f.entity, p.factor) && (!f.option || matches(f.option, p.option)) && numberEqual(p.value, f.value) && unitMatches(f.unit, p.unit ?? p.factor_unit) && typeof p.reason === 'string');
    return { id: f.id, retained_pending: found.length > 0, canonical_retained: facts.find((x) => x.id === f.id)?.retained === true, reasons: found.map((p) => p.reason) };
  });
  for (const target of brief.facts.filter((f) => ['target', 'relative_change', 'absolute_change'].includes(f.role))) {
    const current = brief.facts.find((f) => f.role === 'current' && f.entity === target.entity);
    if (!current) continue;
    const currentNodes = obs.filter((o) => o.role === 'current' && matches(current.entity, o.entity) && numberEqual(o.value, current.value) && unitMatches(current.unit, o.unit)).map((o) => o.node.id);
    const targetNodes = obs.filter((o) => o.role === target.role && matches(target.entity, o.entity) && numberEqual(o.value, target.value) && unitMatches(target.unit, o.unit)).map((o) => o.node.id);
    if (currentNodes.length && targetNodes.length && !currentNodes.some((id) => targetNodes.includes(id))) failures.push({ kind: 'current_target_different_quantity', current: current.id, target: target.id });
  }
  const relativeBinding = cloudRelativeBinding(record, brief, graph, obs);
  if (relativeBinding.status === 'split_references' && !failures.some((failure) => failure.kind === 'current_target_different_quantity')) {
    failures.push({ kind: 'relative_target_split_from_current', current: 'spend-current', target: 'cost-reduction' });
  }
  if (relativeBinding.redundant_question) failures.push({ kind: 'redundant_current_quantity_question', fact: 'spend-current' });
  const goalNodes = (graph.nodes ?? []).filter((n) => n.kind === 'goal');
  if (brief.horizon_months && !goalNodes.some((n) => n.goal_horizon_months === brief.horizon_months)) failures.push({ kind: 'goal_horizon_lost', expected_months: brief.horizon_months });
  if (brief.deadline_quote && !goalNodes.some((n) => n.goal_deadline_as_stated === brief.deadline_quote)) failures.push({ kind: 'deadline_lost', expected: brief.deadline_quote });
  for (const text of brief.qualitative_limits ?? []) {
    // No-new-hires is not a cap on total staff. Keep this literal limit distinct
    // from any numerical staffing rewrite, even when that rewrite is labelled user.
    const held = (graph.goal_constraints ?? []).some((c) => typeof c.value !== 'number'
      && String(c.label ?? '').toLowerCase().includes(text.toLowerCase())
      && quotesOf(c).some((quote) => brief.text.includes(quote) && quote.includes(text)));
    if (!held) failures.push({ kind: 'qualitative_limit_lost', expected: text });
  }
  const options = (graph.nodes ?? []).filter((n) => n.kind === 'option');
  // A matching action label or copied source quote cannot substitute a different
  // numeric action for a listed option. Keep this check independent of admission.
  const matchesExpectedOption = (option, expected) => {
    if (!matches(expected.pattern, label(option))) return false;
    const expectedActions = brief.facts.filter((f) => f.role === 'intervention' && f.option && matches(f.option, `${expected.id} ${expected.pattern}`));
    return expectedActions.every((f) => !obs.some((o) => o.owner === option && o.role === 'intervention' && matches(f.entity, o.entity) && typeof o.value === 'number' && (!numberEqual(o.value, f.value) || !unitMatches(f.unit, o.unit))));
  };
  const optionRows = brief.options.map((expected) => {
    const found = options.filter((o) => matchesExpectedOption(o, expected) && USER.has(o.provenance) && o.proposed_by !== 'olumi' && o.ownership !== 'proposed');
    if (!found.length) failures.push({ kind: 'user_option_lost_or_reclassified', option: expected.id });
    const sourceBound = found.some((o) => sourceResult([o], expected, brief).bound);
    if (found.length && !sourceBound) failures.push({ kind: 'option_source_unbound', option: expected.id });
    return { id: expected.id, retained: found.length > 0, label_retained: options.some((o) => matches(expected.pattern, label(o))), source_bound: sourceBound };
  });
  // An invented numeric claim is a failure even when its number appears elsewhere in the brief.
  for (const o of obs.filter((o) => o.user)) {
    const faithful = brief.facts.some((f) => matches(f.entity, o.entity) && f.role === o.role && numberEqual(f.value, o.value) && unitMatches(f.unit, o.unit) && (!f.option || matches(f.option, label(o.owner))));
    // A baseline option's explicit value may repeat the corresponding current value.
    const repeatedBaseline = o.role === 'intervention' && o.owner.is_baseline === true && brief.facts.some((f) => f.role === 'current' && matches(f.entity, o.entity) && numberEqual(f.value, o.value) && unitMatches(f.unit, o.unit));
    if (!faithful && !repeatedBaseline) failures.push({ kind: 'invented_or_misassigned_user_number', entity: o.entity, role: o.role, value: o.value, unit: o.unit });
  }
  // M1 fidelity is stricter than truthful labelling: an honestly labelled invention still changes the user's model.
  for (const o of obs.filter((o) => !o.user && typeof o.value === 'number')) {
    const stated = brief.facts.some((f) => matches(f.entity, o.entity) && f.role === o.role && numberEqual(f.value, o.value) && unitMatches(f.unit, o.unit) && (!f.option || matches(f.option, label(o.owner))));
    const baseline = o.role === 'intervention' && o.owner.is_baseline === true && brief.facts.some((f) => f.role === 'current' && matches(f.entity, o.entity) && numberEqual(f.value, o.value) && unitMatches(f.unit, o.unit));
    if (!stated && !baseline) failures.push({ kind: 'unstated_canonical_number', entity: o.entity, role: o.role, value: o.value, unit: o.unit, ownership: 'labelled_olumi_or_unspecified' });
  }
  for (const n of (graph.nodes ?? []).filter((n) => ['factor', 'risk', 'outcome'].includes(n.kind))) {
    const supportedFact = obs.some((o) => o.node.id === n.id && brief.facts.some((f) => matches(f.entity, o.entity) && f.role === o.role && numberEqual(f.value, o.value) && unitMatches(f.unit, o.unit)));
    const text = String(n.label ?? '').trim();
    const literalSubject = text.length >= 5 && brief.text.toLowerCase().includes(text.toLowerCase());
    const sourceBound = quotesOf(n).some((q) => q.length >= 5 && q.length < brief.text.length && brief.text.includes(q));
    if (!supportedFact && !literalSubject && !sourceBound) failures.push({ kind: 'unstated_canonical_entity', entity: n.id, label: n.label, node_kind: n.kind, ownership: n.provenance ?? 'unspecified' });
  }
  for (const o of options) {
    const known = brief.options.some((e) => matchesExpectedOption(o, e)) || o.is_baseline === true;
    if (!known || o.proposed_by === 'olumi' || o.ownership === 'proposed') failures.push({ kind: 'unstated_canonical_option', option: o.id, label: o.label, ownership: o.proposed_by ?? o.provenance ?? 'unspecified' });
    if (!known && o.proposed_by !== 'olumi' && (USER.has(o.provenance) || quotesOf(o).length > 0)) failures.push({ kind: 'invented_user_option', option: o.id });
  }
  const proposals = options.filter((o) => o.proposed_by === 'olumi' || o.ownership === 'proposed');
  const outsideProposals = record.proposals ?? record.constructor_diagnostics?.constructor_proposals ?? record.constructor_diagnostics?.proposals ?? [];
  // A typed mark is better than false ownership, but remains distinct from keeping proposals out of canonical truth.
  const authority = { canonical_proposals: proposals.map((o) => o.id), external_proposals: outsideProposals.length, proposals_outside_model: proposals.length === 0 };
  for (const o of proposals) failures.push({ kind: 'proposal_in_canonical_model', option: o.id });
  const ids = new Set((graph.nodes ?? []).map((n) => n.id));
  for (const e of graph.edges ?? []) if (!ids.has(e.from) || !ids.has(e.to)) failures.push({ kind: 'dangling_edge', from: e.from, to: e.to });
  for (const o of obs) if (o.target_exists === false) failures.push({ kind: 'dangling_target', entity: o.entity });
  let identity = { applicable: false };
  if (brief.identity) {
    const definition = brief.identity;
    const nodes = graph.nodes ?? [];
    const declared = nodes.filter((n) => n.nonlinear_identity?.operation === definition.operation);
    const correct = declared.filter((n) => n.kind === 'goal' && matches(definition.target, label(n)) && definition.factors.every((f) => (n.nonlinear_identity.factor_ids ?? []).some((id) => matches(f, label(nodes.find((x) => x.id === id))))));
    const clarifications = [record.assistant_text, ...(record.questions ?? []).map((x) => typeof x === 'string' ? x : x.question ?? x.message ?? ''), JSON.stringify(record.constructor_diagnostics?.questions ?? [])].join(' ');
    const conflictRaised = matches(definition.clarification_pattern, clarifications);
    identity = { applicable: true, on_correct_target: correct.length > 0, other_carriers: declared.filter((n) => !correct.includes(n)).map((n) => n.id), conflicting_brief_values: definition.conflicting_current_values, conflict_raised: conflictRaised };
    if (declared.length && !correct.length) failures.push({ kind: 'identity_wrong_target', carriers: declared.map((n) => n.id) });
    // Asking about scope is not resolving scope. This frozen brief supplies conflicting totals;
    // a product cannot be attached as canonical identity until a later, separately evidenced answer.
    if (definition.conflicting_current_values && correct.length) failures.push({ kind: 'identity_applied_before_scope_resolved', scope_question_present: conflictRaised });
    if (!declared.length && !conflictRaised) failures.push({ kind: 'identity_or_scope_question_missing' });
    for (const n of declared) if (n.nonlinear_identity.stated_in_brief === true) failures.push({ kind: 'inferred_identity_stamped_user', node: n.id });
  }
  const causalEdges = (graph.edges ?? []).filter((e) => {
    if (['decision', 'option'].includes(graph.nodes?.find((n) => n.id === e.from)?.kind)) return false;
    const target = graph.nodes?.find((n) => n.id === e.to);
    // Compiler carrier links express an admitted definition, not an extra estimated causal coefficient.
    return !(target?.nonlinear_identity?.factor_ids ?? []).includes(e.from);
  });
  // None of the frozen four briefs states a numeric causal effect. A source label
  // alone cannot make a salary/effect coefficient user evidence. A placeholder
  // with a natural effect still asserts a numeric relationship.
  const sizedWithoutUserEvidence = causalEdges.filter((e) => e.strength
    && (e.provenance?.magnitude !== 'olumi_placeholder' || e.provenance?.natural_effect));
  const forbidden = obs.filter((o) => o.user && (brief.forbidden_user_numbers ?? []).some((v) => numberEqual(v, o.value)));
  for (const o of forbidden) failures.push({ kind: 'known_fabrication', entity: o.entity, value: o.value });
  const modelPresent = (graph.nodes ?? []).length > 0;
  const initialResponseScore = initialRecoveryScore(record, brief, graph, facts, optionRows, failures, relativeBinding, sizedWithoutUserEvidence);
  return {
    arm: record.arm ?? record.label, brief: brief.id, rep: record.rep, evidence_level: record.evidence_level ?? 'admitted_registration_payload_only',
    model_present: modelPresent, facts, options: optionRows, identity, authority,
    fidelity: { facts_retained: facts.filter((f) => f.retained).length, facts_total: facts.length, source_bound: facts.filter((f) => f.source_bound).length, user_options_retained: optionRows.filter((o) => o.retained).length, user_options_total: optionRows.length, user_options_source_bound: optionRows.filter((o) => o.source_bound).length, relative_target_same_metric_bound: relativeBinding.verified ? 1 : 0, relative_target_same_metric_total: relativeBinding.applicable ? 1 : 0, relative_target_binding: relativeBinding, negative_findings: failures.length, false_user_claims: failures.filter((f) => ['invented_or_misassigned_user_number', 'invented_user_option', 'inferred_identity_stamped_user'].includes(f.kind)).length, unstated_canonical_content: failures.filter((f) => f.kind.startsWith('unstated_canonical_')).length, source_binding_failures: failures.filter((f) => ['source_unbound', 'option_source_unbound'].includes(f.kind)).length, failures },
    scientific_usability: { verified_analysis: record.evidence_level === 'shared_spine_journey' && record.analysis_verified === true, inferred_sized_edges: sizedWithoutUserEvidence.length, identity, unsupported_relationships: record.constructor_diagnostics?.unknown_relationships ?? null },
    complexity: { nodes: graph.nodes?.length ?? 0, edges: graph.edges?.length ?? 0, provider_attempts: record.provider_calls?.length ?? record.structured_raw?.length ?? null, transforms: record.constructor_diagnostics?.transforms ?? null },
    recovery: { pending_evidence_available: Array.isArray(pending), facts: pendingFacts, retained_pending_only: pendingFacts.filter((f) => f.retained_pending && !f.canonical_retained).length, continuation_verified: record.recovery_verified === true, initial_response_score: initialResponseScore },
    experience: { construction_ms: record.ms ?? null, clarification: record.questions ?? null, recovery_verified: record.recovery_verified === true, user_quality_question: 'Does this model make the decision easier to understand and improve?', user_quality_score: record.user_quality_score ?? null, user_quality_scored_by: record.user_quality_scored_by ?? null },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node experiments/alternative-constructor/score.mjs <records.jsonl>');
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) console.log(JSON.stringify(scoreRecord(JSON.parse(line))));
}
