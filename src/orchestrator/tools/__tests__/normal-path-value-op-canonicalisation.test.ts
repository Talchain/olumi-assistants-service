/**
 * B5 — the NORMAL (non-held) edit path reported a value edit APPLIED while the
 * value was unchanged.
 *
 * ── The defect, reproduced at the bytes on staging HEAD 1063394 ───────────
 * The served edit prompt (`edit-graph-v6.ts` PATH SYNTAX) teaches
 * `/nodes/<id>/data/value`. `parseEditGraphResponse` turns that into the LIVE
 * op shape `{ op: 'update_node', path: 'fac_x', value: { 'data/value': 0.5 } }`.
 * `applyUpdateNode` is a shallow `Object.assign`, so the slash key is written
 * onto the node VERBATIM:
 *
 *   observed_state: { value: 0.2, baseline: 0.2, unit: 'index' }   ← UNCHANGED
 *   "data/value": 0.5                                              ← junk key
 *
 * The killer is what happened next: `GraphV3.safeParse(candidate).success`
 * returned TRUE — Zod STRIPS the unknown key rather than erroring — and
 * `handleEditGraph` then promoted the UNPARSED `candidateGraph`. So the
 * validation passed on a graph that was not the one persisted, and the turn
 * reported the edit applied with `observed_state.value` still at 0.2.
 *
 * PR #521 fixed exactly this spelling, but ONLY on the held/confirm path.
 *
 * ── What this file pins ───────────────────────────────────────────────────
 *  1. RED-first repro: the prompt-taught spelling actually moves the persisted
 *     `observed_state.value` (failed on HEAD — the value stayed 0.2).
 *  2. Falsy `0` is preserved (a naive truthiness guard drops it).
 *  3. `unit` / `raw_value` / `cap` siblings survive a value write (merge, not
 *     replace — PLoT's own `update_node` semantics).
 *  4. An UNTRANSLATABLE spelling REFUSES VISIBLY rather than silently
 *     succeeding. Strip-and-succeed is the defect; strip-and-refuse is honest.
 *  5. CONTROL: canonical-spelling ops are entirely unaffected.
 *  6. CONTROL: flag OFF reproduces the legacy behaviour byte-for-byte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { handleEditGraph } from '../edit-graph.js';
import { config } from '../../../config/index.js';
import type { ConversationContext } from '../../types.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';

// ── fixtures ────────────────────────────────────────────────────────────────

/** A VALID GraphV3 (the precondition Codex's repro used). */
function buildGraph() {
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Platform Migration' },
      { id: 'opt_a', kind: 'option', label: 'Migrate Now' },
      {
        id: 'fac_setup',
        kind: 'factor',
        label: 'Setup and Migration Complexity',
        observed_state: { value: 0.2, baseline: 0.2, unit: 'index' },
      },
      { id: 'goal_g', kind: 'goal', label: 'Total Cost' },
    ],
    edges: [
      { from: 'dec_x', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_setup', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_setup', to: 'goal_g', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  };
}

function buildContext(): ConversationContext {
  return {
    graph: buildGraph(),
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn-b5',
  } as unknown as ConversationContext;
}

/** Adapter stub returning ONE canned edit_graph response. */
function makeAdapter(responseJson: unknown): LLMAdapter {
  return {
    name: 'fixtures',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify(responseJson),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: 'test-model',
      latencyMs: 1,
      stopReason: 'end_turn',
    }),
  } as unknown as LLMAdapter;
}

function editResponse(operations: unknown[]) {
  return {
    operations,
    removed_edges: [],
    warnings: [],
    coaching: { summary: 'Updated.', rerun_recommended: true },
  };
}

/** The op the SERVED prompt's PATH SYNTAX produces for a value edit. */
function promptTaughtValueOp(value: unknown, oldValue: unknown = 0.2) {
  return {
    op: 'update_node',
    path: '/nodes/fac_setup/data/value',
    value,
    old_value: oldValue,
    impact: 'moderate',
    rationale: 'Set setup complexity as requested.',
  };
}

async function runEdit(responseJson: unknown, description = 'Set Setup and Migration Complexity to 0.5') {
  return handleEditGraph(
    buildContext(),
    description,
    makeAdapter(responseJson),
    'req-b5',
    'turn-b5',
  );
}

