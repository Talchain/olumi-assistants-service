/**
 * Unit tests for dispatchDraftGraph.
 *
 * Covers the three critical behaviours of the atomic graph-persistence path:
 *
 *  1. Persist success   → stage_indicator='analyse', commitPerformed=true
 *                         (commitDirectAnswer resolves with graphPersisted=true)
 *  2. Atomic commit failure → stage_indicator='frame' (no advancement),
 *                         commitPerformed=false, dispatcher does not throw
 *                         (commitDirectAnswer throws → dispatcher catch returns)
 *  3. No graphOutput    → stage_indicator stays at payload.stage,
 *                         commitDirectAnswer called with graph=undefined
 *
 * Graph persistence is atomic: CommitMetadata.graph is forwarded to
 * append_turn_atomic as p_graph. Both LLM I/O (handleDraftGraph) and the
 * commit stage (commitDirectAnswer) are mocked at module level.
 */

import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import { describe,expect,it,vi } from 'vitest';

// ── module-level mocks ────────────────────────────────────────────────────────



vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return {
    ...actual,
    emit: vi.fn(),
  };
});

// CAS/v6 reads use an explicit absent-base double; both off performs no read.
vi.mock('../../build-turn-context.js', async original => ({
  ...await original<typeof import('../../build-turn-context.js')>(),
  loadPersistedScenarioStateStrict: vi.fn(async () => ({ graph: null, briefText: null })),
}));

// ── imports after mocks ───────────────────────────────────────────────────────




import { Stage } from '@talchain/schemas/boundary';

// ── helpers ───────────────────────────────────────────────────────────────────










// Cast to the DraftGraphResult['analysisReady'] shape rather than
// `as const`: the latter forces every literal field to readonly, which
// fails to assign through `makeDraftResult(_, analysisReady)`. The
// cast preserves type-level validation against the schema while
// allowing the fixture to flow through helper signatures expecting a
// mutable AnalysisReadyPayload.








// ── tests ─────────────────────────────────────────────────────────────────────



// ── Receipt attach must DEGRADE, never throw ─────────────────────────────────
//
// The dispatch response carries INTERNAL debug decorations under an underscore
// prefix (`_timings`, and its siblings `_diagnostic_trace`, `_context_summary`,
// `_reasoning`, `_answer_shape`). They are deliberate internal channels: the
// route strips them BEFORE the strict boundary validation and re-attaches them
// after (`src/orchestrator/debug-fields.ts`).
//
// `attachModelVersionMutationReceipt` is a SECOND strict-parse seam that was
// never taught that discipline, so an internally-decorated response made the
// attach throw. The throw happens AFTER the durable write, inside the dispatch
// try/catch, so the route answered 500 for a turn that had fully persisted —
// the persisted-state invariant inverted. `commit.ts` already guards the exact
// same call for the exact same reason; this is that precedent applied to the
// one remaining unguarded site.
//
// Two harms, deliberately given two separate assertions below, because they
// cannot share one window: (a) throwing on an extra key, and (b) silently
// never attaching a genuine receipt.





// ── B1 egress: OlumiResponseSchema parse ─────────────────────────────────────
//
// Verifies the vendor tarball schema (the B1 egress validator) accepts a full
// draft_graph turn response containing both `draft_graph` and `analysis_ready`.
// This catches the class of deployment failure where the tarball is patched in
// source but the integrity hash in pnpm-lock.yaml was not updated (Render
// would then install the old tarball and the egress parse would throw).

