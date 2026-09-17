/**
 * Track 3 — R4 field-safety (fail-closed).
 *
 * Two checks, restating T4.0 R4:
 *  1. Field allowlist for `update_node_field` / `update_edge_field`: a candidate
 *     may touch only tunable node/edge fields — reconciled (lane CEE-W5) to the
 *     SANCTIONED EDIT VOCABULARY (what edit_graph's PatchOperation schema +
 *     patch applier + downstream Zod validation already accept), evaluated on
 *     the field's ROOT segment so every producer spelling (bare root,
 *     slash-keyed `data/value`, dotted `observed_state.value`) resolves
 *     identically. Pipeline-OWNED value fields (sensitivity_score, elasticity,
 *     e-values, robustness, flip thresholds, …) are analysis-derived — a
 *     producer must never set them (dual-draft G10) — and pipeline-recomputed
 *     stamps (provenance, validation, defaulted, origin) are equally owned;
 *     identity fields (node `id`/`kind`, edge `from`/`to`) stay blocked.
 *  2. Engine-claim scan on ALL free text — EVERY string leaf in the payload (labels,
 *     descriptions, questions, reasons, update `from`/`to` values) PLUS the provenance
 *     rationale: no EVPI / flip-point / quantified-probability prose may ride in on a
 *     candidate, whether as narrative prose OR as a label/value (dual-draft G14, "any
 *     free text"). Ids are scanned too — in the rare case an id literally contains an
 *     engine-claim term (e.g. "flip-point"), the conservative false-positive rejection is
 *     acceptable: a producer should not name entities with engine-claim terms.
 *
 * All checks are pure and total.
 */
import { z } from 'zod';
import type { CandidateMutationEnvelope } from './types.js';
import { InterventionV3 } from '../../schemas/cee-v3.js';
import {
  aiEditableFieldRoots,
  aiEditableObservedSubkeys,
  provenanceOwnedSegments,
  requireEditableFieldTableRevision,
} from '@talchain/schemas/orchestrator';
import {
  FIELD_NOT_ALLOWED,
  PIPELINE_OWNED_FIELD,
  ENGINE_CLAIM_IN_TEXT,
  type MutationReasonCode,
} from './reason-codes.js';

/**
 * A6 PIN-SKEW GUARD (hazard 1, made LOUD). The allowlists below are DERIVED
 * from the classed field-parity table shipped in `@talchain/schemas`. A repo on
 * an older pin carries a SHORTER table, so every derived allowlist would be
 * silently narrower and grants the design made would be silently denied. This
 * call THROWS at module load on an older pin — it never degrades quietly.
 *
 * Bump this constant in the same change as any adoption of a newer table
 * revision. (`EDITABLE_FIELD_TABLE_REVISION` is the table's own monotone
 * content revision, independent of the package's semver.)
 */
export const REQUIRED_EDITABLE_FIELD_TABLE_REVISION = 1;
requireEditableFieldTableRevision(REQUIRED_EDITABLE_FIELD_TABLE_REVISION);

/**
 * Field paths arrive in every spelling the edit pipeline actually produces:
 * a bare root (`description`, `data`, `observed_state`, `goal_threshold`),
 * a slash-keyed leaf path from `normalisePath` (`data/value`,
 * `data/interventions/<fac_id>`), or a legacy dotted path
 * (`observed_state.value`, `strength.mean`). The allowlist is evaluated on
 * the ROOT segment: a sanctioned root sanctions its sub-paths (subject to
 * the pipeline-owned screen on the FULL path below).
 */
function fieldRootOf(field: string): string {
  const first = field.split(/[/.]/, 1)[0];
  return first ?? field;
}

/**
 * Tunable node field ROOTS a candidate may update — **DERIVED (A6), never
 * mirrored**, from the classed field-parity table in `@talchain/schemas`
 * (`aiEditableFieldRoots('node')` = every row of class `grant` or `ai_only`).
 * This replaces the hand-reconciled 14-root list that stood here from lane
 * CEE-W5 (2026-07-07) and had drifted from the inspector's setters — trap 12,
 * the hand-maintained mirror.
 *
 * Deliberately ABSENT, and absent BY DERIVATION rather than by omission:
 *  - `id` / `kind` — no row at all (node identity; the applier strips `id`,
 *    and an identity-class re-type can break invariants no Zod check
 *    re-validates; pinned by referee-core.test.ts since Track 3);
 *  - `goal_threshold*` / `success_threshold` — class `invariant_coupled`: the
 *    threshold quad has exactly one sanctioned writer (add_constraint's
 *    goal-join, which keeps raw/unit/cap/normalised consistent). Parity is
 *    owed at the OPERATION level, in a later leg of this train, never as a raw
 *    field grant;
 *  - `extractionType`, `threshold_source` — class `provenance_owned`: DENIED
 *    permanently ("AI ≤ human" is satisfied by <). Screened below with the
 *    precise PIPELINE_OWNED_FIELD code;
 *  - `confidence` (edge) — class `deferred_derivation`: not granted, not
 *    denied on principle, and carrying its own settling question.
 *
 * ⚠ MEASURED CONSEQUENCE OF THE DERIVATION (disclosed, not hidden). The table
 * is derived from the UI's inspector setters and the SHARED package's node
 * schema. CEE's own `NodeV3` / `EdgeV3` (`src/schemas/cee-v3.ts`) are plain
 * `z.object`s — "declared fields only — unknown fields stripped" — and they do
 * NOT declare four of the newly-granted roots: node `state_space`,
 * `probability`, `impact` and edge `label`. Measured at this tip: each is
 * silently stripped by a `NodeV3` / `EdgeV3` re-parse.
 *
 * ⚠ THE FAIL-SAFE IS UPDATE-PATH ONLY — say it in that scope and no wider.
 * On an UPDATE the loss is LOUD: `batchFullyLanded` (canonicalise-value-ops.ts)
 * compares every written field on the raw-applied entity against the canonical
 * one and refuses the whole batch when a field did not survive — two-stage
 * rejection, never a silent wrong value. On an **ADD** it is **SILENT**: the
 * same function verifies an add by ENTITY PRESENCE only
 * (`findNode(canonNodes, op.path) !== undefined`), so a new node carrying
 * `state_space` is committed WITHOUT it and nothing refuses, warns, or
 * receipts. Both halves are measured in
 * `field-parity-derivation.test.ts`'s persistence-survival block.
 *
 * The fifth new grant, `observed_state.std`, DOES survive (`ObservedStateV3`
 * is `.passthrough()`). All of the above is pinned by
 * `field-parity-derivation.test.ts`'s persistence-survival block so the day
 * CEE declares one of those fields, the pin REDs and the note gets corrected
 * rather than rotting.
 */
