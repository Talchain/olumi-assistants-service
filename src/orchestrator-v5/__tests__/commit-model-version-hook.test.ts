/**
 * Lane 8 — commit-seam Model Management version hook (Part 3a).
 *
 * Pins:
 *  - flag OFF ⇒ byte-identical commit path: the MM service is NEVER
 *    constructed (no env reads, no saveVersion), even on graph-bearing
 *    commits;
 *  - flag ON + graph persisted ⇒ fire-and-forget saveVersion with the SAME
 *    graph object the store persisted, provenance 'commit', a content-free
 *    label, and an event_id DETERMINISTIC on the turn id;
 *  - flag ON + NO graph this commit ⇒ no saveVersion (versions record graph
 *    changes, not every turn);
 *  - non-blocking contract: a throwing service NEVER affects the commit
 *    result (logged warn only);
 *  - v5.model_versions.version_created telemetry emitted on resolution.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { serviceMock } = vi.hoisted(() => ({
  serviceMock: {
    saveVersion: vi.fn(),
    getServiceCalls: 0,
    throwOnGet: false,
  },
}));

vi.mock('../model-management/index.js', () => ({
  getModelManagementService: vi.fn(() => {
    serviceMock.getServiceCalls += 1;
    if (serviceMock.throwOnGet) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    return { saveVersion: serviceMock.saveVersion };
  }),
}));

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { _resetConfigCache } from '../../config/index.js';
import * as telemetry from '../../utils/telemetry.js';

const META = {
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  turn_class: 'direct_answer' as const,
  handler_id: null,
  request_hash: 'sha256:test',
  llm_calls_used: 1,
  duration_ms: 42,
  handler_facts: [],
};

const GRAPH = {
  nodes: [
    { id: 'goal_x', kind: 'goal', label: 'Goal' },
    { id: 'fac_y', kind: 'factor', label: 'Factor' },
  ],
  edges: [
    {
      from: 'fac_y',
      to: 'goal_x',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

const GRAPH_META = {
  ...META,
  graph: GRAPH,
  graphReceiptIntent: 'canonical_mutation' as const,
};

function composed() {
  return composeDirectAnswerResponse({
answerKind: 'functional', assistant_text: 'hi', stage: 'frame' });
}

/** The hook is fire-and-forget; give its microtask a chance to run. */
async function drainMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  serviceMock.getServiceCalls = 0;
  serviceMock.throwOnGet = false;
  serviceMock.saveVersion.mockResolvedValue({
    status: 'ok',
    value: {
      version_id: 'ver-1',
      version_number: 3,
      graph_identity_hash: 'a'.repeat(64),
      deduped: false,
      event_id: `model_version_created_turn_${META.turn_id}`,
    },
  });
  emitSpy = vi.spyOn(telemetry, 'emit');
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
  emitSpy.mockRestore();
});

function setFlag(on: boolean): void {
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', on ? 'true' : 'false');
  _resetConfigCache();
}

