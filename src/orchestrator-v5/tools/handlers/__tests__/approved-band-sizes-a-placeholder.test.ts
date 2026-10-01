/**
 * ⭐ L4 — AN APPROVAL ON A PLACEHOLDER SIZES IT (52f8cd trace #85 5929778726; DL ruling 5929790081; design 1–3 approved).
 *
 * Paul's 1 Oct test (`96c6f5f4`): at 09:25 he approved Olumi's estimates for 8 unsized links ("Record these links"). Every
 * link took the review-only path — the Agent's band equalled the link's current band (0.85 = "very strong") — so the
 * writer recorded `reviewed_by_user` and KEPT `magnitude: 'olumi_placeholder'`. Nothing that asks "is it sized?" could see
 * the approval, and three Runs repeated "Olumi hasn't sized…" until he edited the canvas himself at 09:47:50.
 *
 * THE RULE (`link-sizing.ts`): a review on a placeholder makes it Olumi's estimate, accepted (`olumi_placeholder` →
 * `olumi_estimate` + review). Ruling (i): that sizes the link for GOAL FIGURES. Ruling (ii): it never scores a PARTS limit.
 * R11 is untouched: an accepted Olumi estimate earns no authorship credit, and a confirm on any non-placeholder link still
 * changes nothing but the review.
 *
 * Every row goes through the REAL writer (`adjust_edge_strength`, the path the Agent's approval and the canvas confirm
 * both reach) and reads the REAL readers.
 */
import { describe, expect, it } from 'vitest';

import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';
import { isProvenanceOnlyEdgeConfirmation } from '../../../system-events/edge-strength-edit.js';
import { linkSizing, isPlaceholderLink, isSizedOnlyByOlumi } from '../../../../cee/magnitude/link-sizing.js';
import { placeholderGoalPaths } from '../../../agent-lane/goal-certainty.js';
import { olumiSizedLink } from '../../../../orchestrator/context/placeholder-parts.js';
import { earnsAuthorshipCredit, structureProvenance } from '../../../../cee/graph-readiness/obligation-provenance.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';

const SCENARIO_ID = '96c6f5f4-6c13-41bf-bf9b-8b6c4ec47cb3';
const FROM = 'fac_capacity';
const TO = 'goal_1';
/** Served `96c6f5f4` e-12's shape: Olumi's 0.85 default, its hypothesis, its placeholder sizing. */
const PLACEHOLDER = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } as const;

function graphWith(provenance: Record<string, unknown>, mean = 0.85): GraphV3T {
  return GraphV3.parse({
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Sprint decision' },
      { id: 'goal_1', kind: 'goal', label: 'Quarterly revenue' },
      { id: FROM, kind: 'factor', label: 'AI reporting sprint capacity', observed_state: { value: 0.1, source: 'user_override' } },
      { id: 'opt_a', kind: 'option', label: 'AI reporting sprint', interventions: { [FROM]: { value: 0.6, source: 'brief_extraction' } } },
      { id: 'opt_b', kind: 'option', label: 'Signup fix sprint', interventions: { [FROM]: { value: 0.1, source: 'brief_extraction' } } },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } },
      { from: 'dec_1', to: 'opt_b', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } },
      { from: 'opt_a', to: FROM, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'brief_extraction' } },
      { from: 'opt_b', to: FROM, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'brief_extraction' } },
      { from: FROM, to: TO, strength: { mean, std: mean / 2 }, exists_probability: 0.8, effect_direction: 'positive', defaulted: true, provenance },
    ],
  });
}

const target = (g: unknown) => (g as GraphV3T).edges.find((e) => e.from === FROM && e.to === TO)!;

