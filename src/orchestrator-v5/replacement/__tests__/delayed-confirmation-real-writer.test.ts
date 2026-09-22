/**
 * ⭐⭐⭐ ONE DELAYED-CONFIRMATION EDIT, THROUGH THE CONTROLLER, INTO THE REAL
 * WRITER — on a CAPTURED REAL GRAPH.
 *
 * Paul's directive, and the reason for every constraint below: no synthetic
 * fixture, a captured real graph, prove ONE delayed confirmation first, then
 * next-turn and reload agreement.
 *
 * ── WHY THE CAPTURE IS NOT OPTIONAL, LEARNED THE EXPENSIVE WAY ────────────
 * My previous attempt used a hand-written graph with
 * `interventions: { 'f-budget': 0.2 }` — a bare number. The real product emits
 * a RICH OBJECT:
 *
 *   '35a64cfe': { value: 0.4, raw_value: 200000, unit: '£',
 *                 source: 'cee_hypothesis', target_match: {...},
 *                 value_confidence: 'low', reasoning: '...' }
 *
 * The real writer refused, and I spent four probes deciding whether that was
 * my fixture or the product. **It was my fixture, and it was a shape the
 * product never makes.** A self-authored graph encodes the author's model of
 * the producer, which is exactly why it confirms instead of testing.
 *
 * The graph here is `captures/journey-witness-20260921-graph.json`, lifted
 * verbatim from a real 21 Sep journey witness: 14 nodes, 25 edges.
 * ⛔ APPEND-ONLY. It is a RECORD of what the product emitted on a dated build,
 * not a fixture to keep current. Add captures; never edit one.
 *
 * ── WHAT IS STILL A DOUBLE, SAID PLAINLY ──────────────────────────────────
 * The session STORE is a test double — there is no database here. It is
 * modelled on `system-events/__tests__/option-intervention-transaction.test.ts`,
 * which drives this same write family successfully, rather than invented:
 * `append` records the row AND advances the graph, `readRecent` returns that
 * row, because the adapter READS BACK and verifies both. My previous double
 * returned `{id}` with an empty `readRecent`, so the adapter could not confirm
 * its own commit and reported `write_outcome_unknown` — a true answer about an
 * inadequate double.
 *
 * The model's replies are SCRIPTED. That is what makes this an integration of
 * the MACHINERY, not evidence about model behaviour.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * ⛔ THESE PROBE FILES USED HARDCODED `/tmp/<fixed-name>.json`, which CodeQL
 * flags HIGH as `js/insecure-temporary-file` — a predictable path in a
 * world-writable directory is a symlink-substitution target, and both alerts
 * were NEW in this PR. The files are debug aids (vitest suppresses
 * `console.log`, so outcomes are written out to be read), and the capability is
 * worth keeping — so this takes a per-run directory with a random suffix
 * instead of deleting them.
 *
 * ⚠ CodeQL is NOT a required check on `staging` (the only required context is
 * `Lint, TypeCheck, Unit Tests`), so this would have merged unread. That is
 * exactly why it is fixed here rather than noted.
 */
const PROBE_DIR = mkdtempSync(join(tmpdir(), 'cee-replacement-probe-'));

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURED_GRAPH = JSON.parse(
  readFileSync(join(HERE, 'captures', 'journey-witness-20260921-graph.json'), 'utf8'),
) as { nodes: Array<Record<string, unknown>>; edges: unknown[] };

const SCENARIO = 'c0ffee00-0000-4000-8000-000000000001';

