import { describe, expect, it } from 'vitest';
import { compileSourceMeaning } from './compiler.js';
import { selectSourceFirstClarification } from './clarification.js';
import { buildSourceFirstModel } from './index.js';
import type { SourceMeaning, SourceSpan, SourceUnit } from './meaning.js';

const source = (quote: string): SourceSpan => ({ quote, start: null, end: null });
const GBP: SourceUnit = { kind: 'currency', currency: 'GBP', period: null, counted_object: null, as_stated: '£' };
const goalQuote = 'I need to accelerate securing funding within the next 2 months.';
const dealsQuote = 'Investment firms do deals between £1-2 million.';
const brief = `${goalQuote} ${dealsQuote}`;
const funding = (): SourceMeaning => ({
  entities: [{ ref: 'funding', kind: 'goal', label: 'Funding', source: source(goalQuote) }],
  entity_metadata: [{ entity_ref: 'funding', unit: { value: GBP, authorship: 'interpretation', source: source(dealsQuote) },
    deadline: { as_stated: 'within the next 2 months', horizon_months: 2, source: source(goalQuote) } }],
  quantities: [], options: [], definitions: [], causal_claims: [], proposals: [],
  unknowns: [
    { ref: 'target', entity_refs: ['funding'], question: 'What minimum total funding do you need to secure?', source: source(goalQuote) },
    { ref: 'current', entity_refs: ['funding'], question: 'How much funding have you secured so far?', source: source(goalQuote) },
  ],
});
const select = (meaning: SourceMeaning, text = brief) => selectSourceFirstClarification(text, meaning, compileSourceMeaning(text, meaning));

describe('one source-first user clarification', () => {
  it('presents one funding ask while preserving every contextual and semantic diagnostic in the builder', async () => {
    const meaning = funding();
    const compiled = compileSourceMeaning(brief, meaning);
    const built = await buildSourceFirstModel(brief, async () => ({ text: JSON.stringify(meaning) }));
    expect(built.open_questions).toEqual(['What minimum total funding do you need to secure?']);
    expect(built.graph).toEqual(compiled.graph);
    expect(built.unresolved).toEqual(compiled.unresolved);
    expect(built.loss).toEqual(compiled.loss);
    expect(built.unresolved).toContainEqual(expect.objectContaining({ code: 'contextual_unit_pending_contract' }));
    expect(built.unresolved.filter((finding) => finding.code === 'stated_unknown')).toHaveLength(2);
  });

  it('does not ask the user to solve contextual-unit storage or extraction-reference failures', () => {
    const meaning = funding();
    meaning.unknowns = [];
    const compiled = compileSourceMeaning(brief, meaning);
    compiled.unresolved.push({ ref: 'funding', code: 'option_reference_invalid', question: 'Which extracted option was intended?' });
    expect(selectSourceFirstClarification(brief, meaning, compiled)).toEqual([]);
    expect(compiled.unresolved).toHaveLength(2);
  });

  it('rejects missing, empty and duplicate unknown entity refs without removing their diagnostics', () => {
    const meaning = funding();
    for (const refs of [['missing'], [], ['funding', 'missing']]) {
      meaning.unknowns[0].entity_refs = refs;
      expect(select(meaning)).toEqual(['How much funding have you secured so far?']);
    }
    meaning.unknowns[0].entity_refs = ['funding'];
    meaning.unknowns[0].ref = 'funding';
    expect(select(meaning)).toEqual([]); // The collision also blocks admission of that entity.
    const compiled = compileSourceMeaning(brief, meaning);
    expect(compiled.unresolved).toContainEqual(expect.objectContaining({ code: 'duplicate_reference' }));
  });

  it('rejects an unknown with a fabricated source quote', () => {
    const meaning = funding();
    meaning.unknowns[0].source = source('Funding target is £2 million.');
    expect(select(meaning)).toEqual(['How much funding have you secured so far?']);
  });

  it('suppresses an exact request for an admitted current value and preserves missing scope or effect', () => {
    const text = 'Current funding is £100k. Funding supports runway.';
    const meaning = funding();
    meaning.entities[0].source = source('Current funding is £100k.');
    meaning.entity_metadata = [];
    meaning.quantities = [{ ref: 'current_value', entity_ref: 'funding', role: 'current', frame: 'level', direction: 'none',
      number: { literal: '£100k', value: '100000', source: source('Current funding is £100k.') }, unit: GBP, comparator: null, horizon_months: null }];
    meaning.unknowns = [
      { ref: 'repeat', entity_refs: ['funding'], question: 'What is the current Funding?', source: null },
      { ref: 'scope', entity_refs: ['funding'], question: 'Does current funding include committed or received capital?', source: null },
      { ref: 'effect', entity_refs: ['funding'], question: 'How does funding affect runway?', source: null },
    ];
    expect(select(meaning, text)).toEqual(['Does current funding include committed or received capital?']);
    meaning.unknowns.splice(1, 1);
    expect(select(meaning, text)).toEqual(['How does funding affect runway?']);
    meaning.quantities = [];
    meaning.entities[0].source = source('Funding supports runway.');
    expect(select(meaning, 'Funding supports runway.')).toEqual(['What is the current Funding?']);
  });

  it('prioritises an actual conflicting current value over a broad goal unknown', () => {
    const text = 'Current funding is £100k. Current funding is £120k.';
    const meaning = funding();
    meaning.entities[0].source = source('Current funding is £100k.');
    meaning.entity_metadata = [];
    meaning.quantities = ['100', '120'].map((amount) => ({ ref: `current_${amount}`, entity_ref: 'funding', role: 'current', frame: 'level', direction: 'none',
      number: { literal: `£${amount}k`, value: `${amount}000`, source: source(`Current funding is £${amount}k.`) }, unit: GBP, comparator: null, horizon_months: null }));
    meaning.unknowns.forEach((unknown) => { unknown.source = null; });
    expect(select(meaning, text)).toEqual(['Which stated current level applies to "Funding"?']);
  });

  it('keeps an unresolved effect with validated endpoints useful without inventing its size', () => {
    const text = 'Funding supports runway.';
    const meaning = funding();
    meaning.entity_metadata = [];
    meaning.entities = [{ ref: 'funding', kind: 'factor', label: 'Funding', source: source(text) }, { ref: 'runway', kind: 'goal', label: 'Runway', source: source(text) }];
    meaning.unknowns = [];
    meaning.causal_claims = [{ ref: 'effect', from_ref: 'funding', to_ref: 'runway', direction: 'positive', source: source(text),
      coefficient: null, natural_effect: null, standard_deviation: null, existence_probability: null }];
    const compiled = compileSourceMeaning(text, meaning);
    expect(selectSourceFirstClarification(text, meaning, compiled)).toEqual(['How much does "Funding" change "Runway" per stated change in "Funding"?']);
    expect(compiled.graph.edges).toEqual([]);
    meaning.causal_claims[0].to_ref = 'unknown';
    expect(select(meaning, text)).toEqual([]);
  });
});
