/**
 * The existing controlled graph/model write door.
 * appendCheckedGraphWrite handles turn appends; commitModelChange handles
 * SAVE_VERSION, RESTORE_VERSION and COPY_GUEST_SCENARIO atomic RPCs.
 * Ownership and graph checks precede dispatch; original revision CAS remains
 * authoritative inside each RPC; guest copy binds checked source bytes there.
 * Projection and hashing precede this module. Checks never repair or mutate
 * graph bytes, and restore is never split into multiple writes.
 */
import { assertNoScopedIdentityConflict, assertNoPendingScopeAmendment, refreshScopePending } from './agent-lane/goal-scope.js';
import { PENDING_ACTIONS_PER_TURN_CAP, type PendingAction } from './session/pending-action.js';
import { assertDoorProvenance } from './goal-target/horizon-basis-provenance.js';
import { log } from '../utils/telemetry.js';
import { assertUntouchedLevelQuantities } from './untouched-level-invariant.js';
import { GuestCopyStoreError } from './guest-copy/index.js';
import type { GuestCopyStorePort, GuestCopyOutcome } from './guest-copy/index.js';
import { readVerifiedWriteCaller, assertDoorOwnership } from './ownership/door-ownership.js';
import { computeGraphIdentityHash } from './context/graph-identity.js';
import { isProgramGraph } from './model-program-turn/program-store.js';
import { ModelVersionSignInRequiredError, ModelVersionStoreError } from './model-management/store-adapter.js';
import type { SaveVersionWrite, AtomicRestoreVersionWrite, ModelVersionStorePort } from './model-management/store-adapter.js';
import type { VersionWriteOutcome, AtomicRestoreVersionOutcome, ModelVersionRecord } from './model-management/types.js';
import type { GraphStateIngress } from './boundary/request-extensions.js';

import {
  checkPersistedGraphInvariants,
  formatViolations,
  PersistedGraphInvariantError,
} from './persisted-graph-invariants.js';
import type { SessionAppendOutcome, SessionStore, SessionTurnWrite } from './session/store.js';
import { withoutAgentSubturnText } from './session/agent-subturn-context.js';
import { preconditionRiskLinkViolations } from '../orchestrator/graph-structure-validator.js';
import { todayPartsApartFromGoal } from './agent-lane/goal-definition-sum.js';
import type { GraphV3T } from '../schemas/cee-v3.js';

/** A semantic representation refusal; its label-based reason is safe for the authorised writer's reply. */
export class PreconditionRiskLinkWriteError extends Error {
  readonly code = 'PRECONDITION_RISK_LINKED' as const;
  constructor(reason: string) {
    super(reason);
    this.name = 'PreconditionRiskLinkWriteError';
  }
}

/** All whole-graph writers use the same rule as edit/apply, including a restore's return leg. Never repairs. */
export function assertNoPreconditionRiskLinks(graph: unknown): void {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) return;
  const raw = graph as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return;
  // The floor accepts unknown graph supersets. Select object members for this narrow structural check;
  // schema/referential checks retain their existing authority and the saved graph is never modified.
  const record = (value: unknown): boolean => value !== null && typeof value === 'object' && !Array.isArray(value);
  const violation = preconditionRiskLinkViolations({
    nodes: raw.nodes.filter(record), edges: raw.edges.filter(record),
  } as Pick<GraphV3T, 'nodes' | 'edges'>)[0];
  if (violation !== undefined) throw new PreconditionRiskLinkWriteError(violation.detail);
}

