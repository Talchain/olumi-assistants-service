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
 *
 * ON A MODEL PROGRAM (HC5, Paul D10: A, the existing lens on the same draws; `runProgramWhatIf`): the same request and the same
 * result, run in CEE's own engine, no PLoT call. A card's figure (`factor_value_edit`, as the program's canvas edit takes it,
 * routes/core-turn.ts) is applied with the save path's own postimage (`canvasFigurePostimage`) to a copy of the program;
 * other gestures are refused one by one, by name. The saved model and the what-if are evaluated on the scenario's seed with
 * each draw kept: every figure is drawn from its own stream keyed by (seed, id) (prng.ts), so each draw index is the same
 * world in both, and each option's gap is the paired difference on those draws (paired.ts, Newcombe method 10).
 * "Beyond ordinary variation" is said where that gap's 95% precision is clear of 0 (`separated`) AND it is wider than two
 * independent Runs could differ by (`programGap`), so the words stay true. Nothing is saved.
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
import type { CanonicalModelT } from '../model-program/canonical.js';
import type { PresentCell } from '../model-program/present/present.js';
import { pairedDifference, separated, type PairedDifference } from '../model-program/simulate/paired.js';
import { isWithheld, type Chance } from '../model-program/simulate/result.js';
import { restsOn } from '../model-program/simulate/simulate.js';
import { evaluateCanonical, type Evaluation } from '../model-program-turn/evaluate.js';
import { programRevisionOf } from '../model-program-turn/program-card.js';
import { programReadOf, sourceTextOf, unreadableWords, type SavedProgram } from '../model-program-turn/program-store.js';
import { canvasFigurePostimage } from '../model-program-turn/program-tools.js';

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
  /** The what-if and the saved model drew the same samples (PLoT's seed echoes are equal; on a program, the same seed and
   *  draws, every figure on its own stream). Else not like-for-like. */
  readonly paired: boolean;
  readonly options: readonly {
    readonly option_id: string; readonly saved: Cell; readonly what_if: Cell;
    /** CEE's judgement and its sentence (`variationOf`); the UI renders the words and composes none. */
    readonly variation: WhatIfVariation; readonly variation_words: string;
    /** On a program only: what-if minus saved on the same draws, with its paired 95% precision; null where either is not shown. */
    readonly paired_difference?: { readonly difference: number; readonly precision_95: readonly [number, number] } | null;
  }[];
}

