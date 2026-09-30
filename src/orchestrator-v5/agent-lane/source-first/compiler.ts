import { createHash } from 'node:crypto';
import { GraphV3, type GraphV3T, type NodeV3T, type EdgeV3T } from '../../../schemas/cee-v3.js';
import type { GoalConstraintT } from '../../../schemas/assist.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';
import { resolveGoalThresholdCapWithProvenance } from '../../../utils/goal-threshold-cap.js';
// A pure numeric encoding helper, not the CandidateModel admission/repair chain.
import { defaultFrameFor } from '../admit-model.js';
import { SourceMeaningSchema, type SourceMeaning, type SourceQuantity } from './meaning.js';
import { bindSource, readNumber, quantityProblem, unitText, compatibleUnits, type BoundSource } from './source-binding.js';

export interface SourceFinding {
  ref: string;
  code: string;
  question: string;
}
export interface SourceFirstCompilation {
  graph: GraphV3T;
  open_questions: string[];
  unresolved: SourceFinding[];
  proposals: SourceMeaning['proposals'];
  source_bindings: Record<string, BoundSource>;
  reference_ids: Record<string, string>;
  /** No semantic repairs are performed. Every unrepresented claim is explicit. */
  loss: SourceFinding[];
  trace: { architecture: 'source_first'; transforms: number; repairs: number; retries: number;
    source_offset_corrections: number; level_direction_annotations_ignored: number; projected_option_quantities: number };
}

export function sourceEntityId(ref: string): string {
  return `sf_${createHash('sha256').update(ref).digest('hex').slice(0, 20)}`;
}

const spanWithin = (inner: BoundSource, outer: BoundSource): boolean =>
  outer.start <= inner.start && inner.end <= outer.end;
const spansOverlap = (left: BoundSource, right: BoundSource): boolean =>
  left.start < right.end && right.start < left.end;
function namesBoundTarget(label: string, target: BoundSource, action: BoundSource): boolean {
  const words = label.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const phrases = words.length === 1 ? words : words.slice(1).map((word, index) => `${words[index]} ${word}`);
  return phrases.some((phrase) => phrase.length >= 4
    && target.quote.toLowerCase().includes(phrase) && action.quote.toLowerCase().includes(phrase));
}

