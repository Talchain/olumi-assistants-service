/**
 * S3 §5 / Lane C3 — add-option compound transaction builder (PURE).
 *
 * THE GAP THIS CLOSES. Today an add-option journey is TWO turns: a structural
 * add (edit_graph LLM emits `add_node`(option) + `add_edge`s → held
 * `STRUCTURAL_APPLY_HELD` → confirm applies the option with `interventions:null`)
 * and, separately, a configure turn that writes the effect values. Between them
 * the option is analysis-poison (PLoT 422 `options_not_configured`) — debit (a),
 * the interventions=null poison gap (R-3 probe,
 * acceptance-evidence/s2s3-p0-addoption-probe-2026-07-22/).
 *
 * This module turns a typed `add_option` intent (`chip.intent='add_option'`,
 * @talchain/schemas 0.22.0) carrying a pre-resolved spec in `chip.parameters`
 * into ONE atomic `PatchOperation[]` — the option node + the parent-decision
 * edge + one option->factor edge per configured factor + the per-factor effect
 * VALUES — so the whole option lands configured (or is honestly disclosed as
 * unconfigured) in a SINGLE held proposal. The intervention values ride INSIDE
 * the `add_node` op's node value in the canonical top-level `interventions`
 * spelling.
 *
 * WHY THIS BUILDS ON THE LIVE add_node/add_edge CHAIN, NOT the `add_option`
 * referee case (R-3, trap-16). The dedicated `add_option` referee case
 * (referee.ts) is ALWAYS-held and has ZERO live producers (probe-confirmed on
 * the wire) — a dead branch. The LIVE producer is the generic structural hold
 * (`add_node`/`add_edge` → `STRUCTURAL_APPLY_HELD`). These ops therefore route
 * through the SAME referee gate + `pending_actions` inline_patch +
 * `executeGmHeldResume` confirm/apply the free-text edit already uses — reuse,
 * not a new mechanism.
 *
 * WHY THE CANONICAL INTERVENTION SPELLING (load-bearing — the confirm apply is
 * deterministic). The confirm-side apply (`executeGmHeldResume`) does NOT run
 * the edit-lane encoders (`encodeOptionInterventionsForEdit`, `normalisePath`,
 * `enforceStructuralEdgeDefaults`). Its atomicity guard (`batchFullyLanded`)
 * refuses the WHOLE batch if any written field does not survive
 * `GraphV3.safeParse`. So this module writes:
 *  - interventions as a canonical top-level `node.interventions` record on the
 *    `add_node` value — `NodeV3.interventions` is a declared field GraphV3
 *    preserves, and `batchFullyLanded` verifies an `add_node` by node PRESENCE,
 *    so the bundle lands without depending on any encoder or on the held-lane
 *    value-op canonicaliser (which deliberately EXCLUDES interventions —
 *    `encodeOptionInterventionsForEdit` owns that subtree);
 *  - structural edges (decision->option, option->factor) with the shared
 *    `STRUCTURAL_EDGE_DEFAULTS` (topology, strength 1.0), since the confirm path
 *    does not run `enforceStructuralEdgeDefaults`.
 *
 * PURE + TOTAL + FAIL-SAFE. Any missing/malformed/unresolved input (absent
 * graph, parent that is not a decision, a target that is not a factor, an id
 * collision on a producer-supplied id) resolves to `{ matched: false, reason }`
 * — the caller then falls through BENIGNLY to the existing free-text/LLM path.
 * Never throws; never mutates its inputs.
 *
 * UNVALUED LINKS (add-option text leg, 1 Sep 2026). An intervention spec may
 * carry `value: null`, meaning "this option changes this factor; the size of
 * the effect is not stated". The builder then emits the option->factor
 * structural edge but writes NO entry into the option's `interventions`
 * bundle — so the option reads back as `needs_encoding` ("Connected to N
 * factor(s); awaiting effect value(s)", `cee/transforms/option-status.ts`),
 * an explicit unknown the readiness intake asks the user to fill, never a
 * number anyone invented. `configured` stays "at least one VALUED link".
 */

/**
 * ⚠ CARRY-FORWARD, SCOPED HONESTLY AND NOT CHASED: A MIXED INTERVENTION SPEC.
 *
 * The `value: null` widening this path relies on also serves the DEPLOYED CHIP
 * leg, and a MIXED spec there — some interventions valued, some null — would
 * emit two contradictory sentences, with the false one ("the analysis can run")
 * honoured, because `option-status.ts` guards its connected-but-numberless limb
 * on `interventionCount === 0` rather than on "every value is null".
 *
 * WHAT I MEASURED, AND WHAT I DID NOT:
 *   · The FOCUSED path cannot produce it. `propose-add-option.ts` types its
 *     interventions as `{ factor_id, value: null }` and pushes `value: null`
 *     unconditionally — a mixed spec is unreachable from this PR's path by
 *     construction, not by convention.
 *   · A sweep of `src/` found NO CEE producer emitting a mixed spec, with a
 *     contrast control confirming the sweep sees valued interventions where
 *     they exist.
 *   · ⚠ THE UI SIBLING IS UNSWEPT. I did not look, and this claim says nothing
 *     about it. Reported rather than chased, per scope.
 */
import { z } from 'zod';

import { DEFAULT_EXISTS_PROBABILITY, STRENGTH_DEFAULT_SIGNATURE } from '@talchain/schemas';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../orchestrator/context/constants.js';
import { normaliseIdBase } from '../../cee/utils/id-normalizer.js';
import { InterventionV3 } from '../../schemas/cee-v3.js';
import type { PatchOperation } from '../../orchestrator/types.js';

/**
 * The minimal graph view the builder needs to VALIDATE the spec before
 * synthesising a proposal (so it never emits a doomed one). Matches the
 * `GraphStateIngress` leaf shape route-v2 already holds.
 */
export interface AddOptionGraphView {
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly label?: string;
    /** A factor's category — which factors a NEW factor may point at depends on it. */
    readonly category?: string;
    /** An option's levels (`NodeV3.interventions`), read only to refuse a second option with the SAME levels. */
    readonly interventions?: unknown;
  }>;
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

