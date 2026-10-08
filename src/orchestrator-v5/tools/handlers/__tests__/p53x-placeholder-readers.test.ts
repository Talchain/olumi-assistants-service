/** Science 393023 LICENCE ruling 3 (P53x): the same saved edge owns every reader's words. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { linkSizing } from '../../../../cee/magnitude/link-sizing.js';
import { compactGraph } from '../../../../orchestrator/context/graph-compact.js';
import {
  limitUnitsOf,
  placeholderPartsFinding,
  PLACEHOLDER_PARTS_REASON,
  OLUMI_GUESS_LIMIT_REASON,
} from '../../../../orchestrator/context/placeholder-parts.js';
import type { ContextPackGraph } from '../../../context/context-pack-assembler.js';
import { buildStructureProjectionSummary } from '../../../context/projection-summaries.js';
import { compactGraphForContextPack } from '../../../context/compact-graph-for-contextpack.js';
import type { GraphStateIngress } from '../../../boundary/request-extensions.js';
import { formatGraphForContext } from '../../../format/format-graph-for-context.js';
import { composeExplainFromStructureFallback } from '../explanation-fallback.js';
import { limitChecksForAgent } from '../../../agent-lane/limit-checks.js';
import { honestLimitReply } from '../../../agent-lane/method-turn/what-changes-turn.js';
import { assembleGuidanceSignals } from '../../../agent-lane/turn-context/guidance-signals.js';
import { POLICY } from '../../../agent-lane/guidance/policy.js';

type Rec = Record<string, any>;
const FROM = 'enterprise_prospect_signing_likelihood';
const TO = 'quarterly_revenue';
const FROM_LABEL = 'Enterprise prospect signing likelihood';
const TO_LABEL = 'Quarterly revenue';
const corpus = JSON.parse(readFileSync(new URL('../../../agent-lane/turn-context/__tests__/fixtures/rc-served-signal-cases.json', import.meta.url), 'utf8')) as { cases: Rec[] };
const capture = corpus.cases.find((row) => row.id === 'A-STRENGTHEN-PLACEHOLDER-P1')!;
const servedD1 = (): GraphV3T => structuredClone(capture.body.draft_graph) as GraphV3T;
const targetEdge = (graph: GraphV3T) => graph.edges.find((edge) => edge.from === FROM && edge.to === TO)!;
const sizedD1 = (): GraphV3T => {
  const graph = servedD1();
  const edge = targetEdge(graph);
  edge.strength.std = 0.1;
  edge.provenance = { ...edge.provenance!, magnitude: 'olumi_estimate' };
  return graph;
};

/** Mirrors context-pack-assembler's verbatim compact-edge projection, including its kind indexes. */
function contextGraph(graph: GraphV3T): ContextPackGraph {
  const compact = compactGraph(graph);
  const options = compact.nodes.filter((node) => node.kind === 'option').map(({ id, label }) => ({ id, label }));
  const goals = compact.nodes.filter((node) => node.kind === 'goal');
  return { nodes: compact.nodes, edges: compact.edges, options, goals, constraints: [],
    counts: { nodes: compact.nodes.length, edges: compact.edges.length, options: options.length, goals: goals.length, constraints: 0 } };
}

/** Keep the captured connector and endpoint identities, so every fallback sentence describes THIS pair. */
function targetPair(graph: GraphV3T): GraphV3T {
  return { ...graph, nodes: graph.nodes.filter((node) => node.id === FROM || node.id === TO), edges: [targetEdge(graph)] };
}

