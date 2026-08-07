/**
 * SHARED value-op canonicalisation + landed-op postcondition for BOTH graph
 * apply seams — the held/confirm batch (`executeGmHeldResume`) and the NORMAL
 * edit path (`handleEditGraph`).
 *
 * Introduced by PR #521 for the held path only; generalised here (B5) when the
 * SAME defect was reproduced on the normal path. There is deliberately ONE
 * canonicaliser and ONE postcondition: a second copy is exactly the
 * hand-maintained-twin failure this codebase keeps paying for.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 * `applyUpdateNode` is a shallow `Object.assign`, so whatever key the op
 * carries is written onto the node VERBATIM. The edit prompt
 * (`edit-graph-v6.ts` PATH SYNTAX) teaches `/nodes/<id>/data/value`, which
 * `normalisePath` + the scalar-wrap turn into the LITERAL op key
 * `{ 'data/value': 0.5 }`. `NodeV3` declares neither `data` nor `data/value`,
 * so a GraphV3 parse STRIPS the write and `observed_state.value` never moves,
 * while structural siblings land.
 *
 * On the HELD path the strip happened inside `applyAndValidateMutation`.
 * On the NORMAL path it is worse: `GraphV3.safeParse(candidate)` returns
 * SUCCESS (Zod strips the unknown key rather than erroring) and the code then
 * promoted the UNPARSED candidate — so validation passed on a graph that was
 * not the one persisted, and the edit was reported APPLIED with the value
 * unchanged. Verified on staging HEAD 1063394: `observed_state.value` stayed
 * 0.2, `data/value: 0.5` became a junk key, `safeParse` succeeded.
 *
 * #509 made the held path HONEST (refuses the whole batch) but left the
 * capability closed: the user was correctly told it did not work, and still
 * could not apply their value. This module makes it apply.
 *
 * ── Why canonicalise here rather than round-trip PLoT ─────────────────────
 * The obvious alternative — route the confirm through the same PLoT call the
 * normal edit flow uses — does not exist to be routed to, and would not work
 * if it did:
 *   1. The live V5 edit path calls `handleEditGraph(ctx, msg, adapter, reqId,
 *      turnId)` with NO opts, so `plotClient` is `null` and PLoT is never
 *      called on the edit path at all. There is no PLoT round-trip to reuse.
 *   2. PLoT's `validate-patch` `CANONICAL_NODE_FIELDS` contains
 *      `observed_state` and NOT `data`, so a `data`/`data/value`-spelled
 *      `update_node` is REJECTED there (`INVALID_PATCH_FIELD`) — PLoT would
 *      hard-decline the live spelling, not canonicalise it.
 *   3. A network call inside a confirm would make a previously-pure,
 *      always-available user action fail on a PLoT outage, and PLoT's repair
 *      loop could return ops the user never confirmed — breaking the consent
 *      contract that the confirm applies EXACTLY the named batch.
 *
 * ── Why this is not a second, driftable canonicaliser ─────────────────────
 * Trap 12 (derive, don't mirror). Every input to the translation is derived
 * from the module that already OWNS it:
 *   - which node fields survive the re-parse → `NodeV3.shape` (the schema that
 *     does the stripping), never a hand-listed copy;
 *   - which `observed_state` sub-keys are tunable → `ALLOWED_OBSERVED_SUBKEYS`,
 *     imported from `field-safety.ts` (the referee's own allowlist);
 *   - merge-not-replace semantics → PLoT's own `update_node` behaviour
 *     (`deepMerge(node, op.value)` in `validate-patch.ts`), so a value write
 *     never wipes `unit` / `raw_value` / `cap` siblings;
 *   - the `data` ⇄ `observed_state` alias → the SAME equivalence
 *     `normaliseEditOpsForPlot` asserts when it renames `observed_state` →
 *     `data` for `add_node`, and that `field-safety.ts` asserts when it treats
 *     `root === 'observed_state' || root === 'data'` as one subtree.
 * The one irreducible constant is that alias, and it is NOT assume-good: an op
 * this module fails to translate is left VERBATIM, and `batchFullyLanded`
 * then refuses the whole batch. Drift fails LOUD (an honest refusal), never
 * silently-green.
 *
 * ── Atomicity ─────────────────────────────────────────────────────────────
 * This module changes only the SPELLING of ops, never their number, order,
 * targets, or semantics. It runs AFTER the confirm-time re-referee (so the
 * verdict and its telemetry stay byte-identical) and BEFORE the local apply.
 * `batchFullyLanded` remains the backstop: all-or-nothing per turn.
 *
 * Pure and total — never throws, never mutates its inputs.
 */