/**
 * CEE-SIDE INGRESS CONTRACT for `chip.parameters` on a typed `add_option`
 * intent (the CEE-side shape authority the UI producer, Lane U1, matches; the
 * schema keeps `parameters` an untyped `z.record`). `interventions` folds the
 * configure step into the add so the option lands analysable in ONE
 * transaction:
 *
 *   { parent_decision_id, label, option_id?,
 *     interventions: [ { factor_id, value | null, unit?, raw_value? } ] }
 *
 * `interventions` may be empty — the option is then added UNCONFIGURED and the
 * caller discloses that at proposal time (never a silent analysis-poison land).
 * A `value: null` entry links the factor WITHOUT a value (see the header).
 * Non-strict: producer-side keys (`chip_id`/`spark_id`) pass through harmlessly.
 */
/**
 * A GENUINELY-typed finite number. `z.number()` alone rejects a non-number
 * (a string `"140"`/`"one hundred and forty"` parse-FAILS — no coercion), but
 * still ADMITS `NaN`/`±Infinity`; this refinement rejects those too. No
 * `z.coerce`, no `.catch`, no clamping: a non-finite/non-number value fails the
 * parse, and the caller falls through with `fell_through` telemetry rather than
 * silently committing a coerced value (orchestrator directive, A2 live probe).
 */
const FiniteNumber = z
  .number()
  .refine((n) => Number.isFinite(n), { message: 'expected a finite number' });

const InterventionSpecSchema = z.object({
  factor_id: z.string().min(1),
  // `null` = link with UNKNOWN magnitude (edge only, no bundle entry). Any
  // non-null value must still be a genuinely finite number — no coercion.
  value: z.union([FiniteNumber, z.null()]),
  unit: z.string().min(1).optional(),
  // raw_value is deliberately polymorphic (categorical/boolean raw values keep
  // their original type); its NUMBER branch must still be finite.
  raw_value: z.union([FiniteNumber, z.string(), z.boolean()]).optional(),
  // C2 (#70 5844217159): WHOSE this level is. Absent = the user's (today's bytes). `cee_hypothesis` is Olumi's
  // estimate, the literal an adopted Olumi level already carries. Derived from the contract's own enum, never
  // restated; `brief_extraction` is the drafter's and never an Agent's. Typed, so any other value is
  // `parameters_invalid` — refused, never dropped and stamped as the user's.
  source: InterventionV3.shape.source.extract(['user_specified', 'cee_hypothesis']).optional(),
});

const AddOptionParamsSchema = z.object({
  parent_decision_id: z.string().min(1),
  label: z.string().min(1),
  option_id: z.string().min(1).optional(),
  interventions: z.array(InterventionSpecSchema).default([]),
});

export type AddOptionSkipReason =
  | 'no_parameters'
  | 'parameters_invalid'
  | 'no_graph'
  | 'parent_not_found'
  | 'parent_not_decision'
  | 'option_id_collision'
  | 'option_id_invalid'
  | 'factor_not_found'
  | 'factor_not_factor'
  | 'duplicate_factor'
  // The option would set exactly the levels an existing option sets: the engine cannot tell them apart
  // (PLoT `validation/identical-options.ts` calls it a validation error), and the run drops one silently.
  | 'same_levels_as_existing_option';

/** The existing option a refused one would duplicate, so the refusal names it. */
export interface SameLevelsAs {
  readonly id: string;
  readonly label: string;
}

export interface AddOptionProposal {
  readonly operations: PatchOperation[];
  readonly optionId: string;
  readonly optionLabel: string;
  /** True when the option lands with >=1 effect value (analysable on commit). */
  readonly configured: boolean;
  /** Factor ids that received an effect value (for the proposal-time receipt). */
  readonly configuredFactorIds: readonly string[];
  /** Factor ids linked WITHOUT a value (explicit unknown magnitude). */
  readonly linkedUnvaluedFactorIds: readonly string[];
}

export type AddOptionBuildResult =
  | { readonly matched: true; readonly proposal: AddOptionProposal }
  | { readonly matched: false; readonly reason: AddOptionSkipReason; readonly sameAs?: SameLevelsAs };

/**
 * (A) — the most options ONE typed transaction may add. Four options of up to
 * six factors each stay inside `TYPED_TRANSACTION_ENVELOPE_CAP` (4 × 8 = 32).
 */
export const MAX_OPTIONS_PER_TRANSACTION = 4;

/** Canonical id pattern (mirrors NodeV3/OptionV3 `id`). */
const CANONICAL_ID_RE = /^[a-z0-9_:-]+$/;

function fail(reason: AddOptionSkipReason): AddOptionBuildResult {
  return { matched: false, reason };
}

function findNode(
  graph: AddOptionGraphView,
  id: string,
): { id: string; kind: string; label?: string } | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function nodeIdExists(graph: AddOptionGraphView, id: string): boolean {
  return graph.nodes.some((n) => n.id === id);
}

/** PLoT's tolerance for "the same level" (`validation/identical-options.ts` EPSILON). */
const SAME_LEVEL_EPSILON = 1e-9;

/** An option's VALUED levels, factor id → value. A null or non-numeric entry is a link without a level, not a level. */
function levelsOf(raw: unknown): Map<string, number> {
  const levels = new Map<string, number>();
  if (raw === null || typeof raw !== 'object') return levels;
  for (const [factorId, entry] of Object.entries(raw as Record<string, unknown>)) {
    const value =
      typeof entry === 'number'
        ? entry
        : entry !== null && typeof entry === 'object' ? (entry as { value?: unknown }).value : undefined;
    if (typeof value === 'number' && Number.isFinite(value)) levels.set(factorId, value);
  }
  return levels;
}

