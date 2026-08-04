/**
 * 2.473 — THE CLOSING BOLT on the 0.33.0 transported-critique seam.
 *
 * schemas 0.33.0 (`4526cf58`) added `TransportedCritiqueSchema`: the CEE→UI
 * row, whose field set was hand-mirrored from THIS repo's projection
 * allow-list (`projectCritiquesForTransport`, sanitise-enrichment.ts).
 * Schemas-side CI proves only that its own hand-copied `PROJECTED_ROW`
 * fixture parses — it structurally CANNOT prove the real producer's output
 * does, because the producer lives in this repo. This file is that missing
 * cross-repo assertion, made at the one place both artefacts exist: the
 * vendored schema bytes vs the actual projection function.
 *
 * Two teeth, and neither subsumes the other (CLAUDE.md trap 12d — agreement
 * vs completeness are different guarantees):
 *
 *  1. PARSE — every row the projection emits parses under the vendored
 *     `TransportedCritiqueSchema`. Catches a withheld/renamed
 *     `user_message`, a wrong type, an empty `code`.
 *  2. DECLARED-KEY COVERAGE — every key on every emitted row is declared in
 *     the schema's own shape. The schema is deliberately `.passthrough()`
 *     (open-object, consistent with every enrichment row schema), so tooth 1
 *     alone would stay GREEN if CEE's allow-list gained a field the schema —
 *     and the schemas-side `PROJECTED_ROW` fixture — never heard of. That
 *     silent divergence is exactly the drift this bolt exists to kill.
 *
 * Trap-19 identity binding: every input row carries a unique `id`, the
 * projection transports `id`, and every assertion locates its row BY id —
 * never by a value predicate another row could satisfy.
 */
import { describe, expect, it } from 'vitest';

import { TransportedCritiqueSchema } from '@talchain/schemas/boundary';

import { projectCritiquesForTransport } from '../sanitise-enrichment.js';
import type { LabelResolverContext } from '../resolve-label.js';

const CTX: LabelResolverContext = {
  enrichment: {
    option_comparison: [
      { id: 'opt_a', label: 'Alpha' },
      { id: 'opt_b', label: 'Bravo' },
    ],
  },
};

/**
 * Maximal inputs: every allow-listed field populated on the U row, so the
 * declared-key sweep exercises the WHOLE allow-list, one row per bucket so
 * both surviving branches (U prose-kept / S copy-replaced) are projected.
 */
const RAW_CRITIQUES = [
  {
    // U bucket (genuine — per CRITIQUE_BUCKETS; LOW_EFFECTIVE_SAMPLES is 'S'):
    // producer prose kept (sanitised); display-safe twin present.
    id: 'crit_u_1',
    code: 'DEGENERATE_OUTCOMES',
    severity: 'warning',
    source: 'engine',
    message: 'internal wording referencing node_abc123 raw id',
    user_message: 'This analysis is less reliable than usual.',
    blocks_analysis: false,
    affected_option_ids: ['opt_a'],
    affected_node_ids: ['n1'],
    suggestion: 'Gather more evidence before relying on this comparison.',
  },
  {
    // S bucket — copy is REPLACED from the approved catalogue.
    id: 'crit_s_1',
    code: 'EMPTY_INTERVENTIONS',
    severity: 'warning',
    source: 'validation',
    message: 'internal: option opt_b has no interventions',
    affected_option_ids: ['opt_b'],
  },
  {
    // D bucket — unknown code fails safe to D; must be dropped, never parsed.
    id: 'crit_d_1',
    code: 'SOME_UNKNOWN_ENGINE_CODE',
    severity: 'error',
    message: 'raw engine diagnostic with isl_engine internals',
  },
];

function projectedRows(): Array<Record<string, unknown>> {
  const out = projectCritiquesForTransport(RAW_CRITIQUES, CTX);
  expect(Array.isArray(out)).toBe(true);
  return out as Array<Record<string, unknown>>;
}

