/**
 * ⭐ WIDEN THE OPTIONS: AN ASKED WIDEN RUNS THE REASONING COACH'S RC-WIDEN METHOD, AND ENDS IN ONE CONSENT CARD
 * (PTL 5947349533 GO; DL 5947426886: "≤3 genuinely distinct options as ONE add-option card → approve → re-analyse";
 * RC `method_turns.RC-WIDEN` + its `structured_checks`, vendored in `guidance/policy.ts`).
 *
 *   press → `assembleGuidanceSignals` (#2465, the ONE signal derivation) → `widenVariantOf` (the row's OWN evaluation)
 *   → the directive → ONE model call whose ONLY tool is `propose_new_option` (forced, one hop: the route) → this
 *   module's GATE runs inside that door BEFORE anything is stored → the door's ONE card (its approve chip is the
 *   existing one) or, when the gate refuses, RC's deterministic fallback and no card.
 *
 * ⛔ THE GATE IS BY IDENTITY, NEVER BY WORDING (DL rows 5947426886):
 *   - grounded: every factor an option changes is an EXISTING factor of the model, by its exact label;
 *   - distinct: no option has the label of a current option, and no option changes the SAME set of factors (with the
 *     same directions) as a current option or another proposed option: a reworded copy of an option is refused;
 *   - no figure is the user's unless they gave it: a level is offered only as Olumi's estimate (`estimate: true` + a
 *     basis), which the door records and shows as Olumi's;
 *   - 1 to 3 options, and no new factors in v1 (a new lever is a new entity, not grounded in the model).
 * ⛔ NOTHING IS WRITTEN WITHOUT APPROVAL: a refused call stores nothing; a passed call stores ONE pending change that the
 * user approves (or not) with the existing control.
 *
 * PURE and TOTAL: no I/O, no model call, never throws.
 */
import type { SuggestedAction } from '../../compose/types.js';
import { leaderLicenceFromState } from '../../compose/leader-licence.js';
import { widenVariantOf } from '../guidance/index.js';
import type { Target, Variant } from '../guidance/types.js';
import { POLICY } from '../guidance/policy.js';
import { doorLevelOf, estimateLevelPersists } from '../runtime/agent-capabilities.js';
import { assembleGuidanceSignals, type GuidanceSignals as TurnSignals } from '../turn-context/guidance-signals.js';
import { selectorSignalsOf, TALK_IT_THROUGH_CHIP, type MethodReadback } from './method-turn.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import type { AgentCapabilities, ToolResult } from '../runtime/agent-tools.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildAddFactorTransaction, isNewFactorTarget } from '../../routing/add-factor-transaction.js';
import { factorDefinitionRedirect } from '../../routing/factor-definition-target.js';
import { foldWords, sameFoldedLabel } from '../../label-fold.js';
import { buildAddRiskTransaction } from '../../routing/add-risk-transaction.js';
import { sameLabel } from '../../routing/add-option-transaction.js';
import { statedGoalTargetOf } from '../../goal-target/stated-goal-target.js';
import { chanceGoalDeadlineAsk, goalDeadlineOf, goalKindOf } from '../../goal-target/goal-kind.js';

const METHOD = 'RC-WIDEN' as const;
const CONTRACT = POLICY.method_turns[METHOD];

/** The ONE tool a Widen turn may call: the existing add-option door (one change, one approval). */
export const WIDEN_TOOL = 'propose_new_option';
/** The most options one Widen proposes (RC WD-COUNT). */
export const WIDEN_MAX_OPTIONS = 3;
/** The Widen press. Offered as a next step when the selector's row is RC-WIDEN on options (`widenChipFor`). */
export const WIDEN_PRESS_ID = 'agent-next-widen';
/** RC's 'Something else' (choose_1_of_3): plain words, an ordinary Agent turn. */
export const SOMETHING_ELSE_CHIP = {
  id: 'agent-widen-something-else',
  label: 'Something else',
  message: 'None of those. Let’s think of something else.',
} as const satisfies SuggestedAction;
/** RC's deterministic fallback, verbatim from `method_turns.RC-WIDEN.fallback` (a test pins the inclusion). */
export const WIDEN_FALLBACK_TEMPLATE =
  'What other way could you reach {goal}? For example, a different lever, a smaller first step, or a mix of these options.';
/** The gate's refusal code: the door stores nothing, and the turn falls back. */
export const WIDEN_GATE_REFUSAL = 'widen_gate';

/** The canvas "+" chooser's Option press (DGAI `WhatElseChooser.tsx` → `askAi.ts` `ask:<intent>`): the same options door. */
export const CANVAS_OPTIONS_PRESS_ID = 'ask:widen';

export function isWidenPress(chipId: unknown): boolean {
  return chipId === WIDEN_PRESS_ID || chipId === CANVAS_OPTIONS_PRESS_ID || questionedLinkOf(chipId) !== null;
}