export const ALLOWED_NODE_FIELD_ROOTS: ReadonlySet<string> = aiEditableFieldRoots('node');

/**
 * DERIVED (A6). Within the observed_state/data subtree only these sub-fields
 * are tunable
 * (the old exact allowlist, restored as a depth-1 rule after the root-only
 * relaxation was found to sanction provenance-class sub-fields like
 * `observed_state.source`). `interventions` allows deeper paths
 * (data/interventions/<factor_id>).
 *
 * EXPORTED (R1 residual, follow-up to #509; generalised by B5) so the shared
 * value-op canonicaliser (`src/orchestrator/canonicalise-value-ops.ts`, used
 * by BOTH the held-confirm and normal edit paths) DERIVES its translatable
 * leaf set from this single owner instead of mirroring it — trap 12, a
 * hand-maintained second copy would drift silently and the drift would read
 * as green.
 */
export const ALLOWED_OBSERVED_SUBKEYS: ReadonlySet<string> = aiEditableObservedSubkeys();

/**
 * Tunable edge field ROOTS a candidate may update — DERIVED (A6) from the same
 * classed table, `aiEditableFieldRoots('edge')`.
 */
export const ALLOWED_EDGE_FIELD_ROOTS: ReadonlySet<string> = aiEditableFieldRoots('edge');

/**
 * Analysis-derived, pipeline-owned fields. A candidate that names any of these —
 * on any kind — is rejected as PIPELINE_OWNED_FIELD (checked before the allowlist
 * so the reason is precise). Substring match on a lowercased field path.
 */
const PIPELINE_OWNED_MARKERS: readonly string[] = [
  'sensitivity_score',
  'elasticity',
  'e_value',
  'e-values',
  'robustness',
  'flip_threshold',
  'flip_thresholds',
  'confidence_tier',
  'inference_warnings',
];

/**
 * Pipeline-recomputed / pipeline-review stamps (G10-adjacent, matched on the
 * field's ROOT segment — exact, not substring, so e.g. a hypothetical
 * `origin_label` would not be swept in accidentally):
 *  - `provenance` / `provenance_display` — RESPONSE-ONLY, recomputed by
 *    `transformResponseToV3` on every response;
 *  - `validation` — two-pass parameter-review pipeline metadata (edges);
 *  - `defaulted` — CIL default-strength flag (edges);
 *  - `origin` — creation-source stamp (edges).
 */
const CEE_ANALYSIS_OWNED_ROOTS: readonly string[] = [
  'provenance',
  'provenance_display',
  'validation',
  'defaulted',
  'origin',
  // Extraction-provenance stamps (review hardening, 2026-07-07): these mark
  // HOW a value entered the model and must never be producer-writable —
  // relabelling an AI-invented value as user-extracted is a provenance
  // integrity breach.
  'source',
  'extractiontype',
  'raw_value',
];

/**
 * ⚠ UNION SEMANTICS, AND THE DIRECTION IS LOAD-BEARING (A6; the schemas
 * package's `provenanceOwnedSegments()` docstring mandates exactly this).
 *
 *   CEE_OWNED = CEE_ANALYSIS_OWNED_ROOTS ∪ provenanceOwnedSegments()
 *
 * The two sets are NOT equal and are not meant to be. CEE owns
 * analysis-derived stamps (`validation`, `defaulted`, `origin`,
 * `provenance_display`) that have no human setter and therefore NO row in the
 * table; the table owns human-facing provenance the referee did not yet deny.
 * A consumer that INTERSECTED — or that REPLACED this list with the derived
 * one — would silently un-deny every stamp the table does not happen to name,
 * a provenance breach introduced by an operation that reads like a tidy-up.
 * This set may WIDEN; it may NEVER NARROW. Pinned both ways in
 * `field-parity-derivation.test.ts`.
 *
 * ⚠ RULING J2 — DELIBERATE BEHAVIOUR CHANGE (orchestrator, 5 Aug 2026). The
 * union adds `threshold_source` (who set the goal threshold — same class as
 * `observed_state.source`) and the four edge provenance stamps
 * (`weightSource`, `directionSource`, `strengthStdSource`,
 * `beliefExistsSource`). Before this change `threshold_source` was screened
 * only by the ROOT allowlist, which means:
 *   (a) a candidate naming it directly was refused with the VAGUER
 *       FIELD_NOT_ALLOWED, and is now refused with PIPELINE_OWNED_FIELD;
 *   (b) a candidate carrying it as a SEGMENT of an allowed root
 *       (`goal_constraints.threshold_source`) or INSIDE an object payload was
 *       **ACCEPTED**, and is now refused.
 * (b) is the substantive change: a previously-settable provenance stamp is
 * now unsettable by any producer. Pinned RED-first in
 * `threshold-source-j2.test.ts`.
 */
