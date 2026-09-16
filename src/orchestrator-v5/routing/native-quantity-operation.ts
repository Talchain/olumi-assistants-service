/**
 * ⭐ THE WRITE FOR A NATIVE OPTION QUANTITY — merge-safe by construction.
 *
 * `decideNativeQuantityAnswer` returns the figure the user gave. This turns it
 * into the ONE patch operation that records it, and it exists as its own module
 * for a single reason: **the obvious reuse silently destroys data.**
 *
 * ⚠⚠ WHY NOT `buildOptionEffectRawOperation`. That builder emits
 *
 *     value: { value: resolved.value }
 *
 * at `/nodes/<option>/data/interventions/<factor>` — a WHOLE-OBJECT REPLACEMENT.
 * Reusing it here would drop `source`, `target_match`, `value_confidence`,
 * `reasoning`, `encoding_map` and `display_value` from the cell, and — far
 * worse — it names the field `value`, which is the ENCODED magnitude the engine
 * computes on. Writing a native `95000` there would move a `[0,1]` intervention
 * to 95,000 and corrupt the causal model. The encoded value is never touched by
 * this operation; the native rides beside it.
 *
 * ⚠ THE CELL MUST ALREADY EXIST. This records a native figure for a cell whose
 * encoded value is already set — that is the whole situation it is built for
 * ("this option has 0.7 on Hiring Cost, and I need the same quantity in GBP").
 * If no intervention is present, there is nothing to restate and no encoded
 * value to preserve, so it returns `null` rather than minting a half cell.
 *
 * Pure: no I/O, no graph mutation. It returns an operation for the existing
 * applier to run, so normalisation, the field-safety screen, Zod, the referee
 * gate and the commit are all the same code every other edit goes through.
 */

/** The intervention cell as it stands, read from the graph by the caller. */
export interface ExistingIntervention {
  readonly [field: string]: unknown;
}

export interface NativeQuantityWrite {
  readonly optionId: string;
  readonly optionLabel: string;
  readonly factorId: string;
  readonly factorLabel: string;
  readonly nativeValue: number;
  readonly unit: string;
}

/**
 * Read the intervention cell for `(optionId, factorId)` from a graph, by
 * IDENTITY. Returns `null` when the option does not resolve to exactly one
 * option node, or the cell is absent — a duplicate or foreign id is not a
 * referent (trap 19).
 */
export function readExistingIntervention(
  graph: unknown,
  optionId: string,
  factorId: string,
): ExistingIntervention | null {
  if (graph === null || typeof graph !== 'object') return null;
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return null;
  const options = (nodes as ReadonlyArray<Record<string, unknown>>).filter(
    (n) => n.id === optionId && n.kind === 'option',
  );
  if (options.length !== 1) return null;
  const node = options[0]!;
  const data = node.data;
  const source =
    data !== null && typeof data === 'object' && (data as Record<string, unknown>).interventions
      ? ((data as Record<string, unknown>).interventions as unknown)
      : node.interventions;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return null;
  const cell = (source as Record<string, unknown>)[factorId];
  if (cell === null || typeof cell !== 'object' || Array.isArray(cell)) return null;
  return cell as ExistingIntervention;
}

/**
 * The single `update_node` operation that records the native figure.
 *
 * Every existing field is carried through verbatim; only `raw_value` and `unit`
 * are added or replaced. `old_value` carries the cell as it stood, so the
 * applier's own receipt describes a real before-state rather than `null`.
 */
export function buildNativeQuantityOperation(
  write: NativeQuantityWrite,
  existing: ExistingIntervention | null,
): Record<string, unknown> | null {
  if (existing === null) return null;
  // The encoded magnitude must already be present: this records a native
  // restatement OF something, never a first value.
  if (typeof existing.value !== 'number' || !Number.isFinite(existing.value)) return null;
  if (!Number.isFinite(write.nativeValue)) return null;

  return {
    op: 'update_node',
    path: `/nodes/${write.optionId}/data/interventions/${write.factorId}`,
    value: {
      // Spread FIRST so the cell keeps source, target_match, value_confidence,
      // reasoning, encoding_map and display_value. The encoded `value` rides
      // through here untouched — it is not this operation's business.
      ...existing,
      raw_value: write.nativeValue,
      unit: write.unit,
    },
    old_value: existing,
    impact: 'moderate',
    rationale:
      `Records the ${write.unit} figure the user gave for ${write.optionLabel} `
      + `on ${write.factorLabel}, beside the existing model value.`,
  };
}
