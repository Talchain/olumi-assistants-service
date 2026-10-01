/**
 * ⭐ THE GUIDANCE SIGNALS — the typed state the Reasoning Coach selector reads (AI HARNESS T2; contract
 * programme-docs `rc/reasoning-coach-20261001` @d9d9e340, `REASONING-INTERVENTIONS.json` `signals{}`; PTL 5933452605:
 * M1 "challenge a consequential assumption" is RC-STRENGTHEN-ITEM over these).
 *
 * The minimal model / run / open context of the F2 brief, and nothing more: every signal is READ from its owner's
 * reader, never re-derived here — `statusQuoOptionId` (F1), `detectSameLeverOptions` (F1), `linkSizing` (F1b),
 * `observedValueAuthorship` (F1), `placeholderGoalPaths` (F1b), `decisionSensitivityOf` (factor_evppi),
 * `readStoredOptionParticipation`. The harness computes only what the contract assigns it: the goal paths (which links
 * and factors sit on a directed path from an option's lever to the goal, and how far from the goal they are), the
 * decision point and the request kind.
 *
 * PURE and TOTAL: no I/O, never throws (a malformed graph reads as no model). Content: ids and the user's own labels,
 * for copy fill only; the selector's state keys are hashed before anything is persisted (`agent-guidance-snapshot.ts`).
 */
import { statusQuoOptionId, type GraphEdgeLike, type StatusQuoNodeLike } from '../structural-facts.js';
import { detectSameLeverOptions } from '../../../cee/structure/index.js';
import { linkSizing, type LinkSizing } from '../../../cee/magnitude/link-sizing.js';
import { isAcceptedOlumiEstimate, observedValueAuthorship } from '../../../cee/transforms/provenance-display.js';
import { placeholderGoalPaths } from '../goal-certainty.js';
import { decisionSensitivityOf } from '../decision-sensitivity.js';
import { readStoredOptionParticipation } from '../../tools/handlers/option-participation.js';

export type GuidanceRequest = 'run_result' | 'narration' | 'turn' | 'method';
export type ValueAuthorship = 'yours' | 'olumi_estimate' | 'olumi_accepted' | 'unknown';

export interface GoalPathLink {
  readonly link_id: string;
  readonly from_label: string;
  readonly to_label: string;
  readonly link_sizing: LinkSizing;
  readonly option_ids: readonly string[];
  readonly goal_distance: number;
}

export interface GoalPathFactor {
  readonly factor_id: string;
  readonly label: string;
  readonly value_authorship: ValueAuthorship;
  readonly goal_distance: number;
}

export type DecisionSensitivitySignal =
  | { readonly status: 'measured'; readonly most_sensitive: { readonly factor_id: string; readonly label: string; readonly range?: 'olumi_assumed' | 'yours' } }
  | { readonly status: 'none_measurable' }
  | { readonly status: 'not_measured' };

/** The contract's `signals{}`, keyed exactly as `acceptance-cases.json` states them. */
export interface GuidanceSignals {
  readonly 'turn.request': GuidanceRequest;
  readonly 'open.decision_point': boolean;
  readonly 'run.kind': string | null;
  readonly 'run.leader_licensed': boolean;
  readonly 'run.withheld_reason': string | null;
  readonly 'run.leader_option_id': string | null;
  readonly 'run.decision_sensitivity': DecisionSensitivitySignal;
  readonly 'model.goal_present': boolean;
  readonly 'model.goal_label': string | null;
  readonly 'model.goal_horizon': unknown;
  readonly 'model.status_quo_option_id': string | null;
  readonly 'model.non_sq_option_ids': readonly string[];
  readonly 'model.option_labels': Readonly<Record<string, string>>;
  readonly 'model.same_lever': boolean;
  readonly 'model.risk_ids': readonly string[];
  readonly 'model.goal_path_factor_ids': readonly string[];
  readonly 'model.goal_path_links': readonly GoalPathLink[];
  readonly 'model.placeholder_goal_links': readonly string[];
  readonly 'model.goal_path_factors': readonly GoalPathFactor[];
  /** F2-4 `since_run` is not built: the contract's interim is silence, never edits inferred from text. */
  readonly 'since_run.goal_path_user_edits': { readonly status: 'pending' };
  readonly guidance: Readonly<Record<string, unknown>>;
  readonly 'user.explicit_request': string | null;
}

