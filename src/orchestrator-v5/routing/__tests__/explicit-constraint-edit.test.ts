import { describe, expect, it } from 'vitest';
import { resolveExplicitConstraintEdit } from '../explicit-constraint-edit.js';

type Graph = NonNullable<Parameters<typeof resolveExplicitConstraintEdit>[1]>;
const graph: Graph = {
  nodes: [
    { id: 'funding', kind: 'factor', label: 'Funding Amount Secured', observed_state: { unit: 'GBP' } },
    { id: 'budget', kind: 'factor', label: 'Budget', observed_state: { unit: 'USD' } },
    { id: 'churn', kind: 'risk', label: 'Churn', observed_state: { unit: '%' } },
  ],
  edges: [],
};

// Literal captured offer shape, independent of the renderer used by the resolver.
const fundingOffer = 'Nothing has been changed. I want to confirm this with you before I edit the model, and a limit keeping "Funding Amount Secured" at or above £1,300,000 looks like it would help. Say the word and I will make it.';
const budgetOffer = 'Nothing has been changed. I want to confirm this with you before I edit the model, and a limit keeping "Budget" at or below $40,000 looks like it would help. Say the word and I will make it.';

function expectBound(message: string, target: string, constraintType: string, value: number, unit: string): void {
  const result = resolveExplicitConstraintEdit(message, graph);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(`Expected grounded constraint: ${message}`);
  expect(result.proposal.handler_id).toBe('add_constraint');
  expect(result.proposal.entity.id).toBe(target);
  expect(Object.fromEntries(result.proposal.parameters.map((parameter) => [parameter.name, parameter.value])))
    .toEqual({ constraint_type: constraintType, value, unit });
  expect(result.proposal.parameters.every((parameter) => parameter.source === 'user_explicit')).toBe(true);
}