function rowById(
  rows: ReadonlyArray<Record<string, unknown>>,
  id: string,
): Record<string, unknown> {
  const row = rows.find((r) => r.id === id);
  expect(row, `expected a projected row with id=${id}`).toBeDefined();
  return row as Record<string, unknown>;
}

describe('2.473 closing bolt — real projection output vs vendored TransportedCritiqueSchema', () => {
  it('NON-VACUITY — both surviving rows project (bound by id); the D row does not', () => {
    const rows = projectedRows();
    expect(rows).toHaveLength(2);
    rowById(rows, 'crit_u_1');
    rowById(rows, 'crit_s_1');
    expect(rows.some((r) => r.id === 'crit_d_1')).toBe(false);
  });

  it('TOOTH 1 (PARSE) — every emitted row parses under the vendored schema', () => {
    const rows = projectedRows();
    // Zero rows would make the loop below pass by testing nothing.
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const parsed = TransportedCritiqueSchema.safeParse(row);
      expect(
        parsed.success,
        `row id=${String(row.id)} failed the vendored TransportedCritiqueSchema: ${
          parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2)
        }`,
      ).toBe(true);
    }
  });

  it('TOOTH 1 POSITIVE CONTROL — the vendored schema can BITE (trap 13)', () => {
    // A row withholding the required `user_message` must fail…
    expect(
      TransportedCritiqueSchema.safeParse({ id: 'x', code: 'ANY_CODE' }).success,
    ).toBe(false);
    // …and so must an empty `code`.
    expect(
      TransportedCritiqueSchema.safeParse({ code: '', user_message: 'copy' }).success,
    ).toBe(false);
  });

  it('TOOTH 2 (DECLARED-KEY COVERAGE) — every emitted key is declared in the schema shape', () => {
    const declared = new Set(Object.keys(TransportedCritiqueSchema.shape));
    // Derivation sanity: the required field is in the derived set…
    expect(declared.has('user_message')).toBe(true);
    // …and the seam's defining property holds: `message` is deliberately
    // NOT declared on the transported row (internal wording never ships).
    expect(declared.has('message')).toBe(false);

    const rows = projectedRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        expect(
          declared.has(key),
          `undeclared key '${key}' on row id=${String(row.id)} — CEE's projection ` +
            `allow-list has outrun the vendored TransportedCritiqueSchema. The ` +
            `schema is .passthrough(), so this field would ship UNTYPED and the ` +
            `schemas-side PROJECTED_ROW fixture is now stale. Extend the schema ` +
            `(new schemas version) before extending the allow-list.`,
        ).toBe(true);
      }
    }
  });

  it('U row (by id) — schema-parsed output transports every allow-listed field faithfully', () => {
    const row = rowById(projectedRows(), 'crit_u_1');
    const parsed = TransportedCritiqueSchema.safeParse(row);
    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2),
    ).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.id).toBe('crit_u_1');
    expect(parsed.data.code).toBe('DEGENERATE_OUTCOMES');
    expect(parsed.data.severity).toBe('warning');
    expect(parsed.data.source).toBe('engine');
    expect(parsed.data.blocks_analysis).toBe(false);
    expect(parsed.data.affected_option_ids).toEqual(['opt_a']);
    expect(parsed.data.affected_node_ids).toEqual(['n1']);
    expect(parsed.data.suggestion).toBe(
      'Gather more evidence before relying on this comparison.',
    );
    expect(parsed.data.user_message).toBe('This analysis is less reliable than usual.');
    // The withheld internal field is absent from the projected row itself.
    expect(row).not.toHaveProperty('message');
  });

  it('S row (by id) — replacement copy resolves the option LABEL and stays schema-valid', () => {
    const row = rowById(projectedRows(), 'crit_s_1');
    const parsed = TransportedCritiqueSchema.safeParse(row);
    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2),
    ).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.user_message).toContain('Bravo');
    expect(parsed.data.user_message).not.toContain('opt_b');
    expect(row).not.toHaveProperty('message');
  });
});
