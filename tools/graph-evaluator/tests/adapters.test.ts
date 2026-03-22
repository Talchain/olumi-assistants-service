import { describe, it, expect } from "vitest";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EditGraphAdapter } from "../src/adapters/edit-graph.js";
import { DecisionReviewAdapter } from "../src/adapters/decision-review.js";
import { DraftGraphAdapter } from "../src/adapters/draft-graph.js";
import { ResearchAdapter } from "../src/adapters/research.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOOL_ROOT = resolve(__dirname, "..");

// =============================================================================
// Edit-graph adapter tests
// =============================================================================

describe("EditGraphAdapter", () => {
  const adapter = new EditGraphAdapter();
  const fixturesDir = join(TOOL_ROOT, "fixtures", "edit-graph");

  it("loads all edit-graph fixtures", async () => {
    const cases = await adapter.loadCases(fixturesDir);
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(cases[0].id).toBe("01-add-factor");
    expect(cases[0].graph).toBeDefined();
    expect(cases[0].graph.nodes.length).toBeGreaterThan(0);
    expect(cases[0].edit_instruction).toBeTruthy();
    expect(cases[0].expected).toBeDefined();
  });

  it("builds a valid request from fixture", async () => {
    const cases = await adapter.loadCases(fixturesDir);
    const { system, user } = adapter.buildRequest(cases[0], "You are an edit graph assistant.");
    expect(system).toBe("You are an edit graph assistant.");
    const parsed = JSON.parse(user);
    expect(parsed.graph).toBeDefined();
    expect(parsed.instruction).toBeTruthy();
  });

  it("parses valid JSON response", () => {
    const result = adapter.parseResponse('{"operations": [], "warnings": [], "coaching": {}}');
    expect(result.parsed).not.toBeNull();
    expect(result.parsed!.operations).toBeDefined();
  });

  it("returns null for invalid response", () => {
    const result = adapter.parseResponse("This is not JSON");
    expect(result.parsed).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

// =============================================================================
// Decision-review adapter tests
// =============================================================================

describe("DecisionReviewAdapter", () => {
  const adapter = new DecisionReviewAdapter();
  const fixturesDir = join(TOOL_ROOT, "fixtures", "decision-review");

  it("loads all decision-review fixtures", async () => {
    const cases = await adapter.loadCases(fixturesDir);
    expect(cases.length).toBe(8);
    expect(cases[0].id).toBe("dr-01-clear-winner");
    expect(cases[0].input).toBeDefined();
    expect(cases[0].input.winner).toBeDefined();
    expect(cases[0].expected).toBeDefined();
  });

  it("builds request without DSK injection", async () => {
    const cases = await adapter.loadCases(fixturesDir);
    const nonDsk = cases.find((c) => !c.inject_dsk)!;
    const { system, user } = adapter.buildRequest(nonDsk, "You are a reviewer.");
    expect(system).toBe("You are a reviewer.");
    expect(system).not.toContain("SCIENCE_CLAIMS");
    const parsed = JSON.parse(user);
    expect(parsed.winner).toBeDefined();
  });

  it("builds request with DSK injection", async () => {
    const cases = await adapter.loadCases(fixturesDir);
    const dsk = cases.find((c) => c.inject_dsk === true)!;
    expect(dsk).toBeDefined();
    const { system } = adapter.buildRequest(dsk, "You are a reviewer.");
    expect(system).toContain("SCIENCE_CLAIMS");
    expect(system).toContain("DSK_001");
  });
});

// =============================================================================
// Draft-graph adapter tests (backward compat)
// =============================================================================

describe("DraftGraphAdapter", () => {
  const adapter = new DraftGraphAdapter();
  const briefsDir = join(TOOL_ROOT, "briefs");

  it("loads briefs from briefs/ directory", async () => {
    const cases = await adapter.loadCases(briefsDir);
    expect(cases.length).toBeGreaterThanOrEqual(4);
    // Find the canonical brief (filter out iCloud " 2" duplicates)
    const canonical = cases.find((c) => c.id === "01-simple-binary");
    expect(canonical).toBeDefined();
    expect(canonical!.meta).toBeDefined();
    expect(canonical!.body).toBeTruthy();
  });

  it("builds request correctly", async () => {
    const cases = await adapter.loadCases(briefsDir);
    const { system, user } = adapter.buildRequest(cases[0], "You are a draft graph LLM.");
    expect(system).toBe("You are a draft graph LLM.");
    expect(user).toContain("SaaS"); // 01-simple-binary mentions SaaS
  });
});

// =============================================================================
// Research adapter tests
// =============================================================================

describe("ResearchAdapter", () => {
  const adapter = new ResearchAdapter();
  const fixturesDir = join(TOOL_ROOT, "fixtures", "research");

  it("loads all research fixtures", async () => {
    const cases = await adapter.loadCases(fixturesDir);
    expect(cases.length).toBe(5);
    expect(cases[0].id).toBe("rt-01-saas-churn-benchmark");
    expect(cases[0].query).toBeTruthy();
    expect(cases[0].expected).toBeDefined();
    expect(cases[0].expected.must_contain_keywords).toBeDefined();
  });

  it("builds request with query and context_hint", async () => {
    const cases = await adapter.loadCases(fixturesDir);
    const fixture = cases[0]; // saas-churn-benchmark — has context_hint and target_factor
    const { system, user } = adapter.buildRequest(fixture, "ignored-prompt");
    expect(system).toContain("research assistant");
    expect(user).toContain(fixture.query);
    expect(user).toContain(fixture.context_hint as string);
    expect(user).toContain(fixture.target_factor as string);
  });

  it("builds request without context_hint for vague query", async () => {
    const cases = await adapter.loadCases(fixturesDir);
    const vague = cases.find((c) => c.context_hint === null)!;
    expect(vague).toBeDefined();
    const { user } = adapter.buildRequest(vague, "ignored-prompt");
    expect(user).toBe(vague.query); // No context appended
  });

  it("parses valid research JSON response", () => {
    const raw = JSON.stringify({
      summary: "SaaS churn is typically 2-5% monthly.",
      sources: [{ title: "Report", url: "https://example.com" }],
      confidence_note: "Based on industry surveys.",
    });
    const result = adapter.parseResponse(raw);
    expect(result.parsed).not.toBeNull();
    expect(result.parsed!.summary).toBe("SaaS churn is typically 2-5% monthly.");
  });

  it("returns null for non-JSON response", () => {
    const result = adapter.parseResponse("Here are some findings about churn rates...");
    expect(result.parsed).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("returns null when summary field is missing", () => {
    const raw = JSON.stringify({ sources: [], confidence_note: "note" });
    const result = adapter.parseResponse(raw);
    expect(result.parsed).toBeNull();
    expect(result.error).toContain("summary");
  });
});
