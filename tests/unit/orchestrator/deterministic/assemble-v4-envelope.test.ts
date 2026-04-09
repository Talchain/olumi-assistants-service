/**
 * Tests for v4 pipeline guard wiring (2026-04-09).
 *
 * Covers pipeline-v4.ts:assembleV4Envelope — the v4 equivalent of
 * response-assembler.legacy.ts:assembleDeterministicResponse. Prior to this
 * fix brief, T3 (mutation health gate), T4 (semantic patch summaries), T5
 * (proposal-language guard), and T1-Phase-A (structured failure) were all
 * wired ONLY into the legacy response-assembler, which is dead code under
 * CEE_PIPELINE_V4_ENABLED=true. This file pins the v4 wiring so regressions
 * are caught locally.
 *
 * See docs/open-issues-root-cause-investigation-2026-04-09.md for the
 * investigation that uncovered the dead-code wiring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/context/context-hash.js", () => ({
  computeContextHash: () => 'hash',
}));

vi.mock("../../../../src/orchestrator/guidance/post-analysis.js", () => ({
  generatePostAnalysisGuidance: () => [],
}));

import { setFactorValueAction } from "../../../../src/orchestrator/deterministic/actions/set-factor-value.js";
import { assembleV4Envelope } from "../../../../src/orchestrator/deterministic/pipeline-v4.js";
import { log } from "../../../../src/utils/telemetry.js";
import type {
  DeterministicTurnContext,
  ActionResult,
} from "../../../../src/orchestrator/deterministic/types.js";
import type { PatchOperation } from "../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

const warnSpy = vi.mocked(log.warn);

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Ship on time' },
      { id: 'fac_capacity', kind: 'factor', label: 'Development Capacity' },
      { id: 'fac_cost', kind: 'factor', label: 'AI Tool Cost' },
    ],
    edges: [
      {
        from: 'fac_capacity',
        to: 'goal_1',
        strength: { mean: 0.7, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
      {
        from: 'fac_cost',
        to: 'goal_1',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'negative',
      },
    ],
  } as unknown as GraphV3T;
}

function makeCtx(cap = 50): DeterministicTurnContext {
  const graph = makeGraph();
  return {
    stage: 'evaluate',
    entities: {
      nodes: new Map([
        [
          'fac_capacity',
          {
            id: 'fac_capacity',
            label: 'Development Capacity',
            kind: 'factor',
            cap,
            unit: 'units',
            aliases: [],
          } as unknown as never,
        ],
        [
          'fac_cost',
          {
            id: 'fac_cost',
            label: 'AI Tool Cost',
            kind: 'factor',
            unit: '£',
            aliases: [],
          } as unknown as never,
        ],
      ]),
      edges: [],
      option_ids: [],
      goal_id: 'goal_1',
    },
    graph_summary: {
      node_count: 3,
      edge_count: 2,
      option_count: 0,
      option_labels: [],
      goal_label: 'Ship on time',
      missing_structural: [],
    },
    analysis_summary: null,
    capabilities: {
      can_run_analysis: false,
      can_explain_results: false,
      can_edit_graph: true,
      can_compare_options: false,
      can_challenge: false,
      can_generate_artefact: false,
    },
    blockers: [],
    signals: {
      high_uncertainty_factors: [],
      dominant_factor: null,
      close_call: false,
      default_value_count: 0,
      weak_edges: [],
    },
    conversation: {
      turn_count: 1,
      last_user_intent: null,
      recent_actions_taken: [],
      recent_actions_declined: [],
      pending_confirmation: null,
    },
    eligible_actions: ['set_factor_value', 'add_factor', 'add_option'],
    disambiguation_hints: [],
    graph,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test',
    turn_id: 'turn-1',
    analysis_inputs: null,
  } as unknown as DeterministicTurnContext;
}

/**
 * Build a typical set_factor_value action result manually so we can exercise
 * each guard independently. Mirrors what the set_factor_value handler would
 * return when asked to update fac_cost to a new value. The returned
 * assistantText intentionally leaks proposal-language so T5 can be asserted.
 */
