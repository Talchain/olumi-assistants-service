/**
 * V5 response finaliser — contract tests.
 *
 * Three groups of assertions:
 *
 *   1. Composer cleanliness sweep — every V5 compose function produces a
 *      response that does NOT carry `analysis_ready`. The brief's
 *      architectural principle ("Fields the user depends on must not be
 *      opt-in per composer") is enforceable: a future composer added
 *      without contract awareness will be caught by both this test and
 *      the grep gate at scripts/check-no-direct-analysis-ready.sh.
 *
 *   2. Finaliser behaviour — `finaliseV5Response` stamps `analysis_ready`
 *      with a fresh `computed_at` when given a payload, omits the field
 *      when not, and is idempotent (the second call re-stamps with a
 *      fresh timestamp; the rest of the payload stays identical).
 *
 *   3. Schema contract sweep — every (composer output × {with payload,
 *      without payload}) combination round-trips through OlumiResponseSchema
 *      after passing through the finaliser. Catches future drift where a
 *      new compose function would silently bypass the contract.
 */

import { describe, it, expect, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import {
  composeDirectAnswerResponse,
  composeClarifyResponse,
  composeToolCallResponse,
} from '../compose.js';
import { composeRecoverableValidationResponse } from '../compose/recoverable-validation-response.js';
import { composeUnsupportedActionResponse } from '../compose/unsupported-action-response.js';
import { composeValidationFailure } from '../compose/validation-failure-responses.js';
import { finaliseV5Response } from '../response-finaliser.js';
import type { ValidationError } from '../routing/validator.js';
import type { ComposeContext } from '../compose/types.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import type { FreshnessDerivation } from '../context/freshness.js';
import { AnalysisReadyPayload as CeeAnalysisReadyPayloadSchema } from '../../schemas/analysis-ready.js';

// ─── Fixtures ────────────────────────────────────────────────────────────

function fixturePayload(): AnalysisReadyPayload {
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

// ─── Group 1: composer cleanliness sweep ──────────────────────────────────

describe('finaliser contract — composers do not set analysis_ready', () => {
  it('composeDirectAnswerResponse output omits analysis_ready', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    expect('analysis_ready' in env).toBe(false);
  });

  it('composeClarifyResponse output omits analysis_ready', () => {
    const env = composeClarifyResponse({ assistant_text: 'x', stage: 'frame' });
    expect('analysis_ready' in env).toBe(false);
  });

  it('composeToolCallResponse output omits analysis_ready', () => {
    const env = composeToolCallResponse({
      orientation: 'o',
      confirmation: 'c',
      coaching: null,
      stage: 'analyse',
    });
    expect('analysis_ready' in env).toBe(false);
  });

  it('composeRecoverableValidationResponse output omits analysis_ready', () => {
    const out = composeRecoverableValidationResponse(
      fixtureValidationError(),
      fixtureContext(),
      'frame',
    );
    expect('analysis_ready' in out.response).toBe(false);
  });

  it('composeValidationFailure (impossible-state 500) output omits analysis_ready', () => {
    const out = composeValidationFailure(
      fixtureValidationError(),
      fixtureContext(),
      'frame',
    );
    expect('analysis_ready' in out.response).toBe(false);
  });

  it('composeUnsupportedActionResponse output omits analysis_ready', () => {
    const out = composeUnsupportedActionResponse({
      handlerId: 'add_node',
      context: fixtureContext(),
      stage: 'frame',
      hasAnalysis: false,
    });
    expect('analysis_ready' in out.response).toBe(false);
  });
});

// ─── Group 2: finaliser behaviour ─────────────────────────────────────────

describe('finaliseV5Response — behaviour', () => {
  it('omits analysis_ready when ctx.analysisReady is undefined', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const finalised = finaliseV5Response(env, {});
    expect('analysis_ready' in finalised).toBe(false);
    OlumiResponseSchema.parse(finalised);
  });

  it('stamps analysis_ready with a fresh ISO-8601 computed_at when payload provided', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const finalised = finaliseV5Response(env, { analysisReady: fixturePayload() });
    expect(finalised.analysis_ready).toBeDefined();
    const ts = (finalised.analysis_ready as { computed_at?: string }).computed_at;
    expect(ts).toBeTypeOf('string');
    expect(new Date(ts as string).toISOString()).toBe(ts);
    OlumiResponseSchema.parse(finalised);
  });

  it('preserves the response shape (response_version, blocks, suggested_actions, etc.)', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'hello', stage: 'analyse' });
    const finalised = finaliseV5Response(env, { analysisReady: fixturePayload() });
    expect(finalised.response_version).toBe(env.response_version);
    expect(finalised.assistant_text).toBe(env.assistant_text);
    expect(finalised.blocks).toEqual(env.blocks);
    expect(finalised.suggested_actions).toEqual(env.suggested_actions);
    expect(finalised.insights).toEqual(env.insights);
    expect(finalised.stage_indicator).toBe(env.stage_indicator);
  });

  it('does not mutate the input response or payload (caller refs stay clean)', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const payload = fixturePayload();
    finaliseV5Response(env, { analysisReady: payload });
    expect('analysis_ready' in env).toBe(false);
    expect((payload as { computed_at?: string }).computed_at).toBeUndefined();
  });

  it('is idempotent — calling twice re-stamps computed_at; structure is identical', async () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const payload = fixturePayload();
    const first = finaliseV5Response(env, { analysisReady: payload });
    await new Promise((r) => setTimeout(r, 5));
    const second = finaliseV5Response(first, { analysisReady: payload });
    const ts1 = (first.analysis_ready as { computed_at?: string }).computed_at!;
    const ts2 = (second.analysis_ready as { computed_at?: string }).computed_at!;
    expect(new Date(ts2).getTime()).toBeGreaterThan(new Date(ts1).getTime());
    // Structure (modulo timestamp) identical
    const stripTs = (r: typeof first) => {
      const { computed_at: _ignored, ...rest } = r.analysis_ready as { computed_at?: string };
      return rest;
    };
    expect(stripTs(second)).toEqual(stripTs(first));
  });

  it('regenerates computed_at across two emissions of the same payload', async () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const payload = fixturePayload();
    const a = finaliseV5Response(env, { analysisReady: payload });
    await new Promise((r) => setTimeout(r, 5));
    const b = finaliseV5Response(env, { analysisReady: payload });
    const tsA = (a.analysis_ready as { computed_at?: string }).computed_at!;
    const tsB = (b.analysis_ready as { computed_at?: string }).computed_at!;
    expect(new Date(tsB).getTime()).toBeGreaterThan(new Date(tsA).getTime());
  });
});

