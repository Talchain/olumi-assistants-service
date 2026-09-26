/**
 * Agent lane — the capabilities, each delegating to an existing Olumi path.
 *
 * ⭐ NOTHING HERE OWNS A RULE. Canonical truth, admissibility, authorisation,
 * CAS, idempotency, persistence and analysis all stay where they already live;
 * these functions carry a request to them and report what came back. Writes and
 * analysis go through the SAME `/orchestrate/v2/turn` the product uses, via an
 * internal dispatch, so the Agent cannot reach a shortcut the UI does not have.
 *
 * ⛔ A MUTATION IS CONFIRMED FROM STATE, NEVER FROM A STATUS CODE. Observed on
 * 22 Sep: a tool that returned success on HTTP 200 made the Agent tell the user
 * "Added: …" while CEE had honestly refused with "I couldn't record that
 * properly, so I haven't changed the model." Every mutating capability below
 * re-reads the model afterwards and reports what the model actually shows.
 */

import { createHash, randomUUID } from 'node:crypto';
import { SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS } from '../../tools/handlers/set-factor-value.js';
import { AGENT_ADD_OPTION_CHIP_ID, AGENT_RUN_ANALYSIS_CHIP_ID } from '../../handlers/agent-chip-ids.js';
import { buildAddOptionsTransaction, MAX_OPTIONS_PER_TRANSACTION } from '../../routing/add-option-transaction.js';
import { GM_HELD_HANDLER_ID, GM_HELD_OPERATIONS_MAX_JSON_CHARS, gmHeldProposalRef } from '../../handlers/edit-graph-referee-gate.js';
import { TYPED_TRANSACTION_ENVELOPE_CAP } from '../../graph-management/types.js';
import { resolveProposalRenderCopy } from '../../compose/proposed-change.js';
import { isPendingActionExpired, type PendingAction } from '../../session/pending-action.js';

/**
 * The durable operation identity for authorising a proposal.
 *
 * ⛔ IT MUST BE A v4-SHAPED UUID. Measured against the real
 * `SystemEventTurnPayloadSchema`: `turn_id` is regex-constrained, and a
 * readable key like `agent_authorise:<proposal_id>` is refused at ingress with
 * `INGRESS_CONTRACT_VIOLATION` before any handler runs. My first version used
 * exactly that readable form; the unit tests passed because the mock dispatch
 * does not validate the payload, and only posting it at the real boundary
 * showed all four calls refused.
 *
 * So this is a NAME-BASED uuid wearing a v4 costume: SHA-256 of the proposal
 * id with the version and variant nibbles forced. It is deterministic — the
 * same proposal always yields the same key, which is the whole point — and it
 * satisfies the wire. The trade is legibility in the turn log for a stable
 * idempotency key, and the stable key is what the replay arm needs.
 */

/** A value whose unit is another kind than its factor's (a price as churn): left out, and the Agent says why. */
const UNIT_MISMATCH_NOTE =
  'Left out because the figure is in a different kind of unit from the factor (for example a price given for a rate). '
  + 'Never record a figure the user gave for something else as this factor\u2019s value; ask for its own figure if needed.';

/** What the Agent says about a level it marked as the user's that the user never wrote (`stated-by-user.ts`). */
const NOT_THE_USERS_FIGURE_NOTE =
  'The user did not write these figures, so they are proposed as Olumi\u2019s estimates, not as the user\u2019s own. '
  + 'Say so plainly; never call a figure the user\u2019s unless they wrote it.';

/** Why a level the user never wrote is left unset (`stated-by-user.ts`). */
const notWrittenReason = (value: number, factor: string): string =>
  `${value} is not a figure the user gave for ${factor}, so this change leaves that level unset. Say plainly it has no level yet, `
  + `and ask for ${factor}\u2019s figure only if the user wants to set it. Never send 0 or any placeholder to mean "not set": leave level out.`;

/** What the Agent is told to say about a named input that cannot hold a value. */
const NOT_A_FACTOR_NOTE =
  'These were named but are not factors (for example a risk), so no starting value can be set on them and they are ' +
  'NOT in this proposal. Tell the user plainly, before they approve, that each was left out and why; describe its ' +
  'effect through the factors it acts on instead. Never present the starting point as complete while any is listed here.';

/** The approval-facing disclosure of what was left out (empty when nothing was). */
function leftOutClause(notAFactor: readonly { label: string; kind: string }[]): string {
  if (notAFactor.length === 0) return '';
  return ` (left out, not a factor so it cannot hold a value: ${notAFactor.map((n) => `${n.label} — a ${n.kind}`).join('; ')})`;
}

