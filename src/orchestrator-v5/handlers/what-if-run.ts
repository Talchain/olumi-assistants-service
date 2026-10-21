/**
 * A WHAT-IF ON THE CANVAS, NOTHING SAVED (canvas scenario comparison, slices 1–2; DL 21 Oct). The person makes the same
 * value gestures the canvas already sends (`factor_value_edit`, `edge_strength_edit`, `option_intervention_edit`,
 * `prior_range_edit`), held instead of sent. Each is applied with the saved-edit path's own `applyExplicitEdit` to a COPY
 * of the living model, mapped by the same mapper, and run on the stress variant path (`stress-variant-run.ts`): the
 * standard `run_analysis` handler on an in-memory snapshot, its fact read and DISCARDED. No commit, no turn row, no Run
 * fact, no scenario write.
 *
 *  · The saved model is run beside it on the same path and mapper, so the only difference is the person's gestures.
 *  · No explicit seed: the Run's own seed reuse lends the saved Run's seed where the draw structure matches. `paired` is
 *    PROVEN from PLoT's echoes (`meta.seed_used`), never assumed: the what-if and the saved model drew the same samples.
 *  · `crux`: each applied change is also run alone, all against the same saved run, so the canvas can show which change
 *    moves which option. CEE does the arithmetic; the UI lays out the cells.
 *  · Cells are the Run's own displays (`stressChancesOf`): a figure or range through the goal-chance gate, or withheld with
 *    why. The raw percentage is never returned.
 *  · Built on a model that has since changed (`base_graph_hash`), or not a core scenario: refused with its reason.
 */
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import type { LivingModelT } from '../../schemas/living-model.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { applyExplicitEdit, type ExplicitEdit } from '../path-b/living-model/edit.js';
import { goalIdOf, mapLivingModel, savedGoal } from '../path-b/living-model/mapper.js';
import { livingViewOf } from '../path-b/living-model/view.js';
import type { StressChance } from '../path-b/tools/stress-tool.js';
import { noiseVerdictForProportions } from '../coaching/win-probability-noise-band.js';
import { runVariant, type StressVariantParams, type VariantRun } from './stress-variant-run.js';

/** The value gestures a what-if holds. Structural edits, renames, goal and status changes are not what-ifs. */
export const WHAT_IF_KINDS: ReadonlySet<string> = new Set(['factor_value_edit', 'edge_strength_edit', 'option_intervention_edit', 'prior_range_edit']);

type Rec = Record<string, unknown>;
const isWhatIf = (c: Rec): c is Rec & ExplicitEdit => typeof c.kind === 'string' && WHAT_IF_KINDS.has(c.kind);
type Cell = Omit<StressChance, 'pct'>;
export type WhatIfTarget = { readonly node_id: string } | { readonly from: string; readonly to: string };

/** Whether an option's chance moved beyond ordinary run-to-run variation, judged by CEE so the UI never works it out. */
export type WhatIfVariation = 'beyond_ordinary_variation' | 'within_ordinary_variation' | 'not_judged';

export interface WhatIfVariant {
  readonly change_index: number | 'all';
  /** The what-if and the saved model drew the same samples (PLoT's seed echoes are equal). Else not like-for-like. */
  readonly paired: boolean;
  readonly options: readonly { readonly option_id: string; readonly saved: Cell; readonly what_if: Cell; readonly variation: WhatIfVariation }[];
}

export type WhatIfResult =
  | { readonly kind: 'refused'; readonly reason: string; readonly changes_refused?: readonly { readonly index: number; readonly reason: string }[] }
  | {
    readonly kind: 'ran';
    readonly persisted: false;
    readonly changes_applied: readonly { readonly index: number; readonly target: WhatIfTarget }[];
    readonly changes_refused: readonly { readonly index: number; readonly reason: string }[];
    readonly variants: readonly WhatIfVariant[];
  };

export interface WhatIfDeps {
  /** The saved scenario row (`loadPersistedScenarioStateStrict`). */
  readonly loadSaved: (scenarioId: string) => Promise<{ readonly graph: unknown }>;
  /** One variant on the stress path; production is `runVariant`. */
  readonly run?: (p: StressVariantParams) => Promise<VariantRun>;
}

function targetOf(edit: ExplicitEdit): WhatIfTarget {
  switch (edit.kind) {
    case 'edge_strength_edit': return { from: edit.from, to: edit.to };
    case 'option_intervention_edit': return { node_id: edit.factor_id };
    default: return { node_id: (edit as { target_id: string }).target_id };
  }
}

/** A cell with neither a figure nor the Run's reason says why itself: never a blank the user must interpret (Codex #3591). */
const cellOf = ({ pct: _figure, ...shown }: StressChance): Cell =>
  shown.display === null && shown.not_shown === null ? { ...shown, not_shown: 'no_result_for_this_option' } : shown;

/**
 * The Run-delta noise test (`noiseVerdictForProportions`: two proportions, 2 standard errors), on the figures the user SEES
 * (the licence's whole percentages, never a re-derived probability). A shown figure is rounded, so the verdict must hold at
 * both ends of the rounding: beyond only if still beyond with the two pulled half a point together, within only if still
 * within with them pushed half a point apart; else not judged. It treats the runs as independent samples; on paired draws
 * that is conservative (a "beyond" stands; a small real change may read as within). No shown chance on either side, or no
 * sample count, is not judged.
 */
