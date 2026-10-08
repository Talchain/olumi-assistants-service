/**
 * ⭐ F1 — A BAND EDIT NEVER SILENTLY DROPS THE USER'S OWN FIGURE (red team #87 6006627551; DL lease to c6, #87 6006752323;
 * Science d5 CONFIRMED 6006667946; DL Review Desk class check: the generic merges).
 *
 * Served before the fix (CEE 90ff4888 / 0b85aefc, guest T1b 05bed7cf, 3/3): a canvas band in band, a canvas band across
 * bands, and chat "make … weak" on a link the user sized in their brief each deleted `natural_effect` + `magnitude`,
 * kept a stale `source_quote`, and said only "Its strength is still strong" / "from slight to moderate" / "Recorded …
 * as slight". The next Run asked again for the size the user had given.
 *
 * Every row binds the link by its endpoint pair and its stored bytes, never a value another link could satisfy.
 */
import { describe, expect, it } from 'vitest';
import { OrchestratorTurnPayloadSchema, type SystemEventTurnPayload } from '@talchain/schemas/boundary';

import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { applyPatchOperations, PatchApplyError } from '../../../orchestrator/patch-applier.js';
import { runWithStatedLinkBand, type StatedLinkBand } from '../../agent-lane/stated-link-band-context.js';
import { edgeBandStd } from '../../format/edge-strength-bands.js';
import { REPLACE_KEEPS_DIRECTION_TEXT } from '../../../cee/magnitude/user-figure-held.js';
import { buildUpdateEdgeFieldCandidate } from '../../graph-management/candidate-graph.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { createAdjustEdgeStrengthHandler } from '../../tools/handlers/adjust-edge-strength.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { ProposalAction } from '../../routing/types.js';
import { applyEdgeStrengthEdit } from '../edge-strength-edit.js';

type EdgeStrengthEditEvent = Extract<SystemEventTurnPayload['event'], { kind: 'edge_strength_edit' }>;

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID = '11111111-1111-4111-8111-111111111177';
const FROM = 'f-budget';
const TO = 'g-revenue';
const QUOTE = 'Each lost customer removes £300 a month';
const refusal = (band: string): string =>
  `This link holds your figure: ‘${QUOTE}’. Change the figure, or say ‘replace my figure with ${band}’.`;
const replaced = (band: string): string => `Replaced your figure (‘${QUOTE}’) with ‘${band}’.`;

type Sizing = 'user_stated' | 'olumi_estimate' | 'user_band';
/** The link as the brief left it: the user's figure, in natural units, with the sentence that stated it. */
function heldGraph(mean = 0.62, sizing: Sizing = 'user_stated', writtenFor = mean): GraphV3T {
  const graph = buildD1Fixture();
  const edge = edgeIn(graph);
  edge.strength = { mean, std: 0.12 };
  edge.effect_direction = mean < 0 ? 'negative' : 'positive';
  const natural = {
    amount: mean < 0 ? -300 : 300, amount_unit: 'GBP/month', per_source_change: 1, per_source_change_unit: 'customer',
    strength_mean: writtenFor, strength_mean_frame: 'edge_strength' as const,
  };
  edge.provenance = (sizing === 'user_stated'
    ? { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: natural, source_quote: QUOTE }
    : sizing === 'olumi_estimate'
      ? { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: natural }
      // A band the user picked earlier: theirs, but it carries no figure.
      : { source: 'user_specified' }) as never;
  return graph;
}

function edgeIn(graph: unknown): GraphV3T['edges'][number] & Record<string, unknown> {
  return (graph as GraphV3T).edges.find((e) => e.from === FROM && e.to === TO)! as never;
}

function event(magnitude: number, expectedMean: number, extra: Partial<EdgeStrengthEditEvent> = {}): EdgeStrengthEditEvent {
  return {
    kind: 'edge_strength_edit', from: FROM, to: TO, magnitude, direction_intent: 'preserve',
    expected: { mean: expectedMean, effect_direction: expectedMean < 0 ? 'negative' : 'positive' }, intent: 'set', ...extra,
  };
}