describe('explicit constraint edit grounding', () => {
  it.each([
    'I actually only have a budget of $40,000 for an assistant.',
    'Somewhere between 20000 and 30000.',
    'Churn is currently 30%.',
  ])('leaves statements and answer-only ambiguity to their existing routes: %s', (message) => {
    expect(resolveExplicitConstraintEdit(message, graph)).toEqual({ status: 'unmatched' });
  });

  it('routes the complete funding floor to a constraint, with native amount preserved', () => {
    expectBound('Funding Amount Secured must be at least £1.3m.', 'funding', 'at_least', 1_300_000, '£');
  });

  it('routes a complete budget cap and percentage cap in user units', () => {
    expectBound('Keep Budget under $40,000.', 'budget', 'at_most', 40_000, '$');
    expectBound('Churn must not exceed 25%.', 'churn', 'at_most', 25, '%');
  });

  it.each(['Make that update.', 'Apply this limit.', '- Make that change.'])('accepts a complete adopted funding offer: %s', (adoption) => {
    expectBound(`${fundingOffer} ${adoption}`, 'funding', 'at_least', 1_300_000, '£');
  });

  it('accepts an adopted complete ceiling offer without converting it into a current reading', () => {
    expectBound(`${budgetOffer} Make that update.`, 'budget', 'at_most', 40_000, '$');
  });

  it('claims a recognised unadopted or modified offer for clarification instead of edit fallback', () => {
    for (const message of [fundingOffer, `${fundingOffer} Explain the analysis.`, `${fundingOffer} Make that update to Budget.`]) {
      expect(resolveExplicitConstraintEdit(message, graph)).toEqual({ status: 'clarify' });
    }
  });

  it.each([
    fundingOffer,
    `${fundingOffer} Is this a good idea?`,
    `${fundingOffer} I disagree.`,
    `${fundingOffer} Explain the analysis.`,
    `The assistant said: ${fundingOffer}`,
    `"${fundingOffer} Make that update."`,
    '"Keep Budget under $40,000."',
    'Someone suggested: Keep Budget under $40,000.',
  ])('does not turn quoted or unadopted text into permission: %s', (message) => {
    expect(resolveExplicitConstraintEdit(message, graph).status).not.toBe('ready');
  });

  it.each([
    'Competitor Budget must not exceed $40,000.',
    'Marketing Budget must not exceed $40,000.',
    'Funding Amount Needed must be at least £1.3m.',
    'Annual Churn must not exceed 25%.',
  ])('does not drop a subject qualifier to bind another node: %s', (message) => {
    expect(resolveExplicitConstraintEdit(message, graph).status).not.toBe('ready');
  });

  it('refuses identical and overlapping graph-label ambiguity', () => {
    const duplicate: Graph = { ...graph, nodes: [...graph.nodes, { id: 'other-budget', kind: 'factor', label: 'Budget' }] };
    const overlapping: Graph = { ...graph, nodes: [...graph.nodes, { id: 'marketing-budget', kind: 'factor', label: 'Marketing Budget' }] };
    for (const ambiguous of [duplicate, overlapping]) {
      expect(resolveExplicitConstraintEdit('Keep Budget under $40,000.', ambiguous).status).not.toBe('ready');
      expect(resolveExplicitConstraintEdit(`${budgetOffer} Make that update.`, ambiguous).status).not.toBe('ready');
    }
  });

  it('does not bind an adopted offer when the named target is absent', () => {
    const otherGraph: Graph = { nodes: graph.nodes.filter((node) => node.id !== 'funding'), edges: [] };
    expect(resolveExplicitConstraintEdit(`${fundingOffer} Make that update.`, otherGraph).status).not.toBe('ready');
  });

  it.each([
    'Keep Budget under £40,000.',
    'Funding Amount Secured must be at least $1.3m.',
    'Churn must not exceed £25.',
  ])('refuses incompatible target denomination: %s', (message) => {
    expect(resolveExplicitConstraintEdit(message, graph).status).not.toBe('ready');
  });

  it('refuses conflicting persisted unit declarations', () => {
    const conflicting: Graph = { nodes: [{ id: 'budget', kind: 'factor', label: 'Budget', data: { unit: 'GBP' }, observed_state: { unit: 'USD' } }], edges: [] };
    expect(resolveExplicitConstraintEdit('Keep Budget under $40,000.', conflicting).status).not.toBe('ready');
  });

  it('does not admit truncated percent-magnitude arithmetic', () => {
    // The existing extractor reads 2k% as 2%; the independent quantity reader
    // must prevent that partial reading from becoming a 2% limit.
    expect(resolveExplicitConstraintEdit('Churn must not exceed 2k%.', graph).status).not.toBe('ready');
  });

  it.each([
    `${fundingOffer} Make that update and rename Budget.`,
    `${fundingOffer} Make that update. Rename Budget.`,
    `${fundingOffer} Make that update to £2,000,000.`,
    `${fundingOffer} Make that update to Budget.`,
    `${fundingOffer} Make that update. Actually, do not change the model.`,
    'Keep Budget under $40,000 and rename Churn.',
    'Keep Budget under $40,000. Churn must not exceed 25%.',
    'Do not apply this: Keep Budget under $40,000.',
  ])('does not borrow authority from a compound or retracted message: %s', (message) => {
    expect(resolveExplicitConstraintEdit(message, graph).status).not.toBe('ready');
  });

  it.each([
    'Add that limit to my model.',
    'Make that update.',
    'Budget is currently $40,000.',
    'Why must Budget stay under $40,000?',
    'Reduce Churn by 25%.',
    'Funding Amount Secured must be at least 1300000.',
  ])('does not invent missing instruction, quantity role, frame or unit: %s', (message) => {
    expect(resolveExplicitConstraintEdit(message, graph).status).not.toBe('ready');
  });

  it('requires an existing supported target and graph', () => {
    expect(resolveExplicitConstraintEdit('Keep Budget under $40,000.', null).status).not.toBe('ready');
    const optionGraph: Graph = { nodes: [{ id: 'budget', kind: 'option', label: 'Budget', observed_state: { unit: 'USD' } }], edges: [] };
    expect(resolveExplicitConstraintEdit('Keep Budget under $40,000.', optionGraph).status).not.toBe('ready');
  });
});
