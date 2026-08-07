/**
 * Context Architecture v2 — "disclosure integrity" (ROADMAP 1.73).
 *
 * Design of record: docs-designs/CONTEXT-ARCHITECTURE-V2-2026-07-13/
 *   - 02 §Disclosure — (1) graph truncation gets an in-section marker AND
 *     the section header stops misreporting (post-truncation counts);
 *     (2) the pack conversation gains `{window: {shown, available}}` and
 *     per-message `truncated` flags on projected turns.
 *
 * Disclosure is now UNCONDITIONAL (the CEE_CONTEXT_DISCLOSURE_V2 flag was
 * removed). These pins assert the always-on output shape at every surface
 * that renders it, and lock the LIVE correctness fix: the edit-lane graph
 * header must report what is actually in the JSON below it, never the
 * pre-truncation counts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as telemetry from '../../src/utils/telemetry.js';
import { TelemetryEvents } from '../../src/utils/telemetry.js';
import {
  serialiseEditContextForLLM,
  serialiseEditContextForLLMWithMeta,
  truncateGraphJsonWithMeta,
  editCompactGraph,
} from '../../src/orchestrator/context/serialise.js';
import {
  projectConversation,
  PERSISTED_MESSAGE_CAP,
  CONTEXT_PACK_RECENT_TURNS_CAP,
} from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { SessionTurnWithContent } from '../../src/orchestrator-v5/session/conversation-content.js';
import { ContextPackSchema } from '../../src/orchestrator-v5/context/context-pack-schema.js';
import { CONVERSATION_TEXT_CAP } from '../../src/orchestrator-v5/commit.js';
import type { ConversationContext } from '../../src/orchestrator/types.js';
import type { GraphV3T } from '../../src/schemas/cee-v3.js';

let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function bigGraph(nodeCount = 120): GraphV3T {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `node_${i}`,
    label: `A deliberately verbose node label for overflow ${i} ${'x'.repeat(40)}`,
    kind: 'factor' as const,
  }));
  const edges = Array.from({ length: nodeCount - 1 }, (_, i) => ({
    from: `node_${i}`,
    to: `node_${i + 1}`,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
  }));
  return { nodes, edges } as unknown as GraphV3T;
}

function editContextWith(graph: GraphV3T | null): ConversationContext {
  return {
    graph,
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn_s1_fixture',
  };
}

function turnFixture(i: number, userMessage?: string): SessionTurnWithContent {
  return {
    id: `row_${i}`,
    scenario_id: 'scenario_fixture',
    user_id: null,
    turn_id: `turn_${i}`,
    turn_class: 'handler',
    handler_id: 'run_analysis',
    request_hash: 'sha256:test',
    response_emitted: true,
    llm_calls_used: 0,
    duration_ms: 0,
    created_at: new Date(2026, 0, 1, 0, i).toISOString(),
    user_message: userMessage ?? `question ${i}`,
    assistant_message: `answer ${i}`,
  };
}

// Parse the node/edge counts out of the rendered "## Current Graph (N nodes,
// M edges)" header, and count what the ```json body actually carries.
function readHeaderAndBody(text: string): {
  headerNodes: number;
  headerEdges: number;
  bodyNodes: number;
  bodyEdges: number;
} {
  const header = text.split('\n').find((l) => l.startsWith('## Current Graph'));
  if (!header) throw new Error('no graph header rendered');
  const m = header.match(/\((\d+) nodes, (\d+) edges\)/);
  if (!m) throw new Error(`header shape unexpected: ${header}`);
  const jsonStart = text.indexOf('```json');
  const jsonEnd = text.indexOf('```', jsonStart + 7);
  const body = JSON.parse(text.slice(jsonStart + 7, jsonEnd).trim());
  return {
    headerNodes: Number(m[1]),
    headerEdges: Number(m[2]),
    bodyNodes: body.nodes.length,
    bodyEdges: body.edges.length,
  };
}

// ---------------------------------------------------------------------------
// Graph disclosure (marker + honest header) — UNCONDITIONAL
// ---------------------------------------------------------------------------

describe('graph disclosure (serialise.ts) — always on', () => {
  it('LIVE FIX: a truncated graph header never overstates what the JSON carries', () => {
    // Regression pin for the misreporting header: pre-fix the header printed
    // pre-truncation counts (120 nodes, 119 edges) over a JSON body that had
    // been edge-sliced to a fraction — the edit LLM was told edges existed
    // that it could not see. The default (production) path must be honest.
    const out = serialiseEditContextForLLM(editContextWith(bigGraph()));
    const { headerNodes, headerEdges, bodyNodes, bodyEdges } = readHeaderAndBody(out);
    expect(headerNodes).toBe(bodyNodes);
    expect(headerEdges).toBe(bodyEdges);
  });

  it('default (no opts): header carries POST-truncation counts and the in-section marker', () => {
    const graph = bigGraph();
    const compact = editCompactGraph(graph);
    const cut = truncateGraphJsonWithMeta(compact, 8_000);
    expect(cut.truncated).toBe(true);

    const { text } = serialiseEditContextForLLMWithMeta(editContextWith(graph), 8_000, 4_000);

    // Honest header: post-truncation counts.
    expect(text).toContain(`## Current Graph (${cut.keptNodes} nodes, ${cut.keptEdges} edges)`);
    // The 02 §Disclosure marker, exact shape.
    expect(text).toContain(
      `(graph truncated: showing ${cut.keptNodes} of ${compact.nodes.length} nodes, ${cut.keptEdges} of ${compact.edges.length} edges)`,
    );
    // The misreporting pre-truncation header must be GONE (edges differ).
    expect(text).not.toContain(
      `## Current Graph (${compact.nodes.length} nodes, ${compact.edges.length} edges)`,
    );

    // The cut-site event is disclosed:true.
    const cuts = emitSpy.mock.calls
      .filter((c: readonly unknown[]) => c[0] === TelemetryEvents.V5ContextTruncation)
      .map((c: readonly unknown[]) => c[1] as Record<string, unknown>)
      .filter((e: Record<string, unknown>) => e.section === 'graph_json');
    expect(cuts).toHaveLength(1);
    expect(cuts[0].disclosed).toBe(true);
  });

  it('positive control — a fitting graph: no marker, full header, no cut event', () => {
    const graph = bigGraph(3);
    const compact = editCompactGraph(graph);
    const { text } = serialiseEditContextForLLMWithMeta(editContextWith(graph), 8_000, 4_000);
    expect(text).toContain(`## Current Graph (${compact.nodes.length} nodes, ${compact.edges.length} edges)`);
    expect(text).not.toContain('(graph truncated:');
    // Absence assertion is meaningful only because the truncated case above
    // DOES emit — here the graph fits, so no graph_json cut event fires.
    const cuts = emitSpy.mock.calls
      .filter((c: readonly unknown[]) => c[0] === TelemetryEvents.V5ContextTruncation)
      .map((c: readonly unknown[]) => c[1] as Record<string, unknown>)
      .filter((e: Record<string, unknown>) => e.section === 'graph_json');
    expect(cuts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Window + per-turn disclosure (projectConversation) — UNCONDITIONAL
// ---------------------------------------------------------------------------

describe('window disclosure (projectConversation) — always on', () => {
  it('default (no opts): conversation gains {window: {shown, available}}', () => {
    const turns = Array.from({ length: 9 }, (_, i) => turnFixture(i));
    const projected = projectConversation(turns, false);
    // Numbers asserted by name: the window also carries an additive
    // `notice` (the code-owned in-band disclosure) whenever turns exist
    // that the projection does not show. No `totalStored` is passed here,
    // so the counts stay the window's own length.
    expect(projected.window?.shown).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(projected.window?.available).toBe(9);
    expect(projected.window?.notice).toContain('INCOMPLETE');

    const cuts = emitSpy.mock.calls
      .filter((c: readonly unknown[]) => c[0] === TelemetryEvents.V5ContextTruncation)
      .map((c: readonly unknown[]) => c[1] as Record<string, unknown>);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].disclosed).toBe(true);
  });

  it('a window that fits (<= cap) still discloses shown === available', () => {
    const turns = Array.from({ length: 3 }, (_, i) => turnFixture(i));
    const projected = projectConversation(turns, false);
    // A conversation that fits shows everything, so there is nothing to
    // disclose — the notice key must be ABSENT, not an empty string.
    expect(projected.window).toEqual({ shown: 3, available: 3 });
    // No overflow → no window_slice cut event.
    const cuts = emitSpy.mock.calls.filter(
      (c: readonly unknown[]) => c[0] === TelemetryEvents.V5ContextTruncation,
    );
    expect(cuts).toHaveLength(0);
  });

  it('default (no opts): a projected turn whose message sits AT the persistence cap is flagged truncated', () => {
    const atCap = 'q'.repeat(PERSISTED_MESSAGE_CAP);
    const turns = [turnFixture(0, atCap), turnFixture(1)];
    const projected = projectConversation(turns, false);
    expect(projected.recent_turns[0].truncated).toBe(true);
    // Turns under the cap carry NO truncated key (never a noisy false).
    expect('truncated' in projected.recent_turns[1]).toBe(false);
  });

  it('PERSISTED_MESSAGE_CAP mirrors commit.ts CONVERSATION_TEXT_CAP (drift pin)', () => {
    expect(PERSISTED_MESSAGE_CAP).toBe(CONVERSATION_TEXT_CAP);
  });

  it('a disclosing conversation still validates against the strict ContextPack schema', () => {
    const turns = Array.from({ length: 9 }, (_, i) => turnFixture(i, 'q'.repeat(PERSISTED_MESSAGE_CAP)));
    const projected = projectConversation(turns, false);
    const parsed = ContextPackSchema.shape.conversation.safeParse(projected);
    expect(parsed.success).toBe(true);
    // .strict() must not silently strip the disclosure fields.
    if (parsed.success) {
      const window = (parsed.data as { window?: Record<string, unknown> }).window;
      expect(window?.shown).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
      expect(window?.available).toBe(9);
      // .strict() must not strip the disclosure STRING either.
      expect(typeof window?.notice).toBe('string');
    }
  });
});
