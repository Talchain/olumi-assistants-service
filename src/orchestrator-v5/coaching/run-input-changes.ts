/**
 * SC-24 — WHAT DIFFERED IN THE INPUTS between two Runs, diffed from their recorded `input_snapshot`s
 * (`@talchain/schemas` 0.67.0 `RunDeltaInputChangeSchema`).
 *
 * ⭐ INDEPENDENT OF ATTRIBUTION. This says what the two Runs were SENT differently; `attribution_case` says whether
 * the pair licenses a causal reading of the outcome. A C2 pair still had £59 → £60 as its input.
 *
 * PRODUCER ORDER (the UI shows the first two rows, then "all N"): option settings (the edit a person usually made),
 * options added to / dropped from the comparison, factor values, the goal, limits, links. Within a kind: by id.
 *
 * RULES
 *   - Compare the AUTHORED figure (`raw` + `unit`) when both ends recorded one, else the number PLoT received
 *     (`encoded`). A label-only difference is never a row; a unit or kind difference is.
 *   - A status-quo setting CEE HELD at the factor's current value on BOTH Runs is not an option edit — the factor-value
 *     row already says what moved.
 *   - Nothing here computes a delta: rows carry both ends, and a consumer shows before → after.
 */

import type { RunDeltaInputChange } from '@talchain/schemas/boundary';
import type { RunInputSnapshot } from '@talchain/schemas/orchestrator';

type Value = { raw: number | string | boolean; unit?: string };
type Row = RunDeltaInputChange;

const valueOf = (raw: number | string | boolean | undefined, encoded: number | undefined, unit: string | undefined): Value | null => {
  if (raw !== undefined) return unit !== undefined ? { raw, unit } : { raw };
  if (encoded !== undefined) return { raw: encoded };
  return null;
};

/** Both ends on the same basis: authored when both recorded it, else what PLoT received. */
function pairValues(
  a: { raw?: number | string | boolean; unit?: string; encoded?: number } | undefined,
  b: { raw?: number | string | boolean; unit?: string; encoded?: number } | undefined,
): [Value | null, Value | null] {
  const authored = a?.raw !== undefined && b?.raw !== undefined;
  const pick = (x: typeof a): Value | null =>
    x === undefined ? null : authored ? valueOf(x.raw, undefined, x.unit) : valueOf(undefined, x.encoded, undefined) ?? valueOf(x.raw, undefined, x.unit);
  return [pick(a), pick(b)];
}

const same = (a: Value | null, b: Value | null): boolean =>
  a === null || b === null ? a === b : a.raw === b.raw && a.unit === b.unit;

function changeRow(base: Omit<Row, 'before' | 'after' | 'change'>, before: Value | null, after: Value | null, kinds?: { before?: string; after?: string }): Row | null {
  const kindBefore = kinds?.before;
  const kindAfter = kinds?.after;
  if (before === null && after === null) return null;
  const change = before === null ? 'added' : after === null ? 'removed' : 'changed';
  if (change === 'changed' && same(before, after) && kindBefore === kindAfter) return null;
  return {
    ...base,
    before,
    after,
    change,
    ...(kindBefore !== undefined ? { kind_before: kindBefore } : {}),
    ...(kindAfter !== undefined ? { kind_after: kindAfter } : {}),
  } as Row;
}

const byId = <T,>(rows: readonly T[], id: (r: T) => string): Map<string, T> => new Map(rows.map((r) => [id(r), r]));
const unionIds = (a: Map<string, unknown>, b: Map<string, unknown>): string[] => [...new Set([...a.keys(), ...b.keys()])].sort();
const labels = (a?: string, b?: string) => ({
  ...(a !== undefined ? { label_before: a } : {}),
  ...(b !== undefined ? { label_after: b } : {}),
});

