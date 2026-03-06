/**
 * research_topic Tool Handler + Intent Gate Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyIntent, RESEARCH_PREFIXES } from "../../../../src/orchestrator/intent-gate.js";

// ============================================================================
// Mock research client
// ============================================================================

const { mockExecuteWebSearch } = vi.hoisted(() => ({
  mockExecuteWebSearch: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/research-client.js", () => ({
  executeWebSearch: mockExecuteWebSearch,
}));

// Mock config for tests
vi.mock("../../../../src/config/index.js", () => ({
  config: {
    research: {
      enabled: true,
      model: 'gpt-4o',
      webSearchToolType: 'web_search_preview',
      rateLimitPerScenario: 5,
      rateLimitWindowMs: 1_800_000,
      cacheTtlMs: 1_800_000,
      cacheMaxSize: 200,
      timeoutMs: 15_000,
    },
    features: { dskV0: false },
  },
  isProduction: () => false,
}));

import { handleResearchTopic, _resetResearchCaches } from "../../../../src/orchestrator/tools/research-topic.js";
import type { ConversationContext } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: null,
    messages: [],
    selected_elements: [],
    scenario_id: 'test-scenario',
    ...overrides,
  };
}

function makeSearchResult() {
  return {
    summary: "Remote work has been shown to increase productivity by 13% in a Stanford study.",
    sources: [
      { title: "Stanford Remote Work Study", url: "https://example.com/stanford" },
      { title: "HBR Remote Work Analysis", url: "https://example.com/hbr" },
    ],
    model: 'gpt-4o',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("handleResearchTopic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetResearchCaches();
  });

  it("returns evidence block with findings and sources on successful search", async () => {
    mockExecuteWebSearch.mockResolvedValueOnce(makeSearchResult());

    const result = await handleResearchTopic(
      "remote work productivity",
      makeContext(),
      'req-1',
      'turn-1',
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe('evidence');
    expect(result.blocks[0].data).toMatchObject({
      query: "remote work productivity",
      findings: expect.stringContaining("productivity"),
      sources: expect.arrayContaining([
        expect.objectContaining({ title: "Stanford Remote Work Study" }),
      ]),
      confidence_note: expect.stringContaining("verify"),
    });
    expect(result.assistantText).toContain("productivity");
  });

  it("evidence block has block_id and provenance with timestamp", async () => {
    mockExecuteWebSearch.mockResolvedValueOnce(makeSearchResult());

    const result = await handleResearchTopic("test query", makeContext(), 'req-1', 'turn-1');

    expect(result.blocks[0].block_id).toMatch(/^blk_evidence_/);
    expect(result.blocks[0].provenance).toMatchObject({
      trigger: 'tool:research_topic',
      turn_id: 'turn-1',
      timestamp: expect.any(String),
    });
  });

  it("returns friendly commentary block when OpenAI call fails", async () => {
    mockExecuteWebSearch.mockResolvedValueOnce({
      summary: "I wasn't able to complete the research.",
      sources: [],
      model: 'gpt-4o',
      error: "API error",
    });

    const result = await handleResearchTopic("test query", makeContext(), 'req-1', 'turn-1');

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].block_type).toBe('commentary');
    expect(result.assistantText).toContain("wasn't able");
  });

  it("returns advisory block when no results found", async () => {
    mockExecuteWebSearch.mockResolvedValueOnce({
      summary: "",
      sources: [],
      model: 'gpt-4o',
    });

    const result = await handleResearchTopic("obscure topic xyz", makeContext(), 'req-1', 'turn-1');

    expect(result.blocks[0].block_type).toBe('commentary');
    expect(result.assistantText).toContain("couldn't find");
  });

  it("returns rate limit message on 6th call in session", async () => {
    mockExecuteWebSearch.mockResolvedValue(makeSearchResult());
    const ctx = makeContext();

    // Make 5 calls (limit is 5)
    for (let i = 0; i < 5; i++) {
      await handleResearchTopic(`query ${i}`, ctx, 'req-1', 'turn-1');
    }

    // 6th call should be rate-limited
    const result = await handleResearchTopic("query 6", ctx, 'req-1', 'turn-1');
    expect(result.blocks[0].block_type).toBe('commentary');
    expect(result.assistantText).toContain("research limit");
    expect(mockExecuteWebSearch).toHaveBeenCalledTimes(5); // not called for 6th
  });

  it("rate limit resets after cache reset (simulating TTL window)", async () => {
    mockExecuteWebSearch.mockResolvedValue(makeSearchResult());
    const ctx = makeContext();

    for (let i = 0; i < 5; i++) {
      await handleResearchTopic(`query ${i}`, ctx, 'req-1', 'turn-1');
    }

    // Reset caches (simulates TTL window expiry)
    _resetResearchCaches();

    const result = await handleResearchTopic("query after reset", ctx, 'req-1', 'turn-1');
    expect(result.blocks[0].block_type).toBe('evidence');
  });

  it("returns cached result on repeated query without OpenAI call", async () => {
    mockExecuteWebSearch.mockResolvedValueOnce(makeSearchResult());
    const ctx = makeContext();

    // First call
    await handleResearchTopic("remote work", ctx, 'req-1', 'turn-1');

    // Second call with same query — should be cached
    const result = await handleResearchTopic("remote work", ctx, 'req-1', 'turn-2');

    expect(mockExecuteWebSearch).toHaveBeenCalledTimes(1); // only called once
    expect(result.blocks[0].block_type).toBe('evidence');
    expect(result.blocks[0].data).toMatchObject({
      query: "remote work",
    });
  });

  it("cache hits do not consume rate limit budget", async () => {
    mockExecuteWebSearch.mockResolvedValue(makeSearchResult());
    const ctx = makeContext();

    // First call — cache miss, uses 1 rate limit slot
    await handleResearchTopic("cached query", ctx, 'req-1', 'turn-1');

    // 4 more unique queries — uses 4 rate limit slots (total 5, at limit)
    for (let i = 0; i < 4; i++) {
      await handleResearchTopic(`unique query ${i}`, ctx, 'req-1', `turn-${i + 2}`);
    }

    // Cache hit for "cached query" — should NOT consume a rate limit slot
    const cachedResult = await handleResearchTopic("cached query", ctx, 'req-1', 'turn-7');
    expect(cachedResult.blocks[0].block_type).toBe('evidence');

    // Next unique query — should still be rate-limited (5 external calls made)
    const limitedResult = await handleResearchTopic("brand new query", ctx, 'req-1', 'turn-8');
    expect(limitedResult.assistantText).toContain("research limit");
  });

  it("returns advisory commentary when sources are empty despite long summary", async () => {
    mockExecuteWebSearch.mockResolvedValueOnce({
      summary: "There is a lot of general information about this topic but no specific cited sources were found during the search process.",
      sources: [],
      model: 'gpt-4o',
    });

    const result = await handleResearchTopic("market trends", makeContext(), 'req-1', 'turn-1');

    expect(result.blocks[0].block_type).toBe('commentary');
    expect(result.assistantText).toContain("couldn't find");
  });

  it("evidence payload always includes claims and model_mapping_suggestions arrays", async () => {
    mockExecuteWebSearch.mockResolvedValueOnce(makeSearchResult());

    const result = await handleResearchTopic("test query", makeContext(), 'req-1', 'turn-1');
    const data = result.blocks[0].data as unknown as Record<string, unknown>;

    expect(data.claims).toEqual([]);
    expect(data.model_mapping_suggestions).toEqual([]);
  });
});

describe("intent gate: research_topic patterns", () => {
  it.each([
    ["research competitor response", "competitor response"],
    ["look up churn benchmarks", "churn benchmarks"],
    ["find data on market growth", "market growth"],
    ["find evidence for remote work impact", "remote work impact"],
    ["search for pricing elasticity", "pricing elasticity"],
  ])('"%s" → research_topic with query "%s"', (input, expectedQuery) => {
    const result = classifyIntent(input);
    expect(result.tool).toBe('research_topic');
    expect(result.routing).toBe('deterministic');
    expect(result.research_query).toBe(expectedQuery);
  });

  it("does NOT match 'I need to research this more' (no clear topic after prefix strip)", () => {
    // "i need to research this more" — doesn't start with any research prefix
    const result = classifyIntent("I need to research this more");
    expect(result.tool).not.toBe('research_topic');
  });

  it("does NOT match unrelated message", () => {
    const result = classifyIntent("what's the weather like?");
    expect(result.tool).toBeNull();
  });

  it("does NOT match bare prefix with no topic", () => {
    // "research" alone has no remainder — should not match
    const result = classifyIntent("research");
    expect(result.tool).not.toBe('research_topic');
  });
});