/**
 * ⛔ A SECOND OPTION WITH THE SAME LEVELS IS NOT A NEW CHOICE (served DL browser run bf-20260926T101424Z turn 3:
 * "Test £54 versus £59 by customer cohort before rollout" set only `pro_plan_price` to the value "Raise Pro to £54"
 * already set; the run left it out with no warning and its card read "Not analysed"). Compared on the VALUED levels,
 * exactly as the engine compares them: same factors, each within PLoT's epsilon. An existing option's unsized link
 * does not tell it apart — the served "Raise Pro to £54" had one, and the run still dropped the duplicate. The caller
 * never compares a NEW option with no levels or an unsized link: it is added as today and readiness names what is missing.
 */
function existingOptionWithSameLevels(bundle: Record<string, unknown>, graph: AddOptionGraphView): SameLevelsAs | undefined {
  const mine = levelsOf(bundle);
  if (mine.size === 0) return undefined;
  for (const node of graph.nodes) {
    if (node.kind !== 'option') continue;
    const theirs = levelsOf(node.interventions);
    if (theirs.size !== mine.size) continue;
    let same = true;
    for (const [factorId, value] of mine) {
      const other = theirs.get(factorId);
      if (other === undefined || Math.abs(other - value) > SAME_LEVEL_EPSILON) { same = false; break; }
    }
    if (same) return { id: node.id, label: node.label ?? node.id };
  }
  return undefined;
}

/**
 * Derive a fresh, canonical, collision-free option id from the label
 * (`opt_<slug>`), suffixing `_2`, `_3`, ... on a collision. Reuses
 * `normaliseIdBase` (the production id normaliser) so the slug rule cannot
 * drift from the rest of the pipeline (trap-12).
 */
function deriveOptionId(label: string, graph: AddOptionGraphView): string {
  const base = `opt_${normaliseIdBase(label)}`;
  if (!nodeIdExists(graph, base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!nodeIdExists(graph, candidate)) return candidate;
  }
}

/**
 * A canonical structural edge (topology, not a causal belief): the shared
 * `STRUCTURAL_EDGE_DEFAULTS` (strength 1.0 / exists 1.0 / positive) plus a
 * truthful provenance — `user_specified` unless the link carries an Olumi
 * level (`cee_hypothesis`, DL #70 5845538501). Never `defaulted`: that flag
 * means a causal strength this system chose, and this edge has none. Full
 * canonical value because the confirm-side apply does not run
 * `enforceStructuralEdgeDefaults`.
 */
export function structuralEdgeValue(
  from: string,
  to: string,
  source: 'user_specified' | 'cee_hypothesis' = 'user_specified',
): Record<string, unknown> {
  return {
    from,
    to,
    ...STRUCTURAL_EDGE_DEFAULTS,
    provenance: { source },
  };
}

/**
 * Build the atomic add-option `PatchOperation[]` (or a classified skip) from a
 * typed `add_option` chip's parameters, validated against the current graph.
 *
 * Op ORDER is load-bearing: the `add_node`(option) MUST precede its edges so
 * the referee's intra-batch sequencing (`advanceBatchGraph`) sees the option
 * node when it referees each `add_edge`.
 *
 * @param parameters the chip's `parameters` bag (untyped `z.record` on the wire)
 * @param graph      the turn's graph (validation authority); null -> skip
 */
export function buildAddOptionTransaction(
  parameters: unknown,
  graph: AddOptionGraphView | null,
): AddOptionBuildResult {
  if (parameters == null || typeof parameters !== 'object') {
    return fail('no_parameters');
  }
  if (graph === null) {
    return fail('no_graph');
  }

  const parsed = AddOptionParamsSchema.safeParse(parameters);
  if (!parsed.success) return fail('parameters_invalid');
  const { parent_decision_id, label, option_id, interventions } = parsed.data;

  // Parent must resolve to a DECISION node (an option hangs off a decision).
  const parent = findNode(graph, parent_decision_id);
  if (parent === undefined) return fail('parent_not_found');
  if (parent.kind !== 'decision') return fail('parent_not_decision');

  // Resolve the option id: a producer-supplied id must be canonical AND free;
  // otherwise derive a fresh collision-free one from the label.
  let optionId: string;
  if (option_id !== undefined) {
    if (!CANONICAL_ID_RE.test(option_id)) return fail('option_id_invalid');
    if (nodeIdExists(graph, option_id)) return fail('option_id_collision');
    optionId = option_id;
  } else {
    optionId = deriveOptionId(label, graph);
  }

  // Every target factor must resolve to a FACTOR node, and no factor twice.
  const seenFactors = new Set<string>();
  for (const iv of interventions) {
    if (seenFactors.has(iv.factor_id)) return fail('duplicate_factor');
    seenFactors.add(iv.factor_id);
    const node = findNode(graph, iv.factor_id);
    if (node === undefined) return fail('factor_not_found');
    if (node.kind !== 'factor') return fail('factor_not_factor');
  }

  // Canonical top-level InterventionV3 bundle (the spelling GraphV3 preserves
  // and run_analysis reads). `source` (the user's unless the spec says Olumi's) and an exact-id
  // `target_match` mirror `normalise-option-interventions.freshInterventionV3`.
  const valued = interventions.filter(
    (iv): iv is typeof iv & { value: number } => iv.value !== null,
  );
  const unvalued = interventions.filter((iv) => iv.value === null);
  const interventionBundle: Record<string, unknown> = {};
  for (const iv of valued) {
    const entry: Record<string, unknown> = {
      value: iv.value,
      source: iv.source ?? 'user_specified',
      target_match: {
        node_id: iv.factor_id,
        match_type: 'exact_id',
        confidence: 'high',
      },
    };
    if (iv.unit !== undefined) entry.unit = iv.unit;
    if (iv.raw_value !== undefined) entry.raw_value = iv.raw_value;
    interventionBundle[iv.factor_id] = entry;
  }
  const sameAs = unvalued.length === 0 ? existingOptionWithSameLevels(interventionBundle, graph) : undefined;
  if (sameAs !== undefined) return { matched: false, reason: 'same_levels_as_existing_option', sameAs };

  const operations: PatchOperation[] = [
    {
      op: 'add_node',
      path: optionId,
      value: {
        id: optionId,
        kind: 'option',
        label,
        interventions: interventionBundle,
      },
    },
    { op: 'add_edge', path: `${parent_decision_id}::${optionId}`, value: structuralEdgeValue(parent_decision_id, optionId) },
    ...interventions.map(
      (iv): PatchOperation => ({
        op: 'add_edge',
        path: `${optionId}::${iv.factor_id}`,
        // The link says whose level it carries: an Olumi level's link is Olumi's.
        value: structuralEdgeValue(optionId, iv.factor_id, iv.source ?? 'user_specified'),
      }),
    ),
  ];

  return {
    matched: true,
    proposal: {
      operations,
      optionId,
      optionLabel: label,
      configured: valued.length > 0,
      configuredFactorIds: valued.map((iv) => iv.factor_id),
      linkedUnvaluedFactorIds: unvalued.map((iv) => iv.factor_id),
    },
  };
}

