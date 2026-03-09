import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOOL_ROOT = resolve(__dirname, "..");
const PROFILES_DIR = join(TOOL_ROOT, "fixtures", "prompt-profiles");

interface ProfileFixture {
  fixture_id: string;
  profile: string;
  zone1_id: string;
  active_blocks: Array<{ name: string; version: string }>;
  test_input: Record<string, unknown>;
  expected_behaviour: {
    profile_selected: string;
    must_contain_tags: string[];
    must_not_contain_tags: string[];
  };
}

/**
 * Replicates the --profile assembly logic from cli.ts for testability.
 * Must stay in sync with the implementation in runOrchestrator().
 */
function assembleProfilePrompt(zone1: string, fixture: ProfileFixture): string {
  const input = fixture.test_input;
  const activeBlockNames = new Set(fixture.active_blocks.map((b) => b.name));
  const zone2Parts: string[] = [];
  const messages = (input.messages ?? []) as Array<{ role: string; content: string }>;

  if (activeBlockNames.has("stage_context")) {
    const stageLines: string[] = [`Stage: ${input.stage ?? "frame"}`];
    if (input.goal) stageLines.push(`Goal: ${input.goal}`);
    if (Array.isArray(input.constraints) && input.constraints.length > 0) {
      stageLines.push(`Constraints: ${input.constraints.join("; ")}`);
    }
    if (Array.isArray(input.options) && input.options.length > 0) {
      stageLines.push(`Options: ${input.options.join("; ")}`);
    }
    zone2Parts.push(`<STAGE>\n${stageLines.join("\n")}\n</STAGE>`);
  }

  if (activeBlockNames.has("graph_state") && input.hasGraph) {
    zone2Parts.push(`<GRAPH_STATE>\nNodes: 5 (factor: 3, goal: 1, option: 1)\nEdges: 4\nStrongest edges:\n  fac_1 → goal_1 (strength: 0.85)\n</GRAPH_STATE>`);
  }

  if (activeBlockNames.has("analysis_state") && input.hasAnalysis) {
    zone2Parts.push(`<ANALYSIS_STATE>\nWinner: Option A (62.0%)\nTop drivers:\n  Factor 1: sensitivity 0.45\nRobustness: moderate\nConfidence: medium\n</ANALYSIS_STATE>`);
  }

  if (activeBlockNames.has("bil_context") && input.bilEnabled) {
    zone2Parts.push(`<BRIEF_ANALYSIS>\nPreliminary observations from deterministic brief analysis.\nCompleteness: adequate\nGoal: ${input.goal ?? "Not detected"}\n</BRIEF_ANALYSIS>`);
  }

  if (activeBlockNames.has("conversation_summary") && messages.length > 0) {
    const clauses: string[] = [];
    if (input.goal) clauses.push(`User described a decision: "${input.goal}"`);
    clauses.push(`${messages.length} conversation turns`);
    zone2Parts.push(`<CONVERSATION_SUMMARY>\n${clauses.join(". ")}.\n</CONVERSATION_SUMMARY>`);
  }

  if (activeBlockNames.has("recent_turns") && messages.length > 0) {
    const recent = messages.slice(-3);
    const turnLines = recent.map((m) => {
      const content = String(m.content).slice(0, 500);
      if (m.role === "user") {
        return `BEGIN_UNTRUSTED_CONTEXT\nuser: ${content}\nEND_UNTRUSTED_CONTEXT`;
      }
      return `assistant: ${content}`;
    });
    zone2Parts.push(`<RECENT_TURNS>\n${turnLines.join("\n")}\n</RECENT_TURNS>`);
  }

  if (activeBlockNames.has("event_log")) {
    zone2Parts.push(`<EVENT_LOG>\nGraph drafted. Analysis run.\n</EVENT_LOG>`);
  }

  const hintLines: string[] = [];
  if (activeBlockNames.has("bil_hint")) {
    hintLines.push("A deterministic brief analysis is appended below — use its findings to ground your coaching. Do not repeat the analysis verbatim; reference specific elements.");
  }
  if (activeBlockNames.has("analysis_hint")) {
    hintLines.push("Post-analysis data is available in context. Reference specific results, drivers, and robustness when coaching — all numbers must come from this data.");
  }
  if (hintLines.length > 0) {
    zone2Parts.push(`<CONTEXT_HINTS>\n${hintLines.join("\n")}\n</CONTEXT_HINTS>`);
  }

  return zone1 + "\n\n" + zone2Parts.join("\n\n");
}

async function loadProfileFixture(id: string): Promise<ProfileFixture> {
  const content = await readFile(join(PROFILES_DIR, `${id}.json`), "utf-8");
  return JSON.parse(content) as ProfileFixture;
}

// =============================================================================
// Tests
// =============================================================================

const ZONE1 = "You are a decision-coaching assistant. Zone 1 identity content.";

describe("--profile vs --zone1-only", () => {
  it("--profile output differs from --zone1-only when active Zone 2 blocks exist", async () => {
    const fixture = await loadProfileFixture("framing_saas_pricing");
    const zone1Only = ZONE1;
    const withProfile = assembleProfilePrompt(ZONE1, fixture);

    // Zone 1 only is strictly the raw prompt
    expect(zone1Only).toBe(ZONE1);

    // Profile output is longer (Zone 2 appended)
    expect(withProfile.length).toBeGreaterThan(zone1Only.length);

    // Profile output starts with Zone 1
    expect(withProfile.startsWith(ZONE1)).toBe(true);

    // Zone 2 tags present in profile output, absent in zone1-only
    for (const tag of fixture.expected_behaviour.must_contain_tags) {
      expect(withProfile).toContain(`<${tag}>`);
      expect(zone1Only).not.toContain(`<${tag}>`);
    }
  });

  it("--profile includes all must_contain_tags from fixture", async () => {
    const fixtures = [
      "framing_saas_pricing",
      "ideation_hiring_decision",
      "post_analysis_pricing",
      "parallel_coaching_expansion",
    ];
    for (const id of fixtures) {
      const fixture = await loadProfileFixture(id);
      const prompt = assembleProfilePrompt(ZONE1, fixture);
      for (const tag of fixture.expected_behaviour.must_contain_tags) {
        expect(prompt, `${id} missing <${tag}>`).toContain(`<${tag}>`);
      }
      for (const tag of fixture.expected_behaviour.must_not_contain_tags) {
        expect(prompt, `${id} has forbidden <${tag}>`).not.toContain(`<${tag}>`);
      }
    }
  });

  it("--zone1-only contains no Zone 2 XML tags", () => {
    const zone2Tags = ["STAGE", "GRAPH_STATE", "ANALYSIS_STATE", "BRIEF_ANALYSIS",
      "CONVERSATION_SUMMARY", "RECENT_TURNS", "EVENT_LOG", "CONTEXT_HINTS"];
    for (const tag of zone2Tags) {
      expect(ZONE1).not.toContain(`<${tag}>`);
    }
  });
});
