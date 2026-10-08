import { isDeepStrictEqual } from 'node:util';
import { admitCandidateModel, canonicalLabel, type AdmittedModel, type CandidateModel } from '../admit-model.js';
import type { CallStructuredModel } from './build-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { log } from '../../../utils/telemetry.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { applyDisconfirm, doorFactorOf, existingLevers, sameLevers, riskGate, risksTurnFromSignals,
  widenGate, widenOptionsOf, widenTurnFromSignals, RISK_METHOD, type Graph, type RunWidenTurn } from '../method-turn/widen-turn.js';
import { markOlumiOptions } from '../olumi-option-marker.js';
import { budgetFor } from '../model-budgets.js';
import { doorLevelOf, estimateLevelPersists } from './agent-capabilities.js';
import { readIsBaseline } from '../../../cee/baseline-identity.js';

type AdmissionArgs = Parameters<typeof admitCandidateModel>;
interface FinalGraph {
  readonly nodes: readonly { readonly id: string }[];
  readonly edges: readonly { readonly id?: string; readonly from: string; readonly to: string }[];
  readonly goal_constraints?: unknown;
}
export interface WidenDraftInput {
  admitted: AdmittedModel;
  candidate: CandidateModel;
  brief: string;
  callStructured: CallStructuredModel;
  deadlineAt?: number;
  timeoutMs?: number;
  clock?: () => number;
  /** The same pure path used for persistence, including occurrence binding and refit, before clamp. */
  finalGraph?: (admitted: AdmittedModel) => FinalGraph;
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

export interface DraftDiagnosis {
  risks: null | 'too_few' | 'no_counter_case';
  options: null | 'no_distinct_lever';
}

export const DRAFT_WIDENING_PREAMBLE = "This is Olumi's own check of a first draft; the user has not asked for it. Anything you add is shown as Olumi's suggestion for the user to keep or remove. Where the text below says the user asked or will approve, read it as: Olumi is suggesting, and the user decides.";

/** Diagnose only typed identities, attachments and directed paths on the final un-widened graph. */
export function diagnoseDraft(graph: unknown): DraftDiagnosis {
  const raw = rec(graph);
  const g: Graph = { nodes: Array.isArray(raw?.nodes) ? raw.nodes.map(rec).filter((n): n is Rec => n !== undefined) : [],
    edges: Array.isArray(raw?.edges) ? raw.edges.map(rec).filter((e): e is Rec => e !== undefined) : [] };
  const options = g.nodes.filter(n => n.kind === 'option' && typeof n.id === 'string');
  const isBaseline = (n: Rec): boolean => readIsBaseline({ is_baseline: n.is_baseline === true,
    data: { is_baseline: rec(n.data)?.is_baseline === true } }) === true
    || n.is_status_quo === true || rec(n.data)?.is_status_quo === true;
  const baselines = options.filter(isBaseline);
  const sq = baselines.length === 1 ? baselines[0]!.id as string : null;
  const active = options.filter(n => !isBaseline(n)).sort((a, b) => (a.id as string).localeCompare(b.id as string));
  const activeIds = new Set(active.map(n => n.id as string));
  const levers = active.map(n => existingLevers(g, n.id as string, sq));
  const same = levers.every((lever, i) => levers.slice(i + 1).every(other => sameLevers(lever, other)));
  const risks = g.nodes.filter(n => n.kind === 'risk');
  if (risks.length < 2) return { risks: 'too_few', options: active.length <= 1 || same ? 'no_distinct_lever' : null };

  const reached = new Set(levers.flatMap(lever => [...lever.keys()]));
  const outgoing = new Map<string, string[]>();
  for (const edge of g.edges) if (typeof edge.from === 'string' && typeof edge.to === 'string') {
    const targets = outgoing.get(edge.from) ?? [];
    targets.push(edge.to);
    outgoing.set(edge.from, targets);
  }
  const queue = [...reached];
  for (let i = 0; i < queue.length; i++) for (const target of outgoing.get(queue[i]!) ?? []) if (!reached.has(target)) {
    reached.add(target);
    queue.push(target);
  }
  const hasCounterCase = risks.some(risk => {
    const reliesOn = rec(risk.relies_on);
    return (typeof risk.id === 'string' && reached.has(risk.id))
      || [rec(rec(risk.draft_widening)?.hits)?.id, rec(reliesOn?.hits)?.id, reliesOn?.option_id]
        .some(hit => typeof hit === 'string' && activeIds.has(hit));
  });
  return { risks: hasCounterCase ? null : 'no_counter_case',
    options: active.length <= 1 || same ? 'no_distinct_lever' : null };
}

const forbiddenWideningWords = /\b(better|best|improv\w*|complete\w*|you missed|winner|recommend\w*)\b/i;
const hasForbiddenWideningWords = (text: unknown): boolean => typeof text === 'string' && forbiddenWideningWords.test(text);
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

/** Compare identities after every post-admission reader has had the opportunity to change their meaning. */
function finalExistingUnchanged(before: FinalGraph, after: FinalGraph): boolean {
  const nodes = new Map(after.nodes.map(node => [node.id, node]));
  const edgeId = (edge: FinalGraph['edges'][number]): string => edge.id ?? `${edge.from}::${edge.to}`;
  const edges = new Map(after.edges.map(edge => [edgeId(edge), edge]));
  return before.nodes.every(node => isDeepStrictEqual(node, nodes.get(node.id)))
    && before.edges.every(edge => isDeepStrictEqual(edge, edges.get(edgeId(edge))))
    && isDeepStrictEqual(before.goal_constraints, after.goal_constraints);
}

function optionCandidates(turn: RunWidenTurn, args: unknown, pathIds: ReadonlySet<string>): CandidateModel['options'] {
  const a = rec(args) ?? {};
  const gate = widenGate(turn, a);
  const raw = widenOptionsOf(a);
  return gate.passing_indices.flatMap(index => {
    const option = rec(raw[index])!;
    const acts = (option.acts_on as unknown[]).map(item => rec(item)!);
    if (!acts.some(act => pathIds.has(doorFactorOf(turn, act.factor_label)!))) return [];
    if (hasForbiddenWideningWords(option.label)
      || acts.some(act => hasForbiddenWideningWords(rec(act.level)!.basis))) return [];
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

/** Only diagnosed deficiencies run generators, inside the drafter's deadline; failed passes cost their own suggestions. */
export async function widenDraft(input: WidenDraftInput): Promise<WidenDraftResult | null> {
  const clock = input.clock ?? Date.now;
  const started = clock();
  let calls = 0;
  let counts: WidenCounts = { options: 0, risks: 0 };
  let outcome = 'error';
  let partial = false;
  let diagnosis: DraftDiagnosis | undefined;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const graph = { nodes: input.admitted.nodes, edges: input.admitted.edges,
      ...(input.admitted.goal_constraints.length > 0 ? { goal_constraints: input.admitted.goal_constraints } : {}) };
    const finalBefore = input.finalGraph?.(input.admitted);
    diagnosis = diagnoseDraft(finalBefore ?? graph);
    if (diagnosis.risks === null && diagnosis.options === null) { outcome = 'sufficient'; return null; }
    // Registration, readbacks and narration retain the tail already reserved beyond this absolute deadline.
    const cap = Math.min(20_000, (input.deadlineAt ?? Infinity) - started);
    if (cap < 5_000) { outcome = 'no_budget'; return null; }
    const timeoutMs = Math.min(cap, input.timeoutMs ?? 20_000);
    const signals = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [],
      graph, analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
    const risksTurn = diagnosis.risks === null ? null : risksTurnFromSignals(signals, graph, input.brief);
    const optionsTurn = diagnosis.options === null ? null : widenTurnFromSignals(signals, graph);
    const riskPass = risksTurn?.kind === 'run_risks' ? risksTurn : null;
    const optionPass = optionsTurn?.kind === 'run' ? optionsTurn : null;
    if (riskPass === null && optionPass === null) {
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
        riskPass === null ? Promise.resolve(undefined) : call(`${DRAFT_WIDENING_PREAMBLE}\n${riskPass.directive}`, RISKS_SCHEMA),
        optionPass === null ? Promise.resolve(undefined) : call(`${DRAFT_WIDENING_PREAMBLE}\n${optionPass.directive}`, OPTIONS_SCHEMA),
      ]);
      if (finished) return null;
      const riskArgs = riskReply.status === 'fulfilled' ? riskReply.value : undefined;
      const optionArgs = optionReply.status === 'fulfilled' ? optionReply.value : undefined;
      const rawRisks = rec(riskArgs)?.risk_suggestions;
      // These automatic suggestions have a stricter copy rule than the shared interactive risk gate.
      const candidates = Array.isArray(rawRisks) ? rawRisks.filter(item => {
        const risk = rec(item);
        return ![risk?.label, risk?.relies_on, risk?.watch_for].some(hasForbiddenWideningWords);
      }) : rawRisks;
      const risks = riskPass === null ? [] : applyDisconfirm(riskPass, { ...riskGate(riskPass, candidates), candidates }).kept.slice(0, 3);
      const options = optionPass === null ? [] : optionCandidates(optionPass, optionArgs, new Set(signals['model.goal_path_factor_ids']));
      partial = (risks.length > 0 || options.length > 0) && ((diagnosis!.risks !== null && risks.length === 0)
        || (diagnosis!.options !== null && options.length === 0));
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
          if (finalBefore !== undefined && input.finalGraph !== undefined) {
            const finalAfter = input.finalGraph(admitted);
            if (!finalExistingUnchanged(finalBefore, finalAfter)) { outcome = 'existing_changed'; return null; }
            if (!GraphV3.safeParse(finalAfter).success) { outcome = 'graph_invalid'; return null; }
          }
          if (optionPass !== null && !optionLevelsUnchanged(optionPass, keptOptions, admitted)) { outcome = 'level_changed'; return null; }
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
    log.info({ diagnosis, calls, ms: outcome === 'sufficient' ? 0 : clock() - started, counts, outcome, enrichment_incomplete: outcome !== 'widened',
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
