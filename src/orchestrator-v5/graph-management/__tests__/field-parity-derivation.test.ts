/**
 * ROADMAP 2.474 / design-review amendment A6 — **HALF (a): DERIVED EQUALITY.**
 *
 * The referee's field allowlists are derived from the classed field-parity
 * table shipped in `@talchain/schemas`. This file proves the derivation:
 *   1. the pin carries the table revision the derivation was written against
 *      (hazard 1 — an older pin is a SHORTER table and every derived allowlist
 *      would be silently narrower);
 *   2. the derived sets are SET-EQUAL to the table's accessors, both
 *      directions, with no copy anywhere in this repo;
 *   3. the union direction rule for the owned set (may widen, never narrow);
 *   4. — and this is the answer to "what would have to be true for these to
 *      pass while the property fails" (trap 13b) — the SCREEN ITSELF honours
 *      the table, row by row. Equality of two constants is satisfied by a
 *      screen that reads neither of them; the behavioural block below is not
 *      redundant with the set equality, it is what stops the equality being a
 *      guard that agrees with itself.
 *
 * ⚠ THIS FILE CANNOT NOTICE THE TABLE BEING SHORT. That is derivation's
 * structural blindness (trap 12d, measured: deleting a key from a canonical map
 * leaves every derived guard GREEN). The hand-written corpus in
 * `field-safety-corpus.test.ts` is the other half; neither supersedes the
 * other and both ship.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EDITABLE_FIELD_TABLE,
  EDITABLE_FIELD_TABLE_DIGEST,
  EDITABLE_FIELD_TABLE_REVISION,
  computeEditableFieldTableDigest,
  aiEditableFieldRoots,
  aiEditableObservedSubkeys,
  provenanceOwnedSegments,
  type EditableFieldEntity,
} from '@talchain/schemas/orchestrator';
import { NodeV3, EdgeV3, ObservedStateV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { batchFullyLanded } from '../../../orchestrator/canonicalise-value-ops.js';
import {
  ALLOWED_NODE_FIELD_ROOTS,
  ALLOWED_EDGE_FIELD_ROOTS,
  ALLOWED_OBSERVED_SUBKEYS,
  PIPELINE_OWNED_ROOTS,
  CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST,
  REQUIRED_EDITABLE_FIELD_TABLE_REVISION,
} from '../field-safety.js';
import { refereeMutation } from '../referee.js';
import { FIELD_NOT_ALLOWED, PIPELINE_OWNED_FIELD } from '../reason-codes.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from './fixtures.js';

const G = buildReadyGraph();
const sorted = (s: Iterable<string>): string[] => [...s].sort();
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The blocker code the R4 screen returns for a node/edge field update, or null. */
function screenCode(entity: EditableFieldEntity, field: string, to: unknown = 1): string | null {
  const raw =
    entity === 'node'
      ? makeEnvelope(
          'update_node_field',
          { node_id: 'f-spend', field, from: null, to },
          { base_graph_hash: hashOf(G) },
        )
      : makeEnvelope(
          'update_edge_field',
          { from_node: 'f-spend', to_node: 'g-profit', field, from: null, to },
          { base_graph_hash: hashOf(G) },
        );
  const v = refereeMutation(raw, G, frameFor(G));
  return v.blocker?.code ?? null;
}

const FIELD_SCREEN_CODES = new Set<string>([FIELD_NOT_ALLOWED, PIPELINE_OWNED_FIELD]);

// ---------------------------------------------------------------------------
// 1. Pin-skew (A6 rider, hazard 1)
// ---------------------------------------------------------------------------

