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
// The ONE de-normalisation the validator, the executor precheck and the
// `set_factor_value` handler already share (the AC.1 parity invariant). Reused
// rather than reimplemented — a second copy of a scale convention is the
// hand-maintained-twin defect this module's header exists to warn about.
import { resolveExistingRawValue } from '../orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { recoverScaleFrame } from '../orchestrator-v5/tools/handlers/d1-shared/scale-frame.js';

/**
 * R2-1 — a bare sub-1 value against a FRAME-RECOVERABLE factor is genuinely
 * ambiguous (a proportion of the frame, or a raw sub-unit amount?), and the
 * round-2 writers measurably disagreed on it (10^5 divergence, REVIEW-926.md
 * U1). The ambiguity is the PRODUCT: callers prescreen with
 * `findAmbiguousScaleValueOps` and surface an ask; `reconcileObservedValuePair`
 * throws this typed error as the fail-loud backstop, so a future caller that
 * skips the prescreen cannot silently guess.
 */
export class AmbiguousScaleValueError extends Error {
  constructor(
    readonly path: string,
    readonly newValue: number,
    readonly currentRawValue: number,
  ) {
    super(
      `Value ${newValue} on a frame-scaled factor is ambiguous (a proportion, or an amount of ${currentRawValue}-scale?) — the caller must ask, not guess`,
    );
    this.name = 'AmbiguousScaleValueError';
  }
}

