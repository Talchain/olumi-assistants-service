/**
 * ⭐⭐ ONE PROVENANCE AUTHORITY (Recovery Batch C, DL 12 Oct: "we are patching symptoms … the architecture fix comes first").
 *
 * THE ONLY MODULE THAT INTERPRETS AUTHORSHIP STRINGS: `observed_state.source`, `extractionType`, an option setting's
 * `source`, a link's `provenance.source` / `provenance.magnitude`, and the markers beside them (`user_material_unverified`,
 * `reviewed_by_user`, `stated_time`, `estimate`, `extra_share_by_date`). Every reader whose answer reaches what the person
 * or the Agent is told, or a decision that licenses, withholds, refuses or labels a result, asks {@link provenanceOf} (or a
 * projection of it below) — never the strings. `__tests__/provenance-agreement.test.ts` proves the readers agree for every
 * source variant; `__tests__/provenance-reads-guard.test.ts` is the shrink-only list of the sites still outside.
 *
 * THREE ORIGINS, NEVER TWO (DL AMEND; AIE #94 6119326092):
 *   - `human`   — ONLY on positive attestation: a person's stamp (`user*`, `panel_elicited`), the brief's (`explicit` /
 *                 `observed` extraction, or a `brief_extraction` / `explicit` / `observed` / `user_specified` stamp with no
 *                 extraction type to decide), or a team share computed from the person's stated time (`stated_time`).
 *   - `ai`      — ONLY for a recognised AI source (`inferred` / `range` extraction; `cee_inference`, `inferred`, `range`,
 *                 `cee_hypothesis`, `domain_knowledge`, `cee_repair` stamps). An ACCEPTED Olumi estimate keeps `ai`
 *                 origin with `accepted: true`; the event-by-date switch's own 0/1 is `ai` with `structural: true` (a
 *                 definition, never an input estimate).
 *   - `unknown` — anything else: missing, unrecognised or contradictory. Never counted as Olumi's, never read as the
 *                 person's; disclosed.
 *
 * AND A ROLE, apart from the origin (DL 12 Oct; SYS2 §2 STOP; AIE 0825 §2): `verified` | `unverified` | `n/a`. A
 * human-written figure whose ROLE is unverified — stored today as `user_material_unverified` beside whatever stamp the
 * write side put there (`cee_inference` + `inferred`) — is origin `human`, role `unverified`: never `ai`, never counted as
 * Olumi's, never a verified baseline. Consumers: the AI counts and the provisional label read origin `ai` only; the
 * unverified disclosure reads origin `unknown` OR (`human` AND role `unverified`); every projection that names the
 * person's figure (`yours`, `user_stated`, `from_brief` / `user_set`) requires role `verified`.
 *
 * The extraction type is the finer instrument for the stamps that DEFER to it (`brief_extraction`, `cee_inference`,
 * `explicit`, `inferred`, and any other non-person stamp): it decides first, and the stamp decides only where no
 * extraction type is held. An extraction type that is present but unrecognised decides `unknown`.
 */
