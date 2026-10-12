/**
 * ⭐ R11 — A CONFIRMATION IS REVIEW, NOT AUTHORSHIP (AI Quality #72 5872082179; adopted by the Delivery Lead).
 *
 * The estate already ruled this on 20 Sep (`cee/graph-readiness/obligation-provenance.ts`
 * `earnsAuthorshipCredit`): the product promises the leader claim stays withheld "until you have SET" a value, and a
 * confirmation sets nothing. The bypass was the EDGE WRITER: a confirm stamped `provenance.source: 'user_specified'`
 * and dropped `defaulted`, so one click on an Olumi placeholder licensed naming a winner.
 *
 * The rule:
 *   · credit only on a persisted write-time `set` that CHANGED the value;
 *   · every confirm (or a `set` whose result equals the current strength) is stored as RATIFIED, not authored —
 *     `provenance.source`, `magnitude`, `natural_effect`, `reasoning`, `provenance_display` and the edge's
 *     `defaulted` / `exists_defaulted` / `std_defaulted` flags are KEPT, and `provenance.reviewed_by_user`
 *     (`{ intent: 'confirm', at, band? }`) is ADDED (storage: Canonical lead, accepted by the DL in the #2235 verdict);
 *   · a defaulted strength never earns credit, whatever the link's source.
 *
 * Every row goes through the REAL writers: the `adjust_edge_strength` handler (the Agent's path) and the canvas
 * `edge_strength_edit` adapter (which routes into the same handler), and reads the licence off the ONE census
 * (`censusConfidenceParameters` → `semanticQualitySufficient`, the leader licence `analysis-admission.ts` publishes).
 */
import { describe, expect, it } from 'vitest';

import {
  OrchestratorTurnPayloadSchema,
  type SystemEventTurnPayload,
} from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import {
  censusConfidenceParameters,
  semanticQualitySufficient,
} from '../../../admission/analysis-admission.js';
import { edgeBandStd } from '../../../format/edge-strength-bands.js';
import type { ProposalAction } from '../../../routing/types.js';
import {
  applyEdgeStrengthEdit,
  isProvenanceOnlyEdgeConfirmation,
} from '../../../system-events/edge-strength-edit.js';
import type { HandlerInvocation } from '../../registry.js';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';
import { edgeStrengthProvenance, earnsAuthorshipCredit } from '../../../../cee/graph-readiness/obligation-provenance.js';
import { linkSizing } from '../../../../cee/magnitude/link-sizing.js';
import { createAgentCapabilities, type InternalDispatch } from '../../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';

type EdgeStrengthEditEvent = Extract<SystemEventTurnPayload['event'], { kind: 'edge_strength_edit' }>;
type Edge = GraphV3T['edges'][number];

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '11111111-1111-4111-8111-111111111311';
const FROM = 'fac_price';
const TO = 'goal_1';
const MEAN = 0.5;
const STD = 0.1;

/**
 * A graph the census can license: two options set `fac_price`, and `fac_price → goal_1` is the ONE material causal
 * link. The factor's own baseline is Olumi's (`cee_inference`), so the licence turns on that link alone.
 */
function graphWith(target: Partial<Edge> & { provenance?: Edge['provenance'] }): GraphV3T {
  const graph = {
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Pricing decision' },
      { id: 'goal_1', kind: 'goal', label: 'Grow revenue' },
      { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 10, source: 'cee_inference' } },
      {
        id: 'opt_a',
        kind: 'option',
        label: 'Raise price',
        interventions: { fac_price: { value: 12, source: 'brief_extraction' } },
      },
      {
        id: 'opt_b',
        kind: 'option',
        label: 'Hold price',
        interventions: { fac_price: { value: 9, source: 'brief_extraction' } },
      },
    ],
    edges: [
      {
        from: 'dec_1',
        to: 'opt_a',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis' },
      },
      {
        from: 'dec_1',
        to: 'opt_b',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis' },
      },
      {
        from: FROM,
        to: TO,
        strength: { mean: MEAN, std: STD },
        exists_probability: 0.9,
        effect_direction: 'positive',
        ...target,
      },
      {
        from: 'opt_a',
        to: 'fac_price',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
      {
        from: 'opt_b',
        to: 'fac_price',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
    ],
  };
  // The fixture must be a graph the writers accept, or every row below would be a refusal, not a verdict.
  return GraphV3.parse(graph);
}

