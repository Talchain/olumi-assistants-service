/**
 * ⭐⭐ VALUE WARRANT GUARD — "a value without its warrant", made a CI finding.
 *
 * ── WHAT PROBLEM THIS IS FOR ─────────────────────────────────────────────────
 * A number arrives at a service boundary and NOTHING FAILS. There is no error,
 * no red, no log, because the number is perfectly well-formed. What is missing
 * is the metadata that makes it interpretable or REFUSABLE — the frame it is
 * stated in, the rule that produced its denominator, the unit it is in, where
 * it came from. Measured instances:
 *
 *   · `goal_threshold` normalises as `raw / cap`. On the headroom rule the cap
 *     is `raw * 1.25`, so the target CANCELS and the value is the CONSTANT 0.8
 *     for GBP 20k, GBP 20m, 200 customers and 3 hires alike. A consumer holding
 *     `0.8` could not tell an attested normalisation from an artefact of the
 *     fallback. Closed by minting `goal_threshold_cap_provenance` (utils/
 *     goal-threshold-cap.ts) — the worked example this check generalises.
 *   · `strength.std` is REQUIRED and positive at the contract. A consumer
 *     substituted a constant `0.15` where it was absent; a real `0.15` and a
 *     fabricated `0.15` are indistinguishable BY VALUE.
 *
 * The estate already owns the remedy and applies it WHERE SOMEONE NOTICED:
 * `goal_threshold_frame`, `value_frame` and `goal_threshold_cap_provenance`
 * each carry an explicit fail-closed rule in the contract ("ABSENCE MEANS
 * UNATTESTED AND MUST NEVER BE DEFAULTED"). Patching field by field guarantees
 * the next instance, so this enumerates the whole boundary instead.
 *
 * ── WHAT IS DERIVED AND WHAT IS NOT, STATED BEFORE ANYTHING ELSE ─────────────
 * DERIVED, from the Zod schemas at runtime, with no list to maintain:
 *   · which fields exist, at every nesting depth, including inside arrays;
 *   · which of them are NUMERIC (`ZodNumber` after unwrapping optional /
 *     nullable / default / effects);
 *   · what siblings each one has, and how many other numerics share its level;
 *   · the declared bounds on each value.
 * A numeric field added tomorrow appears in tomorrow's run with NO edit here.
 *
 * NOT DERIVED — two things, both fail-loud rather than assume-good:
 *   · WARRANT_TOKENS, the vocabulary of what a warrant looks like. No rule can
 *     derive that `frame` attests and `cap` does not: both are suffixes on the
 *     same base. Every token carries a WITNESS field that must still exist, so
 *     the vocabulary cannot silently rot (see `deadVocabulary`).
 *   · WARRANT_ROOTS, the entry points. Same limitation `SURFACE_PAIRS` states in
 *     contract-field-guard.ts, and pinned against `deriveSurfaces()` by the
 *     corpus spec so the two cannot drift apart.
 * ⛔ Deriving MOVES risk, it does not remove it (CLAUDE.md trap 12d). The
 * hand-written half is `__tests__/value-warrant-guard.corpus.test.ts`.
 *
 * ── THE ONE DIRECTION THIS IS ALLOWED TO ERR IN ──────────────────────────────
 * A warrant the vocabulary does not recognise produces a FINDING, which a human
 * then records. A warrant the vocabulary wrongly credits produces SILENCE. So
 * the vocabulary is deliberately SHORT: over-reporting costs a decision entry,
 * under-reporting costs the whole point. `EdgeV3.origin` ("Edge creation
 * source: ai, user, repair, enrichment, default", cee-v3.ts:490) is a
 * source-shaped name that is NOT in the vocabulary, and is named here rather
 * than quietly added.
 *
 * ── WHAT THIS CANNOT SEE. READ THIS BEFORE ASSUMING COVERAGE ─────────────────
 *  1. NON-NUMERIC value classes. `analysis_participation` is declared with
 *     "CEE mints it; no model authors it" and measured 0 of 193,917 persisted
 *     nodes — that is DECLARED-BUT-NEVER-WRITTEN, which is the sibling guard's
 *     `orphan` detector, not this one. Likewise `schema_version` / build ids:
 *     an identity that is null is a producer gap, not a missing frame.
 *  2. RUNTIME. This reads DECLARATIONS. A warrant that is declared and never
 *     stamped is invisible here, exactly as `scenarios.brief` (a writer in the
 *     source, 1 row in 14,143) was invisible to the orphan scan.
 *  3. `z.any()`, `z.record()`, `z.union()` and `z.map()` members. Numbers inside
 *     them are not enumerated. `CEEGraphResponseV3.analysis_ready` is `z.any()`
 *     and is therefore entirely out of universe, which is a large hole and is
 *     stated rather than hidden.
 *  4. ADEQUACY. A `unit` present is not proof the unit is right, and this makes
 *     no claim that it is — only that the value is not bare.
 *  5. ANY SURFACE NOT REACHED FROM `WARRANT_ROOTS`: coaching blocks, enrichment,
 *     the turn payload, the DB, PLoT and ISL. The node/graph wire covered well
 *     beats everything covered notionally.
 *  6. ⛔ PREDICATE / ACCESSOR MISUSE — a caller reading the NARROW predicate
 *     where the COMPOSED one was required (`mayNameLeadingOptionForFact` vs
 *     `mayPresentLeaderClaimForFact`) — IS A DIFFERENT CLASS AND IS
 *     DELIBERATELY NOT COVERED. It is named here because a check called a
 *     "warrant" guard invites the assumption that it covers every defect where
 *     a rule was applied from memory, and it does not. The two do not share a
 *     derivation and stretching this one to reach it would be a guess: every
 *     finding here is a fact about a Zod DECLARATION — which keys sit on which
 *     object — and predicate misuse leaves NO schema footprint at all. It is a
 *     call-graph and type question, with a different universe (exported
 *     functions), a different relation (caller-to-callee, not sibling-to-field)
 *     and a different remedy (make the narrow one unreachable, or make the
 *     types distinguish them). A guard that half-fits two problems is how a
 *     predicate nobody can bound gets written — this estate has already paid
 *     for four oscillating rounds of exactly that (CLAUDE.md trap 22f).
 */
