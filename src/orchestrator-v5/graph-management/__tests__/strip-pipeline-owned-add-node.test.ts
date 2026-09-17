/**
 * ⭐ THE PRODUCT BUILT THE RIGHT CHANGE AND REFUSED IT — witnessed on a real
 * user session, one turn (CEE logs):
 *
 *   edit_graph.structural_edge_enforced   x3   option -> fac_morale(factor)
 *   v5.candidate_mutation.rejected  add_node  PIPELINE_OWNED_FIELD  governing_candidate: TRUE
 *   v5.candidate_mutation.rejected  add_edge  ENTITY_NOT_FOUND      governing_candidate: false  x4
 *
 * The user had spent three turns agreeing a team-morale risk was real and
 * unrepresented, then said "Update the model to reflect all of this, then."
 * The model produced exactly that edit. The `add_node` was refused because its
 * value carried a PIPELINE-OWNED field; the edge rejections are its ECHO —
 * `advanceBatchGraph` never materialises a REJECTED add, so every edge that
 * referenced the new node then failed R3 referential integrity. One rejection
 * governs the batch, so the user was told the model was unchanged.
 *
 * ⭐ AND OUR OWN PROMPT ASKS FOR THE FORBIDDEN FIELDS. The served `edit_graph`
 * prompt NAMES `provenance` and `raw_value` (verified against the served
 * bytes), and `PIPELINE_OWNED_ROOTS` refuses both — so the referee refuses the
 * whole candidate for doing what the prompt asked. (A stronger "we SHOW the
 * model these fields and then refuse them" claim was withdrawn as unproven at
 * the model-facing seam; see field-safety.ts. The contradiction above stands
 * without it.)
 *
 * THE FIX, precedented (`sanitiseOperations`'s legacy-field strip;
 * `canonicalise-value-ops.ts`'s `delete nextObserved.raw_value`): REWRITE the
 * op — drop the pipeline-owned keys and let the add proceed — rather than
 * refuse the batch. The keys were never the producer's to set, so dropping
 * them loses nothing the pipeline would have honoured; refusing loses the
 * user's whole edit.
 *
 * WHAT THIS SPEC PINS, in both directions:
 *  - the harm, reproduced through the SHIPPED chain (ops -> producer -> referee);
 *  - the fix, INCLUDING THE CASCADE (the edges are the user-visible outcome,
 *    the strip alone is only the symptom metric);
 *  - the strip is DERIVED from `PIPELINE_OWNED_ROOTS` (iterated, never listed);
 *  - the opposite direction: a genuinely invalid add is STILL refused, the
 *    sanctioned intervention vocabulary SURVIVES, and no other op kind moves.
 */
import { describe, it, expect } from 'vitest';
import {
  PIPELINE_OWNED_ROOTS,
  STRIP_EXEMPT_ROOTS_FOR_TEST,
  STRIPPABLE_OWNED_ROOTS_FOR_TEST,
  checkFieldSafety,
  stripPipelineOwnedFromAddOperations,
} from '../field-safety.js';
import { refereeMutationBatch } from '../referee.js';
import {
  ENTITY_NOT_FOUND,
  PIPELINE_OWNED_FIELD,
  FIELD_NOT_ALLOWED,
  ENGINE_CLAIM_IN_TEXT,
  STRUCTURAL_APPLY_HELD,
} from '../reason-codes.js';
import { editOperationsToCandidateEnvelopes } from '../adapters/edit-graph-producer.js';
import { parseEnvelope } from '../parse-envelope.js';
import type { CandidateMutationEnvelope } from '../types.js';
import { buildReadyGraph, frameFor, hashOf } from './fixtures.js';

const G = buildReadyGraph();
const NEW_ID = 'fac_morale';

/** A local structural stand-in for `PatchOperation` (no src/orchestrator coupling). */
interface OpLike {
  readonly op: string;
  readonly path: string;
  readonly value?: unknown;
}

