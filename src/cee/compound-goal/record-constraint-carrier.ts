/** Compile records declarations at the existing constraint boundary, without rebinding targets. */
import type { GoalConstraintT } from '../../schemas/assist.js';
import type { RecordConstraintCandidate } from '../draft/records/projector.js';
import {
  extractCompoundGoals, normaliseConstraintUnits, toGoalConstraints,
  type ExtractedGoalConstraint,
} from './extractor.js';
import { locateEvidence, normaliseEvidenceText, findT1Matches, deriveMetricText, type ProvenUncoveredBound } from './direction-gate.js';
import { soleStatedQuantityInSpan, unitIsTemporal } from '../factor-extraction/goal-label-target.js';
import { sameUnit } from '../../utils/currency-alphabet.js';
import { classifyUnitScaleClass } from '../draft/records/unit-scale-class.js';
import { valuesMatch } from '../../utils/reduction-framing.js';
import { MINTABLE_TARGET_KINDS } from './mintable-target-kinds.js';

export type RecordConstraintReason =
  | 'record_constraint_validated'
  | 'record_constraint_admitted'
  | 'record_constraint_quote_unlocated'
  | 'record_constraint_quote_ambiguous'
  | 'record_constraint_quantity_unproven'
  | 'record_constraint_unit_unproven'
  | 'record_constraint_arithmetic_unproven'
  | 'record_constraint_target_unit_mismatch'
  | 'record_constraint_semantics_unproven'
  | 'record_constraint_semantics_ambiguous'
  | 'record_constraint_target_unavailable'
  | 'record_constraint_binding_conflict'
  | 'record_constraint_temporal_nonbinding'
  | 'record_constraint_risk_nonbinding'
  | 'record_constraint_direction_unproven'
  | 'record_constraint_non_limit';

interface ConstraintTargetNode {
  readonly id: string;
  readonly kind?: string;
  readonly data?: { readonly unit?: unknown } | null;
  readonly observed_state?: {
    readonly unit?: unknown;
    readonly metadata?: { readonly unit?: unknown } | null;
  } | null;
}

/** Kept only in the authenticated lineage receipt; public refusals use record_disclosures. */
export interface RecordConstraintDisposition {
  candidate: RecordConstraintCandidate;
  reason: RecordConstraintReason;
  canonical_constraint?: GoalConstraintT;
  deadline_metadata?: ExtractedGoalConstraint['deadlineMetadata'];
  /** Unique quoted span in normalized brief text; ownership is not admission. */
  source_span?: { start: number; end: number };
}

function textKey(text: string): string {
  return normaliseEvidenceText(text).toLocaleLowerCase('en-GB');
}

/** Complete evidence comparison, matching the existing named-limit write boundary. */
function completeEvidence(text: string): string {
  return textKey(text).replace(/[.!]\s*$/, '').trim();
}

function uniqueOccurrence(text: string, quote: string): boolean {
  const source = textKey(text);
  const evidence = textKey(quote);
  if (!evidence) return false;
  const at = source.indexOf(evidence);
  return at >= 0 && source.indexOf(evidence, at + 1) < 0;
}

function semanticKey(c: ExtractedGoalConstraint): string {
  return JSON.stringify([c.operator, c.value, c.unit, c.valueFrame]);
}

/** Exact overlapping evidence, not label/subject similarity. */
function sameEvidence(a: string, b: string): boolean {
  const aa = textKey(a);
  const bb = textKey(b);
  return aa.length > 0 && bb.length > 0 && (aa.includes(bb) || bb.includes(aa));
}

/**
 * The record supplies the reference; the existing parser alone supplies the
 * canonical arithmetic and frame. A direction-gate success is not quantity
 * evidence. Unknown units, partial quotes and competing readings stay named.
 */