import { NodeV3Schema, EdgeV3Schema } from "@talchain/schemas";
import { NodeV3, EdgeV3, ObservedStateV3, CEEGraphResponseV3 } from "./cee-v3.js";
import type { Finding, Decision } from "./contract-field-guard.js";

// ============================================================================
// Types
// ============================================================================

/**
 * FIELD        — a `<field>_<qualifier>` sibling. Unambiguous: the warrant
 *                names the value it frames (`goal_threshold_frame`).
 * LEVEL_SOLE   — a bare qualifier, and this is the ONLY numeric on the object,
 *                so attribution is unambiguous by construction
 *                (`record_disclosures[].value` beside `unit`).
 * LEVEL_SHARED — a bare qualifier, and two or more numerics share the level, so
 *                the qualifier does not say WHICH number it frames. Reported.
 *                Not pedantry: `observed_state` carries `unit` beside `value`,
 *                `raw_value`, `baseline` and `cap`, and `raw_value` is
 *                documented as "before normalization" while `value` is after —
 *                one `unit` demonstrably does not frame both the same way.
 * NONE         — nothing. Reported.
 */
export type WarrantVerdict = "FIELD" | "LEVEL_SOLE" | "LEVEL_SHARED" | "NONE";

/** One numeric field at one place on one boundary schema. */
export interface ValueSite {
  /** `<root>::<path>` — the decisions ledger is keyed on exactly this string. */
  readonly id: string;
  readonly root: string;
  /** Dotted path from the root; `[]` marks an array element. */
  readonly path: string;
  readonly required: boolean;
  /**
   * Declared Zod bounds, e.g. `min=0 max=1`. CONTEXT ONLY — deliberately NOT a
   * warrant. `goal_threshold` lives in [0,1] and was still uninterpretable; a
   * fabricated `0.15` satisfies `min=0` exactly as well as a real one. Printed
   * because it is what a human decision rests on, never counted as attestation.
   */
  readonly bounds: string;
  readonly fieldWarrants: readonly string[];
  readonly levelWarrants: readonly string[];
  readonly numericsAtLevel: number;
  readonly verdict: WarrantVerdict;
}

/** A name shape that attests something about a value. Hand-written; witnessed. */
export interface WarrantToken {
  readonly token: string;
  /** A field that exists TODAY and uses this token. Asserted, not decorative. */
  readonly witness: string;
  readonly why: string;
}

export interface WarrantRoot {
  readonly name: string;
  readonly schema: unknown;
}

// ============================================================================
// The vocabulary — the half derivation cannot do
// ============================================================================

