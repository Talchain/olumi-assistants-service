import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

const mocks = vi.hoisted(() => ({
  loadPersistedGraphStrict: vi.fn(),
  loadPriorFactsQuietly: vi.fn(),
  commitDirectAnswer: vi.fn(),
  applyFactorValueEdit: vi.fn(),
  emitted: [] as Array<{ event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  loadPersistedGraphStrict: mocks.loadPersistedGraphStrict,
  loadPriorFactsQuietly: mocks.loadPriorFactsQuietly,
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: mocks.commitDirectAnswer,
  computeRequestHash: vi.fn(() => 'sha256:system-event'),
}));

vi.mock('../factor-value-edit.js', () => ({
  applyFactorValueEdit: mocks.applyFactorValueEdit,
}));

// Record every telemetry event while CALLING THROUGH to the real emitter
// (`importOriginal`-spread, never a hand-listed replacement — a `vi.mock`
// factory REPLACES the module, so a hand-listed mock silently drops every
// export added since it was written). The recording is what lets the egress
// assertions below fail by NAME: `boundary.validation` carries the exact Zod
// issues, so a skew RED prints the offending key rather than a bare `false`.
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return {
    ...actual,
    emit: (event: string, payload: Record<string, unknown>) => {
      mocks.emitted.push({ event, payload });
      return actual.emit(event as never, payload as never);
    },
  };
});

