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
 *  6. CONTROL: the DEFECT MECHANISM is still present and visible — proven by
 *     driving the raw applier directly, so the assertions above cannot go
 *     vacuous.
 *
 * ── 2026-07-25: the gate is gone ────────────────────────────────────────────
 * This behaviour was gated on `CEE_VALUE_OP_CANONICALISATION`, default OFF and
 * never set on any Render service — so the defect described above was live on
 * 100% of real edits, and a sweep of every persisted graph found FOUR false
 * successes it caused. It is now unconditional.
 *
 * The two "flag OFF" tests this file used to carry were POSITIVE CONTROLS, not
 * decoration: they proved the junk key and the unmoved value were really there
 * to be seen, so that the absence assertions meant something. They have been
 * REPLACED (not deleted) with controls that drive `applyPatchOperations`
 * directly. Same discriminating power, no dependency on a switch that no longer
 * exists — and derived from the source of truth rather than from a flag.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { handleEditGraph } from '../edit-graph.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { applyPatchOperations } from '../../patch-applier.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
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

// ── no flag control ─────────────────────────────────────────────────────────
//
// This file used to drive `CEE_VALUE_OP_CANONICALISATION` through the real env
// var so a misspelling in the env→config mapping would fail loud. The mapping
// is gone with the gate, so there is nothing left to misspell — the behaviour
// is reached by calling `handleEditGraph`, which is what these tests already do.

