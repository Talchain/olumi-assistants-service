/**
 * ⭐ T3: AN ASKED PRE-MORTEM RUNS THE REASONING COACH'S METHOD ON TYPED INPUTS, AND ITS REPLY IS CHECKED BEFORE IT IS
 * SENT (DL 5937411688 / 5937503623; RC `method_turns.RC-PREMORTEM`, vendored in `guidance/policy.ts` @a00cb9c8).
 *
 * Today the "Run a pre-mortem" press sends one sentence and the Agent improvises. This module is the method turn's
 * decision and its text gate, and nothing else:
 *   press → `assembleGuidanceSignals` (#2465, the ONE signal derivation) → `selectGuidance` (RC's leaf: run the method,
 *   or ask which option to stress-test) → `methodScienceContext` (#2466: the plan, the grounded items in action
 *   priority, the DSK citation when one applies) → the directive the Agent's reply follows → `checkMethodTurn` on the
 *   draft BEFORE it is sent → the draft, or RC's deterministic fallback, plus the ONE item the turn's change card acts on.
 *
 * PURE and TOTAL: no I/O, no model call, never throws. The route makes the call and the card (`routes/agent-v1-turn.ts`).
 *
 * ⛔ The plan is never chosen for the user (PTL 5933036532 #5): the licensed leader, else the user's own pick. Both
 * writers of the pick (a choose_plan button, and a pre-mortem row whose copy names the user's option) converge on ONE
 * carrier, the chip id `planPickChipId(option_id)`, and ONE reader, `methodPressOf`. The pick lives for its own press
 * only: nothing is stored, so a later generic press asks again.
 */
import type { StageType } from '@talchain/schemas/boundary';

import { leaderLicenceFromState } from '../../compose/leader-licence.js';
import type { SuggestedAction } from '../../compose/types.js';
import { deriveAuthoritativeStage } from '../../context/derive-stage.js';
import type { AnalysisFreshness } from '../../context/freshness.js';
import { extractGraphOptionIds } from '../../context/option-identity.js';
import type { InfluenceBand } from '../../format/influence-bands.js';
import { checkMethodTurn, methodPlanOf, selectGuidance, stateKeyHash } from '../guidance/index.js';
import { linkTargetOf } from '../guidance/select-strengthen-placeholder.js';
import type { GuidanceSignals as SelectorSignals, GuidanceState, MethodInputs, PolicyId } from '../guidance/index.js';
import type { GuidanceRecord } from '../guidance/types.js';
import { POLICY } from '../guidance/policy.js';
import { methodScienceContext, type MethodScienceContext, type SuppliedItem } from '../science/method-science-context.js';
import {
  assembleGuidanceSignals,
  type GuidanceSignalInputs,
  type GuidanceSignals as TurnSignals,
} from '../turn-context/guidance-signals.js';

const METHOD = 'RC-PREMORTEM' satisfies PolicyId;
const CONTRACT = POLICY.method_turns[METHOD];

/** The static next-step chip (`NEXT_STEP_CHIPS` in `routes/agent-v1-turn.ts`; a test pins the equality): a GENERIC press. */
export const PREMORTEM_PRESS_ID = 'agent-next-pre-mortem';
/**
 * A press that names the plan: this prefix + the 12-hex `stateKeyHash({option_id})`. Never the raw id: node ids carry
 * the user's words (RC `selection.entry_key`).
 */
export const PLAN_PICK_PREFIX = 'agent-premortem-plan:';
/** RC's secondary action on every pre-mortem turn ('Talk it through'): plain words, an ordinary Agent turn. */
export const TALK_IT_THROUGH_CHIP = {
  id: 'agent-talk-it-through',
  label: 'Talk it through',
  message: 'Let’s talk it through.',
} as const satisfies SuggestedAction;
/**
 * RC's deterministic fallback, verbatim from `method_turns.RC-PREMORTEM.fallback` (a test pins the equality, so a
 * contract change REDs here instead of drifting).
 */
export const FALLBACK_TEMPLATE =
  'Imagine ‘{plan}’ has gone badly. Start with {first supplied item}: how would you notice it early, and what would you do?';

export function planPickChipId(optionId: string): string {
  return `${PLAN_PICK_PREFIX}${stateKeyHash({ option_id: optionId })}`;
}

export interface MethodPress {
  /** The user's own option this press names, or null for a generic press. */
  readonly pick: string | null;
}

