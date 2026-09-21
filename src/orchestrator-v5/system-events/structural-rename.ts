/**
 * `structural_rename` (schemas 0.50.0) — the DURABLE label writer.
 *
 * THE DEFECT THIS CLOSES. 0.50.0 gave the canvas three direct-edit verbs and
 * CEE shipped a reader for all three: `dispatch.ts` declared `structural_rename`
 * `'reader_only_refusal'`, so a user who renamed a node on the canvas was told,
 * truthfully, that this version could not apply it. The rename lived in the
 * browser and died at the next reload. This module is the writer that turns that
 * honest refusal into an honest write.
 *
 * ⚠ THIS FILE CONTAINS NO MUTATION LOGIC OF ITS OWN — the same rule
 * `factor-value-edit.ts` states for its lane. It is an ADAPTER: it resolves the
 * rename against the server's own persisted read and routes it through the
 * canonical `update_node` PatchOperation train (`applyPatchOperations`), then
 * hands the merged graph to the commit chokepoint `dispatch.ts` already owns.
 * If you find yourself writing `node.label = …` here, the bug is that you are
 * not reusing the applier.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE TRUSTED BASE IS THE SERVER'S OWN READ — inherited verbatim from
 * `structural-delete.ts`, and not weakened here. `session/store.ts` states the
 * rule for the whole estate: the expected base "must derive ONLY from a
 * server-side persisted read … NEVER from request-supplied `graph_state`". The
 * wire carries INTENT (which id, which new label) plus two ASSERTIONS
 * (`base_graph_hash`, `expected_label`), never structure.
 *
 * ⭐⭐ TWO GATES, BECAUSE ONE OF THEM IS STRUCTURALLY BLIND TO THIS EDIT.
 *
 * `base_graph_hash` is the ANALYSIS-AFFECTING hash, and `label` IS NOT IN ITS
 * PROJECTION. Derived at this repo's own bytes: `context/graph-hash.ts`
 * `projectNode` hashes `kind, category, factor_type, is_baseline,
 * goal_threshold, goal_threshold_raw, goal_threshold_cap, intercept,
 * encoding_map` — no `label` — and its module header says so in terms (it omits
 * "cosmetic / provenance / display fields so label-only edits do not trigger" a
 * hash change). The published keep-list in the contract's
 * `boundary/graph-hash-contract.ts` agrees field for field.
 *
 * The consequence, stated forwards because it is easy to get backwards: two
 * users renaming the same node concurrently move NO hash, so `base_graph_hash`
 * alone would let the second rename silently clobber the first — a
 * last-writer-wins loss on the one field the stale gate cannot see. That is why
 * the contract makes `expected_label` mandatory and says "CEE MUST compare
 * `expected_label` against the persisted label and refuse on mismatch". Both
 * gates run, in that order, before anything is resolved.
 *
 * ⭐⭐ AND THAT SAME BLINDNESS IS WHY THE TWO GATES GET DIFFERENT OUTCOMES —
 * this is the concurrency decision, made deliberately and not by symmetry.
 *
 *   · `base_graph_hash` divergence → 409 GRAPH_DIVERGED, nothing appended.
 *     Identical to `structural_delete`. The client holds a 16-hex analysis hash,
 *     the server hands back the one it holds, and "refresh and reconfirm" is a
 *     bounded action: re-read, see a DIFFERENT hash, resend.
 *
 *   · `expected_label` mismatch → a COMMITTED 200 refusal naming the current
 *     label. NOT a 409, and the asymmetry is derived rather than chosen. The
 *     409 envelope's only recovery payload is `expected_base_graph_hash`
 *     (`dispatch.ts` → `route-v2.ts`), and on a label-only divergence that hash
 *     IS UNCHANGED — the server would answer "refresh and reconfirm" while
 *     handing back the exact value the client already holds. A client that
 *     compares the two sees no difference, concludes nothing moved, and resends
 *     the same rename: an affordance terminating in refusal, with no exit (P8).
 *     The datum that makes this recovery bounded is the CURRENT LABEL, and the
 *     409 envelope has no field for it — carrying one would mean widening the
 *     shared contract, which this lane deliberately does not touch. A committed
 *     200 that says "it's called 'X' now" is followable with what the user can
 *     already see, and it lands in the transcript where the next turn can read
 *     it. Contrast `edge_strength_edit`, whose `expected` tuple IS
 *     analysis-affecting: there the hash genuinely moves, so a 409 carrying it
 *     is a real recovery and that writer correctly returns one.
 *
 * ⚠ NO SILENT WIN EITHER WAY. Neither outcome writes a graph, a fact, or a new
 * pending action. The difference is only which honest answer the user gets.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐⭐ A RENAME MUST NOT RETARGET ANYTHING — the property this module's
 * postconditions exist to enforce, and the one place a "cosmetic" edit can do
 * real damage.
 *
 * Everything in the canonical graph is ID-ADDRESSED: `EdgeV3` joins on
 * `(from, to)` node ids, and `interventions` / `raw_interventions` are records
 * KEYED ON FACTOR ID (verified across `orchestrator/types.ts`,
 * `analysis-ready-helper.ts`, `plot-intervention-scale.ts` and
 * `analysable-option-gate.ts` — every one is id-keyed). So a label change moves
 * no reference by construction, and the postconditions below assert exactly
 * that on the bytes that would land.
 *
 * ⚠⚠ ONE IN-GRAPH MIRROR DOES EXIST AND IS HANDLED HERE: the top-level
 * `options[]` roster carries its OWN `label` (`cee-v3.ts` `OptionV3`), and it is
 * the surface live CEE readers PREFER (the ContextPack projection among them).
 * `reconcileTopLevelOptionsFromNodes` — the projection pass that would otherwise
 * own this — is APPEND-and-propagate-INTERVENTIONS only; it never updates an
 * existing entry's label (`reconcile-top-level-options.ts:235` is the append
 * branch). Renaming an option node without `propagateRenamedLabel` below would
 * therefore leave the canvas showing the new name and the analysis surface the
 * old one — the two-views-disagree defect `structural_delete` already paid for
 * once, one field over. Same principle as that lane's `pruneDanglingNodeReferences`:
 * a mutation must not leave a stale copy of what it changed.
 *
 * ⚠⚠ WHAT IS NOT FIXED HERE, NAMED RATHER THAN IMPLIED. A sweep of this repo
 * found label-keyed readers in two classes, and only one of them is a defect:
 *
 *   (1) CHAT ENTITY RESOLUTION — `ask/index.ts` `findMentionedNodes`,
 *       `edit-graph.ts` `resolveEditTarget`, `clarification-resume.ts`
 *       `matchDriverToFactors`, `deterministic-value-update.ts`,
 *       `post-analysis-label-intercept.ts`, `whatif/resolve-target-option.ts`,
 *       `context-pack-assembler.ts` `matchByLabel`. These match the user's FREE
 *       TEXT against the CURRENT graph's labels. After a rename the user says
 *       the new name and these resolve it — retargeting is the CORRECT
 *       behaviour, not a hazard. No change needed and none made.
 *
 *   (2) CROSS-SNAPSHOT LABEL KEYS — the genuine residue, and out of this lane's
 *       scope. The sharpest is `coaching/compare-runs.ts` `deriveDriverRankChanges`,
 *       which keys the PRIOR run's ranking on `factor_label` and looks up the
 *       CURRENT run's `factor_label`: rename a driver between two runs and it
 *       reads as a "new entrant", so its real rank movement silently vanishes
 *       from the comparison. Same class, smaller blast radius:
 *       `context-pack-assembler.ts` `byLabelIdless` (signals that carried no
 *       option_id), `analysis-result-headline.ts` `collectPinnedFactors`,
 *       `chip-finalizer.ts` dedupe, `draft/records/completion.ts`
 *       `merged_refinements`. Collab round manifests also snapshot a label, but
 *       are pinned to an immutable `graph_version_ref` and are stale BY DESIGN.
 *       None of these is reachable from this writer's own bytes; each is a
 *       coaching/analysis-projection seam with its own owner. Fixing them from
 *       here would be the "while we're here" widening the scope rule forbids.
 *       Disclosed so the next lane inherits the finding, not the silence.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐ WHAT THE MUTATION BATTERY COULD NOT KILL, STATED RATHER THAN OMITTED.
 *
 * Every GATE in this module is mutant-killed through the writer: deleting the
 * expected-label gate, the base-hash gate, the duplicate-id check, the
 * `options[]` propagation, the `label_authored` drop, the provenance stamp, the
 * trusted-base clone, or the applier's label write each REDs a named case.
 *
 * The three POSTCONDITIONS do not, and that is a true result about reachability
 * rather than missing coverage. `findStaleRenamedLabel`,
 * `findUnintendedStructuralChange` and `renameMovedAnalysisHash` all guard
 * against a change ONE SEAM PAST the applier: the applier writes `label` and
 * `provenance` and nothing else, and no projection pass rewrites a node label
 * (`reconcile-top-level-options.ts:235` is an APPEND branch), so no input the
 * wire accepts can currently make any of the three fire. Bypassing them at the
 * CALL SITE therefore leaves the writer suite green.
 *
 * They are kept, and each PREDICATE is unit-pinned directly, for the reason
 * `structural-delete.ts` gives for `hasDanglingEdge`: a guard nothing exercises
 * rots into a tautology, and the cheapest defence against that is to test the
 * predicate rather than pretend the integration path reaches it. One of those
 * unit pins earned its keep immediately — see `renameMovedAnalysisHash`, whose
 * obvious simplification is a landmine that the writer suite could not see.
 *
 * ⚠ IF A FUTURE CHANGE MAKES ANY OF THE THREE REACHABLE — a projection pass that
 * writes labels, an applier that takes more than one op, a widened event — the
 * reachability claim above is void and the route-level suite needs cases, not
 * just these unit pins.
 */

