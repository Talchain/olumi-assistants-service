/**
 * THE SCIENCE CONTEXT FOR AN AGENT-LANE METHOD TURN (SCIENCE/DSK, #85 5933229708).
 *
 * When the user presses a reasoning method ("Run a pre-mortem", "Generate a materially different option"), the agent
 * lane today sends the chip's one sentence and the model improvises: no published protocol, and nothing the turn can
 * end on. This module is the PRODUCER half of fixing that. It answers two questions from TYPED inputs only:
 *
 *   1. Does a published DSK protocol apply here, and may the turn cite it? (`dsk`, or `not_cited` with the reason)
 *   2. Which model items can the method's claims rest on, each with the ONE existing change card that acts on it?
 *      (`supplied_items`, in REASONING COACH's action-priority order)
 *
 * It is pure: no I/O beyond the hash-verified DSK bundle read, no LLM, no imports from the agent lane's hot files.
 * Nothing calls it yet. The CODEX BUILDER wires it at the T3 call site under AI HARNESS, after #2451 (DL 5933063973 (b)).
 *
 * ── OWNER SPLIT (PTL 5933036532, DL 5933063973) ──────────────────────────────────────────────────────────────────────
 * SCIENCE/DSK owns applicability and the badge (this file). REASONING COACH owns the method's shape, its post-checks
 * (`checkMethodTurn`) and its fallback. AI HARNESS owns explicit-request routing and the final composition. So this
 * context carries no policy id, no copy and no prompt of its own: only the protocol-derived lines, re-used from
 * `protocolDirectiveLines` (the same composition route-v2's `buildCoachingMethodDirective` emits).
 *
 * ── WHAT IS READ, AND FROM WHOM ──────────────────────────────────────────────────────────────────────────────────────
 * - The ONE canonical lifecycle stage (`deriveAuthoritativeStage`), crossed into the DSK vocabulary at the ONE stage
 *   edge (`dsk/stage-edge.ts`). No stage read means no citation. `run.kind` is currentness, never a stage.
 * - REASONING COACH's typed signals (`REASONING-INTERVENTIONS.json` `signals{}`), by their policy names, exactly as the
 *   selector reads them. They are derived once, by AI HARNESS; this file never re-derives a path, a sizing or an
 *   authorship. `run.leader_licensed` is the ONE `leaderLicence` read (#2451); there is no second licence read here.
 * - The graph, ONLY for the limits on the plan's path (`goal_constraints`), which no signal carries.
 */
import type { StageType } from '@talchain/schemas/boundary';

import type { LinkSizing } from '../../../cee/magnitude/link-sizing.js';
import { mapStageToDecisionStage } from '../../../dsk/stage-edge.js';
import type { DecisionStage, DSKProtocol } from '../../../dsk/types.js';
import { protocolDirectiveLines, literalProtocolSteps } from '../../coaching/typed-intent-directive.js';
import { loadVerifiedDskBundle } from '../../compose/dsk-bundle-record.js';

/** The methods this context serves: the two reasoning methods with a DSK protocol on the served lane. */
export type ScienceMethod = 'pre_mortem' | 'elicit_options';

/** One link on an option's path to the goal (`model.goal_path_links`). */
export interface GoalPathLinkSignal {
  readonly link_id: string;
  readonly from_label: string;
  readonly to_label: string;
  readonly link_sizing: LinkSizing;
  readonly option_ids: readonly string[];
  readonly goal_distance: number;
}

/** One factor on those paths (`model.goal_path_factors`). */
export interface GoalPathFactorSignal {
  readonly factor_id: string;
  readonly label: string;
  readonly value_authorship: 'yours' | 'olumi_estimate' | 'olumi_accepted' | 'unknown';
  readonly goal_distance: number;
}

/**
 * The policy signals this context reads, named exactly as `REASONING-INTERVENTIONS.json` names them, so the
 * selector's signal object is structurally assignable and nothing translates between the two.
 */
export interface MethodScienceSignals {
  readonly 'run.kind': string | null;
  /** The ONE leader licence read (#2451 `leaderLicence`): true only when the run licenses naming a leading option. */
  readonly 'run.leader_licensed': boolean;
  readonly 'run.leader_option_id'?: string | null;
  readonly 'model.goal_label'?: string | null;
  readonly 'model.status_quo_option_id': string | null;
  readonly 'model.non_sq_option_ids': readonly string[];
  readonly 'model.option_labels': Readonly<Record<string, string>>;
  readonly 'model.risk_ids': readonly string[];
  readonly 'model.goal_path_links': readonly GoalPathLinkSignal[];
  readonly 'model.goal_path_factors': readonly GoalPathFactorSignal[];
}