import {
  OBSERVED_STATE_SOURCE_LITERALS,
  STRENGTH_DEFAULT_SIGNATURE,
  type KnownObservedStateSourceLiteral,
} from '@talchain/schemas';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const rec = (v: unknown): Rec | undefined => (isRec(v) ? v : undefined);
function asRecord(value: unknown): Record<string, unknown> | null {
  return isRec(value) ? value : null;
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Introduction is separate from figure/display provenance. Only admission's positive stamp licenses this verdict. */
export function nodeIntroductionOf(node: unknown): { readonly origin: 'olumi_added' | 'unknown'; readonly adopted: boolean } {
  const n = rec(node);
  if (n?.proposed_by !== 'olumi') return { origin: 'unknown', adopted: false };
  // The option card records inclusion; subsequent user exclusion preserves that earlier adoption.
  const adopted = n.kind === 'option' && (n.analysis_participation === 'included'
    || n.option_status === 'infeasible' || n.option_status === 'removed');
  return { origin: 'olumi_added', adopted };
}

// ============================================================================
// The display vocabulary (moved verbatim from `cee/transforms/provenance-display.ts`, which re-exports it)
// ============================================================================

export type ProvenanceDisplay = "from_brief" | "ai_inferred" | "user_set" | "unverified_brief";

/** User-material claim withheld by the current-level receipt validator. */
export function isUnverifiedUserMaterial(observed: unknown): boolean {
  return typeof observed === "object" && observed !== null
    && (observed as { user_material_unverified?: unknown }).user_material_unverified === true;
}


/**
 * Map an edge's structured `provenance.source` enum to UI display vocabulary.
 *
 * - `brief_extraction` → `from_brief`
 * - `user_specified`   → `user_set`
 * - `cee_hypothesis` / `domain_knowledge` / absent / unknown → `ai_inferred`
 */
export function edgeProvenanceDisplay(source: unknown): Exclude<ProvenanceDisplay, "unverified_brief"> {
  if (source === "brief_extraction") return "from_brief";
  if (source === "user_specified") return "user_set";
  return "ai_inferred";
}

// ============================================================================
// ⭐ WHOSE NUMBER IS THIS? — projected from `observed_state.source`
// ============================================================================

/**
 * The legacy three-member node-source vocabulary. Declared here, beside the
 * display vocabulary it travels with, so the two projections of one stamp come
 * out of ONE table and cannot drift. `CompactNodeSource`
 * (`orchestrator/context/graph-compact.ts`) is an alias of this.
 */
export type ValueSourceDisplay = "user" | "assumption" | "system";

/** Both projections of one authorship stamp, emitted together. */
export interface ValueAuthorshipDisplay {
  /** Legacy `CompactNodeSource` vocabulary (context-pack-assembler, telemetry). */
  readonly source: ValueSourceDisplay;
  /** Display vocabulary (UI / coaching / LLM context). */
  readonly provenance: ProvenanceDisplay;
}

/**
 * ⭐ THE THIRD QUESTION OVER `observed_state.source`, NAMED APART FROM ITS TWO
 * SIBLINGS ON PURPOSE (CLAUDE.md trap 21).
 *
 * The estate already runs two exhaustive authorities over this vocabulary, and
 * a fix that folded this into either of them would be reconciling two
 * authorities that answer different questions:
 *
 *   `graph-readiness/obligation-provenance.ts`   → *may this gap be DEMANDED of
 *                                                  the user?*  (INV-P6)
 *   `decision-review/value-source-extraction-type.ts`
 *                                                → *how widely may the sampler
 *                                                   DRAW this number?*
 *   THIS FILE                                    → *whose number is this, as we
 *                                                   PRESENT it?*
 *
 * The third is not derivable from the other two, and the proof is one row:
 * `brief_extraction` and `user_override` are BOTH `user_stated` for the
 * obligation rule and BOTH `explicit` for the sampling rule, while here they
 * must stay APART — `from_brief` ("we read this in your brief") and `user_set`
 * ("you typed this") are different statements to make to a user, and collapsing
 * them is how a product tells someone it extracted a number they actually
 * corrected by hand.
 *
 * ── WHY THIS READS `source` AND NOT `extractionType` ──────────────────────
 *
 * `extractionType` has four members — `explicit | inferred | range | observed`
 * — and every one of them describes HOW THE EXTRACTION PIPELINE READ THE BRIEF.
 * There is no member meaning "the user typed this", so a user edit cannot be
 * expressed in that vocabulary at all: no writer in the estate updates it on a
 * user edit, and none could. Reading authorship off it therefore reports the
 * DRAFTING pipeline's account of a value that has since been overwritten.
 *
 * `observed_state.source` is the field the shared contract owns the vocabulary
 * for, the field every user-edit writer stamps (`USER_EDIT_SOURCE`), and the
 * one `orchestrator-v5/build-turn-context.ts` already names authoritative while
 * refusing the response-only `NodeV3.provenance`. The contract instructs
 * consumers to derive from it in as many words:
 *
 *   > Consumers should DERIVE their classifier/validator membership from this
 *   > list … while keeping their behaviour on UNKNOWN literals honest-neutral.
 *
 * ── ⚠⚠ WHY THIS DOES *NOT* SIMPLY OVERRIDE `extractionType` ────────────────
 *
 * The obvious implementation — "`source` is authoritative, so let it win" —
 * ships a regression, and the estate has already measured the defect it would
 * reopen. `source` is NOT independent evidence for its whole vocabulary:
 *
 *   `transforms/schema-v3.ts:361-362` SYNTHESISES it from `extractionType` for
 *   every drafted factor —
 *       `extractionType === 'inferred' ? 'cee_inference' : 'brief_extraction'`
 *   — coarsening four members into two. (It assigns through a VARIABLE, so a
 *   literal grep for `source: "cee_inference"` finds ZERO writers in this repo
 *   while the writer runs on every draft.)
 *
 * So for those two literals `source` is a LOSSY COPY of the field beside it,
 * and preferring the copy loses the `observed` / `range` distinctions the
 * original still carries. Worse, the copy goes STALE: the ROADMAP 2.972
 * withdrawal in `schema-v3.ts` rewrites `provenance` AND `extractionType` when
 * a node has not earned its brief claim, and does NOT rewrite
 * `observed_state.source`. A reader preferring `source` would therefore
 * resurrect exactly the claim that withdrawal exists to retract — through the
 * one field the withdrawal does not reach.
 *
 * That is not hypothetical. Measured on deployed build `41156fc` (14 Aug,
 * recorded at `repair/deterministic-sweep.ts:449-465`): a repair's own guess
 * shipped as `{value: 0, source: 'brief_extraction', extractionType:
 * 'observed'}` — *"the product claiming it had OBSERVED, FROM THE USER'S BRIEF,
 * a burnout of zero"*.
 *
 * ── THE RULE, THEREFORE ────────────────────────────────────────────────────
 *
 * `source` governs ONLY where it says something `extractionType` structurally
 * cannot. A literal that IS an `extractionType` member, or is synthesised from
 * one, defers (`null`) and the caller's existing `extractionType` mapping runs
 * byte-unchanged. The user-authorship literals have no `extractionType`
 * expression at all, so for them `source` is the only evidence there is.
 *
 * The blast radius is exactly that: the ONLY nodes whose projection moves are
 * those carrying an authorship stamp the old code could not have read.
 *
 * ── ⚠ AND WHAT "DEFERS" ACTUALLY MEANS, STATED PRECISELY ──────────────────
 *
 * The rule as implemented is PER-LITERAL. It is NOT conditional on
 * `extractionType` being present — the table decides from `source` alone, and
 * `null` hands the decision back to the caller whether or not the caller has
 * anything to decide with. Where the caller has nothing, its own default arm
 * runs: `system` / `ai_inferred`.
 *
 * That is reachable, and it is worth naming because it is the OPPOSITE harm in
 * miniature. Goal baselines minted at `schema-v3.ts:351-358` and by
 * `add-constraint.ts:909/939` carry `source: 'brief_extraction'` with NO
 * `extractionType`, and factors take the same shape whenever `extractionType`
 * is absent (`schema-v3.ts` writes that field only when defined). Such a value
 * defers to a field that says nothing and falls through to `ai_inferred` — so
 * a brief-stated goal is classified as the model's own guess.
 *
 * ⚠ IT IS DELIBERATELY NOT FIXED HERE, and the reason is not squeamishness.
 * Letting `brief_extraction` govern when `extractionType` is absent is exactly
 * the "let `source` win" move the whole section above refutes: the 2.972
 * withdrawal rewrites `extractionType` and leaves `source` standing, so
 * "`source` governs when `extractionType` is missing" would resurrect
 * retracted brief claims through the one field the withdrawal cannot reach.
 * Widening this predicate needs the withdrawal to reach `source` first, which
 * is a different lane's change.
 *
 * The misclassification is PRE-EXISTING, errs conservatively (it under-claims
 * on the user's behalf rather than over-claiming), and is contained: the
 * display-safe node projection in `orchestrator-v5/format/format-graph-for-
 * context.ts` carries ONLY `user_set` to the model precisely so this default
 * is not broadcast as a finding.
 *
 * ── DERIVED, NOT MIRRORED (CLAUDE.md trap 12) ─────────────────────────────
 *
 * Keyed `Record<KnownObservedStateSourceLiteral, …>`, exactly as both siblings
 * are, so the re-vendor that mints a thirteenth literal FAILS TYPECHECK here
 * rather than dropping it into a default arm that reads green. `null` is a
 * DECISION recorded per literal, not an absence — every member is listed.
 */
const SOURCE_AUTHORSHIP: Readonly<
  Record<KnownObservedStateSourceLiteral, ValueAuthorshipDisplay | null>
> = {
  // ── DEFER: synthesised from `extractionType`, so the original is richer ──
  // `schema-v3.ts:361-362` writes these two from `extractionType` itself.
  // Preferring them would coarsen `observed`/`range` away and would outlive
  // the 2.972 withdrawal, which rewrites `extractionType` and leaves these
  // standing. The caller's `extractionType` mapping is the finer instrument
  // AND the one the withdrawal keeps honest.
  brief_extraction: null,
  cee_inference: null,

  // ── DEFER: these ARE `extractionType` members, stamped into `source` ─────
  // The contract notes producers spell extraction types into this field too.
  // A restatement of the neighbouring field is not independent evidence, and
  // deferring keeps one authority for the brief-vs-inferred axis rather than
  // two that can disagree.
  explicit: null,
  inferred: null,

  // ── INDEPENDENT: the deterministic repair authored this value ────────────
  // `extractionType` has four members and no "repaired" class, so it cannot
  // express this. A repair's own number badged as the user's brief is the
  // measured 14 Aug defect above, in the other direction.
  cee_repair: { source: "assumption", provenance: "ai_inferred" },

  // ── The user, speaking directly. THE ARM THIS CHANGE EXISTS FOR ──────────
  // Contract provenance, verbatim:
  //   user             — Model-tab factor-value edits
  //   user_override    — typed value (UI edit surfaces AND CEE
  //                      set_factor_value / chat edits)
  //   user_confirmed   — "confirm as is"
  //   user_edited      — OutputsDock transition bridge
  //   user_calibration — inspector calibration
  user: { source: "user", provenance: "user_set" },

  // ⚠⚠ `user_override` GOVERNS ON A STAMP THIS REPO DOCUMENTS AS NOT A
  // SINGLE-MEANING RECEIPT. Read `FORGEABLE_USER_AUTHORSHIP_LITERALS` below
  // before changing this row — the gap is accepted here, deliberately, and the
  // reasoning is not obvious from this line.
  //
  //   `orchestrator/canonicalise-value-ops.ts` `stampUserEditProvenance`
  //   stamps `USER_EDIT_SOURCE` onto EVERY value-writing `update_node` op that
  //   reaches either edit seam — its own comment: *"An explicit LLM-claimed
  //   producer source on a value write is OVERRIDDEN."*
  //
  //   `orchestrator-v5/routing/mutation-consent.ts` records that `edit_graph`
  //   is *"genuinely UNCOVERED by withheld-consent enforcement"*, with
  //   `update_node` ops applying *"regardless of what the user's message asked
  //   for"* (gap ROADMAP 2.628a).
  //
  //   `cee/context-integrity/not-modelled-manifest.ts` states the consequence
  //   outright — *"`user_override` IS NOT A SINGLE-MEANING RECEIPT"* — one
  //   literal serving (a) a genuine user edit and (b) a MODEL-AUTHORED
  //   `update_node` op.
  //
  // So the header above is right about the VOCABULARY (`extractionType` cannot
  // express user authorship) and, for class (b), wrong about the STAMP.
  user_override: { source: "user", provenance: "user_set" },
  user_confirmed: { source: "user", provenance: "user_set" },
  user_edited: { source: "user", provenance: "user_set" },
  user_calibration: { source: "user", provenance: "user_set" },

  // ⚠ `user_assumption` ALONE is the user's declared guess ("mark as assumption"), so the bare literal
  // stays `user_set` HERE and `inferred` for the SAMPLING-WIDTH authority — a declared guess is sampled
  // as widely as a model's (PRECISION), but it is still the user's guess (AUTHORSHIP). Same literal, two
  // questions, two answers.
  //
  // ⭐ BUT THE LITERAL HAS TWO WRITERS, AND ONLY ONE OF THEM IS THE USER'S NUMBER. The approved adoption
  // of Olumi's proposed figure (`set-factor-value.ts`, `approved-adoption-context.ts`) writes the same
  // literal AND records the approval as `observed_state.reviewed_by_user` (`intent: 'confirm'`). That pair
  // is Olumi's figure, accepted — never the user's — and it is told apart by
  // {@link observedValueAuthorship}, which every reader of a whole `observed_state` calls (DL CR on
  // #2412 5921764485; served defect: guest `c708fca5`, #75 5921124922). This row answers for the bare
  // literal only.
  user_assumption: { source: "user", provenance: "user_set" },

  // ⚠ LOSSY, AND THE LOSS IS NAMED. `panel_elicited` is a named colleague's
  // answer, verified server-side by `collab/apply-verification.ts` before the
  // stamp is written. This vocabulary has three members and none of them means
  // "a colleague, not you", so the distinction is carried by `elicited_from`,
  // which is the field 0.40.0 minted for it and the field a surface needing the
  // identity must read.
  //
  // What is NOT in doubt is the direction: the most strongly attested
  // human-supplied number in the system must not be projected as the model's
  // own guess. `ai_inferred` would be a straightforward lie about the one value
  // we can prove a person gave us.
  panel_elicited: { source: "user", provenance: "user_set" },
};

/**
 * ⚠⚠ THE KNOWN GAP, PINNED AS AN EXPLICIT SET RATHER THAN LEFT AS PROSE.
 *
 * These are the literals whose `user_set` verdict above rests on a stamp that
 * CANNOT distinguish a genuine user edit from a model-authored `update_node`
 * op. For those writes this module tells the model *"the user supplied this
 * number"* about a value the user never supplied — the exact untruth the
 * surrounding change exists to remove, arriving through the stamp rather than
 * through the vocabulary.
 *
 * ── WHY THE GAP IS ACCEPTED RATHER THAN CLOSED HERE ───────────────────────
 * Because the alternative is worse, and measurably so. Making `user_override`
 * DEFER would restore the original defect for the COMMON case — the user
 * genuinely typing a number, which is what every edit seam is for — in
 * exchange for closing a rarer one. The honest fix is a SEPARABLE STAMP for
 * model-authored edit ops, which belongs to the lane that owns
 * `stampUserEditProvenance`, not to a display projection. That is the same
 * call `not-modelled-manifest.ts` made on the same gap, for the same reason,
 * and it is recorded there as a re-surface trigger rather than as a fix.
 *
 * ── WHY IT IS A SET AND NOT A SENTENCE ────────────────────────────────────
 * CLAUDE.md's honest-gap rule: a gap recorded in the SUITE is honest; a gap
 * visible only in prose is how the next session ships past it. Every test in
 * `graph-compact-user-authorship.test.ts` sits on the SAFE side of this
 * predicate, so nothing would go red if class (b) grew — this set plus its
 * spec is what makes growth observable. The spec asserts this set EXACTLY
 * (`toEqual`), so it REDs if a literal is added AND if one is removed, and it
 * anchors membership to `USER_EDIT_SOURCE` at the stamper itself so the named
 * re-surface trigger (*"`stampUserEditProvenance` gains a distinct stamp for
 * model-authored ops"*) fires here automatically rather than by memory.
 *
 * ── WHAT IS DELIBERATELY *NOT* IN THIS SET ────────────────────────────────
 * `panel_elicited` is server-VERIFIED against the collab store by
 * `collab/apply-verification.ts` before it is stamped, so it is the one
 * human-authorship literal with an independent receipt.
 *
 * ⚠⚠ AN EARLIER REVISION OF THIS PARAGRAPH ALSO SAID *"the remaining user
 * literals are written by surfaces that are not this stamper"*, AND THAT
 * SENTENCE IS WITHDRAWN. It reads as a safety property and is not one: it is a
 * claim about writers in OTHER repos, which this repo cannot verify, dressed as
 * a reason for leaving them unpinned. Measured here at this tip (`rg -a`,
 * `src/`, tests and the three classifier tables excluded, scoped to
 * `source:`/`SOURCE =` assignment shapes, with a CONTRAST CONTROL non-zero in
 * the same sweep — `brief_extraction` 25, `user_specified` 10):
 *
 *   user_override    6  ← the stamper (`USER_EDIT_SOURCE`) and its call sites
 *   panel_elicited   1  ← `system-events/factor-value-edit.ts:346`, gated on
 *                         `verifyAppliedFrom`
 *   user             0  ⚠ the single `= 'user'` hit in this repo is
 *                         `graph-compact.ts:714`, which writes the COMPACT node
 *                         `source` (`user | assumption | system`) — a different
 *                         field in a different vocabulary, not this stamp
 *   user_confirmed   0
 *   user_edited      0
 *   user_calibration 0
 *   user_assumption  0
 *
 * ⚠ SCOPE, STATED NARROWLY (CLAUDE.md trap 20): that is *no assignment site
 * found in this repo's `src/` at this tip, by the shapes swept*. It is NOT
 * "these literals are never written" — `schema-v3.ts:361-362` proves this
 * estate assigns through VARIABLES, which a literal sweep cannot see, and a
 * filesystem sweep cannot reach another repo or an unmerged branch.
 *
 * So the five below are not KNOWN-SAFE and not KNOWN-FORGEABLE: they are
 * UNVERIFIABLE FROM HERE. That is a third state, and collapsing it into either
 * of the other two is how an absence of evidence becomes evidence of absence.
 */
export const FORGEABLE_USER_AUTHORSHIP_LITERALS: ReadonlySet<KnownObservedStateSourceLiteral> =
  new Set<KnownObservedStateSourceLiteral>(["user_override"]);

/**
 * ⚠⚠ THE KNOWN-UNPINNED SET — the literals that project to `user_set` on
 * evidence this repo does not hold.
 *
 * ── WHY THIS EXISTS AS A SET AND NOT AS PROSE ─────────────────────────────
 * `FORGEABLE_USER_AUTHORSHIP_LITERALS` records a gap we have MEASURED: one
 * literal, written by a stamper in this repo, whose stamp cannot distinguish a
 * genuine user edit from a model-authored `update_node` op. These five are a
 * different thing — we have measured NOTHING about them, because nothing in
 * this repo writes them (see the census above). Their `user_set` verdict rests
 * on the shared contract's documentation of what other surfaces mean by them,
 * and CEE cannot check that.
 *
 * ⛔ THEY ARE DELIBERATELY *NOT* FOLDED INTO THE FORGEABLE SET. Forgeability is
 * a specific, evidenced claim about `stampUserEditProvenance`; asserting it of a
 * literal nothing here writes would be a fabricated finding, and a gap set that
 * named every `user_set` literal would be unfalsifiable-by-breadth — it would
 * "cover" the gap by declaring everything suspect, which records nothing. The
 * two sets are kept apart for the same reason the three authorities over this
 * vocabulary are kept apart (CLAUDE.md trap 21): they answer different
 * questions — *"is this stamp forgeable?"* versus *"has anyone here checked?"*
 *
 * ── THE RE-SURFACE TRIGGER, MECHANICAL RATHER THAN REMEMBERED ─────────────
 * The spec asserts this set EXACTLY (`toEqual`), so it REDs if a literal is
 * added AND if one is removed, and a companion PARTITION assertion REDs if any
 * `user_set`-projecting literal is in NEITHER set nor the receipted one. So the
 * day CEE gains a writer for one of these — or the contract mints a thirteenth
 * literal that lands on `user_set` — the suite forces the decision here instead
 * of letting it default to green.
 */
export const UNVERIFIED_USER_AUTHORSHIP_LITERALS: ReadonlySet<KnownObservedStateSourceLiteral> =
  new Set<KnownObservedStateSourceLiteral>([
    "user",
    "user_confirmed",
    "user_edited",
    "user_calibration",
    "user_assumption",
  ]);

/**
 * Project one `observed_state.source` stamp, or `undefined` when this stamp is
 * not the authority for the question — because it is absent, outside the
 * declared vocabulary, or a restatement of `extractionType` (see the table).
 *
 * ⚠ THE THREE CASES COLLAPSE TO ONE ANSWER ON PURPOSE. All three mean *"do not
 * decide authorship from this field"*, and the caller's existing behaviour is
 * the correct response to each. Absence in particular is the contract's own
 * instruction rather than a convenience — from `ObservedStateSchema.source`:
 *
 *   > Absence means the producer stamped no provenance — a consumer MUST NOT
 *   > read absence as any particular class; classify unknown/absent as neutral,
 *   > never guess.
 *
 * The wire field is `z.string()` by deliberate contract design, so this takes
 * `unknown` and never assumes a parse.
 */
export function valueSourceAuthorship(source: unknown): ValueAuthorshipDisplay | undefined {
  if (typeof source !== "string") return undefined;
  if (Object.prototype.hasOwnProperty.call(SOURCE_AUTHORSHIP, source)) {
    return SOURCE_AUTHORSHIP[source as KnownObservedStateSourceLiteral] ?? undefined;
  }
  return undefined;
}

/** An approved adoption's pair: Olumi's number, accepted — see {@link isAcceptedOlumiEstimate}. */
const ACCEPTED_OLUMI_ESTIMATE: ValueAuthorshipDisplay = { source: "assumption", provenance: "ai_inferred" };

/**
 * ⭐ ORIGIN AND ACCEPTANCE ARE TWO FACTS: is this `observed_state` Olumi's figure the user ACCEPTED?
 *
 * True only for the approved adoption's pair — `source: 'user_assumption'` WITH the approval its writer records,
 * `reviewed_by_user.intent === 'confirm'` (`set-factor-value.ts`). The bare literal is the user's own declared guess
 * and stays theirs; a link-pairing quote (`confirm_pairing`) is not the acceptance of a figure. Takes `unknown`: the
 * wire field is `z.string()` and the review is optional, so nothing is assumed parsed.
 */
export function isAcceptedOlumiEstimate(observed: unknown): boolean {
  if (typeof observed !== "object" || observed === null) return false;
  const o = observed as { source?: unknown; reviewed_by_user?: unknown };
  const review = o.reviewed_by_user;
  return o.source === "user_assumption"
    && typeof review === "object" && review !== null
    && (review as { intent?: unknown }).intent === "confirm";
}

/**
 * The table as data, exported so a test can assert it against the contract's
 * own literal list and against the two sibling authorities. Not for product
 * use — call {@link valueSourceAuthorship}.
 */
export const SOURCE_AUTHORSHIP_TABLE: Readonly<
  Record<KnownObservedStateSourceLiteral, ValueAuthorshipDisplay | null>
> = SOURCE_AUTHORSHIP;


// ============================================================================
// The readiness ladder vocabulary (moved verbatim from `cee/graph-readiness/obligation-provenance.ts`, which re-exports it)
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
 * Strength authorship follows the MEAN (Science FD, 5 Oct 2026). A marked user
 * natural effect earns credit even when spread or existence was projected.
 * An Olumi magnitude never earns credit from the link's structural source.
 * ⛔ UNMARKED links (AIE 6121121310, ONE PROVENANCE AUTHORITY): a link the person or their brief drew
 * ({@link linkProvenanceOf} `human`) keeps R11's rule exactly (`user_stated`, `defaulted` → `ai_drafted`); anything else is
 * `unattributed` — never Olumi's wholesale (R11 read an AI drawing stamp as Olumi's size).
 */
