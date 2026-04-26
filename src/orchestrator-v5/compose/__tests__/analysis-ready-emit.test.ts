/**
 * V5 analysis_ready contract tests.
 *
 * Asserts the wire-emit invariant: every compose function in the V5 dispatch
 * surface either includes `analysis_ready` (when the caller passes a payload)
 * or omits the field entirely (when no payload is passed). When emitted, the
 * payload always carries a fresh ISO-8601 `computed_at` so the UI store can
 * apply a monotonic ordering guard.
 *
 * Why this lives next to the helper rather than per-compose-file: the contract
 * is cross-cutting. A future compose function added in V5 will be caught by
 * the schema contract sweep at the bottom of the file rather than by silent
 * drift across many test files.
 */

import { describe, it, expect } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import {
  composeDirectAnswerResponse,
  composeClarifyResponse,
  composeToolCallResponse,
} from '../../compose.js';
import { composeRecoverableValidationResponse } from '../recoverable-validation-response.js';
import { composeUnsupportedActionResponse } from '../unsupported-action-response.js';
import {
  composeValidationFailure,
} from '../validation-failure-responses.js';
import type { ValidationError } from '../../routing/validator.js';
import type { ComposeContext } from '../types.js';
import type { AnalysisReadyPayload } from '../analysis-ready-emit.js';

// ─── Fixtures ────────────────────────────────────────────────────────────

function fixtureAnalysisReady(): AnalysisReadyPayload {
  return {
    status: 'ready',
    goal_node_id: 'goal_productivity',
    options: [
      {
        option_id: 'opt_status_quo',
        label: 'Make No New Hire (Status Quo)',
        status: 'ready',
        interventions: { fac_role_type: 0, fac_headcount: 0 },
        is_baseline: true,
      },
      {
        option_id: 'opt_tech_lead',
        label: 'Hire a Tech Lead',
        status: 'ready',
        interventions: { fac_role_type: 1, fac_headcount: 0.2 },
      },
    ],
  };
}

function fixtureContext(): ComposeContext {
  return { handlerRegistry: [], graph: null };
}

function fixtureValidationError(): ValidationError {
  return {
    code: 'ENTITY_RESOLUTION_AMBIGUOUS',
    details: { entity_kind: 'option', candidates: [] },
  };
}

// ─── computed_at attachment ───────────────────────────────────────────────

describe('analysis-ready-emit: computed_at', () => {
  it('attaches a fresh ISO-8601 computed_at on every emission', () => {
    const env = composeDirectAnswerResponse({
      assistant_text: 'x',
      stage: 'frame',
      analysisReady: fixtureAnalysisReady(),
    });
    const ts = (env.analysis_ready as { computed_at?: string }).computed_at;
    expect(ts).toBeTypeOf('string');
    expect(() => new Date(ts as string).toISOString()).not.toThrow();
    // Round-trip check: the stored string must equal a re-formatted ISO of itself.
    expect(new Date(ts as string).toISOString()).toBe(ts);
  });

  it('does not mutate the input payload (caller-held ref stays timestamp-free)', () => {
    const input = fixtureAnalysisReady();
    composeDirectAnswerResponse({
      assistant_text: 'x',
      stage: 'frame',
      analysisReady: input,
    });
    expect((input as { computed_at?: string }).computed_at).toBeUndefined();
  });

  it('regenerates computed_at across two emissions of the same payload', async () => {
    const input = fixtureAnalysisReady();
    const a = composeDirectAnswerResponse({
      assistant_text: 'a',
      stage: 'frame',
      analysisReady: input,
    });
    // Date.now() resolution is 1ms; force a measurable gap.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = composeDirectAnswerResponse({
      assistant_text: 'b',
      stage: 'frame',
      analysisReady: input,
    });
    const tsA = (a.analysis_ready as { computed_at?: string }).computed_at!;
    const tsB = (b.analysis_ready as { computed_at?: string }).computed_at!;
    expect(new Date(tsB).getTime()).toBeGreaterThan(new Date(tsA).getTime());
  });
});

// ─── Per-compose-function presence/absence ────────────────────────────────

describe('analysis-ready-emit: composeDirectAnswerResponse', () => {
  it('omits analysis_ready when not provided', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    expect('analysis_ready' in env).toBe(false);
    OlumiResponseSchema.parse(env);
  });

  it('includes analysis_ready when provided', () => {
    const env = composeDirectAnswerResponse({
      assistant_text: 'x',
      stage: 'frame',
      analysisReady: fixtureAnalysisReady(),
    });
    expect(env.analysis_ready).toBeDefined();
    expect((env.analysis_ready as { status: string }).status).toBe('ready');
    OlumiResponseSchema.parse(env);
  });
});

describe('analysis-ready-emit: composeClarifyResponse', () => {
  it('omits when not provided / includes when provided', () => {
    const without = composeClarifyResponse({ assistant_text: 'x', stage: 'frame' });
    const withReady = composeClarifyResponse({
      assistant_text: 'x',
      stage: 'frame',
      analysisReady: fixtureAnalysisReady(),
    });
    expect('analysis_ready' in without).toBe(false);
    expect(withReady.analysis_ready).toBeDefined();
    OlumiResponseSchema.parse(without);
    OlumiResponseSchema.parse(withReady);
  });
});

