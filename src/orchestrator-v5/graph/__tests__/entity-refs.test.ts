/**
 * STABLE ENTITY REFERENCES — a persisted per-entity `ref` (O1, F2, R1, G1 …) that NEVER renumbers and is NEVER reused
 * (PTL #77 5909519622 §2; DL lease 5909544405; AIQ rulings 5909556023 → 5909608045 → 5909721329).
 *
 * `ref` is display identity: IN the identity hash (like `label` and layout), OUT of the analysis hash (the published
 * allow-list). `ref_high_water` is a counter, not content: OUT of both, so a restore that raises it still binds to the
 * restored version's identity.
 */
import { describe, it, expect } from 'vitest';
import { assignEntityRefs, parseEntityRef, raiseRefHighWaterForRestore, REF_PREFIX_BY_KIND } from '../entity-refs.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const node = (id: string, kind: string, extra: Json = {}) => ({ id, kind, label: id, ...extra });
const g = (nodes: Json[], extra: Json = {}): Json => ({ nodes, edges: [], ...extra });
const refs = (graph: Json) => Object.fromEntries((graph.nodes as Json[]).map((n) => [n.id, n.ref]));

const FIRST = g([
  node('goal_mrr', 'goal'), node('opt_raise', 'option'), node('opt_keep', 'option'),
  node('price', 'factor'), node('churn', 'factor'), node('mrr_12', 'outcome'), node('risk_churn', 'risk'),
]);

describe('first construction — every entity gets a ref, in array order within its kind', () => {
  it('G1 · O1 · O2 · F1 · F2 · OC1 · R1, and the high-water records each prefix', () => {
    const out = assignEntityRefs(FIRST, null).graph as Json;
    expect(refs(out)).toEqual({ goal_mrr: 'G1', opt_raise: 'O1', opt_keep: 'O2', price: 'F1', churn: 'F2', mrr_12: 'OC1', risk_churn: 'R1' });
    expect(out.ref_high_water).toEqual({ G: 1, O: 2, F: 2, OC: 1, R: 1 });
  });

  it('every node kind has a prefix, and the prefixes are distinct', () => {
    const prefixes = Object.values(REF_PREFIX_BY_KIND);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const kind of ['goal', 'factor', 'outcome', 'decision', 'risk', 'action', 'option']) {
      expect(REF_PREFIX_BY_KIND).toHaveProperty(kind);
    }
  });

  it('CONTROL: a graph that already carries its refs comes back as the SAME object (no spurious write)', () => {
    const once = assignEntityRefs(FIRST, null).graph;
    expect(assignEntityRefs(once, once).graph).toBe(once);
  });
});

describe('an UNKNOWN base assigns nothing (rule 6)', () => {
  it('base === undefined (the writer could not read what it replaces) → the graph passes through untouched', () => {
    expect(assignEntityRefs(FIRST, undefined).graph).toBe(FIRST);
  });
});

describe('no backfill: a pre-refs graph is not rewritten by an unchanged write', () => {
  it('an unchanged write to a graph with NO refs returns the SAME object (no spurious version, identity unchanged)', () => {
    expect(assignEntityRefs(FIRST, FIRST).graph).toBe(FIRST);
  });

  it('a NEW entity on a pre-refs graph gets a ref; the entities the base held stay ref-less', () => {
    const out = assignEntityRefs({ ...FIRST, nodes: [...(FIRST.nodes as Json[]), node('opt_pilot', 'option')] }, FIRST).graph as Json;
    expect(refs(out).opt_pilot).toBe('O1');
    expect(refs(out).opt_raise).toBeUndefined();
    expect(out.ref_high_water).toEqual({ O: 1 });
  });
});

