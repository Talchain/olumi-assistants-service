/**
 * `structural_add` (schemas 0.50.0) — the DURABLE node writer.
 *
 * THE DEFECT THIS CLOSES. A user who draws a factor on the canvas was told, and
 * truthfully, that this version could not apply it: `SYSTEM_EVENT_HANDLING`
 * declared the kind `'reader_only_refusal'` because CEE could parse the event
 * and had no writer for it. The node lived in the browser and died at the next
 * reload. This is the writer.
 *
 * ⚠ THIS FILE CONTAINS NO MUTATION LOGIC OF ITS OWN. It is an ADAPTER: it
 * resolves the addition against the server's own persisted read and routes it
 * through the canonical `add_node` PatchOperation train (`applyPatchOperations`),
 * then hands the merged graph to the commit chokepoint `dispatch.ts` owns.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐⭐ THE HONESTY RULE THIS WRITER EXISTS TO NOT BREAK: A NEW FACTOR WITH NO
 * STATED VALUE IS AN EXPLICIT UNKNOWN, NEVER A NUMBER WE INVENTED.
 *
 * The estate's standing invariant (`cee/provenance/unquantified-factor.ts`, and
 * the NO UNIVERSAL SEMANTIC FALLBACK rule it cites) allows exactly three states
 * for a quantity: an explicit user fact, a defensible Olumi estimate carrying
 * its own uncertainty, or genuinely unknown. **A defaulted constant is none of
 * them.** The wire member carries `id`, `node_kind` and `label` and NOTHING
 * else — the contract is explicit that every optional `NodeV3` field is
 * deliberately absent — so the user has stated no level, and the only honest
 * answer is to say so.
 *
 * So a new FACTOR gets `prior: uniform(0, 1)` stamped `prior_is_unquantified`,
 * and NO `observed_state` at all. That is the exact shape
 * `ensureControllableFactorBaselines` produces for the same situation on the
 * draft path, reused rather than restated (`buildUnquantifiedPrior`).
 *
 * WHY `U(0,1)` AND NOT "NO PRIOR AT ALL" — the module that owns the decision
 * states it: MARK, NEVER SUPPRESS. Withholding the prior strips the node of any
 * support and leaves a constraint targeting it evaluating trivially
 * (P=1.0/P=0.0 at intercept=0). `U(0,1)` is the one range over the unit
 * interval that asserts NOTHING; a narrowed range would be an information claim
 * and there is no information.
 *
 * WHY THE FLAG MATTERS AND IS NOT DECORATION: the UI's `isFactorNeedsInput`
 * exempts any factor carrying a prior range — an exemption written for genuine
 * external priors. `prior_is_unquantified` is what tells an ignorance prior
 * apart from an estimate, so without it the amber "needs your judgement"
 * affordance stays dark on exactly the factor that needs it.
 *
 * ⛔ AND THE NUMBER THIS MUST NOT BECOME: there is an ACTIVE defect in which 20
 * of 21 factor values are exactly `0.5`. A defaulted midpoint here would add to
 * it while looking like a feature. No branch below writes a value.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐⭐ THE ID COLLISION IS A GATE THE HASH CANNOT REPLACE, and the contract says
 * so in terms: *"CEE MUST refuse an id that already exists in the persisted
 * graph rather than overwriting that node: the base_graph_hash gate cannot catch
 * a collision, because a colliding id is already present in the very graph the
 * user was looking at."*
 *
 * So `base_graph_hash` can be perfectly fresh and the add still be destructive.
 * Both gates run. The applier would itself throw `NODE_ALREADY_EXISTS`, and that
 * is not enough: a `PatchApplyError` yields a generic "I couldn't apply that"
 * sentence, whereas a collision has a specific, followable answer ("something
 * with that identity is already in the model"). Resolve first, then apply.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⚠⚠ TWO `NodeKind` VOCABULARIES, AND THEY DO NOT AGREE — derived at the bytes,
 * not assumed, and it is the reason this module has a kind gate at all.
 *
 * The wire member types `node_kind` as the CONTRACT's `NodeKind`, which has
 * EIGHT members: `goal, factor, outcome, risk, action, decision, option,
 * constraint`. CEE's persisted `NodeV3.kind` is `NodeKindV3`, which has SEVEN —
 * it has no `constraint`. So `{node_kind: 'constraint'}` is a VALID payload that
 * CEE cannot persist: it would pass the boundary, pass the applier, and die at
 * the post-mutation `GraphV3.safeParse` with a generic save failure naming
 * nothing the user could act on.
 *
 * The gate below is DERIVED from `NodeKindV3.options` rather than restating a
 * list — a hand-copied vocabulary is the mirror this estate pays for most often,
 * and a mirror of a set that already disagrees with its twin is the worst place
 * for one. If CEE ever gains `constraint`, the gate opens with no edit here.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⚠ THE `options[]` ROSTER IS NOT PROPAGATED HERE, DELIBERATELY — and this is
 * the opposite call from `structural-rename.ts`, for a derived reason rather
 * than an inconsistency. `reconcileTopLevelOptionsFromNodes` APPENDS a canonical
 * entry for an option-KIND node that has no entry yet (`optionEntryFromNode`,
 * status derived conservatively as `needs_encoding` on an empty bundle), which
 * is exactly this case. The rename case is the one that pass does NOT cover: it
 * never updates an EXISTING entry's label. Duplicating the append here would be
 * a second owner for one concept. The postcondition below ASSERTS the roster
 * agrees, so the reliance is checked rather than trusted.
 *
 * ⚠ WHAT THIS WRITER DOES NOT FIX, NAMED: a node added with no edges is not yet
 * connected to anything, so an added OPTION can leave the model unanalysable and
 * an added FACTOR reaches no goal. The contract already ruled on this — *"the
 * adjacent readiness problem … is a different seam from transport and is not
 * fixed by widening this member"* — so this module does not invent an edge, a
 * value or a category to paper over it. It TELLS THE USER instead, in the
 * confirmation, and names the two routes that finish the job. An affordance that
 * leaves the user stuck is the failure; one that says what is still needed is
 * not.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐ WHAT THE MUTATION BATTERY COULD NOT KILL, STATED RATHER THAN OMITTED.
 *
 * Every GATE and every content decision is mutant-killed through the writer:
 * deleting the collision gate, the stale gate or the kind gate; giving the new
 * factor a `0.5`; leaving the prior unmarked; narrowing the prior; guessing a
 * `category`; claiming `ai_inferred` provenance; flipping `rerun_recommended`;
 * dropping the honest half of the confirmation — each REDs a named case.
 *
 * THREE do not, and each is a true result about reachability rather than missing
 * coverage:
 *
 *   · `findFabricatedLevel` and `findMissingOptionRosterEntry` bypassed at the
 *     CALL SITE. Both guard against a change one seam past this module —
 *     `buildAddedNode` writes no level, and the projection reliably appends the
 *     roster entry — so nothing the wire accepts makes either fire. Each
 *     PREDICATE is unit-pinned directly and heavily, for the reason
 *     `structural-delete.ts` gives for `hasDanglingEdge`.
 *
 *   · The `structuredClone` around the persist merge. This is an EQUIVALENT
 *     mutant TODAY, and the equivalence is DEMONSTRATED rather than asserted:
 *     `reconcileTopLevelOptionsFromNodes` returns a NEW `options` array and
 *     leaves its input untouched, which is pinned by a dedicated case in
 *     `structural-add.test.ts` ("the roster pass this writer RELIES ON is
 *     pure"). The clone stays because the equivalence depends entirely on a
 *     module this writer does not own: `mergeAppliedGraphForPersistence`
 *     composes with a shallow spread, so `merged.options` IS the trusted base's
 *     array, and the day that pass mutates in place the clone becomes the only
 *     thing standing between this writer and a 409 at rest, forever. The purity
 *     pin REDs first if that day comes.
 *
 * ⚠ IF A FUTURE CHANGE MAKES ANY OF THE THREE REACHABLE — a repair pass that
 * synthesises baselines, a projection that stops appending, a roster pass that
 * mutates — the reachability claim above is void and the route-level suite needs
 * cases, not just these unit pins.
 */

