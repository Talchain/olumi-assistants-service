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
 * ⛔ The plan is never chosen for the user (PTL 5933036532 #5): explicit worksheets use the user's own pick; other
 * callers prefer the licensed leader. Both
 * writers of the pick (a choose_plan button, and a pre-mortem row whose copy names the user's option) converge on ONE
 * carrier, the chip id `planPickChipId(option_id)`, and ONE reader, `methodPressOf`. The pick lives for its own press
 * only: nothing is stored. A generic press with multiple own options and no licensed leader stresses the decision.
 */
import type { StageType } from '@talchain/schemas/boundary';

import { leaderLicenceFromState } from '../../compose/leader-licence.js';
import type { SuggestedAction } from '../../compose/types.js';
import { deriveAuthoritativeStage } from '../../context/derive-stage.js';
import type { AnalysisFreshness } from '../../context/freshness.js';
import { extractGraphOptionIds } from '../../context/option-identity.js';
import { checkMethodTurn, methodPlanOf, selectGuidance, stateKeyHash } from '../guidance/index.js';
import { linkTargetOf } from '../guidance/select-strengthen-placeholder.js';
import { isPremortemWorksheetPress } from '../guidance/plan.js';
import { linkStrengthsCardArgs, type LinkStrengthsCardArgs } from '../strengthen-press.js';
import type { GuidanceSignals as SelectorSignals, GuidanceState, MethodInputs, PolicyId } from '../guidance/index.js';
import type { GuidanceRecord } from '../guidance/types.js';
import { POLICY } from '../guidance/policy.js';
import { methodScienceContext, type GoalHorizon, type MethodScienceContext, type SuppliedItem } from '../science/method-science-context.js';
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
 * option (removed, or taken out of the comparison, since the button was offered) carries no pick. It remains an
 * option-naming press: the user is asked again, never handed a plan or decision subject they did not ask for.
 */
export function methodPressOf(chipId: unknown, nonSqOptionIds: readonly string[]): MethodPress | null {
  if (chipId === PREMORTEM_PRESS_ID) return { pick: null };
  if (typeof chipId !== 'string' || !chipId.startsWith(PLAN_PICK_PREFIX)) return null;
  const matches = nonSqOptionIds.filter((id) => planPickChipId(id) === chipId);
  return { pick: matches.length === 1 ? matches[0] : null };
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
  /** A decision-level run has plan === null: no single option id is carried to science or the method. */
  readonly context: MethodScienceContext;
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

/**
 * Why a recognised press cannot run the method. The press still gets the method's OWN answer, never ordinary generation
 * (CODEX_CLI_OVERFLOW P1 on #2480; DL 5939415083 (1)).
 */
export type UnavailableReason = 'model_unread' | 'no_goal' | 'no_own_option' | 'plan_unconfirmed' | 'no_grounded_item';

/** ONE deterministic "can't run the pre-mortem because …" reply, with 'Talk it through'. No model call. */
export interface UnavailableTurn {
  readonly kind: 'unavailable';
  readonly reason: UnavailableReason;
  readonly reply: string;
  readonly actions: readonly SuggestedAction[];
}

export type MethodTurn = RunMethodTurn | ChoosePlanTurn | UnavailableTurn;

const UNAVAILABLE_REPLY: Readonly<Record<UnavailableReason, (plan: string | null) => string>> = {
  model_unread: () => 'I can\u2019t run the pre-mortem right now because I couldn\u2019t read your model. Try again in a moment.',
  no_goal: () => 'I can\u2019t run the pre-mortem yet because your model has no goal to measure failure against. Add the goal first.',
  no_own_option: () => 'I can\u2019t run the pre-mortem yet because your model has no option of yours to stress-test. Add one first.',
  plan_unconfirmed: () => 'I can\u2019t run the pre-mortem because I couldn\u2019t confirm which option to stress-test. Press \u201cRun a pre-mortem\u201d again and pick one.',
  no_grounded_item: (plan) => `I can\u2019t run the pre-mortem on ${plan === null ? 'this decision' : `\u2018${plan}\u2019`} yet because I have no supported model item to stress-test for it.`,
};

export function unavailableTurn(reason: UnavailableReason, plan: string | null = null): UnavailableTurn {
  return { kind: 'unavailable', reason, reply: UNAVAILABLE_REPLY[reason](plan), actions: [TALK_IT_THROUGH_CHIP] };
}

export interface MethodTurnInput {
  /** The request's pressed chip id (`body.chip.id`). */
  readonly chipId: unknown;
  readonly signalInputs: Omit<GuidanceSignalInputs, 'request' | 'explicitRequest'>;
}

/**
 * The method turn for this request. Null ONLY when the request carries no pre-mortem press: a recognised press always
 * gets the method's own answer (run, choose_plan, or unavailable), never an ordinary Agent turn.
 */
export function planMethodTurn(input: MethodTurnInput): MethodTurn | null {
  const signals = assembleGuidanceSignals({ ...input.signalInputs, request: 'method', explicitRequest: METHOD });
  return methodTurnFromSignals(input.chipId, signals, input.signalInputs.graph);
}

export function methodTurnFromSignals(chipId: unknown, s: TurnSignals, graph: unknown): MethodTurn | null {
  const press = methodPressOf(chipId, s['model.non_sq_option_ids']);
  if (press === null) return null;
  if (s['model.goal_present'] !== true) return unavailableTurn('no_goal');
  if (s['model.non_sq_option_ids'].length === 0) return unavailableTurn('no_own_option');
  // An invalid explicit pick never falls through to a licensed plan; retain the existing choose-plan refusal.
  const worksheetPressId = isPremortemWorksheetPress(chipId) ? chipId : undefined;
  if (worksheetPressId !== undefined && press.pick === null) {
    return choosePlan(s['model.non_sq_option_ids'], s['model.option_labels']) ?? unavailableTurn('plan_unconfirmed');
  }
  const selector = {
    ...selectorSignalsOf(s, press.pick),
    'user.generic_method_press': chipId === PREMORTEM_PRESS_ID,
    ...(worksheetPressId !== undefined ? { 'user.premortem_worksheet_press_id': worksheetPressId } : {}),
  };
  const selection = selectGuidance(selector, selector.guidance ?? {});
  if (selection.runs_method !== METHOD) return unavailableTurn('plan_unconfirmed');
  if (selection.mode === 'choose_plan') return choosePlan(selection.choices ?? [], s['model.option_labels']) ?? unavailableTurn('plan_unconfirmed');
  const decision = selection.mode === 'decision_plan';
  const planId = methodPlanOf(selector);
  if (!decision && planId === undefined) return unavailableTurn('plan_unconfirmed');
  if (decision && s['model.non_sq_option_ids'].some(id => !s['model.option_labels'][id])) return unavailableTurn('plan_unconfirmed');
  // A generic press may stress the decision if its licensed leader has no eligible item. An option-naming press
  // keeps the selector's plan; science uses the same item eligibility and union as the existing decision-level path.
  const mayUseDecision = decision || (chipId === PREMORTEM_PRESS_ID && press.pick === null && s['model.non_sq_option_ids'].length >= 2);
  const context = methodScienceContext({
    method: 'pre_mortem',
    canonical_stage: canonicalStageOf(s['run.kind'], graph),
    signals: s,
    user_selected_option_id: press.pick,
    ...(worksheetPressId !== undefined ? { premortem_worksheet_press_id: worksheetPressId } : {}),
    ...(mayUseDecision ? { decision_level: true } : {}),
    graph,
  });
  // Option plans must agree across RC and science. Decision runs carry no plan and require permission above.
  const plan = context.plan;
  if (context.decision_level === true) {
    if (!mayUseDecision || plan !== null || s['model.non_sq_option_ids'].some(id => !s['model.option_labels'][id])) return unavailableTurn('plan_unconfirmed');
  } else if (decision || plan === null || plan.option_id !== planId) return unavailableTurn('plan_unconfirmed');
  if (context.supplied_items.length === 0) return unavailableTurn('no_grounded_item', plan?.label ?? null);
  return { kind: 'run', context, directive: methodDirective(context), check_inputs: checkInputsOf(context, graph) };
}

const quote = (label: string): string => `‘${label}’`;

/** RC's example opening assumes a year; the served directive carries the goal's approved horizon instead (P02, 7 Oct). */
const CONTRACT_HORIZON = 'It is a year later and';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The horizon in plain words: '31 March 2027', or '6 months'. Calendar arithmetic only; no time zone, no locale. */
export function horizonWords(h: GoalHorizon): string {
  if ('deadline' in h) {
    const [y, m, d] = h.deadline.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  return `${h.months} month${h.months === 1 ? '' : 's'}`;
}

function horizonOpening(h: GoalHorizon | null): string {
  if (h === null) return 'Imagine';
  return 'deadline' in h ? `It is ${horizonWords(h)} and` : `It is ${horizonWords(h)} later and`;
}

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
  const plan = ctx.plan === null ? 'this decision' : quote(ctx.plan.label);
  const decision = ctx.decision_level === true;
  return [
    'METHOD TURN: the user asked for a pre-mortem. This reply follows the method below exactly, and calls no tools.',
    `${decision ? 'Stress-test the whole decision' : `The plan to stress-test is ${plan}`}.${ctx.goal_label !== null ? ` The goal is ${quote(ctx.goal_label)}.` : ''}`,
    ...(decision ? [CONTRACT.decision_plan.rule,
      `The current option labels are: ${ctx.current_option_labels.map(quote).join(', ')}.`] : []),
    ...(ctx.dsk !== null
      ? [
          ctx.dsk.protocol_directive,
          ...(ctx.dsk.blind_spot_step !== null
            ? [`For the 'Outside the model:' line, use this step of the protocol: ${ctx.dsk.blind_spot_step}`]
            : []),
        ]
      : []),
    `Shape: ${CONTRACT.body.replaceAll(quote('Switch to GCP'), plan).replace(CONTRACT_HORIZON, horizonOpening(ctx.horizon ?? null))}`,
    ctx.horizon !== undefined
      ? `The goal's horizon, as the user set it, is ${horizonWords(ctx.horizon)}. Set every story at that horizon; never assume another.`
      : 'No approved deadline is held for the goal: use only a period the user stated, and invent none.',
    `Format: ${CONTRACT.format}`,
    'Each story rests on at least one of these items from the user’s model, highest priority first. Name the item in '
      + 'its own words; for a link, name both ends:',
    ...ctx.supplied_items.map((item) => item.lever_option_labels !== undefined
      ? `- ${item.lever_option_labels.map(label => `${quote(label)} sets ${itemPhrase(item)}`).join('; ')}`
      : `- ${itemPhrase(item)} (${decision ? ITEM_CLASS[item.kind].replaceAll('this plan', 'an option') : ITEM_CLASS[item.kind]})`),
    `${decision ? 'Each story names at most one option. Never name a winner, best option or recommendation.' : `Name no option other than ${plan}.`} Outside an item's own name, use no percentage and none of these words: likely, `
      + 'likelihood, chance, probability, probable, odds. Never say anything will fail: tell each story in the past tense.',
    ...(storyOnlyDecision(ctx) ? ['Outside the model’s own labels, give no Run figures, leader or ranking claims; durations are allowed. This exercise prepares no model change or approval card.'] : []),
    ...POLICY.method_turns.shared.never.map((rule) => `Never: ${rule}.`),
    `At most ${POLICY.method_turns.shared.max_words} words.`,
  ].join('\n');
}

/** Every node label of the current model: the user's own words, masked before RC's text bans (`shared.label_masking`). */
function modelLabelsOf(graph: unknown): string[] {
  const nodes = rec(graph)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((n) => {
    const label = rec(n)?.label;
    return typeof label === 'string' && label !== '' ? [label] : [];
  });
}

function checkInputsOf(ctx: RunMethodTurn['context'], graph: unknown): MethodInputs {
  return {
    ...(ctx.decision_level === true ? { decision_level: true } : { plan_label: ctx.plan?.label }),
    current_option_labels: ctx.current_option_labels,
    supplied_items: ctx.supplied_items.map(({ id, labels }) => ({ id, labels })),
    // A deadline's date is the user's own figure, masked like a label (a month count is a duration, already exempt).
    model_labels: ctx.horizon !== undefined && 'deadline' in ctx.horizon ? [...modelLabelsOf(graph), horizonWords(ctx.horizon)] : modelLabelsOf(graph),
  };
}

/** The typed producer flag preserves every original W9 licensed-decision control byte for byte. */
function storyOnlyDecision(ctx: RunMethodTurn['context']): boolean {
  return ctx.decision_story_only === true;
}

/** A story's three server-owned parts: the failure way, then 'Watch for:', then 'Mitigate:'. */
export type StoryParts = readonly [failure: string, watch: string, mitigate: string];

/** Qualitative, kind-correct stories: a risk materialises; only an intervention is called a lever. */
function failureParts(item: SuppliedItem, goal: string): StoryParts {
  if (item.lever_option_labels !== undefined) {
    return [`The effect of ${itemPhrase(item)} fell short of what ${goal} needed.`, 'early results diverging from the expected effect.', 'test this lever with a small group before expanding.'];
  }
  if (item.kind === 'link') {
    return [`The relationship between ${item.labels.map(quote).join(' and ')} differed from the model, undermining progress towards ${goal}.`, 'the observed relationship diverging from the model.', 'check this relationship before relying on it.'];
  }
  if (item.kind === 'risk') {
    return [`${itemPhrase(item)} materialised and undermined progress towards ${goal}.`, 'early signs of this risk.', 'prepare a response before committing further.'];
  }
  if (item.kind === 'limit') {
    return [`${itemPhrase(item)} was breached, undermining progress towards ${goal}.`, 'approaching this limit.', 'set a checkpoint before committing further.'];
  }
  return [`${itemPhrase(item)} differed from the model, undermining progress towards ${goal}.`, 'observations diverging from the model.', 'check this assumption before relying on it.'];
}

/** The ONE story layout: the server owns the markers, whoever wrote the parts. */
export function storyText(parts: StoryParts): string {
  return `${parts[0]} Watch for: ${parts[1]} Mitigate: ${parts[2]}`;
}

const goalPhrase = (ctx: RunMethodTurn['context']) => ctx.goal_label === null ? 'the goal' : quote(ctx.goal_label);

/** The server-built story for one supplied item, as sent and as the worksheet recognises it. */
export function serverStoryParts(item: SuppliedItem, ctx: RunMethodTurn['context']): StoryParts {
  return failureParts(item, goalPhrase(ctx));
}

function failureStory(item: SuppliedItem, goal: string): string {
  return storyText(failureParts(item, goal));
}

/**
 * A story's three parts: before the first "Watch for:", between it and the next "Mitigate:", and after that; each part
 * trimmed and non-empty, markers optionally bolded (served a2-2, 7 Oct). Linear marker search: the earlier lazy
 * `^([\s\S]+?)\s*Watch for:` regex took 3.1 s on a story with 20k spaces after its marker.
 */
export function storyParts(story: string): StoryParts | null {
  const watch = /(?:\*\*)?Watch for:(?:\*\*)?/u.exec(story);
  if (!watch) return null;
  const afterWatch = watch.index + watch[0].length;
  const mitigate = /(?:\*\*)?Mitigate:(?:\*\*)?/u.exec(story.slice(afterWatch));
  if (!mitigate) return null;
  const parts = [story.slice(0, watch.index), story.slice(afterWatch, afterWatch + mitigate.index), story.slice(afterWatch + mitigate.index + mitigate[0].length)]
    .map(part => part.trim());
  return parts.every(part => part !== '') ? [parts[0], parts[1], parts[2]] : null;
}

export function fallbackReply(ctx: RunMethodTurn['context']): string {
  if (storyOnlyDecision(ctx)) {
    const first = ctx.supplied_items[0];
    // Prefer a different option's lever for the second story; never infer a leader from the item order.
    const second = ctx.supplied_items.find(item => item !== first && item.lever_option_labels?.some(label =>
      !first.lever_option_labels?.includes(label))) ?? ctx.supplied_items[1] ?? first;
    const goal = goalPhrase(ctx);
    return [
      'Imagine this decision has gone badly. Two failure stories to test:',
      `1. ${failureStory(first, goal)}`,
      `2. ${failureStory(second, goal)}`,
      'Outside the model: what else could have blindsided this decision?',
    ].join('\n');
  }
  return FALLBACK_TEMPLATE
    .replace('‘{plan}’', ctx.plan === null ? 'this decision' : quote(ctx.plan.label))
    .replace('{first supplied item}', itemPhrase(ctx.supplied_items[0]));
}

export interface SettledMethodTurn {
  /**
   * What is sent: the draft when every post-check passed; else the draft's passing stories in the server's layout with
   * each refused story replaced by the server-built story for an unused item; else RC's deterministic fallback.
   * Never a repaired sentence: a story is kept whole or replaced whole.
   */
  readonly reply: string;
  /** True when what is sent passed every post-check (the draft, or the composed reply re-checked). */
  readonly passed: boolean;
  /** The draft's failed checks, kept when a composed reply is sent so the refusal stays measurable. */
  readonly failed: readonly string[];
  /** The 1-based story numbers that are server-built; absent when no story is (a draft sent as written, or RC's fallback). */
  readonly server_stories?: readonly number[];
  /**
   * The ONE item the turn's change card acts on (`action_target`): on a pass, the story target with the lowest supplied
   * index; on the fallback, the first supplied item, which is the one the fallback names.
   */
  readonly target: SuppliedItem;
}

/** Story numbers and story bodies, by RC's own numbered-line rule (the checker's split). */
function numberedStories(reply: string): { lead: string[]; stories: string[]; blindspot: string | null } {
  const lead: string[] = [];
  const stories: string[] = [];
  let blindspot: string | null = null;
  let current: string | undefined;
  for (const line of reply.split(/\r?\n/u)) {
    if (/^\s*[1-9]\.\s/u.test(line)) { if (current !== undefined) stories.push(current); current = line.replace(/^\s*[1-9]\.\s/u, ''); }
    else if (/^\s*(?:\*\*)?Outside the model:/u.test(line)) {
      if (current !== undefined) stories.push(current);
      current = undefined;
      blindspot ??= line.trim().replace(/^(?:\*\*)?Outside the model:(?:\*\*)?\s*/u, '');
    } else if (current !== undefined) current += `\n${line}`;
    else if (stories.length === 0) lead.push(line);
  }
  if (current !== undefined) stories.push(current);
  return { lead, stories: stories.map(story => story.trim()), blindspot };
}

function compose(ctx: RunMethodTurn['context'], stories: readonly string[], blindspot: string): string {
  const subject = ctx.plan === null ? 'this decision' : quote(ctx.plan.label);
  const opening = ctx.horizon !== undefined
    ? `Imagine it is ${'deadline' in ctx.horizon ? horizonWords(ctx.horizon) : `${horizonWords(ctx.horizon)} from now`} and ${subject} has gone badly.`
    : `Imagine ${subject} has gone badly.`;
  return [`${opening} Failure stories to test:`, ...stories.map((story, i) => `${i + 1}. ${story}`), `Outside the model: ${blindspot}`].join('\n');
}

const SERVER_BLINDSPOT = (ctx: RunMethodTurn['context']) =>
  `what else could have blindsided ${ctx.plan === null ? 'this decision' : quote(ctx.plan.label)}?`;

/**
 * Per-story settle (P02; SB-METHOD-HANDLERS-DESIGN §3): each story is checked ALONE by the same checker, on a probe that
 * repeats it under the server's own frame and question, so RC's rules are applied once and never restated. A passing
 * story is kept whole in the server's layout; a refused one is replaced by the server-built story for the next unused
 * supplied item (a decision prefers an item whose option is unambiguous, so the worksheet can bind it). The composed
 * reply is re-checked as a whole before it is sent. Zero passing stories keep RC's fallback exactly.
 */
function composedSettle(turn: RunMethodTurn, draft: string, failed: readonly string[]): SettledMethodTurn | null {
  const ctx = turn.context;
  const decisionStories = storyOnlyDecision(ctx);
  const { stories, blindspot } = numberedStories(draft);
  const probe = (story: string, question: string) =>
    checkMethodTurn(METHOD, compose(ctx, [story, story], question), turn.check_inputs, decisionStories);
  const serverQuestion = SERVER_BLINDSPOT(ctx);
  const kept: { story: string; target: string | null }[] = stories.slice(0, 3).map((raw) => {
    const parts = storyParts(raw);
    if (parts === null) return { story: '', target: null };
    const story = storyText(parts);
    const check = probe(story, serverQuestion);
    return check.pass ? { story, target: check.targets[0] ?? null } : { story: '', target: null };
  });
  if (!kept.some(k => k.target !== null)) return null;
  const used = new Set(kept.flatMap(k => k.target === null ? [] : [k.target]));
  const bindable = (item: SuppliedItem) => item.kind !== 'limit'
    && (ctx.decision_level !== true || (item.lever_option_labels?.length ?? 0) <= 1);
  const nextItem = (): SuppliedItem | undefined => {
    const unused = ctx.supplied_items.filter(item => !used.has(item.id));
    const item = unused.find(bindable) ?? unused[0];
    if (item !== undefined) used.add(item.id);
    return item;
  };
  const serverStories: number[] = [];
  const out: string[] = [];
  for (const k of [...kept, ...Array.from({ length: Math.max(0, 2 - kept.length) }, () => ({ story: '', target: null }))]) {
    if (k.target !== null) { out.push(k.story); continue; }
    const item = nextItem();
    if (item === undefined) continue;
    out.push(storyText(serverStoryParts(item, ctx)));
    serverStories.push(out.length);
  }
  for (const question of blindspot !== null && blindspot.endsWith('?') ? [blindspot, serverQuestion] : [serverQuestion]) {
    const reply = compose(ctx, out, question);
    const check = checkMethodTurn(METHOD, reply, turn.check_inputs, decisionStories);
    if (!check.pass) continue;
    const indices = check.targets.map((id) => ctx.supplied_items.findIndex((item) => item.id === id));
    if (indices.length === 0 || indices.some((i) => i < 0)) continue;
    return { reply, passed: true, failed, ...(serverStories.length > 0 ? { server_stories: serverStories } : {}), target: ctx.supplied_items[Math.min(...indices)] };
  }
  return null;
}

export function settleMethodTurn(turn: RunMethodTurn, draft: string): SettledMethodTurn {
  const items = turn.context.supplied_items;
  const fallback = (failed: readonly string[]): SettledMethodTurn =>
    ({ reply: fallbackReply(turn.context), passed: false, failed, target: items[0] });
  let check: ReturnType<typeof checkMethodTurn>;
  try {
    check = checkMethodTurn(METHOD, draft, turn.check_inputs, storyOnlyDecision(turn.context));
  } catch {
    // The checker throws on contract drift; an unchecked draft is never sent.
    return fallback(['CHECKER_UNAVAILABLE']);
  }
  const indices = check.targets.map((id) => items.findIndex((item) => item.id === id));
  const failed = check.pass && (indices.length === 0 || indices.some((i) => i < 0)) ? ['PM-GROUNDED'] : check.failed;
  if (failed.length === 0) return { reply: draft, passed: true, failed: [], target: items[Math.min(...indices)] };
  try {
    return composedSettle(turn, draft, failed) ?? fallback(failed);
  } catch {
    return fallback(failed);
  }
}

/** The pre-mortem card's basis (provenance, never shown as the user's words). */
export const PREMORTEM_CARD_RATIONALE = 'Olumi\u2019s current band for a link this pre-mortem rests on, for you to apply as it stands or edit.';

/** The ONE change card's call through the existing door: the tool and the exact arguments its schema takes. */
export type CardCall =
  | { readonly tool: 'propose_link_strengths'; readonly args: LinkStrengthsCardArgs }
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
 * the story, i.e. model text: not in v1), a decision story item, or a target the graph
 * no longer holds as it was read.
 */
export function cardCallFor(target: SuppliedItem, graph: unknown, rationale: string = PREMORTEM_CARD_RATIONALE): CardCall | null {
  if (target.card === null) return null;
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
    return { tool: 'propose_link_strengths', args: linkStrengthsCardArgs(link, rationale) };
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
  // A read that failed (or found no model) is said as such, never handed to the Agent as an ordinary turn.
  if (rb.graph === undefined || rb.graph === null) return unavailableTurn('model_unread');
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
 * The method turn's record, rebuilt at its EXPLICIT boundary: the history before the turn, the user's words, and what
 * was SENT. Nothing the call produced survives (a multi-message or tool-hop draft included), and an earlier turn is never
 * touched, even when the call produced no output (CODEX_CLI_OVERFLOW P1 #3 on #2480; DL 5939415083 (2)).
 */
export function methodTurnItems(history: readonly unknown[] | undefined, message: string, sent: string): unknown[] {
  return [
    ...(history ?? []),
    { role: 'user', content: [{ type: 'input_text', text: message }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: sent }] },
  ];
}