/** The Widen next-step chip, labelled by RC's primary action for options ("Suggest options"). */
export const WIDEN_CHIP = {
  id: WIDEN_PRESS_ID,
  label: CONTRACT_LABEL(),
  message: 'Suggest options I haven’t considered.',
} as const satisfies SuggestedAction;
function CONTRACT_LABEL(): string {
  const row = POLICY.rows.find((r) => r.policy_id === METHOD);
  const label = (row?.primary_action as { label?: Record<string, string> } | undefined)?.label?.options;
  return typeof label === 'string' && label !== '' ? label : 'Suggest options';
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const quote = (label: string): string => `‘${label}’`;
/** Labels compare after folding curly quotes, case and whitespace: the same entity, however the model typed it. */
const norm = foldWords;

export interface Graph {
  readonly nodes: Rec[];
  readonly edges: Rec[];
}
function graphOf(graph: unknown): Graph {
  const g = rec(graph);
  return {
    nodes: Array.isArray(g?.nodes) ? g.nodes.map(rec).filter((n): n is Rec => n !== undefined) : [],
    edges: Array.isArray(g?.edges) ? g.edges.map(rec).filter((e): e is Rec => e !== undefined) : [],
  };
}
const labelOf = (n: Rec | undefined): string | null => (typeof n?.label === 'string' && n.label !== '' ? n.label : null);

/** How an option moves one factor: from its INTERVENTION, never from the structural edge (always +1.0, DL P1-A). */
export type Move = 'positive' | 'negative' | 'unchanged' | 'unknown';
/** An option's identity for distinctness: factor id → how it moves that factor. */
export type Levers = ReadonlyMap<string, Move>;

const numeric = (v: unknown): number | undefined => {
  const x = rec(v) !== undefined ? rec(v)!.value : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
};

/**
 * An existing option's levers by the CANONICAL rule (`model.same_lever`, guidance-signals.ts): the sign of its set level
 * against the baseline (the status-quo option's level, else the factor's observed value, else 0). A level that is not a
 * number is `unknown`. An option with no interventions falls back to its option → factor edges, each `unknown`: the
 * direction is not stored there, so a proposal on the same factors fails closed. The status quo's repair edges are
 * never moves; its stored baseline levels, if any, imply only `unchanged`.
 */
export function existingLevers(g: Graph, optionId: string, sqId: string | null): Levers {
  const byId = new Map(g.nodes.map((n) => [String(n.id), n] as const));
  const factorIds = new Set(g.nodes.filter((n) => n.kind === 'factor').map((n) => String(n.id)));
  const ivs = rec(byId.get(optionId)?.interventions) ?? {};
  const out = new Map<string, Move>();
  for (const t of Object.keys(ivs).filter((k) => factorIds.has(k))) {
    // No finite baseline is NO direction (DL P1-D): never a default of 0 that invents one.
    const base = baselineOf(g, t, sqId);
    out.set(t, moveOf(numeric(ivs[t]), base));
  }
  if (out.size === 0 && optionId !== sqId) {
    for (const e of g.edges) if (e.from === optionId && factorIds.has(String(e.to))) out.set(String(e.to), 'unknown');
  }
  return out;
}

/** sign(level − baseline); `unknown` when either side is not a finite number. */
export function moveOf(level: number | undefined, base: number | null): Move {
  if (level === undefined || base === null) return 'unknown';
  return level > base ? 'positive' : level < base ? 'negative' : 'unchanged';
}

/** A factor's baseline on the stored (encoded) scale: the status quo's level, else the observed value; null when neither is finite. */
export function baselineOf(g: Graph, factorId: string, sqId: string | null): number | null {
  const byId = new Map(g.nodes.map((n) => [String(n.id), n] as const));
  const sqIvs = sqId === null ? {} : rec(byId.get(sqId)?.interventions) ?? {};
  return numeric(sqIvs[factorId]) ?? numeric(rec(byId.get(factorId)?.observed_state)?.value) ?? null;
}

/** A proposal copies an option when it moves EXACTLY the same factors the same way; an `unknown` move matches any (fail closed). */
export function sameLevers(proposed: Levers, existing: Levers): boolean {
  if (proposed.size === 0 || proposed.size !== existing.size) return false;
  for (const [t, d] of proposed) {
    const e = existing.get(t);
    if (e === undefined || (e !== 'unknown' && e !== d)) return false;
  }
  return true;
}

/** A Widen that runs: what the route needs for the ONE model call, and what the gate checks against. */
export interface RunWidenTurn {
  readonly kind: 'run';
  readonly target: Target;
  readonly variant: Variant | null;
  readonly goal_label: string;
  /** Appended to this turn's instructions only: never the user's message, so it is never handed on as history. */
  readonly directive: string;
  /** Every option already in the model (compared, status quo, left out): label (normalised) and its levers. */
  readonly current: readonly { readonly label: string; readonly levers: Levers }[];
  /** Every factor of the model, as the DOOR resolves them (`planNewOption`: label OR description, trim + lower-case). */
  readonly factors: readonly { readonly id: string; readonly label: string; readonly description: string }[];
  /** The graph as read and its status quo: a proposed level's direction is read against the same baseline (DL P1-E). */
  readonly graph: Graph;
  readonly sq: string | null;
  /** The RAW graph, exactly as the door reads it (`factorUnitOf` joins `goal_constraints` by node id). */
  readonly raw: unknown;
  /** LIVING MODEL: the ONE open assumption this press questions, re-read from the stored graph. Absent on a Widen. */
  readonly question?: QuestionedLink;
}

export type WidenUnavailableReason = 'model_unread' | 'no_goal' | 'not_an_assumption';

/** ONE deterministic "can't widen because …" reply, with 'Talk it through'. No model call. */
export interface WidenUnavailableTurn {
  readonly kind: 'unavailable';
  readonly reason: WidenUnavailableReason | 'factor_anchor_ineligible' | 'factor_anchor_defined';
  readonly reply: string;
  readonly actions: readonly SuggestedAction[];
}

export type WidenTurn = RunWidenTurn | WidenUnavailableTurn;

const UNAVAILABLE_REPLY: Readonly<Record<WidenUnavailableReason, string>> = {
  model_unread: 'I can’t suggest options right now because I couldn’t read your model. Try again in a moment.',
  no_goal: 'I can’t suggest options yet because your model has no goal for them to reach. Add the goal first.',
  not_an_assumption: 'That link isn’t an open assumption in your model (it isn’t one of Olumi’s unconfirmed estimates on the way to your goal), so there’s nothing for me to question there.',
};

function unavailable(reason: WidenUnavailableReason): WidenUnavailableTurn {
  return { kind: 'unavailable', reason, reply: UNAVAILABLE_REPLY[reason], actions: [TALK_IT_THROUGH_CHIP] };
}

/** The Widen turn for these signals: unavailable without a goal or factors, else ONE gated model call. Total. */
export function widenTurnFromSignals(s: TurnSignals, graph: unknown, question?: QuestionedLink): WidenTurn {
  if (s['model.goal_present'] !== true) return unavailable('no_goal');
  const g = graphOf(graph);
  const goalLabel = question?.goal_label ?? labelOf(goalOf(graph, g)) ?? s['model.goal_label'] ?? 'your goal';
  const vt = widenVariantOf(selectorSignalsOf(s, null));
  const variant = vt?.target === 'options' ? vt.variant : null;
  const labels = s['model.option_labels'];
  const sq = s['model.status_quo_option_id'];
  const ownIds = s['model.non_sq_option_ids'];
  const factors = g.nodes.filter((n) => n.kind === 'factor' && labelOf(n) !== null);
  const factorLabel = new Map(factors.map((n) => [n.id, labelOf(n)!] as const));
  // EVERY option already in the model is "existing" for distinctness: the compared ones, the status quo, and any option
  // left out of the comparison (an Olumi option the user excluded is not re-proposed as new: identity, not wording).
  const compared = new Set([...ownIds, ...(sq !== null ? [sq] : [])]);
  const optionIds = [...ownIds, ...(sq !== null ? [sq] : []),
    ...g.nodes.filter((n) => n.kind === 'option' && !compared.has(String(n.id))).map((n) => String(n.id))];
  const graphLabel = new Map(g.nodes.map((n) => [String(n.id), labelOf(n)] as const));
  const labelFor = (id: string): string => labels[id] ?? graphLabel.get(id) ?? id;
  const current = optionIds.map((id) => ({ label: norm(labelFor(id)), levers: id === sq ? new Map<string, Move>() : existingLevers(g, id, sq) }));
  const describe = (id: string): string => {
    const changes = id === sq ? [] : g.edges.filter((e) => e.from === id && factorLabel.has(e.to)).map((e) => quote(factorLabel.get(e.to)!));
    return `- ${quote(labelFor(id))}${compared.has(id) ? '' : ' (left out of the comparison)'}${changes.length > 0 ? `: changes ${changes.join(', ')}` : ''}`;
  };
  const directive = question !== undefined ? questionDirective(question, optionIds.map(describe), factors.map((n) => quote(labelOf(n)!))) : [
    'METHOD TURN: the user asked Olumi to suggest options they have not considered. Call propose_new_option exactly once, '
      + `with 1 to ${WIDEN_MAX_OPTIONS} options (one option: \`label\` + \`acts_on\`; two or three: \`options\`). The user approves `
      + 'the change before anything is added.',
    `The goal is ${quote(goalLabel)}.`,
    ...(variant === 'W1' ? ['On the latest run, every current option is likely to break the user’s limit: each suggestion must work in a different way.'] : []),
    ...(optionIds.length > 0 ? ['The options already in the model, and the factors each one changes (never propose any of these again):', ...optionIds.map(describe)] : []),
    `The model's factors (use these exact labels in acts_on, and no others): ${factors.map((n) => quote(labelOf(n)!)).join(', ')}.`,
    `Shape: ${CONTRACT.body}`,
    'Each option must change a DIFFERENT set of factors (or the same factors in a different direction) from every option '
      + 'above and from each other: a reworded copy of an existing option is refused. Name each option in 6 words or fewer, '
      + 'in plain words. Add no new factors.',
    'EVERY factor an option changes needs a level: your own estimate (estimate: true, with a basis the user can check), in '
      + 'the factor’s own units and within its range, so the options can be compared once the user approves. An option whose '
      + 'levels you cannot estimate is not suggested. Never present a level as the user’s figure, and put no figure in an '
      + 'option’s name.',
    'Put why each option might do better in `rationale`, in one or two plain sentences.',
    ...POLICY.method_turns.shared.never.map((rule) => `Never: ${rule}.`),
  ].join('\n');
  const doorFactors = g.nodes.filter((n) => n.kind === 'factor').map((n) => ({
    id: String(n.id), label: typeof n.label === 'string' ? n.label : '', description: typeof n.description === 'string' ? n.description : '' }));
  return { kind: 'run', target: 'options', variant: question !== undefined ? null : variant, goal_label: goalLabel, directive, current,
    factors: doorFactors, graph: g, sq, raw: graph, ...(question !== undefined ? { question } : {}) };
}

/** The Widen turn for a press, from the route's own readback (the same licence and identity projection as the pre-mortem). */
export function widenTurnForReadback(chipId: unknown, rb: MethodReadback): WidenTurn | null {
  if (!isWidenPress(chipId)) return null;
  if (rb.graph === undefined || rb.graph === null) return unavailable('model_unread');
  const pressed = questionedLinkOf(chipId);
  const question = pressed === null ? undefined : openAssumptionOf(rb.graph, pressed.from, pressed.to);
  if (pressed !== null && question === undefined) return unavailable('not_an_assumption');
  const signals = assembleGuidanceSignals({
    request: 'method',
    explicitRequest: METHOD,
    offeredSpecific: [],
    graph: rb.graph,
    analysisState: rb.analysisState,
    analysisResult: rb.analysisResult,
    optionParticipation: rb.optionParticipation,
    ...(rb.identityEvaluated !== undefined
      ? { identityEvaluations: [...rb.identityEvaluated].map((node_id) => ({ node_id, evaluated: true })) } : {}),
    leaderLicensed: leaderLicenceFromState(rb.analysisState, rb.analysisReady) !== 'withheld',
  });
  return widenTurnFromSignals(signals, rb.graph, question);
}

/** Safe to log verbatim: no option/factor labels, basis text, levels or user words. */
export interface WidenOptionCheck {
  readonly index: number;
  readonly factors: readonly { readonly factor_id: string | null; readonly stated_direction: 'positive' | 'negative' | null;
    readonly stored_direction: Move }[];
  readonly failed: readonly string[];
}
export type WidenGateResult = ({ readonly ok: true } | { readonly ok: false; readonly failed: readonly string[] }) & {
  readonly passing_indices: readonly number[];
  readonly per_option: readonly WidenOptionCheck[];
};

/** The door's own normaliser (`propose-new-option.ts` `norm`): trim + lower-case, nothing else. */
const doorNorm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/**
 * The factor the DOOR would pick for this label, or undefined. The door takes the FIRST factor whose label OR
 * description matches (`planNewOption`); the gate accepts only when exactly ONE factor matches either way, so both
 * resolve the same node (DL P2-C).
 */
export function doorFactorOf(turn: RunWidenTurn, wanted: unknown): string | undefined {
  const w = doorNorm(wanted);
  if (w === '') return undefined;
  const hits = turn.factors.filter((f) => doorNorm(f.label) === w || doorNorm(f.description) === w);
  return hits.length === 1 ? hits[0]!.id : undefined;
}

/**
 * The options a Widen call proposes, read EXACTLY as the door reads them (`agent-capabilities.ts` proposeNewOption:
 * `options` only when it is a NON-EMPTY array, otherwise the single `label`/`acts_on`). A strict provider fills every
 * key, so a one-option call arrives as `{ label, acts_on, options: [] }`; reading `[]` as "no options" refused both
 * pressed staging draws as WD-COUNT with nothing checked (Wave A2, CEE 86ccaf3, 7 Oct 02:41Z: `gate_options: []`).
 */
export function widenOptionsOf(a: Record<string, unknown>): unknown[] {
  if (Array.isArray(a.options) && a.options.length > 0) return a.options;
  return a.label !== undefined || a.acts_on !== undefined ? [{ label: a.label, acts_on: a.acts_on }] : [];
}

/**
 * RC-WIDEN's structured checks on the door's own arguments, BEFORE the door stores anything (by identity, never wording).
 * Failed ids: WD-COUNT · WD-S-NEW-FACTORS · WD-S-GROUNDED · WD-NO-DUP · WD-S-DISTINCT · WD-NO-NEW-FIGURES.
 */
export function widenGate(turn: RunWidenTurn, args: unknown): WidenGateResult {
  const a = rec(args) ?? {};
  const raw = widenOptionsOf(a);
  const failed = new Set<string>();
  if (raw.length < 1 || raw.length > WIDEN_MAX_OPTIONS) failed.add('WD-COUNT');
  if (Array.isArray(a.new_factors) && a.new_factors.length > 0) failed.add('WD-S-NEW-FACTORS');
  if (turn.question !== undefined && raw.length !== 1) failed.add('CH-COUNT');
  const wholeCallFailed = [...failed];
  const perOption: WidenOptionCheck[] = [];
  const passingIndices: number[] = [];
  const seen: Levers[] = turn.current.map((c) => c.levers);
  const currentLabels = new Set(turn.current.map((c) => c.label));
  const proposedLabels = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const optionFailed = new Set<string>(wholeCallFailed);
    const diagnostics: WidenOptionCheck['factors'][number][] = [];
    const factorsSeen = new Set<string>();
    const o = rec(item);
    const label = typeof o?.label === 'string' ? norm(o.label) : '';
    const actsOn = Array.isArray(o?.acts_on) ? o.acts_on.map(rec) : [];
    if (label === '' || currentLabels.has(label) || proposedLabels.has(label)) optionFailed.add('WD-NO-DUP');
    const levers = new Map<string, Move>();
    if (actsOn.length === 0) optionFailed.add('WD-S-GROUNDED');
    for (const e of actsOn) {
      const id = doorFactorOf(turn, e?.factor_label);
      const direction: 'positive' | 'negative' | undefined = e?.direction === 'negative' ? 'negative' : e?.direction === 'positive' ? 'positive' : undefined;
      const diagnostic = { factor_id: id ?? null, stated_direction: direction ?? null, stored_direction: 'unknown' as Move };
      diagnostics.push(diagnostic);
      if (id !== undefined && turn.question !== undefined && !actsWithout(turn.graph, id, turn.question)) optionFailed.add('CH-OTHER-MECHANISM');
      if (id === undefined || direction === undefined) { optionFailed.add('WD-S-GROUNDED'); continue; }
      // The door keeps the FIRST entry's direction but the LAST entry's level for a repeated factor: refuse the repeat.
      if (factorsSeen.has(id)) { optionFailed.add('WD-S-LEVEL'); continue; }
      factorsSeen.add(id);
      /**
       * ⛔ THE GATE JUDGES WHAT THE WRITER WILL PERSIST, NEVER WHAT THE MODEL DECLARED (DL round 3, P1-F; the scope cut
       * for v1). Every factor a Widen option changes carries Olumi's estimate level that the door WILL store, judged by
       * the DOOR'S OWN exported stages (DL 5950820450, structural; never a copy): `doorLevelOf` reads the level as the
       * door does, and `estimateLevelPersists` runs its unit check, name rule (`unit ?? factorUnit`) and range, in its
       * order. The door's other unset paths: no estimate + basis (WD-NO-NEW-FIGURES here) and the user's split in
       * another period (unreachable: the press message is our fixed chip text, no ratio). Plus a finite baseline for
       * the move. Anything else refuses this option: a lever that never persists can never make it "distinct".
       */
      const level = rec(e?.level);
      const lvl = doorLevelOf(level);
      if (level === undefined || lvl === undefined) { optionFailed.add('WD-S-LEVEL'); continue; }
      if (level.estimate !== true || typeof level.basis !== 'string' || level.basis.trim() === '') { optionFailed.add('WD-NO-NEW-FIGURES'); continue; }
      const node = turn.graph.nodes.find((n) => String(n.id) === id);
      const persists = estimateLevelPersists(lvl, node as never, turn.raw, typeof o?.label === 'string' ? o.label : '');
      if (!persists.ok) { optionFailed.add('WD-S-LEVEL'); continue; }
      const encoded = persists.value;
      // DL P1-E: the persisted level decides the move, on the door's own frame against the same baseline as the existing
      // options. No finite baseline = no move (refused); today's level, or a move against the declared word, is refused.
      const derived = moveOf(encoded, baselineOf(turn.graph, id, turn.sq));
      diagnostic.stored_direction = derived;
      if (derived === 'unknown') { optionFailed.add('WD-S-LEVEL'); continue; }
      if (derived !== direction) { optionFailed.add('WD-S-DIRECTION'); continue; }
      levers.set(id, derived);
    }
    if (levers.size > 0 && seen.some((existing) => sameLevers(levers, existing))) optionFailed.add('WD-S-DISTINCT');
    const clauses = [...optionFailed];
    perOption.push({ index, factors: diagnostics, failed: clauses });
    for (const clause of clauses) failed.add(clause);
    if (clauses.length === 0) {
      passingIndices.push(index);
      proposedLabels.add(label);
      seen.push(levers);
    }
  }
  const checks = { passing_indices: passingIndices, per_option: perOption };
  return passingIndices.length > 0 ? { ok: true, ...checks } : { ok: false, failed: [...failed], ...checks };
}

