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

export function isWidenPress(chipId: unknown): boolean {
  return chipId === WIDEN_PRESS_ID || questionedLinkOf(chipId) !== null;
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
const norm = (s: string): string => s.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/\s+/gu, ' ').trim().toLowerCase();

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
  readonly reason: WidenUnavailableReason;
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