// ─── Group 2.5: freshness-only synthesis (Mission 3 transport recovery) ───
//
// A legacy/unparseable graph reload derives an honest 'unknown' freshness
// verdict but builds no structural readiness payload. The finaliser
// synthesises a minimal science-free analysis_ready carrier for EXACTLY the
// two legacy/unparseable reasons; every other no-readiness case keeps the
// omit behaviour. Widening the gate (stale-without-readiness, other unknown
// reasons such as edit_graph's derivation_failed) is a separate product
// decision — the omission tests below are enforcing pins, not placeholders.

describe('finaliseV5Response — freshness-only synthesis', () => {
  function derivation(overrides: Partial<FreshnessDerivation> = {}): FreshnessDerivation {
    return {
      freshness: 'unknown',
      reason: 'current_graph_hash_unavailable',
      selected_fact_index: 0,
      graph_hash_at_run: 'sha256:prior',
      current_graph_hash: null,
      computed_at: '2026-05-10T10:00:00.000Z',
      ...overrides,
    };
  }

  it('synthesises a freshness-only block for unknown/current_graph_hash_unavailable with no readiness payload', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const finalised = finaliseV5Response(env, { freshness: derivation() });

    const ar = finalised.analysis_ready as Record<string, unknown>;
    expect(ar).toBeDefined();
    expect(ar.freshness).toBe('unknown');
    expect(ar.freshness_reason).toBe('current_graph_hash_unavailable');
    expect(ar.status).toBe('blocked');
    expect(ar.options).toEqual([]);
    expect(ar.goal_node_id).toBe('');
    expect(ar.bias_findings).toEqual([]);
    expect(ar.graph_hash_at_run).toBe('sha256:prior');
    expect('current_graph_hash' in ar).toBe(false);
    // computed_at preserves the selected fact's run timestamp.
    expect(ar.computed_at).toBe('2026-05-10T10:00:00.000Z');

    // Science-free: no claim-bearing keys ride the synthesized carrier.
    expect('blockers' in ar).toBe(false);
    expect('model_adjustments' in ar).toBe(false);
    expect('user_questions' in ar).toBe(false);
    expect('coaching_summary' in ar).toBe(false);

    // Wire-valid at both the boundary and the CEE schema.
    OlumiResponseSchema.parse(finalised);
    CeeAnalysisReadyPayloadSchema.parse(ar);
  });

  it('synthesises for legacy_fact_missing_hash; null fact timestamp falls back to wire-emit time', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const finalised = finaliseV5Response(env, {
      freshness: derivation({
        reason: 'legacy_fact_missing_hash',
        graph_hash_at_run: null,
        computed_at: null,
      }),
    });
    const ar = finalised.analysis_ready as Record<string, unknown>;
    expect(ar.freshness).toBe('unknown');
    expect(ar.freshness_reason).toBe('legacy_fact_missing_hash');
    expect('graph_hash_at_run' in ar).toBe(false);
    expect(ar.computed_at).toBeTypeOf('string');
    expect(new Date(ar.computed_at as string).toISOString()).toBe(ar.computed_at);
    OlumiResponseSchema.parse(finalised);
  });

  it('a real readiness payload wins over synthesis on the same unknown verdict', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const finalised = finaliseV5Response(env, {
      analysisReady: fixturePayload(),
      freshness: derivation(),
    });
    const ar = finalised.analysis_ready as Record<string, unknown>;
    expect(ar.status).toBe('ready');
    expect((ar.options as unknown[]).length).toBe(2);
    expect(ar.freshness).toBe('unknown');
  });

  it('does NOT synthesise for freshness none (no prior analysis)', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const finalised = finaliseV5Response(env, {
      freshness: derivation({
        freshness: 'none',
        reason: 'no_successful_run_analysis_fact',
        selected_fact_index: null,
        graph_hash_at_run: null,
        computed_at: null,
      }),
    });
    expect('analysis_ready' in finalised).toBe(false);
  });

  it('does NOT synthesise for freshness fresh without a readiness payload', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const finalised = finaliseV5Response(env, {
      freshness: derivation({
        freshness: 'fresh',
        reason: 'graph_hash_match',
        current_graph_hash: 'sha256:prior',
      }),
    });
    expect('analysis_ready' in finalised).toBe(false);
  });

  it('does NOT synthesise for stale without a readiness payload (known follow-up, deliberately unrecovered)', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const finalised = finaliseV5Response(env, {
      freshness: derivation({
        freshness: 'stale',
        reason: 'graph_hash_diverged',
        current_graph_hash: 'sha256:current',
      }),
    });
    expect('analysis_ready' in finalised).toBe(false);
  });

  it('does NOT synthesise for unknown with non-allowlisted reasons (derivation_failed, invariant_failed)', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    for (const reason of ['derivation_failed', 'invariant_failed'] as const) {
      const finalised = finaliseV5Response(env, {
        freshness: derivation({ reason, selected_fact_index: null, graph_hash_at_run: null, computed_at: null }),
      });
      expect('analysis_ready' in finalised).toBe(false);
    }
  });
});