export function widenFallbackReply(turn: RunWidenTurn): string {
  return WIDEN_FALLBACK_TEMPLATE.replace('{goal}', quote(turn.goal_label));
}

/** Preserve the door's call shape and metadata; a partial batch contains only admitted options. */
export function widenPassingArgs(gate: WidenGateResult, args: Parameters<AgentCapabilities['proposeNewOption']>[1]): typeof args {
  return Array.isArray(args.options) && args.options.length > 0
    ? { ...args, options: args.options.filter((_, index) => gate.passing_indices.includes(index)) } : args;
}

const WIDEN_FAILURE_WORDS: Readonly<Record<string, string>> = {
  'WD-NO-DUP': 'its name repeats another option',
  'WD-S-DISTINCT': 'it changes the same factors in the same direction as another option',
  'WD-S-GROUNDED': 'its changes could not be matched to factors in your model',
  'WD-S-LEVEL': 'a level could not be stored and compared against today',
  'WD-S-DIRECTION': 'a level does not move in the direction it describes',
  'WD-NO-NEW-FIGURES': 'a level needs to be offered as Olumi’s estimate with a basis',
  'CH-OTHER-MECHANISM': 'it still depends on the assumption being questioned',
};

/** Extend the door's existing not_added disclosure, without inventing same-level twins for other failures. */
export function widenNotAdded(result: ToolResult, gate: WidenGateResult, args: unknown): ToolResult {
  if (!result.ok || !gate.ok) return result;
  const raw = rec(args);
  const options = Array.isArray(raw?.options) && raw.options.length > 0 ? raw.options : [raw];
  const dropped = gate.per_option.filter((o) => o.failed.length > 0).map((o) => ({
    option: String(rec(options[o.index])?.label ?? 'Unnamed option'),
    reason: o.failed.map((clause) => WIDEN_FAILURE_WORDS[clause] ?? 'it did not pass the checks for this suggestion').join('; '),
  }));
  if (dropped.length === 0) return result;
  return { ...result, not_added: [...(Array.isArray(result.not_added) ? result.not_added : []), ...dropped],
    not_added_note: [result.not_added_note,
      ...dropped.map((o) => `${quote(o.option)} is NOT in this change: ${o.reason}.`),
      'A distinct option requires a new proposal and approval. Never promise to add it later.',
    ].filter((line) => typeof line === 'string' && line !== '').join(' ') };
}

export interface SettledWidenTurn {
  /** What is sent: the door's own reply for the ONE card, else RC's deterministic fallback. Never a repaired draft. */
  readonly reply: string;
  readonly carded: boolean;
  /** RC's follow-ups beside the card's own approve chip: 'Something else', or 'Talk it through' on the fallback. */
  readonly actions: readonly SuggestedAction[];
}

/** The card's line when neither the door nor the gate has typed items to name (never the fallback beside a live card). */
export const WIDEN_CARD_LINE = 'I\u2019ve prepared options you haven\u2019t compared yet. Approve to add them to the comparison, then re-analyse.';

/**
 * The card's own line when the door composed none, from the DOOR'S TYPED RESULT only (DL P1-B): exactly the options it
 * HELD (`option` / `options`), the factors each sets and whose figure it is, and every option it left out (`not_added`).
 * No figure is restated (the card shows them); null when the result is not one this reads.
 */
export function widenDoorReply(result: unknown): string | null {
  const r = rec(result);
  if (r === undefined) return null;
  const held = Array.isArray(r.options) ? r.options.map(rec)
    : rec(r.option) !== undefined ? [{ ...rec(r.option)!, levels: r.levels }] : [];
  if (held.length === 0 || held.some((o) => o === undefined || typeof o.label !== 'string' || o.label === '')) return null;
  const sets = (l: unknown): string | null => {
    const x = rec(l);
    if (typeof x?.factor !== 'string') return null;
    if (x.value === null || x.value === undefined) return `${quote(x.factor)} (level still needed)`;
    return `${quote(x.factor)} (${x.stated_by === 'olumi_estimate' ? 'Olumi\u2019s estimate' : 'your figure'})`;
  };
  const lines = held.map((o) => {
    const parts = (Array.isArray(o!.levels) ? o!.levels : []).map(sets).filter((p): p is string => p !== null);
    return `- ${String(o!.label)}${parts.length > 0 ? `: sets ${parts.join(', ')}` : ''}`;
  });
  const left = (Array.isArray(r.not_added) ? r.not_added.map(rec) : []).flatMap((n) =>
    typeof n?.option !== 'string' ? [] : typeof n.same_levels_as === 'string'
      ? [`Not in this change: ${quote(n.option)} would set the same levels as ${quote(n.same_levels_as)}.`]
      : typeof n.reason === 'string' ? [`Not in this change: ${quote(n.option)}: ${n.reason}.`] : []);
  return [
    `${held.length === 1 ? 'An option' : 'Options'} you haven\u2019t compared yet:`,
    ...lines,
    ...left,
    `Approve to add ${held.length === 1 ? 'it' : 'them'} to the comparison, then re-analyse.`,
  ].join('\n');
}

/**
 * The turn's outcome from the loop's own record. The STORED card is the truth: exactly ONE passed proposal with an id
 * means the card stands, and its text is the door's own reply or, when the door composed none, `widenDoorReply` from
 * the door's typed result (what it HELD, DL P1-B). Anything else is RC's fallback with no card (a refused call stored nothing).
 */
export function settleWidenTurn(
  turn: RunWidenTurn,
  run: {
    readonly assistant_text: string;
    readonly tool_calls: readonly { readonly name: string; readonly ok: boolean; readonly proposal_id?: string }[];
    readonly tool_results?: readonly unknown[];
  },
): SettledWidenTurn {
  const cards = run.tool_calls.flatMap((c, i) => (c.name === WIDEN_TOOL && c.ok && typeof c.proposal_id === 'string' ? [i] : []));
  if (cards.length === 1) {
    const result = rec(run.tool_results?.[cards[0]!]);
    const gateDropped = Array.isArray(result?.not_added) && result.not_added.some((n) => typeof rec(n)?.reason === 'string');
    const reply = gateDropped ? widenDoorReply(result) ?? WIDEN_CARD_LINE : run.assistant_text.trim() !== '' ? run.assistant_text
      : widenDoorReply(run.tool_results?.[cards[0]!]) ?? WIDEN_CARD_LINE;
    if (turn.question !== undefined) {
      return { reply: `${questionHeadline(turn.question)}\n${reply}`, carded: true,
        actions: [{ ...QUESTION_KEEP_CHIP, id: `${QUESTION_KEEP_CHIP.id}:${run.tool_calls[cards[0]!]!.proposal_id}` }] };
    }
    return { reply, carded: true, actions: [SOMETHING_ELSE_CHIP] };
  }
  if (turn.question !== undefined) return { reply: questionFallbackReply(turn.question), carded: false, actions: [TALK_IT_THROUGH_CHIP] };
  return { reply: widenFallbackReply(turn), carded: false, actions: [TALK_IT_THROUGH_CHIP] };
}

/** The next step a Widen replaces when it is offered: the plain "What would change the result?" chip (RC-WHAT-CHANGES is
 * science-blocked, so that chip is an ordinary turn), keeping the UI's three-chip budget. */
export const WIDEN_REPLACES_CHIP_ID = 'agent-next-what-would-change';

/**
 * Whether this state offers Widen as a next step: the selector's OWN RC-WIDEN evaluation holds on options (W1, W3, W4,
 * W5 on a current result; never risks or drivers in v1). Total: an unreadable state offers nothing new.
 */