export interface CheckedGraphAppendParams {
  /** The write, already projected and hashed by the caller. */
  readonly write: SessionTurnWrite;
  /** The store to append through. Callers resolve their own. */
  readonly store: SessionStore;
  readonly horizonBasisWrite?: import('./goal-target/goal-steady-write.js').HorizonBasisWrite;
  readonly storedGraphForHorizonBasis?: unknown;
  /**
   * Whether this write carries a graph. Gates the NON-FATAL reporting only —
   * the fatal refusal below is deliberately NOT gated on it, preserving
   * `commit.ts`'s original behaviour verbatim.
   */
  readonly writesGraph: boolean;
  /**
   * THIN CORE (20 Oct 2026): this write is a core postimage (a living model and the graph regenerated from it, together),
   * set only by the register route for CEE's own `thin_core` writer. A scenario whose meaning is its living model takes no
   * other graph write: one would leave the graph and its meaning apart, or drop the meaning.
   */
  readonly coreWrite?: boolean;
  /** With `coreWrite`, a MODEL PROGRAM's write (`isProgramGraph`): checked where it is made (compile, `validatePostimage`, the approved
   * card), so only storage integrity judges it here, never the legacy edit rules (25 Oct: 3 presses refused as untouched_level_rescaled). */
  readonly programSave?: boolean;
  /** THIN CORE: the authoritative stored graph this write replaces (the commit's own read), for the one-write rule. */
  readonly coreClassificationBase?: unknown;
  /**
   * The graph as it stood BEFORE this write. Violations already present in it
   * are ABSORBED, never refused — only what this write INTRODUCES can fail it.
   *
   * ⚠ THREE STATES, NOT TWO — and `null` is NOT the observe-only one. The
   * degrade key in `checkPersistedGraphInvariants` is a STRICT
   * `options.baseGraph === undefined` (`persisted-graph-invariants.ts:222`):
   *
   *   · `undefined` — NO BASELINE. Every violation is booked as inherited, so
   *     the check is OBSERVE-ONLY and can never refuse. This is the DEGRADE,
   *     reached when a caller cannot read the base at all (the register route's
   *     base-read catch leaves its variable at the declared `undefined`).
   *   · a stored graph — DELTA-SCOPED. Inherited violations absorbed by count,
   *     only the surplus refuses. This keeps a legacy-corrupt scenario editable.
   *   · `null` — ABSOLUTE, NOT delta-scoped. `null !== undefined`, so it takes
   *     the delta branch, and `rawViolations(null)` is `[]`, so the baseline is
   *     EMPTY and EVERY violation counts as introduced.
   *
   * The third state is not an edge case: `SupabaseSessionStore.loadGraph`
   * returns `null` — never `undefined` — both for an absent scenario row and
   * for a row whose `graph` column is NULL (`supabase-store.ts:1960`, `:1971`).
   * A FIRST IMPORT INTO AN EMPTY SCENARIO IS THEREFORE FULLY FAIL-CLOSED, and
   * that is the dominant import journey.
   *
   * THIS IS A DECISION, NOT AN ACCIDENT (C3 closure). A graph carrying a
   * duplicate node id is structurally invalid; persisting it creates corruption
   * every downstream reader must then tolerate, and the turn path has always
   * refused exactly this. Prefer visible failure over confident wrongness. It is
   * recorded here because it previously rested on an undocumented
   * `null`/`undefined` distinction that no test could see — a `?? undefined` at
   * either call site would silently convert the dominant import journey from
   * fail-closed to write-anything, and the merged suite stayed green under it.
   * Pinned by identity in
   * `routes/__tests__/assist.v1.scenario-graph-register.test.ts`
   * ("a FRESH scenario ... is ABSOLUTE" + its degrade twin).
   */
  readonly baseGraphForInvariants?: unknown;
  /** Free-form origin label for logs (`handler_id`, or a route name). */
  readonly source?: string | undefined;
  /** Only successful, user-authorised scope withdrawals may retire this durable issue. */
  readonly withdrawnGoalScopeChipIds?: readonly string[];
  /**
   * ⭐ S-D (lane EDIT-PANEL; Codex r1 P1-3 + r2 P1-2 on #2743): held proposals are reconciled against the latest row read
   * HERE, just before the append, not only against the caller's earlier read. A request that reconciled its held
   * proposals and then took seconds to answer must neither put back one another request approved or declined meanwhile
   * (a supplied held item is kept only while the latest row still holds it) nor erase one another request minted
   * meanwhile (a held item on the latest row that this request never saw is carried). `seenByThisRequest`: every held
   * item this request read, so the ones it settled itself (approved, declined, lapsed: each said) are never re-added.
   * S-D.1b compares the identity of this read inside the conditional append RPC,
   * then rereads and repeats this reconciliation on contention (three attempts).
   */
  readonly heldProposals?: {
    readonly isHeld: (pending: PendingAction) => boolean;
    readonly seenByThisRequest: ReadonlySet<string>;
    readonly offeredChipIds?: ReadonlySet<string>;
    /** Re-project the answer sidecar and say capacity lapses from this final pending read, before the append. */
    readonly onReconciled?: (write: SessionTurnWrite, overCap: readonly PendingAction[]) => SessionTurnWrite;
  };
}

