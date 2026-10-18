/**
 * ⭐ A U2 (18 Oct; AIE 00:27/00:37, PL 02:07Z): a range Olumi chose (`frame_source: 'olumi_convention'`) is its reference,
 * never a bound. A user's figure above it is SAVED, and Olumi's reference is widened by the one policy
 * (`suggestExtendedCap`), still marked Olumi's. A range that is not Olumi's (the brief wrote it, or the user set it) still
 * protects the model: the same figure is refused with the existing remedy.
 *
 * Runs the approved chat path the validator and the handler share: `buildGraphLookup` → `validateToolCall` →
 * `set_factor_value` → the mutated graph it returns (validated against GraphV3 by the handler).
 */
import { describe, expect, it } from 'vitest';
import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';
import { suggestExtendedCap } from '../d1-shared/evaluate-factor-value-proposal.js';
import { buildGraphLookup } from '../../../routing/graph-lookup-adapter.js';
import { validateToolCall } from '../../../routing/validator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';
import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';

type Rec = Record<string, any>;
const TARGET = 'f-tickets';

function graphWith(olumis: boolean): GraphV3T {
  const graph = buildD1Fixture();
  graph.nodes.push({ id: TARGET, kind: 'factor', label: 'Support tickets', observed_state: {
    value: 0.45, raw_value: 45, cap: 100, unit: 'tickets', source: 'brief_extraction', ...(olumis ? { frame_source: 'olumi_convention' } : {}),
  } } as never);
  return graph;
}
const proposal = (value: number): ProposalAction => ({
  handler_id: 'set_factor_value',
  entity: { id: TARGET, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
  parameters: [{ name: 'value', value: { value, unit: 'tickets' }, source: 'user_explicit' }],
  cited_context_fields: [],
} as unknown as ProposalAction);

async function set(olumis: boolean, value: number): Promise<{ valid: boolean; reason?: unknown; node?: Rec }> {
  const graph = graphWith(olumis);
  const built = buildGraphLookup({ nodes: graph.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, observed_state: n.observed_state })),
    edges: graph.edges.map((e) => ({ from: e.from, to: e.to })) } as never);
  if (built.kind !== 'ok') throw new Error('lookup');
  const validation = validateToolCall(proposal(value), built.lookup, HANDLER_VALIDATION_REGISTRY);
  if (!validation.valid) return { valid: false, reason: validation.error.details?.rejection_reason };
  const out = await createSetFactorValueHandler()({
    context: { session_id: 'scn-u2', stage: 'frame', request_id: 'req-u2', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: { kind: 'message', scenario_id: 'scn-u2', turn_id: 'turn-u2', stage: 'frame', message: `Support tickets are ${value} a week.` },
    requestId: 'req-u2', signal: new AbortController().signal, orientationText: '', proposal: proposal(value), graphForTurn: graph,
  } as unknown as HandlerInvocation) as Rec;
  return { valid: true, node: (out.mutated_graph as Rec).nodes.find((n: Rec) => n.id === TARGET) };
}

describe('U2: a user figure above Olumi\'s reference is saved and the reference widened; a range that is not Olumi\'s still protects', () => {
  it('RED on base: 300 against Olumi\'s 100 passes the validator and is saved as 300, on Olumi\'s widened reference', async () => {
    const r = await set(true, 300);
    expect(r.valid, String(r.reason)).toBe(true);
    const cap = suggestExtendedCap(300);
    expect(r.node!.observed_state).toMatchObject({ raw_value: 300, cap, unit: 'tickets', frame_source: 'olumi_convention' });
    expect(r.node!.observed_state.value).toBeCloseTo(300 / cap, 12);
  });

  it('CONTRAST: the same 300 against a range that is not Olumi\'s is refused by the validator with the existing remedy', async () => {
    expect(await set(false, 300)).toEqual({ valid: false, reason: 'value_exceeds_cap' });
  });

  it('CONTROL: a figure inside Olumi\'s reference leaves the reference as it was', async () => {
    const r = await set(true, 60);
    expect(r.node!.observed_state).toMatchObject({ raw_value: 60, cap: 100, frame_source: 'olumi_convention' });
  });
});
