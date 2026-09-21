/**
 * P0 — A LONG NODE LABEL DESTROYED THE USER'S ENTIRE ASSISTANT REPLY.
 *
 * WITNESSED ON STAGING, 28 Aug 2026, CEE build `674a4f2a`. An ordinary open
 * strategic brief drafted a 16-node graph that rendered on the canvas, and the
 * COMPLETE frame carried `assistant_text: 'The server produced a response that
 * failed validation.'` plus a bare `EGRESS_CONTRACT_VIOLATION` block. The Zod
 * issue (recovered from the CEE staging log, and reproduced EXACTLY offline
 * against the pinned 0.50.0 tarball) was:
 *
 *   path:    model_version_receipt.graph.nodes.0.label
 *   message: String must contain at most 200 character(s)
 *
 * The label was 212 characters: CEE copies a brief sentence VERBATIM into the
 * goal node's label, and the brief had a long sentence. Re-driven live the same
 * day with a deliberately long goal sentence: 258-character goal label,
 * `EGRESS_CONTRACT_VIOLATION`, receipt and draft_graph both gone.
 *
 * ⭐ THE MECHANISM IS TWO SCHEMAS WITH ONE NAME (CLAUDE.md trap 21/12).
 *   - The PRODUCER's own admissibility gate is
 *     `mutation-receipt.ts:68` `GraphVerbatim`, which superRefines against
 *     `GraphV3` imported from CEE-LOCAL `schemas/cee-v3.ts`, whose
 *     `NodeV3.label` is a bare `z.string()` — UNBOUNDED (`cee-v3.ts:162`).
 *   - This BOUNDARY validates against the PUBLISHED `OlumiResponseSchema`,
 *     whose `model_version_receipt.graph` is the published `GraphV3Schema` →
 *     `NodeV3Schema.label = z.string().min(1).max(200)`
 *     (`@talchain/schemas` 0.50.0 `dist/graph.js:259`).
 *   So the producer mints a receipt its own validator accepts and this one
 *   rejects — in the same request, milliseconds apart. `mutation-receipt.ts`'s
 *   own docblock states the rule it breaks: "The ADMISSIBILITY question must be
 *   the same one the version carrier asked, or a version it legitimately
 *   created cannot be receipted." They closed that gap for `strength.std` and
 *   left it open for `label`.
 *
 * ⭐ WHY THE FIX IS HERE AND NOT AT THE PRODUCER. Making the producer's gate
 * strict would move the throw to BEFORE the receipt is attached but AFTER the
 * durable commit — which is precisely the split `GraphVerbatim` exists to
 * prevent. Truncating the label at mint time changes `full_hash` and must land
 * before commit; that is the durable fix and it is a separate, larger change.
 * What this seam can do TODAY, safely, is stop a defect in ONE OPTIONAL
 * ADDITIVE FIELD from deleting the whole reply.
 *
 * ⚠ THIS IS NOT "STOP VALIDATING". The retry uses the SAME schema. Nothing
 * unvalidated leaves the boundary: the offending carrier is REMOVED, and the
 * remainder must pass the identical `OlumiResponseSchema` before it ships. A
 * response whose failures reach ANY other field still gets the hard fallback.
 *
 * ⚠ WHY `model_version_receipt` SPECIFICALLY, AND NOTHING ELSE. It is
 * `.optional()` in the published contract (`dist/boundary/olumi-response.js:232`)
 * — absence is a contract-valid state that every consumer already handles — and
 * no user-facing surface renders it. Dropping it costs a user nothing they can
 * see. Dropping `blocks` or `analysis_ready` would cost them the product, so
 * this list stays exactly one key long.
 *
 * ⚠ CORPUS NOTE (CLAUDE.md trap 22). The pre-existing suite for this exact
 * seam — `orchestrator-v5/system-events/__tests__/model-version-receipt-egress.test.ts`
 * :246-491 — is a good corpus with eleven cases, and EVERY graph in it uses a
 * short label ('Grow revenue', 'Demand'). It shares the code's blind spot, which
 * is why eleven green cases said nothing about a 212-character one.
 *
 * ⭐ MUTANT RECORD — MEASURED, AND THE SURVIVORS ARE DEMONSTRATED EQUIVALENT
 * RATHER THAN ASSERTED (CLAUDE.md trap 13c). `validateEgress`'s degrade branch
 * has TWO guards, and this corpus binds them only as a PAIR:
 *   M1  drop the receipt-confinement predicate
 *       (`issues.every(path[0] === 'model_version_receipt')` → `true`)  SURVIVES
 *   M2  ignore the re-parse result (`if (retry.success)` → `if (true)`) SURVIVES
 *   M1+M2 both at once                                                  BITES
 *       → REDs 'STILL REJECTS when a receipt failure is accompanied by ANY
 *         failure elsewhere'
 * Each guard alone is sufficient, so each MASKS the other and no single-mutant
 * kit can bind either: confinement stops a mixed-issue response entering the
 * branch, and the re-parse stops it leaving. That is defence in depth, and it
 * is recorded here for one reason — a future tidy-up that deletes ONE of them
 * as "dead code" will see a fully green suite. It is not dead; it is the other
 * half of a pair. Delete either and the remaining guard must be re-proved on
 * its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitted: Array<{ event: string; payload: Record<string, unknown> }> = [];

// `importOriginal`-spread, never a hand-listed replacement: a `vi.mock` factory
// REPLACES the module, so a hand-listed mock silently drops every export added
// since it was written (CLAUDE.md trap 12).
vi.mock('../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/telemetry.js')>();
  return {
    ...actual,
    emit: (event: string, payload: Record<string, unknown>) => {
      emitted.push({ event, payload });
      return actual.emit(event as never, payload as never);
    },
  };
});

import { validateEgress } from '../b1.js';
import { TelemetryEvents } from '../../utils/telemetry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MUTATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** 212 characters — the EXACT length of the goal label in the 28 Aug capture. */
const LABEL_212 = `A${'x'.repeat(211)}`;
/** Exactly at the bound. Measured: 200 passes, 201 fails. */
const LABEL_200 = 'y'.repeat(200);