import type { OlumiResponse, SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { EditGraphHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, NodeKindV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { log } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../graph-management/reason-codes.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { mergeAppliedGraphForPersistence } from '../handlers/edit-graph-dispatch.js';
import { applyPatchOperations, PatchApplyError } from '../../orchestrator/patch-applier.js';
import { buildUnquantifiedPrior } from '../../cee/provenance/unquantified-factor.js';
import type { PatchOperation } from '../../orchestrator/types.js';

type StructuralAddEvent = Extract<
  SystemEventTurnPayload['event'],
  { kind: 'structural_add' }
>;

/** `safe_summary` is capped at 80 chars by `EditGraphResultSchema`. */
const SAFE_SUMMARY_MAX_CHARS = 80;

/**
 * The node kinds CEE can actually PERSIST.
 *
 * DERIVED from `NodeKindV3` — the schema `GraphV3.safeParse` enforces — never a
 * restated list. See the module header for why the wire's vocabulary is wider.
 */
const PERSISTABLE_NODE_KINDS: ReadonlySet<string> = new Set<string>(NodeKindV3.options);

export interface StructuralAddBaseHashConflict {
  readonly recovery_action: 'refresh_and_reconfirm';
  readonly conflict_category: typeof BASE_HASH_DIVERGED;
  readonly expected_base_graph_hash: string | null;
}

/**
 * A non-null persisted graph that fails GraphV3 is CORRUPTION, not absence.
 * Dispatch maps this throw to a retryable 500 with no append.
 */
export class InvalidPersistedAddGraphError extends Error {
  constructor() {
    super('structural_add persisted graph failed GraphV3 validation');
    this.name = 'InvalidPersistedAddGraphError';
  }
}

export type StructuralAddResult =
  | {
      readonly kind: 'mutated';
      readonly response: OlumiResponse;
      readonly mutatedGraph: unknown;
      readonly handlerFacts: readonly HandlerFact[];
      readonly graph: GraphV3T;
      readonly baseGraph: unknown;
      readonly addedNodeId: string;
      readonly addedNodeKind: string;
      readonly addedLabel: string;
      /** True when the new node was left an EXPLICIT unknown rather than valued. */
      readonly leftUnquantified: boolean;
    }
  | {
      readonly kind: 'refused';
      readonly response: OlumiResponse;
      readonly reason: string;
      readonly baseHashConflict?: StructuralAddBaseHashConflict;
    };

export interface ApplyStructuralAddParams {
  readonly payload: SystemEventTurnPayload;
  readonly event: StructuralAddEvent;
  readonly requestId: string;
  /** Raw graph from the STRICT server-side persisted-graph read. Never client-supplied. */
  readonly persistedGraph: unknown;
}

function refuse(
  payload: SystemEventTurnPayload,
  reason: string,
  assistantText: string,
  baseHashConflict?: StructuralAddBaseHashConflict,
): StructuralAddResult {
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
 * The node the applier will insert — the ONLY place this module decides content.
 *
 * ⭐ EVERY FIELD HERE IS EITHER STATED BY THE USER OR AN EXPLICIT ADMISSION OF
 * IGNORANCE. Nothing is inferred, defaulted or estimated:
 *
 *   · `id`, `kind`, `label` — stated. They are exactly `NodeV3Schema`'s three
 *     required fields, which is why the wire member carries these three and no
 *     more.
 *   · `provenance: 'user_set'` — the enum's own member for "the user put this
 *     here". The one honest origin claim available.
 *   · `prior` — FACTORS ONLY, and only the ignorance prior. See the header.
 *   · everything else — ABSENT. `category` in particular is NOT guessed:
 *     `FactorCategoryV3` is derived from whether an OPTION edge reaches the
 *     factor, and a brand-new node has no edges, so any value would be an
 *     inference dressed as a fact. It becomes derivable the moment the user
 *     draws the edge, which is the gesture that should decide it.
 *
 * ⚠ NO `observed_state`, and that is the load-bearing absence rather than an
 * omission: an `observed_state` with no `value` and an `observed_state` that is
 * absent are different bytes, and only the second means "no level has been
 * stated". Writing an empty one would be a shape that reads as an answer.
 */
export function buildAddedNode(
  nodeId: string,
  nodeKind: string,
  label: string,
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    id: nodeId,
    kind: nodeKind,
    label,
    provenance: 'user_set',
  };
  if (nodeKind === 'factor') {
    node.prior = buildUnquantifiedPrior();
  }
  return node;
}

/**
 * Does this node carry a fabricated level? Returns the offending field, or null.
 *
 * ⭐ THE POSTCONDITION FOR THE HONESTY RULE, asserted on the bytes that would
 * land rather than on the object this module built — the merge and the
 * projection both run in between, and `repairGraphForPersistence` exists
 * precisely to fill things in. A pass that helpfully synthesised a baseline for
 * a value-less factor would otherwise land a number the user never gave, under a
 * confirmation saying the opposite.
 *
 * The check is DELIBERATELY NOT "is the value 0.5". A guard written against the
 * failure mode in hand rather than against the spec is this estate's most
 * expensive habit: the rule is that NO level may be invented, so ANY numeric
 * level on a factor the user gave no value for is the defect — `0.5`, `0`, `1`
 * or anything else.
 */
export function findFabricatedLevel(
  graph: Record<string, unknown>,
  nodeId: string,
): string | null {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const node = nodes.find((n) => isDict(n) && n.id === nodeId);
  if (!isDict(node)) return 'node_missing';
  if (node.kind !== 'factor') return null;
  const observed = node.observed_state;
  if (isDict(observed)) {
    for (const field of ['value', 'raw_value'] as const) {
      if (typeof observed[field] === 'number') return `observed_state.${field}`;
    }
  }
  if (typeof node.intercept === 'number') return 'intercept';
  const prior = node.prior;
  if (!isDict(prior)) return 'prior_missing';
  if (prior.prior_is_unquantified !== true) return 'prior_not_marked_unquantified';
  // A NARROWED range is an information claim, and there is no information.
  if (prior.range_min !== 0 || prior.range_max !== 1) return 'prior_range_narrowed';
  return null;
}

/**
 * The top-level `options[]` roster must agree with a newly added OPTION node.
 *
 * This module does not write the roster — `reconcileTopLevelOptionsFromNodes`
 * appends the entry during projection. This asserts that reliance instead of
 * trusting it, so the day that pass changes, this writer REDs rather than
 * silently persisting a graph whose two option views disagree.
 *
 * ⚠ ONLY when a roster is PRESENT. An absent `options[]` is never invented by
 * the projection (the "a commit does not invent graph fields" invariant), so
 * demanding an entry there would refuse an honest add.
 */
export function findMissingOptionRosterEntry(
  graph: Record<string, unknown>,
  nodeId: string,
  nodeKind: string,
  label: string,
): string | null {
  if (nodeKind !== 'option') return null;
  if (!Array.isArray(graph.options)) return null;
  const entry = graph.options.find((o) => isDict(o) && o.id === nodeId);
  if (!isDict(entry)) return 'options_entry_missing';
  if (entry.label !== label) return 'options_entry_label_disagrees';
  return null;
}

/**
 * Truthful confirmation copy.
 *
 * ⭐ IT STATES WHAT IS STILL MISSING, and that is the honest half rather than a
 * flourish. A node added on the canvas has no edges, so an OPTION cannot yet be
 * analysed and a FACTOR reaches no goal; a factor also has no stated level,
 * because the user did not give one and this writer refuses to invent one.
 * Saying "Added X" and stopping would leave the user to discover a stalled model
 * on their next run. Each sentence names a route that works.
 *
 * Avoids the words the egress sanitiser flags as internal vocabulary (`node`,
 * `operation`, `patch`).
 */
export function buildAddConfirmationText(
  nodeKind: string,
  label: string,
  leftUnquantified: boolean,
): string {
  const head = `Added '${label}' to your model. That's saved, so it stays when you reload.`;
  if (leftUnquantified) {
    return (
      `${head} I haven't given it a value — you haven't told me one, and I won't ` +
      `invent a number. Connect it to what it affects, then tell me its level, and ` +
      `I'll put both in.`
    );
  }
  if (nodeKind === 'option') {
    return (
      `${head} It isn't connected to anything yet, so it can't be compared with your ` +
      `other choices until you link it to the factors it changes.`
    );
  }
  return `${head} Link it to what it affects and I'll include it in the analysis.`;
}

/** `safe_summary` for the fact: ≤80 chars, display-safe, never a raw id. */
export function buildAddSafeSummary(nodeKind: string, label: string): string {
  const full = `Added ${nodeKind} ${label}`;
  if (full.length <= SAFE_SUMMARY_MAX_CHARS) return full;
  const short = `Added ${label}`;
  return short.length <= SAFE_SUMMARY_MAX_CHARS ? short : short.slice(0, SAFE_SUMMARY_MAX_CHARS);
}

export function applyStructuralAdd(params: ApplyStructuralAddParams): StructuralAddResult {
  const { payload, event, requestId, persistedGraph } = params;

  // ── 1. a base we can trust, or nothing ───────────────────────────────────
  if (persistedGraph === null || persistedGraph === undefined) {
    log.info(
      {
        event: 'v5.system_event.structural_add.no_persisted_graph',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_add — no persisted model; refusing without a graph write',
    );
    return refuse(
      payload,
      'no_persisted_graph',
      `There's no saved model to add that to yet. Tell me about the decision first and I'll build one with you.`,
    );
  }
  const graphParse = GraphV3.safeParse(persistedGraph);
  if (!graphParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_add.persisted_graph_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: graphParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_add — non-null persisted graph is malformed; failing closed',
    );
    throw new InvalidPersistedAddGraphError();
  }
  const baseGraph = graphParse.data;

  // ── 2. THE STALE GATE, before anything is resolved ───────────────────────
  const currentBaseHash = computeAnalysisAffectingGraphHash(
    persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (currentBaseHash === null || currentBaseHash !== event.base_graph_hash) {
    log.info(
      {
        event: 'v5.system_event.structural_add.base_hash_diverged',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        client_base_graph_hash: event.base_graph_hash,
        server_base_graph_hash: currentBaseHash,
      },
      'structural_add — client base hash diverged from the persisted graph; refusing the add',
    );
    return refuse(
      payload,
      BASE_HASH_DIVERGED,
      `The model has changed since you added that, so I haven't put it in. Reload it and add it again.`,
      {
        recovery_action: 'refresh_and_reconfirm',
        conflict_category: BASE_HASH_DIVERGED,
        expected_base_graph_hash: currentBaseHash,
      },
    );
  }

  // ── 3. THE COLLISION GATE — the one the hash provably cannot catch ───────
  // A colliding id is already in the very graph the user was looking at, so the
  // base hash is FRESH and the add is still destructive. Refused with its own
  // sentence rather than left to the applier's generic `NODE_ALREADY_EXISTS`.
  if (baseGraph.nodes.some((n) => n.id === event.node_id)) {
    log.warn(
      {
        event: 'v5.system_event.structural_add.node_id_collision',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_add — the minted id already exists in the persisted model; refusing rather than overwriting',
    );
    return refuse(
      payload,
      'node_id_collision',
      `Something with that identity is already in your model, and I won't overwrite it. Reload the model and add it again.`,
    );
  }

  // ── 4. THE KIND GATE — the wire vocabulary is wider than CEE's ───────────
  // Derived from `NodeKindV3`, never restated. Without this, a valid payload
  // dies at the post-mutation parse with a save error naming nothing actionable.
  if (!PERSISTABLE_NODE_KINDS.has(event.node_kind)) {
    log.warn(
      {
        event: 'v5.system_event.structural_add.unpersistable_node_kind',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        node_kind: event.node_kind,
      },
      'structural_add — the requested kind is outside the persisted graph vocabulary; refusing before the write',
    );
    return refuse(
      payload,
      'unpersistable_node_kind',
      `I can't add that sort of thing to the model yet, so I haven't changed anything. Tell me in chat what you want to capture and I'll find the right way to put it in.`,
    );
  }

  // ── 5. the canonical PatchOperation train ────────────────────────────────
  // `applyAddNode` treats `op.path` as authoritative for the id and pushes the
  // value; it also refuses an existing id, which step 3 has already resolved
  // with a better sentence.
  const addedNode = buildAddedNode(event.node_id, event.node_kind, event.label);
  const operations: PatchOperation[] = [
    { op: 'add_node', path: event.node_id, value: addedNode },
  ];

  let candidate: GraphV3T;
  try {
    candidate = applyPatchOperations(baseGraph, operations);
  } catch (err) {
    log.error(
      {
        event: 'v5.system_event.structural_add.apply_failed',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        code: err instanceof PatchApplyError ? err.code : 'unknown',
      },
      'structural_add — canonical applier refused the addition; nothing written',
    );
    return refuse(
      payload,
      err instanceof PatchApplyError ? err.code : 'apply_failed',
      `I couldn't add that to the saved model, so nothing changed. Reload it and try again.`,
    );
  }

  // ── 6. put the rest of the graph back ────────────────────────────────────
  // `applyPatchOperations` returns ONLY `{nodes, edges}`; persisting that
  // verbatim would strip `goal_node_id`, `options`, `meta` and the rest.
  //
  // `mergeAppliedGraphForPersistence` (the EDIT twin), matching both siblings.
  // Its deletion rule is inert here — an add removes nothing — and its
  // `options[]` passthrough is what lets the projection append the new entry.
  const ingressParse = GraphStateIngressSchema.safeParse(persistedGraph);
  if (!ingressParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_add.ingress_projection_failed',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: ingressParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_add — trusted base could not be projected for the persist merge; refusing the write',
    );
    return refuse(
      payload,
      'ingress_projection_failed',
      `I couldn't save that safely, so I haven't changed anything.`,
    );
  }
  // ⚠ THE CLONE IS LOAD-BEARING even though this module performs no in-place
  // write of its own today. `mergeAppliedGraphForPersistence` composes with a
  // SHALLOW spread, so `merged.options` and `merged.meta` are THE SAME OBJECT
  // REFERENCES the trusted base holds — and `projectGraphForPersistence` runs
  // `reconcileTopLevelOptionsFromNodes` over exactly `options[]` immediately
  // below. A projection pass that mutated rather than copied would write through
  // into `persistedGraph`, which `dispatch.ts` hashes as the atomic-CAS expected
  // base: an expected hash for a graph that was never persisted, and a 409 on
  // every subsequent write, at rest, forever. That is the P0 the delete lane
  // paid for. One clone removes the whole class rather than relying on every
  // downstream pass staying pure.
  const merged = structuredClone(
    mergeAppliedGraphForPersistence({
      appliedGraph: candidate,
      persistedBase: persistedGraph,
      ingressBase: ingressParse.data,
      requestId,
      scenarioId: payload.scenario_id,
    }),
  );

  const projectedGraph = projectGraphForPersistence(merged, {
    scenarioId: payload.scenario_id,
    turnId: payload.turn_id,
    turnClass: 'handler',
    source: 'structural_add',
  });
  const projectedParse = GraphV3.safeParse(projectedGraph);
  if (!projectedParse.success) {
    log.error(
      {
        event: 'v5.system_event.structural_add.projected_graph_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        first_issue_path: projectedParse.error.issues[0]?.path.join('.') ?? '',
      },
      'structural_add — post-add graph failed validation; refusing the write',
    );
    return refuse(
      payload,
      'projected_graph_invalid',
      `I couldn't save that safely, so I haven't changed anything.`,
    );
  }

  // ── 7. postconditions, on the bytes that would land ──────────────────────
  // 7a. THE NODE IS ACTUALLY THERE. Claiming an add that did not land is the
  //     defect this writer exists to close, one level up.
  const landed = projectedParse.data.nodes.find((n) => n.id === event.node_id);
  if (landed === undefined || landed.label !== event.label || landed.kind !== event.node_kind) {
    log.error(
      {
        event: 'v5.system_event.structural_add.add_did_not_land',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        found: landed !== undefined,
      },
      'structural_add — the new entry is absent or altered in the persisted bytes; refusing the write',
    );
    return refuse(
      payload,
      'add_did_not_land',
      `I couldn't add that reliably, so I haven't changed anything.`,
    );
  }

  // 7b. ⭐⭐ NO INVENTED LEVEL. The honesty rule, checked on the projected bytes
  //     rather than on what this module built — the merge and the projection run
  //     in between, and a repair pass that synthesised a baseline would land a
  //     number the user never gave under a confirmation saying otherwise.
  const fabricated = findFabricatedLevel(projectedGraph as Record<string, unknown>, event.node_id);
  if (fabricated !== null) {
    log.error(
      {
        event: 'v5.system_event.structural_add.fabricated_level',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        fabricated_field: fabricated,
      },
      'structural_add — the saved graph would carry a level the user never stated; refusing the write',
    );
    return refuse(
      payload,
      'fabricated_level',
      `I couldn't add that without putting a number on it that you never gave me, so I haven't changed anything.`,
    );
  }

  // 7c. the two option views agree — asserted, not trusted. See the header.
  const rosterGap = findMissingOptionRosterEntry(
    projectedGraph as Record<string, unknown>,
    event.node_id,
    event.node_kind,
    event.label,
  );
  if (rosterGap !== null) {
    log.error(
      {
        event: 'v5.system_event.structural_add.option_roster_disagrees',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        roster_gap: rosterGap,
      },
      'structural_add — the option roster would disagree with the new entry; refusing the write',
    );
    return refuse(
      payload,
      'option_roster_disagrees',
      `I couldn't add that consistently everywhere it appears, so I haven't changed anything.`,
    );
  }

  // 7d. NOTHING ELSE MOVED. An add adds exactly one node and no edges — a new
  //     node has no incident edges by construction, which is the contract's own
  //     stated reason this member is SINGULAR.
  const baseIds = new Set(baseGraph.nodes.map((n) => n.id));
  const addedIds = projectedParse.data.nodes.map((n) => n.id).filter((id) => !baseIds.has(id));
  const projectedIds = new Set(projectedParse.data.nodes.map((n) => n.id));
  const lostIds = baseGraph.nodes.map((n) => n.id).filter((id) => !projectedIds.has(id));
  const edgeKey = (e: { from: string; to: string }): string => `${e.from}::${e.to}`;
  const baseEdges = baseGraph.edges.map(edgeKey).sort();
  const projectedEdges = projectedParse.data.edges.map(edgeKey).sort();
  const edgesChanged =
    baseEdges.length !== projectedEdges.length ||
    baseEdges.some((k, i) => k !== projectedEdges[i]);
  if (addedIds.length !== 1 || addedIds[0] !== event.node_id || lostIds.length > 0 || edgesChanged) {
    log.error(
      {
        event: 'v5.system_event.structural_add.unintended_structural_change',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        added_count: addedIds.length,
        lost_count: lostIds.length,
        edges_changed: edgesChanged,
      },
      'structural_add — the write would have changed more than the one entry; refusing',
    );
    return refuse(
      payload,
      'unintended_structural_change',
      `That would have changed more than the one thing you added, so I haven't applied it.`,
    );
  }

  // ── 7e. THE WRITE MUST BE DESCRIBABLE — decided BEFORE it happens ────────
  // Same rule, same position, and for the same reason as `structural_delete`:
  // a guard placed after an irreversible write is not a guard. The analysis hash
  // is the spine of the wire `graph_hash`, freshness, the CAS expected base and
  // the receipt, so a state we cannot hash is a state we cannot describe.
  const postAddHash = computeAnalysisAffectingGraphHash(
    projectedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (postAddHash === null) {
    log.warn(
      {
        event: 'v5.system_event.structural_add.unhashable_result',
        request_id: requestId,
        scenario_id: payload.scenario_id,
      },
      'structural_add — the post-add graph has no analysis hash; refusing BEFORE the write',
    );
    return refuse(
      payload,
      'unhashable_result',
      `I couldn't save that in a state I can describe back to you, so I haven't changed anything.`,
    );
  }

  // ── 8. the receipt ───────────────────────────────────────────────────────
  // ⚠ `graph_patch` cannot carry this either: `GraphPatchBlockSchema.operation`
  // is a CLOSED three-value enum (`set_factor_value | add_constraint |
  // adjust_edge_strength`) with no member naming an add. Same finding both
  // siblings recorded; the receipt is the `draft_graph` applied-graph field
  // `dispatch.ts` stamps from the COMMITTED bytes, plus this `edit_graph` fact.
  //
  // `rerun_recommended: true` is DERIVED and is the OPPOSITE of the rename
  // sibling's: `nodes` and `options[]` are both inside the analysis-hash
  // projection, so an add moves the hash by construction and any prior analysis
  // is out of date. `impact: 'moderate'` rather than `'high'`: the new entry has
  // no edges, so it changes what the model CONTAINS without yet changing any
  // causal path the analysis follows.
  const leftUnquantified = event.node_kind === 'factor';
  const fact = {
    fact_type: 'edit_graph' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      edit_kind: 'structural' as const,
      status: 'applied' as const,
      operations_count: operations.length,
      affected_entities: [{ kind: landed.kind, label: landed.label }],
      graph_hash_before: currentBaseHash,
      graph_hash_after: postAddHash,
      safe_summary: buildAddSafeSummary(event.node_kind, event.label),
      impact: 'moderate' as const,
      rerun_recommended: true,
    },
  };
  const factCheck = EditGraphHandlerFactSchema.safeParse(fact);
  if (!factCheck.success) {
    log.error(
      {
        event: 'v5.system_event.structural_add.fact_invalid',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        parse_error: factCheck.error.message,
      },
      'structural_add — receipt failed its own contract; refusing the commit (fail closed)',
    );
    return refuse(
      payload,
      'fact_invalid',
      `I couldn't record that properly, so I haven't changed the model.`,
    );
  }

  return {
    kind: 'mutated',
    response: {
      response_version: 2,
      assistant_text: buildAddConfirmationText(event.node_kind, event.label, leftUnquantified),
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: payload.stage,
    },
    mutatedGraph: projectedGraph,
    handlerFacts: [factCheck.data],
    graph: projectedParse.data,
    baseGraph: persistedGraph,
    addedNodeId: event.node_id,
    addedNodeKind: event.node_kind,
    addedLabel: event.label,
    leftUnquantified,
  };
}
