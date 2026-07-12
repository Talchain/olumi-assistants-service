/**
 * Context Architecture v2 — S1 "disclosure integrity" (ROADMAP 1.73).
 *
 * Design of record: docs-designs/CONTEXT-ARCHITECTURE-V2-2026-07-13/
 *   - 02 §Disclosure — (1) graph truncation gets an in-section marker AND
 *     the section header stops misreporting (post-truncation counts);
 *     (2) the pack conversation gains `{window: {shown, available}}` and
 *     per-message `truncated` flags on projected turns.
 *   - 05 §S1 — flag `CEE_CONTEXT_DISCLOSURE_V2` (prompt bytes change →
 *     ships dark). RED: truncated fixture graph yields marker + honest
 *     counts.
 *
 * Flag-off byte-identity is the binding invariant: with the flag off the
 * serialiser output and the projected conversation are BYTE-IDENTICAL to
 * pre-S1 (including the misreporting header — that is today's behaviour,
 * kept dark until the harness A/B).
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
} from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { SessionTurnWithContent } from '../../src/orchestrator-v5/session/conversation-content.js';
import { ContextPackSchema } from '../../src/orchestrator-v5/context/context-pack-schema.js';
import { CONVERSATION_TEXT_CAP } from '../../src/orchestrator-v5/commit.js';
import { _resetConfigCache } from '../../src/config/index.js';
import type { ConversationContext } from '../../src/orchestrator/types.js';
import type { GraphV3T } from '../../src/schemas/cee-v3.js';

let emitSpy: ReturnType<typeof vi.spyOn>;
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit');
  envBackup.CEE_CONTEXT_DISCLOSURE_V2 = process.env.CEE_CONTEXT_DISCLOSURE_V2;
});

afterEach(() => {
  if (envBackup.CEE_CONTEXT_DISCLOSURE_V2 === undefined) {
    delete process.env.CEE_CONTEXT_DISCLOSURE_V2;
  } else {
    process.env.CEE_CONTEXT_DISCLOSURE_V2 = envBackup.CEE_CONTEXT_DISCLOSURE_V2;
  }
  _resetConfigCache();
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

// ---------------------------------------------------------------------------
// Graph disclosure (marker + honest header)
// ---------------------------------------------------------------------------

describe('S1 graph disclosure (serialise.ts, CEE_CONTEXT_DISCLOSURE_V2)', () => {
  it('disclose ON: header carries POST-truncation counts and the in-section marker', () => {
    const graph = bigGraph();
    const compact = editCompactGraph(graph);
    const cut = truncateGraphJsonWithMeta(compact, 8_000);
    expect(cut.truncated).toBe(true);

    const { text } = serialiseEditContextForLLMWithMeta(
      editContextWith(graph),
      8_000,
      4_000,
      { discloseTruncations: true },
    );

    // Honest header: post-truncation counts (the :202 misreport fixed).
    expect(text).toContain(`## Current Graph (${cut.keptNodes} nodes, ${cut.keptEdges} edges)`);
    // The 02 §Disclosure marker, exact shape.
    expect(text).toContain(
      `(graph truncated: showing ${cut.keptNodes} of ${compact.nodes.length} nodes, ${cut.keptEdges} of ${compact.edges.length} edges)`,
    );
    // The misreporting pre-truncation header must be GONE.
    expect(text).not.toContain(
      `## Current Graph (${compact.nodes.length} nodes, ${compact.edges.length} edges)`,
    );

    // The cut-site event flips to disclosed:true.
    const cuts = emitSpy.mock.calls
      .filter((c: readonly unknown[]) => c[0] === TelemetryEvents.V5ContextTruncation)
      .map((c: readonly unknown[]) => c[1] as Record<string, unknown>)
      .filter((e: Record<string, unknown>) => e.section === 'graph_json');
    expect(cuts).toHaveLength(1);
    expect(cuts[0].disclosed).toBe(true);
  });

  it('disclose ON with a fitting graph: no marker, header unchanged', () => {
    const graph = bigGraph(3);
    const compact = editCompactGraph(graph);
    const { text } = serialiseEditContextForLLMWithMeta(
      editContextWith(graph),
      8_000,
      4_000,
      { discloseTruncations: true },
    );
    expect(text).toContain(`## Current Graph (${compact.nodes.length} nodes, ${compact.edges.length} edges)`);
    expect(text).not.toContain('(graph truncated:');
  });

  it('flag OFF (default): byte-identical to legacy, misreporting header preserved, event disclosed:false', () => {
    const graph = bigGraph();
    const compact = editCompactGraph(graph);
    const legacy = [
      `## Current Graph (${compact.nodes.length} nodes, ${compact.edges.length} edges)`,
      '```json',
      truncateGraphJsonWithMeta(compact, 8_000).json,
      '```',
    ].join('\n\n');

    const out = serialiseEditContextForLLM(editContextWith(graph));
    expect(out).toBe(legacy);

    const cuts = emitSpy.mock.calls
      .filter((c: readonly unknown[]) => c[0] === TelemetryEvents.V5ContextTruncation)
      .map((c: readonly unknown[]) => c[1] as Record<string, unknown>)
      .filter((e: Record<string, unknown>) => e.section === 'graph_json');
    expect(cuts).toHaveLength(1);
    expect(cuts[0].disclosed).toBe(false);
  });

  it('default follows CEE_CONTEXT_DISCLOSURE_V2 when no explicit opts are passed', () => {
    process.env.CEE_CONTEXT_DISCLOSURE_V2 = 'true';
    _resetConfigCache();
    const out = serialiseEditContextForLLM(editContextWith(bigGraph()));
    expect(out).toContain('(graph truncated: showing');
  });
});

// ---------------------------------------------------------------------------
// Window + per-turn disclosure (projectConversation)
// ---------------------------------------------------------------------------

describe('S1 window disclosure (projectConversation, CEE_CONTEXT_DISCLOSURE_V2)', () => {
  it('disclose ON: conversation gains {window: {shown, available}}', () => {
    const turns = Array.from({ length: 9 }, (_, i) => turnFixture(i));
    const projected = projectConversation(turns, false, { discloseWindow: true });
    expect(projected.window).toEqual({ shown: 5, available: 9 });

    const cuts = emitSpy.mock.calls
      .filter((c: readonly unknown[]) => c[0] === TelemetryEvents.V5ContextTruncation)
      .map((c: readonly unknown[]) => c[1] as Record<string, unknown>);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].disclosed).toBe(true);
  });

  it('disclose ON: a projected turn whose message sits AT the persistence cap is flagged truncated', () => {
    const atCap = 'q'.repeat(PERSISTED_MESSAGE_CAP);
    const turns = [turnFixture(0, atCap), turnFixture(1)];
    const projected = projectConversation(turns, false, { discloseWindow: true });
    expect(projected.recent_turns[0].truncated).toBe(true);
    // Turns under the cap carry NO truncated key (never a noisy false).
    expect('truncated' in projected.recent_turns[1]).toBe(false);
  });

  it('flag OFF (default): output is KEY-IDENTICAL to pre-S1 — no window, no truncated keys', () => {
    const turns = Array.from({ length: 9 }, (_, i) => turnFixture(i, 'q'.repeat(PERSISTED_MESSAGE_CAP)));
    const projected = projectConversation(turns, false);
    expect('window' in projected).toBe(false);
    for (const turn of projected.recent_turns) {
      expect('truncated' in turn).toBe(false);
    }
    // JSON byte-identity of the serialised shape (this is what the routing
    // prompt embeds).
    expect(Object.keys(projected).sort()).toEqual([
      'last_tool_used',
      'pending_confirmation',
      'recent_turns',
      'turn_count',
    ]);
  });

  it('PERSISTED_MESSAGE_CAP mirrors commit.ts CONVERSATION_TEXT_CAP (drift pin)', () => {
    expect(PERSISTED_MESSAGE_CAP).toBe(CONVERSATION_TEXT_CAP);
  });

  it('a disclosing conversation still validates against the strict ContextPack schema', () => {
    const turns = Array.from({ length: 9 }, (_, i) => turnFixture(i, 'q'.repeat(PERSISTED_MESSAGE_CAP)));
    const projected = projectConversation(turns, false, { discloseWindow: true });
    const parsed = ContextPackSchema.shape.conversation.safeParse(projected);
    expect(parsed.success).toBe(true);
    // .strict() must not silently strip the disclosure fields.
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).window).toEqual({ shown: 5, available: 9 });
    }
  });
});