describe('never renumbered, never reused (AIQ condition 1)', () => {
  const v1 = assignEntityRefs(FIRST, null).graph as Json;

  it('delete O2 → add an option → it gets O3, not O2', () => {
    const v2 = { ...v1, nodes: (v1.nodes as Json[]).filter((n) => n.id !== 'opt_keep') };
    const v3 = assignEntityRefs({ ...v2, nodes: [...v2.nodes, node('opt_pilot', 'option')] }, v2).graph as Json;
    expect(refs(v3).opt_pilot).toBe('O3');
    expect(refs(v3).opt_raise).toBe('O1');
    expect(v3.ref_high_water.O).toBe(3);
  });

  it('an edit path that drops the counter AND the deleted node: the BASE still remembers O2 was issued → the new option is O3', () => {
    const { ref_high_water: _hw, ...noCounter } = v1;
    const incoming = { ...noCounter, nodes: [...(v1.nodes as Json[]).filter((n) => n.id !== 'opt_keep'), node('opt_pilot', 'option')] };
    expect(refs(assignEntityRefs(incoming, v1).graph as Json).opt_pilot).toBe('O3');
  });

  it('an edit path that DROPS `ref` gets it back from the base by node id (carry-forward), never a new number', () => {
    const stripped = { ...v1, nodes: (v1.nodes as Json[]).map(({ ref: _ref, ...rest }) => rest) };
    expect(refs(assignEntityRefs(stripped, v1).graph as Json)).toEqual(refs(v1));
  });

  it('an incoming graph cannot RENUMBER an entity: the base\'s ref for that id wins', () => {
    const renumbered = { ...v1, nodes: (v1.nodes as Json[]).map((n) => (n.id === 'opt_raise' ? { ...n, ref: 'O9' } : n)) };
    expect(refs(assignEntityRefs(renumbered, v1).graph as Json).opt_raise).toBe('O1');
  });

  it('a duplicated ref keeps its owner (the base\'s holder); the copy gets a fresh number', () => {
    const dup = { ...v1, nodes: [...(v1.nodes as Json[]), node('opt_copy', 'option', { ref: 'O1' })] };
    const out = refs(assignEntityRefs(dup, v1).graph as Json);
    expect(out.opt_raise).toBe('O1');
    expect(out.opt_copy).toBe('O3');
  });

  it('a malformed or wrong-kind ref is replaced (an option cannot hold "F1")', () => {
    const bad = g([node('opt_a', 'option', { ref: 'F1' }), node('opt_b', 'option', { ref: 'O0' }), node('opt_c', 'option', { ref: 'x' })]);
    expect(refs(assignEntityRefs(bad, null).graph as Json)).toEqual({ opt_a: 'O1', opt_b: 'O2', opt_c: 'O3' });
  });

  it('a lowered high-water on the incoming graph cannot pull numbers back down', () => {
    const lowered: Json = { ...v1, ref_high_water: { O: 0 } };
    const out = assignEntityRefs({ ...lowered, nodes: [...(lowered.nodes as Json[]), node('opt_new', 'option')] }, v1).graph as Json;
    expect(refs(out).opt_new).toBe('O3');
  });
});

describe('restore (AIQ rows: restore v1 → O2 is back; the next new option is O4, not O3 again)', () => {
  const v1 = assignEntityRefs(FIRST, null).graph as Json;                                                   // O1, O2
  const v2 = { ...v1, nodes: (v1.nodes as Json[]).filter((n) => n.id !== 'opt_keep') };                // O1
  const v3 = assignEntityRefs({ ...v2, nodes: [...v2.nodes, node('opt_pilot', 'option')] }, v2).graph as Json; // O1, O3

  it('the restored bytes keep every ref (O2 back as the SAME entity); only the counter rises', () => {
    const restored = raiseRefHighWaterForRestore(v1, v3) as Json;
    expect(refs(restored)).toEqual(refs(v1));
    expect(restored.ref_high_water.O).toBe(3);
  });

  it('the restored graph binds to the restored version: its identity hash equals v1\'s', () => {
    expect(computeGraphIdentityHash(raiseRefHighWaterForRestore(v1, v3) as never)?.value)
      .toBe(computeGraphIdentityHash(v1 as never)?.value);
  });

  it('after the restore, a new option is O4', () => {
    const restored = raiseRefHighWaterForRestore(v1, v3) as Json;
    const next = assignEntityRefs({ ...restored, nodes: [...(restored.nodes as Json[]), node('opt_new', 'option')] }, restored).graph as Json;
    expect(refs(next).opt_new).toBe('O4');
    expect(refs(next).opt_keep).toBe('O2');
  });
});

