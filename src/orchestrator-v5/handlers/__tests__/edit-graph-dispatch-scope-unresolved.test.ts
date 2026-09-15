/**
 * ⭐⭐ END-TO-END: the scope-unresolved verdict must WITHHOLD THE WRITE and ASK.
 *
 * ═══ WHY THIS FILE EXISTS SEPARATELY FROM THE GUARD'S OWN SPEC ═══
 * `routing/__tests__/option-write-scope-unresolved.test.ts` proves the PREDICATE
 * returns `scope_unresolved` for the measured buy turn. It proves nothing about
 * whether the dispatcher ACTS on it — and a verdict nothing consumes is this
 * estate's single most-repeated defect (CLAUDE.md: "WE BUILD MORE THAN WE PLUG
 * IN"). It was real here: the dispatcher gated on `verdict === 'withhold'` in
 * BOTH places, so a third variant fell through both and the write still landed.
 * That was caught by reading, and reading is not evidence. This file executes it.
 *
 * ═══ THE MEASURED TURN — deployed `a3b0548d`, wire-level, FRESH ═══
 * Banked at `output/core-staging-driver/journey-integrated-a3b0548d/journey-buy-run1/`.
 *   USER    "Change the buy option so the vendor cost is £150,000 per year
 *            instead of £120,000. Keep everything else the same."
 *   RESULT  factor `8f788330` observed_state null → {raw_value:150000,
 *             source:"user_override"} — a MODEL-WIDE baseline, minted
 *           option `c5f4f68e` own intervention: still 60000
 *           `graph_hash` a0b39d86 → 84013c95 — IT COMMITTED
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): remove `!optionScopeUnresolved`
 * from the `effectiveAppliedMutation` conjunction and the WITHHOLD test must go
 * red. Remove the `scope_unresolved` text branch and the ASK test must go red.
 * They are separate assertions because they are separate failures: a write that
 * lands silently, and a turn that says nothing about why nothing happened.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  describe, it, expect, vi, beforeEach, afterEach, type MockedFunction,
} from 'vitest';
import type { FastifyRequest } from 'fastify';

import { _resetConfigCache } from '../../../config/index.js';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({ handleEditGraph: vi.fn() }));
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));
vi.mock('../../../adapters/llm/router.js', () => ({ getAdapter: vi.fn().mockReturnValue({}) }));
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return { ...actual, loadPersistedGraphStrict: vi.fn().mockResolvedValue(null) };
});
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const CAPTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./buy-capture-a3b0548d.json', import.meta.url)), 'utf8'),
) as { nodes: Array<Record<string, unknown>>; edges?: unknown[] };

const VENDOR_FACTOR = '8f788330';
const BUY_OPTION = 'c5f4f68e';
const MSG =
  'Change the buy option so the vendor cost is £150,000 per year instead of £120,000. ' +
  'Keep everything else the same.';
/** No option anchor at all — the explicit model-wide edit, which must still land. */
const MODEL_WIDE_MSG = 'Set Vendor Licensing Cost to £150,000 per year.';

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

const INGRESS_GRAPH = clone(CAPTURE) as unknown as GraphStateIngress;

/** The applied graph the wire actually produced: baseline minted, option untouched. */
function baselineMintedGraph(): GraphV3T {
  const g = clone(CAPTURE);
  for (const n of g.nodes) {
    if (n.id === VENDOR_FACTOR) {
      n.observed_state = { value: 1.5, unit: '£', source: 'user_override', raw_value: 150000 };
    }
  }
  return g as unknown as GraphV3T;
}

function appliedResult(graph: GraphV3T, assistantText: string): EditGraphResult {
  return {
    blocks: [],
    assistantText,
    latencyMs: 1000,
    appliedGraph: graph as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [{
      op: 'update_node',
      path: VENDOR_FACTOR,
      value: { observed_state: { value: 1.5, raw_value: 150000, source: 'user_override' } },
    }],
    appliedChanges: {
      summary: assistantText,
      changes: [{ label: 'Vendor Licensing Cost', description: 'changed.', element_ref: VENDOR_FACTOR }],
      rerun_recommended: false,
    },
    operation_meta: [{ impact: 'low', rationale: '' }],
  } as unknown as EditGraphResult;
}

const commitMock = () => commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
const STUB_REQUEST = {} as FastifyRequest;

async function dispatch(message: string, requestId: string) {
  return dispatchEditGraph({
    payload: {
      kind: 'message' as const,
      scenario_id: 'scen-buy-a3b0548d',
      turn_id: 'turn-buy-1',
      stage: 'frame' as const,
      message,
      turn_class: 'frame' as const,
      source: 'composer' as const,
    },
    requestId,
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
}

beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
  vi.clearAllMocks();
  commitMock().mockResolvedValue({
    response: {}, performed: true as const, persisted_row_id: 'row-test', graphPersisted: true,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
});
afterEach(() => { vi.unstubAllEnvs(); _resetConfigCache(); });

describe('an option-anchored turn with no resolved option: the DISPATCHER acts on it', () => {
  it('PRECONDITION — the capture is the buy graph and the option is wired to the factor', () => {
    const option = CAPTURE.nodes.find((n) => n.id === BUY_OPTION);
    expect((option as { interventions: Record<string, unknown> }).interventions)
      .toHaveProperty(VENDOR_FACTOR);
    const factor = CAPTURE.nodes.find((n) => n.id === VENDOR_FACTOR);
    expect((factor as { observed_state?: unknown }).observed_state ?? null).toBeNull();
  });

  it('THE WRITE IS WITHHELD — nothing is committed', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      appliedResult(baselineMintedGraph(), 'Updated Vendor Licensing Cost'),
    );
    await dispatch(MSG, 'req-scope-withhold');
    expect(commitMock()).toHaveBeenCalledTimes(1);
    // The whole defect in one assertion: on a3b0548d this was DEFINED and the
    // model-wide baseline persisted into the scenario graph.
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
  });

  it('THE TURN ASKS — it names what would have moved, and offers the options', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      appliedResult(baselineMintedGraph(), 'Updated Vendor Licensing Cost'),
    );
    const out = await dispatch(MSG, 'req-scope-ask');
    const text = out.response.assistant_text;
    // Nothing fails silently, and the fault is not the user's.
    expect(text).toContain('I have not changed the model');
    expect(text).toContain('Which option did you mean');
    // Bound by identity to the value that would have moved, and to real options.
    expect(text).toContain('Vendor Licensing Cost');
    expect(text).toContain('Buy Off-the-Shelf Reporting Tool');
    // The false success headline does not survive alongside the ask.
    expect(text).not.toContain('Updated Vendor Licensing Cost.');
  });

  it('CONTRAST: an EXPLICIT model-wide edit still commits', async () => {
    // The anchor is what separates the two, and it is read off the USER'S
    // message — not off the write. Without this the fix would be
    // "every baseline edit is forbidden", which it must not be.
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      appliedResult(baselineMintedGraph(), 'Updated Vendor Licensing Cost'),
    );
    await dispatch(MODEL_WIDE_MSG, 'req-scope-modelwide');
    expect(commitMock()).toHaveBeenCalledTimes(1);
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
  });
});
