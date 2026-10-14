/**
 * ⭐ T2 — THE GUIDANCE ROW ON THE WIRE (M1; AI HARNESS lease 5940322790, DL 5939211254; carrier 5937532945). The Agent
 * turn may carry ONE optional root key `guidance: { slot1?, slot2? }`. Each row is the selector's own `SelectedRow`
 * (policy id, variant, priority, primary action, state key hash, RC's rendered copy) plus `item_ref`: the row's subject
 * BY ID, `{kind:'link', from_id, to_id}` or `{kind:'factor', factor_id}`, so PANEL's Accept/Edit binds to the model by
 * identity (`readGuidanceRow`, DGAI `panel/t4-guidance-row` @6e0bc400) and never parses `item`.
 *
 * `item_ref` is resolved against the SAME readback graph the signals were read from (`itemRefOf`), never by splitting
 * the id string; an item no single entity answers to gets no `item_ref` (the row is then words only). Absent `guidance`
 * = no row this turn. Pure.
 */
import { policyWhySaid, selectGuidance, type GuidanceState, type Selection, type SelectedRow } from '../guidance/index.js';
import type { LeaderLicence } from '../../compose/leader-licence.js';
import { assembleGuidanceSignals, type GuidanceRequest } from './guidance-signals.js';
import { POLICY } from '../guidance/policy.js';
import { selectorSignalsOf } from './selector-signals.js';

export type GuidanceItemRef =
  | { readonly kind: 'link'; readonly from_id: string; readonly to_id: string }
  | { readonly kind: 'factor'; readonly factor_id: string };
export type GuidanceWireRow = SelectedRow & { readonly item_ref?: GuidanceItemRef };
export interface GuidanceWire { readonly slot1?: GuidanceWireRow; readonly slot2?: GuidanceWireRow }

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The subject of a row, by identity in this graph. Exactly ONE entity may answer to the item: one factor node with that
 * id, or one link whose `${from}->${to}` is the item. None, or more than one (a factor id that spells a link, parallel
 * links, an id holding '->'), binds to nothing, so Accept/Edit can never act on a different entity than the row names.
 */
export function itemRefOf(item: string | undefined, graph: unknown): GuidanceItemRef | undefined {
  if (item === undefined || !isRec(graph)) return undefined;
  const factors = (Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : []).filter((n) => n.id === item && n.kind === 'factor');
  const links = (Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [])
    .filter((e) => typeof e.from === 'string' && typeof e.to === 'string' && `${e.from}->${e.to}` === item);
  if (factors.length + links.length !== 1) return undefined;
  return factors.length === 1 ? { kind: 'factor', factor_id: item }
    : { kind: 'link', from_id: links[0]!.from as string, to_id: links[0]!.to as string };
}

const wireRow = (row: SelectedRow, graph: unknown): GuidanceWireRow => {
  const ref = itemRefOf(row.item, graph);
  return { ...row, ...(ref !== undefined ? { item_ref: ref } : {}) };
};

/** The wire carrier for a selection; undefined when neither slot holds a row. */
export function guidanceWireFor(selection: Selection, graph: unknown): GuidanceWire | undefined {
  if (selection.slot1 === undefined && selection.slot2 === undefined) return undefined;
  return {
    ...(selection.slot1 !== undefined ? { slot1: wireRow(selection.slot1, graph) } : {}),
    ...(selection.slot2 !== undefined ? { slot2: wireRow(selection.slot2, graph) } : {}),
  };
}

/**
 * Which request this turn is, for the selector (`turn.request`): the Run's own result (request 1), its explanation
 * (request 2), a press of one of the product's next-step methods, or an ordinary turn. The selector itself withholds a
 * row on a Run result, a method turn and a decision point (`select.ts`); this only names the request.
 */
export function guidanceRequestOf(fastPath: string | undefined, chipId: unknown, methodChipIds: ReadonlySet<string>): GuidanceRequest {
  if (fastPath === 'run') return 'run_result';
  if (fastPath === 'explain') return 'narration';
  if (typeof chipId === 'string' && methodChipIds.has(chipId)) return 'method';
  return 'turn';
}

/**
 * Whether a row may build on the leading option (RC-WHAT-CHANGES, RC-PREMORTEM's plan): only on an unqualified licence.
 * A caveated licence names the leader WITH its caveat; a coaching row carries no caveat, so it is unlicensed (fail closed).
 */
export const guidanceLeaderLicensed = (licence: LeaderLicence): boolean => licence === 'permitted';

export interface TurnGuidanceInputs {
  /** Reuse the host selection, including an intentionally empty selection. */
  readonly preReplySelection?: { readonly wire: GuidanceWire | undefined };
  readonly request: GuidanceRequest;
  readonly offeredSpecific: readonly { readonly id: string }[];
  /** The reply's final text: a row rides only a turn that says something (PANEL 5940333155: empty text = `empty`). */
  readonly assistantText: unknown;
  /** The ONE licence (`compose/leader-licence.ts`) from the same final readback; only `permitted` names a leader. */
  readonly licence: LeaderLicence;
  readonly runKey?: string;
  /** Bounded persisted history; null means unreadable. Omission retains legacy callers' behaviour. */
  readonly guidance?: GuidanceState | null;
  readonly state: {
    readonly graph?: unknown;
    readonly analysisState?: unknown;
    readonly analysisResult?: unknown;
    readonly optionParticipation?: unknown;
    readonly identityEvaluated?: ReadonlySet<string>;
  };
}

