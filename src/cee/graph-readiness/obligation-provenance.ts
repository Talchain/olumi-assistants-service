/**
 * ⭐ THE ONE AUTHORITY ON "MAY THIS GAP BE PUT TO THE USER AS AN OBLIGATION?"
 *
 * ## INV-P6, the founder's binding rule
 *
 * > System-inferred structure may remain a provisional hypothesis, but must
 * > NEVER become a mandatory user obligation.
 *
 * Written as an ALLOWLIST, not a denylist: an obligation may only be minted over
 * structure whose provenance is **provably user-stated**. Structure the system
 * authored — drafted, hypothesised, repaired, enriched — may prompt an OFFER
 * ("shall I…?", "is this right?") but never a demand.
 *
 * ⚠ THE DIRECTION IS DELIBERATE AND THE OPPOSITE READING IS THE DEFECT. A
 * denylist ("do not oblige over structure we can PROVE we invented") leaves every
 * unstamped element obliging, which is most of a fresh draft — the very case the
 * founder witnessed ("I couldn't run an analysis on the initial graph"). An
 * allowlist can only ever WITHDRAW an obligation, never invent one, so the harm
 * it can cause is bounded to "we did not demand something we could have
 * demanded" — and the TWIN below is what stops that becoming its own defect.
 *
 * ## WHY ABSENCE IS NOT PROMOTED, and it is not our judgement call
 *
 * The shared contract states it at the field
 * (`@talchain/schemas` `ObservedStateSchema.source`):
 *
 * > Absence means the producer stamped no provenance — a consumer MUST NOT read
 * > absence as any particular class; classify unknown/absent as neutral, never
 * > guess.
 *
 * So an unstamped element is `unattributed`, and `unattributed` is NOT
 * `user_stated`, so it cannot mint an obligation. We do not infer authorship from
 * a `prior` object, from a missing `observed_state`, or from `NodeV3.provenance`
 * — the last of which is declared RESPONSE-ONLY and recomputed on every response
 * (`schemas/cee-v3.ts:203-208`), i.e. a display value, not a record.
 *
 * ## DERIVED, NOT MIRRORED (CLAUDE.md trap 12)
 *
 * Every classification table below is keyed on a `Record<<contract enum>, …>`, so
 * a new member of any of those vocabularies **fails typecheck here** rather than
 * falling into a silent default that reads green. There is no string-substring
 * matching anywhere in this file: the estate has already paid for one of those
 * (`mapToV3ProvenanceSource`, where every candidate stamp containing `"user"`
 * coerced to `user_specified` and converted a withdrawn obligation back into an
 * obligation).
 *
 * ## THE TWIN THIS FILE MUST NOT BREAK
 *
 * A genuinely user-stated gap must STILL block. `user_specified`,
 * `user_override`, `panel_elicited` and `brief_extraction` are producer-written
 * stamps, so the twin is not vacuous: `__tests__/obligation-provenance.test.ts`
 * asserts both directions on the same corpus in the same run.
 */
import {
  OBSERVED_STATE_SOURCE_LITERALS,
  type KnownObservedStateSourceLiteral,
} from '@talchain/schemas';

import { isRepairAuthoredOptionFactorEdge } from '../../graph/repair-authored-edge.js';
import type { CanonicalReadinessIssue } from '../../orchestrator/tools/analysis-ready-helper.js';

// ============================================================================
// The vocabulary
// ============================================================================

