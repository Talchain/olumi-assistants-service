/**
 * THE READINESS OF A MODEL PROGRAM (alpha, DL 23 Oct): the program's own, never the legacy assessor's. A program scenario's
 * analysis is its compiler and its stored Runs, so the legacy readiness and blocker producers (`resolveRunAdmission`, the
 * readiness issues, the repair proposal, the admission verdict) never run on it: their blockers describe a graph format the
 * program does not have ("a range for a figure the program already accepted") and their `may_run` refused every Run.
 *
 * The payload keeps the fields the canvas reads off a readiness block (the goal's target, each option and what it sets),
 * from the saved graph's own projection, and says whether a Run can work something out now (`may_run`). Its open questions
 * are the program's asks, carried by its stored Run and its context, never re-derived here.
 */
import type { AnalysisReadyPayload } from '../../orchestrator/tools/analysis-ready-helper.js';
import { compile } from '../model-program/compile.js';
import { admission } from './evaluate.js';
import { savedProgramOf, sourceTextOf } from './program-store.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** The goal target fields the canvas syncs from a readiness block, as the projection wrote them on the goal's card. */
const GOAL_FIELDS = ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_unit', 'goal_threshold_cap', 'goal_threshold_cap_provenance', 'goal_threshold_frame'] as const;

/** A program graph's readiness, or undefined when the graph holds no program, or one that cannot be read. */
export function programReadinessOf(graph: unknown): AnalysisReadyPayload | undefined {
  const program = savedProgramOf(graph);
  if (program === undefined || !isRec(graph)) return undefined;
  const model = program.canonical;
  const compiled = compile(model, { sourceText: sourceTextOf(program.person_words) });
  const nodes = (Array.isArray(graph['nodes']) ? graph['nodes'] : []).filter(isRec);
  const goal = model.goals.find((g) => g.measure !== null) ?? model.goals[0];
  const goalNode = nodes.find((n) => n['id'] === goal?.id);
  const quantity = new Map(model.quantities.map((q) => [q.id, q] as const));
  // A model its Run would refuse for size (alpha G11) is blocked too: a Run cannot work it out until the model changes.
  const tooLarge = compiled.errors.length === 0 && compiled.executable !== null && !admission(compiled.executable).ok;
  const status = compiled.errors.length > 0 || tooLarge ? 'blocked' : compiled.executable !== null ? 'ready' : 'needs_user_input';
  return {
    goal_node_id: goal?.id ?? '',
    ...Object.fromEntries(GOAL_FIELDS.flatMap((k) => (goalNode?.[k] !== undefined ? [[k, goalNode[k]]] : []))),
    options: model.options.filter((o) => o.status === 'live').map((o) => {
      const outcome = compiled.perOption.find((p) => p.option_id === o.id);
      const interventions = Object.fromEntries(o.sets.flatMap((s) => {
        // The figure it sets: its own quantity's, or its inline value (a range at its centre).
        const f = s.to === null ? s : quantity.get(s.to);
        const v = f?.value ?? (f?.low != null && f.high != null ? (f.low + f.high) / 2 : null);
        return typeof v === 'number' ? [[s.quantity, v]] : [];
      }));
      return { option_id: o.id, label: o.label, status: outcome?.status === 'calculable' ? 'ready' : 'needs_user_input', interventions,
        ...(outcome !== undefined && outcome.reasons.length > 0 ? { status_reason: outcome.reasons.join(' ') } : {}) };
    }),
    status,
    ...(status === 'blocked' ? { blocked_reason: tooLarge ? 'MODEL_PROGRAM_TOO_LARGE' : 'MODEL_PROGRAM_DOES_NOT_COMPILE' } : {}),
    may_run: status === 'ready',
  };
}