export interface GuidanceSignalInputs {
  readonly request: GuidanceRequest;
  /** The reply's specific controls (approval card, Run offer, blocker action, typed choice). Non-empty = decision point. */
  readonly offeredSpecific: readonly { readonly id: string }[];
  /** The readback graph (canonical; the wire's `draft_graph`). */
  readonly graph: unknown;
  readonly analysisState: unknown;
  /** The readback's selected `analysis_result` block (its `enrichment` and `leading_option_id`). */
  readonly analysisResult: unknown;
  readonly optionParticipation?: unknown;
  /** This Run's identity evaluations, as `placeholderGoalPaths` reads them. */
  readonly identityEvaluations?: ReadonlyArray<unknown>;
  /** The persisted guidance record's entries (`agent-guidance-snapshot.ts`). */
  readonly guidance?: Readonly<Record<string, unknown>>;
  readonly explicitRequest?: string | null;
  /**
   * Whether this Run licenses naming a leading option. The ONE licence read (`compose/leader-licence.ts`, PR-L1)
   * when the caller has it; absent, the contract's interim `analysis_state.leader_claim.permitted === true`.
   */
  readonly leaderLicensed?: boolean;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Whose figure a factor's value is, by F1's own reader; deferred stamps read the extraction type; absent = unknown. */
export function valueAuthorshipOf(observed: unknown): ValueAuthorship {
  const os = rec(observed);
  if (os === undefined) return 'unknown';
  if (isAcceptedOlumiEstimate(os)) return 'olumi_accepted';
  const auth = observedValueAuthorship(os);
  if (auth !== undefined) return auth.provenance === 'ai_inferred' ? 'olumi_estimate' : 'yours';
  // `brief_extraction` / `cee_inference` / `explicit` / `inferred` DEFER to the extraction type (provenance-display.ts).
  const et = os.extractionType;
  if (et === 'explicit' || et === 'observed') return 'yours';
  if (et === 'inferred' || et === 'range') return 'olumi_estimate';
  return 'unknown';
}

function enrichmentOf(block: unknown): unknown {
  const b = rec(block);
  return b === undefined ? undefined : (b.enrichment ?? rec(b.data)?.enrichment);
}

function sensitivityOf(block: unknown): DecisionSensitivitySignal {
  try {
    const d = decisionSensitivityOf(enrichmentOf(block));
    if (d.status === 'measured') {
      const m = d.most_sensitive;
      return { status: 'measured', most_sensitive: { factor_id: m.factor_id, label: m.label, ...(m.range !== undefined ? { range: m.range } : {}) } };
    }
    return { status: d.status };
  } catch {
    return { status: 'not_measured' };
  }
}

/**
 * F1's same-lever detector reads the V1 shape (`node.data.interventions[].target`), but the canonical graph the Agent
 * reads carries an option's levers as `node.interventions: {factor_id: level}`. Without this projection the detector
 * saw no levers on any served graph, so `same_lever` was always false (9 of 9 RC served cases, which were all true).
 * A shape projection only: the detector, its 0.6 threshold and its overlap rule stay F1's.
 */
function asLeverGraph(nodes: readonly Rec[]): never {
  return { nodes: nodes.map((n) => {
    const levers = rec(n.interventions);
    if (n.kind !== 'option' || levers === undefined || rec(n.data)?.interventions !== undefined) return n;
    return { ...n, data: { ...(rec(n.data) ?? {}), interventions: Object.keys(levers).map((target) => ({ target })) } };
  }) } as never;
}

export function assembleGuidanceSignals(i: GuidanceSignalInputs): GuidanceSignals {
  const g = rec(i.graph);
  const nodes = Array.isArray(g?.nodes) ? (g!.nodes as unknown[]).map(rec).filter((n): n is Rec => n !== undefined && typeof n.id === 'string') : [];
  const edges = Array.isArray(g?.edges) ? (g!.edges as unknown[]).map(rec).filter((e): e is Rec => e !== undefined && typeof e.from === 'string' && typeof e.to === 'string') : [];
  const byId = new Map(nodes.map((n) => [n.id as string, n] as const));
  const goal = nodes.find((n) => n.kind === 'goal');
  const goalId = goal?.id as string | undefined;
  const state = rec(i.analysisState);
  const claim = rec(state?.leader_claim);
  const leaderLicensed = i.leaderLicensed ?? claim?.permitted === true;
  const block = rec(i.analysisResult);

  // Options: the status quo by F1's reader; the user's own options exclude it and any option the Run took out.
  const options = nodes.filter((n) => n.kind === 'option');
  let sq: string | null = null;
  try { sq = statusQuoOptionId(nodes as unknown as StatusQuoNodeLike[], edges as unknown as GraphEdgeLike[]); } catch { sq = null; }
  const participation = new Map((readStoredOptionParticipation(i.optionParticipation) ?? []).map((p) => [p.option_id, p.state] as const));
  const nonSq = options.map((o) => o.id as string)
    .filter((id) => id !== sq && !String(participation.get(id) ?? '').startsWith('excluded')).sort();
  const optionLabels = Object.fromEntries(options.map((o) => [o.id as string, typeof o.label === 'string' ? o.label : (o.id as string)]));
  let sameLever = false;
  try { sameLever = detectSameLeverOptions(asLeverGraph(nodes), 0.6).detected === true; } catch { sameLever = false; }

  // Goal paths: every link on a directed simple path from an option's lever factor to the goal; distance by reverse BFS.
  const out = new Map<string, Rec[]>();
  const into = new Map<string, string[]>();
  for (const e of edges) {
    (out.get(e.from as string) ?? out.set(e.from as string, []).get(e.from as string)!).push(e);
    (into.get(e.to as string) ?? into.set(e.to as string, []).get(e.to as string)!).push(e.from as string);
  }
  const dist = new Map<string, number>();
  if (goalId !== undefined) {
    dist.set(goalId, 0);
    const queue = [goalId];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const v of into.get(u) ?? []) if (!dist.has(v)) { dist.set(v, dist.get(u)! + 1); queue.push(v); }
    }
  }
  const linkOptions = new Map<string, Set<string>>();
  const MAX_PATH_STEPS = 50_000;
  for (const o of options) {
    const levers = Object.keys(rec(o.interventions) ?? {});
    for (const start of levers) {
      if (goalId === undefined || !dist.has(start)) continue;
      let steps = 0;
      const walk = (u: string, seen: Set<string>, stack: string[]): void => {
        if (++steps > MAX_PATH_STEPS) return;
        if (u === goalId) { for (const k of stack) (linkOptions.get(k) ?? linkOptions.set(k, new Set()).get(k)!).add(o.id as string); return; }
        for (const e of out.get(u) ?? []) {
          const v = e.to as string;
          if (seen.has(v) || !dist.has(v)) continue;
          seen.add(v); walk(v, seen, [...stack, `${u}->${v}`]); seen.delete(v);
        }
      };
      walk(start, new Set([start]), []);
    }
  }
  const links: GoalPathLink[] = [];
  const factors = new Map<string, GoalPathFactor>();
  for (const e of edges) {
    const id = `${e.from as string}->${e.to as string}`;
    const opts = linkOptions.get(id);
    if (opts === undefined) continue;
    const from = byId.get(e.from as string);
    const to = byId.get(e.to as string);
    links.push({
      link_id: id,
      from_label: typeof from?.label === 'string' ? from.label : (e.from as string),
      to_label: typeof to?.label === 'string' ? to.label : (e.to as string),
      link_sizing: linkSizing(e),
      option_ids: [...opts].sort(),
      goal_distance: dist.get(e.to as string) ?? 99,
    });
    for (const n of [from, to]) {
      if (n?.kind !== 'factor' || factors.has(n.id as string)) continue;
      factors.set(n.id as string, {
        factor_id: n.id as string,
        label: typeof n.label === 'string' ? n.label : (n.id as string),
        value_authorship: valueAuthorshipOf(n.observed_state),
        goal_distance: dist.get(n.id as string) ?? 99,
      });
    }
  }

  // F1b's own placeholder rule, over the user's options (it exempts identity operands this Run evaluated).
  let placeholder: string[] = [];
  try {
    const paths = placeholderGoalPaths(i.graph, nonSq, i.identityEvaluations);
    placeholder = [...new Set(paths.flatMap((p) => p.links.map((l) => `${l.from}->${l.to}`)))];
  } catch { placeholder = []; }

  const leader = str(block?.leading_option_id) ?? str(rec(block?.data)?.leading_option_id);
  return {
    'turn.request': i.request,
    'open.decision_point': i.offeredSpecific.length > 0,
    'run.kind': str(rec(state?.run_state)?.kind),
    'run.leader_licensed': leaderLicensed,
    'run.withheld_reason': str(claim?.withheld_reason),
    'run.leader_option_id': leaderLicensed ? leader : null,
    'run.decision_sensitivity': sensitivityOf(block),
    'model.goal_present': goal !== undefined,
    'model.goal_label': typeof goal?.label === 'string' ? goal.label : null,
    'model.goal_horizon': goal?.goal_horizon ?? null,
    'model.status_quo_option_id': sq,
    'model.non_sq_option_ids': nonSq,
    'model.option_labels': optionLabels,
    'model.same_lever': sameLever,
    'model.risk_ids': nodes.filter((n) => n.kind === 'risk').map((n) => n.id as string).sort(),
    'model.goal_path_factor_ids': [...factors.keys()].sort(),
    'model.goal_path_links': links,
    'model.placeholder_goal_links': placeholder,
    'model.goal_path_factors': [...factors.values()].sort((a, b) => (a.factor_id < b.factor_id ? -1 : 1)),
    'since_run.goal_path_user_edits': { status: 'pending' },
    guidance: i.guidance ?? {},
    'user.explicit_request': i.explicitRequest ?? null,
  };
}
