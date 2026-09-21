/**
 * ⭐⭐ THE PRODUCTION SUPPLIER FOR `applyOperations` — the missing half of the
 * accept path.
 *
 * THE PRODUCT DEFECT THIS CLOSES
 * ------------------------------
 * The replacement conversation controller can offer a change and record that
 * the user agreed to it. It cannot save one: its accept tool is built only
 * when an `applyOperations` port is injected, and no production implementation
 * existed. So the product could ask "shall I?", hear "yes", and have nowhere
 * to put the answer. The controller's own prompt tells the user that saving is
 * unavailable in that state, which is honest and useless.
 *
 * The controller deliberately did NOT build this itself, on the grounds that a
 * second copy of the commit path's projection discipline inside the
 * conversation layer would be the hand-maintained mirror one level down. That
 * is right, and it is why this lives here instead.
 *
 * WHAT IT IS, PRECISELY
 * ---------------------
 * A thin adapter over the canonical turn-append seam. It owns six lines of
 * ordering and nothing else — every step below is an existing exported
 * function, called in the order the one worked production example calls them:
 *
 *   load base → normalise paths → validate → apply → encode → project →
 *   build the handler fact → commit → read back and verify.
 *
 * ⚠ THE MODULE IT FOLLOWS IS NAMED HERE BY DESCRIPTION, NOT BY ITS
 * IDENTIFIER, AND THAT IS DELIBERATE — the same reason the conversation
 * layer does it. `routing/__tests__/consent-coverage-manifest.test.ts` pins
 * that writer's production consumers at EXACTLY ONE, and its detector is a
 * whole-file source-spelling scan that deliberately includes comments. This
 * module does not import it, call it, or reach it at runtime; spelling its
 * name in this paragraph would enrol this file as a second consumer and RED
 * the guard, while the sentence the paragraph makes is the opposite.
 *
 * WHAT IT IS NOT
 * --------------
 * ⛔ NOT a second graph writer. It calls the single canonical `scenarios.graph`
 * writer, so the turn row, the fence, the handler facts, the pending-action
 * carry-forward and the model-version receipt all happen exactly once, in one
 * transaction, the way every other durable write in this service happens.
 *
 * ⛔ NOT a consent mechanism, and it does not pretend to be one. The mutation
 * referee is not evidence of consent and is deliberately not invoked here:
 * this adapter is reached only from a controller whose proposal store refuses
 * `open → applied`, binds consent to the exact operation list as it was shown,
 * and names the user turn that gave it. Consent is settled BEFORE the call.
 * This module's job is to make the write land, once, or say why not.
 *
 * ⚠ RECORDED, NOT HIDDEN: because this commits outside the turn executor's
 * commit closure, the withheld-consent backstop does not see it. Its path is
 * entered in the coverage manifest for that reason, with this paragraph as its
 * recorded justification, rather than left to be discovered.
 *
 * THE THREE OUTCOMES, AND WHY THE THIRD IS A THROW
 * ------------------------------------------------
 * The caller distinguishes three states and acts differently on each:
 *
 *   { ok: true, receiptId }  it landed, and this is the proof
 *   { ok: false, reason }    it AFFIRMATIVELY did not land; retry is safe
 *   throw                    UNKNOWN; the caller keeps the proposal in flight
 *                            and reconciles on a later turn
 *
 * Every refusal below is returned as `ok: false` only when NOTHING was sent.
 * Once the commit has been dispatched, every failure — including a readback
 * that disagrees — throws, because after a dispatch "it did not save" is a
 * claim nobody is entitled to make. A transport error need not prove rollback.
 *
 * ⛔⛔ THE KNOWN LIVE DEFECT THIS DELIBERATELY DOES NOT PAPER OVER
 * ---------------------------------------------------------------
 * At-most-once is a database uniqueness constraint on `(scenario_id, turn_id)`
 * — `ON CONFLICT DO NOTHING`, then return the existing row id. That is why
 * {@link ApplyOperationsInput.idempotencyKey} becomes the turn id and why a
 * replay is a no-op that returns the same receipt.
 *
 * ⚠ On the DEPLOYED function body, `append_turn_atomic_v5` evaluates its
 * compare-and-swap BEFORE it looks up whether the turn already exists, while
 * the v4 body it delegates to does the opposite and says why ("SKIP CAS
 * ENTIRELY and return the existing row id — retry safety"). So a replay of an
 * already-committed turn RAISES a stale-write error whenever the graph head
 * has moved on since that commit — which is the NORMAL state during the
 * interruption a replay exists to recover from. The caller is told its write
 * was refused as stale. The write committed.
 *
 * `supabase/migrations/20260920210000_v5_append_v5_replay_precedes_cas.sql`
 * fixes it by moving the pre-existence lookup above the CAS, and its header
 * records the harm in one sentence: *"it fails in the direction that invites a
 * re-apply of a change that already landed."* THAT MIGRATION IS NOT APPLIED.
 *
 * ⛔ NO WORKAROUND IS ADDED HERE ON PURPOSE. A stale-write error from a replay
 * is raised out of the commit and therefore reaches the caller as a THROW —
 * the unknown arm — which is exactly right: nobody knows, and the caller's
 * reconciliation owns it. Converting it to `ok: false` would assert the write
 * did not land, and the whole point is that it probably did. Converting it to
 * `ok: true` would invent a receipt. {@link SessionStore.committedTurnRowId}
 * is the read that settles it without guessing.
 */

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OlumiResponse } from '@talchain/schemas/boundary';