/**
 * ⚠ HAND-WRITTEN AND THEREFORE INCOMPLETE BY CONSTRUCTION — and that is not a
 * defect to fix by deriving it. Nothing in the tree distinguishes
 * `goal_threshold_frame` (attests) from `goal_threshold_cap` (a second number)
 * except what the words mean. Every entry names a field that exists today, and
 * `deadVocabulary` REDs when one stops existing, so this can rot loudly but not
 * quietly. Append-only; adding a token can only turn findings into silence, so
 * an addition is a decision, not housekeeping.
 */
export const WARRANT_TOKENS: readonly WarrantToken[] = [
  {
    token: "frame",
    witness: "goal_threshold_frame",
    why:
      "The reference the number is stated against. ISL's goal samples are " +
      "CHANGES FROM BASELINE and CEE mints LEVELS; nobody converted, and the " +
      "engine answered 'P(change >= X)' for a user who asked 'P(level >= X)' — " +
      "a structural zero in nine of ten live instances, every one " +
      "`status: computed`. No value guard could have caught it: 0.8 is a " +
      "sensible VALUE and the defect lived in its FRAME.",
  },
  {
    token: "provenance",
    witness: "goal_threshold_cap_provenance",
    why:
      "Which rule produced the number. On `target_derived_headroom` the " +
      "denominator is the target itself, so `raw / cap` is the constant 0.8 for " +
      "every target — a consumer cannot fail closed on a denominator it cannot " +
      "see. Matched as a prefix too: `provenance_unit_normalised` " +
      "(assist.ts:468) is the audit trail for a percent-to-fraction rewrite.",
  },
  {
    token: "unit",
    witness: "unit",
    why:
      "The dimension. `ObservedStateV3.unit` (cee-v3.ts:60) and " +
      "`goal_threshold_unit` (cee-v3.ts:210). A magnitude without a unit is not " +
      "a quantity, and `goal-threshold-cap.ts` names raw+unit as the honest " +
      "display precisely because the normalised value is not.",
  },
  {
    token: "source",
    witness: "source",
    why:
      "Who determined the value. `ObservedStateV3.source` (cee-v3.ts:129) is " +
      "the narrowest validator in the chain and is what earns the user-authored " +
      "pill; before it could carry a user stamp, every chat-set value rendered " +
      "as 'Olumi estimate'. Matched as a prefix too: `source_quote` is the " +
      "brief text a value was taken from.",
  },
  {
    token: "scale",
    witness: "scale_frame",
    why:
      "The divisor a magnitude was projected onto. `scale_frame` (cee-v3.ts:278) " +
      "is itself NUMERIC, which is why a 'warrants are the non-numeric siblings' " +
      "rule is wrong and is not used here. `declared_scale` on the contract's " +
      "ObservedStateSchema carries DECLARED_SCALE_BOUNDS " +
      "(unit_interval / ratio / raw_count).",
  },
  {
    token: "elicited_from",
    witness: "elicited_from",
    why:
      "Whose statement the value came from. Declared on the shared contract's " +
      "ObservedStateSchema and NOT on cee.ObservedStateV3 — an asymmetry this " +
      "check makes visible rather than resolving.",
  },
  {
    token: "stated_role",
    witness: "stated_role",
    why:
      "What the user stated the magnitude AS. A brief saying 'keeping monthly " +
      "churn under 4%' reached `observed_state` as `{ value: 0.04, " +
      "extractionType: 'explicit' }` — the field for what is CURRENTLY TRUE " +
      "asserting that churn IS 4%. `stated_role: 'constraint'` is the refusal " +
      "to make that claim silently (cee-v3.ts:165).",
  },
  {
    token: "extractionType",
    witness: "extractionType",
    why:
      "HOW the pipeline read the brief (explicit / inferred / range / observed). " +
      "A weaker warrant than the rest and NOT interchangeable with " +
      "`stated_role` — its four members all describe the reading, and " +
      "`explicit` is stamped as readily on a ceiling as on a measurement " +
      "(cee-v3.ts:139, trap 21). Counted because it is a real attestation about " +
      "where a number came from; never treated as a frame.",
  },
];

/**
 * Does this field NAME attest something, under the vocabulary?
 *
 * Exact token, `_<token>` suffix, or `<token>_` prefix. All three shapes occur:
 * `unit`, `goal_threshold_frame` / `declared_scale`, `provenance_unit_relabelled`.
 */
export function isQualifierName(
  name: string,
  tokens: readonly WarrantToken[] = WARRANT_TOKENS,
): boolean {
  return tokens.some(
    (t) => name === t.token || name.endsWith(`_${t.token}`) || name.startsWith(`${t.token}_`),
  );
}

// ============================================================================
// Derivation
// ============================================================================

