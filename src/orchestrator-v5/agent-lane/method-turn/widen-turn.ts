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
import { levelFrameOf } from '../runtime/agent-capabilities.js';
import { assembleGuidanceSignals, type GuidanceSignals as TurnSignals } from '../turn-context/guidance-signals.js';
import { selectorSignalsOf, TALK_IT_THROUGH_CHIP, type MethodReadback } from './method-turn.js';

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
  return chipId === WIDEN_PRESS_ID;
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
 * direction is not stored there, so a proposal on the same factors fails closed.
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
  if (out.size === 0) {
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

/**
 * A PROPOSED level on the stored scale, by the DOOR's own rule (`levelFrameOf`: the factor's cap, else its scale_frame;
 * a level inside 0..1 is stored as given): the figure the door would write, so £ and encoded values never meet raw.
 * Undefined when the door would not store it (outside the frame, or no frame and outside 0..1).
 */
export function encodedLevelOf(factor: Rec | undefined, value: number): number | undefined {
  const frame = levelFrameOf(factor as never);
  const v = frame !== null ? value / frame : value;
  return v >= 0 && v <= 1 ? v : undefined;
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
}

export type WidenUnavailableReason = 'model_unread' | 'no_goal';

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
};

function unavailable(reason: WidenUnavailableReason): WidenUnavailableTurn {
  return { kind: 'unavailable', reason, reply: UNAVAILABLE_REPLY[reason], actions: [TALK_IT_THROUGH_CHIP] };
}

/** The Widen turn for these signals: unavailable without a goal or factors, else ONE gated model call. Total. */
export function widenTurnFromSignals(s: TurnSignals, graph: unknown): WidenTurn {
  if (s['model.goal_present'] !== true) return unavailable('no_goal');
  const g = graphOf(graph);
  const goalLabel = s['model.goal_label'] ?? labelOf(g.nodes.find((n) => n.kind === 'goal')) ?? 'your goal';
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
  const current = optionIds.map((id) => ({ label: norm(labelFor(id)), levers: existingLevers(g, id, sq) }));
  const describe = (id: string): string => {
    const changes = g.edges.filter((e) => e.from === id && factorLabel.has(e.to)).map((e) => quote(factorLabel.get(e.to)!));
    return `- ${quote(labelFor(id))}${compared.has(id) ? '' : ' (left out of the comparison)'}${changes.length > 0 ? `: changes ${changes.join(', ')}` : ''}`;
  };
  const directive = [
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
    'For each factor an option changes, give a level only as your own estimate (estimate: true, with a basis the user can '
      + 'check), so the options can be compared once the user approves; never present it as the user’s figure.',
    'Put why each option might do better in `rationale`, in one or two plain sentences.',
    ...POLICY.method_turns.shared.never.map((rule) => `Never: ${rule}.`),
  ].join('\n');
  const doorFactors = g.nodes.filter((n) => n.kind === 'factor').map((n) => ({
    id: String(n.id), label: typeof n.label === 'string' ? n.label : '', description: typeof n.description === 'string' ? n.description : '' }));
  return { kind: 'run', target: 'options', variant, goal_label: goalLabel, directive, current, factors: doorFactors, graph: g, sq };
}

/** The Widen turn for a press, from the route's own readback (the same licence and identity projection as the pre-mortem). */
export function widenTurnForReadback(chipId: unknown, rb: MethodReadback): WidenTurn | null {
  if (!isWidenPress(chipId)) return null;
  if (rb.graph === undefined || rb.graph === null) return unavailable('model_unread');
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
  return widenTurnFromSignals(signals, rb.graph);
}

export type WidenGateResult = { readonly ok: true } | { readonly ok: false; readonly failed: readonly string[] };

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
 * RC-WIDEN's structured checks on the door's own arguments, BEFORE the door stores anything (by identity, never wording).
 * Failed ids: WD-COUNT · WD-S-NEW-FACTORS · WD-S-GROUNDED · WD-NO-DUP · WD-S-DISTINCT · WD-NO-NEW-FIGURES.
 */
export function widenGate(turn: RunWidenTurn, args: unknown): WidenGateResult {
  const a = rec(args) ?? {};
  const raw: unknown[] = Array.isArray(a.options) ? a.options : a.label !== undefined || a.acts_on !== undefined ? [{ label: a.label, acts_on: a.acts_on }] : [];
  const failed = new Set<string>();
  if (raw.length < 1 || raw.length > WIDEN_MAX_OPTIONS) failed.add('WD-COUNT');
  if (Array.isArray(a.new_factors) && a.new_factors.length > 0) failed.add('WD-S-NEW-FACTORS');
  const seen: Levers[] = turn.current.map((c) => c.levers);
  const currentLabels = new Set(turn.current.map((c) => c.label));
  const proposedLabels = new Set<string>();
  for (const item of raw) {
    const o = rec(item);
    const label = typeof o?.label === 'string' ? norm(o.label) : '';
    const actsOn = Array.isArray(o?.acts_on) ? o.acts_on.map(rec) : [];
    if (label === '' || currentLabels.has(label) || proposedLabels.has(label)) failed.add('WD-NO-DUP');
    proposedLabels.add(label);
    const levers = new Map<string, Move>();
    if (actsOn.length === 0) failed.add('WD-S-GROUNDED');
    for (const e of actsOn) {
      const id = doorFactorOf(turn, e?.factor_label);
      const direction = e?.direction === 'negative' ? 'negative' : e?.direction === 'positive' ? 'positive' : undefined;
      if (id === undefined || direction === undefined) { failed.add('WD-S-GROUNDED'); continue; }
      levers.set(id, direction);
      const level = rec(e?.level);
      if (level !== undefined && (level.estimate !== true || typeof level.basis !== 'string' || level.basis.trim() === '')) failed.add('WD-NO-NEW-FIGURES');
      // DL P1-E: a level the door would write decides the move, not the declared word. Read on the door's own frame
      // against the same baseline as the existing options; a level that disagrees with its declared direction (a "cut"
      // to £60 when today is £49, or a "cut" that keeps today's level) is refused, never trusted.
      const value = typeof level?.value === 'number' && Number.isFinite(level.value) ? level.value : undefined;
      const node = turn.graph.nodes.find((n) => String(n.id) === id);
      const encoded = value === undefined ? undefined : encodedLevelOf(node, value);
      const derived = moveOf(encoded, baselineOf(turn.graph, id, turn.sq));
      if (derived !== 'unknown' && derived !== direction) failed.add('WD-S-DIRECTION');
    }
    if (levers.size > 0 && seen.some((existing) => sameLevers(levers, existing))) failed.add('WD-S-DISTINCT');
    seen.push(levers);
  }
  return failed.size === 0 ? { ok: true } : { ok: false, failed: [...failed] };
}

export function widenFallbackReply(turn: RunWidenTurn): string {
  return WIDEN_FALLBACK_TEMPLATE.replace('{goal}', quote(turn.goal_label));
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
    typeof n?.option === 'string' && typeof n.same_levels_as === 'string'
      ? [`Not in this change: ${quote(n.option)} would set the same levels as ${quote(n.same_levels_as)}.`] : []);
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
    const reply = run.assistant_text.trim() !== '' ? run.assistant_text
      : widenDoorReply(run.tool_results?.[cards[0]!]) ?? WIDEN_CARD_LINE;
    return { reply, carded: true, actions: [SOMETHING_ELSE_CHIP] };
  }
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
