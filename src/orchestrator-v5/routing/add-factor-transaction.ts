/**
 * PJ-E-FIG — the add-factor transaction builder (PURE), the add-risk door's twin. Delivery Lead #72 5866036457, on
 * Canonical 5866021645.
 *
 * Journey E: "Senior engineers cost £120k a year each and juniors £65k a year each." Those figures must be HELD on typed
 * factor nodes as the USER's values; before this door the Agent had no path. This builds the ONE batch the product's own
 * held-edit seam referees, holds (`graph_management_held_v1`) and, on the user's confirm, applies in ONE commit
 * (`executeGmHeldResume`) — the add-risk seam (`add-risk-transaction.ts`), reused.
 *
 * THE BATCH (1..3 new factors, all or nothing):
 *   · every `add_node` FIRST — `{id, kind: 'factor', label, category: 'external'}` and nothing else (R4 refuses a value
 *     or a source on an add). The first factor's node is op 0, so the hold's handle is
 *     `gmHeldProposalRef(scenario, 'node:<first factor id>')`. `external`: no option sets it — a `controllable` factor no
 *     option reaches is a readiness blocker ("not connected to any option").
 *   · then ONE `add_edge` per factor, new factor → its target, Olumi's PLACEHOLDER (`hypothesisEdgeValue`: default
 *     strength, `defaulted`, `cee_hypothesis`) — never `user_specified`: nobody sized the link.
 *
 * ⛔ THE TARGET KINDS ARE DECIDED HERE. A new factor links to the goal, an outcome or a non-lever factor (one no option
 * sets: observable or external) — the add-option new-factor rule (`isAffectsTarget`) less risks — and NEVER an option, a
 * decision, a risk or a lever the options set (`INVALID_FACTOR_TO_CONTROLLABLE`). Any other target is refused with nothing
 * built. (Recovery Batch B, B1: the goal was refused here while the drafter wrote factor → goal itself and the add-option
 * door took it; Paul's hiring test, 11 Oct, was refused "a new factor directly to the goal".)
 *
 * THE USER'S FIGURE rides the hold, not the ops: a CEE-written member (`GM_HELD_USER_TODAY_KEY`) the confirm stamps into
 * each factor's `add_node` after the re-referee and before the apply (`stampNewUserTodayLevels`), exactly where the
 * switch's today-0 and the stated graded level are stamped.
 */
import { z } from 'zod';

import { normaliseIdBase } from '../../cee/utils/id-normalizer.js';
import { provenanceOf } from '../../cee/provenance/provenance-of.js';
import { USER_EDIT_SOURCE } from '../../orchestrator/canonicalise-value-ops.js';
import type { PatchOperation } from '../../orchestrator/types.js';
import { TYPED_TRANSACTION_ENVELOPE_CAP } from '../graph-management/types.js';
import { StoredInterventionRange } from '../intervention-range.js';
import { rangePointEstimate } from '../../utils/amount-range.js';
import { hypothesisEdgeValue, isAffectsTarget, isStatedTodayObservedState, reachesGoal, sameLabel, type AddOptionGraphView } from './add-option-transaction.js';

/** At most this many new factors in ONE change (the ruling: 1..3). */
export const MAX_FACTORS_PER_ADD = 3;

