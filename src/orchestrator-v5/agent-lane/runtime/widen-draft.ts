import { admitCandidateModel, canonicalLabel, type AdmittedModel, type CandidateModel } from '../admit-model.js';
import type { CallStructuredModel } from './build-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { log } from '../../../utils/telemetry.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { applyDisconfirm, doorFactorOf, existingLevers, riskGate, risksTurnFromSignals,
  widenGate, widenOptionsOf, widenTurnFromSignals, RISK_METHOD, type Graph, type RunWidenTurn } from '../method-turn/widen-turn.js';
import { markOlumiOptions } from '../olumi-option-marker.js';
import { budgetFor } from '../model-budgets.js';
import { doorLevelOf, estimateLevelPersists } from './agent-capabilities.js';
import { CONSTRUCTION_TAIL_RESERVE_MS } from './construction-deadline.js';

type AdmissionArgs = Parameters<typeof admitCandidateModel>;
export interface WidenDraftInput {
  admitted: AdmittedModel;
  candidate: CandidateModel;
  brief: string;
  callStructured: CallStructuredModel;
  deadlineAt?: number;
  timeoutMs?: number;
  clock?: () => number;
  admissionArgs?: [goalLevelStated?: AdmissionArgs[3], targetFigureWrittenAgain?: AdmissionArgs[4],
    goalLevelFromBrief?: AdmissionArgs[5], sizeWritten?: AdmissionArgs[6], sizeRangeEnd?: AdmissionArgs[7]];
}
export interface WidenCounts { options: number; risks: number }
export interface WidenDraftResult {
  admitted: AdmittedModel;
  counts: WidenCounts;
  calls: number;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const objectSchema = (properties: Rec): Rec => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const direction = { type: 'string', enum: ['positive', 'negative'] };
const levelSchema = objectSchema({ value: { type: 'number' }, unit: { type: ['string', 'null'] },
  estimate: { type: 'boolean', enum: [true] }, basis: { type: 'string', minLength: 1 } });
const optionSchema = objectSchema({ label: string, acts_on: { type: 'array', minItems: 1,
  items: objectSchema({ factor_label: string, direction, level: levelSchema }) }, rationale: string });
const OPTIONS_SCHEMA = objectSchema({ options: { type: 'array', maxItems: 3, items: optionSchema } });
const RISKS_SCHEMA = objectSchema({ risk_suggestions: { type: 'array', items: objectSchema({
  label: string, category: { type: 'string', enum: RISK_METHOD.categories },
  mechanism: { type: 'string', enum: ['drives', 'relies_on'] }, hits_id: string, through_id: string,
  through_direction: direction, affects_id: string, direction, relies_on: string, watch_for: string,
}) } });

/** Re-admission may change frames or repair old entities. Any such change costs only this optional widening. */
function existingUnchanged(before: AdmittedModel, after: AdmittedModel): boolean {
  const ids = new Set(before.nodes.map(n => n.id));
  const pairs = new Set(before.edges.map(e => `${e.from}::${e.to}`));
  return JSON.stringify(before.nodes) === JSON.stringify(after.nodes.filter(n => ids.has(n.id)))
    && JSON.stringify(before.edges) === JSON.stringify(after.edges.filter(e => pairs.has(`${e.from}::${e.to}`)))
    && JSON.stringify(before.goal_constraints) === JSON.stringify(after.goal_constraints);
}

function optionCandidates(turn: RunWidenTurn, args: unknown, pathIds: ReadonlySet<string>): CandidateModel['options'] {
  const a = rec(args) ?? {};
  const gate = widenGate(turn, a);
  const raw = widenOptionsOf(a);
  return gate.passing_indices.flatMap(index => {
    const option = rec(raw[index])!;
    const acts = (option.acts_on as unknown[]).map(item => rec(item)!);
    if (!acts.some(act => pathIds.has(doorFactorOf(turn, act.factor_label)!))) return [];
    const ranks = (text: string): boolean => {
      // Existing model labels are the user's context. Only newly authored superiority claims are refused.
      const authored = turn.graph.nodes.reduce((words, node) => typeof node.label === 'string'
        ? words.replaceAll(node.label.toLowerCase(), ' ') : words, text.toLowerCase());
      return /\b(?:better|best|improved)\b|you\s+missed/u.test(authored);
    };
    if (ranks(option.label as string) || acts.some(act => ranks(rec(act.level)!.basis as string))) return [];
    // Copy only the gated intervention and its basis. The generator's rationale never crosses this boundary.
    return [{ label: option.label as string, provenance: 'ai_proposed',
      draft_widening: { provenance: 'ai_suggested_widen' as const },
      interventions: acts.map(act => {
        const level = rec(act.level)!;
        const factor = turn.factors.find(f => f.id === doorFactorOf(turn, act.factor_label))!;
        return { factor_label: factor.label, value: level.value as number,
          ...(typeof level.unit === 'string' ? { unit: level.unit } : {}), provenance: 'ai_proposed',
          estimate: true as const, basis: (level.basis as string).trim() };
      }) }];
  }).slice(0, 3);
}

/** Candidate admission can restate native scales; it must still persist exactly the levels judged by the Widen gate. */
function optionLevelsUnchanged(turn: RunWidenTurn, options: CandidateModel['options'], admitted: AdmittedModel): boolean {
  return options.every(option => {
    const node = admitted.nodes.find(n => n.kind === 'option'
      && canonicalLabel(n.description ?? n.label) === canonicalLabel(option.label));
    if (node?.draft_widening === undefined || node.proposed_by !== 'olumi') return false;
    return (option.interventions ?? []).every(level => {
      const id = doorFactorOf(turn, level.factor_label);
      const factor = turn.graph.nodes.find(n => n.id === id);
      const expected = estimateLevelPersists(doorLevelOf(level)!, factor as never, turn.raw, option.label);
      const actual = id === undefined ? undefined : node.interventions?.[id];
      return expected.ok && actual !== undefined && actual.value === expected.value
        && actual.source === 'cee_hypothesis' && actual.estimate === true && actual.basis === level.basis;
    });
  });
}

/** Two parallel generators share the construction tail; failed passes cost only their own suggestions. */
export async function widenDraft(input: WidenDraftInput): Promise<WidenDraftResult | null> {
  const clock = input.clock ?? Date.now;
  const started = clock();
  let calls = 0;
  let counts: WidenCounts = { options: 0, risks: 0 };
  let outcome = 'error';
  let partial = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The drafter's absolute deadline already leaves this reserve. Keep 8s for admission, registration and reply.
    const cap = Math.min(20_000, (input.deadlineAt ?? Infinity) + CONSTRUCTION_TAIL_RESERVE_MS - 8_000 - started);
    if (cap < 5_000) { outcome = 'no_budget'; return null; }
    const timeoutMs = Math.min(cap, input.timeoutMs ?? 20_000);
    const graph = { nodes: input.admitted.nodes, edges: input.admitted.edges,
      ...(input.admitted.goal_constraints.length > 0 ? { goal_constraints: input.admitted.goal_constraints } : {}) };
    const signals = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [],
      graph, analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
    const risksTurn = risksTurnFromSignals(signals, graph, input.brief);
    const optionsTurn = widenTurnFromSignals(signals, graph);
    if (risksTurn.kind !== 'run_risks' || optionsTurn.kind !== 'run') {
      outcome = 'unavailable'; return null;
    }
    const budget = budgetFor('gpt-5.6-terra', 'widening');
    const call = async (instructions: string, schema: Rec): Promise<unknown> => {
      calls += 1;
      const response = await input.callStructured({ model: budget.model, instructions,
        input: JSON.stringify({ brief: input.brief, graph }), schema, max_output_tokens: budget.max_output_tokens,
        reasoning_effort: budget.reasoning_effort }, started + timeoutMs);
      if (response.status === 'incomplete') throw new Error('incomplete widening');
      return JSON.parse(response.text) as unknown;
    };
    const work = async (): Promise<WidenDraftResult | null> => {
      const [riskReply, optionReply] = await Promise.allSettled([
        call(risksTurn.directive, RISKS_SCHEMA), call(optionsTurn.directive, OPTIONS_SCHEMA),
      ]);
      if (finished) return null;
      const riskArgs = riskReply.status === 'fulfilled' ? riskReply.value : undefined;
      const optionArgs = optionReply.status === 'fulfilled' ? optionReply.value : undefined;
      const candidates = rec(riskArgs)?.risk_suggestions;
      const risks = applyDisconfirm(risksTurn, { ...riskGate(risksTurn, candidates), candidates }).kept.slice(0, 3);
      const options = optionCandidates(optionsTurn, optionArgs, new Set(signals['model.goal_path_factor_ids']));
      partial = (risks.length === 0) !== (options.length === 0);
      if (risks.length === 0 && options.length === 0) { outcome = 'empty_gate'; return null; }
      const oldIds = new Set(input.admitted.nodes.map(n => n.id));
      const admit = (keptRisks: typeof risks, keptOptions: typeof options): WidenDraftResult | null => {
        const merged: CandidateModel = { ...input.candidate, options: [...input.candidate.options, ...keptOptions],
          risks: [...input.candidate.risks, ...keptRisks.map(risk => ({
            label: risk.label, provenance: 'ai_proposed', analysis_participation: 'retained_excluded' as const,
            draft_widening: { provenance: 'ai_suggested_widen' as const, hits: risk.hits, through: risk.through,
              affects: risk.affects, mechanism: risk.mechanism, relies_on: risk.relies_on, watch_for: risk.watch_for },
          }))] };
        try {
          let admitted = admitCandidateModel(merged, {}, input.brief, ...(input.admissionArgs ?? []));
          admitted = { ...admitted, nodes: admitted.nodes.map(n => oldIds.has(n.id) ? n : markOlumiOptions([n], merged, input.brief)[0]!) };
          if (!existingUnchanged(input.admitted, admitted)) { outcome = 'existing_changed'; return null; }
          if (!optionLevelsUnchanged(optionsTurn, keptOptions, admitted)) { outcome = 'level_changed'; return null; }
          if (!GraphV3.safeParse({ nodes: admitted.nodes, edges: admitted.edges,
            ...(admitted.goal_constraints.length > 0 ? { goal_constraints: admitted.goal_constraints } : {}) }).success) {
            outcome = 'graph_invalid'; return null;
          }
          const added = admitted.nodes.filter(n => !oldIds.has(n.id));
          const risksKept = keptRisks.every(risk => {
            const n = added.find(n => n.kind === 'risk' && canonicalLabel(n.description ?? n.label) === canonicalLabel(risk.label));
            return n?.draft_widening !== undefined && n.proposed_by === 'olumi'
              && n.analysis_participation === 'retained_excluded'
              && !admitted.edges.some(e => e.from === n.id || e.to === n.id);
          });
          const admittedCounts = { options: added.filter(n => n.kind === 'option').length,
            risks: added.filter(n => n.kind === 'risk').length };
          if (!risksKept || admittedCounts.risks !== keptRisks.length || admittedCounts.options !== keptOptions.length) {
            outcome = 'readmit_refusal'; return null;
          }
          return { admitted, counts: admittedCounts, calls };
        } catch { outcome = 'readmit_refusal'; return null; }
      };
      let result = admit(risks, options);
      if (result === null && risks.length > 0 && options.length > 0) {
        // Re-admit only the survivor: no refused candidate or its repair may leak into the shipped graph.
        partial = true;
        result = admit(risks, []) ?? admit([], options);
      }
      if (result === null) return null;
      counts = result.counts;
      outcome = 'widened';
      return result;
    };
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => { finished = true; outcome = 'timeout'; resolve(null); }, Math.max(0, started + timeoutMs - clock()));
    });
    return await Promise.race([work(), timeout]);
  } catch {
    outcome = 'error'; return null;
  } finally {
    finished = true;
    if (timer !== undefined) clearTimeout(timer);
    log.info({ calls, ms: clock() - started, counts, outcome, enrichment_incomplete: outcome !== 'widened',
      ...(partial ? { partial: true } : {}) }, 'agent_draft_widen');
  }
}

