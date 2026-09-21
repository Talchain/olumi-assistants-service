/**
 * ROADMAP 2.478 (the add path bypasses the field-safety screen) + the
 * INTERVENTION-TUNNEL obligation banked from the schemas #34 review.
 *
 * TWO defects, one screen.
 *
 * 2.478 — `checkFieldSafety` screened only the two UPDATE kinds, and the
 * producer projects an `add_node` op down to `{id, kind, label}`. Everything
 * else on the add value (`AddNodeValue` in patch-validation.ts is
 * `.passthrough()`) reached the applier unscreened, so a producer could stamp
 * `observed_state.source: 'user'` on a NEW node and never meet the provenance
 * guard. The RED fixture is a NESTED smuggle: the pre-fix screen was
 * non-recursive, so the natural spelling — a stamp inside an object payload —
 * was the one that rode through.
 *
 * THE TUNNEL — inside the `interventions` subtree the smuggle guard exempted
 * the InterventionV3 contract keys, which is correct, but it did so over a FLAT
 * key set and screened nothing else there. Any key that is not an intervention
 * contract key rode through under `interventions.<factor_id>.*`. The six names
 * below are the ones CEE OWNS elsewhere and had no reader there — zero blast
 * radius by construction (trap 10), and exactly the kind of "harmless today"
 * hole a future reader turns into a provenance breach. They die at the
 * executor's contract screen, which is DERIVED from `InterventionV3.shape`.
 */
import { describe, it, expect } from 'vitest';
import {
  PIPELINE_OWNED_ROOTS,
  INTERVENTION_CONTRACT_KEYS,
  CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST,
  checkFieldSafety,
} from '../field-safety.js';
import { refereeMutation } from '../referee.js';
import { CandidateMutationEnvelopeV1 } from '../types.js';
import { FIELD_NOT_ALLOWED, PIPELINE_OWNED_FIELD, STRUCTURAL_APPLY_HELD } from '../reason-codes.js';
import { editOperationsToCandidateEnvelopes } from '../adapters/edit-graph-producer.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from './fixtures.js';

const G = buildReadyGraph();

function addNode(screened: Record<string, unknown> | undefined) {
  return refereeMutation(
    makeEnvelope(
      'add_node',
      {
        node: { id: 'n-new', kind: 'factor', label: 'New factor' },
        ...(screened === undefined ? {} : { screened_value: screened }),
      },
      { base_graph_hash: hashOf(G) },
    ),
    G,
    frameFor(G),
  );
}

function nodeUpdate(field: string, to: unknown) {
  return refereeMutation(
    makeEnvelope(
      'update_node_field',
      { node_id: 'f-spend', field, from: null, to },
      { base_graph_hash: hashOf(G) },
    ),
    G,
    frameFor(G),
  );
}

/**
 * THE SIX ZERO-READER SMUGGLE NAMES, DERIVED — not listed.
 *
 *   CEE_ANALYSIS_OWNED_ROOTS \ INTERVENTION_CONTRACT_KEYS
 *
 * i.e. the names CEE owned at the time the tunnel was found, minus the ones the
 * interventions exemption legitimately lets past. `source` and `raw_value` are
 * absent from this set BY CONSTRUCTION, not by oversight: they ARE intervention
 * contract keys (`InterventionV3.shape`), which is why the exemption exists at
 * all and why the live option-configure write still works.
 *
 * The J2 union adds five MORE names the tunnel would also have carried
 * (`threshold_source` + the four edge `*Source` stamps) — asserted separately
 * below so "six" stays the historical, reviewable figure rather than a number
 * that silently drifts with the union.
 *
 * The corpus half spells the same six out by hand
 * (`field-safety-corpus.test.ts`) — deriving them here proves the screen and
 * the contract agree; spelling them there is what would notice the CONTRACT
 * itself changing shape underneath.
 */
const SMUGGLE_NAMES = [...CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST]
  .filter((k) => !INTERVENTION_CONTRACT_KEYS.has(k))
  .sort();

