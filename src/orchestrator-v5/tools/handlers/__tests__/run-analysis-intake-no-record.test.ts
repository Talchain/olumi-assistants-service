/**
 * ⭐ NO PRODUCER, NO GATE (DL 14 Oct). On the served lane no option carries an option-words record, so a brief that LISTS
 * its options ("The options are …") met the intake axis's `identity_unverified` and lost its leader on every Run, whatever
 * the goal-chance licence said. With no record written, the intake axis has nothing to judge: the leader permission is
 * exactly the one the same model gets from a brief that lists nothing.
 *
 * THE PATH: R8-7's graph through the REAL loader and the REAL handler (`runP0Graph`); the served W3 capture (520aab46)
 * shows a served option carries no record. Rung: TESTED (in-process), not a wire witness.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';


import { extractEnumeratedOptions, deriveIntakeOptionReconciliation, withoutUnwrittenOptionWords } from '../../../../orchestrator/context/intake-option-reconciliation.js';

type Json = Record<string, any>;
import { runP0Graph } from './mc-p0-run-helper.js';
import { admitCandidateLinks } from '../../../agent-lane/admit-candidate.js';

/** R8-7's graph (`mc-p0-round8-final-ruling.test.ts`): an authored link into the goal, so the licence names 'a'. */
const edge = (from: string, to: string, provenance: Json = { source: 'brief_extraction' }) => ({
  from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive', defaulted: true, provenance,
});
function sizedGraph(): Json {
  const [link] = admitCandidateLinks([{ from: 'x', to: 'g', direction: 'positive', provenance: 'explicit', strength_mean: 0.83 }]).edges;
  return { nodes: [
    { id: 'g', kind: 'goal', label: 'Revenue' },
    { id: 'x', kind: 'factor', label: 'Capacity', observed_state: { value: 0.1, source: 'user_override' } },
    { id: 'a', kind: 'option', label: 'Expand', interventions: { x: { value: 0.8, source: 'brief_extraction' } } },
    { id: 'b', kind: 'option', label: 'Pilot', interventions: { x: { value: 0.4, source: 'brief_extraction' } } },
    { id: 'd', kind: 'decision', label: 'Compare capacity options' },
  ], edges: [edge('d', 'a'), edge('d', 'b'), edge('a', 'x'), edge('b', 'x'), link], goal_node_id: 'g' };
}
/** Paul's three journeys' first briefs, verbatim (the live journey's sources, 14 Oct). */
const JOURNEY_BRIEFS: Record<string, string> = {
  "capacity": "We are comparing two staffing options, labelled exactly \"Keep current staffing\" and \"Add one specialist\". Use the exact goal label \"Weekly support capacity\". Our existing team resolves 80 tickets per week. Keep current staffing adds no specialist. Add one specialist adds one specialist. Each additional specialist resolves about 20 tickets per week, between 10 and 30. Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity. Goal: weekly support capacity of at least 100 tickets per week. This target is an absolute level, with no deadline.",
  "hiring": "Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality? We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we're lacking leadership. Our budget is £200,000, but we'd like to spend less.",
  "marketing": "Should I hire a marketing manager, or use an AI tool to plan the campaign for the next product feature launch, and use the money I'd save to spend more on advertising? Our budget for the year is £100,000. I can't spend more than 25% of my time on this, and I'm not that experienced with marketing."
};
const W3 = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const LISTED = 'Should we change our Pro plan price? The options are keep the £49 price, raise to £54, or raise to £59.';

describe('the served lane writes no option-words record, so the intake axis never withholds the leader', () => {
  it('PRECONDITION: the brief lists its options (the reader enumerates them) and no served option carries a record', () => {
    expect(extractEnumeratedOptions(LISTED).length).toBeGreaterThanOrEqual(2);
    const options = (W3.graph.nodes as Json[]).filter((n) => n.kind === 'option');
    expect(options.length).toBe(3);
    for (const o of options) expect(o.source_quote ?? o.provenance?.source_quote ?? o.provenance?.brief_quote).toBeUndefined();
    expect(deriveIntakeOptionReconciliation(LISTED, W3.graph).state, 'staging withheld here').toBe('identity_unverified');
  });

  it('RED: a brief that lists its options gets its leader named when the licence permits, as a brief that lists none', async () => {
    const listed = 'Should we grow our capacity? The options are expand, or pilot.';
    expect(extractEnumeratedOptions(listed).length, 'the reader enumerates this brief').toBeGreaterThanOrEqual(2);
    expect(deriveIntakeOptionReconciliation(listed, sizedGraph()).state, 'staging withheld here').toBe('identity_unverified');
    const unlisted = await runP0Graph(sizedGraph(), 'Compare the options.');
    expect(unlisted.leading_option_id, 'control: the licence names the most likely option on this Run').toBe('a');
    const r = await runP0Graph(sizedGraph(), listed);
    expect(r.leading_option_id).toBe('a');
    expect(String(r.summary)).not.toContain('correspondence is confirmed');
  });

  it.each(Object.entries(JOURNEY_BRIEFS))('UNCHANGED: the %s journey brief lists nothing the reader enumerates, so it never met this gate', (_j, brief) => {
    expect(extractEnumeratedOptions(brief)).toEqual([]);
    expect(deriveIntakeOptionReconciliation(brief, W3.graph).state).toBe('not_applicable');
  });

  it('CONTROL: a model whose options DO carry a record keeps the full check (an unmatched record still withholds)', () => {
    const graph = clone(W3.graph);
    for (const n of graph.nodes as Json[]) if (n.kind === 'option') n.source_quote = 'a quote the brief does not hold';
    const derived = deriveIntakeOptionReconciliation(LISTED, graph);
    expect(derived.state).toBe('identity_unverified');
    expect(withoutUnwrittenOptionWords(derived, graph).state).toBe('identity_unverified');
    expect(withoutUnwrittenOptionWords(derived, graph).mayNameLeadingOption).toBe(false);
  });
});