/**
 * The entry points.
 *
 * ⚠ THE SAME SIX SURFACES `deriveSurfaces()` NAMES, and the corpus spec asserts
 * set equality with it — so this cannot drift from the sibling guard, and a
 * seventh surface added there is a RED here rather than a silent gap. What is
 * new is the WALK: this one descends into nested objects and array elements,
 * which is where `strength.std`, `observed_state.value` and
 * `goal_constraints[].value` live. The flat guard cannot see any of them.
 */
export function deriveWarrantRoots(): WarrantRoot[] {
  return [
    { name: "contract.NodeV3Schema", schema: NodeV3Schema },
    { name: "contract.EdgeV3Schema", schema: EdgeV3Schema },
    { name: "cee.NodeV3", schema: NodeV3 },
    { name: "cee.EdgeV3", schema: EdgeV3 },
    { name: "cee.ObservedStateV3", schema: ObservedStateV3 },
    { name: "cee.CEEGraphResponseV3", schema: CEEGraphResponseV3 },
  ];
}

/** Strip the wrappers that do not change what a field IS. */
function unwrap(schema: unknown): any {
  let cur: any = schema;
  for (let i = 0; i < 32; i++) {
    const t = cur?._def?.typeName;
    if (
      t === "ZodOptional" ||
      t === "ZodNullable" ||
      t === "ZodDefault" ||
      t === "ZodReadonly" ||
      t === "ZodBranded" ||
      t === "ZodCatch"
    ) {
      cur = cur._def.innerType;
    } else if (t === "ZodEffects") {
      cur = cur._def.schema;
    } else if (t === "ZodLazy") {
      cur = cur._def.getter();
    } else if (t === "ZodPipeline") {
      cur = cur._def.out;
    } else {
      return cur;
    }
  }
  throw new Error("unwrap did not terminate — a wrapper chain deeper than 32");
}

function boundsOf(numeric: any): string {
  const checks: any[] = numeric?._def?.checks ?? [];
  return checks
    .map((c) => (c.value === undefined ? String(c.kind) : `${c.kind}=${c.value}`))
    .join(" ");
}

/** Deepest nesting this walk will follow before calling it a hard error. */
const MAX_DEPTH = 8;

/**
 * Every numeric leaf reachable from the roots, with the warrants beside it.
 *
 * Takes its universe as an argument so the corpus spec can feed it a synthetic
 * one — the same shape every detector in contract-field-guard.ts has.
 *
 * A schema object reached from more than one root is attributed to the FIRST
 * root that reaches it, in declaration order (so `cee.ObservedStateV3` yields
 * no rows of its own: `cee.NodeV3.observed_state` gets there first). Reordering
 * the roots therefore renames ids — which the ledger reports LOUDLY in both
 * directions, never silently.
 */
export function deriveValueSites(
  roots: readonly WarrantRoot[] = deriveWarrantRoots(),
  tokens: readonly WarrantToken[] = WARRANT_TOKENS,
): ValueSite[] {
  const sites: ValueSite[] = [];
  const visited = new Set<unknown>();

  const walk = (rootName: string, schema: unknown, path: string, depth: number): void => {
    const obj = unwrap(schema);
    if (obj?._def?.typeName !== "ZodObject") return;
    if (depth > MAX_DEPTH) {
      // Truncating silently would report a clean result for a subtree nobody
      // looked at, which is the one answer this must never give.
      throw new Error(`value-warrant-guard: nesting deeper than ${MAX_DEPTH} at ${rootName}.${path}`);
    }
    if (visited.has(obj)) return;
    visited.add(obj);

    const shape: Record<string, unknown> = obj.shape;
    const names = Object.keys(shape).sort();
    const numerics = names.filter((n) => unwrap(shape[n])?._def?.typeName === "ZodNumber");

    for (const name of names) {
      const declared = shape[name] as any;
      const inner = unwrap(declared);
      const kind = inner?._def?.typeName;
      const here = path ? `${path}.${name}` : name;

      if (kind === "ZodObject") {
        walk(rootName, inner, here, depth + 1);
        continue;
      }
      if (kind === "ZodArray") {
        const element = unwrap(inner._def.type);
        if (element?._def?.typeName === "ZodObject") walk(rootName, element, `${here}[]`, depth + 1);
        continue;
      }
      if (kind !== "ZodNumber") continue;

      const fieldWarrants = names.filter(
        (s) => s !== name && s.startsWith(`${name}_`) && isQualifierName(s, tokens),
      );
      const levelWarrants = names.filter(
        (s) => s !== name && !s.startsWith(`${name}_`) && isQualifierName(s, tokens),
      );
      const verdict: WarrantVerdict =
        fieldWarrants.length > 0
          ? "FIELD"
          : levelWarrants.length === 0
            ? "NONE"
            : numerics.length === 1
              ? "LEVEL_SOLE"
              : "LEVEL_SHARED";

      sites.push({
        id: `${rootName}::${here}`,
        root: rootName,
        path: here,
        required: declared?._def?.typeName !== "ZodOptional",
        bounds: boundsOf(inner),
        fieldWarrants,
        levelWarrants,
        numericsAtLevel: numerics.length,
        verdict,
      });
    }
  };

  for (const root of roots) {
    const obj = unwrap(root.schema);
    // Fail loud rather than skip: a root that stopped being an object must not
    // read as "nothing wrong here".
    if (obj?._def?.typeName !== "ZodObject") {
      throw new Error(`WARRANT_ROOTS names a non-object schema: ${root.name}`);
    }
    walk(root.name, obj, "", 0);
  }
  return sites.sort((a, b) => a.id.localeCompare(b.id));
}