function makeSetFactorValueResult(opts: {
  leakyText?: boolean;
  failure?: boolean;
} = {}): ActionResult {
  if (opts.failure) {
    return {
      operations: undefined,
      blocks: [],
      assistantText: '',
      failure: {
        code: 'CAP_EXCEEDED',
        message: 'value 100 exceeds cap 50 for fac_capacity',
        user_message: 'Development Capacity has a maximum of 50. Try a lower value.',
        recovery_hint: 'Pick a value at or below 50.',
      },
      guidance_items: [],
    } as unknown as ActionResult;
  }

  const operations: PatchOperation[] = [
    {
      op: 'set_factor_value',
      target_id: 'fac_cost',
      value: 2000,
    } as unknown as PatchOperation,
  ];

  return {
    operations,
    blocks: [],
    assistantText: opts.leakyText
      ? 'Got it, setting the AI Tool Cost to £2,000.'
      : "I'd recommend updating the AI Tool Cost to £2,000. Please review before running analysis.",
    applied_graph: makeGraph(),
    applied_graph_hash: 'post-hash',
    guidance_items: [],
  } as unknown as ActionResult;
}

// ─────────────────────────────────────────────────────────────────────────
// T4 — Semantic patch summary wiring
// ─────────────────────────────────────────────────────────────────────────

