/**
 * Currency prompt wiring — adapter-level composition tests.
 *
 * Verifies that `currencyInstruction` is present in the assembled prompt
 * for all three LLM paths: draft, repair, and clarify.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildCurrencyInstruction } from "../../src/cee/signals/currency-signal.js";

// Mock prompt-loader to avoid Supabase/store calls
vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("SYSTEM PROMPT PLACEHOLDER"),
  getSystemPromptMeta: vi.fn().mockReturnValue({ taskId: "test", prompt_hash: "abc", source: "mock" }),
  invalidatePromptCache: vi.fn(),
}));

// Mock config
vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      draftComplianceReminderEnabled: false,
      briefSignalsHeaderEnabled: false,
    },
    prompts: {},
    promptCache: {
      anthropicEnabled: false,
    },
  },
  isProduction: false,
  shouldUseStagingPrompts: vi.fn().mockReturnValue(false),
}));

// ============================================================================
// Anthropic adapter
// ============================================================================

describe("Anthropic adapter — currency instruction in prompts", () => {
  let buildDraftPrompt: any;
  let buildRepairPrompt: any;
  let buildClarifyPrompt: any;

  beforeEach(async () => {
    const mod = await import("../../src/adapters/llm/anthropic.js");
    buildDraftPrompt = (mod as any).__test_only.buildDraftPrompt;
    buildRepairPrompt = (mod as any).__test_only.buildRepairPrompt;
    buildClarifyPrompt = (mod as any).__test_only.buildClarifyPrompt;
  });

  it("buildDraftPrompt includes currencyInstruction in user content", async () => {
    const instruction = buildCurrencyInstruction({ symbol: "£", code: "GBP" });
    const result = await buildDraftPrompt({
      brief: "Test brief",
      docs: [],
      seed: 17,
      currencyInstruction: instruction,
    });
    expect(result.userContent).toContain("[CURRENCY_CONTEXT]");
    expect(result.userContent).toContain("£ (GBP)");
  });

  it("buildDraftPrompt omits currency context when not provided", async () => {
    const result = await buildDraftPrompt({
      brief: "Test brief",
      docs: [],
      seed: 17,
    });
    expect(result.userContent).not.toContain("[CURRENCY_CONTEXT]");
  });

  it("buildRepairPrompt includes currencyInstruction in user content", async () => {
    const instruction = buildCurrencyInstruction({ symbol: "$", code: "USD" });
    const result = await buildRepairPrompt({
      graph: { nodes: [], edges: [] },
      violations: ["test violation"],
      brief: "Test brief",
      currencyInstruction: instruction,
    });
    expect(result.userContent).toContain("[CURRENCY_CONTEXT]");
    expect(result.userContent).toContain("$ (USD)");
  });

  it("buildClarifyPrompt includes currencyInstruction in user content", async () => {
    const instruction = buildCurrencyInstruction({ symbol: "€", code: "EUR" });
    const result = await buildClarifyPrompt({
      brief: "Test brief",
      round: 1,
      currencyInstruction: instruction,
    });
    expect(result.userContent).toContain("[CURRENCY_CONTEXT]");
    expect(result.userContent).toContain("€ (EUR)");
  });

  it("buildClarifyPrompt omits currency context when not provided", async () => {
    const result = await buildClarifyPrompt({
      brief: "Test brief",
      round: 1,
    });
    expect(result.userContent).not.toContain("[CURRENCY_CONTEXT]");
  });

  it("null signal produces default £ instruction in draft prompt", async () => {
    const instruction = buildCurrencyInstruction(null);
    const result = await buildDraftPrompt({
      brief: "Test brief",
      docs: [],
      seed: 17,
      currencyInstruction: instruction,
    });
    expect(result.userContent).toContain("[CURRENCY_CONTEXT]");
    expect(result.userContent).toContain("£ (GBP)");
    expect(result.userContent).toContain("No specific currency was detected");
  });
});