describe('B1 egress: OlumiResponseSchema.parse', () => {
  it('accepts a complete draft_graph turn response with both draft_graph and analysis_ready', () => {
    const wireResponse = {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision graph with 13 nodes and 24 edges.',
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse' as const,
      draft_graph: {
        nodes: [
          { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
          { id: 'goal_revenue', kind: 'goal', provenance: 'from_brief', label: 'Revenue' },
        ],
        edges: [
          { from: 'dec_launch', to: 'goal_revenue', strength: 0.8 },
        ],
        node_count: 2,
        edge_count: 1,
      },
      analysis_ready: {
        status: 'ready',
        options: [
          {
            option_id: 'opt_launch_now',
            label: 'Launch now',
            status: 'ready',
            interventions: { fac_revenue: 0.8 },
          },
        ],
        goal_node_id: 'goal_revenue',
      },
    };

    expect(() => OlumiResponseSchema.parse(wireResponse)).not.toThrow();
    const parsed = OlumiResponseSchema.parse(wireResponse);
    expect(parsed.analysis_ready?.status).toBe('ready');
    expect(parsed.analysis_ready?.goal_node_id).toBe('goal_revenue');
    expect(parsed.draft_graph?.node_count).toBe(2);
  });

  it('still accepts a response with only draft_graph (no analysis_ready) — backward compat', () => {
    const wireResponse = {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision graph.',
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse' as const,
      draft_graph: {
        nodes: [{ id: 'dec_launch', kind: 'decision', label: 'Launch?' }],
        edges: [],
        node_count: 1,
        edge_count: 0,
      },
    };

    expect(() => OlumiResponseSchema.parse(wireResponse)).not.toThrow();
    const parsed = OlumiResponseSchema.parse(wireResponse);
    expect(parsed.analysis_ready).toBeUndefined();
  });

  it('still accepts a plain conversational response (no draft_graph, no analysis_ready)', () => {
    const wireResponse = {
      response_version: 2 as const,
      assistant_text: 'Here is some information.',
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'frame' as const,
    };

    expect(() => OlumiResponseSchema.parse(wireResponse)).not.toThrow();
  });
});

// ── Schema canonical value guard ──────────────────────────────────────────────

describe('stage_indicator canonical values', () => {
  it("Stage enum accepts 'analyse' — the value used on graph-persist success", () => {
    expect(() => Stage.parse('analyse')).not.toThrow();
  });

  it("Stage enum accepts 'frame' — the value used on graph-persist failure", () => {
    expect(() => Stage.parse('frame')).not.toThrow();
  });

  it("Stage enum rejects unknown values such as 'evaluate'", () => {
    expect(() => Stage.parse('evaluate')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// V5 review: post-draft chip generation
// ---------------------------------------------------------------------------
//
// The brief's chip-mapping table calls for different chips on the draft
// response depending on analysis_ready status and persistence outcome.
// These tests exercise buildPostDraftChips end-to-end through the dispatcher
// and also assert the emitted chips pass the boundary `ActionSchema`, so an
// egress validator cannot reject the envelope.



// ---------------------------------------------------------------------------
// V5 post-draft coaching — gated-hybrid composer wiring
// ---------------------------------------------------------------------------
//
// These tests exercise the dispatch boundary: the new fields on
// DraftGraphResult (strengthenItems, coachingSummary, coachingBiasSignals)
// are passed to buildPostDraftNarrative, and the source-selection
// telemetry event fires on the success path.



// ────────────────────────────────────────────────────────────────────────────
// V5 narrow-guard coaching scrub — pre-scrub the LLM-authored coaching
// strings (coachingSummary, strengthenItems[].label/.detail,
// coachingBiasSignals[].detail) before they reach `buildPostDraftNarrative`
// so internal node IDs cannot leak into `assistant_text`. The central
// egress sanitiser (`sanitiseUserFacingText`) cannot close this gap for
// `label === id` cases because `resolveLabel` returns the raw id as the
// label and substitutes the leak with itself.
// ────────────────────────────────────────────────────────────────────────────



// B-FIX1: an empty successful scenario read permits first-touch adoption on CAS ON.
vi.mock('../../build-turn-context.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../build-turn-context.js')>(),
  loadPersistedScenarioStateStrict: async () => ({ graph: null, briefText: null, revision: 7 }),
}));
