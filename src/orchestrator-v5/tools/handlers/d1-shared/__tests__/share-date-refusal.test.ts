import { describe, expect, it } from 'vitest';
import { composeHandlerFailureBody } from '../../../../compose/handler-failure-responses.js';
import { isRecoverableHandlerCause } from '../../../../compose/recoverable-handler-causes.js';
import { HandlerInvocationFailedError } from '../../../handler-errors.js';
import { D1HandlerError } from '../errors.js';
import { runD1Handler } from '../error-boundary.js';
import { applyAndValidateMutation } from '../apply-graph-mutation.js';

describe('deadline forecast ownership refusals at the D1 boundary', () => {
  it('L3-P2-ownership: dropping the held team link becomes a typed recoverable refusal with guidance', async () => {
    const graph = {
      nodes: [{ id: 'team', kind: 'factor', label: "Today's team" }, { id: 'goal', kind: 'goal', label: 'Launch' }],
      edges: [{ from: 'team', to: 'goal', strength: { mean: 1, std: 0.01 }, exists_probability: 1,
        effect_direction: 'positive', provenance: { source: 'cee_hypothesis', share_by_date: {
          role: 'team', team_id: 'team', goal_id: 'goal', deliverable: 'the launch', unresolved_option_ids: [],
        } } }],
    };
    const originalBytes = JSON.stringify(graph);
    let caught: unknown;
    try {
      await runD1Handler('remove_edge', async () => {
        applyAndValidateMutation(graph, clone => { clone.edges = []; return { before: null, after: null }; });
        throw new Error('ownership guard did not refuse');
      });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(HandlerInvocationFailedError);
    const typed = caught as HandlerInvocationFailedError;
    expect(typed.cause_kind).toBe('precondition_unmet_at_execute');
    expect(typed.details.reason_code).toBe('SHARE_BY_DATE_SERVER_OWNED');
    expect(isRecoverableHandlerCause(typed.cause_kind)).toBe(true);
    expect(composeHandlerFailureBody(typed).body.assistant_text).toBe(
      "That link holds the deadline forecast's definition, so I can't remove or replace it here. Change the deadline or the team's time on its change card. Nothing was written.",
    );
    expect(JSON.stringify(graph)).toBe(originalBytes);
  });

  it('L3-P2-ownership control: existing D1 typed errors keep their own guidance', async () => {
    const task = runD1Handler('set_factor_value', async () => {
      throw new D1HandlerError('PRECONDITION_UNMET', 'missing', { userGuidance: 'Set the unit first.' });
    });
    await expect(task).rejects.toMatchObject({ cause_kind: 'precondition_unmet_at_execute',
      details: { handler_id: 'set_factor_value', specific_issue: 'Set the unit first.' } });
  });

  it('L3-P2-ownership control: unrelated errors propagate unchanged', async () => {
    const original = new Error('unrelated');
    await expect(runD1Handler('remove_edge', async () => { throw original; })).rejects.toBe(original);
  });
});