import { GraphV3, type GraphV3T } from '../schemas/cee-v3.js';
import { assertIngressGraphNumericBounds, floorGraphSigmaForCompute } from '../validators/numeric-bounds.js';
import { applyPatchOperations } from '../orchestrator/patch-applier.js';
import { validatePatchOperations } from '../orchestrator/patch-validation.js';
import { buildAppliedChanges, parseEditGraphResponse } from '../orchestrator/tools/edit-graph.js';
import {
  encodeOptionInterventionsForEdit,
  optionIdsAddedWithInterventionIntent,
  optionIdsTouchedByOperations,
} from '../orchestrator/tools/encode-option-interventions.js';
import type { PatchOperation } from '../orchestrator/types.js';

import { GraphStateIngressSchema, type GraphStateIngress } from './boundary/request-extensions.js';
import { commitDirectAnswer } from './commit.js';
import { computeAnalysisAffectingGraphHash } from './context/graph-hash.js';
import { computeExpectedGraphCasHashes } from './context/graph-cas-conflict.js';
import { mergeAppliedGraphForPersistence } from './handlers/edit-graph-dispatch.js';
import { buildEditGraphHandlerFact } from './handlers/edit-graph-fact-builder.js';
import { projectGraphForPersistence } from './persisted-graph-projection.js';
// Declared importer under `scripts/validate-state-write-invariant.sh` rule 3 —
// see {@link ApplyOperationsDeps.store} for why this module holds it.
import { getSessionStore } from './session/index.js';

/**
 * One operation a proposal would perform, exactly as the conversation layer
 * stores it. Structurally identical to that layer's `ProposalOperation` and
 * deliberately re-declared rather than imported: the port is a boundary, and
 * a type dependency in this direction would make the persistence path depend
 * on the controller instead of the other way round.
 *
 * `kind` is the TOOL that staged the change; `detail.operations` is the patch.
 */