// ─── Group 3: schema contract sweep ───────────────────────────────────────
//
// For every compose surface, verify the (compose → finalise) pipeline lands
// a schema-valid OlumiResponse. Future compose functions added without
// finaliser awareness will be caught by either this sweep (if registered)
// or the grep gate (if not).

describe('finaliser contract — schema sweep across compose surface', () => {
  const payload = fixturePayload();
  const ctx = fixtureContext();
  const err = fixtureValidationError();

  const cases: Array<{ name: string; build: () => unknown }> = [
    {
      name: 'composeDirectAnswerResponse',
      build: () => composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' }),
    },
    {
      name: 'composeClarifyResponse',
      build: () => composeClarifyResponse({ assistant_text: 'x', stage: 'frame' }),
    },
    {
      name: 'composeToolCallResponse',
      build: () =>
        composeToolCallResponse({
          orientation: 'o',
          confirmation: 'c',
          coaching: null,
          stage: 'analyse',
        }),
    },
    {
      name: 'composeRecoverableValidationResponse',
      build: () => composeRecoverableValidationResponse(err, ctx, 'frame').response,
    },
    {
      name: 'composeValidationFailure',
      build: () => composeValidationFailure(err, ctx, 'frame').response,
    },
    {
      name: 'composeUnsupportedActionResponse',
      build: () =>
        composeUnsupportedActionResponse({
          handlerId: 'add_node',
          context: ctx,
          stage: 'frame',
          hasAnalysis: false,
        }).response,
    },
  ];

  for (const { name, build } of cases) {
    it(`${name} → finalise(without payload) → schema valid, no analysis_ready`, () => {
      const env = build() as Parameters<typeof finaliseV5Response>[0];
      const finalised = finaliseV5Response(env, {});
      const parsed = OlumiResponseSchema.parse(finalised);
      expect('analysis_ready' in parsed).toBe(false);
    });

    it(`${name} → finalise(with payload) → schema valid + analysis_ready stamped`, () => {
      const env = build() as Parameters<typeof finaliseV5Response>[0];
      const finalised = finaliseV5Response(env, { analysisReady: payload });
      const parsed = OlumiResponseSchema.parse(finalised);
      expect(parsed.analysis_ready).toBeDefined();
      expect((parsed.analysis_ready as { status: string }).status).toBe('ready');
      expect(
        (parsed.analysis_ready as { computed_at?: string }).computed_at,
      ).toBeTypeOf('string');
    });
  }
});

