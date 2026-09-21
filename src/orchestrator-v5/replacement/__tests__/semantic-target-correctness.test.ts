/**
 * ⭐⭐⭐ MANDATORY REGRESSION 1 — SEMANTIC TARGET CORRECTNESS.
 *
 * Paul's ruling, 21 Sep 2026, from his own pricing session: when the user sets
 * an option's effect on a factor, the persisted operation must be
 * **option × factor**. It must NOT mutate the global factor baseline, and the
 * receipt and the reload must identify the same option, factor and value.
 *
 * ── THE SESSION THIS EXISTS TO STOP REPEATING (`48a1ce84`, 21 Sep) ────────
 * He was asked: *"Factor 'Feature Release Quality' is currently 0.5 scale. What
 * should option 'increase the Pro plan price…' set it to?"* He answered 0.6.
 * The next readiness block read:
 *
 *   "Factor 'Feature Release Quality' is currently **0.6** scale. What should
 *    option 'increase the Pro plan price…' set it to?"
 *
 * The 0.6 landed on the FACTOR'S BASELINE, and the blocker survived — so the
 * question came back with the target moved. **Every answer moved the thing he
 * was being asked to hit.** That is an unwinnable loop, and it is why he could
 * never reach analysis.
 *
 * ── WHY THE CONTROL BELOW IS THE LOAD-BEARING PART ───────────────────────
 * "The factor baseline is unchanged" passes TRIVIALLY if the write did nothing
 * at all — a refused write, a no-op adapter, a broken fixture all satisfy it.
 * So it is paired with proof that the option's own cell DID change in the same
 * run. Neither assertion means anything without the other (CLAUDE.md trap 13).
 *
 * The graph is the captured 21 Sep journey witness — append-only, never edited.
 * The store is a double and the model is scripted: this is evidence about the
 * MACHINERY, not about model behaviour.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURED_GRAPH = JSON.parse(
  readFileSync(join(HERE, 'captures', 'journey-witness-20260921-graph.json'), 'utf8'),
) as { nodes: Array<Record<string, unknown>>; edges: unknown[] };

const SCENARIO = 'c0ffee00-0000-4000-8000-000000000002';
/** Both ids come from the capture. Neither is invented. */
const OPTION_ID = '3f02dabe';
const FACTOR_ID = '35a64cfe';

function makeStore(initial: unknown) {
  let graphJson = JSON.stringify(initial);
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    loadGraph: vi.fn(async () => JSON.parse(graphJson)),
    loadGraphAndBriefText: async () => ({ graph: JSON.parse(graphJson), briefText: null }),
    append: vi.fn(async (write: Record<string, unknown>) => {
      const id = `persisted-row-${rows.length + 1}`;
      rows.push({ id, scenario_id: write.scenario_id, turn_id: write.turn_id, request_hash: write.request_hash });
      if (write.graph !== undefined && write.graph !== null) graphJson = JSON.stringify(write.graph);
      return { id };
    }),
    readRecent: vi.fn(async () => rows.map((r) => ({ ...r }))),
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    ensureScenarioExists: async () => ({ user_id: null }),
    countTurns: async () => 0,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
  };
}

const nodeById = (g: { nodes: Array<Record<string, unknown>> }, id: string) =>
  g.nodes.find((n) => n.id === id)!;

