import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CEE_OWNED_EDGE_FIELDS } from '../../../graph-management/field-safety.js';
import { keepMeanProjectionWhenSizeUnchanged } from '../../../../cee/magnitude/link-sizing.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash as hash } from '../../../context/graph-hash.js';
import { unsizedLeaderGoalPaths } from '../../../agent-lane/goal-certainty.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';
import { appendLegacyFiguresAfterLeaderSentence, isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';
import { runP0Outcome } from './mc-p0-run-helper.js';

type R = Record<string, any>;
// The buddy's private PURE helper, verbatim from the current route, with real
// ingress/projection/hash/licence readers. No production visibility change.
const source = readFileSync('src/routes/assist.v1.scenario-graph-register.ts', 'utf8');
const section = source.slice(source.indexOf('const isEdgeRecord ='), source.indexOf('export const SCENARIO_GRAPH_REGISTRATION_SCHEMA'));
const carry = new Function('keepMeanProjectionWhenSizeUnchanged', 'CEE_OWNED_EDGE_FIELDS',
  ts.transpileModule(section, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  + ';return withStoredEdgeFactsWhenUnstated;')(keepMeanProjectionWhenSizeUnchanged, CEE_OWNED_EDGE_FIELDS) as (g: R, old: R) => R;
function graph(): R {
  return { nodes: [
    { id: 'a', kind: 'option', label: 'Expand', interventions: { x: { value: 0.8, source: 'brief_extraction' } } },
    { id: 'b', kind: 'option', label: 'Hold', interventions: { x: { value: 0.1, source: 'brief_extraction' } } },
    { id: 'x', kind: 'factor', label: 'Capacity', observed_state: { value: 0.1, source: 'user_override' } },
    { id: 'g', kind: 'goal', label: 'Revenue' },
  ], edges: [{ id: 'old-edge', from: 'x', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8,
    effect_direction: 'positive', defaulted: true, provenance: { source: 'cee_hypothesis', mean_projected: true } }], goal_node_id: 'g' };
}
const registered = (g: R, before: R): R => projectGraphForPersistence(carry(GraphStateIngressSchema.parse(g), before)) as R;
const graphHash = (g: R) => hash(g as never);

describe('R9 F1 conservative registration hash guard', () => {
  it.each(['same-id', 'new-id', 'duplicate'])('buddy row %s keeps flag, hash and licence', change => {
    const before = graph();
    if (change === 'duplicate') before.edges.push(structuredClone(before.edges[0]));
    const proposed = structuredClone(before);
    for (const e of proposed.edges) { delete e.provenance.mean_projected; if (change === 'new-id') e.id = 'new-edge'; }
    const after = registered(proposed, before);
    expect(after.edges.every((e: R) => e.provenance.mean_projected === true)).toBe(true);
    expect(graphHash(after)).toBe(graphHash(before));
    expect(unsizedLeaderGoalPaths(after, ['a', 'b'])).toEqual(unsizedLeaderGoalPaths(before, ['a', 'b']));
    expect(unsizedLeaderGoalPaths(after, ['a', 'b']).map(p => p.option_id)).toEqual(['a']);
  });
  it('unequal duplicate counts and reordered ids keep every matching flagged size, leave changed sizes clear', () => {
    const before = graph();
    const unflagged = structuredClone(before.edges[0]); unflagged.id = 'unflagged'; delete unflagged.provenance.mean_projected;
    before.edges.push(unflagged);
    const proposed = structuredClone(before);
    proposed.edges.reverse(); proposed.edges.push(structuredClone(proposed.edges[0]));
    proposed.edges.push(structuredClone(proposed.edges[0]));
    proposed.edges[3].strength.mean = 0.6;
    for (const e of proposed.edges) delete e.provenance.mean_projected;
    const after = registered(proposed, before);
    expect(after.edges.slice(0, 3).every((e: R) => e.provenance.mean_projected === true)).toBe(true);
    expect(after.edges[3].provenance.mean_projected).toBeUndefined();
  });
  it('an omitted whole provenance on an unflagged duplicate cannot undo conservative carry', () => {
    const before = graph();
    const unflagged = structuredClone(before.edges[0]); unflagged.id = 'unflagged'; delete unflagged.provenance.mean_projected;
    before.edges.push(unflagged);
    const proposed = structuredClone(before);
    for (const e of proposed.edges) delete e.provenance;
    const after = registered(proposed, before);
    expect(after.edges.every((e: R) => e.provenance.mean_projected === true)).toBe(true);
    expect(after.edges.every((e: R) => e.provenance.source === 'cee_hypothesis')).toBe(true);
    expect(graphHash(after)).toBe(graphHash(before));
  });
  it.each(['mean', 'magnitude'])('real user %s change clears the carrier and moves hash', field => {
    const before = graph(); const proposed = structuredClone(before);
    delete proposed.edges[0].provenance.mean_projected;
    if (field === 'mean') proposed.edges[0].strength.mean = 0.6;
    else proposed.edges[0].provenance.magnitude = 'user_stated';
    const after = registered(proposed, before);
    expect(after.edges[0].provenance.mean_projected).toBeUndefined();
    expect(graphHash(after)).not.toBe(graphHash(before));
  });
});

describe('R9 F3 carrier-only helper', () => {
  it.each(['std', 'existence'])('no-carrier %s write stands as sent', field => {
    const before = graph().edges[0]; before.provenance = { source: 'user_specified' };
    const proposed = structuredClone(before); delete proposed.provenance;
    if (field === 'std') proposed.strength.std = 0.2; else proposed.exists_probability = 0.7;
    expect(keepMeanProjectionWhenSizeUnchanged(before, proposed)).toBe(proposed);
    expect(carry({ edges: [proposed] }, { edges: [before] }).edges[0]).toEqual(proposed);
  });
  it('omitted provenance carries only the flag when std changes', () => {
    const before = graph().edges[0]; before.provenance.reasoning = 'old reasoning';
    const proposed = structuredClone(before); delete proposed.provenance; proposed.strength.std = 0.2;
    expect(keepMeanProjectionWhenSizeUnchanged(before, proposed).provenance).toEqual({ mean_projected: true });
    expect(carry({ edges: [proposed] }, { edges: [before] }).edges[0].provenance).toEqual({ mean_projected: true });
  });
});

describe('R9 F2 exact Science disclosure with graph labels', () => {
  it.each(['Customer trust', 'Customer’s trust', 'Time to ‘yes’', 'Customer’s $& trust'])('real Run + registry keeps leader and exact disclosure for %s', async label => {
    const g = graph(); delete g.edges[0].provenance.mean_projected; g.nodes.find((n: R) => n.id === 'x').label = label;
    // The buddy's Run pair includes the analysis-ready structural topology.
    g.nodes.push({ id: 'd', kind: 'decision', label: 'Work' });
    for (const [from, to] of [['d', 'a'], ['d', 'b'], ['a', 'x'], ['b', 'x']]) {
      g.edges.push({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8,
        effect_direction: 'positive', defaulted: true, provenance: { source: 'cee_hypothesis' } });
    }
    const outcome = await runP0Outcome(g, 'Compare the options.');
    const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis')!;
    if (fact.fact_type !== 'run_analysis') throw new Error('missing Run fact');
    const disclosure = ` Olumi supplied the figures for the link from ‘${label}’ to ‘Revenue’. Set your own to see how much it matters.`;
    expect(fact.result.leading_option_id).toBe('a');
    expect(outcome.assistant_text).toMatch(/^Expand was supported by 80% of runs of this model/);
    expect(outcome.assistant_text).toContain(disclosure);
    const confirm = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
    if (typeof confirm !== 'function') throw new Error('Run confirmation must be a forwarder');
    expect(confirm(outcome)).toBe(outcome.assistant_text);
    expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text, '', disclosure)).toBe(true);
    const followup = appendLegacyFiguresAfterLeaderSentence('Expand was supported by 80% of runs of this model. Run the follow-up checks before treating this as final.', disclosure);
    expect(followup).toContain(`${disclosure} Run the follow-up checks`);
    expect(isAllowedRunAnalysisAssistantText(followup, '', disclosure)).toBe(true);
    const forged = { ...outcome, assistant_text: outcome.assistant_text.replace(disclosure, disclosure.replace(label, 'Unrelated label')) };
    expect(confirm(forged)).not.toContain('Unrelated label');
    expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text + disclosure, '', disclosure)).toBe(false);
  });
});