const AddFactorParamsSchema = z
  .object({
    factors: z
      .array(
        z
          .object({
            id: z.string().min(1).optional(),
            label: z.string().trim().min(1),
            /** The ONE existing node the new factor drives (new factor → target). */
            link: z.object({ to_id: z.string().min(1), effect_direction: z.enum(['positive', 'negative']) }).strict(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_FACTORS_PER_ADD),
  })
  .strict();

export type AddFactorParams = z.input<typeof AddFactorParamsSchema>;

export type AddFactorSkipReason =
  | 'parameters_invalid'
  | 'no_graph'
  | 'factor_label_exists'
  | 'factor_label_repeated'
  | 'factor_id_invalid'
  | 'factor_id_collision'
  | 'node_not_found'
  | 'target_not_allowed'
  | 'new_factor_unreachable'
  | 'too_many_ops';

export interface AddFactorProposal {
  readonly operations: PatchOperation[];
  /** The new factors in request order: id, label and the one link each. */
  readonly factors: readonly { readonly id: string; readonly label: string; readonly to: string; readonly effect_direction: 'positive' | 'negative' }[];
}

export type AddFactorBuildResult =
  | { readonly matched: true; readonly proposal: AddFactorProposal }
  | { readonly matched: false; readonly reason: AddFactorSkipReason };

const CANONICAL_ID_RE = /^[a-z0-9_:-]+$/;
const fail = (reason: AddFactorSkipReason): AddFactorBuildResult => ({ matched: false, reason });

/**
 * What a new factor may drive: the goal, an outcome or a non-lever factor (one no option sets). Never an option, decision,
 * risk or lever.
 *
 * ⭐ ONE RULE (Recovery Batch B, B1): DERIVED from the add-option new-factor rule (`isAffectsTarget`), never restated, so
 * the two doors that add a factor cannot disagree on a target again. The served drafter writes factor → goal itself
 * (`build-model.ts`: "straight to the goal metric"; `admit-model.ts` keeps it, its factor → goal repair having been removed
 * by ruling) and the analysis runs it. The one difference is kept and named: a risk, which this door has never taken
 * (Canonical #72's door rule; not in Batch B's scope).
 */
export function isNewFactorTarget(node: { kind: string; category?: string } | undefined): boolean {
  if (node === undefined || node.kind === 'risk') return false;
  return isAffectsTarget(node);
}

/** Build the atomic add-factor batch against the current graph, or a classified refusal. A refusal builds nothing. */
export function buildAddFactorTransaction(params: unknown, graph: AddOptionGraphView | null): AddFactorBuildResult {
  if (graph === null) return fail('no_graph');
  const parsed = AddFactorParamsSchema.safeParse(params);
  if (!parsed.success) return fail('parameters_invalid');
  const taken = new Set(graph.nodes.map((n) => n.id));
  const factors: { id: string; label: string; to: string; effect_direction: 'positive' | 'negative' }[] = [];
  for (const f of parsed.data.factors) {
    const label = f.label.trim();
    // A second node by the same name is not a new factor: the user could not tell the two apart.
    if (graph.nodes.some((n) => sameLabel(n.label, label))) return fail('factor_label_exists');
    if (factors.some((x) => sameLabel(x.label, label))) return fail('factor_label_repeated');
    let id: string;
    if (f.id !== undefined) {
      if (!CANONICAL_ID_RE.test(f.id)) return fail('factor_id_invalid');
      if (taken.has(f.id)) return fail('factor_id_collision');
      id = f.id;
    } else {
      const base = `fac_${normaliseIdBase(label)}`;
      id = base;
      for (let k = 2; taken.has(id); k += 1) id = `${base}_${k}`;
    }
    taken.add(id);
    const target = graph.nodes.find((n) => n.id === f.link.to_id);
    if (target === undefined) return fail('node_not_found');
    if (!isNewFactorTarget(target)) return fail('target_not_allowed');
    // A factor whose target never reaches the goal cannot change the comparison.
    if (!reachesGoal(graph, target.id)) return fail('new_factor_unreachable');
    factors.push({ id, label, to: target.id, effect_direction: f.link.effect_direction });
  }
  if (factors.length * 2 > TYPED_TRANSACTION_ENVELOPE_CAP) return fail('too_many_ops');
  const operations: PatchOperation[] = [
    ...factors.map((f): PatchOperation => ({ op: 'add_node', path: f.id, value: { id: f.id, kind: 'factor', label: f.label, category: 'external' } })),
    ...factors.map((f): PatchOperation => ({ op: 'add_edge', path: `${f.id}::${f.to}`, value: hypothesisEdgeValue(f.id, f.to, f.effect_direction) })),
  ];
  return { matched: true, proposal: { operations, factors } };
}

/**
 * ⛔ THE DOOR'S RULES HOLD ON THE GRAPH A HOLD LANDS ON, NOT ONLY THE ONE IT WAS PROPOSED ON (review finding 1, PJ-E-FIG).
 * The referee has no name rule, so a canvas add of "Senior engineer salary" between the proposal and the approval
 * re-pinned the hold (`threadHoldsThroughMutatingCommit`) and the approval committed a SECOND node by that name.
 *
 * Re-reads the held batch as the door's own request — each `add_node` with its ONE `add_edge` — and runs THIS builder
 * on `graph`: every propose-time rule (name taken, target kind, reaches the goal, id free) applies again. `null` = the
 * batch is still exactly what this door would build here; otherwise the reason. Pure and total; a batch that is not a
 * door batch at all is `parameters_invalid`.
 */
export function recheckAddFactorBatch(
  operations: readonly PatchOperation[],
  graph: AddOptionGraphView | null,
): AddFactorSkipReason | null {
  if (graph === null) return 'no_graph';
  const valueOf = (o: PatchOperation): Record<string, unknown> =>
    (o.value !== null && typeof o.value === 'object' && !Array.isArray(o.value) ? o.value as Record<string, unknown> : {});
  const nodes = operations.filter((o) => o.op === 'add_node');
  const edges = operations.filter((o) => o.op === 'add_edge');
  if (nodes.length === 0 || nodes.length + edges.length !== operations.length || edges.length !== nodes.length) return 'parameters_invalid';
  const factors: unknown[] = [];
  for (const n of nodes) {
    const own = edges.filter((e) => valueOf(e).from === n.path);
    if (own.length !== 1) return 'parameters_invalid';
    const e = valueOf(own[0]!);
    factors.push({ id: n.path, label: valueOf(n).label, link: { to_id: e.to, effect_direction: e.effect_direction } });
  }
  const built = buildAddFactorTransaction({ factors }, graph);
  return built.matched ? null : built.reason;
}

// ---------------------------------------------------------------------------
// ⭐ THE USER'S FIGURE FOR EACH NEW FACTOR, WRITTEN IN THE SAME APPLY
// ---------------------------------------------------------------------------

/**
 * The key the HOLD records each new factor's figure under (`inline_patch.user_today`): `[{ factor_id, observed_state }]`.
 * Written only by the add-factor dispatch (CEE's own transaction, from the Agent's in-process call, never from a payload
 * the referee screens), read only by the confirm. Absent on every other hold, so their bytes are unchanged.
 */
export const GM_HELD_USER_TODAY_KEY = 'user_today';

/**
 * Whose the figure is: the user's, typed in chat and approved at the confirm — the product's literal for exactly that
 * (`USER_EDIT_SOURCE`, the goal-current-level precedent). NOT the ruling's `user_specified`: that literal is not an
 * `ObservedStateV3.source` member (@talchain/schemas 0.60.0), so the post-apply GraphV3 parse would decline every approval.
 */
export const USER_TODAY_SOURCE = USER_EDIT_SOURCE;

/**
 * Why the figure is the user's (DL ruling on #2235, 14:05Z 28 Sep). `written_about`: their words wrote it about THIS factor
 * (one figure, one new factor: the strict matcher). `confirmed_by_approval`: their message wrote two figures or more, or
 * the change adds two factors or more, so Olumi's PAIRING was shown on the approval card with their own words (`quote`)
 * and their approval made it theirs. The hold is the durable record (the receipt schema is strict).
 */
export type UserTodayBasis = 'written_about' | 'confirmed_by_approval';
export const USER_TODAY_BASES: readonly UserTodayBasis[] = ['written_about', 'confirmed_by_approval'];
/** The longest quote a hold carries (the card shows at most `FIGURE_QUOTE_MAX` plus its ellipses). */
export const USER_TODAY_QUOTE_MAX = 400;

export interface UserTodayLevel {
  readonly factor_id: string;
  readonly observed_state: Readonly<Record<string, unknown>>;
  readonly basis?: UserTodayBasis;
  /** The user's own sentence the figure was written in, verbatim (`quoteOfFigure`). Required with `confirmed_by_approval`. */
  readonly quote?: string;
}

/**
 * Whether `os` is exactly the ONE framing rule's output (`framedObservedState`, the stated-baseline shape
 * `isStatedTodayObservedState` pins) re-stamped as the user's: `{ value: raw / cap, raw_value, cap, declared_scale,
 * unit?, source }` on a cap above 1, or a bare value within [0, 1]. Nothing else rides into the model.
 */
export function isUserTodayObservedState(os: unknown): boolean {
  if (os === null || typeof os !== 'object' || Array.isArray(os)) return false;
  const { range, ...o } = os as Record<string, unknown>;
  if (o.source !== USER_TODAY_SOURCE) return false;
  // Recovery Batch B (L6): a range rides only beside the user's own figure, and only as `isStatedLevelRange` admits it.
  if (range !== undefined && !isStatedLevelRange(range, o)) return false;
  // The shape rule is the stated-baseline one, verbatim: only the source differs.
  return isStatedTodayObservedState({ ...o, source: 'brief_extraction' });
}

/**
 * ⭐ RECOVERY BATCH B (SYS3 TRACE L6) — A LEVEL THE USER STATED AS A RANGE IS STORED AS A RANGE.
 *
 * Paul, 11 Oct: "currently they spend between 20% and 30% of their time on non-development tasks", then "Let's go with
 * 25%." The range was never stored: no door could carry it. It now rides `observed_state.range` beside the figure the
 * user CHOSE, in the existing schemas 0.66 `InterventionRangeSchema` shape (`intervention-range.ts`): `{low, high,
 * meaning, source, source_quote}`, in the figure's own (raw) units, with its own author — never a new store.
 *
 *   · the user's own range: `source` is the user's literal (`USER_TODAY_SOURCE`) and `source_quote` the ONE sentence of
 *     theirs that states both ends (the door checks that sentence; this rule requires that one is carried);
 *   · `meaning: 'min_max'`: the ends as the user wrote them ("between 20% and 30%"), read as bounds and nothing more —
 *     never `likely_range`, which claims the middle half of what is likely (the contract's meanings are likely_range,
 *     min_max, at_most, at_least). Nothing samples a level range, so the analysis is unchanged (the wire copy drops it:
 *     `withoutStatedLevelRanges`);
 *   · it CONTAINS the user's chosen figure (`low ≤ figure ≤ high`); never a midpoint: the figure beside it is the one the
 *     user wrote, or there is no range.
 */
export function isStatedLevelRange(range: unknown, os: Readonly<Record<string, unknown>>): boolean {
  if (!isUserStatedRange(range)) return false;
  const r = StoredInterventionRange.parse(range);
  const figure = typeof os.raw_value === 'number' ? os.raw_value : os.value;
  return typeof figure === 'number' && Number.isFinite(figure) && r.low <= figure && figure <= r.high;
}

/**
 * The author half of {@link isStatedLevelRange}: a stored range the user stated, attested and quoted, asked of the one
 * provenance authority (C), never a brief's type-less stamp. Recovery Batch E (run 4 hiring step 13): a factor holding one
 * is never reported as a range Olumi chose (`ranges_added_for_analysis`).
 */
export function isUserStatedRange(range: unknown): boolean {
  const parsed = StoredInterventionRange.safeParse(range);
  if (!parsed.success) return false;
  const r = parsed.data;
  const author = provenanceOf({ value: r });
  return r.meaning === 'min_max' && author.origin === 'human' && author.role === 'verified' && author.stampOnly !== true
    && typeof r.source_quote === 'string' && r.source_quote.trim() !== '' && r.source_quote.length <= USER_TODAY_QUOTE_MAX;
}

/**
 * Row5 RULING (DL 12 Oct 13:1xZ): the point beside a stored level range. `stated_figure`: the user's own figure inside
 * their own range (L6). `midpoint`: Olumi's point from a range someone stated (`rangePointEstimate`, the ONE point rule),
 * never the user's figure. Otherwise none.
 */
export function levelRangePointBasis(os: Readonly<Record<string, unknown>>): 'stated_figure' | 'midpoint' | undefined {
  const parsed = StoredInterventionRange.safeParse(os.range);
  if (!parsed.success) return undefined;
  if (isStatedLevelRange(os.range, os)) return 'stated_figure';
  const figure = typeof os.raw_value === 'number' ? os.raw_value : os.value;
  const olumis = os.source === 'cee_inference' && os.user_material_unverified !== true;
  return olumis && figure === rangePointEstimate({ min: parsed.data.low, max: parsed.data.high }) ? 'midpoint' : undefined;
}

/**
 * The ANALYSIS wire copy without any stated level range (Batch B, L6): the range changes no compute, so the request PLoT
 * receives is byte-identical with or without it. Identity when no node carries one; the stored graph is never touched.
 */
export function withoutStatedLevelRanges<G>(graph: G): G {
  if (graph === null || typeof graph !== 'object') return graph;
  const nodes = 'nodes' in graph ? graph.nodes : undefined;
  if (!Array.isArray(nodes)) return graph;
  const carries = (n: unknown): boolean => n !== null && typeof n === 'object'
    && (n as { observed_state?: unknown }).observed_state !== null && typeof (n as { observed_state?: unknown }).observed_state === 'object'
    && Object.hasOwn((n as { observed_state: object }).observed_state, 'range');
  if (!nodes.some(carries)) return graph;
  return { ...graph, nodes: nodes.map((n) => {
    if (!carries(n)) return n;
    const { range: _range, ...os } = (n as { observed_state: Record<string, unknown> }).observed_state;
    return { ...(n as object), observed_state: os };
  }) } as G;
}

/**
 * The hold's `user_today` member, read. FAIL-CLOSED: unlike a graded level (no signal ⇒ asked later), this door exists to
 * carry the figure, so a malformed member is `undefined` and the caller declines the hold — never the factors valueless.
 */
export function readUserTodayMember(raw: unknown): readonly UserTodayLevel[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: UserTodayLevel[] = [];
  for (const x of raw) {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return undefined;
    const { factor_id: id, observed_state: os, basis, quote } = x as { factor_id?: unknown; observed_state?: unknown; basis?: unknown; quote?: unknown };
    if (typeof id !== 'string' || id.length === 0 || !isUserTodayObservedState(os)) return undefined;
    // FAIL-CLOSED on the record of WHY the figure is theirs: an unknown basis, or a confirmation with no quote shown.
    if (basis !== undefined && !(USER_TODAY_BASES as readonly unknown[]).includes(basis)) return undefined;
    if (quote !== undefined && (typeof quote !== 'string' || quote.trim() === '' || quote.length > USER_TODAY_QUOTE_MAX)) return undefined;
    if (basis === 'confirmed_by_approval' && quote === undefined) return undefined;
    out.push({
      factor_id: id,
      observed_state: { ...(os as Record<string, unknown>) },
      ...(basis !== undefined ? { basis: basis as UserTodayBasis } : {}),
      ...(quote !== undefined ? { quote: quote as string } : {}),
    });
  }
  return new Set(out.map((l) => l.factor_id)).size === out.length ? out : undefined;
}

/**
 * Write each named new factor's figure INTO its `add_node` op — run by the confirm AFTER the re-referee and AFTER the
 * switch and graded-today stamps, BEFORE the apply. FAIL-CLOSED, by identity: each id must name exactly ONE `add_node` of
 * a FACTOR in this batch that carries no value yet, and the level must be the user's framed figure. No option is needed
 * (this door adds factors only). Anything else is `{ ok: false }` and the caller refuses the whole batch. Pure and total.
 */
export function stampNewUserTodayLevels<T extends PatchOperation>(
  operations: readonly T[],
  levels: readonly UserTodayLevel[],
): { readonly ok: true; readonly operations: T[] } | { readonly ok: false } {
  if (levels.length === 0) return { ok: true, operations: [...operations] };
  if (new Set(levels.map((l) => l.factor_id)).size !== levels.length) return { ok: false };
  const out = [...operations];
  for (const l of levels) {
    if (!isUserTodayObservedState(l.observed_state)) return { ok: false };
    const at = out.flatMap((o, i) => (o.op === 'add_node' && o.path === l.factor_id ? [i] : []));
    if (at.length !== 1) return { ok: false };
    const value = out[at[0]!]!.value;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
    const node = value as Record<string, unknown>;
    if (node.kind !== 'factor' || node.id !== l.factor_id || 'observed_state' in node || 'data' in node) return { ok: false };
    // ⭐ R11 × #2235 (DL APPROVE 5872416793 follow-up; ACK 5872437724): HOW this figure became the user's is kept ON
    // the node, in the same field family as a link's `provenance.reviewed_by_user` — a pairing Olumi read from their
    // words and they CONFIRMED on the approval card carries that card's quote. `ObservedStateV3` is passthrough, so it
    // survives the save and every reload; a figure written about this factor alone (`written_about`) records nothing.
    const confirmedPairing = l.basis === 'confirmed_by_approval' && typeof l.quote === 'string'
      ? { reviewed_by_user: { intent: 'confirm_pairing', quote: l.quote } }
      : {};
    out[at[0]!] = { ...out[at[0]!]!, value: { ...node, observed_state: { ...l.observed_state, ...confirmedPairing } } };
  }
  return { ok: true, operations: out };
}