function factorOf(graph: unknown): Record<string, unknown> {
  const nodes = (graph as { nodes: Array<Record<string, unknown>> }).nodes;
  return nodes.find((n) => n.id === 'fac_setup')!;
}

function observedOf(graph: unknown): Record<string, unknown> {
  return factorOf(graph).observed_state as Record<string, unknown>;
}

// ── flag control ────────────────────────────────────────────────────────────

const FLAG = 'valueOpCanonicalisationEnabled' as const;
let originalFlag: boolean;

beforeEach(() => {
  originalFlag = config.cee[FLAG];
  (config.cee as Record<string, unknown>)[FLAG] = true;
});

afterEach(() => {
  (config.cee as Record<string, unknown>)[FLAG] = originalFlag;
  vi.restoreAllMocks();
});

// ── 1. The repro (RED on HEAD) ──────────────────────────────────────────────

describe('B5 — prompt-taught `data/value` on the NORMAL edit path', () => {
  it('MOVES the persisted observed_state.value (RED on HEAD: it stayed 0.2)', async () => {
    const result = await runEdit(editResponse([promptTaughtValueOp(0.5)]));

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();

    const observed = observedOf(result.appliedGraph);
    // THE ASSERTION THAT FAILED ON HEAD.
    expect(observed.value).toBe(0.5);
  });

  it('persists NO junk slash key — the promoted graph is the PARSED canonical one', async () => {
    const result = await runEdit(editResponse([promptTaughtValueOp(0.5)]));

    const node = factorOf(result.appliedGraph);
    // On HEAD the UNPARSED candidate was promoted, so this key was persisted.
    expect(Object.keys(node)).not.toContain('data/value');
    expect(node).not.toHaveProperty('data/value');
  });

  it('preserves a FALSY 0 (a truthiness guard would drop it)', async () => {
    const result = await runEdit(
      editResponse([promptTaughtValueOp(0)]),
      'Set Setup and Migration Complexity to 0',
    );

    expect(result.wasRejected).toBe(false);
    const observed = observedOf(result.appliedGraph);
    expect(observed.value).toBe(0);
    expect(observed.value).not.toBeUndefined();
  });

  it('MERGES onto observed_state — unit/baseline siblings survive the value write', async () => {
    const result = await runEdit(editResponse([promptTaughtValueOp(0.5)]));

    const observed = observedOf(result.appliedGraph);
    expect(observed.value).toBe(0.5);
    // Merge-not-replace: the siblings the op never mentioned are still there.
    expect(observed.unit).toBe('index');
    expect(observed.baseline).toBe(0.2);
  });
});

// ── 2. Honest refusal for what cannot be translated ─────────────────────────

describe('B5 — untranslatable spellings REFUSE VISIBLY (never strip-and-succeed)', () => {
  it('refuses a value write to an unknown observed sub-key rather than reporting success', async () => {
    // `made_up_leaf` is not in the referee's ALLOWED_OBSERVED_SUBKEYS, so the
    // canonicaliser leaves it verbatim and the parse strips it. The landed-op
    // postcondition must catch that and refuse — the whole point of B5 is that
    // a stripped write can no longer be reported as applied.
    const result = await runEdit(
      editResponse([
        {
          op: 'update_node',
          path: '/nodes/fac_setup/data/made_up_leaf',
          value: 0.5,
          old_value: null,
          impact: 'moderate',
          rationale: 'Unknown spelling.',
        },
      ]),
    );

    // Visible refusal, not a silent success.
    expect(result.wasRejected).toBe(true);
    expect(result.appliedGraph).toBeNull();
  });

  it('refuses the WHOLE batch when one op cannot land (no silent partial)', async () => {
    const result = await runEdit(
      editResponse([
        promptTaughtValueOp(0.5),
        {
          op: 'update_node',
          path: '/nodes/fac_setup/data/made_up_leaf',
          value: 0.9,
          old_value: null,
          impact: 'moderate',
          rationale: 'Unknown spelling alongside a good op.',
        },
      ]),
    );

    expect(result.wasRejected).toBe(true);
    expect(result.appliedGraph).toBeNull();
  });
});