/**
 * Who is writing, for the log line only. `turn_id`/`turn_class` are OPTIONAL
 * because the third writer is not a turn: the restore tier replaces the working
 * graph outright and has no turn row to name (C8).
 */
export interface GraphWriteIdentity {
  readonly scenario_id: string;
  readonly turn_id?: string | null | undefined;
  readonly turn_class?: string | null | undefined;
}

/** Params for the CHECK alone — no store, no append. */
export interface GraphInvariantAssertionParams {
  /**
   * The exact bytes about to be persisted. Callers pass the SAME object they
   * hand to their writer on the next line — see the module header on why the
   * report is recomputed here and never passed in.
   */
  readonly graph: unknown;
  readonly identity: GraphWriteIdentity;
  readonly writesGraph: boolean;
  /** Same three-state semantics as `CheckedGraphAppendParams`. Read its JSDoc. */
  readonly baseGraphForInvariants?: unknown;
  readonly source?: string | undefined;
  /** See `CheckedGraphAppendParams.programSave`. */
  readonly programSave?: boolean;
}

/**
 * THE CHECK, WITHOUT THE APPEND — the half of this floor that a writer owning
 * its own atomic statement can still stand on.
 *
 * ── WHY THIS IS SPLIT OUT (C8 closure) ─────────────────────────────────────
 * The module header above records that the restore tier
 * (`routes/assist.v1.scenario-versions.ts` → `service.restoreVersionAtomic` →
 * `restore_model_version_atomic_v1`) was NOT on this floor, and that routing it
 * here was "materially larger: that RPC owns graph + undo + version + head +
 * event in a single statement". That remains true, and it is why the fix is
 * this split rather than a third `appendCheckedGraphWrite` caller.
 *
 * ⭐ THE DECISIVE MEASUREMENT, AND IT POINTS THE OTHER WAY FROM THE OBVIOUS FIX:
 * the restore RPC's CAS is **STRICTLY STRONGER** than the turn path's, so
 * converging it onto `store.append` would have COST a guarantee, not gained one.
 *   · restore (`20260824200000:327-333`): an UNCONDITIONAL three-way compare
 *     (stored hash, caller-supplied hash, and the full stored graph body), with
 *     no flag and no bypass.
 *   · the `append_turn_atomic_*` family reached through `store.append`:
 *     `p_cas_enforce BOOLEAN DEFAULT FALSE` — the compare block is skipped
 *     entirely unless a caller opts in (`20260717120000:133`/`:198`,
 *     `20260731130000:143`/`:243`, `20260802120000:101`/`:206`,
 *     `20260806120000:165`/`:308`).
 * So the honest closure is: THE INVARIANT CHECK BELONGS ON THAT PATH, THE
 * APPEND DOES NOT. Refusing more than needed is safe; a silent write is not.
 * Nothing about either CAS is touched by this function.
 *
 * ⚠ SCOPE OF THE EVIDENCE FOR THE PARAGRAPH ABOVE: it rests on READING the
 * migration SQL at this tip. No PL/pgSQL was executed to establish it, and every
 * atomicity claim on that migration has rested on reading — stated so the claim
 * is not read as stronger than it is.
 *
 * Throws `PersistedGraphInvariantError` when this write INTRODUCES a structural
 * violation — fail-closed, never a silent repair. Returns `void` on pass: the
 * caller then performs its own write, and NOTHING may mutate the graph in
 * between (the same obligation `appendCheckedGraphWrite` discharges structurally
 * by appending on its own next line).
 */