describe('hash pins (AIQ 5909608045)', () => {
  const v1 = assignEntityRefs(FIRST, null).graph as Json;

  it('assigning refs never makes a Run stale: the ANALYSIS hash is unchanged', () => {
    expect(computeAnalysisAffectingGraphHash(v1 as never)).toBe(computeAnalysisAffectingGraphHash(FIRST as never));
  });

  it('`ref` IS display identity: the IDENTITY hash moves when refs are written', () => {
    expect(computeGraphIdentityHash(v1 as never)?.value).not.toBe(computeGraphIdentityHash(FIRST as never)?.value);
  });

  it('`ref_high_water` is NOT identity: changing only the counter leaves the identity hash alone', () => {
    expect(computeGraphIdentityHash({ ...v1, ref_high_water: { O: 99 } } as never)?.value)
      .toBe(computeGraphIdentityHash(v1 as never)?.value);
  });
});

/**
 * PR Review CR on #2357 @ `37ad639b` (5911749449): (1) the BASE is authoritative for whether an entity it already holds
 * has a ref — a client-supplied ref on a legacy (ref-less) node must not be honoured, raise the counter, or change the
 * stored identity; (2) accepted refs and counters are bounded to safe integers, so no issued ref is `OInfinity` or a
 * rounded repeat.
 */
describe('the base decides for an entity it already holds (PR Review CR 1)', () => {
  it('RED: a legacy node the base held ref-less keeps no ref when the client sends a valid one, and the counter does not move', () => {
    const incoming = { ...FIRST, nodes: (FIRST.nodes as Json[]).map((n) => (n.id === 'opt_raise' ? { ...n, ref: 'O9' } : n)) };
    const out = assignEntityRefs(incoming, FIRST).graph as Json;
    expect(refs(out).opt_raise).toBeUndefined();
    expect(out.ref_high_water).toBeUndefined();
    expect(computeGraphIdentityHash(out as never)?.value).toBe(computeGraphIdentityHash(FIRST as never)?.value);
  });

  it('RED: a wrong-kind ref the client puts on a legacy node is removed, not left behind', () => {
    const incoming = { ...FIRST, nodes: (FIRST.nodes as Json[]).map((n) => (n.id === 'opt_raise' ? { ...n, ref: 'F1' } : n)) };
    const out = assignEntityRefs(incoming, FIRST).graph as Json;
    expect(Object.hasOwn((out.nodes as Json[]).find((n) => n.id === 'opt_raise')!, 'ref')).toBe(false);
    expect(computeGraphIdentityHash(out as never)?.value).toBe(computeGraphIdentityHash(FIRST as never)?.value);
  });

  it('a NEW entity beside those legacy nodes still gets the next number, unaffected by the refused O9', () => {
    const incoming = { ...FIRST, nodes: [...(FIRST.nodes as Json[]).map((n) => (n.id === 'opt_raise' ? { ...n, ref: 'O9' } : n)), node('opt_pilot', 'option')] };
    const out = assignEntityRefs(incoming, FIRST).graph as Json;
    expect(refs(out).opt_pilot).toBe('O1');
    expect(out.ref_high_water).toEqual({ O: 1 });
  });

  it('CONTROL: an unchanged write to the legacy graph is still the SAME object', () => {
    expect(assignEntityRefs(FIRST, FIRST).graph).toBe(FIRST);
  });
});

describe('refs and counters are bounded to safe integers (PR Review CR 2)', () => {
  it('RED: an oversized incoming ref is refused; the new same-kind entity gets a well-formed unique ref', () => {
    const huge = `O${'9'.repeat(400)}`;
    const out = assignEntityRefs(g([node('opt_a', 'option', { ref: huge }), node('opt_b', 'option')]), null).graph as Json;
    const r = refs(out);
    expect(r.opt_a).toMatch(/^O[1-9][0-9]{0,8}$/);
    expect(r.opt_b).toMatch(/^O[1-9][0-9]{0,8}$/);
    expect(r.opt_a).not.toBe(r.opt_b);
    expect(Number.isSafeInteger(out.ref_high_water.O)).toBe(true);
  });

  it('RED: an unsafe counter in the base cannot push the next ref past the bound', () => {
    const base = { ...(assignEntityRefs(FIRST, null).graph as Json), ref_high_water: { O: 1e300 } };
    const out = assignEntityRefs({ ...base, nodes: [...(base.nodes as Json[]), node('opt_new', 'option')] }, base).graph as Json;
    expect(refs(out).opt_new).toMatch(/^O[1-9][0-9]{0,8}$/);
    expect(parseEntityRef(`O${'1'.repeat(10)}`)).toBeNull();
    expect(parseEntityRef('O999999999')).toEqual({ prefix: 'O', n: 999999999 });
  });
});