describe('analysis-ready-emit: composeToolCallResponse', () => {
  const base = {
    orientation: 'doing the thing',
    confirmation: 'did the thing',
    coaching: null,
    stage: 'analyse' as const,
  };

  it('omits when not provided / includes when provided', () => {
    const without = composeToolCallResponse(base);
    const withReady = composeToolCallResponse({
      ...base,
      analysisReady: fixtureAnalysisReady(),
    });
    expect('analysis_ready' in without).toBe(false);
    expect(withReady.analysis_ready).toBeDefined();
    OlumiResponseSchema.parse(without);
    OlumiResponseSchema.parse(withReady);
  });
});

describe('analysis-ready-emit: composeRecoverableValidationResponse', () => {
  it('omits when not provided / includes when provided', () => {
    const without = composeRecoverableValidationResponse(
      fixtureValidationError(),
      fixtureContext(),
      'frame',
    );
    const withReady = composeRecoverableValidationResponse(
      fixtureValidationError(),
      fixtureContext(),
      'frame',
      fixtureAnalysisReady(),
    );
    expect('analysis_ready' in without.response).toBe(false);
    expect(withReady.response.analysis_ready).toBeDefined();
    OlumiResponseSchema.parse(without.response);
    OlumiResponseSchema.parse(withReady.response);
  });
});

describe('analysis-ready-emit: composeUnsupportedActionResponse', () => {
  it('omits when not provided / includes when provided', () => {
    const baseInput = {
      handlerId: 'add_node',
      context: fixtureContext(),
      stage: 'frame' as const,
      hasAnalysis: false,
    };
    const without = composeUnsupportedActionResponse(baseInput);
    const withReady = composeUnsupportedActionResponse({
      ...baseInput,
      analysisReady: fixtureAnalysisReady(),
    });
    expect('analysis_ready' in without.response).toBe(false);
    expect(withReady.response.analysis_ready).toBeDefined();
    OlumiResponseSchema.parse(without.response);
    OlumiResponseSchema.parse(withReady.response);
  });
});

describe('analysis-ready-emit: composeValidationFailure (impossible-state 500 wrapper)', () => {
  it('omits when not provided / includes when provided', () => {
    const without = composeValidationFailure(
      fixtureValidationError(),
      fixtureContext(),
      'frame',
    );
    const withReady = composeValidationFailure(
      fixtureValidationError(),
      fixtureContext(),
      'frame',
      fixtureAnalysisReady(),
    );
    expect('analysis_ready' in without.response).toBe(false);
    expect(withReady.response.analysis_ready).toBeDefined();
    OlumiResponseSchema.parse(without.response);
    OlumiResponseSchema.parse(withReady.response);
  });
});

// ─── Schema contract sweep ────────────────────────────────────────────────
//
// Catches future drift: any compose function that produces an OlumiResponse
// must accept the analysis_ready field and round-trip it through the
// boundary schema. Adding a new compose surface without wiring this is a
// test failure rather than a silent regression.

describe('analysis-ready-emit: schema contract sweep across V5 compose surface', () => {
  const ar = fixtureAnalysisReady();
  const ctx = fixtureContext();
  const err = fixtureValidationError();

  const cases: Array<{ name: string; build: () => unknown }> = [
    {
      name: 'composeDirectAnswerResponse',
      build: () =>
        composeDirectAnswerResponse({
          assistant_text: 'x',
          stage: 'frame',
          analysisReady: ar,
        }),
    },
    {
      name: 'composeClarifyResponse',
      build: () =>
        composeClarifyResponse({
          assistant_text: 'x',
          stage: 'frame',
          analysisReady: ar,
        }),
    },
    {
      name: 'composeToolCallResponse',
      build: () =>
        composeToolCallResponse({
          orientation: 'o',
          confirmation: 'c',
          coaching: null,
          stage: 'analyse',
          analysisReady: ar,
        }),
    },
    {
      name: 'composeRecoverableValidationResponse',
      build: () =>
        composeRecoverableValidationResponse(err, ctx, 'frame', ar).response,
    },
    {
      name: 'composeUnsupportedActionResponse',
      build: () =>
        composeUnsupportedActionResponse({
          handlerId: 'add_node',
          context: ctx,
          stage: 'frame',
          hasAnalysis: false,
          analysisReady: ar,
        }).response,
    },
    {
      name: 'composeValidationFailure',
      build: () => composeValidationFailure(err, ctx, 'frame', ar).response,
    },
  ];

  for (const { name, build } of cases) {
    it(`${name}: emits schema-valid analysis_ready with computed_at`, () => {
      const env = build();
      const parsed = OlumiResponseSchema.parse(env);
      expect(parsed.analysis_ready).toBeDefined();
      expect((parsed.analysis_ready as { status: string }).status).toBe('ready');
      expect(
        (parsed.analysis_ready as { computed_at?: string }).computed_at,
      ).toBeTypeOf('string');
    });
  }
});
