/**
 * Draft system-directive placement (#595 review P2).
 *
 * The lean-retry / strength-default corrective directives must land OUTSIDE the
 * [BEGIN/END]_UNTRUSTED_USER_CONTENT markers that wrap the brief — otherwise the
 * model is told to treat its own retry instruction as untrusted user input,
 * which is exactly the defect the P2 finding named. These are adapter-level
 * composition tests: they assert the assembled `userContent` places the
 * directive AFTER the closing marker (system authority) while the brief itself
 * stays fully bracketed.
 *
 * Positive control (P2 / CLAUDE.md #13): each "directive is outside" assertion
 * is paired with a proof the brief is INSIDE — so an absence claim ("not inside
 * the markers") is only made after showing the markers can contain content.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DRAFT_LEAN_RETRY_DIRECTIVE, STRENGTH_DEFAULT_RETRY_NUDGE } from "../../src/cee/constants.js";

// Mock prompt-loader to avoid Supabase/store calls (mirror currency-wiring test)
vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("SYSTEM PROMPT PLACEHOLDER"),
  getSystemPromptMeta: vi.fn().mockReturnValue({ taskId: "test", prompt_hash: "abc", source: "mock" }),
  invalidatePromptCache: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      draftComplianceReminderEnabled: false,
      briefSignalsHeaderEnabled: false,
    },
    prompts: {},
    promptCache: { anthropicEnabled: false },
  },
  isProduction: false,
  shouldUseStagingPrompts: vi.fn().mockReturnValue(false),
}));

const BEGIN = "[BEGIN_UNTRUSTED_USER_CONTENT]";
const END = "[END_UNTRUSTED_USER_CONTENT]";
const BRIEF = "MARKER_BRIEF_TEXT_should_stay_bracketed";

describe("Anthropic draft prompt — system directive placement (P2)", () => {
  let buildDraftPrompt: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../src/adapters/llm/anthropic.js");
    buildDraftPrompt = (mod as any).__test_only.buildDraftPrompt;
  });

  it("places the lean-retry directive OUTSIDE the closing untrusted-content marker (brief stays inside — positive control)", async () => {
    const { userContent } = await buildDraftPrompt({
      brief: BRIEF,
      docs: [],
      seed: 17,
      systemDirective: DRAFT_LEAN_RETRY_DIRECTIVE,
    });

    // Positive control: the markers DO contain the brief — so the "directive is
    // not inside the markers" assertion below is testing a real containment,
    // not a vacuously empty pair.
    const beginIdx = userContent.indexOf(BEGIN);
    const endIdx = userContent.indexOf(END);
    const briefIdx = userContent.indexOf(BRIEF);
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(beginIdx);
    expect(briefIdx).toBeGreaterThan(beginIdx);
    expect(briefIdx).toBeLessThan(endIdx);

    // The directive lands AFTER the closing marker — system-side, not user text.
    const directiveIdx = userContent.indexOf(DRAFT_LEAN_RETRY_DIRECTIVE);
    expect(directiveIdx).toBeGreaterThan(endIdx);
  });

  it("places the strength-default nudge OUTSIDE the closing marker too (same mechanism)", async () => {
    const { userContent } = await buildDraftPrompt({
      brief: BRIEF,
      docs: [],
      seed: 17,
      systemDirective: STRENGTH_DEFAULT_RETRY_NUDGE,
    });
    const endIdx = userContent.indexOf(END);
    expect(endIdx).toBeGreaterThan(0);
    expect(userContent.indexOf(STRENGTH_DEFAULT_RETRY_NUDGE)).toBeGreaterThan(endIdx);
  });

  it("omits the directive entirely when none is supplied (normal first attempt)", async () => {
    const { userContent } = await buildDraftPrompt({ brief: BRIEF, docs: [], seed: 17 });
    expect(userContent).not.toContain(DRAFT_LEAN_RETRY_DIRECTIVE);
    expect(userContent).not.toContain(STRENGTH_DEFAULT_RETRY_NUDGE);
    // The brief is still bracketed even without a directive.
    expect(userContent).toContain(`${BEGIN}\n${BRIEF}\n${END}`);
  });
});