export function compileRecordConstraint(
  candidate: RecordConstraintCandidate,
  brief: string,
  graphNodes: readonly ConstraintTargetNode[],
): RecordConstraintDisposition {
  let sourceSpan: RecordConstraintDisposition['source_span'];
  const refuse = (reason: RecordConstraintReason): RecordConstraintDisposition => ({
    candidate, reason, ...(sourceSpan ? { source_span: sourceSpan } : {}),
  });
  const quote = candidate.source_quote;
  const evidence = locateEvidence(brief, quote);
  if (!evidence.located) return refuse('record_constraint_quote_unlocated');
  if (!uniqueOccurrence(brief, quote)) return refuse('record_constraint_quote_ambiguous');
  // A following qualifier may change the quantity. The compiler has no authority
  // to discard it, even when both existing parsers stop at the same prefix.
  if (!completeEvidence(evidence.sentence).endsWith(completeEvidence(quote))) {
    return refuse('record_constraint_semantics_unproven');
  }

  const start = textKey(brief).indexOf(textKey(quote));
  sourceSpan = { start, end: start + textKey(quote).length };
  const target = graphNodes.find((node) => node.id === candidate.constraint.node_id);
  if (!target || !MINTABLE_TARGET_KINDS.has(String(target.kind))) {
    return refuse('record_constraint_target_unavailable');
  }

  const extracted = extractCompoundGoals(quote, { includeProxies: false }).constraints;
  const deadline = extracted.find((c) => c.deadlineMetadata !== undefined);
  if (unitIsTemporal(candidate.constraint.unit) || deadline !== undefined) {
    return {
      ...refuse('record_constraint_temporal_nonbinding'),
      ...(deadline?.deadlineMetadata ? { deadline_metadata: deadline.deadlineMetadata } : {}),
    };
  }
  const quantity = soleStatedQuantityInSpan(quote);
  if (!quantity || !valuesMatch(quantity.value, candidate.constraint.value)) {
    return refuse('record_constraint_quantity_unproven');
  }
  if (!candidate.constraint.unit || !sameUnit(quantity.unit, candidate.constraint.unit)) {
    return refuse('record_constraint_unit_unproven');
  }
  // The full governing statement must attest the same semantics too. A quote
  // cut just after "25%" cannot borrow authority from "25%/month" in the brief.
  const governing = extractCompoundGoals(evidence.sentence, { includeProxies: false }).constraints;
  const matching = extracted.filter((c) =>
    c.deadlineMetadata === undefined
    && c.provenance === 'explicit'
    && c.operator === candidate.constraint.operator
    && (c.valueFrame === 'level' || c.valueFrame === 'delta')
    && sameUnit(c.unit, quantity.unit)
    && completeEvidence(c.sourceQuote) === completeEvidence(quote)
    && textKey(c.sourceQuote).includes(textKey(quantity.matchedText))
    && governing.some((full) => semanticKey(full) === semanticKey(c)
      && sameEvidence(full.sourceQuote, quote)
      && uniqueOccurrence(evidence.sentence, full.sourceQuote)),
  );
  if (matching.length === 0) return refuse('record_constraint_semantics_unproven');
  if (new Set(matching.map(semanticKey)).size !== 1) return refuse('record_constraint_semantics_ambiguous');

  // The raw scanner and extractor use different arithmetic. Agreement on the
  // quote alone is insufficient: parseValue currently reads "2k%" as .02,
  // while the raw scanner reads 2000%. Check the independent raw magnitude
  // against the extractor's own documented percent convention. The extractor
  // remains the owner of a delta's sign and frame; the raw scanner reports the
  // unsigned amount stated in a reduction phrase.
  const attested = matching[0]!;
  const extractedUserValue = classifyUnitScaleClass(quantity.unit) === 'percent'
    ? attested.value * 100 : attested.value;
  const extractedMagnitude = attested.valueFrame === 'delta'
    ? Math.abs(extractedUserValue) : extractedUserValue;
  if (!valuesMatch(quantity.value, extractedMagnitude)) {
    return refuse('record_constraint_arithmetic_unproven');
  }

  const canonical = toGoalConstraints(normaliseConstraintUnits([{
    ...attested,
    targetNodeId: candidate.constraint.node_id,
  }]))[0]!;
  // The existing normalizer leaves 100%+ in its historical %-label/fraction-
  // value convention. Do not promote that unresolved scale to executable input.
  if (canonical.unit === '%' && Math.abs(canonical.value) >= 1) {
    return refuse('record_constraint_unit_unproven');
  }
  // Compare declared denominations individually: a broad "currency" family
  // cannot make £ and $ interchangeable. Absence supplies no new unit/frame.
  const targetUnits = [target.data?.unit, target.observed_state?.unit, target.observed_state?.metadata?.unit]
    .filter((unit): unit is string => typeof unit === 'string' && unit.trim().length > 0);
  if (targetUnits.some((unit) => !sameUnit(unit, quantity.unit) && !sameUnit(unit, canonical.unit ?? ''))) {
    return refuse('record_constraint_target_unit_mismatch');
  }
  return { ...refuse('record_constraint_validated'), canonical_constraint: canonical };
}