/**
 * Who authored the structure a readiness issue is raised over.
 *
 * `unattributed` is a DISTINCT value on purpose. Collapsing "we know the system
 * made this" and "nobody stamped it" into one bucket is what makes an obligation
 * rule unauditable: the probe could no longer show which graphs are
 * unclassifiable, and a producer that stops stamping would look like a producer
 * that stamped `ai_drafted`.
 *
 * ⭐ `user_ratified` is the FIFTH, added 20 Sep 2026 for the same reason one
 * level up: *"Olumi estimated it and the user endorsed it"* is neither
 * authorship nor a machine's own guess, and collapsing it into `user_stated`
 * (which is what this union did) let a single click satisfy a threshold the
 * product's own copy promises requires SETTING a value. See
 * {@link earnsAuthorshipCredit} for the ruling, and {@link reflectsAHumanAct}
 * for what ratification DOES earn.
 *
 * ⛔ THE COUNT IS NOT WRITTEN HERE ANY MORE. `STRUCTURE_PROVENANCE_VALUES` below
 * is the derivation; a number in a docblock is a hand-maintained mirror, and
 * this one said "FOURTH" until the fifth member arrived.
 */
export type StructureProvenance =
  | 'user_stated'
  | 'user_ratified'
  | 'ai_drafted'
  | 'system_repaired'
  | 'unattributed';

/** Whether a gap may be put to the user as a demand, or only as an offer. */
export type ObligationClass = 'required' | 'offered';

/**
 * ⭐⭐ THE ONE PLACE THE AUTHORSHIP THRESHOLD IS DECIDED (ruled 20 Sep 2026).
 *
 * *"Did a PERSON supply this value?"* — the question every authorship threshold
 * in the estate is actually asking, and the reason `user_ratified` exists as a
 * separate class rather than as a shade of `user_stated`.
 *
 * ## WHY RATIFICATION IS NOT AUTHORSHIP
 *
 * **The decisive ground is the product's own shipped sentence.** When no
 * parameter is the user's, `analysis-admission.ts` tells them the leader claim
 * stays withheld *"until you have **SET** at least one of them"*, and again
 * *"until you have **set a value** on a factor one of the options changes"*.
 * **Both say SET. Neither says confirm, approve, or accept.** While
 * `user_confirmed` classified as `user_stated`, one click on one Olumi estimate
 * satisfied a threshold the product had promised required setting a value —
 * which made a published sentence false. That is an inconsistency between what
 * we say and what we do, not a preference.
 *
 * Two supporting reasons:
 *   · **The consequence is wildly asymmetric to the act.** The threshold is
 *     ONE parameter (`analysis-admission.ts` returns `material_user_stated` the
 *     moment the count exceeds zero), so a single confirmation converted a
 *     fully machine-authored model into one licensed to name a winner.
 *   · **Confirmation cannot distinguish knowledge from acquiescence.** "I know
 *     this is about right" and "I have no better number and it looks plausible"
 *     produce the identical event. Humans remaining the AUTHORS requires
 *     authorship, not assent.
 *
 * ## ⚠ WHAT THIS PREDICATE IS NOT — and it is a trap-21 pair, not a duplicate
 *
 * Ratification is a **genuine human act** and must not be discarded. Every
 * threshold about REVIEW rather than AUTHORSHIP reads {@link reflectsAHumanAct}
 * instead. Two questions, two predicates, named apart — do not "reconcile"
 * them, which is the move that would recreate the collapse this change undid.
 */
export function earnsAuthorshipCredit(provenance: StructureProvenance): boolean {
  return provenance === 'user_stated';
}

/**
 * *"Did a person ATTEND to this value at all?"* — true for authorship AND for
 * ratification, false for everything the machine did alone.
 *
 * The companion to {@link earnsAuthorshipCredit}, and the reason widening the
 * union does not quietly demote a confirmed value everywhere at once. A user who
 * confirmed an estimate has done something real: it is honest to say *"you have
 * reviewed these estimates"*, and it is a LIE to describe that value back to
 * them as Olumi's own invention. `context-integrity/not-modelled-manifest.ts`
 * reads this one for exactly that reason — its own header records that wrongly
 * claiming a user's value as our invention is far worse than the reverse.
 *
 * ⛔ It must NOT be used to unlock `comparative_leader`, "stable" or "robust".
 * That is the authorship question, and it has its own predicate above.
 */
export function reflectsAHumanAct(provenance: StructureProvenance): boolean {
  return provenance === 'user_stated' || provenance === 'user_ratified';
}

