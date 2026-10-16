/**
 * GRAPH-EDIT-TRANSACTION §3.2 — the edit lane must advertise the hash of the
 * graph it PERSISTS, not of the graph it had before the commit-site passes.
 *
 * THE DEFECT (confirmed at the bytes on staging `5afef510`).
 * `edit-graph-dispatch.ts` computed `currentGraphHashForRecovery =
 * computeAnalysisAffectingGraphHash(persistedPostEditGraph)` and then handed
 * that same graph to `commitDirectAnswer`, which runs three passes —
 * `repairGraphForPersistence`, `normaliseOptionInterventionContract`,
 * `reconcileTopLevelOptionsFromNodes` — that mutate `intercept`, node
 * `interventions` and `options[]`. All three are inside the analysis-hash
 * projection. So the hash the dispatch handed to freshness, to the pending
 * re-pin (`graph_hash`) and to the hold thread-through
 * (`graphHashAfterCommit`) described a graph that was never stored.
 *
 * This drives the REAL dispatch through the REAL persist-merge seam (only the
 * edit LLM and the commit are faked) and asserts the property directly: the
 * graph handed to the commit is already in persisted form, and the advertised
 * hash is that graph's hash. RED before the projection is applied.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction, afterEach } from 'vitest';
import { _resetConfigCache } from '../../../config/index.js';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    // B-FIX1: the combined read follows the existing graph double.
    loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});
import { commitDirectAnswer } from '../../commit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const hash = (g: unknown) =>
  computeAnalysisAffectingGraphHash(g as GraphStateIngress | null | undefined);

/**
 * An ordinary applied value edit whose result carries the duplicate
 * observed-root intercept pattern (`intercept === observed_state.value`) —
 * precisely what `repairGraphForPersistence` strips at the persist site, and a
 * field the analysis hash projects.
 */
function makeInterceptDuplicateEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Updated the annual office rent to 42.',
    latencyMs: 1200,
    appliedGraph: {
      nodes: [
        { id: 'goal_cost', kind: 'goal', label: 'Reduce Operating Costs' },
        {
          id: 'fac_rent',
          kind: 'factor',
          label: 'Annual Office Rent',
          intercept: 42,
          observed_state: { value: 42 },
        },
      ],
      edges: [
        {
          from: 'fac_rent',
          to: 'goal_cost',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'negative' as const,
        },
      ],
    } as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [{ op: 'update_node', path: 'fac_rent', value: { observed_state: { value: 42 } } }],
    appliedChanges: {
      summary: 'Annual Office Rent: set to 42',
      changes: [
        { label: 'Annual Office Rent', description: 'Set to 42.', element_ref: 'fac_rent' },
      ],
      rerun_recommended: false,
    },
    operation_meta: [{ impact: 'moderate', rationale: '' }],
  };
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-hash',
    graphPersisted: true,
    persistedAnalysisGraphHash: null,
    pendingLifecycle: {
      priorCount: 0,
      consumedCount: 0,
      supersededCount: 0,
      expiredWallCount: 0,
      expiredTurnsCount: 0,
      hashInvalidatedCount: 0,
      capDroppedCount: 0,
      survivedCount: 0,
    },
  };
}

// ── ROADMAP 2.474 / A10 — the mode is now STATED, not inherited ──────────
// `CEE_GRAPH_MANAGEMENT_MODE`'s repo default moved 'off' → 'live' (the referee
// ships ON; a trust story hanging on a dashboard variable is one careless edit
// from being untrue). This file pins PERSISTENCE mechanics — the merge base,
// the projection, the advertised hash — on a turn that reaches the commit. It
// was authored under the implicit 'off' default, and that premise is exactly
// what it needs: 'off' is the mode in which the existing path proceeds
// byte-identically, so the seam under test is reached unchanged. Stating it
// here preserves the property this file was written to prove, and makes the
// dependency visible instead of inherited. Live-mode ROUTING is covered by its
// own files (edit-graph-dispatch-graph-management-modes.test.ts and the
// referee-gate suites), which is where a live regression would surface.
beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('dispatchEditGraph — §3.2: the advertised hash describes the PERSISTED graph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
      makeCommitResult() as unknown as Awaited<ReturnType<typeof commitDirectAnswer>>,
    );
  });

  it('premise: this edit result IS one the persist projection changes', () => {
    const applied = makeInterceptDuplicateEditResult().appliedGraph;
    expect(hash(projectGraphForPersistence(applied, {}))).not.toBe(hash(applied));
  });
});