export function diffRunInputSnapshots(prior: RunInputSnapshot, current: RunInputSnapshot): Row[] {
  const rows: Row[] = [];
  const push = (r: Row | null) => {
    if (r !== null) rows.push(r);
  };

  // ── option settings, for options on both Runs ─────────────────────────────
  const pOpts = byId(prior.options, (o) => o.option_id);
  const cOpts = byId(current.options, (o) => o.option_id);
  for (const optionId of unionIds(pOpts, cOpts)) {
    const p = pOpts.get(optionId);
    const c = cOpts.get(optionId);
    if (p === undefined || c === undefined) continue; // presence rows below
    const pSet = byId(p.settings, (s) => s.factor_id);
    const cSet = byId(c.settings, (s) => s.factor_id);
    for (const factorId of unionIds(pSet, cSet)) {
      const ps = pSet.get(factorId);
      const cs = cSet.get(factorId);
      if (ps?.held === true && cs?.held === true) continue;
      const [before, after] = pairValues(ps, cs);
      push(changeRow(
        { entity_kind: 'option_setting', entity_id: factorId, option_id: optionId, field: 'value', ...labels(ps?.label, cs?.label) },
        before,
        after,
        { before: ps?.kind, after: cs?.kind },
      ));
    }
  }

  // ── options entering / leaving the comparison ─────────────────────────────
  for (const optionId of unionIds(pOpts, cOpts)) {
    const p = pOpts.get(optionId);
    const c = cOpts.get(optionId);
    if (p !== undefined && c !== undefined) continue;
    push(changeRow(
      { entity_kind: 'option', entity_id: optionId, field: 'presence', ...labels(p?.label, c?.label) },
      p === undefined ? null : { raw: true },
      c === undefined ? null : { raw: true },
    ));
  }

  // ── factor values ─────────────────────────────────────────────────────────
  const pF = byId(prior.factors, (f) => f.factor_id);
  const cF = byId(current.factors, (f) => f.factor_id);
  for (const factorId of unionIds(pF, cF)) {
    const pf = pF.get(factorId);
    const cf = cF.get(factorId);
    const [before, after] = pairValues(pf, cf);
    push(changeRow({ entity_kind: 'factor_value', entity_id: factorId, field: 'value', ...labels(pf?.label, cf?.label) }, before, after));
  }

  // ── the goal ──────────────────────────────────────────────────────────────
  const pg = prior.goal;
  const cg = current.goal;
  if (pg !== null || cg !== null) {
    if (pg !== null && cg !== null && pg.node_id === cg.node_id) {
      const base = { entity_kind: 'goal' as const, entity_id: cg.node_id, ...labels(pg.label, cg.label) };
      const v = (raw: number | string | undefined): Value | null => (raw === undefined ? null : { raw });
      push(changeRow({ ...base, field: 'target' }, pg.target_raw !== undefined ? valueOf(pg.target_raw, undefined, pg.unit) : null,
        cg.target_raw !== undefined ? valueOf(cg.target_raw, undefined, cg.unit) : null));
      // A unit-only edit (AIQ 5912905493) is its own row even when the target number is unchanged.
      push(changeRow({ ...base, field: 'unit' }, v(pg.unit), v(cg.unit)));
      push(changeRow({ ...base, field: 'operator' }, v(pg.operator), v(cg.operator)));
      push(changeRow({ ...base, field: 'direction' }, v(pg.direction), v(cg.direction)));
    } else {
      // A different goal node: the old goal left, the new one arrived.
      if (pg !== null) push(changeRow({ entity_kind: 'goal', entity_id: pg.node_id, field: 'presence', ...labels(pg.label, undefined) }, { raw: true }, null));
      if (cg !== null) push(changeRow({ entity_kind: 'goal', entity_id: cg.node_id, field: 'presence', ...labels(undefined, cg.label) }, null, { raw: true }));
    }
  }

  // ── limits ────────────────────────────────────────────────────────────────
  const pC = byId(prior.constraints, (c) => c.constraint_id);
  const cC = byId(current.constraints, (c) => c.constraint_id);
  for (const id of unionIds(pC, cC)) {
    const pc = pC.get(id);
    const cc = cC.get(id);
    const base = { entity_kind: 'constraint' as const, entity_id: id, ...labels(pc?.label, cc?.label) };
    push(changeRow({ ...base, field: 'target' }, pc ? valueOf(pc.raw, undefined, pc.unit) : null, cc ? valueOf(cc.raw, undefined, cc.unit) : null));
    if (pc !== undefined && cc !== undefined) {
      push(changeRow({ ...base, field: 'operator' }, { raw: pc.operator }, { raw: cc.operator }));
    }
  }

  // ── links ─────────────────────────────────────────────────────────────────
  const key = (l: { from: string; to: string }) => `${l.from}->${l.to}`;
  const pL = byId(prior.links, key);
  const cL = byId(current.links, key);
  for (const id of unionIds(pL, cL)) {
    const pl = pL.get(id);
    const cl = cL.get(id);
    const ends = (pl ?? cl) as { from: string; to: string };
    push(changeRow(
      { entity_kind: 'link', entity_id: id, link: { from: ends.from, to: ends.to }, field: 'strength' },
      pl ? { raw: pl.mean } : null,
      cl ? { raw: cl.mean } : null,
    ));
  }

  return rows;
}