// ---------------------------------------------------------------------------
// (A) — several options in ONE transaction (Canonical CONTRACT #70 5841241418)
// ---------------------------------------------------------------------------

/**
 * `chip.parameters` for a multi-option add:
 *
 *   { parent_decision_id?, options: [ <the single-option spec above>, ... ] }
 *
 * A top-level `parent_decision_id` is the default for every entry that omits
 * its own. Each entry is the SAME spec `buildAddOptionTransaction` validates —
 * there is one definition of an option add, composed, never a second parser.
 */
const MultiOptionParamsSchema = z.object({
  parent_decision_id: z.string().min(1).optional(),
  options: z.array(z.record(z.string(), z.unknown())).min(1),
});

export type AddOptionsSkipReason =
  | AddOptionSkipReason
  | 'too_many_options'
  // ONE HELD CHANGE ADDS THE MISSING FACTOR AND THE OPTION (ruling #70 5843972346 + 5843988693).
  | 'new_factor_exists'
  | 'factor_id_invalid'
  | 'factor_id_collision'
  | 'affects_target_invalid'
  | 'new_factor_unreachable'
  | 'new_factor_not_found'
  | 'new_factor_unused'
  // A new SWITCH (`kind: 'switch'`) that an option acting on it does not switch ON (level exactly a bare 1 — a 1 that
  // carries a unit or a raw figure is an amount, not on): refused, never guessed (Canonical #70 5854919806 item 1).
  | 'new_switch_not_switched_on';

export type AddOptionsBuildResult =
  | {
      readonly matched: true;
      /** One proposal per option, in request order. */
      readonly proposals: readonly AddOptionProposal[];
      /** Every option's ops, concatenated in order: ONE batch, ONE hold. */
      readonly operations: PatchOperation[];
      /** Factors this batch ADDS, so a caller names them by label (the pre-edit graph does not have them). */
      readonly newFactors: ReadonlyArray<{ readonly id: string; readonly label: string }>;
      /**
       * The new factors this batch adds as a 0/1 SWITCH (`kind: 'switch'`), by id. Absent when there are none, so every
       * other build is byte-identical. The hold records them (`GM_HELD_SWITCH_FACTORS_KEY`) and the confirm writes each
       * one's today-0 in the SAME apply as the option (`stampNewSwitchFactors`).
       */
      readonly switchFactorIds?: readonly string[];
    }
  | { readonly matched: false; readonly reason: AddOptionsSkipReason; readonly index?: number; readonly sameAs?: SameLevelsAs };

// ---------------------------------------------------------------------------
// ONE HELD CHANGE ADDS THE MISSING FACTOR AND THE OPTION
// (DL #70 5843303596; contract 5843960061; Canonical ruling 5843972346 + correction 5843988693)
// ---------------------------------------------------------------------------

/**
 * `chip.parameters.new_factors` — factors the model lacks, added in the SAME batch as the option(s) that set
 * them, so ONE approval lands both. An option's intervention names a new factor by `factor_key` (its
 * batch-local `key`), never by label or a guessed id; the id is given or derived HERE (`fac_<slug>`,
 * collision-free). Wire pinned with Runtime: #70 5844014025.
 *
 * STRICT on purpose: the add-option spec is non-strict, so an unknown key there is dropped silently — the
 * exact way a "unit" or "current value" would vanish. There is no carrier for a value on this path (R4
 * screens `add_node` for `source`), so a GRADED factor's current value is set afterwards through the value
 * path, which records who said it.
 *
 * ⭐ A SWITCH IS THE ONE EXCEPTION (Canonical #70 5854919806 item 1; AIQ 5854838919; DL 5854812811 / MG 5854956233,
 * Paul's `90b8f080`: "£59 for new Pro customers; grandfather existing customers" landed with grandfathering unset, so
 * the option duplicated "£59" and the factor ranked as Driver 1 over an unbounded prior). `kind: 'switch'` says the
 * option simply turns the factor ON: every option acting on it sets it to exactly 1, and today it is 0 — OLUMI'S
 * reading of the option's framing (`cee_inference`), never the user's and never source-less. That today-0 cannot ride
 * the `add_node` op (R4 screens `source`/`raw_value` there, and a producer must never be let past that), so it is
 * written by CEE's own confirm, post-referee and pre-apply, into the SAME apply as the option (`stampNewSwitchFactors`)
 * — the carrier `stampUserEditProvenance` already uses for the user's own stamp. One approval, one commit; never a
 * follow-up value write. Its spelling is the magnitude contract's existing switch (`isSwitch`: frame 1 read from levels
 * that are all 0 or 1, both in use) — no `scale_frame`, no unit, no new member. `kind` absent (or `'graded'`) is the
 * factor exactly as before: valueless, asked, never 0.
 */