describe('MANDATORY REGRESSION 1 — an option effect never moves the factor baseline', () => {
  it('the capture carries the option and factor this regression names', () => {
    // Pins its own precondition: if the capture is ever swapped, this REDs
    // rather than the assertions below passing against absent nodes.
    expect(nodeById(CAPTURED_GRAPH, OPTION_ID)?.kind).toBe('option');
    expect(nodeById(CAPTURED_GRAPH, FACTOR_ID)?.kind).toBe('factor');
  });

  it('writes option × factor, leaves the factor node byte-identical, and agrees on reload', async () => {
    const { createApplyOperations, currentModelRevision } = await import('../../apply-operations.js');
    const store = makeStore(CAPTURED_GRAPH);

    const before = await store.loadGraph();
    const factorBefore = JSON.stringify(nodeById(before, FACTOR_ID));
    const optionCellBefore = JSON.stringify(
      (nodeById(before, OPTION_ID).interventions as Record<string, unknown>)[FACTOR_ID],
    );

    const modelRevision = await currentModelRevision(SCENARIO, { store: store as never });
    const apply = createApplyOperations({
      scenarioId: SCENARIO,
      requestId: 'req-semantic-target',
      store: store as never,
    });

    const outcome = (await apply({
      proposalId: 'prop-semantic-target',
      idempotencyKey: 'turn-semantic-target',
      modelRevision: modelRevision!,
      operations: [
        {
          kind: 'set_option_effect',
          summary: 'Set this option effect to 0.6',
          detail: {
            operations: [
              {
                // ⭐ THE PATH IS THE WHOLE POINT: option, THEN factor.
                op: 'update_node',
                path: `/nodes/${OPTION_ID}/data/interventions/${FACTOR_ID}`,
                value: { value: 0.6 },
                old_value: null,
                impact: 'moderate',
                rationale: 'The user answered 0.6 for this option.',
              },
            ],
          },
        },
      ],
    } as never)) as { ok?: boolean; receiptId?: string };

    expect(outcome.ok, 'the write must land, or every assertion below is vacuous').toBe(true);
    expect(outcome.receiptId, 'a receipt identifies what persisted').toBeTruthy();

    const after = await store.loadGraph();

    // ⭐ POSITIVE CONTROL — the option's own cell DID move. Without this, the
    // factor-unchanged assertion below would pass on a write that did nothing.
    const optionCellAfter = (nodeById(after, OPTION_ID).interventions as Record<string, { value?: unknown }>)[FACTOR_ID];
    expect(JSON.stringify(optionCellAfter), 'the option cell must have changed').not.toBe(optionCellBefore);
    expect(optionCellAfter.value, 'option × factor carries the user’s value').toBe(0.6);

    // ⛔ THE REGRESSION. The factor node — its baseline, its prior, its scale —
    // must be untouched. This is the defect that made the session unwinnable.
    expect(
      JSON.stringify(nodeById(after, FACTOR_ID)),
      'setting an OPTION effect must not mutate the FACTOR baseline',
    ).toBe(factorBefore);

    // Reload agreement: same option, same factor, same value, through storage.
    const reloaded = JSON.parse(JSON.stringify(await store.loadGraph())) as typeof after;
    const cell = (nodeById(reloaded, OPTION_ID).interventions as Record<string, { value?: unknown }>)[FACTOR_ID];
    expect(cell.value).toBe(0.6);
    expect(JSON.stringify(nodeById(reloaded, FACTOR_ID))).toBe(factorBefore);
  });

  it('no OTHER option gains the value — the write binds to one option by identity', async () => {
    const { createApplyOperations, currentModelRevision } = await import('../../apply-operations.js');
    const store = makeStore(CAPTURED_GRAPH);
    const modelRevision = await currentModelRevision(SCENARIO, { store: store as never });
    const apply = createApplyOperations({
      scenarioId: SCENARIO, requestId: 'req-identity', store: store as never,
    });
    await apply({
      proposalId: 'prop-identity',
      idempotencyKey: 'turn-identity',
      modelRevision: modelRevision!,
      operations: [{
        kind: 'set_option_effect',
        summary: 'Set this option effect to 0.6',
        detail: { operations: [{
          op: 'update_node',
          path: `/nodes/${OPTION_ID}/data/interventions/${FACTOR_ID}`,
          value: { value: 0.6 }, old_value: null, impact: 'moderate', rationale: 'x',
        }] },
      }],
    } as never);

    const after = await store.loadGraph();
    const others = after.nodes.filter(
      (n: Record<string, unknown>) => n.kind === 'option' && n.id !== OPTION_ID,
    );
    expect(others.length, 'the capture must carry sibling options, or this proves nothing').toBeGreaterThan(0);
    for (const o of others) {
      const cell = (o.interventions as Record<string, { value?: unknown }> | undefined)?.[FACTOR_ID];
      if (cell !== undefined) {
        expect(cell.value, `sibling option ${String(o.id)} must not have gained the value`).not.toBe(0.6);
      }
    }
  });
});