async function apply(graph: unknown, ev: EdgeStrengthEditEvent) {
  const payload = OrchestratorTurnPayloadSchema.parse({
    kind: 'system_event', turn_id: TURN_ID, scenario_id: SCENARIO_ID, stage: 'analyse', event: ev,
  }) as SystemEventTurnPayload;
  return await applyEdgeStrengthEdit({ payload, event: ev, requestId: 'req-f1', persistedGraph: graph });
}

/** The Agent's verified approval, in-process (`agent-capabilities.ts`): the band the user named, and their replace if they asked. */
const approval = (band: StatedLinkBand['band'], replaces: boolean, to = TO): StatedLinkBand => ({
  scenarioId: SCENARIO_ID, proposalId: 'prop-f1', from: FROM, to, band, ...(replaces ? { replacesUserFigure: true as const } : {}),
});

describe('⭐ F1 — the canvas, the slider and the chat approval never drop the user’s figure', () => {
  it.each([
    // The served pill sends the band's MIDPOINT and no `band` (DGAI 2fc2128d `strengthBandWire.ts`: not wired yet).
    ['(a) canvas pill “Strong” on a link already strong (served shape: midpoint 0.55)', 0.62, event(0.55, 0.62), 'strong'],
    ['(b) canvas pill slight → moderate (served shape: midpoint 0.3)', 0.15, event(0.3, 0.15), 'moderate'],
    ['(a′) the same pill once it states its band (schemas 0.60.0 `band`)', 0.62, event(0.55, 0.62, { band: 'strong' }), 'strong'],
    ['(d) the slider / β field (an exact figure)', 0.62, event(0.5, 0.62), 'strong'],
  ] as const)('RED-TEAM %s: refused in the writer’s words, the figure quoted, the link byte-identical', async (_n, mean, ev, band) => {
    const graph = heldGraph(mean);
    const before = structuredClone(graph);
    const result = await apply(graph, ev);
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('user_figure_held');
    if (result.kind !== 'refused') return;
    expect(result.response.assistant_text).toBe(refusal(band));
    expect(graph).toStrictEqual(before);
  });

  it('RED-TEAM (c) chat “make … weak”, approved with the band but no replace: refused, “slight” in the canvas’s word', async () => {
    const graph = heldGraph(0.62);
    const before = structuredClone(graph);
    const result = await runWithStatedLinkBand(approval('weak', false), () => apply(graph, event(0.1, 0.62)));
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('user_figure_held');
    if (result.kind !== 'refused') return;
    expect(result.response.assistant_text).toBe(refusal('slight'));
    expect(graph).toStrictEqual(before);
  });

  it('REPLACE (the user’s own “replace my figure with slight”): midpoint, the band’s spread, sizing user, sign kept, figure + magnitude + quote dropped together, receipt names it', async () => {
    const graph = heldGraph(0.62);
    const result = await runWithStatedLinkBand(approval('weak', true), () => apply(graph, event(0.1, 0.62)));
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const stored = edgeIn(result.mutatedGraph);
    expect(stored.strength.mean).toBe(0.1);
    expect(stored.strength.std).toBe(edgeBandStd('weak'));
    expect(stored.strength.std).not.toBe(0.12);
    expect(stored.effect_direction).toBe('positive');
    const p = stored.provenance as Record<string, unknown>;
    expect(p.source).toBe('user_specified');
    expect(p).not.toHaveProperty('natural_effect');
    expect(p).not.toHaveProperty('magnitude');
    expect(p).not.toHaveProperty('source_quote');
    expect(result.response.assistant_text.startsWith(replaced('slight')), result.response.assistant_text).toBe(true);
  });

  it('REPLACE on a link that LOWERS its target keeps the sign (d5: the sign is kept)', async () => {
    const graph = heldGraph(-0.62);
    const result = await runWithStatedLinkBand(approval('weak', true), () => apply(graph, event(0.1, -0.62)));
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect(edgeIn(result.mutatedGraph).strength.mean).toBe(-0.1);
    expect(edgeIn(result.mutatedGraph).effect_direction).toBe('negative');
  });

  it('BUDDY r1 #4: a replace at a midpoint EQUAL to the stored mean is still a replace — the band’s spread, the figure dropped', async () => {
    const graph = heldGraph(0.55);
    const result = await runWithStatedLinkBand(approval('strong', true), () => apply(graph, event(0.55, 0.55)));
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const stored = edgeIn(result.mutatedGraph);
    expect(stored.strength).toStrictEqual({ mean: 0.55, std: edgeBandStd('strong') });
    expect(stored.provenance).not.toHaveProperty('natural_effect');
    expect(stored.provenance).not.toHaveProperty('source_quote');
    expect(result.response.assistant_text.startsWith(replaced('strong')), result.response.assistant_text).toBe(true);
  });

  it('BUDDY r1 #5: a replace that would also REVERSE the link is refused (the sign is kept), nothing written', async () => {
    const graph = heldGraph(0.62);
    const before = structuredClone(graph);
    const result = await runWithStatedLinkBand(approval('weak', true), () => apply(graph, event(0.1, 0.62, { direction_intent: 'negative' })));
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('replace_keeps_direction');
    if (result.kind !== 'refused') return;
    expect(result.response.assistant_text).toBe(REPLACE_KEEPS_DIRECTION_TEXT);
    expect(graph).toStrictEqual(before);
  });

  it('the replace is scoped to its own link: an approval that carried it for ANOTHER link replaces nothing here', async () => {
    const graph = heldGraph(0.62);
    const result = await runWithStatedLinkBand(approval('weak', true, 'g-other'), () => apply(graph, event(0.1, 0.62)));
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('user_figure_held');
  });

  it('CONTROL — a confirm (review) keeps the figure and its quote byte-equal, never refused', async () => {
    const graph = heldGraph(0.62);
    const result = await apply(graph, event(0.62, 0.62, { intent: 'confirm_current' }));
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const p = edgeIn(result.mutatedGraph).provenance as Record<string, unknown>;
    expect(p.natural_effect).toStrictEqual((edgeIn(graph).provenance as Record<string, unknown>).natural_effect);
    expect(p.source_quote).toBe(QUOTE);
    expect(p.magnitude).toBe('user_stated');
  });

  it.each([
    ['Olumi’s estimate', 'olumi_estimate', 0.62],
    ['a band the user picked earlier (no figure)', 'user_band', 0.62],
    // BUDDY r1 #6: a stale carrier (written for 0.4, the link now 0.62) states nothing a write could lose.
    ['a STALE user figure (written for another mean)', 'user_stated', 0.4],
  ] as const)('TWIN — %s: the same canvas pill still edits the link', async (_n, sizing, writtenFor) => {
    const result = await apply(heldGraph(0.62, sizing, writtenFor), event(0.3, 0.62, { band: 'moderate' }));
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect(edgeIn(result.mutatedGraph).strength.mean).toBe(0.3);
  });
});

