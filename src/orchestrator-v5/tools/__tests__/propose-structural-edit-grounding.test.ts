/**
 * ROADMAP 2.474 — THE GROUNDING VALIDATOR IS THE TRUST CORE (the 2.461 lesson).
 *
 * The property under test is not "does the validator work" but something
 * stronger and more specific: THE MODEL IS STRUCTURALLY INCAPABLE OF EDITING A
 * GRAPH IT MERELY IMAGINED. Every assertion below binds to a named id or a
 * named label — never to a value predicate another entity could satisfy
 * (CLAUDE.md trap 19) — because the defect class this guards against is
 * precisely "the right shape, the wrong object".
 *
 * For each rule the test asks the trap-13b question — what would have to be
 * true for this guard to PASS while the property FAILS? — and writes that case:
 *   · a batch where the invented id is NOT the first op (a validator that only
 *     checked op 1 would pass);
 *   · a batch whose OTHER ops are all perfectly grounded (a validator that
 *     filtered instead of rejecting would return the good ones and look fine);
 *   · a label echo that is absent rather than wrong (a guard treating "absent"
 *     as "fine" is a guard agreeing with itself).
 */
import { describe, expect, it } from 'vitest';

import {
  buildStructuralEditGrounding,
  validateProposedStructuralEdit,
  renderGroundingTable,
  buildProposeStructuralEditTool,
  PROPOSE_STRUCTURAL_EDIT_TOOL_NAME,
  STRUCTURAL_EDIT_OPS,
} from '../propose-structural-edit.js';
import { PROPOSAL_CAP } from '../../graph-management/types.js';
import { PatchOperationSchema } from '../../../orchestrator/patch-validation.js';
import { buildReadyGraph } from '../../graph-management/__tests__/fixtures.js';

const GRAPH = buildReadyGraph();
const OPTS = { maxPatchOperations: 15 } as const;

function grounding() {
  const g = buildStructuralEditGrounding(GRAPH);
  if (g === null) throw new Error('fixture graph must be groundable');
  return g;
}

/** A perfectly grounded, single-op batch — the control every case varies from. */
function groundedUpdateOfMarketingSpend() {
  return {
    op: 'update_node',
    path: 'f-spend',
    target_label: 'Marketing spend',
    value: { observed_state: { value: 0.7 } },
  };
}

describe('grounding table — built from the persisted graph, never from nothing', () => {
  it('carries every persisted node id with its label, bound id→label', () => {
    const g = grounding();
    expect([...g.nodeIds].sort()).toEqual(
      ['d-choice', 'f-reach', 'f-spend', 'g-profit', 'o-a', 'o-b'].sort(),
    );
    // Identity binding: the LABEL is read for the NAMED id, not "some node".
    expect(g.labelById.get('f-spend')).toBe('Marketing spend');
    expect(g.labelById.get('f-reach')).toBe('Audience reach');
  });

  it('returns null for an unreadable graph — and null is what stops the tool engaging (A5a)', () => {
    expect(buildStructuralEditGrounding(null)).toBeNull();
    expect(buildStructuralEditGrounding('not a graph')).toBeNull();
    expect(buildStructuralEditGrounding({ edges: [] })).toBeNull();
  });

  it('renders the FULL table — no paging, no summarisation (A12): every node id appears', () => {
    const rendered = renderGroundingTable(grounding());
    for (const id of grounding().nodeIds) expect(rendered).toContain(id);
    expect(rendered).toContain('f-spend | factor | Marketing spend');
  });

  it('the tool advert carries the table, so the model cannot be asked to edit a graph it was never shown', () => {
    const tool = buildProposeStructuralEditTool(grounding());
    expect(tool.name).toBe(PROPOSE_STRUCTURAL_EDIT_TOOL_NAME);
    expect(tool.description).toContain('f-spend | factor | Marketing spend');
    expect(tool.description).toContain('REJECTS THE WHOLE BATCH');
  });
});