import { NodeV3 } from '../schemas/cee-v3.js';
import { ALLOWED_OBSERVED_SUBKEYS } from '../orchestrator-v5/graph-management/field-safety.js';
import { parseEdgeTargetPath } from '../orchestrator-v5/graph-management/adapters/edit-graph-producer.js';
import type { PatchOperation } from './types.js';
import type { GraphV3T } from '../schemas/cee-v3.js';

/**
 * Node fields that SURVIVE the GraphV3 re-parse, derived from the schema that
 * performs the strip. A field added to (or removed from) `NodeV3` changes this
 * set automatically — there is no list to keep in sync.
 */
const NODE_DECLARED_FIELDS: ReadonlySet<string> = new Set(Object.keys(NodeV3.shape));

/** The canonical node field a tunable value write must land in. */
const OBSERVED_ROOT = 'observed_state';

/**
 * Producer spellings of {@link OBSERVED_ROOT}. `data` is the edit prompt's own
 * vocabulary ("Data: { value, raw_value, unit, cap, … }") and the rename
 * target `normaliseEditOpsForPlot` uses for `add_node`; `field-safety.ts`
 * already treats the two roots as one subtree.
 */
const OBSERVED_ROOT_SPELLINGS: ReadonlySet<string> = new Set([OBSERVED_ROOT, 'data']);

/**
 * Tunable leaves this module will translate, DERIVED from the referee's
 * allowlist minus `interventions`.
 *
 * `interventions` is deliberately excluded: `extractInterventionUpdates`
 * (edit-graph.ts) reads the `data.interventions` spelling OFF THE OPERATION,
 * so rewriting that subtree would break the option-configure chain that
 * option-configure-apply-chain.test.ts pins. An interventions op is left
 * verbatim and the atomicity guard refuses it honestly — exactly today's
 * behaviour.
 */
const TRANSLATABLE_LEAVES: ReadonlySet<string> = new Set(
  [...ALLOWED_OBSERVED_SUBKEYS].filter((k) => k !== 'interventions'),
);

/**
 * Path segments that could reach the prototype chain. Op keys are
 * model-controlled, so a key like `__proto__/value` is never translated (left
 * verbatim → guard refuses), mirroring `candidate-graph.ts`'s setter guard.
 */
const FORBIDDEN_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Locate a node by id on an arbitrary (possibly hostile) ingress graph. */
function findNode(graph: unknown, nodeId: string): Record<string, unknown> | null {
  const g = asRecord(graph);
  if (g === null || !Array.isArray(g.nodes)) return null;
  for (const n of g.nodes) {
    const node = asRecord(n);
    if (node !== null && node.id === nodeId) return node;
  }
  return null;
}

/**
 * Canonicalise ONE `update_node` op's value payload. Returns `null` when
 * nothing needed translating, so the caller can return the ORIGINAL operation
 * object by reference (identity — byte-identical for canonical spellings).
 */