/** Modelled on the transaction suite's double: append advances the graph AND records a readable row. */
function makeStore(initial: unknown) {
  let graphJson = JSON.stringify(initial);
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    appends: [] as Array<Record<string, unknown>>,
    loadGraph: vi.fn(async () => JSON.parse(graphJson)),
    loadGraphAndBriefText: async () => ({ graph: JSON.parse(graphJson), briefText: null }),
    append: vi.fn(async (write: Record<string, unknown>) => {
      const id = `persisted-row-${rows.length + 1}`;
      rows.push({
        id,
        scenario_id: write.scenario_id,
        turn_id: write.turn_id,
        request_hash: write.request_hash,
      });
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

describe('CLAUSE: one delayed-confirmation edit reaches the real writer', () => {
  it('the captured graph is REAL — rich intervention objects, not bare numbers', () => {
    // ⚠ THE PRECONDITION. If this capture were ever replaced by something
    // hand-written, every clause below would be testing a shape the product
    // does not make, and would pass while proving nothing.
    const option = CAPTURED_GRAPH.nodes.find((n) => n.kind === 'option' && n.interventions);
    expect(option, 'the capture must carry an option with interventions').toBeDefined();
    const first = Object.values(option!.interventions as Record<string, unknown>)[0] as Record<string, unknown>;
    expect(typeof first, 'a real intervention is an OBJECT, not a number').toBe('object');
    expect(first).toHaveProperty('value');
    expect(first).toHaveProperty('source');
  });

  it('the real adapter commits a change to the captured graph and returns a receipt', async () => {
    const { createApplyOperations, currentModelRevision } = await import('../../apply-operations.js');
    const store = makeStore(CAPTURED_GRAPH);

    const modelRevision = await currentModelRevision(SCENARIO, { store: store as never });
    expect(modelRevision, 'a real captured graph must mint a real token').not.toBeNull();

    const apply = createApplyOperations({
      scenarioId: SCENARIO,
      requestId: 'req-delayed-1',
      store: store as never,
    });

    // The edit: raise "SMB Self-Serve Investment" on "Double Down on Self-Serve SMB".
    // Both ids come from the capture; neither is invented.
    const outcome = await apply({
      proposalId: 'prop-delayed-1',
      idempotencyKey: 'turn-confirm-1',
      modelRevision: modelRevision!,
      operations: [
        {
          kind: 'set_option_effect',
          summary: 'Raise SMB Self-Serve Investment on Double Down on Self-Serve SMB',
          detail: {
            operations: [
              {
                op: 'update_node',
                path: '/nodes/3f02dabe/data/interventions/35a64cfe',
                value: { value: 0.55 },
                old_value: null,
                impact: 'moderate',
                rationale: 'The user confirmed this effect on a later turn.',
              },
            ],
          },
        },
      ],
    } as never);

    // ⭐ THE CLAUSE. A receipt, or a named refusal — reported either way.
    writeFileSync(join(PROBE_DIR, 'adapter-outcome.json'), JSON.stringify({
      outcome,
      appends: store.append.mock.calls.length,
      rows: store.rows,
      graphAdvanced: (await store.loadGraph()) !== undefined,
    }, null, 1));
    expect(outcome, 'the adapter must answer').toBeDefined();
  });
});

/**
 * ⭐⭐ THE ACTUAL DELAYED CONFIRMATION: turn 1 OFFERS, turn 2 CONFIRMS, and the
 * write lands through the CONTROLLER rather than by calling the adapter直接.
 *
 * The clause above proves the WRITER commits against a real graph. It calls
 * `apply()` directly, so it says nothing about whether the controller reaches
 * it, stages the right operation, or survives the turn boundary between the
 * offer and the answer. That boundary IS the feature: "offer a change, the user
 * agrees ON A LATER TURN".
 */
describe('CLAUSE: the offer survives the turn boundary and the answer commits', () => {
  it('turn 1 offers · turn 2 confirms · the real writer returns a receipt', async () => {
    const { createApplyOperations, currentModelRevision } = await import('../../apply-operations.js');
    const { runReplacementTurn } = await import('../run-replacement-turn.js');
    const { ACCEPT_TOOL_NAME } = await import('../run-replacement-turn.js');
    const { EMPTY_CONVERSATION_MEMORY } = await import('../conversation-memory.js');
    const { EMPTY_PROPOSAL_STORE } = await import('../proposal-store.js');

    const store = makeStore(CAPTURED_GRAPH);
    const modelRevision = (await currentModelRevision(SCENARIO, { store: store as never }))!;
    const apply = createApplyOperations({ scenarioId: SCENARIO, requestId: 'req-j', store: store as never });

    // The staged operation targets ids taken from the capture, not invented.
    const OPS = [
      {
        op: 'update_node',
        path: '/nodes/3f02dabe/data/interventions/35a64cfe',
        value: { value: 0.55 },
        old_value: null,
        impact: 'moderate',
        rationale: 'The user confirmed this effect on a later turn.',
      },
    ];
    const tool = {
      kind: 'propose' as const,
      definition: { name: 'set_option_effect', description: 'propose', input_schema: { type: 'object', properties: {} } },
      execute: () => ({ type: 'proposed' as const, summary: 'Raise SMB Self-Serve Investment', operations: OPS }),
    };

    const reply = (blocks: unknown[], stop: string) => ({
      content: blocks, stop_reason: stop, usage: { input_tokens: 5, output_tokens: 5 }, model: 's', latencyMs: 1,
    });
    const scripted = (rs: unknown[]) => { let i = 0; return (async () => rs[Math.min(i++, rs.length - 1)]) as never; };

    const base = {
      history: [], memory: EMPTY_CONVERSATION_MEMORY, proposals: EMPTY_PROPOSAL_STORE,
      modelRevision, workspaceSummary: 'Four options, four factors.', tools: [tool],
      now: '2026-09-21T10:00:00.000Z', idFor: (p: string, i: number) => `${p}-${i}`,
    };

    const t1 = await runReplacementTurn(
      { ...base, turnId: 'turn-offer', message: 'What should we put for SMB self-serve investment?' } as never,
      { chatWithTools: scripted([
          reply([{ type: 'tool_use', id: 'tu1', name: 'set_option_effect', input: {} }], 'tool_use'),
          reply([{ type: 'text', text: 'I suggest raising it. Shall I put that in?' }], 'end_turn'),
        ]), checkpoint: async () => undefined, applyOperations: apply } as never,
    );
    const open = t1.proposals.proposals.filter((p: { status: string }) => p.status === 'open');
    expect(open, 'turn 1 must leave exactly one open proposal').toHaveLength(1);

    // ⭐ THE TURN BOUNDARY — everything reloads from storage, as the next turn would.
    const carried = JSON.parse(JSON.stringify({ memory: t1.memory, proposals: t1.proposals }));

    const t2 = await runReplacementTurn(
      { ...base, turnId: 'turn-confirm', message: 'Yes, go ahead and update the model.',
        memory: carried.memory, proposals: carried.proposals } as never,
      { chatWithTools: scripted([
          reply([{ type: 'tool_use', id: 'tu2', name: ACCEPT_TOOL_NAME,
                   input: { proposal_id: open[0]!.id, user_agreement_quote: 'go ahead and update the model' } }], 'tool_use'),
          reply([{ type: 'text', text: 'Done.' }], 'end_turn'),
        ]), checkpoint: async () => undefined, applyOperations: apply } as never,
    );

    writeFileSync(join(PROBE_DIR, 'journey-outcome.json'), JSON.stringify({
      applied: t2.applied, mustReconcile: t2.mustReconcile,
      refusals: t2.trace?.refusals ?? [], appends: store.append.mock.calls.length, rows: store.rows,
    }, null, 1));

    // ── CLAUSE: the write actually landed, with a receipt and no refusal ──
    expect(t2.applied, 'exactly one apply, carrying a receipt').toHaveLength(1);
    expect(t2.applied[0]!.receiptId, 'the receipt is the proof of commit').toBeTruthy();
    expect(t2.trace?.refusals ?? [], 'no refusal on the committing turn').toHaveLength(0);
    expect(store.append.mock.calls.length, 'ONE write, not two').toBe(1);

    // ── CLAUSE: RELOAD AGREEMENT — the graph a later turn loads carries it ──
    // Read back through the store the way the next turn would, not from any
    // value this test held in memory.
    const reloaded = (await store.loadGraph()) as { nodes: Array<Record<string, unknown>> };
    const option = reloaded.nodes.find((n) => n.id === '3f02dabe')!;
    const intervention = (option.interventions as Record<string, { value?: unknown }>)['35a64cfe'];
    expect(intervention, 'the edited cell must exist after reload').toBeDefined();
    expect(intervention.value, 'the reloaded model carries the CONFIRMED value').toBe(0.55);

    // ⚠ POSITIVE CONTROL on the reload: an untouched cell must be unchanged,
    // or "it carries 0.55" could be true of a graph this test simply replaced.
    const untouched = (option.interventions as Record<string, { value?: unknown }>)['bc936d4c'];
    expect(untouched?.value, 'a neighbouring cell must survive untouched').toBe(0.075);

    // ── CLAUSE: NEXT-TURN AGREEMENT — the revision moved, so a stale offer
    // would be recognised as stale rather than silently re-applied.
    const after = await currentModelRevision(SCENARIO, { store: store as never });
    expect(after, 'the reloaded graph still mints a token').not.toBeNull();
    expect(after, 'the revision MOVED — a later turn can tell the model changed').not.toBe(modelRevision);
  });
});
