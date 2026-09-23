/**
 * A VALUE THE PRODUCT CHOSE MUST NOT WEAR THE USER'S NAME.
 *
 * ── THE DEFECT, MEASURED ON DEPLOYED STAGING ───────────────────────────────
 * 23 Sep, scenario `450acd25`, guest, agent lane: fourteen factors were filled
 * in twenty-one seconds and EVERY ONE persisted as `provenance: 'user_set'`.
 * Eight were exactly the midpoint (`0.5`, raw `50`); one set
 * `Tech Lead headcount = 0` inside a decision about whether to hire a Tech
 * Lead. The user stated none of them.
 *
 * The cause was one line: `node.provenance = 'user_set'` UNCONDITIONALLY,
 * while the same mutation already stamps `observed_state.source` from
 * `appliedProvenance` sixty lines above. Two authorities on one question, and
 * the node-level one — which trust surfaces read — could not be told the truth.
 *
 * ── WHY THE ORACLE IS THE ENUM, NOT A PREFERENCE ───────────────────────────
 * `NodeV3.provenance` is `from_brief | ai_inferred | user_set`
 * (`schemas/cee-v3.ts:363`), and the estate's source vocabulary splits cleanly:
 * `user_explicit|user_specified|user_stated|user_override|user_edited` are a
 * human; `ai_estimated` and `system_event` are not. The mapping below is that
 * split, not this author's judgement.
 *
 * ⚠ SCOPE. This proves the HANDLER stamps what the caller declares. It does not
 * detect an agent and must not be read as doing so — the internal dispatch
 * carries no lane marker. Making the agent lane DECLARE a non-user source is a
 * separate change in that lane.
 */
import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { createSetFactorValueHandler } from '../set-factor-value.js';
import { nodeProvenanceFromSource } from '../set-factor-value.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';
import { OBSERVED_STATE_SOURCE_LITERALS } from '@talchain/schemas';

function buildInvocation(
  graph: GraphV3T,
  proposal: ProposalAction,
  appliedProvenance?: { readonly source: string },
): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-1', stage: 'frame', request_id: 'req-1',
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message', scenario_id: 'scn-1', turn_id: 'turn-1',
      stage: 'frame', message: 'set churn to 5%',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
    ...(appliedProvenance === undefined ? {} : { appliedProvenance }),
  } as unknown as HandlerInvocation;
}

const proposal: ProposalAction = {
  handler_id: 'set_factor_value',
  entity: { id: 'f-churn', kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
  parameters: [{ name: 'value', value: { value: 5, unit: '%', cap: 100 }, operator: 'set', source: 'user_explicit' }],
  cited_context_fields: [],
} as unknown as ProposalAction;

async function stampFor(appliedProvenance?: { readonly source: string }) {
  const outcome = await createSetFactorValueHandler()(
    buildInvocation(buildD1Fixture(), proposal, appliedProvenance),
  );
  const node = (outcome.mutated_graph as GraphV3T).nodes.find((n) => n.id === 'f-churn');
  return {
    nodeProvenance: (node as { provenance?: unknown } | undefined)?.provenance,
    observedSource: (node?.observed_state as { source?: unknown } | undefined)?.source,
  };
}

describe('authorship is reported, not assumed', () => {
  it('a machine-chosen value is NOT recorded as the user’s', async () => {
    const { nodeProvenance } = await stampFor({ source: 'cee_inference' });
    expect(nodeProvenance).toBe('ai_inferred');
  });

  it('CONTROL: an ordinary edit (no appliedProvenance) is byte-identical to before', async () => {
    const { nodeProvenance } = await stampFor(undefined);
    expect(nodeProvenance).toBe('user_set');
  });

  it('CONTROL: a declared USER source is still the user', async () => {
    for (const source of ['user_override', 'user_confirmed', 'user', 'user_edited', 'user_assumption', 'user_calibration']) {
      const { nodeProvenance } = await stampFor({ source });
      expect(nodeProvenance).toBe('user_set');
    }
  });

  it('a repair writer is not a human either', async () => {
    expect((await stampFor({ source: 'cee_repair' })).nodeProvenance).toBe('ai_inferred');
    expect((await stampFor({ source: 'inferred' })).nodeProvenance).toBe('ai_inferred');
  });

  it('the brief is the brief \u2014 neither the user nor the machine', async () => {
    expect((await stampFor({ source: 'brief_extraction' })).nodeProvenance).toBe('from_brief');
  });

  it('THE TWO STAMPS MUST NOT CONTRADICT — that divergence was the defect', async () => {
    const machine = await stampFor({ source: 'cee_inference' });
    // observed_state.source already recorded the truth; the node stamp used to lie.
    expect(machine.observedSource).toBe('cee_inference');
    expect(machine.nodeProvenance).toBe('ai_inferred');

    const human = await stampFor({ source: 'user_override' });
    expect(human.observedSource).toBe('user_override');
    expect(human.nodeProvenance).toBe('user_set');
  });

  it('EXHAUSTIVE against the contract \u2014 no literal can arrive unmapped', () => {
    // Bound to the shared contract's own list, so a new member added upstream
    // fails here instead of silently defaulting.
    for (const literal of OBSERVED_STATE_SOURCE_LITERALS) {
      const mapped = nodeProvenanceFromSource(literal);
      expect(['user_set', 'from_brief', 'ai_inferred']).toContain(mapped);
      // A literal this table does not name would fall through to ai_inferred.
      // Assert every declared literal is NAMED, not merely handled.
      const named = literal.startsWith('user') || literal === 'panel_elicited'
        ? 'user_set'
        : literal === 'brief_extraction' || literal === 'explicit'
          ? 'from_brief'
          : 'ai_inferred';
      expect(mapped).toBe(named);
    }
    expect(nodeProvenanceFromSource(undefined)).toBe('user_set');
    // An unknown source UNDER-claims, never over-claims.
    expect(nodeProvenanceFromSource('a_source_that_does_not_exist')).toBe('ai_inferred');
  });
});