/** A placeholder: Olumi's default strength on Olumi's hypothesis, with Olumi's sizing and reasoning. */
function placeholder(): GraphV3T {
  return graphWith({
    defaulted: true,
    provenance: {
      source: 'cee_hypothesis',
      magnitude: 'olumi_placeholder',
      reasoning: 'Olumi: higher prices usually lift revenue per customer.',
    },
    provenance_display: 'ai_inferred',
  });
}

/** A link the brief named, whose STRENGTH Olumi defaulted. */
function briefDefaulted(): GraphV3T {
  return graphWith({
    defaulted: true,
    provenance: { source: 'brief_extraction', magnitude: 'olumi_placeholder' },
    provenance_display: 'from_brief',
  });
}

const licensed = (graph: unknown): boolean => semanticQualitySufficient(censusConfidenceParameters(graph));

function edgeOf(graph: unknown): Record<string, unknown> {
  const edges = (graph as { edges: Array<Record<string, unknown>> }).edges.filter(
    (e) => e.from === FROM && e.to === TO,
  );
  expect(edges).toHaveLength(1);
  return edges[0]!;
}

function provenanceOf(graph: unknown): Record<string, unknown> {
  return edgeOf(graph).provenance as Record<string, unknown>;
}

/** `reviewed_by_user` is present, says `confirm`, and carries a real ISO instant. */
function expectReviewed(graph: unknown, band?: string): void {
  const review = provenanceOf(graph).reviewed_by_user as Record<string, unknown> | undefined;
  expect(review).toBeDefined();
  expect(review!.intent).toBe('confirm');
  expect(typeof review!.at).toBe('string');
  expect(new Date(review!.at as string).toISOString()).toBe(review!.at);
  if (band === undefined) expect(review).not.toHaveProperty('band');
  else expect(review!.band).toBe(band);
}

/**
 * Everything on the target edge except the review record, (for a band) the std and — L4 — a placeholder's magnitude must
 * be byte-identical. ⭐ L4 AMENDMENT (DL ruling #85 5929790081 on 52f8cd's trace 5929778726): a review on a PLACEHOLDER
 * sizes it — `olumi_placeholder` becomes `olumi_estimate` (Olumi's band, now accepted). Authorship stays R11's: `source`,
 * `reasoning`, `provenance_display` and the `defaulted` flags are kept, and the licence rows below still read NO licence.
 */
function expectKeptExactly(before: GraphV3T, after: unknown, opts: { bandStd?: number } = {}): void {
  const b = structuredClone(edgeOf(before));
  const a = structuredClone(edgeOf(after));
  const ap = a.provenance as Record<string, unknown>;
  delete ap.reviewed_by_user;
  if ((b.provenance as Record<string, unknown> | undefined)?.magnitude === 'olumi_placeholder') {
    expect(ap.magnitude, 'L4: an approved placeholder is sized — Olumi\u2019s estimate, accepted').toBe('olumi_estimate');
    ap.magnitude = 'olumi_placeholder';
  }
  if (opts.bandStd !== undefined) {
    expect((a.strength as { std: number }).std).toBe(opts.bandStd);
    (a.strength as { std: number }).std = (b.strength as { std: number }).std;
  }
  expect(a).toStrictEqual(b);
}

// ─── The Agent's path: the handler itself ─────────────────────────────────────────────────────────────────────────