/**
 * THE rule. One line, one place — so no surface can hold a second opinion.
 * Only structure that {@link earnsAuthorshipCredit} earns a demand.
 *
 * ⚠ `user_ratified` is DELIBERATELY `offered`, not `required`. INV-P6's
 * allowlist can only ever WITHDRAW an obligation, and a value the user merely
 * endorsed is precisely one we may ask about ("is this still right?") and may
 * not demand. Stated rather than inherited, because the fifth member arrived
 * after this function was written and a silent `else` is how a class ships
 * unruled — which is how `user_confirmed` got here in the first place.
 */
export function obligationFor(provenance: StructureProvenance): ObligationClass {
  return earnsAuthorshipCredit(provenance) ? 'required' : 'offered';
}

/**
 * ⭐⭐ THE ONE ORDER OVER THIS UNION, AS DATA — because two of this file's own
 * derivations COMBINE the provenance of several elements, and a combining rule
 * written as an `if` ladder is total only by accident.
 *
 * ## WHY THIS EXISTS (measured, 21 Sep 2026)
 *
 * `structureProvenanceOfEffect`'s "weakest end wins" was three `if`s and a bare
 * `return 'user_stated'`. That is total over FOUR members and silently
 * non-total over five: `user_ratified` matched no guard and fell through to
 * **`user_stated`** — promoting ratification to authorship on
 * `readiness_issues[]`, the exact equivalence the 20 Sep ruling forbids, on the
 * ONE READINESS AUTHORITY's own path. It produced
 * `{"provenance":"user_stated","obligation":"required"}`, **byte-identical to a
 * genuinely user-stated control**, while `obligationFor`'s docblock three
 * screens above said `user_ratified` is deliberately `offered`. The compiler
 * saw nothing, because a bare `return` at the end of a chain is not a default
 * the type system can check. It is CLAUDE.md trap 12 — a hand-maintained
 * mirror — wearing control flow rather than a list.
 *
 * ⛔ SO THE ORDER IS A `Record<StructureProvenance, number>` AND NOT A LADDER.
 * A sixth member fails typecheck AT THIS OBJECT LITERAL, which is the same
 * device `OBSERVED_STATE_SOURCE` and `STRUCTURE_PROVENANCE_VALUES` already use
 * in this file. An exhaustive `switch` with a `never` default would also be
 * total, and was rejected: "weakest wins" is an ORDER over the union, not a
 * case analysis, so a switch would have to re-derive the comparison at every
 * call site and could hold a different opinion at each. Stated once, as data.
 *
 * ## THE ORDER, AND WHY EACH STEP
 *
 * `system_repaired` < `unattributed` < `ai_drafted` < `user_ratified` <
 * `user_stated`. The first three preserve the ladder's pre-existing precedence
 * exactly (verified by execution, not by reading). `user_ratified` sits ABOVE
 * `ai_drafted` because ratification is a genuine human act
 * ({@link reflectsAHumanAct}) and BELOW `user_stated` because it is not
 * authorship ({@link earnsAuthorshipCredit}) — which is precisely the gap the
 * fifth member was minted to hold open.
 *
 * ⚠ THIS IS A STRENGTH ORDER, NOT AN OBLIGATION ORDER. Do not read
 * `required`/`offered` off it; {@link obligationFor} is the only authority on
 * that, and it deliberately cuts between `user_ratified` and `user_stated`
 * rather than anywhere else on this scale.
 */
const AUTHORSHIP_STRENGTH: Readonly<Record<StructureProvenance, number>> = {
  system_repaired: 0,
  unattributed: 1,
  ai_drafted: 2,
  user_ratified: 3,
  user_stated: 4,
};

/**
 * The LEAST-authored of several elements' provenance — *"an obligation is only
 * the user's when every element it names is the user's."*
 *
 * Returns `null` for an empty list rather than guessing a member: the caller
 * knows what "we looked at nothing" means on its own path, and this function
 * does not.
 */
