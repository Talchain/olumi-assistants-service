/**
 * WHEN AN EDIT IS REFUSED, THE LOG SAYS WHICH OPERATION — AND LEAKS NOTHING.
 *
 * ⛔ THE MEASURED CASE. Staging `8e4efce0`, 2026-09-14, request
 * `20eec8c9-aa74-40b1-aab5-5d0e613c5648`: an ordinary edit refused with
 * `edit_graph B5 — an operation did not survive canonicalisation`. A
 * discriminator over the deployed logs returned
 *
 *     "encoded option interventions to the canonical"  -> 0
 *     option_interventions_encoded                     -> 0
 *     "did not survive canonicalisation" (contrast)    -> 1
 *     zzz-fabricated (negative control)                -> 0
 *
 * so the intervention encoder never fired — but the line could not say whether
 * the op spelling was OUTSIDE the recogniser or the encoder was NOT ON THE PATH.
 * Those have opposite remedies. `key_is_intervention_subtree` is exactly that
 * discrimination, evaluated with the encoder's OWN predicate.
 *
 * ⛔ THE REDACTION HALF IS THE OTHER POINT OF THIS FILE, and it is not a
 * formality — "log the key/path, it's structural" is the tempting call and it
 * is WRONG HERE, twice:
 *   1. `op.path` IS an entity id, and ids in this codebase are slug-shaped
 *      renderings of the USER'S OWN LABELS (`fac_delivery_cost`,
 *      `factor_team_morale` — see `shared/output-safety.ts`).
 *   2. The failing KEY embeds an id in its last segment
 *      (`interventions/<id>`, `data/interventions/<id>`).
 * Plus this module's own comment states op keys are MODEL-CONTROLLED, so no
 * allowlist may assume a closed vocabulary — it must fail closed.
 *
 * The leak tests below use a distinctive user-ish token so a regression is
 * unmistakable, assert on the SERIALISED descriptor (so a field added later
 * that echoes the path is caught without anyone extending a list), and carry a
 * POSITIVE CONTROL proving the token really was in the input — otherwise a
 * "no leak" pass could just mean the fixture never held it.
 */
import { describe, it, expect } from 'vitest';

import {
  firstOperationThatDidNotLand,
  batchFullyLanded,
  describeKeyShape,
} from '../canonicalise-value-ops.js';
import type { PatchOperation } from '../types.js';

/** A label a real user might write, slugified the way this estate makes ids. */
const SECRET = 'acme_q4_redundancy_programme';

const GRAPH = {
  nodes: [
    { id: 'g', kind: 'goal', label: 'Goal' },
    { id: `fac_${SECRET}`, kind: 'factor', label: 'Acme Q4 redundancy programme' },
  ],
  edges: [],
} as never;

function op(over: Partial<PatchOperation> = {}): PatchOperation {
  return { op: 'update_node', path: `fac_${SECRET}`, value: {}, ...over } as PatchOperation;
}

describe('the refusal names the operation', () => {
  it('returns null when every operation landed — and batchFullyLanded agrees', () => {
    const ops = [op({ op: 'add_node', path: 'g', value: {} })];
    expect(firstOperationThatDidNotLand(ops, GRAPH, GRAPH, GRAPH)).toBeNull();
    expect(batchFullyLanded(ops, GRAPH, GRAPH, GRAPH)).toBe(true);
  });

  it('names an add_node that is absent from the canonical graph', () => {
    const ops = [op({ op: 'add_node', path: 'fac_missing', value: {} })];
    const got = firstOperationThatDidNotLand(ops, GRAPH, GRAPH, GRAPH);
    expect(got?.op).toBe('add_node');
    expect(got?.reason).toBe('added_entity_missing_from_canonical');
    expect(got?.index).toBe(0);
  });

  it('names an unknown op kind rather than failing silently', () => {
    const ops = [op({ op: 'frobnicate' as never })];
    expect(firstOperationThatDidNotLand(ops, GRAPH, GRAPH, GRAPH)?.reason).toBe('unknown_op_kind');
  });

  it('reports the INDEX of the first non-landing op, not merely that one exists', () => {
    const ops = [
      op({ op: 'add_node', path: 'g', value: {} }),
      op({ op: 'add_node', path: 'fac_missing', value: {} }),
    ];
    expect(firstOperationThatDidNotLand(ops, GRAPH, GRAPH, GRAPH)?.index).toBe(1);
  });

  // ── the discrimination the incident needed ────────────────────────────────

  it('says an intervention-subtree spelling WAS recognised by the encoder', () => {
    // `interventions/<id>` is a spelling `encodeOptionInterventionsForEdit`
    // owns. Firing with `true` means the encoder was on the path and did not
    // land — a different bug from the spelling being unrecognised.
    const raw = {
      nodes: [{ id: `fac_${SECRET}`, [`interventions/${SECRET}`]: 0.5 }],
      edges: [],
    } as never;
    const ops = [op({ value: { [`interventions/${SECRET}`]: 0.5 } })];
    const got = firstOperationThatDidNotLand(ops, raw, GRAPH, GRAPH);
    expect(got?.reason).toBe('update_writes_did_not_survive');
    expect(got?.key_is_intervention_subtree).toBe(true);
  });

  it('says an UNRECOGNISED spelling was not an intervention-subtree key', () => {
    // The opposite arm. Same shape of failure, opposite remedy — and before
    // this change the log said exactly the same thing for both.
    const raw = { nodes: [{ id: `fac_${SECRET}`, 'data/weighting': 0.5 }], edges: [] } as never;
    const ops = [op({ value: { 'data/weighting': 0.5 } })];
    const got = firstOperationThatDidNotLand(ops, raw, GRAPH, GRAPH);
    expect(got?.reason).toBe('update_writes_did_not_survive');
    expect(got?.key_is_intervention_subtree).toBe(false);
  });
});