function proposal(strength: number): ProposalAction {
  return {
    handler_id: 'adjust_edge_strength',
    entity: { id: `${FROM}→${TO}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'strength', value: strength, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: [],
  };
}

async function handlerSet(graph: GraphV3T, strength: number): Promise<{ graph: unknown; facts: readonly HandlerFact[] }> {
  const invocation: HandlerInvocation = {
    context: {
      session_id: SCENARIO_ID,
      stage: 'frame',
      request_id: 'req-r11',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      stage: 'frame',
      message: 'set the link',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-r11',
    signal: new AbortController().signal,
    orientationText: '',
    proposal: proposal(strength),
    graphForTurn: graph,
  };
  const outcome = await createAdjustEdgeStrengthHandler()(invocation);
  return { graph: outcome.mutated_graph, facts: outcome.handler_facts };
}

// ─── The canvas path: the strict system-event adapter ─────────────────────────────────────────────────────────────

function eventFor(overrides: Partial<EdgeStrengthEditEvent>): EdgeStrengthEditEvent {
  return {
    kind: 'edge_strength_edit',
    from: FROM,
    to: TO,
    magnitude: MEAN,
    direction_intent: 'preserve',
    expected: { mean: MEAN, effect_direction: 'positive' },
    intent: 'confirm_current',
    ...overrides,
  };
}

async function canvas(graph: GraphV3T, event: EdgeStrengthEditEvent) {
  const payload = OrchestratorTurnPayloadSchema.parse({
    kind: 'system_event',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  }) as SystemEventTurnPayload;
  return await applyEdgeStrengthEdit({ payload, event, requestId: 'req-r11-canvas', persistedGraph: graph });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe('R11 — the fixture is a real licence discriminator (controls, same run)', () => {
  it('the untouched placeholder is NOT licensed; the SAME graph with a user-set link IS', () => {
    expect(licensed(placeholder())).toBe(false);
    expect(licensed(graphWith({ provenance: { source: 'user_specified' } }))).toBe(true);
  });
});

describe('R11 — a confirm on a placeholder is review, not authorship', () => {
  it('canvas confirm_current: source, magnitude, reasoning, display and defaulted kept; reviewed_by_user added; NO licence', async () => {
    const before = placeholder();
    const result = await canvas(before, eventFor({}));

    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect(provenanceOf(result.mutatedGraph).source).toBe('cee_hypothesis');
    expect(edgeOf(result.mutatedGraph).defaulted).toBe(true);
    expectReviewed(result.mutatedGraph);
    expectKeptExactly(before, result.mutatedGraph);
    expect(licensed(result.mutatedGraph)).toBe(false);
    // The pure guard agrees with the adapter on the bytes the dispatcher persists.
    expect(isProvenanceOnlyEdgeConfirmation({ before, after: result.mutatedGraph, from: FROM, to: TO })).toBe(true);
  });

  it('the Agent\'s confirm (a set to the current value) on the same placeholder: kept, reviewed, NO licence', async () => {
    const before = placeholder();
    const { graph } = await handlerSet(before, MEAN);

    expect(provenanceOf(graph).source).toBe('cee_hypothesis');
    expectReviewed(graph);
    expectKeptExactly(before, graph);
    expect(licensed(graph)).toBe(false);
  });
});

describe('R11 — an in-band pick is review, not authorship', () => {
  // ⛔ #2473 CR (CODEX_CLI_OVERFLOW 5937437431, DL concur): the canvas pill's typed band on a confirm used to move std
  // to the band's spread. A no-change confirm is byte-equal through every door, the typed band included.
  it('canvas confirm_current + the band the link already sits in: strength KEPT byte-equal (#2473), band recorded, NO licence', async () => {
    const before = placeholder();
    const result = await canvas(before, eventFor({ band: 'strong' }));

    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    if (result.kind !== 'mutated') throw new Error('not mutated');
    expect(edgeOf(result.mutatedGraph).strength).toStrictEqual(edgeOf(before).strength);
    expect(provenanceOf(result.mutatedGraph).source).toBe('cee_hypothesis');
    expectReviewed(result.mutatedGraph, 'strong');
    expectKeptExactly(before, result.mutatedGraph);
    expect(licensed(result.mutatedGraph)).toBe(false);
  });

  it('RED (R7 finding 3, through the approval door): Price → Revenue projected user-drawn prior is reviewed at its stored mean, never credited', async () => {
    let persisted = graphWith({ strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'user_specified', mean_projected: true } as Edge['provenance'] });
    persisted.nodes.find(n => n.id === TO)!.label = 'Revenue';
    const before = structuredClone(edgeOf(persisted));
    const events: EdgeStrengthEditEvent[] = [];
    expect(linkSizing(before), 'identity: the user drew Price → Revenue but gave no size').toBe('placeholder');
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: persisted, graph_hash: 'r7-price-revenue' } };
      expect(path).toBe('/orchestrate/v2/turn');
      const payload = OrchestratorTurnPayloadSchema.parse(body) as SystemEventTurnPayload;
      expect(payload.event.kind).toBe('edge_strength_edit');
      const event = payload.event as EdgeStrengthEditEvent;
      events.push(event);
      const result = await applyEdgeStrengthEdit({ payload, event, requestId: 'r7-price-review', persistedGraph: persisted });
      expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
      if (result.kind === 'mutated') persisted = result.mutatedGraph as GraphV3T;
      return { status: 200, json: result.response as unknown as Record<string, unknown> };
    };
    const proposals = new ProposalStore();
    const caps = createAgentCapabilities(dispatch, proposals);
    const words = 'Price is strong.';
    const context = { scenario_id: SCENARIO_ID, authenticated_user_id: null, request_id: 'r7-price-review',
      user_text: words, user_turn_text: words };
    const proposed = await caps.proposeLinkStrength!(context, { from_label: 'Price', to_label: 'Revenue',
      strength: 'strong', rationale: words });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const proposal = proposals.get(String(proposed.proposal_id))!;
    expect(proposal.scenario_id).toBe(SCENARIO_ID);
    expect(proposal.operations).toEqual([expect.objectContaining({ op: 'update_edge', path: `${FROM}::${TO}`,
      value: expect.objectContaining({ magnitude: 0.5, intent: 'confirm_current', band: 'strong' }) })]);
    // Science 393023 LICENCE ruling 3, re-derived:
    // Price → Revenue source=user_specified + mean_projected was rejected (carrier lost); now it records review only,
    // with μ=0.5 / σ=0.125 held and no promotion to the user's own strength.
    const approved = await caps.authoriseChange(context, { proposal_id: proposal.proposal_id });
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    expect(events).toEqual([expect.objectContaining({ from: FROM, to: TO, magnitude: 0.5, intent: 'confirm_current' })]);
    expect(edgeOf(persisted).strength).toStrictEqual(before.strength);
    expectReviewed(persisted, 'strong');
    const { reviewed_by_user: _review, ...kept } = provenanceOf(persisted);
    expect(kept).toStrictEqual(before.provenance);
    expect(linkSizing(edgeOf(persisted))).toBe('placeholder');
    expect(earnsAuthorshipCredit(edgeStrengthProvenance(edgeOf(persisted)))).toBe(false);
    expect(String(approved.follow_up)).not.toMatch(/your (?:own )?estimate|you set/i);
  });

  it('CONTROL (R7): reviewing a non-user projected placeholder permits only the canonical magnitude/carrier transition', async () => {
    const before = graphWith({ strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'cee_hypothesis', mean_projected: true } as Edge['provenance'] });
    const result = await canvas(before, eventFor({ band: 'strong' }));
    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    if (result.kind !== 'mutated') throw new Error('non-user projection was not reviewed');
    expect(edgeOf(result.mutatedGraph).strength).toStrictEqual(edgeOf(before).strength);
    expect(provenanceOf(result.mutatedGraph)).toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' });
    expect(provenanceOf(result.mutatedGraph)).not.toHaveProperty('mean_projected');
    expectReviewed(result.mutatedGraph, 'strong');
    expect(linkSizing(edgeOf(result.mutatedGraph))).toBe('olumi_accepted');
    expect(earnsAuthorshipCredit(edgeStrengthProvenance(edgeOf(result.mutatedGraph)))).toBe(false);
    expect(isProvenanceOnlyEdgeConfirmation({ before, after: result.mutatedGraph, from: FROM, to: TO, statedBand: 'strong' })).toBe(true);
  });
});

describe('R11 — a defaulted strength never earns credit, whatever the link\'s source', () => {
  it('brief_extraction + defaulted, UNTOUCHED: NO licence', () => {
    expect(licensed(briefDefaulted())).toBe(false);
  });

  it('CONTRAST: brief_extraction with its own (non-defaulted) strength still licenses — the rule is the default, not the source', () => {
    expect(licensed(graphWith({ provenance: { source: 'brief_extraction' } }))).toBe(true);
  });

  it('brief_extraction + defaulted, CONFIRMED on the canvas: source and defaulted kept, reviewed, NO licence', async () => {
    const before = briefDefaulted();
    const result = await canvas(before, eventFor({}));

    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect(provenanceOf(result.mutatedGraph).source).toBe('brief_extraction');
    expect(edgeOf(result.mutatedGraph).defaulted).toBe(true);
    expectReviewed(result.mutatedGraph);
    expectKeptExactly(before, result.mutatedGraph);
    expect(licensed(result.mutatedGraph)).toBe(false);
  });
});

describe('R11 — a set that CHANGES the value is authorship (today\'s behaviour, kept exactly)', () => {
  it('canvas set 0.5 → 0.3: user_specified, user_set, defaulted gone, and a licence', async () => {
    const result = await canvas(
      placeholder(),
      eventFor({ intent: 'set', magnitude: 0.3 }),
    );

    expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const edge = edgeOf(result.mutatedGraph);
    expect((edge.strength as { mean: number }).mean).toBe(0.3);
    expect(provenanceOf(result.mutatedGraph).source).toBe('user_specified');
    expect(edge.provenance_display).toBe('user_set');
    expect(edge).not.toHaveProperty('defaulted');
    expect(edge.exists_defaulted).toBe(true);
    expect(provenanceOf(result.mutatedGraph)).not.toHaveProperty('reviewed_by_user');
    expect(licensed(result.mutatedGraph)).toBe(true);
  });

  it('the Agent\'s set 0.5 → 0.3: user_specified and a licence', async () => {
    const { graph } = await handlerSet(placeholder(), 0.3);
    expect(provenanceOf(graph).source).toBe('user_specified');
    expect(edgeOf(graph)).not.toHaveProperty('defaulted');
    expect(licensed(graph)).toBe(true);
  });
});

describe('R11 — a set to the SAME value is a confirm: no credit', () => {
  it('the Agent\'s set 0.5 → 0.5 on brief_extraction + defaulted: reviewed, kept, NO licence', async () => {
    const before = briefDefaulted();
    const { graph, facts } = await handlerSet(before, MEAN);

    expect(provenanceOf(graph).source).toBe('brief_extraction');
    expect(edgeOf(graph).defaulted).toBe(true);
    expectReviewed(graph);
    expectKeptExactly(before, graph);
    expect(licensed(graph)).toBe(false);
    // The fact still says nothing changed.
    expect(facts[0]).toMatchObject({ fact_type: 'adjust_edge_strength', noop: true });
  });

  it('the canvas set to the same value is still refused, and writes nothing (no credit either way)', async () => {
    const before = placeholder();
    const snapshot = structuredClone(before);
    const result = await canvas(before, eventFor({ intent: 'set' }));
    expect(result).toMatchObject({ kind: 'refused', reason: 'set_target_unchanged' });
    expect(before).toStrictEqual(snapshot);
    expect(licensed(before)).toBe(false);
  });
});

describe('R11 — the confirm guard (isProvenanceOnlyEdgeConfirmation)', () => {
  const review = { intent: 'confirm', at: '2026-09-28T15:00:00.000Z' };
  function reviewed(before: GraphV3T, extra: Record<string, unknown> = {}): GraphV3T {
    const after = structuredClone(before);
    const edge = after.edges.find((e) => e.from === FROM && e.to === TO)!;
    edge.provenance = { ...edge.provenance!, reviewed_by_user: { ...review, ...extra } } as Edge['provenance'];
    return after;
  }
  const guard = (before: GraphV3T, after: GraphV3T, statedBand?: 'strong' | 'moderate') =>
    isProvenanceOnlyEdgeConfirmation({
      before,
      after,
      from: FROM,
      to: TO,
      ...(statedBand !== undefined ? { statedBand } : {}),
    });

  it('⭐ ACCEPTS the new after-state: everything kept, reviewed_by_user added', () => {
    const before = placeholder();
    expect(guard(before, reviewed(before))).toBe(true);
  });

  it('⭐ REFUSES a confirm whose after-state stamps user_specified (the old bypass)', () => {
    const before = placeholder();
    const after = reviewed(before);
    const edge = after.edges.find((e) => e.from === FROM && e.to === TO)!;
    edge.provenance = { ...edge.provenance!, source: 'user_specified' };
    expect(guard(before, after)).toBe(false);
  });

  it('REFUSES the old full stamp too (user_specified + user_set, defaulted and Olumi\'s sizing dropped)', () => {
    const before = placeholder();
    const after = structuredClone(before);
    const edge = after.edges.find((e) => e.from === FROM && e.to === TO)!;
    edge.provenance = { source: 'user_specified' };
    edge.provenance_display = 'user_set';
    delete edge.defaulted;
    edge.exists_defaulted = true;
    edge.std_defaulted = true;
    expect(guard(before, after)).toBe(false);
  });

  it('REFUSES a confirm that drops defaulted, or Olumi\'s magnitude, while recording the review', () => {
    const before = placeholder();
    const dropsDefault = reviewed(before);
    delete dropsDefault.edges.find((e) => e.from === FROM && e.to === TO)!.defaulted;
    expect(guard(before, dropsDefault)).toBe(false);

    const dropsMagnitude = reviewed(before);
    const edge = dropsMagnitude.edges.find((e) => e.from === FROM && e.to === TO)!;
    const { magnitude: _m, ...rest } = edge.provenance!;
    edge.provenance = rest as Edge['provenance'];
    expect(guard(before, dropsMagnitude)).toBe(false);
  });

  it('REFUSES a confirm that records nothing, and a review record with the wrong intent', () => {
    const before = placeholder();
    expect(guard(before, structuredClone(before))).toBe(false);
    expect(guard(before, reviewed(before, { intent: 'set' }))).toBe(false);
  });

  it('R7 guard controls: carrier deletion alone, invented user credit, and actual graph changes remain refused', () => {
    const before = graphWith({ strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'cee_hypothesis', mean_projected: true } as Edge['provenance'] });
    const carrierOnly = reviewed(before);
    delete (provenanceOf(carrierOnly) as Record<string, unknown>).mean_projected;
    expect(guard(before, carrierOnly), 'no canonical magnitude transition accompanies carrier loss').toBe(false);
    const promoted = reviewed(before);
    provenanceOf(promoted).magnitude = 'olumi_estimate';
    delete provenanceOf(promoted).mean_projected;
    expect(guard(before, promoted), 'CONTROL: exactly the canonical promotion is permitted').toBe(true);
    for (const mutate of [
      (g: GraphV3T) => { g.edges.find(e => e.from === FROM && e.to === TO)!.strength.mean = 0.55; },
      (g: GraphV3T) => { g.edges.find(e => e.from === FROM && e.to === TO)!.strength.std = 0.2; },
      (g: GraphV3T) => { provenanceOf(g).source = 'user_specified'; },
      (g: GraphV3T) => { g.nodes.find(n => n.id === TO)!.label = 'Changed revenue'; },
    ]) {
      const changed = structuredClone(promoted);
      mutate(changed);
      expect(guard(before, changed), 'canonical promotion cannot permit any other persisted change').toBe(false);
    }
    const drawn = graphWith({ strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'user_specified', mean_projected: true } as Edge['provenance'] });
    const inventedCredit = reviewed(drawn);
    provenanceOf(inventedCredit).magnitude = 'olumi_estimate';
    delete provenanceOf(inventedCredit).mean_projected;
    expect(guard(drawn, inventedCredit), 'a review never clears the only carrier that distinguishes drawn from user-sized').toBe(false);
  });

  // ⛔ #2473 CR: a band confirm keeps the std (this row once ACCEPTED std → the band's spread).
  it('a band confirm: ACCEPTS the band recorded with the strength kept; REFUSES std → the band\'s spread, a missing or a different band', () => {
    const before = placeholder();
    const withSpread = (after: GraphV3T): GraphV3T => {
      after.edges.find((e) => e.from === FROM && e.to === TO)!.strength.std = edgeBandStd('strong');
      return after;
    };
    expect(guard(before, reviewed(before, { band: 'strong' }), 'strong')).toBe(true);
    expect(guard(before, withSpread(reviewed(before, { band: 'strong' })), 'strong')).toBe(false);
    expect(guard(before, reviewed(before), 'strong')).toBe(false);
    expect(guard(before, reviewed(before, { band: 'moderate' }), 'strong')).toBe(false);
    // And a figure confirm may not carry a band it was never given.
    expect(guard(before, reviewed(before, { band: 'strong' }))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// A CONFIRMED link is SETTLED for every consumer that would re-size it, ask about it again, or flag it as an unseen
// default — review is not authorship (no licence, above), but it is the user's settled view of that figure
// (`edgeReviewedByUser`, the one predicate). Rows added by Canonical after the builder's consumer map.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('R11 — a CONFIRMED link is settled: never re-sized, re-asked or re-flagged (and still no licence)', () => {
  const confirmed = async (): Promise<GraphV3T> => {
    const r = await canvas(placeholder(), eventFor({}));
    if (r.kind !== 'mutated') throw new Error(`confirm did not commit: ${JSON.stringify(r)}`);
    return r.mutatedGraph as GraphV3T;
  };

  it('RED: the magnitude contract never silently re-sizes a size the user confirmed; CONTROL: the unconfirmed placeholder is re-sized', async () => {
    const { frameDefaultedLinks } = await import('../../../../cee/magnitude/frame-defaulted-links.js');
    const link = `${FROM}::${TO}`;
    expect(frameDefaultedLinks(placeholder(), FROM).sized, 'CONTROL: Olumi\'s placeholder is re-sized on the levels').toContain(link);
    expect(frameDefaultedLinks(await confirmed(), FROM).sized).not.toContain(link);
  });

  it('RED: the fragile-link card no longer treats a confirmed link as Olumi\'s unseen assumption; CONTROL: before the confirm it does', async () => {
    const { classifyEdgeAuthorship } = await import('../../../coaching/edge-strength-authorship.js');
    expect(classifyEdgeAuthorship(edgeOf(placeholder()))).toBe('olumi_assumed');
    expect(classifyEdgeAuthorship(edgeOf(await confirmed()))).toBe('not_olumi_assumed');
  });

  it('RED: the Agent\'s view of the link says the user confirmed it (so it is not asked about again); its source stays Olumi\'s', async () => {
    const { createAgentCapabilities } = await import('../../../agent-lane/runtime/agent-capabilities.js');
    const { ProposalStore } = await import('../../../agent-lane/proposal.js');
    const viewOf = async (graph: GraphV3T): Promise<Record<string, unknown> | undefined> => {
      const caps = createAgentCapabilities(async (path: string) => (path.endsWith('/graph')
        ? { status: 200, json: { graph, graph_hash: 'h1' } } : { status: 404, json: {} }), new ProposalStore(), undefined, 'full');
      const out = await (caps as unknown as { getCanonicalState: (ctx: unknown) => Promise<unknown> })
        .getCanonicalState({ scenario_id: SCENARIO_ID, authenticated_user_id: null, request_id: 'r' });
      const find = (x: unknown): Record<string, unknown> | undefined => {
        if (Array.isArray(x)) { for (const y of x) { const f = find(y); if (f) return f; } return undefined; }
        if (x === null || typeof x !== 'object') return undefined;
        const r = x as Record<string, unknown>;
        if (r.from === FROM && r.to === TO && 'source' in r) return r;
        for (const v of Object.values(r)) { const f = find(v); if (f) return f; }
        return undefined;
      };
      return find(out);
    };
    const before = await viewOf(placeholder());
    expect(before, 'the Agent is shown the link').toBeDefined();
    expect(before!.confirmed_by_user).toBeUndefined();
    const after = await viewOf(await confirmed());
    expect(after).toMatchObject({ source: 'cee_hypothesis', confirmed_by_user: true });
  });

  it('DL row 1: a confirm leaves the ADMISSION census byte-identical (Paul\'s R11: confirming "strong" moved the gate)', async () => {
    const before = placeholder();
    expect(censusConfidenceParameters(await confirmed())).toEqual(censusConfidenceParameters(before));
    const brief = briefDefaulted();
    const r = await canvas(brief, eventFor({}));
    if (r.kind !== 'mutated') throw new Error('brief confirm did not commit');
    expect(censusConfidenceParameters(r.mutatedGraph)).toEqual(censusConfidenceParameters(brief));
  });

  it('DL row 2: the review record survives a save and reload — JSON (JSONB) round trip, then the persisted-graph parse (GraphV3)', async () => {
    const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(await confirmed())));
    expect(provenanceOf(reloaded).reviewed_by_user).toMatchObject({ intent: 'confirm' });
    expect(provenanceOf(reloaded).source).toBe('cee_hypothesis');
    expect(edgeOf(reloaded).defaulted).toBe(true);
  });
});