export function widenOffered(rb: MethodReadback): boolean {
  if (rb.graph === undefined || rb.graph === null) return false;
  try {
    const signals = assembleGuidanceSignals({
      request: 'turn',
      explicitRequest: null,
      offeredSpecific: [],
      graph: rb.graph,
      analysisState: rb.analysisState,
      analysisResult: rb.analysisResult,
      optionParticipation: rb.optionParticipation,
      ...(rb.identityEvaluated !== undefined
        ? { identityEvaluations: [...rb.identityEvaluated].map((node_id) => ({ node_id, evaluated: true })) } : {}),
      leaderLicensed: leaderLicenceFromState(rb.analysisState, rb.analysisReady) !== 'withheld',
    });
    return signals['model.goal_present'] === true && widenVariantOf(selectorSignalsOf(signals, null))?.target === 'options';
  } catch {
    return false;
  }
}

/** The product's next steps with Widen in the replaced chip's place when it is offered; otherwise unchanged. */
export function nextStepsWithWiden<T extends SuggestedAction>(steps: readonly T[], offered: boolean): (T | typeof WIDEN_CHIP)[] {
  return offered ? steps.map((s) => (s.id === WIDEN_REPLACES_CHIP_ID ? WIDEN_CHIP : s)) : [...steps];
}

/**
 * ⭐ LIVING MODEL — QUESTION ONE ASSUMPTION (PTL #85 5963052437 item 7; lease 5963140107; DL GO 5963160109).
 *
 *   press `agent-question-assumption:<from>><to>` → the link is RE-READ from the stored graph (never trusted from the
 *   chip) and must be an OPEN assumption: Olumi's unconfirmed size (`linkSizing`: `olumi_estimate` or `placeholder`, the
 *   ONE reader) on a link that reaches the goal → the Widen turn's ONE forced `propose_new_option` call, told the link →
 *   the gate (Widen's checks, plus CH-COUNT: exactly ONE option, and CH-OTHER-MECHANISM) INSIDE the door → ONE held card,
 *   or the question's fallback and nothing stored.
 *
 * ⛔ A PROPOSAL, NEVER TRUTH: nothing is written until the user presses the existing approve chip; the levels stay
 * Olumi's estimates (`user_text: ''`, the Widen wrapper in the route); and the questioned link itself is NEVER rewritten
 * here — it stays explicit and unresolved until the user sizes it through its own door.
 * ⛔ "GENUINELY DIFFERENT" IS GRAPH STRUCTURE, NEVER WORDING (DL 5963160109): every factor the option changes must reach
 * the goal with the questioned link REMOVED, and none may be the link's own source.
 */
export const QUESTION_PRESS_PREFIX = 'agent-question-assumption:';
/** The press label (DL 5963160109: "Challenge this" stays SCI-DEEP's). */
export const QUESTION_PRESS_LABEL = 'Question this assumption';
/** The card's decline: its offered id is bound to the exact held proposal and withdraws it without a model call. */
export const QUESTION_KEEP_CHIP = {
  id: 'agent-question-keep',
  label: 'Keep my options',
  message: 'Keep my options as they are.',
} as const satisfies SuggestedAction;

/** The link a question names, by its stored endpoints, and whose open size it is (re-read from the graph). */
export interface QuestionedLink {
  readonly from: string;
  readonly to: string;
  readonly from_label: string;
  readonly to_label: string;
  readonly goal_id: string;
  readonly goal_label: string;
  readonly sizing: 'olumi_estimate' | 'placeholder';
}

/** The ONE press for a stored link. Node ids never contain `>` (`NODE_ID_PATTERN` `[a-z0-9_:-]`), so the id is unambiguous. */
export function challengePressFor(from: string, to: string): SuggestedAction {
  return { id: `${QUESTION_PRESS_PREFIX}${from}>${to}`, label: QUESTION_PRESS_LABEL, message: `${QUESTION_PRESS_LABEL}.` };
}

const NODE_ID = /^[a-z0-9_:-]+$/;
/** The endpoints a press names, or null when it is not a question press. Shape only; the graph decides the rest. */
export function questionedLinkOf(chipId: unknown): { readonly from: string; readonly to: string } | null {
  if (typeof chipId !== 'string' || !chipId.startsWith(QUESTION_PRESS_PREFIX)) return null;
  const parts = chipId.slice(QUESTION_PRESS_PREFIX.length).split('>');
  return parts.length === 2 && NODE_ID.test(parts[0]!) && NODE_ID.test(parts[1]!) ? { from: parts[0]!, to: parts[1]! } : null;
}

/** The goal the graph names: `goal_node_id` when it is a goal node, else the ONE goal node; undefined otherwise. */
function goalOf(raw: unknown, g: Graph): Rec | undefined {
  const named = rec(raw)?.goal_node_id;
  const goals = g.nodes.filter((n) => n.kind === 'goal');
  if (typeof named === 'string') return goals.find((n) => n.id === named);
  return goals.length === 1 ? goals[0] : undefined;
}

/** Bidirected links express co-movement; a probability-zero link cannot carry a causal path. */
const causalEdge = (e: Rec): boolean => e.edge_type !== 'bidirected' && e.exists_probability !== 0;

/** The exact held proposal declined by a typed Keep press; words alone withdraw nothing. */
export function keptProposalOf(chipId: unknown): string | undefined {
  if (typeof chipId !== 'string' || !chipId.startsWith(`${QUESTION_KEEP_CHIP.id}:`)) return undefined;
  const id = chipId.slice(QUESTION_KEEP_CHIP.id.length + 1);
  return /^gmh_[0-9a-f]{12}$/.test(id) ? id : undefined;
}

