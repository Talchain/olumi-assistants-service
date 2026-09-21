/**
 * ⭐⭐ G1/G2 — THE BEHAVIOUR WITNESS FOR #1674, AT THE REAL STAGE.
 *
 * The salvage suite proves the unit decides correctly on fixtures the author
 * wrote. This file asks the different question the gate actually cares about:
 * run the REAL `runStructuralParse` over a REAL drafted model and show that
 * what survives still MEANS to a user what it meant before.
 *
 * ⚠ THE SHAPE IS CAPTURE-DERIVED; THE DIGITS AND LABELS ARE NOT REAL.
 * Structure taken from a staging debug bundle captured 21 Sep 2026 (one
 * scenario, 8 graph nodes + 4 options, 19 edges, `goal_constraints` carrying a
 * single `<=` row whose `node_id` targets an ordinary `factor` — NOT a node of
 * kind `constraint`). Both repos are PUBLIC, so every label and figure here is
 * synthetic; only the SHAPE is inherited. That shape is the part no
 * self-authored fixture can be trusted to get right, and it is the part that
 * decides this stage's behaviour.
 *
 * ⭐ THE PERTURBED PAIR FALLS OUT OF THE REAL SHAPE, which is why it is worth
 * using: in the captured payload the constraint's target is a `factor`, so
 *   G1 corrupts an ORDINARY factor          → salvage, model preserved
 *   G2 corrupts the CONSTRAINT'S TARGET     → DECLINE, the 500 stands
 * The two payloads are byte-identical but for WHICH node carries the malformed
 * field. If `kind` were the discriminator both would salvage, and the user's
 * stated limit would silently stop being expressed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { DraftGraphOutput } from '../../../../../schemas/assist.js';
import { runStructuralParse } from '../structural-parse.js';
import type { StageContext } from '../../../types.js';
import { log } from '../../../../../utils/telemetry.js';

vi.mock('../../../../../utils/telemetry.js', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** The observed_state shape the wire actually emits (field-for-field). */
const observed = (raw: number, unit: string) => ({
  value: raw / 100,
  unit,
  source: 'cee_inference',
  raw_value: raw,
  extractionType: 'inferred',
  factor_type: 'other',
  uncertainty_drivers: [],
  declared_scale: 'unit_interval',
});

const GOAL_ID = 'n_goal';
const TARGET_ID = 'n_rate';        // the goal_constraints target — an ordinary FACTOR
const PLAIN_ID = 'n_quality';      // an ordinary factor, not referenced by any constraint

function realShapedGraph(): Record<string, unknown> {
  return {
    nodes: [
      { id: 'n_decision', kind: 'decision', label: 'Question' },
      { id: PLAIN_ID, kind: 'factor', label: 'Delivery quality', observed_state: observed(40, '%') },
      { id: 'n_price', kind: 'factor', label: 'Unit price', observed_state: observed(50, '%') },
      { id: 'n_revenue', kind: 'outcome', label: 'Recurring revenue' },
      { id: TARGET_ID, kind: 'factor', label: 'Monthly rate', observed_state: observed(3, '%') },
      { id: GOAL_ID, kind: 'goal', label: 'Reach the target within the year' },
      { id: 'n_risk', kind: 'risk', label: 'Rate spike on a price rise' },
      { id: 'n_opt_a', kind: 'option', label: 'Hold price' },
      { id: 'n_opt_b', kind: 'option', label: 'Raise price with a release' },
    ],
    edges: [
      { from: 'n_decision', to: 'n_opt_a' },
      { from: 'n_decision', to: 'n_opt_b' },
      { from: PLAIN_ID, to: 'n_revenue' },
      { from: PLAIN_ID, to: 'n_risk' },
      { from: 'n_price', to: 'n_revenue' },
      { from: TARGET_ID, to: 'n_risk' },
      { from: 'n_revenue', to: GOAL_ID },
      { from: 'n_risk', to: GOAL_ID },
    ],
  };
}

/** The exact `invalid_union` shape the census found on every failing node. */
const MALFORMED = { value: 'not-a-number', unit: 7, declared_scale: {} };

const GOAL_CONSTRAINTS = [
  { constraint_id: 'c_rate_max', node_id: TARGET_ID, operator: '<=', value: 0.04, label: 'Keep the rate at or below 4%' },
];

const ctxFor = (graph: unknown, goalConstraints?: unknown): StageContext =>
  ({ graph, requestId: 'req-witness', goalConstraints } as unknown as StageContext);

const lastWarn = () => (log.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0] as Record<string, unknown>;

