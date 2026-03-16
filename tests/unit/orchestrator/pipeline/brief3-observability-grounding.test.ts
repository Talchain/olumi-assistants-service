/**
 * Brief 3 Liveness Tests: Zone 2 observability and grounding completeness
 *
 * Task 1: Zone 2 per-turn logging emits zone2_assembly_complete event
 * Task 2: Empty blocks surface in feature health map
 * Task 3: Robustness recommendation_stability and confidence in grounded set
 * Task 4: Brief-context number extraction covers constraints and option labels
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "features") {
          return {
            bilEnabled: true,
            zone2Registry: true,
            dskEnabled: false,
            dskV0: false,
            dskCoachingEnabled: false,
            grounding: false,
            orchestratorV2: true,
            strictPromptValidation: false,
          };
        }
        if (prop === "cee") {
          return { entityMemoryEnabled: false, causalValidationEnabled: false };
        }
        if (prop === "isl") {
          return { baseUrl: null };
        }
        return Reflect.get(target, prop);
      },
    }),
    isProduction: () => false,
  };
});

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { log } from "../../../../src/utils/telemetry.js";
import { assembleFullPrompt } from "../../../../src/orchestrator/prompt-zones/assemble.js";
import { buildFeatureHealthMap } from "../../../../src/orchestrator/pipeline/phase5-validation/envelope-assembler.js";
import {
  buildGroundedValues,
  extractBriefNumbers,
  buildBriefTextForGrounding,
} from "../../../../src/orchestrator/tools/explain-results.js";
import type { V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";
import type { TurnContext } from "../../../../src/orchestrator/prompt-zones/zone2-blocks.js";

const mockLog = log as unknown as { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

// ============================================================================
// Shared helpers
// ============================================================================

function makeTurnContext(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    stage: 'frame',
    goal: undefined,
    constraints: undefined,
    options: undefined,
    graphCompact: null,
    analysisSummary: null,
    eventLogSummary: '',
    messages: [],
    selectedElements: [],
    bilContext: undefined,
    bilEnabled: false,
    hasGraph: false,
    hasAnalysis: false,
    generateModel: false,
    ...overrides,
  };
}

function makeAnalysisResponse(overrides: Record<string, unknown> = {}): V2RunResponseEnvelope {
  return {
    results: [{ option_id: "a", option_label: "Option A", win_probability: 0.65 }],
    meta: { response_hash: "h1", seed_used: 42, n_samples: 1000 },
    ...overrides,
  } as unknown as V2RunResponseEnvelope;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Brief 3: Zone 2 observability and grounding completeness", () => {
  // ============================================================================
  // Task 1: Zone 2 per-turn logging
  // ============================================================================

  describe("Task 1: Zone 2 per-turn logging", () => {
    it("emits zone2_assembly_complete log event after assembly", () => {
      const ctx = makeTurnContext({ stage: 'frame' });
      assembleFullPrompt("Zone 1 prompt content", "cf-v13", ctx);

      const assemblyLog = mockLog.info.mock.calls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>)?.event === 'zone2_assembly_complete',
      );
      expect(assemblyLog).toBeDefined();
      const logData = assemblyLog![0] as Record<string, unknown>;
      expect(logData.total_chars).toBeGreaterThan(0);
      expect(logData.block_count).toBeGreaterThanOrEqual(0);
      expect(logData.block_chars).toBeDefined();
      expect(typeof logData.profile).toBe('string');
    });

    it("includes empty_blocks in log when blocks render empty", () => {
      // graph_state block activates when hasGraph=true but renders empty when graphCompact is null
      const ctx = makeTurnContext({ hasGraph: true, graphCompact: null });
      assembleFullPrompt("Zone 1", "cf-v13", ctx);

      const assemblyLog = mockLog.info.mock.calls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>)?.event === 'zone2_assembly_complete',
      );
      expect(assemblyLog).toBeDefined();
      const logData = assemblyLog![0] as Record<string, unknown>;
      // graph_state activates (hasGraph=true) but renders empty (graphCompact=null)
      expect(logData.empty_blocks).toContain('graph_state');
    });
  });

  // ============================================================================
  // Task 2: Empty blocks in feature health
  // ============================================================================

  describe("Task 2: empty blocks surface in feature health", () => {
    it("marks BIL unhealthy when all BIL-owned blocks rendered empty", () => {
      const features = buildFeatureHealthMap([
        'bil_context', 'bil_hint', 'primary_gap_hint',
      ]);

      expect(features.BIL).toBeDefined();
      expect(features.BIL.healthy).toBe(false);
      expect(features.BIL.reason).toBe('all zone2 blocks rendered empty');
    });

    it("does not mark BIL unhealthy when only some BIL blocks are empty", () => {
      const features = buildFeatureHealthMap(['bil_context']);

      expect(features.BIL).toBeDefined();
      expect(features.BIL.healthy).toBe(true);
    });

    it("does not affect features when no empty blocks passed", () => {
      const features = buildFeatureHealthMap();
      expect(features.BIL).toBeDefined();
      expect(features.BIL.healthy).toBe(true);
    });

    it("does not affect features when empty array passed", () => {
      const features = buildFeatureHealthMap([]);
      expect(features.BIL).toBeDefined();
      expect(features.BIL.healthy).toBe(true);
    });
  });

  // ============================================================================
  // Task 3: Robustness grounded values
  // ============================================================================

  describe("Task 3: robustness recommendation_stability and confidence grounded", () => {
    it("includes recommendation_stability in grounded set", () => {
      const response = makeAnalysisResponse({
        robustness: {
          level: 'high',
          fragile_edges: [],
          recommendation_stability: 0.92,
          confidence: 0.87,
        },
      });

      const grounded = buildGroundedValues(response);

      // 0.92 → "92", "92.0", "0.92"
      expect(grounded.has("92")).toBe(true);
      expect(grounded.has("0.92")).toBe(true);
    });

    it("includes confidence in grounded set", () => {
      const response = makeAnalysisResponse({
        robustness: {
          level: 'medium',
          fragile_edges: ['e1'],
          recommendation_stability: 0.75,
          confidence: 0.68,
        },
      });

      const grounded = buildGroundedValues(response);

      // 0.68 → "68", "0.68"
      expect(grounded.has("68")).toBe(true);
      expect(grounded.has("0.68")).toBe(true);
      // 0.75 → "75", "0.75"
      expect(grounded.has("75")).toBe(true);
      // fragile_edges count
      expect(grounded.has("1")).toBe(true);
    });

    it("handles robustness without recommendation_stability or confidence", () => {
      const response = makeAnalysisResponse({
        robustness: {
          level: 'low',
          fragile_edges: ['e1', 'e2'],
        },
      });

      const grounded = buildGroundedValues(response);
      // Should not throw, and should include fragile_edges count
      expect(grounded.has("2")).toBe(true);
    });
  });

  // ============================================================================
  // Task 4: Brief-context number extraction — constraints and option labels
  // ============================================================================

  describe("Task 4: brief-context number extraction covers constraints and options", () => {
    it("extracts numbers from constraint text (£50k budget)", () => {
      const grounded = extractBriefNumbers("Stay within a £50k budget for the project");

      expect(grounded.has("50000")).toBe(true);
      expect(grounded.has("50k")).toBe(true);
    });

    it("extracts percentage from constraint text", () => {
      const grounded = extractBriefNumbers("Maintain at least 15% profit margin");

      expect(grounded.has("15")).toBe(true);
    });

    it("buildBriefTextForGrounding combines brief, goal, constraints, and options", () => {
      const context = {
        framing: {
          brief_text: "We need to decide on a platform",
          goal: "Maximise revenue to £2M",
          constraints: ["£50k budget", "6 months timeline"],
          options: ["Option A", "Option B"],
        },
        graph: null,
        analysis_response: null,
        messages: [],
        scenario_id: "s1",
        analysis_inputs: null,
      } as any;

      const text = buildBriefTextForGrounding(context);
      expect(text).toContain("£50k budget");
      expect(text).toContain("6 months timeline");
      expect(text).toContain("Maximise revenue to £2M");
      expect(text).toContain("Option A");
    });

    it("buildBriefTextForGrounding handles object-shaped options with labels", () => {
      const context = {
        framing: {
          brief_text: "Choose a vendor",
          options: [
            { label: "Vendor A — $100k/yr" },
            { option_label: "Vendor B — $80k/yr" },
          ],
        },
        graph: null,
        analysis_response: null,
        messages: [],
        scenario_id: "s1",
        analysis_inputs: null,
      } as any;

      const text = buildBriefTextForGrounding(context);
      expect(text).toContain("$100k/yr");
      expect(text).toContain("$80k/yr");
    });

    it("returns null when framing is absent", () => {
      const context = {
        framing: null,
        graph: null,
        analysis_response: null,
        messages: [],
        scenario_id: "s1",
        analysis_inputs: null,
      } as any;

      expect(buildBriefTextForGrounding(context)).toBeNull();
    });
  });
});