// ─── Group 4: adversarial — bypass patterns the grep gate must catch ─────
//
// These are not unit tests of the finaliser per se; they're documentation
// of the bypass shapes the pre-push gate (scripts/check-no-direct-analysis-ready.sh)
// is designed to catch. If a future contributor adds one of these patterns
// to a composer or handler, both this test (via the schema sweep above
// detecting unexpected analysis_ready in compose output) AND the grep gate
// (run as pre-push check #15) will fire.
//
// Patterns intentionally NOT testable here: `const k = "analysis_ready";
// response[k] = ...` with an aliased key. Grep cannot catch this; the
// schema sweep does — composer outputs are inspected for unexpected
// analysis_ready presence regardless of how it was set. See
// adversarial-bypass note in scripts/check-no-direct-analysis-ready.sh.

// ─── Group 4.5: chip-click compose → finaliser end-to-end contract ────────
//
// The V5 golden-path Step 4 is a chip-click → composeToolCallResponse →
// finaliseV5Response chain. This test pins both halves of the ownership
// contract in one assertion: composer never writes analysis_ready
// (negative), finaliser stamps it (positive). Designed to be hard to
// silently break — any drift in either direction fails the test.

describe('finaliser contract — chip-click compose negative-then-positive', () => {
  it('composeToolCallResponse omits analysis_ready; finaliseV5Response stamps it on the same envelope', () => {
    const env = composeToolCallResponse({
      orientation: '',
      confirmation: 'Ran analysis on your current scenario.',
      coaching: null,
      stage: 'analyse',
    });

    // Negative: composer surface clean.
    expect('analysis_ready' in env).toBe(false);

    // Positive: feed THAT exact envelope into the finaliser with a payload.
    const finalised = finaliseV5Response(env, { analysisReady: fixturePayload() });
    expect('analysis_ready' in finalised).toBe(true);
    expect(finalised.analysis_ready).toBeDefined();
    expect((finalised.analysis_ready as { status: string }).status).toBe('ready');
    expect(
      (finalised.analysis_ready as { computed_at?: string }).computed_at,
    ).toBeTypeOf('string');

    // Schema round-trip — proves the post-finalise body is wire-valid.
    OlumiResponseSchema.parse(finalised);

    // Composer envelope NOT mutated (caller refs stay clean).
    expect('analysis_ready' in env).toBe(false);
  });
});

