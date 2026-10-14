/** Batch A rulings 1–6: placeholder approval is review; only a genuine or newly adopted estimate sizes a link. */
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
async function approve(graph: GraphV3T, strength: number, band?: 'very strong' | 'strong', adoptedBand?: 'strong'): Promise<GraphV3T> {
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
    ...(adoptedBand !== undefined ? { edgeStrengthAdoptedEstimateAuthority: { band: adoptedBand } } : {}),
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

describe('Batch A: approving a placeholder records review and keeps it unsized', () => {
  it('Batch A: approving the current placeholder band keeps its sizing and records review', async () => {
    const before = graphWith(PLACEHOLDER);
    expect(linkSizing(target(before)), 'PRECONDITION: a placeholder').toBe('placeholder');
    const after = await approve(before, 0.85, 'very strong');
    const p = target(after).provenance as Record<string, unknown>;
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(p.magnitude).toBe('olumi_placeholder');
    expect(p.source, 'authorship stays Olumi’s (R11)').toBe('cee_hypothesis');
    expect(p.reviewed_by_user).toMatchObject({ intent: 'confirm', band: 'very strong' });
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(linkSizing(target(after))).toBe(linkSizing(target(before)));
    expect(target(after).strength.mean, 'the figure is unchanged').toBe(0.85);
    // Batch A ruling 2: reviewing the placeholder earns no goal licence.
    expect(placeholderGoalPaths(after, ['opt_a', 'opt_b'])).toEqual(placeholderGoalPaths(before, ['opt_a', 'opt_b']));
  });

  it('Batch A: adopting a newly supplied different mean licenses goal figures as an accepted Olumi estimate', async () => {
    const before = graphWith(PLACEHOLDER);
    expect(placeholderGoalPaths(before, ['opt_a', 'opt_b']).map((x) => x.option_id), 'PRECONDITION: withheld before').toContain('opt_a');
    // Batch A rulings 4 and 6: adopt a new 0.55 estimate instead of confirming the stored 0.85 placeholder.
    const after = await approve(before, 0.55, undefined, 'strong');
    // Batch A ruling 6: retain the goal-licence assertion on a legitimately accepted estimate.
    expect(placeholderGoalPaths(after, ['opt_a', 'opt_b'])).toEqual([]);
    // Batch A ruling 4: adoption of a different mean really sizes the link.
    expect(isPlaceholderLink(target(after))).toBe(false);
    // Batch A ruling 6: the accepted estimate remains Olumi's, never user credit.
    expect(linkSizing(target(after))).toBe('olumi_accepted');
  });

  it('CONTROL (ruling ii): the parts rule is unchanged — an accepted Olumi size still never scores a parts limit', async () => {
    // Batch A ruling 6: approve a genuine estimate for the accepted-size control.
    const after = await approve(graphWith({ ...PLACEHOLDER, magnitude: 'olumi_estimate' }), 0.85, 'very strong');
    expect(olumiSizedLink(target(after) as never)).toBe(true);
    expect(isSizedOnlyByOlumi(target(after))).toBe(true);
  });

  it('CONTROL (R11): an accepted Olumi estimate earns no authorship credit', async () => {
    // Batch A ruling 6: approve a genuine estimate for the accepted-size control.
    const after = await approve(graphWith({ ...PLACEHOLDER, magnitude: 'olumi_estimate' }), 0.85, 'very strong');
    expect(earnsAuthorshipCredit(structureProvenance(target(after), after))).toBe(false);
  });

  it('CONTROL: a confirm on a link that is NOT a placeholder changes nothing but the review — the analysis stays fresh', async () => {
    const before = graphWith({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' }, 0.55);
    // Batch A ruling 2: bare and same-band confirms both preserve the stored spread.
    const after = await approve(before, 0.55);
    expect((target(after).provenance as Record<string, unknown>).magnitude).toBe('olumi_estimate');
    expect(computeAnalysisAffectingGraphHash(after)).toBe(computeAnalysisAffectingGraphHash(before));
  });

  it('Batch A: placeholder approval preserves the analysis hash', async () => {
    const before = graphWith(PLACEHOLDER);
    const after = await approve(before, 0.85);
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(computeAnalysisAffectingGraphHash(after)).toBe(computeAnalysisAffectingGraphHash(before));
    const { reviewed_by_user: _review, ...kept } = target(after).provenance as Record<string, unknown>;
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(kept).toStrictEqual(target(before).provenance);
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(target(after).strength).toStrictEqual(target(before).strength);
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(target(after).defaulted).toBe(target(before).defaulted);
  });
});

describe('Batch A: the canvas confirm allowlist refuses placeholder relabelling', () => {
  const confirmAfter = (magnitude: string) => {
    const before = graphWith(PLACEHOLDER);
    const after = structuredClone(before) as GraphV3T;
    const p = target(after).provenance as Record<string, unknown>;
    p.magnitude = magnitude;
    p.reviewed_by_user = { intent: 'confirm', at: new Date().toISOString() };
    return isProvenanceOnlyEdgeConfirmation({ before, after, from: FROM, to: TO });
  };
  // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
  it('Batch A: REFUSES placeholder → Olumi’s estimate', () => expect(confirmAfter('olumi_estimate')).toBe(false));
  it('⛔ REFUSES placeholder → the user’s (a confirm is never authorship, R11)', () => expect(confirmAfter('user_stated')).toBe(false));
});

describe('Batch A: an older unmarked default stays unmarked on approval', () => {
  const UNMARKED = { source: 'cee_hypothesis' } as const;
  it('Batch A: approving an unmarked default records review and keeps its origin', async () => {
    const before = graphWith(UNMARKED);
    expect(linkSizing(target(before)), 'PRECONDITION: unmarked').toBe('unmarked');
    const after = await approve(before, 0.85, 'very strong');
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(target(after).provenance).toMatchObject({ source: 'cee_hypothesis', reviewed_by_user: { intent: 'confirm' } });
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(target(after).provenance).not.toHaveProperty('magnitude');
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(linkSizing(target(after))).toBe(linkSizing(target(before)));
  });
  it('CONTROL: a link with no sizing mark that is NOT Olumi’s default (no `defaulted`) is not re-marked', async () => {
    const before = graphWith(UNMARKED);
    delete (target(before) as Record<string, unknown>).defaulted;
    const after = await approve(before, 0.85, 'very strong');
    expect((target(after).provenance as Record<string, unknown>).magnitude).toBeUndefined();
  });
  it('Batch A: the canvas allowlist refuses unmarked → estimate with or without defaulted', () => {
    const run = (defaulted: boolean) => {
      const before = graphWith(UNMARKED);
      if (!defaulted) delete (target(before) as Record<string, unknown>).defaulted;
      const after = structuredClone(before) as GraphV3T;
      Object.assign(target(after).provenance as Record<string, unknown>, { magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm', at: new Date().toISOString() } });
      return isProvenanceOnlyEdgeConfirmation({ before, after, from: FROM, to: TO });
    };
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(run(true)).toBe(false);
    expect(run(false)).toBe(false);
  });
});

describe('Batch A P03: a projected mean stays unsized after approval', () => {
  const PROJECTED = { source: 'cee_hypothesis', mean_projected: true } as const;
  const confirm = (sized: boolean) => {
    const before = graphWith(PROJECTED);
    const after = structuredClone(before) as GraphV3T;
    const p = target(after).provenance as Record<string, unknown>;
    delete p.mean_projected;
    if (sized) p.magnitude = 'olumi_estimate';
    p.reviewed_by_user = { intent: 'confirm', at: new Date().toISOString() };
    return isProvenanceOnlyEdgeConfirmation({ before, after, from: FROM, to: TO });
  };
  it('Batch A: approving a projected mean records review and keeps the marker', async () => {
    const after = await approve(graphWith(PROJECTED), 0.85, 'very strong');
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(target(after).provenance).toMatchObject({ source: 'cee_hypothesis', reviewed_by_user: { intent: 'confirm' } });
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(target(after).provenance).not.toHaveProperty('magnitude');
    // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
    expect(target(after).provenance).toHaveProperty('mean_projected', true);
  });
  // Batch A rulings 1 and 2: L4 superseded; confirmation preserves sizing and records review.
  it('Batch A: the canvas allowlist refuses marker deletion WITH relabelling', () => expect(confirm(true)).toBe(false));
  it('⛔ REFUSES the marker dropped WITHOUT the sizing (a confirm may not touch it otherwise)', () => expect(confirm(false)).toBe(false));
});