/**
 * THE REAL BATCH, in the shape the live turn produced: one `add_node` for the
 * morale factor whose value mirrors a comparable node (exactly what the prompt
 * asks for), plus the structural edges that reference it.
 */
function moraleBatch(): OpLike[] {
  return [
    {
      op: 'add_node',
      path: NEW_ID,
      value: {
        kind: 'factor',
        label: 'Team morale',
        observed_state: {
          value: 0.3,
          // ⭐ A PROVENANCE STAMP THE SERVED PROMPT INVITES AND THE REFEREE
          // FORBIDS. `raw_value` is deliberately NOT here: it is the native
          // magnitude, it is never stripped, and an add carrying it still
          // refuses — pinned in its own block below.
          source: 'user_stated',
        },
        provenance: { source: 'edit_graph_llm', rationale: 'discussed over three turns' },
        extractionType: 'stated',
      },
    },
    { op: 'add_edge', path: 'o-a::fac_morale', value: { from: 'o-a', to: NEW_ID } },
    { op: 'add_edge', path: 'o-b::fac_morale', value: { from: 'o-b', to: NEW_ID } },
    {
      op: 'add_edge',
      path: 'fac_morale::g-profit',
      value: { from: NEW_ID, to: 'g-profit' },
    },
  ];
}

function refereeOver(operations: readonly OpLike[]) {
  let n = 0;
  const raw = editOperationsToCandidateEnvelopes(operations, {
    base_graph_hash: hashOf(G),
    scenario_id: 'scn-morale',
    turn_id: 'turn-morale',
    makeCandidateId: () => {
      n += 1;
      return `${'0'.repeat(7)}${n}-0000-4000-8000-000000000000`.slice(-36);
    },
  });
  return refereeMutationBatch(raw, G, frameFor(G));
}

/** The PARSED envelope the referee will actually screen for op `index`. */
function envelopeOf(operations: readonly OpLike[], index: number): CandidateMutationEnvelope {
  let n = 0;
  const raw = editOperationsToCandidateEnvelopes(operations, {
    base_graph_hash: hashOf(G),
    scenario_id: 'scn-morale',
    turn_id: 'turn-morale',
    makeCandidateId: () => {
      n += 1;
      return `${'0'.repeat(7)}${n}-0000-4000-8000-000000000000`.slice(-36);
    },
  });
  const parsed = parseEnvelope(raw[index]);
  if (!parsed.ok) throw new Error(`envelope ${index} did not parse`);
  return parsed.envelope;
}