export function widenedLine(counts: WidenCounts): string | null {
  const parts = [counts.options > 0 ? `${counts.options} option${counts.options === 1 ? '' : 's'}` : null,
    counts.risks > 0 ? `${counts.risks} risk${counts.risks === 1 ? '' : 's'}` : null].filter(x => x !== null);
  return parts.length === 0 ? null : `Olumi added ${parts.join(' and ')} for you to consider. They're Olumi's suggestions, not yours; remove any that don't fit.`;
}
export function widenedRiskNote(counts: WidenCounts): string | null {
  return counts.risks > 0 ? "Risks Olumi added aren't in the chance yet, so it may be too high." : null;
}

export const WIDENED_RISK_MARKER_DOWN = "Leaves out Olumi's added risks; may be too high";
export const WIDENED_RISK_MARKER_MOVE = "Leaves out Olumi's added risks; may move";

type AddedRisk = {
  readonly affects?: { readonly direction: 'positive' | 'negative' };
  readonly draft_widening?: { readonly provenance?: 'ai_suggested_widen';
    readonly affects?: { readonly direction: 'positive' | 'negative' } };
};
/** Read typed attachment directions, never infer a risk's sign from its label. */
export function widenedRiskMarker(addedRisks: readonly AddedRisk[]): string | null {
  if (addedRisks.length === 0) return null;
  return addedRisks.every(risk => (risk.draft_widening?.affects ?? risk.affects)?.direction === 'negative')
    ? WIDENED_RISK_MARKER_DOWN : WIDENED_RISK_MARKER_MOVE;
}