export function weakestProvenance(
  candidates: readonly StructureProvenance[],
): StructureProvenance | null {
  let weakest: StructureProvenance | null = null;
  for (const candidate of candidates) {
    if (weakest === null || AUTHORSHIP_STRENGTH[candidate] < AUTHORSHIP_STRENGTH[weakest]) {
      weakest = candidate;
    }
  }
  return weakest;
}

/**
 * The MOST-authored of several elements' provenance — the opposite question,
 * asked where one human-supplied part is evidence about the whole (an option is
 * being worked on by the user if ANY of its stated effects is theirs).
 *
 * Named apart from {@link weakestProvenance} rather than parameterised, because
 * the two answer genuinely different questions and a shared `direction` flag is
 * how a call site ends up asking the wrong one.
 */
export function strongestProvenance(
  candidates: readonly StructureProvenance[],
): StructureProvenance | null {
  let strongest: StructureProvenance | null = null;
  for (const candidate of candidates) {
    if (strongest === null || AUTHORSHIP_STRENGTH[candidate] > AUTHORSHIP_STRENGTH[strongest]) {
      strongest = candidate;
    }
  }
  return strongest;
}

/**
 * The vocabularies as VALUES, for the validators that must accept them across a
 * JSON boundary.
 *
 * ⚠ DERIVED FROM THE TYPES, not hand-listed beside them. The `Record<T, true>`
 * form means adding a member to `StructureProvenance` or `ObligationClass`
 * FAILS TYPECHECK here — so a new member cannot ship with a validator that
 * silently rejects it. That failure mode is not hypothetical: these fields cross
 * the readiness-repair pending action's JSONB boundary, whose parser rejects every
 * unrecognised key, and adding them without extending it turned a healthy resume
 * into `invalid`.
 */
export const STRUCTURE_PROVENANCE_VALUES = Object.keys({
  user_stated: true,
  user_ratified: true,
  ai_drafted: true,
  system_repaired: true,
  unattributed: true,
} satisfies Record<StructureProvenance, true>) as readonly StructureProvenance[];

/**
 * ⛔⛔ THE SAME LIST, TYPED AS THE NON-EMPTY TUPLE `z.enum` DEMANDS.
 *
 * WHY THIS EXISTS. `STRUCTURE_PROVENANCE_VALUES` above is derived and therefore
 * safe; `z.enum` will not accept `readonly StructureProvenance[]`, and the
 * convenient way past that is to hand-list the members beside the schema. That
 * is exactly what `context/context-pack-schema.ts` did, and **the compiler
 * could not see it**: measured at `31d5b81e`, there are ZERO exhaustive
 * switches over this union repo-wide, so widening it breaks nothing at build
 * time — while the hand-listed Zod enum would have **REJECTED the new member at
 * RUNTIME**, inside the context pack, on a real turn. A green build and a
 * throwing parse.
 *
 * So the tuple is published HERE, once, cast only in its TYPE and never in its
 * CONTENT — the `satisfies Record<StructureProvenance, true>` above is what
 * keeps it honest, and it is why widening the union still fails typecheck at
 * the object literal rather than silently shipping a short list.
 *
 * Pinned both ways (and round-tripped through the schema, which is the actual
 * failure mode) by
 * `orchestrator-v5/context/__tests__/context-pack-provenance-vocabulary-parity.test.ts`.
 */
export const STRUCTURE_PROVENANCE_ENUM_VALUES = STRUCTURE_PROVENANCE_VALUES as readonly [
  StructureProvenance,
  ...StructureProvenance[],
];

export const OBLIGATION_CLASS_VALUES = Object.keys({
  required: true,
  offered: true,
} satisfies Record<ObligationClass, true>) as readonly ObligationClass[];

export function isStructureProvenance(value: unknown): value is StructureProvenance {
  return typeof value === 'string' && (STRUCTURE_PROVENANCE_VALUES as readonly string[]).includes(value);
}

export function isObligationClass(value: unknown): value is ObligationClass {
  return typeof value === 'string' && (OBLIGATION_CLASS_VALUES as readonly string[]).includes(value);
}