export const PIPELINE_OWNED_ROOTS: ReadonlySet<string> = new Set([
  ...CEE_ANALYSIS_OWNED_ROOTS,
  ...provenanceOwnedSegments(),
]);

/** The CEE-local half of the union, exported so the direction rule (this set is
 *  a SUBSET of the union, always) is assertable rather than assumed. */
export const CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST: readonly string[] = CEE_ANALYSIS_OWNED_ROOTS;


/** Conservative engine-claim patterns applied to every candidate string leaf (G14). */
const ENGINE_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bEVPI\b/i,
  /\bVOI\b/i,
  /flip[\s-]?point/i,
  /would\s+flip/i,
  /\bprobability\s+of\s+\d/i,
  /\b\d{1,3}(?:\.\d+)?\s?%\s+(?:likely|chance|probability|confiden)/i,
];

/**
 * Result carries a CODE only — never the offending field name or value. The raw
 * `field`/`to` strings are model-controlled payload values, so surfacing them (even
 * as a diagnostic `path`) would violate the §5 redaction contract; callers render a
 * fixed per-code message.
 */
export interface FieldSafetyResult {
  readonly ok: boolean;
  readonly code?: MutationReasonCode;
}

function isPipelineOwned(field: string): boolean {
  const f = field.toLowerCase();
  // Segment-wise (review hardening): the owned set is screened on EVERY path
  // segment, not just the root — `observed_state.provenance` and `data/origin`
  // are as owned as their bare spellings. Exact-segment match preserved (a
  // hypothetical `origin_label` still passes).
  if (f.split(/[./]/).some((seg) => PIPELINE_OWNED_ROOTS.has(seg))) return true;
  return PIPELINE_OWNED_MARKERS.some((m) => f.includes(m));
}

/** Depth-1 keys of an object value, lowercased (arrays and non-objects → empty). */
function ownKeysLower(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).map((k) => k.toLowerCase());
}

/**
 * ROADMAP 2.11 / P0-2 — the intervention CONTRACT keys, DERIVED from the
 * canonical Zod schema (`InterventionV3.shape`, trap-12: derive, don't
 * mirror) plus `cap` (the edit prompt's DERIVED-FIELD RULE instructs
 * "Include value, raw_value, unit, and cap"; the option-intervention
 * encoder reads `cap` to normalise, and InterventionV3 passes it through).
 *
 * Why: an option-configure edit ("the raise price option should reduce
 * marketing spend to £25k") lands as `update_node` at
 * `data/interventions/<factor_id>` with an object payload carrying
 * `raw_value` — which is ALSO a pipeline-owned extraction-provenance root
 * on nodes. The smuggle guard read the payload keys context-free and
 * REJECTED the whole sanctioned configure vocabulary (PIPELINE_OWNED_FIELD),
 * so the one chat path that writes option interventions was dead on
 * arrival. Inside the interventions subtree these keys belong to the
 * intervention contract, not to node provenance — exempt exactly the
 * schema-derived set, exactly there. Everywhere else the screen is
 * unchanged.
 */
export const INTERVENTION_CONTRACT_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(InterventionV3.shape).map((k) => k.toLowerCase()),
  'cap',
]);

/**
 * THE INTERVENTION SPEC SCREEN — the contract's KEYS **and its TYPES**, both
 * derived from `InterventionV3.shape`.
 *
 * ⚠ AN EARLIER VERSION OF THIS MODULE SCREENED KEYS ONLY, and said "the key set
 * is what the contract can enforce here". That was FALSE and the correction is
 * recorded because the reasoning is the interesting part. `InterventionV3` is
 * `.passthrough()` with `value` and `target_match` REQUIRED, so
 * `InterventionV3.parse` genuinely cannot be used: it would accept every
 * smuggled key (passthrough) AND reject the live option-configure write, which
 * carries only `value` / `raw_value` / `unit` / `cap`. But "parse or key set"
 * was a false pair. Rebuilding the object from the SAME shape —
 * `.partial()` for the live partial write, `.strict()` for the smuggle —
 * yields the key set *plus* the types, from one derivation, with no mirror.
 *
 * What the types buy, measured: below the spec level the walk stops (a spec's
 * values are contract-typed data whose keys are free-form — `encoding_map`'s
 * keys are raw category labels, one could legitimately be "source"). A
 * key-set-only screen therefore let an OBJECT ride in any scalar contract slot:
 * `interventions.<id>.value = { extractionType: 'x' }` passed. Every scalar and
 * enum slot is now type-checked, so those positions are closed by the contract
 * itself rather than by a second walk.
 *
 * `cap` is `z.unknown()` ON PURPOSE. `InterventionV3` does not declare it — it
 * comes from the edit prompt's DERIVED-FIELD RULE and rides the schema's
 * passthrough — so the contract states no type for it and this screen invents
 * none. A key-only rule for a key-only contract.
 *
 * ⚠ `target_match` stays a PASSTHROUGH object in the contract, so the one
 * remaining below-spec position is `target_match.*`. Zero readers (the option
 * encoder reads `value`/`raw_value`/`unit`/`cap`/`encoding_map`; the provenance
 * pill reads NODE-level fields), so blast radius is zero by construction —
 * recorded here rather than left to be rediscovered, and pinned by a test.
 */
