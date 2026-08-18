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
import type { z } from 'zod';

import {
  OBSERVED_STATE_SOURCE_LITERALS,
  type KnownObservedStateSourceLiteral,
} from '@talchain/schemas';

import { isRepairAuthoredOptionFactorEdge } from '../../graph/repair-authored-edge.js';
import type { CanonicalReadinessIssue } from '../../orchestrator/tools/analysis-ready-helper.js';
import { ExtractionType } from '../../schemas/graph.js';

// ============================================================================
// The vocabulary
// ============================================================================

/**
 * Who authored the structure a readiness issue is raised over.
 *
 * `unattributed` is a FOURTH value on purpose. Collapsing "we know the system
 * made this" and "nobody stamped it" into one bucket is what makes an obligation
 * rule unauditable: the probe could no longer show which graphs are
 * unclassifiable, and a producer that stops stamping would look like a producer
 * that stamped `ai_drafted`.
 */
export type StructureProvenance =
  | 'user_stated'
  | 'ai_drafted'
  | 'system_repaired'
  | 'unattributed';

/** Whether a gap may be put to the user as a demand, or only as an offer. */
export type ObligationClass = 'required' | 'offered';

/**
 * THE rule. One line, one place — so no surface can hold a second opinion.
 * `user_stated` and only `user_stated` earns a demand.
 */
export function obligationFor(provenance: StructureProvenance): ObligationClass {
  return provenance === 'user_stated' ? 'required' : 'offered';
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
  ai_drafted: true,
  system_repaired: true,
  unattributed: true,
} satisfies Record<StructureProvenance, true>) as readonly StructureProvenance[];

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
  user_confirmed: 'user_stated',
  user_edited: 'user_stated',
  user_calibration: 'user_stated',
  user_assumption: 'user_stated',
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
 * `ExtractionType` (`schemas/graph.ts:59`) — HOW a value was extracted, which is
 * a different question from WHO supplied it, but the two agree on this axis:
 * `explicit`/`observed` are the user's own figures; `inferred`/`range` are the
 * model's.
 *
 * ⭐ DERIVED FROM THE CONTRACT, not re-typed here. This was a hand-copied union
 * (CLAUDE.md trap 12): a fifth `ExtractionType` member would have left the map
 * below quietly total over a stale four-member alphabet and the new label would
 * have fallen through `classifyValueSource` to `unattributed` — a provenance
 * downgrade with nothing red. `Record<ExtractionTypeLiteral, …>` IS exhaustive,
 * so with the union derived, adding a member now fails `tsc` HERE.
 *
 * ⚠ Deliberately NOT merged with `factor-value-provenance.ts`'s partition of the
 * same enum: that one answers *"may this value's badge read `from_brief`?"* and
 * this one answers *"whose structure is this, for the obligation rule?"* — two
 * questions under similar names is exactly the pair trap 21 says to keep apart.
 * They are cross-named there and here so a future divergence is a choice.
 */
type ExtractionTypeLiteral = z.infer<typeof ExtractionType>;

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
    if (classes.includes('user_stated')) return 'user_stated';
    if (classes.includes('ai_drafted')) return 'ai_drafted';
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
  if (ends.length === 0) return 'unattributed';

  // The WEAKEST end wins: an obligation is only the user's when every element it
  // names is the user's.
  if (ends.includes('system_repaired')) return 'system_repaired';
  if (ends.includes('unattributed')) return 'unattributed';
  if (ends.includes('ai_drafted')) return 'ai_drafted';
  return 'user_stated';
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
 *
 * ⚠ THE SAME THREE CATEGORIES LIVE IN `analysis-ready-helper.ts` AS
 * `hardBlocked`, AND THEY ARE NOT THE SAME CONCEPT (CLAUDE.md trap 21).
 * That one answers *"may this turn still be called READY?"* — no, so the status
 * goes `blocked` with a `blocked_reason`. This one answers *"may the product
 * DEMAND the user supply this?"* — no, because these are not a missing quantity.
 * The sets are byte-identical today and are deliberately NOT shared: a change to
 * either is a decision about ONE of the two questions. Both sites name the other
 * so the next divergence is a choice, made once, rather than a silent drift in
 * whichever one the author happened to open.
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
