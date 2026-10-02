/**
 * ⭐ STEP 1: WHY THE OUTCOME CAN'T BE READ IN THE GOAL'S OWN UNITS, SAID BY OLUMI (DL 5947906652 marker-only; RC rule (1);
 * HARNESS item 2, #85 5947874597).
 *
 * Served step 1 (R3 f5 journey-10/11): a goal with NO target never reaches F1b's outcome withhold, so each option's outcome
 * (mean ≈ 0.02 on the model's own scale) reached the narrator unmarked and the explanation said "only on an internal
 * scale — not interpretable quarterly revenue" (13 served texts); where outcomes WERE withheld it said "no usable outcome
 * figures are supplied" (7 more). F1b now marks the run instead (`GOAL_OUTCOME_MODEL_SCALE`, strips nothing), and this
 * leaf is the marker's ONE reader on the Agent lane:
 *   - `modelScaleOutcomeOptionIds`: the marked options' outcome figures are kept from the model (the panel still shows
 *     them; the same rule as an outcome a withhold kept for the panel, `analysisResultForAgent`);
 *   - `modelScaleOutcomeLines`: RC's reason line and ONE next step, verbatim, said by Olumi FIRST on the explanation.
 * Fills come from the marker, verbatim (the user's words); a missing fill drops BOTH lines, never an unresolved template.
 * Copy: programme-docs RC `c04a14a1` `REASONING-INTERVENTIONS.json` `method_turns.shared.model_scale_outcome` (pinned by
 * test). Pure.
 */

type Rec = Record<string, unknown>;
const recordOf = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** F1b's marker code (`inference_warnings[]`, flat). */
export const GOAL_OUTCOME_MODEL_SCALE = 'GOAL_OUTCOME_MODEL_SCALE';
/** Every option (the marker named none: fail closed). */
export const EVERY_MARKED_OPTION = '*';

/** RC's words, verbatim, by the marker's precondition (P1 → `today_level`, P5 → `placeholder_link`). */
export const MODEL_SCALE_OUTCOME_COPY = {
  today_level: {
    reason: 'Olumi can’t yet say what the options do to {goal_label} in its own units: its current level isn’t set.',
    next_step: 'Give today’s {goal_label} and the next run can say it in its own units.',
  },
  placeholder_link: {
    reason: 'Olumi can’t yet say what the options do to {goal_label} in its own units: the link from {from_label} to {to_label} hasn’t been sized.',
    next_step: 'Size that link (accept Olumi’s estimate or give your own) and run again.',
  },
} as const;

export interface ModelScaleMarker {
  readonly precondition: 'P1' | 'P5';
  readonly option_ids: readonly string[] | typeof EVERY_MARKED_OPTION;
  readonly goal_label?: string;
  readonly from_label?: string;
  readonly to_label?: string;
}

function warningsOf(analysisResult: unknown): unknown[] {
  const block = recordOf(analysisResult);
  const enrichment = recordOf(block?.enrichment) ?? block;
  const w = enrichment?.inference_warnings;
  return Array.isArray(w) ? w : [];
}

/** The run's marker (the first one), or null. Accepts the `analysis_result` block or its `enrichment`. */
export function modelScaleMarkerOf(analysisResult: unknown): ModelScaleMarker | null {
  for (const w of warningsOf(analysisResult)) {
    const r = recordOf(w);
    if (r?.code !== GOAL_OUTCOME_MODEL_SCALE || (r.precondition !== 'P1' && r.precondition !== 'P5')) continue;
    const ids = Array.isArray(r.option_ids) ? r.option_ids.filter((id): id is string => typeof id === 'string') : null;
    return {
      precondition: r.precondition,
      option_ids: ids ?? EVERY_MARKED_OPTION,
      ...(filled(r.goal_label) ? { goal_label: r.goal_label } : {}),
      ...(filled(r.from_label) ? { from_label: r.from_label } : {}),
      ...(filled(r.to_label) ? { to_label: r.to_label } : {}),
    };
  }
  return null;
}

/** The options whose outcome figures the model must not see (`*` = every option), from every marker on the run. */
export function modelScaleOutcomeOptionIds(analysisResult: unknown): Set<string> {
  const out = new Set<string>();
  for (const w of warningsOf(analysisResult)) {
    const r = recordOf(w);
    if (r?.code !== GOAL_OUTCOME_MODEL_SCALE) continue;
    if (!Array.isArray(r.option_ids)) { out.add(EVERY_MARKED_OPTION); continue; }
    for (const id of r.option_ids) if (typeof id === 'string') out.add(id);
  }
  return out;
}

/** RC's reason line, then its ONE next step; `[]` when there is no marker or any fill the copy needs is missing. */
export function modelScaleOutcomeLines(marker: ModelScaleMarker | null): string[] {
  if (marker === null) return [];
  const copy = marker.precondition === 'P1' ? MODEL_SCALE_OUTCOME_COPY.today_level : MODEL_SCALE_OUTCOME_COPY.placeholder_link;
  const fills: Record<string, string | undefined> = { goal_label: marker.goal_label, from_label: marker.from_label, to_label: marker.to_label };
  const render = (t: string): string | null => {
    let missing = false;
    const s = t.replace(/\{(goal_label|from_label|to_label)\}/g, (_m, k: string) => {
      const v = fills[k];
      if (v === undefined) { missing = true; return ''; }
      return v;
    });
    return missing ? null : s;
  };
  const reason = render(copy.reason);
  const next = render(copy.next_step);
  return reason !== null && next !== null ? [reason, next] : [];
}
