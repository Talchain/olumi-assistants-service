/**
 * Un-analysed factors are not drivers — keep Olumi's ignorance out of the driver ranking.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE HARM, measured on Paul's own debug export (`olumi-debug-90b8f080`, 27 Sep, frozen tuple CEE `263dbd5` · PLoT
 * `1f6ad52` · ISL `3717e36`; AIQ #70 5854893356, DL GO 5854902243):
 *
 *   "Existing customers grandfathered"   no value, no prior          ranked Driver 1 of 6, "biggest", elasticity 0.9895
 *   "Pro plan price"                     the decision lever          elasticity 0, labelled "strong"
 *
 * ISL never analysed the first factor: it had no observed value and no parameter uncertainty, so ISL held it at a
 * constant 0.0 and said so in its own `ROOT_NODE_DEFAULT_VALUE` warning. The row the user saw is PLoT's STRUCTURAL
 * path-sum over two placeholder edges (−0.5 each; PLoT `factor-influence.ts:798-805`, whose own comment says it "is not
 * an elasticity at all"), passed through unchanged for a factor ISL did not match (`:945-952`) and normalised against
 * the lever. So the ranking presented Olumi's placeholder structure as the biggest influence on the goal. The lever's
 * "strong" comes from `LEVER_SUPPRESSION_FIELDS` zeroing the elasticity but keeping `influence_score` 1, which the band
 * reads (`driver-label.ts:138`).
 *
 * ─── WHAT THIS DOES (transport only; both claim branches) ─────────────────
 *   1. A factor the ENGINE says it defaulted (its own `ROOT_NODE_DEFAULT_VALUE` warning, `field`
 *      `nodes[<id>].observed_state.value`) and that no option sets (its row is not an `intervention_override` lever)
 *      is removed from every driver surface: `factor_sensitivity`, and `decision_brief.top_drivers` /
 *      `key_assumptions` / `what_would_change`. The remaining rows' `importance_rank` / `influence_rank` close up, so
 *      no surface shows a gap it would explain with the wrong reason.
 *   2. A lever row (`zero_reason: 'intervention_override'`) loses `driver_label`: its zero means "not uncertain — the
 *      decision sets it", not "no influence", and a band on it is a claim nothing measured.
 *
 * ⚠ WHAT IT DELIBERATELY KEEPS. `decision_brief.defaulted_assumptions` and `inference_warnings` still disclose the
 * default — the fact is true and the user is owed it. Nothing is synthesised: no replacement "biggest", no new copy.
 * Absence, not invention (the house rule in `withheld-claim-projection.ts`).
 *
 * ⚠ IDENTITY, NEVER A VALUE PREDICATE. The drop is keyed on the engine's own warning naming the node id, never on an
 * elasticity threshold, a missing provenance field or an edge's `defaulted` flag (every edge on Paul's model is
 * defaulted, so that predicate would drop every row). A label-keyed list entry is removed only when exactly one
 * `factor_sensitivity` row carries that label, so a shared label can never take a second factor with it.
 *
 * The source fix is PLoT's (MG, deferred behind the Paul-hit queue): stamp the un-analysed row, band no suppressed
 * lever. When that lands this projection becomes a no-op on its output and can be retired.
 */

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The engine's own default-root warning code (ISL `ROOT_NODE_DEFAULT_VALUE`, carried by PLoT on the enrichment). */
const DEFAULT_ROOT_CODE = 'ROOT_NODE_DEFAULT_VALUE';
const DEFAULT_ROOT_FIELD = /^nodes\[(.+)\]\.observed_state\.value$/;
/** PLoT's lever stamp: the decision sets this factor, so its uncertainty contribution is zero by construction. */
const LEVER_ZERO_REASON = 'intervention_override';
const RANK_FIELDS = ['importance_rank', 'influence_rank'] as const;

/** The node ids the engine says it held at a default value because none was given. */
function defaultedRootIds(enrichment: Rec): Set<string> {
  const out = new Set<string>();
  const warnings = enrichment.inference_warnings;
  if (!Array.isArray(warnings)) return out;
  for (const w of warnings) {
    if (!isRecord(w) || w.code !== DEFAULT_ROOT_CODE || typeof w.field !== 'string') continue;
    const m = DEFAULT_ROOT_FIELD.exec(w.field);
    if (m !== null && m[1]!.length > 0) out.add(m[1]!);
  }
  return out;
}

/** Close the gaps a dropped row leaves in a 1-based rank field; a row without a finite rank is left as it is. */
function closeRanks(rows: Rec[], dropped: Rec[]): Rec[] {
  return rows.map((row) => {
    let next: Rec | null = null;
    for (const field of RANK_FIELDS) {
      const rank = row[field];
      if (typeof rank !== 'number' || !Number.isFinite(rank)) continue;
      const above = dropped.filter((d) => typeof d[field] === 'number' && (d[field] as number) < rank).length;
      if (above > 0) (next ??= { ...row })[field] = rank - above;
    }
    return next ?? row;
  });
}

export function projectUnanalysedDriversForTransport(enrichment: unknown): unknown {
  if (!isRecord(enrichment)) return enrichment;
  const rows = enrichment.factor_sensitivity;
  if (!Array.isArray(rows) || !rows.every(isRecord)) return enrichment;
  const sensitivity = rows as Rec[];

  const defaulted = defaultedRootIds(enrichment);
  const dropped = sensitivity.filter((r) =>
    typeof r.factor_id === 'string' && defaulted.has(r.factor_id) && r.zero_reason !== LEVER_ZERO_REASON);
  const leverBanded = sensitivity.some((r) => r.zero_reason === LEVER_ZERO_REASON && 'driver_label' in r);
  if (dropped.length === 0 && !leverBanded) return enrichment;

  const kept = closeRanks(sensitivity.filter((r) => !dropped.includes(r)), dropped).map((r) => {
    if (r.zero_reason !== LEVER_ZERO_REASON || !('driver_label' in r)) return r;
    const { driver_label: _band, ...rest } = r;
    return rest;
  });
  const patch: Rec = { factor_sensitivity: kept };

  // Label-keyed lists: a label is dropped only when exactly one sensitivity row carries it.
  const labelCount = (label: string) => sensitivity.filter((r) => r.factor_label === label).length;
  const droppedIds = new Set(dropped.map((r) => r.factor_id as string));
  const droppedLabels = new Set(
    dropped.map((r) => r.factor_label).filter((l): l is string => typeof l === 'string' && labelCount(l) === 1),
  );
  const brief = enrichment.decision_brief;
  if (isRecord(brief) && dropped.length > 0) {
    const briefPatch: Rec = {};
    const drivers = brief.top_drivers;
    if (Array.isArray(drivers)) {
      briefPatch.top_drivers = drivers.filter((d) => !(isRecord(d) && (
        (typeof d.factor_id === 'string' && droppedIds.has(d.factor_id))
        || (d.factor_id == null && typeof d.factor_label === 'string' && droppedLabels.has(d.factor_label)))));
    }
    for (const key of ['key_assumptions', 'what_would_change'] as const) {
      const list = brief[key];
      if (Array.isArray(list)) briefPatch[key] = list.filter((x) => !(typeof x === 'string' && droppedLabels.has(x)));
    }
    patch.decision_brief = { ...brief, ...briefPatch };
  }
  return { ...enrichment, ...patch };
}