import type { OlumiResponse, SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { EditGraphHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { log } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../graph-management/reason-codes.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { mergeAppliedGraphForPersistence } from '../handlers/edit-graph-dispatch.js';
import { applyPatchOperations, PatchApplyError } from '../../orchestrator/patch-applier.js';
import type { PatchOperation } from '../../orchestrator/types.js';

type StructuralRenameEvent = Extract<
  SystemEventTurnPayload['event'],
  { kind: 'structural_rename' }
>;

/** `safe_summary` is capped at 80 chars by `EditGraphResultSchema`. */
const SAFE_SUMMARY_MAX_CHARS = 80;

/**
 * A recoverable canonical-state divergence in ANALYSIS space. Mapped by the
 * route to HTTP 409 + `GRAPH_DIVERGED`. No graph, fact or turn row is written.
 *
 * ⚠ ONLY the `base_graph_hash` gate produces this. An `expected_label`
 * divergence deliberately does NOT — see the module header for why handing back
 * an unchanged hash would be an unfollowable recovery.
 */
export interface StructuralRenameBaseHashConflict {
  readonly recovery_action: 'refresh_and_reconfirm';
  readonly conflict_category: typeof BASE_HASH_DIVERGED;
  /** The hash the server actually holds — makes the refresh a bounded action. */
  readonly expected_base_graph_hash: string | null;
}

/**
 * A non-null persisted graph that fails GraphV3 is CORRUPTION, not absence.
 * Dispatch maps this throw to a retryable 500 with no append, so the corrupt row
 * stays authoritative and no friendly "no saved model" refusal hides the defect.
 */
export class InvalidPersistedRenameGraphError extends Error {
  constructor() {
    super('structural_rename persisted graph failed GraphV3 validation');
    this.name = 'InvalidPersistedRenameGraphError';
  }
}

export type StructuralRenameResult =
  | {
      readonly kind: 'mutated';
      readonly response: OlumiResponse;
      /** The projected graph to persist (full ingress shape, not the GraphV3 subset). */
      readonly mutatedGraph: unknown;
      readonly handlerFacts: readonly HandlerFact[];
      /** GraphV3 view of `mutatedGraph` — the adapter's own readback. */
      readonly graph: GraphV3T;
      /** The trusted server-read base, for the atomic CAS expected hashes. */
      readonly baseGraph: unknown;
      /** The node that was renamed, for telemetry and the dispatch receipt check. */
      readonly renamedNodeId: string;
      readonly previousLabel: string;
      readonly newLabel: string;
    }
  | {
      readonly kind: 'refused';
      readonly response: OlumiResponse;
      readonly reason: string;
      /** Present ONLY for a stale base hash → 409, never a committed transcript. */
      readonly baseHashConflict?: StructuralRenameBaseHashConflict;
    };

export interface ApplyStructuralRenameParams {
  readonly payload: SystemEventTurnPayload;
  readonly event: StructuralRenameEvent;
  readonly requestId: string;
  /** Raw graph from the STRICT server-side persisted-graph read. Never client-supplied. */
  readonly persistedGraph: unknown;
}

function refuse(
  payload: SystemEventTurnPayload,
  reason: string,
  assistantText: string,
  baseHashConflict?: StructuralRenameBaseHashConflict,
): StructuralRenameResult {
  return {
    kind: 'refused',
    reason,
    ...(baseHashConflict !== undefined ? { baseHashConflict } : {}),
    response: {
      response_version: 2,
      assistant_text: assistantText,
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: payload.stage,
    },
  };
}

function isDict(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Update the top-level `options[]` mirror of a renamed node's label.
 *
 * UPDATE-IF-PRESENT, never invent. An absent or malformed `options[]` is left
 * exactly as found — the same rule `reconcileTopLevelOptionsFromNodes` states
 * for itself, and the reason is the tested "a commit does not invent graph
 * fields" invariant. A non-option node has no entry and this is a no-op.
 *
 * Mutates a clone the caller owns. Returns how many entries it touched, which
 * is 0 or 1 for a well-formed graph and is reported rather than asserted — a
 * duplicated `options[]` id is a pre-existing corruption this lane must not
 * silently reinterpret.
 */
export function propagateRenamedLabel(
  graph: Record<string, unknown>,
  nodeId: string,
  newLabel: string,
): number {
  if (!Array.isArray(graph.options)) return 0;
  let updated = 0;
  for (const option of graph.options) {
    if (!isDict(option)) continue;
    if (option.id !== nodeId) continue;
    if (option.label === newLabel) continue;
    option.label = newLabel;
    updated += 1;
  }
  return updated;
}

/**
 * Any SURVIVING copy of the OLD label for the renamed id, or null when clean.
 *
 * The postcondition twin of `propagateRenamedLabel`, asserted on the PROJECTED
 * bytes — the projection runs after the propagation and could reintroduce a
 * stale entry (`reconcileTopLevelOptionsFromNodes` appends entries derived from
 * nodes, so a bug there is exactly the shape this catches).
 *
 * Checks the NODE itself too: if the applier or the merge failed to land the
 * rename, the graph is unchanged and committing it would claim a rename that did
 * not happen.
 */
export function findStaleRenamedLabel(
  graph: Record<string, unknown>,
  nodeId: string,
  newLabel: string,
): string | null {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const node = nodes.find((n) => isDict(n) && n.id === nodeId);
  if (!isDict(node) || node.label !== newLabel) return 'nodes[]';
  if (Array.isArray(graph.options)) {
    for (const option of graph.options) {
      if (isDict(option) && option.id === nodeId && option.label !== newLabel) {
        return 'options[]';
      }
    }
  }
  return null;
}

/**
 * The RETARGETING postcondition: a rename changed the named node's label and
 * NOTHING else about the graph's identity or wiring.
 *
 * ⚠ SCOPED DELIBERATELY, AND THE SCOPE IS THE WHOLE POINT. A byte-equality
 * assertion between base and projected would be WRONG here: `projectGraphForPersistence`
 * legitimately repairs, normalises and reconciles, so an honest rename over a
 * graph that was not already in projected form would be refused — a guard that
 * blocks a valid gesture is a worse defect than the one it prevents. What this
 * asserts instead is the set of properties a LABEL CHANGE can never move:
 *
 *   · the multiset of node ids is unchanged (nothing added, removed, re-keyed);
 *   · the multiset of edge `(from, to)` tuples is unchanged — edges are keyed on
 *     that pair and on nothing else, so this IS "no edge was retargeted";
 *   · no node OTHER than the renamed one changed its label.
 *
 * The third clause is what makes the test binding by IDENTITY rather than by a
 * value predicate: a same-labelled sibling proves the writer resolved by id.
 *
 * Returns a short reason code, or null when clean.
 */
export function findUnintendedStructuralChange(
  base: GraphV3T,
  projected: GraphV3T,
  renamedNodeId: string,
): string | null {
  const baseIds = base.nodes.map((n) => n.id).sort();
  const projectedIds = projected.nodes.map((n) => n.id).sort();
  if (baseIds.length !== projectedIds.length) return 'node_set_changed';
  if (baseIds.some((id, i) => id !== projectedIds[i])) return 'node_set_changed';

  const edgeKey = (e: { from: string; to: string }): string => `${e.from}::${e.to}`;
  const baseEdges = base.edges.map(edgeKey).sort();
  const projectedEdges = projected.edges.map(edgeKey).sort();
  if (baseEdges.length !== projectedEdges.length) return 'edge_set_changed';
  if (baseEdges.some((k, i) => k !== projectedEdges[i])) return 'edge_set_changed';

  const projectedLabels = new Map(projected.nodes.map((n) => [n.id, n.label]));
  for (const node of base.nodes) {
    if (node.id === renamedNodeId) continue;
    if (projectedLabels.get(node.id) !== node.label) return 'other_node_relabelled';
  }
  return null;
}

/**
 * Truthful confirmation copy.
 *
 * States exactly what changed, in the user's own two labels, and — unlike the
 * delete lane — explicitly says the numbers did NOT move. That second half is
 * not decoration: a user who renames a factor and then sees an unchanged
 * analysis needs to know that is correct rather than stale. It is also the
 * user-facing statement of the invariant this module asserts on the bytes.
 *
 * Avoids the words the egress sanitiser flags as internal vocabulary (`node`,
 * `operation`, `patch`).
 */
export function buildRenameConfirmationText(previousLabel: string, newLabel: string): string {
  return (
    `Renamed '${previousLabel}' to '${newLabel}'. That change is saved, so the new name ` +
    `stays when you reload. Nothing else moved — a name change doesn't affect the analysis.`
  );
}

/** `safe_summary` for the fact: ≤80 chars, display-safe, never a raw id. */
export function buildRenameSafeSummary(previousLabel: string, newLabel: string): string {
  const full = `Renamed ${previousLabel} to ${newLabel}`;
  if (full.length <= SAFE_SUMMARY_MAX_CHARS) return full;
  const short = `Renamed to ${newLabel}`;
  return short.length <= SAFE_SUMMARY_MAX_CHARS
    ? short
    : short.slice(0, SAFE_SUMMARY_MAX_CHARS);
}

/**
 * Did this rename move any ANALYSIS-AFFECTING byte?
 *
 * A rename provably cannot: `label` is absent from `projectNode`'s keep-list in
 * `context/graph-hash.ts`, and the published keep-list in the contract's
 * `boundary/graph-hash-contract.ts` agrees field for field. This is the guard
 * that makes the claim checkable rather than argued.
 *
 * ⭐⭐ BOTH SIDES ARE PROJECTED, AND THAT IS THE WHOLE DESIGN — MEASURED, NOT
 * ASSUMED. `projectGraphForPersistence` repairs, normalises and reconciles, and
 * at least one of those passes moves the analysis hash on its own:
 * `reconcileTopLevelOptionsFromNodes` APPENDS an entry for an option-KIND node
 * missing from `options[]`, and `options[]` is inside the hash projection.
 * Measured on the real modules at this tip: a graph carrying `options: []`
 * beside an option node hashes `cf19e98b3fe2a8ed` unprojected and
 * `780b0e7c684e1500` projected.
 *
 * So comparing the post-rename hash against the UNPROJECTED base hash would
 * declare an honest rename analysis-affecting on every graph that was persisted
 * before the projection existed, and refuse it — a guard that blocks a valid
 * gesture, which is strictly worse than the drift it watches for. Projecting
 * both sides isolates the RENAME's own contribution, which is the property
 * actually being claimed.
 *
 * ⚠ NEITHER ARGUMENT IS MUTATED. `structuredClone` first, because
 * `persistedGraph` is `dispatch.ts`'s CAS expected base and a write-through
 * there is a 409-at-rest, forever.
 *
 * ⚠ REACHABILITY, DISCLOSED. No input the wire accepts can currently make this
 * return true — the applier writes `label`/`provenance` and nothing else, and
 * both are outside the projection. It is defence-in-depth against a change one
 * seam past it, and it is UNIT-pinned for exactly that reason: an integration
 * mutant that neuters it cannot be killed through the route, so pinning the
 * predicate directly is what stops it rotting into a tautology. Same honest
 * posture, and same reasoning, as `structural-delete.ts`'s `hasDanglingEdge`.
 */
export function renameMovedAnalysisHash(
  persistedBase: unknown,
  projectedGraph: unknown,
  ctx: { readonly scenarioId?: string; readonly turnId?: string },
): { readonly moved: boolean; readonly baseHash: string | null; readonly afterHash: string | null } {
  const projectedBase = projectGraphForPersistence(structuredClone(persistedBase), {
    ...(ctx.scenarioId !== undefined ? { scenarioId: ctx.scenarioId } : {}),
    ...(ctx.turnId !== undefined ? { turnId: ctx.turnId } : {}),
    turnClass: 'handler',
    source: 'structural_rename_base_probe',
  });
  const baseHash = computeAnalysisAffectingGraphHash(
    projectedBase as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  const afterHash = computeAnalysisAffectingGraphHash(
    projectedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  return { moved: afterHash === null || afterHash !== baseHash, baseHash, afterHash };
}

export function applyStructuralRename(
  params: ApplyStructuralRenameParams,
): StructuralRenameResult {
  const { payload, event, requestId, persistedGraph } = params;

  // ── 1. a base we can trust, or nothing ───────────────────────────────────
  if (persistedGraph === null || persistedGraph === undefined) {
    log.info(
      {
        event: 'v5.system_event.structural_rename.no_persisted_graph',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_rename — no persisted model; refusing without a graph write',
    );
    return refuse(
      payload,
      'no_persisted_graph',
      `There's no saved model I can safely change yet, so I haven't renamed anything.`,
    );
  }
  const graphParse = GraphV3.safeParse(persistedGraph);
  if (!graphParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_rename.persisted_graph_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: graphParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_rename — non-null persisted graph is malformed; failing closed',
    );
    throw new InvalidPersistedRenameGraphError();
  }
  const baseGraph = graphParse.data;

  // ── 2. THE ANALYSIS-SPACE STALE GATE, before anything is resolved ────────
  const currentBaseHash = computeAnalysisAffectingGraphHash(
    persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (currentBaseHash === null || currentBaseHash !== event.base_graph_hash) {
    log.info(
      {
        event: 'v5.system_event.structural_rename.base_hash_diverged',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        // Hashes are non-secret content digests and are the whole diagnostic.
        client_base_graph_hash: event.base_graph_hash,
        server_base_graph_hash: currentBaseHash,
      },
      'structural_rename — client base hash diverged from the persisted graph; refusing the rename',
    );
    return refuse(
      payload,
      BASE_HASH_DIVERGED,
      `The model has changed since you renamed that, so I haven't applied it. Reload it and rename again — otherwise I could rename something you didn't pick.`,
      {
        recovery_action: 'refresh_and_reconfirm',
        conflict_category: BASE_HASH_DIVERGED,
        expected_base_graph_hash: currentBaseHash,
      },
    );
  }

  // ── 3. resolve the target BY ID, against the server's graph ──────────────
  // Never by label: label-matching is precisely what this event must not do,
  // and a duplicate id is refused rather than arbitrarily disambiguated — the
  // same rule `edge_strength_edit` and `structural_delete` apply.
  const matches = baseGraph.nodes.filter((n) => n.id === event.node_id);
  if (matches.length === 0) {
    log.info(
      {
        event: 'v5.system_event.structural_rename.node_target_not_found',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_rename — the named node is not in the persisted model; refusing',
    );
    return refuse(
      payload,
      'node_target_not_found',
      `I couldn't find what you renamed in the saved model, so I haven't changed anything. Reload it and try again.`,
    );
  }
  if (matches.length > 1) {
    log.error(
      {
        event: 'v5.system_event.structural_rename.node_target_ambiguous',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        match_count: matches.length,
      },
      'structural_rename — the persisted model holds duplicate ids for the named node; refusing',
    );
    return refuse(
      payload,
      'node_target_ambiguous',
      `The saved model has more than one thing with that identity, so I can't tell which you meant. I haven't changed anything.`,
    );
  }
  const target = matches[0]!;

  // ── 4. THE LABEL-SPACE GATE — the one the hash cannot see ────────────────
  // Contract: "CEE MUST compare `expected_label` against the persisted label and
  // refuse on mismatch." Without it a concurrent rename is silently clobbered,
  // because step 2 provably cannot fire on a label-only change.
  //
  // The copy NAMES THE CURRENT LABEL, which is the whole reason this outcome is
  // a committed 200 rather than a 409 — see the module header.
  if (target.label !== event.expected_label) {
    log.info(
      {
        event: 'v5.system_event.structural_rename.expected_label_mismatch',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        // Labels are user-authored display strings, already egress-visible in
        // the copy below. Logging lengths only would make this undiagnosable.
        client_expected_label: event.expected_label,
        server_current_label: target.label,
      },
      'structural_rename — expected label diverged from the persisted label; refusing the rename',
    );
    return refuse(
      payload,
      'expected_label_mismatch',
      `That's called '${target.label}' in the saved model now, not '${event.expected_label}' — someone renamed it while you were working. I haven't changed it. Rename it again from what you can see now.`,
    );
  }

  // ── 5. the canonical PatchOperation train ────────────────────────────────
  // `applyUpdateNode` strips `id` from the update and `Object.assign`s the rest,
  // so this changes `label` and `provenance` and touches nothing else.
  //
  // `provenance: 'user_set'` is the honest origin claim for a label the user
  // typed themselves; the enum has exactly that member (`cee-v3.ts` NodeV3).
  // ⚠ It is documented RESPONSE-ONLY (recomputed by `transformResponseToV3`),
  // so it is advisory rather than load-bearing — the AUTHORITATIVE receipt is
  // the `edit_graph` handler fact this module builds below, which is committed
  // on the turn row and read by every downstream prior-facts consumer.
  const operations: PatchOperation[] = [
    {
      op: 'update_node',
      path: event.node_id,
      value: { label: event.label, provenance: 'user_set' },
    },
  ];

  let candidate: GraphV3T;
  try {
    candidate = applyPatchOperations(baseGraph, operations);
  } catch (err) {
    log.error(
      {
        event: 'v5.system_event.structural_rename.apply_failed',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        code: err instanceof PatchApplyError ? err.code : 'unknown',
      },
      'structural_rename — canonical applier refused the rename; nothing written',
    );
    return refuse(
      payload,
      err instanceof PatchApplyError ? err.code : 'apply_failed',
      `I couldn't apply that rename to the saved model, so I haven't changed anything. Reload it and try again.`,
    );
  }

  // ── 5b. a stale `label_authored` is a FALSE CLAIM about the new label ────
  // `NodeV3.label_authored` means "this label is OUR authored display string
  // rather than the user's verbatim words", and its own doc says it is DERIVED
  // from `label !== source_quote`, never hand-set, with absence meaning "the
  // label IS the user's own text". After a user types their own name for the
  // node, absence is exactly the true state — leaving a `true` behind would tell
  // the inspector Olumi authored a string the user wrote.
  //
  // ⚠ `source_quote` is DELIBERATELY LEFT ALONE. It is the user's exact words
  // from the brief — a historic record, append-only, and deleting it would
  // destroy provenance to tidy a derived flag (the estate's rule: a dated
  // capture is evidence, not a fixture to keep current).
  //
  // Done here rather than through the applier because `Object.assign`ing
  // `label_authored: undefined` leaves the KEY present with an undefined value,
  // which `structuredClone` preserves — "declared absent" and "absent" are
  // different bytes, and only one of them is what the field's contract means.
  //
  // `applyPatchOperations` returns a fresh structuredClone of `{nodes, edges}`,
  // so this mutates nothing the caller can observe.
  const renamedNode = candidate.nodes.find((n) => n.id === event.node_id);
  if (renamedNode !== undefined && 'label_authored' in renamedNode) {
    delete (renamedNode as Record<string, unknown>).label_authored;
  }

  // ── 6. put the rest of the graph back ────────────────────────────────────
  // `applyPatchOperations` returns ONLY `{nodes, edges}`. Persisting that
  // verbatim would strip `goal_node_id`, `options`, `meta`, `coaching`,
  // `causal_claims` and every other top-level field.
  //
  // `mergeAppliedGraphForPersistence` (the EDIT twin) rather than
  // `mergeMutatedGraphForPersistence` (the D1 twin), matching `structural_delete`:
  // the two are documented as NOT interchangeable, and the edit twin is the one
  // whose precedence rules own the top-level `options[]` roster this rename must
  // keep in step. It removes no entry here — a rename deletes nothing — so its
  // deletion rule is inert and its passthrough is what we want.
  const ingressParse = GraphStateIngressSchema.safeParse(persistedGraph);
  if (!ingressParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_rename.ingress_projection_failed',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: ingressParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_rename — trusted base could not be projected for the persist merge; refusing the write',
    );
    return refuse(
      payload,
      'ingress_projection_failed',
      `I couldn't save that rename safely, so I haven't changed anything.`,
    );
  }
  // ⚠⚠ THE CLONE IS LOAD-BEARING — the same P0 `structural_delete` records.
  // `mergeAppliedGraphForPersistence` composes with a SHALLOW spread, so
  // `merged.options` is THE SAME ARRAY REFERENCE the trusted base holds.
  // `propagateRenamedLabel` below writes `option.label = …` IN PLACE, so without
  // this clone it would rewrite `persistedGraph` — the read `dispatch.ts` then
  // derives the atomic-CAS expected base from, yielding an expected hash for a
  // graph that was never persisted and a 409 on every subsequent write.
  const merged = structuredClone(
    mergeAppliedGraphForPersistence({
      appliedGraph: candidate,
      persistedBase: persistedGraph,
      ingressBase: ingressParse.data,
      requestId,
      scenarioId: payload.scenario_id,
    }),
  );

  // ── 6b. keep the `options[]` mirror in step ──────────────────────────────
  const optionsUpdated = propagateRenamedLabel(merged, event.node_id, event.label);
  if (optionsUpdated > 0) {
    log.info(
      {
        event: 'v5.system_event.structural_rename.options_mirror_updated',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        entries_updated: optionsUpdated,
      },
      'structural_rename — propagated the new label into the top-level options roster',
    );
  }

  const projectedGraph = projectGraphForPersistence(merged, {
    scenarioId: payload.scenario_id,
    turnId: payload.turn_id,
    turnClass: 'handler',
    source: 'structural_rename',
  });
  const projectedParse = GraphV3.safeParse(projectedGraph);
  if (!projectedParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_rename.projected_graph_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: projectedParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_rename — post-rename graph failed validation; refusing the write',
    );
    return refuse(
      payload,
      'projected_graph_invalid',
      `I couldn't save that rename safely, so I haven't changed anything.`,
    );
  }

  // ── 7. the postconditions, on the bytes that would land ──────────────────
  const staleLabel = findStaleRenamedLabel(
    projectedGraph as Record<string, unknown>,
    event.node_id,
    event.label,
  );
  if (staleLabel !== null) {
    log.error(
      {
        event: 'v5.system_event.structural_rename.stale_label_survived',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        stale_surface: staleLabel,
      },
      'structural_rename — the old label would survive in the persisted bytes; refusing the write',
    );
    return refuse(
      payload,
      'stale_label_survived',
      `I couldn't rename that consistently everywhere it appears, so I haven't changed anything.`,
    );
  }

  const unintended = findUnintendedStructuralChange(
    baseGraph,
    projectedParse.data,
    event.node_id,
  );
  if (unintended !== null) {
    log.error(
      {
        event: 'v5.system_event.structural_rename.unintended_structural_change',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        unintended_change: unintended,
      },
      'structural_rename — a rename would have changed more than a label; refusing the write',
    );
    return refuse(
      payload,
      'unintended_structural_change',
      `That rename would have changed more than the name, so I haven't applied it.`,
    );
  }

  // ── 7b. THE ANALYSIS HASH MUST NOT MOVE ──────────────────────────────────
  // A rename is provably not analysis-affecting: `label` is absent from
  // `projectNode`'s keep-list. So the post-rename hash MUST equal the hash of
  // the same base put through the same projection.
  //
  // The predicate is EXTRACTED and unit-pinned — see `renameMovedAnalysisHash`
  // for why both sides are projected and why that is not interchangeable with a
  // comparison against `currentBaseHash`.
  const neutrality = renameMovedAnalysisHash(persistedGraph, projectedGraph, {
    scenarioId: payload.scenario_id,
    turnId: payload.turn_id,
  });
  const projectedBaseHash = neutrality.baseHash;
  const postRenameHash = neutrality.afterHash;
  if (neutrality.moved) {
    log.error(
      {
        event: 'v5.system_event.structural_rename.analysis_hash_moved',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        projected_base_graph_hash: projectedBaseHash,
        post_rename_graph_hash: postRenameHash,
      },
      'structural_rename — a label change moved the analysis hash; refusing the write',
    );
    return refuse(
      payload,
      'analysis_hash_moved',
      `That rename would have changed more than the name, so I haven't applied it.`,
    );
  }

  // ── 8. what actually changed, measured from the graphs ───────────────────
  // DERIVED base-vs-projected, never copied from the request.
  const previousLabel = target.label;
  const newLabel = projectedParse.data.nodes.find((n) => n.id === event.node_id)?.label ?? '';
  if (newLabel === previousLabel) {
    // Unreachable through the wire (the contract refines `label !== expected_label`
    // and step 4 pins `expected_label === persisted label`), and kept anyway
    // because it is derived from the GRAPHS rather than from the request: if a
    // future projection pass reverted the label, committing would claim a rename
    // that did not happen.
    log.warn(
      {
        event: 'v5.system_event.structural_rename.no_effect',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_rename — resolved rename changed nothing; refusing rather than claiming a change',
    );
    return refuse(
      payload,
      'no_effect',
      `That's already what it's called in the saved model, so there was nothing for me to change.`,
    );
  }

  // ── 9. the receipt ───────────────────────────────────────────────────────
  // ⚠ `graph_patch` IS NOT THE CARRIER, and that is a contract fact rather than
  // a preference: `GraphPatchBlockSchema.operation` is a CLOSED three-value enum
  // (`set_factor_value | add_constraint | adjust_edge_strength`) with no member
  // that can name a rename, so emitting one would require either a false
  // operation name or a widening of the shared contract this lane does not
  // touch. `structural_delete` recorded the identical finding for its own verb.
  // The authoritative UI-facing receipt is therefore the same one that lane
  // uses: the `draft_graph` applied-graph field `dispatch.ts` stamps from the
  // COMMITTED bytes, plus this `edit_graph` fact on the turn row.
  //
  // `impact: 'low'` + `rerun_recommended: false` are DERIVED, not copied from
  // the delete sibling: step 7b has just PROVEN this change moved no
  // analysis-affecting byte, so telling the user to re-run would be advice the
  // server's own measurement contradicts.
  const fact = {
    fact_type: 'edit_graph' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      edit_kind: 'structural' as const,
      status: 'applied' as const,
      operations_count: operations.length,
      affected_entities: [{ kind: target.kind, label: newLabel }],
      graph_hash_before: currentBaseHash,
      graph_hash_after: postRenameHash,
      safe_summary: buildRenameSafeSummary(previousLabel, newLabel),
      impact: 'low' as const,
      rerun_recommended: false,
    },
  };
  const factCheck = EditGraphHandlerFactSchema.safeParse(fact);
  if (!factCheck.success) {
    // Fail CLOSED. Committing the rename without its receipt would leave the
    // graph changed and the transcript unable to say what changed.
    log.error(
      {
        event: 'v5.system_event.structural_rename.fact_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        parse_error: factCheck.error.message,
      },
      'structural_rename — receipt failed its own contract; refusing the commit (fail closed)',
    );
    return refuse(
      payload,
      'fact_invalid',
      `I couldn't record that rename properly, so I haven't changed the model.`,
    );
  }

  return {
    kind: 'mutated',
    response: {
      response_version: 2,
      assistant_text: buildRenameConfirmationText(previousLabel, newLabel),
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: payload.stage,
    },
    mutatedGraph: projectedGraph,
    handlerFacts: [factCheck.data],
    graph: projectedParse.data,
    baseGraph: persistedGraph,
    renamedNodeId: event.node_id,
    previousLabel,
    newLabel,
  };
}