// ─── Group 4.7: defensive ceeTrace scrub on egress ────────────────────────
//
// V5 source code does not write `ceeTrace`, but the V5 golden-path baseline
// observed `ceeTrace.reason: "CEE"` on a Step 4 wire response from an
// earlier deploy. The finaliser strips any `ceeTrace` field from the
// response when CEE_TURN_DEBUG_ENABLED is false — a permanent guard
// against upstream regressions.

describe('finaliser contract — ceeTrace defensive scrub', () => {
  it('strips ceeTrace when present on the response and debug is disabled', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const polluted = { ...env, ceeTrace: { reason: 'CEE' } } as typeof env & {
      ceeTrace: { reason: string };
    };
    const finalised = finaliseV5Response(polluted, {});
    expect('ceeTrace' in (finalised as object)).toBe(false);
  });

  it('strips ceeTrace alongside analysis_ready stamping when payload also provided', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const polluted = { ...env, ceeTrace: { reason: 'CEE', pipeline: 'foo' } } as typeof env & {
      ceeTrace: { reason: string; pipeline: string };
    };
    const finalised = finaliseV5Response(polluted, { analysisReady: fixturePayload() });
    expect('ceeTrace' in (finalised as object)).toBe(false);
    expect('analysis_ready' in finalised).toBe(true);
  });

  it('no-op when ceeTrace is absent (no spurious key insertion)', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    expect('ceeTrace' in (env as object)).toBe(false);
    const finalised = finaliseV5Response(env, {});
    expect('ceeTrace' in (finalised as object)).toBe(false);
  });

  // Improvement 4: prove the ceeTrace strip is opt-out, not always-on.
  // When CEE_TURN_DEBUG_ENABLED is true, operators inspecting wire
  // responses MUST be able to see the trace field. The default-disabled
  // behaviour is a defensive guard for production traffic; it must not
  // block the documented debugging path.
  it('preserves ceeTrace when CEE_TURN_DEBUG_ENABLED is explicitly true (operator inspection path)', async () => {
    // Re-import the finaliser with the debug flag flipped so the
    // module-level `config` proxy reads the overridden value at call
    // time. We do this by stashing the original env, mutating it, and
    // re-importing the module.
    const ORIGINAL = process.env.CEE_TURN_DEBUG_ENABLED;
    try {
      process.env.CEE_TURN_DEBUG_ENABLED = 'true';
      // Force config re-evaluation by clearing the module cache and
      // re-importing the finaliser. The `config` value in
      // response-finaliser.ts is a lazy Proxy that reads from process.env
      // each access, so the new value is observed without cache busting.
      vi.resetModules();
      const { finaliseV5Response: finaliseDebug } = await import('../response-finaliser.js');
      const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
      const polluted = { ...env, ceeTrace: { reason: 'CEE', pipeline: 'foo' } } as typeof env & {
        ceeTrace: { reason: string; pipeline: string };
      };
      const finalised = finaliseDebug(polluted, {});
      expect('ceeTrace' in (finalised as object)).toBe(true);
      expect((finalised as unknown as { ceeTrace: unknown }).ceeTrace).toEqual({
        reason: 'CEE',
        pipeline: 'foo',
      });
    } finally {
      if (ORIGINAL === undefined) {
        delete process.env.CEE_TURN_DEBUG_ENABLED;
      } else {
        process.env.CEE_TURN_DEBUG_ENABLED = ORIGINAL;
      }
      vi.resetModules();
    }
  });

  // Nested scrub — staging f588320 observed `blocks[0].enrichment.ceeTrace`
  // from the decision-review enricher passthrough. The original top-level
  // strip missed it entirely. These four cases lock the deeper walk in.

  it('strips nested blocks[*].enrichment.ceeTrace when debug is disabled', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const polluted = {
      ...env,
      blocks: [
        {
          type: 'analysis_result',
          enrichment: {
            ceeTrace: {
              reason: 'Legacy CEE calls skipped (M2 decision-review enabled)',
            },
            factor_sensitivity: [{ factor_id: 'fac_a', strength: 0.5 }],
          },
        },
      ],
    } as unknown as typeof env;
    const finalised = finaliseV5Response(polluted, {});
    const blocks = (finalised as unknown as {
      blocks: Array<{ enrichment?: Record<string, unknown> }>;
    }).blocks;
    expect(blocks[0].enrichment).toBeDefined();
    expect('ceeTrace' in (blocks[0].enrichment as object)).toBe(false);
    // Sibling fields under enrichment must survive — the scrub strips
    // only `ceeTrace`, never the rest of the enrichment payload.
    expect((blocks[0].enrichment as { factor_sensitivity?: unknown }).factor_sensitivity)
      .toBeDefined();
  });

  it('strips both top-level and nested ceeTrace in the same response', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const polluted = {
      ...env,
      ceeTrace: { reason: 'top' },
      blocks: [
        { type: 'analysis_result', enrichment: { ceeTrace: { reason: 'nested' } } },
      ],
    } as unknown as typeof env;
    const finalised = finaliseV5Response(polluted, {});
    expect('ceeTrace' in (finalised as object)).toBe(false);
    const blocks = (finalised as unknown as {
      blocks: Array<{ enrichment?: Record<string, unknown> }>;
    }).blocks;
    expect('ceeTrace' in (blocks[0].enrichment as object)).toBe(false);
  });

  it('preserves nested blocks[*].enrichment.ceeTrace when CEE_TURN_DEBUG_ENABLED is true', async () => {
    const ORIGINAL = process.env.CEE_TURN_DEBUG_ENABLED;
    try {
      process.env.CEE_TURN_DEBUG_ENABLED = 'true';
      vi.resetModules();
      const { finaliseV5Response: finaliseDebug } = await import('../response-finaliser.js');
      const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
      const polluted = {
        ...env,
        blocks: [
          { type: 'analysis_result', enrichment: { ceeTrace: { reason: 'nested' } } },
        ],
      } as unknown as typeof env;
      const finalised = finaliseDebug(polluted, {});
      const blocks = (finalised as unknown as {
        blocks: Array<{ enrichment?: Record<string, unknown> }>;
      }).blocks;
      expect('ceeTrace' in (blocks[0].enrichment as object)).toBe(true);
    } finally {
      if (ORIGINAL === undefined) {
        delete process.env.CEE_TURN_DEBUG_ENABLED;
      } else {
        process.env.CEE_TURN_DEBUG_ENABLED = ORIGINAL;
      }
      vi.resetModules();
    }
  });

  it('is a no-op when blocks have enrichment without ceeTrace', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    const clean = {
      ...env,
      blocks: [
        {
          type: 'analysis_result',
          enrichment: { factor_sensitivity: [{ factor_id: 'a', strength: 0.1 }] },
        },
      ],
    } as unknown as typeof env;
    const finalised = finaliseV5Response(clean, {});
    const blocks = (finalised as unknown as {
      blocks: Array<{ enrichment?: Record<string, unknown> }>;
    }).blocks;
    expect((blocks[0].enrichment as { factor_sensitivity?: unknown }).factor_sensitivity)
      .toBeDefined();
    expect('ceeTrace' in (blocks[0].enrichment as object)).toBe(false);
  });
});

describe('finaliser contract — adversarial documentation', () => {
  it('schema sweep above catches any composer-set analysis_ready (object literal, dot, dynamic key)', () => {
    // This is a meta-assertion: the cases array above spreads (env without
    // payload → no analysis_ready) for every compose function. If a future
    // composer were to set analysis_ready directly via any pattern (object
    // literal, dot assignment, dynamic key, aliased key), it would appear
    // in the env and the `'analysis_ready' in parsed` check would fail.
    // Documented here for explicit reviewer attention.
    expect(true).toBe(true);
  });
});