const InterventionSpecScreen = z
  .object(InterventionV3.shape)
  .partial()
  .extend({ cap: z.unknown().optional() })
  .strict();

/**
 * Where in the interventions grammar a payload sits. The interventions subtree
 * has THREE distinct levels and each has a different rule — reading the payload
 * context-free (one flat key set, as the pre-2.478 guard did) cannot tell them
 * apart, which is exactly how the tunnel opened:
 *
 *   `outside`    — ordinary node/edge payload. Every key at every depth is
 *                  screened against the pipeline-owned set.
 *   `factor_map` — the value of an `interventions` key: its keys are FACTOR
 *                  IDS, not field names, so they are never screened as
 *                  vocabulary (a factor literally named `source` is data, not
 *                  a provenance stamp). Each value is an intervention SPEC.
 *   `spec`       — one `InterventionV3` payload: every key must be an
 *                  intervention CONTRACT key, derived from `InterventionV3.shape`.
 *
 * ⚠ WHY A KEY-SET SCREEN AND NOT `InterventionV3.parse`. `InterventionV3` is
 * `.passthrough()` and its `source`/`target_match` are REQUIRED, so parsing a
 * payload against it would (a) accept every smuggled key anyway — a screen that
 * cannot fail — and (b) reject the live option-configure write, which carries
 * only `value` / `raw_value` / `unit` / `cap` (the edit prompt's DERIVED-FIELD
 * RULE). The KEY SET is what the contract can enforce here, and it is derived
 * from the schema's own `.shape`, never mirrored.
 */
type PayloadContext = 'outside' | 'factor_map' | 'spec';

/**
 * The key whose VALUE is the factor map — the one boundary where the screen
 * stops treating keys as vocabulary. Named once so the screen above and the
 * STRIP below cannot drift about where the interventions grammar begins
 * (trap 12: the two would otherwise be a hand-maintained pair).
 */
const INTERVENTIONS_KEY = 'interventions';

/**
 * RECURSIVE payload screen (ROADMAP 2.478 + the intervention-tunnel
 * obligation). Walks a payload VALUE carrying its grammar context, so a
 * provenance stamp is caught at ANY depth and the interventions subtree is
 * screened against its own contract instead of being skipped wholesale.
 *
 * Fail-closed, first-failure-wins, total (never throws). Below the `spec`
 * level the walk STOPS: a spec's values are `InterventionV3`-typed data whose
 * own keys are free-form (`encoding_map`'s keys are raw category labels — one
 * could legitimately be the string "source"), so screening them as vocabulary
 * would be a false rejection. Those positions have no reader (the option
 * encoder reads `value`/`raw_value`/`unit`/`cap`/`encoding_map`; the provenance
 * pill reads NODE-level fields), so the residual is zero-blast-radius by
 * construction — recorded here rather than left to be rediscovered.
 */
