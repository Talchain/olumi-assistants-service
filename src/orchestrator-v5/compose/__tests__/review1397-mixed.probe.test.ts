import { describe, expect, it } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import { enforceLeadingOptionClaimsAtWire, textNamesAnOption } from '../leading-option-wire-enforcement.js';
import { textAssertsLeadingOption } from '../leading-option-egress-guard.js';
import { splitIntoRedactableUnits } from '../redactable-units.js';

// Synthetic control for the same existing distributed-claim contract. The
// comparator name is not the subject whose identity the assertion borrows.
const LEAD = 'Hire a Hands-on Technical Lead';
const OTHER = 'Two Developers';
const graph = { nodes: [
  { id: 'lead', kind: 'option', label: LEAD },
  { id: 'other', kind: 'option', label: OTHER },
], edges: [] };
const opts = { graph, requestId: 'independent1397', exitPath: 'edit_graph' as const };
const roster = [LEAD, OTHER];
function envelope(text: string) {
  return OlumiResponseSchema.parse({ response_version: 2, assistant_text: text,
    blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse' });
}
const distributed = `${LEAD} is strong. It leads in 54% of simulations.`;
const comparator = `${LEAD} is strong. It leads in 54% of simulations against ${OTHER}.`;

describe('independent1397 distributed comparator identity', () => {
  it('pins the two real units and names-only-comparator assertion', () => {
    const units = splitIntoRedactableUnits(comparator).filter(unit => !/^\s+$/.test(unit));
    expect(units).toHaveLength(2);
    expect(textAssertsLeadingOption(units[0], { optionLabels: roster })).toBe(false);
    expect(textAssertsLeadingOption(units[1], { optionLabels: roster })).toBe(true);
    expect(textNamesAnOption(units[1], roster)).toBe(true);
    expect(units[1]).not.toContain(LEAD);
  });
  it('retains the original no-comparator distributed control', () => {
    const result = enforceLeadingOptionClaimsAtWire(envelope(distributed), { ...opts, mayNameLeadingOption: false });
    expect(result.response.assistant_text).not.toContain(LEAD);
    expect(result.changed).toBe(true);
  });
  it('removes a borrowed leader even when its assertion names a comparator', () => {
    const result = enforceLeadingOptionClaimsAtWire(envelope(comparator), { ...opts, mayNameLeadingOption: false });
    expect(result.response.assistant_text).not.toContain(LEAD);
    expect(result.changed).toBe(true);
  });
  it('preserves the exact same comparator-bearing input when permitted', () => {
    const input = envelope(comparator);
    const result = enforceLeadingOptionClaimsAtWire(input, { ...opts, mayNameLeadingOption: true });
    expect(result.response).toBe(input);
    expect(result.changed).toBe(false);
  });
  it('does not let one self-named predicate hide another borrowed predicate in the same unit', () => {
    const text = `${LEAD} is strong. It leads in 54% of simulations against ${OTHER}, while ${OTHER} leads on cost.`;
    const units = splitIntoRedactableUnits(text).filter(unit => !/^\s+$/.test(unit));
    expect(units).toHaveLength(2);
    expect(units[1]).toContain('It leads');
    expect(units[1]).toContain(`${OTHER} leads`);
    const result = enforceLeadingOptionClaimsAtWire(envelope(text), { ...opts, mayNameLeadingOption: false });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).not.toContain(LEAD);
    expect(result.response.assistant_text).not.toContain('54%');
  });
  it('keeps conditional prose when both predicates in the mixed unit name their own subjects', () => {
    const conditional = `If ${LEAD} helped unblock architecture, document the evidence.`;
    const text = `${conditional}\n\n${LEAD} leads in 54% of simulations against ${OTHER}, while ${OTHER} leads on cost.`;
    const result = enforceLeadingOptionClaimsAtWire(envelope(text), { ...opts, mayNameLeadingOption: false });
    expect(result.changed).toBe(true);
    expect(result.response.assistant_text).toContain(conditional);
    expect(result.response.assistant_text).not.toContain('54%');
  });
  it('preserves the mixed borrowed/named input byte-for-byte when permitted', () => {
    const text = `${LEAD} is strong. It leads in 54% of simulations against ${OTHER}, while ${OTHER} leads on cost.`;
    const input = envelope(text);
    const result = enforceLeadingOptionClaimsAtWire(input, { ...opts, mayNameLeadingOption: true });
    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
  });
});