/** A canonical row from this exact source quantity, independently of its guessed target. */
export function sameRecordConstraintEvidence(
  canonical: GoalConstraintT,
  other: Record<string, unknown>,
): boolean {
  return typeof other.value === 'number' && valuesMatch(canonical.value, other.value)
    && canonical.operator === other.operator && canonical.unit === other.unit
    && canonical.value_frame === other.value_frame
    && typeof canonical.source_quote === 'string' && typeof other.source_quote === 'string'
    && sameEvidence(canonical.source_quote, other.source_quote);
}

function occurrences(source: string, text: string): number[] {
  const positions: number[] = [];
  if (!text) return positions;
  for (let at = source.indexOf(text); at >= 0; at = source.indexOf(text, at + 1)) positions.push(at);
  return positions;
}

function ownedSpan(dispositions: readonly RecordConstraintDisposition[], start: number, end: number): boolean {
  return dispositions.some((d) => d.source_span !== undefined
    && d.source_span.start <= start && d.source_span.end >= end);
}

/**
 * Reserve the literal quantity's position, not a sentence or a numeric value.
 * A short ambiguous regex quote that could refer to refused evidence cannot
 * supply independent authority. A different position stays eligible even if
 * its number is identical or it shares the same governing sentence.
 */
export function recordOwnsConstraintSource(
  dispositions: readonly RecordConstraintDisposition[],
  row: { source_quote?: unknown },
  brief: string,
  sourceAmountSpan?: ExtractedGoalConstraint['sourceAmountSpan'],
): boolean {
  if (sourceAmountSpan) {
    const { start, end } = sourceAmountSpan;
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= brief.length) {
      // The producer's offsets refer to the exact extractor input. Convert the
      // captured occurrence, not its numeric value, to the records coordinate
      // space. Ending the prefix at the amount avoids trim() moving its start
      // backwards across whitespace before the capture.
      const amount = textKey(brief.slice(start, end));
      const normalizedEnd = textKey(brief.slice(0, end)).length;
      if (amount) return ownedSpan(dispositions, normalizedEnd - amount.length, normalizedEnd);
    }
  }
  if (typeof row.source_quote !== 'string') return false;
  const quote = textKey(row.source_quote);
  const quantity = soleStatedQuantityInSpan(quote);
  if (!quantity) return false;
  const amount = textKey(quantity.matchedText);
  const inQuote = occurrences(quote, amount);
  return occurrences(textKey(brief), quote).some((at) => inQuote.some((offset) =>
    ownedSpan(dispositions, at + offset, at + offset + amount.length),
  ));
}

/** The construction table already exposes its match/amount span; retain that identity. */
export function recordOwnsConstruction(
  dispositions: readonly RecordConstraintDisposition[],
  bound: ProvenUncoveredBound,
  brief: string,
): boolean {
  const sentence = textKey(bound.sentence);
  const matches = findT1Matches(sentence).filter((m) =>
    m.id === bound.t1_id && m.direction === bound.direction
    && valuesMatch(m.value, bound.value) && m.unit === bound.unit
    && textKey(deriveMetricText(m.subject, null, null)) === textKey(bound.subject),
  );
  return occurrences(textKey(brief), sentence).some((at) => matches.some((m) => {
    const construction = sentence.slice(m.index, m.index + m.length);
    return occurrences(construction, textKey(m.amountText)).some((offset) =>
      ownedSpan(dispositions, at + m.index + offset, at + m.index + offset + m.amountText.length),
    );
  }));
}

/** Use the established disclosure surface; the carrier node is never removed. */
export function recordConstraintDisclosure(disposition: RecordConstraintDisposition): Record<string, unknown> {
  return {
    reason: disposition.reason,
    label: disposition.candidate.source_quote,
    node_id: disposition.candidate.carrier_node_id,
    stated_index: disposition.candidate.stated_index,
    from_ref: `stated_items[${disposition.candidate.stated_index}]`,
    // A refused declaration is not evidence that its number was user-authored.
  };
}