/** Keep a quarter deadline verbatim when the goal's own bound source states one. */
function statedQuarterDeadline(quote: string): string | undefined {
  const matches = [...quote.matchAll(/\b(?:by|before)\s+(?:the\s+end\s+of\s+)?Q[1-4]\b/gi)]
    .filter((match) => !/\b(?:not|never|cannot|can't)\s*$/i.test(quote.slice(0, match.index)));
  return matches.length === 1 ? matches[0][0] : undefined;
}

/** Compile validated meaning once. Never repair meaning by label or invent values. */
export function compileSourceMeaning(brief: string, input: unknown): SourceFirstCompilation {
  const meaning = SourceMeaningSchema.parse(input);
  const unresolved: SourceFinding[] = [];
  const source_bindings: Record<string, BoundSource> = {};
  const reference_ids: Record<string, string> = {};
  const nodes = new Map<string, NodeV3T>();
  const entities = new Map(meaning.entities.map((entity) => [entity.ref, entity]));
  const edges: EdgeV3T[] = [];
  const constraints: GoalConstraintT[] = [];
  let projectedOptionQuantities = 0;
  const accepted = new Map<string, { claim: SourceQuantity; value: number }>();
  const issue = (ref: string, code: string, question: string): void => {
    if (!unresolved.some((item) => item.ref === ref && item.code === code)) unresolved.push({ ref, code, question });
  };
  const allRefs = [...meaning.entities, ...meaning.quantities, ...meaning.definitions, ...meaning.causal_claims, ...meaning.unknowns, ...meaning.proposals].map((item) => item.ref);
  const duplicates = new Set(allRefs.filter((ref, index) => allRefs.indexOf(ref) !== index));
  for (const ref of duplicates) issue(ref, 'duplicate_reference', `Which distinct item does "${ref}" refer to?`);
  for (const entity of meaning.entities) {
    if (duplicates.has(entity.ref)) continue;
    const source = bindSource(brief, entity.source);
    if (!source.ok) { issue(entity.ref, source.reason, `Which passage identifies "${entity.label}"?`); continue; }
    const id = sourceEntityId(entity.ref);
    const deadline = entity.kind === 'goal' ? statedQuarterDeadline(source.source.quote) : undefined;
    reference_ids[entity.ref] = id;
    source_bindings[entity.ref] = source.source;
    nodes.set(entity.ref, {
      id, kind: entity.kind, label: entity.label,
      source_quote: source.source.quote, provenance: 'from_brief',
      ...(deadline ? { goal_deadline_as_stated: deadline } : {}),
      ...(entity.label !== source.source.quote ? { label_authored: true } : {}),
      ...(entity.kind === 'factor' ? { category: 'external' as const } : {}),
    });
  }
  for (const claim of meaning.quantities) {
    if (duplicates.has(claim.ref)) continue;
    const entity = entities.get(claim.entity_ref);
    if (!entity || !nodes.has(claim.entity_ref)) {
      issue(claim.ref, 'unknown_entity_reference', `Which quantity does "${claim.number.literal}" describe?`); continue;
    }
    const number = readNumber(brief, claim.number);
    if (!number) { issue(claim.ref, 'number_not_grounded', `What does "${claim.number.literal}" mean for "${entity.label}"?`); continue; }
    const context = `${entity.source.quote}\n${claim.number.source.quote}`;
    const problem = quantityProblem(claim, context);
    if (problem) { issue(claim.ref, problem, `Is "${claim.number.literal}" the current level, a target, or a change for "${entity.label}"?`); continue; }
    source_bindings[claim.ref] = number.source;
    const value = claim.frame === 'level' ? number.value : claim.direction === 'decrease' ? -Math.abs(number.value)
      : claim.direction === 'increase' ? Math.abs(number.value) : number.value;
    accepted.set(claim.ref, { claim, value });
  }

  const claimsFor = (ref: string) => [...accepted.values()].filter(({ claim }) => claim.entity_ref === ref);
  for (const goal of meaning.entities.filter((entity) => entity.kind === 'goal' && nodes.has(entity.ref))) {
    for (const metric of meaning.entities.filter((entity) => entity.ref !== goal.ref && nodes.has(entity.ref)
      && entity.label.trim().toLowerCase() === goal.label.trim().toLowerCase())) {
      if (claimsFor(goal.ref).some(({ claim }) => claim.role === 'target')
        && claimsFor(metric.ref).some(({ claim }) => claim.role === 'current')) {
        issue(goal.ref, 'metric_scope_split', `Does the current "${metric.label}" describe the same quantity as the target "${goal.label}", or a different scope?`);
      }
    }
  }
  const frameOf = (node: NodeV3T) => node.scale_frame ?? node.goal_threshold_cap ?? 1;
  const goalQuantityRefs = new Set<string>();
  for (const [ref, node] of nodes) {
    const entityQuote = node.source_quote!;
    const held = claimsFor(ref);
    const currents = held.filter(({ claim }) => claim.role === 'current');
    const targets = held.filter(({ claim }) => claim.role === 'target'
      || (node.kind === 'goal' && claim.role === 'relative_change'));
    const levelUnits = held.filter(({ claim }) => claim.frame === 'level' && claim.role !== 'evidence');
    const unit = currents[0]?.claim.unit ?? levelUnits[0]?.claim.unit;
    if (unit && levelUnits.some(({ claim }) => !compatibleUnits(unit, claim.unit))) {
      issue(ref, 'incompatible_quantity_units', `Which unit and period should "${node.label}" use?`);
      for (const { claim } of held) accepted.delete(claim.ref);
      continue;
    }
    const max = Math.max(0, ...held.filter(({ claim }) => claim.frame === 'level').map(({ value }) => Math.abs(value)));
    if (held.length > 0) node.scale_frame = unit?.kind === 'percent' || unit?.kind === 'percentage_points' ? 100 : defaultFrameFor(max);
    if (targets.length === 1) {
      const { claim, value } = targets[0];
      if (node.kind !== 'goal') {
        issue(claim.ref, 'target_needs_goal_carrier', `Should "${node.label}" be the outcome to assess against this target?`);
      } else if (claim.frame === 'change_rel') {
        // Canonical relative targets store the signed fraction, while their
        // unit and baseline belong to the metric, never to the percentage.
        goalQuantityRefs.add(claim.ref);
        const current = currents.length === 1 ? currents[0] : undefined;
        if (!current) {
          issue(claim.ref, 'relative_goal_metric_unbound', `What current quantity and unit does the stated ${claim.number.literal} change in "${node.label}" apply to?`);
        } else {
          node.source_quote = claim.number.source.quote;
          node.goal_threshold_raw = value / 100;
          node.goal_threshold_frame = 'change_rel';
          if (claim.comparator && claim.comparator !== '=') node.goal_direction = claim.comparator;
          node.goal_threshold_unit = unitText(current.claim.unit);
          const targetLevel = current.value * (1 + value / 100);
          const cap = current.value > 0 && targetLevel >= 0
            ? resolveGoalThresholdCapWithProvenance(undefined, Math.max(current.value, targetLevel), unitText(current.claim.unit), undefined) : null;
          if (cap) {
            node.goal_threshold = value / 100;
            node.goal_threshold_cap = cap.cap;
            node.goal_threshold_cap_provenance = cap.provenance;
            node.scale_frame = cap.cap;
          } else issue(claim.ref, 'relative_goal_baseline_unusable', `What positive current level should the stated ${claim.number.literal} change in "${node.label}" be measured from?`);
        }
      } else {
        node.source_quote = claim.number.source.quote;
        node.goal_threshold_raw = value;
        node.goal_threshold_unit = unitText(claim.unit);
        node.goal_threshold_frame = claim.frame;
        if (claim.comparator && claim.comparator !== '=') node.goal_direction = claim.comparator;
        if (claim.horizon_months !== null) node.goal_horizon_months = claim.horizon_months;
        const cap = resolveGoalThresholdCapWithProvenance(undefined, value, claim.unit.kind === 'percent' ? '%' : unitText(claim.unit), undefined);
        if (cap) {
          node.goal_threshold = value / cap.cap;
          node.goal_threshold_cap = cap.cap;
          node.goal_threshold_cap_provenance = cap.provenance;
          // The node's current state and target use one numeric coordinate system.
          if (claim.frame === 'level') node.scale_frame = cap.cap;
        }
      }
      // The target's validated numeric claim, not the node's general quote,
      // authorises the field-level source marker read by the product.
      if (node.goal_threshold_raw !== undefined && source_bindings[claim.ref]) node.threshold_source = 'brief_extraction';
    } else if (targets.length > 1) issue(ref, 'multiple_targets', `Which target applies to "${node.label}"?`);
    if (currents.length === 1) {
      const { claim, value } = currents[0];
      node.observed_state = { value: value / frameOf(node), raw_value: value, unit: unitText(claim.unit), source: 'brief_extraction', extractionType: 'explicit', source_quote: claim.number.source.quote };
      if (node.kind === 'factor') node.category = 'observable';
    } else if (currents.length > 1) issue(ref, 'multiple_current_values', `Which stated current level applies to "${node.label}"?`);
    // Exact statements remain retrievable even when no canonical numeric role exists.
    const quotes = [...new Set(held.map(({ claim }) => claim.number.source.quote))];
    if (quotes.length > 0) node.description = [...new Set([entityQuote, ...quotes])].join('\n');
  }

  const structuralEdge = (from: NodeV3T, to: NodeV3T, reason: string, source: 'brief_extraction' | 'domain_knowledge' = 'brief_extraction'): void => {
    if (edges.some((edge) => edge.from === from.id && edge.to === to.id)) return;
    edges.push({ from: from.id, to: to.id, ...STRUCTURAL_EDGE_DEFAULTS,
      provenance: { source, reasoning: reason }, origin: 'structural' });
  };
  const decisions = meaning.entities.filter((entity) => entity.kind === 'decision');
  const explicitOptionRefs = [...new Set(meaning.options.map((option) => option.entity_ref))]
    .filter((ref) => nodes.get(ref)?.kind === 'option');
  if (decisions.length === 1) {
    const decision = nodes.get(decisions[0].ref);
    if (decision) for (const ref of explicitOptionRefs) {
      const option = nodes.get(ref)!;
      structuralEdge(decision, option, option.source_quote!);
    }
  } else if (decisions.length > 1) {
    for (const ref of explicitOptionRefs) issue(ref, 'decision_option_scope_ambiguous',
      `Which stated decision does "${nodes.get(ref)!.label}" answer?`);
  }
  const usedQuantityRefs = new Set<string>();
  for (const option of meaning.options) {
    const node = nodes.get(option.entity_ref);
    if (!node || node.kind !== 'option') {
      issue(option.entity_ref, 'option_reference_invalid', `Which stated option do these interventions belong to? "${node?.label ?? option.entity_ref}" was extracted as ${node?.kind ?? 'an unknown entity'}, not an option.`); continue;
    }
    if (option.is_status_quo) {
      if (/\b(keep|status quo|do nothing|unchanged|stay|remain|business as usual)\b/i.test(node.source_quote ?? '')) node.is_baseline = true;
      else issue(option.entity_ref, 'status_quo_not_grounded', `Does "${node.label}" keep the current position?`);
    }
    node.interventions = {};
    for (const intervention of option.interventions) {
      let target = nodes.get(intervention.entity_ref);
      let targetSource = source_bindings[intervention.entity_ref];
      const source = bindSource(brief, intervention.source);
      const quantity = intervention.quantity_ref === null ? undefined : accepted.get(intervention.quantity_ref);
      // A separately stated current level need not repeat inside the option.
      // A validated change explicitly referring to this target can bind it to
      // the action instead; a number assigned to another target cannot.
      if (quantity?.claim.entity_ref === intervention.entity_ref) targetSource = source_bindings[quantity.claim.ref];
      // The source IR already names a proposed count and its owning option.
      // GraphV3 needs separate nodes for the alternative and the quantity it
      // sets. Project that typed quantity; do not turn an option into a factor
      // or invent a current headcount, scientific relationship or magnitude.
      if (target === node && source.ok && quantity?.claim.entity_ref === option.entity_ref
        && quantity.claim.role === 'proposed_level' && quantity.claim.frame === 'level'
        && quantity.claim.unit.kind === 'count' && quantity.claim.unit.counted_object !== null) {
        const ownerSource = source_bindings[option.entity_ref];
        const numberSource = source_bindings[quantity.claim.ref];
        const counted = quantity.claim.unit.counted_object;
        const escaped = counted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sourceNamesCount = new RegExp(`\\b${escaped}\\b`, 'i').test(numberSource.quote);
        const literal = quantity.claim.number.literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const countPhrase = `${literal}\\s+${escaped}`;
        // A new-hire count is not total workforce headcount. Accept the direct
        // action or its immediately coordinated alternative ("hire X or Y").
        // Do not borrow "hire" from another sentence or from the display label.
        const prefix = brief.slice(0, numberSource.start);
        const directHire = new RegExp(`^hire\\s+${countPhrase}$`, 'i').test(numberSource.quote);
        const coordinatedHire = new RegExp(`^${countPhrase}$`, 'i').test(numberSource.quote)
          && /\bhire\s+(?:[\w,-]+\s+){1,6}or\s+$/i.test(prefix);
        const hireStart = directHire ? numberSource.start : prefix.search(/\bhire\s+(?:[\w,-]+\s+){1,6}or\s+$/i);
        const sourceNamesHiring = (directHire || coordinatedHire)
          && !/\b(?:not|never|without|avoid)\s*$/i.test(brief.slice(0, hireStart));
        const sourceOwnsClaim = ownerSource.start <= source.source.start && ownerSource.end >= source.source.end
          && source.source.start <= numberSource.start && source.source.end >= numberSource.end;
        const quantityRef = `option_quantity:${option.entity_ref}:${quantity.claim.ref}`;
        if (sourceNamesCount && sourceNamesHiring && sourceOwnsClaim && !allRefs.includes(quantityRef) && !nodes.has(quantityRef)) {
          target = {
            id: sourceEntityId(quantityRef), kind: 'factor', label: `${counted} to hire`,
            category: 'controllable', provenance: 'from_brief', source_quote: numberSource.quote,
            description: numberSource.quote, scale_frame: defaultFrameFor(quantity.value),
          };
          nodes.set(quantityRef, target);
          reference_ids[quantityRef] = target.id;
          source_bindings[quantityRef] = numberSource;
          targetSource = numberSource;
          projectedOptionQuantities++;
        }
      }
      if (!target || target.kind !== 'factor' || !source.ok) {
        issue(option.entity_ref, 'intervention_target_unresolved', `Which controllable quantity does "${node.label}" change?`); continue;
      }
      const optionSource = source_bindings[option.entity_ref];
      if (!spanWithin(source.source, optionSource)) {
        issue(option.entity_ref, 'intervention_option_source_mismatch', `Does this change belong to "${node.label}"?`); continue;
      }
      if (intervention.quantity_ref !== null) {
        if (!quantity || quantity.claim.entity_ref !== intervention.entity_ref
          || !['proposed_level', 'absolute_change', 'relative_change', ...(node.is_baseline ? ['current'] : [])].includes(quantity.claim.role)) {
          issue(intervention.quantity_ref, 'intervention_role_mismatch', `What level or change of "${target.label}" belongs to "${node.label}"?`); continue;
        }
        const numericSource = source_bindings[intervention.quantity_ref];
        if (!spanWithin(numericSource, source.source)) {
          issue(intervention.quantity_ref, 'intervention_quantity_source_mismatch', `Which stated figure belongs to "${node.label}"?`); continue;
        }
      }
      // A wide option quote can include a separate constraint sentence. The
      // constraint may be typed on a different ref for the same named concept;
      // its source role still cannot authorise an option action.
      if (intervention.quantity_ref === null && [...accepted.values()].some(({ claim }) =>
        claim.role === 'limit' && spansOverlap(source_bindings[claim.ref], source.source))) {
        issue(intervention.entity_ref, 'intervention_source_is_limit',
          `Does "${node.label}" change "${target.label}", or is this only its stated limit?`); continue;
      }
      // Qualitative interventions need an affirmative action in their own
      // bound clause; a shared noun in a broad option quote is not enough.
      if (intervention.quantity_ref === null && !/\b(?:add|adopt|build|change|cut|decrease|deploy|hire|increase|introduce|launch|lower|move|raise|reduce|remove|replace|shift|start|stop|switch|use)\b/i.test(source.source.quote)) {
        issue(intervention.entity_ref, 'intervention_action_unbound',
          `What action does "${node.label}" take on "${target.label}"?`); continue;
      }
      // An option quote cannot authorise a link to an unrelated factor. Its
      // action must overlap the target's independent source and name it there.
      // The same check applies when the action has no numeric level.
      if (!spansOverlap(targetSource, source.source) || !namesBoundTarget(target.label, targetSource, source.source)) {
        issue(intervention.entity_ref, 'intervention_target_source_mismatch',
          `Does "${node.label}" change "${target.label}"? Its stated option does not name that quantity.`); continue;
      }
      structuralEdge(node, target, source.source.quote);
      target.category = 'controllable';
      if (intervention.quantity_ref === null) {
        issue(option.entity_ref, 'intervention_level_missing', `What level of "${target.label}" does "${node.label}" set?`); continue;
      }
      if (!quantity) continue; // Checked above; retained for type narrowing.
      usedQuantityRefs.add(intervention.quantity_ref);
      let value = quantity.value;
      let derived = false;
      if (quantity.claim.frame !== 'level') {
        const baseline = target.observed_state?.raw_value;
        if (baseline === undefined) {
          issue(intervention.quantity_ref, 'change_needs_current_level', `What is the current level of "${target.label}" so the stated change can be applied?`); continue;
        }
        const baseUnit = claimsFor(intervention.entity_ref).find(({ claim }) => claim.role === 'current')!.claim.unit;
        const changeUnit = quantity.claim.unit;
        const pointsOnPercent = baseUnit.kind === 'percent' && changeUnit.kind === 'percentage_points'
          && baseUnit.period === changeUnit.period && baseUnit.counted_object === changeUnit.counted_object;
        if (quantity.claim.frame === 'change_abs' && !compatibleUnits(baseUnit, changeUnit) && !pointsOnPercent) {
          issue(intervention.quantity_ref, 'change_unit_mismatch', `Does the change for "${target.label}" use the same unit and period as its current level?`); continue;
        }
        value = quantity.claim.frame === 'change_rel' ? baseline * (1 + value / 100) : baseline + value;
        derived = true;
      }
      const currentUnit = claimsFor(intervention.entity_ref).find(({ claim }) => claim.role === 'current')?.claim.unit;
      const displayUnit = quantity.claim.frame !== 'level' && currentUnit ? unitText(currentUnit) : unitText(quantity.claim.unit);
      node.interventions[target.id] = {
        value: value / frameOf(target), raw_value: value, unit: displayUnit,
        source: derived ? 'cee_hypothesis' : 'brief_extraction',
        target_match: { node_id: target.id, match_type: 'exact_id', confidence: 'high' },
        source_quote: quantity.claim.number.source.quote,
        reasoning: derived ? `Calculated from the stated current level (${claimsFor(intervention.entity_ref).find(({ claim }) => claim.role === 'current')!.claim.number.source.quote}) and change (${quantity.claim.number.source.quote}).` : source.source.quote,
        value_type: 'numeric',
      };
    }
  }
  for (const { claim, value } of accepted.values()) {
    const target = nodes.get(claim.entity_ref)!;
    if (claim.role === 'limit') {
      if (claim.comparator === null || claim.comparator === '=') {
        issue(claim.ref, 'limit_comparator_missing', `Is the limit for "${target.label}" an upper or lower bound?`); continue;
      }
      constraints.push({
        constraint_id: sourceEntityId(claim.ref), node_id: target.id,
        operator: claim.comparator === '<' || claim.comparator === '<=' ? '<=' : '>=',
        ...(claim.comparator === '<' || claim.comparator === '>' ? { operator_as_stated: claim.comparator } : {}),
        value, unit: unitText(claim.unit), value_frame: claim.frame, label: target.label, provenance: 'explicit',
        ...(claim.number.source.quote.length <= 200 ? { source_quote: claim.number.source.quote } : {}),
      });
    } else if (['proposed_level', 'absolute_change', 'relative_change'].includes(claim.role)
      && !usedQuantityRefs.has(claim.ref) && !goalQuantityRefs.has(claim.ref)) {
      issue(claim.ref, 'unassigned_change', `Which option does "${claim.number.literal}" for "${target.label}" belong to?`);
    }
  }

  const hasPath = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return edges.some((edge) => edge.from === from && hasPath(edge.to, to, seen));
  };
  for (const definition of meaning.definitions) {
    const target = nodes.get(definition.target_ref);
    const operands = definition.operand_refs.map((ref) => nodes.get(ref));
    const source = bindSource(brief, definition.source);
    if (!target || operands.some((node) => !node) || !source.ok || duplicates.has(definition.ref)) {
      issue(definition.ref, 'definition_reference_unresolved', 'Which exact quantities form this definition?'); continue;
    }
    if (new Set(definition.operand_refs).size !== definition.operand_refs.length
      || operands.some((operand) => hasPath(target.id, operand!.id))) {
      issue(definition.ref, 'definition_cycle_or_repeated_operand', `What is the intended definition of "${target.label}"?`); continue;
    }
    if (definition.operation === 'sum' && definition.authorship === 'explicit') {
      issue(definition.ref, 'explicit_sum_carrier_unsupported', `The stated sum for "${target.label}" is retained, but its explicit authorship cannot yet be stored on the calculation carrier.`); continue;
    }
    const targetClaims = claimsFor(definition.target_ref);
    const operandClaims = definition.operand_refs.map((ref) => claimsFor(ref));
    const targetUnit = targetClaims.find(({ claim }) => claim.frame === 'level')?.claim.unit;
    const operandUnits = operandClaims.map((items) => items.find(({ claim }) => claim.frame === 'level')?.claim.unit);
    if (definition.operation === 'sum' && (!targetUnit || operandUnits.some((unit) => !unit || !compatibleUnits(targetUnit, unit)))) {
      issue(definition.ref, 'definition_unit_mismatch', `Do all parts of "${target.label}" use the same unit and period?`); continue;
    }
    if (definition.operation === 'product' && targetUnit && operandUnits.every(Boolean)) {
      const money = operandUnits.filter((unit) => unit!.kind === 'currency');
      const counts = operandUnits.filter((unit) => unit!.kind === 'count');
      if (money.length === 1 && counts.length === 1 && operandUnits.length === 2) {
        if (targetUnit.kind !== 'currency' || money[0]!.currency !== targetUnit.currency || money[0]!.period !== targetUnit.period
          || counts[0]!.period !== null || !money[0]!.counted_object || !counts[0]!.counted_object
          || money[0]!.counted_object.replace(/s$/, '').toLowerCase() !== counts[0]!.counted_object.replace(/s$/, '').toLowerCase()) {
          issue(definition.ref, 'definition_unit_mismatch', `Which population and period does "${target.label}" cover?`); continue;
        }
      } else {
        issue(definition.ref, 'definition_dimensions_unverified', `How do these quantities combine in the unit of "${target.label}"?`); continue;
      }
    }
    const baseline = target.observed_state?.raw_value;
    const values = operands.map((operand) => operand!.observed_state?.raw_value);
    if (baseline !== undefined && values.every((value) => value !== undefined)) {
      const computed = definition.operation === 'product'
        ? (values as number[]).reduce((product, value) => product * value, 1)
        : (values as number[]).reduce((sum, value) => sum + value, 0);
      if (Math.abs(computed - baseline) > 1e-8 * Math.max(1, Math.abs(computed), Math.abs(baseline))) {
        issue(definition.ref, 'definition_current_values_disagree', `The stated parts give ${computed}, while "${target.label}" is ${baseline}. Do they cover the same population and period?`); continue;
      }
    }
    target.nonlinear_identity = definition.operation === 'sum'
      ? { operation: 'sum', factor_ids: operands.map((node) => node!.id), stated_in_brief: false }
      : { operation: 'product', factor_ids: operands.map((node) => node!.id), stated_in_brief: definition.authorship === 'explicit' };
    source_bindings[definition.ref] = source.source;
    for (const operand of operands) structuralEdge(operand!, target, source.source.quote, definition.authorship === 'explicit' ? 'brief_extraction' : 'domain_knowledge');
  }
  for (const claim of meaning.causal_claims) {
    const from = nodes.get(claim.from_ref);
    const to = nodes.get(claim.to_ref);
    const source = bindSource(brief, claim.source);
    if (!from || !to || !source.ok || duplicates.has(claim.ref)) {
      issue(claim.ref, 'causal_reference_unresolved', 'Which quantities does the stated causal relationship connect?'); continue;
    }
    source_bindings[claim.ref] = source.source;
    const coefficient = claim.coefficient && readNumber(brief, claim.coefficient);
    const deviation = claim.standard_deviation && readNumber(brief, claim.standard_deviation);
    const probability = claim.existence_probability && readNumber(brief, claim.existence_probability);
    if (claim.direction === 'unknown' || !coefficient || !deviation || !probability) {
      issue(claim.ref, 'causal_size_unresolved', `How does "${from.label}" affect "${to.label}"? The stated relationship has no complete numerical specification.`); continue;
    }
    if (!/coefficient|\bbeta\b|\bβ\b/i.test(claim.coefficient!.source.quote)
      || deviation.value <= 0 || probability.value < 0 || probability.value > 1
      || coefficient.value === 0 || (coefficient.value > 0) !== (claim.direction === 'positive') || hasPath(to.id, from.id)) {
      issue(claim.ref, 'causal_parameters_invalid', `Which numerical effect and uncertainty apply from "${from.label}" to "${to.label}"?`); continue;
    }
    edges.push({ from: from.id, to: to.id, strength: { mean: coefficient.value, std: deviation.value },
      exists_probability: probability.value, effect_direction: claim.direction,
      provenance: { source: 'brief_extraction', reasoning: source.source.quote, magnitude: 'user_stated' } });
  }
  for (const unknown of meaning.unknowns) issue(unknown.ref, 'stated_unknown', unknown.question);
  const graph = GraphV3.parse({ nodes: [...nodes.values()], edges, ...(constraints.length ? { goal_constraints: constraints } : {}) });
  return {
    graph, open_questions: [...new Set(unresolved.map((item) => item.question))], unresolved,
    proposals: meaning.proposals, source_bindings, reference_ids, loss: [...unresolved],
    trace: { architecture: 'source_first', transforms: 1, repairs: 0, retries: 0,
      source_offset_corrections: Object.values(source_bindings).filter((source) => source.offset_corrected).length,
      level_direction_annotations_ignored: [...accepted.values()].filter(({ claim }) => claim.frame === 'level' && claim.direction !== 'none').length,
      projected_option_quantities: projectedOptionQuantities },
  };
}