function screenPayload(value: unknown, ctx: PayloadContext): FieldSafetyResult {
  if (Array.isArray(value)) {
    for (const el of value) {
      const r = screenPayload(el, ctx);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (value === null || typeof value !== 'object') return { ok: true };

  const entries = Object.entries(value as Record<string, unknown>);

  if (ctx === 'spec') {
    if (InterventionSpecScreen.safeParse(value).success) return { ok: true };
    // Reason precision, and NO regression on it: an owned name here was already
    // refused as PIPELINE_OWNED_FIELD before the contract screen existed (the
    // flat guard's exemption did not cover it), so it keeps that code. Anything
    // else the screen refuses — an unknown key, or a contract key given the
    // wrong TYPE — gets FIELD_NOT_ALLOWED, which is the honest reason for it.
    for (const [k] of entries) {
      const lower = k.toLowerCase();
      if (!INTERVENTION_CONTRACT_KEYS.has(lower) && PIPELINE_OWNED_ROOTS.has(lower)) {
        return { ok: false, code: PIPELINE_OWNED_FIELD };
      }
    }
    return { ok: false, code: FIELD_NOT_ALLOWED };
  }

  if (ctx === 'factor_map') {
    // Keys are factor ids — data, never vocabulary. Each value is a spec.
    for (const [, v] of entries) {
      const r = screenPayload(v, 'spec');
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  for (const [k, v] of entries) {
    const lower = k.toLowerCase();
    if (PIPELINE_OWNED_ROOTS.has(lower)) return { ok: false, code: PIPELINE_OWNED_FIELD };
    const r = screenPayload(v, lower === INTERVENTIONS_KEY ? 'factor_map' : 'outside');
    if (!r.ok) return r;
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// ⭐ STRIP THE PIPELINE-OWNED KEY, DO NOT REFUSE THE ADD (2026-09-17).
//
// WITNESSED ON A REAL USER SESSION. The user spent three turns agreeing with
// the product that a team-morale risk was real and unrepresented, then said
// "Update the model to reflect all of this, then." CEE's logs, one turn:
//
//   edit_graph.structural_edge_enforced   x3   option -> fac_morale(factor)
//   v5.candidate_mutation.rejected  add_node  PIPELINE_OWNED_FIELD  governing: TRUE
//   v5.candidate_mutation.rejected  add_edge  ENTITY_NOT_FOUND      governing: false  x4
//
// The product built EXACTLY the right change. The `add_node` was refused
// because its value carried a pipeline-owned field; the four edge rejections
// are that one refusal's ECHO — `advanceBatchGraph` never materialises a
// REJECTED add, so every edge referencing the new node failed R3 referential
// integrity against a graph the node never entered. One rejection governs the
// batch, so the user was told the model was unchanged.
//
// ⭐ AND OUR OWN PROMPT ASKS FOR THE FORBIDDEN FIELDS. The served `edit_graph`
// prompt tells the model to "Mirror the nearest comparable existing node
// shape" and invites `provenance` / `raw_value`; `orchestrator/context/
// budget.ts` drops `source` from the model-visible graph ONLY under token
// pressure, so in the ordinary case the model SEES `source` on the comparable
// nodes it is told to mirror. We ask for the field and then refuse the whole
// candidate for supplying it.
//
// WHY STRIPPING IS THE RIGHT ANSWER AND NOT A WEAKENING. These keys were never
// the producer's to set: `PIPELINE_OWNED_ROOTS` is precisely the set CEE
// RECOMPUTES or owns, so the pipeline would overwrite or ignore whatever the
// model wrote. Dropping them therefore loses NOTHING a consumer would have
// honoured — while refusing loses the user's entire edit. The forgeable-
// provenance hole ROADMAP 2.478 closed stays closed, because the key is gone
// from the op the APPLIER runs, not merely from the copy the referee screens.
//
// PRECEDENT, not invention — three live rewrite-rather-than-refuse seams:
//   · `edit-graph.ts` `sanitiseOperations` — deletes LEGACY_FIELDS from op
//     values and logs a count (the same seam this composes into);
//   · `canonicalise-value-ops.ts` — `delete nextObserved.raw_value` when the
//     scale is unrecoverable ("never leave the stale claim standing");
//   · `orchestrator/context/budget.ts` — strips `extractionType` /
//     `raw_value` / `source` from the model-visible graph.
//
// WHY IT LIVES HERE, beside the screen rather than in the edit pipeline: the
// strip must remove EXACTLY what `screenPayload` refuses. Co-locating them on
// one traversal and one constant is the only way to guarantee that without a
// hand-maintained second opinion about the owned set (trap 12). If a key is
// added to `PIPELINE_OWNED_ROOTS`, the screen and the strip move together.
//
// SCOPE — stated precisely, and each exclusion is pinned by a test:
//   (1) `add_node` ONLY. Updates keep refusing: an update names a field the
//       user can see, so a silent rewrite there would change the meaning of an
//       edit the user asked for. An ADD is a fresh entity — nothing is
//       overwritten and nothing the user can see is lost.
//   (2) The `outside` grammar context ONLY. Inside the interventions subtree
//       `raw_value` / `source` / `cap` are InterventionV3 CONTRACT keys that
//       the screen ACCEPTS (ROADMAP 2.11), and a factor map's keys are factor
//       IDS, not vocabulary. The strip stops exactly where the screen stops
//       treating keys as vocabulary, so the sanctioned option-configure write
//       is untouched.
//   (3) Only keys in `PIPELINE_OWNED_ROOTS`. `PIPELINE_OWNED_MARKERS` (the
//       substring list) and the root allowlist are deliberately NOT applied to
//       adds today; this change does not start applying them, and every other
//       refusal reason — FIELD_NOT_ALLOWED, ENGINE_CLAIM_IN_TEXT — survives
//       unchanged. A genuinely invalid add is still refused.
// ---------------------------------------------------------------------------

/**
 * ⛔⛔ `raw_value` IS THE ONE MEMBER OF THE OWNED SET THAT IS DATA, NOT A STAMP —
 * AND STRIPPING IT WOULD BE A WORSE DISHONESTY THAN THE REFUSAL THIS FIXES.
 *
 * It sits in `CEE_ANALYSIS_OWNED_ROOTS` under a comment that reads:
 *
 *     "Extraction-provenance stamps: these mark HOW a value entered the model
 *      ... relabelling an AI-invented value as user-extracted is a provenance
 *      integrity breach."
 *
 * That rationale is exactly right for its neighbours `source` and
 * `extractiontype`, which are CLAIMS ABOUT a value. It does not hold for
 * `raw_value`, which IS the value — the NATIVE MAGNITUDE, the thing that lets
 * a factor read "£80,000" instead of "0.8". Three concepts were grouped under
 * one comment and one list; this is trap 21 at list granularity.
 *
 * DERIVED AT THE BYTES, and each of these is why the exemption exists:
 *  1. `ObservedStateV3` DECLARES it — `raw_value: z.number().optional()`
 *     (`schemas/cee-v3.ts:130`). It is first-class data that SURVIVES the
 *     GraphV3 re-parse, not an unknown key the schema would drop anyway.
 *  2. NOTHING RE-DERIVES IT ON AN ADD. Every `raw_value`-writing path in
 *     `canonicalise-value-ops.ts` is gated `op.op !== 'update_node'` (all four
 *     of them). On an `add_node` there is no prior value to recompute from, so
 *     a stripped magnitude is gone with NO recovery path.
 *  3. IT IS READ EVERYWHERE — 745 non-test references in `src/`, against a
 *     same-family contrast control (`observed_state`) of 684 and a negative
 *     control of 0, so the sweep discriminates. The canonical formatter reads
 *     `raw_value` FIRST.
 *  4. THE ESTATE HAS ALREADY RULED ON THIS COLLISION ONCE: ROADMAP 2.11
 *     exempted `raw_value` inside the interventions subtree for precisely this
 *     reason — there it is contract DATA, and screening it context-free killed
 *     the one chat path that writes option interventions.
 *
 * So: a user who says "add a factor for hiring cost, it's £80,000" must not
 * have that £80,000 deleted on the way in. TODAY such an add is REFUSED, which
 * is visible and honest. Stripping would make it land silently WITHOUT the
 * magnitude — trading a visible refusal for an invisible data loss, which is
 * the exact failure class this change exists to end.
 *
 * ⚠ THIS NARROWS THE FIX AND THAT IS DELIBERATE. An `add_node` carrying
 * `observed_state.raw_value` STILL refuses, and the served prompt's
 * DERIVED-FIELD RULE ("Include value, raw_value, unit, and cap") means that
 * will keep happening. Whether `raw_value` should be GRANTED on adds is a
 * change to what the referee permits — a provenance-contract decision with its
 * own owner — and is reported as a finding rather than taken here.
 */
const STRIP_EXEMPT_ROOTS: ReadonlySet<string> = new Set<string>(['raw_value']);

/**
 * What the strip may remove: the owned set MINUS the value-bearing exemption,
 * DERIVED by set difference so it tracks `PIPELINE_OWNED_ROOTS` as that set
 * widens (it may never narrow). A NEW member is strippable by default, which
 * is why `strip-pipeline-owned-add-node.test.ts` also PINS the exempt set —
 * derivation proves the copies agree, only a pinned corpus notices the list
 * changed and forces the stamp-or-data question to be asked again (trap 12d).
 */
const STRIPPABLE_OWNED_ROOTS: ReadonlySet<string> = new Set<string>(
  [...PIPELINE_OWNED_ROOTS].filter((root) => !STRIP_EXEMPT_ROOTS.has(root)),
);

/** Exposed so the pin above is assertable rather than assumed. */
export const STRIP_EXEMPT_ROOTS_FOR_TEST: readonly string[] = [...STRIP_EXEMPT_ROOTS];
export const STRIPPABLE_OWNED_ROOTS_FOR_TEST: readonly string[] = [...STRIPPABLE_OWNED_ROOTS];

/**
 * Segments that carry NO model-authored content, so they may be named in a
 * disclosure. DERIVED from the sets this module already owns — never a second
 * hand-kept vocabulary. Anything outside it is masked to `*`, the same
 * treatment `canonicalise-value-ops.ts`'s `describeKeyShape` gives a
 * model-controlled op key.
 */
const DISCLOSABLE_KEY_SEGMENTS: ReadonlySet<string> = new Set<string>([
  ...PIPELINE_OWNED_ROOTS,
  ...ALLOWED_OBSERVED_SUBKEYS,
  ...ALLOWED_NODE_FIELD_ROOTS,
  ...ALLOWED_EDGE_FIELD_ROOTS,
  ...INTERVENTION_CONTRACT_KEYS,
  INTERVENTIONS_KEY,
  'observed_state',
  'data',
]);

/**
 * Mask a stripped key's PATH down to its structural shape for logging.
 *
 * ⚠ THE §5 REDACTION CONTRACT IS NOT BREACHED BY NAMING THE OWNED SEGMENT.
 * `FieldSafetyResult` carries a code only because the refused `field` / `to`
 * strings are MODEL-CONTROLLED and could hold user content. A segment that
 * matched `PIPELINE_OWNED_ROOTS` is by construction one of a CLOSED, CEE-OWNED
 * vocabulary — it carries no model content, which is exactly the property that
 * makes `describeKeyShape` safe. Every other segment is masked.
 */
function describeStrippedKeyShape(path: readonly string[]): string {
  if (path.length === 0) return '*';
  return path.map((seg) => (DISCLOSABLE_KEY_SEGMENTS.has(seg) ? seg : '*')).join('/');
}

/**
 * Remove every `PIPELINE_OWNED_ROOTS` key from an add value, walking the SAME
 * structure `screenPayload` walks in the `outside` context and stopping where
 * it stops. Returns the input BY REFERENCE when nothing was removed, so an add
 * with nothing to strip projects a byte-identical op.
 */
function stripOutside(value: unknown, path: readonly string[], out: string[]): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((el) => {
      const r = stripOutside(el, path, out);
      if (r !== el) changed = true;
      return r;
    });
    return changed ? next : value;
  }
  if (value === null || typeof value !== 'object') return value;

  const next: Record<string, unknown> = {};
  let changed = false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    // ⛔ `STRIPPABLE_OWNED_ROOTS`, not `PIPELINE_OWNED_ROOTS`: `raw_value` is
    // the native magnitude and is NEVER stripped — see STRIP_EXEMPT_ROOTS. An
    // add carrying it keeps refusing, visibly, rather than landing without the
    // user's number.
    if (STRIPPABLE_OWNED_ROOTS.has(lower)) {
      out.push(describeStrippedKeyShape([...path, lower]));
      changed = true;
      continue;
    }
    // ⭐ THE WALK STOPS AT THE FACTOR MAP, exactly as the screen does. Below
    // this key the names are factor IDS and then InterventionV3 CONTRACT keys
    // — `raw_value` there is the option-configure vocabulary, not a provenance
    // stamp, and the screen accepts it. Descending would destroy the one chat
    // path that writes option interventions (the defect ROADMAP 2.11 closed).
    const child = lower === INTERVENTIONS_KEY ? v : stripOutside(v, [...path, lower], out);
    if (child !== v) changed = true;
    next[k] = child;
  }
  return changed ? next : value;
}

/** The minimum an operation must expose to be screened here (no `PatchOperation` coupling). */
export interface AddNodeOperationLike {
  readonly op: string;
  readonly value?: unknown;
}

/** Operations with pipeline-owned keys removed from `add_node` values, plus what went. */
export interface PipelineOwnedStripResult<T extends AddNodeOperationLike> {
  readonly operations: T[];
  /** Redaction-safe shapes of the removed keys, de-duplicated and sorted. */
  readonly strippedKeyShapes: readonly string[];
}

/**
 * Strip pipeline-owned keys from every `add_node` operation's value, so the
 * referee's R4 screen accepts a candidate it would otherwise refuse WHOLE —
 * taking every edge that references the new node down with it.
 *
 * Pure and total: never throws, never mutates its inputs; an operation with
 * nothing to strip is returned BY REFERENCE.
 */
export function stripPipelineOwnedFromAddOperations<T extends AddNodeOperationLike>(
  operations: readonly T[],
): PipelineOwnedStripResult<T> {
  const shapes: string[] = [];
  const out = operations.map((op) => {
    if (op.op !== 'add_node') return op;
    if (op.value === null || typeof op.value !== 'object' || Array.isArray(op.value)) return op;
    const stripped = stripOutside(op.value, [], shapes);
    return stripped === op.value ? op : { ...op, value: stripped };
  });
  return {
    operations: shapes.length === 0 ? [...operations] : out,
    strippedKeyShapes: [...new Set(shapes)].sort(),
  };
}

/**
 * The grammar context the PAYLOAD of an update op sits in, derived from the
 * op's FIELD PATH. `data/interventions/<factor_id>` means the payload IS a
 * spec; `observed_state.interventions` means it is a factor map; a bare root
 * means the walk discovers any `interventions` key itself.
 *
 * Returns `null` when the path reaches BELOW a spec (`.../interventions/<fid>/
 * value`): the payload is then one contract field's VALUE and there is no key
 * vocabulary to screen — but the path segment naming that field is checked by
 * the caller, so a path into a NON-contract key is still refused.
 */
function payloadContextForField(segs: readonly string[]): PayloadContext | null {
  const i = segs.indexOf('interventions');
  if (i === -1) return 'outside';
  const after = segs.length - 1 - i;
  if (after === 0) return 'factor_map';
  if (after === 1) return 'spec';
  return null;
}

/**
 * Depth-1 subtree rule for observed_state/data field paths, the
 * intervention-contract screen on the PATH, and the recursive payload screen.
 */
function checkObservedSubtree(field: string, payloadValue: unknown): FieldSafetyResult {
  const segs = field.toLowerCase().split(/[./]/).filter((s) => s.length > 0);
  const root = segs[0];
  const isObserved = root === 'observed_state' || root === 'data';
  if (isObserved && segs.length > 1 && !ALLOWED_OBSERVED_SUBKEYS.has(segs[1]!)) {
    return { ok: false, code: FIELD_NOT_ALLOWED };
  }

  const ctx = payloadContextForField(segs);
  if (ctx === null) {
    // The path descends INTO a spec: the segment after the factor id must be an
    // intervention contract key (`data/interventions/f-1/observed_state` is a
    // path-level twin of the payload-level smuggle and is refused here).
    const i = segs.indexOf('interventions');
    const specKey = segs[i + 2];
    if (specKey !== undefined && !INTERVENTION_CONTRACT_KEYS.has(specKey)) {
      return { ok: false, code: FIELD_NOT_ALLOWED };
    }
    return { ok: true };
  }

  const screened = screenPayload(payloadValue, ctx);
  if (!screened.ok) return screened;

  if (isObserved && segs.length === 1) {
    for (const k of ownKeysLower(payloadValue)) {
      // depth-1 keys of a whole-object write must be tunable sub-keys;
      // deeper keys (inside interventions maps) are factor ids — allow.
      if (!ALLOWED_OBSERVED_SUBKEYS.has(k)) {
        return { ok: false, code: FIELD_NOT_ALLOWED };
      }
    }
  }
  return { ok: true };
}

function scanText(text: unknown): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return ENGINE_CLAIM_PATTERNS.some((re) => re.test(text));
}

/**
 * Collect every string leaf in an arbitrary value (payload). Total; bounded by the
 * envelope schema (already parsed + capped). Ids are collected too but never match
 * the engine-claim patterns, so scanning them is harmless.
 */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const el of value) collectStrings(el, out);
  } else if (value !== null && typeof value === 'object') {
    for (const el of Object.values(value)) collectStrings(el, out);
  }
}

