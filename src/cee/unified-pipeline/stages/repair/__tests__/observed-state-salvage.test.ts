/**
 * AN OPTIONAL FIELD MUST NOT DESTROY THE USER'S WHOLE MODEL — PINNED.
 *
 * ── THE PROPERTY ────────────────────────────────────────────────────────────
 * `Node.observed_state` is declared `NodeObservedState.optional()`
 * (`schemas/graph.ts:336`). A node that OMITS it parses cleanly. A node that
 * carries a MALFORMED one fails the whole `DraftGraphOutput.parse`, so one
 * unparseable optional provenance field on one node returns a 400 that becomes
 * a user-facing 500 with an empty `assistant_text` — the user is shown nothing.
 *
 * That asymmetry is the defect. On 2026-09-21 the deployed `Staging Journey
 * Smoke` gate recorded draft failure rates of 40/60/20/40/40% across five
 * consecutive staging heads, and a complete census of that window's
 * `cee.structural_parse.failed` events (17 events, 20 issues, no truncation)
 * put EVERY issue at `graph.nodes.N.observed_state`, code `invalid_union`.
 *
 * ── WHY THE FIX CANNOT MAKE ANYTHING WORSE ──────────────────────────────────
 * The salvage runs ONLY after the full parse has already failed — a path whose
 * current outcome is a guaranteed 500 — and only when EVERY issue is an
 * `invalid_union` at an `observed_state` path. One issue anywhere else, or of
 * any other code, and it declines and the pre-existing 500 is byte-identical.
 *
 * ── THE DISCRIMINATION THAT MATTERS ─────────────────────────────────────────
 * `FactorObservedState` carries a refinement forbidding any `metadata` key, so
 * a MALFORMED CONSTRAINT observed_state (metadata present, operator missing) is
 * reported as `custom`, NOT `invalid_union`. That refusal is DELIBERATE:
 * `schemas/graph.ts:255-259` exists so "you cannot slip a broken operator
 * through by shedding the constraint shape". Shedding it is precisely what this
 * module does, so salvaging a `custom` issue would override that ruling.
 *
 * T2 is therefore the load-bearing test: it differs from T1 ONLY in the shape
 * of one `observed_state`, and it must still 400. A fix that keys on the PATH
 * alone — the obvious implementation, and the one first written here — passes
 * T1 and FAILS T2.
 *
 * ── PRECONDITION PINS ───────────────────────────────────────────────────────
 * Every test asserts its fixture reproduces the situation before asserting the
 * outcome, so none can hold vacuously: T0 pins that the same graph WITHOUT the
 * malformed field parses cleanly (otherwise the salvage would be credited for a
 * graph that was never savable), and T1/T2 pin the observed Zod issue CODE.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DraftGraphOutput } from '../../../../../schemas/assist.js';
import { runStructuralParse } from '../structural-parse.js';
import type { StageContext } from '../../../types.js';

vi.mock('../../../../../utils/telemetry.js', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const FACTOR = (observed_state?: unknown) => {
  const n: Record<string, unknown> = { id: 'fac_spend', kind: 'factor', label: 'Marketing spend' };
  if (observed_state !== undefined) n.observed_state = observed_state;
  return n;
};

const graphWith = (...nodes: Array<Record<string, unknown>>) => ({ nodes, edges: [] as unknown[] });

const ctxFor = (graph: unknown): StageContext =>
  ({ graph, requestId: 'req-test' } as unknown as StageContext);

const issueCodesFor = (graph: unknown): string[] => {
  const r = DraftGraphOutput.safeParse({ graph });
  return r.success ? [] : r.error.issues.map((i) => i.code as string);
};

describe('observed_state salvage — an optional field must not destroy the model', () => {
  beforeEach(() => vi.clearAllMocks());

  it('T0 PRECONDITION: the same graph without the malformed field parses cleanly', () => {
    expect(DraftGraphOutput.safeParse({ graph: graphWith(FACTOR()) }).success).toBe(true);
  });

  it('T1 a provenance-only observed_state is SHED and the model is preserved', () => {
    const graph = graphWith(FACTOR({ unit: '%' }));
    expect(issueCodesFor(graph)).toEqual(['invalid_union']); // precondition pin

    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();                 // no 500 — the user gets a model
    expect(graph.nodes[0]).not.toHaveProperty('observed_state');
    expect(graph.nodes[0]).toMatchObject({ id: 'fac_spend', kind: 'factor', label: 'Marketing spend' });
  });

  it('T2 DISCRIMINATING TWIN: a malformed CONSTRAINT observed_state still 400s', () => {
    const graph = graphWith(FACTOR({ value: 1, metadata: {} }));
    expect(issueCodesFor(graph)).toEqual(['custom']);        // precondition pin: NOT invalid_union

    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn?.statusCode).toBe(400);           // the deliberate refusal is preserved
    expect(graph.nodes[0]).toHaveProperty('observed_state'); // and nothing was shed
  });

  it('T3 an issue ANYWHERE ELSE still 400s and sheds nothing', () => {
    const graph = graphWith({ id: 'f1', label: 'no kind' });  // `kind` is required
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);
    expect(ctx.earlyReturn?.statusCode).toBe(400);
  });

  it('T4 a MIX of an observed_state issue and another issue still 400s, graph restored', () => {
    const bad = FACTOR({ unit: '%' });
    const graph = graphWith(bad, { id: 'f2', label: 'no kind' });
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);
    expect(ctx.earlyReturn?.statusCode).toBe(400);
    expect(graph.nodes[0]).toHaveProperty('observed_state');  // untouched — byte-identical path
  });

  it('T5 a VALID graph is untouched and never enters the salvage', () => {
    const graph = graphWith(FACTOR({ value: 0.5 }));
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);
    expect(ctx.earlyReturn).toBeUndefined();
    expect(graph.nodes[0]).toHaveProperty('observed_state', { value: 0.5 });
  });

  it('T6 several bad nodes are all shed, and good neighbours keep their provenance', () => {
    const graph = graphWith(
      FACTOR({ unit: '%' }),
      { id: 'fac_ok', kind: 'factor', label: 'Fine', observed_state: { value: 0.25 } },
      { id: 'fac_bad2', kind: 'factor', label: 'Also bad', observed_state: {} },
    );
    const ctx = ctxFor(graph);
    runStructuralParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(graph.nodes[0]).not.toHaveProperty('observed_state');
    expect(graph.nodes[1]).toHaveProperty('observed_state', { value: 0.25 }); // neighbour intact
    expect(graph.nodes[2]).not.toHaveProperty('observed_state');
  });
});