export interface MethodScienceInput {
  readonly method: ScienceMethod;
  /**
   * The ONE canonical lifecycle stage for this turn: `deriveAuthoritativeStage(...)`'s output, or null when none could
   * be read. Never a literal: the agent lane's hard-coded `'frame'` is not a stage anyone derived.
   */
  readonly canonical_stage: StageType | null;
  readonly signals: MethodScienceSignals;
  /** An option the user explicitly chose for this method, or null. It names the plan; it never licenses a leader. */
  readonly user_selected_option_id?: string | null;
  /** The current graph, read ONLY for the limits on the plan's path. */
  readonly graph?: unknown;
}

/**
 * The existing agent tool that prepares the ONE change card for an item (`agent-lane/runtime/agent-tools.ts`). A link
 * item is a link only Olumi sized, so its door is `propose_link_strengths` (plural), which records Olumi's band for the
 * user to approve. The singular `propose_link_strength` records a band the USER stated and refuses one they didn't
 * (RC 5934628210; DL 5933929583).
 */
export type ItemCard = 'propose_link_strengths' | 'propose_assumptions' | 'propose_new_risk';

/**
 * A model item a method's claims may rest on. The shape is REASONING COACH's `supplied_items` entry, so the harness
 * passes these to `checkMethodTurn` unchanged (RC 5933294912). Labels only: no value, no figure, no ranking.
 */
export interface SuppliedItem {
  readonly id: string;
  readonly kind: 'link' | 'factor' | 'risk' | 'limit';
  readonly labels: readonly string[];
  readonly card: ItemCard;
}

/** Why a protocol was not cited. A missing badge is the honest default; each reason names the clause that failed. */
export type NotCitedReason =
  | 'bundle_unverified'
  | 'protocol_unavailable'
  | 'no_canonical_stage'
  | 'stage_not_applicable'
  | 'no_current_run'
  | 'run_exists'
  | 'no_identified_plan'
  | 'single_option'
  | 'no_evidence_gap'
  | 'no_options';

export interface DskCitation {
  readonly protocol_id: string;
  readonly protocol_title: string;
  readonly bundle_hash: string;
  /** The DSK stage the canonical stage crossed into, and that the protocol's own `stage_applicability` lists. */
  readonly decision_stage: DecisionStage;
  /** The protocol-derived lines, from `protocolDirectiveLines`. Never user-facing. */
  readonly protocol_directive: string;
  /** The protocol's steps that carry no placeholder, in order (`literalProtocolSteps`). */
  readonly literal_steps: readonly string[];
  /** DSK-P-001's outside-the-model question, carried apart from the grounded stories (PTL 5933036532 #4). */
  readonly blind_spot_step: string | null;
}

export interface MethodScienceContext {
  readonly method: ScienceMethod;
  readonly dsk: DskCitation | null;
  readonly not_cited: NotCitedReason | null;
  /**
   * The plan a pre-mortem stresses: the licensed leader, else the option the user explicitly chose, else none. A lone
   * option is never named on its own: a plan label needs a licence or the user's choice (PTL 5933036532 #5).
   */
  readonly plan: { readonly option_id: string; readonly label: string; readonly basis: PlanBasis } | null;
  readonly goal_label: string | null;
  readonly current_option_labels: readonly string[];
  readonly supplied_items: readonly SuppliedItem[];
  /**
   * Figures the user stated. Empty in v1: REASONING COACH's checker compares digit strings and no formatter for them is
   * agreed yet, so none is emitted rather than one formatted here.
   */
  readonly supplied_figures: readonly string[];
}

export type PlanBasis = 'licensed_leader' | 'user_selected';

/** Which DSK protocol names each method's exercise (the same pairing as `INTENT_PROTOCOL_ID`, plus the pre-mortem). */
const METHOD_PROTOCOL_ID: Readonly<Record<ScienceMethod, string>> = {
  pre_mortem: 'DSK-P-001',
  elicit_options: 'DSK-P-004',
};

/**
 * DSK-P-001's outside-the-model step, BOUND TO THE BUNDLE IT WAS READ FROM. Step 2 of the v1.0.0 bundle asks for "a
 * failure scenario that the model doesn't capture". It is selected by position under the bundle's own hash, so a new
 * bundle yields no blind-spot step until this binding is re-read, never a different step silently.
 */
const BLIND_SPOT_STEP = {
  protocol_id: 'DSK-P-001',
  bundle_hash: 'ca0f63fb0a7d942ccd7b5be67ffde5ad61edef92f8181269d8f966d690d9c896',
  step_index: 1,
} as const;

const PLACEHOLDER_RE = /\[[^\]]*\]/;