import { dispatchSystemEvent } from '../dispatch.js';
import { validateEgress } from '../../../validators/b1.js';
import { TelemetryEvents } from '../../../utils/telemetry.js';
import {
  ModelVersionMutationReceiptV1LocalSchema,
  OlumiResponseWithModelVersionReceiptLocalSchema,
} from '../../model-management/mutation-receipt.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MUTATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const BASE_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Grow revenue' },
    {
      id: 'fac_demand',
      kind: 'factor',
      label: 'Demand',
      observed_state: { value: 0.4, source: 'cee_inference' },
    },
  ],
  edges: [
    {
      from: 'fac_demand',
      to: 'goal_growth',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
  goal_node_id: 'goal_growth',
};

const MUTATED_GRAPH = {
  ...BASE_GRAPH,
  nodes: [
    BASE_GRAPH.nodes[0],
    {
      ...BASE_GRAPH.nodes[1],
      observed_state: { value: 0.7, source: 'user_override' },
    },
  ],
};

const RECEIPT = ModelVersionMutationReceiptV1LocalSchema.parse({
  schema: 'model_version_mutation_receipt.v1',
  scenario_id: SCENARIO_ID,
  mutation_id: MUTATION_ID,
  version_id: VERSION_ID,
  sequence: 2,
  graph: MUTATED_GRAPH,
  full_hash: 'a'.repeat(64),
  hash_algorithm: 'sha256',
  identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1',
  graph_schema_version: 'graph_v3',
  analysis_affecting_hash: 'b'.repeat(64),
  actor: { kind: 'unknown' },
  creation: { kind: 'committed_mutation' },
  source_turn_id: TURN_ID,
  lineage: {
    kind: 'known',
    parent_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    root_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  },
  undo_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  event_id: `model_version_created_mutation_${MUTATION_ID}`,
});

/** A minimal response the egress contract accepts, independent of this slice. */
const MINIMAL_RESPONSE = {
  response_version: 2,
  assistant_text: 'Updated Demand.',
  blocks: [],
  suggested_actions: [],
  insights: [],
  stage_indicator: 'analyse',
} as const;

/**
 * The Zod issues the REAL egress validator reported for the last egress call.
 *
 * Read from the `boundary.validation` telemetry event rather than reconstructed,
 * so the assertion is about what the validator ACTUALLY did on the production
 * path — and so a schema-skew failure REDs with the offending key spelled out
 * (`Unrecognized key(s) in object: 'model_version_receipt'`) instead of a bare
 * boolean that tells the next lane nothing.
 */
function lastEgressIssues(): unknown[] {
  const events = mocks.emitted.filter(
    (e) =>
      e.event === TelemetryEvents.BoundaryValidation &&
      e.payload.direction === 'egress',
  );
  const last = events[events.length - 1];
  if (!last) return [{ message: 'no egress boundary.validation event was emitted' }];
  return (last.payload.issues as unknown[] | undefined) ?? [];
}

describe('system-event atomic model-version receipt egress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.emitted.length = 0;
    mocks.loadPersistedGraphStrict.mockResolvedValue(BASE_GRAPH);
    mocks.loadPriorFactsQuietly.mockResolvedValue([]);
    mocks.applyFactorValueEdit.mockResolvedValue({
      kind: 'mutated',
      response: {
        response_version: 2,
        assistant_text: 'Updated Demand.',
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'analyse',
      },
      mutatedGraph: MUTATED_GRAPH,
      handlerFacts: [],
      graph: MUTATED_GRAPH,
      baseGraph: BASE_GRAPH,
    });
    mocks.commitDirectAnswer.mockImplementation(async (response) => ({
      response: { ...response, model_version_receipt: RECEIPT },
      performed: true,
      persisted_row_id: 'turn-row',
      modelVersionReceipt: {},
      graphPersisted: true,
      pendingLifecycle: {
        priorCount: 0,
        freshCount: 0,
        carriedCount: 0,
        droppedCount: 0,
      },
      persistedAnalysisGraphHash: '0123456789abcdef',
      persistedGraph: MUTATED_GRAPH,
    }));
  });

  it('returns the exact committed receipt after factor response reconstruction', async () => {
    const payload = {
      kind: 'system_event',
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      stage: 'analyse',
      event: {
        kind: 'factor_value_edit',
        target_id: 'fac_demand',
        value: 0.7,
        field: 'value',
      },
    } as unknown as SystemEventTurnPayload;

    const result = await dispatchSystemEvent({ payload, requestId: 'req-receipt' });
    const wire = OlumiResponseWithModelVersionReceiptLocalSchema.parse(result.response);

    expect(result.commitPerformed).toBe(true);
    expect(wire.model_version_receipt).toEqual(RECEIPT);
    expect(mocks.commitDirectAnswer).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // THE PUBLISHED-CONTRACT SEAM.
  //
  // ⚠ WHY THESE EXIST, so the gap they close is not reopened by a tidy-up. The
  // test above is named `-egress` and passed throughout the window in which a
  // signed-in draft turn returned an `EGRESS_CONTRACT_VIOLATION` envelope to
  // every user, because it validates against
  // `OlumiResponseWithModelVersionReceiptLocalSchema` — a LOCAL
  // `OlumiResponseSchema.extend({ model_version_receipt })`. That local extend
  // is precisely the workaround for the pin not carrying the field, so the
  // guard was structurally incapable of observing the skew it was named for:
  // it asked "does CEE's own extended shape admit this receipt?" while
  // production asks "does the VENDORED published contract admit it?". Two
  // questions, similar names, opposite answers.
  //
  // These cases put the REAL `validateEgress` (`src/validators/b1.ts`) — the
  // exact function `route-v2.ts:1096` calls — over the response, so the pinned
  // contract is the authority and a future pin that drops the field REDs here
  // rather than on a user's screen.
  // -------------------------------------------------------------------------
  describe('the REAL egress validator over the PINNED published contract', () => {
    it('accepts a response carrying model_version_receipt', () => {
      const egress = validateEgress(
        { ...MINIMAL_RESPONSE, model_version_receipt: RECEIPT },
        'req-egress-receipt',
      );

      expect(lastEgressIssues()).toEqual([]);
      expect(egress.ok).toBe(true);
    });

    it('carries every receipt field through validation unchanged EXCEPT one known rewrite', () => {
      // ⚠⚠ A KNOWN, MEASURED GAP, PINNED RATHER THAN HIDDEN — read this before
      // "simplifying" the assertion below.
      //
      // Egress does not return the object it was handed: `route-v2.ts:1096`
      // sends `egress.value`, which is Zod's REBUILT object. Measured at this
      // pin, that rebuild applies the graph contract's own default —
      // `edge_type: EdgeType.optional().default('directed')`
      // (schemas `src/graph.ts:318`) — to every edge that omitted the key. So a
      // receipt whose `graph` had no `edge_type` ships with one injected.
      //
      // THAT MOVES THE HASH. Measured with CEE's own `computeGraphIdentityHash`
      // and a discriminating contrast control: the same graph hashes
      // 26a8d97d… without `edge_type` and b833e888… with `edge_type:
      // 'directed'` (and a third value for 'undirected', so the probe is
      // genuinely discriminating, not blind). `full_hash` is computed over the
      // PERSISTED bytes — `commit.ts` deliberately stopped substituting
      // `parsed.data` "so the carrier's hashes describe the persisted bytes by
      // construction rather than by coincidence" — so a client that recomputes
      // `H(receipt.graph)` and compares gets a MISMATCH. That is the C8-A
      // hash/payload fork reappearing one seam downstream, at egress.
      //
      // WHY IT IS PINNED HERE AND NOT FIXED HERE. It is LATENT, not live: swept
      // at UI `323b195a` with firing contrast controls (`analysis_ready` 881,
      // `draft_graph` 227), `model_version_receipt` has ZERO readers and
      // `full_hash` has ZERO readers, so nothing verifies the hash today and the
      // blast radius is zero by construction. It also predates this change —
      // schemas `src/graph.ts` is BYTE-IDENTICAL between 0.48.0 and 0.50.0, so
      // the default is not introduced by the pin bump; the bump merely makes a
      // previously unreachable payload reachable. Fixing it means changing what
      // egress is allowed to rewrite, which is a design decision with an owner,
      // not a quick edit inside a P0.
      //
      // The assertion is written as an EXACT known-rewrite set so the suite
      // stays green for the RIGHT reason and REDs if the set GROWS (egress
      // starts rewriting something else) or SHRINKS (someone fixes the fork and
      // must then delete this note).
      const egress = validateEgress(
        { ...MINIMAL_RESPONSE, model_version_receipt: RECEIPT },
        'req-egress-passthrough',
      );

      expect(egress.ok).toBe(true);
      if (!egress.ok) return;
      const out = (egress.value as { model_version_receipt?: Record<string, unknown> })
        .model_version_receipt;

      // Every field other than `graph` survives byte-for-byte.
      const { graph: _outGraph, ...outRest } = out ?? {};
      const { graph: _inGraph, ...inRest } = RECEIPT as Record<string, unknown>;
      expect(outRest).toEqual(inRest);

      // `graph` differs ONLY by the contract's own `edge_type` default.
      const outGraph = out?.graph as { nodes: unknown[]; edges: Array<Record<string, unknown>> };
      expect(outGraph.nodes).toEqual(MUTATED_GRAPH.nodes);
      expect(outGraph.edges).toEqual(
        MUTATED_GRAPH.edges.map((e) => ({ ...e, edge_type: 'directed' })),
      );
    });

    it('preserves ADDITIVE nested graph fields (they are not stripped)', () => {
      // The passthrough half of the story, pinned separately from the default
      // half above: an additive field on a nested node SURVIVES egress. This is
      // what stops the fork being worse than measured — the rebuild adds a
      // default, it does not also delete unknown keys.
      const richGraph = {
        ...MUTATED_GRAPH,
        nodes: [
          MUTATED_GRAPH.nodes[0],
          { ...MUTATED_GRAPH.nodes[1], additive_nested_field: 'survives' },
        ],
      };

      const egress = validateEgress(
        { ...MINIMAL_RESPONSE, model_version_receipt: { ...RECEIPT, graph: richGraph } },
        'req-egress-verbatim',
      );

      expect(egress.ok).toBe(true);
      if (!egress.ok) return;
      const graph = (
        egress.value as { model_version_receipt?: { graph?: { nodes?: unknown[] } } }
      ).model_version_receipt?.graph;
      expect((graph?.nodes?.[1] as Record<string, unknown>).additive_nested_field).toBe(
        'survives',
      );
    });

    it('binds the DISPATCHED response — not a hand-built twin — to the real validator', async () => {
      // Identity, not resemblance: the object under test is the one
      // `dispatchSystemEvent` actually produced. A hand-built fixture can drift
      // from what the production path emits and then certify a shape nobody
      // ships. This is the case that would have caught the live defect.
      const payload = {
        kind: 'system_event',
        scenario_id: SCENARIO_ID,
        turn_id: TURN_ID,
        stage: 'analyse',
        event: {
          kind: 'factor_value_edit',
          target_id: 'fac_demand',
          value: 0.7,
          field: 'value',
        },
      } as unknown as SystemEventTurnPayload;

      const result = await dispatchSystemEvent({
        payload,
        requestId: 'req-dispatch-egress',
      });
      const egress = validateEgress(result.response, 'req-dispatch-egress');

      expect(lastEgressIssues()).toEqual([]);
      expect(egress.ok).toBe(true);
    });

    // --- OPPOSITE-DIRECTION TWINS ------------------------------------------
    // A fix that made the receipt admissible must not have made the egress
    // validator permissive. Each of these must stay RED-for-the-right-reason
    // at every pin: they are what stops this suite from passing by fail-open.

    it('still accepts a response with NO receipt at all (absence stays valid)', () => {
      const egress = validateEgress({ ...MINIMAL_RESPONSE }, 'req-egress-absent');

      expect(lastEgressIssues()).toEqual([]);
      expect(egress.ok).toBe(true);
    });

    it('still REJECTS a genuinely unknown top-level key', () => {
      const egress = validateEgress(
        { ...MINIMAL_RESPONSE, definitely_not_a_contract_field: 'junk' },
        'req-egress-unknown',
      );

      expect(egress.ok).toBe(false);
      if (egress.ok) return;
      expect(egress.fallback.blocks[0]).toMatchObject({
        type: 'error',
        error_code: 'EGRESS_CONTRACT_VIOLATION',
      });
    });

    it('still REJECTS a structurally malformed response', () => {
      const { assistant_text: _dropped, ...missingRequired } = MINIMAL_RESPONSE;
      const egress = validateEgress(missingRequired, 'req-egress-malformed');

      expect(egress.ok).toBe(false);
    });

    it('still REJECTS a receipt whose own shape is invalid, FOR THE RIGHT REASON', () => {
      // The field being admissible must not mean its CONTENTS are unchecked —
      // otherwise the bump would trade a visible failure for a confident wrong
      // one, which is the trade this fix must not make.
      //
      // ⚠ THE REASON IS ASSERTED, NOT JUST THE VERDICT. Measured at the pristine
      // 0.48.0 pin, a bare `expect(egress.ok).toBe(false)` PASSED here — but on
      // `unrecognized_keys` at the ROOT, i.e. because the pin rejected the whole
      // field, never because it inspected the receipt. That is a guard agreeing
      // with itself: it would keep passing under a pin that cannot validate
      // receipts at all. Binding to the ISSUE PATH makes it fail whenever the
      // rejection stops being about the receipt's contents.
      const egress = validateEgress(
        {
          ...MINIMAL_RESPONSE,
          model_version_receipt: { ...RECEIPT, schema: 'not_a_receipt_schema' },
        },
        'req-egress-bad-receipt',
      );

      expect(egress.ok).toBe(false);
      const paths = (lastEgressIssues() as Array<{ path?: string }>).map((i) => i.path ?? '');
      expect(paths.some((p) => p.startsWith('model_version_receipt'))).toBe(true);
    });
  });
});