/**
 * THE ROW THIS TURN CARRIES, from the final readback: #2465's signals → SCIENCE/DSK's adapter → RC's selector → the wire.
 * The caller supplies bounded persisted history. The existing selector owns cooldown; an unreadable history or
 * state gives no row. Legacy callers without a history keep their existing offers until the state moves.
 */
export function turnGuidanceFor(i: TurnGuidanceInputs): GuidanceWire | undefined {
  if (typeof i.assistantText !== 'string' || i.assistantText.trim() === '') return undefined;
  if (i.preReplySelection !== undefined) return i.preReplySelection.wire;
  return selectTurnGuidance(i);
}

/** The same selector inputs before or after a reply; no prose enters selection. */
export function selectTurnGuidance(i: Omit<TurnGuidanceInputs, 'assistantText' | 'preReplySelection'>): GuidanceWire | undefined {
  return selectTurnGuidanceShown(i).wire;
}

/**
 * The wire, and whether its slot-1 row's "Why?" was already said on this state of its policy (`policyWhySaid`). The
 * flag is display only: it never changes the wire, the selection, or what the model is told.
 */
export interface TurnGuidanceSelection { readonly wire: GuidanceWire | undefined; readonly whySaid: boolean }
export function selectTurnGuidanceShown(i: Omit<TurnGuidanceInputs, 'assistantText' | 'preReplySelection'>): TurnGuidanceSelection {
  if (i.guidance === null) return { wire: undefined, whySaid: false };
  try {
    const signals = assembleGuidanceSignals({
      request: i.request, offeredSpecific: i.offeredSpecific, graph: i.state.graph, analysisState: i.state.analysisState,
      analysisResult: i.state.analysisResult, optionParticipation: i.state.optionParticipation,
      identityEvaluations: [...(i.state.identityEvaluated ?? [])].map((node_id) => ({ node_id, evaluated: true })),
      guidance: i.guidance ?? {}, explicitRequest: null, leaderLicensed: guidanceLeaderLicensed(i.licence),
    });
    const selectedSignals = selectorSignalsOf(signals, null, i.runKey);
    const history = selectedSignals.guidance ?? {};
    const wire = guidanceWireFor(selectGuidance(selectedSignals, history), i.state.graph);
    const policy = wire?.slot1?.policy_id;
    return { wire, whySaid: policy !== undefined && policyWhySaid(policy, selectedSignals, history) };
  } catch {
    return { wire: undefined, whySaid: false };
  }
}

/** One method, from the selected policy's own expert words (summary is the science_basis text). */
export interface EligibleIntervention {
  readonly policy_id: SelectedRow['policy_id'];
  readonly variant_id: SelectedRow['variant'] | null;
  readonly name: string;
  readonly why: string;
  readonly trigger: string;
}
export const ELIGIBLE_INTERVENTION_INSTRUCTION = 'Only name the scientific method in CURRENT MODEL STATE.eligible_intervention. If absent, give a direct grounded answer without a named method. Write next moves as plain action bullets of at most eight words each. Keep useful questions and user figures. When a supplied reasoning method materially helps this turn, give its reason briefly as part of your useful answer. Use the reason supplied with that method; do not invent a scientific justification or append the same explanation routinely. When the user asks about the method itself, explain it from that context.';
/**
 * ⛔ A ROW'S SCIENCE SENTENCE IS NOT ALWAYS TRUE OF EVERY VARIANT (SYS2 G1, served 11 Oct). RC-WIDEN's sentence ("Decisions
 * framed with a single alternative ('whether or not') fail more often…") describes W2 only, the one-proposed-route case
 * (AIE 6115647793: W2Z is ZERO options, not a single alternative). Paul's two-option hiring model got it under "Suggest
 * drivers" (W7). Every other variant names a different situation (no option yet; a broken limit, which can hold with one
 * option; one lever; no baseline; close options; few risks; few drivers), so behind "Why?" it carries its own approved
 * `why_now` (the policy's progressive_detail: "Why: one line on the variant's why_now").
 */
const ROW_SCIENCE_ONLY_FOR: Readonly<Partial<Record<SelectedRow['policy_id'], readonly string[]>>> = { 'RC-WIDEN': ['W2'] };
function whyOf(row: (typeof POLICY.rows)[number], variant: string | undefined): string | undefined {
  const only = ROW_SCIENCE_ONLY_FOR[row.policy_id];
  if (only === undefined || (variant !== undefined && only.includes(variant))) return row.science_basis.summary;
  const own = typeof row.why_now === 'string' || variant === undefined ? undefined : (row.why_now as Readonly<Record<string, string>>)[variant];
  return typeof own === 'string' && own.trim() !== '' ? own : undefined;
}
export function eligibleInterventionFor(wire: GuidanceWire | undefined): EligibleIntervention | undefined {
  const selected = wire?.slot1;
  if (selected === undefined) return undefined;
  const row = POLICY.rows.find(row => row.policy_id === selected.policy_id)!;
  const variant = 'variants' in row.trigger_predicate ? row.trigger_predicate.variants.find(v => v.id === selected.variant) : undefined;
  // No true sentence for this variant → no named method (a direct grounded answer), never the row's untrue one.
  const why = whyOf(row, selected.variant);
  if (why === undefined) return undefined;
  return { policy_id: selected.policy_id, variant_id: selected.variant ?? null,
    name: row.name, why,
    trigger: variant?.when ?? row.trigger_predicate.all.join(' AND ') };
}