/** Codepoint order, as the reference builder sorts (Python `sorted`), never locale order. */
const byCodepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function protocolById(id: string): { protocol: DSKProtocol; bundleHash: string } | null | 'unverified' {
  const bundle = loadVerifiedDskBundle();
  if (bundle === null) return 'unverified';
  const record = (bundle.objects ?? []).find((o): o is DSKProtocol => o.type === 'protocol' && o.id === id) ?? null;
  if (record === null || record.deprecated === true) return null;
  return { protocol: record, bundleHash: bundle.dsk_version_hash };
}

function choosePlan(
  s: MethodScienceSignals,
  userSelected: string | null | undefined,
): MethodScienceContext['plan'] {
  const labels = s['model.option_labels'];
  // The leader's identity is read ONLY behind its licence: an unlicensed leader is never read, so it cannot leak.
  if (s['run.leader_licensed'] === true) {
    const leader = s['run.leader_option_id'];
    if (typeof leader === 'string' && typeof labels[leader] === 'string') {
      return { option_id: leader, label: labels[leader], basis: 'licensed_leader' };
    }
  }
  if (typeof userSelected === 'string' && typeof labels[userSelected] === 'string') {
    return { option_id: userSelected, label: labels[userSelected], basis: 'user_selected' };
  }
  return null;
}

/**
 * The pre-mortem's items in REASONING COACH's action-priority order (`method_turns.RC-PREMORTEM.inputs`, reference
 * `tools/build-cases.py` `pm_items` @ 5ff741ab):
 *   (1) links on the plan's path that only Olumi sized (placeholder or estimate), nearest the goal first;
 *   (2) factors on the plan's path (an end of one of those links) whose value is Olumi's estimate;
 *   (3) risks at either end of a link on the plan's path;
 *   (4) limits whose quantity sits on the plan's path.
 * Ties break by id, in codepoint order.
 */
function premortemItems(s: MethodScienceSignals, planId: string, graph: unknown): SuppliedItem[] {
  const onPlan = s['model.goal_path_links'].filter((l) => l.option_ids.includes(planId));
  const distance = new Map<string, number>();
  for (const l of s['model.goal_path_links']) distance.set(l.link_id, l.goal_distance);
  for (const f of s['model.goal_path_factors']) distance.set(f.factor_id, f.goal_distance);
  const ordered = (ids: string[]): string[] =>
    [...ids].sort((a, b) => (distance.get(a) ?? 99) - (distance.get(b) ?? 99) || byCodepoint(a, b));

  const links = new Map(
    onPlan.filter((l) => l.link_sizing === 'placeholder' || l.link_sizing === 'olumi_estimate').map((l) => [l.link_id, l] as const),
  );
  const riskIds = new Set(s['model.risk_ids']);
  const riskLabel = new Map<string, string>();
  const pathNodes = new Set<string>();
  for (const l of onPlan) {
    const [from, to] = l.link_id.split('->');
    for (const [id, label] of [[from, l.from_label], [to, l.to_label]] as const) {
      if (id === undefined) continue;
      pathNodes.add(id);
      if (riskIds.has(id)) riskLabel.set(id, label);
    }
  }
  // A factor only on ANOTHER option's path is not this plan's evidence gap (CODEX_CLI_OVERFLOW 5934859876 P1).
  const factors = new Map(
    s['model.goal_path_factors']
      .filter((f) => f.value_authorship === 'olumi_estimate' && pathNodes.has(f.factor_id))
      .map((f) => [f.factor_id, f] as const),
  );

  return [
    ...ordered([...links.keys()]).map((id): SuppliedItem => {
      const l = links.get(id)!;
      return { id, kind: 'link', labels: [l.from_label, l.to_label], card: 'propose_link_strengths' };
    }),
    ...ordered([...factors.keys()]).map((id): SuppliedItem => ({
      id, kind: 'factor', labels: [factors.get(id)!.label], card: 'propose_assumptions',
    })),
    ...[...riskLabel.keys()].sort(byCodepoint).map((id): SuppliedItem => ({
      id, kind: 'risk', labels: [riskLabel.get(id)!], card: 'propose_new_risk',
    })),
    // A limit's target is a new risk against it, never a change to the limit (RC 5933294912).
    ...limitsOnPath(graph, pathNodes).map((l): SuppliedItem => ({
      id: l.id, kind: 'limit', labels: [l.label], card: 'propose_new_risk',
    })),
  ];
}

function limitsOnPath(graph: unknown, pathNodes: ReadonlySet<string>): { id: string; label: string }[] {
  const constraints = (graph as { goal_constraints?: unknown } | null)?.goal_constraints;
  if (!Array.isArray(constraints)) return [];
  const out: { id: string; label: string }[] = [];
  for (const c of constraints) {
    const r = c as { constraint_id?: unknown; node_id?: unknown; label?: unknown } | null;
    if (typeof r?.constraint_id !== 'string' || typeof r.node_id !== 'string' || typeof r.label !== 'string') continue;
    if (pathNodes.has(r.node_id)) out.push({ id: r.constraint_id, label: r.label });
  }
  return out.sort((a, b) => byCodepoint(a.id, b.id));
}