// ============================================================================
// Classifying ONE value-provenance stamp
// ============================================================================

/**
 * The complete shared-contract vocabulary for `observed_state.source`, mapped.
 *
 * Exhaustive by TYPE: `Record<KnownObservedStateSourceLiteral, …>` means the
 * 0.41.0 re-vendor that adds a thirteenth literal breaks the build here instead
 * of silently classifying it. That is the whole point — this is the list a human
 * would otherwise have to remember to sync.
 *
 * `explicit` and `inferred` are in this vocabulary because the estate's writers
 * stamp `ExtractionType` members into `source` as well as into `extractionType`;
 * they are classified the same way in both places (see {@link EXTRACTION_TYPE}).
 */
const OBSERVED_STATE_SOURCE: Readonly<
  Record<KnownObservedStateSourceLiteral, StructureProvenance>
> = {
  // The user speaking — directly, or through their own brief. A brief is the
  // user's own words, so a value extracted from it is user-stated, not inferred.
  brief_extraction: 'user_stated',
  explicit: 'user_stated',
  user: 'user_stated',
  user_override: 'user_stated',
  user_edited: 'user_stated',
  user_calibration: 'user_stated',
  // ── RATIFICATION, NOT AUTHORSHIP (ruled 20 Sep 2026) ───────────────────
  // Both of these classified as `user_stated` until that ruling, and neither
  // carried a written justification — note the asymmetry with `brief_extraction`
  // at the top of this table, which does. They were swept in with the `user_*` family,
  // not ruled. See {@link earnsAuthorshipCredit} for the full ground.
  //
  // `user_confirmed` is the UI's "confirm as is": an OLUMI estimate the user
  // endorsed. The number is still ours. The product's own sentence promises the
  // leader claim stays withheld "until you have SET at least one of them", and a
  // user who only confirmed has set nothing.
  user_confirmed: 'user_ratified',
  // `user_assumption` is "mark as assumption": a value the user INVENTED rather
  // than one they know. The same reasoning read from the other end — an admitted
  // guess is not evidence of domain knowledge, and `decision-review/
  // value-source-extraction-type.ts` has always sampled it WIDE for that reason.
  user_assumption: 'user_ratified',
  // Elicited FROM the user through a panel, and verified against CEE's own
  // collab store before it is stamped — the user supplied it.
  panel_elicited: 'user_stated',
  // CEE's own inference. A hypothesis, however good.
  cee_inference: 'ai_drafted',
  inferred: 'ai_drafted',
  // The deterministic repair authored this.
  cee_repair: 'system_repaired',
};

/**
 * `InterventionV3.source` (`schemas/cee-v3.ts:336`) and the analysis-ready
 * option shape (`schemas/analysis-ready.ts:40`) share a narrower three-member
 * vocabulary. Kept as its own exhaustive table rather than folded into the one
 * above, because the two enums are separately declared and may drift — and a
 * single merged table would hide which one gained a member.
 */
type InterventionSourceLiteral = 'brief_extraction' | 'cee_hypothesis' | 'user_specified';

const INTERVENTION_SOURCE: Readonly<Record<InterventionSourceLiteral, StructureProvenance>> = {
  brief_extraction: 'user_stated',
  user_specified: 'user_stated',
  cee_hypothesis: 'ai_drafted',
};

/**
 * `EdgeProvenanceV3.source` (`schemas/cee-v3.ts:221`) adds `domain_knowledge`:
 * the model supplying something from general knowledge. That is the model
 * speaking, not the user.
 */
type EdgeProvenanceSourceLiteral = InterventionSourceLiteral | 'domain_knowledge';

const EDGE_PROVENANCE_SOURCE: Readonly<
  Record<EdgeProvenanceSourceLiteral, StructureProvenance>
> = {
  ...INTERVENTION_SOURCE,
  domain_knowledge: 'ai_drafted',
};