describe('A6 — pin-skew: the resolved @talchain/schemas carries the table this repo derives from', () => {
  it('the INSTALLED package version is 0.39.0 (read off the resolved install, not the declaration)', () => {
    // The package's own `exports` map exposes neither ./package.json nor a CJS
    // condition, so this reads the manifest of the INSTALLED module in
    // node_modules — what `pnpm install` actually produced, never what
    // package.json says it wanted. A vendored tarball whose bytes disagree with
    // the pin fails here rather than silently supplying a shorter table. The
    // digest test below binds this to the module the code actually imports.
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'node_modules', '@talchain', 'schemas', 'package.json'), 'utf8'),
    ) as { name: string; version: string };
    expect(pkg.name).toBe('@talchain/schemas');
    expect(pkg.version).toBe('0.39.0');
  });

  it('the DECLARED pin and the installed version agree (a stale vendor tarball fails loud)', () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.['@talchain/schemas']).toBe(
      'file:./vendor/talchain-schemas-0.39.0.tgz',
    );
  });

  it('the resolved table CONTENT reproduces its own published digest (not a stale constant)', () => {
    // The digest shipped by the package is only evidence if recomputing it over
    // the table you actually resolved returns the same value — otherwise the
    // constant could be right while the rows are not.
    expect(computeEditableFieldTableDigest(EDITABLE_FIELD_TABLE)).toBe(EDITABLE_FIELD_TABLE_DIGEST);
    // Moved 0.35.0 -> 0.37.0 by the DSK-provenance pin bump (2.490 slice 2).
    // ⚠ THAT BUMP UNAVOIDABLY ADOPTS 0.36.0's editable-field table revision 2 —
    // no consumer had pinned 0.36.0, so this lane is the first to inherit it,
    // and the inheritance was MEASURED rather than waved through:
    //   · 42 -> 43 rows; the SEMANTIC delta (entity|wire_field|field_root|
    //     field_class) is EXACTLY ONE added row, `edge|validation|validation|
    //     provenance_owned`, and ZERO removed. Every other changed row differs
    //     only in `reason` / `ui_write_sites` PROSE.
    //   · That one row is behaviourally INERT AT THIS CONSUMER: `validation`
    //     is already in `CEE_ANALYSIS_OWNED_ROOTS` (field-safety.ts:173),
    //     unioned into `PIPELINE_OWNED_ROOTS`, so the deny set is unchanged.
    //     Verified at the bytes here, NOT taken from the row's own prose
    //     claiming it — the row asserting its own inertness is exactly the
    //     kind of sentence this estate has learned not to inherit.
    expect(EDITABLE_FIELD_TABLE_DIGEST).toBe('67cea469-77605f3b');
  });

  it('the resolved table revision is at least the revision the derivation requires', () => {
    expect(EDITABLE_FIELD_TABLE_REVISION).toBeGreaterThanOrEqual(
      REQUIRED_EDITABLE_FIELD_TABLE_REVISION,
    );
  });

  it('the resolved table is the 43-row classed table (a shorter pin is a different contract)', () => {
    expect(EDITABLE_FIELD_TABLE.length).toBe(43);
    const byClass = new Map<string, number>();
    for (const r of EDITABLE_FIELD_TABLE) {
      byClass.set(r.field_class, (byClass.get(r.field_class) ?? 0) + 1);
    }
    expect(Object.fromEntries([...byClass].sort())).toEqual({
      ai_only: 5,
      deferred_derivation: 1,
      grant: 22,
      invariant_coupled: 7,
      // 7 -> 8 at the 0.37.0 pin. The histogram moved by EXACTLY the one
      // semantic row the delta measurement predicted (`edge.validation`,
      // provenance_owned) and in no other class — an independent confirmation
      // that the 0.36.0 table revision is prose everywhere else.
      provenance_owned: 8,
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Derived equality, both directions
// ---------------------------------------------------------------------------

describe('A6 half (a) — the allowlists are DERIVED-equal to the table, both directions', () => {
  it('node roots: derived set == table accessor (no copy)', () => {
    expect(sorted(ALLOWED_NODE_FIELD_ROOTS)).toEqual(sorted(aiEditableFieldRoots('node')));
  });

  it('edge roots: derived set == table accessor (no copy)', () => {
    expect(sorted(ALLOWED_EDGE_FIELD_ROOTS)).toEqual(sorted(aiEditableFieldRoots('edge')));
  });

  it('observed sub-keys: derived set == table accessor (no copy)', () => {
    expect(sorted(ALLOWED_OBSERVED_SUBKEYS)).toEqual(sorted(aiEditableObservedSubkeys()));
  });

  it('every allowlisted root has a grant/ai_only row for its entity (no root without a row)', () => {
    for (const entity of ['node', 'edge'] as const) {
      const allow = entity === 'node' ? ALLOWED_NODE_FIELD_ROOTS : ALLOWED_EDGE_FIELD_ROOTS;
      for (const root of allow) {
        const rows = EDITABLE_FIELD_TABLE.filter(
          (r) =>
            r.entity === entity &&
            r.field_root === root &&
            (r.field_class === 'grant' || r.field_class === 'ai_only'),
        );
        expect(rows.length, `${entity}/${root} has no grant/ai_only row`).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The owned set is a UNION, and the direction is load-bearing
// ---------------------------------------------------------------------------

describe('A6 — owned segments are a UNION (may widen, never narrow)', () => {
  it('every CEE analysis-derived stamp survives the union (no narrowing)', () => {
    for (const root of CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST) {
      expect(PIPELINE_OWNED_ROOTS.has(root), `${root} was narrowed out of the owned set`).toBe(true);
    }
  });

  it('every table provenance_owned segment is adopted (the J2 half of the union)', () => {
    for (const seg of provenanceOwnedSegments()) {
      expect(PIPELINE_OWNED_ROOTS.has(seg), `${seg} was not adopted from the table`).toBe(true);
    }
  });

  it('the union is a STRICT superset of each half — the two sets are not equal and must not be', () => {
    const table = provenanceOwnedSegments();
    const cee = new Set(CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST);
    // CEE owns stamps with no human setter and therefore no row (validation,
    // defaulted, origin, provenance_display); the table owns human-facing
    // provenance CEE did not deny (threshold_source, the edge *Source stamps).
    expect([...cee].some((k) => !table.has(k))).toBe(true);
    expect([...table].some((k) => !cee.has(k))).toBe(true);
    expect(PIPELINE_OWNED_ROOTS.size).toBeGreaterThan(cee.size);
    expect(PIPELINE_OWNED_ROOTS.size).toBeGreaterThan(table.size);
  });
});

// ---------------------------------------------------------------------------
// 4. The SCREEN honours the table, row by row (trap 13b: the equality above is
//    satisfied by a screen that reads neither constant — this block is not)
// ---------------------------------------------------------------------------

describe('A6 half (a) — the R4 SCREEN itself honours the classed table, row by row', () => {
  const rowsFor = (cls: string, entity: EditableFieldEntity) =>
    EDITABLE_FIELD_TABLE.filter((r) => r.field_class === cls && r.entity === entity);

  for (const entity of ['node', 'edge'] as const) {
    it(`${entity}: every grant/ai_only row's root passes the field screen`, () => {
      const rows = [...rowsFor('grant', entity), ...rowsFor('ai_only', entity)];
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        const code = screenCode(entity, r.field_root);
        expect(
          code === null || !FIELD_SCREEN_CODES.has(code),
          `${entity}/${r.field_root} (${r.field_class}) was refused by the field screen with ${code}`,
        ).toBe(true);
      }
    });

    it(`${entity}: every provenance_owned row is refused as PIPELINE_OWNED_FIELD`, () => {
      const rows = rowsFor('provenance_owned', entity);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(screenCode(entity, r.wire_field), `${entity}/${r.wire_field}`).toBe(
          PIPELINE_OWNED_FIELD,
        );
      }
    });

    it(`${entity}: every invariant_coupled / deferred_derivation row is refused`, () => {
      const rows = [...rowsFor('invariant_coupled', entity), ...rowsFor('deferred_derivation', entity)];
      for (const r of rows) {
        const code = screenCode(entity, r.wire_field);
        expect(
          code !== null && FIELD_SCREEN_CODES.has(code),
          `${entity}/${r.wire_field} (${r.field_class}) was NOT refused (code ${code})`,
        ).toBe(true);
      }
    });
  }

  it('a root with NO row at all is refused (the other direction of the equality)', () => {
    for (const invented of ['not_a_real_field', 'body', 'weight', 'belief_exists']) {
      expect(screenCode('node', invented), invented).toBe(FIELD_NOT_ALLOWED);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. DISCLOSED MEASUREMENT — what the new grants actually do at CEE
// ---------------------------------------------------------------------------

describe('A6 — measured persistence survival of the derivation delta (disclosure, not decoration)', () => {
  /**
   * The table is derived from the UI's inspector setters and the SHARED
   * package's node schema. CEE's own NodeV3/EdgeV3 are plain `z.object`s —
   * declared fields only, unknown fields stripped. Four of the five newly
   * granted roots are NOT declared there. This block pins the measurement so
   * the day CEE declares one of them, it REDs and the note in field-safety.ts
   * gets corrected instead of rotting into a false claim.
   */
  it('node state_space / probability / impact are STRIPPED by CEE NodeV3 (grant is proposal-only today)', () => {
    const parsed = NodeV3.safeParse({
      id: 'f-x',
      kind: 'factor',
      label: 'X',
      state_space: { range: { min: 0, max: 1 } },
      probability: 0.4,
      impact: 'high',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const keys = Object.keys(parsed.data);
    expect(keys).not.toContain('state_space');
    expect(keys).not.toContain('probability');
    expect(keys).not.toContain('impact');
  });

  it('edge label is STRIPPED by CEE EdgeV3 (grant is proposal-only today)', () => {
    const parsed = EdgeV3.safeParse({
      from: 'a',
      to: 'b',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
      label: 'causes',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(Object.keys(parsed.data)).not.toContain('label');
  });

  it('observed_state.std SURVIVES (ObservedStateV3 is passthrough) — the one fully-live new grant', () => {
    const parsed = ObservedStateV3.safeParse({ value: 1, std: 0.3 });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(Object.keys(parsed.data)).toContain('std');
  });

  /**
   * ⚠ THE FAIL-SAFE IS UPDATE-PATH ONLY, AND AN EARLIER VERSION OF THIS LANE'S
   * SUMMARY OVERSTATED IT. `batchFullyLanded` verifies an UPDATE field-by-field
   * and an ADD by entity PRESENCE, so the same dropped grant is a loud refusal
   * on one path and a silent drop on the other. Measured on both, because a
   * fail-safe claim asserted one path wide is exactly the kind of sentence that
   * gets quoted somewhere it is false.
   */
  const stripBySchema = (g: GraphV3T): GraphV3T => ({
    ...g,
    nodes: g.nodes.map((n) => NodeV3.parse(n)),
  });

  it('UPDATE carrying an undeclared grant → batchFullyLanded refuses (LOUD)', () => {
    const raw: GraphV3T = {
      nodes: [{ id: 'f-spend', kind: 'factor', label: 'Spend', state_space: { range: { min: 0, max: 1 } } } as GraphV3T['nodes'][number]],
      edges: [],
    };
    const landed = batchFullyLanded(
      [{ op: 'update_node', path: 'f-spend', value: { state_space: { range: { min: 0, max: 1 } } } }],
      raw,
      stripBySchema(raw),
    );
    expect(landed).toBe(false);
  });

  it('ADD carrying the SAME undeclared grant → batchFullyLanded PASSES (SILENT drop)', () => {
    const raw: GraphV3T = {
      nodes: [{ id: 'f-new', kind: 'factor', label: 'New', state_space: { range: { min: 0, max: 1 } } } as GraphV3T['nodes'][number]],
      edges: [],
    };
    const canonical = stripBySchema(raw);
    // The field is gone from the persisted graph …
    expect(Object.keys(canonical.nodes[0]!)).not.toContain('state_space');
    // … and the landed check does not notice, because adds are verified by
    // entity presence. This is the honest scope of the fail-safe claim.
    const landed = batchFullyLanded(
      [{ op: 'add_node', path: 'f-new', value: { id: 'f-new', kind: 'factor', label: 'New', state_space: { range: { min: 0, max: 1 } } } }],
      raw,
      canonical,
    );
    expect(landed).toBe(true);
  });
});