/** Directed reachability over the stored links, optionally with ONE link removed. */
function reaches(g: Graph, start: string, target: string, without?: { readonly from: string; readonly to: string }): boolean {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (at === target) return true;
    for (const e of g.edges) {
      if (!causalEdge(e) || e.from !== at || (without !== undefined && e.from === without.from && e.to === without.to)) continue;
      const next = String(e.to);
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return false;
}

/**
 * The OPEN assumption at this stored link, or undefined: exactly one link with these endpoints, its size Olumi's and
 * unconfirmed (`linkSizing`), both ends labelled, and its target on the way to the goal. Read off the stored graph only.
 */
export function openAssumptionOf(graph: unknown, from: string, to: string): QuestionedLink | undefined {
  const g = graphOf(graph);
  const links = g.edges.filter((e) => e.from === from && e.to === to);
  if (links.length !== 1 || !causalEdge(links[0]!)) return undefined;
  const sizing = linkSizing(links[0]);
  if (sizing !== 'olumi_estimate' && sizing !== 'placeholder') return undefined;
  const goal = goalOf(graph, g);
  const goalId = typeof goal?.id === 'string' ? goal.id : undefined;
  const goalLabel = labelOf(goal);
  const fromLabel = labelOf(g.nodes.find((n) => n.id === from));
  const toLabel = labelOf(g.nodes.find((n) => n.id === to));
  if (goalId === undefined || goalLabel === null || fromLabel === null || toLabel === null || !reaches(g, to, goalId)) return undefined;
  return { from, to, from_label: fromLabel, to_label: toLabel, goal_id: goalId, goal_label: goalLabel, sizing };
}

/** CH-OTHER-MECHANISM for ONE factor an option changes: not the link's source, and still reaches the goal without it. */
export function actsWithout(g: Graph, factorId: string, q: QuestionedLink): boolean {
  return factorId !== q.from && reaches(g, factorId, q.goal_id, q);
}

const linkWords = (q: QuestionedLink): string => `${quote(q.from_label)} → ${quote(q.to_label)}`;
const whoseSize = (q: QuestionedLink): string =>
  q.sizing === 'placeholder' ? 'nobody has sized it yet' : 'its size is Olumi’s estimate, and nobody has confirmed it';

function questionDirective(q: QuestionedLink, existing: readonly string[], factorLabels: readonly string[]): string {
  return [
    `METHOD TURN: the user asked Olumi to question one assumption in their model: the link ${linkWords(q)}; ${whoseSize(q)}. `
      + 'Call propose_new_option exactly once, with exactly ONE option (`label` + `acts_on`). The user approves the change '
      + 'before anything is added.',
    `The goal is ${quote(q.goal_label)}.`,
    ...(existing.length > 0 ? ['The options already in the model, and the factors each one changes (never propose any of these again):', ...existing] : []),
    `The model's factors (use these exact labels in acts_on, and no others): ${factorLabels.join(', ')}.`,
    `The option must reach the goal through a DIFFERENT mechanism, one that does not depend on that link: it must not change `
      + `${quote(q.from_label)}, and every factor it changes must affect ${quote(q.goal_label)} without going through ${linkWords(q)}. `
      + 'An option that only works through that link is refused. Add no new factors. Name the option in 6 words or fewer, in plain words.',
    'EVERY factor the option changes needs a level: your own estimate (estimate: true, with a basis the user can check), in '
      + 'the factor’s own units and within its range. An option whose levels you cannot estimate is not suggested. Never '
      + 'present a level as the user’s figure, and put no figure in the option’s name.',
    'Put why it might do better, whichever way that link turns out, in `rationale`, in one or two plain sentences.',
    ...POLICY.method_turns.shared.never.map((rule) => `Never: ${rule}.`),
  ].join('\n');
}

/** The card's first line: WHICH assumption this option answers (typed labels only), so the stored answer row says it. */
export function questionHeadline(q: QuestionedLink): string {
  return `Your options rest partly on the link ${linkWords(q)}: ${whoseSize(q)}. Here is a way to reach ${quote(q.goal_label)} that does not rely on it. The link itself stays as it is.`;
}

export function questionFallbackReply(q: QuestionedLink): string {
  return `I couldn’t find a way to reach ${quote(q.goal_label)} that does not rely on the link ${linkWords(q)}, so nothing was changed. `
    + 'That link is still an open assumption: you can give your own view of it, or name another lever.';
}

/**
 * ⭐⭐ S-C MODEL WIDENING — ONE DOOR, ONE ENTRY PER TARGET (DL 0fd71f 7 Oct; Paul: "I don't want patches"; RC
 * `method_turns.RC-WIDEN`: "Each Add lands as ONE change card on the item's refs … propose_new_risk for risks").
 *
 *   press (by identity: `widenTargetOf`) → the target's readback → ONE model call → typed candidates → the target's
 *   identity gate → a DETERMINISTIC reply (the named method, ≤3 items, each naming what it hits) + one Add press per
 *   item + 'Something else'. NOTHING IS STORED. Add → no model call → the target's existing door → ONE held card → the
 *   existing approve chip. Options keep their one-card door above (target `options`); risks are target `risks`.
 *
 * ⛔ WHY A CHOICE FIRST, THEN ONE CARD (approval-chips.ts ONE_CHANGE_PER_APPROVAL): one approval carries one change and
 * every hold is pinned to the graph it was made on, so three held risks could never all be approved. Add is the choice.
 * ⛔ NEVER INERT (D-09, Paul's served "Overlapping costs": no parents, valued 0, moved no figure): every risk is linked
 * FROM a factor that an option the user has actually changes (or a named factor), and INTO the goal or an outcome.
 * ⛔ ONE SHARED PRESS ID (D-11 diagnosis): DGAI's pre-mortem worksheet "Add this as a risk" sends `agent-next-suggest-risks`
 * with its OWN "Prepare one risk called …" message (premortem.ts `risk_request`), an ordinary Agent turn. The risks press is
 * therefore the id AND this exact server-authored message; the canvas "+" sends its own typed id (`ask:risks`).
 */
export type WidenTarget = 'options' | 'risks' | 'factors';

/** The W6 press (RC-WIDEN target risks, primary action "Suggest risks"), offered by `nextStepsFromGuidance`. */
export const SUGGEST_RISKS_CHIP = {
  id: 'agent-next-suggest-risks',
  label: 'Suggest risks',
  message: "Suggest risks I haven't considered.",
} as const satisfies SuggestedAction;
/** The canvas "+" chooser's Risk press (DGAI `WhatElseChooser.tsx` → `askAi.ts` `ask:risks`). */
export const CANVAS_RISKS_PRESS_ID = 'ask:risks';


/** Which target a press opens, by identity; null for every other press (including the pre-mortem's risk request). */
export function widenTargetOf(chipId: unknown, message?: unknown): WidenTarget | null {
  if (chipId === CANVAS_FACTORS_PRESS.id) return 'factors';
  if (isWidenPress(chipId)) return 'options';
  if (chipId === CANVAS_RISKS_PRESS_ID) return 'risks';
  if (chipId === SUGGEST_RISKS_CHIP.id && typeof message === 'string' && message.length <= 200
    && foldWords(message) === foldWords(SUGGEST_RISKS_CHIP.message)) return 'risks';
  return null;
}

/**
 * The method that generates risks: ONE registry row (Science 393023 ruling, 7 Oct 10:3xZ, `science-risk-method-ruling-
 * 20261007.md`). Assumption-Based Planning (Dewar 2002; Dewar et al. 1993, RAND MR-114-A): what each option RELIES ON in
 * the model, how that could fail, and an early-warning sign ("Watch for", ABP's signpost). Coverage from a risk prompt
 * list (IEC 31010:2019 checklists; Hillson 2002 RBS). Structured practice, not a validated forecaster: never "the real
 * risks". The pre-mortem (prospective hindsight) stays a separate method.
 */
export const RISK_METHOD = {
  id: 'assumption_based_planning',
  categories: ['people', 'timing', 'cost', 'dependency', 'external'] as const,
  line: 'I checked what each option relies on and how that could fail, across people, timing, cost, dependencies and outside events (assumption-based planning).',
} as const;
export type RiskCategory = (typeof RISK_METHOD.categories)[number];
const CATEGORY_WORDS: Readonly<Record<RiskCategory, string>> = {
  people: 'people', timing: 'timing', cost: 'cost', dependency: 'dependency', external: 'outside events',
};
/** The most risks one press suggests (RC WD-COUNT). */
export const RISK_MAX_ITEMS = 3;
/** The Add press: this prefix + a 16-hex hash of its exact message (the research chip's binding, `public-research.ts`). */
export const WIDEN_ADD_PREFIX = 'agent-widen-add:';

/** ⭐ THE STANDING GAP SIGNAL (S-C / S-E): typed, deterministic, from model state; ONE question at most. */
export type ModelGap =
  | { readonly kind: 'goal_target_missing'; readonly goal_id: string; readonly deadline_known: boolean; readonly question: string }
  /** A chance-of-event goal with no date: S1's ONE question, by its own function (never a target ask, #2742). */
  | { readonly kind: 'deadline_missing'; readonly goal_id: string; readonly question: string }
  | { readonly kind: 'budget_without_limit'; readonly question: string };

const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A budget the user stated in words: "budget" within one clause of a money figure (bounded runs, no nesting). */
const MONEY = String.raw`(?:[£$€][ \t]{0,2}\d[\d,.]{0,15}(?:k|m|bn)?|\d[\d,.]{0,15}[ \t]{0,2}(?:k|m|bn)?[ \t]{0,2}(?:pounds|dollars|euros|gbp|usd|eur)\b)`;
const MONEY_UNIT = /[£$€]|\b(?:gbp|usd|eur|pounds?|dollars?|euros?|budget|cost|spend|salary|salaries)\b/iu;
export const STATED_BUDGET = new RegExp(String.raw`\bbudget\b[^.?!\n]{0,60}?${MONEY}|${MONEY}[^.?!\n]{0,60}?\bbudget`, 'iu');

/**
 * The model's most serious gap, or null. Goal first (D-01: no target means no option can have a chance of meeting it),
 * then a budget the user stated that no limit holds (D-07). Never a question the model already answers.
 */
export function modelGapOf(graph: unknown, userWords: string = ''): ModelGap | null {
  const raw = rec(graph);
  const g = graphOf(graph);
  const goal = goalOf(graph, g);
  // ⛔ THE GOAL-KIND REGISTRY DECIDES WHAT MAY BE ASKED (#2742 S1; PL/Codex 5443200599): a chance goal takes no target
  // quantity — its one question is S1's deadline ask, byte for byte, and nothing once it holds its date.
  const chance = goal !== undefined && goalKindOf(goal) === 'chance_of_event';
  if (chance && typeof goal.id === 'string' && labelOf(goal) !== null && goalDeadlineOf(goal) === undefined) {
    return { kind: 'deadline_missing', goal_id: goal.id, question: chanceGoalDeadlineAsk(labelOf(goal)!) };
  }
  if (!chance && raw !== undefined && goal !== undefined && typeof goal.id === 'string' && labelOf(goal) !== null
    && statedGoalTargetOf(raw, goal) === null) {
    const rows = Array.isArray(raw.goal_constraints) ? raw.goal_constraints.map(rec) : [];
    const horizon = rec(goal.goal_horizon);
    const deadlineKnown = rows.some((r) => r?.node_id === goal.id && rec(r?.deadline_metadata) !== undefined)
      || typeof horizon?.deadline === 'string' || finiteNum(horizon?.months);
    return {
      kind: 'goal_target_missing', goal_id: goal.id, deadline_known: deadlineKnown,
      question: deadlineKnown
        ? `One gap: ${quote(labelOf(goal)!)} has no target yet. What would count as meeting it?`
        : `One gap: ${quote(labelOf(goal)!)} has no target or deadline yet. What would count as meeting it, and by when?`,
    };
  }
  // Only a MONEY limit answers a stated budget (Codex r1 P2: a hiring-count cap is not the budget).
  // An explicit unit decides (Codex r2 P2: "Budget reviewers" in people is not money); a label only when no unit is stored.
  const unitOf = (r: Rec): string => [r.unit, rec(rec(g.nodes.find((n) => n.id === r.node_id))?.observed_state)?.unit, labelOf(g.nodes.find((n) => n.id === r.node_id))]
    .find((u): u is string => typeof u === 'string' && u.trim() !== '') ?? '';
  const moneyLimits = raw !== undefined && Array.isArray(raw.goal_constraints)
    ? raw.goal_constraints.map(rec).filter((r): r is Rec => r !== undefined && (goal === undefined || r.node_id !== goal.id) && MONEY_UNIT.test(unitOf(r))) : [];
  if (moneyLimits.length === 0 && userWords.length <= 20_000 && STATED_BUDGET.test(userWords)) {
    return { kind: 'budget_without_limit',
      question: 'One gap: you mentioned a budget, but the model has no limit for it yet. What is the most you can spend?' };
  }
  return null;
}

/** A risk suggestion that passed the gate: every reference is a stored node, by id, with its exact label. */
export interface RiskSuggestion {
  readonly label: string;
  readonly category: RiskCategory;
  readonly hits: { readonly id: string; readonly label: string; readonly kind: 'option' | 'factor' };
  readonly through: { readonly id: string; readonly label: string; readonly direction: 'positive' | 'negative' };
  readonly affects: { readonly id: string; readonly label: string; readonly direction: 'positive' | 'negative' };
  /** What the option relies on (ABP's load-bearing assumption), ≤12 words. */
  readonly relies_on: string;
  /** ABP's signpost: the early sign, ≤8 words (the pre-mortem's "Watch for" vocabulary). */
  readonly watch_for: string;
  /** A factor no option changes: the risk affects every option alike, so it cannot change the comparison (offered last). */
  readonly shared: boolean;
  readonly press: SuggestedAction;
}

/** A risks press that runs: ONE tool-less model call, then the gate. */
export interface RunRisksWidenTurn {
  readonly kind: 'run_risks';
  readonly target: 'risks';
  readonly goal_label: string;
  readonly directive: string;
  readonly graph: Graph;
  /** The user's own options and the factors each one CHANGES (moves against the status quo; repair edges excluded). */
  readonly options: readonly { readonly id: string; readonly label: string; readonly changes: readonly string[] }[];
  readonly gap: ModelGap | null;
}

const RISK_TAG = 'risk_suggestions';
const nodeId = z.string().min(1).max(160);
const riskCandidateSchema = z.object({
  label: z.string().trim().min(1).max(60),
  category: z.enum(RISK_METHOD.categories),
  hits_id: nodeId,
  through_id: nodeId,
  through_direction: z.enum(['positive', 'negative']),
  affects_id: nodeId,
  direction: z.enum(['positive', 'negative']),
  relies_on: z.string().trim().min(1).max(120),
  watch_for: z.string().trim().min(1).max(80),
}).strict();

/** Olumi-authored words a suggestion may never carry (after the words of the model's own labels are masked out). */
const AUTHORED_BAN = /%|\b(?:most likely|likely|likelihood|chance|probability|probable|odds|best|winners?|winning|recommend\w*|leads?|leader\w*|ahead|beats?|placeholder|node|edge)\b/iu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
/**
 * A word the user's own model uses ("Tech Lead", "Q3 revenue") is theirs, not Olumi's ranking word or figure: masked by
 * WORD before the ban and the figure test. Every other figure or banned word refuses the item.
 */
const DURATION = /\b\d{1,3}[ \t]{0,2}(?:days?|weeks?|months?|quarters?|years?)\b|\b(?:day|week|month|quarter)[ \t]{1,2}\d{1,2}\b/giu;
function bannedAfterMasking(text: string, labels: readonly string[], durations = false): boolean {
  const theirs = new Set(labels.flatMap((l) => foldWords(l).match(WORD) ?? []));
  // A signpost may name a time ("no offer by week 4"): durations only, as the pre-mortem's PM-NO-FIGURES exempts them.
  const timed = durations ? foldWords(text).replace(DURATION, ' ') : foldWords(text);
  const masked = timed.replace(WORD, (w) => (theirs.has(w) ? ' ' : w));
  return AUTHORED_BAN.test(masked) || /\d/u.test(masked);
}

/** The risks turn for a readback: unavailable without a readable model or a goal, else ONE gated model call. Total. */
export function risksTurnFromSignals(s: TurnSignals, graph: unknown, userWords: string = ''): RunRisksWidenTurn | WidenUnavailableTurn {
  if (s['model.goal_present'] !== true) return { ...unavailable('no_goal'), reply: RISKS_UNAVAILABLE.no_goal };
  const g = graphOf(graph);
  const goal = goalOf(graph, g);
  if (goal === undefined || labelOf(goal) === null) return { ...unavailable('no_goal'), reply: RISKS_UNAVAILABLE.no_goal };
  const goalLabel = labelOf(goal)!;
  const sq = s['model.status_quo_option_id'];
  const labels = s['model.option_labels'];
  const options = s['model.non_sq_option_ids'].map((id) => ({
    id, label: labels[id] ?? labelOf(g.nodes.find((n) => n.id === id)) ?? id,
    changes: [...existingLevers(g, id, sq)].filter(([, m]) => m !== 'unchanged').map(([f]) => f),
  }));
  const pick = (n: Rec): { id: string; label: string } => ({ id: String(n.id), label: labelOf(n) ?? String(n.id) });
  const factors = g.nodes.filter((n) => n.kind === 'factor' && labelOf(n) !== null).map(pick);
  const destinations = g.nodes.filter((n) => (n.kind === 'goal' || n.kind === 'outcome') && labelOf(n) !== null).map(pick);
  const risks = g.nodes.filter((n) => n.kind === 'risk' && labelOf(n) !== null).map((n) => labelOf(n)!);
  const directive = [
    'METHOD TURN: the user asked Olumi to suggest risks they have not considered. Do not write prose. Reply with ONLY '
      + `<${RISK_TAG}>JSON array</${RISK_TAG}>, nothing before or after it. The server writes every word the user sees.`,
    'METHOD: assumption-based planning. For each option below, find what it RELIES ON in the model (a factor it changes) and '
      + `how that could fail. Use the prompt list (${RISK_METHOD.categories.join(', ')}) for coverage, and keep up to ${RISK_MAX_ITEMS} `
      + 'risks, each from a DIFFERENT class. Risks on what the options DIFFER on come first; a risk on a factor no option changes '
      + 'affects every option alike, so offer it only if there is room. Ground each in the brief, the conversation or the model.',
    `Each item: {"label": a new risk name, 6 words or fewer, no figures; "category": one of ${RISK_METHOD.categories.join('|')}; `
      + '"hits_id": the id of the option it hits (or, for an assumption every option shares, the id of a factor NO option '
      + 'changes); "through_id": the id of a factor which that option CHANGES (listed under it) and which the risk works through, '
      + 'or the same factor id when hits_id is a factor; "through_direction": "positive" when more of that factor makes the risk '
      + 'more severe, else "negative"; "affects_id": the id of the goal or an outcome the risk would hurt; "direction": '
      + '"negative" when the risk lowers it, "positive" when it raises it; "relies_on": what the option relies on, 12 words or '
      + 'fewer, starting with a verb or noun (e.g. "filling both roles quickly"); "watch_for": the early sign, 8 words or fewer}.',
    `The goal: ${JSON.stringify({ id: String(goal.id), label: goalLabel })}.`,
    `Goal and outcomes (affects_id): ${JSON.stringify(destinations)}.`,
    `The user's options and the factors each one changes: ${JSON.stringify(options.map((o) => ({ id: o.id, label: o.label,
      changes: o.changes.map((f) => ({ id: f, label: labelOf(g.nodes.find((n) => n.id === f)) ?? f })) })))}.`,
    `All factors: ${JSON.stringify(factors)}.`,
    ...(risks.length > 0 ? [`Risks already in the model (never suggest these again): ${JSON.stringify(risks)}.`] : []),
    'Use only these ids. Never write a probability, percentage, figure, likely, chance, best, recommend, winner, leads or ahead.',
  ].join('\n');
  return { kind: 'run_risks', target: 'risks', goal_label: goalLabel, directive, graph: g, options, gap: modelGapOf(graph, userWords) };
}

const RISKS_UNAVAILABLE: Readonly<Record<'no_goal' | 'model_unread', string>> = {
  no_goal: 'I can’t suggest risks yet because your model has no goal for them to threaten. Add the goal first.',
  model_unread: 'I can’t suggest risks right now because I couldn’t read your model. Try again in a moment.',
};

/** The model call's typed candidates, or undefined when the reply carries none. A malformed appendix is no candidates. */
export function readRiskCandidates(draft: string): unknown {
  const open = `<${RISK_TAG}>`;
  const close = `</${RISK_TAG}>`;
  const start = draft.indexOf(open);
  const end = draft.lastIndexOf(close);
  if (start < 0 || end < start) return undefined;
  try { return JSON.parse(draft.slice(start + open.length, end)) as unknown; } catch { return undefined; }
}

/** Safe to log verbatim: indices and clause ids only, never labels or words. */
export interface RiskGateResult {
  readonly kept: readonly RiskSuggestion[];
  readonly dropped: readonly { readonly index: number; readonly failed: readonly string[] }[];
}

/**
 * RC-WIDEN's checks for target risks, BY IDENTITY, before anything is offered. Clauses: RK-SCHEMA · RK-NO-DUP (a new
 * name: no node and no earlier item has it) · RK-HITS (a user option, never the status quo, or a factor) · RK-THROUGH
 * (a factor that option really changes, uniquely named) · RK-AFFECTS (the goal or an outcome, uniquely named) ·
 * RK-DISTINCT (one per category) · RK-WORDS (no figure, no banned word, no question, quotable) · RK-DOOR (the door's own
 * builder accepts it, run purely) · RK-COUNT (at most three kept).
 */
export function riskGate(turn: RunRisksWidenTurn, candidates: unknown): RiskGateResult {
  const g = turn.graph;
  const byId = new Map(g.nodes.map((n) => [String(n.id), n] as const));
  const allLabels = g.nodes.map(labelOf).filter((l): l is string => l !== null);
  const uniqueLabel = (n: Rec | undefined): string | null => {
    const l = labelOf(n);
    return l !== null && allLabels.filter((x) => doorNorm(x) === doorNorm(l)).length === 1 && !/[‘’\n]/u.test(l) && l.length <= 200 ? l : null;
  };
  const kept: RiskSuggestion[] = [];
  const dropped: { index: number; failed: string[] }[] = [];
  const raw = Array.isArray(candidates) ? candidates : [];
  for (const [index, item] of raw.entries()) {
    const failed: string[] = [];
    const parsed = riskCandidateSchema.safeParse(item);
    if (!parsed.success) { dropped.push({ index, failed: ['RK-SCHEMA'] }); continue; }
    const c = parsed.data;
    if (allLabels.some((l) => sameLabel(l, c.label)) || kept.some((k) => sameLabel(k.label, c.label))) failed.push('RK-NO-DUP');
    const hitNode = byId.get(c.hits_id);
    const option = turn.options.find((o) => o.id === c.hits_id);
    // A factor stands in for "every option" ONLY when no option changes it (Science: a shared assumption, offered last).
    const shared = option === undefined && hitNode?.kind === 'factor' && !turn.options.some((o) => o.changes.includes(c.hits_id));
    const hitsKind = option !== undefined ? 'option' : shared ? 'factor' : null;
    if (hitsKind === null) failed.push('RK-HITS');
    const through = byId.get(c.through_id);
    const throughLabel = through?.kind === 'factor' ? uniqueLabel(through) : null;
    if (throughLabel === null || (hitsKind === 'option' && !option!.changes.includes(c.through_id))
      || (hitsKind === 'factor' && c.through_id !== c.hits_id)) failed.push('RK-THROUGH');
    const affects = byId.get(c.affects_id);
    const affectsLabel = affects?.kind === 'goal' || affects?.kind === 'outcome' ? uniqueLabel(affects) : null;
    if (affectsLabel === null) failed.push('RK-AFFECTS');
    if (kept.some((k) => k.category === c.category)) failed.push('RK-DISTINCT');
    const words = (t: string): number => t.split(/\s+/u).filter(Boolean).length;
    if (words(c.label) > 6 || words(c.relies_on) > 12 || words(c.watch_for) > 8 || /[‘’\n]/u.test(c.label)
      || [c.label, c.relies_on, c.watch_for].some((t) => /[?\n]/u.test(t))
      || bannedAfterMasking(c.label, []) || bannedAfterMasking(c.relies_on, allLabels, true)
      || bannedAfterMasking(c.watch_for, allLabels, true)) failed.push('RK-WORDS');
    if (failed.length === 0) {
      const built = buildAddRiskTransaction({ risk: { label: c.label }, links: [
        { from_id: c.through_id, effect_direction: c.through_direction },
        { to_id: c.affects_id, effect_direction: c.direction },
      ] }, { nodes: g.nodes as never, edges: g.edges as never });
      if (!built.matched) failed.push('RK-DOOR');
    }
    if (failed.length === 0 && kept.length >= RISK_MAX_ITEMS) failed.push('RK-COUNT');
    if (failed.length > 0) { dropped.push({ index, failed }); continue; }
    const s: Omit<RiskSuggestion, 'press'> = {
      label: c.label.trim(), category: c.category,
      hits: { id: c.hits_id, label: hitsKind === 'option' ? option!.label : throughLabel!, kind: hitsKind! },
      through: { id: c.through_id, label: throughLabel!, direction: c.through_direction },
      affects: { id: c.affects_id, label: affectsLabel!, direction: c.direction },
      relies_on: c.relies_on.replace(/[.!]+$/u, ''), watch_for: c.watch_for.replace(/[.!]+$/u, ''), shared: hitsKind === 'factor',
    };
    kept.push({ ...s, press: riskAddPressFor(s) });
  }
  // Science: what the options DIFFER on first; a shared assumption cannot change the comparison, so it comes last.
  return { kept: [...kept.filter((k) => !k.shared), ...kept.filter((k) => k.shared)], dropped };
}

/** The Add press's message: the user's own words in the transcript, naming the risk, what it hits and its refs by label. */
function riskAddMessage(s: Pick<RiskSuggestion, 'label' | 'hits' | 'through' | 'affects'>): string {
  const target = s.hits.kind === 'option' ? `to ${quote(s.hits.label)}` : 'for every option';
  return `Add the risk ${quote(s.label)} ${target}: driven by ${s.through.direction === 'positive' ? 'more' : 'less'} ${quote(s.through.label)}, `
    + `it would ${s.affects.direction === 'negative' ? 'lower' : 'raise'} ${quote(s.affects.label)}.`;
}
/**
 * The press id binds the message AND the node identities it was minted on (Codex r1 P1 on #2744): a label that later
 * names another node (a rename plus a new node with the old name) recomputes to a different id and is refused.
 */
const addPressId = (message: string, ids: readonly string[]): string =>
  `${WIDEN_ADD_PREFIX}${createHash('sha256').update(JSON.stringify([message, ...ids]), 'utf8').digest('hex').slice(0, 16)}`;

export function riskAddPressFor(s: Pick<RiskSuggestion, 'label' | 'hits' | 'through' | 'affects'>): SuggestedAction {
  const message = riskAddMessage(s);
  return { id: addPressId(message, [s.hits.id, s.through.id, s.affects.id]), label: `Add ${quote(s.label)}`, message };
}

export function isWidenAddPressId(id: unknown): boolean {
  return typeof id === 'string' && /^agent-widen-add:[0-9a-f]{16}$/u.test(id);
}

export type WidenAddCall = { readonly tool: 'propose_new_risk'; readonly args: {
  label: string; rationale: string;
  /** The press IS the whole request (server-owned): the door's own typed reply composes it (`composeProposalReply`). */
  whole_request: true;
  affects: { target_label: string; direction: 'positive' | 'negative' }[];
  caused_by: { factor_label: string; direction: 'positive' | 'negative' }[];
} };

const ADD_PREFIX_WORDS = 'Add the risk ‘';
const DIRECTIONS = ['positive', 'negative'] as const;

/**
 * The door call an Add press asks for, re-checked against the model AS IT IS NOW, or null (the route then refuses it
 * deterministically: an Add press never falls through to ordinary generation, Codex r1 P1).
 *
 * NO PARSING of the user-visible words (Codex r2 P1: a label's own ’ broke a capture): the press is RECONSTRUCTED. Every
 * (option or "every option", factor, goal/outcome, direction pair) the Suggest turn could offer on THIS readback — the
 * same scope, `risksTurnForReadback` (Codex r2 P2) — is minted again with `riskAddPressFor`; the press stands only when
 * one of them is byte-identical in message AND id (the id binds the node ids, Codex r1 P1). Then the attachment is
 * re-checked: the option still changes the factor, or (shared) no option in scope does.
 */
export function widenAddCallOf(chipId: unknown, message: unknown, rb: MethodReadback): WidenAddCall | null {
  if (!isWidenAddPressId(chipId) || typeof message !== 'string' || message.length > 600) return null;
  const m = message.trim();
  if (!m.startsWith(ADD_PREFIX_WORDS)) return null;
  const end = m.indexOf('’', ADD_PREFIX_WORDS.length);
  const label = end < 0 ? '' : m.slice(ADD_PREFIX_WORDS.length, end);
  if (label === '' || label.length > 60) return null;
  const turn = risksTurnForReadback(rb);
  if (turn.kind !== 'run_risks') return null;
  const g = turn.graph;
  const uniquelyNamed = (n: Rec): boolean => labelOf(n) !== null && g.nodes.filter((x) => doorNorm(x.label) === doorNorm(n.label)).length === 1;
  const factors = g.nodes.filter((n) => n.kind === 'factor' && uniquelyNamed(n));
  const destinations = g.nodes.filter((n) => (n.kind === 'goal' || n.kind === 'outcome') && uniquelyNamed(n));
  const hits: (RunRisksWidenTurn['options'][number] | null)[] = [...turn.options, null];
  for (const option of hits) {
    for (const f of factors) {
      const fid = String(f.id);
      // The attachment, re-checked now: the option still changes the factor; a shared factor is changed by no option in scope.
      if (option !== null ? !option.changes.includes(fid) : turn.options.some((o) => o.changes.includes(fid))) continue;
      for (const a of destinations) {
        for (const td of DIRECTIONS) {
          for (const ad of DIRECTIONS) {
            const minted = {
              label,
              hits: option !== null ? { id: option.id, label: option.label, kind: 'option' as const } : { id: fid, label: labelOf(f)!, kind: 'factor' as const },
              through: { id: fid, label: labelOf(f)!, direction: td },
              affects: { id: String(a.id), label: labelOf(a)!, direction: ad },
            };
            // Words first (cheap), then the id over the node ids.
            if (riskAddMessage(minted) !== m || riskAddPressFor(minted).id !== chipId) continue;
            return { tool: 'propose_new_risk', args: {
              label,
              affects: [{ target_label: labelOf(a)!, direction: ad }],
              caused_by: [{ factor_label: labelOf(f)!, direction: td }],
              rationale: 'Olumi suggested this risk (assumption-based planning); the user chose to add it.',
              whole_request: true,
            } };
          }
        }
      }
    }
  }
  return null;
}

/**
 * The Add press HELD its card but the door's typed reply could not be composed: say what is held, never the refusal
 * (served sc-plus-1, 7 Oct 16:58Z: `held: true`, yet the user read "I couldn't prepare that risk").
 */
export function riskHeldReply(call: WidenAddCall): string {
  const a = call.args;
  return `I’ve prepared this change: add the risk ${quote(a.label)}, driven by ${a.caused_by[0]!.direction === 'positive' ? 'more' : 'less'} `
    + `${quote(a.caused_by[0]!.factor_label)}; it would ${a.affects[0]!.direction === 'negative' ? 'lower' : 'raise'} ${quote(a.affects[0]!.target_label)}. `
    + 'How strongly is not known yet. Nothing is added until you approve it.';
}

/** The Add press refused at the door: said plainly, nothing held, and the way back. */
export const RISK_ADD_REFUSED_REPLY =
  'I couldn’t prepare that risk as a change, so nothing was added. The model may have changed since I suggested it. Press Suggest risks for a fresh set.';

const COUNT_WORDS = ['', 'One risk', 'Two risks', 'Three risks'] as const;

/** RC's deterministic fallback for risks: one question, and 'Talk it through'. */
export function risksFallbackReply(turn: Pick<RunRisksWidenTurn, 'goal_label'>): string {
  return `What else could stop ${quote(turn.goal_label)} from working out? For example, something about people, timing, cost, a dependency, or something outside your control.`;
}

export interface SettledRisksTurn {
  readonly reply: string;
  readonly offered: number;
  readonly actions: readonly SuggestedAction[];
  readonly gate: RiskGateResult;
}

/**
 * The reply, written by the server from the gate's typed items only (Paul 7 Oct: one structure, deterministic): the
 * named method, then one bullet per item naming what it hits and what it would hurt, then the line that nothing is added,
 * then AT MOST ONE gap question. Chips: one Add per item, then 'Something else'. None passed → RC's fallback.
 */
export function settleRisksTurn(turn: RunRisksWidenTurn, draft: string): SettledRisksTurn {
  const gate = riskGate(turn, readRiskCandidates(draft));
  if (gate.kept.length === 0) {
    return { reply: risksFallbackReply(turn), offered: 0, actions: [TALK_IT_THROUGH_CHIP], gate };
  }
  // Science's item shape: who relies on what · the risk, its class and the factor it works through · the signpost.
  const lines = gate.kept.map((r) => r.shared
    ? `- Every option relies on ${r.relies_on}. Risk: ${quote(r.label)} (${CATEGORY_WORDS[r.category]}), through ${quote(r.through.label)}; it affects every option alike. Watch for: ${r.watch_for}.`
    : `- ${quote(r.hits.label)} relies on ${r.relies_on}. Risk: ${quote(r.label)} (${CATEGORY_WORDS[r.category]}), through ${quote(r.through.label)}. Watch for: ${r.watch_for}.`);
  const reply = [
    `${COUNT_WORDS[gate.kept.length]} you haven’t mapped yet.`,
    RISK_METHOD.line,
    ...lines,
    'Possible risks, not established facts. Nothing is added until you choose one and approve the change.',
    ...(turn.gap !== null ? [turn.gap.question] : []),
  ].join('\n');
  return { reply, offered: gate.kept.length, actions: [...gate.kept.map((r) => r.press), SOMETHING_ELSE_CHIP], gate };
}

/** The risks turn for a press, from the route's own readback (the same licence and identity projection as the options door). */
export function risksTurnForReadback(rb: MethodReadback, userWords: string = ''): RunRisksWidenTurn | WidenUnavailableTurn {
  if (rb.graph === undefined || rb.graph === null) return { ...unavailable('model_unread'), reply: RISKS_UNAVAILABLE.model_unread };
  const signals = assembleGuidanceSignals({
    request: 'method',
    explicitRequest: METHOD,
    offeredSpecific: [],
    graph: rb.graph,
    analysisState: rb.analysisState,
    analysisResult: rb.analysisResult,
    optionParticipation: rb.optionParticipation,
    ...(rb.identityEvaluated !== undefined
      ? { identityEvaluations: [...rb.identityEvaluated].map((node_id) => ({ node_id, evaluated: true })) } : {}),
    leaderLicensed: leaderLicenceFromState(rb.analysisState, rb.analysisReady) !== 'withheld',
  });
  return risksTurnFromSignals(signals, rb.graph, userWords);
}


/** P14: one typed coverage call, followed by a pure identity gate. */
export const CANVAS_FACTORS_PRESS = {
  id: 'ask:missing-factor', label: 'Suggest factors',
  message: 'What else could change how this turns out that the model doesn’t have yet?',
} as const satisfies SuggestedAction;
export const FACTOR_METHOD = {
  id: 'influence_diagram_elicitation',
  categories: ['customers and demand', 'money and price', 'people and capacity', 'time and timing',
    'how the work is done', 'outside conditions (competitors, rules, the economy)'] as const,
} as const;
export const FACTOR_MAX_ITEMS = 3;
export const FACTOR_ADD_REFUSED_REPLY =
  'I couldn’t prepare that factor as a change, so nothing was added. The model may have changed since I suggested it. Press Suggest factors for a fresh set.';
export const OLUMI_DIRECTION_BASIS = "Olumi's suggestion: the direction is Olumi's estimate from general patterns, not from your data or your words. Its strength isn't set yet.";
export interface RunFactorsWidenTurn {
  readonly kind: 'run_factors'; readonly target: 'factors'; readonly graph: Graph;
  readonly raw: unknown; readonly directive: string; readonly goal_label: string;
  readonly clickedId?: string;
}
export interface FactorSuggestion {
  readonly label: string; readonly category: string; readonly since: string;
  readonly anchor: { readonly id: string; readonly label: string };
  readonly direction: 'positive' | 'negative'; readonly press: SuggestedAction;
}
export interface FactorGateResult {
  readonly kept: readonly FactorSuggestion[];
  readonly dropped: readonly { readonly index: number; readonly failed: readonly string[] }[];
  readonly redirect?: string;
}
const factorCandidateSchema = z.object({
  label: z.string().trim().min(1).max(60), category: z.enum(FACTOR_METHOD.categories),
  anchor_id: nodeId, direction: z.enum(['positive', 'negative']), since: z.string().trim().min(1).max(120),
}).strict();
// Bounded candidate lengths precede every regex. No masking: Olumi supplies both the name and mechanism.
const COVERAGE_BAN = /\b(?:key|main|most important|top|primary|root cause|the real|the answer|best|winners?|recommend\w*|ahead|beats?|leader\w*|you missed|you forgot|your model is wrong|incomplete|all the drivers|complete|everything that matters|will|proven|research shows|likely|probably|hidden risks|unintended consequences|lever|uncontrollable)\b/iu;
function coverageWordsAllowed(label: string, since: string): boolean {
  return ![label, since].some((t) => /\p{Nd}/u.test(t) || /[%٪﹪％⁒?\n‘’]/u.test(t) || COVERAGE_BAN.test(foldWords(t)))
    && label.split(/\s+/u).length <= 6 && since.split(/\s+/u).length <= 12;
}
function uniqueCoverageAnchor(g: Graph, id: string): Rec | undefined {
  const hits = g.nodes.filter((n) => n.id === id);
  if (hits.length !== 1) return undefined;
  const n = hits[0]!; const label = labelOf(n);
  return label !== null && label.length <= 200 && !/[\n‘’]/u.test(label)
    && g.nodes.filter((x) => norm(String(x.label ?? '')) === norm(label)).length === 1 ? n : undefined;
}
export function factorsTurnForReadback(rb: MethodReadback, clickedId?: string): RunFactorsWidenTurn | WidenUnavailableTurn {
  if (rb.graph === undefined || rb.graph === null) return { ...unavailable('model_unread'),
    reply: 'I can’t suggest factors right now because I couldn’t read your model. Try again in a moment.' };
  const graph = graphOf(rb.graph); const goal = goalOf(rb.graph, graph);
  if (clickedId !== undefined) {
    const clicked = uniqueCoverageAnchor(graph, clickedId);
    if (clicked === undefined || !isNewFactorTarget(clicked as never)) return {
      kind: 'unavailable', reason: 'factor_anchor_ineligible', actions: [TALK_IT_THROUGH_CHIP],
      reply: `${quote(labelOf(graph.nodes.find((n) => n.id === clickedId)) ?? clickedId)} can’t take a new driver here. Press + on an outcome or a factor it depends on.`,
    };
    const definition = factorDefinitionRedirect(rb.graph, clickedId);
    if (definition !== undefined) return {
      kind: 'unavailable', reason: 'factor_anchor_defined', reply: definition, actions: [TALK_IT_THROUGH_CHIP],
    };
  }
  const anchors = graph.nodes.filter((n) => (clickedId === undefined || n.id === clickedId)
    && isNewFactorTarget(n as never) && uniqueCoverageAnchor(graph, String(n.id)) !== undefined);
  const directive = [
    'METHOD TURN: influence-diagram elicitation. Do not write prose. Reply with ONLY <factor_suggestions>JSON array</factor_suggestions>. The server writes every word the user sees.',
    `Return up to ${FACTOR_MAX_ITEMS} possible drivers, one per distinct category, from ${JSON.stringify(FACTOR_METHOD.categories)}.`,
    'Each item has exactly label, category, anchor_id, direction (positive or negative), since (at most twelve words). Label: at most six words. No digits in label or since. No rankings, certainty, diagnosis or completeness claims.',
    `Use an exact anchor_id from these nodes; new factor links INTO that node: ${JSON.stringify(anchors.map((n) => ({ id: n.id, label: n.label, definition: factorDefinitionRedirect(rb.graph, String(n.id)) ?? null })))}. Never drive a node fixed by a definition.`,
    `All existing labels (never repeat them): ${JSON.stringify(graph.nodes.map((n) => n.label))}.`,
  ].join('\n');
  return { kind: 'run_factors', target: 'factors', graph, raw: rb.graph, directive, goal_label: labelOf(goal) ?? 'your goal',
    ...(clickedId !== undefined ? { clickedId } : {}) };
}
function factorAddMessage(s: Pick<FactorSuggestion, 'label' | 'anchor' | 'direction'>): string {
  return `Add the factor ${quote(s.label)}: it could ${s.direction === 'positive' ? 'raise' : 'lower'} ${quote(s.anchor.label)}.`;
}
export function factorAddPressFor(s: Pick<FactorSuggestion, 'label' | 'anchor' | 'direction'>): SuggestedAction {
  const message = factorAddMessage(s);
  return { id: addPressId(message, ['factors', s.anchor.id]), label: `Add ${quote(s.label)}`, message };
}
export function factorGate(turn: RunFactorsWidenTurn, candidates: unknown): FactorGateResult {
  const kept: FactorSuggestion[] = []; const dropped: { index: number; failed: string[] }[] = [];
  let redirect: string | undefined;
  for (const [index, item] of (Array.isArray(candidates) ? candidates : []).entries()) {
    const raw = rec(item);
    if (typeof raw?.label !== 'string' || raw.label.length > 60 || typeof raw.since !== 'string' || raw.since.length > 120) {
      dropped.push({ index, failed: ['FD-SCHEMA'] }); continue;
    }
    const parsed = factorCandidateSchema.safeParse(item);
    if (!parsed.success) { dropped.push({ index, failed: ['FD-SCHEMA'] }); continue; }
    const c = parsed.data; const failed: string[] = [];
    if (turn.graph.nodes.some((n) => sameFoldedLabel(typeof n.label === 'string' ? n.label : undefined, c.label))
      || kept.some((n) => sameFoldedLabel(n.label, c.label))) failed.push('FD-NO-DUP');
    const anchor = uniqueCoverageAnchor(turn.graph, c.anchor_id);
    if (anchor === undefined || !isNewFactorTarget(anchor as never)
      || (turn.clickedId !== undefined && c.anchor_id !== turn.clickedId)) failed.push('FD-ANCHOR');
    const definition = factorDefinitionRedirect(turn.raw, c.anchor_id);
    if (definition !== undefined) { failed.push('FD-NOT-DEFINED'); redirect ??= definition; }
    if (!coverageWordsAllowed(c.label, c.since)) failed.push('FD-WORDS');
    if (kept.some((n) => n.category === c.category)) failed.push('FD-DISTINCT');
    if (failed.length === 0 && !buildAddFactorTransaction({ factors: [{ label: c.label,
      link: { to_id: c.anchor_id, effect_direction: c.direction } }] }, { nodes: turn.graph.nodes as never, edges: turn.graph.edges as never }, { kind: 'olumi_direction' }).matched) failed.push('FD-DOOR');
    if (failed.length === 0 && kept.length >= FACTOR_MAX_ITEMS) failed.push('FD-COUNT');
    if (failed.length > 0) { dropped.push({ index, failed }); continue; }
    const suggestion = { label: c.label, category: c.category, since: c.since,
      direction: c.direction, anchor: { id: c.anchor_id, label: labelOf(anchor)! } };
    kept.push({ ...suggestion, press: factorAddPressFor(suggestion) });
  }
  return { kept, dropped, ...(redirect !== undefined ? { redirect } : {}) };
}
function readCoverageCandidates(draft: string, tag: string): unknown {
  if (draft.length > 20_000) return undefined;
  const open = `<${tag}>`; const close = `</${tag}>`; const start = draft.indexOf(open); const end = draft.lastIndexOf(close);
  if (start < 0 || end < start) return undefined;
  try { return JSON.parse(draft.slice(start + open.length, end)) as unknown; } catch { return undefined; }
}
export function settleFactorsTurn(turn: RunFactorsWidenTurn, draft: string) {
  const gate = factorGate(turn, readCoverageCandidates(draft, 'factor_suggestions'));
  const lines = gate.kept.map((s) => `- ${quote(s.label)} (${s.category}): could ${s.direction === 'positive' ? 'raise' : 'lower'} ${quote(s.anchor.label)}, since ${s.since}.`);
  const names = [...new Set(gate.kept.map((s) => quote(s.anchor.label)))].join(' and ');
  const reply = gate.kept.length > 0 ? [
    'Possible drivers not in the model yet.',
    `I looked for what else could drive ${names}, across customers and demand, money and price, people and capacity, timing, how the work is done, and outside conditions (influence-diagram elicitation).`,
    ...lines, 'Possible drivers to consider, not established causes.', 'Nothing is added until you choose one and approve the change.',
  ].join('\n') : gate.redirect ?? 'I couldn’t prepare a possible driver from this model. Nothing was added.';
  return { reply, gate, offered: gate.kept.length, actions: gate.kept.length > 0 ? [...gate.kept.map((s) => s.press), SOMETHING_ELSE_CHIP] : [CANVAS_FACTORS_PRESS] };
}
export type FactorAddCall = { readonly tool: 'propose_new_factor'; readonly internal: { readonly kind: 'olumi_direction' }; readonly args: {
  factors: readonly { label: string; affects: string; direction: 'positive' | 'negative' }[]; rationale: string; whole_request: true;
} };
export function factorAddCallOf(chipId: unknown, message: unknown, rb: MethodReadback): FactorAddCall | null {
  const prefix = 'Add the factor ‘';
  if (!isWidenAddPressId(chipId) || typeof message !== 'string' || message.length > 600 || !message.startsWith(prefix)) return null;
  const end = message.indexOf('’', prefix.length); const label = end < 0 ? '' : message.slice(prefix.length, end);
  if (label === '' || label.length > 60) return null;
  const turn = factorsTurnForReadback(rb); if (turn.kind !== 'run_factors') return null;
  for (const anchor of turn.graph.nodes) for (const direction of DIRECTIONS) {
    const gate = factorGate(turn, [{ label, category: FACTOR_METHOD.categories[0], anchor_id: anchor.id, direction, since: 'general patterns suggest this connection' }]);
    const s = gate.kept[0];
    if (s?.press.message === message && s.press.id === chipId) return { tool: 'propose_new_factor', internal: { kind: 'olumi_direction' },
      args: { factors: [{ label, affects: s.anchor.id, direction }], rationale: 'Olumi suggested this driver (influence-diagram elicitation); the user chose to add it.', whole_request: true } };
  }
  return null;
}