function canonicaliseUpdateNodeValue(
  value: Record<string, unknown>,
  currentNode: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  /** Accumulated tunable leaf writes destined for `observed_state`. */
  let observedPatch: Record<string, unknown> | null = null;

  for (const [key, to] of Object.entries(value)) {
    // A key the schema already declares (including a canonical `observed_state`
    // whole-object write) is passed through UNTOUCHED — its existing semantics,
    // whatever they are, are not this lane's to change.
    if (NODE_DECLARED_FIELDS.has(key)) {
      out[key] = to;
      continue;
    }

    const segments = key.split(/[/.]/).filter((s) => s.length > 0);
    if (
      segments.length === 0 ||
      segments.some((s) => FORBIDDEN_PATH_SEGMENTS.has(s)) ||
      !OBSERVED_ROOT_SPELLINGS.has(segments[0]!)
    ) {
      out[key] = to;
      continue;
    }

    if (segments.length === 1) {
      // Whole-root write in an alias spelling, e.g. `{ data: { value: 0.5 } }`.
      // Translate only when EVERY member is a tunable leaf; anything else
      // (an interventions map, an unknown sub-key) stays verbatim.
      const members = asRecord(to);
      if (
        members === null ||
        Object.keys(members).length === 0 ||
        !Object.keys(members).every((k) => TRANSLATABLE_LEAVES.has(k))
      ) {
        out[key] = to;
        continue;
      }
      observedPatch = { ...(observedPatch ?? {}), ...members };
      continue;
    }

    if (segments.length === 2 && TRANSLATABLE_LEAVES.has(segments[1]!)) {
      observedPatch = { ...(observedPatch ?? {}), [segments[1]!]: to };
      continue;
    }

    // Deeper paths (`data/interventions/<factor_id>`) and non-tunable leaves
    // are NOT this module's to rewrite — verbatim, guard decides.
    out[key] = to;
  }

  if (observedPatch === null) return null;

  // PLoT's `update_node` semantics (`deepMerge`): merge onto what the node
  // already has, so a value write never wipes `unit` / `raw_value` / `cap`.
  // An explicit `observed_state` in the same op still wins over the node's
  // existing state; the translated leaves win over both (they are the write
  // the user confirmed).
  const existing = asRecord(currentNode?.observed_state) ?? {};
  const explicit = asRecord(out[OBSERVED_ROOT]) ?? {};
  out[OBSERVED_ROOT] = { ...existing, ...explicit, ...observedPatch };
  return out;
}

/**
 * Translate every `update_node` value op in a confirmed held batch into the
 * field spelling GraphV3 preserves. Ops that need no translation are returned
 * BY REFERENCE; when no op changes, the input array is returned by reference
 * too, so a flag-on run over a canonical batch is byte-identical to flag-off.
 *
 * `currentGraph` is the graph the batch is about to be applied to — it supplies
 * the existing `observed_state` that translated leaves merge onto.
 */
export function canonicaliseValueOps(
  operations: readonly PatchOperation[],
  currentGraph: unknown,
): { readonly operations: PatchOperation[]; readonly translatedCount: number } {
  let translatedCount = 0;
  const out = operations.map((op) => {
    if (op.op !== 'update_node') return op;
    const value = asRecord(op.value);
    if (value === null) return op;
    const canonical = canonicaliseUpdateNodeValue(value, findNode(currentGraph, op.path));
    if (canonical === null) return op;
    translatedCount += 1;
    return { ...op, value: canonical };
  });
  return {
    operations: translatedCount === 0 ? [...operations] : out,
    translatedCount,
  };
}

// ---------------------------------------------------------------------------
// User-edit provenance stamp (ROADMAP 2.396(b) — P4 transport, 2026-08-05).
//
// Every op that reaches either edit seam is a CHAT-SET, USER-CONFIRMED write
// (the normal path applies what the user asked for; the held path applies what
// the user explicitly confirmed). Yet the applied value carried NO user
// provenance, so the UI's "User edited" pill — earned from
// `observed_state.source` (its reliable rung; node `provenance` is clobbered
// by the V3 response transform, `schema-v3.ts` nodeProvenanceDisplay) — could
// never earn on these lanes, and every chat-set value rendered as "Olumi
// estimate — check first".
//
// The stamp is written INTO THE OP, pre-apply, deliberately:
//   · the applier then writes it, the GraphV3 re-parse keeps it (the
//     ObservedStateV3.source enum now carries the user members), and
//     `batchFullyLanded`'s per-field survival check sees it IDENTICAL on both
//     the raw and canonical sides. Stamping the canonical graph AFTER the
//     apply would instead make raw != canonical on the observed_state key and
//     refuse every stamped batch.
//   · ONE function, called by BOTH seams — the same no-second-copy rule as
//     `canonicaliseValueOps` itself (see the module header).
//
// Scope: ONLY `update_node` ops whose (post-canonicalisation) `observed_state`
// payload carries a `value` member — the pill is a claim about the VALUE.
// Unit-only edits, label edits, structural ops and intervention writes are
// returned BY REFERENCE, untouched. An explicit LLM-claimed producer source on
// a value write is OVERRIDDEN: the user consented to this write, and letting a
// model stamp its own output as `cee_inference` on a user-confirmed value is
// the exact mislabel this exists to close.
//
// This deliberately does NOT ride inside `canonicaliseValueOps`: that module's
// pinned contract is spelling-only ("byte-identical for canonical batches"),
// and folding a semantic stamp into it would break that pin. Compose them:
//   stampUserEditProvenance(canonicaliseValueOps(ops, graph).operations)
// ---------------------------------------------------------------------------

