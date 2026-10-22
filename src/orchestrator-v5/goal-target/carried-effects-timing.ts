/**
 * ⭐ THE AUTOMATIC RUN CARRIES THE AI'S TIMING READING (DL 12:57Z 14 Oct, after #3038; `undeployed/CEE-recovery.md`, #2987 T2).
 * The automatic Run after a committed change sent `effects_timing: null`, and a goal chance that rests on the AI's reading of
 * when the options' effects are in place is withheld without one (`periodEndConditionalOf`). So hiring's conditional chance
 * was withheld on every automatic Run after an edit, although the AI had read the timing for the Run before it.
 *
 * The reading carried is the one the latest Run RECORDED on the model as the turn found it: its licence's reading, or its
 * period-end withhold's (each records Olumi's reading as such, `effects_timing_origin: 'olumi'`). It is carried only while
 * this turn's change left that reading's subject exactly as it was: the same options (every option node, every link from an
 * option) and the same goal (`goalReadingProjectionOf`: label, target, horizon, period, reading). Otherwise none, so the Run
 * withholds and asks, as before. Never a default: an absent, invalid or disagreeing reading carries nothing.
 */
import { isDeepStrictEqual } from 'node:util';
import { effectsTimingOf, type EffectsTiming } from './period-end-assumption.js';
import { GOAL_CHANCE_LICENSED, PERIOD_END_EFFECTS_UNSTATED, periodEndEffectsUnstatedOf } from './goal-chance-licence.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../orchestrator/context/option-result-source.js';
import { goalReadingProjectionOf } from './goal-reading-write.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const nodesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []);
const edgesOf = (graph: unknown): Rec[] => (isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : []);
const byId = (a: Rec, b: Rec): number => String(a.id).localeCompare(String(b.id));
const byEnds = (a: Rec, b: Rec): number => `${String(a.from)}\u0000${String(a.to)}`.localeCompare(`${String(b.from)}\u0000${String(b.to)}`);

/** Olumi's timing reading recorded by a Run's result; `undefined` unless every record names the same valid reading. */
export function recordedEffectsTimingOf(result: unknown): EffectsTiming | undefined {
  if (!isRec(result)) return undefined;
  const records = [isRec(result.enrichment) ? result.enrichment.inference_warnings : undefined, result.inference_warnings]
    .flatMap((w) => (Array.isArray(w) ? w : [])).filter(isRec);
  const readings = records.flatMap((w) => {
    if (w.code === GOAL_CHANCE_LICENSED && w.effects_timing_origin === 'olumi') return [w.effects_timing];
    const detail = isRec(w.detail) ? w.detail : undefined;
    return w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE && detail?.reason === PERIOD_END_EFFECTS_UNSTATED
      && detail.effects_timing_origin === 'olumi' ? [detail.effects_timing] : [];
  }).map(effectsTimingOf);
  if (readings.length === 0 || readings.some((r) => r === undefined) || new Set(readings).size !== 1) return undefined;
  return readings[0];
}

/** The options as a Run sends them: every option node and every link from an option, in a stable order. */
function optionsSubjectOf(graph: unknown): unknown {
  const options = nodesOf(graph).filter((n) => n.kind === 'option').sort(byId);
  const ids = new Set(options.map((n) => n.id));
  return { options, links: edgesOf(graph).filter((e) => ids.has(e.from)).sort(byEnds) };
}

/** The single goal's projection; `undefined` for none or several (no subject to bind a reading to). */
function goalSubjectOf(graph: unknown): unknown {
  const goals = nodesOf(graph).filter((n) => n.kind === 'goal' && typeof n.id === 'string');
  return goals.length === 1 ? goalReadingProjectionOf(graph, goals[0]!.id as string) : undefined;
}

/**
 * The reading the automatic Run sends: the turn-start Run's recorded reading while the saved model keeps its subject, else
 * `null` (the Run's existing "no reading" input). `before` is the turn-start graph read as it came (`turnStartRead`): the
 * model as the turn found it, with the result that read selected (a read carries a result only for its own graph, so this is
 * the Run that was current on it).
 */
export function carriedEffectsTiming(before: { readonly graph?: unknown; readonly analysis_result?: unknown } | undefined, saved: unknown): EffectsTiming | null {
  if (before === undefined) return null;
  const reading = recordedEffectsTimingOf(before.analysis_result);
  if (reading === undefined) return null;
  const goalBefore = goalSubjectOf(before.graph);
  if (goalBefore === undefined || !isDeepStrictEqual(goalBefore, goalSubjectOf(saved))) return null;
  return isDeepStrictEqual(optionsSubjectOf(before.graph), optionsSubjectOf(saved)) ? reading : null;
}

/**
 * ⭐ NO AUTOMATIC RUN THAT COULD ONLY WITHHOLD (DL 22 Oct, hiring a on 2fa753d6: the automatic Run after an approval withheld
 * every chance, and the pressed Run two minutes later gave them on the same graph). True when the saved goal's chance rests on
 * a reading of when the options' effects are in place (`periodEndEffectsUnstatedOf`) and no reading can be carried: the reply
 * invites Run, where the AI gives its reading. A goal that needs no timing reading keeps its automatic Run.
 */
export function awaitsTimingReading(saved: unknown, carried: EffectsTiming | null): boolean {
  const goals = nodesOf(saved).filter((n) => n.kind === 'goal');
  return carried === null && goals.length === 1 && periodEndEffectsUnstatedOf(saved, goals[0]!.id) !== undefined;
}
