/**
 * ⭐⭐ THE DOWNSTREAM HALF: A DECLARATION THAT DIES AT THE BOUNDARY IS NO
 * DECLARATION.
 *
 * The projector writes a user-stated `value_scale` onto both carriers. That
 * proves the PRODUCER records it and nothing about whether a consumer can read
 * it — and in this estate that is exactly where such fields go to die:
 *
 *   · CEE's `NodeV3` is a PLAIN `z.object`, not `.passthrough()`. Its own
 *     comments record that an undeclared root is "SILENTLY DELETED by
 *     `GraphV3.safeParse` … with no error anywhere". `@talchain/schemas`'
 *     `NodeV3Schema` IS `.passthrough()` — two schemas, one name, opposite
 *     postures, so fixing it there would change nothing here.
 *   · `transformNodeToV3` rebuilds `observed_state` FIELD BY FIELD. That
 *     rebuild silently dropped `sets_to` for a whole release, and dropped the
 *     repair stage's promoted `raw_value`/`cap`/`unit` until
 *     `promoted-scale-reaches-observed-state.test.ts` was written.
 *
 * ⭐⭐ THE FIXTURE IS THE PROJECTOR'S OWN OUTPUT, NOT A HAND-AUTHORED SHAPE, and
 * that is load-bearing. A self-authored fixture here encodes my model of what
 * the producer emits rather than what it emits: the first draft of this file
 * hand-wrote `declared_scale` onto `data` and `observed_state` but not onto the
 * NODE, read `undefined`, and would have been recorded as "the boundary drops
 * the declaration". It does not. It reads the NODE-LEVEL carrier only
 * (`schema-v3.ts:498`) — which is precisely why the projector writes both, and
 * the third test pins that asymmetry so nobody "simplifies" it to one.
 *
 * ⚠ SCOPE. This is the CEE boundary only. It says nothing about PLoT or ISL:
 * PLoT projects `observed_state` through a 10-member allowlist that does not
 * list `declared_scale`, so the declaration does NOT reach the solver — which
 * is the right shape, because the solver computes on the normalised `value`.
 * The declaration is for the consumers that must DESCRIBE a number rather than
 * compute with it.
 */
import { describe, expect, it } from 'vitest';

import type { DraftRecordSet } from '../../draft/records/grammar.js';
import { projectRecordsToGraph } from '../../draft/records/projector.js';
import { NodeV3 } from '../../../schemas/cee-v3.js';
import { transformNodeToV3 } from '../schema-v3.js';

/** Exactly the shape the increment is about: the USER states the convention. */
function projectedFactor(statedOver: Record<string, unknown> = {}): Record<string, unknown> {
  const records = {
    stated_items: [
      { kind: 'goal', source_quote: 'grow net revenue retention next year' },
      { kind: 'option', source_quote: 'launch the expansion tier' },
      {
        kind: 'figure',
        source_quote: 'net revenue retention is currently 0.9',
        value: 0.9,
        unit: '%',
        ...statedOver,
      },
    ],
    claims: [
      {
        claim_kind: 'causal_link',
        label: 'retention bears on the goal',
        from_stated: 2,
        to_stated: 0,
        effect: 'positive',
      },
    ],
  } as unknown as DraftRecordSet;
  const { graph } = projectRecordsToGraph(records);
  const factors = graph.nodes.filter((n) => n.kind === 'factor');
  expect(factors.length, 'exactly one factor, or every assertion below is vacuous').toBe(1);
  return factors[0]! as unknown as Record<string, unknown>;
}

const parsedOf = (node: unknown) => {
  const out = transformNodeToV3(node as never);
  const parsed = NodeV3.safeParse(out);
  if (!parsed.success) {
    throw new Error(`NodeV3 rejected the transform output: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data as { observed_state?: Record<string, unknown> };
};

describe("a user-stated declaration survives CEE's strict V3 boundary", () => {
  it('⭐ is READABLE on observed_state after the strict re-parse', () => {
    const os = parsedOf(projectedFactor({ value_scale: 'ratio' })).observed_state;
    expect(os, 'observed_state must survive at all, or the rest is vacuous').toBeDefined();
    expect(os?.declared_scale).toBe('ratio');
  });

  it('CONTRAST CONTROL — an undeclared figure crosses with no declaration', () => {
    // Without this, the assertion above could be satisfied by a transform that
    // stamps something on everything. It also pins the contract's own failure
    // semantics at the boundary: absence means UNDECLARED and must stay absent
    // rather than being defaulted on the way through.
    const os = parsedOf(projectedFactor()).observed_state;
    expect(os, 'the undeclared node must still cross, or this control is vacuous').toBeDefined();
    expect(os?.declared_scale).toBeUndefined();
  });

  it('⚠ THE NODE-LEVEL CARRIER IS THE ONE THAT CROSSES — why both are written', () => {
    // `schema-v3.ts:498` reads `(node as {declared_scale}).declared_scale` and
    // NOTHING ELSE: not `data.declared_scale`, not the incoming
    // `observed_state.declared_scale`. So a producer that wrote only the
    // published carrier would be silently dropped here, with no error anywhere
    // — the exact defect class this boundary already inflicted on `sets_to`.
    // Pinned so a tidy-up that drops "the redundant node-level write" turns
    // this red instead of turning the declaration dark.
    const node = projectedFactor({ value_scale: 'ratio' });
    expect(node.declared_scale, 'the projector must write the node-level carrier').toBe('ratio');
    delete node.declared_scale;
    expect(
      parsedOf(node).observed_state?.declared_scale,
      'observed_state alone does NOT cross — this is the asymmetry the double write exists for',
    ).toBeUndefined();
  });
});