const NewFactorSpecSchema = z
  .object({
    /** The batch-local handle an option's intervention names it by (`factor_key`). */
    key: z.string().min(1),
    /** `'switch'`: the option turns it on (see above). Absent = `'graded'`, today's behaviour byte for byte. */
    kind: z.enum(['switch', 'graded']).optional(),
    factor_id: z.string().min(1).optional(),
    label: z.string().min(1),
    affects: z
      .array(z.object({ node_id: z.string().min(1), effect_direction: z.enum(['positive', 'negative']) }).strict())
      .min(1)
      // ⛔ One link per target (review 5844092217 B1): a repeated `node_id` emitted two `add_edge`s to the
      // same pair — HELD, then "Edge already exists" at apply, so the user's "yes" landed nothing.
      .refine((a) => new Set(a.map((x) => x.node_id)).size === a.length, { message: 'duplicate affects target' }),
  })
  .strict();
const NewFactorsSchema = z
  .array(NewFactorSpecSchema)
  .min(1)
  .refine((specs) => new Set(specs.map((f) => f.key)).size === specs.length, { message: 'duplicate key' });

/** What a new factor may point at: what served agent-lane graphs link a factor to (never an option/decision, never a lever). */
function isAffectsTarget(node: { kind: string; category?: string } | undefined): boolean {
  if (node === undefined) return false;
  if (node.kind === 'goal' || node.kind === 'outcome' || node.kind === 'risk') return true;
  return node.kind === 'factor' && (node.category === 'observable' || node.category === 'external');
}