function invocation(graph: GraphV3T, strength: number, replaces = false): HandlerInvocation {
  const proposal: ProposalAction = {
    handler_id: 'adjust_edge_strength',
    entity: { id: `${FROM}→${TO}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'strength', value: strength, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: ['graph.edges'],
  } as ProposalAction;
  return {
    context: { session_id: 'scn-1', stage: 'frame', request_id: 'req-1', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null } as unknown as HandlerInvocation['context'],
    payload: { kind: 'message', scenario_id: 'scn-1', turn_id: 'turn-1', stage: 'frame', message: 'make it moderate' } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1', signal: new AbortController().signal, orientationText: '', proposal, graphForTurn: graph,
    edgeStrengthEndpointAuthority: { from: FROM, to: TO },
    ...(replaces ? { edgeStrengthReplacesUserFigureAuthority: true as const } : {}),
  };
}

describe('⭐ F1 — the writer refuses for EVERY caller (the legacy NL path reaches it without the adapter)', () => {
  it('RED: a move on a link holding the user’s figure is refused with their figure quoted; nothing is returned to write', async () => {
    const graph = heldGraph(0.62);
    const before = structuredClone(graph);
    await expect(createAdjustEdgeStrengthHandler()(invocation(graph, 0.3))).rejects.toMatchObject({
      cause_kind: 'precondition_unmet_at_execute',
      details: { reason: 'user_figure_held', specific_issue: refusal('moderate') },
    });
    expect(graph).toStrictEqual(before);
  });

  it('#2848: a user’s strength on Olumi’s estimate drops Olumi’s `basis` with Olumi’s size', async () => {
    const graph = heldGraph(0.62, 'olumi_estimate');
    (edgeIn(graph).provenance as Record<string, unknown>).basis = 'bigger deals need more support';
    const outcome = await createAdjustEdgeStrengthHandler()(invocation(graph, 0.3));
    const stored = edgeIn(outcome.mutated_graph);
    expect(stored.strength.mean).toBe(0.3);
    expect(stored.provenance).not.toHaveProperty('basis');
  });

  it('with the user’s replace authority it writes, drops the quote with the figure, and says what it replaced', async () => {
    const outcome = await createAdjustEdgeStrengthHandler()(invocation(heldGraph(0.62), 0.3, true));
    const stored = edgeIn(outcome.mutated_graph);
    expect(stored.provenance).not.toHaveProperty('source_quote');
    expect(stored.provenance).not.toHaveProperty('natural_effect');
    expect(String(outcome.assistant_text).startsWith(replaced('moderate')), String(outcome.assistant_text)).toBe(true);
  });
});

describe('⭐ F1 — the generic merges (DL Review Desk class check): applier and referee in parity', () => {
  const path = `${FROM}::${TO}`;

  it('RED: patch-applier `update_edge` moving the strength of a link holding the user’s figure throws USER_FIGURE_HELD', () => {
    const graph = heldGraph(0.62);
    let caught: unknown;
    try { applyPatchOperations(graph, [{ op: 'update_edge', path, value: { strength: { mean: 0.3 } } }] as never); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(PatchApplyError);
    expect((caught as PatchApplyError).code).toBe('USER_FIGURE_HELD');
    expect((caught as PatchApplyError).message).toBe(refusal('moderate'));
  });

  it('CONTROL: an `update_edge` that leaves the strength (existence only) keeps the figure', () => {
    const out = applyPatchOperations(heldGraph(0.62), [{ op: 'update_edge', path, value: { exists_probability: 0.8 } }] as never);
    expect((edgeIn(out).provenance as Record<string, unknown>).source_quote).toBe(QUOTE);
  });

  it('TWIN: the same `update_edge` on Olumi’s estimate still applies', () => {
    const out = applyPatchOperations(heldGraph(0.62, 'olumi_estimate'), [{ op: 'update_edge', path, value: { strength: { mean: 0.3 } } }] as never);
    expect(edgeIn(out).strength.mean).toBe(0.3);
  });

  it('REACH: `add_edge` (structure-tools) cannot touch an existing link — EDGE_ALREADY_EXISTS, the figure untouched', () => {
    const graph = heldGraph(0.62);
    let caught: unknown;
    try {
      applyPatchOperations(graph, [{ op: 'add_edge', path, value: { from: FROM, to: TO, strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified' } } }] as never);
    } catch (err) { caught = err; }
    expect((caught as PatchApplyError).code).toBe('EDGE_ALREADY_EXISTS');
  });

  it('RED: the referee’s `update_edge_field` candidate refuses the same move, in the same words (held, never adopted)', () => {
    const built = buildUpdateEdgeFieldCandidate(heldGraph(0.62), { from_node: FROM, to_node: TO, field: 'strength.mean', to: 0.3 });
    expect(built.candidate).toBeUndefined();
    expect(built.error?.readable).toBe(refusal('moderate'));
  });

  it('TWIN: the referee still builds the candidate on Olumi’s estimate', () => {
    const built = buildUpdateEdgeFieldCandidate(heldGraph(0.62, 'olumi_estimate'), { from_node: FROM, to_node: TO, field: 'strength.mean', to: 0.3 });
    expect(built.error).toBeUndefined();
    expect(edgeIn(built.candidate).strength.mean).toBe(0.3);
  });
});
