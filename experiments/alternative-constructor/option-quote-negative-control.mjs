/** Independent registered-payload scoring control for #72 comment 5893015487.
 * It imports no constructor, admission, option marker or Run permission code.
 * These are synthetic graph mutations, not a served registration/Run witness.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scoreRecord } from './score.mjs';

const text = 'The options are raise Pro price to £59, or keep it at £49.';
const span = (quote) => ({ start: text.indexOf(quote), end: text.indexOf(quote) + quote.length });
const facts = [
  { id: 'raise-price', entity: 'price', role: 'intervention', value: 59, unit: 'GBP', option: 'raise', quote: 'raise Pro price to £59' },
  { id: 'keep-price', entity: 'price', role: 'intervention', value: 49, unit: 'GBP', option: 'keep', quote: 'keep it at £49' },
].map((f) => ({ ...f, source_span: span(f.quote) }));
const brief = {
  id: 'quoted-option-replacement', text,
  source_sha256: createHash('sha256').update(text).digest('hex'), facts,
  options: [
    { id: 'raise', pattern: 'raise', quote: facts[0].quote, source_span: facts[0].source_span },
    { id: 'keep', pattern: 'keep', quote: facts[1].quote, source_span: facts[1].source_span },
  ],
};
const option = (id, label, value, quote) => ({
  id, kind: 'option', label, provenance: 'from_brief', source_quote: quote,
  interventions: { price: { raw_value: value, unit: 'GBP', source: 'brief_extraction', source_quote: quote } },
});
const fresh = () => ({
  brief: brief.id, evidence_level: 'synthetic_registered_payload_negative_control_only',
  graph: { nodes: [
    { id: 'price', kind: 'factor', label: 'Pro price', source_quote: 'Pro price' },
    option('raise', 'Raise to £59', 59, facts[0].quote),
    option('keep', 'Keep at £49', 49, facts[1].quote),
  ], edges: [] },
});
const cases = [];
const control = scoreRecord(fresh(), [brief]);
assert.equal(control.fidelity.user_options_retained, 2);
assert.equal(control.fidelity.facts_retained, 2);
assert.equal(control.fidelity.false_user_claims, 0);
cases.push({ name: 'matching_action_control', score: control });

const replacement = fresh();
replacement.graph.nodes[1].label = 'Raise to £54';
replacement.graph.nodes[1].interventions.price.raw_value = 54;
// Worst case: the producer erased the AI marker while attaching the £59 quote.
const bad = scoreRecord(replacement, [brief]);
assert.equal(bad.fidelity.user_options_retained, 1);
assert.equal(bad.options.find((o) => o.id === 'raise').source_bound, false);
assert(bad.fidelity.failures.some((f) => f.kind === 'invented_or_misassigned_user_number' && f.value === 54));
assert(bad.fidelity.failures.some((f) => f.kind === 'invented_user_option' && f.option === 'raise'));
cases.push({ name: 'numeric_replacement_borrows_59_quote_and_erases_ai_marker', score: bad });

replacement.graph.nodes[1].proposed_by = 'olumi';
const marked = scoreRecord(replacement, [brief]);
assert.equal(marked.fidelity.user_options_retained, 1);
assert(marked.fidelity.failures.some((f) => f.kind === 'proposal_in_canonical_model'));
cases.push({ name: 'honest_ai_marker_still_does_not_earn_user_option', score: marked });

const external = fresh();
external.proposals = [structuredClone(replacement.graph.nodes[1])];
const outside = scoreRecord(external, [brief]);
assert.equal(outside.fidelity.user_options_retained, 2);
assert.equal(outside.fidelity.false_user_claims, 0);
assert.equal(outside.authority.external_proposals, 1);
cases.push({ name: 'separate_proposal_does_not_change_user_options', score: outside });

for (const row of cases) console.log(JSON.stringify(row));
console.error(`${cases.length} independent option-quote controls passed; zero provider calls.`);