describe('the six zero-reader smuggle names — enumerated at the bytes', () => {
  it('is exactly the CEE-owned names that are NOT intervention contract keys', () => {
    expect(SMUGGLE_NAMES).toEqual([
      'defaulted',
      'extractiontype',
      'origin',
      'provenance',
      'provenance_display',
      'validation',
    ]);
  });

  it('`source` and `raw_value` are excluded because they ARE contract keys (not an oversight)', () => {
    expect(INTERVENTION_CONTRACT_KEYS.has('source')).toBe(true);
    expect(INTERVENTION_CONTRACT_KEYS.has('raw_value')).toBe(true);
    expect(PIPELINE_OWNED_ROOTS.has('source')).toBe(true);
    expect(PIPELINE_OWNED_ROOTS.has('raw_value')).toBe(true);
  });

  it('the J2 union adds five MORE names the same screen now kills (11 total, not 6)', () => {
    const all = [...PIPELINE_OWNED_ROOTS].filter((k) => !INTERVENTION_CONTRACT_KEYS.has(k)).sort();
    expect(all.length).toBe(11);
    expect(all.filter((k) => !SMUGGLE_NAMES.includes(k))).toEqual([
      'beliefexistssource',
      'directionsource',
      'strengthstdsource',
      'threshold_source',
      'weightsource',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2.478 — the add path is screened, recursively
// ---------------------------------------------------------------------------

describe('2.478 — the add path screen is RECURSIVE (the nested spelling is the RED fixture)', () => {
  it('an add carrying a NESTED provenance stamp is REJECTED (the bycatch defect)', () => {
    const v = addNode({ observed_state: { value: 0.4, source: 'user' } });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('an add carrying a stamp TWO objects deep is REJECTED (depth-1 screening would miss it)', () => {
    const v = addNode({ meta: { deep: { extractionType: 'explicit' } } });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('an add carrying a stamp inside an ARRAY element is REJECTED', () => {
    const v = addNode({ notes: [{ ok: 1 }, { validation: { passed: true } }] });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('every one of the six smuggle names is refused on the add path, nested', () => {
    for (const name of SMUGGLE_NAMES) {
      const v = addNode({ observed_state: { value: 1, [name]: 'x' } });
      expect(v.blocker?.code, `nested add smuggle: ${name}`).toBe(PIPELINE_OWNED_FIELD);
    }
  });

  it('a clean structural add still reaches its HELD verdict (no capability revoked)', () => {
    const v = addNode({ observed_state: { value: 0.4, unit: 'GBP' }, description: 'A new factor' });
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  it('an identity-only add is unchanged (screened_value absent → nothing to screen)', () => {
    const v = addNode(undefined);
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });
});

describe('2.478 — the producer CARRIES the add value so the screen can see it', () => {
  const ctx = {
    base_graph_hash: 'h',
    scenario_id: 's',
    turn_id: 't',
    makeCandidateId: () => '11111111-1111-4111-8111-111111111111',
  };

  it('add_node projects the non-identity value keys into `screened_value`', () => {
    const [env] = editOperationsToCandidateEnvelopes(
      [
        {
          op: 'add_node',
          path: 'n-new',
          value: { id: 'n-new', kind: 'factor', label: 'L', observed_state: { value: 1, source: 'user' } },
        },
      ],
      ctx,
    ) as Array<{ payload: { node: unknown; screened_value?: Record<string, unknown> } }>;
    expect(env.payload.screened_value).toEqual({ observed_state: { value: 1, source: 'user' } });
    // Identity stays exactly where it was — the reviewable unit is unchanged.
    expect(env.payload.node).toEqual({ id: 'n-new', kind: 'factor', label: 'L' });
  });

  it('add_edge projects the non-identity value keys too (carried for the follow-up slice)', () => {
    const [env] = editOperationsToCandidateEnvelopes(
      [
        {
          op: 'add_edge',
          path: 'a::b',
          value: { from: 'a', to: 'b', strength: { mean: 0.5, std: 0.1 }, origin: 'user' },
        },
      ],
      ctx,
    ) as Array<{ payload: { screened_value?: Record<string, unknown> } }>;
    expect(env.payload.screened_value).toEqual({
      strength: { mean: 0.5, std: 0.1 },
      origin: 'user',
    });
  });

  it('an identity-only add emits NO `screened_value` key (byte-identical to the old envelope)', () => {
    const [env] = editOperationsToCandidateEnvelopes(
      [{ op: 'add_node', path: 'n-new', value: { id: 'n-new', kind: 'factor', label: 'L' } }],
      ctx,
    ) as Array<{ payload: Record<string, unknown> }>;
    expect(Object.keys(env.payload)).toEqual(['node']);
  });

  it('the produced envelope with a smuggled stamp parses, then is REJECTED by the screen', () => {
    const [raw] = editOperationsToCandidateEnvelopes(
      [
        {
          op: 'add_node',
          path: 'n-new',
          value: { id: 'n-new', kind: 'factor', label: 'L', observed_state: { value: 1, source: 'user' } },
        },
      ],
      { ...ctx, base_graph_hash: hashOf(G) },
    );
    // R1 must ACCEPT it (a screening field is part of the contract, not an
    // unknown key), and R4 must REFUSE it — an R1 rejection here would pass
    // this test for the wrong reason.
    const parsed = CandidateMutationEnvelopeV1.safeParse(raw);
    expect(parsed.success).toBe(true);
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });
});

describe('2.478 — the `add_edge` residual is PINNED OPEN, not assumed closed', () => {
  /**
   * ⚠ MEASURED, and the reason this is a residual rather than a fix: applying
   * the node screen to edge adds revokes a LIVE capability. The deterministic
   * add-option transaction stamps `provenance: { source: 'user_specified' }` on
   * every structural edge it builds, and the producer labels EVERY envelope
   * `edit_graph_llm` — so the referee cannot distinguish CEE's own chip-driven
   * constructor from a model forging the same field. Closing it needs producer
   * identity on the envelope, or an `EdgeProvenanceV3`-derived context rule.
   *
   * This test states the gap in executable form. When the follow-up slice
   * lands, it REDs — which is the point: a residual nobody can forget.
   */
  it('an edge add carrying an owned stamp is currently ACCEPTED (the open half of 2.478)', () => {
    const v = refereeMutation(
      makeEnvelope(
        'add_edge',
        {
          edge: { from: 'f-spend', to: 'g-profit' },
          screened_value: { origin: 'user', defaulted: true },
        },
        { base_graph_hash: hashOf(G) },
      ),
      G,
      frameFor(G),
    );
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  it('the live deterministic edge-creation shape is NOT refused (what the residual protects)', () => {
    const v = refereeMutation(
      makeEnvelope(
        'add_edge',
        {
          edge: { from: 'f-spend', to: 'g-profit' },
          screened_value: {
            strength: { mean: 1, std: 0.1 },
            exists_probability: 1,
            effect_direction: 'positive',
            provenance: { source: 'user_specified' },
          },
        },
        { base_graph_hash: hashOf(G) },
      ),
      G,
      frameFor(G),
    );
    expect(v.blocker?.code).not.toBe(PIPELINE_OWNED_FIELD);
  });
});

describe('2.478 — `screened_value` is SCREENING-ONLY (nothing applies it)', () => {
  it('the candidate graph built for a clean add carries only the identity triple', () => {
    // add_node is held, so the candidate is built for the intra-batch working
    // view. It must not have absorbed the screened value.
    const v = refereeMutation(
      makeEnvelope(
        'add_node',
        {
          node: { id: 'n-new', kind: 'factor', label: 'New factor' },
          screened_value: { description: 'ignored by the builder', observed_state: { value: 9 } },
        },
        { base_graph_hash: hashOf(G) },
      ),
      G,
      frameFor(G),
    );
    expect(v.verdict).toBe('held');
    const candidate = v.candidate as { nodes?: Array<Record<string, unknown>> } | undefined;
    const added = candidate?.nodes?.find((n) => n.id === 'n-new');
    if (added !== undefined) {
      expect(Object.keys(added).sort()).toEqual(['id', 'kind', 'label']);
    }
  });
});

// ---------------------------------------------------------------------------
// The intervention tunnel — the executor validates against InterventionV3
// ---------------------------------------------------------------------------

describe('the intervention tunnel — every non-contract key inside a spec is refused', () => {
  it('the contract key set is DERIVED from InterventionV3.shape (+ cap), never mirrored', () => {
    expect(INTERVENTION_CONTRACT_KEYS.has('value')).toBe(true);
    expect(INTERVENTION_CONTRACT_KEYS.has('target_match')).toBe(true);
    expect(INTERVENTION_CONTRACT_KEYS.has('encoding_map')).toBe(true);
    expect(INTERVENTION_CONTRACT_KEYS.has('cap')).toBe(true);
    expect(INTERVENTION_CONTRACT_KEYS.has('observed_state')).toBe(false);
  });

  for (const name of SMUGGLE_NAMES) {
    it(`\`${name}\` dies inside \`data/interventions/<factor_id>\` (spec level, UPDATE path)`, () => {
      const v = nodeUpdate('data/interventions/f-spend', { value: 1, [name]: 'x' });
      expect(v.verdict).toBe('rejected');
      expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
    });

    it(`\`${name}\` dies inside a whole \`interventions\` map write`, () => {
      const v = nodeUpdate('interventions', { 'f-spend': { value: 1, [name]: 'x' } });
      expect(v.verdict).toBe('rejected');
      expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
    });

    it(`\`${name}\` dies inside an interventions subtree on the ADD path`, () => {
      const v = addNode({ interventions: { 'f-spend': { value: 1, [name]: 'x' } } });
      expect(v.verdict).toBe('rejected');
      expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
    });
  }

  it('a NON-owned, non-contract key inside a spec is refused as FIELD_NOT_ALLOWED', () => {
    // The newly reachable branch: before the contract screen this key rode
    // through entirely (it is not owned, so the flat guard had no rule for it).
    // Its reason is honestly "not an allowed field", not "pipeline-owned".
    for (const probe of [
      () => nodeUpdate('data/interventions/f-spend', { value: 1, invented_key: 'x' }),
      () => nodeUpdate('interventions', { 'f-spend': { value: 1, invented_key: 'x' } }),
      () => addNode({ interventions: { 'f-spend': { value: 1, invented_key: 'x' } } }),
    ]) {
      const v = probe();
      expect(v.verdict).toBe('rejected');
      expect(v.blocker?.code).toBe(FIELD_NOT_ALLOWED);
    }
  });

  it('a BURIED `observed_state.source` object inside a spec is refused (review attack A2)', () => {
    // `observed_state` is not a contract key and not owned → FIELD_NOT_ALLOWED.
    // At pristine this shape was ACCEPTED: the flat guard exempted `source`
    // anywhere in an interventions payload, and `observed_state` had no rule.
    const v = nodeUpdate('data/interventions/f-spend', {
      value: 1,
      observed_state: { source: 'user' },
    });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(FIELD_NOT_ALLOWED);
  });

  it('a PATH that descends into a non-contract key of a spec is refused (the path-level twin)', () => {
    const v = nodeUpdate('data/interventions/f-spend/observed_state', { source: 'user' });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(FIELD_NOT_ALLOWED);
  });

  it('a factor id is DATA, not vocabulary — an id colliding with an owned name is allowed', () => {
    // `vocabularySegments()` in the contract stops scanning at `interventions`
    // for the same reason: below it, the keys are factor IDS.
    const v = nodeUpdate('interventions', { origin: { value: 1 } });
    expect(v.blocker?.code).not.toBe(PIPELINE_OWNED_FIELD);
    expect(v.blocker?.code).not.toBe(FIELD_NOT_ALLOWED);
  });

  it('the LIVE option-configure vocabulary still passes (F1 lesson: never revoke it silently)', () => {
    for (const field of ['data/interventions/f-spend', 'observed_state.interventions']) {
      const payload =
        field === 'data/interventions/f-spend'
          ? { value: 25000, raw_value: 25000, unit: 'GBP', cap: 50000 }
          : { 'f-spend': { value: 25000, raw_value: 25000, unit: 'GBP', cap: 50000 } };
      const v = nodeUpdate(field, payload);
      expect(v.blocker?.code, field).not.toBe(PIPELINE_OWNED_FIELD);
      expect(v.blocker?.code, field).not.toBe(FIELD_NOT_ALLOWED);
    }
  });

  it('a full InterventionV3 payload (source + target_match) still passes', () => {
    const v = nodeUpdate('data/interventions/f-spend', {
      value: 25000,
      unit: 'GBP',
      source: 'user_specified',
      // The COMPLETE TargetMatch the live add-option transaction builds
      // (`routing/add-option-transaction.ts:246-253`). Its inner fields are
      // required by the contract and dereferenced unconditionally by every
      // reader (`cee/validation/v3-validator.ts` reads `.node_id` in eight
      // places, `.confidence` in one), so a partial one is not a live shape.
      target_match: { node_id: 'f-spend', match_type: 'exact_id', confidence: 'high' },
      value_confidence: 'high',
      reasoning: 'The brief states the budget.',
    });
    expect(v.blocker?.code).not.toBe(PIPELINE_OWNED_FIELD);
    expect(v.blocker?.code).not.toBe(FIELD_NOT_ALLOWED);
  });
});

describe('the intervention spec screen carries the contract TYPES, not just its keys', () => {
  /**
   * ⚠ CORRECTED CLAIM. An earlier version of this lane said "the key set is
   * what the contract can enforce here". That was false, and the correction is
   * measured below rather than argued. `InterventionV3.parse` is genuinely
   * unusable (`.passthrough()` accepts every smuggle; `value`/`target_match`
   * are required and would reject the live partial write) — but "parse or key
   * set" was a false pair. `z.object(InterventionV3.shape).partial().strict()`
   * gives the key set AND the types from the SAME derivation.
   *
   * These are the below-spec positions a key-only screen left open: the walk
   * stops at the spec level, so an OBJECT could ride in any scalar slot.
   */
  const BELOW_SPEC_TUNNELS: ReadonlyArray<readonly [string, unknown]> = [
    ['value', { extractionType: 'explicit' }],
    ['unit', { source: 'user' }],
    ['reasoning', { provenance: 'user_set' }],
    ['display_value', { origin: 'user' }],
    ['raw_value', { validation: {} }],
    ['encoding_map', { origin: { defaulted: true } }],
    ['source', { extractionType: 'x' }],
    ['value_confidence', { origin: 'user' }],
    ['value_type', { origin: 'user' }],
  ];

  for (const [key, smuggle] of BELOW_SPEC_TUNNELS) {
    it(`an object smuggled into the scalar slot \`${key}\` is refused`, () => {
      const v = nodeUpdate('data/interventions/f-spend', { value: 1, [key]: smuggle });
      expect(v.verdict).toBe('rejected');
      expect(v.blocker?.code).toBe(FIELD_NOT_ALLOWED);
    });
  }

  it('the contract ENUMS are enforced — a foreign `source` vocabulary is refused', () => {
    // `user_override` is the NODE-level user stamp, not an InterventionV3
    // source (`brief_extraction | cee_hypothesis | user_specified`).
    const v = nodeUpdate('data/interventions/f-spend', { value: 1, source: 'user_override' });
    expect(v.blocker?.code).toBe(FIELD_NOT_ALLOWED);
  });

  it('`cap` stays UNTYPED on purpose — the contract declares no type for it', () => {
    // `cap` is not in `InterventionV3.shape`; it rides the schema's passthrough
    // and comes from the edit prompt's DERIVED-FIELD RULE. The screen invents
    // no type it cannot derive, so a string cap is accepted exactly as before.
    for (const cap of [50000, '50k']) {
      const v = nodeUpdate('data/interventions/f-spend', { value: 1, cap });
      expect(v.blocker?.code, `cap=${String(cap)}`).not.toBe(FIELD_NOT_ALLOWED);
    }
  });

  it('DISCLOSED NARROWING — a PARTIAL `target_match` is now refused', () => {
    // `.partial()` is shallow, so `TargetMatch`'s own required fields stay
    // required. No live producer emits a partial one and every reader
    // dereferences `.node_id` unconditionally, so the direction is fail-safe —
    // but it IS a narrowing and it is pinned here rather than discovered later.
    const v = nodeUpdate('data/interventions/f-spend', {
      value: 1,
      target_match: { node_id: 'f-spend' },
    });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(FIELD_NOT_ALLOWED);
  });

  it('RESIDUAL, PINNED OPEN — `target_match.*` is the one below-spec position left', () => {
    // `TargetMatch` is `.passthrough()` in the contract, so the screen cannot
    // close this without inventing a rule the contract does not state. Zero
    // readers reach these positions, so blast radius is zero by construction
    // (trap 10). This test REDs the day the contract tightens.
    const v = nodeUpdate('data/interventions/f-spend', {
      value: 1,
      target_match: {
        node_id: 'f-spend',
        match_type: 'exact_id',
        confidence: 'high',
        extractionType: 'explicit',
      },
    });
    expect(v.blocker?.code).not.toBe(FIELD_NOT_ALLOWED);
    expect(v.blocker?.code).not.toBe(PIPELINE_OWNED_FIELD);
  });
});

// ---------------------------------------------------------------------------
// The "narrower-never-wider" residuals from the first-pass review
// ---------------------------------------------------------------------------

describe('residual — `strength.origin` (the referee is already narrower than the tool)', () => {
  it('is refused as PIPELINE_OWNED_FIELD (exact-segment match on a non-root segment)', () => {
    const v = refereeMutation(
      makeEnvelope(
        'update_edge_field',
        { from_node: 'f-spend', to_node: 'g-profit', field: 'strength.origin', from: null, to: 'user' },
        { base_graph_hash: hashOf(G) },
      ),
      G,
      frameFor(G),
    );
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('`origin_label` is NOT swept in — the screen stayed exact-segment, not substring', () => {
    const v = nodeUpdate('origin_label', 'x');
    expect(v.blocker?.code).toBe(FIELD_NOT_ALLOWED);
  });
});

describe('residual — nested UPDATE smuggles under every allowed root', () => {
  const allowedRoots = ['observed_state', 'prior', 'goal_constraints', 'encoding_map'];
  for (const root of allowedRoots) {
    it(`a provenance stamp nested under \`${root}\` is refused`, () => {
      const v = nodeUpdate(root, { nested: { provenance_display: 'user_set' } });
      expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
    });
  }

  it('a marker field under a non-observed root is refused (`prior.elasticity`)', () => {
    const v = nodeUpdate('prior.elasticity', 0.5);
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });
});

describe('residual — numeric bounds are enforced UPSTREAM of the referee, not by it', () => {
  /**
   * The tool schema enforces none of CEE's numeric refinements. That is
   * fail-safe ONLY because `handleEditGraph` validates ops against
   * `PatchOperationSchema` (which carries `refineNodeNumericBounds` /
   * `refineEdgeNumericBounds`) BEFORE the producer projects envelopes. This
   * pins the ordering claim rather than asserting it in prose: an
   * out-of-bounds value never becomes an envelope.
   */
  it('the referee itself does NOT screen numeric bounds (so the upstream gate is load-bearing)', () => {
    const v = nodeUpdate('observed_state.value', Number.POSITIVE_INFINITY);
    expect(v.blocker?.code).not.toBe(FIELD_NOT_ALLOWED);
    expect(v.blocker?.code).not.toBe(PIPELINE_OWNED_FIELD);
  });
});

describe('add_option — the interventions spec is already `.strict()` at R1', () => {
  it('an add_option intervention carrying a smuggled key is rejected at ENVELOPE PARSE', () => {
    const raw = makeEnvelope(
      'add_option',
      {
        option: {
          id: 'o-c',
          label: 'Plan C',
          parent_decision_id: 'd-choice',
          edges: [{ to_factor_id: 'f-spend' }],
          interventions: { 'f-spend': { value: 0.5, extractionType: 'explicit' } },
        },
      },
      { base_graph_hash: hashOf(G) },
    );
    expect(CandidateMutationEnvelopeV1.safeParse(raw).success).toBe(false);
  });
});

describe('direct-call surface — checkFieldSafety on a non-mutating kind is unchanged', () => {
  it('a clarification envelope is not affected by the add/intervention screens', () => {
    const raw = makeEnvelope(
      'clarification',
      { target_ref: 'f-spend', question: 'Which quarter?' },
      { base_graph_hash: hashOf(G) },
    );
    const parsed = CandidateMutationEnvelopeV1.parse(raw);
    expect(checkFieldSafety(parsed).ok).toBe(true);
  });
});