/** A new lever is a moved goal-path factor that no other option moves, regardless of its direction. */
export function classifyWidenedOptions(graph: unknown): Record<string, 'NEW_LEVER' | 'SAME_LEVER'> {
  const raw = rec(graph);
  const g: Graph = { nodes: Array.isArray(raw?.nodes) ? raw.nodes.map(rec).filter((n): n is Rec => n !== undefined) : [],
    edges: Array.isArray(raw?.edges) ? raw.edges.map(rec).filter((e): e is Rec => e !== undefined) : [] };
  const signals = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [],
    graph, analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
  const path = new Set(signals['model.goal_path_factor_ids']);
  const sq = signals['model.status_quo_option_id'];
  const options = g.nodes.filter(n => n.kind === 'option' && typeof n.id === 'string');
  const levers = new Map(options.map(n => [n.id as string, existingLevers(g, n.id as string, sq)]));
  return Object.fromEntries(options.filter(n => rec(n.draft_widening)?.provenance === 'ai_suggested_widen').map(n => {
    const moves = levers.get(n.id as string)!;
    const novel = [...moves].some(([factor, direction]) => path.has(factor)
      && (direction === 'positive' || direction === 'negative')
      && options.every(other => other.id === n.id || levers.get(other.id as string)?.get(factor) === undefined
        || levers.get(other.id as string)?.get(factor) === 'unchanged'));
    return [n.id as string, novel ? 'NEW_LEVER' : 'SAME_LEVER'];
  }));
}
