import { periodIn, sameUnit, readCountRate, readMoney, evidencePeriod, words } from '../../../orchestrator-v5/agent-lane/same-unit.js';
import { findStatedAmounts, readUnit, readCurrencyUnitWithQualifiers } from '../../provenance/stated-amounts.js';
import type { DraftQuoteSpan, DraftValueRange, DraftStatedItem } from './grammar.js';

function boundMatches(quote: string, span: DraftQuoteSpan, value: number, unit?: string): boolean {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end)
    || span.start < 0 || span.end > quote.length || span.start >= span.end) return false;
  const slice = quote.slice(span.start, span.end);
  const amounts = findStatedAmounts(slice);
  const reading = readCurrencyUnitWithQualifiers(unit);
  if (amounts[0]?.kind === 'currency' && (reading.kind !== 'currency' || amounts[0].currencyCode !== reading.currencyCode)) return false;
  if (reading.kind === 'currency' && amounts[0]?.kind !== 'currency') return false;
  return amounts.length === 1 && amounts[0]!.index === 0 && amounts[0]!.matchedText.length === slice.length
    && amounts[0]!.magnitude * readUnit(slice).multiplier === value;
}

/** A typed range is checked, never inferred from wording or borrowed from a neighbour. */
export function admittedValueRange(range: DraftValueRange | undefined, quote: string, value: number, unit: string | undefined, legacyEvidence = false): DraftValueRange | undefined {
  if (range === undefined || unit === undefined || !sameUnit(range.unit ?? unit, unit)
    || ![range.low, range.high, value].every(Number.isFinite)
    || range.low > value || value > range.high || range.low >= range.high) return undefined;
  // New literals locate their own evidence here, including ranges on sets_to claims.
  // A legacy restated range unit remains checked, never overwritten.
  if (!legacyEvidence && range.low_literal !== undefined && range.high_literal !== undefined) {
    const low = boundLiteral(quote, range.low_literal, range.low);
    const high = boundLiteral(quote, range.high_literal, range.high);
    if (low.reason !== undefined || high.reason !== undefined || low.span.end > high.span.start) return undefined;
    return { ...range, unit, low_span: low.span, high_span: high.span };
  }
  if (range.low_span === undefined || range.high_span === undefined
    || range.low_span.end > range.high_span.start
    || !boundMatches(quote, range.low_span, range.low, range.unit) || !boundMatches(quote, range.high_span, range.high, range.unit)) return undefined;
  return range;
}

/** Evidence-bound typed value. Unit text validates the declared unit; it never supplies a field. */
export function statedValueIsBound(item: DraftStatedItem, brief: string | undefined): boolean {
  const { value, unit, source_quote: quote } = item;
  if (item.evidence_conflicts?.includes('span_and_literal_both')) return false;
  if (typeof brief !== 'string' || !brief.includes(quote) || quote.length === 0 || value === undefined || unit === undefined) return false;
  if (item.value_literal !== undefined) {
    if (item.legacy_evidence && item.value_span!==undefined) {
      if(!boundMatches(quote,item.value_span,literalConventionValue(value,unit,item.value_scale),unit))return false;
    } else if (boundLiteral(quote, item.value_literal, value, item.value_scale).reason !== undefined) return false;
    // Referenced quantities inherit the declaration, never require unit words in every clause.
    if (item.unit_literals === undefined) return true;
    return unitEvidenceReason(item, unit) === undefined;
  }
  const { value_span, unit_span } = item;
  if(value_span === undefined || unit_span === undefined || !boundMatches(quote,value_span,value,unit)
    || unit_span.start < 0 || unit_span.end > quote.length || unit_span.start >= unit_span.end) return false;
  const unitText=quote.slice(unit_span.start,unit_span.end);
  return readCurrencyUnitWithQualifiers(unit).kind === 'currency' ? periodIn(unit) === periodIn(unitText) : sameUnit(unit,unitText);
}

