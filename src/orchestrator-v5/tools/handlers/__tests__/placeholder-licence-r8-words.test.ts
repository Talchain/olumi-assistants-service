/**
 * Science 393023 LICENCE ruling 3 (one meaning of unsized) — Codex review of #2767 @188fbfda, findings 1 and 2.
 *  1. The Canvas/handler edit receipt never names a placeholder's default band ("from strong to slight").
 *  2. The Olumi-authored disclosure never counts a strength the ONE predicate reads as the user's.
 * Bound by identity (link ends); each row has a control that keeps today's words.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';
import { deriveOlumiLinkStrengths, type OlumiAuthoredValue } from '../../../coaching/inferred-value-disclosure.js';
import { linkSizing } from '../../../../cee/magnitude/link-sizing.js';
import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';

const invocation = (graph: GraphV3T, entityId: string, strength: number): HandlerInvocation => ({
  context: { session_id: 'scn-r8', stage: 'frame', request_id: 'req-r8', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null } as unknown as HandlerInvocation['context'],
  payload: { kind: 'message', scenario_id: 'scn-r8', turn_id: 'turn-r8', stage: 'frame', message: 'make it slight' } as unknown as HandlerInvocation['payload'],
  requestId: 'req-r8', signal: new AbortController().signal, orientationText: '', graphForTurn: graph,
  proposal: { handler_id: 'adjust_edge_strength', entity: { id: entityId, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'strength', value: strength, operator: 'set', source: 'user_explicit' }], cited_context_fields: [] } as ProposalAction,
});
/** The D1 fixture's budget → revenue link, re-stamped as the "+" door default (0.5/0.125, defaulted, hypothesis). */
const withDoorDefault = (): GraphV3T => {
  const g = structuredClone(buildD1Fixture());
  const e = g.edges.find((x) => x.from === 'f-budget' && x.to === 'g-revenue')! as Record<string, unknown>;
  Object.assign(e, { strength: { mean: 0.5, std: 0.125 }, defaulted: true, provenance: { source: 'cee_hypothesis' } });
  return g;
};

describe('finding 1: the edit receipt never names a placeholder default as a band', () => {
  it('door-default budget → revenue set to slight: says it had no size, never "from strong"', async () => {
    const g = withDoorDefault();
    expect(linkSizing(g.edges.find((x) => x.from === 'f-budget' && x.to === 'g-revenue'))).toBe('placeholder');
    const out = await createAdjustEdgeStrengthHandler()(invocation(g, 'f-budget→g-revenue', 0.1));
    expect(out.assistant_text).toContain('nobody had sized it before');
    expect(out.assistant_text).toMatch(/to slight/);
    expect(out.assistant_text).not.toMatch(/from (strong|moderate|slight|very strong)/);
  });
  it('CONTROL: the same edit on the sized fixture link (0.4/0.1) still says "from … to …"', async () => {
    const out = await createAdjustEdgeStrengthHandler()(invocation(structuredClone(buildD1Fixture()), 'f-budget→g-revenue', 0.1));
    expect(out.assistant_text).toMatch(/from [a-z ]+ to slight/);
    expect(out.assistant_text).not.toContain('nobody had sized it before');
  });
});

describe('finding 2: the Olumi-authored count never claims the user\'s own strength', () => {
  const banked = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/g1b-answer-door-banked.json', import.meta.url), 'utf8'));
  const graph = structuredClone(banked.graphs['acc__g1-2633s_draft-2__5fe19642'].graph ?? banked.graphs['acc__g1-2633s_draft-2__5fe19642']);
  const key = (l: OlumiAuthoredValue) => (l.kind === 'link_strength' ? `${l.from}->${l.to}` : '');
  it('banked 5fe19642 starter_subscribers → starter_tier_mrr (magnitude user_stated) is not counted as Olumi\'s', () => {
    const edge = (graph.edges as Record<string, unknown>[]).find((e) => e.from === 'starter_subscribers' && e.to === 'starter_tier_mrr')!;
    expect(edge).toBeDefined();
    expect(linkSizing(edge)).toBe('user');
    expect(deriveOlumiLinkStrengths(graph).map(key)).not.toContain('starter_subscribers->starter_tier_mrr');
  });
  it('CONTROL: an Olumi-sized link and a placeholder in the same graph are still counted', () => {
    const g = structuredClone(graph);
    const edge = (g.edges as Record<string, any>[]).find((e) => e.from === 'starter_subscribers' && e.to === 'starter_tier_mrr')!;
    edge.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate' };
    expect(deriveOlumiLinkStrengths(g).map(key)).toContain('starter_subscribers->starter_tier_mrr');
    Object.assign(edge, { provenance: { source: 'cee_hypothesis' }, defaulted: true, strength: { mean: 0.5, std: 0.125 } });
    expect(linkSizing(edge)).toBe('placeholder');
    expect(deriveOlumiLinkStrengths(g).map(key)).toContain('starter_subscribers->starter_tier_mrr');
  });
});