describe('flag OFF — byte-identical commit path', () => {
  it('never constructs the MM service, even on a graph-bearing commit', async () => {
    setFlag(false);
    const result = await commitDirectAnswer(
      composed(),
      GRAPH_META,
      createNoopSessionStore({ appendId: 'row-1' }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(serviceMock.getServiceCalls).toBe(0);
    expect(serviceMock.saveVersion).not.toHaveBeenCalled();
  });
});

describe('flag ON', () => {
  it('graph-bearing commit → fire-and-forget saveVersion with the persisted graph + deterministic event_id', async () => {
    setFlag(true);
    const result = await commitDirectAnswer(
      composed(),
      GRAPH_META,
      createNoopSessionStore({ appendId: 'row-2' }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(serviceMock.saveVersion).toHaveBeenCalledTimes(1);
    const req = serviceMock.saveVersion.mock.calls[0]![0] as Record<string, unknown>;
    expect(req.scenario_id).toBe(META.scenario_id);
    expect(req.provenance).toBe('commit');
    expect(req.label).toBe('commit:direct_answer'); // content-free turn context
    expect(req.event_id).toBe(`model_version_created_turn_${META.turn_id}`);
    // The graph handed to MM is the store's OWN persisted object (same
    // nodes/edges; the persist-repair chokepoints are idempotent no-ops on
    // this fixture).
    expect(req.graph).toMatchObject({ nodes: GRAPH.nodes.map((n) => ({ id: n.id })) });
    // Telemetry: registered event, content-free fields.
    const mmEvents = emitSpy.mock.calls.filter(
      (c: readonly unknown[]) => c[0] === telemetry.TelemetryEvents.V5ModelVersionCreated,
    );
    expect(mmEvents).toHaveLength(1);
    expect(mmEvents[0]![1]).toMatchObject({
      scenario_id: META.scenario_id,
      turn_id: META.turn_id,
      status: 'ok',
      version_number: 3,
      graph_identity_hash_prefix: 'a'.repeat(16),
      provenance: 'commit',
    });
  });

  it('deterministic event_id: two commits of the SAME turn id carry the SAME event_id (idempotent re-drive)', async () => {
    setFlag(true);
    await commitDirectAnswer(composed(), GRAPH_META, createNoopSessionStore());
    await commitDirectAnswer(composed(), GRAPH_META, createNoopSessionStore());
    await drainMicrotasks();
    const ids = serviceMock.saveVersion.mock.calls.map(
      (c) => (c[0] as { event_id: string }).event_id,
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('no graph persisted this commit → no saveVersion call', async () => {
    setFlag(true);
    await commitDirectAnswer(composed(), META, createNoopSessionStore());
    await drainMicrotasks();
    expect(serviceMock.saveVersion).not.toHaveBeenCalled();
  });

  it('a throwing service NEVER affects the turn result (non-blocking contract)', async () => {
    setFlag(true);
    serviceMock.throwOnGet = true;
    const result = await commitDirectAnswer(
      composed(),
      GRAPH_META,
      createNoopSessionStore({ appendId: 'row-3' }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(result.persisted_row_id).toBe('row-3');
  });

  it('a rejected saveVersion NEVER affects the turn result and logs only', async () => {
    setFlag(true);
    serviceMock.saveVersion.mockRejectedValue(new Error('rpc down'));
    const result = await commitDirectAnswer(
      composed(),
      GRAPH_META,
      createNoopSessionStore({ appendId: 'row-4' }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
  });

  it('deduped outcome reports status=deduped on the telemetry event', async () => {
    setFlag(true);
    serviceMock.saveVersion.mockResolvedValue({
      status: 'ok',
      value: {
        version_id: 'ver-1',
        version_number: 3,
        graph_identity_hash: 'b'.repeat(64),
        deduped: true,
        event_id: null,
      },
    });
    await commitDirectAnswer(composed(), GRAPH_META, createNoopSessionStore());
    await drainMicrotasks();
    const mmEvents = emitSpy.mock.calls.filter(
      (c: readonly unknown[]) => c[0] === telemetry.TelemetryEvents.V5ModelVersionCreated,
    );
    expect(mmEvents[0]![1]).toMatchObject({ status: 'deduped' });
  });
});

// ---------------------------------------------------------------------------
// MM P1 (ROADMAP 1.25, item 2 completion) — Brief H guest pre-check: skip
// the doomed saveVersion RPC entirely for a guest (unowned) scenario.
// ---------------------------------------------------------------------------
describe('guest pre-check (ROADMAP 1.25 item 2)', () => {
  it('owner unresolvable (guest, getScenarioOwner → null) → saveVersion is NEVER called', async () => {
    setFlag(true);
    const result = await commitDirectAnswer(
      composed(),
      GRAPH_META,
      createNoopSessionStore({
        appendId: 'row-guest',
        getScenarioOwnerBehaviour: { value: null },
      }),
    );
    await drainMicrotasks();
    expect(result.performed).toBe(true);
    expect(serviceMock.saveVersion).not.toHaveBeenCalled();
    // The service itself is never even constructed for the guest path —
    // no env reads, no client construction, matching the flag-OFF pin.
    expect(serviceMock.getServiceCalls).toBe(0);
  });

  it('owner resolves (owned scenario) → saveVersion IS called as before (no regression)', async () => {
    setFlag(true);
    await commitDirectAnswer(
      composed(),
      GRAPH_META,
      createNoopSessionStore({
        getScenarioOwnerBehaviour: { value: 'owner-user-id' },
      }),
    );
    await drainMicrotasks();
    expect(serviceMock.saveVersion).toHaveBeenCalledTimes(1);
  });

  it('store does not implement getScenarioOwner (older/other store) → fails open, saveVersion IS called', async () => {
    setFlag(true);
    // createNoopSessionStore's default omits getScenarioOwner entirely.
    await commitDirectAnswer(
      composed(),
      GRAPH_META,
      createNoopSessionStore({ appendId: 'row-no-precheck' }),
    );
    await drainMicrotasks();
    expect(serviceMock.saveVersion).toHaveBeenCalledTimes(1);
  });

  it('getScenarioOwner throws → fails open, saveVersion IS still called (pre-check is best-effort)', async () => {
    setFlag(true);
    await commitDirectAnswer(
      composed(),
      GRAPH_META,
      createNoopSessionStore({
        getScenarioOwnerBehaviour: { throws: new Error('read failed') },
      }),
    );
    await drainMicrotasks();
    expect(serviceMock.saveVersion).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// MM P1 (ROADMAP 1.25, item 4) — racing-pointer fix: thread the commit
// hook's expected-base identity hash into saveVersion's write-time CAS.
// ---------------------------------------------------------------------------
describe('racing-pointer CAS threading (ROADMAP 1.25 item 4)', () => {
  const EXPECTED_HASH = 'e'.repeat(64);

  it('metadata.expectedGraphIdentityHash (string) is threaded verbatim to saveVersion', async () => {
    setFlag(true);
    await commitDirectAnswer(
      composed(),
      { ...GRAPH_META, expectedGraphIdentityHash: EXPECTED_HASH },
      createNoopSessionStore(),
    );
    await drainMicrotasks();
    const req = serviceMock.saveVersion.mock.calls[0]![0] as Record<string, unknown>;
    expect(req.expected_graph_identity_hash).toBe(EXPECTED_HASH);
  });

  it('metadata.expectedGraphIdentityHash undefined (uninstrumented path) → key omitted, byte-identical to pre-fix', async () => {
    setFlag(true);
    await commitDirectAnswer(composed(), GRAPH_META, createNoopSessionStore());
    await drainMicrotasks();
    const req = serviceMock.saveVersion.mock.calls[0]![0] as Record<string, unknown>;
    expect('expected_graph_identity_hash' in req).toBe(false);
  });

  it('metadata.expectedGraphIdentityHash null (server read, empty/unparseable base) → collapses to omitted, not literal null', async () => {
    setFlag(true);
    await commitDirectAnswer(
      composed(),
      { ...GRAPH_META, expectedGraphIdentityHash: null },
      createNoopSessionStore(),
    );
    await drainMicrotasks();
    const req = serviceMock.saveVersion.mock.calls[0]![0] as Record<string, unknown>;
    expect('expected_graph_identity_hash' in req).toBe(false);
  });
});