/** One ambiguous value op, as the callers' prescreen reports it. */
export interface AmbiguousScaleValueOp {
  readonly path: string;
  readonly newValue: number;
  readonly currentRawValue: number;
  readonly label?: string;
}
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
    const stampedObserved: Record<string, unknown> = {
      ...observed,
      source: USER_EDIT_SOURCE,
    };
    // A normal chat edit is authored by the current user, not by a prior
    // collaboration round. `canonicaliseValueOps` deliberately carries
    // observed-state siblings forward, so without an explicit removal the
    // old participant/evidence citation survives beside `user_override`.
    // Absence is the shared contract's meaning for "not panel-elicited".
    delete stampedObserved.elicited_from;
    return {
      ...op,
      value: {
        ...value,
        [OBSERVED_ROOT]: stampedObserved,
        provenance: USER_EDIT_PROVENANCE,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Observed value-pair authority (ROADMAP 2.1033 — the SERVER half of
// "screen = commit", 2026-08-09).
//
// ── The defect, reproduced by execution at 1ff2469d ────────────────────────
// `canonicaliseUpdateNodeValue` merges the node's EXISTING observed_state
// under the translated leaves so a value write never wipes `unit`/`cap`. That
// merge also carries `raw_value` forward — and `raw_value` is the field the
// canonical formatter reads FIRST. So editing a 20% factor to 40% produced:
//
//   applied observed_state = { value: 0.4, raw_value: 20, unit: '%' }
//   synthesiseDisplayValue(...)             → "20%"     ← the OLD number
//   reconcileDisplayAnchors(...) repaired[] → []        ← agreed with it
//
// #884's display-anchor reconciliation cannot see this: it recomputes the
// anchor from the same stale `raw_value`, gets "20%" back, and concludes
// nothing needs repair. The 2.1003 fix is not wrong — it is fed a lie.
//
// ── The authority ruling ───────────────────────────────────────────────────
// On the edit path `observed_state.value` is AUTHORITATIVE and `raw_value` is
// a derived denormalisation artefact. Three independent derivations, none of
// them a matter of taste:
//   1. `ALLOWED_OBSERVED_SUBKEYS` (field-safety.ts) = baseline · interventions
//      · std · unit · value. `raw_value` is NOT AI-editable, so an edit op
//      structurally CANNOT author a correct one. A field the writer may not
//      write cannot be the field that wins.
//   2. `graph-hash.ts` whitelists `observed_state.{value,baseline,cap}` as
//      analysis-affecting and EXCLUDES `raw_value` as "cosmetic / provenance
//      / display" — the repo's own declaration.
//   3. `analysis-ready.ts` ships `observed_state.value` as the intervention
//      number; `raw_value` reaches only display-oriented detail.
//
// So the pair is repaired at the WRITER, once, rather than every reader
// defending against it (trap 21: two same-named-concept sources of one
// symptom must not earn a third patch).
//
// ── Why re-derive rather than invent ───────────────────────────────────────
// The inverse is NOT a second copy: `resolveExistingRawValue` is the shared
// de-normalisation the validator, the executor precheck and the
// `set_factor_value` handler already agree on (the AC.1 parity invariant).
// Calling it with `raw_value` OMITTED asks it exactly the right question —
// "what user-unit magnitude does this NEW value denote?" — and it answers
// `ambiguous` when the scale genuinely cannot be recovered.
//
// On `ambiguous`/`missing` the stale `raw_value` is DROPPED, never kept. That
// is the same law `set-factor-value.ts` and `reconcileDisplayAnchors` already
// apply to `display_value`: clear the derived artefact rather than let it
// lie. The formatter's own `value` fallback then renders the honest number.
// Dropping is safe because the live edit path applies ops through
// `applyUpdateNode`, whose `NODE_REQUIRED_NESTED_FIELDS` set is empty, so
// `observed_state` is a whole-object REPLACE (`plotClient` is null at both V5
// dispatch call sites — PLoT's deepMerge is not in play here).
//
// Scope: ONLY `update_node` ops that MOVE `observed_state.value` — i.e. whose
// payload carries a `value` member DIFFERING from the node's current one.
// That second clause is load-bearing and is enforced against the node, not
// against the payload's shape: the canonicaliser merges the node's existing
// observed_state under every translatable-leaf write, so a unit-only,
// std-only or baseline-only edit reaches here carrying an UNCHANGED `value`
// and the live `raw_value`. Reconciling those would DELETE a correct pair on
// an edit that never touched the number, and with it the
// `normalisedConvention` evidence the egress scale net needs — sending PLoT a
// value off by a factor of `cap`. Label edits, structural ops and the
// intervention subtree (whose own `raw_value` IS authoritative — see
// plot-intervention-scale.ts) are likewise returned BY REFERENCE, untouched.
//
// Composed, not folded into `canonicaliseValueOps`, for the same reason
// `stampUserEditProvenance` is: that module's pinned contract is
// spelling-only.
// ---------------------------------------------------------------------------

/**
 * Re-derive (or clear) `observed_state.raw_value` on every op that moves
 * `observed_state.value`, so the denormalised sibling can never outlive the
 * value it described.
 *
 * Pure and total — never throws, never mutates its inputs; an op that needs
 * no reconciliation is returned BY REFERENCE, so a batch that already agrees
 * is byte-identical to today.
 *
 * @param currentGraph - the graph these ops are about to be applied to; it
 *                       supplies the `unit`/`cap` scale context and the
 *                       existing `raw_value` that may need clearing.
 */
/**
 * THE CALLERS' PRESCREEN for the ambiguous scale class (R2-1). Same
 * extraction as `reconcileObservedValuePair` (op → observed root → new value;
 * node → before pair), same predicate as the D1 stated-value ambiguity gate's
 * framed arm: capless factor, frame recoverable from the BEFORE pair, bare
 * value `v ≠ 0 ∧ |v| < 1` that actually MOVES the stored value. Both live
 * callers (`edit-graph.ts` and `gm-held-execute.ts`) call this before
 * reconcile and surface an ASK for any hit; reconcile's typed throw is the
 * backstop, and this function is exported so the ask and the backstop cannot
 * disagree on membership (one predicate, one module — trap 12).
 */
export function findAmbiguousScaleValueOps(
  operations: readonly PatchOperation[],
  currentGraph: unknown,
): AmbiguousScaleValueOp[] {
  const out: AmbiguousScaleValueOp[] = [];
  for (const op of operations) {
    if (op.op !== 'update_node') continue;
    const value = asRecord(op.value);
    if (value === null) continue;
    const observed = asRecord(value[OBSERVED_ROOT]);
    if (observed === null) continue;
    if (!Object.prototype.hasOwnProperty.call(observed, 'value')) continue;
    const newValue = observed.value;
    if (typeof newValue !== 'number' || !Number.isFinite(newValue)) continue;
    if (newValue === 0 || Math.abs(newValue) >= 1) continue;
    const node = findNode(currentGraph, op.path);
    const nodeObserved = asRecord(node?.observed_state) ?? {};
    if (nodeObserved.value === newValue) continue; // no move — not an edit
    const payloadCap = typeof observed.cap === 'number' ? observed.cap : undefined;
    const nodeCap = typeof nodeObserved.cap === 'number' ? nodeObserved.cap : undefined;
    if (payloadCap !== undefined || nodeCap !== undefined) continue; // capped: existing machinery owns it
    // `%` factors: a sub-1 op value is the model-scale convention, not the
    // ambiguous class — the percentage path owns them (same exclusion as
    // reconcile's framed branch; one predicate, kept together).
    const payloadUnit = typeof observed.unit === 'string' ? observed.unit : undefined;
    const nodeUnit = typeof nodeObserved.unit === 'string' ? nodeObserved.unit : undefined;
    if ((payloadUnit ?? nodeUnit) === '%') continue;
    const frame = recoverScaleFrame({
      value: nodeObserved.value,
      raw_value: nodeObserved.raw_value,
    });
    if (frame === undefined) continue;
    const currentRaw =
      typeof nodeObserved.raw_value === 'number' ? nodeObserved.raw_value : Number.NaN;
    const label = typeof node?.label === 'string' ? node.label : undefined;
    out.push({
      path: op.path,
      newValue,
      currentRawValue: currentRaw,
      ...(label !== undefined ? { label } : {}),
    });
  }
  return out;
}

export function reconcileObservedValuePair(
  operations: readonly PatchOperation[],
  currentGraph: unknown,
): PatchOperation[] {
  return operations.map((op) => {
    if (op.op !== 'update_node') return op;
    const value = asRecord(op.value);
    if (value === null) return op;
    const observed = asRecord(value[OBSERVED_ROOT]);
    if (observed === null) return op;
    if (!Object.prototype.hasOwnProperty.call(observed, 'value')) return op;

    const newValue = observed.value;
    if (typeof newValue !== 'number' || !Number.isFinite(newValue)) return op;

    // Scale context, and the authority on whether the value MOVED. Read before
    // any other guard, because that question decides the whole lane.
    const nodeObserved = asRecord(findNode(currentGraph, op.path)?.observed_state) ?? {};

    // ⚠ THE SCOPE THE CHAIN ACTUALLY HANDS US. This function's contract is
    // "act on ops that MOVE observed_state.value", but it never receives a
    // bare payload: `canonicaliseUpdateNodeValue` merges the node's existing
    // observed_state under EVERY translatable-leaf write (value · unit ·
    // baseline · std), so a unit-only / std-only / baseline-only edit arrives
    // carrying an UNCHANGED `value` AND the live `raw_value` — and would
    // resolve `ambiguous` and DELETE the pair on an edit that never touched
    // the number. Nothing can be stale if the value did not move.
    //
    // Deleting it is not cosmetic: `buildFactorScaleMap` grants
    // `normalisedConvention` only when `raw_value` is present, and that flag
    // is the sole evidence gate for the egress scale net's `cap_denormalised`
    // rule. Dropping it changes what PLoT/ISL computes on by a factor of
    // `cap` (£20,000 → 0.2). Pinned by the "COMPOSED chain" describe in
    // observed-value-pair-authority.test.ts.
    if (nodeObserved.value === newValue) return op;

    // ⚠ NARROW BY DESIGN: act ONLY on a payload that already carries a
    // `raw_value`. That key is the stale-carry-forward signature — it is
    // there because `canonicaliseUpdateNodeValue` merged the node's existing
    // observed_state under the write. A payload WITHOUT it cannot strand a
    // stale claim, so this lane leaves it exactly as it found it.
    //
    // This is the boundary, and it is deliberate. A literal nested
    // `{ observed_state: { value } }` op takes the declared-field branch, is
    // never merged, and the applier's whole-object replace then drops
    // `unit`/`cap`/`raw_value` outright — pinned today by
    // `gm-held-value-canonicalisation.test.ts` ("the canonicaliser is the
    // identity"). That sibling WIPE is a real and separate defect; it is NOT
    // this defect (nothing stale survives a wipe), and repairing it here
    // would be the "while we're here" scope creep this programme keeps
    // paying for. Recorded, not absorbed.
    if (!Object.prototype.hasOwnProperty.call(observed, 'raw_value')) return op;

    // Scale context: the payload's own unit/cap (the canonicaliser already
    // merged the node's in), falling back to the node for a payload that set
    // one without the other. `nodeObserved` is read above.
    const unit =
      typeof observed.unit === 'string'
        ? observed.unit
        : typeof nodeObserved.unit === 'string'
          ? nodeObserved.unit
          : undefined;
    const cap =
      typeof observed.cap === 'number'
        ? observed.cap
        : typeof nodeObserved.cap === 'number'
          ? nodeObserved.cap
          : undefined;

    // ── FRAMED CAPLESS FACTORS (records pass 3d) — the frame is preserved,
    // not destroyed (PR #926 round-1 BLOCKER), and the genuinely ambiguous
    // input class is REFUSED, not guessed (round-2 blocker R2-1). The
    // projector writes magnitude-scaled factors as {value: raw/frame,
    // raw_value: raw} with NO cap (a stored cap would flip
    // normaliseFactorValue to cap-normalised writes and break the user-scale
    // round-trip). The frame is recoverable from the node's BEFORE pair —
    // including the over-frame pair a >frame edit creates (round-2 blocker
    // R2-2: the earlier `value ≤ 1` precondition refused the very pair the
    // writer itself wrote, so the SECOND edit resurrected the raw write).
    //
    //   · bare sub-1 non-zero input → AMBIGUOUS (proportion of the frame, or
    //     a raw sub-unit amount?). Round 2 measured the two writers guessing
    //     OPPOSITE answers (10^5 apart). Callers prescreen via
    //     `findAmbiguousScaleValueOps` and ASK; this throw is the fail-loud
    //     backstop so no future caller can silently guess (trap 22f: make
    //     the ambiguity the product).
    //   · everything else (raw magnitudes, 0, negatives ≤ -1) → RAW, divided
    //     onto the factor's own frame — the same semantics as writer 1, and
    //     the cross-writer parity pin holds both to it.
    // ⚠ `unit === '%'` DEFERS to the percentage convention below — that path
    // is `resolveExistingRawValue`'s own special case, and it is ITSELF
    // frame-preserving for percent factors (model value stays the 0–1 level,
    // raw_value = value×100 — i.e. frame 100, exactly what the pair encodes).
    // Intercepting it here misread an unambiguous 0.4 (= 40%) as the
    // ambiguous class (caught by observed-value-pair-authority.test.ts).
    if (cap === undefined && unit !== '%') {
      const frame = recoverScaleFrame({
        value: nodeObserved.value,
        raw_value: nodeObserved.raw_value,
      });
      if (frame !== undefined) {
        if (newValue !== 0 && Math.abs(newValue) < 1) {
          const currentRaw =
            typeof nodeObserved.raw_value === 'number' ? nodeObserved.raw_value : Number.NaN;
          throw new AmbiguousScaleValueError(op.path, newValue, currentRaw);
        }
        const framedValue = newValue / frame;
        if (Number.isFinite(framedValue)) {
          const nextObserved: Record<string, unknown> = { ...observed };
          nextObserved.value = framedValue;
          nextObserved.raw_value = newValue;
          return { ...op, value: { ...value, [OBSERVED_ROOT]: nextObserved } };
        }
        // Non-finite arithmetic: fall through to the pre-existing path below,
        // which re-derives or clears raw_value — never a silent no-op.
      }
    }

    // `raw_value` deliberately OMITTED: we are asking what the NEW value
    // denotes, not echoing the old answer back (which is the defect).
    const derived = resolveExistingRawValue({
      value: newValue,
      ...(unit !== undefined ? { unit } : {}),
      ...(cap !== undefined ? { cap } : {}),
    });

    const nextObserved: Record<string, unknown> = { ...observed };
    if (derived.kind === 'resolved') {
      if (observed.raw_value === derived.raw) return op; // agrees — by reference
      nextObserved.raw_value = derived.raw;
    } else {
      // Scale unrecoverable. Never leave the stale claim standing.
      delete nextObserved.raw_value;
    }

    return { ...op, value: { ...value, [OBSERVED_ROOT]: nextObserved } };
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
