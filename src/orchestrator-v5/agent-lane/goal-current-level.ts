/**
 * ⭐ THE GOAL'S CURRENT LEVEL, STATED BY THE USER IN CHAT — proposed for approval, then recorded exactly as
 * construction records a brief-stated one.
 *
 * THE DEAD END THIS CLOSES (AI Quality 5843320710; served CEE e26c3d2, OpenAI-only). After Paul's pricing
 * brief and the approve, "Our current MRR is £12,000." called only `get_canonical_state`: no Agent tool could
 * record a goal's level (`propose_assumptions` takes factors only; #1840 writes a goal baseline only at build,
 * from the brief). The goal's `observed_state` stayed null, ISL refused the level frame
 * (`missing_goal_baseline` → `GOAL_THRESHOLD_NOT_CONVERTIBLE`) and the Run had no `probability_of_goal`.
 *
 * ⛔ HELD, NEVER DIRECT. The proposer writes nothing: it stores ONE exact proposal in the lane's own
 * `ProposalStore` (content-hashed, bound to scenario, user and the base revision), and only
 * `authorise_change` on that stored proposal writes — the same consent every factor value goes through.
 *
 * ⭐ THE SAME SHAPE AS #1840 (`admit-model.ts`, the goal limb): `{ value: B, baseline: B, unit, source,
 * raw_value: R, cap }`, B = R / the target's OWN cap (`goal_threshold_cap`). Only `source` differs, because
 * the act differs: a chat statement is not the brief. It is `USER_EDIT_SOURCE` ('user_override', "the
 * observed_state.source literal CEE's chat-edit writers stamp", `canonicalise-value-ops.ts`), which the
 * obligation rule reads as `user_stated` exactly like `brief_extraction` (`obligation-provenance.ts`) while
 * the display keeps "you typed this" apart from "we read this in your brief" (`provenance-display.ts`).
 *
 * ⛔ ADMISSION IS THE BRIEF PATH'S OWN RULE (`admitStatedGoalLevel`), plus the three questions only a chat
 * statement raises, each asked first:
 *   · IS IT THE GOAL? `goal_label` must name the goal node itself — a figure for a factor or another
 *     metric is never written to the goal.
 *   · IS IT THE USER'S? `user_stated: true`, or refused — Olumi's estimate never sets the chance of reaching
 *     the user's target (the brief path withholds an estimate for the same reason).
 *   · IS IT IN THE GOAL'S OWN UNIT? (`readStatedGoalLevel`, below). "12%" for a GBP goal would pass the scale
 *     rule (12 / 25000 is inside [0, 1]), so the unit check is the one that refuses it — and on this path it
 *     FAILS CLOSED, because the figure feeds the headline chance of reaching the target.
 * The goal's comparator is NOT persisted (`admit-model.ts`, the `goal_operator` loss), so the Agent states
 * how the user put the target (`goal_is`) — the same model-read the brief's `operator` is — and an unstated
 * one is refused, never defaulted.
 */
import { USER_EDIT_SOURCE } from '../../orchestrator/canonicalise-value-ops.js';
import { sameUnit } from '../../utils/currency-alphabet.js';
import { admitStatedGoalLevel } from './admit-model.js';
import { canonicaliseLimitUnit } from './admit-constraint.js';
import { unitPhraseFamily, unitPhraseHead, unitsConflict } from './unit-conflict.js';
import { createProposal, type ProposalOperation, type ProposalStore, type ReceiptSummary, type StructuredProposal } from './proposal.js';
import { registrationTurnId } from '../graph-registration/registration-identity.js';
import type { AgentToolContext, ToolResult } from './runtime/agent-tools.js';

/** The proposal op: the estate's existing node-update op, carrying the goal's new `observed_state`. */
export const GOAL_CURRENT_LEVEL_OP = 'update_node' as const;