export function assertNoIntroducedGraphViolations(
  params: GraphInvariantAssertionParams,
): void {
  const { graph, identity, writesGraph, source } = params;

  const legacyRules = writesGraph && params.programSave !== true;
  // RC3 is an absolute representation rule, independent of baseline absorption or GM mode.
  if (legacyRules) assertNoPreconditionRiskLinks(graph);
  // ⭐ STEP 8: so is a goal's compiled today part: exactly its goal's level today, set by no option, with no link into it. Every
  // caller (append, save, restore, copy) reaches this one check; the register route sets the part before hashing.
  const apart = legacyRules ? todayPartsApartFromGoal(graph) : [];
  if (apart.length > 0) throw new PersistedGraphInvariantError([{ code: 'GOAL_TODAY_PART_NOT_GOAL_LEVEL', entity_ids: [...apart].sort(), count: apart.length }]);

  const persistedInvariants = checkPersistedGraphInvariants(graph, {
    baseGraph: params.baseGraphForInvariants,
  });

  const logBase = {
    scenario_id: identity.scenario_id,
    turn_id: identity.turn_id,
    turn_class: identity.turn_class,
    source,
  };

  // ── FAIL-CLOSED, NEVER A SILENT REPAIR ───────────────────────────────────
  // A violation refuses the write and names what was wrong. The refusal is a
  // throw: each caller's existing failure ladder maps it to its own typed
  // response — a typed commit failure on the turn path, a 422 naming the
  // violated invariant on the registration path.
  if (persistedInvariants.status === 'violated') {
    log.error(
      {
        event: 'v5.graph_persist.invariant_violation',
        ...logBase,
        introduced: persistedInvariants.violations.map((v) => ({
          code: v.code,
          count: v.count,
          entity_ids: v.entity_ids,
        })),
        inherited_count: persistedInvariants.inheritedViolations.length,
      },
      '[persist] REFUSING the write — this write INTRODUCED a structural violation into the graph',
    );
    throw new PersistedGraphInvariantError(persistedInvariants.violations);
  }

  // Inherited corruption is absorbed, NOT refused (a legacy/migration-era graph
  // must stay editable — `edit-graph.ts:2750-2755`), but it is still surfaced:
  // a violation nobody can see is one nobody will ever fix.
  if (writesGraph && persistedInvariants.inheritedViolations.length > 0) {
    log.warn(
      {
        event: 'v5.graph_persist.invariant_inherited',
        ...logBase,
        had_baseline: params.baseGraphForInvariants !== undefined,
        inherited: persistedInvariants.inheritedViolations.map((v) => ({
          code: v.code,
          count: v.count,
          entity_ids: v.entity_ids,
        })),
      },
      '[persist] pre-existing structural violation carried through this write (absorbed, not refused) — ' +
        formatViolations(persistedInvariants.inheritedViolations),
    );
  }

  // Non-fatal findings are surfaced rather than swallowed. These are the
  // invariants NOT yet demonstrated to hold on real traffic, so they are
  // reported and the write proceeds — an honest "we saw this and did not
  // enforce it", never a silent pass.
  if (writesGraph && persistedInvariants.observations.length > 0) {
    log.warn(
      {
        event: 'v5.graph_persist.invariant_observation',
        ...logBase,
        observations: persistedInvariants.observations.map((v) => ({
          code: v.code,
          count: v.count,
          entity_ids: v.entity_ids,
        })),
      },
      '[persist] persisted-graph invariant OBSERVED but not enforced — ' +
        formatViolations(persistedInvariants.observations),
    );
  }

  // A graph whose top-level shape the structural invariants are undefined for
  // is recorded as UNCHECKED rather than counted as a pass — an absence claim
  // about this check must not be read wider than the graphs it can evaluate.
  if (writesGraph && persistedInvariants.status === 'unshaped') {
    log.warn(
      { event: 'v5.graph_persist.invariant_unchecked', ...logBase },
      '[persist] persisted-graph invariants NOT evaluated — the graph has no nodes/edges arrays',
    );
  }
}