function variationOf(saved: StressChance | undefined, whatIf: StressChance | undefined, nSaved: number | null, nWhatIf: number | null): WhatIfVariation {
  if (saved?.pct == null || whatIf?.pct == null || nSaved === null || nWhatIf === null) return 'not_judged';
  const [a, b] = [saved.pct / 100, whatIf.pct / 100];
  const half = 0.005 * (Math.sign(b - a) || 1);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  if (Math.abs(b - a) > 0.01 && noiseVerdictForProportions(a + half, b - half, nSaved, nWhatIf) === 'signal') return 'beyond_ordinary_variation';
  return noiseVerdictForProportions(clamp(a - half), clamp(b + half), nSaved, nWhatIf) === 'within_noise' ? 'within_ordinary_variation' : 'not_judged';
}
const NOT_SHOWN: Cell = { display: null, provisional: false, not_shown: 'not_in_this_run' };

export async function runWhatIf(
  p: {
    readonly payload: MessageTurnPayload; readonly requestId: string; readonly changes: readonly Rec[]; readonly crux: boolean;
    /** The saved model the canvas built the what-if on; a gesture that carries its own `base_graph_hash` is checked too. */
    readonly baseGraphHash?: string;
    readonly signal?: AbortSignal;
  },
  deps: WhatIfDeps,
): Promise<WhatIfResult> {
  const run = deps.run ?? runVariant;
  const stored = (await deps.loadSaved(p.payload.scenario_id)).graph;
  const view = livingViewOf(stored);
  if (view === undefined || !('withheld' in view)) return { kind: 'refused', reason: 'not_a_core_scenario' };
  const saved = view.living_model as LivingModelT;
  const goal = savedGoal(stored);
  const base = computeExpectedGraphCasHashes(stored).expectedGraphAnalysisHash;
  const claimed = [p.baseGraphHash, ...p.changes.map((c) => c.base_graph_hash)].filter((h): h is string => typeof h === 'string');
  if (claimed.some((h) => h !== base)) return { kind: 'refused', reason: 'stale_base' };

  // Applied one by one, in order, as the saved-edit path applies each; a refused gesture is named and left out.
  const applied: { readonly index: number; readonly edit: ExplicitEdit }[] = [];
  const refused: { index: number; reason: string }[] = [];
  let all = saved;
  p.changes.forEach((c, index) => {
    if (!isWhatIf(c)) { refused.push({ index, reason: 'not_a_what_if_gesture' }); return; }
    const outcome = applyExplicitEdit(all, c, goalIdOf(stored));
    if (!('model' in outcome)) { refused.push({ index, reason: outcome.refused }); return; }
    all = outcome.model;
    applied.push({ index, edit: c });
  });
  if (applied.length === 0) return { kind: 'refused', reason: 'no_change_applied', changes_refused: refused };

  const graphOf = (model: LivingModelT): Rec => ({ ...mapLivingModel(model, goal).graph, living_model: model });
  const alone = (edit: ExplicitEdit): LivingModelT | null => {
    const outcome = applyExplicitEdit(saved, edit, goalIdOf(stored));
    return 'model' in outcome ? outcome.model : null;
  };
  const runOne = (model: LivingModelT) => run({ payload: p.payload, requestId: p.requestId, variantGraph: graphOf(model), signal: p.signal });

  const baseline = await runOne(saved);
  if (baseline.kind !== 'rows') return { kind: 'refused', reason: `saved_${baseline.reason}` };
  const plan: { readonly change_index: number | 'all'; readonly model: LivingModelT | null }[] = [
    { change_index: 'all', model: all },
    ...(p.crux && applied.length > 1 ? applied.map(({ index, edit }) => ({ change_index: index, model: alone(edit) })) : []),
  ];
  const variants: WhatIfVariant[] = [];
  for (const { change_index, model } of plan) {
    if (model === null) continue;
    const result = await runOne(model);
    if (result.kind !== 'rows') {
      if (change_index === 'all') return { kind: 'refused', reason: `what_if_${result.reason}`, changes_refused: refused };
      continue;
    }
    const ids = [...new Set([...baseline.rows.keys(), ...result.rows.keys()])];
    variants.push({
      change_index,
      paired: baseline.seedUsed !== null && baseline.seedUsed === result.seedUsed,
      options: ids.map((option_id) => ({
        option_id,
        saved: baseline.rows.has(option_id) ? cellOf(baseline.rows.get(option_id)!) : NOT_SHOWN,
        what_if: result.rows.has(option_id) ? cellOf(result.rows.get(option_id)!) : NOT_SHOWN,
        variation: variationOf(baseline.rows.get(option_id), result.rows.get(option_id), baseline.nSamples, result.nSamples),
      })),
    });
  }
  return {
    kind: 'ran', persisted: false, variants, changes_refused: refused,
    changes_applied: applied.map(({ index, edit }) => ({ index, target: targetOf(edit) })),
  };
}
