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
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
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

/**
 * The REAL identity of `MUTATED_GRAPH`, computed by the same function
 * `commit.ts` uses to stamp `graph_identity_hash` on the persisted row.
 *
 * `RECEIPT.full_hash` is a placeholder (`'a'.repeat(64)`), which is fine for
 * the shape assertions above but CANNOT express the receipt's actual promise.
 * The promise is `H(receipt.graph) === receipt.full_hash`, and a placeholder
 * hash makes that unaskable.
 */
const MUTATED_GRAPH_IDENTITY = computeGraphIdentityHash(
  MUTATED_GRAPH as never,
)?.value;

/** A receipt whose `full_hash` is the TRUE hash of the graph it carries. */
const SELF_CONSISTENT_RECEIPT = ModelVersionMutationReceiptV1LocalSchema.parse({
  ...RECEIPT,
  graph: MUTATED_GRAPH,
  full_hash: MUTATED_GRAPH_IDENTITY,
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

    it('rewrites NOTHING: the wire object is the object egress was handed', () => {
      // ⭐ THE KNOWN-REWRITE SET IS NOW EMPTY, AND THIS PIN STILL BITES IN BOTH
      // DIRECTIONS. It previously asserted an EXACT set of one — the graph
      // contract's `edge_type: EdgeType.optional().default('directed')` injected
      // by Zod's rebuild — and was written to RED if that set GREW or SHRANK.
      // It SHRANK, deliberately: `validateEgress` now returns the caller's
      // object instead of `parsed.data`, so B1 is a gate rather than a
      // transform. This RED was the instrument working exactly as its author
      // intended, and the note is updated rather than deleted so the next lane
      // inherits the reason.
      //
      // ⚠ THE ASSERTIONS ARE DELIBERATELY TWO, AND THEY ARE NOT REDUNDANT.
      //   (1) `toEqual` REDs if egress adds, drops or changes ANY value — the
      //       rewrite set growing again.
      //   (2) `toBe` REDs if egress REBUILDS AT ALL, even into a value-identical
      //       object. That is the structural guarantee, and it is the one that
      //       matters: the fork this fix closes was invisible for two schema
      //       releases precisely because a rebuild was value-identical until a
      //       `.default()` landed inside it. Value equality today is not
      //       evidence that a rebuild is safe tomorrow.
      const response = { ...MINIMAL_RESPONSE, model_version_receipt: RECEIPT };

      // PIN THE PRECONDITION IN-TEST. If the fixture's edges ever carried
      // `edge_type` themselves, an egress that re-injected it would be
      // indistinguishable from one that did not, and this test would pass
      // vacuously — a guard agreeing with itself.
      for (const edge of MUTATED_GRAPH.edges) {
        expect(edge).not.toHaveProperty('edge_type');
      }

      const egress = validateEgress(response, 'req-egress-passthrough');

      expect(egress.ok).toBe(true);
      if (!egress.ok) return;

      expect(egress.value).toEqual(response);
      expect(egress.value).toBe(response);
    });

    it('ships a receipt a client can VERIFY: H(wire.graph) === wire.full_hash', () => {
      // ⭐ THE INVARIANT THE WHOLE RECEIPT EXISTS FOR, ASSERTED ON THE EGRESS
      // OUTPUT — the bytes a user's client actually receives.
      //
      // ⚠ WHY THIS PIN AND NOT THE EXISTING ONE. CI was structurally blind to
      // this. `atomic-model-version-commit.test.ts` asserts the same invariant,
      // but it takes its "wire" from CEE's LOCAL `GraphVerbatim` carrier
      // (`mutation-receipt.ts`), which is an identity function by construction —
      // so it can only ever confirm that an identity function is an identity
      // function. Production ships `egress.value` from `validateEgress`
      // (`route-v2.ts:1096`), and NOTHING computed this hash over THAT object.
      // Right invariant, wrong schema: the two questions have similar names and
      // opposite answers.
      //
      // MEASURED at the wire before this pin existed (golden-journey capture
      // `20260826T212322Z-fresh-extended-507050`, three independent receipts —
      // T1_DRAFT 15/15 edges, T4_EDIT 15/15, T5C_CONFIRM 19/19): every receipt
      // shipped `edge_type: 'directed'` on every edge while the cold read of
      // the same scenario carried it on ZERO, and removing `edge_type` — and
      // nothing else — reproduced each shipped `full_hash` EXACTLY. A client
      // recomputing the hash concluded the server lied, on every turn.
      const egress = validateEgress(
        { ...MINIMAL_RESPONSE, model_version_receipt: SELF_CONSISTENT_RECEIPT },
        'req-egress-verifiable',
      );

      expect(egress.ok).toBe(true);
      if (!egress.ok) return;
      const wireReceipt = (
        egress.value as { model_version_receipt?: { graph?: unknown; full_hash?: string } }
      ).model_version_receipt;

      // ⛔ THE WIRE MUST ACTUALLY CARRY A RECEIPT, OR THIS TEST VERIFIES NOTHING.
      //
      // ⚠ FOUND BY INDEPENDENT REVIEW, IN THE PIN THIS FILE OFFERS AS CLOSING A
      // STRUCTURAL CI BLIND SPOT. Both sides of the hash comparison below are
      // optional-chained: `computeGraphIdentityHash(undefined)` returns `null`,
      // so `?.value` is `undefined`; `wireReceipt?.full_hash` is `undefined`;
      // and `expect(undefined).toBe(undefined)` PASSES. So a receipt-free
      // egress would take this test GREEN while shipping nothing to verify —
      // and a receipt-free response is a legitimate reachable state, pinned by
      // a sibling case in this very file.
      //
      // REPRODUCED before this line was added: removing `model_version_receipt`
      // from the egress input left the suite at 10/10 PASSED. With this line,
      // that same mutation REDs on `expected undefined to be defined`.
      //
      // The two precondition pins below guard the FIXTURE. This one guards the
      // WIRE. They are not interchangeable.
      expect(wireReceipt).toBeDefined();

      // PIN THE PRECONDITION IN-TEST: this assertion is only meaningful if the
      // fixture's declared hash really is the hash of the fixture's graph.
      // Without this, a fixture that silently stopped being self-consistent
      // would make the test below pass or fail for reasons unrelated to egress.
      expect(MUTATED_GRAPH_IDENTITY).toBeDefined();
      expect(computeGraphIdentityHash(MUTATED_GRAPH as never)?.value).toBe(
        SELF_CONSISTENT_RECEIPT.full_hash,
      );

      expect(computeGraphIdentityHash(wireReceipt?.graph as never)?.value).toBe(
        wireReceipt?.full_hash,
      );
    });

    it('preserves ADDITIVE nested graph fields (they are not stripped)', () => {
      // The passthrough half of the story, pinned separately from the default
      // half above: an additive field on a nested node SURVIVES egress.
      //
      // ⚠ CORRECTED. This comment used to end "the rebuild adds a default, it
      // does not also delete unknown keys" — **that was not universally true**,
      // and it understated the case for the fix rather than overstating it.
      // Derived at the 0.50.0 bytes (`dist/graph.js`): 8 `z.object({` sites, 7
      // `.passthrough()` calls, so there are EXACTLY TWO strip points, and an
      // independent reviewer's schema-tree walk over 622 paths found the same
      // two:
      //   1. `StrengthSchema` (graph.js:274-277) — a bare `z.object({mean, std})`,
      //      so additive keys inside `edge.strength` were deleted;
      //   2. `nodes[].state_space.range` (graph.js:180-183) — an inner anonymous
      //      `z.object({min, max})`. `StateSpaceSchema` itself IS passthrough,
      //      which is exactly why this one hides.
      // Both were LATENT forks of the same hash/payload class as the default:
      // silent deletion from the wire while `full_hash` describes the persisted
      // bytes. Returning the caller's object CLOSES BOTH — a strictly better
      // result than "the rebuild only added a default".
      // Latency, measured: 11,902 persisted `strength` objects carry ZERO
      // additive keys today, so neither had a live instance.
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
      //
      // ⭐ AMENDED 28 Aug 2026 (P0 egress degrade). THE GUARANTEE IS UNCHANGED;
      // THE ASSERTION USED TO CONFLATE TWO QUESTIONS AND NOW SEPARATES THEM.
      //   Q1 "does an invalid receipt reach the client?"  → must stay NO.
      //   Q2 "does an invalid receipt destroy the reply?" → must become NO.
      // `expect(egress.ok).toBe(false)` answered Q1 only by INFERENCE from total
      // rejection — it never checked the receipt was absent. That conflation IS
      // the P0: a 212-character node label (valid to the producer's own
      // CEE-local `cee-v3.ts` GraphV3, invalid to the published `max(200)`)
      // deleted a user's entire assistant reply on staging. `validateEgress`
      // now DROPS a receipt-confined failure and ships the rest.
      // Asserting the receipt's ABSENCE is strictly stronger than the old
      // verdict check for this test's own stated purpose, and the issue-path
      // assertion below — the half its docblock calls load-bearing — is intact.
      const egress = validateEgress(
        {
          ...MINIMAL_RESPONSE,
          model_version_receipt: { ...RECEIPT, schema: 'not_a_receipt_schema' },
        },
        'req-egress-bad-receipt',
      );

      // Q1: the invalid receipt does not reach the wire — asserted directly.
      expect(egress.ok).toBe(true);
      if (!egress.ok) return;
      expect(
        Object.prototype.hasOwnProperty.call(egress.value, 'model_version_receipt'),
      ).toBe(false);
      // Q2: and the reply the user came for survives.
      expect(egress.value.assistant_text).toBe(MINIMAL_RESPONSE.assistant_text);
      // Unchanged: the rejection was about the RECEIPT's contents, not the root.
      const paths = (lastEgressIssues() as Array<{ path?: string }>).map((i) => i.path ?? '');
      expect(paths.some((p) => p.startsWith('model_version_receipt'))).toBe(true);
    });
  });
});