export function authorisationTurnId(proposalId: string): string {
  const h = createHash('sha256').update(`agent_authorise:${proposalId}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/**
 * ⭐ THE RECEIPT A WRITE PRODUCED, read with the estate's own parser.
 *
 * ⛔ MEASURED GAP: the agent lane read `model_version_receipt` in 0 non-test
 * files, against 6 elsewhere in the estate. So even when a signed-in authorise
 * minted a version, `authorise_change` dropped the receipt — the Agent could not
 * say "saved as version 7", and a retry could not hand back what the first
 * authorisation produced.
 *
 * Returns the compact summary only. The receipt also carries the entire
 * committed `graph`, which must never ride into a tool result that is
 * stringified back into the model's context.
 *
 * A receipt that is PRESENT but fails the strict schema is reported, not
 * swallowed and not thrown: the write happened, the user's turn must not
 * crash, and nobody should read "no receipt" when one arrived malformed.
 */
export function receiptSummaryOf(json: unknown): { summary: ReceiptSummary | null; unreadable: boolean } {
  try {
    const r = modelVersionMutationReceiptFromResponse(json);
    if (r === null) return { summary: null, unreadable: false };
    return {
      summary: { version: r.sequence, version_id: r.version_id, mutation_id: r.mutation_id, source_turn_id: r.source_turn_id },
      unreadable: false,
    };
  } catch {
    return { summary: null, unreadable: true };
  }
}

import { planNewFactors, planNewOption, type NewFactorRequest } from '../propose-new-option.js';
import { createProposal, ProposalStore, type ProposalOperation, type ReceiptSummary, type StructuredProposal } from '../proposal.js';
import { modelVersionMutationReceiptFromResponse } from '../../model-management/mutation-receipt.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { confirmEdgeWrite, describeOutcome } from '../confirm-write.js';
import { statusQuoOptionId, structuralFacts } from '../structural-facts.js';
import { readinessViewOf, withoutCantRunOpening } from '../readiness-view.js';
import { pickGoalThresholdTrio } from '../../../utils/goal-threshold-trio.js';
import { bandFromMagnitude, INFLUENCE_BAND_THRESHOLDS, type InfluenceBand } from '../../format/influence-bands.js';
import { runWithApprovedAdoption, runWithApprovedLevelAdoption } from '../approved-adoption-context.js';
import { isRepairAuthoredOptionFactorEdge } from '../../../graph/repair-authored-edge.js';
import { factorUnitOf, unitsConflict } from '../unit-conflict.js';
import { bandTheUserWrote, contradictsItsName, figureTheUserWrote } from '../stated-by-user.js';
import { defaultFrameFor, nonlinearIdentityForAgent } from '../admit-model.js';
import { WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN } from '../../compose/analysis-state-v1.js';
import type { AgentCapabilities, AgentToolContext, ToolResult } from './agent-tools.js';
import { buildModelFromBrief, constructionOperationId, findConstructionVersion, type CallStructuredModel } from './build-model.js';
import { claimPermissionsFrom, describeFirstAnalysisForAgent, type FirstAnalysisInput, type FirstAnalysisOutcome } from '../first-analysis.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { linkedFactorsOf } from '../../routing/option-effect-write.js';
import { applyGoalCurrentLevel, isGoalCurrentLevelProposal, proposeGoalCurrentLevel } from '../goal-current-level.js';
import type { KnownObservedStateSourceLiteral } from '@talchain/schemas';

/**
 * ⛔ C46 (d) — THE AGENT IS TOLD WHEN THE LEADER RESTS ON A PRODUCT THE ANALYSIS ONLY ADDS UP.
 *
 * `claim_permissions` is the Agent's only view of the leader permission. A C46 reason the wire carries
 * (`nonlinear_identity_sign_unproven`) must not reach it as an unknown code, and — AI Quality option (i),
 * #70 5842615260 — while a limit or the unrequested first pass holds the `withheld_reason` field, the
 * product cause is still TRUE and still said: it rides beside that reason as `nonlinear_identity`, with
 * its plain-English sentence (goal and factors named; no direction, no figure, no option).
 *
 * REMOVE-ONLY: it can set `leader_may_be_named` false, never true, and it leaves `withheld_reason` as the
 * wire published it, so the limit card's cause and this one both stand. Schema-free: `claim_permissions`
 * is the Agent's internal view, never a wire member.
 */
function withNonlinearIdentity(permissions: unknown, graph: unknown): unknown {
  const p = (permissions ?? {}) as { withheld_reason?: unknown };
  const finding = nonlinearIdentityForAgent(graph, p.withheld_reason === WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
  if (finding === null) return permissions;
  return {
    ...(permissions as Record<string, unknown>),
    leader_may_be_named: false,
    nonlinear_identity: {
      reason: WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN,
      say: finding.sentence,
      note: 'Say this sentence to the user as a reason no option is put forward on this model yet, beside any other '
        + 'reason given here. Do not name a leading option, a direction or a win percentage for this goal.',
    },
  };
}

/**
 * ⭐ DID *THIS* `factor_value_edit` COMMIT A WRITE? Read from its OWN response only.
 *
 * What the served `/orchestrate/v2/turn` system-event response carries, derived at
 * `route-v2.ts` (the `ingress.kind === 'system_event'` branch) and
 * `system-events/dispatch.ts` (`dispatchFactorValueEdit`):
 *
 *   · COMMITTED → HTTP 200, `blocks: [{ type: 'graph_patch', status: 'applied',
 *     operation: 'set_factor_value', target_id, before, after }]`, `graph_hash` (the
 *     commit's own persisted hash), `draft_graph`, and a `model_version_receipt` only
 *     when a version was minted. A guest never gets one (`append_turn_atomic_v5`:
 *     `v_should_create := v_user_id IS NOT NULL AND …`, else `'model_version_receipt',
 *     NULL`); it is also flag-dependent and the one `DEGRADABLE_EGRESS_FIELD`.
 *   · REFUSED → ALSO HTTP 200. The refusal is committed as a turn with no graph
 *     (`commitPerformed: true, graph: null`), so the body is `blocks: []`, no
 *     `graph_hash`, no receipt, and copy such as "…so I haven't changed anything."
 *   · COMMIT FAILED → 500 (`system_event_commit_failed`).
 *   · REPLAY / REUSED ID → 200, but `commit.ts` rewrites the patch to `status: 'noop'`
 *     ("nothing was written") and strips the receipt on a reused id.
 *   · VALUE ALREADY HELD → 200, the handler's own fact says `status: 'noop'`.
 *
 * So the one per-operation proof a guest's write carries is the `graph_patch` block
 * with `status: 'applied'` for THIS target. It is built from this request's own
 * handler fact and returned only on this request's response, so ANOTHER writer cannot
 * produce it: their commits move the graph and its hash, which is exactly why neither
 * the hash nor a read-back of the target is evidence of anything we did.
 */
function valueWriteCommittedByThisRequest(
  res: { status: number; json: Record<string, unknown> },
  targetId: string,
): boolean {
  if (res.status !== 200) return false;
  const blocks: unknown[] = Array.isArray(res.json.blocks) ? res.json.blocks : [];
  return blocks.some((b) => {
    if (b === null || typeof b !== 'object') return false;
    const p = b as { type?: unknown; operation?: unknown; target_id?: unknown; status?: unknown };
    return p.type === 'graph_patch' && p.operation === 'set_factor_value' && p.target_id === targetId && p.status === 'applied';
  });
}

/**
 * The native figure THIS request's own committed write stored for `targetId` — from its own
 * `graph_patch.after` (the handler fact of this request; another writer cannot produce it).
 * `undefined` when the response carries no usable snapshot.
 */
function ownCommittedNative(res: { status: number; json: Record<string, unknown> }, targetId: string): number | undefined {
  if (!valueWriteCommittedByThisRequest(res, targetId)) return undefined;
  const blocks: unknown[] = Array.isArray(res.json.blocks) ? res.json.blocks : [];
  const patch = blocks.find((b) => {
    const p = (b ?? {}) as { type?: unknown; target_id?: unknown; status?: unknown };
    return p.type === 'graph_patch' && p.target_id === targetId && p.status === 'applied';
  }) as { after?: unknown } | undefined;
  const a = (patch?.after ?? {}) as { value?: unknown; raw_value?: unknown; cap?: unknown };
  if (typeof a.raw_value === 'number') return a.raw_value;
  if (typeof a.value === 'number') return typeof a.cap === 'number' && a.cap > 0 ? a.value * a.cap : a.value;
  return undefined;
}

/**
 * The level THIS request's own committed `option_intervention_edit` stored for (option, factor), from
 * the committed post-state its OWN response carries (`draft_graph`; `system-events/dispatch.ts`), or
 * `undefined` when the response carries none.
 */
/**
 * ⛔ "THE SAME FIGURE" IS DECIDED EXACTLY WHEREVER NO ARITHMETIC SEPARATES THE TWO (pre-reviews of #1881, 5828080522 and
 * 5828293137). Any tolerance proportional to magnitude has a £1 boundary somewhere: 1e-6 hid £1,001 on £1.2bn, 1e-9 hid
 * £1 there, and 1e-12 hides £1 on £1.2tn. So two STORED figures — our committed level and the level read back in the
 * same range, or two native values — are compared with `===`. Only across a range change, where the product itself
 * multiplied and divided, is float noise allowed, and then only a few units in the last place of the larger figure
 * (~£0.002 at £1.2tn): the real rounding of those few steps, never a band a person's entry could fall inside.
 */
function sameAfterScaling(a: number, b: number): boolean {
  return a === b || Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
}
/** A figure for the Agent to quote: float noise removed (54.00000000000001 → 54); 15 significant digits is every digit a double carries. */
function quotable(x: number): number {
  return Number(x.toPrecision(15));
}

/**
 * ⛔ THIS WRITE COMMITTED, THEN THE MODEL MOVED ON — "COULD NOT BE CONFIRMED", NEVER "NOT SAVED" (round-2 review of
 * fix/agent-never-shows-instructions-or-codes, blocker 2's class). Called only once the read-back does NOT hold the
 * change. Proof that THIS write committed comes only from its own response: its committed post-state (`draft_graph`,
 * which a refused edit omits) holds the change, or it reports a revision other than the approved one AND the model has
 * since moved past that revision. A refusal answers 200 with the revision it found, unmoved, and no post-state — so it
 * stays "Not saved". Used by every `authoriseChange` branch that decides landed-ness from the read-back.
 */
function committedThenMoved(
  res: { status: number; json: Record<string, unknown> },
  approvedRevision: string,
  after: { graph_hash: string } | null,
  committedPostStateHolds: (draft: { edges?: unknown }) => boolean,
): boolean {
  if (res.status !== 200 || after === null) return false;
  const draft = res.json.draft_graph;
  if (draft !== null && typeof draft === 'object' && committedPostStateHolds(draft as { edges?: unknown })) return true;
  const reported = typeof res.json.graph_hash === 'string' ? res.json.graph_hash : '';
  return reported !== '' && approvedRevision !== '' && reported !== approvedRevision && after.graph_hash !== '' && after.graph_hash !== reported;
}

function committedLevelOf(json: Record<string, unknown>, optionId: string, factorId: string): number | undefined {
  const nodes = ((json.draft_graph ?? {}) as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return undefined;
  const option = nodes.find((n) => (n as { id?: unknown } | null)?.id === optionId) as { interventions?: Record<string, unknown> } | undefined;
  const iv = option?.interventions?.[factorId];
  const value = typeof iv === 'number' ? iv : (iv as { value?: unknown } | undefined)?.value;
  return typeof value === 'number' ? value : undefined;
}

/** Marks a compound starting point, so a newer one can replace it before approval. */
const STARTING_POINT_BASIS = 'a starting point \u2014 values and what each option sets \u2014 for the user to adopt or correct in one approval';

/**
 * The `observed_state.source` an adopted Olumi assumption is stored with. Typed
 * against the shared contract's vocabulary, so it cannot drift to a literal the
 * product does not know. See `applyCompound` for why it exists.
 */
const ADOPTED_ASSUMPTION_SOURCE: KnownObservedStateSourceLiteral = 'user_assumption';

/**
 * ⛔ WHO AUTHORED THIS ONE VALUE — never inferred from the proposal as a whole (Codex
 * pre-review of #1851, 5825286731). One `propose_assumptions` proposal can hold a revision the
 * USER named (`revise:true`, their figure) beside a figure OLUMI suggested, and its proposal-wide
 * `authored_by` is `model_proposed` whenever any figure is Olumi's — so stamping from that one
 * field recorded the user's own number as an Olumi assumption. Each value op now records its own
 * author (inside the proposal's integrity hash, `computeProposalId`, so it cannot be edited
 * undetected). A USER-authored proposal is the user's in every value (only a proposal made
 * entirely of their figures claims `user_stated`), so an op can only move an Olumi proposal's
 * value TO the user, never the reverse. An op without the field — a carrier persisted before it
 * existed — takes the proposal's author.
 */
function valueOpAuthor(op: ProposalOperation, proposal: StructuredProposal): 'model_proposed' | 'user_stated' {
  if (proposal.provenance.authored_by === 'user_stated') return 'user_stated';
  const own = ((op.value ?? {}) as { authored_by?: unknown }).authored_by;
  return own === 'user_stated' ? 'user_stated' : 'model_proposed';
}

/**
 * ⛔ WHO AUTHORED THIS ONE LEVEL (RC #69 5830255884) — the same rule as `valueOpAuthor`, for an
 * option level. MEASURED on served `c1ddb50`: every level an approval wrote was stamped
 * `user_specified`, so Olumi's proposed levels read "Set by you". A level is the user's only
 * when the user gave it (`user_stated` on the proposal) or the whole proposal is theirs; an op
 * without the field (a carrier stored before it existed) is Olumi's — the narrower claim.
 */
function levelOpAuthor(op: ProposalOperation, proposal: StructuredProposal): 'model_proposed' | 'user_stated' {
  return valueOpAuthor(op, proposal);
}

/** One level write, inside its adoption identity when the level is Olumi's (`approved-adoption-context.ts`). */
function writeLevelAs<T>(
  author: 'model_proposed' | 'user_stated',
  adoption: { scenarioId: string; proposalId: string; optionId: string; factorId: string; modelValue: number },
  write: () => Promise<T>,
): Promise<T> {
  return author === 'model_proposed' ? runWithApprovedLevelAdoption(adoption, write) : write();
}

/**
 * ⛔ WHAT THE APPROVAL STORED, SAID PER VALUE (Codex pre-review of #1851, 5825446207): the explanation
 * the Agent repeats must match the stamps `valueOpAuthor` decided. A mixed approval stores the user's
 * revision as theirs and Olumi's figure as the user's assumption; one sentence calling every value
 * "the user's adopted assumptions" collapsed the two authors the model now records.
 */
function valueAuthorshipNote(ops: readonly ProposalOperation[], proposal: StructuredProposal, labelOf: (id: string) => string): string {
  const values = ops.filter((o) => o.op === 'set_factor_value');
  const theirs = values.filter((o) => valueOpAuthor(o, proposal) === 'user_stated').map((o) => labelOf(o.path));
  const olumis = values.filter((o) => valueOpAuthor(o, proposal) === 'model_proposed').map((o) => labelOf(o.path));
  const one = (xs: readonly string[], singular: string, plural: string): string => (xs.length === 1 ? singular : plural);
  const own = theirs.length === 0 ? '' :
    `${theirs.join(', ')} ${one(theirs, 'is', 'are')} the user\u2019s own ${one(theirs, 'figure', 'figures')}, stored as theirs.`;
  const adopted = olumis.length === 0 ? '' :
    `${olumis.join(', ')} ${one(olumis, 'is Olumi\u2019s figure', 'are Olumi\u2019s figures')} that the user adopted as ` +
    `${one(olumis, 'an assumption', 'assumptions')}, not ${one(olumis, 'a measurement', 'measurements')}, stored as the user\u2019s ` +
    `${one(olumis, 'assumption', 'assumptions')}.`;
  return [own, adopted].filter((x) => x !== '').join(' ');
}

/** One internal dispatch, so every path is the product's own. */
export type InternalDispatch = (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;

interface GraphRead {
  readonly graph_hash: string;
  /**
   * ⭐ THE IDENTITY-SPACE HASH OF THE SAME READ — "is this the same graph
   * object?" — kept so a write can assert the identity it actually read.
   *
   * ⛔ NOT INTERCHANGEABLE WITH `graph_hash`, which is the ANALYSIS projection
   * and excludes labels. That exclusion is the whole defect: a rename landing
   * between our read and our write passes an analysis-space comparison and is
   * then overwritten by our stale copy of the node. `''` when the read did not
   * supply one — an expectation is then simply not sent, never fabricated.
   */
  readonly graph_identity_hash: string;
  /**
   * Declared, not cast. `readGraph` passes the persisted node through verbatim,
   * so these are the carriers the stored graph really holds — counted across
   * every stored graph on 22 Sep 2026: `provenance` 209,115, `display_value`
   * 34,107, `scale_frame` 5,803. Naming them here is what lets the projection
   * read them without an `as` that would hide a later rename.
   */
  readonly nodes: {
    id: string;
    kind: string;
    label: string;
    description?: string;
    display_value?: unknown;
    scale_frame?: unknown;
    provenance?: unknown;
    observed_state?: Record<string, unknown>;
    interventions?: Record<string, unknown>;
    changes?: unknown;
    /** The drafter's status-quo declaration, read only through `readIsBaseline` (`statusQuoOptionId`). */
    is_baseline?: unknown;
    data?: unknown;
  }[];
  /** `origin` is read only to recognise a repair-authored edge (`isRepairAuthoredOptionFactorEdge`). */
  readonly edges: {
    from: string;
    to: string;
    origin?: unknown;
    /** Whose link it is and how strong: read by the model context (C33) and the link-strength proposal and its write check. */
    provenance?: unknown;
    strength?: unknown;
    exists_probability?: unknown;
    effect_direction?: unknown;
    defaulted?: unknown;
  }[];
  readonly analysis_state: unknown;
  /** The persisted graph exactly as read — every top-level carrier, not only nodes/edges. */
  readonly raw: Record<string, unknown>;
}

const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/…$/, '').trim();

/**
 * ⛔ A HELD STATUS QUO GETS NO LEVELS (Paul's ruling; admission, MG #1838).
 *
 * An option that carries on as now is connected to the factors the other options
 * act on by repair edges with NO level: each factor stays at its starting value.
 * Readiness already excludes those edges from its level mapping. A level written
 * there is harmful, not harmless (RC): a later correction to the factor's starting
 * value would leave the status quo at the OLD figure, so "Maintain current
 * staffing" would silently model cutting staff.
 *
 * Returns `${optionId}::${factorId}` for every pair whose option→factor edges are
 * ALL repair-authored — the same test readiness applies (a pair with any ordinary
 * edge is mapped), through the ONE authority, never a copy of it.
 */
function heldStatusQuoPairs(g: Pick<GraphRead, 'nodes' | 'edges'>): ReadonlySet<string> {
  // WHICH option is the status quo is decided per option, by the ONE authority
  // `statusQuoOptionId` (the declared option first, else exactly one idiom label —
  // admission's own minting order; review of #1849, blocker 2, for why repair alone
  // is not enough). ⛔ It was label-only here, so a DECLARED "Keep £49 Pro Price" was
  // never held and one approval wrote £49 and 0 onto it (served d5d5839, #69 5832119174).
  // The REPAIR test is per PAIR, the granularity readiness uses (`analysis-ready.ts:780`
  // skips each repair edge on its own): a status quo the user has since linked to one
  // more factor keeps its other pairs held (review of #1849 at 1a32b120 — all-or-nothing
  // re-opened RC's harm).
  const id = statusQuoOptionId(g.nodes, g.edges);
  if (id === null) return new Set();
  const kinds = new Map(g.nodes.map((n) => [n.id, n.kind] as const));
  const repaired = new Set<string>();
  const ordinary = new Set<string>();
  for (const e of g.edges) {
    if (e.from !== id || kinds.get(e.to) !== 'factor') continue;
    (isRepairAuthoredOptionFactorEdge(e, kinds) ? repaired : ordinary).add(`${e.from}::${e.to}`);
  }
  return new Set([...repaired].filter((k) => !ordinary.has(k)));
}

/**
 * A factor's starting value in the user's own units (Codex 5810763729 item 1): `raw_value`
 * when the frame recorded one, else the model value multiplied back up by the cap, else the
 * value itself (an unframed factor stores native already). `undefined` when it holds none.
 */
function nativeStartingValue(os: { value?: unknown; raw_value?: unknown; cap?: unknown } | undefined): number | undefined {
  const model = typeof os?.value === 'number' ? os.value : undefined;
  const cap = typeof os?.cap === 'number' && os.cap > 0 ? os.cap : undefined;
  return typeof os?.raw_value === 'number' ? os.raw_value : model !== undefined && cap !== undefined ? model * cap : model;
}

/**
 * The range an option level on this factor is stored against — THE rule the level writer
 * divides by (`proposeOptionInterventions`): `observed_state.cap` when positive, else the
 * factor's stored `scale_frame` when above 1, else none (a level in 0..1 is stored as given).
 * One function, so the projection that reads a level back can never use a different range
 * from the write that stored it.
 */
function levelFrameOf(factor: { observed_state?: Record<string, unknown>; scale_frame?: unknown } | undefined): number | null {
  const cap = (factor?.observed_state ?? {}).cap;
  if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) return cap;
  const frame = factor?.scale_frame;
  return typeof frame === 'number' && Number.isFinite(frame) && frame > 1 ? frame : null;
}

/**
 * ⭐ WHAT EACH OPTION SETS, AS STORED (Canonical State RCA D1, #69 5833317225). `projectEntity`
 * showed values, units and ranges but no option levels, so `get_canonical_state` never told the
 * Agent what an option already sets: it quoted its own tool arguments and re-proposed levels
 * blind, and Paul's chat said £38k where the canvas held £39k. Each stored cell is returned in
 * the user's units by the writer's own range (`levelFrameOf`), with who set it. A cell with no
 * numeric value is left out, never shown as a zero.
 */
const byIdCache = new WeakMap<object, ReadonlyMap<string, GraphRead['nodes'][number]>>();
function byIdOf(g: Pick<GraphRead, 'nodes'>): ReadonlyMap<string, GraphRead['nodes'][number]> {
  let m = byIdCache.get(g);
  if (m === undefined) { m = new Map(g.nodes.map((n) => [n.id, n])); byIdCache.set(g, m); }
  return m;
}

export function projectOptionLevels(
  option: GraphRead['nodes'][number],
  factorsById: ReadonlyMap<string, GraphRead['nodes'][number]>,
): Record<string, unknown>[] {
  if (option.kind !== 'option' || option.interventions === null || typeof option.interventions !== 'object') return [];
  const out: Record<string, unknown>[] = [];
  for (const [factorId, raw] of Object.entries(option.interventions)) {
    const cell = (raw ?? {}) as { value?: unknown; source?: unknown };
    if (typeof cell.value !== 'number' || !Number.isFinite(cell.value)) continue;
    const factor = factorsById.get(factorId);
    const frame = levelFrameOf(factor);
    const unit = (factor?.observed_state ?? {}).unit;
    out.push({
      factor_id: factorId,
      ...(typeof factor?.label === 'string' && factor.label !== '' ? { factor: factor.label } : {}),
      level: frame === null ? cell.value : cell.value * frame,
      ...(typeof unit === 'string' && unit !== '' ? { unit } : {}),
      ...(typeof cell.source === 'string' && cell.source !== '' ? { set_by: cell.source } : {}),
    });
  }
  return out;
}

/**
 * ⭐ ONE PROJECTION of a persisted node into what the Agent is shown — used by
 * EVERY tool that hands the Agent entities.
 *
 * ⛔ It used to live inline in `get_canonical_state` while `build_model_from_brief`
 * kept its own `{label, kind, value}` list. An independent review ran both on the
 * same stored node — `{value: 0.45, raw_value: 9, unit: 'months', cap: 20}` — and
 * only one carried the figure. The route tells the Agent to answer from the BUILD
 * result, so the first reply every user sees quoted a normalised 0.45 and said the
 * unit was unknown. Two field lists will always drift; one cannot.
 */
export function projectEntity(n: GraphRead['nodes'][number]): Record<string, unknown> {
          // The carriers the persisted graph already holds. Reading them is not
          // enrichment — every one is a field the estate stores, and withholding
          // them made the Agent reconstruct from the prompt what canonical state
          // already knew.
          const os = (n.observed_state ?? {}) as Record<string, unknown>;
          const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
          const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
          // Value provenance is a DIFFERENT fact from entity provenance: who put
          // this NUMBER here, versus where the entity came from. Collapsing them
          // is how a system-read figure inherits a user's authority.
          const valueProvenance = {
            ...(str(os.source) ? { source: os.source } : {}),
            ...(str(os.extractionType) ? { extraction_type: os.extractionType } : {}),
          };
          return {
            // ⭐ THE ID. Without it the only way to act on an entity was a fuzzy
            // label match, which collides and cannot address two entities that
            // read alike.
            id: n.id,
            label: n.label,
            ...(n.description !== undefined ? { full_label: n.description } : {}),
            kind: n.kind,
            // A value only when one is actually stored. Absence is reported as
            // unknown rather than as a zero.
            value: num(os.value) ? os.value : null,
            // ⚠ EVERY FIELD BELOW IS OMITTED WHEN ABSENT, never nulled. A null
            // here reads to a model as a stated fact ("there is no unit") rather
            // than as silence, and the Agent would repeat it.
            ...(num(os.raw_value) ? { raw_value: os.raw_value } : {}),
            ...(str(n.display_value) ? { display_value: n.display_value } : {}),
            ...(str(os.unit) ? { unit: os.unit } : {}),
            // The scale carriers. A bare amount with none of these is not just
            // under-described, it is unanalysable downstream — the Agent needs to
            // see that to explain it.
            ...(num(os.cap) ? { cap: os.cap } : {}),
            ...(str(os.declared_scale) ? { declared_scale: os.declared_scale } : {}),
            ...(n.scale_frame === undefined ? {} : { scale_frame: n.scale_frame }),
            ...(Object.keys(valueProvenance).length === 0
              ? {}
              : { value_provenance: valueProvenance }),
            ...(n.provenance === undefined ? {} : { provenance: n.provenance }),
          };
        }

/**
 * ⭐ (B) WHAT THE AGENT NEEDS TO EXPLAIN THE MODEL HONESTLY — the goal as the user stated it, the limits they
 * set, whose each link is, and the ONE readiness verdict (C33 5838970895; ChatGPT 5839692762 B).
 *
 * Every value is a stored carrier passed through, never re-derived: the goal target through the ONE trio
 * reader (`pickGoalThresholdTrio`, raw figure only — never the normalised `goal_threshold`, which is the
 * constant 0.8 on every headroom-derived cap), limits from `goal_constraints` as stored, link strength and
 * provenance as stored. Readiness is `readinessViewOf` — the route's own admission verdict, in plain words.
 */
function projectModelContext(g: Pick<GraphRead, 'nodes' | 'edges' | 'raw' | 'analysis_state'>): Record<string, unknown> {
  const str = (v: unknown): v is string => typeof v === 'string' && v !== '';
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const labelOf = new Map(g.nodes.map((n) => [n.id, n.label] as const));
  const goals = g.nodes.filter((n) => n.kind === 'goal').map((n) => {
    const trio = pickGoalThresholdTrio(n as never) as { goal_threshold_raw?: number; goal_threshold_unit?: string };
    const frame = (n as { goal_threshold_frame?: unknown }).goal_threshold_frame;
    return {
      id: n.id,
      label: n.label,
      ...(trio.goal_threshold_raw === undefined ? {} : {
        target: {
          value: trio.goal_threshold_raw,
          ...(trio.goal_threshold_unit === undefined ? {} : { unit: trio.goal_threshold_unit }),
          ...(str(frame) ? { frame } : {}),
        },
      }),
    };
  });
  const limits = (Array.isArray(g.raw.goal_constraints) ? g.raw.goal_constraints : [])
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
    .filter((c) => str(c.operator) && num(c.value))
    .map((c) => ({
      // Named as the run-turn limit card names it (#1935): the node the limit sits on, joined by id; the row's
      // own label only when that node is absent — so the card and the Agent say the same words for one limit.
      on: (str(c.node_id) ? labelOf.get(c.node_id) : undefined) ?? (str(c.label) ? c.label : 'the goal'),
      operator: c.operator,
      value: c.value,
      ...(str(c.unit) ? { unit: c.unit } : {}),
      ...(str(c.provenance) ? { stated_by: c.provenance } : {}),
    }));
  const links = g.edges.map((e) => {
    const source = (e.provenance !== null && typeof e.provenance === 'object') ? (e.provenance as { source?: unknown }).source : e.provenance;
    const st = (e.strength !== null && typeof e.strength === 'object') ? e.strength as { mean?: unknown; std?: unknown } : undefined;
    return {
      from: e.from,
      to: e.to,
      ...(str(source) ? { source } : {}),
      ...(str(e.effect_direction) ? { direction: e.effect_direction } : {}),
      ...(st !== undefined && num(st.mean) ? { strength: { mean: st.mean, ...(num(st.std) ? { std: st.std } : {}) } } : {}),
      ...(num(e.exists_probability) ? { exists_probability: e.exists_probability } : {}),
      ...(e.defaulted === true ? { defaulted: true } : {}),
      ...(str(e.origin) ? { origin: e.origin } : {}),
    };
  });
  return {
    ...(goals.length === 1 ? { goal: goals[0] } : goals.length > 1 ? { goals } : {}),
    ...(limits.length > 0 ? { limits } : {}),
    links,
    readiness: readinessViewOf(g.raw),
    ...(earlierAnalysisOf(g.analysis_state) ?? {}),
  };
}

const pickKeys = (o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * ⛔ AN EARLIER ANALYSIS IS NOT PERMISSION TO RUN. The read route's `analysis_state.readiness` is a
 * PLACEHOLDER (`{status:'unknown', blockers:[]}`; an empty list the composer treats as "nothing blocking"),
 * so it is dropped here: whether a run may happen now is `readiness`, only. What the stored RESULT is — an
 * earlier run, current or stale — stays, named `earlier_analysis` so it is never read as admission.
 */
function earlierAnalysisOf(state: unknown): { analysis: Record<string, unknown> } | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  const { readiness: _placeholder, ...rest } = state as Record<string, unknown>;
  const kind = (rest.run_state as { kind?: unknown } | undefined)?.kind;
  return { analysis: { ...(typeof kind === 'string' ? { earlier_analysis: kind } : {}), ...rest } };
}

/**
 * ⭐ A STRENGTH WORD IS A BAND ON THE PRODUCT'S OWN THRESHOLDS (`INFLUENCE_BAND_THRESHOLDS`, the one table the
 * narration reads its "weak / moderate / strong" from). When a link must be SET to a band the user named, it is
 * set to that band's midpoint — derived from the thresholds, never a second table — and the preview says the
 * figure before the user approves it.
 */
const INFLUENCE_BAND_RANGE: Readonly<Record<InfluenceBand, readonly [number, number]>> = {
  weak: [0, INFLUENCE_BAND_THRESHOLDS.moderate],
  moderate: [INFLUENCE_BAND_THRESHOLDS.moderate, INFLUENCE_BAND_THRESHOLDS.strong],
  strong: [INFLUENCE_BAND_THRESHOLDS.strong, INFLUENCE_BAND_THRESHOLDS.veryStrong],
  'very strong': [INFLUENCE_BAND_THRESHOLDS.veryStrong, 1],
};
const bandMidpoint = (band: InfluenceBand): number => {
  const [lo, hi] = INFLUENCE_BAND_RANGE[band];
  return Math.round(((lo + hi) / 2) * 1000) / 1000;
};
const isInfluenceBand = (v: unknown): v is InfluenceBand => typeof v === 'string' && Object.hasOwn(INFLUENCE_BAND_RANGE, v);

/**
 * ⛔ A NAME SHARED BY TWO ACCEPTABLE TARGETS NAMES NEITHER.
 *
 * Every proposer resolved the Agent's label with a first match — `pool.find(writable)
 * ?? pool[0]` for values, `nodes.find(...)` for levels and links — so when two
 * factors share a label, the one that happens to come first in the stored node list
 * got the user's number, and the approval they were shown named only the label.
 * Nothing about the user's words chose it; array order did.
 *
 * The tool schemas carry labels only (`agent-tools.ts`: `factor_label`,
 * `option_label`, `from_label`, `to_label`; `additionalProperties: false`), but
 * `get_canonical_state` shows every entity's `id` (see `projectEntity`). So:
 *
 *   1. A string that IS a node id makes that node a candidate — the one way to
 *      address two entities that read alike (ids are unique; labels are not).
 *   2. An exact visible LABEL wins over a description match (unchanged).
 *   3. Among all candidates, exactly one acceptable node → it. MORE THAN ONE (two
 *      same-label factors, or an id that is also another factor's label) →
 *      `ambiguous`, with every candidate, and the caller proposes NOTHING for it.
 *   4. None acceptable → `other` (named, but e.g. a risk), or `none`.
 *
 * A label shared by a factor and a risk still resolves to the factor: only ONE of
 * them is acceptable, so nothing is guessed.
 */
type Resolution =
  | { readonly kind: 'one'; readonly node: GraphRead['nodes'][number] }
  | { readonly kind: 'ambiguous'; readonly candidates: GraphRead['nodes'] }
  | { readonly kind: 'other'; readonly node: GraphRead['nodes'][number] }
  | { readonly kind: 'none' };

function resolveNamed(
  g: Pick<GraphRead, 'nodes'>,
  requested: string,
  accept: (n: GraphRead['nodes'][number]) => boolean,
): Resolution {
  const byLabel = g.nodes.filter((n) => norm(n.label) === norm(requested));
  const pool = byLabel.length > 0 ? byLabel : g.nodes.filter((n) => norm(n.description) === norm(requested));
  const idHit = g.nodes.find((n) => n.id === requested);
  const candidates = idHit === undefined ? pool : [idHit, ...pool.filter((n) => n.id !== idHit.id)];
  const acceptable = candidates.filter(accept);
  if (acceptable.length > 1) return { kind: 'ambiguous', candidates: acceptable };
  if (acceptable.length === 1) return { kind: 'one', node: acceptable[0] };
  return candidates.length > 0 ? { kind: 'other', node: candidates[0] } : { kind: 'none' };
}

/** One name that matched more than one acceptable entity, with every candidate. */
type AmbiguousTarget = { readonly requested: string; readonly candidates: readonly Record<string, unknown>[] };

/** One ambiguous request, with what tells its candidates apart — the SAME projection as every other tool. */
function describeAmbiguity(g: Pick<GraphRead, 'nodes' | 'edges'>, requested: string, candidates: GraphRead['nodes']): AmbiguousTarget {
  const labelOf = new Map(g.nodes.map((n) => [n.id, n.label]));
  return {
    requested,
    candidates: candidates.map((n) => ({
      ...projectEntity(n),
      connected_to: [...new Set(g.edges.flatMap((e) =>
        e.from === n.id ? [labelOf.get(e.to)] : e.to === n.id ? [labelOf.get(e.from)] : []))]
        .filter((l): l is string => typeof l === 'string' && l !== '')
        .sort(),
    })),
  };
}

/** What the Agent is told to do about a name that matched more than one entity. */
const AMBIGUOUS_NOTE =
  'More than one entity in the model carries each name in ambiguous_targets, so NOTHING was proposed for it and no ' +
  'guess was made. Ask the user which one they mean, describing each candidate by what tells it apart (its full ' +
  'label, current value, what it is connected to), never by its id. Then propose again, passing that entity’s ' +
  '`id` exactly as given here in place of its label.';

/** The approval-facing disclosure of a name left out as ambiguous (empty when none was). */
function ambiguousClause(ambiguous: readonly AmbiguousTarget[]): string {
  if (ambiguous.length === 0) return '';
  return ` (left out, more than one entity is called this, so the user must say which: ${ambiguous.map((a) => `"${a.requested}"`).join('; ')})`;
}

export function createAgentCapabilities(
  dispatch: InternalDispatch,
  proposals: ProposalStore,
  /**
   * Construction needs a structured model call. It is injected rather than
   * imported so this module still has no provider of its own — and when it is
   * absent the tool REFUSES rather than pretending the model could not be built
   * for some modelling reason.
   */
  callStructured?: CallStructuredModel,
  /**
   * 'preview' is READ-ONLY. This is the innermost of three layers: the tools
   * are not declared, `dispatchTool` refuses the names, and these refuse too.
   * Defence in depth, because a single prompt sentence is not a boundary.
   */
  mode: 'full' | 'preview' = 'full',
  /**
   * ⭐ THE UI RENDERS THE ANALYSIS FROM `blocks` AND `analysis_ready`, NOT FROM
   * THE PROSE. Measured on the real browser transport at `2fd8cbba`: the turn
   * came back 200 with a correct verdict in `assistant_text` and
   * `blocks=none`, `analysis_ready.options=0` — so a user reading the page saw
   * the sentence and an empty results panel.
   *
   * The raw payload is handed to the ROUTE through this callback rather than
   * returned in the ToolResult, because the ToolResult is JSON-stringified
   * straight back into the model's context: a full analysis payload there
   * would cost thousands of tokens per hop and tell the model nothing its own
   * summary does not already say.
   *
   * `scenario_id`, `status` and `trigger` are what the run-turn coaching
   * contract (`runTurnCoaching`, CEE #1855) binds the run by: without them it
   * cannot tell that a run happened this turn, or that it was the automatic
   * first pass. No `trigger` ⇒ the user asked for the run.
   */
  onAnalysis?:(payload: { scenario_id: string; status: number; analysis_state?: unknown; analysis_ready?: unknown; blocks?: unknown[]; trigger?: 'auto_first_pass' }) => void,
  /**
   * ⭐ THE AUTOMATIC FIRST ANALYSIS (Paul, 5812069638), injected by the route so the run, its turn
   * deadline and its write accounting stay the route's. Absent → no automatic run (a unit test, or a
   * caller that does not want one). See `../first-analysis.ts` for the rules it enforces.
   */
  opts: {
    readonly firstAnalysis?: (input: FirstAnalysisInput) => Promise<FirstAnalysisOutcome>;
    /**
     * The pending actions on the scenario's LATEST answer row, as the session store returns them. The held
     * add-option proposal lives there (route-v2 minted it), so a `gmh_` approval is confirmed against what the
     * store actually holds — never against a copy this process remembered. Absent ⇒ a held approval refuses.
     */
    readonly readPendingActions?: (scenarioId: string) => Promise<readonly PendingAction[]>;
    /**
     * ⭐ ONE approved batch of option levels — each with the option → factor link it needs — as ONE atomic commit
     * (ChatGPT #70 5847200462): the product's own level writer, reached in-process (`commitOptionLevelsInProcess`).
     * All or nothing; answers like a system-event write (409 · 422 with `refusal.index` · 500 · 200 with `graph_hash`
     * and `model_version_receipt`). Absent ⇒ unavailable.
     */
    readonly commitOptionLevels?: (input: CommitOptionLevelsInput) => Promise<CommitOptionLevelsResult>;
  } = {},
): AgentCapabilities {
  const readOnly = mode === 'preview';
  const refuseReadOnly = (): ToolResult => ({
    ok: false, mutated: false, refusal: 'read_only_preview',
    detail: 'This preview cannot change the model. Nothing has been altered.',
  });
  /**
   * The first analysis THIS request ran, and the revision it ran on. Capabilities are created per
   * request, so this never outlives the build turn: a later explicit Run never sees it.
   */
  let firstAnalysisThisRequest: { readonly revisionHash: string; readonly result: ToolResult } | undefined;
  /**
   * ⛔ AN APPROVAL RUNS NOTHING — held here, by the server, not by the prompt.
   *
   * Paul's ruling (#63 5812069638): later edits and approvals never re-run unless
   * the user asks. Witnessed on served 8428207 (c19w, 5818452655): an approval in
   * words became `authorise_change` then `run_analysis` in ONE turn, and the reply
   * named a leader the typed claim withheld. Removing the prompt instruction was
   * not enough (re-gate of #1854: a reworded regression survived every test).
   *
   * Set when an approval in THIS request applied (or recovered) a change; read by
   * `runAnalysis`. Per request, like `firstAnalysisThisRequest`, so the NEXT
   * turn's explicit Run is never suppressed. ⚠ Known cost, priced: a user who
   * says "apply it and run it" in one message gets the approval plus a Run to
   * press, never an unrequested run — deciding "did they ask?" from their words
   * is a natural-language predicate this guard deliberately does not make.
   */
  let approvalAppliedThisRequest = false;
  /**
   * ⛔ ONE HELD OPTION PER APPROVAL — until the product's typed add-option carries several options in ONE hold
   * (Canonical #70 5841241418). Two holds offered together get NO approve button (an approval names exactly one
   * proposal), which is the "add all five → nothing to press" dead end of Paul's test. So the first option is
   * prepared and offered; a second in the same turn is refused in plain words, to be added once the first is approved.
   */
  let heldOptionThisRequest: string | undefined;
  /**
   * Normalise the read route's `graph_identity_hash` to the 64-hex value the
   * register route compares. `''` means "no identity to anchor to" — the route
   * returns `null` for an absent, unparseable or identity-empty graph — and
   * every caller below treats `''` as "send no expectation".
   *
   * A bare string is tolerated so this keeps working if the wire is ever
   * flattened; nothing is invented either way, because the envelope's `.value`
   * IS the comparison space.
   */
  const identityHashOf = (raw: unknown): string => {
    if (typeof raw === 'string') return raw;
    if (raw !== null && typeof raw === 'object') {
      const v = (raw as { value?: unknown }).value;
      if (typeof v === 'string') return v;
    }
    return '';
  };

  const readGraph = async (scenarioId: string): Promise<GraphRead | null> => {
    const r = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {});
    if (r.status !== 200) return null;
    const g = (r.json.graph ?? {}) as Record<string, unknown>;
    return {
      graph_hash: String(r.json.graph_hash ?? ''),
      // ⛔⛔ IT IS AN ENVELOPE OBJECT, NOT A STRING. The read route emits the
      // producer's own return value — `computeGraphIdentityHash(graph)`, type
      // `GraphIdentityHash | null` = `{kind, value, algorithm, ...}` — so the
      // `String(...)` this line used to do produced the literal
      // `"[object Object]"`, and once the register route enforced the field
      // EVERY frame write below would have been refused 409 and the user told a
      // competing writer had moved their model when none had. That is the exact
      // fabricated-concurrency claim this PR exists to remove, so it is fixed
      // here rather than tolerated. The register route compares the 64-hex
      // `.value` (`context/graph-cas-conflict.ts` extracts it), and accepts
      // either spelling; we send the value.
      graph_identity_hash: identityHashOf(r.json.graph_identity_hash),
      nodes: (g.nodes as GraphRead['nodes']) ?? [],
      edges: (g.edges as GraphRead['edges']) ?? [],
      analysis_state: r.json.analysis_state,
      raw: g,
    };
  };

  /**
   * ⭐ THE HELD ADD-OPTION (C52). The Agent adds an option through the product's own typed add-option
   * transaction: route-v2 builds option + decision→option edge + option→factor edges (+ the user's levels) as
   * ONE referee-checked batch and HOLDS it as a `graph_management_held_v1` pending under a deterministic
   * `gmh_` handle. Approval sends the UI's own confirm for that handle, and route-v2 commits the batch in ONE
   * write. So the Agent can no longer leave an option unlinked from the decision (Paul's test, 25 Sep).
   *
   * The hold is read from the session store's LATEST answer row — the same read route-v2's confirm makes —
   * so a `gmh_` approval is checked against what the store will actually confirm, never a remembered copy.
   */
  const liveHeldHold = async (scenarioId: string, ref: string): Promise<PendingAction | undefined> => {
    if (opts.readPendingActions === undefined) return undefined;
    const pendings = await opts.readPendingActions(scenarioId);
    return pendings.find((p) => p.chip_id === ref
      && p.action.kind === 'apply_proposed_change'
      && (p.action as { inline_patch?: { handler_id?: unknown } }).inline_patch?.handler_id === GM_HELD_HANDLER_ID
      && !isPendingActionExpired(p, Date.now()));
  };
  const heldOpsOf = (hold: PendingAction): readonly { op: string; path: string; value?: unknown }[] => {
    const ops = (hold.action as { inline_patch?: { operations?: unknown } }).inline_patch?.operations;
    return Array.isArray(ops) ? ops.filter((o): o is { op: string; path: string; value?: unknown } =>
      o !== null && typeof o === 'object' && typeof (o as { op?: unknown }).op === 'string' && typeof (o as { path?: unknown }).path === 'string') : [];
  };
  /** Every live held add-option, as the approval it awaits. A failed read lists none — never a guess. */
  const liveHeldAwaiting = async (scenarioId: string): Promise<{ proposal_id: string; public_label: string }[]> => {
    if (opts.readPendingActions === undefined) return [];
    let pendings: readonly PendingAction[];
    try { pendings = await opts.readPendingActions(scenarioId); } catch { return []; }
    return pendings
      .filter((p) => typeof p.chip_id === 'string' && /^gmh_[0-9a-f]{12}$/.test(p.chip_id)
        && p.action.kind === 'apply_proposed_change'
        && (p.action as { inline_patch?: { handler_id?: unknown } }).inline_patch?.handler_id === GM_HELD_HANDLER_ID
        && !isPendingActionExpired(p, Date.now()))
      .map((p) => ({ proposal_id: p.chip_id as string, public_label: resolveProposalRenderCopy(p.action as { kind: string; public_label?: string }).label }));
  };
  /** A level is set when the option's intervention for that factor carries a number (either stored shape). */
  const hasLevel = (node: { interventions?: unknown } | undefined, factorId: string): boolean => {
    const iv = (node?.interventions as Record<string, unknown> | undefined)?.[factorId];
    return typeof iv === 'number' || (iv !== null && typeof iv === 'object' && typeof (iv as { value?: unknown }).value === 'number');
  };
  /**
   * Confirm a held add-option exactly as the UI would: the hold's own chip id and its own public message,
   * verbatim, on the non-composer chip path (the route gate matches the exact copy; a paraphrase or a bare
   * "yes" would reach the edit model instead). Applied ONLY when THIS confirm's own response shows it AND the
   * store agrees: the response carries the applied model (`draft_graph`, which a refused hold omits) holding
   * every option the hold adds with its decision link, the model now stored is that one, the hold is consumed,
   * and the options are in the model with their decision links.
   *
   * ⛔ BOUND TO THIS RESPONSE, NOT TO WHAT THE MODEL NOW HOLDS (Canonical, #70 5841421182, condition 3). A writer
   * racing the confirm can land an option with the same deterministic id while route-v2 refuses the stale hold:
   * the model moved, the hold is gone and the id is present — and none of it is this write.
   */
  const confirmHeld = async (ctx: AgentToolContext, ref: string): Promise<ToolResult> => {
    let hold: PendingAction | undefined;
    try {
      hold = await liveHeldHold(ctx.scenario_id, ref);
    } catch {
      return { ok: false, mutated: false, refusal: 'not_found', proposal_id: ref,
        detail: 'The waiting change could not be read, so nothing was applied. Tell the user plainly and offer to try again.' };
    }
    if (hold === undefined) {
      return { ok: false, mutated: false, refusal: 'unknown_proposal', proposal_id: ref,
        detail: 'That change is no longer waiting (it expired, or the model changed since it was offered), so nothing was applied. Offer to prepare it again.' };
    }
    const before = await readGraph(ctx.scenario_id);
    if (before === null) return { ok: false, mutated: false, refusal: 'not_found', proposal_id: ref };
    const copy = resolveProposalRenderCopy(hold.action as { kind: string; public_label?: string; public_message?: string });
    const r = await dispatch('/orchestrate/v2/turn', {
      kind: 'message', turn_id: authorisationTurnId(`agent_confirm_held:${hold.id}`), scenario_id: ctx.scenario_id,
      stage: 'frame', turn_class: 'frame', source: 'chip', message: copy.message, chip: { id: ref },
    });
    const after = await readGraph(ctx.scenario_id);
    let stillHeld = true;
    try { stillHeld = (await liveHeldHold(ctx.scenario_id, ref)) !== undefined; } catch { stillHeld = true; }
    const heldOps = heldOpsOf(hold);
    // ⛔ A held batch may also ADD a factor (`new_factors`): only an option node is an option.
    const isFactorAdd = (o: { op: string; value?: unknown }): boolean => o.op === 'add_node' && (o.value as { kind?: unknown } | undefined)?.kind === 'factor';
    const optionIds = heldOps.filter((o) => o.op === 'add_node' && !isFactorAdd(o)).map((o) => o.path);
    const addedFactorIds = heldOps.filter(isFactorAdd).map((o) => o.path);
    // The decision link of each option, from the held batch itself (`decision::option`).
    const decisionLinks = heldOps.filter((o) => o.op === 'add_edge' && optionIds.some((id) => o.path.endsWith(`::${id}`)))
      .map((o) => o.path.split('::') as [string, string]);
    const holdsAll = (g: { nodes?: unknown; edges?: unknown } | null | undefined): boolean => {
      const nodes = Array.isArray(g?.nodes) ? g.nodes as { id?: unknown }[] : [];
      const edges = Array.isArray(g?.edges) ? g.edges as { from?: unknown; to?: unknown }[] : [];
      return optionIds.length > 0 && decisionLinks.length >= optionIds.length
        && optionIds.every((id) => nodes.some((x) => x?.id === id))
        && decisionLinks.every(([from, to]) => edges.some((e) => e?.from === from && e?.to === to));
    };
    const applied = r.status === 200 && r.json.draft_graph !== null && typeof r.json.draft_graph === 'object'
      && holdsAll(r.json.draft_graph as { nodes?: unknown; edges?: unknown });
    const verified = applied && after !== null && typeof r.json.graph_hash === 'string' && r.json.graph_hash === after.graph_hash
      && after.graph_hash !== before.graph_hash && !stillHeld && holdsAll(after);
    if (!verified) {
      return applied
        ? { ok: false, mutated: true, refusal: 'not_verified', proposal_id: ref,
          detail: 'The change was saved, but the model changed again straight afterwards, so what it now holds could not be confirmed. Read the model again before saying what it holds.' }
        : { ok: false, mutated: false, refusal: 'not_applied', proposal_id: ref,
          detail: 'The change was not saved (the model may have changed since it was offered). Tell the user plainly; do not describe it as added, and offer to prepare it again.' };
    }
    approvalAppliedThisRequest = true;
    const { summary, unreadable } = receiptSummaryOf(r.json);
    /**
     * ⛔ EVERY LABEL IS QUOTED (round-2 review of fix/agent-never-shows-instructions-or-codes, blocker 3). This follow-up
     * is shown verbatim on the one-click path, through the boundary that withholds anything addressed to the Agent
     * (`withoutAgentDirections`). A label is the user's data: quoted, it can never read as an instruction or a code —
     * unquoted, "Size of the user base", `cost_per_hire` or the id fallback below dropped both sentences.
     */
    const quoted = (label: string): string => `"${label}"`;
    const sentences = optionIds.map((id) => {
      const node = after!.nodes.find((x) => x.id === id) as { label?: unknown; interventions?: unknown } | undefined;
      const factorIds = after!.edges.filter((e) => e.from === id).map((e) => e.to)
        .filter((to) => after!.nodes.some((x) => x.id === to && x.kind === 'factor'));
      const labelOf = (fid: string): string => quoted(String(after!.nodes.find((x) => x.id === fid)?.label ?? fid));
      const unlevelled = factorIds.filter((fid) => !hasLevel(node, fid)).map(labelOf);
      // Whose each level is, from what was COMMITTED: Olumi's estimates are said as that (C2), never as the user's.
      const estimated = factorIds.filter((fid) => ((node?.interventions ?? {}) as Record<string, { source?: unknown } | undefined>)[fid]?.source === 'cee_hypothesis').map(labelOf);
      return `Added "${String(node?.label ?? id)}", linked from the decision and acting on ${factorIds.map(labelOf).join(', ')}.`
        + (estimated.length > 0 ? ` Its level for ${estimated.join(', ')} is Olumi's estimate, for you to correct.` : '')
        + (unlevelled.length > 0 ? ` It does not yet set a level for ${unlevelled.join(', ')}; tell me the figure for each and I'll set it.` : '');
    });
    for (const fid of addedFactorIds) {
      const f = after!.nodes.find((x) => x.id === fid);
      if (f === undefined) continue;
      const changes = after!.edges.filter((e) => e.from === fid).map((e) => quoted(String(after!.nodes.find((x) => x.id === e.to)?.label ?? e.to)));
      sentences.push(`Also added the factor "${String(f.label ?? fid)}", which changes ${changes.join(', ')}; how strongly is Olumi's estimate. `
        + 'Its current value is not set yet; tell me what it is today and I\'ll record it.');
    }
    return {
      ok: true, mutated: true, applied: true, outcome: 'applied', proposal_id: ref,
      receipts: summary !== null ? [summary] : [],
      ...(unreadable ? { receipt_unreadable: true } : {}),
      follow_up: sentences.join(' '),
    };
  };

  /**
   * ⛔ ONE APPROVAL MUST BE ABLE TO APPLY A WHOLE STARTING POINT — AND ONLY ONTO
   * THE MODEL THE USER APPROVED.
   *
   * Every proposal is bound to the model revision it was made against, so two
   * proposals offered together (starting values AND option levels) could never
   * both be applied from one "yes": applying the first superseded the second.
   * A compound proposal fixes that — and the first version of it (#1712 @
   * 3674539 / ecb45282) re-read the graph before each part and re-bound the
   * part to whatever it found. Independent review measured the consequence: an
   * UNRELATED edit between the approval and a write was absorbed, the approved
   * levels landed on a model the user never saw (a level shown as 7 FTE stored
   * as 70 after a re-frame), and the result said "applied".
   *
   * So the expected revision is CARRIED, never re-read-and-adopted:
   *   1. It starts at the parent-approved base — the exact read `authoriseChange`
   *      just authorised against, handed in here, not a second read.
   *   2. VALUES are applied IN MEMORY with the product's own
   *      `applyFactorValueEdit` (the inspector path's validator + handler +
   *      merge, unchanged), then written as ONE registration carrying
   *      `expected_graph_hash` = that base. `factor_value_edit` has no base on
   *      the wire (0.55, `.strict()`), so this is what makes the value write
   *      CONDITIONAL: the route refuses a moved model with nothing written, and
   *      the atomic RPC's CAS closes its own read→write window.
   *   3. The revision advances ONLY to the hash that registration reports for
   *      the bytes IT stored, and then to each CAS-gated
   *      `option_intervention_edit`'s own reported hash.
   *   4. Anything else stops the compound truthfully: `not_applied` with zero
   *      writes, or `partially_applied` naming exactly what landed.
   * The approved operations are applied verbatim. Nothing is regenerated.
   */
  const COMPOUND_ORDER = ['set_factor_value', 'set_option_intervention'] as const;
  const frameOf = (n: GraphRead['nodes'][number] | undefined): number | null => {
    const os = (n?.observed_state ?? {}) as { cap?: unknown };
    if (typeof os.cap === 'number' && os.cap > 0) return os.cap;
    if (typeof n?.scale_frame === 'number' && n.scale_frame > 0) return n.scale_frame;
    return null;
  };
  const applyCompound = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0],
    parent: StructuredProposal,
    approvedRead: GraphRead,
  ): Promise<ToolResult> => {
    const unsupported = parent.operations.filter((o) => !(COMPOUND_ORDER as readonly string[]).includes(o.op));
    if (unsupported.length > 0) {
      return { ok: false, mutated: false, refusal: 'unsupported_compound', detail: `This proposal mixes changes that cannot be applied together: ${[...new Set(unsupported.map((o) => o.op))].join(', ')}.` };
    }
    const notApplied = (reason: string, detail: string, extra: Record<string, unknown> = {}): ToolResult => ({
      ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id,
      refusal: 'not_applied', reason, detail, parts: [], receipts: [], ...extra,
    });
    // (1) The carried revision starts at what the user approved.
    if (approvedRead.graph_hash !== parent.base_graph_identity_hash) {
      return notApplied('model_changed_since_approval', 'The model changed after this was approved, so nothing was written. Read it again and propose afresh.');
    }
    const valueOps = parent.operations.filter((o) => o.op === 'set_factor_value');
    const levelOps = parent.operations.filter((o) => o.op === 'set_option_intervention');

    // (2) Values, in memory, through the product's own inspector path.
    let working: unknown = approvedRead.raw;
    for (let i = 0; i < valueOps.length; i += 1) {
      const o = valueOps[i];
      const v = (o.value ?? {}) as { value?: number; unit?: string };
      if (typeof v.value !== 'number') return notApplied('no_value_on_proposal', `No value was stored on the proposal for ${o.path}. Nothing was written.`);
      /**
       * ⛔ `raw_value` WAS DROPPED HERE (Codex 5810763729 items 3 and 5). The proposal
       * carries the user's NATIVE figure, so on a framed factor (`cap: 100`) the event
       * arrived as a bare `value: 50` and `factor-value-edit` — which inverts a bare
       * value with the factor's own stored cap — read it as 50 × 100.
       *
       * ⚠ ONLY WHEN THE FACTOR ALREADY HAS A CAP. An uncapped input is passed through
       * untouched: dividing or clamping it here would invent a frame the canonical
       * scale writer owns, and the block below is what gives an unframed amount its
       * range. This turns no relative change into an absolute set — `v.value` is
       * already the absolute figure the user approved.
       */
      const targetOs = ((((working as { nodes?: GraphRead['nodes'] }).nodes ?? [])
        .find((n) => n.id === o.path)?.observed_state) ?? {}) as { cap?: unknown };
      const targetCap = typeof targetOs.cap === 'number' && targetOs.cap > 0 ? targetOs.cap : undefined;
      const event = {
        kind: 'factor_value_edit' as const,
        target_id: o.path,
        ...(targetCap !== undefined
          ? { value: v.value / targetCap, raw_value: v.value }
          : { value: v.value }),
        ...(v.unit !== undefined && v.unit !== '' ? { unit: v.unit } : {}),
      };
      const res = await applyFactorValueEdit({
        payload: {
          kind: 'system_event',
          turn_id: authorisationTurnId(`${parent.proposal_id}#value${i}`),
          scenario_id: ctx.scenario_id,
          stage: 'frame',
          event,
        } as never,
        event: event as never,
        requestId: ctx.request_id,
        persistedGraph: working,
        priorFacts: [],
      });
      if (res.kind !== 'mutated') {
        const label = approvedRead.nodes.find((n) => n.id === o.path)?.label ?? o.path;
        return notApplied('value_refused', `The value for ${label} could not be recorded (${res.reason}), so nothing was written.`, { refused_factor: label });
      }
      working = res.mutatedGraph;
    }
    let workingNodes = ((working as { nodes?: GraphRead['nodes'] }).nodes ?? []).map((n) => ({ ...n }));
    // A value that landed as a bare amount above 1 gets a range from its own
    // figure — the same step the single-kind path takes after its write, done
    // here BEFORE the one write so it is part of what is conditional.
    const framed: { factor: string; value: number; range: number }[] = [];
    workingNodes = workingNodes.map((n) => {
      if (!valueOps.some((o) => o.path === n.id)) return n;
      if (typeof n.scale_frame === 'number' && n.scale_frame > 1) return n;
      const os = (n.observed_state ?? {}) as { value?: unknown; raw_value?: unknown; cap?: unknown };
      if (!(typeof os.value === 'number' && Math.abs(os.value) > 1 && typeof os.cap !== 'number')) return n;
      const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
      const range = defaultFrameFor(raw);
      if (range <= 1) return n;
      framed.push({ factor: n.label, value: raw, range });
      return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
    });
    // ⛔ A LEVEL IS A NUMBER ON ITS FACTOR'S FRAME. If this approval's own
    // values would give a level's factor a DIFFERENT frame from the one the
    // level was normalised against, the level would silently mean something
    // else (1.0 of 0-10 is 10, not the 1 the user was shown). Refuse first.
    const byIdAfterValues = new Map(workingNodes.map((n) => [n.id, n]));
    for (const o of levelOps) {
      const factorId = o.path.split('::')[1];
      const lv = (o.value ?? {}) as { cap?: number | null; derived_frame?: number | null };
      const levelFrame = typeof lv.cap === 'number' && lv.cap > 0 ? lv.cap : null;
      const factorFrame = frameOf(byIdAfterValues.get(factorId));
      if (factorFrame !== null && levelFrame !== null && factorFrame !== levelFrame) {
        return notApplied('level_frame_changed_by_values', `A level for ${byIdAfterValues.get(factorId)?.label ?? factorId} was proposed on a range this approval's own values would change. Nothing was written — propose again.`);
      }
      if (factorFrame !== null && levelFrame === null) {
        return notApplied('level_frame_changed_by_values', `A level for ${byIdAfterValues.get(factorId)?.label ?? factorId} was proposed before it had a range that this approval would give it. Nothing was written — propose again.`);
      }
    }
    // Derived level frames on factors that hold a value and still have no
    // range — the same attachment the single-kind level path makes.
    workingNodes = workingNodes.map((n) => {
      const op = levelOps.find((o) => o.path.split('::')[1] === n.id && typeof ((o.value ?? {}) as { derived_frame?: unknown }).derived_frame === 'number');
      if (op === undefined || frameOf(n) !== null) return n;
      const range = ((op.value ?? {}) as { derived_frame: number }).derived_frame;
      const os = (n.observed_state ?? {}) as { value?: number; raw_value?: number };
      const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
      if (typeof raw !== 'number' || range <= 1) return n;
      framed.push({ factor: n.label, value: raw, range });
      return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
    });
    /**
     * ⛔ AN ADOPTED ASSUMPTION IS STORED AS AN ASSUMPTION, NOT AS THE USER'S OWN
     * FIGURE (panel #63 5811761386 item 6). `applyFactorValueEdit` stamps
     * `USER_EDIT_SOURCE` (the user's-own-figure stamp) because the inspector it was built for
     * is where the user TYPES the number. Registered as-is, one "yes" to Olumi's
     * proposed values stored them as the user's own: "User edited" in the UI,
     * `user_stated` to the readiness authority — and a single such parameter
     * licenses a comparative-leader claim (`analysis-admission.ts`).
     *
     * `user_assumption` is the contract's own literal for it (0.55
     * `OBSERVED_STATE_SOURCE_LITERALS`; CEE's `ObservedStateV3` accepts it; the UI
     * labels it "Your assumption"; `obligation-provenance.ts` classifies it
     * `user_ratified` — a human act, not authorship). Nothing is invented and no
     * measurement is claimed. This path can stamp it because THIS capability
     * composes the registered bytes. A USER-authored proposal keeps the writer's
     * stamp — decided PER VALUE (`valueOpAuthor`). The single-kind `set_factor_value` path
     * reaches the same stamp at the writer, through the approved-adoption context.
     */
    workingNodes = workingNodes.map((n) => {
      if (!valueOps.some((o) => o.path === n.id && valueOpAuthor(o, parent) === 'model_proposed')) return n;
      const os = n.observed_state;
      if (os === undefined || typeof os.value !== 'number') return n;
      return { ...n, observed_state: { ...os, source: ADOPTED_ASSUMPTION_SOURCE } };
    });

    // ONE conditional write for every value (and any range they need).
    const receipts: ReceiptSummary[] = [];
    let valuesLanded = false;
    let carried = parent.base_graph_identity_hash;
    if (valueOps.length > 0 || framed.length > 0) {
      const operationId = authorisationTurnId(`${parent.proposal_id}#values`);
      const reg = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
        graph: { ...(working as Record<string, unknown>), nodes: workingNodes },
        expected_graph_hash: carried,
        /**
         * ⭐ AND THE IDENTITY EXPECTATION, from the SAME read these bytes come from (`approvedRead`), as the frame
         * writes send it. A rename that lands between that read and the route's own is outside the analysis
         * projection, so only this refuses it; without it the whole-graph write restores the stale label
         * (Canonical 5844410312; the #1743 counterexample #1810 closed for the frame writes).
         */
        ...(approvedRead.graph_identity_hash !== '' ? { expected_graph_identity_hash: approvedRead.graph_identity_hash } : {}),
        operation_id: operationId,
      });
      if (reg.status !== 200) {
        const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
        return notApplied(
          code === 'GRAPH_STALE' ? 'model_changed_since_approval' : 'values_not_written',
          code === 'GRAPH_STALE'
            ? 'The model changed after this was approved, so nothing was written. Read it again and propose afresh.'
            : `The values could not be saved (http ${reg.status}). Nothing was written.`,
        );
      }
      valuesLanded = true;
      const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
      if (mv !== undefined && typeof mv.version_id === 'string') {
        receipts.push({
          version: Number(mv.version_number), version_id: mv.version_id,
          mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '',
          source_turn_id: registrationTurnId(ctx.scenario_id, operationId),
        } as ReceiptSummary);
      }
      const next = reg.json.graph_hash;
      if (typeof next !== 'string' || next.length === 0) {
        // No authoritative revision for our own write: we cannot prove the next
        // CAS base, so no level is written on a guess.
        return {
          ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id,
          refusal: levelOps.length > 0 ? 'partially_applied' : 'not_applied',
          detail: 'The values were saved; the option levels were not written because the saved revision could not be confirmed.',
          parts: [{ part: 'values', ok: true, recorded_count: valueOps.length, requested_count: valueOps.length }, ...(levelOps.length > 0 ? [{ part: 'option_levels', ok: false, recorded_count: 0, requested_count: levelOps.length }] : [])],
          receipts,
        };
      }
      carried = next;
    }

    // (3) Levels, each CAS-gated on the revision our OWN previous write produced.
    let levelsRecorded = 0;
    let levelStop: string | null = null;
    for (let i = 0; i < levelOps.length; i += 1) {
      const o = levelOps[i];
      const [optionId, factorId] = o.path.split('::');
      const v = ((o.value ?? {}) as { normalised?: number }).normalised;
      if (typeof v !== 'number') { levelStop = `no level was stored on the proposal for ${o.path}`; break; }
      const r = await writeLevelAs(
        levelOpAuthor(o, parent),
        { scenarioId: ctx.scenario_id, proposalId: parent.proposal_id, optionId, factorId, modelValue: v },
        () => dispatch('/orchestrate/v2/turn', {
          kind: 'system_event',
          turn_id: authorisationTurnId(`${parent.proposal_id}#level${i}`),
          scenario_id: ctx.scenario_id,
          stage: 'frame',
          event: { kind: 'option_intervention_edit', option_id: optionId, factor_id: factorId, value: v, base_graph_hash: carried },
        }),
      );
      if (r.status !== 200) { levelStop = `the level for ${o.path} was refused (http ${r.status})`; break; }
      const rc = receiptSummaryOf(r.json);
      if (rc.summary !== null) receipts.push(rc.summary);
      const next = r.json.graph_hash;
      if (typeof next === 'string' && next.length > 0) {
        carried = next;
        levelsRecorded += 1;
        continue;
      }
      // A 200 with no revision committed nothing. It is either a verified no-op
      // (the model already holds exactly this level) or a refusal. A read tells
      // them apart — it VERIFIES, it never adopts: a revision other than the
      // carried one means someone else changed the model, and we stop.
      const check = await readGraph(ctx.scenario_id);
      const held = check?.nodes.find((n) => n.id === optionId)?.interventions?.[factorId] as { value?: unknown } | number | undefined;
      const heldValue = typeof held === 'number' ? held : (held as { value?: unknown } | undefined)?.value;
      /**
       * ⛔ HELD EXACTLY IS RECORDED; THE REVISION ONLY DECIDES WHETHER THE CHAIN GOES ON (round-2 review of
       * fix/agent-never-shows-instructions-or-codes, blocker 2's class). This checked the revision FIRST, so when another
       * writer had moved the model a level the model holds exactly as approved was counted as not recorded, and the
       * user read that it was not saved. The rule is the link writer's: the read-back holding exactly the approved level
       * is landed. A moved model still gives no revision to carry, so no FURTHER level is written on a guess.
       */
      if (check === null) { levelStop = 'the model changed while the option levels were being recorded'; break; }
      const moved = check.graph_hash !== carried;
      if (heldValue !== v) { levelStop = moved ? 'the model changed while the option levels were being recorded' : `the level for ${o.path} was not recorded`; break; }
      levelsRecorded += 1;
      if (moved && i < levelOps.length - 1) { levelStop = 'the model changed while the option levels were being recorded'; break; }
    }

    const all = levelStop === null && levelsRecorded === levelOps.length;
    if (all) proposals.markApplied(parent.proposal_id, receipts);
    const parts = [
      ...(valueOps.length > 0 ? [{ part: 'values', ok: valuesLanded, recorded_count: valuesLanded ? valueOps.length : 0, requested_count: valueOps.length }] : []),
      ...(levelOps.length > 0 ? [{ part: 'option_levels', ok: levelStop === null, recorded_count: levelsRecorded, requested_count: levelOps.length }] : []),
    ];
    return {
      ok: all,
      mutated: valuesLanded || levelsRecorded > 0,
      applied: all,
      proposal_id: parent.proposal_id,
      parts,
      receipts,
      revision_before: parent.base_graph_identity_hash,
      revision_after: carried,
      ...(framed.length > 0 ? { ranges_added_for_analysis: framed } : {}),
      ...(all
        ? {
            not_represented:
              `${valueAuthorshipNote(valueOps, parent, (id) => approvedRead.nodes.find((n) => n.id === id)?.label ?? id)} ` +
              (parent.provenance.authored_by === 'model_proposed'
                ? 'The option levels are the user\u2019s adopted assumptions too, not measurements, but carry no such mark \u2014 '
                : 'The option levels are the user\u2019s own figures too \u2014 ') +
              'say so when you describe what changed.',
          }
        : {
            refusal: valuesLanded || levelsRecorded > 0 ? 'partially_applied' : 'not_applied',
            detail: `${levelStop ?? 'Not every change was recorded'}. Tell the user exactly which part was recorded and which was not.`,
          }),
    };
  };
  /**
   * ⛔ A STARTING POINT MUST COVER EVERY FACTOR EACH OPTION ACTS ON.
   *
   * MEASURED on served 63cf4dcf (journey witness, direct transport): the
   * starting point gave "Stage Hiring After Review" ONE level, but the option is
   * wired to three factors; readiness blocks the comparison on every unset
   * (option, linked factor) pair (`missing_value`), so "one approval -> first
   * comparison" needed a second approval. Across six served journeys only two
   * were fully analysable after one approval.
   *
   * Deterministic, from the SAME reader the write and the proposer use
   * (`linkedFactorsOf`): the pairs still lacking a level after this proposal
   * would apply. The values themselves are never invented here — the Agent is
   * told which pairs to propose before it shows the user anything.
   */
  const missingPairs = async (ctx: AgentToolContext, levelPaths: ReadonlySet<string>): Promise<{ option: string; factor: string }[] | null> => {
    const g = await readGraph(ctx.scenario_id);
    if (g === null) return null;
    const held = heldStatusQuoPairs(g);
    const missing: { option: string; factor: string }[] = [];
    for (const o of g.nodes.filter((n) => n.kind === 'option')) {
      const has = (o.interventions ?? {}) as Record<string, unknown>;
      for (const f of linkedFactorsOf(g as never, o.id)) {
        if (has[f.id] !== undefined || levelPaths.has(`${o.id}::${f.id}`)) continue;
        // A held status quo is complete with no level (`heldStatusQuoPairs`).
        if (held.has(`${o.id}::${f.id}`)) continue;
        missing.push({ option: o.label, factor: String(f.label ?? f.id) });
      }
    }
    return missing;
  };
  /**
   * ⭐ WHAT THE ONE VERDICT WOULD SAY IF THIS WERE APPROVED (served ef99a97 / cb1778b: a starting point that filled
   * every level but made two options identical — the user's one approval led straight to "nothing to compare").
   * The stored graph with the proposal's levels (and value presence) applied, read by the SAME `readinessViewOf`.
   * A preview for the Agent's words only; nothing here is written.
   */
  const readinessIfApplied = async (ctx: AgentToolContext, ops: readonly ProposalOperation[]): Promise<ReturnType<typeof readinessViewOf>> => {
    const g = await readGraph(ctx.scenario_id);
    if (g === null) return readinessViewOf(undefined);
    const raw = JSON.parse(JSON.stringify(g.raw)) as { nodes?: { id?: unknown; interventions?: unknown; observed_state?: Record<string, unknown> }[] };
    const byId = new Map((raw.nodes ?? []).map((n) => [String(n.id), n] as const));
    for (const o of ops) {
      if (o.op === 'set_option_intervention') {
        const [optionId, factorId] = o.path.split('::') as [string, string];
        const v = (o.value as { normalised?: unknown } | undefined)?.normalised;
        const n = byId.get(optionId);
        if (n !== undefined && typeof v === 'number') n.interventions = { ...((n.interventions ?? {}) as Record<string, unknown>), [factorId]: { value: v } };
      } else if (o.op === 'set_factor_value') {
        const n = byId.get(o.path);
        const v = (o.value as { value?: unknown } | undefined)?.value;
        const cap = n?.observed_state?.cap;
        if (n !== undefined && typeof v === 'number') {
          // Stored against the factor's range when it has one; the verdict reads presence and range, never this figure's meaning.
          const stored = typeof cap === 'number' && cap > 0 ? v / cap : v <= 1 ? v : 1;
          n.observed_state = { ...(n.observed_state ?? {}), value: stored };
        }
      }
    }
    return readinessViewOf(raw);
  };
  /**
   * What the Agent must say BEFORE the approval when the preview still blocks: the verdict's own words — the
   * user's demands, else the refusal's `reason` (the run path's `blockedNextStep`) — never an example that may not
   * fit this model (#1957 review: a one-option model was told to ask about "identical options").
   */
  const stillBlockedNote = (v: ReturnType<typeof readinessViewOf>): string => {
    if (!v.checked || v.may_run !== false) return '';
    const why = [...v.needs_from_user.map((i) => i.message), ...(v.needs_from_user.length === 0 && v.reason !== undefined ? [withoutCantRunOpening(v.reason)] : [])]
      .map((m) => m.trim().replace(/\.+$/, ''))
      .filter((m) => m !== '');
    return ` Even after this approval the analysis could still not run: ${why.length > 0 ? why.join('. ') : 'the model would still be blocked'}. `
      + 'Say so plainly BEFORE asking for approval, and ask the user for what this cannot settle — never invent a difference or a figure.';
  };
  const levelPathsOf = (ps: readonly StructuredProposal[]): Set<string> =>
    new Set(ps.flatMap((p) => p.operations).filter((o) => o.op === 'set_option_intervention').map((o) => o.path));
  /**
   * ⛔ COMPLETENESS IS AN ADMISSION RULE, NOT A NOTE — independent review of
   * #1719 at d00727aa: reporting the missing pairs AFTER storing an approvable
   * proposal let a model that ignored the note ask the user to approve an
   * incomplete set, and the user still needed a second approval. So an
   * incomplete starting point leaves NOTHING approvable.
   */
  const incompleteStartingPoint = (missing: { option: string; factor: string }[], extra: Record<string, unknown>): ToolResult => ({
    ok: false, mutated: false, refusal: 'incomplete_starting_point',
    options_missing_levels: missing,
    ...extra,
    detail:
      'Nothing is awaiting approval. A starting point must give a level for EVERY factor each option acts on, and the pairs in ' +
      'options_missing_levels have none. Call propose_starting_point again with the same values and levels PLUS a level for each ' +
      'pair (in the factor\u2019s own units, as an assumption to correct), then show the user that one proposal.' +
      (Array.isArray(extra.levels_not_accepted) && extra.levels_not_accepted.length > 0
        ? ' Some levels you DID give were not accepted: levels_not_accepted says which and why. Correct each one as its reason ' +
          'says. Re-sending the same value will be refused again.'
        : ''),
  });

  /**
   * A newer starting point REPLACES the caller's earlier unapproved one, so
   * "if exactly one is awaiting approval, authorise THAT" always names the
   * latest set the user was shown. Only starting points are replaced; an
   * ordinary single proposal is never discarded here.
   */
  const replaceEarlierStartingPoints = (ctx: AgentToolContext): void => {
    for (const o of proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id)) {
      const p = proposals.get(o.proposal_id);
      if (p !== undefined && p.provenance.basis === STARTING_POINT_BASIS) proposals.discard(o.proposal_id);
    }
  };

  const caps: AgentCapabilities = {
    async getCanonicalState(ctx: AgentToolContext): Promise<ToolResult> {
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      return {
        ok: true,
        mutated: false,
        graph_revision: g.graph_hash,
        empty: g.nodes.length === 0,
        entities: g.nodes.map((n) => {
          // What each option already sets, as stored (RCA D1): quote these, never your own earlier arguments.
          const levels = projectOptionLevels(n, byIdOf(g));
          return levels.length > 0 ? { ...projectEntity(n), levels } : projectEntity(n);
        }),
        existing_links: g.edges.map((e) => `${e.from} -> ${e.to}`),
        // Derived by traversal of the persisted graph — facts, not estimates,
        // and the Agent may state them to the user as facts. Without these it
        // has to infer topology from an edge list, and measurably does it worse
        // than the product it is being compared against.
        structure: structuralFacts(g.nodes, g.edges),
        // (B) goal target, limits, links, the ONE readiness verdict, and the earlier analysis kept apart from it.
        ...projectModelContext(g),
        // Every proposal this user has been shown and not yet approved, newest
        // first — including a held add-option, which lives in the session store,
        // not in memory. An approval with nothing to bind to is an approval that
        // silently does nothing.
        awaiting_your_approval: [...await liveHeldAwaiting(ctx.scenario_id), ...proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id)],
      };
    },

    /**
     * ⭐ CHALLENGE → AUTHORISED REVISION. The user says how strong an existing link is; ONE change records it as
     * theirs, through the product's own link writer (`edge_strength_edit`) on approval. Served (F) row F8 on
     * `319dde1`: without this the Agent answered "I could not record 'strong' separately".
     */
    async proposeLinkStrength(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      if (!isInfluenceBand(args?.strength)) {
        return { ok: false, mutated: false, refusal: 'unreadable_strength',
          detail: 'The strength must be one of: weak, moderate, strong, very strong. Nothing was prepared; ask the user which.' };
      }
      const band = args.strength;
      // ⛔ Recorded as the user's only when the user named the band (`bandTheUserWrote`); the writer stamps it as theirs.
      if (!bandTheUserWrote(band, ctx.user_turn_text)) {
        return { ok: false, mutated: false, refusal: 'strength_not_stated',
          detail: `The user has not called this link ${band} in this message, in their own words, so nothing was prepared: it would be recorded as their estimate. `
            + 'Ask them how strong they think it is \u2014 weak, moderate, strong or very strong \u2014 and never offer a band as theirs.' };
      }
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const fromRes = resolveNamed(g, String(args.from_label ?? ''), () => true);
      const toRes = resolveNamed(g, String(args.to_label ?? ''), () => true);
      const ambiguousEnds = [
        ...(fromRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(args.from_label ?? ''), fromRes.candidates)] : []),
        ...(toRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(args.to_label ?? ''), toRes.candidates)] : []),
      ];
      if (ambiguousEnds.length > 0) {
        return { ok: false, mutated: false, refusal: 'ambiguous_entity', ambiguous_targets: ambiguousEnds, ambiguous_note: AMBIGUOUS_NOTE,
          detail: 'Nothing was proposed: more than one entity carries that name.' };
      }
      const from = fromRes.kind === 'one' ? fromRes.node : undefined;
      const to = toRes.kind === 'one' ? toRes.node : undefined;
      if (from === undefined || to === undefined) {
        return { ok: false, mutated: false, refusal: 'unresolved_entity',
          detail: `No entity is labelled "${from === undefined ? args.from_label : args.to_label}". Read the state again and use a label exactly as it appears.` };
      }
      const edge = g.edges.find((e) => e.from === from.id && e.to === to.id);
      if (edge === undefined) {
        return { ok: false, mutated: false, refusal: 'no_such_link',
          detail: `The model has no link from "${from.label}" to "${to.label}", so there is no strength to record. Nothing was prepared. `
            + 'If the user wants that link, offer to add it with propose_model_change.' };
      }
      const mean = (edge.strength !== null && typeof edge.strength === 'object') ? (edge.strength as { mean?: unknown }).mean : undefined;
      if (typeof mean !== 'number' || !Number.isFinite(mean)) {
        return { ok: false, mutated: false, refusal: 'unreadable_link', detail: 'That link carries no readable strength, so nothing was prepared. Tell the user plainly.' };
      }
      const current: 'positive' | 'negative' = edge.effect_direction === 'negative' || edge.effect_direction === 'positive'
        ? edge.effect_direction : (mean < 0 ? 'negative' : 'positive');
      const wanted = args.direction === 'positive' || args.direction === 'negative' ? args.direction : current;
      const currentBand = bandFromMagnitude(Math.abs(mean));
      // Already in the band the user named, pushing the same way: KEEP the figure, record it as theirs.
      const confirm = currentBand === band && wanted === current;
      const magnitude = confirm ? Math.abs(mean) : bandMidpoint(band);
      const value = {
        magnitude,
        intent: confirm ? 'confirm_current' : 'set',
        direction_intent: confirm || args.direction === undefined ? 'preserve' : wanted,
        expected: { mean, effect_direction: current },
      };
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations: [{ op: 'update_edge', path: `${from.id}::${to.id}`, value }],
        provenance: { authored_by: 'user_stated', basis: String(args.rationale ?? '') },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: confirm
          ? `Record "${from.label}" \u2192 "${to.label}" as ${band}, as your own estimate (strength kept at ${Math.abs(mean)})`
          : `Record "${from.label}" \u2192 "${to.label}" as ${band} (${magnitude} on Olumi's 0\u20131 scale), as your own estimate${wanted !== current ? `, pushing ${wanted === 'positive' ? 'up' : 'down'}` : ''}`,
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        link: { from: from.label, to: to.label, was: { band: currentBand, strength: Math.abs(mean), direction: current },
          becomes: { band, strength: magnitude, direction: wanted }, keeps_current_strength: confirm },
        note: confirm
          ? 'Nothing has changed yet. The link already sits in that band, so its strength is kept and only recorded as the user\u2019s own. Say so, never the id, and call authorise_change with this proposal_id once they agree.'
          : `Nothing has changed yet. Tell the user it will be recorded as ${band}, which Olumi stores as ${magnitude} on its 0\u20131 strength scale, as their own estimate — never the id — and call authorise_change with this proposal_id once they agree.`,
      };
    },

    async proposeModelChange(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      // ⛔ Two entities answering to one name: nothing is proposed, and the Agent asks
      // (`resolveNamed`). An id is identity; a label beats a description.
      const fromRes = resolveNamed(g, String(args.from_label ?? ''), () => true);
      const toRes = resolveNamed(g, String(args.to_label ?? ''), () => true);
      const ambiguousEnds = [
        ...(fromRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(args.from_label ?? ''), fromRes.candidates)] : []),
        ...(toRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(args.to_label ?? ''), toRes.candidates)] : []),
      ];
      if (ambiguousEnds.length > 0) {
        return {
          ok: false, mutated: false, refusal: 'ambiguous_entity',
          ambiguous_targets: ambiguousEnds, ambiguous_note: AMBIGUOUS_NOTE,
          detail: 'Nothing was proposed: more than one entity carries that name.',
        };
      }
      const from = fromRes.kind === 'one' ? fromRes.node : undefined;
      const to = toRes.kind === 'one' ? toRes.node : undefined;
      if (from === undefined || to === undefined) {
        return {
          ok: false, mutated: false, refusal: 'unresolved_entity',
          detail: `No entity is labelled "${from === undefined ? args.from_label : args.to_label}". Read the state again and use a label exactly as it appears.`,
        };
      }
      if (g.edges.some((e) => e.from === from.id && e.to === to.id)) {
        return { ok: false, mutated: false, refusal: 'already_present', detail: 'That link is already in the model.' };
      }
      /**
       * ⛔ A NEW LINK CARRIES ONLY THE BAND THE USER TYPED THIS TURN (Delivery Lead #70 5845493088, agreed by Canonical
       * 5845487856: "The Agent proposes a link only with the band the user typed THIS turn … With no band it asks 'how
       * strong…?'. The user_specified stamp is then TRUE."). The link writer stamps every link it adds `user_specified`
       * (`structural-add-edge.ts`), so the strength sent with it is recorded as the user's own estimate. Before this, an
       * approval sent a fixed 0.5 and Olumi's placeholder read as the user's figure.
       *
       * The band must be named in THIS turn's typed words by the one matcher `propose_link_strength` uses
       * (`bandTheUserWrote` — the same band words, negations and question rules, never a second copy), and it is sent as
       * that band's midpoint (`bandMidpoint`). Checked after the refusals above, so the user is never asked how strong a
       * link that cannot be added is.
       */
      const band = isInfluenceBand(args?.strength) ? args.strength : undefined;
      if (band === undefined || !bandTheUserWrote(band, ctx.user_turn_text)) {
        const ask = 'ask them "how strong is that effect: weak, moderate, strong or very strong?" and never offer a band as theirs.';
        return { ok: false, mutated: false, refusal: 'strength_not_stated',
          detail: band === undefined
            ? `${args?.strength === undefined ? 'No strength was given' : 'The strength given is not one of weak, moderate, strong or very strong'}, so nothing was prepared. `
              + `If the user named one of those bands for this link in this message, call again with it as strength; otherwise ${ask}`
            : `The user has not called the link from "${from.label}" to "${to.label}" ${band} in this message, in their own words, so nothing was prepared: `
              + `it would be recorded as their estimate. Instead, ${ask}` };
      }
      const magnitude = bandMidpoint(band);
      const operations: ProposalOperation[] = [
        { op: 'add_edge', path: `${from.id}::${to.id}`, value: { effect_direction: args.direction, magnitude } },
      ];
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: { authored_by: 'model_proposed', basis: args.rationale },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: `Connect "${from.label}" to "${to.label}" (${args.direction}) as ${band}, your own estimate`,
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        link: { from: from.label, to: to.label, direction: args.direction, band, strength: magnitude },
        note: `Nothing has changed. Tell the user the link will be recorded as ${band}, which Olumi stores as ${magnitude} on its 0\u20131 strength scale, as their own estimate — never the id — and ask them to approve it before calling authorise_change.`,
      };
    },

    /**
     * ⭐ ADOPTING ASSUMPTIONS IS A PROPOSAL, NOT A WRITE.
     *
     * The gap, measured on Paul's session of 22 Sep: 17 of 20 factors held no
     * value, the Agent listed sensible starting assumptions in prose, the user
     * replied "these look like a good set of assumptions, can you update the
     * model with them?" — and the turn came back `mutated: false` with
     * `[get_canonical_state]` as its only tool call. Honest, and inert.
     *
     * The dishonest fix is the one the incumbent already ships: invent the
     * numbers during construction and attribute them to the system. The honest
     * one is this — the model SUGGESTS, the user ADOPTS, and the adoption goes
     * through the same stored-proposal/authorise boundary as any other change,
     * so what gets written is exactly what was shown.
     *
     * ⛔ It will not overwrite a value that is already there. A factor that
     * already carries a number was set by somebody; replacing it with a guess
     * under cover of "adopting assumptions" is the failure this refuses.
     */
    async proposeAssumptions(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const input = Array.isArray(args?.assumptions) ? args.assumptions : [];
      if (input.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: 'No assumptions were given.' };
      }

      /**
       * ⛔ ONLY A NODE THE VALUE WRITER ACCEPTS CAN BE PROPOSED A VALUE — the writer's own rule,
       * imported (`SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS`), never a copy. Served `778f1fd`
       * (witness c7a, 24 Sep 03:05Z): a value proposed for a RISK node matched by label was
       * refused at write (`entity_kind_mismatch_at_execute`) and the whole approval landed
       * nothing. A label shared by a factor and another node resolves to the factor.
       */
      const writable = (n: { kind?: unknown }) => SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS.includes(String(n.kind));
      // An exact visible LABEL wins over a description match (a factor's description must never
      // take a value the user named for a risk); among equal matches, the ONE writable kind wins —
      // and two writable matches are AMBIGUOUS, never "the first" (see `resolveNamed`).
      const unresolved: string[] = [];
      const notAFactor: { label: string; kind: string }[] = [];
      const ambiguous: AmbiguousTarget[] = [];
      const occupied: { label: string; current_value: number }[] = [];
      const unitMismatch: { label: string; value: unknown; unit: string; factor_unit: string }[] = [];
      const seen = new Set<string>();
      const adopted: { id: string; label: string; value: number; unit: string; basis: string; replaces?: number; userWrote: boolean }[] = [];

      for (const a of input) {
        const requested = String(a?.factor_label ?? '');
        const res = resolveNamed(g, requested, writable);
        if (res.kind === 'none') { unresolved.push(requested); continue; }
        // ⛔ Two writable factors answer to this name: no op for it, and the Agent asks.
        if (res.kind === 'ambiguous') {
          if (!ambiguous.some((x) => x.requested === requested)) ambiguous.push(describeAmbiguity(g, requested, res.candidates));
          continue;
        }
        if (res.kind === 'other') { notAFactor.push({ label: res.node.label, kind: String(res.node.kind) }); continue; }
        const node = res.node;
        // ⛔ A figure in another kind of unit is never this factor's value (`unit-conflict.ts`): left out, and said.
        const nodeUnit = factorUnitOf(g.raw, node);
        if (unitsConflict(a?.unit, nodeUnit) !== null) {
          unitMismatch.push({ label: node.label, value: a?.value, unit: String(a?.unit), factor_unit: String(nodeUnit) });
          continue;
        }
        /**
         * ⛔ THE APPROVAL MUST SHOW THE USER'S OWN NUMBER, NOT THE MODEL'S DIVISOR
         * (Codex 5810763729 item 1). `observed_state.value` is the number read against
         * the factor's frame — on a `cap: 100` factor the user's 70 is stored as 0.7.
         * Carried straight into `replaces`, the approval chip read "0.7 → 50", which is
         * not a sentence about anything the user said. The native figure is `raw_value`
         * when the frame recorded one, else the model value multiplied back up by the
         * cap, else the value itself (an unframed factor stores native already).
         */
        const existing = nativeStartingValue(node.observed_state as never);
        /**
         * ⭐ THE ONE CASE THE BLANKET REFUSAL WAS NEVER MEANT TO CATCH.
         *
         * The refusal above this exists to stop the MODEL replacing somebody's
         * number with a guess "under cover of adopting assumptions". That is
         * still refused and the wording of that rule has not moved.
         *
         * But the product's whole sensitivity loop asks the user to do exactly
         * the opposite act: the analysis names the assumption the ordering turns
         * on and invites them to change it and see how much it matters. An
         * assumption the ordering is sensitive to ALWAYS already holds a value —
         * otherwise it could not drive an ordering — so every such request landed
         * on the blanket refusal and the invitation could never be honoured.
         *
         * `revise` is opt-in PER FACTOR and the tool tells the model it may set
         * it only when the user has just asked for that factor to be changed and
         * named the number. The old value is carried into `replaces` so the
         * approval the user is shown says what it is replacing: consent stays
         * informed, and the write still goes through authorise_change like any
         * other. Nothing here writes.
         */
        const userNamedThisChange = a?.revise === true;
        if (typeof existing === 'number' && !userNamedThisChange) {
          occupied.push({ label: node.label, current_value: existing });  // native, per item 1
          continue;
        }
        if (!Number.isFinite(Number(a?.value))) { unresolved.push(node.label); continue; }
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        adopted.push({
          id: node.id, label: node.label,
          value: Number(a.value), unit: String(a?.unit ?? ''), basis: String(a?.basis ?? ''),
          ...(typeof existing === 'number' ? { replaces: existing } : {}),
          // ⛔ A revision is the user's only when they WROTE the figure (`stated-by-user.ts`); else it is Olumi's.
          userWrote: figureTheUserWrote(Number(a.value), a?.unit ?? nodeUnit, ctx.user_text),
        });
      }

      if (adopted.length === 0) {
        return {
          ok: false, mutated: false, refusal: 'nothing_to_adopt',
          unresolved_labels: unresolved, already_valued: occupied,
          ...(notAFactor.length > 0 ? { not_a_factor: notAFactor } : {}),
          ...(ambiguous.length > 0 ? { ambiguous_targets: ambiguous, ambiguous_note: AMBIGUOUS_NOTE } : {}),
          ...(unitMismatch.length > 0 ? { unit_mismatch: unitMismatch, unit_mismatch_note: UNIT_MISMATCH_NOTE } : {}),
          detail:
            'None of those could be adopted. Read the state again and use the labels exactly as they appear; ' +
            'factors that already hold a value are left alone.',
        };
      }

      // Sorted by node id so an identical set proposed in a different order is
      // the SAME proposal, not a second one.
      const ordered = [...adopted].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      const operations: ProposalOperation[] = ordered.map((a) => ({
        op: 'set_factor_value',
        path: a.id,
        // A revision the user named AND wrote is theirs; anything else is Olumi's (`valueOpAuthor`).
        value: { value: a.value, unit: a.unit, basis: a.basis, authored_by: typeof a.replaces === 'number' && a.userWrote ? 'user_stated' : 'model_proposed' },
      }));
      /**
       * ⛔ THE APPROVAL MUST SAY WHAT IT REPLACES.
       *
       * A revision and an adoption are different acts and the user is agreeing to
       * a different thing in each case. "Churn = 6%" hides that a number was
       * already there; "Churn: 4% to 6%" does not. The receipt quotes this label,
       * so what was consented to stays legible after the fact.
       */
      const revisions = ordered.filter((a) => typeof a.replaces === 'number');
      const fresh = ordered.filter((a) => typeof a.replaces !== 'number');
      const notWritten = revisions.filter((a) => !a.userWrote);
      const withUnit = (a: { value: number; unit: string }) => `${a.value}${a.unit !== '' ? ' ' + a.unit : ''}`;
      const describe = (a: { label: string; value: number; unit: string; replaces?: number }) =>
        typeof a.replaces === 'number'
          ? `${a.label}: ${a.replaces}${a.unit !== '' ? ' ' + a.unit : ''} \u2192 ${withUnit(a)}`
          : `${a.label} = ${withUnit(a)}`;
      const heading =
        revisions.length === 0
          ? `Adopt ${fresh.length} starting assumption${fresh.length === 1 ? '' : 's'}: `
          : fresh.length === 0
            ? `Revise ${revisions.length} value${revisions.length === 1 ? '' : 's'} you asked to change: `
            : `Revise ${revisions.length} value${revisions.length === 1 ? '' : 's'} and adopt ${fresh.length} starting assumption${fresh.length === 1 ? '' : 's'}: `;
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: {
          // A revision the user named is theirs, not the model's. Only a proposal
          // made entirely of those may claim it.
          authored_by: fresh.length === 0 && revisions.length > 0 && notWritten.length === 0 ? 'user_stated' : 'model_proposed',
          basis:
            revisions.length > 0 && fresh.length === 0 && notWritten.length === 0
              ? 'values the user asked to change, at the figures they gave'
              : 'starting assumptions offered for the user to adopt or correct',
        },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        // The heading distinguishes a revision the user asked for from an assumption
        // offered to them; `leftOutClause` is staging’s disclosure of the labels that
        // were not factors. Both are required — the heading alone drops the disclosure,
        // and staging’s label alone calls a revision an adoption.
        public_label: heading + ordered.map(describe).join('; ') + leftOutClause(notAFactor) + ambiguousClause(ambiguous),
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        assumptions: ordered.map((a) => ({
          factor: a.label, value: a.value, unit: a.unit, basis: a.basis,
          ...(typeof a.replaces === 'number' ? { replaces: a.replaces } : {}),
        })),
        ...(unresolved.length > 0 ? { unresolved_labels: unresolved } : {}),
        ...(occupied.length > 0 ? { left_alone_already_valued: occupied } : {}),
        // Named, but not something a value can be set on (a risk, an outcome, an option): left out,
        // so the user is never asked to approve a value that cannot be saved.
        ...(notAFactor.length > 0 ? { not_a_factor: notAFactor, not_a_factor_note: NOT_A_FACTOR_NOTE } : {}),
        ...(ambiguous.length > 0 ? { ambiguous_targets: ambiguous, ambiguous_note: AMBIGUOUS_NOTE } : {}),
        ...(unitMismatch.length > 0 ? { unit_mismatch: unitMismatch, unit_mismatch_note: UNIT_MISMATCH_NOTE } : {}),
        ...(notWritten.length > 0 ? {
          not_the_users_figure: notWritten.map((a) => ({ factor: a.label, value: a.value })),
          not_the_users_figure_note: NOT_THE_USERS_FIGURE_NOTE,
        } : {}),
        note:
          'Nothing has changed. Show the user each value and what it rests on, say plainly that these are ' +
          'assumptions to adopt or correct and NOT measurements, and call authorise_change with this ' +
          'proposal_id only once they agree.',
      };
    },

    /**
     * ⭐ WHAT AN OPTION DOES — the last structural blocker on the journey.
     *
     * ⛔ THE CONSTRAINT THAT DECIDES THIS DESIGN. `option_intervention_edit` is
     * `.strict()` and its `value` is `z.number().min(0).max(1)`, described as
     * "the effect value on the MODEL scale … no unit, no currency and no
     * percentage: the client converts nothing, and the server licenses no
     * raw-unit conversion on this path." A first version of this capability
     * took the user's "£54" and was WITHDRAWN unshipped, because turning it
     * into a number in [0, 1] meant choosing a scale at the moment of writing,
     * which is the fabrication this lane exists to prevent.
     *
     * ⭐ IT IS HONEST NOW ONLY BECAUSE THE FACTOR CARRIES A DECLARED FRAME.
     * Construction publishes `observed_state.cap`, so `raw / cap` READS the
     * user's own number against a range the model already stated and disclosed
     * — a different act from inventing one here. Both numbers are reported.
     *
     * ⛔ AND WITHOUT A FRAME IT REFUSES. A factor with no cap whose value is
     * outside [0, 1] cannot be expressed on this wire at all; saying so is the
     * correct outcome, not picking a denominator.
     */
    /**
     * ⭐ A STARTING POINT IS ONE PROPOSAL, SO ONE "YES" APPLIES ALL OF IT.
     * Composed from the two existing proposers — their validation, frames and
     * refusals are unchanged — then merged into one exact proposal on the SAME
     * base, and the two halves discarded so only the object the user is shown
     * is awaiting approval. See `applyCompound` for how it is applied.
     */
    async proposeStartingPoint(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const assumptions = Array.isArray(args?.assumptions) ? args.assumptions : [];
      const levels = Array.isArray(args?.option_levels) ? args.option_levels : [];
      if (assumptions.length === 0 && levels.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: 'Nothing was proposed.' };
      }
      const a = assumptions.length > 0 ? await caps.proposeAssumptions(ctx, { assumptions }) : null;
      // What THIS starting point would make each factor's starting value — read off the stored
      // value half, never the Agent's arguments — so a held level that only restates it is caught.
      const valueHalf = a !== null && a.ok === true && typeof a.proposal_id === 'string' ? proposals.get(a.proposal_id) : undefined;
      const startingValues = new Map<string, number>();
      for (const o of valueHalf?.operations ?? []) {
        const v = (o.value ?? {}) as { value?: unknown };
        if (o.op === 'set_factor_value' && typeof v.value === 'number') startingValues.set(o.path, v.value);
      }
      const b = levels.length > 0 ? await caps.proposeOptionInterventions(ctx, { interventions: levels }, { startingValues }) : null;
      const refused = {
        ...(a !== null && a.ok !== true ? { assumptions_refused: a } : {}),
        ...(b !== null && b.ok !== true ? { option_levels_refused: b } : {}),
      };
      const made = [a, b].filter((r): r is ToolResult => r !== null && r.ok === true && typeof r.proposal_id === 'string');
      if (made.length === 0) return { ok: false, mutated: false, refusal: 'nothing_to_propose', ...refused };
      // ⛔ A name that matched two entities travels to the joined result from EITHER half,
      // so the starting point never looks complete at the moment of consent.
      const ambiguousTargets = [a, b].flatMap((r) => (r !== null && Array.isArray(r.ambiguous_targets) ? r.ambiguous_targets : []));
      const ambiguity = ambiguousTargets.length > 0 ? { ambiguous_targets: ambiguousTargets, ambiguous_note: AMBIGUOUS_NOTE } : {};
      // Only one half could be proposed: it is an ordinary proposal already.
      if (made.length === 1) {
        const only = proposals.get(made[0].proposal_id as string);
        const missing = await missingPairs(ctx, levelPathsOf(only !== undefined ? [only] : []));
        if (missing === null || missing.length > 0) {
          if (only !== undefined) proposals.discard(only.proposal_id);
          if (missing === null) return { ok: false, mutated: false, refusal: 'not_found' };
          return incompleteStartingPoint(missing, {
            assumptions: a?.assumptions ?? [], option_levels: b?.interventions ?? [],
            ...(b !== null && Array.isArray(b.not_linked) ? { not_linked: b.not_linked } : {}),
            ...(b !== null && Array.isArray(b.levels_not_accepted) ? { levels_not_accepted: b.levels_not_accepted } : {}),
            ...(a !== null && Array.isArray(a.not_a_factor) ? { not_a_factor: a.not_a_factor } : {}), ...ambiguity, ...refused,
          });
        }
        const ifApproved = await readinessIfApplied(ctx, only?.operations ?? []);
        return { ...made[0], ...ambiguity, ...refused, readiness_if_approved: ifApproved,
          ...(stillBlockedNote(ifApproved) !== '' ? { note: `${String(made[0].note ?? '')}${stillBlockedNote(ifApproved)}` } : {}) };
      }
      const halves = made.map((r) => proposals.get(r.proposal_id as string)).filter((p): p is StructuredProposal => p !== undefined);
      if (halves.length !== 2 || halves[0].base_graph_identity_hash !== halves[1].base_graph_identity_hash) {
        for (const h of halves) proposals.discard(h.proposal_id);
        return { ok: false, mutated: false, refusal: 'model_changed_while_proposing', detail: 'The model changed while this was being put together. Read the state again and propose once more.' };
      }
      const missing = await missingPairs(ctx, levelPathsOf(halves));
      if (missing === null || missing.length > 0) {
        for (const h of halves) proposals.discard(h.proposal_id);
        if (missing === null) return { ok: false, mutated: false, refusal: 'not_found' };
        return incompleteStartingPoint(missing, {
          assumptions: a?.assumptions ?? [], option_levels: b?.interventions ?? [],
          ...(b !== null && Array.isArray(b.not_linked) ? { not_linked: b.not_linked } : {}),
          ...(b !== null && Array.isArray(b.levels_not_accepted) ? { levels_not_accepted: b.levels_not_accepted } : {}),
          ...(a !== null && Array.isArray(a.not_a_factor) ? { not_a_factor: a.not_a_factor } : {}), ...ambiguity, ...refused,
        });
      }
      const compound = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: halves[0].base_graph_identity_hash,
        operations: [...halves[0].operations, ...halves[1].operations],
        provenance: { authored_by: 'model_proposed', basis: STARTING_POINT_BASIS },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: `${halves[0].public_label}; ${halves[1].public_label}`,
      });
      replaceEarlierStartingPoints(ctx);
      proposals.put(compound);
      for (const h of halves) proposals.discard(h.proposal_id);
      const ifApproved = await readinessIfApplied(ctx, compound.operations);
      return {
        readiness_if_approved: ifApproved,
        ok: true, mutated: false,
        proposal_id: compound.proposal_id,
        public_label: compound.public_label,
        base_revision: compound.base_graph_identity_hash,
        assumptions: a?.assumptions ?? [],
        option_levels: b?.interventions ?? [],
        // Levels the proposer LEFT OUT because the option is not wired to that
        // factor — the Agent must say so and offer a level it CAN record.
        ...(b !== null && Array.isArray(b.not_linked) ? { not_linked: b.not_linked, not_linked_note: b.not_linked_note } : {}),
        ...(b !== null && Array.isArray(b.levels_not_accepted) ? { levels_not_accepted: b.levels_not_accepted } : {}),
        ...(b !== null && Array.isArray(b.not_the_users_figure) ? { not_the_users_figure: b.not_the_users_figure, not_the_users_figure_note: NOT_THE_USERS_FIGURE_NOTE } : {}),
        // ⛔ What the user NAMED but this proposal leaves out, carried to the joined result (independent
        // review of #1800, 5806926323): when both halves succeed, the value half's omission otherwise
        // never reached the Agent, and the starting point looked complete at the moment of consent.
        ...(a !== null && Array.isArray(a.not_a_factor) ? { not_a_factor: a.not_a_factor, not_a_factor_note: NOT_A_FACTOR_NOTE } : {}),
        ...ambiguity,
        ...refused,
        note:
          'Nothing has changed. Show the user every value and level and what each rests on, say plainly they are ' +
          'assumptions to adopt or correct, NOT measurements, and that ONE approval applies all of them. Then call ' +
          'authorise_change with this proposal_id once they agree.' + stillBlockedNote(ifApproved),
      };
    },

    async proposeOptionInterventions(ctx, args, internal): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const input = Array.isArray(args?.interventions) ? args.interventions : [];
      if (input.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: 'No interventions were given.' };
      }
      // Resolved within the kind first (a label on a node of another kind never shadows the
      // right one), then by `resolveNamed`: an id is identity, a label beats a description,
      // and two nodes of the kind answering to one name are AMBIGUOUS, never "the first".
      const optionNodes = { nodes: g.nodes.filter((n) => n.kind === 'option') };
      const factorNodes = { nodes: g.nodes.filter((n) => n.kind === 'factor') };
      const ambiguous: AmbiguousTarget[] = [];
      const ambiguousSeen = new Set<string>();
      const held = heldStatusQuoPairs(g);

      const unresolved: string[] = [];
      const unframed: { factor: string; detail: string }[] = [];
      const unchanged: string[] = [];
      const notLinked: { option: string; factor: string; acts_on: string[] }[] = [];
      /**
       * ⛔ EVERY SUPPLIED LEVEL THAT IS NOT ACCEPTED, WITH ITS OPTION AND WHY.
       * MEASURED on served d1829c5 (journey J1): the starting point was refused
       * `incomplete_starting_point` three times in one turn because a level the
       * Agent DID supply was dropped here, and the refusal named only the pair
       * still missing — so the Agent re-sent the same value. The reason travels
       * with the pair, so the next attempt can correct it.
       */
      const notAccepted: { option: string; factor: string; value: unknown; reason: string }[] = [];
      /** Levels the Agent marked `user_stated` that the user never wrote: recorded as Olumi's, never as theirs. */
      const notWrittenByUser: { option: string; factor: string; value: unknown }[] = [];
      const seen = new Set<string>();
      const set: {
        option: { id: string; label: string }; factor: { id: string; label: string };
        raw: number; normalised: number; cap: number | null; unit: string; basis: string;
        derivedFrame: number | null;
        /** The user GAVE this level (`user_stated`); otherwise it is Olumi's proposal. */
        userStated: boolean;
      }[] = [];

      for (const i of input) {
        const asGiven = { option: String(i?.option_label ?? ''), factor: String(i?.factor_label ?? ''), value: i?.value };
        const optionRes = resolveNamed(optionNodes, asGiven.option, () => true);
        const factorRes = resolveNamed(factorNodes, asGiven.factor, () => true);
        if (optionRes.kind === 'ambiguous' || factorRes.kind === 'ambiguous') {
          // ⛔ No level for this pair, and no guess at which entity was meant.
          const which: string[] = [];
          for (const [kind, requested, res] of [['option', asGiven.option, optionRes], ['factor', asGiven.factor, factorRes]] as const) {
            if (res.kind !== 'ambiguous') continue;
            which.push(`${kind} "${requested}"`);
            if (!ambiguousSeen.has(`${kind}\u0000${requested}`)) {
              ambiguousSeen.add(`${kind}\u0000${requested}`);
              ambiguous.push(describeAmbiguity(g, requested, res.candidates));
            }
          }
          notAccepted.push({
            ...asGiven,
            reason: `More than one ${which.join(' and more than one ')} is in the model, so this level was left out. Ask the user which one they mean, then propose it again passing that entity\u2019s id in place of its label.`,
          });
          continue;
        }
        const option = optionRes.kind === 'one' ? optionRes.node : undefined;
        const factor = factorRes.kind === 'one' ? factorRes.node : undefined;
        if (option === undefined) {
          unresolved.push(`option "${asGiven.option}"`);
          notAccepted.push({ ...asGiven, reason: `No option in the model is labelled "${asGiven.option}". Use an option label exactly as get_canonical_state gives it.` });
          continue;
        }
        if (factor === undefined) {
          unresolved.push(`factor "${asGiven.factor}"`);
          notAccepted.push({ ...asGiven, option: option.label, reason: `No factor in the model is labelled "${asGiven.factor}". Use a factor label exactly as get_canonical_state gives it.` });
          continue;
        }
        /**
         * ⛔ A LEVEL CAN ONLY BE SET ON A FACTOR THE OPTION IS WIRED TO — the
         * write's own rule, applied at PROPOSAL time. MEASURED on served
         * 0f2f3b87 (journey witness, scenario 1e7649c2): the Agent proposed
         * "Internal Lead Trial -> Tech lead headcount", an option with no link
         * to that factor. This proposer accepted it, `option_intervention_edit`
         * then refused it (`unresolved_effect_relationship`, same reader:
         * `linkedFactorsOf`), and because a compound's level chain stops at its
         * first refusal, NONE of that approval's levels landed — the user
         * approved a set that could never be written. Excluded here, with the
         * factors the option DOES act on, so the Agent corrects it before the
         * user is asked to approve anything.
         */
        const linked = linkedFactorsOf(g as never, option.id);
        if (!linked.some((f) => f.id === factor.id)) {
          notLinked.push({
            option: option.label, factor: factor.label,
            acts_on: linked.map((f) => String(f.label ?? f.id)),
          });
          continue;
        }
        // ⛔ A held status quo takes no level the AGENT supplies (`heldStatusQuoPairs`):
        // not accepted, never an operation. ⭐ The USER's own correction is the
        // exception (independent review of #1849, 5820560331): the Agent is told to
        // say the user can correct the held reading, so what they say must be
        // recordable. `user_stated` is opt-in per level, on the same terms as
        // `revise` — only when the user said it and gave the level — and it still
        // reaches the user as a proposal to approve, never a write.
        /**
         * ⛔ `user_stated` is the Agent's claim; it stands only when the user WROTE the figure (`stated-by-user.ts`).
         * Unwritten, the level is Olumi's estimate (recorded as such, and said), and on a held pair it is not a level.
         */
        const claimedByUser = i?.user_stated === true;
        const userWrote = claimedByUser && figureTheUserWrote(Number(i?.value), factorUnitOf(g.raw, factor), ctx.user_text);
        if (claimedByUser && !userWrote) notWrittenByUser.push({ option: option.label, factor: factor.label, value: i?.value });
        if (held.has(`${option.id}::${factor.id}`) && !userWrote) {
          notAccepted.push({
            option: option.label, factor: factor.label, value: i?.value,
            reason: claimedByUser
              ? `${option.label} is held at its starting values, and ${String(i?.value)} is not a figure the user wrote, so no level is recorded for ${factor.label}. Leave it out; never send a figure as the user's unless they wrote it.`
              : `${option.label} is held at its starting values — carrying on as now sets no level, so none is recorded for ${factor.label}. Leave it out, unless the user themselves said carrying on changes ${factor.label} and gave the level: then send it with user_stated: true.`,
          });
          continue;
        }
        const raw = Number(i?.value);
        if (!Number.isFinite(raw)) {
          unresolved.push(`${option.label} -> ${factor.label} (no value)`);
          notAccepted.push({ option: option.label, factor: factor.label, value: i?.value, reason: 'No numeric value was given.' });
          continue;
        }

        const os = (factor.observed_state ?? {}) as { cap?: unknown; unit?: unknown };
        /**
         * ⭐ THE STORED RANGE WINS OVER ONE DERIVED FROM THIS FIGURE. A factor
         * built with no baseline carries its range as `scale_frame` (the
         * declared carrier; see `admit-model.ts`), and the option levels
         * already on it were divided by that range. Reading `observed_state`
         * alone missed it, so this derived a second range from the user's
         * number and the two levels on one factor sat on two scales. Measured
         * in the replay of Paul's session (repro/FINDINGS.md, turns 3-4).
         */
        const cap = levelFrameOf(factor);
        let normalised: number;
        let derivedFrame: number | null = null;
        if (cap !== null) {
          normalised = raw / cap;
          if (normalised < 0 || normalised > 1) {
            unframed.push({ factor: factor.label, detail: `${raw} is outside the model's range for this factor (0 to ${cap})` });
            notAccepted.push({
              option: option.label, factor: factor.label, value: raw,
              reason: `${raw} is outside the model's range for this factor (0 to ${cap}). Propose a level within that range, in the same units, as an assumption for the user to correct.`,
            });
            continue;
          }
        } else if (raw >= 0 && raw <= 1) {
          normalised = raw;
        } else if (raw > 1) {
          /**
           * ⭐ DERIVE THE FRAME RATHER THAN REFUSE, and say so.
           *
           * ⛔ MEASURED on the deployed build: this branch USED to refuse, and
           * the refusal was correct in isolation and a dead end in practice.
           * A factor with no VALUE cannot carry a range at construction —
           * `ObservedStateSchema` requires `value`, and a node-level `cap` is
           * stripped by `NodeV3Schema` — so "Feature release availability" and
           * "Price rollout exposure" could never be set by any option, and the
           * comparison could never run. The Agent's advice became "a rebuild is
           * required", which is not something to ask a user for.
           *
           * The frame is taken from the user's own figure and ATTACHED to the
           * factor on authorisation, exactly as the adopted-assumption path
           * already does. Reported below as `ranges_added_for_analysis`.
           */
          derivedFrame = defaultFrameFor(raw);
          normalised = raw / derivedFrame;
        } else {
          const detail =
            `"${factor.label}" has no stated range, and ${raw} cannot be read against one. ` +
            'Nothing here will pick a range on your behalf for a figure like that.';
          unframed.push({ factor: factor.label, detail });
          notAccepted.push({ option: option.label, factor: factor.label, value: raw, reason: detail });
          continue;
        }

        /**
         * ⛔ A HELD STATUS QUO'S STARTING VALUE IS NOT A LEVEL ANYONE STATED (RC #69 5830102377,
         * pre-review 5830132268). Only a `user_stated` level reaches here on a held pair, and that
         * flag is the Agent's. MEASURED on served builds: one "Use as starting assumptions" wrote
         * the held status quo's levels as COPIES of the starting values — hiring c27a `0303ef5`
         * (0.1333 and 0, the values the same starting point proposed), pricing c26 `7f9a16d` (the
         * brief's £49) — and the level writer stamped each `user_specified`: Olumi's figure, or
         * the brief's, recorded as a level the user set. A copy changes nothing today and freezes
         * the figure, so a later correction to the starting value would leave "carrying on as
         * now" behind (`heldStatusQuoPairs`). A DIFFERENT figure is still the user's correction.
         * The starting value is the one this starting point proposes, else the factor's own.
         */
        if (held.has(`${option.id}::${factor.id}`)) {
          const proposed = internal?.startingValues?.get(factor.id);
          const start = proposed ?? nativeStartingValue(os as never);
          const modelStart = proposed === undefined && typeof (os as { value?: unknown }).value === 'number' ? (os as { value: number }).value : undefined;
          if (start !== undefined && (raw === start || (modelStart !== undefined && normalised === modelStart))) {
            notAccepted.push({
              option: option.label, factor: factor.label, value: i?.value,
              reason: `${option.label} already keeps ${factor.label} at its starting value, ${quotable(start)}. Recording that as a level changes nothing today, and would stop carrying on as now from following a later correction to the starting value, so none is recorded. Leave it out.`,
            });
            continue;
          }
        }

        const current = (option.interventions ?? {})[factor.id] as { value?: unknown } | number | undefined;
        const currentValue = typeof current === 'number' ? current : (current as { value?: unknown } | undefined)?.value;
        if (currentValue === normalised || currentValue === raw) {
          unchanged.push(`${option.label} already sets ${factor.label} to ${String(currentValue)}`);
          continue;
        }
        const key = `${option.id}::${factor.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        set.push({
          option: { id: option.id, label: option.label },
          factor: { id: factor.id, label: factor.label },
          raw, normalised, cap: cap ?? derivedFrame, unit: typeof os.unit === 'string' ? os.unit : '',
          basis: String(i?.basis ?? ''), derivedFrame, userStated: userWrote,
        });
      }

      if (set.length === 0) {
        return {
          ok: false, mutated: false, refusal: 'nothing_to_set',
          ...(unresolved.length > 0 ? { unresolved } : {}),
          ...(notLinked.length > 0 ? { not_linked: notLinked } : {}),
          ...(unframed.length > 0 ? { no_stated_range: unframed } : {}),
          ...(unchanged.length > 0 ? { already_set: unchanged } : {}),
          ...(notAccepted.length > 0 ? { levels_not_accepted: notAccepted } : {}),
          ...(notWrittenByUser.length > 0 ? { not_the_users_figure: notWrittenByUser, not_the_users_figure_note: NOT_THE_USERS_FIGURE_NOTE } : {}),
          ...(ambiguous.length > 0 ? { ambiguous_targets: ambiguous, ambiguous_note: AMBIGUOUS_NOTE } : {}),
          detail: 'Nothing could be recorded. Tell the user exactly which of these it was and why.',
        };
      }

      const ordered = [...set].sort((x, y) =>
        `${x.option.id}::${x.factor.id}` < `${y.option.id}::${y.factor.id}` ? -1 : 1);
      const operations: ProposalOperation[] = ordered.map((i) => ({
        op: 'set_option_intervention',
        path: `${i.option.id}::${i.factor.id}`,
        value: {
          normalised: i.normalised, raw: i.raw, cap: i.cap, basis: i.basis, derived_frame: i.derivedFrame,
          // Per level, like `valueOpAuthor`: whose level this is travels to the writer (`levelOpAuthor`).
          authored_by: i.userStated ? 'user_stated' : 'model_proposed',
        },
      }));
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: { authored_by: 'model_proposed', basis: 'what each option does, for the user to confirm or correct' },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label:
          ordered.map((i) => `${i.option.label} sets ${i.factor.label} to ${i.raw}${i.unit !== '' ? ' ' + i.unit : ''}`).join('; ') +
          ambiguousClause(ambiguous),
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        interventions: ordered.map((i) => ({
          option: i.option.label, factor: i.factor.label,
          value: i.raw, unit: i.unit,
          // Both numbers, always. The user approves the one they said.
          recorded_on_model_scale: i.normalised,
          model_range: i.cap,
          ...(i.derivedFrame !== null ? { range_taken_from_your_figure: i.derivedFrame } : {}),
          basis: i.basis,
        })),
        ...(unresolved.length > 0 ? { unresolved } : {}),
        ...(notLinked.length > 0 ? {
          not_linked: notLinked,
          not_linked_note: 'These levels were LEFT OUT: the option is not connected to that factor, so no level can be recorded there. Propose a level on one of the factors each option acts on (listed in acts_on), or say the option needs a link first.',
        } : {}),
        ...(unframed.length > 0 ? { no_stated_range: unframed } : {}),
        ...(unchanged.length > 0 ? { already_set: unchanged } : {}),
        ...(notAccepted.length > 0 ? { levels_not_accepted: notAccepted } : {}),
        ...(notWrittenByUser.length > 0 ? { not_the_users_figure: notWrittenByUser, not_the_users_figure_note: NOT_THE_USERS_FIGURE_NOTE } : {}),
        ...(ambiguous.length > 0 ? { ambiguous_targets: ambiguous, ambiguous_note: AMBIGUOUS_NOTE } : {}),
        note:
          'Nothing has changed. Show the user the value in THEIR units and what it rests on, then call ' +
          'authorise_change with this proposal_id once they agree.',
      };
    },

    async authoriseChange(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      // A held add-option (C52) is confirmed on the product's own seam, never through the proposal store.
      if (typeof args?.proposal_id === 'string' && /^gmh_[0-9a-f]{12}$/.test(args.proposal_id)) return confirmHeld(ctx, args.proposal_id);
      const before = await readGraph(ctx.scenario_id);
      if (before === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const decision = proposals.authorise({
        proposal_id: args.proposal_id,
        scenario_id: ctx.scenario_id,
        authenticated_user_id: ctx.authenticated_user_id,
        current_graph_identity_hash: before.graph_hash,
      });
      if (decision.status === 'already_applied') {
        // ⭐ A retry RECOVERS the first result. It carries the proposal id, so
        // the retry is bound to the same proposal by identity, and the ORIGINAL
        // receipts, so the Agent can say which version it already became.
        return {
          ok: true, mutated: false, applied: true, already_applied: true,
          proposal_id: decision.proposal.proposal_id,
          receipts: decision.receipts,
          detail:
            decision.receipts.length > 0
              ? `That proposal was already applied and saved as version ${Math.max(...decision.receipts.map((x) => x.version))}. Nothing was applied twice.`
              : 'That proposal was already applied. No saved version was recorded for it. Nothing was applied twice.',
        };
      }
      if (decision.status !== 'execute') {
        return { ok: false, mutated: false, refusal: decision.status, ...(decision.status === 'superseded' ? { expected: decision.expected, actual: decision.actual } : {}) };
      }

      // The STORED operations are applied. Nothing is regenerated here.
      const ops = decision.proposal.operations;

      /**
       * ⛔ AN OLD-SHAPE ADD-OPTION IS NEVER APPLIED (C52). It wrote the option and its links as separate system
       * events and never linked it from the decision, so the model it produced could not run (Paul's test,
       * 25 Sep). New option proposals are held on the product's own seam (`gmh_…`, `confirmHeld`); one
       * restored from before this change is refused honestly rather than written incompletely.
       */
      if (ops[0]?.op === 'add_node' && ops.slice(1).every((o) => o.op === 'add_edge')) {
        return {
          ok: false, mutated: false, refusal: 'superseded', proposal_id: decision.proposal.proposal_id,
          detail: 'That offer to add an option was prepared before an update and can no longer be applied. Nothing was changed. Offer to prepare it again.',
        };
      }

      /**
       * ⭐ A LINK'S STRENGTH, AS THE USER STATED IT — ONE typed `edge_strength_edit`, the product's own link writer
       * (the inspector's canonical D1 path, with its expected-before tuple). Reported as applied ONLY when this
       * response succeeded AND the stored link now holds exactly what was approved, stamped as the user's.
       */
      if (ops.length === 1 && ops[0]!.op === 'update_edge') {
        const op = ops[0]!;
        const [fromId, toId] = op.path.split('::') as [string, string];
        const v = op.value as { magnitude: number; intent: 'set' | 'confirm_current'; direction_intent: 'preserve' | 'positive' | 'negative'; expected: { mean: number; effect_direction: 'positive' | 'negative' } };
        const operationId = authorisationTurnId(decision.proposal.proposal_id);
        const res = await dispatch('/orchestrate/v2/turn', {
          kind: 'system_event', turn_id: operationId, scenario_id: ctx.scenario_id, stage: 'frame',
          event: { kind: 'edge_strength_edit', from: fromId, to: toId, intent: v.intent, direction_intent: v.direction_intent, magnitude: v.magnitude, expected: v.expected },
        });
        const after = await readGraph(ctx.scenario_id);
        const dir = v.direction_intent === 'preserve' ? v.expected.effect_direction : v.direction_intent;
        const want = dir === 'negative' ? -v.magnitude : v.magnitude;
        /** The link as it was approved: exactly this strength, stamped as the user's — in whichever graph holds it. */
        const holdsApproved = (edges: unknown): boolean => {
          const x = (Array.isArray(edges) ? edges as { from?: unknown; to?: unknown; strength?: unknown; provenance?: unknown }[] : [])
            .find((y) => y?.from === fromId && y?.to === toId);
          const mean = x?.strength !== null && typeof x?.strength === 'object' ? (x.strength as { mean?: unknown }).mean : undefined;
          const source = x?.provenance !== null && typeof x?.provenance === 'object' ? (x.provenance as { source?: unknown }).source : undefined;
          return typeof mean === 'number' && Math.abs(mean - want) < 1e-9 && source === 'user_specified';
        };
        /**
         * ⛔ LANDED IS WHAT THE MODEL HOLDS, NOT WHETHER TWO REVISIONS ARE EQUAL (round-2 review of
         * fix/agent-never-shows-instructions-or-codes, blocker 2 — probed through this capability). `landed` also demanded
         * that this response's revision EQUAL the read-back's, so a link write that landed and was followed by any other
         * write before the read-back came back `not_applied`, `mutated: false` — "Not saved: none of it was applied." —
         * while the link held exactly the approved 0.825 stamped as the user's, and the approval was left unapplied.
         * The read-back holding exactly what was approved is landed; a commit the model no longer shows is "could not be
         * confirmed" (`committedThenMoved`); only a response that shows nothing committed is "Not saved".
         */
        const landed = res.status === 200 && after !== null && holdsApproved(after.edges);
        if (after === null && res.status === 200) {
          // The write may have landed; the read-back failed. Never "as it was" when Olumi cannot see (review of #1950).
          return { ok: false, mutated: false, applied: false, refusal: 'not_confirmed', proposal_id: decision.proposal.proposal_id,
            detail: 'Olumi could not read the model back to confirm whether the link was recorded. Tell the user plainly that it could not be confirmed, and offer to check again.' };
        }
        if (!landed && committedThenMoved(res, before.graph_hash, after, (draft) => holdsApproved(draft.edges))) {
          return { ok: false, mutated: true, applied: false, refusal: 'not_verified', proposal_id: decision.proposal.proposal_id,
            detail: 'The link was saved, but the model changed again straight afterwards and no longer shows it as approved, so what it now holds could not be confirmed. Read the model again before saying what it holds; do not describe the link as recorded.' };
        }
        if (!landed) {
          return { ok: false, mutated: false, applied: false, refusal: 'not_applied', proposal_id: decision.proposal.proposal_id,
            detail: String(res.json.assistant_text ?? '').trim() !== ''
              ? `The link was not recorded. Olumi said: "${String(res.json.assistant_text).trim()}" Tell the user plainly; nothing else changed.`
              : 'The link was not recorded, so the model is as it was. Tell the user plainly.' };
        }
        const receipt = receiptSummaryOf(res.json);
        const receipts = receipt.summary !== null ? [receipt.summary] : [];
        proposals.markApplied(decision.proposal.proposal_id, receipts);
        /**
         * ⛔ `follow_up` IS WHAT THE USER READS; `note` IS WHAT THE AGENT READS (served f2, CEE `af719a1`, scenario
         * `bdba963b`): one click on "Record this link" showed this `follow_up` verbatim — "Recorded as the user's own
         * estimate: … Offer to run the analysis again so they can see what it changes." The typed-approval fast path
         * shows `follow_up` to the user and no model reads the result there; on the loop path the Agent reads both.
         * So the sentence the user reads is addressed to them (the label already says "as your own estimate"), and
         * the next step for the Agent stays in `note`, where only the Agent reads it.
         */
        return {
          ok: true, mutated: true, applied: true, proposal_id: decision.proposal.proposal_id, operation_id: operationId, receipts,
          ...(receipt.unreadable ? { receipt_unreadable: true } : {}),
          follow_up: `${decision.proposal.public_label.replace(/^Record /, 'Recorded ')}.`,
          note: 'Recorded as the user’s own estimate. Offer to run the analysis again so they can see what it changes.',
        };
      }

      // A starting point mixes kinds; each single-kind path below handles one.
      if (new Set(ops.map((o) => o.op)).size > 1) return applyCompound(ctx, decision.proposal, before);

      // The goal's current level, as the user stated it (`../goal-current-level.ts`): one CAS-gated write.
      if (isGoalCurrentLevelProposal(decision.proposal)) {
        return applyGoalCurrentLevel({ dispatch, readGraph, proposals, operationId: authorisationTurnId }, ctx, decision.proposal, before);
      }

      if (ops[0]?.op === 'set_option_intervention') {
        /**
         * ⚠ THIS EVENT IS CAS-GATED AND `factor_value_edit` IS NOT — it carries
         * a REQUIRED `base_graph_hash`. Each applied edit moves the hash, so the
         * next edit carries the revision our OWN preceding write reported (never a
         * re-read, which would adopt another writer's edit); sending the proposal's
         * base for all of them refuses every edit after the first with a divergence
         * that is really our own preceding write.
         */
        const applied: { option: string; factor: string; requested: number; recorded: number | null }[] = [];
        const failures: { path: string; detail: string }[] = [];
        const receipts: ReceiptSummary[] = [];
        /**
         * ⭐ ATTACH ANY DERIVED FRAME FIRST, in one write, before the levels.
         * The factor must carry its range before a level is recorded against
         * it, or the level is a number the model cannot interpret. Same
         * mechanism as the adopted-assumption path, and the same disclosure.
         */
        const framedHere: { factor: string; range: number }[] = [];
        const frames = new Map<string, number>();
        for (const o of ops) {
          const f = ((o.value ?? {}) as { derived_frame?: number | null }).derived_frame;
          if (typeof f === 'number' && f > 1) frames.set(o.path.split('::')[1], f);
        }
        if (frames.size > 0) {
          /**
           * ⭐⭐ PATCH THE MODEL AS IT IS NOW, NOT AS IT WAS WHEN WE READ IT.
           *
           * ⛔ THE COUNTEREXAMPLE THIS CLOSES (owner note 5799139118, limb 1):
           * this write sends a WHOLE graph built from an earlier read. The
           * route's expectation is compared in ANALYSIS space, which EXCLUDES
           * labels — so a rename landing between our read and this write passes
           * the comparison and is then overwritten by our stale copy of the node.
           *
           * ⚠ I previously reported limb 1 as wholly uncloseable caller-side and
           * left it to the atomic-writer lease. That was too broad. A caller
           * cannot express an IDENTITY-space expectation — that part is true and
           * still belongs at the write boundary — but it CAN stop replaying stale
           * bytes, which is the other half the owner note named: *"a targeted
           * atomic patch … can avoid replaying the whole stale graph."*
           *
           * So: re-read, patch the FRESH nodes, and send those. An intervening
           * edit is preserved BY CONSTRUCTION rather than by a comparison that
           * cannot see it. The residual window shrinks from "user think-time plus
           * a model call" to the milliseconds between this read and the route's
           * own — and the route's CAS already covers its own read-to-write gap.
           *
           * ⛔ AND IT NEVER CLOBBERS A RANGE SOMEONE ELSE SUPPLIED: a factor that
           * already carries a usable frame in the fresh read is left alone. If
           * that leaves nothing to do, no write is attempted at all.
           *
           * A failed re-read falls back to the earlier read: degrading to
           * today's behaviour is right, because refusing the whole authorisation
           * because a READ failed would lose work the user already approved.
           */
          const nowRead = await readGraph(ctx.scenario_id);
          const base = nowRead ?? before;
          const stillNeeds = new Map<string, number>();
          for (const [id, range] of frames) {
            const node = base.nodes.find((n) => n.id === id);
            if (node !== undefined && frameOf(node) !== null) continue;
            stillNeeds.set(id, range);
          }
          const patched = base.nodes.map((n) => {
            const range = stillNeeds.get(n.id);
            if (range === undefined) return n;
            const os = (n.observed_state ?? {}) as { value?: number; raw_value?: number };
            const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
            /**
             * ⛔ A FACTOR WITH NO VALUE IS LEFT WITHOUT ONE. `ObservedStateSchema`
             * requires `value`, so attaching a range here would mean inventing a
             * baseline — and a zero baseline is the exact fabrication this lane
             * refuses ("an absent value is unknown, never zero"). It is also
             * unnecessary: the baseline gate skips a factor with no value
             * outright (`if (baseline === undefined) continue`), so an unvalued
             * factor was never what blocked the analysis. Only a factor that
             * ALREADY carries a bare amount gets the range.
             */
            if (typeof raw !== 'number') { frames.delete(n.id); return n; }
            framedHere.push({ factor: n.label, range });
            return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
          });
          if (framedHere.length > 0) {
            /**
             * ⛔⛔ CAS-GATED, AND IT WAS NOT. This write asserts
             * `edges: before.edges` — the WHOLE edge set as it was at the read
             * on entry to this capability — so without an expected hash it does
             * not merely lose a node change: any edge written in between is
             * silently restored to its old value, the user is told nothing, and
             * the Agent reports the frame as attached.
             *
             * ⚠ THE PROPOSAL CHECK IS NOT THE WRITE CHECK, and it is tempting to
             * think it covers this. `proposals.authorise` is bound to
             * `before.graph_hash`, but that is an in-memory comparison against a
             * hash THIS process read; the register call is the only thing that
             * can refuse ATOMICALLY at the row. Between them another writer can
             * land.
             *
             * The values write below already does this (`expected_graph_hash:
             * carried`), which is what made the omission a gap rather than a
             * design. Same shape, same honest refusal.
             *
             * ⚠ SENT ONLY WHEN NON-EMPTY: the route rejects an empty string
             * outright (`EXPECTED_GRAPH_HASH_INVALID`), and `readGraph` coerces
             * a missing hash to `''`. Omitting it there preserves today's
             * behaviour rather than turning a degraded read into a hard failure.
             */
            /**
             * ⛔ NO WRITE AT ALL WHEN THE RE-READ LEFT NOTHING TO DO — the docblock
             * above promised exactly this and it was false.
             *
             * ⚠ Accepted from independent review of #1743. The gate was
             * `frameById.size`, computed BEFORE the re-read. When a competing writer
             * had already framed every factor, `stillNeeds` was empty, `patched`
             * equalled `base.nodes`, and a byte-identical WHOLE-GRAPH register still
             * went out — minting a model version the user did not cause and taking
             * the overwrite risk this block exists to remove, for nothing.
             *
             * Skipping is honest rather than synthetic: no HTTP call is made and
             * nothing downstream claims a write, because none was made.
             */
            const reg: { status: number; json: Record<string, unknown> } = stillNeeds.size === 0
              ? { status: 200, json: {} }
              : await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
              // ⛔⛔ SPREAD THE WHOLE GRAPH. This sent only `{ nodes, edges }`, so
              // every other top-level key was DELETED by a write whose purpose is
              // to stop the model being overwritten. They are not cosmetic:
              // `computeAnalysisAffectingGraphHashSha256` (`context/graph-hash.ts:149-162`)
              // hashes `options`, `goal_node_id` and `goal_constraints` too, so the
              // frame write destroyed analysis-affecting content. The value-batch
              // write at `:367` had it right all along — same spread, same reason.
              graph: { ...base.raw, nodes: patched, edges: base.edges },
              ...(base.graph_hash !== '' ? { expected_graph_hash: base.graph_hash } : {}),
              /**
               * ⭐ AND THE IDENTITY EXPECTATION, from the SAME read these bytes
               * come from. Patching fresh nodes preserves an intervening rename;
               * this REFUSES outright if one lands in the window between that
               * read and the route's own — which the analysis-space hash cannot
               * see, because its projection excludes labels.
               *
               * ⚠ The route enforces this only once CEE #1810 lands. Until then
               * it is an unknown top-level field and is ignored (the register
               * route has no body schema), so sending it early is safe and makes
               * the two land in either order.
               */
              ...(base.graph_identity_hash !== ''
                ? { expected_graph_identity_hash: base.graph_identity_hash }
                : {}),
            });
            if (reg.status !== 200) {
              const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
              failures.push({
                path: 'scale_frame',
                detail: code === 'GRAPH_STALE'
                  ? 'the model changed while this was being prepared, so no range was attached and nothing was written — read it again and propose afresh'
                  : `could not attach a range: http ${reg.status}`,
              });
              framedHere.length = 0;
            }
          }
        }
        const rebased = framedHere.length > 0 ? await readGraph(ctx.scenario_id) : null;
        let baseHash = rebased?.graph_hash ?? before.graph_hash;
        /** The levels THIS approval's own writes committed — see the read-back below. */
        const ownLevelWrite = new Set<string>();
        /** The level each own write committed: from its OWN response's committed post-state when present, else what it sent. */
        const ownLevel = new Map<string, number>();
        /** Levels whose COMMITTED value is known exactly (the write's own `draft_graph`), not just the value sent. */
        const ownLevelExact = new Set<string>();
        for (let i = 0; i < ops.length; i += 1) {
          const o = ops[i];
          const [optionId, factorId] = o.path.split('::');
          const v = ((o.value ?? {}) as { normalised?: number }).normalised;
          if (typeof v !== 'number') { failures.push({ path: o.path, detail: 'no value stored on the proposal' }); continue; }
          const r = await writeLevelAs(
            levelOpAuthor(o, decision.proposal),
            { scenarioId: ctx.scenario_id, proposalId: decision.proposal.proposal_id, optionId, factorId, modelValue: v },
            () => dispatch('/orchestrate/v2/turn', {
              kind: 'system_event',
              turn_id: authorisationTurnId(`${decision.proposal.proposal_id}#${i}`),
              scenario_id: ctx.scenario_id,
              stage: 'frame',
              event: { kind: 'option_intervention_edit', option_id: optionId, factor_id: factorId, value: v, base_graph_hash: baseHash },
            }),
          );
          const rc = receiptSummaryOf(r.json);
          if (rc.unreadable) failures.push({ path: o.path, detail: 'a receipt arrived but could not be read' });
          if (r.status !== 200) {
            failures.push({ path: o.path, detail: `http ${r.status}` });
            // ⛔⛔ DO NOT ADVANCE THE BASE AFTER A REFUSED EDIT.
            //
            // This used to re-read the graph and reassign `baseHash`
            // UNCONDITIONALLY, which made the claim at the head of this block —
            // "a moved graph refuses the WHOLE authorisation, not half of it" —
            // false for every multi-op proposal. A stale base survived exactly
            // ONE iteration: op 0 was refused at the row, then `baseHash` became
            // the CONCURRENT writer's hash and ops 1..N passed the
            // `base_graph_hash` gate, landing on a model the user never approved
            // while the result still reported the approval as applied.
            //
            // A refusal means the graph moved because someone ELSE wrote. Keeping
            // the approved base means every remaining op is refused too, which is
            // the whole-or-nothing property this authorisation is supposed to
            // have. Advancing after a SUCCESS is different and still correct: the
            // graph moved because WE moved it, within this same authorisation.
            continue;
          }
          // ⭐ ADVANCE ONLY TO THE REVISION *OUR* WRITE REPORTS COMMITTING. A re-read here
          // adopted whatever the model held by then — including another writer's edit
          // landing just after ours — and the next op then passed CAS on a model the user
          // never approved (the #1712 shape `applyCompound` already refuses). The served
          // committed response carries its own persisted `graph_hash`; a 200 without one
          // is the writer's verified no-op, which moved nothing, so the base stays put.
          const committedHash = typeof r.json.graph_hash === 'string' && r.json.graph_hash.length > 0 ? r.json.graph_hash : null;
          if (committedHash === null) {
            failures.push({ path: o.path, detail: 'not recorded by this approval: the write reported no committed revision' });
            continue;
          }
          baseHash = committedHash;
          ownLevelWrite.add(o.path);
          const committedLevel = committedLevelOf(r.json, optionId!, factorId!);
          ownLevel.set(o.path, committedLevel ?? v);
          if (committedLevel !== undefined) ownLevelExact.add(o.path);
          // A receipt is reported only beside its own committed write.
          if (rc.summary !== null) receipts.push(rc.summary);
        }

        const afterSet = await readGraph(ctx.scenario_id);
        const byId = new Map((afterSet?.nodes ?? []).map((n) => [n.id, n]));
        /**
         * ⛔ SAVED BY US, THEN CHANGED BY SOMEONE ELSE (Codex challenge on #1851, 5825938003): another writer
         * committed the SAME pair after our write and before this read, so the read shows THEIR level. Detected
         * only when the model moved past OUR last committed revision (`baseHash`), so the handler's own
         * normalisation is never mistaken for another writer.
         */
        // An empty hash is a read that cannot say which revision it saw: never "moved", never "ours" (review 5826841372).
        const hashKnown = afterSet !== null && typeof afterSet.graph_hash === 'string' && afterSet.graph_hash !== '';
        const movedPastUs = hashKnown && afterSet!.graph_hash !== baseHash;
        /** In the USER's scale and unit (review of #1881, 5826400426): the Agent quotes these, never 0.27 for £54. */
        const levelsChangedSince: { option: string; factor: string; saved: number; now: number | null; unit?: string }[] = [];
        let levelsUnread = false;
        const beforeNodeById = new Map((before.nodes ?? []).map((n) => [n.id, n]));
        for (const o of ops) {
          const [optionId, factorId] = o.path.split('::');
          const option = byId.get(optionId);
          const iv = (option?.interventions ?? {})[factorId] as { value?: unknown } | number | undefined;
          const recorded = typeof iv === 'number' ? iv : (iv as { value?: unknown } | undefined)?.value;
          const stored = ((o.value ?? {}) as { raw?: number }).raw;
          applied.push({
            // A node another writer deleted is named from the approved read, never by its id (review 5826841372).
            option: option?.label ?? beforeNodeById.get(optionId)?.label ?? optionId,
            factor: byId.get(factorId)?.label ?? beforeNodeById.get(factorId)?.label ?? factorId,
            requested: typeof stored === 'number' ? stored : Number.NaN,
            // ⛔ ONLY A LEVEL THIS APPROVAL'S OWN WRITE COMMITTED. The read-back alone
            // counted a REFUSED op as recorded whenever the pair already held a level
            // (the old one, or another writer's) — the same false "saved" as the value
            // path. `option_intervention_edit` refuses with 409/422/500 and commits with
            // its own `graph_hash`, so `ownLevelWrite` is decided from our own response.
            recorded: ownLevelWrite.has(o.path) && typeof recorded === 'number' ? recorded : null,
          });
          const mine = ownLevel.get(o.path);
          const row = applied[applied.length - 1]!;
          /**
           * ⛔ A LEVEL THIS APPROVAL COMMITTED IS NEVER "NOT RECORDED" (review of #1881 5826400426; Codex
           * 5826386917). Our own 200 + committed hash is the proof; the read-back only says what the model
           * holds NOW. So an own-written row keeps OUR level, and the present state is reported beside it:
           * changed by someone else (numeric), removed by someone else (absent), or unknown (read failed).
           */
          if (ownLevelWrite.has(o.path) && mine !== undefined) {
            // The op's `cap` is the range the level was divided by (stated, or derived from the figure); none ⇒ already 0–1.
            const opv = (o.value ?? {}) as { cap?: unknown; normalised?: unknown };
            const cap = typeof opv.cap === 'number' && opv.cap > 0 ? opv.cap : undefined;
            /**
             * ⛔ COMPARE UN-ROUNDED; ROUND ONLY WHAT IS REPORTED (review of #1881 at 6868825f, 5827673705). A 6-figure round
             * (6 significant figures) applied before the comparison made a precise figure — £1,234,567 — never equal
             * to itself, so ANY unrelated write that moved the graph read as "someone else changed your level".
             */
            const toAbs = (x: number): number => (cap !== undefined ? x * cap : x);
            // What we saved, as the user said it: their own figure when the write committed exactly what was sent.
            const savedAsSent = typeof opv.normalised === 'number' && mine === opv.normalised && Number.isFinite(row.requested);
            // Compared against the EXACT committed level in its range, so the only difference left is scale-step noise.
            const savedAbs = toAbs(mine);
            const savedUser = savedAsSent ? row.requested : quotable(savedAbs);
            const unitRaw = ((byId.get(factorId) ?? beforeNodeById.get(factorId))?.observed_state as { unit?: unknown } | undefined)?.unit;
            const unit = typeof unitRaw === 'string' && unitRaw.trim() !== '' ? unitRaw.trim() : undefined;
            const current = typeof recorded === 'number' ? recorded : null;
            /**
             * ⛔ WHAT THE MODEL HOLDS NOW, IN ITS OWN FRAME (review 5826841372; Codex 5826779118). Another writer's
             * consented range change renormalises every option level on the factor to KEEP its absolute value
             * (`renormaliseOptionInterventionsForCapChange`): 0.27 of 200 becomes 0.135 of 400, still £54. Read with
             * the proposal's old range that was "someone cut it to £27". So the current level is converted with the
             * FRESH factor's range, cross-checked against the absolute the renormaliser stamps (`raw_value`); a frame
             * that cannot be established, or the two disagreeing, is unknown — never an invented amount.
             */
            const freshOs = (byId.get(factorId)?.observed_state ?? {}) as { cap?: unknown };
            const freshFrameRaw = byId.get(factorId)?.scale_frame;
            const freshCap = typeof freshOs.cap === 'number' && Number.isFinite(freshOs.cap) && freshOs.cap > 0 ? freshOs.cap
              : typeof freshFrameRaw === 'number' && Number.isFinite(freshFrameRaw) && freshFrameRaw > 1 ? freshFrameRaw : undefined;
            const ivRawValue = (iv as { raw_value?: unknown } | undefined)?.raw_value;
            const stampedAbs = typeof ivRawValue === 'number' && Number.isFinite(ivRawValue) ? ivRawValue : undefined;
            const currentAbs = ((): number | undefined => {
              if (current === null) return undefined;
              if (freshCap !== undefined) {
                const fromFrame = current * freshCap;
                return stampedAbs === undefined || sameAfterScaling(stampedAbs, fromFrame) ? fromFrame : undefined;
              }
              if (stampedAbs !== undefined) return stampedAbs;
              // A level on a factor that had no range then and has none now is already on the user's 0–1 scale.
              return cap === undefined ? current : undefined;
            })();
            const unknown = (): void => { row.recorded = mine; levelsUnread = true; };
            const changed = (nowUser: number | null): void => {
              row.recorded = mine;
              levelsChangedSince.push({ option: row.option, factor: row.factor, saved: savedUser, now: nowUser, ...(unit !== undefined ? { unit } : {}) });
            };
            if (current === null) {
              // Absent now, or the read failed. Only a model read as moved past OUR commit can say someone else
              // removed it; otherwise what it holds now is unknown — never an invented writer, never "not recorded".
              if (movedPastUs) changed(null);
              else unknown();
            } else if (!hashKnown) {
              if (current !== mine) unknown();
            } else if (movedPastUs) {
              row.recorded = mine;
              // Same range: the stored level either IS ours or is not — no arithmetic, no tolerance.
              const sameRange = freshCap === cap;
              // Known only as SENT (no committed post-state): a mismatch may be the product's own normalisation — unknown, never another writer.
              if (sameRange) { if (current !== mine) { if (ownLevelExact.has(o.path)) changed(quotable(toAbs(current))); else unknown(); } }
              else if (currentAbs === undefined) unknown();
              else if (!sameAfterScaling(currentAbs, savedAbs)) changed(quotable(currentAbs));
            }
          }
        }
        const landed = applied.filter((a) => a.recorded !== null);
        if (landed.length === 0) {
          return {
            ok: false, mutated: false, applied: false, refusal: 'not_applied',
            detail:
              'None of the levels were recorded, so this approval left the model unchanged. Read the model again ' +
              'before describing it: someone else may have changed it meanwhile.',
            failures, interventions: applied,
          };
        }
        if (landed.length === applied.length) proposals.markApplied(decision.proposal.proposal_id, receipts);
        return {
          ok: true, mutated: true, applied: true,
          proposal_id: decision.proposal.proposal_id,
          receipts,
          recorded_count: landed.length,
          requested_count: applied.length,
          interventions: applied,
          revision_before: before.graph_hash,
          // A failed read is not a model that never moved: our last committed revision is the one we can prove.
          revision_after: afterSet?.graph_hash ?? baseHash,
          ...(failures.length > 0 ? { failures } : {}),
          ...(levelsChangedSince.length > 0 ? { changed_since_by_another_writer: levelsChangedSince } : {}),
          ...(levelsUnread ? { current_state_unknown: true } : {}),
          ...(framedHere.length > 0 ? { ranges_added_for_analysis: framedHere } : {}),
          not_represented:
            (landed.length < applied.length
              ? `Only some levels were recorded by this approval; ${applied.filter((a) => a.recorded === null).map((a) => `${a.option} \u2192 ${a.factor}`).join(', ')} ${applied.length - landed.length === 1 ? 'was' : 'were'} NOT. `
              : '') +
            (levelsChangedSince.length > 0
              ? levelsChangedSince.map((x) =>
                `${x.option} \u2192 ${x.factor} was saved by this approval, but someone else has since ` +
                (x.now === null ? 'removed it' : 'changed it')).join('; ') +
                ' \u2014 say so, and describe it from the model as it now stands, not as this approval\u2019s level ' +
                '(changed_since_by_another_writer has the figures in the user\u2019s units). '
              : '') +
            (levelsUnread ? 'These levels were saved, but a read afterwards could not confirm what the model holds now, so do not describe its current levels. ' : '') +
            (landed.length < applied.length ? 'The levels that were recorded are' : 'What each option does is now recorded') +
            ' from what the user said, not measured. The model ' +
            'stores each level against the factor\u2019s stated range, so quote the user\u2019s own number back ' +
            'to them, not the normalised one.' +
            (framedHere.length > 0
              ? ' Some factors had no range at all, which would have stopped the analysis running, so one was ' +
                'taken from the figure itself: ' + framedHere.map((f) => `${f.factor} 0 to ${f.range}`).join(', ') +
                '. Say so, and invite a correction \u2014 a range is a unit of measurement, not a forecast.'
              : ''),
        };
      }

      if (ops[0]?.op === 'set_factor_value') {
        /**
         * ⭐ APPLY EACH ADOPTED ASSUMPTION AS ITS OWN `factor_value_edit`, WITH
         * ITS OWN DERIVED IDENTITY. The wire has no batch form, and each event
         * needs a distinct `turn_id` because `(scenario_id, turn_id)` is unique
         * — so the key is derived from the proposal id AND the operation index,
         * which keeps a retry of the same authorisation idempotent per value
         * instead of minting a fresh id every attempt.
         *
         * ⚠ REPRESENTATION LOSS, RECORDED. `FactorValueEditEvent` is `.strict()`
         * and carries `{kind, target_id, value, raw_value?, unit?, field?,
         * applied_from?}` — there is NO provenance field on it, and the handler
         * stamps `observed_state.source` with `USER_EDIT_SOURCE`
         * (`canonicalise-value-ops.ts`) because it was built for the inspector.
         * (`user_explicit` is only the source of the proposal PARAMETER
         * `factor-value-edit.ts` builds, not the stored stamp.) That stamp is
         * right about WHO set the value (the user authorised this exact set)
         * and silent about WHAT IT RESTS ON. The
         * basis therefore survives only in the proposal and in what the Agent
         * says, so the result below tells it to say it.
         *
         * ✅ CLOSED AT THE WRITER (review of #1851, B2; RC #63 5825007295): an adopted Olumi
         * value that arrives WITHOUT levels is stamped `user_assumption` by the writer
         * itself, from a server-internal approved-adoption context (below;
         * `approved-adoption-context.ts`) — the same verified-identity idea as
         * `appliedProvenance`, carried in-process instead of on the wire. Routing it through
         * the compound path was tried first and rejected: it changes this path's per-value
         * identity, partial-outcome and disclosure behaviour.
         */
        const applied: { factor: string; requested: number; recorded: number | null }[] = [];
        const failures: { factor: string; detail: string }[] = [];
        const receipts: ReceiptSummary[] = [];
        /**
         * Did THIS approval's own write for that factor actually land? Decided per
         * operation by `valueWriteCommittedByThisRequest` — see its docblock for what the
         * served response carries and why nothing else can satisfy it.
         *
         * ⛔⛔ IT USED TO BE `r.status === 200 && (receipt || graph_hash moved)`, and that
         * reported refused writes as saved. A refused `factor_value_edit` answers HTTP 200
         * (the refusal is committed as a turn), a guest gets no receipt, and the graph hash
         * moves for ANY writer — so an unrelated edit landing in the same window turned a
         * refusal into "Saved", and the old value read back became the "recorded" figure.
         */
        const ownWrite = new Map<string, boolean>();
        /** What THIS approval's own committed write stored, per target — the historical fact. */
        const ownNative = new Map<string, number>();
        /** The frame the factor already carries, read from the pre-write state. */
        const beforeById = new Map((before.nodes ?? []).map((n) => [n.id, n]));
        const capOf = (id: string): number | undefined => {
          const c = ((beforeById.get(id)?.observed_state ?? {}) as { cap?: unknown }).cap;
          return typeof c === 'number' && c > 0 ? c : undefined;
        };
        for (let i = 0; i < ops.length; i += 1) {
          const o = ops[i];
          const v = (o.value ?? {}) as { value?: number; unit?: string };
          if (typeof v.value !== 'number') { failures.push({ factor: o.path, detail: 'no value stored on the proposal' }); continue; }
          const approvedValue = v.value;
          const send = () => dispatch('/orchestrate/v2/turn', {
            kind: 'system_event',
            turn_id: authorisationTurnId(`${decision.proposal.proposal_id}#${i}`),
            scenario_id: ctx.scenario_id,
            stage: 'frame',
            event: {
              kind: 'factor_value_edit',
              target_id: o.path,
              // Same coherent {model, native} pair as the compound path — see the note
              // there. Only when the factor already carries a cap.
              ...(capOf(o.path) !== undefined
                ? { value: approvedValue / (capOf(o.path) as number), raw_value: approvedValue }
                : { value: approvedValue }),
              ...(v.unit !== undefined && v.unit !== '' ? { unit: v.unit } : {}),
            },
          });
          // ⭐ OLUMI'S FIGURE, ADOPTED, IS STORED AS AN ASSUMPTION (review of #1851, B2; RC #63
          // 5825007295). This proposal was verified by `proposals.authorise` above (scenario,
          // user, base revision), so its identity rides the in-process dispatch as a
          // server-internal context — never a wire field — and the writer stamps
          // `user_assumption` for exactly this target and value. A value the USER authored
          // (a revision they named, even inside a proposal that also holds Olumi's figures —
          // `valueOpAuthor`) sends no context: the writer's own stamp is the truth.
          const r = valueOpAuthor(o, decision.proposal) === 'model_proposed'
            ? await runWithApprovedAdoption(
              { scenarioId: ctx.scenario_id, proposalId: decision.proposal.proposal_id, targetId: o.path, rawValue: approvedValue },
              send,
            )
            : await send();
          // ⛔ OWN-WRITE EVIDENCE, PER OP, FROM THIS REQUEST'S OWN RESPONSE (Codex
          // 5810763729 item 4). A later read cannot tell "my write landed" from "the old
          // number was already there" or "someone else wrote it".
          const own = valueWriteCommittedByThisRequest(r, o.path);
          if (r.status !== 200) failures.push({ factor: o.path, detail: `http ${r.status}` });
          else if (!own) {
            // A 200 that is not this op's committed write: a refusal (committed as a turn,
            // nothing written) or a no-op. Olumi's own words say which, so they travel.
            const said = typeof r.json.assistant_text === 'string' ? r.json.assistant_text.trim() : '';
            failures.push({ factor: o.path, detail: said !== '' ? said : 'not recorded by this approval' });
          }
          const rc = receiptSummaryOf(r.json);
          // A receipt is reported only alongside this op's own committed write, so the
          // result can never pair "not recorded" with "saved as version N".
          if (own && rc.summary !== null) receipts.push(rc.summary);
          if (rc.unreadable) failures.push({ factor: o.path, detail: 'a receipt arrived but could not be read' });
          ownWrite.set(o.path, own);
          const mine = ownCommittedNative(r, o.path);
          if (mine !== undefined) ownNative.set(o.path, mine);
        }

        // ⛔ CONFIRMED FROM STATE. The handler may rescale what it was sent
        // (unit caps, percent-vs-fraction), so the recorded number is read back
        // and reported EVEN WHEN it differs from the one the user approved —
        // that difference is exactly the thing a user must not discover later.
        const afterSet = await readGraph(ctx.scenario_id);
        const byId = new Map((afterSet?.nodes ?? []).map((n) => [n.id, n]));
        const superseded: { id: string; factor: string; saved: number; now: number }[] = [];
        for (const o of ops) {
          const node = byId.get(o.path);
          const sos = (node?.observed_state ?? {}) as { value?: unknown; raw_value?: unknown; cap?: unknown };
          const sCap = typeof sos.cap === 'number' && sos.cap > 0 ? sos.cap : undefined;
          /**
           * ⛔ READ BACK THE NATIVE FIGURE, AND ONLY CALL IT SAVED IF THIS WRITE PUT IT
           * THERE (Codex 5810763729 item 4).
           *
           * The old line was `recorded: typeof stored === 'number' ? stored : null` over
           * `observed_state.value`, and `landed` was every row whose `recorded` was not
           * null. Both halves were wrong in the same direction: a factor that ALREADY
           * held 0.7 still reads a number back after a refused write, so the refusal was
           * reported as "Saved", and the number shown was the model's divisor rather than
           * the user's own. So: read the native figure (`raw_value`, else the model value
           * scaled back up by the cap), and require THIS operation's own committed write
           * (`ownWrite`, from its own response — never a receipt-or-hash guess).
           *
           * ⚠ A RESCALE IS STILL REPORTED, NOT SUPPRESSED. When the handler stores a
           * different number from the one approved, `recorded` carries what is actually
           * in the model and the caller names the difference — that behaviour is the
           * point of reading state back and it is deliberately unchanged. What is new is
           * that a row with NO write behind it can no longer count as landed.
           */
          const storedNative =
            typeof sos.raw_value === 'number'
              ? sos.raw_value
              : typeof sos.value === 'number' && sCap !== undefined
                ? sos.value * sCap
                : typeof sos.value === 'number'
                  ? sos.value
                  : undefined;
          const req = ((o.value ?? {}) as { value?: number }).value;
          applied.push({
            factor: node?.label ?? o.path,
            requested: typeof req === 'number' ? req : Number.NaN,
            // ⛔ NO EXTRA KEY ON THIS ROW. An earlier version added `no_write_recorded: true`
            // to rows with no own-write evidence, and `adopt-assumptions.test.ts` — a
            // DIFFERENT file, whose reader set I had not derived — asserts this row's exact
            // shape: "expected [{…(3)},{…(4)}] to deeply equal [{…(3)},{…(3)}]". `recorded:
            // null` already carries the whole meaning, so the diagnostic key is dropped
            // rather than the contract widened.
            recorded: ownWrite.get(o.path) === true && storedNative !== undefined ? storedNative : null,
          });
          /**
           * ⛔ SAVED BY US, THEN CHANGED BY SOMEONE ELSE (Codex pre-review of #1851, 5825735512).
           * Our write committed, but the fresh read holds a different figure from the one OUR
           * commit stored: another writer changed the same target in between. The row then keeps
           * what THIS approval saved (the historical fact) — never the other writer's figure as a
           * "rescale" — and the present state is reported separately. Nothing after this point
           * frames, re-reads or describes that target as this approval's.
           */
          const mine = ownNative.get(o.path);
          const last = applied[applied.length - 1]!;
          if (ownWrite.get(o.path) === true && mine !== undefined && storedNative !== undefined && storedNative !== mine) {
            last.recorded = mine;
            superseded.push({ id: o.path, factor: last.factor, saved: mine, now: storedNative });
          }
        }
        const landed = applied.filter((a) => a.recorded !== null);
        /**
         * ⛔ EVERYTHING AFTER THE VALUE WRITES FOLLOWS WHAT THIS APPROVAL COMMITTED, NOT WHAT IT
         * PROPOSED (Codex pre-review of #1851, 5825603926). With one value landed and another
         * refused, the range framing below selected every PROPOSAL op, so it could rescale and
         * register the refused target — a write to a factor whose own write was just refused — and
         * the note said the refused value was "stored". Aligned with `applied` by index.
         */
        const supersededIds = new Set(superseded.map((x) => x.id));
        const landedOps = ops.filter((o, i) => applied[i] !== undefined && applied[i]!.recorded !== null && !supersededIds.has(o.path));
        const notLandedLabels = ops
          .filter((_, i) => applied[i] === undefined || applied[i]!.recorded === null)
          .map((o) => beforeById.get(o.path)?.label ?? o.path);
        if (landed.length === 0) {
          return {
            ok: false, mutated: false, applied: false, refusal: 'not_applied',
            // ⛔ NOT "the model is unchanged": a refusal proves only that THIS approval
            // wrote nothing. Another writer may have changed the model in the same window.
            detail:
              'None of the values were recorded, so this approval left the model unchanged. Read the model again ' +
              'before describing it: someone else may have changed it meanwhile.',
            failures, values: applied,
          };
        }

        /**
         * ⭐ ATTACH A SCALE FRAME TO ANYTHING THAT LANDED AS A BARE AMOUNT.
         *
         * ⛔ WHY THIS SECOND WRITE EXISTS, measured end to end. A factor above
         * 1 with no `cap` is refused by `run_analysis`
         * (`baseline_scale_unresolved`) and the refusal is permanent:
         * `factor_value_edit` is `.strict()` with no cap field, and posting a
         * `{value, raw_value}` pair is accepted with HTTP 200 then normalised
         * back to `raw === value`. Construction publishes the frame inside
         * `observed_state`, which survives because `ObservedStateSchema` is
         * `.passthrough()` — but a factor with NO baseline at construction has
         * no `observed_state` to carry one (`value` is required), and a
         * node-level `cap` is stripped by `NodeV3Schema`. So a factor that
         * gets its first value HERE, by adoption, would be unanalysable for
         * the life of the model.
         *
         * Measured on the deployed build: with the frame attached this way,
         * `analysis_ready` went `blocked` -> `ready`, blockers 0, and the run
         * produced win probabilities over 10,000 samples per option. Without
         * it, the same model refused.
         *
         * ⚠ The frame is DERIVED from the user's own number, `raw_value` keeps
         * that number untouched, and it is reported so the Agent says it.
         */
        const needsFrame = (afterSet?.nodes ?? []).filter((n) => {
          if (!landedOps.some((o) => o.path === n.id)) return false;
          const os = (n.observed_state ?? {}) as { value?: unknown; cap?: unknown };
          // ⛔ A factor that already carries a stored range was written ON it
          // by the value handler. A level above 1 there is the honest truth
          // about an over-range figure; deriving a new range for it would
          // rescale the baseline away from every option level on that factor.
          if (typeof n.scale_frame === 'number' && n.scale_frame > 1) return false;
          return typeof os.value === 'number' && Math.abs(os.value) > 1 && typeof os.cap !== 'number';
        });
        /**
         * ⛔⛔ CARRIES THE STABLE NODE ID, and the id is the load-bearing part.
         *
         * ⚠ CHANGES_REQUIRED from independent review of #1743, accepted. This list
         * held only the visible `label`, and the post-refusal readback joined the
         * fresh canonical nodes by `Map<label, node>` — where the LAST duplicate
         * label wins. Production-shaped counterexample: factors A and B both
         * display "Revenue"; A's frame is still absent after GRAPH_STALE, B is
         * framed by another writer and appears later in the fresh list. The map
         * resolved A's "Revenue" to B, dropped A, and told the user every factor
         * now has a range — while A still blocked the analysis. A label is a value
         * another object can satisfy; binding a claim to one is the estate's own
         * named trap, and I walked into it while fixing the rename case.
         *
         * ⭐ An id join also subsumes the rename case for free: the node is found,
         * and its CURRENT label is what the user is shown.
         *
         * `id` is internal only — it is stripped before the wire (`toWire` below)
         * so the emitted payload shape is unchanged, byte for byte.
         */
        type IntendedFrame = { id: string; factor: string; value: number; range: number };
        const toWire = (f: IntendedFrame) => ({ factor: f.factor, value: f.value, range: f.range });
        const framed: IntendedFrame[] = [];
        /** The ranges this turn INTENDED to attach but could not — kept so a
         *  failure can name which factors still have no range, instead of the
         *  reply implying nothing was written at all. */
        let rangesNotAttached: IntendedFrame[] = [];
        /**
         * ⛔ THE FIELD NAME MUST CARRY ITS OWN GUARANTEE. A consumer cannot tell a
         * verified absence from an intended one, so `ranges_not_attached` is
         * emitted ONLY when a post-refusal readback confirmed the factor still has
         * no range. When the readback fails this is set instead, and the consumer
         * says the present state is unknown rather than advising.
         *
         * CHANGES_REQUIRED on #1751 `f028650d`: the deterministic consumer turned
         * that event field into a present-state claim ("unchanged", "still needs a
         * range", "do not re-enter") with no readback between the refusal and the
         * sentence. Fixing only the consumer would leave the next consumer free to
         * make the same mistake; the contract is fixed here.
         */
        let currentStateUnknown = false;
        if (needsFrame.length > 0 && afterSet !== null) {
          const frameById = new Map<string, number>();
          for (const n of needsFrame) {
            const os = n.observed_state as { value: number; raw_value?: number };
            const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
            const range = defaultFrameFor(raw);
            if (range <= 1) continue;
            frameById.set(n.id, range);
            // ⛔ `framed` is NOT built here. It is the list reported back to the
            // user as `ranges_added_for_analysis`, and it must describe what the
            // write ACTUALLY DID — which is only knowable after the re-read
            // below decides which factors still need a frame. Building it here
            // meant a 200 reported ranges added for factors the code had
            // deliberately skipped because a competing writer already framed them.
          }
          if (frameById.size > 0) {
          /**
             * ⭐⭐ PATCH THE MODEL AS IT IS NOW, NOT AS IT WAS WHEN WE READ IT.
             *
             * ⛔ THE COUNTEREXAMPLE THIS CLOSES (owner note 5799139118, limb 1):
             * this write sends a WHOLE graph built from an earlier read. The
             * route's expectation is compared in ANALYSIS space, which EXCLUDES
             * labels — so a rename landing between our read and this write passes
             * the comparison and is then overwritten by our stale copy of the node.
             *
             * ⚠ I previously reported limb 1 as wholly uncloseable caller-side and
             * left it to the atomic-writer lease. That was too broad. A caller
             * cannot express an IDENTITY-space expectation — that part is true and
             * still belongs at the write boundary — but it CAN stop replaying stale
             * bytes, which is the other half the owner note named: *"a targeted
             * atomic patch … can avoid replaying the whole stale graph."*
             *
             * So: re-read, patch the FRESH nodes, and send those. An intervening
             * edit is preserved BY CONSTRUCTION rather than by a comparison that
             * cannot see it. The residual window shrinks from "user think-time plus
             * a model call" to the milliseconds between this read and the route's
             * own — and the route's CAS already covers its own read-to-write gap.
             *
             * ⛔ AND IT NEVER CLOBBERS A RANGE SOMEONE ELSE SUPPLIED: a factor that
             * already carries a usable frame in the fresh read is left alone. If
             * that leaves nothing to do, no write is attempted at all.
             *
             * A failed re-read falls back to the earlier read: degrading to
             * today's behaviour is right, because refusing the whole authorisation
             * because a READ failed would lose work the user already approved.
             */
            const nowRead = await readGraph(ctx.scenario_id);
            const base = nowRead ?? afterSet;
            const stillNeeds = new Map<string, number>();
            for (const [id, range] of frameById) {
              const node = base.nodes.find((n) => n.id === id);
              if (node !== undefined && frameOf(node) !== null) continue;
              /**
               * ⛔ AND IT MUST STILL HAVE A VALUE IN THE FRESH BYTES. `needsFrame`
               * validated `typeof os.value === 'number'` against the EARLIER read;
               * `patched` maps over the fresh one. A competing writer that cleared
               * a value therefore yielded `raw === undefined` and put `value: NaN`
               * on the wire — a number the selection filter never validated, on
               * bytes it never saw. The first site has this guard; this one did not.
               * A factor with no value is left without one rather than framed.
               */
              const freshOs = (node?.observed_state ?? {}) as { value?: unknown; raw_value?: unknown };
              const freshRaw = typeof freshOs.raw_value === 'number' ? freshOs.raw_value : freshOs.value;
              if (node === undefined || typeof freshRaw !== 'number' || !Number.isFinite(freshRaw)) continue;
              stillNeeds.set(id, range);
              // ⭐ Reported only now, from the FRESH node, so the sentence the user
              // reads and the bytes that were written are the same fact.
              framed.push({ id: node.id, factor: node.label, value: freshRaw, range });
            }
            const patched = base.nodes.map((n) => {
              const range = stillNeeds.get(n.id);
              if (range === undefined) return n;
              const os = (n.observed_state ?? {}) as { value: number; raw_value?: number };
              const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
              return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
            });
            /**
             * ⛔ THE SIBLING OF THE FRAME WRITE ABOVE, and it carried the same
             * omission. `afterSet` is a re-read, so it is fresher — but a read
             * is still a read, and this asserts `edges: afterSet.edges`, the
             * whole edge set as it was at that moment. Without an expected hash
             * a write landing in between is silently restored to its old value.
             *
             * ⚠ I CLAIMED THIS WAS FIXED ONCE AND IT WAS NOT. The claim went
             * into a commit message and a PR body while only the first site had
             * changed. Fixed now, and the guard below counts BOTH.
             */
            /**
             * ⛔ NO WRITE AT ALL WHEN THE RE-READ LEFT NOTHING TO DO — the docblock
             * above promised exactly this and it was false at BOTH sites.
             *
             * ⚠ Accepted from independent review of #1743. The gate was
             * `frameById.size`, computed BEFORE the re-read. When a competing writer
             * had already framed every factor, `stillNeeds` was empty, `patched`
             * equalled `base.nodes`, and a byte-identical WHOLE-GRAPH register still
             * went out — minting a model version the user did not cause and taking
             * the overwrite risk this block exists to remove, for nothing.
             *
             * Skipping is honest rather than synthetic: `framed` is now built inside
             * the `stillNeeds` loop, so it is empty here and
             * `ranges_added_for_analysis` is omitted. No claim, because no write.
             */
            const reg: { status: number; json: Record<string, unknown> } = stillNeeds.size === 0
              ? { status: 200, json: {} }
              : await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
              // ⛔⛔ SPREAD THE WHOLE GRAPH. This sent only `{ nodes, edges }`, so
              // every other top-level key was DELETED by a write whose purpose is
              // to stop the model being overwritten. They are not cosmetic:
              // `computeAnalysisAffectingGraphHashSha256` (`context/graph-hash.ts:149-162`)
              // hashes `options`, `goal_node_id` and `goal_constraints` too, so the
              // frame write destroyed analysis-affecting content. The value-batch
              // write at `:367` had it right all along — same spread, same reason.
              graph: { ...base.raw, nodes: patched, edges: base.edges },
              ...(base.graph_hash !== '' ? { expected_graph_hash: base.graph_hash } : {}),
              /**
               * ⭐ AND THE IDENTITY EXPECTATION, from the SAME read these bytes
               * come from. Patching fresh nodes preserves an intervening rename;
               * this REFUSES outright if one lands in the window between that
               * read and the route's own — which the analysis-space hash cannot
               * see, because its projection excludes labels.
               *
               * ⚠ The route enforces this only once CEE #1810 lands. Until then
               * it is an unknown top-level field and is ignored (the register
               * route has no body schema), so sending it early is safe and makes
               * the two land in either order.
               */
              ...(base.graph_identity_hash !== ''
                ? { expected_graph_identity_hash: base.graph_identity_hash }
                : {}),
            });
            if (reg.status !== 200) {
              const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
              /**
               * ⛔⛔ "NOTHING WAS WRITTEN" WAS UNTRUE HERE, AND IT IS THE WORST
               * KIND OF UNTRUE: the values were already saved, in their own
               * registration, BEFORE this frame write was attempted. Telling the
               * user nothing landed invites them to redo a write that succeeded.
               *
               * The two outcomes are now reported SEPARATELY — what was saved,
               * and what was not attached — because they are separately true.
               * The unattached list is captured before `framed` is cleared;
               * clearing it was itself losing the only record of which factors
               * still have no range.
               */
              rangesNotAttached = [...framed];
              const savedSomething = landed.length > 0;
              if (code === 'GRAPH_STALE') {
                /**
                 * ⛔⛔ THE REFUSAL ESTABLISHES ONE THING ONLY: *THIS* FRAME WRITE
                 * DID NOT LAND. It establishes nothing about the current model.
                 *
                 * ⚠ CHANGES_REQUIRED on a6dc18be, accepted in full. My previous
                 * wording asserted that the approved values were "unchanged",
                 * that "only the range" was missing, and that the analysis was
                 * "still blocked" — then told the user not to re-enter anything.
                 * But GRAPH_STALE means a COMPETING WRITER moved the canonical
                 * graph after the `afterSet` read. That writer may have changed a
                 * value, attached a range, or removed the factor. Every one of
                 * those sentences was authority the stale read cannot support,
                 * and the last one is advice that could lose the user's work.
                 *
                 * So: RE-READ, and describe only what the fresh read shows. When
                 * the read is unavailable, report the HISTORICAL EVENT and say
                 * the current state is unknown — never advise on a state we could
                 * not observe.
                 */
                const fresh = await readGraph(ctx.scenario_id);
                if (fresh === null) {
                  // Nothing here is verified, so nothing is claimed: the list is
                  // dropped and the unknown marker travels in its place.
                  rangesNotAttached = [];
                  currentStateUnknown = true;
                  failures.push({
                    factor: 'scale_frame',
                    detail: savedSomething
                      ? /**
                       * ⚠ THE HISTORICAL FACT IS BOUND TO ITS OWN TENSE. I asked
                       * the reviewer whether to withhold it entirely; on
                       * reflection that is my call, and withholding it is worse —
                       * it is the one thing that stops a user redoing a write
                       * that was accepted. What matters is that it cannot be
                       * READ as a current-state claim, so the sentence says the
                       * writes were accepted AT THE TIME and that whether those
                       * values are still in the model is unknown, rather than
                       * stating a fact and an UNKNOWN side by side.
                       */
                      'the model changed while the range was being attached, and it could not be read back afterwards. This turn\u2019s value writes were accepted AT THE TIME, and its range write was refused. Whether those values are still in the model, whether they now carry a range, and whether the analysis can run are ALL UNKNOWN, because the model could not be read. Read it again before describing or advising anything \u2014 and do not tell the user their figures are safe.'
                      : 'the model changed while this was being prepared and could not be read back. No range was attached by this turn; the current state is unknown — read it again and propose afresh.',
                  });
                } else {
                  // Derived from the FRESH read, never from what we intended:
                  // a competing writer may already have supplied a range.
                  /**
                   * ⭐⭐ KEYED ON `id`, WHICH IS THE ONLY KEY THAT CANNOT COLLIDE.
                   *
                   * A label join silently resolved one factor to a DIFFERENT factor
                   * sharing its label (see the `IntendedFrame` note above), and it
                   * could not find a renamed one at all. An id join answers both:
                   * present-and-framed, present-and-still-unranged, or absent.
                   *
                   * ⚠ And the message is built from the FRESH node's label, not the
                   * one this turn remembered — after a rename the user is shown the
                   * name the model now uses, not a name that no longer exists.
                   */
                  const byId = new Map<string, GraphRead['nodes'][number]>();
                  for (const n of fresh.nodes) {
                    const id = String((n as { id?: unknown }).id ?? '');
                    if (id !== '') byId.set(id, n);
                  }
                  /**
                   * ⛔⛔ AND A LABEL THAT IS NOT IN THE FRESH READ PROVES NOTHING.
                   * The join is on `label`, so a factor a competing writer RENAMED
                   * — the exact case GRAPH_STALE fires for — is simply absent from
                   * `byLabel`. `frameOf(undefined)` is null, so it survived the
                   * filter and was then printed BY ITS OLD LABEL as "still has no
                   * range": a present-state claim about a name the model no longer
                   * uses, from a read that never saw it. That is the same
                   * fabrication as the refusal copy this block was written to fix.
                   *
                   * So the three cases are separated. Found and unranged → named.
                   * Found and framed → dropped, someone supplied one. NOT FOUND →
                   * dropped from the named list and disclosed as unaccounted for,
                   * without asserting anything about it.
                   */
                  const unaccounted = rangesNotAttached.filter((f) => byId.get(f.id) === undefined);
                  const stillUnranged = rangesNotAttached
                    .filter((f) => byId.get(f.id) !== undefined && frameOf(byId.get(f.id)) === null)
                    // ⭐ The CURRENT label, from the fresh read. A factor renamed by
                    // a competing writer is named as the model now names it.
                    .map((f) => ({ ...f, factor: String((byId.get(f.id) as { label?: unknown }).label ?? f.factor) }));
                  rangesNotAttached = stillUnranged;
                  failures.push({
                    factor: 'scale_frame',
                    detail: savedSomething
                      ? 'the model changed while the range was being attached, so this turn attached none. Read back afterwards, ' +
                        (stillUnranged.length > 0
                          ? `these still have no range: ${stillUnranged.map((f) => f.factor).join(', ')}. Describe the values from that read, not from what was approved — someone else may have changed them.`
                          : 'every factor that could be found now has a range, so someone else supplied one. Describe the model from that read before advising anything.')
                        + (unaccounted.length > 0
                          ? ` ⚠ ${unaccounted.length} factor(s) this turn tried to frame could not be found in that read at all — they may have been renamed or removed, so nothing is claimed about them; read the model as it now stands.`
                          : '')
                      : 'the model changed while this was being prepared, so this turn attached no range. Read the model as it now stands before proposing again.',
                  });
                }
              } else {
                failures.push({
                  factor: 'scale_frame',
                  detail: `could not attach a range: http ${reg.status}`,
                });
              }
              framed.length = 0;
            }
          }
        }
        if (landed.length === applied.length) proposals.markApplied(decision.proposal.proposal_id, receipts);
        /**
         * ⛔⛔ RE-DERIVE THE SUBSTITUTION FROM THE FINAL WRITE, NOT THE FIRST ONE.
         *
         * ⚠ CHANGES_REQUIRED at `4c2d40b6`, accepted in full, and it is the same
         * shape as the disclosure defect one layer down: the READER was innocent
         * and the PRODUCER was wrong.
         *
         * `applied` is built from `afterSet` — the read taken BEFORE the scale
         * frame is attached. So for an approved bare amount of 40 with no prior
         * range: the frame write below registers `{value: 0.4, raw_value: 40,
         * cap: 100}`, but `rescaled` was computed from the earlier row (40 → 40)
         * and came out EMPTY. The model then computes with 0.4 while the reply
         * said the approved figures were "stored unchanged".
         *
         * That is the authorship failure this lane exists to prevent: the person
         * approved 40, the analysis uses 0.4, and the translation was invisible.
         * No consumer could recover it, because the fact was never emitted.
         *
         * So the recorded side is re-read from the bytes that actually landed. A
         * failed re-read does not fabricate one: it falls back to the arithmetic
         * we know we sent (`raw / range`, on a register that returned 200) and
         * `frame_derivation_unread` records that it was derived rather than
         * observed.
         */
        let recordedUnread = false;
        if (framed.length > 0) {
          const finalRead = await readGraph(ctx.scenario_id);
          const finalById = new Map((finalRead?.nodes ?? []).map((n) => [n.id, n]));
          const framedRangeByLabel = new Map(framed.map((f) => [f.factor, f.range]));
          if (finalRead === null) recordedUnread = true;
          for (let i = 0; i < ops.length; i += 1) {
            const row = applied[i];
            if (row === undefined || row.recorded === null || supersededIds.has(ops[i].path)) continue;
            const node = finalById.get(ops[i].path);
            const finalValue = node?.observed_state?.value;
            if (typeof finalValue === 'number') {
              row.recorded = finalValue;
              continue;
            }
            // Fresh read unusable for this node: derive from what we sent.
            const range = framedRangeByLabel.get(row.factor);
            if (typeof range === 'number' && range > 1 && typeof row.requested === 'number') {
              row.recorded = row.requested / range;
              recordedUnread = true;
            }
          }
        }
        const rescaled = landed.filter((a) => a.recorded !== a.requested);
        return {
          ok: true, mutated: true, applied: true,
          proposal_id: decision.proposal.proposal_id,
          receipts,
          adopted_count: landed.length,
          requested_count: applied.length,
          values: applied,
          revision_before: before.graph_hash,
          revision_after: afterSet?.graph_hash ?? before.graph_hash,
          ...(failures.length > 0 ? { failures } : {}),
          ...(superseded.length > 0 ? { changed_since_by_another_writer: superseded.map(({ factor, saved, now }) => ({ factor, saved, now })) } : {}),
          ...(rescaled.length > 0
            ? { rescaled_by_the_model: rescaled, must_disclose_rescaling: true }
            : {}),
          ...(framed.length > 0 ? { ranges_added_for_analysis: framed.map(toWire) } : {}),
          /**
           * ⭐ THE PARTIAL OUTCOME, STATED RATHER THAN IMPLIED. A value write and
           * a frame write are two registrations; the first can land and the
           * second refuse. Reporting only aggregate success let the reply claim
           * "applied" while the analysis was still blocked.
           *
           * `partially_applied` is this file's existing word for it (`:395`,
           * `:463`). Present only when it is true, so its presence is the signal.
           */
          // ⚠ PRESENT-STATE UNKNOWN, stated rather than implied by an absence.
          // Travels even when `ranges_not_attached` is empty, which is exactly
          // when a consumer must not advise.
          ...(currentStateUnknown ? { partially_applied: true, current_state_unknown: true } : {}),
          ...(rangesNotAttached.length > 0
            ? {
              partially_applied: true,
              ranges_not_attached: rangesNotAttached.map(toWire),
              // A factor whose amount has no range cannot be read against
              // anything, so the analysis stays blocked for it whatever else
              // landed. Named, so the Agent cannot report a clean success.
              // ⚠ DERIVED FROM THE FRESH READ, not from what this turn intended.
              // On GRAPH_STALE `rangesNotAttached` has already been filtered to
              // the factors a re-read shows STILL have no range; when the read
              // failed it is the unfiltered intent and the detail above says the
              // current state is unknown, so nothing here claims otherwise.
              analysis_still_blocked_for: rangesNotAttached.map((f) => f.factor),
            }
            : {}),
          // Per value, whoever authored the proposal (Codex 5825564214: a user-only revision was still told
          // "adopted assumptions … no mark", though it is stored as the user's own figure).
          not_represented:
            `${valueAuthorshipNote(landedOps, decision.proposal, (id) => beforeById.get(id)?.label ?? id)}` +
            (notLandedLabels.length > 0
              ? ` ${notLandedLabels.join(', ')} ${notLandedLabels.length === 1 ? 'was' : 'were'} NOT recorded by this approval.`
              : '') +
            (superseded.length > 0
              ? ' ' + superseded.map((x) => `${x.factor} was saved by this approval as ${x.saved}, but someone else has since changed it to ${x.now}`).join('; ') +
                ' — describe it from the model as it now stands, not as this approval\u2019s figure.'
              : '') +
            ' Say so when you describe what changed' +
            (rescaled.length > 0 ? ', and state every value the model stored differently from the one approved.' : '.') +
            (rangesNotAttached.length > 0
              ? ' \u26a0 This turn could not attach a range to ' +
                rangesNotAttached.map((f) => f.factor).join(', ') +
                ' because the model changed underneath it. Describe those factors from the model as it now stands — ' +
                'another person may have changed a value or supplied a range — and do not tell the user their figures ' +
                'are safe or unchanged unless the current model shows it.'
              : '') +
            (framed.length > 0
              ? ' Some of them had no range to be read against, which would have stopped the analysis running ' +
                'at all, so a range was taken from the figure itself: ' +
                framed.map((f) => `${f.factor} 0 to ${f.range}`).join(', ') +
                '. That is a unit of measurement rather than a forecast or a limit. ' +
                // ⛔ "the approved figures are stored unchanged" WAS FALSE, and it was the
                // sentence that hid the whole translation. The user's figure is preserved
                // as the raw value, but the number the analysis computes with is that
                // figure divided by the range — 40 on a 0-to-100 range is 0.4. Both
                // representations must be named, because only then is the authorship
                // legible: the person authored 40, and 0.4 is the product's encoding of it.
                'The figure each person approved is kept exactly as they gave it, and the ' +
                'number the analysis computes with is that figure measured against its range ' +
                '— state BOTH when you describe what changed, never only one. ' +
                (recordedUnread
                  ? 'One or more of those computed figures could not be read back and was derived ' +
                    'from the range instead, so describe it as derived rather than as observed. '
                  : '') +
                'The user should be told and invited to correct any range that is wrong.'
              : ''),
        };
      }

      const op = ops[0];
      const [fromId, toId] = op.path.split('::');
      const { effect_direction: direction, magnitude: storedMagnitude } = op.value as { effect_direction: 'positive' | 'negative'; magnitude?: unknown };
      /**
       * ⭐ THE STRENGTH SENT IS THE USER'S BAND (#70 5845493088): `proposeModelChange` stores the midpoint of the band the
       * user typed, and the writer stamps it `user_specified` — now true. ⚠ A proposal restored from the durable carrier
       * that was made BEFORE that rule carries no magnitude: it keeps the projection default 0.5 and its disclosure
       * (`placeholder_strength`), so nothing restored breaks.
       */
      const usersStrength = typeof storedMagnitude === 'number' && Number.isFinite(storedMagnitude) && storedMagnitude > 0 && storedMagnitude <= 1
        ? storedMagnitude : undefined;
      /**
       * ⭐ THE OPERATION IDENTITY IS DERIVED, NOT MINTED.
       *
       * This was `randomUUID()`. A fresh id per authorisation means a retry of
       * the SAME authorisation is a different operation to every layer beneath
       * it, so `(scenario_id, turn_id)` can never match and the deployed
       * `append_turn_atomic_v5` replay arm is unreachable by construction.
       *
       * The proposal id is already the stable client/operation identity: it is
       * hashed over the scenario, the user, the base revision and the exact
       * operations, so the same authorisation of the same proposal yields the
       * same key, and a different mutation yields a different one.
       *
       * ⚠ This does NOT by itself deliver durable replay. At the served SHA,
       * `structural-add-edge.ts` computes the current hash and refuses
       * `BASE_HASH_DIVERGED` BEFORE `payload.turn_id` is read, so the app-level
       * gate answers first and the DB's replay-before-CAS arm is still not
       * reached. What this change does is make that boundary MEASURABLE rather
       * than masked by an identity that never repeats.
       */
      const operationId = authorisationTurnId(decision.proposal.proposal_id);
      const res = await dispatch('/orchestrate/v2/turn', {
        kind: 'system_event',
        turn_id: operationId,
        scenario_id: ctx.scenario_id,
        stage: 'frame',
        event: {
          kind: 'structural_add_edge',
          from: fromId,
          to: toId,
          // The midpoint of the band the user typed (`proposeModelChange`). ⚠ A proposal
          // restored from before that rule has none, and the wire REQUIRES a magnitude and
          // forbids `unknown`: it sends the projection default, not the user's claim, and
          // the result says so below.
          magnitude: usersStrength ?? 0.5,
          effect_direction: direction,
          base_graph_hash: decision.proposal.base_graph_identity_hash,
        },
      });

      const after = await readGraph(ctx.scenario_id);
      const confirmation = confirmEdgeWrite({
        revision_before: before.graph_hash,
        revision_after: after?.graph_hash ?? before.graph_hash,
        edgeExistsAfter: (after?.edges ?? []).some((e) => e.from === fromId && e.to === toId),
        system_message: String(res.json.assistant_text ?? ''),
      });
      /**
       * ⛔ A LINK THIS WRITE ADDED IS NEVER "NOT SAVED" FOR WHAT HAPPENED AFTER IT (round-2 review of
       * fix/agent-never-shows-instructions-or-codes, blocker 2's class). Landed-ness here is the read-back alone, so a
       * failed read-back, or a link another writer removed straight after this write committed it, read "Not saved: none
       * of it was applied." Same rule as the link-strength branch.
       */
      if (!confirmation.applied && after === null && res.status === 200) {
        return {
          ok: false, mutated: false, applied: false, refusal: 'not_confirmed', proposal_id: decision.proposal.proposal_id,
          detail: 'Olumi could not read the model back to confirm whether the link was added. Tell the user plainly that it could not be confirmed, and offer to check again.',
          http: res.status, operation_id: operationId,
        };
      }
      const hasTheLink = (edges: unknown): boolean => Array.isArray(edges)
        && (edges as { from?: unknown; to?: unknown }[]).some((e) => e?.from === fromId && e?.to === toId);
      if (!confirmation.applied && committedThenMoved(res, before.graph_hash, after, (draft) => hasTheLink(draft.edges))) {
        return {
          ok: false, mutated: true, applied: false, refusal: 'not_verified', proposal_id: decision.proposal.proposal_id,
          detail: 'The link was added, but the model changed again straight afterwards and no longer shows it, so what it now holds could not be confirmed. Read the model again before saying what it holds; do not describe the link as added.',
          http: res.status, operation_id: operationId,
        };
      }
      if (!confirmation.applied) {
        return {
          ok: false, mutated: false, applied: false, refusal: 'not_applied',
          detail: describeOutcome(confirmation), http: res.status, operation_id: operationId,
        };
      }
      const edgeReceipt = receiptSummaryOf(res.json);
      const edgeReceipts = edgeReceipt.summary !== null ? [edgeReceipt.summary] : [];
      proposals.markApplied(decision.proposal.proposal_id, edgeReceipts);
      return {
        ok: true, mutated: true, applied: true,
        receipts: edgeReceipts,
        ...(edgeReceipt.unreadable ? { receipt_unreadable: true } : {}),
        proposal_id: decision.proposal.proposal_id,
        operation_id: operationId,
        revision_before: confirmation.revision_before,
        revision_after: confirmation.revision_after,
        ...(usersStrength !== undefined
          ? { detail: `Recorded with the strength the user stated, as their own estimate: ${decision.proposal.public_label}.` }
          : {
            // Olumi discloses this to the user deterministically; see disclosure.ts.
            placeholder_strength: true,
            not_represented:
              'The direction was recorded. No strength was stated by the user, so the model carries a ' +
              'placeholder strength that is not a measurement — say so if you describe the change.',
          }),
      };
    },

    async buildModelFromBrief(ctx, args): Promise<ToolResult> {
      if (callStructured === undefined) {
        return { ok: false, mutated: false, refusal: 'construction_unavailable' };
      }
      const brief = typeof args?.brief === 'string' ? args.brief.trim() : '';
      if (brief.length === 0) return { ok: false, mutated: false, refusal: 'empty_brief' };

      /**
       * ⭐ FIRST ASK WHETHER THIS CONSTRUCTION ALREADY COMMITTED — before the
       * populated-graph guard, and before any model call.
       *
       * ⛔ Independent review of #1691 at 84dadabb: after a build commits and its
       * response is lost, a retry hit the guard below first and answered
       * `model_already_exists`, so the derived operation id never reached the
       * registration replay arm. The model was saved; the Agent said it was not.
       *
       * If the version this brief's construction produced exists, recover its
       * receipt — no second model generation, no second version — and let the
       * SAME confirm-from-state block below report the model as it now stands.
       * A populated graph with no matching operation is a genuinely different
       * model, and keeps the refusal.
       */
      const prior = await findConstructionVersion(dispatch, ctx.scenario_id, brief);
      let built: ToolResult;
      if (prior !== null) {
        built = {
          ok: true, mutated: false, replayed: true, model_version: prior,
          detail: `This model was already built from this brief and saved as version ${prior.version_number}. Nothing was built twice.`,
        };
      } else {
        // ⛔ NEVER BUILD OVER A MODEL THAT ALREADY EXISTS. Registration replaces
        // the whole graph, so running this on a populated scenario would discard
        // work the user has already authorised.
        const before = await readGraph(ctx.scenario_id);
        if (before === null) return { ok: false, mutated: false, refusal: 'not_found' };
        if (before.nodes.length > 0) {
          return {
            ok: false, mutated: false, refusal: 'model_already_exists',
            detail: 'The model already has entities. Propose a change instead of rebuilding it.',
          };
        }
        built = await buildModelFromBrief(ctx.scenario_id, brief, dispatch, callStructured);
        if (built.ok !== true) return built;
      }

      // Confirmed from state, never from the write's own return value.
      const after = await readGraph(ctx.scenario_id);
      if (after === null || after.nodes.length === 0) {
        return { ok: false, mutated: false, refusal: 'model_not_readable_after_write' };
      }
      /**
       * ⭐ THE FIRST ANALYSIS, RUN BY OLUMI, ONCE (Paul, 5812069638) — ONLY when this request is the one
       * whose construction COMMITTED. Every retry shape fails this gate: a new turn id recovers the
       * version (`mutated: false, replayed: true`), a concurrent twin gets OPERATION_ID_REUSED (the
       * same), and the registration replay arm answers `mutated: true, replayed: true` — which is why
       * `replayed !== true` is required and `mutated` alone is not. The runner then checks admission,
       * the turn deadline and the (K, H) prior fact before the one dispatch.
       */
      let firstAnalysis: Record<string, unknown> | undefined;
      if (built.mutated === true && built.replayed !== true && opts.firstAnalysis !== undefined) {
        const outcome = await opts.firstAnalysis({
          scenarioId: ctx.scenario_id,
          constructionTurnId: registrationTurnId(ctx.scenario_id, constructionOperationId(ctx.scenario_id, brief)),
          revisionGraph: after.raw,
          revisionHash: after.graph_hash,
          requestId: ctx.request_id,
        });
        if (outcome.ran) onAnalysis?.({ scenario_id: ctx.scenario_id, status: 200, analysis_ready: outcome.analysisReady, blocks: [...outcome.blocks], trigger: 'auto_first_pass' });
        // What the Agent narrates from: the READBACK after the run — its confined summary and the
        // typed leader permission — never the run's own receipt. A failed read describes nothing.
        const postRun = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph`, {}).catch(() => null);
        const read = postRun !== null && postRun.status === 200 ? postRun.json : {};
        firstAnalysis = describeFirstAnalysisForAgent(outcome, {
          analysisState: read.analysis_state,
          analysisResult: read.analysis_result,
          analysisAdmission: read.analysis_admission,
        });
        // ⛔ C46 (d): the first pass withholds its leader as unrequested (policy), so the product cause is
        // carried beside that reason, read from the model just built — only where an analysis exists.
        if (firstAnalysis.ran === true || firstAnalysis.reason === 'already_ran_for_construction') {
          firstAnalysis = { ...firstAnalysis, claim_permissions: withNonlinearIdentity(firstAnalysis.claim_permissions, after.raw) };
        }
        if (outcome.ran) {
          firstAnalysisThisRequest = {
            revisionHash: after.graph_hash,
            result: {
              ok: true, mutated: false, ran: true, already_run_this_turn: true,
              ...(firstAnalysis.summary !== undefined ? { summary: firstAnalysis.summary } : {}),
              claim_permissions: firstAnalysis.claim_permissions,
              note: 'Olumi already ran the first analysis of this model on this turn, so it was not run again.',
            },
          };
        }
      }
      /**
       * ⭐ RETURN THE POST-BUILD STATE, so the Agent does not have to go and
       * fetch it. Measured on the preview path: the first turn called
       * `get_canonical_state`, then `build_model_from_brief`, then
       * `get_canonical_state` AGAIN, then `run_analysis` — four tool calls and
       * four model round trips, 85 s on the slowest sample against a 125 s
       * browser-proxy budget. The second read asks for something this call
       * already has in hand.
       */
      return {
        ...built,
        confirmed_entities: after.nodes.length,
        graph_revision: after.graph_hash,
        // The SAME projection get_canonical_state uses — see projectEntity.
        entities: after.nodes.map(projectEntity),
        structure: structuralFacts(after.nodes, after.edges),
        // (B) The goal as stated, the limits, and the ONE readiness verdict — the same projection as
        // get_canonical_state, so the first reply never contradicts the Run control.
        ...pickKeys(projectModelContext(after), ['goal', 'goals', 'limits', 'readiness']),
        ...(firstAnalysis !== undefined ? { first_analysis: firstAnalysis } : {}),
      };
    },

    /**
     * ⭐ ADD AN OPTION THE USER PICKED — the act RC named as missing.
     *
     * Proposal only, exactly like every other write on this lane: nothing changes
     * until `authorise_change`. The plan is computed by `planNewOption`, a pure
     * function, so the refusals are testable without a graph round trip.
     */
    async proposeNewOption(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      if (heldOptionThisRequest !== undefined) {
        return {
          ok: false, mutated: false, refusal: 'one_option_per_approval',
          detail: `${heldOptionThisRequest} is already prepared and waiting for the user's approval. Every option the user asked for `
            + 'goes into ONE propose_new_option call (`options`, up to 4): a second proposal in the same reply would have no button of '
            + 'its own. Offer the one that is prepared, and say plainly which you will add after the user approves it.',
        };
      }
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      type Asked = { factor_label?: unknown; direction?: unknown; level?: { value?: unknown; unit?: unknown; estimate?: unknown; basis?: unknown } | null };
      const askedOf = (xs: unknown): Asked[] => (Array.isArray(xs) ? xs.map((x) => (x ?? {}) as Asked) : []);
      /**
       * ⭐ SEVERAL OPTIONS, ONE CHANGE (F4; Canonical's typed transaction #1940, contract #70 5841655730). "Add A
       * and B" is ONE proposal the user approves once: every option is built into ONE held batch, and it lands
       * whole or not at all. A single option may still be sent without `options`.
       */
      const specs = Array.isArray(args?.options) && args.options.length > 0
        ? (args.options as unknown[]).map((o) => ({ label: String((o as { label?: unknown } | null)?.label ?? ''), acts_on: askedOf((o as { acts_on?: unknown } | null)?.acts_on) }))
        : [{ label: String(args?.label ?? ''), acts_on: askedOf(args?.acts_on) }];
      if (specs.length > MAX_OPTIONS_PER_TRANSACTION) {
        return {
          ok: false, mutated: false, refusal: 'too_many_options',
          detail: `One change can add at most ${MAX_OPTIONS_PER_TRANSACTION} options; this asks for ${specs.length}. Nothing was prepared. `
            + `Offer the first ${MAX_OPTIONS_PER_TRANSACTION} as one change, and add the rest after the user approves it.`,
        };
      }
      /**
       * ⛔ AN OPTION IS LINKED FROM THE DECISION IT ANSWERS — and only when that decision is unambiguous. With
       * none, or more than one, nothing is prepared and the user is asked: a guessed parent is a wrong model.
       */
      const decisions = g.nodes.filter((x) => x.kind === 'decision');
      if (decisions.length !== 1) {
        return {
          ok: false, mutated: false, refusal: 'no_single_decision',
          detail: decisions.length === 0
            ? 'The model has no decision to add an option to, so nothing was prepared. Tell the user plainly.'
            : 'The model has more than one decision, so it is not clear which one this option answers. Nothing was prepared; ask the user which decision it is for.',
        };
      }
      const decision = decisions[0]!;
      // ⭐ A factor the model lacks is added IN THIS SAME CHANGE (`planNewFactors`; Canonical 5843972346/5843988693).
      const planned = planNewFactors(g.nodes as never, Array.isArray(args?.new_factors) ? args.new_factors as readonly NewFactorRequest[] : []);
      if (!planned.ok) return { ok: false, mutated: false, refusal: planned.refusal, detail: planned.detail };
      const newFactors = planned.factors;
      // Each option is planned against the model PLUS the options before it: distinct ids, and no two options by one name.
      const plans: { spec: (typeof specs)[number]; plan: Extract<ReturnType<typeof planNewOption>, { ok: true }> }[] = [];
      for (const spec of specs) {
        const view = [...g.nodes, ...plans.map((x) => ({ id: x.plan.optionId, kind: 'option', label: x.plan.label }))];
        const plan = planNewOption(view as never, {
          label: spec.label,
          acts_on: spec.acts_on.map((a) => ({ factor_label: String(a.factor_label ?? ''), direction: a.direction === 'negative' ? 'negative' as const : 'positive' as const })),
          rationale: String(args?.rationale ?? ''),
          newFactors,
        });
        if (!plan.ok) {
          return { ok: false, mutated: false, refusal: plan.refusal,
            detail: `${specs.length > 1 ? `"${spec.label}": ` : ''}${plan.detail}${specs.length > 1 ? ' Nothing was prepared for any of the options: they are one change.' : ''}`,
            ...(plan.unresolved_labels ? { unresolved_labels: plan.unresolved_labels } : {}) };
        }
        plans.push({ spec, plan });
      }
      // A factor added for no option changes nothing the comparison can use: refused, never added on its own.
      const unused = newFactors.filter((f) => !plans.some((x) => x.plan.newActsOn.some((a) => a.key === f.key)));
      if (unused.length > 0) {
        return { ok: false, mutated: false, refusal: 'new_factor_unused',
          detail: `No option acts on ${unused.map((f) => `"${f.label}"`).join(', ')}. Nothing was prepared. Add a factor only for an option that changes it, and name it in that option\u2019s acts_on.` };
      }
      /**
       * ⛔ ONE CHANGE HAS A SIZE LIMIT, checked BEFORE anything is sent. A typed transaction CEE builds holds at
       * most TYPED_TRANSACTION_ENVELOPE_CAP changes; each option costs one, its decision link one, and one per
       * factor it acts on. Over the limit the product would refuse the batch — so it is refused here, in plain
       * words, with nothing sent.
       */
      // Each new factor costs one change for itself and one per thing it affects; the option's link to it is its acts_on.
      const envelopes = plans.reduce((n, x) => n + 2 + x.plan.actsOn.length + x.plan.newActsOn.length, 0)
        + newFactors.reduce((n, f) => n + 1 + f.affects.length, 0);
      if (envelopes > TYPED_TRANSACTION_ENVELOPE_CAP) {
        return {
          ok: false, mutated: false, refusal: 'too_many_links',
          detail: `That is ${envelopes} changes in one, and one change can carry at most ${TYPED_TRANSACTION_ENVELOPE_CAP} (each option, its link from the decision, and one per factor it acts on). `
            + 'Nothing was prepared. Suggest adding the options with the factors they change most, then linking the rest.',
        };
      }
      /**
       * ⭐ A LEVEL IS WRITTEN ONLY WHEN THE USER STATED IT — never invented to make the model runnable — and
       * ONLY ON THE RANGE THE LANE'S LEVEL WRITER USES (`levelFrameOf`: the declared cap, else the declared
       * `scale_frame`; independent review of #1933, 00:16Z). A figure on that range is stored as figure ÷ range,
       * with the figure kept. A figure outside it is refused with nothing sent (`proposeOptionInterventions`
       * refuses it too). A figure above 1 on a factor with NO range is left unset and said so: the lane's
       * writer derives a range and attaches it to the factor, which this one-change transaction cannot do, and
       * a bare figure beside levels stored as fractions would put one factor on two scales.
       */
      const rawNodes = ((g.raw as { nodes?: unknown }).nodes as { id: string; kind?: string; label?: string; description?: string }[] | undefined) ?? [];
      const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();
      const outOfRange: { option: string; factor: string; value: number; range: number }[] = [];
      const unitMismatch: { option: string; factor: string; value: number; unit: string; factor_unit: string }[] = [];
      const levelsNotSet: { option: string; factor: string; value: number; reason: string }[] = [];
      const entries = plans.map(({ spec, plan }) => {
        type Lvl = { value: number; unit?: string; estimate?: string; by?: 'user' | 'olumi' };
        const levelById = new Map<string, Lvl>();
        for (const a of spec.acts_on) {
          const v = a.level?.value;
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
          const f = rawNodes.find((x) => x.kind === 'factor' && (norm(x.label) === norm(a.factor_label) || norm(x.description) === norm(a.factor_label)));
          // Olumi's own suggested figure, with its basis (ChatGPT 5839692762 A: an EXPLICIT hypothesis, never silent).
          const basis = a.level?.estimate === true && typeof a.level?.basis === 'string' && a.level.basis.trim() !== '' ? a.level.basis.trim() : undefined;
          if (f !== undefined) levelById.set(f.id, { value: v, ...(typeof a.level?.unit === 'string' && a.level.unit.trim() !== '' ? { unit: a.level.unit.trim() } : {}), ...(basis !== undefined ? { estimate: basis } : {}) });
        }
        const set = new Map<string, Lvl>();
        const interventions = plan.actsOn.map((f) => {
          const lvl = levelById.get(f.id);
          if (lvl === undefined) return { factor_id: f.id, value: null };
          const factor = g.nodes.find((x) => x.id === f.id);
          // ⛔ A figure in another kind of unit is never this factor's level (`unit-conflict.ts`: a price as churn).
          const factorUnit = factorUnitOf(g.raw, factor);
          if (unitsConflict(lvl.unit, factorUnit) !== null) {
            unitMismatch.push({ option: plan.label, factor: f.label, value: lvl.value, unit: String(lvl.unit), factor_unit: String(factorUnit) });
            return { factor_id: f.id, value: null };
          }
          /**
           * ⛔ WHOSE LEVEL: the user's only when they wrote the figure (`stated-by-user.ts`: a 0 sent to mean "not set"
           * was stored as the user's 0% churn). Otherwise it is Olumi's ESTIMATE only when the Agent said so, with a
           * basis, and it is recorded and shown as that (`cee_hypothesis`, C2). Anything else is left unset and said.
           */
          const byUser = figureTheUserWrote(lvl.value, lvl.unit ?? factorUnit, ctx.user_text);
          if (!byUser && lvl.estimate === undefined) {
            levelsNotSet.push({ option: plan.label, factor: f.label, value: lvl.value, reason: notWrittenReason(lvl.value, f.label) });
            return { factor_id: f.id, value: null };
          }
          if (!byUser && contradictsItsName(lvl.value, lvl.unit ?? factorUnit, plan.label)) {
            levelsNotSet.push({ option: plan.label, factor: f.label, value: lvl.value,
              reason: `Olumi's estimate of ${lvl.value} for ${f.label} does not match the figure in the option's own name ("${plan.label}"), so that level is left unset. Use the figure in the name, or name the option for the figure you mean.` });
            return { factor_id: f.id, value: null };
          }
          lvl.by = byUser ? 'user' : 'olumi';
          const stamp = byUser ? {} : { source: 'cee_hypothesis' as const };
          const frame = levelFrameOf(factor);
          if (frame !== null) {
            const v = lvl.value / frame;
            if (!(v >= 0 && v <= 1)) {
              outOfRange.push({ option: plan.label, factor: f.label, value: lvl.value, range: frame });
              return { factor_id: f.id, value: null };
            }
            const os = (factor?.observed_state ?? {}) as { unit?: unknown };
            const unit = lvl.unit ?? (typeof os.unit === 'string' && os.unit !== '' ? os.unit : undefined);
            set.set(f.id, lvl);
            return { factor_id: f.id, value: v, raw_value: lvl.value, ...(unit !== undefined ? { unit } : {}), ...stamp };
          }
          if (lvl.value >= 0 && lvl.value <= 1) { set.set(f.id, lvl); return { factor_id: f.id, value: lvl.value, ...stamp }; }
          levelsNotSet.push({ option: plan.label, factor: f.label, value: lvl.value,
            reason: `The model has no range for ${f.label} to read ${lvl.value} against, so this change leaves that level unset. `
              + `Once the option is added, propose that level with propose_option_interventions, which records a range for ${f.label}.` });
          return { factor_id: f.id, value: null };
        });
        /**
         * A new factor starts with no level on this option: it has no range yet to read a figure against, and its
         * current value is set after it exists (Canonical's OPEN ruling). A level the user gave for it is said, not lost.
         */
        for (const a of plan.newActsOn) {
          const asked = spec.acts_on.find((x) => norm(x.factor_label) === norm(a.label))?.level?.value;
          if (typeof asked === 'number' && Number.isFinite(asked)) {
            levelsNotSet.push({ option: plan.label, factor: a.label, value: asked,
              reason: `"${a.label}" is new in this change and has no range yet, so its level is not set here. Once it is added, propose that level with propose_option_interventions.` });
          }
        }
        const added = plan.newActsOn.map((a) => ({ factor_key: a.key, value: null }));
        return { plan, set, entry: { label: plan.label, option_id: plan.optionId, interventions: [...interventions, ...added] } };
      });
      if (unitMismatch.length > 0) {
        const m = unitMismatch[0]!;
        return {
          ok: false, mutated: false, refusal: 'level_unit_mismatch', unit_mismatch: unitMismatch,
          detail: `${m.value} ${m.unit} is not a level for ${m.factor}, which the model measures in ${m.factor_unit}. Nothing was prepared. `
            + 'A figure the user gave for something else (a price, say) is never another factor\u2019s level. Call propose_new_option '
            + `once more with that level left out, and ask the user for ${m.factor}\u2019s own figure only if they want to set it.`,
        };
      }
      if (outOfRange.length > 0) {
        const o = outOfRange[0]!;
        return {
          ok: false, mutated: false, refusal: 'level_out_of_range', out_of_range: outOfRange,
          detail: `${o.value} is outside the model's range for ${o.factor} (0 to ${o.range}). Nothing was prepared. `
            + 'Ask the user for a figure within that range, in the same units, or whether that range itself is wrong.',
        };
      }
      /** The new factors a set of options uses: a factor only a left-out option acted on is left out with it. */
      const factorsOf = (es: typeof entries) => newFactors.filter((f) => es.some((e) => e.plan.newActsOn.some((a) => a.key === f.key)));
      const parametersOf = (es: typeof entries) => {
        const nf = factorsOf(es);
        const nfWire = nf.length === 0 ? {} : { new_factors: nf.map((f) => ({
          key: f.key, label: f.label,
          affects: f.affects.map((a) => ({ node_id: a.node_id, effect_direction: a.effect_direction })),
        })) };
        return es.length === 1
          ? { parent_decision_id: decision.id, ...es[0]!.entry, ...nfWire }
          : { parent_decision_id: decision.id, options: es.map((e) => e.entry), ...nfWire };
      };
      /**
       * ⛔ ONE TWIN NEVER SINKS THE REST (DL #70 5846812818, served F4/F4e). The product refuses a WHOLE batch when one
       * option repeats an existing option's levels, and names that option (`index`, `sameAs`). The valid options are
       * still the user's request: that one is left out, named with its twin (`not_added`), and the rest go as ONE
       * change. A lone option that is a twin is refused as before.
       */
      let kept = entries;
      const notAdded: { option: string; same_levels_as: string }[] = [];
      let parameters = parametersOf(kept);
      // The product's own transaction, run here purely: a spec it would not build is never sent.
      let built = buildAddOptionsTransaction(parameters, { nodes: g.nodes as never, edges: g.edges as never });
      while (!built.matched && built.reason === 'same_levels_as_existing_option' && built.sameAs !== undefined
        && kept.length > 1 && typeof built.index === 'number' && built.index >= 0 && built.index < kept.length) {
        const twinIndex = built.index;
        notAdded.push({ option: kept[twinIndex]!.plan.label, same_levels_as: built.sameAs.label });
        kept = kept.filter((_, i) => i !== twinIndex);
        parameters = parametersOf(kept);
        built = buildAddOptionsTransaction(parameters, { nodes: g.nodes as never, edges: g.edges as never });
      }
      const keptFactors = factorsOf(kept);
      if (!built.matched || JSON.stringify(built.operations).length > GM_HELD_OPERATIONS_MAX_JSON_CHARS) {
        const reason = !built.matched ? String(built.reason) : '';
        /**
         * ⛔ A TWIN IS NAMED (#1990 review, Runtime follow-up). The product refuses an option whose levels equal an
         * existing option's — the engine cannot tell them apart and the run drops one silently ("Not analysed").
         * The Agent says WHICH option it would repeat, so the user can change a level, never a bare "could not".
         */
        const twin = !built.matched && built.sameAs !== undefined ? built.sameAs.label : undefined;
        const why = reason === 'new_factor_unreachable'
          ? ' Nothing the new factor changes leads to the goal, so it could not affect the comparison: ask the user what it changes.'
          : reason === 'new_factor_exists'
            ? ' The model already has a factor by that name: name it in acts_on instead of adding it.'
            : reason === 'same_levels_as_existing_option'
              ? ` It would set exactly the same levels as "${twin ?? 'an option already in the model'}", so the analysis could not tell the two apart: `
                + 'say so, and ask the user which level this option should change.'
              : '';
        return { ok: false, mutated: false, refusal: 'not_prepared', ...(!built.matched ? { reason: built.reason } : {}),
          ...(twin !== undefined ? { same_levels_as: twin } : {}),
          ...(notAdded.length > 0 ? { not_added: notAdded } : {}),
          detail: `That could not be prepared as one change, so nothing was sent or changed.${why} Tell the user plainly.` };
      }
      const labels = kept.map((x) => x.plan.label);
      const r = await dispatch('/orchestrate/v2/turn', {
        kind: 'message', turn_id: authorisationTurnId(`agent_add_option:${ctx.scenario_id}:${JSON.stringify(parameters)}`), scenario_id: ctx.scenario_id,
        stage: 'frame', turn_class: 'frame', source: 'chip', message: `Add ${labels.map((l) => `the option "${l}"`).join(' and ')}.`,
        chip: { id: AGENT_ADD_OPTION_CHIP_ID, intent: 'add_option', parameters },
      });
      /**
       * ⛔ HELD, OR NOT PROPOSED. The only proof is the product's own handle for THIS batch (`gmh_` over the
       * scenario and the FIRST option's id), and, where the store can be read, the held batch itself adding
       * EVERY option WITH its decision link. Anything else is a hard failure: never retried in other words.
       */
      const ref = gmHeldProposalRef(ctx.scenario_id, `node:${kept[0]!.plan.optionId}`);
      const offered = Array.isArray(r.json.suggested_actions) ? r.json.suggested_actions as { id?: unknown; label?: unknown; message?: unknown }[] : [];
      const heldChip = r.status === 200 ? offered.find((c) => c?.id === ref) : undefined;
      let heldBatchOk = heldChip !== undefined;
      if (heldBatchOk && opts.readPendingActions !== undefined) {
        try {
          const hold = await liveHeldHold(ctx.scenario_id, ref);
          const ops = hold !== undefined ? heldOpsOf(hold) : [];
          heldBatchOk = kept.every(({ plan }) => ops.some((o) => o.op === 'add_node' && o.path === plan.optionId)
            && ops.some((o) => o.op === 'add_edge' && o.path === `${decision.id}::${plan.optionId}`))
            // Every factor this change adds is in the held batch too, as a factor.
            && keptFactors.every((f) => ops.some((o) => o.op === 'add_node'
              && (o.value as { kind?: unknown } | undefined)?.kind === 'factor'
              && norm((o.value as { label?: unknown } | undefined)?.label) === norm(f.label)));
        } catch {
          heldBatchOk = false;
        }
      }
      if (!heldBatchOk) {
        // A change the product REFUSED with its own sentence (no hold offered) — say that sentence, never a bare "could not".
        const said = heldChip === undefined && r.status === 200 && typeof r.json.assistant_text === 'string' ? r.json.assistant_text.trim() : '';
        return { ok: false, mutated: false, refusal: 'not_prepared',
          detail: said !== ''
            ? `Olumi did not prepare that change, so nothing was added. Olumi said: "${said}" Tell the user plainly; do not retry it in other words.`
            : 'Olumi could not prepare that as one change, so nothing was added. Tell the user plainly; do not retry it in other words.' };
      }
      heldOptionThisRequest = labels.map((l) => `"${l}"`).join(' and ');
      const described = kept.map(({ plan, set }) => ({
        label: plan.label,
        linked_from: String(decision.label ?? ''),
        acts_on: [...plan.actsOn.map((a) => a.label), ...plan.newActsOn.map((a) => a.label)],
        levels: plan.actsOn.map((f) => {
          const lvl = set.get(f.id);
          return lvl !== undefined
            ? { factor: f.label, value: lvl.value, ...(lvl.unit !== undefined ? { unit: lvl.unit } : {}),
              ...(lvl.by === 'olumi' ? { stated_by: 'olumi_estimate', basis: lvl.estimate } : { stated_by: 'user' }) }
            : { factor: f.label, value: null, still_needed: true };
        }),
      }));
      return {
        ok: true, mutated: false,
        proposal_id: ref,
        public_label: typeof heldChip!.label === 'string' && heldChip!.label.trim() !== '' ? heldChip!.label : kept[0]!.plan.publicLabel,
        held_message: typeof heldChip!.message === 'string' ? heldChip!.message : '',
        base_revision: g.graph_hash,
        ...(described.length === 1
          ? { option: { label: described[0]!.label, linked_from: described[0]!.linked_from, acts_on: described[0]!.acts_on }, levels: described[0]!.levels }
          : { options: described }),
        ...(levelsNotSet.some((l) => labels.includes(l.option)) ? { levels_not_set: levelsNotSet.filter((l) => labels.includes(l.option)) } : {}),
        ...(notAdded.length > 0 ? {
          not_added: notAdded,
          not_added_note: `${notAdded.map((n) => `"${n.option}" is NOT in this change: it would set exactly the same levels as "${n.same_levels_as}", so the analysis could not tell the two apart`).join('; ')}. `
            + 'Say that in one line, and ask the user what makes it different (for example, a factor it changes that the other does not). '
            + 'Never promise to add it later: it is added only by a new proposal the user approves.',
        } : {}),
        ...(keptFactors.length > 0 ? {
          new_factors: keptFactors.map((f) => ({
            label: f.label,
            changes: f.affects.map((a) => `${a.label} (${a.effect_direction === 'positive' ? 'raises it' : 'lowers it'})`),
            how_strongly: 'Olumi\u2019s estimate, for the user to correct',
            current_value: null,
          })),
          new_factors_note: 'This change also ADDS these factors. Say so: what each changes and which way, that how strongly is Olumi\u2019s '
            + 'estimate, and that its current value is not set yet. Ask the user what it is today (for example, whether it is '
            + 'offered at all yet) \u2014 nothing else will ask, and the comparison needs it; never say the analysis will ask for it.',
        } : {}),
        note:
          `Nothing has changed yet. Show the user ${described.length === 1 ? 'the option' : `all ${described.length} options, as ONE change they approve once`}, `
          + 'that each is linked from the decision, what it acts on and each level — saying plainly which have no level yet, and which '
          + 'levels are Olumi\u2019s estimates (stated_by olumi_estimate), with why, for the user to correct — never the id, '
          + 'and call authorise_change with this proposal_id once they agree.',
      };
    },

    async proposeGoalCurrentLevel(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      return proposeGoalCurrentLevel({ readGraph, proposals }, ctx, args);
    },

    async runAnalysis(ctx, args): Promise<ToolResult> {
      if (approvalAppliedThisRequest) {
        return {
          ok: false, mutated: false, ran: false, refusal: 'run_not_requested',
          detail:
            'The approved change is saved. An analysis runs only when the user asks for one, never as part ' +
            'of an approval. Nothing was analysed: do not describe any result, and tell the user they can ' +
            'run the analysis when they are ready.',
        };
      }
      /**
       * The model asked again on the build turn itself: the first analysis of THIS revision already ran in
       * this request, so it is returned rather than run twice. Verified against a fresh read — if the
       * model moved since, this is a new analysis and it runs.
       */
      if (firstAnalysisThisRequest !== undefined) {
        const now = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph`, {}).catch(() => null);
        if (now !== null && now.status === 200 && now.json.graph_hash === firstAnalysisThisRequest.revisionHash) {
          return firstAnalysisThisRequest.result;
        }
      }
      const r = await dispatch('/orchestrate/v2/turn', {
        kind: 'message',
        // Deliberately NOT derived, unlike the authorised write above: asking
        // for the analysis twice is two operations the user actually made, and
        // collapsing them onto one identity would suppress the second.
        turn_id: randomUUID(),
        scenario_id: ctx.scenario_id,
        stage: 'analyse',
        turn_class: 'decide',
        source: 'chip_click',
        message: args.reason,
        chip: { id: AGENT_RUN_ANALYSIS_CHIP_ID, action_type: 'run_analysis' },
      });
      /**
       * ⛔ A RUN THAT FAILED IS NOT A RUN THAT WAS REFUSED (served 319dde1, 01:42Z). The run turn answered 500
       * (the saved model could not be read), and the Agent explained it from the stale analysis state as "the saved
       * graph has changed" — a cause that was false. Olumi cannot know the reason from here, so the Agent is told
       * exactly what is true: it did not run, nothing changed, try again — and to give no other reason.
       */
      if (r.status !== 200) {
        onAnalysis?.({ scenario_id: ctx.scenario_id, status: r.status, blocks: [] });
        return {
          ok: false, mutated: false, ran: false, refusal: 'run_failed', http: r.status,
          detail: 'The analysis could not be run: something went wrong on Olumi\u2019s side while starting it, so nothing ran and nothing in the '
            + 'model changed. Tell the user exactly that and suggest trying again in a moment; do not give any other reason, and do not '
            + 'describe an earlier result as the current one.',
        };
      }
      const ready = (r.json.analysis_ready ?? {}) as Record<string, unknown>;
      const blocks = (r.json.blocks as { type: string }[] | undefined) ?? [];
      const result = blocks.find((b) => b.type === 'analysis_result');
      onAnalysis?.({ scenario_id: ctx.scenario_id, status: r.status, analysis_state: r.json.analysis_state, analysis_ready: r.json.analysis_ready, blocks });
      const permissions = claimPermissionsFrom(r.json.analysis_state, r.json.analysis_ready, { requested: true });
      // ⛔ C46 (d): only a run that produced a result and withheld its leader is read against the model
      // (one graph read); a named leader means the Run's own stamp found no product in the way.
      let graphForProduct: unknown;
      if (result !== undefined && permissions.leader_may_be_named !== true) {
        try { graphForProduct = (await readGraph(ctx.scenario_id))?.raw; } catch { graphForProduct = undefined; }
      }
      return {
        ok: r.status === 200,
        mutated: false,
        ran: result !== undefined,
        status: ready.status ?? 'unknown',
        // Olumi's own words about what is missing. Not re-worded here.
        what_is_missing: String(r.json.assistant_text ?? ''),
        blockers: ready.blockers ?? [],
        options: ready.options ?? [],
        ...(result !== undefined ? { result } : {}),
        // The typed leader permission for THIS run, read from its own wire verdict — so the Agent names a
        // leader only when `leader_may_be_named` (see the route's reporting instruction). `requested`: every
        // run_analysis dispatch is one the user asked for (the Agent's own call, or the Run chip's fast path);
        // the automatic first analysis reads its permission in `describeFirstAnalysisForAgent`, not here.
        claim_permissions: graphForProduct === undefined ? permissions : withNonlinearIdentity(permissions, graphForProduct),
      };
    },
  };
  return {
    ...caps,
    // The approval guard's writer: every return path of `authoriseChange`, one place.
    async authoriseChange(ctx, args): Promise<ToolResult> {
      const r = await caps.authoriseChange(ctx, args);
      if (r.applied === true || r.mutated === true) {
        approvalAppliedThisRequest = true;
        // ⭐ (B) WHAT THE MODEL NEEDS NOW, from the graph as stored after the write — one place for every
        // apply path (the in-turn tool and the typed-approve fast path). A failed read says "not checked".
        let after: GraphRead | null = null;
        try { after = await readGraph(ctx.scenario_id); } catch { after = null; }
        return { ...r, readiness_after: readinessViewOf(after?.raw) };
      }
      return r;
    },
  };
}