/**
 * Enforce the terminal persisted-graph invariants on the bytes about to be
 * written, then append them. THE SINGLE CALL-GRAPH AUTHORITY for a
 * turn graph write through `store.append`. Explicit save/restore operations
 * take the same module's commitModelChange entry and their existing atomic RPCs.
 *
 * Throws `PersistedGraphInvariantError` when this write INTRODUCES a structural
 * violation — fail-closed, never a silent repair. Repairing here would put a
 * mutation AFTER the caller's hash was computed and recreate the ordering
 * defect this floor exists to close.
 */
export async function appendCheckedGraphWrite(
  params: CheckedGraphAppendParams,
): Promise<SessionAppendOutcome> {
  const { store, writesGraph, source } = params;
  const programSave = params.coreWrite === true && params.programSave === true;
  if (writesGraph && params.baseGraphForInvariants === undefined) {
    log.warn({ event: 'door.untouched_level_check_skipped', reason: 'no_base_supplied', source });
  }
  await assertDoorOwnership(store, params.write.scenario_id, source);
  // THIN CORE: one write rule per scenario. A writer that merges onto the stored graph carries its living model forward;
  // one that rebuilds the graph drops it, so the base is checked too.
  const carriesLivingModel = (g: unknown): boolean => g !== null && typeof g === 'object' && (g as { living_model?: unknown }).living_model !== undefined;
  if (writesGraph && params.coreWrite !== true && (carriesLivingModel(params.write.graph) || carriesLivingModel(params.baseGraphForInvariants)
    || carriesLivingModel(params.coreClassificationBase))) {
    throw new PersistedGraphInvariantError([{ code: 'CORE_SCENARIO_LEGACY_WRITE', entity_ids: [], count: 1 }]);
  }
  for (let attempt = 0; ; attempt += 1) {
    // Always reconcile the ORIGINAL request against each fresh row. Reusing the
    // previous attempt would retain obsolete scope issues or permanently drop holds.
    let write = params.write;
    let expectedLatestRowId: string | null | undefined;
    // Pending issue lifetime is a persistence obligation even on a read-only conversational turn.
    // Only this sidecar is extended here; graph bytes and both hashes remain exactly as prepared.
    // A model program's save carries its own pendings (the register threads them) and has no goal scope: no read here.
    if (typeof store.readMostRecentPendingActions === 'function' && !programSave) {
      const prior = await store.readMostRecentPendingActions(write.scenario_id, { validation: 'strict',
        ...(params.heldProposals !== undefined ? { onLatestRowId: (id: string | null) => { expectedLatestRowId = id; } } : {}) });
      if (writesGraph && !programSave) assertNoPendingScopeAmendment(write.graph, params.baseGraphForInvariants, prior);
      let supplied = write.pending_actions ?? [];
      // Per attempt: what did not fit is said from THIS read's reconciliation only (S-D slice 2 x S-D.1b).
      const heldOverCap: PendingAction[] = [];
      if (params.heldProposals !== undefined) {
        const { isHeld, seenByThisRequest } = params.heldProposals;
        const onLatest = new Set(prior.filter(isHeld).map((p) => p.chip_id));
        const kept = supplied.filter((n) => !isHeld(n) || onLatest.has(n.chip_id) || !seenByThisRequest.has(n.chip_id));
        const arrived = prior.filter((p) => isHeld(p) && !seenByThisRequest.has(p.chip_id) && !kept.some((n) => n.chip_id === p.chip_id));
        if (kept.length !== supplied.length || arrived.length > 0) {
          const merged = [...kept, ...arrived];
          const arriving = new Set(arrived.map(p => p.chip_id));
          // A concurrently arriving offer keeps its room alongside this answer's offer. Other holds remain oldest first.
          const priority = (p: PendingAction): number => p.action.kind === 'reconcile_goal_scope' ? 0
            : isHeld(p) && params.heldProposals?.offeredChipIds?.has(p.chip_id) ? 1
              : arriving.has(p.chip_id) ? 2 : isHeld(p) ? 3 : 4;
          merged.sort((a, b) => priority(a) - priority(b) || a.emitted_at_iso.localeCompare(b.emitted_at_iso));
          if (merged.length > PENDING_ACTIONS_PER_TURN_CAP) {
            heldOverCap.push(...merged.slice(PENDING_ACTIONS_PER_TURN_CAP).filter(isHeld));
            log.warn({ scenario_id: write.scenario_id, source, dropped: merged.slice(PENDING_ACTIONS_PER_TURN_CAP).map((p) => p.chip_id) },
              '[persist] held proposal another request added does not fit the row; the lowest-priority items are not carried');
          }
          supplied = merged.slice(0, PENDING_ACTIONS_PER_TURN_CAP).sort((a, b) =>
            Number(b.action.kind === 'reconcile_goal_scope') - Number(a.action.kind === 'reconcile_goal_scope')
            || a.emitted_at_iso.localeCompare(b.emitted_at_iso));
          write = { ...write, pending_actions: supplied };
        }
      }
      const missing = prior.filter(p => p.action.kind === 'reconcile_goal_scope'
        && !params.withdrawnGoalScopeChipIds?.includes(p.chip_id)
        && !supplied.some(n => n.chip_id === p.chip_id))
        .flatMap(p => { const kept = refreshScopePending(p, writesGraph ? write.graph : params.baseGraphForInvariants); return kept ? [kept] : []; });
      if (missing.length > 0) {
        const merged = [...missing, ...supplied];
        if (params.heldProposals !== undefined) heldOverCap.push(...merged.slice(PENDING_ACTIONS_PER_TURN_CAP).filter(params.heldProposals.isHeld));
        write = { ...write, pending_actions: merged.slice(0, PENDING_ACTIONS_PER_TURN_CAP) };
      }
      if (params.heldProposals?.onReconciled !== undefined) write = params.heldProposals.onReconciled(write, heldOverCap);
    }
    if (writesGraph && !programSave) {
      assertNoScopedIdentityConflict(write.graph);
      assertUntouchedLevelQuantities(params.baseGraphForInvariants, write.graph);
    }

    // The check runs on `write.graph` — the same object handed to `store.append`
    // on the last line of this function, with nothing between them.
    if (!programSave) assertDoorProvenance(write.graph, params.storedGraphForHorizonBasis !== undefined ? params.storedGraphForHorizonBasis : params.baseGraphForInvariants, write.scenario_id, params.horizonBasisWrite);
    assertNoIntroducedGraphViolations({
      graph: write.graph,
      identity: {
        scenario_id: write.scenario_id,
        turn_id: write.turn_id,
        turn_class: write.turn_class,
      },
      writesGraph,
      baseGraphForInvariants: params.baseGraphForInvariants,
      source,
      programSave,
    });

    // Nothing mutates the graph between the check above and this line. A row written inside one of the Agent's own
    // dispatches is stored without conversation text: the user never saw it (`agent-subturn-context.ts`, #75 5910983526).
    // Reconciliation may replace the write, but it cannot replace the revision
    // captured by its original server read. Bind it again at the append seam.
    const { expectedRevision: _reconciledExpectedRevision, ...writeWithoutRevision } = write;
    const storedWrite = withoutAgentSubturnText(
      params.write.expectedRevision === undefined && !Object.prototype.hasOwnProperty.call(write, 'expectedRevision')
        ? write
        : {
          ...writeWithoutRevision,
          ...(params.write.expectedRevision !== undefined ? { expectedRevision: params.write.expectedRevision } : {}),
        },
    );
    if (expectedLatestRowId === undefined || attempt >= 3 || typeof store.appendIfLatest !== 'function') return await store.append(storedWrite);
    const outcome = await store.appendIfLatest(storedWrite, { expectedLatestRowId });
    if (!('status' in outcome)) return outcome;
    if (attempt === 2) {
      log.warn({ event: 'v5.agent_answer.latest_moved_exhausted', scenario_id: write.scenario_id, source, attempts: 3 },
        '[persist] latest row moved on all three conditional attempts; rereading once more and appending the answer unconditionally');
    }
  }
}