/**
 * The pre-mortem press this request carries, or null when it carries none. A pick whose hash names no CURRENT own
 * option (removed, or taken out of the comparison, since the button was offered) reads as a generic press: the user
 * is asked again, never handed a plan they did not pick.
 */
export function methodPressOf(chipId: unknown, nonSqOptionIds: readonly string[]): MethodPress | null {
  if (chipId === PREMORTEM_PRESS_ID) return { pick: null };
  if (typeof chipId !== 'string' || !chipId.startsWith(PLAN_PICK_PREFIX)) return null;
  return { pick: nonSqOptionIds.find((id) => planPickChipId(id) === chipId) ?? null };
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const POLICY_IDS: ReadonlySet<string> = new Set(POLICY.rows.map((r) => r.policy_id));
const RECORD_STATUSES: ReadonlySet<string> = new Set(['offered', 'pressed', 'completed', 'dismissed']);

function horizonOf(v: unknown): SelectorSignals['model.goal_horizon'] {
  if (v === null) return null;
  const r = rec(v);
  if (r === undefined) return undefined;
  return {
    ...(typeof r.deadline === 'string' ? { deadline: r.deadline } : {}),
    ...(typeof r.months === 'number' && Number.isFinite(r.months) ? { months: r.months } : {}),
  };
}

/** The persisted guidance record, content-free as on disk (`{status, state_key_hash, turn_id}`); anything else is dropped. */
function guidanceStateOf(entries: Readonly<Record<string, unknown>>): GuidanceState {
  const out: Record<string, GuidanceRecord> = {};
  for (const [key, value] of Object.entries(entries)) {
    const r = rec(value);
    if (r === undefined || typeof r.status !== 'string' || !RECORD_STATUSES.has(r.status)) continue;
    out[key] = {
      status: r.status as GuidanceRecord['status'],
      ...(typeof r.state_key_hash === 'string' ? { state_key_hash: r.state_key_hash } : {}),
      ...(typeof r.turn_id === 'string' ? { turn_id: r.turn_id } : {}),
    };
  }
  return out;
}

/**
 * The ONE adapter from #2465's signals to RC's selector leaf (AI HARNESS agreed, 5938348370): the same named signals,
 * with the four fields whose wire form differs narrowed to the leaf's types (a null goal label is ABSENT: the leaf's
 * copy renderer reads it as text), the press's pick as `user.selected_option_id`, and the Run's key when the caller has
 * one (RC-WHAT-CHANGES keys on it; a method turn does not).
 */
export function selectorSignalsOf(s: TurnSignals, pick: string | null, runKey?: string): SelectorSignals {
  const {
    'model.goal_label': goalLabel,
    'model.goal_horizon': horizon,
    guidance,
    'user.explicit_request': asked,
    ...rest
  } = s;
  return {
    ...rest,
    ...(goalLabel !== null ? { 'model.goal_label': goalLabel } : {}),
    'model.goal_horizon': horizonOf(horizon),
    guidance: guidanceStateOf(guidance),
    'user.explicit_request': typeof asked === 'string' && POLICY_IDS.has(asked) ? (asked as PolicyId) : null,
    'user.selected_option_id': pick,
    ...(runKey !== undefined ? { 'run.run_key': runKey } : {}),
  };
}

/**
 * The canonical state's run currency, as `compose/analysis-state-v1.ts` derives it FROM the freshness authority:
 * complete_current ⇔ fresh, complete_stale ⇔ stale, never_run ⇔ none. Every other kind is a currency nobody vouches for.
 */
const FRESHNESS_OF_RUN_KIND: Readonly<Record<string, AnalysisFreshness>> = {
  complete_current: 'fresh',
  complete_stale: 'stale',
  never_run: 'none',
};

/**
 * The ONE canonical lifecycle stage of an Agent turn: `deriveAuthoritativeStage` over the lane's own stage (`frame`, the
 * only stage this lane requests) and the run's currency, with the option count from `extractGraphOptionIds`, exactly as
 * route-v2 feeds it (`build-turn-context.ts`). An unread run state is NO stage, so no protocol is cited (DL 5933063973).
 */
export function canonicalStageOf(runKind: string | null, graph: unknown): StageType | null {
  if (runKind === null) return null;
  return deriveAuthoritativeStage({
    requestedStage: 'frame',
    freshness: FRESHNESS_OF_RUN_KIND[runKind] ?? 'unknown',
    optionCount: extractGraphOptionIds(graph)?.length ?? null,
    hasGraph: graph != null,
  });
}

/** A method turn that runs: everything the route needs for the ONE model call and the check after it. */
export interface RunMethodTurn {
  readonly kind: 'run';
  readonly context: MethodScienceContext & { readonly plan: NonNullable<MethodScienceContext['plan']> };
  /** Appended to this turn's instructions only: never the user's message, so it is never handed on as history. */
  readonly directive: string;
  readonly check_inputs: MethodInputs;
}

/** No plan yet: ask which option to stress-test. Deterministic, no model call. */
export interface ChoosePlanTurn {
  readonly kind: 'choose_plan';
  readonly reply: string;
  readonly actions: readonly SuggestedAction[];
}

export type MethodTurn = RunMethodTurn | ChoosePlanTurn;

export interface MethodTurnInput {
  /** The request's pressed chip id (`body.chip.id`). */
  readonly chipId: unknown;
  readonly signalInputs: Omit<GuidanceSignalInputs, 'request' | 'explicitRequest'>;
}

/**
 * The method turn for this request, or null when it is not one: no pre-mortem press, no goal or own option to stress,
 * or nothing in the model a story could rest on. Null is an ordinary Agent turn, exactly as today.
 */
export function planMethodTurn(input: MethodTurnInput): MethodTurn | null {
  const signals = assembleGuidanceSignals({ ...input.signalInputs, request: 'method', explicitRequest: METHOD });
  return methodTurnFromSignals(input.chipId, signals, input.signalInputs.graph);
}

export function methodTurnFromSignals(chipId: unknown, s: TurnSignals, graph: unknown): MethodTurn | null {
  const press = methodPressOf(chipId, s['model.non_sq_option_ids']);
  if (press === null) return null;
  const selector = selectorSignalsOf(s, press.pick);
  const selection = selectGuidance(selector, selector.guidance ?? {});
  if (selection.runs_method !== METHOD) return null;
  if (selection.mode === 'choose_plan') return choosePlan(selection.choices ?? [], s['model.option_labels']);
  const planId = methodPlanOf(selector);
  if (planId === undefined) return null;
  const context = methodScienceContext({
    method: 'pre_mortem',
    canonical_stage: canonicalStageOf(s['run.kind'], graph),
    signals: s,
    user_selected_option_id: press.pick,
    graph,
  });
  // ONE plan rule, two readers (RC's `methodPlanOf`, SCIENCE/DSK's `choosePlan`): if they ever disagree, nothing runs.
  const plan = context.plan;
  if (plan === null || plan.option_id !== planId) return null;
  if (context.supplied_items.length === 0) return null;
  const ctx = { ...context, plan };
  return { kind: 'run', context: ctx, directive: methodDirective(ctx), check_inputs: checkInputsOf(ctx) };
}

const quote = (label: string): string => `‘${label}’`;

function choosePlan(choices: readonly string[], labels: Readonly<Record<string, string>>): ChoosePlanTurn | null {
  const buttons: SuggestedAction[] = [];
  for (const id of choices) {
    const label = labels[id];
    if (typeof label !== 'string' || label === '') return null;
    buttons.push({ id: planPickChipId(id), label: quote(label), message: `Run a pre-mortem on ${quote(label)}.` });
  }
  if (buttons.length === 0) return null;
  return { kind: 'choose_plan', reply: CONTRACT.choose_plan.copy, actions: [...buttons, TALK_IT_THROUGH_CHIP] };
}

/** How the reply and the fallback name an item: by the user's labels only; a link by both of its ends. */
function itemPhrase(item: SuppliedItem): string {
  return item.kind === 'link' && item.labels.length === 2
    ? `how ${quote(item.labels[0])} affects ${quote(item.labels[1])}`
    : quote(item.labels.join(' '));
}

const ITEM_CLASS: Readonly<Record<SuppliedItem['kind'], string>> = {
  link: 'nobody has sized this yet',
  factor: 'a figure Olumi estimated',
  risk: 'a risk on this plan’s path',
  limit: 'a limit this plan must stay within',
};

/**
 * The directive this turn's reply follows. RC's own method text (body, format, the never list, the word cap) is read
 * from the vendored contract, never restated; the DSK protocol line comes only from `MethodScienceContext` (RC never
 * asserts a badge). The checker's rules are stated so a compliant draft passes; a draft that does not is replaced.
 */
export function methodDirective(ctx: RunMethodTurn['context']): string {
  const plan = quote(ctx.plan.label);
  return [
    'METHOD TURN: the user asked for a pre-mortem. This reply follows the method below exactly, and calls no tools.',
    `The plan to stress-test is ${plan}.${ctx.goal_label !== null ? ` The goal is ${quote(ctx.goal_label)}.` : ''}`,
    ...(ctx.dsk !== null
      ? [
          ctx.dsk.protocol_directive,
          ...(ctx.dsk.blind_spot_step !== null
            ? [`For the 'Outside the model:' line, use this step of the protocol: ${ctx.dsk.blind_spot_step}`]
            : []),
        ]
      : []),
    `Shape: ${CONTRACT.body.replaceAll(quote('Switch to GCP'), plan)}`,
    `Format: ${CONTRACT.format}`,
    'Each story rests on at least one of these items from the user’s model, highest priority first. Name the item in '
      + 'its own words; for a link, name both ends:',
    ...ctx.supplied_items.map((item) => `- ${itemPhrase(item)} (${ITEM_CLASS[item.kind]})`),
    `Name no option other than ${plan}. Outside an item's own name, use no percentage and none of these words: likely, `
      + 'likelihood, chance, probability, probable, odds. Never say anything will fail: tell each story in the past tense.',
    ...POLICY.method_turns.shared.never.map((rule) => `Never: ${rule}.`),
    `At most ${POLICY.method_turns.shared.max_words} words.`,
  ].join('\n');
}

function checkInputsOf(ctx: RunMethodTurn['context']): MethodInputs {
  return {
    plan_label: ctx.plan.label,
    current_option_labels: ctx.current_option_labels,
    supplied_items: ctx.supplied_items.map(({ id, labels }) => ({ id, labels })),
  };
}

export function fallbackReply(ctx: RunMethodTurn['context']): string {
  return FALLBACK_TEMPLATE
    .replace('{plan}', ctx.plan.label)
    .replace('{first supplied item}', itemPhrase(ctx.supplied_items[0]));
}

export interface SettledMethodTurn {
  /** What is sent: the draft when every post-check passed, else RC's deterministic fallback. Never a repaired draft. */
  readonly reply: string;
  readonly passed: boolean;
  readonly failed: readonly string[];
  /**
   * The ONE item the turn's change card acts on (`action_target`): on a pass, the story target with the lowest supplied
   * index; on the fallback, the first supplied item, which is the one the fallback names.
   */
  readonly target: SuppliedItem;
}

export function settleMethodTurn(turn: RunMethodTurn, draft: string): SettledMethodTurn {
  const items = turn.context.supplied_items;
  const fallback = (failed: readonly string[]): SettledMethodTurn =>
    ({ reply: fallbackReply(turn.context), passed: false, failed, target: items[0] });
  let check: ReturnType<typeof checkMethodTurn>;
  try {
    check = checkMethodTurn(METHOD, draft, turn.check_inputs);
  } catch {
    // The checker throws on contract drift; an unchecked draft is never sent.
    return fallback(['CHECKER_UNAVAILABLE']);
  }
  if (!check.pass) return fallback(check.failed);
  const indices = check.targets.map((id) => items.findIndex((item) => item.id === id));
  if (indices.length === 0 || indices.some((i) => i < 0)) return fallback(['PM-GROUNDED']);
  return { reply: draft, passed: true, failed: [], target: items[Math.min(...indices)] };
}

/** The ONE change card's call through the existing door: the tool and the exact arguments its schema takes. */
export type CardCall =
  | {
      readonly tool: 'propose_link_strengths';
      readonly args: {
        readonly links: readonly [{ readonly from_label: string; readonly to_label: string; readonly strength: InfluenceBand }];
        readonly rationale: string;
      };
    }
  | {
      readonly tool: 'propose_assumptions';
      readonly args: {
        readonly assumptions: readonly [{
          readonly factor_label: string; readonly value: number; readonly unit: string; readonly basis: string; readonly keep: true;
        }];
      };
    };

/**
 * The ONE change card the method turn ends in (RC `action_target`), as the existing door's own call. It authors no
 * figure: a link is offered at the band the writer itself reads as current, read through RC's `linkTargetOf` (#2477:
 * the ONE read of a link's mean and band, shared with the S1 picker), with no `from_words`, so it is
 * recorded as Olumi's estimate that the user accepts or edits; a factor is offered as Olumi's STORED figure to keep
 * (`keep`: the writer re-reads the stored figure and refuses anything not Olumi's own). Labels are the graph's, which
 * the writer resolves.
 *
 * Null = no card, and the turn offers 'Talk it through' only: a risk or a limit (its card would need a label drawn from
 * the story, i.e. model text: not in v1), or a target the graph no longer holds as it was read.
 */
export function cardCallFor(target: SuppliedItem, graph: unknown, rationale: string): CardCall | null {
  const g = rec(graph);
  const nodes = Array.isArray(g?.nodes) ? g.nodes.map(rec).filter((n): n is Rec => n !== undefined) : [];
  const edges = Array.isArray(g?.edges) ? g.edges.map(rec).filter((e): e is Rec => e !== undefined) : [];
  const labelOf = (id: unknown): string | null => {
    const label = nodes.find((n) => n.id === id)?.label;
    return typeof label === 'string' && label !== '' ? label : null;
  };
  if (target.kind === 'link') {
    // The ends come from the graph's own edge, never from splitting the id (AI HARNESS 5938348370).
    const edge = edges.find((e) => `${String(e.from)}->${String(e.to)}` === target.id);
    const link = typeof edge?.from === 'string' && typeof edge.to === 'string' ? linkTargetOf(graph, edge.from, edge.to) : null;
    if (link === null || labelOf(link.from_id) === null || labelOf(link.to_id) === null) return null;
    return {
      tool: 'propose_link_strengths',
      args: { links: [{ from_label: link.from_label, to_label: link.to_label, strength: link.band }], rationale },
    };
  }
  if (target.kind === 'factor') {
    const node = nodes.find((n) => n.id === target.id);
    const os = rec(node?.observed_state);
    const label = labelOf(target.id);
    if (label === null || typeof os?.value !== 'number' || !Number.isFinite(os.value)) return null;
    return {
      tool: 'propose_assumptions',
      args: {
        assumptions: [{
          factor_label: label, value: os.value, unit: typeof os.unit === 'string' ? os.unit : '',
          basis: 'Olumi\u2019s current estimate', keep: true,
        }],
      },
    };
  }
  return null;
}

/** The agent route's graph readback (`readBackState`), as far as a method turn reads it. */
export interface MethodReadback {
  readonly graph?: unknown;
  readonly analysisState?: unknown;
  readonly analysisReady?: unknown;
  readonly analysisResult?: unknown;
  readonly optionParticipation?: unknown;
  /** The SELECTED fact's evaluated identity carriers (`analysis_identity_evaluated_node_ids`). */
  readonly identityEvaluated?: ReadonlySet<string>;
}

/** Whether this request's chip is a pre-mortem press at all: the route reads the state only then. */
export function isMethodPress(chipId: unknown): boolean {
  return chipId === PREMORTEM_PRESS_ID || (typeof chipId === 'string' && chipId.startsWith(PLAN_PICK_PREFIX));
}

/**
 * The method turn for a press, from the route's own readback. The leader is licensed by the ONE licence
 * (`leaderLicenceFromState`, PR-L1: anything but `withheld`); the identity carriers are projected to exactly the two
 * fields `placeholderGoalPaths` reads (`node_id`, `evaluated`).
 */
export function methodTurnForReadback(chipId: unknown, rb: MethodReadback): MethodTurn | null {
  if (!isMethodPress(chipId)) return null;
  return planMethodTurn({
    chipId,
    signalInputs: {
      offeredSpecific: [],
      graph: rb.graph,
      analysisState: rb.analysisState,
      analysisResult: rb.analysisResult,
      optionParticipation: rb.optionParticipation,
      ...(rb.identityEvaluated !== undefined
        ? { identityEvaluations: [...rb.identityEvaluated].map((node_id) => ({ node_id, evaluated: true })) } : {}),
      leaderLicensed: leaderLicenceFromState(rb.analysisState, rb.analysisReady) !== 'withheld',
    },
  });
}

/**
 * The turn's history with its LAST assistant message saying what was actually sent: a replaced draft never reaches the
 * next turn as Olumi's words.
 */
export function withSentReply(items: readonly unknown[], text: string): unknown[] {
  const sent = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = rec(items[i]);
    // The model's own output message carries `type: 'message'` and may carry no role; an input item carries a role.
    if (it !== undefined && (it.role === 'assistant' || (it.type === 'message' && it.role === undefined))) {
      return [...items.slice(0, i), sent, ...items.slice(i + 1)];
    }
  }
  return [...items, sent];
}