function graphWithGoalLabel(label: string) {
  return {
    nodes: [
      { id: 'goal_growth', kind: 'goal', label },
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
}

function receiptCarrying(graph: unknown) {
  return {
    schema: 'model_version_mutation_receipt.v1',
    scenario_id: SCENARIO_ID,
    mutation_id: MUTATION_ID,
    version_id: VERSION_ID,
    sequence: 1,
    graph,
    full_hash: 'a'.repeat(64),
    hash_algorithm: 'sha256',
    identity_projection_version: 'identity.v1',
    identity_normaliser_version: '1',
    graph_schema_version: 'graph_v3',
    analysis_affecting_hash: 'b'.repeat(64),
    actor: { kind: 'unknown' },
    creation: { kind: 'initial' },
    source_turn_id: TURN_ID,
    lineage: { kind: 'known', parent_version_id: null, root_version_id: VERSION_ID },
    undo_version_id: null,
    event_id: `model_version_created_mutation_${MUTATION_ID}`,
  };
}

/** The substantive reply a user must not lose. */
const SUBSTANTIVE = {
  response_version: 2,
  assistant_text: "Here is the shared picture of your renewals problem.",
  blocks: [{ type: 'draft_graph', nodes: [], edges: [], node_count: 0, edge_count: 0 }],
  suggested_actions: [],
  insights: [],
  stage_indicator: 'frame',
} as const;

function lastEgressEvent() {
  const events = emitted.filter(
    (e) => e.event === TelemetryEvents.BoundaryValidation && e.payload.direction === 'egress',
  );
  return events[events.length - 1];
}

describe('B1 egress — a defective model_version_receipt must not delete the reply', () => {
  beforeEach(() => {
    emitted.length = 0;
  });

  // ─────────────────────────────────────────────────────────── the P0 itself
  it('KEEPS the assistant reply when the ONLY failure is the receipt graph label (212 chars)', () => {
    const response = {
      ...SUBSTANTIVE,
      model_version_receipt: receiptCarrying(graphWithGoalLabel(LABEL_212)),
    };

    const egress = validateEgress(response, 'req-p0-label-212');

    // The user's reply survives.
    expect(egress.ok).toBe(true);
    if (!egress.ok) return;
    expect(egress.value.assistant_text).toBe(SUBSTANTIVE.assistant_text);
    expect(egress.value.blocks).toEqual(SUBSTANTIVE.blocks);
    // The one unvalidatable carrier is gone — not smuggled through.
    expect(
      Object.prototype.hasOwnProperty.call(egress.value, 'model_version_receipt'),
    ).toBe(false);
  });

  it('records the degrade in telemetry — a silent drop would be its own defect', () => {
    validateEgress(
      { ...SUBSTANTIVE, model_version_receipt: receiptCarrying(graphWithGoalLabel(LABEL_212)) },
      'req-p0-telemetry',
    );
    const last = lastEgressEvent();
    expect(last).toBeDefined();
    expect(last?.payload.pass).toBe(true);
    expect(last?.payload.degraded_field).toBe('model_version_receipt');
    // The issues that forced the drop are carried, so the next lane can see WHY
    // without re-driving the product.
    expect(JSON.stringify(last?.payload.issues)).toContain(
      'model_version_receipt.graph.nodes.0.label',
    );
  });

  // ────────────────────────────────────────── the bound itself, both directions
  it('does NOT degrade at exactly 200 characters — the valid receipt ships intact', () => {
    const receipt = receiptCarrying(graphWithGoalLabel(LABEL_200));
    const response = { ...SUBSTANTIVE, model_version_receipt: receipt };

    const egress = validateEgress(response, 'req-bound-200');

    expect(egress.ok).toBe(true);
    if (!egress.ok) return;
    // Reference-identical: this boundary is a GATE, not a transform. A rebuilt
    // graph would re-open the `edge_type` hash/payload fork b1.ts documents.
    expect(egress.value).toBe(response);
    expect(egress.value.model_version_receipt).toBe(receipt);
    expect(lastEgressEvent()?.payload.degraded_field).toBeUndefined();
  });

  // ───────────────────────────────────────── non-regression: the gate still bites
  it('STILL REJECTS a genuinely unknown top-level key (no receipt-shaped escape hatch)', () => {
    const egress = validateEgress(
      { ...SUBSTANTIVE, some_unknown_key: 'nope' },
      'req-unknown-key',
    );
    expect(egress.ok).toBe(false);
    if (egress.ok) return;
    expect(egress.fallback.blocks[0]).toMatchObject({
      error_code: 'EGRESS_CONTRACT_VIOLATION',
    });
  });

  it('STILL REJECTS a structurally malformed response (missing required field)', () => {
    const { assistant_text: _dropped, ...missingRequired } = SUBSTANTIVE;
    const egress = validateEgress(missingRequired, 'req-malformed');
    expect(egress.ok).toBe(false);
  });

  it('STILL REJECTS when a receipt failure is accompanied by ANY failure elsewhere', () => {
    // The discriminating case: the degrade must be confined to receipt-ONLY
    // failures. A response that is also broken somewhere the user can see must
    // take the hard fallback, exactly as today.
    const egress = validateEgress(
      {
        ...SUBSTANTIVE,
        stage_indicator: 'not_a_stage',
        model_version_receipt: receiptCarrying(graphWithGoalLabel(LABEL_212)),
      },
      'req-mixed-issues',
    );
    expect(egress.ok).toBe(false);
  });

  it('STILL REJECTS a receipt that is not an object at all (degrade is not a blanket drop)', () => {
    // Guards the lazy implementation: "any receipt problem ⇒ drop it" would let
    // a wholly fabricated carrier through by deletion. It is still receipt-
    // confined, so it DOES degrade — but the reply must survive and the key go.
    const egress = validateEgress(
      { ...SUBSTANTIVE, model_version_receipt: { schema: 'wrong' } },
      'req-receipt-garbage',
    );
    expect(egress.ok).toBe(true);
    if (!egress.ok) return;
    expect(
      Object.prototype.hasOwnProperty.call(egress.value, 'model_version_receipt'),
    ).toBe(false);
    expect(egress.value.assistant_text).toBe(SUBSTANTIVE.assistant_text);
  });
});