/** The existing turn append and explicit version operations share this module's writer contract.
 * Version operations dispatch their existing RPC once, without a fabricated turn or split transaction.
 * All graphs are already projected/hashed. Neither checks nor dispatch may change their bytes.
 */
type CopyGuestChange = {
  readonly operation: 'COPY_GUEST_SCENARIO';
  readonly store: GuestCopyStorePort;
  readonly sourceScenarioId: string;
  readonly userId: string;
};

type ModelChange = CopyGuestChange | ({
  readonly store: ModelVersionStorePort;
} & ({ readonly operation: 'SAVE_VERSION'; readonly write: SaveVersionWrite }
  | { readonly operation: 'RESTORE_VERSION'; readonly write: AtomicRestoreVersionWrite;
      /** Server-read head, never a client-supplied admission flag. */
      readonly restoreHead?: ModelVersionRecord | null }));

/** Preserve the existing, identity-bound Undo admission; an arbitrary boolean cannot grant it. */
export function isReturnLegRestore(params: {
  readonly head: ModelVersionRecord | null;
  readonly targetVersionId: string;
  readonly currentGraph: unknown;
}): boolean {
  const { head, targetVersionId, currentGraph } = params;
  if (head === null || head.provenance !== 'restore' || head.parent_version_id !== targetVersionId) return false;
  const identity = computeGraphIdentityHash(currentGraph as GraphStateIngress | null | undefined);
  return identity !== null && identity.value === head.graph_identity_hash
    && identity.algorithm === head.hash_algorithm && identity.projection_version === head.identity_projection_version
    && identity.normaliser_version === head.identity_normaliser_version && identity.graph_schema_version === head.graph_schema_version;
}