/** Does a path from `start` reach a goal node over the view's directed edges? Shared with the add-risk builder. */
export function reachesGoal(graph: AddOptionGraphView, start: string): boolean {
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind] as const));
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (kindOf.get(at) === 'goal') return true;
    for (const e of graph.edges) {
      if (e.from === at && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return false;
}

export const sameLabel = (a: string | undefined, b: string): boolean =>
  (a ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Olumi's DEFAULT hypothesis for a new factor's link to what it affects: the drafter's own default-strength
 * edge (`STRENGTH_DEFAULT_SIGNATURE`, `DEFAULT_EXISTS_PROBABILITY`), stamped `defaulted` + `cee_hypothesis`
 * and signed by the USER's stated direction. Never `STRUCTURAL_EDGE_DEFAULTS`: strength 1.0 is topology, and
 * on a causal link it would claim the factor fully drives what it touches.
 *
 * Exported for the add-risk builder (`add-risk-transaction.ts`, Canonical #70 5855234599): a new risk's every link is
 * this same placeholder hypothesis — never `user_specified`.
 */
export function hypothesisEdgeValue(from: string, to: string, direction: 'positive' | 'negative'): Record<string, unknown> {
  return {
    from,
    to,
    strength: {
      mean: direction === 'negative' ? -STRENGTH_DEFAULT_SIGNATURE.mean : STRENGTH_DEFAULT_SIGNATURE.mean,
      std: STRENGTH_DEFAULT_SIGNATURE.std,
    },
    exists_probability: DEFAULT_EXISTS_PROBABILITY,
    effect_direction: direction,
    defaulted: true,
    provenance: { source: 'cee_hypothesis' as const },
  };
}

type NewFactorPlan =
  | {
      readonly ok: true;
      readonly factors: ReadonlyArray<{ readonly key: string; readonly id: string; readonly label: string }>;
      readonly nodeOps: PatchOperation[];
      readonly edgeOps: PatchOperation[];
      /** New factors declared `kind: 'switch'`, by id, in request order. */
      readonly switchIds: readonly string[];
      readonly view: AddOptionGraphView;
    }
  | { readonly ok: false; readonly reason: AddOptionsSkipReason };

function planNewFactors(raw: unknown, graph: AddOptionGraphView): NewFactorPlan {
  const parsed = NewFactorsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'parameters_invalid' };
  let view = graph;
  const factors: { key: string; id: string; label: string }[] = [];
  const nodeOps: PatchOperation[] = [];
  const edgeOps: PatchOperation[] = [];
  const switchIds: string[] = [];
  for (const spec of parsed.data) {
    if (view.nodes.some((n) => sameLabel(n.label, spec.label))) return { ok: false, reason: 'new_factor_exists' };
    let id: string;
    if (spec.factor_id !== undefined) {
      if (!CANONICAL_ID_RE.test(spec.factor_id)) return { ok: false, reason: 'factor_id_invalid' };
      if (nodeIdExists(view, spec.factor_id)) return { ok: false, reason: 'factor_id_collision' };
      id = spec.factor_id;
    } else {
      const base = `fac_${normaliseIdBase(spec.label)}`;
      id = base;
      for (let n = 2; nodeIdExists(view, id); n += 1) id = `${base}_${n}`;
    }
    for (const a of spec.affects) {
      if (!isAffectsTarget(findNode(graph, a.node_id))) return { ok: false, reason: 'affects_target_invalid' };
    }
    if (!spec.affects.some((a) => reachesGoal(graph, a.node_id))) return { ok: false, reason: 'new_factor_unreachable' };
    // The node op is the same bare shape for a switch: its today-0 is CEE's own stamp at the confirm (see the schema).
    nodeOps.push({ op: 'add_node', path: id, value: { id, kind: 'factor', label: spec.label, category: 'controllable' } });
    if (spec.kind === 'switch') switchIds.push(id);
    for (const a of spec.affects) {
      edgeOps.push({ op: 'add_edge', path: `${id}::${a.node_id}`, value: hypothesisEdgeValue(id, a.node_id, a.effect_direction) });
    }
    factors.push({ key: spec.key, id, label: spec.label });
    view = {
      nodes: [...view.nodes, { id, kind: 'factor', label: spec.label, category: 'controllable' }],
      edges: [...view.edges, ...spec.affects.map((a) => ({ from: id, to: a.node_id }))],
    };
  }
  return { ok: true, factors, nodeOps, edgeOps, switchIds, view };
}

/** Rewrite `{factor_key}` interventions to the batch's own ids; `null` when one names no new factor. */
function resolveNewFactorRefs(
  spec: Record<string, unknown>,
  factors: ReadonlyArray<{ readonly key: string; readonly id: string }>,
): Record<string, unknown> | null {
  const ivs = spec.interventions;
  if (!Array.isArray(ivs)) return spec;
  const out: unknown[] = [];
  for (const iv of ivs) {
    if (iv !== null && typeof iv === 'object' && 'factor_key' in (iv as Record<string, unknown>)) {
      const { factor_key: key, ...rest } = iv as Record<string, unknown>;
      const hit = typeof key === 'string' ? factors.find((f) => f.key === key) : undefined;
      if (hit === undefined) return null;
      out.push({ ...rest, factor_id: hit.id });
    } else {
      out.push(iv);
    }
  }
  return { ...spec, interventions: out };
}

/**
 * Build ONE batch for one or several options.
 *
 * A bag WITHOUT `options` is the single-option spec, byte-identical to
 * `buildAddOptionTransaction`. With `options`, each entry is built against the
 * graph PLUS the options before it, so ids stay distinct and a later entry can
 * never collide with an earlier one. ALL-OR-NOTHING: the first entry that fails
 * fails the whole batch, with its reason and index — no partial proposal.
 */
export function buildAddOptionsTransaction(
  parameters: unknown,
  graph: AddOptionGraphView | null,
): AddOptionsBuildResult {
  const bag =
    parameters !== null && typeof parameters === 'object' && !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>)
      : null;
  // No new factors: exactly the pre-existing path, byte for byte.
  if (bag === null || !('new_factors' in bag)) return buildOptionsOnly(parameters, graph);
  if (graph === null) return { matched: false, reason: 'no_graph' };

  const plan = planNewFactors(bag.new_factors, graph);
  if (!plan.ok) return { matched: false, reason: plan.reason };
  const { new_factors: _newFactors, ...rest } = bag;
  let resolved: Record<string, unknown>;
  if (Array.isArray(rest.options)) {
    const options: unknown[] = [];
    for (const entry of rest.options) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        options.push(entry);
        continue;
      }
      const r = resolveNewFactorRefs(entry as Record<string, unknown>, plan.factors);
      if (r === null) return { matched: false, reason: 'new_factor_not_found' };
      options.push(r);
    }
    resolved = { ...rest, options };
  } else {
    const r = resolveNewFactorRefs(rest, plan.factors);
    if (r === null) return { matched: false, reason: 'new_factor_not_found' };
    resolved = r;
  }

  // The options are built against the graph PLUS the new factors, by the one option builder.
  const built = buildOptionsOnly(resolved, plan.view);
  if (!built.matched) return built;
  // A factor no option sets is not what this path is for: refuse rather than add a stray lever.
  const used = new Set(built.proposals.flatMap((p) => [...p.configuredFactorIds, ...p.linkedUnvaluedFactorIds]));
  if (!plan.factors.every((f) => used.has(f.id))) return { matched: false, reason: 'new_factor_unused' };
  // ⭐ A SWITCH IS SWITCHED ON by every option that acts on it: its level is exactly 1. Unset, or any other level, and
  // "off today, on under this option" would describe a move the option does not make — refused, never guessed.
  // ⛔ AND ONLY A BARE 1 (independent verification of A1, round 2): a switch has no level of its own, so a 1 that carries
  // a unit or a raw figure (£1/month, 1%, 1 hire, "0.5", "50%", 100% as 1) is an amount, never "on" — taken as on, the
  // user's figure would be dropped without a word and today-0 written as Olumi's. Refused, never guessed.
  for (let index = 0; index < built.proposals.length; index += 1) {
    const p = built.proposals[index]!;
    const bundle = (p.operations[0]!.value as { interventions?: unknown }).interventions;
    const levels = levelsOf(bundle);
    for (const id of plan.switchIds) {
      const acts = p.configuredFactorIds.includes(id) || p.linkedUnvaluedFactorIds.includes(id);
      if (!acts) continue;
      const entry: unknown = bundle !== null && typeof bundle === 'object' ? (bundle as Record<string, unknown>)[id] : undefined;
      const carriesUnit = entry !== null && typeof entry === 'object' && 'unit' in entry;
      const carriesRawFigure = entry !== null && typeof entry === 'object' && 'raw_value' in entry;
      if (levels.get(id) !== 1 || carriesUnit || carriesRawFigure) {
        return { matched: false, reason: 'new_switch_not_switched_on', index };
      }
    }
  }

  // ORDER (pinned with Runtime, #70 5844014025): the first option's add_node (the held change's handle) →
  // every new factor node → decision→option → factor→affects → option→factor → any further options' ops.
  // Every node precedes every edge that names it.
  const firstLen = built.proposals[0]!.operations.length;
  const firstOps = built.operations.slice(0, firstLen);
  const laterOps = built.operations.slice(firstLen);
  return {
    matched: true,
    proposals: built.proposals,
    operations: [firstOps[0]!, ...plan.nodeOps, firstOps[1]!, ...plan.edgeOps, ...firstOps.slice(2), ...laterOps],
    newFactors: plan.factors.map((f) => ({ id: f.id, label: f.label })),
    ...(plan.switchIds.length > 0 ? { switchFactorIds: [...plan.switchIds] } : {}),
  };
}

// ---------------------------------------------------------------------------
// ⭐ A NEW SWITCH'S TODAY-0, WRITTEN IN THE SAME APPLY AS THE OPTION (Canonical #70 5854919806 item 1)
// ---------------------------------------------------------------------------

/**
 * The key the HOLD records a batch's new switches under (`inline_patch.switch_factors`). Written only by the typed
 * add-option dispatch (CEE's own transaction — no producer mints a hold's `inline_patch`), read only by the confirm.
 * Absent on every other hold, so their bytes are unchanged.
 */
export const GM_HELD_SWITCH_FACTORS_KEY = 'switch_factors';

/**
 * ⭐ A6b (DL CR on #2131, option (a)) — the key the HOLD records the nodes the USER SUPPLIED under
 * (`inline_patch.user_stated_node_ids`): today, the options whose label the user's own typed words named
 * (`add-option-authorship-context.ts`). Written only by CEE when it mints the hold, never from a payload; read only by
 * the confirm, which stamps exactly those adds `user_set` (`stampUserStatedAddProvenance`). Never a new factor Olumi
 * minted, and absent on every hold with no such signal — whose adds keep their own provenance and whose bytes are
 * unchanged. It records AUTHORSHIP, not approval: an approval alone is never recorded as the user's.
 */
