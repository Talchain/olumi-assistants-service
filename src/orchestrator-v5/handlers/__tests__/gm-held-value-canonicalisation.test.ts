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
 * THE FIX (flag `CEE_GM_HELD_VALUE_CANONICALISATION`, default OFF):
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
import { afterEach, describe, expect, it } from 'vitest';

import { evaluateEditGraphMutations } from '../edit-graph-referee-gate.js';
import { executeGmHeldResume, readGmHeldResume } from '../gm-held-execute.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';

// ── flag helpers (pattern: ui-directive-emit.test.ts) ───────────────────────

const FLAG = 'CEE_GM_HELD_VALUE_CANONICALISATION';

async function setFlag(value: 'true' | 'false' | undefined): Promise<void> {
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

afterEach(async () => {
  await setFlag(undefined);
});

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

  it('flag ON: the value CHANGES on the persisted graph and the structural sibling lands', async () => {
    await setFlag('true');
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

  it('flag OFF: byte-identical to #509 — the whole batch is still honestly refused', async () => {
    await setFlag('false');
    const outcome = holdThenConfirm([LIVE_VALUE_OP, RISK_ADD, RISK_LINK]);
    expect(outcome).toEqual({ status: 'apply_failed', reason: 'incomplete_apply' });
  });

  it('flag DEFAULT (absent): OFF — the capability ships dark', async () => {
    await setFlag(undefined);
    const outcome = holdThenConfirm([LIVE_VALUE_OP, RISK_ADD, RISK_LINK]);
    expect(outcome).toEqual({ status: 'apply_failed', reason: 'incomplete_apply' });
  });

  it.each([
    ['bare data whole-object', { data: { value: 0.5 } }],
    ['slash-keyed data/value', { 'data/value': 0.5 }],
    ['slash-keyed observed_state/value', { 'observed_state/value': 0.5 }],
    ['dotted observed_state.value', { 'observed_state.value': 0.5 }],
    ['dotted data.value', { 'data.value': 0.5 }],
  ])('flag ON: %s applies the value', async (_label, value) => {
    await setFlag('true');
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
  it('canonical observed_state spelling: flag ON produces a graph IDENTICAL to flag OFF', async () => {
    const ops = [
      { op: 'update_node', path: 'fac_setup', value: { observed_state: { value: 0.5 } } },
      RISK_ADD,
      RISK_LINK,
    ];
    await setFlag('false');
    const off = holdThenConfirm(ops);
    await setFlag('true');
    const on = holdThenConfirm(ops);
    expect(off.status).toBe('executed');
    expect(on.status).toBe('executed');
    if (off.status !== 'executed' || on.status !== 'executed') return;
    // Byte-identical: the canonicaliser is the IDENTITY on canonical ops,
    // including the (pre-existing) whole-object replace semantics.
    expect(on.mutatedGraph).toEqual(off.mutatedGraph);
    expect(nodeOf(on.mutatedGraph as Record<string, unknown>, 'fac_setup').observed_state).toEqual({
      value: 0.5,
    });
  });

  it('pure-structural hold: flag ON produces a graph IDENTICAL to flag OFF', async () => {
    const ops = [RISK_ADD, RISK_LINK];
    await setFlag('false');
    const off = holdThenConfirm(ops);
    await setFlag('true');
    const on = holdThenConfirm(ops);
    expect(off.status).toBe('executed');
    expect(on.status).toBe('executed');
    if (off.status !== 'executed' || on.status !== 'executed') return;
    expect(on.mutatedGraph).toEqual(off.mutatedGraph);
  });

  it('a non-value node field (description) is untouched by the canonicaliser', async () => {
    const ops = [
      { op: 'update_node', path: 'fac_setup', value: { description: 'Quarterly complexity' } },
      RISK_ADD,
      RISK_LINK,
    ];
    await setFlag('false');
    const off = holdThenConfirm(ops);
    await setFlag('true');
    const on = holdThenConfirm(ops);
    if (off.status !== 'executed' || on.status !== 'executed') {
      throw new Error('both must execute');
    }
    expect(on.mutatedGraph).toEqual(off.mutatedGraph);
  });
});

// ── the guard must still bite ───────────────────────────────────────────────

describe('R1 — atomicity doctrine: batchFullyLanded still refuses what it cannot land', () => {
  it('flag ON: an op in a spelling the canonicaliser does NOT translate still refuses the WHOLE batch', async () => {
    await setFlag('true');
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

  it('flag ON: a value op targeting an interventions path is NOT rewritten (that subtree has its own reader)', async () => {
    await setFlag('true');
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
