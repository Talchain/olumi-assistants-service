/**
 * ROADMAP 2.1003 — the no-change verdict.
 *
 * RED-first. At pristine `6b8698a4` this module does not exist and every test
 * here fails at import.
 *
 * The oracle is derived from the PRODUCER's declared semantics, not from my
 * reading of what the fields ought to mean (trap 13c): `graph-hash.ts`'s own
 * doc-comment enumerates exactly which fields `computeAnalysisAffectingGraphHash`
 * includes and excludes, and the tests below assert against that list.
 */
import { describe, it, expect } from 'vitest';

import {
  computeUserMeaningfulModelHash,
  evaluateEditModelChange,
} from '../edit-outcome-binding.js';

function graph(overrides: Record<string, unknown> = {}) {
  return {
    nodes: [
      {
        id: 'fac_cs_coverage_depth',
        kind: 'factor',
        label: 'Customer Success Coverage Depth',
        display_value: '20%',
        observed_state: { value: 20, baseline: 20, unit: '%' },
      },
      {
        id: 'fac_onboarding',
        kind: 'factor',
        label: 'Onboarding Quality',
        display_value: '35%',
        observed_state: { value: 35, unit: '%' },
      },
      { id: 'goal_1', kind: 'goal', label: 'Improve NRR' },
    ],
    edges: [
      {
        from: 'fac_cs_coverage_depth',
        to: 'goal_1',
        edge_type: 'causal',
        strength: { mean: 0.4, std: 0.1 },
        effect_direction: 'positive',
      },
    ],
    ...overrides,
  };
}

/** Deep clone with the SAME content but a different key order at every level. */
function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderKeys) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = reorderKeys(v);
    return out as T;
  }
  return value;
}

describe('computeUserMeaningfulModelHash', () => {
  it('is stable across a pure key-order re-serialisation (the PLoT round-trip case)', () => {
    const a = graph();
    const b = reorderKeys(graph());
    // PRECONDITION PINNED IN-TEST (trap 13b, third face): the fixture must
    // ACTUALLY have a different key order, or this test proves nothing.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(computeUserMeaningfulModelHash(a)).toBe(computeUserMeaningfulModelHash(b));
  });

  it('is stable when a producer annotates passthrough fields the user never sees', () => {
    const before = graph();
    const after = graph();
    // PLoT legitimately annotates these; they are not the user's model.
    (after.edges[0] as Record<string, unknown>).validation = { ok: true };
    (after.edges[0] as Record<string, unknown>).defaulted = ['std'];
    (after.nodes[0] as Record<string, unknown>).provenance_display = 'AI inferred';
    expect(computeUserMeaningfulModelHash(before)).toBe(computeUserMeaningfulModelHash(after));
  });

  it('MOVES when observed_state.value moves — the measured 20 -> 40 case', () => {
    const before = graph();
    const after = graph();
    (after.nodes[0].observed_state as Record<string, unknown>).value = 40;
    expect(computeUserMeaningfulModelHash(before)).not.toBe(computeUserMeaningfulModelHash(after));
  });

  it('MOVES on a rename — the field the analysis-affecting hash deliberately excludes', () => {
    const before = graph();
    const after = graph();
    after.nodes[0].label = 'CS Coverage Depth (renamed)';
    // This is the reason a bare `computeAnalysisAffectingGraphHash` is not
    // sufficient here: it excludes labels so a rename does not falsely stale
    // an analysis. Correct for freshness, wrong for "did the user change
    // anything" — a rename IS a change the user made.
    expect(computeUserMeaningfulModelHash(before)).not.toBe(computeUserMeaningfulModelHash(after));
  });

  it('does NOT move when only display_value moves (a display-anchor repair is not a second change)', () => {
    const before = graph();
    const after = graph();
    after.nodes[0].display_value = '40%';
    expect(computeUserMeaningfulModelHash(before)).toBe(computeUserMeaningfulModelHash(after));
  });

  it('MOVES on an edge strength change', () => {
    const before = graph();
    const after = graph();
    (after.edges[0].strength as Record<string, unknown>).mean = 0.8;
    expect(computeUserMeaningfulModelHash(before)).not.toBe(computeUserMeaningfulModelHash(after));
  });

  it('returns null only for a null/undefined graph', () => {
    expect(computeUserMeaningfulModelHash(null)).toBeNull();
    expect(computeUserMeaningfulModelHash(undefined)).toBeNull();
  });

  it('IS TOTAL — a malformed graph yields null, never a throw', () => {
    // MEASURED, by calling it: `computeAnalysisAffectingGraphHash` throws when
    // `edges` is absent ("Cannot read properties of undefined (reading 'map')").
    // This helper sits on the critical path of every edit, so an uncaught
    // throw would cost the user an edit that otherwise succeeded.
    // ⚠ Not claimed: that any existing test reaches it. A mutant removing the
    // guard leaves the V3-invalid-base integration case GREEN — these
    // assertions are the ONLY thing holding the guard in place.
    expect(computeUserMeaningfulModelHash({ nodes: [{ id: 'a' }] })).toBeNull();
    expect(computeUserMeaningfulModelHash({ edges: [] })).toBeNull();
    expect(computeUserMeaningfulModelHash('not a graph')).toBeNull();
    expect(computeUserMeaningfulModelHash(42)).toBeNull();
  });

  it('a graph whose hash cannot be computed produces NO VERDICT, never "unchanged"', () => {
    // The dangerous failure mode would be two nulls comparing equal and
    // reading as "unchanged" — the product would then tell the user nothing
    // happened on a turn that did change the model.
    const malformed = { nodes: [{ id: 'a' }] };
    expect(evaluateEditModelChange(malformed, malformed).verdict).toBe('not_applicable');
  });
});

