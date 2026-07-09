/**
 * ROADMAP 1.52 — goal-fit sign-inversion backstop.
 *
 * THE BUG (traced, hand-verified on the 6B capture): "reduce cost by 15%"
 * encodes as `{operator: '>=', value: +0.15}` against a signed-delta
 * outcome that goes NEGATIVE on success → P(outcome >= +0.15) ≡ ~0
 * structurally, regardless of how good the option actually is. Honest
 * number for the captured scenario ≈ 97-99%, displayed ≈ 0%.
 *
 * THE BACKSTOP (this handler): the tool-schema guidance tells Sonnet to
 * flip reduction-framed targets to `at_most`/negative — but if Sonnet
 * ignores that guidance and still emits the naive `>=`/positive reading
 * against a message that used explicit reduction-by framing, the handler
 * refuses to persist the (probably inverted) constraint and asks for
 * confirmation instead of silently completing it. This is a REFUSAL, not
 * a silent auto-flip — the fix doctrine is explicit that ambiguous cases
 * must route to clarify, never a guessed correction.
 *
 * Non-goals covered here: an ordinary `at_most`/positive registration
 * (the pre-existing, correct case) and an absolute-level restatement
 * ("keep cost under £40k", no "by") must be completely unaffected.
 */
import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

function buildInvocation(
  graph: GraphV3T,
  proposal: ProposalAction,
  message: string,
): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-1',
      stage: 'frame',
      request_id: 'req-1',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-1',
      turn_id: 'turn-1',
      stage: 'frame',
      message,
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function makeProposal(p: {
  readonly entityId: string;
  readonly entityKind?: 'node' | 'goal';
  readonly constraintType: 'at_least' | 'at_most';
  readonly value: number;
  readonly unit?: string;
}): ProposalAction {
  const params: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: p.constraintType, source: 'user_explicit' },
    { name: 'value', value: p.value, source: 'user_explicit' },
  ];
  if (p.unit) params.push({ name: 'unit', value: p.unit, source: 'user_explicit' });
  return {
    handler_id: 'add_constraint',
    entity: {
      id: p.entityId,
      kind: p.entityKind ?? 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: params,
    cited_context_fields: [],
  };
}

describe('add_constraint reduction-sign backstop — ROADMAP 1.52', () => {
  it('refuses "reduce X by N%" mis-encoded as at_least/positive (the exact 6B fingerprint)', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({ entityId: 'f-budget', constraintType: 'at_least', value: 15, unit: '%' }),
          'Reduce marketing budget by 15% please.',
        ),
      ),
    ).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });

    // Refusal must not mutate the graph — no wrongly-signed constraint
    // should land even transiently.
    expect(graph.goal_constraints ?? []).toHaveLength(0);
  });

  it('refuses the same fingerprint when the target is the goal node itself', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'g-revenue',
            entityKind: 'goal',
            constraintType: 'at_least',
            value: 15,
            unit: '%',
          }),
          'Reduce cost of living by 15% by relocating to Manchester.',
        ),
      ),
    ).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
  });

  it('does NOT block the CORRECT flipped encoding (at_most/negative) for the same reduction message', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-budget', constraintType: 'at_most', value: -15, unit: '%' }),
        'Reduce marketing budget by 15% please.',
      ),
    );

    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints).toHaveLength(1);
    expect(mutated.goal_constraints![0].operator).toBe('<=');
    expect(mutated.goal_constraints![0].value).toBe(-15);
  });

  it('does NOT block an ordinary at_most/positive registration with no reduction framing', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-churn', constraintType: 'at_most', value: 5, unit: '%' }),
        'Keep churn below 5%.',
      ),
    );

    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints![0].operator).toBe('<=');
    expect(mutated.goal_constraints![0].value).toBe(5);
  });

  it('does NOT block an ordinary at_least/positive registration with no reduction framing (unrelated growth target)', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-quality', constraintType: 'at_least', value: 80, unit: '%' }),
        'Quality must be at least 80%.',
      ),
    );

    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints![0].operator).toBe('>=');
    expect(mutated.goal_constraints![0].value).toBe(80);
  });

  it('does NOT block an absolute-level restatement ("reduce X to Y", no "by") even with at_least/positive', async () => {
    // "to" states a level; without "by" the reduction-framing detector
    // does not fire — this exercises that the backstop is scoped to the
    // "by" fingerprint, not every message containing a reduction verb.
    // (Registering this AS at_least/positive would be a separate, orthogonal
    // bug — this test only pins that the NEW backstop does not over-fire.)
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-budget', constraintType: 'at_least', value: 40000, unit: '£' }),
        'Reduce the marketing budget to £40k.',
      ),
    );

    expect(outcome.mutated_graph).toBeDefined();
  });
});