/**
 * `ExtractionType` (`schemas/graph.ts`) — HOW a value was extracted, which is a
 * different question from WHO supplied it, but the two agree on this axis:
 * `explicit`/`observed` are the user's own figures; `inferred`/`range` are the
 * model's.
 */
type ExtractionTypeLiteral = 'explicit' | 'inferred' | 'range' | 'observed';

const EXTRACTION_TYPE: Readonly<Record<ExtractionTypeLiteral, StructureProvenance>> = {
  explicit: 'user_stated',
  observed: 'user_stated',
  inferred: 'ai_drafted',
  range: 'ai_drafted',
};

/**
 * Classify one stamp against every declared vocabulary, most specific first.
 * Returns `unattributed` for an absent or unrecognised stamp — never a guess.
 */
export function classifyValueSource(stamp: unknown): StructureProvenance {
  if (typeof stamp !== 'string') return 'unattributed';
  if (stamp in OBSERVED_STATE_SOURCE) {
    return OBSERVED_STATE_SOURCE[stamp as KnownObservedStateSourceLiteral];
  }
  if (stamp in EDGE_PROVENANCE_SOURCE) {
    return EDGE_PROVENANCE_SOURCE[stamp as EdgeProvenanceSourceLiteral];
  }
  if (stamp in EXTRACTION_TYPE) {
    return EXTRACTION_TYPE[stamp as ExtractionTypeLiteral];
  }
  return 'unattributed';
}

/**
 * The declared vocabularies, exported so a test can assert the tables cover them
 * and a probe can report which stamps a corpus actually carries. Derived from the
 * contract constant, never re-typed.
 */
export const DECLARED_VALUE_SOURCE_STAMPS: readonly string[] = [
  ...OBSERVED_STATE_SOURCE_LITERALS,
  ...(Object.keys(EDGE_PROVENANCE_SOURCE) as readonly string[]),
  ...(Object.keys(EXTRACTION_TYPE) as readonly string[]),
];

// ============================================================================
// Reading a graph
// ============================================================================

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nodesOf(graph: unknown): readonly Record<string, unknown>[] {
  const raw = asRecord(graph)?.nodes;
  if (!Array.isArray(raw)) return [];
  return raw.map(asRecord).filter((n): n is Record<string, unknown> => n !== null);
}

function edgesOf(graph: unknown): readonly Record<string, unknown>[] {
  const raw = asRecord(graph)?.edges;
  if (!Array.isArray(raw)) return [];
  return raw.map(asRecord).filter((e): e is Record<string, unknown> => e !== null);
}

function nodeById(graph: unknown, id: string): Record<string, unknown> | null {
  for (const node of nodesOf(graph)) if (node.id === id) return node;
  return null;
}

/**
 * Which classes the option-interventions ladder in {@link structureProvenance}
 * RESOLVES on, and which it defers past to the repair-authored-edge check.
 *
 * ⚠ `false` is a DEFERRAL, not a verdict. `unattributed` means no stamp was
 * read, and `system_repaired` reaching this table would be an off-contract
 * stamp (`InterventionV3.source` declares three members, none of them repair);
 * in both cases the incoming-edge check below has better evidence, and both
 * behave exactly as they did before this map existed.
 *
 * ⛔ It is a `Record<StructureProvenance, boolean>` rather than an `if` ladder
 * for the same reason as {@link AUTHORSHIP_STRENGTH}: a sixth member must be
 * RULED, and a `Record` makes not ruling it a build failure. Omission is how
 * `user_ratified` came to be reported as `unattributed` here.
 */
const INTERVENTION_CLASS_RESOLVES: Readonly<Record<StructureProvenance, boolean>> = {
  user_stated: true,
  user_ratified: true,
  ai_drafted: true,
  system_repaired: false,
  unattributed: false,
};

/**
 * The provenance of ONE graph element.
 *
 * Reads only fields a PRODUCER writes:
 *   - an option's per-factor `interventions[factorId].source`;
 *   - a factor's `observed_state.source`, then its `observed_state.extractionType`;
 *   - a node's `data.observed_state` / `data.interventions` legacy carriers.
 *
 * It does NOT read `NodeV3.provenance` (response-only display, regenerated every
 * response) and it does NOT infer authorship from the presence of a `prior`.
 */