/**
 * Whether the method's protocol may be cited, clause by clause, each read from a typed input. The protocol's own
 * `stage_applicability`, `required_inputs` and `contraindications` are the specification; every clause below names the
 * one it implements.
 */
function adjudicate(
  input: MethodScienceInput,
  plan: MethodScienceContext['plan'],
  items: readonly SuppliedItem[],
): { citation: DskCitation | null; reason: NotCitedReason | null } {
  const found = protocolById(METHOD_PROTOCOL_ID[input.method]);
  if (found === 'unverified') return { citation: null, reason: 'bundle_unverified' };
  if (found === null) return { citation: null, reason: 'protocol_unavailable' };
  const { protocol, bundleHash } = found;

  if (input.canonical_stage === null) return { citation: null, reason: 'no_canonical_stage' };
  const stage = mapStageToDecisionStage(input.canonical_stage);
  if (!(protocol.stage_applicability ?? []).includes(stage)) return { citation: null, reason: 'stage_not_applicable' };

  const s = input.signals;
  const ownOptions = s['model.non_sq_option_ids'].length;
  if (input.method === 'pre_mortem') {
    // required_inputs[0] "analysis results with fragile edges or evidence gaps": a current Run, and at least one item
    // only Olumi sized or estimated on the plan's path. (Fragile edges are never-coach as "could flip": not read.)
    if (s['run.kind'] !== 'complete_current') return { citation: null, reason: 'no_current_run' };
    // required_inputs[1] "identified winning option": the licensed leader only. A user's choice names a plan, not a winner.
    if (plan?.basis !== 'licensed_leader') return { citation: null, reason: 'no_identified_plan' };
    // contraindications[0] "only one option and no meaningful alternatives".
    if (ownOptions < 2) return { citation: null, reason: 'single_option' };
    if (!items.some((i) => i.kind === 'link' || i.kind === 'factor')) return { citation: null, reason: 'no_evidence_gap' };
    // contraindications[1] "already identified fragile edges and wants to proceed" is the user's dismissal, which the
    // selector's cooldown carries (RC dsk_trigger_map DSK-TR-001 negatives_to_rc); a press is the user asking.
  } else {
    // P-004 is a frame|ideate exercise ("before we analyse further"): never after a Run, current or stale, whatever
    // stage is read (DL 5933063973 (a); CODEX_CLI_OVERFLOW 5934859876 P1). Only a model that was never run is eligible;
    // an unknown run state is not (fail closed).
    if (s['run.kind'] !== 'none') return { citation: null, reason: 'run_exists' };
    // required_inputs[0] "current options in the model".
    if (Object.keys(s['model.option_labels']).length === 0) return { citation: null, reason: 'no_options' };
    // contraindications[0] "binary go/no-go": one own option (or none) against carrying on as now.
    if (ownOptions < 2) return { citation: null, reason: 'single_option' };
    // contraindications[1] "already explicitly evaluated resource trade-offs" has no typed signal; the press is the
    // user asking, and the selector's cooldown carries a dismissal.
  }

  const askSteps = input.method !== 'pre_mortem';
  const step = protocol.steps?.[BLIND_SPOT_STEP.step_index];
  const blindSpot = input.method === 'pre_mortem'
    && protocol.id === BLIND_SPOT_STEP.protocol_id
    && bundleHash === BLIND_SPOT_STEP.bundle_hash
    && typeof step === 'string' && !PLACEHOLDER_RE.test(step)
    ? step : null;
  return {
    citation: {
      protocol_id: protocol.id,
      protocol_title: protocol.title,
      bundle_hash: bundleHash,
      decision_stage: stage,
      protocol_directive: protocolDirectiveLines(protocol, { askSteps }).join('\n').trim(),
      literal_steps: literalProtocolSteps(protocol),
      blind_spot_step: blindSpot,
    },
    reason: null,
  };
}

export function methodScienceContext(input: MethodScienceInput): MethodScienceContext {
  const s = input.signals;
  const plan = input.method === 'pre_mortem' ? choosePlan(s, input.user_selected_option_id) : null;
  const items = plan === null ? [] : premortemItems(s, plan.option_id, input.graph);
  const { citation, reason } = adjudicate(input, plan, items);
  return {
    method: input.method,
    dsk: citation,
    not_cited: reason,
    plan,
    goal_label: typeof s['model.goal_label'] === 'string' ? s['model.goal_label'] : null,
    current_option_labels: Object.values(s['model.option_labels']),
    supplied_items: items,
    supplied_figures: [],
  };
}
