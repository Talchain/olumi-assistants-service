/**
 * R1 residual (follow-up to PR #509) — the held-confirm value op must ACTUALLY
 * APPLY, not merely refuse honestly.
 *
 * #509 made the held-batch apply ATOMIC + HONEST: `batchFullyLanded()`
 * verifies every confirmed op had an observable effect on the canonical
 * persisted graph and refuses the WHOLE batch when one did not. That closed the
 * silent-partial defect but left the capability gap open — a mixed compound
 * edit ("set Setup and Migration Complexity to 0.5, and also add a risk about
 * data quality") was HELD, and then every confirm hard-declined, because the
 * tunable value op arrives in a field spelling GraphV3 strips.
 *
 * WHAT ACTUALLY ARRIVES (pinned by the producer-anchor test below, not
 * assumed): the edit prompt (`edit-graph-v6.ts` PATH SYNTAX) teaches
 * `/nodes/<id>/data/value`. `normalisePath` splits that into
 * `path: 'fac_x'` + `field: 'data/value'`, and the scalar-wrap turns it into
 * `value: { 'data/value': 0.5 }` — a LITERAL key, which `Object.assign` writes
 * verbatim onto the node and the GraphV3 re-parse then strips. #509's own
 * repro used `{data:{value}}` and `{'observed_state/value':…}`; all behave
 * identically, but the SLASH-KEYED `data/value` shape is the one the live
 * pipeline emits.
 *
 * THE FIX (UNCONDITIONAL since 2026-07-25; was the flag
 * `CEE_GM_HELD_VALUE_CANONICALISATION`, default OFF and never set on any
 * Render service, so this lane's repair had been dark since it shipped while
 * its REFUSAL — `batchFullyLanded` — was ungated and live):
 * `canonicaliseValueOps` translates those spellings to the one GraphV3
 * preserves — a MERGE onto the node's existing `observed_state` (PLoT's own
 * `update_node` semantics are `deepMerge`, so siblings like `unit` / `cap` /
 * `raw_value` survive) — immediately before the local apply, AFTER the
 * re-referee (so the confirm-time verdict and its telemetry stay byte-identical).
 *
 * ATOMICITY IS PRESERVED: `batchFullyLanded()` remains the backstop. The
 * fix makes the guard stop firing for LEGITIMATE batches; it never bypasses it.
 * An op the canonicaliser cannot translate is left verbatim and the guard
 * still refuses the whole batch (pinned below).
 */
import { describe, expect, it } from 'vitest';

import { evaluateEditGraphMutations } from '../edit-graph-referee-gate.js';
import { executeGmHeldResume, readGmHeldResume } from '../gm-held-execute.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { canonicaliseValueOps } from '../../../orchestrator/canonicalise-value-ops.js';

// ── no flag helpers ─────────────────────────────────────────────────────────
//
// This file used to drive `CEE_GM_HELD_VALUE_CANONICALISATION` through the real
// env var. The gate is gone (2026-07-25) and the behaviour is unconditional, so
// the "flag OFF" arms have been REPLACED rather than deleted: each one is now a
// direct assertion on `canonicaliseValueOps` itself — the module that decides
// whether an op is translated. That is a strictly better discriminator than the
// flag was, because it is derived from the source of truth instead of from a
// switch a reader has to trust. See the notes on the individual tests.

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * A realistic factor: `observed_state` carries the sibling fields a real
 * persisted graph has (`unit`, `raw_value`, `cap`). A fix that REPLACED
 * observed_state wholesale would wipe them — the sibling assertions below are
 * the positive control for that failure mode.
 */