export function structureProvenance(element: unknown, graph?: unknown): StructureProvenance {
  const node = asRecord(element);
  if (!node) return 'unattributed';

  const data = asRecord(node.data);
  const observed = asRecord(node.observed_state) ?? asRecord(data?.observed_state);
  if (observed) {
    const fromSource = classifyValueSource(observed.source);
    if (fromSource !== 'unattributed') return fromSource;
    const fromExtraction = classifyValueSource(observed.extractionType);
    if (fromExtraction !== 'unattributed') return fromExtraction;
  }

  const interventions = asRecord(node.interventions) ?? asRecord(data?.interventions);
  if (interventions) {
    // An option is user-stated when ANY of its stated effects is. Options are
    // authored as a whole; one user-supplied effect is evidence the user is
    // working on this option, and the per-pair question is answered by
    // `structureProvenanceOfEffect` below, which is what the obligation rule
    // actually calls.
    const classes = Object.values(interventions).map((entry) =>
      classifyValueSource(asRecord(entry)?.source),
    );
    // The STRONGEST stated effect wins here — the opposite question to
    // `structureProvenanceOfEffect`'s, and named apart from it on purpose.
    //
    // ⛔ THIS WAS ALSO AN `if` LADDER, total over two members and silent about
    // the other three: `user_ratified` fell past both guards and this function
    // returned `unattributed` — a WIRE counter meaning *"nobody stamped it"*,
    // which is false about a value a human acted on, and the reason this file's
    // own header insists that bucket stay distinct.
    //
    // Which classes RESOLVE here is now stated, not left to omission. The two
    // that do not are unchanged in behaviour: they defer to the repair-authored
    // incoming-edge check below, which knows things this map cannot.
    const strongest = strongestProvenance(classes);
    if (strongest !== null && INTERVENTION_CLASS_RESOLVES[strongest]) return strongest;
  }

  // A repair-authored INCOMING edge makes the element's connection the system's,
  // not the user's. Only meaningful with the graph in hand.
  if (graph !== undefined && typeof node.id === 'string') {
    const kinds = new Map<string, string>();
    for (const n of nodesOf(graph)) {
      if (typeof n.id === 'string' && typeof n.kind === 'string') kinds.set(n.id, n.kind);
    }
    for (const edge of edgesOf(graph)) {
      if (edge.to !== node.id) continue;
      const view = {
        from: typeof edge.from === 'string' ? edge.from : '',
        to: typeof edge.to === 'string' ? edge.to : '',
        origin: edge.origin,
      };
      if (isRepairAuthoredOptionFactorEdge(view, kinds)) return 'system_repaired';
    }
  }

  return 'unattributed';
}

/**
 * The provenance of the OPTION×FACTOR EFFECT a `MISSING_OPTION_VALUE`-class
 * blocker is raised over — the precise subject of the ask *"Factor X is
 * currently N. What should option Y set it to?"*
 *
 * Order is load-bearing, and it is the order of who authored the RELATIONSHIP:
 *   1. the option→factor edge, if the deterministic repair drew it;
 *   2. the option's own stamp for THIS factor, if it carries one;
 *   3. the weakest of the option's and the factor's own provenance — because an
 *      ask over either an invented option or an invented factor is an ask over an
 *      invention, whatever the other end says.
 */