describe('P53x: served D1 prospect → revenue, identity-bound across v2 readers', () => {
  it('binds the captured placeholder and the sized control to the canonical predicate', () => {
    expect(capture.capture_sha_matches_case).toBe(true);
    expect(targetEdge(servedD1())).toMatchObject({ from: FROM, to: TO, strength: { mean: 0.5, std: 0.125 },
      defaulted: true, provenance: { source: 'cee_hypothesis' } });
    expect(linkSizing(targetEdge(servedD1()))).toBe('placeholder');
    expect(linkSizing(targetEdge(sizedD1()))).toBe('olumi_estimate');
  });

  it('formatted v2 context says not sized; the same sized link keeps strong positive link', () => {
    const placeholder = formatGraphForContext(contextGraph(servedD1())).edges.find((edge) => edge.from === FROM && edge.to === TO)!;
    // Science 393023 LICENCE ruling 3 (P53x), re-derived: captured defaulted 0.5/0.125 is placeholder, so strong positive link → not sized yet.
    expect(placeholder).toMatchObject({ from_label: FROM_LABEL, to_label: TO_LABEL, relationship: 'not sized yet' });
    expect(placeholder.relationship).not.toMatch(/strong|slight|moderate|estimate/i);
    expect(formatGraphForContext(contextGraph(sizedD1())).edges.find((edge) => edge.from === FROM && edge.to === TO)!.relationship)
      .toBe('strong positive link');
  });

  it('canonical direct formatter and repeated projection cannot lose the placeholder class', () => {
    const graph = servedD1();
    const direct = formatGraphForContext({ ...contextGraph(graph), edges: [targetEdge(graph)] });
    expect(direct.edges[0]!.relationship).toBe('not sized yet');
    expect(formatGraphForContext(direct as unknown as ContextPackGraph)).toEqual(direct);
    const forged = formatGraphForContext({ ...contextGraph(graph), edges: [{ from: FROM, to: TO,
      sizing: 'placeholder', relationship: 'strong positive link' }] });
    expect(forged.edges[0]!.relationship).toBe('not sized yet');
  });

  it('the adapter’s structural fallback preserves the original default-door sizing identity', () => {
    const graph = servedD1();
    graph.nodes[0]!.kind = 'invalid-kind' as never;
    const before = JSON.stringify(graph);
    const outcome = compactGraphForContextPack(graph as unknown as GraphStateIngress, { requestId: 'p53x-served-d1-fallback' });
    expect(outcome).toMatchObject({ kind: 'compacted', via: 'structural_fallback' });
    if (outcome.kind !== 'compacted') throw new Error('Expected served D1 structural fallback');
    const edge = outcome.compact.edges.find((candidate) => candidate.from === FROM && candidate.to === TO)!;
    expect(edge.strength).toBe(0);
    const base = contextGraph(servedD1());
    // Science 393023 LICENCE ruling 3 (P53x), re-derived: fallback’s inert zero was negligible link; the original captured placeholder stays not sized yet.
    expect(formatGraphForContext({ ...base, nodes: outcome.compact.nodes, edges: outcome.compact.edges }).edges
      .find((candidate) => candidate.from === FROM && candidate.to === TO)!.relationship).toBe('not sized yet');
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('a sized numeric compact mean already owns its sign despite a legacy direction field', () => {
    expect(formatGraphForContext({ ...contextGraph(sizedD1()), edges: [{ from: FROM, to: TO,
      strength: 0.5, sizing: 'olumi_estimate', effect_direction: 'negative' }] }).edges[0]!.relationship)
      .toBe('strong positive link');
  });

  it('compact interpretation keeps unsized words and the sized control’s existing adverb', () => {
    const placeholder = contextGraph(servedD1()).edges.find((edge) => (edge as Rec).from === FROM && (edge as Rec).to === TO) as Rec;
    // Science 393023 LICENCE ruling 3 (P53x), re-derived: the captured prior’s moderately increases/confidence wording becomes the not-sized sentence.
    expect(placeholder.plain_interpretation).toBe(`The link from ${FROM_LABEL} to ${TO_LABEL} is not sized yet.`);
    expect(placeholder.coefficient_confidence).toBeUndefined();
    const sized = contextGraph(sizedD1()).edges.find((edge) => (edge as Rec).from === FROM && (edge as Rec).to === TO) as Rec;
    expect(sized.plain_interpretation).toBe(`${FROM_LABEL} moderately increases ${TO_LABEL} (moderate confidence)`);
  });

  it.each([undefined, FROM_LABEL])('explanation fallback on that pair, named factor=%s, never bands its prior', (messageText) => {
    const projection = (graph: GraphV3T) => buildStructureProjectionSummary(contextGraph(targetPair(graph)), {
      relationshipDetailStatus: 'canonical_strict', ...(messageText !== undefined ? { messageText } : {}),
    });
    const placeholder = composeExplainFromStructureFallback(projection(servedD1()));
    // Science 393023 LICENCE ruling 3 (P53x), re-derived: the captured link’s strong/strongest fallback wording becomes a directed link that is not sized yet.
    expect(placeholder).toContain(`The directed link from ${FROM_LABEL} to ${TO_LABEL} is not sized yet.`);
    expect(placeholder).not.toMatch(/strong|slight|moderate|most structural effect|estimated/i);
    const sized = composeExplainFromStructureFallback(projection(sizedD1()));
    expect(sized).toContain('a strong link');
    expect(sized).not.toContain('not sized yet');
  });

  it('a placeholder and estimate with equal means cannot collapse to one canonical strength', () => {
    const context = contextGraph(targetPair(servedD1()));
    const edge = context.edges[0] as Rec;
    const summary = buildStructureProjectionSummary({ ...context, edges: [edge, { ...edge, sizing: 'olumi_estimate' }] },
      { relationshipDetailStatus: 'canonical_strict' });
    expect(summary.relationship_detail_status).toBe('unavailable');
  });
});

describe('P53x: projected-mean contradiction keeps the limit reader’s unsized meaning', () => {
  const LIMIT_NODE = 'sprint_initiatives_tackled_properly';
  const graph = (): Rec => JSON.parse(readFileSync(new URL('../../../../orchestrator/context/__tests__/fixtures/served-799d1a5d-limit-unit.json', import.meta.url), 'utf8')).graph as Rec;
  const options = (g: Rec): Rec[] => g.nodes.filter((node: Rec) => node.kind === 'option' && node.id !== 'continue_current_priorities');
  const limitId = (g: Rec): string => g.goal_constraints.find((row: Rec) => row.node_id === LIMIT_NODE).constraint_id;
  const say = (g: Rec): string => limitChecksForAgent(g, { per_limit: [{ constraint_id: limitId(g), state: 'scored' }],
    joint: { state: 'scored' } } as never)!.find((row) => row.constraint_id === limitId(g))!.say;

  it('which Olumi estimated is retained only for the sized control, never a projected prior', () => {
    const control = graph();
    expect(placeholderPartsFinding(LIMIT_NODE, control.nodes, control.edges, options(control), limitUnitsOf(control.goal_constraints))?.reason)
      .toBe(OLUMI_GUESS_LIMIT_REASON);
    expect(say(control)).toContain('which Olumi estimated');
    const placeholder = graph();
    const targetEdges = placeholder.edges.filter((candidate: Rec) => candidate.to === LIMIT_NODE) as Rec[];
    for (const target of targetEdges) target.provenance.mean_projected = true;
    const edge = targetEdges[0]!;
    expect(edge.provenance.natural_effect.strength_mean).toBe(edge.strength.mean);
    expect(linkSizing(edge)).toBe('placeholder');
    // Science 393023 LICENCE ruling 3 (P53x), re-derived: a projected mean outranks its contradictory natural estimate, moving estimate-only words to unsized links.
    expect(placeholderPartsFinding(LIMIT_NODE, placeholder.nodes, placeholder.edges, options(placeholder), limitUnitsOf(placeholder.goal_constraints))?.reason)
      .toBe(PLACEHOLDER_PARTS_REASON);
    expect(say(placeholder)).toMatch(/hasn.t sized/);
    expect(say(placeholder)).not.toContain('which Olumi estimated');
  });
});

describe('P53x: S1 honest-limit reply follows the selected edge’s sizing', () => {
  const signals = (graph: GraphV3T) => assembleGuidanceSignals({ request: 'method', offeredSpecific: [], graph,
    analysisState: capture.body.analysis_state, analysisResult: capture.body.analysis_result,
    optionParticipation: capture.body.option_participation, explicitRequest: 'RC-WHAT-CHANGES', leaderLicensed: false });

  it('policy copy and renderer never call a selected placeholder Olumi’s estimate', () => {
    const graph = servedD1();
    const s = signals(graph);
    expect(s['model.placeholder_goal_links']).toContain(`${FROM}->${TO}`);
    const reply = honestLimitReply(s, graph);
    // Science 393023 LICENCE ruling 3 (P53x), re-derived: S1 selects the captured placeholder, so it is Olumi’s estimate → this link is not sized yet.
    expect(reply).toContain('how much enterprise prospect signing likelihood affects quarterly revenue');
    expect(reply).toContain('not sized yet');
    expect(reply).not.toMatch(/Olumi.s estimate/);
    const placeholderCopy = (POLICY.method_turns['RC-WHAT-CHANGES'].honest_limit as unknown as { placeholder_text: string }).placeholder_text;
    expect(placeholderCopy).not.toMatch(/Olumi.s estimate/);
  });

  it('same pair sized by Olumi keeps the original estimate copy', () => {
    const graph = targetPair(sizedD1());
    const s = signals(sizedD1());
    // Isolate THIS S3L target from the other unsized connectors in the served graph.
    const selected = { ...s, 'model.goal_path_links': s['model.goal_path_links'].filter((link) => link.link_id === `${FROM}->${TO}`),
      'model.placeholder_goal_links': [], 'model.goal_path_factors': [] };
    expect(honestLimitReply(selected, graph)).toBe("Olumi can't yet measure what would change this choice in this model. The most useful thing to check meanwhile is how much enterprise prospect signing likelihood affects quarterly revenue: it is Olumi's estimate and it sits on the path to your goal.");
  });
});