export interface ProposalOperationInput {
  readonly kind: string;
  readonly summary: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface ApplyOperationsInput {
  readonly proposalId: string;
  /**
   * ⭐ THIS BECOMES THE TURN ID, and that is the whole idempotency mechanism.
   * `append_turn_atomic` carries `UNIQUE (scenario_id, turn_id)` with
   * `ON CONFLICT DO NOTHING`, so a replay carrying the same key writes nothing
   * and returns the same row id. Nothing weaker is relied on, and no
   * content-dedupe is consulted.
   */
  readonly idempotencyKey: string;
  readonly operations: readonly ProposalOperationInput[];
  /**
   * The revision the consent was bound to.
   *
   * ⛔⛔ MINT IT WITH {@link currentModelRevision}. NEVER FROM THE REQUEST'S
   * `extensions.graphState`. This is not a style preference — the ingress
   * graph and the stored graph ARE NOT THE SAME OBJECT, and the difference
   * lands exactly on the fields this token hashes.
   *
   * ── MEASURED, AT STAGING `f3ae7266` ───────────────────────────────────────
   * `commit.ts:1124-1136` resolves `graphForStore` through three persist
   * passes — `repairGraphForPersistence`, `normaliseOptionInterventionContract`
   * and `reconcileTopLevelOptionsFromNodes` — which mutate `intercept`, node
   * `interventions` and top-level `options[]`. All three sit INSIDE
   * `computeAnalysisAffectingGraphHash`'s projection. Running the real
   * reconciler against the real hash function on one graph:
   *
   *     ingress    c373cbdfb844909d
   *     persisted  4dadc7e6510ec272      <- different
   *
   * with controls that discriminate rather than merely agree: a graph with no
   * option nodes no-ops and hashes EQUAL, a cosmetic label change reads EQUAL,
   * and by-reference idempotence holds. So the divergence is caused by the
   * projection, not by the probe.
   *
   * ⚠ AND IT HAS ALREADY SHIPPED ONCE, WITH BOTH HASHES IN THE LOG.
   * `response-finaliser.ts:436-445` recorded a FALSE `GRAPH_DIVERGED` on a
   * FRESH analysis — effectiveGraph `7367714928030768` vs persisted
   * `b3ebb23cfb03df1d`. Same hash function, two sources, a false "the model has
   * changed". This is a fact about the deployed system, not a hazard someone
   * imagined.
   *
   * ⛔ THE FAILURE IS TOTAL AND IT LOOKS REASONABLE, which is what makes it
   * worth this much text. Feed this from ingress and EVERY accept refuses with
   * *"the model has changed since that was agreed"* — a sentence a reader
   * accepts at face value. A capability outage wearing a correct-sounding
   * excuse is strictly worse than a crash, because nobody goes looking.
   *
   * ⚠ Turn-class scoping, since the estate's own map invites the wrong read:
   * "the UI sends no graph, CEE reloads its own" is true of RUN turns and
   * SYSTEM_EVENT turns. It is FALSE of `kind: 'message'` turns, where
   * `graph_state` is optional and the executor has an explicit backfill for its
   * absence — and that is the class the accept path is offered on.
   *
   * The shape that works is already shipped four times here — `structural_rename`,
   * `structural_delete`, `option_intervention_edit` and `/graph/register` — and
   * it is always the same: a SERVER-MINTED base assertion the client echoes,
   * re-derived server-side from `store.loadGraph`. `/graph/register`'s
   * `graph_hash` exists *specifically* because a reload left the client
   * baseless and every first edit refused as `needs_fresh_base`.
   */
  readonly modelRevision: string;
}

export type ApplyOperationsOutcome =
  | { readonly ok: true; readonly receiptId: string; readonly newModelRevision?: string }
  | { readonly ok: false; readonly reason: string };

/** The injected port, derived from the canonical commit entrypoint so this
 *  module neither constructs a session store nor introduces a second one.
 *
 *  ⚠ "Neither constructs nor introduces a second one" still holds now that
 *  {@link ApplyOperationsDeps.store} is optional: the fallback calls
 *  `getSessionStore()`, which is a MEMOISED SINGLETON (`session/index.ts:44`
 *  caches `cachedInstance`) — the very same instance `commitDirectAnswer`
 *  resolves at `commit.ts:1121`. There is one store either way. */
export type ApplyOperationsStore = NonNullable<Parameters<typeof commitDirectAnswer>[2]>;

export interface ApplyOperationsDeps {
  /** Bound at construction: the port carries no scenario. */
  readonly scenarioId: string;
  /**
   * OPTIONAL — omit it and the adapter resolves the canonical store itself.
   *
   * ⭐ WHY OPTIONAL, AND IT IS NOT TO DODGE A GATE. Every caller that offers an
   * accept would otherwise need its own `getSessionStore` import.
   * `scripts/validate-state-write-invariant.sh` rule 3 exists to keep the
   * session write surface NARROW AND DECLARED, so N undeclared importers is
   * the outcome it is written to prevent — and one small single-purpose
   * adapter holding the dependency is strictly narrower than a route file per
   * consumer. That is the same argument that made `commit.ts` a declared
   * integration point, so this module is declared there too, by name and with
   * the reason, rather than left as a silent sixth violation.
   *
   * ⚠ Measured, not reasoned: putting the import here rather than in the route
   * RELOCATES the gate's finding, it does not remove it (6 → 7 named lines,
   * applied-check confirmed). The declaration is what removes it. Anyone
   * tempted to move this import back out should run the gate, not re-read this.
   *
   * Tests inject a double and never touch the accessor: the fallback is
   * resolved PER CALL inside the returned function, exactly as
   * `commitDirectAnswer` does at `commit.ts:1121`, so construction stays pure.
   */
  readonly store?: ApplyOperationsStore;
  /** Correlation only. Never an identity or an authority. */
  readonly requestId: string;
  /** Threaded into the change summary; never grants mutation authority. */
  readonly hasExistingAnalysis?: boolean;
}

/**
 * ⭐ WHAT A "MODEL REVISION" IS, DEFINED ONCE AND EXPORTED.
 *
 * The conversation layer treats the revision as an opaque token: it binds
 * consent to it, marks an offer stale when it moves, and hands it back here.
 * It never decides what one IS — nothing above this module can, because the
 * graph lives below it.
 *
 * So this is the definition, and the injector MUST feed the controller's
 * `modelRevision` from this same function. {@link createApplyOperations}
 * re-derives it from the base it just read and refuses an accept whose token
 * disagrees, so a caller that feeds something else — a state-store revision,
 * say — gets an immediate, affirmative, recoverable refusal on its first
 * accept rather than a change applied against a model the user never saw.
 * A gap, never a lie.
 *
 * Returns `null` for a graph with no analysis-affecting projection.
 */
export function modelRevisionOf(graph: unknown): string | null {
  try {
    return computeAnalysisAffectingGraphHash(graph as GraphStateIngress | null | undefined);
  } catch {
    return null;
  }
}

/**
 * ⭐⭐ THE SERVER-MINTED BASE ASSERTION. The ONLY blessed way to obtain a
 * `modelRevision`.
 *
 * It exists so that the offer side and the accept side read the SAME SOURCE.
 * {@link createApplyOperations} re-derives the base from `store.loadGraph` at
 * accept time; if the offer minted its token from anywhere else the two can
 * disagree for reasons that have nothing to do with the user changing
 * anything — see {@link ApplyOperationsInput.modelRevision} for the measured
 * proof and the live incident. Mint from here at OFFER time, carry the token
 * with the offer, echo it back on accept, and the comparison then means what
 * it says: the model moved between the offer and the answer.
 *
 * ⚠ THIS IS NOT A CONVENIENCE WRAPPER AROUND {@link modelRevisionOf}. The
 * difference is the ARGUMENT, and the argument is the entire defect: this one
 * cannot be handed the ingress graph, because it does not take a graph.
 *
 * Returns `null` when the scenario has no graph, or one with no
 * analysis-affecting projection — the same `null` the adapter refuses on, so a
 * caller that propagates it gets a refusal rather than a token that means
 * nothing. A FAILED read propagates as a throw: a caller minting a base must
 * not receive "no model" when the truth is "we could not look".
 */
export async function currentModelRevision(
  scenarioId: string,
  deps: { readonly store?: ApplyOperationsStore } = {},
): Promise<string | null> {
  const store = deps.store ?? getSessionStore();
  return modelRevisionOf(await store.loadGraph(scenarioId));
}

/**
 * The base read, reduced to the only two shapes anything downstream may see.
 *
 * ⛔ `null` IS A LEGITIMATE SUCCESS VALUE AND MUST SURVIVE AS ONE. The store
 * returns `null` — never `undefined` — both for an absent scenario row and for
 * a row whose graph column is NULL. Collapsing that into the failure case is
 * the coercion {@link invariantBaselineFor} exists to prevent.
 */
export type BaseRead =
  | { readonly ok: true; readonly graph: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * ⭐⭐ THE THREE-STATE BASELINE, AND WHY THIS IS A FUNCTION RATHER THAN A FIELD.
 *
 * `checkPersistedGraphInvariants` keys on a STRICT `=== undefined` test, so
 * the metadata field has three distinct meanings and two of them are easy to
 * reach by accident:
 *
 *   absent / undefined  every structural violation is booked as INHERITED.
 *                       Observe-only; the check can never refuse. This is the
 *                       degrade for "we could not read the base at all".
 *   a stored graph      DELTA-SCOPED. Violations already in the base are
 *                       absorbed by count; only the surplus this write
 *                       introduces refuses. A legacy-corrupt scenario stays
 *                       editable, which is the point.
 *   null                ALSO the else-branch, because `null !== undefined`.
 *                       The baseline is empty, so EVERY violation counts as
 *                       introduced. Fully fail-closed.
 *
 * ⛔ DO NOT NORMALISE IN EITHER DIRECTION, and the two mistakes are not
 * symmetric:
 *
 *   · `?? undefined` over a real `null` silently converts a fail-closed first
 *     write into write-anything. A merged suite stayed green under exactly
 *     that change once; it is pinned by name elsewhere in this repo.
 *   · passing `null` on a READ FAILURE is worse for this adapter: it turns a
 *     legacy-corrupt scenario from "editable, with its existing damage
 *     absorbed" into permanently refused.
 *
 * So: pass what the store returned, verbatim, on the success path; pass
 * NOTHING AT ALL on the read-failure path. Spreading the returned object is
 * what makes "nothing at all" expressible — an explicit
 * `baseGraphForInvariants: undefined` would be indistinguishable in the type
 * but identical at the `=== undefined` test, whereas a literal `null` would
 * not be, and this shape makes the `null` mistake impossible to make by
 * omission.
 *
 * ⚠ HONEST SCOPE. On this adapter TODAY the failure arm is not reachable from
 * {@link createApplyOperations}: a base that cannot be read is a base the
 * patch cannot be applied to, so the call refuses before any commit. This
 * function exists so that the discipline is stated once, in one testable
 * place, for the live call site and for any later path that CAN commit
 * without a base. It is not a claim that both arms run in production.
 */
export function invariantBaselineFor(read: BaseRead): { readonly baseGraphForInvariants?: unknown } {
  return read.ok ? { baseGraphForInvariants: read.graph } : {};
}

type EditableGraph = GraphV3T & Record<string, unknown>;

/** Narrows the RAW object. Never returns the floored/parsed copy — flooring
 *  here would change the very analysis identity this write must preserve. */
function isEditableGraph(value: unknown): value is EditableGraph {
  const ingress = GraphStateIngressSchema.safeParse(value);
  return (
    ingress.success &&
    assertIngressGraphNumericBounds(ingress.data).ok &&
    GraphV3.passthrough().safeParse(floorGraphSigmaForCompute(value).graph).success
  );
}

/**
 * Flatten the consented operation list into raw patch operations.
 *
 * ⛔ FAILS CLOSED ON ANYTHING IT DOES NOT UNDERSTAND. `kind` is a free string
 * and `detail` is optional at the port, so an adapter that skipped an entry it
 * could not read would commit a PARTIAL write and hand back a receipt for it —
 * the user consented to three changes and two landed, with proof attached.
 * Refusing the whole set costs a turn and keeps the receipt honest.
 */
export function flattenProposalOperations(
  operations: readonly ProposalOperationInput[],
): { readonly ok: true; readonly raw: Record<string, unknown>[] } | { readonly ok: false; readonly reason: string } {
  if (operations.length === 0) {
    return { ok: false, reason: 'there was nothing to apply' };
  }
  const raw: Record<string, unknown>[] = [];
  for (const operation of operations) {
    const nested = operation.detail?.operations;
    if (!Array.isArray(nested) || nested.length === 0) {
      return {
        ok: false,
        reason: `I could not read the change "${operation.summary}" as something I know how to save`,
      };
    }
    for (const entry of nested) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return {
          ok: false,
          reason: `part of the change "${operation.summary}" was not in a shape I could save`,
        };
      }
      raw.push(entry as Record<string, unknown>);
    }
  }
  return { ok: true, raw };
}