export function structureProvenanceOfEffect(
  graph: unknown,
  optionId: string | undefined,
  factorId: string | undefined,
): StructureProvenance {
  const option = optionId ? nodeById(graph, optionId) : null;
  const factor = factorId ? nodeById(graph, factorId) : null;

  if (optionId && factorId) {
    const kinds = new Map<string, string>();
    for (const n of nodesOf(graph)) {
      if (typeof n.id === 'string' && typeof n.kind === 'string') kinds.set(n.id, n.kind);
    }
    for (const edge of edgesOf(graph)) {
      if (edge.from !== optionId || edge.to !== factorId) continue;
      const view = {
        from: optionId,
        to: factorId,
        origin: edge.origin,
      };
      if (isRepairAuthoredOptionFactorEdge(view, kinds)) return 'system_repaired';
    }
  }

  if (option && factorId) {
    const data = asRecord(option.data);
    const interventions = asRecord(option.interventions) ?? asRecord(data?.interventions);
    const entry = interventions ? asRecord(interventions[factorId]) : null;
    if (entry) {
      const stamped = classifyValueSource(entry.source);
      if (stamped !== 'unattributed') return stamped;
    }
  }

  const ends: StructureProvenance[] = [];
  if (option) ends.push(structureProvenance(option, graph));
  if (factor) ends.push(structureProvenance(factor, graph));

  // The WEAKEST end wins: an obligation is only the user's when every element it
  // names is the user's.
  //
  // ⛔ DO NOT REWRITE THIS AS AN `if` LADDER. It was one, it was total over four
  // members, and the fifth (`user_ratified`) fell through its bare final
  // `return 'user_stated'` — minting a DEMAND over a value the user had only
  // confirmed, on the readiness authority's own wire field, with no type error.
  // {@link AUTHORSHIP_STRENGTH} carries the order so a sixth member breaks the
  // BUILD instead of the ruling.
  //
  // `null` here means neither end resolved to a node at all — which is "nobody
  // stamped it", not "the user said so". Unchanged from the guard this replaces.
  return weakestProvenance(ends) ?? 'unattributed';
}

// ============================================================================
// Classifying ONE readiness issue
// ============================================================================

export interface ObligationDecision {
  readonly provenance: StructureProvenance;
  readonly obligation: ObligationClass;
  /** True when the run will proceed by excluding/holding the option this names. */
  readonly waived_by_exclusion: boolean;
}

/**
 * ⚠ STRUCTURAL ISSUES KEEP THEIR OBLIGATION, AND THAT IS NOT AN OVERSIGHT.
 *
 * A `graph_structure` / `numeric_integrity` / `internal` blocker is not a request
 * for a missing quantity — it is a statement that the model cannot be computed at
 * all (no goal, no decision, fewer than two options, a cycle, a value that cannot
 * be interpreted). Withdrawing those would produce a graph the product offers to
 * analyse and the engine cannot process: P8's defect, inverted.
 *
 * Trap 21 applies here and is the reason this is a named category test rather
 * than a provenance test: *"is a quantity missing for a relationship?"* and *"can
 * this model be computed?"* are DIFFERENT QUESTIONS, and INV-P6 answers only the
 * first. A cycle the drafter drew is a real residual — the system should repair
 * it rather than ask — but that belongs to the repair seam, not to this rule, and
 * it is reported rather than quietly folded in.
 */
const OBLIGATION_EXEMPT_CATEGORIES: ReadonlySet<CanonicalReadinessIssue['category']> = new Set([
  'graph_structure',
  'numeric_integrity',
  'internal',
]);

/**
 * Classify one readiness issue: whose structure is it over, may it be demanded,
 * and is the run about to answer it by exclusion?
 */
export function classifyIssueObligation(
  issue: CanonicalReadinessIssue,
  graph: unknown,
  waivedOptionIds: readonly string[] = [],
): ObligationDecision {
  const waived =
    typeof issue.option_id === 'string' && waivedOptionIds.includes(issue.option_id);

  if (OBLIGATION_EXEMPT_CATEGORIES.has(issue.category)) {
    return {
      provenance: structureProvenanceOfEffect(graph, issue.option_id, issue.factor_id),
      obligation: 'required',
      waived_by_exclusion: waived,
    };
  }

  const provenance = structureProvenanceOfEffect(graph, issue.option_id, issue.factor_id);
  return {
    provenance,
    obligation: obligationFor(provenance),
    waived_by_exclusion: waived,
  };
}