// ============================================================================
// Detectors — pure, each takes its universe
// ============================================================================

/** D1 — a number crossing the boundary with no attestation of any kind. */
export function detectUnwarrantedValues(sites: readonly ValueSite[]): Finding[] {
  return sites
    .filter((s) => s.verdict === "NONE")
    .map((s) => ({
      detector: "unwarranted-value" as const,
      id: `unwarranted:${s.id}`,
      detail:
        `\`${s.path}\` is a ${s.required ? "REQUIRED" : "optional"} number on ${s.root} ` +
        `with NO frame, provenance, unit, source or scale beside it` +
        (s.bounds ? ` (declared bounds: ${s.bounds} — a bound is not a warrant)` : "") +
        `. A consumer receiving it cannot tell an attested value from a substituted one.`,
    }));
}

/**
 * D2 — a bare qualifier on an object carrying several numbers, so it does not
 * say WHICH number it attests. Weaker than D1 and reported separately for that
 * reason: the fix is usually to scope the warrant to the field, not to add one.
 */
export function detectScopeAmbiguousWarrants(sites: readonly ValueSite[]): Finding[] {
  return sites
    .filter((s) => s.verdict === "LEVEL_SHARED")
    .map((s) => ({
      detector: "scope-ambiguous-warrant" as const,
      id: `scope-ambiguous:${s.id}`,
      detail:
        `\`${s.path}\` on ${s.root} shares its level with ${s.numericsAtLevel - 1} other ` +
        `number(s), and its only warrants are level-scoped ` +
        `(${s.levelWarrants.join(", ")}) — none of them names which value it attests.`,
    }));
}

export function runWarrantDetectors(sites: readonly ValueSite[]): Finding[] {
  return [...detectUnwarrantedValues(sites), ...detectScopeAmbiguousWarrants(sites)];
}

/**
 * The vocabulary's own ratchet: a token whose witness has left the schemas.
 *
 * Without this, a token can outlive the thing it was written for and go on
 * silently crediting warrants that no longer exist — the hand-maintained mirror
 * one level up from the one this check replaces.
 */
export function deadVocabulary(
  sites: readonly ValueSite[],
  tokens: readonly WarrantToken[] = WARRANT_TOKENS,
): WarrantToken[] {
  const present = new Set<string>();
  for (const s of sites) for (const w of [...s.fieldWarrants, ...s.levelWarrants]) present.add(w);
  return tokens.filter((t) => !present.has(t.witness));
}

// ============================================================================
// The decisions ledger
// ============================================================================

/**
 * ⚠ A LEDGER IS A HAND-MAINTAINED MIRROR (trap 12), made safe the same way
 * contract-field-guard.ts makes its own safe: `adjudicate` ratchets it in BOTH
 * directions. A finding with no entry REDs; an entry whose finding no longer
 * reproduces REDs. It cannot silently go short and it cannot silently rot.
 *
 * ⛔ THE FIRST CUT IS AN ENUMERATION, NOT A CLEAN-UP. 26 of the 34 value sites
 * are findings and MOST ARE RECORDED `OPEN` — nobody has answered them. An
 * `OPEN` entry is not an exemption and must not be read as one; it is the
 * question written down where the next reader can see it. Getting the question
 * right matters more than getting to zero.
 *
 * ⛔ DO NOT DECLARE A FIELD PURELY TO TURN A ROW GREEN. A defaulted provenance
 * is a manufactured attestation, which is worse than none.
 *
 * ⛔ NO DATE TRIGGERS. A CI job that turns red on a calendar is a time bomb.
 * What this gives instead is an OPEN count printed every run that a human can
 * watch go up.
 */
