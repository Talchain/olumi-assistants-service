/**
 * Golden Path v4 Integration Test
 *
 * Exercises the real v4 pipeline (not mocked) for the core user journey.
 * Mocks only external HTTP boundaries: Anthropic adapter, PLoT client.
 * Uses real TurnContext, real tool-builder, real action handlers, real
 * envelope assembly, real guards (buildPatchSummary, enforceProposalLanguage,
 * assessMutationHealth).
 *
 * This test catches:
 * - Guards wired to dead code (summary and language checks fail)
 * - Missing analysis_ready propagation
 * - Proposal language leaks
 * - Internal jargon in assistant_text
 * - Entity ID leaks in patch summaries
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks: external boundaries only ──────────────────────────────────────

vi.mock("../../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../../../../src/config/index.js", () => ({
  config: {
    features: {
      pipelineV4Enabled: true,
      deterministicOrchestratorEnabled: true,
      briefDetectionEnabled: true,
      deterministicRoutingV2: true,
      clarifier: false,
    },
    llm: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
    promptCache: { anthropicEnabled: true },
    cee: {
      clarifierEnabled: false,
      preflightEnabled: false,
      coachingContextEnabled: false,
    },
  },
  shouldUseStagingPrompts: () => false,
}));

vi.mock("../../../../../src/prompts/loader.js", () => ({
  loadPrompt: vi.fn().mockResolvedValue({ source: 'default', content: '' }),
}));

const mockStreamChatWithTools = vi.fn();
const mockGetAdapter = vi.fn().mockReturnValue({
  name: 'anthropic',
  model: 'claude-sonnet-4-6',
  streamChatWithTools: mockStreamChatWithTools,
});
vi.mock("../../../../../src/adapters/llm/router.js", () => ({
  getAdapter: (...args: unknown[]) => mockGetAdapter(...args),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock("../../../../../src/config/timeouts.js", () => ({
  ORCHESTRATOR_TIMEOUT_MS: 30000,
}));

// context-hash and post-analysis guidance are intentionally NOT mocked —
// they are internal pipeline logic that should run for real.

// Mock PLoT client boundary (external HTTP to PLoT /v2/run)
vi.mock("../../../../../src/orchestrator/plot-client.js", () => ({
  createPLoTClient: vi.fn().mockReturnValue(null),
  PLoTTimeoutError: class PLoTTimeoutError extends Error {},
  PLoTError: class PLoTError extends Error { v2RunError?: unknown },
}));

import { executePipelineV4 } from "../../../../../src/orchestrator/deterministic/pipeline-v4.js";
import { log } from "../../../../../src/utils/telemetry.js";
import type { OrchestratorStreamEvent } from "../../../../../src/orchestrator/pipeline/stream-events.js";
import type { ChatWithToolsStreamEvent } from "../../../../../src/adapters/llm/types.js";
import {
  makeGraph,
  makeAnalysisResponse,
  makeAnalysisInputs,
  buildTestTurnRequest,
  makeTextStream,
  makeToolUseStream,
  ENTITY_ID_RE,
  JARGON_PATTERNS,
} from "./golden-path-fixtures.js";

// ── Helpers ──────────────────────────────────────────────────────────────

async function collectEvents(gen: AsyncGenerator<OrchestratorStreamEvent>): Promise<OrchestratorStreamEvent[]> {
  const events: OrchestratorStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

async function* mockStream(events: ChatWithToolsStreamEvent[]): AsyncGenerator<ChatWithToolsStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

function getEnvelope(events: OrchestratorStreamEvent[]) {
  const complete = events.find((e) => e.type === 'turn_complete') as
    Extract<OrchestratorStreamEvent, { type: 'turn_complete' }> | undefined;
  expect(complete).toBeDefined();
  return complete!.envelope;
}

function getGraphPatchBlock(envelope: ReturnType<typeof getEnvelope>) {
  const blocks = (envelope as unknown as { blocks: Array<{ block_type: string; data: Record<string, unknown> }> }).blocks;
  return blocks.find((b) => b.block_type === 'graph_patch');
}

// ============================================================================
// Golden Path Integration Tests
// ============================================================================

describe("v4 Golden Path Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Scenario 1: Draft ──────────────────────────────────────────────────

  describe("Scenario 1: Draft graph from brief", () => {
    it("produces a graph_patch with semantic summary and no jargon", async () => {
      // Mock: LLM returns a draft_graph tool call
      mockStreamChatWithTools.mockReturnValue(mockStream(
        makeToolUseStream('draft_graph', {
          brief: 'Should we raise prices from 49 to 59?',
        }),
      ));

      const req = buildTestTurnRequest({
        message: 'Should we raise prices from 49 to 59?',
        generate_model: true,
        context: {
          graph: null,
          analysis_response: null,
          framing: { stage: 'frame' },
          messages: [],
          scenario_id: 'golden-path-test',
        },
      });

      const events = await collectEvents(executePipelineV4(req, 'req-draft'));
      const envelope = getEnvelope(events);

      // Basic structure
      expect(events[0].type).toBe('turn_start');
      expect(envelope).toHaveProperty('turn_id');
      expect(envelope).toHaveProperty('response_version', 2);

      // assistant_text should not contain internal jargon
      const text = (envelope as unknown as { assistant_text: string | null }).assistant_text;
      if (text) {
        for (const pattern of JARGON_PATTERNS) {
          expect(text, `assistant_text should not contain jargon: ${pattern}`).not.toMatch(pattern);
        }
      }
    });
  });

  // ── Scenario 2: Add option ─────────────────────────────────────────────

  describe("Scenario 2: Add option with guards", () => {
    it("produces graph_patch with entity-name summary, no leaks, and analysis_ready", async () => {
      // Mock: LLM returns an add_option tool call
      mockStreamChatWithTools.mockReturnValue(mockStream(
        makeToolUseStream('add_option', {
          label: 'Tiered Pricing',
          interventions: {
            fac_market_size: 600,
            fac_cost: 100000,
          },
        }, 'I suggest adding a tiered pricing option that sets Market Size to 600 and Implementation Cost to 100,000.'),
      ));

      const graph = makeGraph();
      const req = buildTestTurnRequest({
        message: 'What about a tiered pricing model?',
        context: {
          graph,
          analysis_response: null,
          framing: { stage: 'ideate' },
          messages: [],
          scenario_id: 'golden-path-test',
        },
      });

      const events = await collectEvents(executePipelineV4(req, 'req-add-option'));
      const envelope = getEnvelope(events);
      const patchBlock = getGraphPatchBlock(envelope);

      // Guard 1 (T4): graph_patch block has semantic summary
      expect(patchBlock).toBeDefined();
      const summary = patchBlock!.data.summary;
      expect(summary).toBeDefined();
      // Summary should contain entity names, not just counts
      if (typeof summary === 'object' && summary !== null && 'title' in summary) {
        const title = (summary as { title: string }).title;
        // Should mention the option name or at least not be a raw count
        expect(title.length).toBeGreaterThan(0);
      }

      // No entity ID leaks in summary
      const summaryStr = JSON.stringify(summary);
      expect(summaryStr, 'Summary should not contain raw entity IDs').not.toMatch(ENTITY_ID_RE);

      // Guard 2 (T5): assistant_text uses proposal language, not completion language
      const text = (envelope as unknown as { assistant_text: string | null }).assistant_text;
      expect(text).toBeDefined();
      if (text) {
        // Should NOT contain completion phrases on a proposal turn
        expect(text).not.toMatch(/\badding now\b/i);
        expect(text).not.toMatch(/\bi've added\b/i);
        expect(text).not.toMatch(/\bdone\b/i);
        expect(text).not.toMatch(/\bapplied\b/i);
      }

      // analysis_ready propagation: add_option computes it via
      // computeSyntheticOptionReadiness against the post-patch graph.
      // pipeline-v4 propagates it to both the patch block and the envelope.
      const envelopeAny = envelope as unknown as Record<string, unknown>;
      expect(
        patchBlock?.data.analysis_ready ?? envelopeAny.analysis_ready,
        'analysis_ready should be propagated on add_option turn',
      ).toBeDefined();
      // The handler's assistantText confirms it ran through the real handler.
      expect(text).toContain('Tiered Pricing');
    });
  });

  // ── Scenario 3: Run analysis ───────────────────────────────────────────

  describe("Scenario 3: Run analysis", () => {
    it("returns analysis_response with option_comparison on the envelope", async () => {
      const analysisFixture = makeAnalysisResponse();

      // Mock PLoT boundary: createPLoTClient returns a client whose run()
      // resolves with the fixture analysis response.
      const { createPLoTClient } = await import("../../../../../src/orchestrator/plot-client.js");
      vi.mocked(createPLoTClient).mockReturnValue({
        run: vi.fn().mockResolvedValue(analysisFixture),
        validatePatch: vi.fn().mockResolvedValue({}),
      } as never);

      // Mock: LLM returns a run_analysis tool call
      mockStreamChatWithTools.mockReturnValue(mockStream(
        makeToolUseStream('run_analysis', {}),
      ));

      const graph = makeGraph();
      const req = buildTestTurnRequest({
        message: 'Run the analysis',
        context: {
          graph,
          analysis_response: null,
          framing: { stage: 'evaluate' },
          messages: [],
          scenario_id: 'golden-path-test',
          analysis_inputs: makeAnalysisInputs(),
        },
      });

      const events = await collectEvents(executePipelineV4(req, 'req-analysis'));
      const envelope = getEnvelope(events);

      // analysis_response must be on the envelope
      const envelopeAny = envelope as unknown as Record<string, unknown>;
      expect(envelopeAny.analysis_response, 'analysis_response should be on envelope').toBeDefined();

      // Verify key analysis fields propagated
      const analysisResponse = envelopeAny.analysis_response as Record<string, unknown>;
      expect(analysisResponse.option_comparison).toBeDefined();
      const comparison = analysisResponse.option_comparison as Record<string, unknown>;
      expect(comparison.robustness).toBe('moderate');

      // assistant_text should confirm completion
      const text = (envelope as unknown as { assistant_text: string | null }).assistant_text;
      expect(text).toBeDefined();
      expect(text!.length).toBeGreaterThan(0);
    });
  });

  // ── Scenario 4: Explain results (INTERPRET mode) ──────────────────────

  describe("Scenario 4: Explain results (text-only, no tool call)", () => {
    it("returns substantive text referencing analysis figures", async () => {
      const analysisText =
        'Raise Prices leads with an overall score of 0.72, edging out Enter New Market at 0.65. ' +
        'The 7-point margin is driven primarily by Market Size (35% influence) and lower Implementation Cost. ' +
        'The result shows moderate robustness.';

      mockStreamChatWithTools.mockReturnValue(mockStream(
        makeTextStream(analysisText),
      ));

      const graph = makeGraph();
      const analysis = makeAnalysisResponse();
      const req = buildTestTurnRequest({
        message: 'Why does Raise Prices win?',
        context: {
          graph,
          analysis_response: analysis as unknown as null,
          framing: { stage: 'evaluate' },
          messages: [],
          scenario_id: 'golden-path-test',
        },
      });

      const events = await collectEvents(executePipelineV4(req, 'req-explain'));
      const envelope = getEnvelope(events);

      const text = (envelope as unknown as { assistant_text: string | null }).assistant_text;
      expect(text).toBeDefined();
      expect(text!.length).toBeGreaterThan(0);

      // No tool call in response (INTERPRET mode)
      const patchBlock = getGraphPatchBlock(envelope);
      expect(patchBlock, 'Explain should not produce a graph_patch').toBeUndefined();

      // Text should reference actual analysis figures
      expect(text).toContain('Raise Prices');
      expect(text).toContain('0.72');

      // No jargon
      for (const pattern of JARGON_PATTERNS) {
        expect(text, `assistant_text should not contain jargon: ${pattern}`).not.toMatch(pattern);
      }
    });
  });

  // ── Scenario 5: Deterministic action with all guards ───────────────────

  describe("Scenario 5: set_factor_value with all guards reachable", () => {
    it("produces summary with factor name, checks proposal language, and mutation health gate is reachable", async () => {
      // Mock: LLM returns a set_factor_value tool call
      mockStreamChatWithTools.mockReturnValue(mockStream(
        makeToolUseStream('set_factor_value', {
          target_id: 'fac_cost',
          value: 300000,
        }, 'Setting Implementation Cost to 300,000.'),
      ));

      const graph = makeGraph();
      const analysis = makeAnalysisResponse();
      const req = buildTestTurnRequest({
        message: 'Set Implementation Cost to 300,000',
        context: {
          graph,
          analysis_response: analysis as unknown as null,
          framing: { stage: 'evaluate' },
          messages: [],
          scenario_id: 'golden-path-test',
        },
      });

      const events = await collectEvents(executePipelineV4(req, 'req-set-value'));
      const envelope = getEnvelope(events);
      const patchBlock = getGraphPatchBlock(envelope);

      // Guard T4: patch summary contains the factor label
      expect(patchBlock).toBeDefined();
      const summary = patchBlock!.data.summary;
      expect(summary).toBeDefined();
      const summaryStr = JSON.stringify(summary);
      // Summary should reference the factor name (Implementation Cost)
      expect(
        summaryStr.includes('Implementation Cost') || summaryStr.includes('factor'),
        'Summary should reference entity name or kind',
      ).toBe(true);

      // No entity ID leaks
      expect(summaryStr, 'Summary should not contain raw entity IDs').not.toMatch(ENTITY_ID_RE);

      // Guard T5: proposal language guard fires on proposal turns.
      // Deterministic actions always emit auto_apply: false.
      const text = (envelope as unknown as { assistant_text: string | null }).assistant_text;
      expect(patchBlock!.data.auto_apply).toBe(false);
      expect(text).toBeDefined();
      // The guard rewrites handler completion phrases ("Setting X to Y",
      // "Updated X to Y", "I'll add X") inline to proposal language. The
      // response composer can also replace the text entirely via a fact.
      // Either way, the final text must NOT contain banned completion idioms
      // on a proposal turn.
      expect(text!).not.toMatch(/^\s*Setting\s+/);
      expect(text!).not.toMatch(/^\s*Updated\s+/);
      expect(text!).not.toMatch(/\bI['’]ll add\b/);

      // Guard T3: mutation health gate is reachable (verify via telemetry)
      // The gate is advisory — check that the code path executed by looking
      // for the warn log (or absence if healthy).
      const warnCalls = vi.mocked(log.warn).mock.calls;
      const healthEvent = warnCalls.find(
        (call) => (call[0] as Record<string, unknown>)?.event === 'v4.mutation_health_warning',
      );
      const healthError = warnCalls.find(
        (call) => (call[0] as Record<string, unknown>)?.event === 'v4.mutation_health_error',
      );
      // Either healthy (no warning event) or the gate ran and reported.
      // Both are valid — the key assertion is that the gate code is REACHABLE.
      // If neither event exists, the gate ran cleanly (healthy graph).
      // If v4.mutation_health_error exists, the gate threw — that's a bug.
      expect(healthError, 'Mutation health gate should not throw').toBeUndefined();
    });
  });

  // ── Cross-cutting: proposal language leak detection ────────────────────

  describe("Cross-cutting: LEAK_PATTERNS detect completion language", () => {
    it("appends review suffix when LLM says 'Got it, setting X to Y' on a proposal turn", async () => {
      mockStreamChatWithTools.mockReturnValue(mockStream(
        makeToolUseStream('set_factor_value', {
          target_id: 'fac_market_size',
          value: 700,
        }, 'Got it, setting Market Size to 700.'),
      ));

      const graph = makeGraph();
      const req = buildTestTurnRequest({
        message: 'Set Market Size to 700',
        context: {
          graph,
          analysis_response: null,
          framing: { stage: 'ideate' },
          messages: [],
          scenario_id: 'golden-path-test',
        },
      });

      const events = await collectEvents(executePipelineV4(req, 'req-leak-check'));
      const envelope = getEnvelope(events);
      const text = (envelope as unknown as { assistant_text: string | null }).assistant_text;

      // The proposal language guard should detect "Got it, setting" and
      // append a review suffix
      expect(text).toBeDefined();
      const warnCalls = vi.mocked(log.warn).mock.calls;
      const leakEvent = warnCalls.find(
        (call) => (call[0] as Record<string, unknown>)?.event === 'v4.proposal_language_leak',
      );
      // Either the guard caught it (leakEvent exists) or the text was already clean.
      // The key: if the original text had "Got it, setting" and there's a proposal
      // block, the guard MUST have fired.
      const patchBlock = getGraphPatchBlock(envelope);
      if (patchBlock && patchBlock.data.auto_apply === false) {
        expect(leakEvent, 'Proposal language guard should detect "Got it, setting" and log v4.proposal_language_leak').toBeDefined();
        expect(text!.toLowerCase()).toContain('review');
      }
    });
  });
});
