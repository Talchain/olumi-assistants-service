/**
 * ⭐⭐ A PROPOSAL HEADLINE MAY NOT SURVIVE A TURN THAT PERSISTED NOTHING.
 *
 * ═══ THE MEASURED TURN — deployed `a3b0548d`, wire-level, FRESH ═══
 * Banked at `output/core-staging-driver/journey-2026-09-15-postmerge/journey-run1/
 * beat-edit-confirm.json` (`exit_path: "edit_graph"`). Its `assistant_text`, in full:
 *
 *   "2 model parameters updated: Pro Plan Monthly Price, Model is raising the Pro
 *    plan price from £49 to £69 per month with the next Pro feature release
 *
 *    Note: nothing from this message was saved, so "Pro Plan Monthly Price" is unchanged."
 *
 * One turn claims two parameters updated AND that nothing was saved. The NOTE is
 * the true half: `graph_hash` never moved across the session, and the option's
 * stored value read 59 at save, rerun AND reopen.
 *
 * ═══ WHY IT HAPPENS ═══
 * The headline is `buildAppliedChanges`'s summary, composed from the PARSED
 * OPERATIONS and the in-memory post-apply graph, and fixed into
 * `response.assistant_text` long before `effectiveAppliedMutation` exists. It
 * cannot know the write was withheld.
 *
 * ⚠ AND A GUARD ALREADY SAT ON THIS LANE AND MISSED IT — which is why the naive
 * test for this is VACUOUS, and one such test was written and thrown away before
 * this file existed. `findSuccessClaimHit` replaces a false success sentence
 * here, but binds by PHRASE. EXECUTED against `SUCCESS_CLAIM_PATTERNS`:
 *
 *   "2 model parameters updated: …"          -> null   (MISSES — the real defect)
 *   "Updated Subcontractor cost as share …"  -> "Updated S"  (hits)
 *   "Updated Vendor Licensing Cost"          -> "Updated V"  (hits)
 *
 * So a fixture whose summary starts "Updated …" is replaced by the PHRASE arm and
 * proves nothing about the gate. This fixture deliberately uses the real wire
 * headline, which that arm does not match.
 *
 * ═══ THE LANE, and why the message is a CHIP ═══
 * The real turn was a chip click. Its message names the option's FULL label, so
 * `detectConfigureOptionIntent` matches on `chip_prefix` and the option resolves —
 * which is what lets the withhold arm reach a verdict at all. A free-text message
 * that does not name the full label takes a different path entirely.
 *
 * ⚠ Fixture transcribed from the banked capture: the post-rename pricing graph,
 * and the `after` is that graph with the baseline write the edit proposed and the
 * guard withheld. Historic capture: append, never edit (trap 14b).
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): remove the headline-withdrawal block
 * from `edit-graph-dispatch.ts` and the first test MUST go red. The two contrast
 * tests must stay GREEN through that removal.
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
import { findSuccessClaimHit } from '../../compose/forbidden-user-facing-phrases.js';

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
  readFileSync(fileURLToPath(new URL('./pricing-confirm-capture-a3b0548d.json', import.meta.url)), 'utf8'),
) as { nodes: Array<Record<string, unknown>>; edges?: unknown[] };

const PRICE_FACTOR = '6d9a37f3';
const OPTION_LABEL =
  'raising the Pro plan price from £49 to £69 per month with the next Pro feature release';
/** The chip message the product itself emitted, and the user clicked. */
const CHIP_MSG = `Help me configure ${OPTION_LABEL}.`;
/** The headline the wire actually shipped. */
const WIRE_HEADLINE =
  '2 model parameters updated: Pro Plan Monthly Price, Model is raising the Pro plan price ' +
  'from £49 to £69 per month with the next Pro feature release';

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
const INGRESS_GRAPH = clone(CAPTURE) as unknown as GraphStateIngress;

/** The applied graph the edit proposed: the FACTOR baseline moved. */
function baselineMovedGraph(): GraphV3T {
  const g = clone(CAPTURE);
  for (const n of g.nodes) {
    if (n.id !== PRICE_FACTOR) continue;
    const obs = (n.observed_state ?? {}) as Record<string, unknown>;
    n.observed_state = { ...obs, value: 0.69, raw_value: 69, source: 'user_override' };
  }
  return g as unknown as GraphV3T;
}

function appliedResult(graph: GraphV3T, summary: string): EditGraphResult {
  return {
    blocks: [], assistantText: summary, latencyMs: 1000,
    appliedGraph: graph as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [{
      op: 'update_node', path: PRICE_FACTOR,
      value: { observed_state: { value: 0.69, raw_value: 69, source: 'user_override' } },
    }],
    appliedChanges: {
      summary,
      changes: [{ label: 'Pro Plan Monthly Price', description: 'changed.', element_ref: PRICE_FACTOR }],
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
      kind: 'message' as const, scenario_id: 'scen-pricing-a3b0548d', turn_id: 'turn-confirm',
      stage: 'frame' as const, message, turn_class: 'frame' as const, source: 'composer' as const,
    },
    requestId, request: STUB_REQUEST, graphState: INGRESS_GRAPH, analysisState: null,
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

describe('the applied-changes headline is withdrawn when nothing persisted', () => {
  it('PRECONDITION — the PHRASE guard genuinely misses this headline', () => {
    // If this ever starts hitting, the test below would pass via the phrase arm
    // and prove nothing about the gate — the exact vacuity that sank a previous
    // attempt at this test.
    expect(findSuccessClaimHit(WIRE_HEADLINE)).toBeNull();
    // Contrast in the same assertion pair: the arm is alive, just not here.
    expect(findSuccessClaimHit('Updated Pro Plan Monthly Price')).not.toBeNull();
  });

  it('THE CLAIM: the false headline does not reach the user, and the honest note does', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      appliedResult(baselineMovedGraph(), WIRE_HEADLINE),
    );
    const out = await dispatch(CHIP_MSG, 'req-headline-gate');
    const text = out.response.assistant_text;

    // The write really was withheld — the precondition this rests on.
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
    // THE DEFECT: on a3b0548d this line was present, above the note.
    expect(text).not.toContain('2 model parameters updated');
    // Surgery, not demolition — the true half survives.
    expect(text).toContain('nothing from this message was saved');
  });

  it('CONTRAST: a turn that PERSISTS keeps its headline', async () => {
    // Withdrawing a headline from a turn that saved would be the inverse lie.
    // Same summary string, opposite gate state — proving the binding is to the
    // GATE and not to the text.
    const landed = clone(CAPTURE);
    for (const n of landed.nodes) {
      if (n.id !== '619f3099') continue;
      const iv = (n.interventions ?? {}) as Record<string, Record<string, unknown>>;
      iv[PRICE_FACTOR] = { ...iv[PRICE_FACTOR], value: 0.69, raw_value: 69, source: 'user_override' };
      n.interventions = iv;
    }
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      appliedResult(landed as unknown as GraphV3T, WIRE_HEADLINE),
    );
    const out = await dispatch(CHIP_MSG, 'req-headline-gate-twin');
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
    expect(out.response.assistant_text).toContain('2 model parameters updated');
  });
});