/** How the user stated the goal's target → the comparator the shared rule reads. */
const OPERATOR_OF: Readonly<Record<string, string>> = { at_least: '>=', above: '>', at_most: '<=', below: '<' };

export interface GoalCurrentLevelArgs {
  readonly goal_label?: unknown;
  readonly value?: unknown;
  readonly unit?: unknown;
  readonly goal_is?: unknown;
  readonly user_stated?: unknown;
}

/** The slice of a graph read this module needs — `agent-capabilities.ts`'s `GraphRead` satisfies it. */
export interface GoalLevelRead {
  readonly graph_hash: string;
  readonly graph_identity_hash: string;
  readonly nodes: readonly { id: string; kind: string; label: string; observed_state?: Record<string, unknown> }[];
  readonly raw: Record<string, unknown>;
}

type InternalDispatch = (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;

const norm = (s: unknown): string => String(s ?? '').toLowerCase().trim();
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const refuse = (refusal: string, detail: string, extra: Record<string, unknown> = {}): ToolResult =>
  ({ ok: false, mutated: false, refusal, detail, ...extra });

/** A rescale by a stated magnitude suffix — the admit-constraint M-rung's own stamp, carried verbatim. */
interface UnitNormalised {
  readonly rule: string;
  readonly original_value: number;
  readonly original_unit: string;
}

/** The goal's own observed_state carried on the proposal — what `authorise_change` writes, byte for byte. */
interface GoalObservedState {
  readonly value: number;
  readonly baseline: number;
  readonly unit?: string;
  readonly source: string;
  readonly raw_value: number;
  readonly cap: number;
  readonly provenance_unit_normalised?: UnitNormalised;
}

/**
 * The goal's stated target the level is measured against — its persisted frame, unit, figure and cap. Carried on
 * the proposal and required UNCHANGED at apply time: the frame and the unit are outside the analysis hash the
 * proposal is bound to, so the store's base check alone would let an approval land on a goal that moved to the
 * delta frame or to another unit after the figure was prepared.
 */
interface GoalTarget {
  readonly goal_threshold_frame: unknown;
  readonly goal_threshold_unit: string | null;
  readonly goal_threshold_raw: unknown;
  readonly goal_threshold_cap: unknown;
}

function targetOf(node: Record<string, unknown>): GoalTarget {
  const unit = node.goal_threshold_unit;
  return {
    goal_threshold_frame: node.goal_threshold_frame,
    goal_threshold_unit: typeof unit === 'string' && unit.trim() !== '' ? unit : null,
    goal_threshold_raw: node.goal_threshold_raw,
    goal_threshold_cap: node.goal_threshold_cap,
  };
}

const sameTarget = (a: GoalTarget, b: GoalTarget): boolean =>
  a.goal_threshold_frame === b.goal_threshold_frame && a.goal_threshold_unit === b.goal_threshold_unit &&
  a.goal_threshold_raw === b.goal_threshold_raw && a.goal_threshold_cap === b.goal_threshold_cap;

type StatedLevel =
  | { readonly ok: true; readonly raw: number; readonly normalised?: UnitNormalised }
  | { readonly ok: false; readonly refusal: 'unit_mismatch' | 'unit_unstated' | 'unit_unrecognised'; readonly detail: string };

/**
 * ⛔ THE STATED FIGURE, READ IN THE GOAL'S OWN UNIT — or refused. Never relabelled.
 *
 * Verified at 68602637 (DEFECT_FOUND): the family check alone let `12000 USD` through as "12000 GBP MRR" (USD, $,
 * EUR and "GBP MRR" are all the currency family) and `12 £k` through as raw 12 — 1000x too small, so the chance
 * of reaching £20k read as nil. The rungs, in order:
 *   1. A goal whose own unit no classifier reads (or has none) is held to nothing — the lane's fail-open rule.
 *   2. A k/m suffix on the goal's OWN currency is scaled by the admit-constraint M-rung itself
 *      (`canonicaliseLimitUnit`, the node side given as the goal's bare currency head), and its stamp is kept.
 *      The accepted suffixes are therefore exactly the M-rung's; anything else falls to rung 3.
 *   3. FAIL CLOSED: no unit, or one no classifier reads ("subscribers", "$k"), is refused and the user is asked
 *      for the figure in the goal's own unit — the headline goal-fit number is never fed by an unclassified figure.
 *   4. Another kind of unit ("%", "users") is refused (`unitsConflict`).
 *   5. Another currency is refused: both heads must be ONE currency (`sameUnit`: £ ≡ GBP). No rate is applied.
 */
export function readStatedGoalLevel(value: number, statedUnit: unknown, goal: { readonly label: string; readonly unit: string | undefined }): StatedLevel {
  const stated = typeof statedUnit === 'string' ? statedUnit.trim() : '';
  const goalFamily = unitPhraseFamily(goal.unit);
  const goalHead = unitPhraseHead(goal.unit);
  if (goal.unit === undefined || goalFamily === null || goalHead === null) return { ok: true, raw: value };

  const askInstead =
    `Nothing was prepared; ask the user for the current level of "${goal.label}" in ${goal.unit}, written out in full.`;

  if (goalFamily === 'currency' && stated !== '') {
    const scaled = canonicaliseLimitUnit(value, stated, { unit: goalHead });
    if (scaled.provenance_unit_normalised !== undefined) return { ok: true, raw: scaled.value, normalised: scaled.provenance_unit_normalised };
  }

  if (stated === '') {
    return {
      ok: false, refusal: 'unit_unstated',
      detail: `${value} was given with no unit, and "${goal.label}" is measured in ${goal.unit}. A figure is never ` +
        `assumed to be in the goal's unit. ${askInstead}`,
    };
  }
  if (unitPhraseFamily(stated) === null) {
    return {
      ok: false, refusal: 'unit_unrecognised',
      detail: `"${stated}" is not a unit that can be matched to ${goal.unit}, the unit "${goal.label}" is measured in, ` +
        `so ${value} ${stated} is never recorded as its current level. ${askInstead}`,
    };
  }
  if (unitsConflict(stated, goal.unit) !== null) {
    return {
      ok: false, refusal: 'unit_mismatch',
      detail: `${value} ${stated} is in a different kind of unit from "${goal.label}", which is measured in ${goal.unit}. ` +
        'A figure given for something else is never recorded as the goal’s current level. Nothing was prepared; ask ' +
        `the user for the current level of "${goal.label}" itself.`,
    };
  }
  if (goalFamily === 'currency' && !sameUnit(unitPhraseHead(stated) ?? '', goalHead)) {
    return {
      ok: false, refusal: 'unit_mismatch',
      detail: `${value} ${stated} is not in the currency of "${goal.label}", which is measured in ${goal.unit}. No ` +
        `exchange rate is ever applied, so it is never recorded as the goal's current level. ${askInstead}`,
    };
  }
  return { ok: true, raw: value };
}

function goalLevelOf(op: ProposalOperation | undefined): GoalObservedState | undefined {
  if (op?.op !== GOAL_CURRENT_LEVEL_OP) return undefined;
  const os = (op.value as { goal_current_level?: unknown } | undefined)?.goal_current_level;
  return os !== null && typeof os === 'object' ? os as GoalObservedState : undefined;
}

/** Is this stored proposal a goal-current-level change? (`authorise_change` routes it here.) */
export function isGoalCurrentLevelProposal(p: StructuredProposal): boolean {
  return p.operations.length === 1 && goalLevelOf(p.operations[0]) !== undefined;
}

/**
 * Prepare the change: every admission question, then ONE held proposal. Writes nothing.
 */
export async function proposeGoalCurrentLevel(
  deps: { readonly readGraph: (scenarioId: string) => Promise<GoalLevelRead | null>; readonly proposals: ProposalStore },
  ctx: AgentToolContext,
  args: GoalCurrentLevelArgs,
): Promise<ToolResult> {
  const g = await deps.readGraph(ctx.scenario_id);
  if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
  const goals = g.nodes.filter((n) => n.kind === 'goal');
  const goalNames = goals.map((n) => `"${n.label}"`).join(', ') || 'none';

  // ── IS IT THE GOAL? Identity by the label the Agent read from get_canonical_state.
  const requested = String(args?.goal_label ?? '');
  const named = g.nodes.filter((n) => norm(n.label) === norm(requested));
  const goal = named.length === 1 && named[0]!.kind === 'goal' ? named[0]! : undefined;
  if (goal === undefined) {
    const other = named.find((n) => n.kind !== 'goal');
    return refuse(
      'not_the_goal',
      (other !== undefined
        ? `"${other.label}" is not the goal of this model (it is a ${other.kind}).`
        : `The model has nothing called "${requested}" that is its goal.`) +
      ` This records only the current level of the goal itself (${goalNames}); a figure for anything else is never ` +
      'written to the goal. Nothing was prepared.',
      { goal: goalNames },
    );
  }

  // ── IS IT THE USER'S?
  if (args?.user_stated !== true) {
    return refuse(
      'not_the_users_figure',
      `Only a current level the user stated for "${goal.label}" can be recorded: an estimate would set the chance of ` +
      'reaching their target on a guess. Nothing was prepared. Ask the user for their own figure.',
    );
  }
  const value = args?.value;
  if (!num(value)) return refuse('unparsable_value', 'No usable number was given. Nothing was prepared.');

  // ── A TARGET ON THE LEVEL FRAME TO MEASURE AGAINST (the goal's own persisted trio).
  const node = goal as typeof goal & { goal_threshold_raw?: unknown; goal_threshold_cap?: unknown; goal_threshold_frame?: unknown; goal_threshold_unit?: unknown };
  const target = node.goal_threshold_raw;
  const cap = node.goal_threshold_cap;
  if (!num(target) || !num(cap) || cap <= 0 || node.goal_threshold_frame !== 'level') {
    return refuse(
      'no_target',
      `"${goal.label}" has no stated target to measure its current level against, so there is no chance of reaching ` +
      'one to show. Nothing was prepared. Ask the user what level they are aiming for first.',
    );
  }
  const goalUnit = typeof node.goal_threshold_unit === 'string' && node.goal_threshold_unit.trim() !== '' ? node.goal_threshold_unit : undefined;

  // ── IN THE GOAL'S OWN UNIT? (scaled by a stated k/m suffix only as the M-rung scales a limit; else refused)
  const stated = readStatedGoalLevel(value, args?.unit, { label: goal.label, unit: goalUnit });
  if (!stated.ok) return refuse(stated.refusal, stated.detail);
  const raw = stated.raw;
  const statedUnit = typeof args?.unit === 'string' ? args.unit.trim() : '';

  // ── HOW THE USER PUT THE TARGET (not persisted: stated by the Agent from the user's words, never defaulted).
  const operator = typeof args?.goal_is === 'string' ? OPERATOR_OF[args.goal_is] : undefined;
  if (operator === undefined) {
    return refuse(
      'goal_is_unstated',
      `Say how the user put the target for "${goal.label}" (at least, above, at most or below ${target}). If they have not ` +
      'said, ask them. Nothing was prepared.',
    );
  }

  // ── THE BRIEF PATH'S OWN RULE: operator tail, then scale and direction.
  const verdict = admitStatedGoalLevel({ metric: goal.label, operator, rawTarget: target, rawBaseline: raw, cap });
  if (!verdict.admitted) return refuse('not_admitted', verdict.reason);

  const existing = goal.observed_state;
  const existingRaw = num(existing?.raw_value) ? existing!.raw_value as number : undefined;
  if (existingRaw === raw && existing?.source === USER_EDIT_SOURCE) {
    return refuse('already_recorded', `${raw}${goalUnit !== undefined ? ` ${goalUnit}` : ''} is already recorded as the user’s current level of "${goal.label}". Nothing to change.`);
  }
  const observed: GoalObservedState = {
    value: verdict.normalised,
    baseline: verdict.normalised,
    ...(goalUnit !== undefined ? { unit: goalUnit } : {}),
    source: USER_EDIT_SOURCE,
    raw_value: raw,
    cap,
    ...(stated.normalised !== undefined ? { provenance_unit_normalised: stated.normalised } : {}),
  };
  const withUnit = (x: number) => `${x}${goalUnit !== undefined ? ` ${goalUnit}` : ''}`;
  // ⛔ THE USER'S OWN FIGURE AND UNIT, as they gave it — never relabelled in the goal's unit — plus, when a stated
  // suffix was scaled, what it is recorded as. The target and a replaced record are the goal's own, in its unit.
  const asStated = `${value}${statedUnit !== '' ? ` ${statedUnit}` : ''}`;
  const figure = stated.normalised !== undefined ? `${asStated}, which is ${withUnit(raw)}` : asStated;
  const replaces = existingRaw !== undefined && existingRaw !== raw ? existingRaw : undefined;
  const proposal = createProposal({
    scenario_id: ctx.scenario_id,
    user_id: ctx.authenticated_user_id,
    base_graph_identity_hash: g.graph_hash,
    operations: [{ op: GOAL_CURRENT_LEVEL_OP, path: goal.id, value: { goal_current_level: observed, against: targetOf(node) } }],
    provenance: { authored_by: 'user_stated', basis: 'the current level of the goal, as the user stated it' },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label:
      `Record the current level of "${goal.label}" as your figure: ` +
      (replaces !== undefined ? `${withUnit(replaces)} → ${figure}` : figure) +
      ` (target ${withUnit(target)})`,
  });
  deps.proposals.put(proposal);
  return {
    ok: true, mutated: false,
    proposal_id: proposal.proposal_id,
    public_label: proposal.public_label,
    base_revision: g.graph_hash,
    goal: goal.label,
    current_level: { value: raw, ...(goalUnit !== undefined ? { unit: goalUnit } : {}) },
    as_stated: { value, ...(statedUnit !== '' ? { unit: statedUnit } : {}) },
    target: { value: target, ...(goalUnit !== undefined ? { unit: goalUnit } : {}) },
    ...(replaces !== undefined ? { replaces } : {}),
    note:
      'Nothing has changed. Show the user the figure as they gave it' +
      (stated.normalised !== undefined ? ` and what it is recorded as (${asStated} is ${withUnit(raw)})` : '') +
      ', and that it will be recorded as THEIR current level of the goal, never the id, and call authorise_change ' +
      'with this proposal_id only once they agree.',
  };
}

/**
 * Apply an APPROVED goal-current-level proposal: ONE registration of the approved read with the goal's
 * `observed_state` set, CAS-gated on the revision the user approved (`expected_graph_hash`, the analysis
 * space the proposal is bound to) AND the identity of the same read (`expected_graph_identity_hash`) — the
 * pair the frame write sends, so an intervening edit refuses rather than being overwritten by stale bytes.
 * "Saved" only when THIS registration answered 200 and a read afterwards holds exactly what it wrote.
 */
export async function applyGoalCurrentLevel(
  deps: {
    readonly dispatch: InternalDispatch;
    readonly readGraph: (scenarioId: string) => Promise<GoalLevelRead | null>;
    readonly proposals: ProposalStore;
    readonly operationId: (key: string) => string;
  },
  ctx: AgentToolContext,
  proposal: StructuredProposal,
  approved: GoalLevelRead,
): Promise<ToolResult> {
  const op = proposal.operations[0]!;
  const os = goalLevelOf(op)!;
  const notApplied = (detail: string): ToolResult => ({ ok: false, mutated: false, applied: false, proposal_id: proposal.proposal_id, refusal: 'not_applied', detail });
  const goal = approved.nodes.find((n) => n.id === op.path);
  if (goal === undefined || goal.kind !== 'goal') return notApplied('The goal is no longer in the model, so nothing was written.');
  // ⛔ RE-VALIDATED AT APPLY TIME: the level frame, and the same unit, figure and cap the proposal was prepared against.
  const against = (op.value as { against?: GoalTarget } | undefined)?.against;
  const now = targetOf(goal as unknown as Record<string, unknown>);
  if (against === undefined || now.goal_threshold_frame !== 'level' || !sameTarget(against, now)) {
    return {
      ok: false, mutated: false, applied: false, proposal_id: proposal.proposal_id, refusal: 'superseded',
      detail: `The target of "${goal.label}" changed after this was prepared, so nothing was written. Read the model again and propose afresh.`,
    };
  }

  const operationId = deps.operationId(`${proposal.proposal_id}#goal_current_level`);
  // A rescale stamp describes the figure it came with: a new figure without one never inherits the previous one's.
  const { provenance_unit_normalised: _previousStamp, ...kept } = (goal.observed_state ?? {}) as Record<string, unknown>;
  const nodes = approved.nodes.map((n) => (n.id === op.path ? { ...n, observed_state: { ...kept, ...os } } : n));
  const reg = await deps.dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
    graph: { ...approved.raw, nodes },
    ...(approved.graph_hash !== '' ? { expected_graph_hash: approved.graph_hash } : {}),
    ...(approved.graph_identity_hash !== '' ? { expected_graph_identity_hash: approved.graph_identity_hash } : {}),
    operation_id: operationId,
  });
  if (reg.status !== 200) {
    const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
    return code === 'GRAPH_STALE'
      ? { ok: false, mutated: false, applied: false, proposal_id: proposal.proposal_id, refusal: 'superseded',
        detail: 'The model changed after this was approved, so nothing was written. Read it again and propose afresh.' }
      : notApplied(`The current level could not be saved (http ${reg.status}). Nothing was written.`);
  }
  const receipts: ReceiptSummary[] = [];
  const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
  if (mv !== undefined && typeof mv.version_id === 'string') {
    receipts.push({
      version: Number(mv.version_number), version_id: mv.version_id,
      mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '',
      source_turn_id: registrationTurnId(ctx.scenario_id, operationId),
    });
  }
  // ⛔ CONFIRMED FROM STATE: the goal as stored now holds exactly the level this write carried.
  const after = await deps.readGraph(ctx.scenario_id);
  const held = after?.nodes.find((n) => n.id === op.path)?.observed_state;
  const landed = held !== undefined && held.raw_value === os.raw_value && held.baseline === os.baseline && held.source === os.source;
  if (!landed) {
    return {
      ok: false, mutated: true, applied: false, proposal_id: proposal.proposal_id, refusal: 'not_verified', receipts,
      detail: 'The current level was saved, but the model changed again straight afterwards, so what it now holds could not be confirmed. Read the model again before saying what it holds.',
    };
  }
  deps.proposals.markApplied(proposal.proposal_id, receipts);
  const unit = os.unit !== undefined ? ` ${os.unit}` : '';
  return {
    ok: true, mutated: true, applied: true,
    proposal_id: proposal.proposal_id,
    receipts,
    goal: goal.label,
    recorded: { value: os.raw_value, ...(os.unit !== undefined ? { unit: os.unit } : {}) },
    revision_before: approved.graph_hash,
    revision_after: after?.graph_hash ?? approved.graph_hash,
    not_represented:
      `The current level of "${goal.label}" (${os.raw_value}${unit}) is recorded as the user’s own figure. Say so. ` +
      'An analysis the user asks for can now compare it with the target.',
  };
}
