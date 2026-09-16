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
  /**
   * The target factor's declared scale. REQUIRED to write: without a
   * calibration there is no supported mapping from the user's figure to the
   * model, and inventing one is the fabrication this whole path exists to
   * avoid.
   */
  factorScale: { readonly cap?: number; readonly unit?: string } | undefined,
): Record<string, unknown> | null {
  if (existing === null) return null;
  // The encoded magnitude must already be present: this records a native
  // restatement OF something, never a first value.
  if (typeof existing.value !== 'number' || !Number.isFinite(existing.value)) return null;
  if (!Number.isFinite(write.nativeValue)) return null;

  // ⚠⚠ NO CALIBRATION, NO WRITE. Executed (Codex CX-60 witness): with the
  // stale encoded value carried through, the no-calibration and unit-mismatch
  // cases BOTH landed a cell that kept `value: 0.7` and reported
  // `unresolved: []` — a silent success over an unsupported conversion. The
  // refusal has to happen here, before the operation exists.
  if (typeof factorScale?.cap !== 'number' || !Number.isFinite(factorScale.cap)) return null;
  // A declared factor unit that disagrees with the figure's unit is a mismatch,
  // not a conversion opportunity.
  if (typeof factorScale.unit === 'string' && factorScale.unit !== write.unit) return null;

  // ⭐⭐ THE STALE ENCODED VALUE IS DROPPED, AND THAT IS THE POINT.
  //
  // My first cut spread the whole cell through, `value` included, on a
  // "preserve everything" instinct. Measured, that instinct BLOCKS the
  // calibration it was meant to protect: the encoder's `deriveValue` returns
  // `rec.value` immediately when a numeric one is present, so the native was
  // stored and never consumed — the cell stayed 0.7. Codex's control line is
  // the proof: "same calibrated native without old encoded value" -> 0.6.
  //
  // So the native reaches the existing calibration authority and the encoded
  // magnitude is RE-DERIVED from it. Every other field is still carried
  // through verbatim; siblings and unrelated meaning are untouched.
  const { value: _staleEncoded, display_value: _staleDisplay, ...carried } = existing;

  return {
    op: 'update_node',
    path: `/nodes/${write.optionId}/data/interventions/${write.factorId}`,
    value: {
      // Everything EXCEPT the stale encoded value and its display twin, which
      // described the old magnitude and would otherwise caption the new one.
      ...carried,
      raw_value: write.nativeValue,
      unit: write.unit,
    },
    old_value: existing,
    impact: 'moderate',
    rationale:
      `Records the ${write.unit} figure the user gave for ${write.optionLabel} `
      + `on ${write.factorLabel}, for the model value to be derived from.`,
  };
}

/**
 * ⭐ DID THE NATIVE FIGURE LAND? — the native path's own committed read.
 *
 * ⚠⚠ IT EXISTS BECAUSE `readCommittedOptionEffect` ANSWERS A DIFFERENT
 * QUESTION, AND REUSING IT WOULD REPORT A SUCCESSFUL WRITE AS A FAILURE.
 * That reader returns the ENCODED value, and the dispatcher compares it to the
 * value it asked to write:
 *
 *     const committed = readCommittedOptionEffect(appliedGraph, optionId, factorId);
 *     if (committed === optionEffectWrite.value) { ...success ack... }
 *
 * A native write leaves the encoded value DELIBERATELY unchanged, so `committed`
 * comes back as the pre-existing `0.7`, never equals the native figure, the
 * success branch never fires, and the turn falls into the
 * `option_effect_write_did_not_land` warning and its recovery copy — telling
 * the user their cost did not save while it sits correctly in the graph. This
 * lane's own defect class, arriving through the SUCCESS path.
 *
 * ⛔ And the tempting fix is wrong: do NOT teach `readCommittedOptionEffect` to
 * return the native when present. Its existing callers ask "did the ENCODED
 * value land?" and would start receiving a number in a different scale — two
 * questions under one reader (trap 21), which is how this estate loses days.
 */
export function readCommittedNativeQuantity(
  appliedGraph: unknown,
  optionId: string,
  factorId: string,
): { readonly rawValue: number; readonly unit: string } | undefined {
  const cell = readExistingIntervention(appliedGraph, optionId, factorId);
  if (cell === null) return undefined;
  const rawValue = cell.raw_value;
  const unit = cell.unit;
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return undefined;
  if (typeof unit !== 'string' || unit.trim() === '') return undefined;
  return { rawValue, unit };
}

/**
 * The acknowledgement, citing the COMMITTED bytes rather than the request —
 * the same rule the option-effect ack follows (ROADMAP 2.427 P5).
 *
 * ⚠ IT SAYS WHAT IT DID AND WHAT IT DID NOT DO. Recording a cost does not
 * recalculate anything: the model value is untouched and the ranking still
 * reflects it. Saying only the first half would let the reader believe the
 * comparison had moved, which is the overclaim the constraint disclosure
 * already exists to prevent one level up.
 *
 * No forbidden vocabulary: no "recommend", no state-mutation denial, no
 * "previous analysis". Plain, and it names the option and the factor so the
 * user can see which cell it landed in.
 */
export function formatNativeQuantityAck(input: {
  readonly optionLabel: string;
  readonly factorLabel: string;
  readonly rawValue: number;
  readonly unit: string;
}): string {
  const amount = `${input.unit} ${input.rawValue.toLocaleString('en-GB')}`;
  return (
    `Recorded ${amount} as ${input.optionLabel}'s ${input.factorLabel}. `
    + `The model value for this option is unchanged, so the comparison still `
    + `reflects it — run the analysis again to check this figure against your limit.`
  );
}