export function commitModelChange(params: Extract<ModelChange, { operation: 'SAVE_VERSION' }>): Promise<VersionWriteOutcome>;
// eslint-disable-next-line no-redeclare -- TypeScript overloads share this one door implementation.
export function commitModelChange(params: Extract<ModelChange, { operation: 'RESTORE_VERSION' }>): Promise<AtomicRestoreVersionOutcome>;
// eslint-disable-next-line no-redeclare -- Same door, typed guest-copy operation.
export function commitModelChange(params: CopyGuestChange): Promise<GuestCopyOutcome>;
// eslint-disable-next-line no-redeclare -- Implementation of the TypeScript overload signatures above.
export async function commitModelChange(params: ModelChange): Promise<VersionWriteOutcome | AtomicRestoreVersionOutcome | GuestCopyOutcome> {
  if (params.operation === 'COPY_GUEST_SCENARIO') {
    const userId = readVerifiedWriteCaller();
    if (userId === null || userId !== params.userId) return { kind: 'refused', reason: 'unknown_user' };
    // A replay writes nothing. Recover it even if the source has since moved or
    // become invalid. The authoritative replay key remains inside the RPC.
    // A replay can also appear AFTER this pre-read. Preserve created:false from
    // the RPC: recovery does not certify the just-checked source was copied.
    const replay = await params.store.readGuestCopy(params.sourceScenarioId, userId);
    const source = replay ?? await params.store.readGuestSource(params.sourceScenarioId);
    if (source === null) return { kind: 'refused', reason: 'not_copyable' };
    const graph = JSON.parse(JSON.stringify(source.graph ?? {})) as unknown;
    if (replay === null) {
      if (source.user_id !== null) return { kind: 'refused', reason: 'not_copyable' };
      if (source.graph === null || typeof source.graph !== 'object' || Array.isArray(source.graph)) {
        return { kind: 'refused', reason: 'no_model' };
      }
      if (Buffer.byteLength(JSON.stringify(graph), 'utf8') > 1048576) {
        return { kind: 'refused', reason: 'too_large' };
      }
      try {
        assertNoIntroducedGraphViolations({ graph, writesGraph: true,
          identity: { scenario_id: params.sourceScenarioId }, baseGraphForInvariants: null, source: 'guest_copy', programSave: isProgramGraph(graph) });
      } catch (error) {
        if (error instanceof PersistedGraphInvariantError || error instanceof PreconditionRiskLinkWriteError) {
          return { kind: 'refused', reason: 'no_model' };
        }
        throw error;
      }
    }
    // Non-null checked arguments are mandatory, including on replay. No legacy
    // downgrade, even if PostgREST has not reloaded the new function signature.
    if (!Number.isSafeInteger(source.revision)) {
      throw new GuestCopyStoreError('copy_guest_scenario checked source unavailable');
    }
    return params.store.copyGuestScenarioChecked({ sourceScenarioId: params.sourceScenarioId,
      userId, graph, revision: source.revision });
  }
  const { store, write } = params;
  let owner: string | null | undefined;
  await assertDoorOwnership({
    ...(store.getScenarioOwner === undefined ? {} : { getScenarioOwner: async (id: string) => {
      owner = await store.getScenarioOwner!(id);
      return owner;
    } }),
  }, write.scenario_id, params.operation);
  // The shared scenario policy admits guest working models; explicit version history does not.
  // Preserve MV001's existing typed result, now before any writing RPC.
  if (owner === null) throw new ModelVersionSignInRequiredError('Version history requires sign-in');
  if (params.operation === 'SAVE_VERSION') {
    assertNoIntroducedGraphViolations({ graph: params.write.graph, writesGraph: true,
      identity: { scenario_id: write.scenario_id, turn_id: null, turn_class: null },
      baseGraphForInvariants: null, source: 'version_save', programSave: isProgramGraph(params.write.graph) });
    return store.saveVersion(params.write);
  }
  // A model program's save, restore and copy keep the structural checks only (inventory F4): no legacy edit rule runs on one.
  const programRestore = isProgramGraph(params.write.graph);
  if (!programRestore) assertNoPreconditionRiskLinks(params.write.graph);
  if (isReturnLegRestore({ head: params.restoreHead ?? null,
    targetVersionId: params.write.version_id, currentGraph: params.write.current_graph })) {
    const admitted = checkPersistedGraphInvariants(params.write.graph, { baseGraph: params.write.current_graph });
    if (admitted.status === 'violated') log.warn({ event: 'v5.scenario_versions.return_leg_admitted',
      scenario_id: write.scenario_id, version_id: params.write.version_id, head_version_id: params.restoreHead?.id,
      admitted: admitted.violations.map(v => ({ code: v.code, count: v.count, entity_ids: v.entity_ids })) },
    'Scenario versions — return leg: restoring a previously-held state that carries structural violations; admitted knowingly');
  } else {
    assertNoIntroducedGraphViolations({ graph: params.write.graph, writesGraph: true,
      identity: { scenario_id: write.scenario_id, turn_id: null, turn_class: null },
      baseGraphForInvariants: params.write.current_graph, source: 'version_restore', programSave: programRestore });
  }
  if (store.restoreVersionAtomic === undefined) throw new ModelVersionStoreError('Atomic model-version restore is not available in this store.');
  return store.restoreVersionAtomic(params.write);
}