afterEach(() => {
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

describe('B5 — the promoted graph is the PARSED one', () => {
  /**
   * ⚠ CORRECTED. An earlier version of this comment claimed the intervention
   * test below pins fix part 2. It does NOT, and the claim was refuted by
   * mutation-check: `encodeOptionInterventionsForEdit` DELETES its own slash
   * keys (`encode-option-interventions.ts:320-322`), so on the intervention
   * path the raw and parsed graphs agree and promoting either one passes.
   *
   * The sole discriminator for hunk 2 is the `add_node` test further down
   * (plus its flag-OFF positive control). The intervention test below is a
   * genuine REGRESSION GUARD for the ordering — the parse must run AFTER the
   * encoder, or the encoder loses the keys it reads — but it does not pin the
   * promotion itself. Keeping both, labelled for what each actually does.
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

  /**
   * POSITIVE CONTROL for the assertion above (trap 13).
   *
   * The `not.toHaveProperty('data')` test is an ABSENCE assertion, and an
   * absence assertion that cannot see a PRESENCE is vacuous. If `applyAddNode`
   * were ever hardened to drop undeclared keys, the absence would hold for a
   * reason that has nothing to do with the promotion, hunk 2 could be reverted,
   * and the suite would stay green.
   *
   * This control proves the key IS there to be seen.
   *
   * ⚠ 2026-07-25: it used to prove that by setting the flag OFF and showing the
   * legacy path persisted `data`. The flag is gone. Rather than delete the
   * control — which would leave the absence assertion above unable to fail for
   * the right reason — it is re-expressed one layer down, against the two
   * functions that actually produce the effect:
   *
   *   `applyPatchOperations`  WRITES the undeclared `data` key onto the node
   *   `GraphV3.safeParse`     STRIPS it
   *
   * That is the whole mechanism. If `applyAddNode` is ever hardened to drop
   * undeclared keys, THIS test goes red and tells you the absence assertion
   * above has gone vacuous — which is exactly what the flag-OFF version did.
   */
  it('POSITIVE CONTROL — the raw applier DOES write the undeclared `data` key', () => {
    const ops = [
      {
        op: 'add_node',
        path: 'fac_risk',
        value: {
          id: 'fac_risk',
          kind: 'factor',
          label: 'Data Quality Risk',
          data: { value: 0.4, unit: 'index' },
        },
      },
    ];

    const raw = applyPatchOperations(INTERVENTION_GRAPH as unknown as GraphV3T, ops as never);
    const rawAdded = raw.nodes.find((n) => n.id === 'fac_risk')! as Record<string, unknown>;

    // The PRESENCE the absence assertion above must be capable of seeing.
    expect(rawAdded).toHaveProperty('data');
    expect(rawAdded.data).toEqual({ value: 0.4, unit: 'index' });

    // …and the parse is what removes it — so promoting the parsed graph is the
    // thing that makes the absence true, not some unrelated hardening.
    const parsed = GraphV3.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const parsedAdded = parsed.data.nodes.find((n) => n.id === 'fac_risk')! as Record<string, unknown>;
    expect(parsedAdded).not.toHaveProperty('data');
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

    // No slash-keyed residue survives. ⚠ This does NOT discriminate hunk 2 —
    // the encoder deletes these keys itself (encode-option-interventions.ts:
    // 320-322), so it holds with either graph promoted. What it DOES guard is
    // the ORDERING: move the parse before the encoder and the encoder loses
    // the keys it reads, and this test goes red.
    expect(option).not.toHaveProperty('data/interventions/fac_setup');
    expect(Object.keys(option).some((k) => k.includes('/'))).toBe(false);
  });
});

// ── 4. The V5 H5 narrowed-base contract, which B5 must INHERIT not reverse ──

describe('B5 — a V3-INVALID base graph stays editable (H5 narrowing preserved)', () => {
  /**
   * The P1 an adversarial review caught, and the number nobody had measured.
   *
   * The synthesis block deliberately DECLINES to strict-parse when the BASE
   * graph is already V3-invalid: "the patch is not the cause of the defect and
   * refusing here would block legitimate edits". Without inheriting that
   * `baseValid` narrowing, the B5 block re-parses exactly the graph H5 chose
   * not to parse — so with the flag ON, ANY edit (even a rename) on such a
   * scenario returns SYNTHESIZED_GRAPH_INVALID and the scenario becomes
   * permanently uneditable, behind copy inviting a rephrase that can never work.
   *
   * This is NOT a hypothetical shape. CEE manufactures it: `buildStructuralFallback`
   * stamps `strength: { mean: 0, std: 0 }`, and CEE's own `EdgeStrengthV3.std`
   * rejects a non-positive std — so any fallback graph with ≥1 edge is a
   * V3-invalid base.
   */
  const INVALID_BASE = {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Platform Migration' },
      { id: 'opt_a', kind: 'option', label: 'Migrate Now' },
      { id: 'fac_setup', kind: 'factor', label: 'Setup Complexity', observed_state: { value: 0.2, unit: 'index' } },
      { id: 'goal_g', kind: 'goal', label: 'Total Cost' },
    ],
    edges: [
      // `std: 0` — exactly what buildStructuralFallback stamps, and exactly
      // what EdgeStrengthV3 rejects. This base does NOT strict-parse.
      { from: 'dec_x', to: 'opt_a', strength: { mean: 0, std: 0 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_setup', strength: { mean: 0, std: 0 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_setup', to: 'goal_g', strength: { mean: 0, std: 0 }, exists_probability: 1, effect_direction: 'negative' },
    ],
  };

  it('the fixture really IS V3-invalid (guard against the test silently going vacuous)', () => {
    expect(GraphV3.safeParse(INVALID_BASE).success).toBe(false);
  });

  it('flag ON — a benign rename still APPLIES on a V3-invalid base', async () => {
    const ctx = {
      graph: INVALID_BASE,
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: 'scn-b5-invalid',
    } as unknown as ConversationContext;

    const result = await handleEditGraph(
      ctx,
      'Rename the setup factor',
      makeAdapter(
        editResponse([
          {
            op: 'update_node',
            path: '/nodes/fac_setup/label',
            value: 'Setup Complexity (revised)',
            old_value: 'Setup Complexity',
            impact: 'minor',
            rationale: 'Rename.',
          },
        ]),
      ),
      'req-b5-invalid',
      'turn-b5-invalid',
    );

    // Must NOT be SYNTHESIZED_GRAPH_INVALID. The scenario stays editable.
    expect(result.wasRejected).toBe(false);
    expect(result.appliedGraph).not.toBeNull();
    expect(factorOf(result.appliedGraph).label).toBe('Setup Complexity (revised)');
  });
});

// ── 5. Controls ─────────────────────────────────────────────────────────────

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

  /**
   * POSITIVE CONTROL for the whole file (trap 13).
   *
   * ⚠ 2026-07-25: this REPLACES `FLAG OFF — reproduces the legacy silent no-op
   * byte-for-byte`, which set the kill-switch and pinned the defect so the
   * switch was proven to restore the old path. There is no switch any more, but
   * the control it provided is still needed: without it, "the value is 0.5"
   * could be true because the fixture was always going to end up at 0.5, and
   * every assertion in this file would be satisfied by an applier that ignored
   * the op entirely.
   *
   * So the defect mechanism is demonstrated directly instead. Feed the RAW,
   * uncanonicalised op — the exact shape the live pipeline emits — to
   * `applyPatchOperations` and observe the two halves of the false success:
   *
   *   1. `observed_state.value` does NOT move
   *   2. a dead root-level `data/value` key IS written
   *
   * This is the presence every absence in this file is measured against, and it
   * is the mechanism that produced four false successes in persisted data.
   */
  it('POSITIVE CONTROL — the raw op silently no-ops and leaves a dead junk key', () => {
    const rawOp = [{ op: 'update_node', path: 'fac_setup', value: { 'data/value': 0.5 } }];

    const raw = applyPatchOperations(buildGraph() as unknown as GraphV3T, rawOp as never);
    const node = raw.nodes.find((n) => n.id === 'fac_setup')! as Record<string, unknown>;

    // (1) the value the user asked for never reached the field that is read
    expect((node.observed_state as Record<string, unknown>).value).toBe(0.2);
    // (2) …it went to a root-level key with a slash in it instead
    expect(node['data/value']).toBe(0.5);

    // …and the parse silently STRIPS that key rather than erroring, which is
    // why the pre-fix code could report the edit applied.
    const parsed = GraphV3.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const parsedNode = parsed.data.nodes.find((n) => n.id === 'fac_setup')! as Record<string, unknown>;
    expect(parsedNode).not.toHaveProperty('data/value');
    expect((parsedNode.observed_state as Record<string, unknown>).value).toBe(0.2);
  });
});