describe('the op vocabulary is the canonical one (A1) — no second grammar', () => {
  it('every advertised op is a real PatchOperation discriminator, and every discriminator is advertised', () => {
    // DERIVED from the enforcing schema, both directions — the union assertion
    // that notices a new canonical op with no row here (trap 12d).
    const canonical = PatchOperationSchema.options
      .map((o) => o.shape.op.value)
      .sort();
    expect([...STRUCTURAL_EDIT_OPS].sort()).toEqual(canonical);
  });

  it('accepted operations carry ONLY canonical PatchOperation keys — the grounding echo is stripped', () => {
    const result = validateProposedStructuralEdit(
      { operations: [groundedUpdateOfMarketingSpend()] },
      grounding(),
      OPTS,
    );
    if (!result.ok) throw new Error(`expected acceptance, got ${result.code}`);
    expect(Object.keys(result.operations[0]!).sort()).toEqual(['op', 'path', 'value']);
    expect(result.operations[0]).not.toHaveProperty('target_label');
  });
});

describe('UNKNOWN ID ⇒ THE WHOLE BATCH IS REJECTED (cite-or-reject, applied to edits)', () => {
  it('an invented node id rejects the batch, and returns NO operations at all', () => {
    const result = validateProposedStructuralEdit(
      { operations: [{ op: 'update_node', path: 'f-imagined', target_label: 'Brand equity', value: { observed_state: { value: 0.5 } } }] },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNKNOWN_ENTITY_ID');
    expect(result.reason).toContain('f-imagined');
    // Reject, never repair: there is no `operations` key to salvage.
    expect(result).not.toHaveProperty('operations');
  });

  it('THE CASE THAT WOULD LET A FILTERING VALIDATOR PASS: 3 perfectly grounded ops + 1 invented id ⇒ nothing survives', () => {
    // A validator that dropped the bad op and kept the good ones would return
    // ok with 3 operations here, and every id-level check would "pass". That
    // is the exact shape in which a fabricated edit reaches a confirm chip the
    // user reads as being about something else.
    const result = validateProposedStructuralEdit(
      {
        operations: [
          groundedUpdateOfMarketingSpend(),
          { op: 'update_node', path: 'f-reach', target_label: 'Audience reach', value: { observed_state: { value: 0.6 } } },
          { op: 'update_node', path: 'f-hallucinated', target_label: 'Referral rate', value: { observed_state: { value: 0.2 } } },
          { op: 'remove_edge', path: 'f-spend::g-profit' },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNKNOWN_ENTITY_ID');
    expect(result.reason).toContain('f-hallucinated');
  });

  it('an invented EDGE rejects the batch, bound to the named endpoints', () => {
    const result = validateProposedStructuralEdit(
      { operations: [{ op: 'remove_edge', path: 'f-spend::f-reach' }] },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNKNOWN_ENTITY_ID');
    expect(result.reason).toContain('f-spend -> f-reach');
  });

  it('an add_edge to an invented endpoint rejects the batch', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'add_edge', path: 'f-spend::f-ghost', value: { from: 'f-spend', to: 'f-ghost' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNKNOWN_ENTITY_ID');
  });
});

describe('THE ID CAN HIDE IN `value` — every entity reference is grounded, not just `path`', () => {
  /**
   * ⚠ MEASURED DEFECT, reproduced at three rungs before this guard existed
   * (adversarial review of #823, and re-measured first-hand in this lane):
   *
   *   validator : 5/5 smuggle shapes returned ok:true
   *   gate,live : {"governing":"proceed","blockApply":false} — no hold, no chip
   *   end-to-end: update_node path='option_1'
   *               value={interventions:{ghost_factor:{value:0.9}}}
   *               -> wasRejected FALSE, and option_1.interventions became
   *                  {"ghost_factor":…} — the REAL intervention on factor_1 was
   *                  REPLACED, not merged.
   *
   * The validator read `path` and (for add_edge) `value.from`/`value.to`, and
   * copied `value` through verbatim — while the tool advert of the day declared
   * `value` as `additionalProperties: true` (2.655 has since closed it to a
   * declared field list, and the scan below is unaffected: it walks whatever
   * `value` actually carries, not what the advert says it may carry). So the
   * answer to "what would have to be true
   * for these tests to pass while the property fails?" was: THE ID IS IN A
   * FIELD THE VALIDATOR DOES NOT READ.
   *
   * This is the 2.461 fabrication class inside the tool built to kill it, and
   * it sits on the headline scenario's most natural composition — "give each
   * option its own driver" is naturally an option `update_node` carrying an
   * `interventions` map KEYED BY FACTOR ID, which was the one key family
   * nothing checked.
   */
  it('option interventions keyed by a GHOST factor id reject the batch', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          {
            op: 'update_node',
            path: 'o-a',
            target_label: 'Plan A',
            value: { interventions: { ghost_factor: { value: 0.9 } } },
          },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNKNOWN_ENTITY_ID');
    expect(result.reason).toContain('ghost_factor');
  });

  it('the SAME op with a REAL factor id passes — the guard rejects the ghost, not the shape', () => {
    // The discriminating half. Without it, a guard that simply banned
    // `interventions` would pass every test above while destroying the
    // capability (configuring an option IS writing an interventions map).
    const result = validateProposedStructuralEdit(
      {
        operations: [
          {
            op: 'update_node',
            path: 'o-a',
            target_label: 'Plan A',
            value: { interventions: { 'f-spend': { value: 0.9 } } },
          },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ['observed_state.interventions', { observed_state: { interventions: { ghost_factor: { value: 0.9 } } } }],
    ['data.interventions', { data: { interventions: { ghost_factor: { value: 0.9 } } } }],
  ])('a ghost id nested under %s rejects too — the scan is by KEY NAME at any depth', (_n, value) => {
    // Not a hand-listed set of paths: field-safety sanctions the intervention
    // subtree at `interventions`, `observed_state/interventions` AND
    // `data/interventions/<factor_id>`, so a path list would be a mirror of
    // that list and would drift from it (trap 12).
    const result = validateProposedStructuralEdit(
      { operations: [{ op: 'update_node', path: 'f-spend', target_label: 'Marketing spend', value }] },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNKNOWN_ENTITY_ID');
    expect(result.reason).toContain('ghost_factor');
  });

  it('an intervention keyed by a factor CREATED EARLIER IN THE BATCH is fine', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'add_node', path: 'f-new', value: { id: 'f-new', kind: 'factor', label: 'New driver' } },
          {
            op: 'update_node',
            path: 'o-a',
            target_label: 'Plan A',
            value: { interventions: { 'f-new': { value: 0.5 } } },
          },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(true);
  });

  it('an intervention keyed by a factor the batch REMOVES is REMOVED_ID_REUSED, by name', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'remove_node', path: 'f-reach', target_label: 'Audience reach' },
          {
            op: 'update_node',
            path: 'o-a',
            target_label: 'Plan A',
            value: { interventions: { 'f-reach': { value: 0.5 } } },
          },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('REMOVED_ID_REUSED');
  });

  it('add_node whose `value.id` disagrees with `path` is an identity CONFLICT, named as one', () => {
    // Two identity claims in one op. The producer treats `path` as
    // authoritative and the applier may not; either way the model must be told
    // precisely which field is wrong, or it will keep re-emitting the pair.
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'add_node', path: 'f-new', value: { id: 'ghost_node', kind: 'factor', label: 'New' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('VALUE_IDENTITY_CONFLICT');
    expect(result.reason).toContain('ghost_node');
  });

  it('add_node whose `value.id` AGREES with `path` is accepted — restating identity is not an error', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'add_node', path: 'f-new', value: { id: 'f-new', kind: 'factor', label: 'New' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(true);
  });

  it('update_edge rewriting `value.from`/`value.to` to ghosts is an identity CONFLICT', () => {
    // Edge identity is not updatable — the producer skips from/to on
    // update_edge, so these were inert downstream. Rejected anyway:
    // narrower-never-wider, and an inert smuggle today is a live one the day
    // the producer changes.
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'update_edge', path: 'f-spend::g-profit', value: { from: 'ghost_a', to: 'ghost_b', exists_probability: 0.5 } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('VALUE_IDENTITY_CONFLICT');
  });

  it('update_node carrying an `id` that disagrees with `path` is an identity CONFLICT', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'update_node', path: 'f-spend', target_label: 'Marketing spend', value: { id: 'g-profit', description: 'x' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('VALUE_IDENTITY_CONFLICT');
  });

  it('the tool advert TELLS the model that ids inside `value` are checked', () => {
    // A guard the model is not told about is a guard it will trip repeatedly,
    // and every trip costs the user the whole batch.
    //
    // ⚠ THIS ASSERTION USED TO READ `toContain('interventions')`, which was a
    // value predicate standing in for the property (trap 19): it passed on the
    // presence of one WORD, not on the advert making the claim. 2.655 closed
    // `value` to a declared field list, and a dynamic-key map cannot be
    // advertised under a rule that admits only `additionalProperties: false`,
    // so the field name left the advert while the RULE — which the validator
    // still enforces at any depth, `collectInterventionTargetIds` — stayed.
    // The old assertion would have gone red on a change that lost nothing, and
    // would have stayed green on a rewrite that dropped the rule and kept the
    // word. It now binds to the claim.
    const tool = buildProposeStructuralEditTool(grounding());
    expect(tool.description).toMatch(/ids inside `value` are checked/i);
    expect(tool.description).toMatch(/keyed by factor id/i);
    expect(tool.description).toMatch(/must be in the table above/i);
  });
});

describe('EXPLICIT CREATES are the only ungrounded ids allowed', () => {
  it('add_node introduces an id later ops may reference — the add-and-wire batch composes', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'add_node', path: 'f-referrals', value: { id: 'f-referrals', kind: 'factor', label: 'Referral rate' } },
          { op: 'add_edge', path: 'f-referrals::g-profit', value: { from: 'f-referrals', to: 'g-profit' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.operations.map((o) => o.path)).toEqual(['f-referrals', 'f-referrals::g-profit']);
  });

  it('a create that claims an EXISTING id is a collision, not a create', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'add_node', path: 'f-spend', value: { id: 'f-spend', kind: 'factor', label: 'Marketing spend v2' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('CREATED_ID_COLLIDES');
    expect(result.reason).toContain('f-spend');
  });

  it('two creates claiming the SAME new id collide (the second one, not the first)', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'add_node', path: 'f-new', value: { id: 'f-new', kind: 'factor', label: 'A' } },
          { op: 'add_node', path: 'f-new', value: { id: 'f-new', kind: 'factor', label: 'B' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('CREATED_ID_COLLIDES');
  });
});

describe('A5(d) — an id removed in a batch cannot come back in the same batch', () => {
  it('remove_node X then add_node X is REMOVED_ID_REUSED, with a reason precise enough not to loop on', () => {
    // The referee's working view deliberately never subtracts removes, so this
    // batch is a structural collision there — with generic collision copy the
    // model would keep re-emitting it. Caught here, by name.
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'remove_node', path: 'f-reach', target_label: 'Audience reach' },
          { op: 'add_node', path: 'f-reach', value: { id: 'f-reach', kind: 'factor', label: 'Audience reach (rebuilt)' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('REMOVED_ID_REUSED');
    expect(result.reason).toContain('f-reach');
  });

  it('an edge added to a node removed earlier in the batch is REMOVED_ID_REUSED, not UNKNOWN_ENTITY_ID', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'remove_node', path: 'f-reach', target_label: 'Audience reach' },
          { op: 'add_edge', path: 'f-spend::f-reach', value: { from: 'f-spend', to: 'f-reach' } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('REMOVED_ID_REUSED');
  });
});

describe('A5(c) DUAL IDENTITY BINDING — the label echo catches wrong-id-right-shape (trap 19)', () => {
  it('an op naming f-spend while echoing ANOTHER real node’s label is rejected', () => {
    // Both ids are real and both labels are real: every id-level check passes.
    // Only the PAIRING is wrong — which is exactly the failure a duplicate- or
    // similar-label graph produces, and exactly what a value predicate would
    // miss.
    const result = validateProposedStructuralEdit(
      {
        operations: [
          { op: 'update_node', path: 'f-spend', target_label: 'Audience reach', value: { observed_state: { value: 0.9 } } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('LABEL_ID_MISMATCH');
    expect(result.reason).toContain('f-spend');
    expect(result.reason).toContain('Marketing spend');
  });

  it('THE GUARD-AGREEING-WITH-ITSELF CASE: an ABSENT echo is a mismatch, not a pass', () => {
    const result = validateProposedStructuralEdit(
      { operations: [{ op: 'update_node', path: 'f-spend', value: { observed_state: { value: 0.9 } } }] },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('LABEL_ID_MISMATCH');
  });

  it('remove_node is bound the same way — the destructive op is not the loose one', () => {
    const result = validateProposedStructuralEdit(
      { operations: [{ op: 'remove_node', path: 'f-reach', target_label: 'Marketing spend' }] },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('LABEL_ID_MISMATCH');
  });

  it('a correct pairing passes, and an id created IN-BATCH needs no echo (it has no persisted label)', () => {
    const result = validateProposedStructuralEdit(
      {
        operations: [
          groundedUpdateOfMarketingSpend(),
          { op: 'add_node', path: 'f-new', value: { id: 'f-new', kind: 'factor', label: 'New' } },
          { op: 'update_node', path: 'f-new', value: { observed_state: { value: 0.3 } } },
        ],
      },
      grounding(),
      OPTS,
    );
    expect(result.ok).toBe(true);
  });
});

describe('A3 — the caps are DERIVED from what actually rejects, not restated', () => {
  /**
   * ⚠ CHANGED DELIBERATELY, 2026-08-05 (A3). This case asserted that an
   * over-cap envelope fan-out was REJECTED. The live witness measured what
   * that rejection costs: the canonical headline sentence composed a real
   * batch and had it discarded on this exact rule, eight times in ten. The cap
   * now SPLITS. What is still pinned here is the thing that made the original
   * assertion worth writing — that the fan-out is counted per FIELD, by the
   * producer the referee consumes, so a batch of only six operations is
   * correctly recognised as too large. Full split behaviour:
   * `structural-edit-batch-split.test.ts`.
   */
  it('an over-cap ENVELOPE fan-out is caught per-FIELD by the producer the referee uses, and SPLITS', () => {
    // Nine single-field updates = nine envelopes > PROPOSAL_CAP (8), even
    // though nine operations is well under the pipeline's 15.
    const ids = ['f-spend', 'f-reach', 'g-profit', 'd-choice', 'o-a', 'o-b'];
    const operations = [
      // 3 multi-field updates fan out to 2 envelopes each = 6 …
      ...ids.slice(0, 3).map((id, i) => ({
        op: 'update_node',
        path: id,
        target_label: grounding().labelById.get(id)!,
        value: { observed_state: { value: 0.1 * (i + 1) }, description: `d${i}` },
      })),
      // … plus 3 single-field updates = 9 envelopes from only 6 operations.
      ...ids.slice(3).map((id, i) => ({
        op: 'update_node',
        path: id,
        target_label: grounding().labelById.get(id)!,
        value: { description: `e${i}` },
      })),
    ];
    expect(operations.length).toBeLessThanOrEqual(OPTS.maxPatchOperations);
    const result = validateProposedStructuralEdit({ operations }, grounding(), OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // Nine envelopes from six operations — the per-FIELD count, still derived
    // from the producer the referee consumes.
    expect(result.envelopeCount).toBe(9);
    expect(result.envelopeCount).toBeGreaterThan(PROPOSAL_CAP);
    // And it becomes more than one proposal rather than a dead turn.
    expect(result.parts.length).toBeGreaterThan(1);
    for (const part of result.parts) {
      expect(part.envelopeCount).toBeLessThanOrEqual(PROPOSAL_CAP);
    }
  });

  it('an over-cap OPERATION count is rejected against the pipeline cap that was passed in', () => {
    const operations = Array.from({ length: 4 }, () => groundedUpdateOfMarketingSpend());
    const result = validateProposedStructuralEdit({ operations }, grounding(), {
      maxPatchOperations: 3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('BATCH_CAP_EXCEEDED');
    expect(result.reason).toContain('3');
  });

  it('a grounding failure WINS over a cap failure — the model is told about the invented id first', () => {
    const ids = ['f-spend', 'f-reach', 'g-profit', 'd-choice', 'o-a', 'o-b'];
    const operations = [
      ...ids.map((id) => ({
        op: 'update_node',
        path: id,
        target_label: grounding().labelById.get(id)!,
        value: { observed_state: { value: 0.2 }, description: 'x' },
      })),
      { op: 'update_node', path: 'f-invented', target_label: 'Nope', value: { description: 'y' } },
    ];
    const result = validateProposedStructuralEdit({ operations }, grounding(), OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('UNKNOWN_ENTITY_ID');
  });
});

describe('malformed payloads reject the batch rather than being repaired into one', () => {
  it.each([
    ['not an object', 'nope'],
    ['no operations key', {}],
    ['empty batch', { operations: [] }],
    ['op is not a known verb', { operations: [{ op: 'rewire_everything', path: 'f-spend' }] }],
    ['no path', { operations: [{ op: 'update_node', value: {} }] }],
    ['unreadable edge path', { operations: [{ op: 'remove_edge', path: 'f-spend' }] }],
    ['add_edge with no endpoints', { operations: [{ op: 'add_edge', path: 'a::b', value: {} }] }],
  ])('%s ⇒ SCHEMA_INVALID, no operations', (_name, payload) => {
    const result = validateProposedStructuralEdit(payload, grounding(), OPTS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('SCHEMA_INVALID');
    expect(result).not.toHaveProperty('operations');
  });
});