/** The observed_state.source literal CEE's chat-edit writers stamp. */
export const USER_EDIT_SOURCE = 'user_override' as const;
/** The node-level provenance literal (the set_factor_value precedent). */
export const USER_EDIT_PROVENANCE = 'user_set' as const;

/**
 * Stamp user provenance onto every value-writing `update_node` op. Pure and
 * total — never throws, never mutates its inputs; ops needing no stamp are
 * returned by reference.
 */
export function stampUserEditProvenance(
  operations: readonly PatchOperation[],
): PatchOperation[] {
  return operations.map((op) => {
    if (op.op !== 'update_node') return op;
    const value = asRecord(op.value);
    if (value === null) return op;
    const observed = asRecord(value[OBSERVED_ROOT]);
    if (observed === null) return op;
    if (!Object.prototype.hasOwnProperty.call(observed, 'value')) return op;
    return {
      ...op,
      value: {
        ...value,
        [OBSERVED_ROOT]: { ...observed, source: USER_EDIT_SOURCE },
        provenance: USER_EDIT_PROVENANCE,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Landed-op postcondition (#509's `heldBatchFullyLanded`, generalised to serve
// the normal edit path too).
//
// Every operation must have an OBSERVABLE effect on the CANONICAL
// (persisted-shape) graph. For update ops that means every field the applier
// wrote must survive canonicalisation with the same value on the target
// entity; for add/remove ops it means the entity's presence/absence flipped as
// asked. If ANY op did not land, the caller refuses the WHOLE batch — nothing
// persists, never a silent partial. Total + fail-closed: an unresolvable
// target or any thrown comparison reports NOT-landed (refuse), never a false
// OK.
//
// This runs on the ops AS APPLIED (post-canonicalisation). That ordering is
// what makes it exact: a translated value op's payload is by then a DECLARED
// `observed_state` write, so it survives the parse byte-for-byte and is
// verified literally. The only keys that can still be stripped are the ones
// `canonicaliseValueOps` deliberately left verbatim.
// ---------------------------------------------------------------------------

const NODE_IDENTITY_KEYS: readonly string[] = ['id'];
const EDGE_IDENTITY_KEYS: readonly string[] = ['from', 'to', 'id'];

/** Order-insensitive deep equality over JSON-serialisable values. */
function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqualJson(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every(
    (k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqualJson(ao[k], bo[k]),
  );
}

/**
 * True for the intervention-subtree op spellings (`data/interventions/<id>`,
 * `observed_state.interventions.<id>`, `interventions/<id>`) that
 * `canonicaliseValueOps` deliberately does NOT translate because
 * `encodeOptionInterventionsForEdit` owns them: it reads these very keys off
 * the applied graph and promotes them to canonical top-level `interventions`.
 *
 * Derived from the same segment vocabulary the canonicaliser uses
 * (`OBSERVED_ROOT_SPELLINGS` + the `interventions` leaf of the referee's
 * `ALLOWED_OBSERVED_SUBKEYS`), not a second hand-kept list.
 */
function isInterventionSubtreeKey(key: string): boolean {
  const segments = key.split(/[/.]/).filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  if (segments[0] === 'interventions') return true;
  return OBSERVED_ROOT_SPELLINGS.has(segments[0]!) && segments[1] === 'interventions';
}

/**
 * Every non-identity field an update op's applier wrote (`rawEntity`) must
 * survive canonicalisation byte-for-byte on the persisted entity
 * (`canonEntity`). A missing/altered field means the write did not land (it
 * was stripped, e.g. a `data`/slash-keyed value spelling). Fail-closed: a
 * missing entity reports NOT-survived.
 *
 * `preEntity` is supplied ONLY by callers that run a downstream encoder
 * between the apply and the persisted parse (the normal edit path runs
 * `encodeOptionInterventionsForEdit`). When present it admits ONE narrow extra
 * way for a key to have landed: an intervention-subtree spelling whose
 * canonical `interventions` field actually MOVED relative to the pre-edit
 * entity. Anything else that was stripped still refuses. When `preEntity` is
 * absent (the held path) the check is strictly #509's.
 */
function updateWritesSurvived(
  value: unknown,
  identityKeys: readonly string[],
  rawEntity: Record<string, unknown> | undefined,
  canonEntity: Record<string, unknown> | undefined,
  preEntity: Record<string, unknown> | undefined,
): boolean {
  if (rawEntity === undefined || canonEntity === undefined) return false;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return true;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (identityKeys.includes(key)) continue;
    if (deepEqualJson(rawEntity[key], canonEntity[key])) continue;

    // The write was stripped by canonicalisation.
    if (preEntity === undefined) return false;
    if (!isInterventionSubtreeKey(key)) return false;
    // The intervention encoder owns this spelling — it landed iff the
    // canonical intervention state actually changed.
    if (deepEqualJson(canonEntity.interventions, preEntity.interventions)) return false;
  }
  return true;
}

/**
 * True iff EVERY operation in the batch has an observable effect on the
 * canonical applied graph. `rawApplied` is the pre-canonicalisation candidate
 * (the applier's raw writes); `canonical` is the GraphV3-parsed
 * persisted-shape graph the commit will store and the UI/analysis will read.
 *
 * `preEdit` is optional — see {@link updateWritesSurvived}. Omitting it gives
 * the strict #509 held-path semantics unchanged.
 */
export function batchFullyLanded(
  operations: readonly PatchOperation[],
  rawApplied: GraphV3T,
  canonical: GraphV3T,
  preEdit?: GraphV3T | null,
): boolean {
  const rawNodes = rawApplied.nodes as ReadonlyArray<Record<string, unknown>>;
  const rawEdges = rawApplied.edges as ReadonlyArray<Record<string, unknown>>;
  const canonNodes = canonical.nodes as ReadonlyArray<Record<string, unknown>>;
  const canonEdges = canonical.edges as ReadonlyArray<Record<string, unknown>>;
  const preNodes = (preEdit?.nodes ?? undefined) as
    | ReadonlyArray<Record<string, unknown>>
    | undefined;
  const preEdges = (preEdit?.edges ?? undefined) as
    | ReadonlyArray<Record<string, unknown>>
    | undefined;
  const findNode = (
    arr: ReadonlyArray<Record<string, unknown>> | undefined,
    id: unknown,
  ): Record<string, unknown> | undefined => arr?.find((n) => n.id === id);
  const findEdge = (
    arr: ReadonlyArray<Record<string, unknown>> | undefined,
    from: unknown,
    to: unknown,
  ): Record<string, unknown> | undefined => arr?.find((e) => e.from === from && e.to === to);

  for (const op of operations) {
    try {
      switch (op.op) {
        case 'add_node':
          if (findNode(canonNodes, op.path) === undefined) return false;
          break;
        case 'remove_node':
          if (findNode(canonNodes, op.path) !== undefined) return false;
          break;
        case 'add_edge': {
          const v = op.value as Record<string, unknown>;
          if (findEdge(canonEdges, v?.from, v?.to) === undefined) return false;
          break;
        }
        case 'remove_edge': {
          const ep = parseEdgeTargetPath(op.path);
          if (ep === null) return false;
          if (findEdge(canonEdges, ep.from, ep.to) !== undefined) return false;
          break;
        }
        case 'update_node':
          if (
            !updateWritesSurvived(
              op.value,
              NODE_IDENTITY_KEYS,
              findNode(rawNodes, op.path),
              findNode(canonNodes, op.path),
              preNodes === undefined ? undefined : findNode(preNodes, op.path),
            )
          ) {
            return false;
          }
          break;
        case 'update_edge': {
          const ep = parseEdgeTargetPath(op.path);
          if (ep === null) return false;
          if (
            !updateWritesSurvived(
              op.value,
              EDGE_IDENTITY_KEYS,
              findEdge(rawEdges, ep.from, ep.to),
              findEdge(canonEdges, ep.from, ep.to),
              preEdges === undefined ? undefined : findEdge(preEdges, ep.from, ep.to),
            )
          ) {
            return false;
          }
          break;
        }
        default:
          // Unknown op kind — cannot verify its effect, so fail closed.
          return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}
