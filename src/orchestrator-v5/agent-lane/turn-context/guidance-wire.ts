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
import { selectGuidance, type GuidanceState, type Selection, type SelectedRow } from '../guidance/index.js';
import type { LeaderLicence } from '../../compose/leader-licence.js';
import { assembleGuidanceSignals, type GuidanceRequest } from './guidance-signals.js';
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
  if (i.guidance === null) return undefined;
  try {
    const signals = assembleGuidanceSignals({
      request: i.request, offeredSpecific: i.offeredSpecific, graph: i.state.graph, analysisState: i.state.analysisState,
      analysisResult: i.state.analysisResult, optionParticipation: i.state.optionParticipation,
      identityEvaluations: [...(i.state.identityEvaluated ?? [])].map((node_id) => ({ node_id, evaluated: true })),
      guidance: i.guidance ?? {}, explicitRequest: null, leaderLicensed: guidanceLeaderLicensed(i.licence),
    });
    const selectedSignals = selectorSignalsOf(signals, null, i.runKey);
    return guidanceWireFor(selectGuidance(selectedSignals, selectedSignals.guidance ?? {}), i.state.graph);
  } catch {
    return undefined;
  }
}