/** The Agent's approval of Olumi's band: a `set` to the value already stored (the served review-only path). */
async function approve(graph: GraphV3T, strength: number, band?: 'very strong' | 'strong'): Promise<GraphV3T> {
  const proposal: ProposalAction = {
    handler_id: 'adjust_edge_strength',
    entity: { id: `${FROM}→${TO}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'strength', value: strength, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: [],
  };
  const invocation = {
    context: { session_id: SCENARIO_ID, stage: 'frame', request_id: 'req-l4', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: { kind: 'message', scenario_id: SCENARIO_ID, turn_id: '11111111-1111-4111-8111-111111111411', stage: 'frame', message: 'Yes, record those.' },
    requestId: 'req-l4', signal: new AbortController().signal, orientationText: '', proposal, graphForTurn: graph,
    ...(band !== undefined ? { edgeStrengthBandAuthority: band } : {}),
  } as unknown as HandlerInvocation;
  const outcome = await createAdjustEdgeStrengthHandler()(invocation);
  return GraphV3.parse(outcome.mutated_graph);
}

describe('the one predicate: who sized this link', () => {
  it.each([
    [{ source: 'user_specified' }, 'user'],
    [{ source: 'cee_hypothesis', magnitude: 'user_stated' }, 'user'],
    [PLACEHOLDER, 'placeholder'],
    [{ ...PLACEHOLDER, magnitude: 'olumi_estimate' }, 'olumi_estimate'],
    [{ ...PLACEHOLDER, magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm', at: '2026-10-01T09:25:10.219Z' } }, 'olumi_accepted'],
    [{ source: 'cee_hypothesis' }, 'unmarked'],
  ] as const)('%o → %s', (provenance, sizing) => {
    expect(linkSizing({ provenance })).toBe(sizing);
  });
});

describe('L4: an approval on a placeholder sizes it (DL 5929790081)', () => {
  it('RED (served e-12): Olumi’s "very strong" approved on its own 0.85 placeholder → Olumi’s estimate, accepted', async () => {
    const before = graphWith(PLACEHOLDER);
    expect(linkSizing(target(before)), 'PRECONDITION: a placeholder').toBe('placeholder');
    const after = await approve(before, 0.85, 'very strong');
    const p = target(after).provenance as Record<string, unknown>;
    expect(p.magnitude).toBe('olumi_estimate');
    expect(p.source, 'authorship stays Olumi’s (R11)').toBe('cee_hypothesis');
    expect(p.reviewed_by_user).toMatchObject({ intent: 'confirm', band: 'very strong' });
    expect(linkSizing(target(after))).toBe('olumi_accepted');
    expect(target(after).strength.mean, 'the figure is unchanged').toBe(0.85);
  });

  it('RED (ruling i): the goal-figure reader stops withholding once the placeholder is approved; before, it withholds', async () => {
    const before = graphWith(PLACEHOLDER);
    expect(placeholderGoalPaths(before, ['opt_a', 'opt_b']).map((x) => x.option_id), 'PRECONDITION: withheld before').toContain('opt_a');
    const after = await approve(before, 0.85, 'very strong');
    expect(placeholderGoalPaths(after, ['opt_a', 'opt_b'])).toEqual([]);
    expect(isPlaceholderLink(target(after))).toBe(false);
  });

  it('CONTROL (ruling ii): the parts rule is unchanged — an accepted Olumi size still never scores a parts limit', async () => {
    const after = await approve(graphWith(PLACEHOLDER), 0.85, 'very strong');
    expect(olumiSizedLink(target(after) as never)).toBe(true);
    expect(isSizedOnlyByOlumi(target(after))).toBe(true);
  });

  it('CONTROL (R11): an accepted Olumi estimate earns no authorship credit', async () => {
    const after = await approve(graphWith(PLACEHOLDER), 0.85, 'very strong');
    expect(earnsAuthorshipCredit(structureProvenance(target(after), after))).toBe(false);
  });

  it('CONTROL: a confirm on a link that is NOT a placeholder changes nothing but the review — the analysis stays fresh', async () => {
    const before = graphWith({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' }, 0.55);
    // A bare confirm (no band): a named band stores that band's spread (A6f), a separate, intended analysis change.
    const after = await approve(before, 0.55);
    expect((target(after).provenance as Record<string, unknown>).magnitude).toBe('olumi_estimate');
    expect(computeAnalysisAffectingGraphHash(after)).toBe(computeAnalysisAffectingGraphHash(before));
  });

  it('the placeholder’s approval moves the analysis hash by its sizing alone (the Run correctly reads out of date)', async () => {
    const before = graphWith(PLACEHOLDER);
    const after = await approve(before, 0.85);
    const sizedOnly = GraphV3.parse(structuredClone(before));
    (target(sizedOnly).provenance as Record<string, unknown>).magnitude = 'olumi_estimate';
    expect(computeAnalysisAffectingGraphHash(after)).not.toBe(computeAnalysisAffectingGraphHash(before));
    expect(computeAnalysisAffectingGraphHash(after)).toBe(computeAnalysisAffectingGraphHash(sizedOnly));
  });
});

describe('the canvas confirm allowlist admits exactly the one L4 transition', () => {
  const confirmAfter = (magnitude: string) => {
    const before = graphWith(PLACEHOLDER);
    const after = structuredClone(before) as GraphV3T;
    const p = target(after).provenance as Record<string, unknown>;
    p.magnitude = magnitude;
    p.reviewed_by_user = { intent: 'confirm', at: new Date().toISOString() };
    return isProvenanceOnlyEdgeConfirmation({ before, after, from: FROM, to: TO });
  };
  it('ACCEPTS placeholder → Olumi’s estimate', () => expect(confirmAfter('olumi_estimate')).toBe(true));
  it('⛔ REFUSES placeholder → the user’s (a confirm is never authorship, R11)', () => expect(confirmAfter('user_stated')).toBe(false));
});