export const WARRANT_DECISIONS: readonly Decision[] = [
  // ── FAMILY: edge strength (mean, std) — the estate's second measured instance
  {
    id: "unwarranted:contract.EdgeV3Schema::strength.std",
    status: "OPEN",
    decision:
      "OPEN, and this is the instance that motivated the check. `std` is " +
      "REQUIRED and `min=0` at the contract, and a consumer substituted a " +
      "constant 0.15 where it was absent — a real 0.15 and a fabricated 0.15 " +
      "are indistinguishable BY VALUE, which is the whole defect class. " +
      "StrengthSchema carries exactly two fields, both numbers, so there is " +
      "nowhere on the object for an attestation to live. The question owed: " +
      "does an edge coefficient need a provenance (model / repair / default / " +
      "user) on the wire, or is `EdgeV3.defaulted` + `EdgeV3.origin` at the " +
      "level above sufficient? Note those live on cee.EdgeV3 and NOT on " +
      "contract.EdgeV3Schema, so they cannot answer for this surface.",
  },
  {
    id: "unwarranted:contract.EdgeV3Schema::strength.mean",
    status: "OPEN",
    decision:
      "OPEN, same object and same question as its `std` sibling — settle them " +
      "together. `mean` is bounded `min=-1 max=1` here, which says what range " +
      "it lives in and nothing about who put it there.",
  },
  {
    id: "unwarranted:cee.EdgeV3::strength.std",
    status: "OPEN",
    decision:
      "OPEN, CEE's half of the same pair. Settle with " +
      "unwarranted:contract.EdgeV3Schema::strength.std — two schemas named " +
      "`strength`, one on each side of the wire, and a warrant added to one " +
      "alone changes nothing (the twin the sibling guard records as " +
      "surface-twin:edgev3).",
  },
  {
    id: "unwarranted:cee.EdgeV3::strength.mean",
    status: "OPEN",
    decision:
      "OPEN, and the row carries a SECOND finding this check surfaced without " +
      "looking for it: the contract declares `mean` as `min=-1 max=1` and CEE's " +
      "own copy declares NO bounds at all. That divergence is out of this " +
      "check's scope to fix and is recorded here because the enumeration is " +
      "where it became visible.",
  },

  // ── FAMILY: declared ranges (prior, state_space) ──────────────────────────
  {
    id: "unwarranted:cee.NodeV3::prior.range_min",
    status: "OPEN",
    decision:
      "OPEN. A prior's range is a pair of magnitudes in the factor's own units " +
      "with no unit, frame or source beside it — its only sibling is " +
      "`distribution`, which names the SHAPE and not the SCALE. Whether the " +
      "unit is inherited from the node's `observed_state.unit` is exactly the " +
      "kind of thing a consumer currently has to assume, and assuming is the " +
      "defect. Settle with range_max.",
  },
  {
    id: "unwarranted:cee.NodeV3::prior.range_max",
    status: "OPEN",
    decision: "OPEN, the other half of the prior range. Settle with range_min.",
  },
  {
    id: "unwarranted:contract.NodeV3Schema::state_space.range.min",
    status: "OPEN",
    decision:
      "OPEN. `state_space.range` is `{ min, max }` and nothing else — no unit " +
      "and no scale, on the surface CEE STRIPS ENTIRELY " +
      "(stripped:cee.NodeV3:state_space, already recorded in the sibling " +
      "guard's ledger). So the decision owed here is downstream of that one: " +
      "settle whether `state_space` crosses the CEE boundary at all before " +
      "deciding what must accompany it.",
  },
  {
    id: "unwarranted:contract.NodeV3Schema::state_space.range.max",
    status: "OPEN",
    decision: "OPEN, the other half. Settle with state_space.range.min.",
  },

  // ── FAMILY: quality scores ────────────────────────────────────────────────
  {
    id: "unwarranted:cee.CEEGraphResponseV3::quality.overall",
    status: "ACCEPTED",
    decision:
      "ACCEPTED — no warrant is owed. This is not a measurement of anything in " +
      "the user's world: it is CEE's own score of the draft it just produced, " +
      "on a scale the schema declares (`min=1 max=10`) and the comment names " +
      "('Quality metrics (1-10 integer scale; see computeQuality / openapi.yaml " +
      "CEEQualityMeta)', cee-v3.ts:939). Both halves of the interpretation — " +
      "whose claim it is, and what scale it is on — are fixed by construction, " +
      "so there is no frame a consumer could misread and none to attest. " +
      "⚠ This reasoning is about SELF-SCORES ONLY and must not be reused for a " +
      "bounded number that measures the world: `exists_probability` is also " +
      "bounded and is recorded OPEN below, deliberately.",
  },
  {
    id: "unwarranted:cee.CEEGraphResponseV3::quality.structure",
    status: "ACCEPTED",
    decision: "ACCEPTED for the reason given at quality.overall — a declared-scale self-score.",
  },
  {
    id: "unwarranted:cee.CEEGraphResponseV3::quality.coverage",
    status: "ACCEPTED",
    decision: "ACCEPTED for the reason given at quality.overall — a declared-scale self-score.",
  },
  {
    id: "unwarranted:cee.CEEGraphResponseV3::quality.safety",
    status: "ACCEPTED",
    decision: "ACCEPTED for the reason given at quality.overall — a declared-scale self-score.",
  },
  {
    id: "unwarranted:cee.CEEGraphResponseV3::quality.structural_proxy",
    status: "ACCEPTED",
    decision: "ACCEPTED for the reason given at quality.overall — a declared-scale self-score.",
  },

  // ── Counts and probabilities ──────────────────────────────────────────────
  {
    id: "unwarranted:cee.CEEGraphResponseV3::record_disclosures_omitted",
    status: "ACCEPTED",
    decision:
      "ACCEPTED — no warrant is owed. It is a COUNT of entries this transform " +
      "could not express, in units of entries, and its own docblock already " +
      "states its frame in the only place a frame could go wrong here: " +
      "'`omitted: 0` means the transform expressed everything it was handed. It " +
      "does NOT mean the user received everything' (cee-v3.ts:906). ⚠ That " +
      "scope limit is a real and measured hole (56 to 0 on the v5 turn path, " +
      "ROADMAP 2.1094) — it is a PRODUCER-COVERAGE gap, not a missing warrant, " +
      "and recording it here must not be read as closing it.",
  },
  {
    id: "unwarranted:contract.EdgeV3Schema::exists_probability",
    status: "OPEN",
    decision:
      "OPEN, and deliberately not waved through on its bounds. `min=0 max=1` " +
      "fixes the RANGE and says nothing about whose belief it is or how it was " +
      "arrived at — a defaulted 0.9 and an elicited 0.9 are the same number. " +
      "CEE's own EdgeV3 carries `provenance`, `provenance_display`, `origin` " +
      "and `defaulted` at this level and the shared contract carries NONE of " +
      "them, so the contract surface cannot answer the question at all. The " +
      "decision owed is whether edge existence needs an attestation on the " +
      "shared wire, not whether CEE happens to have one internally.",
  },

  // ── SCOPE-AMBIGUOUS: observed_state, the four-numbers-one-unit family ──────
  {
    id: "scope-ambiguous:cee.NodeV3::observed_state.value",
    status: "OPEN",
    decision:
      "OPEN, and the sharpest instance this detector found. `observed_state` " +
      "carries FOUR numbers — `value`, `baseline`, `cap`, `raw_value` — and ONE " +
      "`unit`. The object's own comments say `raw_value` is 'Raw value before " +
      "normalization' while `value` is after (cee-v3.ts:130), so a single unit " +
      "demonstrably does not frame both the same way, and nothing on the wire " +
      "says which one it frames. `source`, `stated_role` and `extractionType` " +
      "have the same ambiguity. The decision owed: does `unit` attach to " +
      "`value` by definition (and the other three inherit or not), or does this " +
      "object need per-field scoping the way `goal_threshold_unit` has it? " +
      "Settle the whole family together.",
  },
  {
    id: "scope-ambiguous:cee.NodeV3::observed_state.baseline",
    status: "OPEN",
    decision:
      "OPEN — the same four-numbers-one-unit ambiguity. Settle with " +
      "scope-ambiguous:cee.NodeV3::observed_state.value.",
  },
  {
    id: "scope-ambiguous:cee.NodeV3::observed_state.cap",
    status: "OPEN",
    decision:
      "OPEN — same family, and the one where the ambiguity is most likely to " +
      "bite: a cap is a DENOMINATOR, and the whole `goal_threshold` defect was " +
      "a denominator nobody could see. Settle with " +
      "scope-ambiguous:cee.NodeV3::observed_state.value.",
  },
  {
    id: "scope-ambiguous:cee.NodeV3::observed_state.raw_value",
    status: "OPEN",
    decision:
      "OPEN — same family, and the field whose docblock is the EVIDENCE that " +
      "one shared `unit` cannot serve all four. Settle with " +
      "scope-ambiguous:cee.NodeV3::observed_state.value.",
  },
  {
    id: "scope-ambiguous:contract.NodeV3Schema::observed_state.value",
    status: "OPEN",
    decision:
      "OPEN — the contract's own `observed_state`, which is a DIFFERENT object " +
      "from CEE's: it carries `declared_scale` and `elicited_from` (which CEE's " +
      "does not declare) and lacks `cap`, `raw_value`, `stated_role` and " +
      "`extractionType` (which CEE's has). Three numbers, one unit, same " +
      "ambiguity. Settle alongside the CEE half, not separately — a warrant " +
      "added to one side of a twin changes nothing.",
  },
  {
    id: "scope-ambiguous:contract.NodeV3Schema::observed_state.baseline",
    status: "OPEN",
    decision:
      "OPEN — same object. Settle with " +
      "scope-ambiguous:contract.NodeV3Schema::observed_state.value.",
  },
  {
    id: "scope-ambiguous:contract.NodeV3Schema::observed_state.std",
    status: "OPEN",
    decision:
      "OPEN — same object, and the contract-side twin of the `strength.std` " +
      "substitution problem: an uncertainty with no attestation is exactly " +
      "where a constant gets quietly supplied. Settle with " +
      "scope-ambiguous:contract.NodeV3Schema::observed_state.value.",
  },

  // ── SCOPE-AMBIGUOUS: node-level numbers ───────────────────────────────────
  {
    id: "scope-ambiguous:cee.NodeV3::goal_threshold_raw",
    status: "ACCEPTED",
    decision:
      "ACCEPTED. The level-scoped credit is an artefact of counting — the " +
      "warrant this field actually has is `goal_threshold_unit`, which the " +
      "detector attributes to `goal_threshold` (the base it is a suffix of) " +
      "rather than to `goal_threshold_raw`. `goal-threshold-cap.ts` names " +
      "`goal_threshold_raw` + `goal_threshold_unit` as THE honest target " +
      "display, so this pair is the estate's own worked answer and no further " +
      "attestation is owed. ⭐ Recorded rather than fixed by widening the " +
      "matcher: a prefix rule loose enough to bind `goal_threshold_unit` to " +
      "`goal_threshold_raw` also binds `goal_threshold_cap` to it, and a " +
      "detector that guesses at family membership is the containment rule " +
      "contract-field-guard.ts deliberately refused to ship.",
  },
  {
    id: "scope-ambiguous:cee.NodeV3::intercept",
    status: "OPEN",
    decision:
      "OPEN. A regression intercept sitting among four unrelated node numbers, " +
      "credited only by node-level `provenance` / `source_quote` / " +
      "`extractionType` — none of which is about the intercept. This is the " +
      "clearest case where LEVEL_SHARED is telling the truth: the qualifiers " +
      "are real, and not one of them attests THIS value.",
  },
  {
    id: "scope-ambiguous:cee.NodeV3::scale_frame",
    status: "OPEN",
    decision:
      "OPEN, and it is the interesting one: `scale_frame` IS a warrant — the " +
      "divisor every option magnitude for this factor was projected onto — and " +
      "it is itself an unattested number. Its docblock says 'ABSENCE MEANS " +
      "NEVER FRAMED. Consumers MUST NOT default it' (cee-v3.ts:274), which is " +
      "the right posture for its absence and says nothing about the units of " +
      "the divisor when present. A warrant that needs a warrant is not a " +
      "regress to dismiss: it is the same question one level down.",
  },
  {
    id: "scope-ambiguous:cee.CEEGraphResponseV3::goal_constraints[].confidence",
    status: "ACCEPTED",
    decision:
      "ACCEPTED — no warrant is owed, and the level-scoped credit is again an " +
      "artefact. `confidence` is `min=0 max=1` and the object carries " +
      "`provenance: explicit | inferred | proxy` (assist.ts:419) which IS the " +
      "attestation for it; the sibling numeric that makes this row SHARED is " +
      "`value`, and `value` has its own field-scoped `value_frame`. Nothing " +
      "here is ambiguous once both are read together.",
  },
];

// ============================================================================
// Re-export the adjudication the sibling guard already owns
// ============================================================================

export { adjudicate } from "./contract-field-guard.js";
export type { Finding, Decision, GuardReport } from "./contract-field-guard.js";