describe("assembleV4Envelope — T4 buildPatchSummary wiring", () => {
  beforeEach(() => {
    warnSpy.mockClear();
  });

  it("graph_patch block carries a non-empty string summary (not the undefined default)", () => {
    const ctx = makeCtx();
    const actionResult = makeSetFactorValueResult();

    const env = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-t4-1',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: actionResult.assistantText ?? null,
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    const patchBlock = env.blocks.find((b) => b.block_type === 'graph_patch');
    expect(patchBlock).toBeDefined();
    const data = (patchBlock as unknown as { data: { summary?: string } }).data;
    expect(typeof data.summary).toBe('string');
    expect((data.summary ?? '').length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// T5 — Proposal-language guard wiring
// ─────────────────────────────────────────────────────────────────────────

describe("assembleV4Envelope — T5 enforceProposalLanguage wiring", () => {
  beforeEach(() => {
    warnSpy.mockClear();
  });

  it("flags 'Got it, setting ... to ...' and appends the review suffix", () => {
    const ctx = makeCtx();
    const actionResult = makeSetFactorValueResult({ leakyText: true });

    const env = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-t5-1',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: actionResult.assistantText ?? null,
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    expect(env.assistant_text).toContain('Review the suggested changes above.');

    const leakCall = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.proposal_language_leak',
    );
    expect(leakCall).toBeDefined();
    expect((leakCall![0] as { tool_name: string }).tool_name).toBe('set_factor_value');
  });

  it("does not flag clean proposal text", () => {
    const ctx = makeCtx();
    const actionResult = makeSetFactorValueResult({ leakyText: false });

    const env = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-t5-2',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: actionResult.assistantText ?? null,
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    // No suffix appended to a clean proposal text.
    expect(env.assistant_text).not.toContain('Review the suggested changes above.');
    const leakCall = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.proposal_language_leak',
    );
    expect(leakCall).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// T3 — Mutation health gate wiring
// ─────────────────────────────────────────────────────────────────────────

describe("assembleV4Envelope — T3 assessMutationHealth wiring", () => {
  beforeEach(() => {
    warnSpy.mockClear();
  });

  it("does NOT emit v4.mutation_health_warning when the mutation is healthy", () => {
    const ctx = makeCtx();
    // A plain set_factor_value on an existing factor is healthy: no new
    // structural violations, no readiness degradation, no duplicate labels.
    const actionResult = makeSetFactorValueResult();

    assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-t3-healthy',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: actionResult.assistantText ?? null,
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    const warnCall = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.mutation_health_warning',
    );
    expect(warnCall).toBeUndefined();
  });

  it("health gate is reachable from v4 (no mutation_health_error swallow)", () => {
    // This regression-guards the wiring: if the gate ever throws due to an
    // import error or missing dep, the catch branch logs v4.mutation_health_error.
    // We assert that for a well-formed call, the error branch did NOT fire.
    const ctx = makeCtx();
    const actionResult = makeSetFactorValueResult();

    assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-t3-reach',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: actionResult.assistantText ?? null,
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    const errCall = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.mutation_health_error',
    );
    expect(errCall).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// T1 Phase A — Structured failure wiring
// ─────────────────────────────────────────────────────────────────────────

describe("assembleV4Envelope — T1 Phase A structured failure wiring", () => {
  beforeEach(() => {
    warnSpy.mockClear();
  });

  it("surfaces failure.user_message as assistant_text on cap-exceeded failure", () => {
    const ctx = makeCtx();
    const actionResult = makeSetFactorValueResult({ failure: true });

    const env = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-failure-1',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: null, // rawAssistantText — handler emits nothing on failure
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    expect(env.assistant_text).toContain('Development Capacity');
    expect(env.assistant_text).toContain('maximum');
    // Failure path must not leak the decision-language "Setting X to Y" style.
    expect(env.assistant_text).not.toContain('Got it');
  });

  it("mirrors failure_code and failure_recovery_hint onto the envelope", () => {
    const ctx = makeCtx();
    const actionResult = makeSetFactorValueResult({ failure: true });

    const env = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-failure-2',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: null,
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    const envAny = env as unknown as {
      failure_code?: string;
      failure_recovery_hint?: string;
    };
    expect(envAny.failure_code).toBe('CAP_EXCEEDED');
    expect(envAny.failure_recovery_hint).toContain('50');
  });

  it("emits v4.action_failed telemetry with code + tool_name", () => {
    const ctx = makeCtx();
    const actionResult = makeSetFactorValueResult({ failure: true });

    assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-failure-3',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: null,
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    const failCall = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'v4.action_failed',
    );
    expect(failCall).toBeDefined();
    expect((failCall![0] as { code: string }).code).toBe('CAP_EXCEEDED');
    expect((failCall![0] as { tool_name: string }).tool_name).toBe('set_factor_value');
  });

  it("emits NO graph_patch block on failure path (blocks skipped entirely)", () => {
    const ctx = makeCtx();
    const actionResult = makeSetFactorValueResult({ failure: true });

    const env = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-failure-4',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: null,
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    expect(env.blocks.find((b) => b.block_type === 'graph_patch')).toBeUndefined();
  });

  it("normal (non-failure) path still emits the graph_patch block (regression)", () => {
    const ctx = makeCtx();
    const actionResult = makeSetFactorValueResult({ failure: false });

    const env = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-happy-1',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: actionResult.assistantText ?? null,
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    const envAny = env as unknown as { failure_code?: string };
    expect(envAny.failure_code).toBeUndefined();
    expect(env.blocks.find((b) => b.block_type === 'graph_patch')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration: exercise the real set_factor_value handler end-to-end
// through assembleV4Envelope. This is the closest thing to a staging
// reproduction of the brief scenario.
// ─────────────────────────────────────────────────────────────────────────

describe("assembleV4Envelope — set_factor_value cap-exceeded real handler integration", () => {
  it("real handler failure flows through v4 assembler and produces a failure envelope", async () => {
    const ctx = makeCtx(10);
    const actionResult = await setFactorValueAction.execute(
      { target_id: 'fac_capacity', value: 25 },
      ctx,
    );
    expect(actionResult.failure).toBeDefined();

    const env = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-int-1',
      requestId: 'req-1',
      executionClass: 'deterministic',
      assistantText: actionResult.assistantText ?? null,
      actionResult,
      routing: 'deterministic',
      executedAction: 'set_factor_value',
      contextFallbackUsed: false,
    });

    const envAny = env as unknown as { failure_code?: string; assistant_text: string };
    expect(envAny.failure_code).toBe('CAP_EXCEEDED');
    expect(envAny.assistant_text).toContain('Development Capacity');
    expect(env.blocks.find((b) => b.block_type === 'graph_patch')).toBeUndefined();
  });
});