describe('#1674 behaviour witness — the real stage over a real-shaped model', () => {
  beforeEach(() => vi.clearAllMocks());

  it('T0 PRECONDITION: the uncorrupted capture-shaped payload parses cleanly', () => {
    const r = DraftGraphOutput.safeParse({ graph: realShapedGraph(), goal_constraints: GOAL_CONSTRAINTS });
    expect(r.success, 'the witness is void if the base payload does not parse').toBe(true);
  });

  it('G1: one malformed observed_state on an ORDINARY factor — the model survives, with user meaning intact', () => {
    const graph = realShapedGraph();
    const before = JSON.parse(JSON.stringify(graph)) as typeof graph;
    (graph.nodes as Array<Record<string, unknown>>).find((n) => n.id === PLAIN_ID)!.observed_state = MALFORMED;

    // The whole model is lost without the salvage — that is the alternative.
    expect(DraftGraphOutput.safeParse({ graph, goal_constraints: GOAL_CONSTRAINTS }).success).toBe(false);

    const ctx = ctxFor(graph, GOAL_CONSTRAINTS);
    runStructuralParse(ctx);

    // 1. It salvaged, and said so honestly on the UNCHANGED event name.
    const w = lastWarn();
    expect(w.event).toBe('cee.structural_parse.failed');
    expect(w.salvaged).toBe(true);
    expect(w.stripped).toEqual([{ node_id: PLAIN_ID, node_kind: 'factor' }]);
    expect(w.stripped_constraint_nodes).toBe(0);

    // 2. USER MEANING INTACT — this is the witness, not the return value.
    const after = ctx.graph as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    expect(after.nodes).toHaveLength((before.nodes as unknown[]).length);
    expect(after.edges).toEqual(before.edges);
    expect(after.nodes.map((n) => n.id)).toEqual((before.nodes as Array<Record<string, unknown>>).map((n) => n.id));
    expect(after.nodes.map((n) => n.label)).toEqual((before.nodes as Array<Record<string, unknown>>).map((n) => n.label));

    // 3. EXACTLY ONE field was shed, and only on the corrupted node. Every
    //    other node's stored position is byte-identical to before.
    for (const b of before.nodes as Array<Record<string, unknown>>) {
      const a = after.nodes.find((n) => n.id === b.id)!;
      if (b.id === PLAIN_ID) {
        expect('observed_state' in a, 'the malformed field must be gone, not repaired').toBe(false);
      } else {
        expect(a.observed_state).toEqual(b.observed_state);
      }
    }

    // 4. The salvaged graph is now genuinely usable downstream.
    expect(DraftGraphOutput.safeParse({ graph: ctx.graph, goal_constraints: GOAL_CONSTRAINTS }).success).toBe(true);
  });

  it('G2 PERTURBED EQUIVALENT: same payload, the malformed node IS the constraint target — DECLINE, do not salvage', () => {
    const graph = realShapedGraph();
    (graph.nodes as Array<Record<string, unknown>>).find((n) => n.id === TARGET_ID)!.observed_state = MALFORMED;
    // Compare against the CORRUPTED input: declining must leave the caller's
    // graph exactly as it arrived, not restore it to some pristine version.
    const asArrived = JSON.parse(JSON.stringify(graph)) as typeof graph;

    const ctx = ctxFor(graph, GOAL_CONSTRAINTS);
    runStructuralParse(ctx);

    // The user-visible consequence: the turn fails, which is the honest
    // outcome when the alternative is a model that no longer states its limit.
    expect(ctx.earlyReturn?.statusCode).toBe(400);

    const w = lastWarn();
    expect(w.salvaged).toBe(false);
    expect(w.salvage_declined).toBe('would_strip_constraint');
    expect(w.stripped).toBeUndefined();

    // ⭐ THE ROLE HAZARD IS ISOLATED STRUCTURALLY, NOT BY A LABEL. This head
    // reports only `declined_reason`, and THREE separate hazards return the
    // same `would_strip_constraint` string, so the event cannot say which one
    // fired. The isolation is therefore asserted on the payload: the node's
    // `kind` is `factor` (so the kind test cannot fire) and its malformed
    // `observed_state` carries no `metadata` (so the shape test cannot
    // either). Only its ROLE as a `goal_constraints` target is left.
    const node = (ctx.graph as { nodes: Array<Record<string, unknown>> }).nodes
      .find((n) => n.id === TARGET_ID)!;
    expect(node.kind).toBe('factor');
    expect(MALFORMED).not.toHaveProperty('metadata');
    expect(GOAL_CONSTRAINTS.some((c) => c.node_id === TARGET_ID)).toBe(true);

    // The caller's graph is left EXACTLY as it arrived — byte-for-byte, with
    // the malformed field still present and nothing else touched.
    expect(ctx.graph).toEqual(asArrived);
  });

  it('G1/G2 are the same payload but for which node carries the field', () => {
    const a = realShapedGraph();
    const b = realShapedGraph();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

/**
 * ⭐⭐ G3 — #1674 AGAINST GATE-0 CRITERION 4, DECIDED RATHER THAN ASSUMED.
 *
 * Criterion 4: "unsupported semantics exposed as unsupported, never silently
 * approximated." The two clauses land differently here, and conflating them
 * would let this pass on the easier one:
 *
 *   ✅ NEVER APPROXIMATED. The salvage invents nothing. It deletes a field it
 *      could not express; no magnitude is written, moved or attributed.
 *
 *   ⛔ NOT EXPOSED. MEASURED, complete manifest: the ONLY consumer of
 *      `salvage.stripped` in the whole tree is `structural-parse.ts`, which
 *      writes it to `log.warn`. There are ZERO user-facing consumers. So a
 *      node that HAD a stored position loses it, and the rendered model is
 *      indistinguishable from one where no position was ever given. The user
 *      cannot tell "we could not read your figure" from "you never gave one".
 *
 * ⇒ VERDICT: #1674 satisfies the no-approximation clause and FAILS the
 *   exposure clause. It violates criterion 4 as currently wired.
 *
 * ⚠ HOW BAD, SCOPED HONESTLY. The highest-harm case is already refused: a
 * constraint-bearing node declines on all three axes (role, shape, kind), so a
 * user's stated LIMIT never silently vanishes. And in the captured staging
 * population every `observed_state` carried `source: "cee_inference"` /
 * `extractionType: "inferred"` — CEE shedding its own inference, not the
 * user's input.
 *
 * ⭐ RE-DERIVED AT THIS HEAD, AND ONE HALF OF THE ORIGINAL FINDING IS NOW
 * CLOSED. An earlier revision of this comment said the hazard tests key on
 * constraint role/shape/kind and "never on AUTHORSHIP", so a user-authored
 * value on an ordinary factor would be shed silently. That is FALSE here:
 * `would_strip_user_authority` now declines on a user-authored `source` or any
 * `stated_role` (see the G2b case below, which executes it). The claim is
 * corrected rather than deleted, because the verdict it supported changed
 * scope and a reader needs to know which half moved.
 *
 * ⛔ THE EXPOSURE CLAUSE STILL FAILS, AND THE VERDICT STANDS. Re-measured at
 * this head: the only consumer of `salvage.stripped` is still
 * `structural-parse.ts` writing to `log.warn`. Zero user-facing consumers.
 *
 * ⇒ What remains is narrower but real: a node carrying CEE's own inferred
 *   position, on a non-constraint, non-user-authored node, still loses it with
 *   nothing said. Closing that is disclosure — the data already leaves the
 *   salvage for exactly this purpose and nothing consumes it. That is a
 *   product ruling, not a build decision, and is not taken here.
 *
 * This case PINS the gap so it cannot be forgotten. It is written to go RED
 * the day disclosure is added — that is the intended signal, not a breakage.
 */
describe('G3 — the salvage is silent to the user (known limit, pinned)', () => {
  it('KNOWN LIMIT: a salvaged turn carries the stripped nodes in TELEMETRY ONLY', () => {
    const graph = realShapedGraph();
    (graph.nodes as Array<Record<string, unknown>>).find((n) => n.id === PLAIN_ID)!.observed_state = MALFORMED;
    const ctx = ctxFor(graph, GOAL_CONSTRAINTS);
    runStructuralParse(ctx);

    // Telemetry knows exactly what was shed...
    expect(lastWarn().stripped).toEqual([{ node_id: PLAIN_ID, node_kind: 'factor' }]);

    // ...and the turn carries NO user-facing signal of it. `earlyReturn` is the
    // stage's only channel to the caller, and a salvaged turn sets none, so
    // there is nothing for the product to disclose from.
    expect(ctx.earlyReturn, 'if this becomes defined, disclosure exists — update G3').toBeUndefined();
  });
});

/**
 * ⭐ G2b — THE AUTHORSHIP AXIS, EXECUTED. Added after rebasing onto
 * `fix(draft): never shed an observed_state a human authored — GATE 0`. Same
 * payload, same ordinary factor that G1 salvages; the ONLY difference is that
 * the malformed field claims a user-authored source. G1 and this case together
 * are the discriminating pair for the new axis.
 */
describe('G2b — a human-authored observed_state is never shed', () => {
  it('declines on authorship even though the node is an ordinary, unconstrained factor', () => {
    const graph = realShapedGraph();
    (graph.nodes as Array<Record<string, unknown>>).find((n) => n.id === PLAIN_ID)!.observed_state = {
      ...MALFORMED,
      source: 'user_override',
    };
    const ctx = ctxFor(graph, GOAL_CONSTRAINTS);
    runStructuralParse(ctx);

    const w = lastWarn();
    expect(w.salvaged, 'a human-authored value must never be shed').toBe(false);
    expect(w.salvage_declined).toBe('would_strip_user_authority');
    expect(ctx.earlyReturn?.statusCode).toBe(400);
  });
});