const VALUE_GRAPH = {
  goal_node_id: 'g_profit',
  schema_version: 'v3',
  nodes: [
    { id: 'g_profit', kind: 'goal', label: 'Profit' },
    {
      id: 'fac_setup',
      kind: 'factor',
      label: 'Setup and Migration Complexity',
      category: 'observable',
      observed_state: { value: 0.1, unit: 'index', raw_value: 10, cap: 100 },
    },
  ],
  edges: [
    {
      from: 'fac_setup',
      to: 'g_profit',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

const RISK_ADD = {
  op: 'add_node',
  path: 'risk_dq',
  value: { id: 'risk_dq', kind: 'risk', label: 'Data quality' },
};
const RISK_LINK = {
  op: 'add_edge',
  path: 'risk_dq::g_profit',
  value: {
    from: 'risk_dq',
    to: 'g_profit',
    strength: { mean: 0.4, std: 0.1 },
    exists_probability: 0.8,
    effect_direction: 'negative',
  },
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

function nodeOf(graph: Record<string, unknown>, id: string): Record<string, unknown> {
  const found = (graph.nodes as Array<Record<string, unknown>>).find((n) => n.id === id);
  if (found === undefined) throw new Error(`node ${id} missing`);
  return found;
}

/**
 * Mint the hold through the REAL gate (propose → hold), read the payload back
 * off the persisted-shape pending, and confirm — the whole user-visible loop,
 * not a hand-built input.
 */
function holdThenConfirm(operations: unknown[]) {
  const hash = hashOf(VALUE_GRAPH);
  const held = evaluateEditGraphMutations({
    mode: 'live',
    operations: operations as never,
    currentGraph: VALUE_GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none',
    scenarioId: 'scn-r1',
    turnId: 'turn-r1',
    requestId: 'req-r1',
  });
  expect(held.governing).toBe('held');
  const pending = held.pendingActions![0]!;
  const read = readGmHeldResume(pending);
  expect(read.kind).toBe('ok');
  if (read.kind !== 'ok') throw new Error('pending must carry an executable payload');
  return executeGmHeldResume({
    operations: read.operations,
    currentGraph: VALUE_GRAPH,
    currentGraphHash: hash,
    freshness: 'none',
    hasExistingAnalysis: false,
    scenarioId: 'scn-r1',
    turnId: 'turn-r1',
    requestId: 'req-r1',
  });
}

// ── producer anchor ─────────────────────────────────────────────────────────

describe('producer anchor — the spelling the LIVE pipeline actually emits', () => {
  it('the prompt-taught path /nodes/<id>/data/value parses to a slash-keyed literal op key', () => {
    // Trap 16: a fix aimed at a spelling the producer never emits is theatre.
    // This pins the target shape to the REAL parser, so a prompt/parser change
    // that moves the spelling fails HERE rather than silently un-fixing R1.
    const parsed = parseEditGraphResponse(
      JSON.stringify({
        operations: [
          {
            op: 'update_node',
            path: '/nodes/fac_setup/data/value',
            value: 0.5,
            old_value: 0.1,
            impact: 'low',
            rationale: 'user asked',
          },
        ],
      }),
    );
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0]!.value).toEqual({ 'data/value': 0.5 });
  });
});

// ── the capability ──────────────────────────────────────────────────────────

describe('R1 — a held mixed batch whose value op is data-spelled APPLIES on confirm', () => {
  /** The op the live producer emits for "set Setup and Migration Complexity to 0.5". */
  const LIVE_VALUE_OP = {
    op: 'update_node',
    path: 'fac_setup',
    value: { 'data/value': 0.5 },
    old_value: { 'data/value': 0.1 },
  };

  it('the value CHANGES on the persisted graph and the structural sibling lands', async () => {
    const outcome = holdThenConfirm([LIVE_VALUE_OP, RISK_ADD, RISK_LINK]);

    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;

    // THE POINT OF THE WHOLE LANE: the value actually moved.
    const fac = nodeOf(outcome.mutatedGraph as Record<string, unknown>, 'fac_setup');
    expect((fac.observed_state as Record<string, unknown>).value).toBe(0.5);

    // …and the merge preserved the siblings a wholesale replace would wipe.
    expect(fac.observed_state).toEqual({
      value: 0.5,
      unit: 'index',
      raw_value: 10,
      cap: 100,
    });

    // …and the structural siblings landed in the SAME confirm (whole batch).
    expect(
      (outcome.mutatedGraph.nodes as Array<Record<string, unknown>>).some(
        (n) => n.id === 'risk_dq',
      ),
    ).toBe(true);
    expect(
      (outcome.mutatedGraph.edges as Array<Record<string, unknown>>).some(
        (e) => e.from === 'risk_dq' && e.to === 'g_profit',
      ),
    ).toBe(true);

    // …and no junk spelling was persisted alongside it.
    expect(Object.keys(fac)).not.toContain('data/value');
    expect(Object.keys(fac)).not.toContain('data');

    // DL-7 receipt still ships.
    expect(outcome.fact.result.status).toBe('applied');
    expect(outcome.fact.result.operations_count).toBe(3);
  });

  /**
   * REPLACES the old "flag OFF: byte-identical to #509" arm.
   *
   * That test set the kill-switch and asserted the batch was still refused. It
   * was the POSITIVE CONTROL for the test above: it proved the batch is one the
   * held lane genuinely could not land, so that "it executes now" means the
   * canonicaliser is what changed — not that the fixture was landable all along.
   *
   * The switch is gone, but the control must not go with it, or the test above
   * becomes an assertion that some batch executes, which is nearly vacuous. So
   * the control is re-expressed against the module that actually decides:
   * `canonicaliseValueOps` must REPORT this op as translated, and the raw
   * (untranslated) spelling must be one `GraphV3` strips.
   */
  it('POSITIVE CONTROL — the op above is one the lane could NOT land untranslated', () => {
    const { operations, translatedCount } = canonicaliseValueOps(
      [LIVE_VALUE_OP, RISK_ADD, RISK_LINK] as never,
      VALUE_GRAPH as never,
    );

    // The canonicaliser is what moves this op — exactly one op was rewritten.
    expect(translatedCount).toBe(1);

    // Before translation the write targets a node-ROOT key with a slash in it,
    // which is undeclared on NodeV3 and therefore stripped by the re-parse.
    // That strip is the defect; this is the presence the absence relies on.
    expect(Object.keys(LIVE_VALUE_OP.value)).toEqual(['data/value']);

    // After translation it targets `observed_state`, which GraphV3 preserves.
    const rewritten = (operations as Array<{ value: Record<string, unknown> }>)[0];
    expect(Object.keys(rewritten.value)).toEqual(['observed_state']);
    expect((rewritten.value.observed_state as Record<string, unknown>).value).toBe(0.5);
  });

  it.each([
    ['bare data whole-object', { data: { value: 0.5 } }],
    ['slash-keyed data/value', { 'data/value': 0.5 }],
    ['slash-keyed observed_state/value', { 'observed_state/value': 0.5 }],
    ['dotted observed_state.value', { 'observed_state.value': 0.5 }],
    ['dotted data.value', { 'data.value': 0.5 }],
  ])('%s applies the value', async (_label, value) => {
    const outcome = holdThenConfirm([
      { op: 'update_node', path: 'fac_setup', value },
      RISK_ADD,
      RISK_LINK,
    ]);
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    const fac = nodeOf(outcome.mutatedGraph as Record<string, unknown>, 'fac_setup');
    expect((fac.observed_state as Record<string, unknown>).value).toBe(0.5);
    // Siblings survive on every spelling (merge, never replace).
    expect((fac.observed_state as Record<string, unknown>).unit).toBe('index');
  });
});

// ── no regression on the cases that already worked ──────────────────────────

describe('R1 — blast radius: the currently-working cases are unchanged', () => {
  /**
   * These three tests used to run the same batch twice — flag OFF, then flag ON
   * — and assert the two graphs were `toEqual`. With the gate deleted there is
   * no OFF run to compare against, so the property is now asserted where it
   * actually lives: `canonicaliseValueOps` must be the IDENTITY on these ops.
   *
   * `translatedCount === 0` is the same claim the two-run comparison was making
   * ("this batch is not affected"), stated directly and without needing a
   * switch. It is also strictly sharper: the old form would have passed if BOTH
   * runs were wrong in the same way, and this form cannot.
   *
   * The deep-equality on the returned ops is kept because
   * `canonicalise-value-ops.ts` returns a shallow COPY of the array on the
   * zero-translation path (its own doc comment claims it returns the input by
   * reference — that comment is wrong; the elements are identical references
   * but the array is not). Element identity is what downstream consumers see,
   * so that is what is asserted.
   */
  function assertIdentity(ops: unknown[]) {
    const { operations, translatedCount } = canonicaliseValueOps(
      ops as never,
      VALUE_GRAPH as never,
    );
    expect(translatedCount).toBe(0);
    expect(operations).toEqual(ops);
    operations.forEach((op, i) => expect(op).toBe(ops[i]));
  }

  it('canonical observed_state spelling: the canonicaliser is the identity', () => {
    const ops = [
      { op: 'update_node', path: 'fac_setup', value: { observed_state: { value: 0.5 } } },
      RISK_ADD,
      RISK_LINK,
    ];
    assertIdentity(ops);

    // …and it still applies, with the (pre-existing) whole-object replace.
    const outcome = holdThenConfirm(ops);
    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') return;
    expect(
      nodeOf(outcome.mutatedGraph as Record<string, unknown>, 'fac_setup').observed_state,
    ).toEqual({ value: 0.5 });
  });

  it('pure-structural hold: the canonicaliser is the identity', () => {
    const ops = [RISK_ADD, RISK_LINK];
    assertIdentity(ops);
    expect(holdThenConfirm(ops).status).toBe('executed');
  });

  it('a non-value node field (description) is untouched by the canonicaliser', () => {
    const ops = [
      { op: 'update_node', path: 'fac_setup', value: { description: 'Quarterly complexity' } },
      RISK_ADD,
      RISK_LINK,
    ];
    assertIdentity(ops);
    expect(holdThenConfirm(ops).status).toBe('executed');
  });
});

// ── the guard must still bite ───────────────────────────────────────────────

describe('R1 — atomicity doctrine: batchFullyLanded still refuses what it cannot land', () => {
  it('an op in a spelling the canonicaliser does NOT translate still refuses the WHOLE batch', () => {
    // `goal_constraints` is a SANCTIONED referee root (so the batch really
    // holds and reaches the confirm) but is undeclared on NodeV3, so the
    // re-parse strips it. The canonicaliser leaves it verbatim — it is not an
    // observed_state spelling — and the guard must still refuse the whole
    // batch rather than persist the structural siblings alone.
    const outcome = holdThenConfirm([
      {
        op: 'update_node',
        path: 'fac_setup',
        value: { goal_constraints: [{ label: 'Keep complexity low' }] },
      },
      RISK_ADD,
      RISK_LINK,
    ]);
    expect(outcome).toEqual({ status: 'apply_failed', reason: 'incomplete_apply' });
  });

  it('a value op targeting an interventions path is NOT rewritten (that subtree has its own reader)', () => {
    // `extractInterventionUpdates` consumes the `data.interventions` spelling
    // FROM THE OP. Rewriting it to observed_state would break that reader, so
    // the canonicaliser leaves it alone and the guard refuses honestly.
    const outcome = holdThenConfirm([
      {
        op: 'update_node',
        path: 'fac_setup',
        value: { 'data/interventions/fac_other': { value: 0.3 } },
      },
      RISK_ADD,
      RISK_LINK,
    ]);
    expect(outcome).toEqual({ status: 'apply_failed', reason: 'incomplete_apply' });
  });
});