/**
 * R4 field-safety for a parsed envelope. Returns the first failure (fail-closed,
 * first-failure-wins) or `{ ok: true }`.
 */
export function checkFieldSafety(envelope: CandidateMutationEnvelope): FieldSafetyResult {
  // (a) field allowlist / pipeline-owned guard for the two field-edit kinds.
  //     Pipeline-owned is screened on the FULL path (a nested
  //     `data/sensitivity_score` is still pipeline-owned); the allowlist is
  //     evaluated on the ROOT segment (a sanctioned root sanctions its
  //     sub-paths in every producer spelling: bare, slash-keyed, dotted).
  if (envelope.kind === 'update_node_field') {
    const field = envelope.payload.field;
    if (isPipelineOwned(field)) return { ok: false, code: PIPELINE_OWNED_FIELD };
    if (!ALLOWED_NODE_FIELD_ROOTS.has(fieldRootOf(field))) {
      return { ok: false, code: FIELD_NOT_ALLOWED };
    }
    const sub = checkObservedSubtree(field, envelope.payload.to);
    if (!sub.ok) return sub;
  } else if (envelope.kind === 'update_edge_field') {
    const field = envelope.payload.field;
    if (isPipelineOwned(field)) return { ok: false, code: PIPELINE_OWNED_FIELD };
    if (!ALLOWED_EDGE_FIELD_ROOTS.has(fieldRootOf(field))) {
      return { ok: false, code: FIELD_NOT_ALLOWED };
    }
    const sub = checkObservedSubtree(field, envelope.payload.to);
    if (!sub.ok) return sub;
  } else if (envelope.kind === 'add_node') {
    // ROADMAP 2.478 — THE NODE ADD PATH IS SCREENED, RECURSIVELY.
    //
    // Before this, `checkFieldSafety` screened only the two UPDATE kinds. The
    // producer projects an `add_node` op down to `{id, kind, label}` for the
    // envelope, so every OTHER key on the add value — `observed_state.source`,
    // `extractionType`, a stamp buried two objects deep — reached the applier
    // with nothing in between: a producer could mint a NEW node already
    // labelled "user-extracted". That is the forgeable-provenance hole under
    // the whole P4 provenance track.
    //
    // `screened_value` carries the add op's NON-IDENTITY value keys for this
    // check and this check only — no builder, applier or candidate path reads
    // it (pinned in add-path-recursive-screen.test.ts).
    //
    // SCOPE, stated precisely — TWO deliberate exclusions, both measured:
    //
    // (1) NOT the root allowlist. The screen denies the pipeline-owned set at
    //     any depth and enforces the intervention contract; it does not require
    //     add-value keys to be allowlisted roots. An add creates a FRESH entity
    //     with no sibling to desync from (the `invariant_coupled` argument is
    //     about moving one member of a quad while the others stay), and
    //     imposing the allowlist would revoke live add shapes the referee has
    //     always accepted. The Option-A tool schema is stricter on adds, which
    //     is the sanctioned direction: the tool may be narrower than the
    //     referee, never wider.
    //
    // (2) NOT `add_edge` — FOR THIS CHECK ONLY, and a NAMED RESIDUAL rather
    //     than an oversight. ⚠ Say it precisely: `add_edge` is unscreened by
    //     check (a). Check (b), the G14 engine-claim scan below, DOES see the
    //     edge add value from this commit on, because `screened_value` is part
    //     of the payload it walks. "add_edge is deliberately unscreened",
    //     unqualified, is wrong — see add-value-engine-claim-scan.test.ts.
    //     Applying THIS
    //     screen to edge adds REVOKES A LIVE CAPABILITY, measured: the
    //     deterministic add-option transaction
    //     (`routing/add-option-transaction.ts:179-186`) builds every structural
    //     edge with `provenance: { source: 'user_specified' }` — the edge's
    //     creation-source DECLARATION, written by CEE's own chip-driven
    //     constructor after a user action, not by a model. The referee cannot
    //     currently tell the two apart: `edit-graph-producer.ts` stamps
    //     `provenance.source = 'edit_graph_llm'` on EVERY envelope it emits,
    //     including deterministic chip transactions, so there is no producer
    //     identity to key the exemption on. Screening edge adds therefore needs
    //     either that identity or an `EdgeProvenanceV3`-derived context rule of
    //     the same shape as the interventions one — a separate slice, rowed.
    //     The producer still CARRIES `screened_value` for add_edge so that
    //     slice has the payload; today nothing reads it, and
    //     `add-path-recursive-screen.test.ts` pins that fact so the gap is
    //     visible rather than assumed closed.
    const screened = screenPayload(envelope.payload.screened_value, 'outside');
    if (!screened.ok) return screened;
  }

  // (b) engine-claim scan on ALL free text (G14 "any free text"): every string leaf in
  //     the payload — labels, descriptions, questions, reasons, update `from`/`to`
  //     values — PLUS the provenance rationale. A claim must not ride in as a label or
  //     any other string field, not just as narrative prose.
  const texts: string[] = [];
  collectStrings(envelope.payload, texts);
  if (typeof envelope.provenance.rationale === 'string') texts.push(envelope.provenance.rationale);
  for (const t of texts) {
    if (scanText(t)) return { ok: false, code: ENGINE_CLAIM_IN_TEXT };
  }

  return { ok: true };
}