export function edgeStrengthProvenance(edge: unknown): StructureProvenance {
  const record = asRecord(edge);
  const stamp = asRecord(record?.provenance);
  const sizing = linkSizing(edge);
  if (sizing === 'user' && (stamp?.source === 'user_specified'
    || stamp?.reading === 'agent_proposed_user_confirmed'
    || asRecord(stamp?.natural_effect) !== null)) return 'user_stated';
  if (stamp?.magnitude === 'user_stated' || sizing === 'placeholder'
    || sizing === 'olumi_estimate' || sizing === 'olumi_accepted') return 'ai_drafted';
  if (linkProvenanceOf(edge).origin !== 'human') return 'unattributed';
  return record?.defaulted === true ? 'ai_drafted' : 'user_stated';
}

/**
 * ⭐ R11 — WHETHER THE USER HAS REVIEWED A LINK'S STRENGTH (a confirm: `provenance.reviewed_by_user`, written by
 * `adjust-edge-strength.ts`). Review is not authorship (`edgeStrengthProvenance` still gives no credit), but it IS the
 * user's settled view of that figure: a consumer that would re-derive the size, ask about it again, or flag it as an
 * unseen default treats a reviewed link as settled. One predicate, so those consumers cannot disagree.
 */
export function edgeReviewedByUser(edge: unknown): boolean {
  const review = asRecord(asRecord(asRecord(edge)?.provenance)?.reviewed_by_user);
  return review !== null && review !== undefined && review.intent === 'confirm';
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
// Link sizing (moved verbatim from `cee/magnitude/link-sizing.ts`, which re-exports it)
// ============================================================================

export type LinkSizing = 'user' | 'placeholder' | 'olumi_accepted' | 'olumi_estimate' | 'unmarked';

/** The writer's own literal for a link nobody sized (`cee-v3.ts` `magnitude`). */
export const PLACEHOLDER_MAGNITUDE = 'olumi_placeholder';
/** The literal an approval writes on a placeholder whose band the user approved: Olumi's size, now chosen. */
export const ESTIMATE_MAGNITUDE = 'olumi_estimate';

function reviewedByUser(p: Rec): boolean {
  const r = p.reviewed_by_user;
  return isRec(r) && r.intent === 'confirm';
}

/**
 * The default doors (Science 393023 LICENCE (b), 7 Oct 20:48Z): every producer that writes a size nobody chose writes
 * `defaulted: true` and the tag; this table is how the reader still knows the links a door wrote before it tagged.
 * One row per door, never only `hypothesisEdgeValue`'s. A bare 0.5 with no `defaulted` is never matched: a user's 0.5
 * must never read as a placeholder.
 */
export const DOOR_DEFAULT_CONSTANTS: ReadonlyArray<{ readonly door: string; readonly mean: number; readonly std: number }> = [
  { door: 'hypothesisEdgeValue (+ Option / + Risk / add-factor)', mean: STRENGTH_DEFAULT_SIGNATURE.mean, std: STRENGTH_DEFAULT_SIGNATURE.std },
  { door: 'factor enricher (enricher.ts)', mean: 0.5, std: 0.2 },
];

function isUntaggedDoorDefault(edge: unknown, p: Rec | undefined): boolean {
  if (p?.magnitude !== undefined || p?.natural_effect !== undefined) return false;
  if (!isRec(edge) || edge.defaulted !== true || !isRec(edge.strength)) return false;
  const { mean, std } = edge.strength;
  return typeof mean === 'number' && DOOR_DEFAULT_CONSTANTS.some((d) => Math.abs(mean) === d.mean && std === d.std);
}

/**
 * Order (Science 393023 LICENCE rulings 1-2, 7 Oct 20:48Z):
 *   1. `magnitude: 'user_stated'`: the user stated the size.
 *   2. `mean_projected`: a projected mean is unsized WHATEVER its magnitude or natural_effect (a contradictory record
 *      fails closed: a misreading may only withhold or range) and whatever its source (`user_specified` + a projected
 *      mean = the user drew the link but gave no number).
 *   3. `source: 'user_specified'`.
 *   4. the tag, the other `olumi_*` classes, then the untagged door constants ({@link DOOR_DEFAULT_CONSTANTS}).
 */
export function linkSizing(edge: unknown): LinkSizing {
  const p = isRec(edge) && isRec(edge.provenance) ? edge.provenance : undefined;
  if (p?.magnitude === 'user_stated') return 'user';
  if (p?.mean_projected === true) return 'placeholder';
  if (p?.source === 'user_specified') return 'user';
  if (p?.magnitude === PLACEHOLDER_MAGNITUDE) return 'placeholder';
  if (typeof p?.magnitude === 'string' && p.magnitude.startsWith('olumi_')) return reviewedByUser(p) ? 'olumi_accepted' : 'olumi_estimate';
  if (isUntaggedDoorDefault(edge, p)) return 'placeholder';
  return 'unmarked';
}

// ============================================================================
// ⭐⭐ THE ONE RULE — provenanceOf
// ============================================================================

/** Whose figure: the person's, Olumi's, or not established. Three, never two (see the module header). */
export type Origin = 'human' | 'ai' | 'unknown';

export interface Provenance {
  readonly origin: Origin;
  /** `ai` only: the person accepted Olumi's figure — still Olumi's estimate, accepted (never the person's). */
  readonly accepted: boolean;
  /** `ai` only: a structural definition (the event-by-date switch; a link from an option or decision; a validated
   *  definition), never an input estimate — never counted, never disclosed as unverified. */
  readonly structural: boolean;
  /** `human` only: declared as their assumption (`user_assumption`), not stated. */
  readonly ratified: boolean;
  /** `ai` only: written by a system repair (`cee_repair`). */
  readonly repaired: boolean;
  /** `ai` only (links): Olumi's placeholder — nobody sized it. */
  readonly placeholder: boolean;
  /** The figure's ROLE: `verified` for the person's figure; `unverified` for a human-written figure whose role is not
   *  verified (`user_material_unverified`; AIE 0825 §2); `n/a` for Olumi's and for an unestablished origin. */
  readonly role: Role;
  /**
   * `human` only: the person's BY ITS STAMP ALONE — a type-less `brief_extraction`, which no writer attested against the
   * person's words (the last check's BLOCKING 1–2: the level-target path, single-entry option levels, the legacy prose
   * extractor and the V2/V3 draft transforms write it for figures nobody said). ⛔ LABEL, NEVER WITHHOLD (DL 12 Oct; Paul's
   * test, 12 Oct): every gate keeps staging's reading (the person's), so no chance staging shows is newly withheld; the
   * goal-chance census ({@link inputOriginOf}, `settingOriginOf`) discloses it as unverified, so a chance resting on it is
   * shown provisional with its note. A figure is attested with `extractionType: 'explicit'` (the typed door; admission's
   * receipt), which never carries this flag. Present only when true.
   */
  readonly stampOnly?: true;
}

export type Role = 'verified' | 'unverified' | 'n/a';

const P = (origin: Origin, flags: Partial<Omit<Provenance, 'origin'>> = {}): Provenance => ({
  origin, accepted: false, structural: false, ratified: false, repaired: false, placeholder: false,
  role: origin === 'human' ? 'verified' : 'n/a', ...flags,
});

/** The person's figure, verified in its role — the only `human` any projection names as theirs. */
const verifiedHuman = (p: Provenance): boolean => p.origin === 'human' && p.role === 'verified';

/** Disclosed as unverified: an unestablished origin, or a human-written figure whose role is unverified. */
export function isUnverifiedProvenance(p: Provenance): boolean {
  return p.origin === 'unknown' || (p.origin === 'human' && p.role === 'unverified');
}

export type ProvenanceSubject =
  | { readonly value: unknown }
  | { readonly setting: unknown; readonly target?: unknown }
  | { readonly link: unknown; readonly context?: LinkContext };

/** THE one question, for a starting value (`observed_state`), an option setting (its cell, and the node it sets) or a link. */
export function provenanceOf(subject: ProvenanceSubject): Provenance {
  if ('value' in subject) return valueProvenanceOf(subject.value);
  if ('setting' in subject) return settingProvenanceOf(subject.setting, subject.target);
  return linkProvenanceOf(subject.link, subject.context);
}

// ── Starting values ─────────────────────────────────────────────────────────

const UNKNOWN_DISPLAY: ValueAuthorshipDisplay = { source: 'system', provenance: 'unverified_brief' };
const OLUMI_DISPLAY: ValueAuthorshipDisplay = { source: 'system', provenance: 'ai_inferred' };
/** The extraction type's own pair (the compactor's original chain, unchanged). */
const EXTRACTION_DISPLAY: Readonly<Record<'explicit' | 'observed' | 'inferred' | 'range', ValueAuthorshipDisplay>> = {
  explicit: { source: 'user', provenance: 'from_brief' },
  observed: { source: 'system', provenance: 'from_brief' },
  inferred: { source: 'assumption', provenance: 'ai_inferred' },
  range: { source: 'system', provenance: 'ai_inferred' },
};
/**
 * HUMAN by a stamp, where no extraction type decides. ⚠ `brief_extraction` here is the person's BY ITS STAMP ALONE
 * (`stampOnly`, below): every gate reads it as staging does; the goal-chance census discloses it as unverified.
 */
const HUMAN_VALUE_STAMP: Readonly<Record<string, ValueAuthorshipDisplay>> = {
  brief_extraction: EXTRACTION_DISPLAY.explicit,
  explicit: EXTRACTION_DISPLAY.explicit,
  observed: EXTRACTION_DISPLAY.observed,
  user_specified: { source: 'user', provenance: 'user_set' },
};
/**
 * AI by a stamp, where no extraction type decides: the recognised AI sources only (the census's rule, DL AMEND / AIE R5
 * item 1 — and the ladder's, the blocker label's and the licence's since before it).
 * ⚠ FOR THE DL / AIE: S7 (AIE #94 6094306696, #2949, 10 Oct) pinned F1 reading the ABSENT-type `cee_inference` carrier
 * (legacy, or a withdrawn brief stamp) as `unknown`. The one rule reads it as Olumi's, as every other reader already did;
 * holding S7 instead is this one row (delete `cee_inference` here): the census then discloses it as unverified, and the
 * blocker label, the ladder and `estimate_only` stop calling it Olumi's.
 */
const AI_VALUE_STAMP: Readonly<Record<string, ValueAuthorshipDisplay>> = {
  cee_inference: OLUMI_DISPLAY,
  inferred: EXTRACTION_DISPLAY.inferred,
  range: EXTRACTION_DISPLAY.range,
  cee_hypothesis: OLUMI_DISPLAY,
  domain_knowledge: OLUMI_DISPLAY,
};
/** The person's own DECLARED assumption: theirs, ratified rather than stated (`user_confirmed` is Olumi's, accepted, above). */
const RATIFIED_VALUE_LITERALS: ReadonlySet<string> = new Set(['user_assumption']);

interface ValueReading { readonly provenance: Provenance; readonly display: ValueAuthorshipDisplay }

function readValue(observed: unknown): ValueReading | undefined {
  const os = rec(observed);
  if (os === undefined) return undefined;
  // A human-written figure whose ROLE is unverified (AIE 0825 §2): origin human, never Olumi's, never a verified figure —
  // whatever stamp the write side put beside the receipt (today `cee_inference` + `inferred`). Said "Not confirmed".
  if (isUnverifiedUserMaterial(os)) return { provenance: P('human', { role: 'unverified' }), display: UNKNOWN_DISPLAY };
  if (isAcceptedOlumiEstimate(os)) return { provenance: P('ai', { accepted: true }), display: ACCEPTED_OLUMI_ESTIMATE };
  // `user_confirmed`: the person CONFIRMED Olumi's figure (its writers — the identity confirm's net zero, the ceiling
  // stock's zero — stamp a number Olumi proposed). "The number is still ours" (B3-8; `constraint-feasibility.ts`): Olumi's
  // origin, accepted — never the person's own figure. (F1 and the display table used to call it the person's.)
  if (os.source === 'user_confirmed') return { provenance: P('ai', { accepted: true }), display: ACCEPTED_OLUMI_ESTIMATE };
  // The event-by-date switch's own 0: "this option is not adding capacity today" — its definition, never an estimate.
  if (isEventByDateSwitchState(os)) return { provenance: P('ai', { structural: true }), display: OLUMI_DISPLAY };
  // The person's own stamps (and a system repair) decide by themselves (`SOURCE_AUTHORSHIP`).
  const stamped = valueSourceAuthorship(os.source);
  if (stamped !== undefined) {
    return stamped.provenance === 'user_set'
      ? { provenance: P('human', { ratified: RATIFIED_VALUE_LITERALS.has(os.source as string) }), display: stamped }
      : { provenance: P('ai', { repaired: true }), display: stamped };
  }
  // Every other stamp DEFERS to the extraction type, the finer instrument; a present but unrecognised one is unknown.
  const et = os.extractionType;
  if (et === 'explicit' || et === 'observed') return { provenance: P('human'), display: EXTRACTION_DISPLAY[et] };
  if (et === 'inferred' || et === 'range') return { provenance: P('ai'), display: EXTRACTION_DISPLAY[et] };
  if (et !== undefined) return { provenance: P('unknown'), display: UNKNOWN_DISPLAY };
  // The existing source-bound writer of a share-by-date team share (`team-share-write.ts` `teamObservedState`,
  // `event-by-date-model.ts` `withEventShareDate`): its value is COMPUTED from the person's own stated team time, held
  // beside it as `stated_time`. An Olumi-assumed range makes the computed level Olumi's estimate, not the person's figure.
  const statedTime = rec(os.stated_time);
  if (statedTime?.quantity === 'months_to_finish') return statedTime.range_origin === 'olumi_estimate'
    ? { provenance: P('ai'), display: OLUMI_DISPLAY }
    : { provenance: P('human'), display: HUMAN_VALUE_STAMP.user_specified! };
  const src = typeof os.source === 'string' ? os.source : undefined;
  if (src !== undefined && Object.prototype.hasOwnProperty.call(HUMAN_VALUE_STAMP, src)) {
    return { provenance: P('human', src === 'brief_extraction' ? { stampOnly: true } : {}), display: HUMAN_VALUE_STAMP[src]! };
  }
  if (src !== undefined && Object.prototype.hasOwnProperty.call(AI_VALUE_STAMP, src)) return { provenance: P('ai'), display: AI_VALUE_STAMP[src]! };
  return { provenance: P('unknown'), display: UNKNOWN_DISPLAY };
}

/** A starting value's provenance (`observed_state`). Not a record → `unknown`. */
export function valueProvenanceOf(observed: unknown): Provenance {
  return readValue(observed)?.provenance ?? P('unknown');
}

/**
 * The value's display pair (`source` + `provenance`) — the compactor, both decision-review arms and every receipt read
 * this. Total for any record (an `unknown` origin says `unverified_brief`, never `ai_inferred`); `undefined` only when
 * there is no `observed_state` record at all.
 */
export function observedValueAuthorship(observed: unknown): ValueAuthorshipDisplay | undefined {
  return readValue(observed)?.display;
}

/**
 * The wire's node `provenance` (the canvas label). A node that HOLDS a figure says that figure's provenance; a node
 * with no figure keeps its extraction type's display (the original rule: `explicit` / `observed` → `from_brief`, else
 * `ai_inferred`), and an unverified user-material receipt says `unverified_brief`.
 */
export function nodeProvenanceDisplay(extractionType: unknown, observed?: unknown): ProvenanceDisplay {
  const os = rec(observed);
  if (os !== undefined && (finite(os.value) || finite(os.raw_value))) return readValue(os)!.display.provenance;
  if (isUnverifiedUserMaterial(observed)) return 'unverified_brief';
  if (extractionType === 'explicit' || extractionType === 'observed') return 'from_brief';
  return 'ai_inferred';
}

/** F1's vocabulary (`guidance-signals.ts` `ValueAuthorship`): a structural definition is not an estimate, nor the person's. */
export type ValueAuthorship = 'yours' | 'olumi_estimate' | 'olumi_accepted' | 'unknown';

export function valueAuthorshipOf(observed: unknown): ValueAuthorship {
  const p = valueProvenanceOf(observed);
  // A figure that is the person's by its stamp alone is never said to be theirs here (F1 said `unknown` on staging too).
  if (verifiedHuman(p)) return p.stampOnly === true ? 'unknown' : 'yours';
  if (p.origin === 'ai' && !p.structural) return p.accepted ? 'olumi_accepted' : 'olumi_estimate';
  return 'unknown';
}

/** The census's vocabulary (`goal-chance-estimate-attribution.ts`); the switch's 0 is excluded there by its own marker. */
export type InputOrigin = 'human' | 'ai' | 'ai_accepted' | 'unverified';

export function inputOriginOf(observed: unknown): InputOrigin {
  const p = valueProvenanceOf(observed);
  // A figure that is the person's by its stamp alone is disclosed as unverified here — the chance is labelled, never withheld.
  return verifiedHuman(p) && p.stampOnly !== true ? 'human' : p.origin === 'ai' ? (p.accepted ? 'ai_accepted' : 'ai') : 'unverified';
}

/** Whose figure the model holds, in the receipts' owners (`write-outcome.ts` `NotSavedValue.still.owner`). */
export type HeldFigureOwner = 'yours' | 'brief' | 'olumi' | 'olumi_accepted' | 'unverified_brief';

export function heldFigureOwnerOf(observed: unknown): HeldFigureOwner | undefined {
  const reading = readValue(observed);
  if (reading === undefined) return undefined;
  if (reading.provenance.origin === 'ai' && reading.provenance.accepted) return 'olumi_accepted';
  const display = reading.display.provenance;
  return display === 'unverified_brief' ? 'unverified_brief' : display === 'user_set' ? 'yours' : display === 'from_brief' ? 'brief' : 'olumi';
}

// ── Option settings ─────────────────────────────────────────────────────────

/** HUMAN by positive attestation: the person's own setting stamps (`InterventionV3.source`'s human members). */
const HUMAN_SETTING_STAMPS: ReadonlySet<string> = new Set(['user_specified', 'brief_extraction']);
/**
 * ⚠ A `brief_extraction` cell without `extractionType: 'explicit'` beside it is the person's BY ITS STAMP ALONE
 * (`stampOnly`): the stamp is written by unverified doors too (single-entry option levels, `admit-model.ts`; the legacy prose
 * extractor). Every gate reads it as staging does; the goal-chance census discloses it as unverified (LABEL, NEVER WITHHOLD).
 */
const STAMP_ONLY_BRIEF_CELL = (cell: unknown): boolean => rec(cell)?.source === 'brief_extraction' && rec(cell)?.extractionType !== 'explicit';
/** AI ORIGIN: the recognised AI sources only. Mere absence from the human set is NOT AI origin. */
const AI_SETTING_STAMPS: ReadonlySet<string> = new Set(['cee_hypothesis', 'domain_knowledge', 'cee_inference']);

const cellFigure = (cell: unknown): number | undefined => {
  const v = typeof cell === 'number' ? cell : rec(cell)?.value;
  return finite(v) ? v : undefined;
};

/**
 * ⛔ THE ONE NAMED STRUCTURAL MARKER for a sourceless option cell: THE EVENT-BY-DATE SWITCH. `admitEventByDate`
 * (`event-by-date-model.ts`) writes `{ value: 1 }` on each option's own switch and `{ value: 0 }` on every other — no
 * `source`: the option turning the switch on IS what the switch means. Its marker is the switch node's own
 * `observed_state.extra_share_by_date`, and only a 0 or a 1 is that definition.
 */
export function isEventByDateSwitchCell(cell: unknown, target: unknown): boolean {
  const v = cellFigure(cell);
  return (v === 0 || v === 1) && rec(rec(rec(target)?.observed_state)?.extra_share_by_date) !== undefined;
}

function isEventByDateSwitchState(os: Rec): boolean {
  return os.value === 0 && rec(os.extra_share_by_date) !== undefined;
}

/** The same marker on the switch node's OWN starting value (`{ value: 0, …, extra_share_by_date }`): its definition. */
export function isEventByDateSwitchValue(node: unknown): boolean {
  const os = rec(rec(node)?.observed_state);
  return os !== undefined && isEventByDateSwitchState(os);
}

/**
 * An option cell's provenance. HUMAN only on a human stamp nothing contradicts (`estimate: true` is Olumi's draft-widening
 * level, "never user-authored": a human stamp beside it is contradictory, so `unknown`); AI only on a recognised AI stamp
 * (an approved Olumi level keeps `cee_hypothesis`: there is no acceptance marker on a cell); the event-by-date switch is
 * structural; anything else — missing, unrecognised (a legacy `user`) — `unknown`.
 */
export function settingProvenanceOf(cell: unknown, target?: unknown): Provenance {
  // A setting the drafter called the user's that construction could not credit: UNKNOWN, whatever the non-user stamp beside
  // it, exactly as `observed_state.user_material_unverified` (capacity authorship row 7, DL 14 Oct).
  if (rec(cell)?.user_material_unverified === true) return P('unknown');
  const source = rec(cell)?.source;
  if (typeof source === 'string') {
    if (HUMAN_SETTING_STAMPS.has(source)) {
      return rec(cell)?.estimate === true ? P('unknown') : P('human', STAMP_ONLY_BRIEF_CELL(cell) ? { stampOnly: true } : {});
    }
    return AI_SETTING_STAMPS.has(source) ? P('ai') : P('unknown');
  }
  return isEventByDateSwitchCell(cell, target) ? P('ai', { structural: true }) : P('unknown');
}

/** The setting's display: the brief's (`from_brief`), the person's (`user_set`), Olumi's (`ai_inferred`) or not established. */
export function settingDisplayOf(cell: unknown, target?: unknown): ProvenanceDisplay {
  const p = settingProvenanceOf(cell, target);
  if (p.origin === 'human') return rec(cell)?.source === 'brief_extraction' ? 'from_brief' : 'user_set';
  return p.origin === 'ai' ? 'ai_inferred' : 'unverified_brief';
}

/** The setting in the census / panel vocabulary (`olumiEstimatesFeedingResult`'s `optionSettings[].authorship`). */
export function settingAuthorshipOf(cell: unknown, target?: unknown): 'user' | 'olumi_estimate' | 'unknown' | 'structural' {
  const p = settingProvenanceOf(cell, target);
  return p.structural ? 'structural' : p.origin === 'human' ? 'user' : p.origin === 'ai' ? 'olumi_estimate' : 'unknown';
}

// ── Links ───────────────────────────────────────────────────────────────────

/** What the caller knows about a link beyond the edge record (the module reads no graph). */
export interface LinkContext {
  /** The `kind` of the node the link leaves: an option's or a decision's link is the model's structure, not a size. */
  readonly fromKind?: unknown;
  /** The link is a VALIDATED definition (`held-user-links.ts` `validatedDefinitionForGraph`): exact, whoever flagged it. */
  readonly validatedDefinition?: boolean;
}

/**
 * A link's SIZE provenance. Sized: by `linkSizing` (the person's size → `human`; Olumi's → `ai`, accepted or not; a
 * placeholder → `ai` with `placeholder`). UNMARKED (AIE 6121121310): never `ai` wholesale and never dropped — the existing
 * proven meaning where there is one: a validated definition, or a link from an option or decision → structural; a link
 * the person or their brief drew (R11's source rule: a stamp the ladder credits as `user_stated` — `brief_extraction`,
 * `user_specified`, the person's own literals) → `human`, as readiness has always read it; otherwise (no stamp, an AI
 * drawing stamp, an unrecognised one) `unknown`, disclosed. (`isUserStatedLink`, the licence's "your link" class for
 * holds, is NARROWER: a brief link only WITH its evidence — always a subset of this `human`.)
 */
export function linkProvenanceOf(edge: unknown, context: LinkContext = {}): Provenance {
  switch (linkSizing(edge)) {
    case 'user': return P('human');
    case 'olumi_estimate': return P('ai');
    case 'olumi_accepted': return P('ai', { accepted: true });
    case 'placeholder': return P('ai', { placeholder: true });
    default: break;
  }
  if (context.validatedDefinition === true || context.fromKind === 'option' || context.fromKind === 'decision') {
    return P('ai', { structural: true });
  }
  const drawnBy = isRec(edge) && isRec(edge.provenance) ? classifyValueSource(edge.provenance.source) : 'unattributed';
  return drawnBy === 'user_stated' ? P('human') : P('unknown');
}

/**
 * WHO DREW A LINK, as the model's compact context says it (`CompactEdge.provenance`; moved from `graph-compact.ts`, which
 * read the drawing stamp itself). The four recognised drawing stamps keep their existing words exactly. Any other stamp,
 * or none, used to say `ai_inferred` wholesale; it now says what the stamp's class establishes — Olumi's for a structural
 * link or an AI / repair stamp, the person's for a person's stamp, otherwise `unverified_brief` (AIE 6121121310: never
 * `ai` wholesale). `raw` is the unrecognised stamp, kept for diagnostics as before.
 */
export function linkDrawingDisplayOf(edge: unknown, context: LinkContext = {}): { readonly provenance: ProvenanceDisplay; readonly raw?: string } {
  const src = isRec(edge) && isRec(edge.provenance) ? edge.provenance.source : undefined;
  if (src === 'brief_extraction') return { provenance: 'from_brief' };
  if (src === 'user_specified') return { provenance: 'user_set' };
  if (src === 'cee_hypothesis' || src === 'domain_knowledge') return { provenance: 'ai_inferred' };
  // WHO DREW IT, not whose size it is (that is `linkSizing` / `linkProvenanceOf`, carried beside it): an option's or a
  // decision's link is the model's structure (Olumi's); otherwise the stamp's own class, and nothing established says so.
  const structural = context.validatedDefinition === true || context.fromKind === 'option' || context.fromKind === 'decision';
  const drawnBy = classifyValueSource(src);
  const provenance: ProvenanceDisplay = structural || drawnBy === 'ai_drafted' || drawnBy === 'system_repaired' ? 'ai_inferred'
    : drawnBy === 'user_stated' ? 'user_set' : 'unverified_brief';
  return typeof src === 'string' && src.length > 0 ? { provenance, raw: src } : { provenance };
}

/**
 * The licence's "the user's link" class: the user sized it, or their brief stated it WITH its evidence. Science d5 #87
 * 6008444863: a `brief_extraction` edge without its `source_quote` may be a drafter-invented mediator, never "your link".
 * (Moved verbatim from `held-user-links.ts`, which re-exports it.)
 */
export function isUserStatedLink(e: unknown): boolean {
  if (!isRec(e)) return false;
  if (linkSizing(e) === 'user') return true;
  const p = e.provenance;
  return isRec(p) && p.source === 'brief_extraction' && typeof p.source_quote === 'string' && p.source_quote.trim() !== '';
}

// ── The readiness ladder's projections (the obligation authority's five classes) ────────────────────────────

/** A value's ladder class FROM its provenance — the readiness authority now agrees with every other reader. */
export function valueLadderOf(p: Provenance): StructureProvenance {
  if (verifiedHuman(p)) return p.ratified ? 'user_ratified' : 'user_stated';
  // An accepted Olumi estimate is a human act on Olumi's figure: ratified, never stated (`user_ratified`).
  if (p.origin === 'ai') return p.accepted ? 'user_ratified' : p.repaired ? 'system_repaired' : 'ai_drafted';
  return 'unattributed';
}

/** {@link valueLadderOf} of an `observed_state`: the replacement for `classifyValueSource(observed_state.source)`. */
export function valueClassOf(observed: unknown): StructureProvenance {
  return valueLadderOf(valueProvenanceOf(observed));
}

/** An option setting's ladder class FROM its provenance. */
export function settingClassOf(cell: unknown, target?: unknown): StructureProvenance {
  const p = settingProvenanceOf(cell, target);
  return p.origin === 'human' ? 'user_stated' : p.origin === 'ai' ? 'ai_drafted' : 'unattributed';
}

// ── Named questions over the one answer (each reader's own question, answered from `provenanceOf`) ──────────

/** A stamp-only caller's input, read as the `observed_state` it came from (a bare stamp is a state with no extraction type). */
const asObserved = (observedOrStamp: unknown): unknown =>
  typeof observedOrStamp === 'string' ? { source: observedOrStamp } : observedOrStamp;

/** {@link valueClassOf} for a caller that holds a whole `observed_state` OR (legacy) only its stamp. */
export function valueClassOfStateOrStamp(observedOrStamp: unknown): StructureProvenance {
  return valueClassOf(asObserved(observedOrStamp));
}

/** The person's OWN figure: stated, or declared as their own assumption — never a confirmation of Olumi's figure and never
 *  Olumi's estimate they accepted (`placeholder-parts.ts`'s "the user's own number"). */
export function isPersonsOwnValue(observed: unknown): boolean {
  const p = valueProvenanceOf(observed);
  return verifiedHuman(p) && (!p.ratified || rec(observed)?.source === 'user_assumption');
}

/** The person's own setting (or a setting's own range, which carries the same stamp vocabulary). */
export function isPersonsOwnSetting(cell: unknown, target?: unknown): boolean {
  return settingProvenanceOf(cell, target).origin === 'human';
}

/** A figure held as an ASSUMPTION — the person's declared guess or Olumi's estimate they accepted (one literal, two writers). */
export function isAssumptionFigure(observedOrStamp: unknown): boolean {
  const os = rec(asObserved(observedOrStamp));
  return os?.source === 'user_assumption' && !isUnverifiedUserMaterial(os);
}

/**
 * ⛔ A STRENGTH THE USER STATED IS THEIRS (moved verbatim from `placeholder-parts.ts` `userStatedStrength`; PJ-A3): the
 * user drew it (`user_specified`) and no Olumi size or projected mean stands in it. A NARROWER question than
 * {@link linkProvenanceOf}: whenever this is true, that is `human` (the agreement spec pins the subset).
 */
export function isUserStatedStrength(edge: unknown): boolean {
  const p = isRec(edge) && isRec(edge.provenance) ? edge.provenance : undefined;
  return p?.source === 'user_specified'
    && !(typeof p.magnitude === 'string' && p.magnitude.startsWith('olumi_')) && p.mean_projected !== true;
}

/** The user's own LEVEL for the certainty rules: their verified figure, or Olumi's estimate they approved (accepted) —
 *  never an unestablished origin, never a human figure whose role is unverified (`goal-certainty`'s `userOwns`). */
export function isUsersLevelOrApproved(observed: unknown): boolean {
  const p = valueProvenanceOf(observed);
  return verifiedHuman(p) || (p.origin === 'ai' && p.accepted);
}

/** Olumi's own estimate, unaccepted, as a starting value (never a structural definition). */
export function isOlumiEstimateValue(observed: unknown): boolean {
  const p = valueProvenanceOf(observed);
  return p.origin === 'ai' && !p.accepted && !p.structural;
}

/**
 * The band edit's own stamp (`adjust-edge-strength.ts`): the person set the link's band — `user_specified` +
 * `provenance_display: 'user_set'` — and stated no size (moved verbatim from `target-testability.ts`). A NARROWER
 * question than {@link linkProvenanceOf}: whenever true, that is `human`.
 */
export function isUserSetBand(edge: unknown): boolean {
  return linkSizing(edge) === 'user' && isRec(edge) && isRec(edge.provenance) && edge.provenance_display === 'user_set'
    && edge.provenance.magnitude !== 'user_stated' && edge.provenance.natural_effect === undefined;
}

/** The link carries the person's STATED size (`magnitude: 'user_stated'`, contract D9). A NARROWER question than
 *  {@link linkProvenanceOf}: whenever true, that is `human` (`linkSizing` rule 1). */
export function hasUserStatedSize(edge: unknown): boolean {
  return isRec(edge) && isRec(edge.provenance) && edge.provenance.magnitude === 'user_stated';
}

/** The link carries Olumi's estimate as its size (`magnitude: 'olumi_estimate'`, accepted or not). A NARROWER question than
 *  {@link linkProvenanceOf}: whenever true, that is `ai` (sized, not a placeholder) unless the person's size stands first. */
export function hasOlumiEstimateSize(edge: unknown): boolean {
  return isRec(edge) && isRec(edge.provenance) && edge.provenance.magnitude === 'olumi_estimate';
}

/** The link's size is the EXAMPLE's figure (`magnitude: 'example_figure'`) — neither the person's nor Olumi's estimate:
 *  `linkProvenanceOf` reads it `unknown` (disclosed), and the conditional basis names it in its own words. */
export function isExampleFigureLink(edge: unknown): boolean {
  return isRec(edge) && isRec(edge.provenance) && edge.provenance.magnitude === 'example_figure';
}

/**
 * The person's link size with NO Olumi mark on it (moved from `placeholder-parts.ts`'s unit inference, Science L1 r2/R3):
 * an Olumi estimate, a projected mean or an Olumi drawing stamp never establishes the person's authority, whatever user
 * stamp sits beside it. A NARROWER question than {@link linkProvenanceOf}: only ever true where that is `human`.
 */
export function isUserSizedWithoutOlumiMarks(edge: unknown): boolean {
  const p = isRec(edge) && isRec(edge.provenance) ? edge.provenance : undefined;
  if (p === undefined || linkProvenanceOf(edge).origin !== 'human') return false;
  return p.source !== 'cee_hypothesis' && p.mean_projected !== true
    && !(typeof p.magnitude === 'string' && p.magnitude.startsWith('olumi_'));
}

/** A retained/planned statement's explicit human-origin stamp, including a hiring-bound disclosure.
 * This projects the statement contract, not the factor-value stamp vocabulary. */
export function isHumanStatementSource(statement: unknown): boolean {
  return rec(statement)?.source === 'user_stated';
}
