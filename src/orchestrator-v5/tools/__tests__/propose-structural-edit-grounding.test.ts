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
  it('an over-cap ENVELOPE fan-out is pre-caught, counted by the producer the referee uses', () => {
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
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('BATCH_CAP_EXCEEDED');
    expect(result.reason).toContain(String(PROPOSAL_CAP));
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