/** `words`, on a program: the save path's own sentence for why that figure cannot be set (CEE composes it, the UI none). */
type RefusedChange = { readonly index: number; readonly reason: string; readonly words?: string };
export type WhatIfResult =
  | {
    readonly kind: 'refused'; readonly reason: string; readonly changes_refused?: readonly RefusedChange[];
    /** A model the Run cannot analyse: the Run's own next step and questions, so the canvas can say why and what to add. */
    readonly next_step?: string; readonly readiness_questions?: readonly string[];
  }
  | {
    readonly kind: 'ran';
    readonly persisted: false;
    readonly changes_applied: readonly { readonly index: number; readonly target: WhatIfTarget }[];
    readonly changes_refused: readonly RefusedChange[];
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

/** The Run's own reason a model cannot be analysed, carried as given (absent keys stay absent). */
const whyNot = (r: { readonly next_step?: string; readonly readiness_questions?: readonly string[] }) => ({
  ...(r.next_step !== undefined ? { next_step: r.next_step } : {}),
  ...(r.readiness_questions !== undefined ? { readiness_questions: r.readiness_questions } : {}),
});

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
  const read = programReadOf(stored);
  if (read.kind === 'unreadable') return { kind: 'refused', reason: 'program_unreadable', next_step: unreadableWords(read.reason) };
  if (read.kind === 'program') {
    const claimed = [p.baseGraphHash, ...p.changes.map((c) => c.base_graph_hash)].filter((h): h is string => typeof h === 'string');
    if (claimed.some((h) => h !== programRevisionOf(stored))) return { kind: 'refused', reason: 'stale_base' };
    return runProgramWhatIf(read.program, p.changes, p.crux);
  }
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
  if (baseline.kind !== 'rows') return { kind: 'refused', reason: `saved_${baseline.reason}`, ...whyNot(baseline) };
  const plan: { readonly change_index: number | 'all'; readonly model: LivingModelT | null }[] = [
    { change_index: 'all', model: all },
    ...(p.crux && applied.length > 1 ? applied.map(({ index, edit }) => ({ change_index: index, model: alone(edit) })) : []),
  ];
  const variants: WhatIfVariant[] = [];
  for (const { change_index, model } of plan) {
    if (model === null) continue;
    const result = await runOne(model);
    if (result.kind !== 'rows') {
      if (change_index === 'all') return { kind: 'refused', reason: `what_if_${result.reason}`, changes_refused: refused, ...whyNot(result) };
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

/** On a program, a what-if holds a card's figure; these the program's canvas edit does not take either (routes/core-turn.ts). */
const PROGRAM_NOT_A_FIGURE = 'not_a_figure_on_this_model';
const numberOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A cell as the lens shows it: the view's own display or its why; `provisional` where the chance rests on a figure of
 *  Olumi's: one upstream of an aim (`restsOn`), or an aim's window length or origin timing (the compiler resolves those into
 *  the window, so they are read off the canonical model: Codex HC5 r1). */
function programCell(e: Evaluation, canonical: CanonicalModelT, optionId: string): Cell {
  const cell = (e.view.options as readonly { readonly option_id: string; readonly cell: PresentCell }[]).find((o) => o.option_id === optionId)?.cell;
  if (cell === undefined) return NOT_SHOWN;
  if (cell.kind === 'withheld') return { display: null, provisional: false, not_shown: cell.why };
  const x = e.compiled.executable!;
  const roots = [...x.goals.flatMap((g) => [g.quantity, g.target, ...(g.per !== undefined ? [g.per] : [])]), ...x.limits.flatMap((l) => [l.quantity, l.bound, ...(l.per !== undefined ? [l.per] : [])])];
  const behind = restsOn(x, roots, optionId);
  const olumis = x.quantities.some((q) => behind.has(q.id) && q.dist !== undefined
    && (q.dist.kind === 'fixed' ? q.dist.author === 'olumi' : q.dist.basis === 'olumi_estimate'));
  // Only the aims this Run computed (a limit left out of the Run is not behind its chances: Codex HC5 r2).
  const inRun = new Set([...x.goals, ...x.limits].map((a) => a.id));
  const windows = [...canonical.goals, ...canonical.limits].filter((a) => inRun.has(a.id)).flatMap((a) => [a.measure?.window?.periods, a.measure?.window?.origin_offset])
    .filter((id): id is string => typeof id === 'string');
  const timed = canonical.quantities.some((q) => windows.includes(q.id) && q.author === 'olumi');
  return { display: cell.display, provisional: olumis || timed, not_shown: null };
}

/** What-if minus saved for one option on the same draws, or null where either side shows no figure. */
function programGap(saved: Evaluation, whatIf: Evaluation, optionId: string): { readonly gap: PairedDifference; readonly beyond: boolean } | null {
  const at = (e: Evaluation) => e.sim?.per_draw?.options.find((o) => o.option_id === optionId);
  const chance = (e: Evaluation) => e.sim?.options.find((o) => o.option_id === optionId)?.joint_within_limits;
  const a = at(whatIf), b = at(saved), ca = chance(whatIf), cb = chance(saved);
  if (a === undefined || b === undefined || ca === undefined || cb === undefined || isWithheld(ca) || isWithheld(cb)) return null;
  const exact = (c: Chance) => c.precision_95[0] === c.precision_95[1];
  const gap = pairedDifference(a.joint_within_limits, b.joint_within_limits, exact(ca) && exact(cb));
  // "Beyond ordinary run-to-run variation" (VARIATION_WORDS) needs more than a real gap on the shared draws (Codex HC5 r1: 20
  // → 20.01 joins is a real 0.17-point gap): the gap must also pass the band two independent Runs could differ by, 2 × (sd A +
  // sd B), each sd at the most variable chance inside its 95% precision (as `variationOf` reads the PLoT path).
  const sd = (c: Chance, n: number) => { const worst = Math.min(Math.max(0.5, c.precision_95[0]), c.precision_95[1]); return Math.sqrt((worst * (1 - worst)) / n); };
  const band = NOISE_BAND_SE_MULTIPLE * (sd(ca, whatIf.sim!.draws) + sd(cb, saved.sim!.draws));
  return { gap, beyond: separated(gap) && gap.kind !== 'withheld' && Math.abs(gap.difference) > band };
}

/** The words a refused saved or what-if evaluation gives: the first option's own why. */
const whyOf = (e: Evaluation): { next_step?: string } => {
  const c = (e.view.options as readonly { readonly cell: PresentCell }[])[0]?.cell;
  return c !== undefined && c.kind === 'withheld' ? { next_step: c.why } : {};
};

export function runProgramWhatIf(program: SavedProgram, changes: readonly Rec[], crux: boolean): WhatIfResult {
  const brief = program.person_words[0] !== undefined ? { brief: program.person_words[0] } : {};
  const evaluate = (canonical: CanonicalModelT, typed: readonly string[]): Evaluation =>
    evaluateCanonical(canonical, { sourceText: sourceTextOf([...program.person_words, ...typed]), seed: program.seed, perDraw: true, ...brief });
  /** One figure, applied to `on` with the save path's own postimage; the same figure as saved is applied as no change. */
  const figure = (on: SavedProgram, c: Rec): { readonly ok: true; readonly model: CanonicalModelT; readonly words: readonly string[] } | { readonly ok: false; readonly refused: Omit<RefusedChange, 'index'> } => {
    const value = numberOf(c.raw_value ?? c.value);
    if (c.kind !== 'factor_value_edit' || typeof c.target_id !== 'string' || value === undefined) return { ok: false, refused: { reason: PROGRAM_NOT_A_FIGURE } };
    const built = canvasFigurePostimage(on, { target: { quantity_id: c.target_id }, value }, null);
    if (built.ok) return { ok: true, model: built.model, words: [built.words] };
    return built.code === 'no_change' ? { ok: true, model: on.canonical, words: [] } : { ok: false, refused: { reason: built.code ?? 'not_applied', words: built.reason } };
  };

  const applied: { readonly index: number; readonly change: Rec }[] = [];
  const refused: RefusedChange[] = [];
  let all = program, typed: string[] = [];
  changes.forEach((c, index) => {
    const out = figure(all, c);
    if (!out.ok) { refused.push({ index, ...out.refused }); return; }
    typed = [...typed, ...out.words];
    all = { ...all, canonical: out.model, person_words: [...all.person_words, ...out.words] };
    applied.push({ index, change: c });
  });
  if (applied.length === 0) return { kind: 'refused', reason: 'no_change_applied', changes_refused: refused };

  const saved = evaluate(program.canonical, []);
  if (saved.sim === null) return { kind: 'refused', reason: saved.too_large === true ? 'saved_too_large' : 'saved_not_analysable', ...whyOf(saved) };
  const plan: { readonly change_index: number | 'all'; readonly model: CanonicalModelT; readonly typed: readonly string[] }[] = [
    { change_index: 'all', model: all.canonical, typed },
    ...(crux && applied.length > 1 ? applied.flatMap(({ index, change }) => {
      const out = figure(program, change);
      return out.ok ? [{ change_index: index, model: out.model, typed: out.words }] : [];
    }) : []),
  ];
  const variants: WhatIfVariant[] = [];
  for (const { change_index, model, typed: words } of plan) {
    const whatIf = evaluate(model, words);
    if (whatIf.sim === null || whatIf.compiled.errors.length > 0) {
      if (change_index === 'all') return { kind: 'refused', reason: whatIf.too_large === true ? 'what_if_too_large' : 'what_if_not_analysable', changes_refused: refused, ...whyOf(whatIf) };
      continue;
    }
    const ids = [...new Set([...saved.view.options.map((o) => o.option_id), ...whatIf.view.options.map((o) => o.option_id)])];
    variants.push({
      change_index, paired: true,
      options: ids.map((option_id) => {
        const shown = programCell(saved, program.canonical, option_id), moved = programCell(whatIf, model, option_id);
        const paired = shown.display === null || moved.display === null ? null : programGap(saved, whatIf, option_id);
        const gap = paired?.gap ?? null;
        const variation: WhatIfVariation = paired?.beyond === true ? 'beyond_ordinary_variation' : 'not_judged';
        return { option_id, saved: shown, what_if: moved, variation, variation_words: VARIATION_WORDS[variation],
          paired_difference: gap === null || gap.kind === 'withheld' ? null
            : { difference: gap.difference, precision_95: gap.kind === 'exact' ? [gap.difference, gap.difference] : gap.precision_95 } };
      }),
    });
  }
  return { kind: 'ran', persisted: false, variants, changes_refused: refused,
    changes_applied: applied.map(({ index, change }) => ({ index, target: { node_id: change.target_id as string } })) };
}