export type UnitRefusal = 'value_scale_restated_conflict' | 'quantity_unit_undeclared' | 'quantity_declaration_mismatch' | 'unit_not_evidenced' | 'unit_period_ambiguous' | 'unit_literal_contradicts_unit' | 'unit_restated_conflict';
/** Unit parts validate one authored declaration; they never supply a unit. */
export function unitEvidenceReason(item: DraftStatedItem, unit: string): UnitRefusal | undefined {
  const parts = item.unit_literals ?? [];
  if (parts.some(p => locateLiteral(item.source_quote,p).reason !== undefined)) return 'unit_not_evidenced';
  const valueLiteral=item.value_literal ?? item.relationship?.amount_literal ?? '';
  const amount=findStatedAmounts(valueLiteral)[0];
  const money=readMoney(unit,'');
  const period=evidencePeriod(parts);
  if(period === 'ambiguous') return 'unit_period_ambiguous';
  if(money !== null) {
    const code=amount?.currencyCode ?? parts.map(p=>readCurrencyUnitWithQualifiers(p)).find(p=>p.kind==='currency')?.currencyCode;
    if(code !== undefined && code !== money.code || period !== null && period !== money.period) return 'unit_literal_contradicts_unit';
    if(code !== money.code || period !== money.period) return 'unit_not_evidenced';
    return undefined;
  }
  if(unit === '%') return amount?.kind === 'percent' || parts.includes('%') ? undefined : 'unit_not_evidenced';
  const count=readCountRate(unit);
  if(count !== null) {
    const noun=count.noun.join(' ');
    if(period !== null && period !== count.period) return 'unit_literal_contradicts_unit';
    if(!parts.some(p=>readCountRate(p)?.noun.join(' ')===noun) || period !== count.period) return 'unit_not_evidenced';
    return undefined;
  }
  return parts.some(p=>sameUnit(unit,p)) ? undefined : 'unit_not_evidenced';
}

export function canonicalQuantityUnits(records: import('./grammar.js').DraftRecordSet): { records: import('./grammar.js').DraftRecordSet; refusals: {stated_index:number;reason:UnitRefusal}[] } {
  const copy=structuredClone(records);
  const vnext=records.stated_items.some(i=>!i.legacy_evidence && (i.value_literal!==undefined || i.unit_literals!==undefined || i.relationship?.no_effect_literal!==undefined));
  const refusals: {stated_index:number;reason:UnitRefusal}[]=[];
  const unitOf=(q:number): string | undefined => {
    const item=records.stated_items[q];
    if(item?.unit === undefined){refusals.push({stated_index:q,reason:'quantity_unit_undeclared'});return undefined;}
    if(item.quantity !== undefined && item.quantity !== q){refusals.push({stated_index:q,reason:'quantity_declaration_mismatch'});return undefined;}
    // Legacy restatements remain checked input; the new literal declaration is evidence-bound.
    const reason=!vnext || item.legacy_evidence ? undefined : unitEvidenceReason(item,item.unit);
    if(reason !== undefined){refusals.push({stated_index:q,reason});return undefined;}
    return item.unit;
  };
  copy.stated_items.forEach((item,index)=>{
    if(item.quantity !== undefined){const unit=unitOf(item.quantity);if(unit !== undefined){
      if(item.unit !== undefined && !sameUnit(item.unit,unit))refusals.push({stated_index:index,reason:'unit_restated_conflict'});
      // Legacy independently evidenced units retain R1 semantics; v-next has one declaration.
      if(!item.legacy_evidence || !statedValueIsBound(item,item.source_quote))item.unit=unit;
      const scale=records.stated_items[item.quantity]?.value_scale;
      if(item.value_scale!==undefined && scale!==undefined && item.value_scale!==scale)refusals.push({stated_index:index,reason:'value_scale_restated_conflict'});
      if(scale!==undefined)item.value_scale=scale;
    }}
    const r=item.relationship;
    if(r !== undefined){const from=unitOf(r.from_quantity),to=unitOf(r.to_quantity);
      if(r.amount_unit !== undefined && to !== undefined && !sameUnit(r.amount_unit,to) || r.per_source_change_unit !== undefined && from !== undefined && !sameUnit(r.per_source_change_unit,from)) {
        refusals.push({stated_index:index,reason:'unit_restated_conflict'});delete r.amount_span;delete r.source_span;
      } else { r.amount_unit=to;r.per_source_change_unit=from; }
      if(r.range !== undefined)r.range.unit=to;
    }
    if(item.range !== undefined && item.range.unit===undefined)item.range.unit=item.unit;
  });
  copy.claims.forEach(c=>{if(c.quantity !== undefined){const unit=unitOf(c.quantity);if(c.unit !== undefined && unit !== undefined && !sameUnit(c.unit,unit))refusals.push({stated_index:c.quantity,reason:'unit_restated_conflict'});c.unit=unit;
    const scale=records.stated_items[c.quantity]?.value_scale;
    if(c.value_scale!==undefined && scale!==undefined && c.value_scale!==scale)refusals.push({stated_index:c.quantity,reason:'value_scale_restated_conflict'});
    if(scale!==undefined)c.value_scale=scale;
  }});
  return {records:copy,refusals:[...new Map(refusals.map(r=>[JSON.stringify(r),r])).values()]};
}

