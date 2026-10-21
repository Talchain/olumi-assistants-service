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
import { NOISE_BAND_SE_MULTIPLE } from '../coaching/win-probability-noise-band.js';
import { displayedPctAt, type GoalChanceDisplayRounding } from '../goal-target/goal-chance-display.js';
import { runVariant, type StressVariantParams, type VariantRun } from './stress-variant-run.js';

/** The value gestures a what-if holds. Structural edits, renames, goal and status changes are not what-ifs. */
export const WHAT_IF_KINDS: ReadonlySet<string> = new Set(['factor_value_edit', 'edge_strength_edit', 'option_intervention_edit', 'prior_range_edit']);

type Rec = Record<string, unknown>;
const isWhatIf = (c: Rec): c is Rec & ExplicitEdit => typeof c.kind === 'string' && WHAT_IF_KINDS.has(c.kind);
type Cell = Omit<StressChance, 'pct'>;
export type WhatIfTarget = { readonly node_id: string } | { readonly from: string; readonly to: string };

/** Beyond ordinary run-to-run variation, or not shown to be. On paired draws "within" can never be claimed safely. */
export type WhatIfVariation = 'beyond_ordinary_variation' | 'not_judged';
export const VARIATION_WORDS: Readonly<Record<WhatIfVariation, string>> = {
  beyond_ordinary_variation: "The what-if moves this option's chance by more than ordinary run-to-run variation.",
  not_judged: "This model can't say whether the what-if moves this option's chance by more than ordinary run-to-run variation.",
};

export interface WhatIfVariant {
  readonly change_index: number | 'all';
  /** The what-if and the saved model drew the same samples (PLoT's seed echoes are equal). Else not like-for-like. */
  readonly paired: boolean;
  readonly options: readonly {
    readonly option_id: string; readonly saved: Cell; readonly what_if: Cell;
    /** CEE's judgement and its sentence (`variationOf`); the UI renders the words and composes none. */
    readonly variation: WhatIfVariation; readonly variation_words: string;
  }[];
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
/** CEE's sentences for a cell with nothing to show; the Run's own withheld `why` is already one. The UI composes no copy. */
export const NO_RESULT_WORDS = 'This run gave no result to show for this option.';
export const NOT_IN_RUN_WORDS = 'This option was not part of this run.';
/** A cell with neither a figure nor the Run's reason says why itself: never a blank the user must interpret (Codex #3591). */
const cellOf = ({ pct: _figure, ...shown }: StressChance): Cell =>
  shown.display === null && shown.not_shown === null ? { ...shown, not_shown: NO_RESULT_WORDS } : shown;
const NOT_SHOWN: Cell = { display: null, provisional: false, not_shown: NOT_IN_RUN_WORDS };

/** Every true chance the display could have shown as `pct` at `step`, read off `displayedPctAt` itself (its clamps
 *  included: a coarse step shows a small positive chance as 5%), widened by the scan's resolution. Null if none. */
const SCAN = 10_000;
const intervals = new Map<string, readonly [number, number] | null>();
function shownInterval(pct: number, step: GoalChanceDisplayRounding): readonly [number, number] | null {
  const key = `${step}:${pct}`;
  if (!intervals.has(key)) {
    let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i <= SCAN; i++) if (displayedPctAt(i / SCAN, step) === pct) { lo = Math.min(lo, i / SCAN); hi = Math.max(hi, i / SCAN); }
    intervals.set(key, lo > hi ? null : [Math.max(0, lo - 1 / SCAN), Math.min(1, hi + 1 / SCAN)]);
  }
  return intervals.get(key)!;
}

/**
 * BEYOND ORDINARY VARIATION, claimed only when it holds for ANY true values the shown figures allow and ANY covariance
 * between the runs (Codex #3591 r2, #3602 r1):
 *  · each shown figure (the licence's `pct_by_option`) stands for the whole interval of chances its display step could have
 *    shown as it (`shownInterval`, from `displayedPctAt`, so the 5%/95% clamps are included);
 *  · the gap is the smallest distance between the two intervals;
 *  · the band is 2 × (sd A + sd B): sd A + sd B bounds sd(A − B) for any covariance (the runs may move oppositely), each sd
 *    at the most variable proportion inside its interval, n from PLoT's n_samples; 2 SE as the Run delta (`NOISE_BAND_SE_MULTIPLE`).
 * Anything else is `not_judged`: on paired draws a "within" can never be claimed safely, so it is not offered.
 */
function variationOf(saved: StressChance | undefined, whatIf: StressChance | undefined, sSaved: GoalChanceDisplayRounding | undefined,
  sWhatIf: GoalChanceDisplayRounding | undefined, nSaved: number | null, nWhatIf: number | null): WhatIfVariation {
  if (saved?.pct == null || whatIf?.pct == null || nSaved === null || nWhatIf === null || nSaved <= 0 || nWhatIf <= 0) return 'not_judged';
  const ia = shownInterval(saved.pct, sSaved ?? 'whole');
  const ib = shownInterval(whatIf.pct, sWhatIf ?? 'whole');
  if (ia === null || ib === null) return 'not_judged';
  const sd = ([lo, hi]: readonly [number, number], n: number) => {
    const worst = Math.min(Math.max(0.5, lo), hi);
    return Math.sqrt((worst * (1 - worst)) / n);
  };
  const gap = Math.max(0, Math.max(ia[0], ib[0]) - Math.min(ia[1], ib[1]));
  return gap > NOISE_BAND_SE_MULTIPLE * (sd(ia, nSaved) + sd(ib, nWhatIf)) ? 'beyond_ordinary_variation' : 'not_judged';
}

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
        ...((v) => ({ variation: v, variation_words: VARIATION_WORDS[v] }))(variationOf(baseline.rows.get(option_id), result.rows.get(option_id),
          baseline.displayStep.get(option_id), result.displayStep.get(option_id), baseline.nSamples, result.nSamples)),
      })),
    });
  }
  return {
    kind: 'ran', persisted: false, variants, changes_refused: refused,
    changes_applied: applied.map(({ index, edit }) => ({ index, target: targetOf(edit) })),
  };
}