describe('THE HARM — an add_node refused for a pipeline-owned field takes its edges with it', () => {
  it('reproduces the live rejection cascade through the shipped chain', () => {
    const verdicts = refereeOver(moraleBatch());

    expect(verdicts).toHaveLength(4);
    // The add is REJECTED for the field the prompt asked the model to mirror.
    expect(verdicts[0]!.verdict).toBe('rejected');
    expect(verdicts[0]!.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
    // ... and every edge that referenced the node it would have created is an
    // ECHO of that one rejection, not an independent fault.
    for (const v of verdicts.slice(1)) {
      expect(v.verdict).toBe('rejected');
      expect(v.blocker?.code).toBe(ENTITY_NOT_FOUND);
    }
  });
});

describe('THE FIX — strip the pipeline-owned keys, keep the edit', () => {
  it('the add_node is no longer rejected', () => {
    const { operations } = stripPipelineOwnedFromAddOperations(moraleBatch());
    const verdicts = refereeOver(operations);

    expect(verdicts[0]!.verdict).not.toBe('rejected');
    expect(verdicts[0]!.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  it('⭐ THE CASCADE RESOLVES — the edges now reach the node (the user-visible outcome)', () => {
    const { operations } = stripPipelineOwnedFromAddOperations(moraleBatch());
    const verdicts = refereeOver(operations);

    expect(verdicts).toHaveLength(4);
    // Not one ENTITY_NOT_FOUND anywhere in the batch.
    expect(verdicts.map((v) => v.blocker?.code).filter((c) => c === ENTITY_NOT_FOUND)).toEqual([]);
    // Every edge is held for confirmation — i.e. it RESOLVED against the
    // working view the add now advances.
    for (const v of verdicts.slice(1)) {
      expect(v.verdict).toBe('held');
      expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
    }
    // And nothing in the batch is rejected at all.
    expect(verdicts.filter((v) => v.verdict === 'rejected')).toEqual([]);
  });

  it('the surviving value keeps everything the model legitimately authored', () => {
    const { operations } = stripPipelineOwnedFromAddOperations(moraleBatch());
    const addValue = operations[0]!.value as Record<string, unknown>;

    expect(addValue.kind).toBe('factor');
    expect(addValue.label).toBe('Team morale');
    expect(addValue.observed_state).toEqual({ value: 0.3 });
    expect(addValue).not.toHaveProperty('provenance');
    expect(addValue).not.toHaveProperty('extractionType');
  });

  it('⭐ DISCRIMINATING PAIR — the same screen refuses the raw value and accepts the stripped one', () => {
    const before = envelopeOf(moraleBatch(), 0);
    const { operations } = stripPipelineOwnedFromAddOperations(moraleBatch());
    const after = envelopeOf(operations, 0);

    // The precondition is pinned IN-TEST: the unstripped envelope really does
    // trip the screen, so the acceptance below is the strip's doing and not a
    // screen that stopped discriminating.
    expect(checkFieldSafety(before).ok).toBe(false);
    expect(checkFieldSafety(before).code).toBe(PIPELINE_OWNED_FIELD);
    expect(checkFieldSafety(after).ok).toBe(true);
  });
});

describe('THE STRIP IS DERIVED, NEVER RE-LISTED', () => {
  it('every STRIPPABLE member of the owned set is removed from an add_node value', () => {
    const owned = [...STRIPPABLE_OWNED_ROOTS_FOR_TEST];
    // The set must be non-empty, or this whole block would pass vacuously.
    expect(owned.length).toBeGreaterThan(5);

    const value: Record<string, unknown> = { kind: 'factor', label: 'Probe' };
    for (const key of owned) value[key] = 'model-authored';

    const { operations } = stripPipelineOwnedFromAddOperations([
      { op: 'add_node', path: 'n-probe', value },
    ]);
    const out = operations[0]!.value as Record<string, unknown>;

    for (const key of owned) expect(out).not.toHaveProperty(key);
    // Contrast control: a NON-owned key in the same object survives.
    expect(out.label).toBe('Probe');
    expect(out.kind).toBe('factor');
  });

  it('removes an owned key at DEPTH, and under any casing', () => {
    const { operations } = stripPipelineOwnedFromAddOperations([
      {
        op: 'add_node',
        path: 'n-deep',
        value: {
          kind: 'factor',
          label: 'Deep',
          observed_state: { value: 1, nested: { PROVENANCE: 'x', keep: 'me' } },
          list: [{ Source: 'x', keep: 'me' }],
        },
      },
    ]);
    const out = operations[0]!.value as Record<string, unknown>;
    const observed = out.observed_state as Record<string, unknown>;
    const nested = observed.nested as Record<string, unknown>;

    expect(nested).not.toHaveProperty('PROVENANCE');
    expect(nested.keep).toBe('me');
    expect((out.list as Record<string, unknown>[])[0]).not.toHaveProperty('Source');
    expect((out.list as Record<string, unknown>[])[0]!.keep).toBe('me');
  });

  it('an op with nothing to strip is returned BY REFERENCE', () => {
    const op: OpLike = { op: 'add_node', path: 'n-clean', value: { kind: 'factor', label: 'Clean' } };
    const { operations, strippedKeyShapes } = stripPipelineOwnedFromAddOperations([op]);

    expect(operations[0]).toBe(op);
    expect(strippedKeyShapes).toEqual([]);
  });
});

describe('DISCLOSURE — what was dropped is reported, in a redaction-safe shape', () => {
  it('names the owned segment and masks every model-authored segment', () => {
    const { strippedKeyShapes } = stripPipelineOwnedFromAddOperations([
      {
        op: 'add_node',
        path: 'n-disclose',
        value: {
          kind: 'factor',
          label: 'Disclose',
          provenance: 'x',
          observed_state: { value: 1, source: 'user_stated' },
          model_authored_container: { extractionType: 'stated' },
        },
      },
    ]);

    // The owned segment is named — it is a CLOSED, CEE-OWNED vocabulary, never
    // model content, which is exactly why naming it does not breach §5.
    expect(strippedKeyShapes).toContain('provenance');
    expect(strippedKeyShapes).toContain('observed_state/source');
    // The model-authored container name is MASKED.
    expect(strippedKeyShapes).toContain('*/extractiontype');
    expect(strippedKeyShapes.join(' ')).not.toContain('model_authored_container');
  });

  it('a silent strip is impossible — something was dropped iff a shape is reported', () => {
    const clean = stripPipelineOwnedFromAddOperations([
      { op: 'add_node', path: 'n-a', value: { kind: 'factor', label: 'A' } },
    ]);
    const dirty = stripPipelineOwnedFromAddOperations([
      { op: 'add_node', path: 'n-b', value: { kind: 'factor', label: 'B', provenance: 'x' } },
    ]);

    expect(clean.strippedKeyShapes).toHaveLength(0);
    expect(clean.operations[0]).toBe(clean.operations[0]);
    expect(dirty.strippedKeyShapes.length).toBeGreaterThan(0);
  });
});

describe('⭐ THE OPPOSITE DIRECTION — the strip must not become a blanket accept', () => {
  it('a genuinely invalid add_node is STILL refused (non-contract intervention key)', () => {
    const verdicts = refereeOver(
      stripPipelineOwnedFromAddOperations([
        {
          op: 'add_node',
          path: 'o-new',
          value: {
            kind: 'option',
            label: 'Smuggler',
            interventions: { 'f-spend': { value: 0.5, not_a_contract_key: 'x' } },
          },
        },
      ]).operations,
    );

    expect(verdicts[0]!.verdict).toBe('rejected');
    expect(verdicts[0]!.blocker?.code).toBe(FIELD_NOT_ALLOWED);
  });

  it('an engine claim in an add_node label is STILL refused', () => {
    const verdicts = refereeOver(
      stripPipelineOwnedFromAddOperations([
        {
          op: 'add_node',
          path: 'n-claim',
          value: { kind: 'factor', label: 'Morale (EVPI driver)', provenance: 'x' },
        },
      ]).operations,
    );

    expect(verdicts[0]!.verdict).toBe('rejected');
    expect(verdicts[0]!.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
  });

  it('⭐ the SANCTIONED intervention vocabulary survives (ROADMAP 2.11 must not regress)', () => {
    const op: OpLike = {
      op: 'add_node',
      path: 'o-new',
      value: {
        kind: 'option',
        label: 'Raise price',
        // `raw_value` here is an InterventionV3 CONTRACT key, not a node
        // provenance stamp — the screen accepts it and the strip must not touch it.
        interventions: { 'f-spend': { value: 0.25, raw_value: 25000, unit: 'GBP', cap: 100000 } },
      },
    };
    const { operations, strippedKeyShapes } = stripPipelineOwnedFromAddOperations([op]);

    expect(operations[0]).toBe(op);
    expect(strippedKeyShapes).toEqual([]);
    expect(refereeOver(operations)[0]!.verdict).not.toBe('rejected');
  });

  it('a factor id that happens to spell an owned name is DATA, and survives', () => {
    const op: OpLike = {
      op: 'add_node',
      path: 'o-odd',
      value: {
        kind: 'option',
        label: 'Odd ids',
        interventions: { source: { value: 0.5 }, provenance: { value: 0.2 } },
      },
    };
    const { operations, strippedKeyShapes } = stripPipelineOwnedFromAddOperations([op]);

    expect(operations[0]).toBe(op);
    expect(strippedKeyShapes).toEqual([]);
  });
});

describe('⛔ `raw_value` IS DATA, NOT A STAMP — it is never stripped, and it still refuses', () => {
  it('the exempt set is EXACTLY {raw_value} — a widening of the owned set must force this decision again', () => {
    expect([...STRIP_EXEMPT_ROOTS_FOR_TEST]).toEqual(['raw_value']);
    // Derivation pin: strippable + exempt reconstitutes the owned set exactly,
    // so the exemption is a set DIFFERENCE and never a second hand-kept list.
    expect(
      [...STRIPPABLE_OWNED_ROOTS_FOR_TEST, ...STRIP_EXEMPT_ROOTS_FOR_TEST].sort(),
    ).toEqual([...PIPELINE_OWNED_ROOTS].sort());
    // `raw_value` really is in the owned set — without this the block is vacuous.
    expect(PIPELINE_OWNED_ROOTS.has('raw_value')).toBe(true);
    expect(STRIPPABLE_OWNED_ROOTS_FOR_TEST).not.toContain('raw_value');
  });

  it('⛔ a user-stated magnitude SURVIVES the strip — it is never silently deleted', () => {
    const op: OpLike = {
      op: 'add_node',
      path: 'f-hiring',
      value: {
        kind: 'factor',
        label: 'Hiring cost',
        // "add a factor for hiring cost, it's £80,000"
        observed_state: { value: 0.8, raw_value: 80000, unit: 'GBP', source: 'user_stated' },
      },
    };
    const { operations, strippedKeyShapes } = stripPipelineOwnedFromAddOperations([op]);
    const observed = (operations[0]!.value as Record<string, unknown>)
      .observed_state as Record<string, unknown>;

    // The stamp goes ...
    expect(strippedKeyShapes).toContain('observed_state/source');
    expect(observed).not.toHaveProperty('source');
    // ... and the USER'S NUMBER STAYS.
    expect(observed.raw_value).toBe(80000);
    expect(observed.unit).toBe('GBP');
    expect(observed.value).toBe(0.8);
  });

  it('⛔ and the add carrying it still REFUSES — visibly, rather than landing without the number', () => {
    const { operations } = stripPipelineOwnedFromAddOperations([
      {
        op: 'add_node',
        path: 'f-hiring',
        value: {
          kind: 'factor',
          label: 'Hiring cost',
          observed_state: { value: 0.8, raw_value: 80000 },
        },
      },
    ]);
    const verdicts = refereeOver(operations);

    expect(verdicts[0]!.verdict).toBe('rejected');
    expect(verdicts[0]!.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });
});

describe('SCOPE — add_node only', () => {
  it('leaves update_node_field ops untouched, so an owned field is still REFUSED there', () => {
    const ops: OpLike[] = [
      { op: 'update_node', path: 'f-spend', value: { observed_state: { source: 'user_stated' } } },
    ];
    const { operations, strippedKeyShapes } = stripPipelineOwnedFromAddOperations(ops);

    expect(operations[0]).toBe(ops[0]);
    expect(strippedKeyShapes).toEqual([]);
    expect(refereeOver(operations)[0]!.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('leaves add_edge values untouched', () => {
    const ops: OpLike[] = [
      {
        op: 'add_edge',
        path: 'o-a::f-spend',
        value: { from: 'o-a', to: 'f-spend', provenance: { source: 'user_specified' } },
      },
    ];
    const { operations, strippedKeyShapes } = stripPipelineOwnedFromAddOperations(ops);

    // add_edge is deliberately NOT screened by checkFieldSafety's add branch,
    // and the deterministic add-option transaction writes `provenance.source`
    // on every structural edge it builds. Touching it would revoke a live
    // capability — see field-safety.ts's add_edge exclusion note.
    expect(operations[0]).toBe(ops[0]);
    expect(strippedKeyShapes).toEqual([]);
  });

  it('leaves remove ops untouched', () => {
    const ops: OpLike[] = [{ op: 'remove_node', path: 'f-reach' }];
    expect(stripPipelineOwnedFromAddOperations(ops).operations[0]).toBe(ops[0]);
  });
});