export type LiteralRefusal = 'literal_absent' | 'literal_ambiguous' | 'literal_not_whole_amount' | 'literal_value_mismatch' | 'span_and_literal_both';
export type LiteralLocation = { span: DraftQuoteSpan; reason?: never } | { reason: LiteralRefusal; span?: never };
/** Copy-and-locate only. The literal must have exactly one occurrence, including overlapping occurrences. */
export function locateLiteral(quote: string, literal: string): LiteralLocation {
  const start = literal.length === 0 ? -1 : quote.indexOf(literal);
  if (start < 0) return { reason: 'literal_absent' };
  if (start !== quote.lastIndexOf(literal)) return { reason: 'literal_ambiguous' };
  return { span: { start, end: start + literal.length } };
}
/** Validate a typed magnitude; the collector never supplies a value to the record. */
export function boundLiteral(quote: string, literal: string, value: number, scale?: import("./grammar.js").DraftRecordValueScale): LiteralLocation {
  const located = locateLiteral(quote, literal);
  if (located.reason !== undefined) return located;
  const parts = findStatedAmounts(literal);
  if (parts.length !== 1) return { reason: 'literal_not_whole_amount' };
  const part = parts[0]!;
  const whole = findStatedAmounts(quote).find(a => a.index === located.span.start + part.index && a.matchedText === part.matchedText);
  if (whole === undefined) return { reason: 'literal_not_whole_amount' };
  const magnitude = part.magnitude * readUnit(part.matchedText).multiplier;
  const expected=part.kind === 'percent' ? literalConventionValue(value,'%',scale) : value;
  if (Math.abs(Math.abs(expected) - magnitude) > Math.max(Math.abs(expected), magnitude, 1) * 1e-9) return { reason: 'literal_value_mismatch' };
  return located;
}