/**
 * A digest of what this call is applying. Informational — it is NOT the
 * idempotency key and nothing dedupes on it — but it must be STABLE across a
 * replay, because the post-commit readback binds the returned turn row to it.
 */
export function requestDigestFor(input: ApplyOperationsInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        proposal_id: input.proposalId,
        idempotency_key: input.idempotencyKey,
        operations: input.operations,
      }),
    )
    .digest('hex');
}

/**
 * Build the production `applyOperations` port for one scenario.
 *
 * The conversation layer injects the result. With it absent that layer offers
 * no accept tool at all and says so in the prompt, which is why handing back a
 * port that cannot honour the idempotency contract would be strictly worse
 * than handing back nothing.
 */
export function createApplyOperations(
  deps: ApplyOperationsDeps,
): (input: ApplyOperationsInput) => Promise<ApplyOperationsOutcome> {
  const { scenarioId, requestId } = deps;
  const hasExistingAnalysis = deps.hasExistingAnalysis === true;

  return async function applyOperations(input: ApplyOperationsInput): Promise<ApplyOperationsOutcome> {
    const refuse = (reason: string): ApplyOperationsOutcome => ({ ok: false, reason });

    // Resolved here, not at construction: an injected double is used verbatim,
    // and a supplier that is never invoked never touches the accessor.
    const store: ApplyOperationsStore = deps.store ?? getSessionStore();

    // ── 1. THE BASE ────────────────────────────────────────────────────────
    // Read once. It is both the patch base and the invariant baseline, and it
    // is passed on verbatim — see `invariantBaselineFor`.
    let read: BaseRead;
    try {
      read = { ok: true, graph: await store.loadGraph(scenarioId) };
    } catch {
      read = { ok: false, reason: 'I could not read the model, so I have not changed anything' };
    }
    if (!read.ok) return refuse(read.reason);

    const before = read.graph;
    if (!isEditableGraph(before)) {
      return refuse('I could not read the model in a form I can safely change');
    }

    // ── 2. CONSENT IS BOUND TO A REVISION ──────────────────────────────────
    // The controller already marks an offer stale when the revision moves;
    // this is the same question asked of the STORE rather than of the
    // controller's snapshot, so the two cannot silently disagree.
    const baseRevision = modelRevisionOf(before);
    if (baseRevision === null) {
      return refuse('I could not establish which version of the model this is');
    }
    if (baseRevision !== input.modelRevision) {
      return refuse('the model has changed since that was agreed, so I have not applied it');
    }

    // ── 3. NORMALISE, VALIDATE, APPLY ──────────────────────────────────────
    const flattened = flattenProposalOperations(input.operations);
    if (!flattened.ok) return refuse(flattened.reason);

    let normalised: PatchOperation[];
    try {
      // ⭐ THE PATH CONVERSION HAPPENS HERE AND NOWHERE ELSE. At the applier a
      // node operation's `path` is a BARE NODE ID, not a pointer — it looks
      // for a node whose id is the whole string and throws NODE_NOT_FOUND
      // otherwise. The pointer spelling the conversation layer sends IS the
      // production spelling, and this is the production normaliser for it:
      // `/nodes/<id>/<field>` splits into `{ path: <id>, field }` and the
      // value is wrapped under the field key. Writing a second normaliser
      // would be the mirror defect; this reuses the one that already ships.
      normalised = parseEditGraphResponse(
        JSON.stringify({ operations: flattened.raw, removed_edges: [], warnings: [], coaching: null }),
      ).operations;
    } catch {
      return refuse('I could not turn that change into something I can save');
    }
    if (normalised.length !== flattened.raw.length) {
      // Silent loss here would commit a subset under a whole-set receipt.
      return refuse('part of that change did not survive preparation, so I have not applied any of it');
    }

    const validated = validatePatchOperations(normalised, before);
    if (!validated.valid || validated.operations.length !== normalised.length) {
      return refuse('that change is not valid against the model as it stands');
    }
    const operations = validated.operations;

    let applied: GraphV3T;
    try {
      applied = applyPatchOperations(before, operations);
    } catch {
      return refuse('that change could not be applied to the model as it stands');
    }

    // ── 4. ENCODE, MERGE, PROJECT ──────────────────────────────────────────
    // ⛔ A NATIVE MAGNITUDE IS NOT A MODEL VALUE. The encoder returns a present
    // `value` VERBATIM as a model-scale number and does not consult the unit,
    // so a native figure arriving in that slot would move a [0,1] intervention
    // to its own magnitude and corrupt the causal model. A native figure must
    // ride as `raw_value` + `unit`, from which `value = raw_value / cap` is
    // derived here. Nothing in this adapter converts, invents or repairs one:
    // when it cannot be derived safely the option comes back unresolved and
    // the whole write is refused rather than persisted.
    const touched = optionIdsTouchedByOperations(operations, applied);
    const mustConfigure = optionIdsAddedWithInterventionIntent(operations);
    const encoded = encodeOptionInterventionsForEdit(applied, touched, mustConfigure);
    if (encoded.unresolvedOptionIds.length > 0) {
      return refuse('I could not work out what that change means for the options, so I have not saved it');
    }

    const graph = projectGraphForPersistence(
      mergeAppliedGraphForPersistence({
        appliedGraph: encoded.graph,
        persistedBase: before,
        ingressBase: before,
        scenarioId,
        requestId,
      }),
      { scenarioId, turnId: input.idempotencyKey },
    );
    if (!isEditableGraph(graph)) {
      return refuse('the result of that change was not a model I can safely save');
    }

    const analysisGraphHash = modelRevisionOf(graph);
    if (analysisGraphHash === null) {
      return refuse('I could not establish what the model would become, so I have not saved it');
    }

    // ── 5. THE HANDLER FACT ────────────────────────────────────────────────
    // A commit without one is a commit the next turn cannot see.
    const appliedChanges = buildAppliedChanges(operations, graph, hasExistingAnalysis, before);
    const handlerFact = buildEditGraphHandlerFact({
      editResult: {
        blocks: [],
        assistantText: appliedChanges.summary,
        latencyMs: 0,
        wasRejected: false,
        operations,
        appliedGraph: graph,
        appliedChanges,
      },
      preEditGraph: before,
      hasExistingAnalysis,
    });
    if (handlerFact === null) {
      return refuse('I could not record what that change did, so I have not saved it');
    }

    // ── 6. COMMIT ──────────────────────────────────────────────────────────
    // Past this line NOTHING returns `ok: false`. The write has been
    // dispatched, and "it did not save" stops being a claim we can make.
    const response: OlumiResponse = {
      response_version: 2,
      assistant_text: appliedChanges.summary,
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'frame',
    };

    const committed = await commitDirectAnswer(
      response,
      {
        scenario_id: scenarioId,
        // ⭐ The idempotency key IS the turn id. See the field's own doc.
        turn_id: input.idempotencyKey,
        request_hash: requestDigestFor(input),
        turn_class: 'direct_answer',
        handler_id: null,
        llm_calls_used: 0,
        duration_ms: 0,
        handler_facts: [handlerFact],
        graph,
        contentGraph: graph,
        ...invariantBaselineFor(read),
        ...computeExpectedGraphCasHashes(before),
        graph_hash: analysisGraphHash,
      },
      store,
    );

    // ── 7. READ BACK, AND VERIFY BEFORE CLAIMING ───────────────────────────
    // ⚠ Every failure from here THROWS. `CommitResult` carries the PROJECTED
    // INPUT, not a database readback, and a replay can return an older row
    // without applying this request's bytes — so a mismatch means the outcome
    // is unknown, not that it failed. The caller's reconciliation owns that.
    const unknown = (why: string): never => {
      throw new ApplyOperationsUnverifiedError(why);
    };

    const reloaded = await store.loadGraph(scenarioId);
    if (!committed.graphPersisted) unknown('committed_graph_absent');
    if (!isDeepStrictEqual(reloaded, graph)) unknown('committed_graph_mismatch');

    // The graph answers "what is saved now?", not "what did THIS call
    // commit?". Bind the row to this call's own key and digest.
    const rows = (await store.readRecent(scenarioId)).filter((row) => row.id === committed.persisted_row_id);
    const row = rows[0];
    if (
      rows.length !== 1 ||
      row?.scenario_id !== scenarioId ||
      row.turn_id !== input.idempotencyKey ||
      row.request_hash !== requestDigestFor(input)
    ) {
      unknown('committed_turn_unverified');
    }

    // ⭐ THE RECEIPT IS THE TURN ROW ID — THE PROOF OF COMMIT — AND NOT THE
    // MODEL-VERSION RECEIPT. The version receipt is legitimately NULL on two
    // successful paths: a guest, and a genuine no-op where the incoming graph
    // already equals the head. Feeding it to the caller instead would make
    // every guest turn — the ordinary first-time path — look like a save that
    // could not be substantiated, for writes that all landed. The version
    // receipt is cited separately as provenance when there is one, and when
    // there is one it must describe THIS turn.
    const receipt = committed.modelVersionReceipt;
    if (receipt !== null && (receipt.source_turn_id !== input.idempotencyKey || !isDeepStrictEqual(receipt.graph, reloaded))) {
      unknown('committed_receipt_mismatch');
    }
    if (typeof committed.persisted_row_id !== 'string' || committed.persisted_row_id.trim().length === 0) {
      unknown('committed_receipt_absent');
    }

    return { ok: true, receiptId: committed.persisted_row_id, newModelRevision: analysisGraphHash };
  };
}

/**
 * The write was dispatched and its outcome could not be established.
 *
 * Thrown rather than returned, because the port's failure arm means
 * "affirmatively did not land" and this is the third state. The caller keeps
 * the proposal in flight, replays under the same key, and reconciles.
 */
export class ApplyOperationsUnverifiedError extends Error {
  constructor(reason: string) {
    super(`the save was dispatched and could not be verified: ${reason}`);
    this.name = 'ApplyOperationsUnverifiedError';
  }
}