export const GM_HELD_USER_STATED_NODES_KEY = 'user_stated_node_ids';

/**
 * Today's state of a new switch: OFF, and Olumi's reading of the option's framing (AIQ 5854838919: "it CAN be wrong,
 * e.g. partly in place already"), so it is counted in "I supplied N values", shown as Olumi's estimate and correctable.
 * The value writer's own members, spelled as the builders spell an inferred value (`admit-model.ts`
 * `estimatedObservedState`): `observed_state` {value, raw_value, source `cee_inference`, extractionType `inferred`} and
 * the node's `provenance: 'ai_inferred'`. No unit and no `scale_frame`: the magnitude contract reads a switch's frame 1
 * from its levels (`resolveMagnitudeFrame`, `isSwitch`), and a stored frame of 1 would make the value writer refuse the
 * user's own correction.
 */
export const NEW_SWITCH_TODAY = Object.freeze({
  observed_state: Object.freeze({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' }),
  provenance: 'ai_inferred',
} as const);

/**
 * Write each named new switch's today-0 INTO its `add_node` op — CEE's own stamp, run by the confirm AFTER the
 * re-referee and BEFORE the apply, exactly where `stampUserEditProvenance` writes the user's (`gm-held-execute.ts`).
 * The applier then writes it, and the one commit carries the factor, its today-0, the option's level 1 and the links.
 *
 * FAIL-CLOSED, and by identity: each id must name exactly ONE `add_node` of a FACTOR in this batch that carries no
 * value yet, and every option this batch adds that sets a level on it must set exactly 1, with at least one doing so.
 * Anything else is `{ ok: false }` and the caller refuses the whole batch — nothing lands. Pure and total; never
 * mutates its inputs; with no ids, the operations come back unchanged.
 */
export function stampNewSwitchFactors<T extends PatchOperation>(
  operations: readonly T[],
  switchFactorIds: readonly string[],
): { readonly ok: true; readonly operations: T[] } | { readonly ok: false } {
  if (switchFactorIds.length === 0) return { ok: true, operations: [...operations] };
  if (new Set(switchFactorIds).size !== switchFactorIds.length) return { ok: false };
  const out = [...operations];
  for (const id of switchFactorIds) {
    const at = out.flatMap((o, i) => (o.op === 'add_node' && o.path === id ? [i] : []));
    if (at.length !== 1) return { ok: false };
    const value = out[at[0]!]!.value;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
    const node = value as Record<string, unknown>;
    if (node.kind !== 'factor' || node.id !== id || 'observed_state' in node || 'data' in node) return { ok: false };
    let switchedOn = 0;
    for (const o of out) {
      if (o.op !== 'add_node' || o.value === null || typeof o.value !== 'object') continue;
      const v = o.value as { kind?: unknown; interventions?: unknown };
      if (v.kind !== 'option' || v.interventions === null || typeof v.interventions !== 'object') continue;
      if (!Object.prototype.hasOwnProperty.call(v.interventions, id)) continue;
      if (levelsOf(v.interventions).get(id) !== 1) return { ok: false };
      switchedOn += 1;
    }
    if (switchedOn === 0) return { ok: false };
    out[at[0]!] = {
      ...out[at[0]!]!,
      value: { ...node, observed_state: { ...NEW_SWITCH_TODAY.observed_state }, provenance: NEW_SWITCH_TODAY.provenance },
    };
  }
  return { ok: true, operations: out };
}

// ---------------------------------------------------------------------------
// ⭐ PJ-A1 £49 — A NEW GRADED FACTOR'S TODAY LEVEL, WHEN THE USER STATED IT, IN THE SAME APPLY AS THE OPTION
// (DL #70 5860365834; AIQ 5860384275 / 5860839793)
// ---------------------------------------------------------------------------

/**
 * The key the HOLD records a batch's stated today levels under (`inline_patch.graded_today`): `[{ factor_id,
 * observed_state }]`, one per NEW graded factor whose today level the user's own typed words state. Written only by the
 * typed add-option dispatch, from the Agent's in-process context (`statedTodayLevelsFor`) — never from `parameters` —
 * and read only by the confirm. Absent on every other hold, so their bytes are unchanged.
 *
 * WHY. Journey A's "£59 for new Pro customers" minted the NEW graded factor "New Pro customer price" with no today level.
 * It reached ISL as a root with no observed value, ISL defaulted it to 0 (`GOAL_ANCESTOR_DATA_GAP` named it), and the
 * status quo was measured from £0 — wrong by about £49 × new subscribers. The user's brief states £49 ("from £49 to
 * £59"), so that is its level today, the user's (`brief_extraction`); a figure the user never wrote is never stamped, and
 * with none the factor stays valueless and asked — never 0.
 */
export const GM_HELD_GRADED_TODAY_KEY = 'graded_today';

export interface GradedTodayLevel {
  readonly factor_id: string;
  readonly observed_state: Readonly<Record<string, unknown>>;
}

const STATED_TODAY_KEYS = new Set(['value', 'raw_value', 'cap', 'declared_scale', 'unit', 'source']);
const finiteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Whether `os` is exactly what `framedObservedState` (`admit-model.ts`) writes for a baseline the user stated: source
 * `brief_extraction`; framed `{ value: raw / cap, raw_value, cap, declared_scale: 'unit_interval' }` on a cap above 1
 * with 0 ≤ raw ≤ cap; or, with no usable range, a bare value already within [0, 1] (a bare amount above 1 would be
 * unanalysable, `baseline_scale_unresolved`). An optional unit. Nothing else — no extra member rides it into the model.
 */
export function isStatedTodayObservedState(os: unknown): boolean {
  if (os === null || typeof os !== 'object' || Array.isArray(os)) return false;
  const o = os as Record<string, unknown>;
  if (!Object.keys(o).every((k) => STATED_TODAY_KEYS.has(k))) return false;
  if (o.source !== 'brief_extraction' || !finiteNum(o.value)) return false;
  if (o.unit !== undefined && (typeof o.unit !== 'string' || o.unit.trim() === '')) return false;
  if (o.cap === undefined) {
    return o.raw_value === undefined && o.declared_scale === undefined && o.value >= 0 && o.value <= 1;
  }
  if (!finiteNum(o.cap) || o.cap <= 1 || !finiteNum(o.raw_value) || o.declared_scale !== 'unit_interval') return false;
  if (o.raw_value < 0 || o.raw_value > o.cap) return false;
  return Math.abs(o.value - o.raw_value / o.cap) <= 1e-9;
}

/**
 * The hold's `graded_today` member, read. A malformed member is NO signal (`undefined`): the batch is whole without it,
 * and a factor with no today level is asked for — under-claiming, never a guessed value.
 */
export function readGradedTodayMember(raw: unknown): readonly GradedTodayLevel[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: GradedTodayLevel[] = [];
  for (const x of raw) {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return undefined;
    const { factor_id: id, observed_state: os } = x as { factor_id?: unknown; observed_state?: unknown };
    if (typeof id !== 'string' || id.length === 0 || !isStatedTodayObservedState(os)) return undefined;
    out.push({ factor_id: id, observed_state: { ...(os as Record<string, unknown>) } });
  }
  return new Set(out.map((l) => l.factor_id)).size === out.length ? out : undefined;
}

/**
 * Write each named new graded factor's stated today level INTO its `add_node` op — run by the confirm AFTER the
 * re-referee (whose R4 screen keeps values off a producer's `add_node`) and AFTER the switch stamp, BEFORE the apply,
 * exactly as `stampNewSwitchFactors` does. The one commit carries the factor, its today level, the option and the links.
 *
 * FAIL-CLOSED, and by identity: each id must name exactly ONE `add_node` of a FACTOR in this batch that carries no value
 * yet (so never a switch, whose today-0 is already stamped), that an option this batch adds links to; its level must be
 * exactly a stated framed level (`isStatedTodayObservedState`). Anything else is `{ ok: false }` and the caller refuses
 * the whole batch. Pure and total; never mutates its inputs; with no levels, the operations come back unchanged.
 */
export function stampNewGradedTodayLevels<T extends PatchOperation>(
  operations: readonly T[],
  levels: readonly GradedTodayLevel[],
): { readonly ok: true; readonly operations: T[] } | { readonly ok: false } {
  if (levels.length === 0) return { ok: true, operations: [...operations] };
  if (new Set(levels.map((l) => l.factor_id)).size !== levels.length) return { ok: false };
  const out = [...operations];
  const addedOptionIds = new Set(out.filter((o) => o.op === 'add_node' && o.value !== null && typeof o.value === 'object'
    && (o.value as { kind?: unknown }).kind === 'option').map((o) => o.path));
  for (const l of levels) {
    if (!isStatedTodayObservedState(l.observed_state)) return { ok: false };
    const at = out.flatMap((o, i) => (o.op === 'add_node' && o.path === l.factor_id ? [i] : []));
    if (at.length !== 1) return { ok: false };
    const value = out[at[0]!]!.value;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
    const node = value as Record<string, unknown>;
    if (node.kind !== 'factor' || node.id !== l.factor_id || 'observed_state' in node || 'data' in node) return { ok: false };
    const actedOn = out.some((o) => o.op === 'add_edge' && o.path.endsWith(`::${l.factor_id}`)
      && addedOptionIds.has(o.path.slice(0, o.path.length - `::${l.factor_id}`.length)));
    if (!actedOn) return { ok: false };
    out[at[0]!] = { ...out[at[0]!]!, value: { ...node, observed_state: { ...l.observed_state } } };
  }
  return { ok: true, operations: out };
}

function buildOptionsOnly(
  parameters: unknown,
  graph: AddOptionGraphView | null,
): AddOptionsBuildResult {
  const multi =
    parameters !== null &&
    typeof parameters === 'object' &&
    !Array.isArray(parameters) &&
    'options' in (parameters as Record<string, unknown>);
  if (!multi) {
    const single = buildAddOptionTransaction(parameters, graph);
    return single.matched
      ? { matched: true, proposals: [single.proposal], operations: [...single.proposal.operations], newFactors: [] }
      : { matched: false, reason: single.reason, ...(single.sameAs !== undefined ? { sameAs: single.sameAs } : {}) };
  }
  if (graph === null) return { matched: false, reason: 'no_graph' };
  const parsed = MultiOptionParamsSchema.safeParse(parameters);
  if (!parsed.success) return { matched: false, reason: 'parameters_invalid' };
  const { parent_decision_id, options } = parsed.data;
  if (options.length > MAX_OPTIONS_PER_TRANSACTION) {
    return { matched: false, reason: 'too_many_options' };
  }

  let view: AddOptionGraphView = graph;
  const proposals: AddOptionProposal[] = [];
  for (let index = 0; index < options.length; index += 1) {
    const entry = options[index]!;
    const spec =
      parent_decision_id !== undefined && entry.parent_decision_id === undefined
        ? { ...entry, parent_decision_id }
        : entry;
    const built = buildAddOptionTransaction(spec, view);
    if (!built.matched) return { matched: false, reason: built.reason, index, ...(built.sameAs !== undefined ? { sameAs: built.sameAs } : {}) };
    proposals.push(built.proposal);
    const { optionId, optionLabel } = built.proposal;
    // The new option's levels ride into the view, so a LATER option in the same batch cannot duplicate it either.
    const addNode = built.proposal.operations[0]!.value as { interventions?: unknown };
    view = {
      nodes: [...view.nodes, { id: optionId, kind: 'option', label: optionLabel, interventions: addNode.interventions }],
      edges: view.edges,
    };
  }
  return { matched: true, proposals, operations: proposals.flatMap((p) => p.operations), newFactors: [] };
}