describe('evaluateEditModelChange', () => {
  it('the identical-replay case reads UNCHANGED', () => {
    const before = graph();
    const after = reorderKeys(graph());
    expect(evaluateEditModelChange(before, after).verdict).toBe('unchanged');
  });

  it('the real 20 -> 40 edit reads CHANGED', () => {
    const before = graph();
    const after = graph();
    (after.nodes[0].observed_state as Record<string, unknown>).value = 40;
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  it('A GUESS IS NOT A VERDICT: a missing applied graph is not_applicable, never "unchanged"', () => {
    expect(evaluateEditModelChange(graph(), null).verdict).toBe('not_applicable');
    expect(evaluateEditModelChange(null, graph()).verdict).toBe('not_applicable');
    expect(evaluateEditModelChange(undefined, undefined).verdict).toBe('not_applicable');
  });

  it('NEVER reads a producer-supplied graph_hash — the §3.3 landmine, as an explicit case', () => {
    // The applied graph carries a PLoT-format `graph_hash` in a DIFFERENT
    // format from anything we compute. If the predicate ever read it, the
    // verdict would flip to `changed` here. It must stay `unchanged`.
    const before = graph();
    const after = graph({ graph_hash: 'plot-format-hash-not-ours-0123456789abcdef' });
    expect(evaluateEditModelChange(before, after).verdict).toBe('unchanged');
  });
});

/**
 * ROADMAP 2.1003 (c) — THE AUTHORED NOTE.
 *
 * Externally witnessed at deployed CEE `df3e5424` / UI `138d9560` / PLoT
 * `669ba2b` / ISL `28fe0c95`, on real owned scenario
 * `b780d666-e85e-476d-a350-4c0bb77f31e9`, goal node `15227757`:
 *
 *   The user asked to retain a qualitative note. The write SUCCEEDED — the
 *   persisted graph's before/after differ in exactly ONE field
 *   (`nodes[goal].description`), a version row at sequence 2 was created, an
 *   independent authenticated read returned the exact saved text, it appears
 *   in the browser's goal Context field, and it survives a reload.
 *
 *   And the product said: *"No change: the model already matched that.
 *   Nothing was updated."*
 *
 * THE ORACLE IS THE SPEC, NOT THE SYMPTOM (the `> 1` vs `< 0 || > 1` lesson).
 * The spec these cases are written against is the module's own contract —
 * *"did the USER-MEANINGFUL model move?"* — plus the producer's declared
 * semantics for what carries a node's authored prose:
 *   · `cee/transforms/schema-v3.ts:245`   `description: node.body`
 *   · `cee/extraction/intervention-extractor.ts:1655`
 *       `const description = node.description || node.body`
 *     ← the repo's OWN precedence, reused here rather than invented.
 *   · `context/graph-hash.ts:104` names `descriptions` in the EXCLUDED list of
 *     the analysis-affecting hash. That exclusion is CORRECT and stays: prose
 *     cannot move a number, so it must never stale an analysis. Authored-content
 *     change and numerical freshness are two questions, and this module answers
 *     only the first.
 *
 * THE OPPOSITE-DIRECTION TWIN IS ARM 2, and it is the regression risk: the real
 * no-op case was ALSO witnessed by the same auditor (repeating the identical
 * note correctly says it already matches). Widening the comparator until
 * everything reads as a change would trade a silent discard for a confident
 * lie, which is the worse of the two.
 */
describe('evaluateEditModelChange — authored notes (the five arms)', () => {
  const NOTE =
    'Board wants this framed as retention, not acquisition — Sept steerco.';

  /** The witnessed shape: a goal node with no note, then the same node with one. */
  function goalNoteGraphs(note: string | undefined, existing?: string) {
    const before = graph();
    const after = graph();
    // PRECONDITION PINNED IN-TEST (trap 13b): assert the fixture really is what
    // these cases claim, BY IDENTITY, before any verdict is taken. Without this
    // the arms below could pass on a fixture that stopped reproducing the case.
    expect(before.nodes[2].id).toBe('goal_1');
    expect(after.nodes[2].id).toBe('goal_1');
    if (existing !== undefined) {
      (before.nodes[2] as Record<string, unknown>).description = existing;
      (after.nodes[2] as Record<string, unknown>).description = existing;
    }
    expect((before.nodes[2] as Record<string, unknown>).description).toBe(existing);
    if (note !== undefined) {
      (after.nodes[2] as Record<string, unknown>).description = note;
    }
    expect((after.nodes[2] as Record<string, unknown>).description).toBe(
      note === undefined ? existing : note,
    );
    return { before, after };
  }

  // ---- ARM 1 — a real note added to a previously-empty field is a CHANGE ----

  it('ARM 1 — a note added to the GOAL node reads CHANGED (the witnessed defect)', () => {
    const { before, after } = goalNoteGraphs(NOTE);
    // BOUND BY IDENTITY: the only difference between the two graphs is
    // `nodes[goal_1].description`. Pin that, so the verdict cannot be earned by
    // some other divergence the fixture accidentally introduced.
    const diff = before.nodes
      .map((n, i) => [n.id, JSON.stringify(n) === JSON.stringify(after.nodes[i])] as const)
      .filter(([, same]) => !same)
      .map(([id]) => id);
    expect(diff).toEqual(['goal_1']);
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  it('ARM 1 — a note added to a FACTOR node reads CHANGED (the discriminating twin)', () => {
    // The partner of the case above. Under the "prose projected for `fac_*`
    // only" mutant this stays GREEN while the goal case goes RED — which is
    // what proves each case is bound to ITS OWN node rather than to
    // "prose changed somewhere".
    const before = graph();
    const after = graph();
    expect(after.nodes[1].id).toBe('fac_onboarding');
    (after.nodes[1] as Record<string, unknown>).description = NOTE;
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  it('ARM 1 — replacing an EXISTING note with different text reads CHANGED', () => {
    const before = graph();
    const after = graph();
    (before.nodes[2] as Record<string, unknown>).description = 'An earlier note.';
    (after.nodes[2] as Record<string, unknown>).description = NOTE;
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  it('ARM 1 — DELETING a note reads CHANGED (the opposite direction of adding one)', () => {
    const before = graph();
    const after = graph();
    (before.nodes[2] as Record<string, unknown>).description = NOTE;
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  it('ARM 1 — the `body` spelling of authored prose is honoured too', () => {
    // `schema-v3.ts:245` maps V1 `body` onto V3 `description`; the extractor at
    // `intervention-extractor.ts:1655` reads `description || body`. A note that
    // arrives under the older spelling is the same user act.
    const before = graph();
    const after = graph();
    (after.nodes[2] as Record<string, unknown>).body = NOTE;
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  // ---- ARM 2 — the identical note repeated is still a NO-OP -----------------

  it('ARM 2 — the IDENTICAL note repeated still reads UNCHANGED (the regression risk)', () => {
    const { before, after } = goalNoteGraphs(undefined, NOTE);
    // Both halves carry the same note. This is the auditor's own positive
    // control on the live product, and it must survive the fix.
    expect((before.nodes[2] as Record<string, unknown>).description).toBe(NOTE);
    expect((after.nodes[2] as Record<string, unknown>).description).toBe(NOTE);
    expect(evaluateEditModelChange(before, after).verdict).toBe('unchanged');
  });

  it('ARM 2 — the identical note survives a PLoT key-order round trip as UNCHANGED', () => {
    const before = graph();
    (before.nodes[2] as Record<string, unknown>).description = NOTE;
    const after = reorderKeys(before);
    expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));
    expect(evaluateEditModelChange(before, after).verdict).toBe('unchanged');
  });

  it('ARM 2 — absent, empty and whitespace-only prose are the SAME "no note"', () => {
    // Otherwise a producer that normalises `undefined` to `''` on the round
    // trip would manufacture a change out of nothing — the inverse harm.
    const a = graph();
    const b = graph();
    (b.nodes[2] as Record<string, unknown>).description = '';
    const c = graph();
    (c.nodes[2] as Record<string, unknown>).description = '   \n ';
    expect(evaluateEditModelChange(a, b).verdict).toBe('unchanged');
    expect(evaluateEditModelChange(a, c).verdict).toBe('unchanged');
  });

  // ---- ARM 3 — a numeric value edit is unchanged behaviour ------------------

  it('ARM 3 — a numeric value edit still reads CHANGED, with notes present on both sides', () => {
    const before = graph();
    const after = graph();
    (before.nodes[2] as Record<string, unknown>).description = NOTE;
    (after.nodes[2] as Record<string, unknown>).description = NOTE;
    (after.nodes[0].observed_state as Record<string, unknown>).value = 40;
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  it('ARM 3 — a numeric value edit is NOT masked by an unrelated note being present', () => {
    const before = graph();
    const after = graph();
    (before.nodes[1] as Record<string, unknown>).description = 'unrelated note';
    (after.nodes[1] as Record<string, unknown>).description = 'unrelated note';
    (after.edges[0].strength as Record<string, unknown>).mean = 0.8;
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  // ---- ARM 4 — a rename is unchanged behaviour -----------------------------

  it('ARM 4 — a rename still reads CHANGED, and is not confused with a note', () => {
    const before = graph();
    const after = graph();
    (before.nodes[2] as Record<string, unknown>).description = NOTE;
    (after.nodes[2] as Record<string, unknown>).description = NOTE;
    after.nodes[2].label = 'Improve Net Revenue Retention';
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  it('ARM 4 — swapping a label INTO the note field is not a no-op', () => {
    // Guards the fold: `description ?? body` must not let a value move between
    // slots unnoticed.
    const before = graph();
    const after = graph();
    (before.nodes[2] as Record<string, unknown>).description = NOTE;
    (after.nodes[2] as Record<string, unknown>).label = NOTE;
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  // ---- ARM 5 — persisted metadata churn is NOT an authored change ----------

  it('ARM 5 — timestamps, sequence numbers and derived identities read UNCHANGED', () => {
    // THE BREADTH TEST. The comparator must not become "anything the persistence
    // layer touched". Every field here moves on a real save and none of them is
    // something a user authored.
    const before = graph();
    const after = graph({
      updated_at: '2026-08-30T04:41:00.000Z',
      version: 2,
      sequence: 2,
      graph_hash: 'deadbeefdeadbeef',
      model_version_id: 'mv_0002',
      schema_version: 'v3',
    });
    (after.nodes[2] as Record<string, unknown>).updated_at = '2026-08-30T04:41:00.000Z';
    (after.nodes[2] as Record<string, unknown>).provenance = 'ai_estimated';
    (after.nodes[2] as Record<string, unknown>).provenance_display = 'estimated by Olumi';
    (after.nodes[2] as Record<string, unknown>).origin = 'plot';
    (after.nodes[0] as Record<string, unknown>).display_value = '40%';
    (after.edges[0] as Record<string, unknown>).validation = { pass1: { strength_mean: 0.4 } };
    (after.edges[0] as Record<string, unknown>).defaulted = ['std'];
    expect(evaluateEditModelChange(before, after).verdict).toBe('unchanged');
  });

  it('ARM 5 — a NON-STRING value in a prose slot cannot manufacture a change', () => {
    // A producer annotating `description` with a structured object is not the
    // user writing a note. Only a string is authored prose.
    const before = graph();
    const after = graph();
    (after.nodes[2] as Record<string, unknown>).description = { generated: true };
    (after.nodes[2] as Record<string, unknown>).body = 42;
    expect(evaluateEditModelChange(before, after).verdict).toBe('unchanged');
  });

  it('ARM 5 — the DERIVED top-level `options[]` projection is NOT a second prose source', () => {
    // Options are `kind: 'option'` NODES (`turn-executor.ts:2522`), and the
    // top-level `options[]` array is a projection built FROM them
    // (`schema-v3.ts:1289-1296`, `description: node.body`). An option's authored
    // note is therefore already covered at the node. Reading the derived array
    // as well would import its churn for zero extra coverage — so it must not
    // move the verdict on its own.
    const before = graph({ options: [{ id: 'opt_a', status: 'ready' }] });
    const after = graph({
      options: [{ id: 'opt_a', status: 'ready', description: 'projection churn' }],
    });
    expect(evaluateEditModelChange(before, after).verdict).toBe('unchanged');
  });

  it('ARM 5 — an OPTION NODE own note IS a change (the coverage that arm buys back)', () => {
    const before = graph();
    const after = graph();
    before.nodes.push({ id: 'opt_a', kind: 'option', label: 'Hire two CSMs' } as never);
    after.nodes.push({
      id: 'opt_a',
      kind: 'option',
      label: 'Hire two CSMs',
      description: NOTE,
    } as never);
    expect(evaluateEditModelChange(before, after).verdict).toBe('changed');
  });

  // ---- The receipt half of the verdict -------------------------------------

  it('reports BOTH hashes on a note change, so the verdict is inspectable', () => {
    const { before, after } = goalNoteGraphs(NOTE);
    const result = evaluateEditModelChange(before, after);
    expect(result.beforeHash).not.toBeNull();
    expect(result.afterHash).not.toBeNull();
    expect(result.beforeHash).not.toBe(result.afterHash);
  });
});