// ── 3. The parsed-vs-candidate promotion, pinned where it DISCRIMINATES ─────

describe('B5 — the promoted graph is the PARSED one (intervention path)', () => {
  /**
   * This is the case that actually pins fix part 2, and it took a
   * mutation-check to find it: for a plain value op the canonicaliser has
   * already rewritten the payload into a DECLARED field, so raw and parsed
   * agree and promoting either one passes. The intervention subtree is where
   * they genuinely differ — `canonicaliseValueOps` deliberately leaves
   * `data/interventions/<factor_id>` VERBATIM (its owner,
   * `encodeOptionInterventionsForEdit`, reads that exact spelling off the
   * applied graph), so the raw candidate still carries the slash key after the
   * encoder has promoted it to canonical top-level `interventions`.
   *
   * Promote the raw candidate and that junk key is persisted; promote the
   * parsed graph and it is not. Reverting `appliedGraph = canonicalApplied`
   * to `appliedGraph = rawApplied` turns THIS test red — and nothing else.
   */
  const INTERVENTION_GRAPH = {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Platform Migration' },
      { id: 'opt_a', kind: 'option', label: 'Migrate Now' },
      {
        id: 'fac_setup',
        kind: 'factor',
        label: 'Setup and Migration Complexity',
        observed_state: { value: 0.2, raw_value: 500000, unit: '£', cap: 2500000 },
      },
      { id: 'goal_g', kind: 'goal', label: 'Total Cost' },
    ],
    edges: [
      { from: 'dec_x', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_setup', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_setup', to: 'goal_g', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  };

  async function runInterventionEdit() {
    const ctx = {
      graph: INTERVENTION_GRAPH,
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: 'scn-b5-int',
    } as unknown as ConversationContext;

    return handleEditGraph(
      ctx,
      'Configure the migrate-now option setup cost to 2000000',
      makeAdapter(
        editResponse([
          {
            op: 'update_node',
            path: '/nodes/opt_a/data/interventions/fac_setup',
            value: { value: 0.8, raw_value: 2000000, unit: '£', cap: 2500000 },
            old_value: null,
            impact: 'moderate',
            rationale: 'Configure the setup cost intervention.',
          },
        ]),
      ),
      'req-b5-int',
      'turn-b5-int',
      // An option-configuration edit is classified `option_configuration` and
      // routed to propose-and-confirm, which returns BEFORE the apply. The
      // confirm is the live continuation of that flow and is the path that
      // reaches `applyPatchOperations`, so that is what we drive here.
      { invocationInput: { confirmation_mode: 'apply_pending_proposal' } } as Parameters<typeof handleEditGraph>[5],
    );
  }

  /**
   * The case that DOES discriminate promotion. `add_node` spreads the op value
   * onto the new node, and `NodeV3` declares no `data` field — so a node added
   * with `data: {...}` (the shape `normaliseEditOpsForPlot` itself produces by
   * renaming `observed_state` → `data`) carries that key on the raw candidate
   * and loses it to the parse. The postcondition's `add_node` arm checks
   * PRESENCE only, so it passes either way.
   *
   * Promote the raw candidate and the junk `data` key is persisted onto the
   * graph the UI and analysis read; promote the parsed graph and it is not.
   *
   * (Separately: the value inside that `data` is LOST on both sides — a real
   * add_node defect this lane found but deliberately did not widen scope to
   * fix, because the postcondition arm that would catch it would begin
   * refusing every add-node-with-initial-value edit. Reported, not silently
   * absorbed.)
   */
  it('persists NO undeclared `data` key from an add_node (pins the parsed promotion)', async () => {
    const ctx = {
      graph: INTERVENTION_GRAPH,
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: 'scn-b5-add',
    } as unknown as ConversationContext;

    const result = await handleEditGraph(
      ctx,
      'Add a data quality risk that affects total cost',
      makeAdapter(
        editResponse([
          {
            op: 'add_node',
            path: '/nodes/fac_risk',
            value: {
              id: 'fac_risk',
              kind: 'factor',
              label: 'Data Quality Risk',
              data: { value: 0.4, unit: 'index' },
            },
            old_value: null,
            impact: 'moderate',
            rationale: 'Add the risk factor.',
          },
          {
            op: 'add_edge',
            path: '/edges/opt_a->fac_risk',
            value: { from: 'opt_a', to: 'fac_risk', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
            old_value: null,
            impact: 'moderate',
            rationale: 'Wire the option to the risk.',
          },
          {
            op: 'add_edge',
            path: '/edges/fac_risk->goal_g',
            value: { from: 'fac_risk', to: 'goal_g', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
            old_value: null,
            impact: 'moderate',
            rationale: 'Wire the risk to the goal.',
          },
        ]),
      ),
      'req-b5-add',
      'turn-b5-add',
    );

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();

    const nodes = (result.appliedGraph as unknown as { nodes: Array<Record<string, unknown>> }).nodes;
    const added = nodes.find((n) => n.id === 'fac_risk')!;
    expect(added).toBeDefined();

    // THE DISCRIMINATOR: fails if `appliedGraph = rawApplied` is promoted.
    expect(added).not.toHaveProperty('data');
  });

  it('lands the intervention canonically AND persists no slash-keyed residue', async () => {
    const result = await runInterventionEdit();

    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();

    const nodes = (result.appliedGraph as unknown as { nodes: Array<Record<string, unknown>> }).nodes;
    const option = nodes.find((n) => n.id === 'opt_a')!;

    // The encoder did its job: canonical top-level interventions.
    const interventions = option.interventions as Record<string, unknown> | undefined;
    expect(interventions).toBeDefined();
    expect(interventions).toHaveProperty('fac_setup');

    // And the promoted graph is the PARSED one, so the slash key the encoder
    // read from is NOT persisted. This is the assertion that discriminates
    // fix part 2 — it fails if the raw candidate is promoted instead.
    expect(option).not.toHaveProperty('data/interventions/fac_setup');
    expect(Object.keys(option).some((k) => k.includes('/'))).toBe(false);
  });
});

// ── 4. Controls ─────────────────────────────────────────────────────────────

describe('B5 — controls: canonical spellings and flag-off are unaffected', () => {
  // NOT a control — this one surprised us. `/nodes/<id>/observed_state/value`
  // is the CANONICAL path spelling, yet `normalisePath` wraps it into the
  // literal key `{ 'observed_state/value': 0.7 }` just the same, so it ALSO
  // silently no-opped on HEAD. The exposure is the slash-wrapping, not the
  // `data` alias. Kept here because it is the case a reviewer is most likely
  // to assume was already safe.
  it('the CANONICAL `observed_state/value` spelling is ALSO fixed (it no-opped on HEAD too)', async () => {
    const result = await runEdit(
      editResponse([
        {
          op: 'update_node',
          path: '/nodes/fac_setup/observed_state/value',
          value: 0.7,
          old_value: 0.2,
          impact: 'moderate',
          rationale: 'Canonical spelling.',
        },
      ]),
    );

    expect(result.wasRejected).toBe(false);
    const observed = observedOf(result.appliedGraph);
    expect(observed.value).toBe(0.7);
    expect(observed.unit).toBe('index');
  });

  it('CONTROL — a purely structural edit is untouched by this lane', async () => {
    const result = await runEdit(
      editResponse([
        {
          op: 'update_node',
          path: '/nodes/fac_setup/label',
          value: 'Setup Complexity (revised)',
          old_value: 'Setup and Migration Complexity',
          impact: 'minor',
          rationale: 'Rename.',
        },
      ]),
      'Rename the setup factor',
    );

    expect(result.wasRejected).toBe(false);
    expect(factorOf(result.appliedGraph).label).toBe('Setup Complexity (revised)');
  });

  it('FLAG OFF — reproduces the legacy silent no-op byte-for-byte', async () => {
    (config.cee as Record<string, unknown>)[FLAG] = false;

    const result = await runEdit(editResponse([promptTaughtValueOp(0.5)]));

    // The legacy behaviour this lane is fixing: reported applied, value unmoved.
    // Pinned so the kill-switch is proven to actually restore the old path.
    expect(result.wasRejected).toBe(false);
    expect(observedOf(result.appliedGraph).value).toBe(0.2);
  });
});