/** Locate all authored evidence before projection; preserve legacy offsets as checked compatibility inputs. */
export function locateRecordEvidence(records: import('./grammar.js').DraftRecordSet): { records: import('./grammar.js').DraftRecordSet; refusals: { stated_index: number; reason: LiteralRefusal }[] } {
  const copy = structuredClone(records);
  const refusals: { stated_index: number; reason: LiteralRefusal }[] = [];
  copy.stated_items.forEach((item, stated_index) => {
    const refuse = (reason: LiteralRefusal) => { if (!refusals.some(r => r.stated_index === stated_index)) refusals.push({ stated_index, reason }); };
    if (item.evidence_conflicts?.includes('span_and_literal_both')) refuse('span_and_literal_both');
    const bind = (literal: string | undefined, value?: number, determiner = false, scale?: import("./grammar.js").DraftRecordValueScale, legacySpan?: DraftQuoteSpan): DraftQuoteSpan | undefined => {
      if (literal === undefined) return undefined;
      if(item.legacy_evidence && legacySpan!==undefined){
        if(!Number.isInteger(legacySpan.start)||!Number.isInteger(legacySpan.end)||legacySpan.start<0||legacySpan.end>item.source_quote.length||legacySpan.start>=legacySpan.end
          || item.source_quote.slice(legacySpan.start,legacySpan.end)!==literal){refuse('literal_absent');return undefined;}
        if(value!==undefined && !(determiner && Math.abs(value)===1 && ['each','every','per'].includes(words(literal)[0] ?? ''))){
          const parts=findStatedAmounts(literal),whole=findStatedAmounts(item.source_quote);
          if(parts.length!==1 || !whole.some(a=>a.index===legacySpan.start+parts[0]!.index && a.matchedText===parts[0]!.matchedText)){refuse('literal_not_whole_amount');return undefined;}
          const expected=parts[0]!.kind==='percent' ? literalConventionValue(value,'%',scale) : value;
          const magnitude=parts[0]!.magnitude*readUnit(parts[0]!.matchedText).multiplier;
          if(Math.abs(Math.abs(expected)-magnitude)>Math.max(Math.abs(expected),magnitude,1)*1e-9){refuse('literal_value_mismatch');return undefined;}
        }
        return legacySpan;
      }
      const result = determiner && Math.abs(value ?? 0) === 1 && ['each', 'every', 'per'].includes(words(literal)[0] ?? '')
        ? locateLiteral(item.source_quote, literal)
        : value === undefined ? locateLiteral(item.source_quote, literal) : boundLiteral(item.source_quote, literal, value, scale);
      if (result.reason !== undefined) { refuse(result.reason); return undefined; }
      return result.span;
    };
    if (item.value_literal !== undefined) item.value_span = bind(item.value_literal, item.value, false, records.stated_items[item.quantity ?? stated_index]?.value_scale,item.value_span);
    if (item.unit_literals?.length === 1) item.unit_span = bind(item.unit_literals[0],undefined,false,undefined,item.unit_span);
    if (item.direction_literal !== undefined) item.direction_span = bind(item.direction_literal,undefined,false,undefined,item.direction_span);
    const range = (r: DraftValueRange | undefined, q=stated_index) => { if (r === undefined) return; if(r.low_literal !== undefined) r.low_span=bind(r.low_literal,r.low,false,records.stated_items[q]?.value_scale,r.low_span); if(r.high_literal !== undefined) r.high_span=bind(r.high_literal,r.high,false,records.stated_items[q]?.value_scale,r.high_span); };
    range(item.range,item.quantity ?? stated_index);
    if (item.relationship !== undefined) {
      const r = item.relationship;
      if(r.amount_literal !== undefined) r.amount_span=bind(r.amount_literal,r.amount,false,records.stated_items[r.to_quantity]?.value_scale,r.amount_span);
      if(r.per_source_literal !== undefined) r.source_span=bind(r.per_source_literal,r.per_source_change,true,records.stated_items[r.from_quantity]?.value_scale,r.source_span);
      if(r.no_effect_literal !== undefined) bind(r.no_effect_literal);
      range(r.range,r.to_quantity);
      // The sizer's natural percent unit is points. Preserve the typed convention at input,
      // and use one raw-value helper for the checked compiler/persisted arithmetic.
      const from=records.stated_items[r.from_quantity],to=records.stated_items[r.to_quantity];
      if(r.amount!==undefined)r.amount=literalConventionValue(r.amount,to?.unit,to?.value_scale);
      if(r.per_source_change!==undefined)r.per_source_change=literalConventionValue(r.per_source_change,from?.unit,from?.value_scale);
      if(r.range!==undefined){r.range.low=literalConventionValue(r.range.low,to?.unit,to?.value_scale);r.range.high=literalConventionValue(r.range.high,to?.unit,to?.value_scale);}
      if (refusals.some(r => r.stated_index === stated_index)) { delete r.amount_span; delete r.source_span; }
    }
  });
  return { records: copy, refusals };
}

/** Shared natural/literal convention, never inferred from the magnitude. */
export function literalConventionValue(value: number, unit: string | undefined, scale: import('./grammar.js').DraftRecordValueScale | undefined): number {
  return unit === '%' && (scale === 'unit_interval' || scale === 'ratio') ? value * 100 : value;
}
