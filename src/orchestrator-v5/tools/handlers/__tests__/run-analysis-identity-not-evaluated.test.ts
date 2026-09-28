/**
 * ⭐ BATCH 7 (R3) — THE WIRING: a PLoT 422 `blocked` carrying ISL #187's `IDENTITY_NOT_EVALUATED` reaches the user as
 * the one question that unblocks it (R&C CLAIM #72 5860867216; AIQ #72 5860888736), composed in the handler from the
 * Run's own persisted graph. Same harness as `run-analysis-typed-refusal-not-500.test.ts`; the 422 body is the one
 * PLoT forwards TODAY (`mapISLCritiquesToV2`, staging 22f3d94), plus the typed `identity` field asked of CLOUD-1.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { PLoTClient, PLoTClientRunOpts, V2RunError } from '../../../../orchestrator/plot-client.js';
import { PLoTError } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { composeHandlerFailureBody } from '../../../compose/handler-failure-responses.js';
import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  HandlerInvocationFailedError,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync(
  new URL('../../../coaching/__tests__/fixtures/isl187-identity-not-evaluated-paul-a295e4a1.json', import.meta.url), 'utf8',
)) as Rec;
const SCENARIO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function plot422(v2: V2RunError): PLoTError {
  const err = new PLoTError(`PLoT run analysis blocked: ${v2.status_reason}`, 422, 'run', 1449, 'req-identity');
  err.v2RunError = v2;
  return err;
}

async function invoke(v2: V2RunError): Promise<HandlerInvocationFailedError> {
  const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_price: 0.9 } },
    ],
    goal_node_id: 'g',
    rawPersistedGraph: F.graph,
  };
  const handler = createRunAnalysisHandler({
    plotClient: {
      run: vi.fn((..._a: [Record<string, unknown>, string, PLoTClientRunOpts | undefined]) =>
        Promise.reject<V2RunResponseEnvelope>(plot422(v2))),
      validatePatch: vi.fn().mockResolvedValue({}),
    } as unknown as PLoTClient,
    scenarioReader: vi.fn(() => Promise.resolve(snapshot)) as unknown as ScenarioReader,
  });
  const invocation: HandlerInvocation = {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO, request_id: 'req-identity',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ turn_id: 't1', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-identity',
    signal: new AbortController().signal,
    orientationText: '',
  };
  try {
    await handler(invocation);
  } catch (err) {
    return err as HandlerInvocationFailedError;
  }
  throw new Error('handler should have thrown');
}

describe('run_analysis — ISL withheld the analysis on an identity: the reply is the ask', () => {
  it('RED-FIRST (the 422 PLoT forwards today): the identity is named, figure-free, never the generic blocked copy', async () => {
    const caught = await invoke(F.plot_422_untyped as V2RunError);
    expect(caught.cause_kind).toBe('analysis_blocked');
    expect(caught.details.plot_primary_code).toBe('IDENTITY_NOT_EVALUATED');
    expect(caught.details.identity_ask).toMatchObject({ reason: 'unstated', node_id: 'mrr' });
    const composed = composeHandlerFailureBody(caught);
    expect(composed.template_id).toBe('analysis_blocked_identity_unstated');
    expect(composed.body.assistant_text.startsWith('“MRR” is worked out as “Pro plan price” × “Pro paying subscribers” + “Other MRR growth”')).toBe(true);
    expect(composed.body.assistant_text).not.toMatch(/\d|fail|couldn't proceed/i);
    expect(caught.details.plot_blocker_code_known).toBe(true);
  });

  it('RED-FIRST (typed identity, CLOUD-1 ask): both figures ISL compared, the stated one labelled with its owner', async () => {
    const v2 = JSON.parse(JSON.stringify(F.plot_422_untyped)) as Rec;
    v2.critiques[0].identity = F.typed_identity_inconsistent;
    const composed = composeHandlerFailureBody(await invoke(v2 as V2RunError));
    expect(composed.template_id).toBe('analysis_blocked_identity_identity_inconsistent');
    expect(composed.body.assistant_text).toContain('gives £50,000, but you said “MRR” is £75,000. Which is right?');
  });

  it('CONTRAST: another blocked code keeps its own copy, with no ask attached', async () => {
    const caught = await invoke({ analysis_status: 'blocked', status_reason: 'x', critiques: [{ code: 'NO_PATH_TO_GOAL', message: 'm' }] });
    expect(caught.details.identity_ask).toBeUndefined();
    expect(composeHandlerFailureBody(caught).template_id).not.toMatch(/identity/);
  });
});