describe('describeKeyShape — structural segments survive, everything else is masked', () => {
  it.each([
    ['interventions/fac_acme_q4', 'interventions/*'],
    ['data/interventions/fac_acme_q4', 'data/interventions/*'],
    ['observed_state.interventions.fac_acme_q4', 'observed_state/interventions/*'],
    ['data/value', 'data/value'],
    ['__proto__/value', '*/value'],
    ['', '*'],
  ])('%s -> %s', (input, expected) => {
    expect(describeKeyShape(input)).toBe(expected);
  });

  it('normalises dot and slash spellings to ONE shape so logs aggregate', () => {
    expect(describeKeyShape('data.interventions.x')).toBe(describeKeyShape('data/interventions/x'));
  });
});

describe('the descriptor cannot carry user content', () => {
  const cases: ReadonlyArray<readonly [string, PatchOperation[], unknown, unknown]> = [
    [
      'update_node with an intervention key carrying the id',
      [op({ value: { [`interventions/${SECRET}`]: 0.5 } })],
      { nodes: [{ id: `fac_${SECRET}`, [`interventions/${SECRET}`]: 0.5 }], edges: [] },
      GRAPH,
    ],
    [
      'update_node whose target is missing entirely',
      [op({ path: `fac_${SECRET}`, value: { 'data/value': 1 } })],
      { nodes: [], edges: [] },
      { nodes: [], edges: [] },
    ],
    [
      'add_node whose path is the user-derived id',
      [op({ op: 'add_node', path: `fac_${SECRET}`, value: {} })],
      { nodes: [], edges: [] },
      { nodes: [], edges: [] },
    ],
    [
      'unknown op kind carrying the id in its path',
      [op({ op: 'frobnicate' as never, path: `fac_${SECRET}` })],
      GRAPH,
      GRAPH,
    ],
  ];

  it.each(cases)('%s leaks nothing', (_label, ops, raw, canon) => {
    const got = firstOperationThatDidNotLand(ops, raw as never, canon as never, GRAPH);
    expect(got).not.toBeNull();
    // POSITIVE CONTROL: the input really does carry the token, so a pass below
    // means the masking worked — not that there was nothing to leak.
    expect(JSON.stringify({ ops, raw })).toContain(SECRET);
    const serialised = JSON.stringify(got);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain('acme');
  });

  it('never emits the internal missing-entity sentinel', () => {
    const got = firstOperationThatDidNotLand(
      [op({ value: { 'data/value': 1 } })],
      { nodes: [], edges: [] } as never,
      { nodes: [], edges: [] } as never,
      GRAPH,
    );
    const serialised = JSON.stringify(got);
    expect(serialised).not.toContain('missing_entity');
    // The sentinel is NUL-prefixed, and a NUL reaching a log line is its own
    // hazard — CLAUDE.md trap 17: plain grep goes blind to a NUL-bearing file,
    // so an operator sweeping these logs would get a clean-looking false zero.
    expect(serialised).not.toContain(String.fromCharCode(0));
  });
});
