/**
 * Zero-match clarification intercept for edit_graph (S2 fix).
 *
 * When the V2 handler returns pendingClarification with empty
 * candidate_labels (i.e. resolveEditTarget returned match_type='none'),
 * the V4 adapter replaces the generic question with a grounded
 * clarification that lists actual graph entities.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

vi.mock("../../../../../src/orchestrator/tools/edit-graph.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../../src/orchestrator/tools/edit-graph.js")>(
    "../../../../../src/orchestrator/tools/edit-graph.js",
  );
  return {
    ...actual,
    handleEditGraph: vi.fn(),
  };
});

vi.mock("../../../../../src/orchestrator/plot-client.js", () => ({
  createPLoTClient: vi.fn(() => null),
}));

vi.mock("../../../../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn(() => ({ name: 'anthropic', model: 'test', chat: vi.fn() })),
}));

vi.mock("../../../../../src/orchestrator/guidance/post-draft.js", () => ({
  generatePostDraftGuidance: vi.fn(() => []),
}));

import { editGraphAction } from "../../../../../src/orchestrator/deterministic/actions/edit-graph.js";
import { handleEditGraph } from "../../../../../src/orchestrator/tools/edit-graph.js";
import type { DeterministicTurnContext } from "../../../../../src/orchestrator/deterministic/types.js";
import type { GraphV3T } from "../../../../../src/schemas/cee-v3.js";

const handleEditGraphMock = vi.mocked(handleEditGraph);

beforeEach(() => {
  handleEditGraphMock.mockReset();
});

function makeGraphWithRisks(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_g', kind: 'goal', label: 'Goal' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      { id: 'opt_b', kind: 'option', label: 'Option B' },
      { id: 'risk_churn', kind: 'risk', label: 'Customer Churn' },
      { id: 'risk_legal', kind: 'risk', label: 'Legal Exposure' },
      { id: 'risk_supply', kind: 'risk', label: 'Supply Disruption' },
      { id: 'fac_cost', kind: 'factor', label: 'Operating Cost' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

function makeContextForGraph(graph: GraphV3T, userMessage?: string): DeterministicTurnContext {
  const messages = userMessage
    ? [{ role: 'user', content: userMessage }]
    : [];
  return {
    stage: 'ideate',
    graph,
    scenario_id: 'test',
    turn_id: 'test-turn',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
    graph_summary: {},
    analysis_summary: null,
    analysis: null,
    analysis_inputs: null,
    capabilities: {},
    blockers: [],
    signals: {},
    conversation: { turn_count: 1, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null, messages: [] },
    eligible_actions: [],
    disambiguation_hints: [],
    conversational_state: null,
    messages,
  } as unknown as DeterministicTurnContext;
}

describe('edit_graph zero-match clarification', () => {
  it('kind=risk with multiple risk nodes → lists all risk labels and emits 3 chips', async () => {
    handleEditGraphMock.mockResolvedValue({
      blocks: [],
      assistantText: 'Could you clarify which element you mean?',
      latencyMs: 1,
      appliedGraph: null,
      wasRejected: true,
      pendingClarification: {
        tool: 'edit_graph',
        original_edit_request: 'connect the pricing risk',
        candidate_labels: [],
      },
    });

    const ctx = makeContextForGraph(makeGraphWithRisks());
    const result = await editGraphAction.execute(
      { edit_description: 'connect the pricing risk to outcome' },
      ctx,
    );

    expect(result.assistantText).toContain('Customer Churn');
    expect(result.assistantText).toContain('Legal Exposure');
    expect(result.assistantText).toContain('Supply Disruption');
    expect(result.assistantText).toContain('risk');
    expect(result.suggested_actions_override).toBeDefined();
    expect(result.suggested_actions_override).toHaveLength(3);
    for (const chip of result.suggested_actions_override!) {
      expect(chip.action_type).toBe('edit_graph');
      expect(chip.label).toMatch(/^(Edit|Connect)\s/);
    }
  });

  it('no kind inference, no global similarity → text-only response, no chips', async () => {
    handleEditGraphMock.mockResolvedValue({
      blocks: [],
      assistantText: 'Could you clarify which element you mean?',
      latencyMs: 1,
      appliedGraph: null,
      wasRejected: true,
      pendingClarification: {
        tool: 'edit_graph',
        original_edit_request: 'xyzzy qwerty frobnicate',
        candidate_labels: [],
      },
    });

    const graph = {
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal' },
        { id: 'opt_a', kind: 'option', label: 'Alpha' },
      ],
      edges: [],
    } as unknown as GraphV3T;
    const ctx = makeContextForGraph(graph);
    const result = await editGraphAction.execute(
      { edit_description: 'xyzzy qwerty frobnicate' },
      ctx,
    );

    expect(result.assistantText).toContain("doesn't include");
    // Explicit empty override — authoritative "no chips" for the envelope assembler.
    expect(result.suggested_actions_override).toEqual([]);
  });

  it('kind=factor but zero factor nodes → global similarity fallback', async () => {
    handleEditGraphMock.mockResolvedValue({
      blocks: [],
      assistantText: 'Could you clarify which element you mean?',
      latencyMs: 1,
      appliedGraph: null,
      wasRejected: true,
      pendingClarification: {
        tool: 'edit_graph',
        original_edit_request: 'the churn factor',
        candidate_labels: [],
      },
    });

    const graph = {
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal' },
        { id: 'opt_a', kind: 'option', label: 'Option A' },
        { id: 'risk_churn', kind: 'risk', label: 'Customer Churn' },
      ],
      edges: [],
    } as unknown as GraphV3T;
    const ctx = makeContextForGraph(graph);
    const result = await editGraphAction.execute(
      { edit_description: 'churn' },
      ctx,
    );

    // Global similarity should pick up "Customer Churn" via token overlap
    expect(result.assistantText).toContain('Customer Churn');
    expect(result.suggested_actions_override?.length).toBeGreaterThanOrEqual(1);
  });

  it('kind=risk with >5 risks and zero token overlap → deterministic first-5 fallback, never empty', async () => {
    handleEditGraphMock.mockResolvedValue({
      blocks: [],
      assistantText: 'Could you clarify which element you mean?',
      latencyMs: 1,
      appliedGraph: null,
      wasRejected: true,
      pendingClarification: {
        tool: 'edit_graph',
        original_edit_request: 'risk xyzzy',
        candidate_labels: [],
      },
    });
    const graph = {
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal' },
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `risk_${String(i).padStart(2, '0')}`,
          kind: 'risk',
          label: `Risk number ${i}`,
        })),
      ],
      edges: [],
    } as unknown as GraphV3T;
    const ctx = makeContextForGraph(graph);
    const result = await editGraphAction.execute(
      { edit_description: 'risk xyzzy' },
      ctx,
    );
    expect(result.assistantText).toMatch(/Risk number \d/);
    expect(result.suggested_actions_override?.length).toBe(3);
  });

  it('no-candidates case returns explicit empty override (suppresses chip engine)', async () => {
    handleEditGraphMock.mockResolvedValue({
      blocks: [],
      assistantText: 'Could you clarify which element you mean?',
      latencyMs: 1,
      appliedGraph: null,
      wasRejected: true,
      pendingClarification: {
        tool: 'edit_graph',
        original_edit_request: 'xyzzy frobnicate',
        candidate_labels: [],
      },
    });
    const graph = {
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal' },
        { id: 'opt_a', kind: 'option', label: 'Alpha' },
      ],
      edges: [],
    } as unknown as GraphV3T;
    const ctx = makeContextForGraph(graph);
    const result = await editGraphAction.execute(
      { edit_description: 'xyzzy frobnicate' },
      ctx,
    );
    expect(result.suggested_actions_override).toBeDefined();
    expect(result.suggested_actions_override).toEqual([]);
  });

  it('chip prompt preserves full user intent with only entity reference substituted', async () => {
    handleEditGraphMock.mockResolvedValue({
      blocks: [],
      assistantText: 'Could you clarify which element you mean?',
      latencyMs: 1,
      appliedGraph: null,
      wasRejected: true,
      pendingClarification: {
        tool: 'edit_graph',
        original_edit_request: 'connect the pricing risk to the revenue outcome',
        candidate_labels: [],
      },
    });
    const graph = {
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal' },
        { id: 'opt_a', kind: 'option', label: 'Option A' },
        { id: 'out_revenue', kind: 'outcome', label: 'Revenue' },
        { id: 'risk_pricing', kind: 'risk', label: 'Market Pricing Risk' },
        { id: 'risk_churn', kind: 'risk', label: 'Customer Churn' },
      ],
      edges: [],
    } as unknown as GraphV3T;
    const userMessage = 'connect the pricing risk to the revenue outcome';
    const ctx = makeContextForGraph(graph, userMessage);
    const result = await editGraphAction.execute(
      { edit_description: 'connect the pricing risk to the revenue outcome' },
      ctx,
    );
    expect(result.suggested_actions_override).toBeDefined();
    const chips = result.suggested_actions_override!;
    expect(chips.length).toBeGreaterThan(0);
    // Chip label is the short form.
    expect(chips[0].label).toMatch(/^(Connect|Edit)\s/);
    // Chip prompt preserves the user's "to the revenue outcome" tail and
    // substitutes the chosen candidate for the unresolved "the pricing risk".
    const firstPrompt = chips[0].prompt;
    expect(firstPrompt).toContain('to the revenue outcome');
    // At least one chip substitutes to a concrete risk label.
    const anyPreserved = chips.some((c) =>
      (c.prompt.includes('Market Pricing Risk') || c.prompt.includes('Customer Churn'))
        && c.prompt.includes('to the revenue outcome'),
    );
    expect(anyPreserved).toBe(true);
  });

  it('chip labels are constructed explicitly, not substring of user phrase', async () => {
    handleEditGraphMock.mockResolvedValue({
      blocks: [],
      assistantText: 'Could you clarify which element you mean?',
      latencyMs: 1,
      appliedGraph: null,
      wasRejected: true,
      pendingClarification: {
        tool: 'edit_graph',
        original_edit_request: 'CONNECT the pricing danger',
        candidate_labels: [],
      },
    });
    const ctx = makeContextForGraph(makeGraphWithRisks());
    const result = await editGraphAction.execute(
      { edit_description: 'CONNECT the pricing danger' },
      ctx,
    );
    for (const chip of result.suggested_actions_override ?? []) {
      // Chip uses the node label, not the user's raw phrase.
      expect(chip.label).not.toContain('CONNECT');
      expect(chip.label).not.toContain('danger');
    }
  });
});
