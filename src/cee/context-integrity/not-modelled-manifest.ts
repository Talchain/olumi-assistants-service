/**
 * ROADMAP 2.973 — THE NOT-MODELLED MANIFEST.
 *
 * Answers, for one scenario: *"what did you keep, and what did you leave out?"*
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The context-integrity trace of 2026-08-08 drove the DEPLOYED system with three
 * real strategic briefs and 76 pre-registered information atoms
 * (`PHASE0-EVIDENCE-2026-07-28/context-integrity-trace-2026-08-08/loss-map.md`).
 * It measured that the brief is persisted byte-verbatim and read by nothing,
 * while draft extraction silently discards most of what a strategist said:
 * quantities surviving with unit AND magnitude intact were 3/17, 5/14 and 1/14.
 * The user is told none of this. This module makes the loss VISIBLE.
 *
 * ── WHAT IT CLAIMS, AND WHAT IT REFUSES TO CLAIM ───────────────────────────
 * It makes exactly ONE narrow, checkable claim per item:
 *
 *     "this quantity you stated does / does not appear in the model."
 *
 * It does NOT claim to enumerate everything that was lost. It cannot: the
 * pipeline has no record of what the drafting LLM chose not to emit. The
 * classes it CANNOT see are named explicitly in `not_tracked`, and that field
 * is the point of the design — an empty `absent` list on a brief we
 * demonstrably lost content from would be a NEW lie, more damaging than
 * silence. Absent knowledge renders as absent (`status: "unavailable"`), never
 * as an empty-and-therefore-reassuring list.
 *
 * ── DERIVED, NOT ASSERTED ──────────────────────────────────────────────────
 * Same discipline as `detectLayout` in the route that serves this: the answer
 * is MEASURED from the bytes being returned. It is a pure function of
 * (brief_text, graph), so it re-derives on every read and can never go stale
 * against a graph that has since been edited — unlike a snapshot taken at draft
 * time, which would start lying the moment the user changed anything.
 *
 * ── THE CORPUS IS NOT MINE ─────────────────────────────────────────────────
 * Trap 22: a corpus drawn from the author's head cannot see the class the
 * author did not imagine. Every threshold and rule here was measured against
 * the three briefs of the 2026-08-08 trace — written by a different lane, in a
 * stressed-executive voice, deliberately spanning goal / quantitative target /
 * assumption / evidence-with-source / constraint / half-formed idea /
 * uncertainty / disagreement — and graded against that trace's per-atom loss
 * tables, which are an INDEPENDENT oracle produced from the deployed system.
 */

import {
  MAGNITUDE_ALTERNATION,
  magnitudeSuffixPattern,
  resolveMagnitude,
} from "../../utils/magnitude-alphabet.js";
import { CURRENCY_SYMBOL_TO_CODE } from "../extraction/numeric-parser.js";
import { readUnit, type AmountKind } from "../provenance/stated-amounts.js";

/** Wire schema discriminator. The UI lane builds against this. */
export const NOT_MODELLED_SCHEMA = "not_modelled.v1" as const;

/**
 * Upper bound on reported items. A brief is user-supplied and unbounded; an
 * unbounded array on a read path is a payload-size hazard. Truncation is
 * REPORTED (`truncated: true`), never silent — a silently short list is the
 * same lie as an empty one.
 */
export const MAX_ITEMS = 200;

export type QuantityKind = "money" | "percent" | "count" | "date" | "period";

/** in_model = carried as a value, cap, unit or label. prose_only = mentioned in
 *  commentary/coaching but not parameterising anything. absent = nowhere. */
export type QuantityVerdict = "in_model" | "prose_only" | "absent";

/**
 * WHAT KIND OF THING THE USER STATED — the second axis, and the one that makes
 * the retention invariant sayable at all.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Measured on the deployed cold read for the 4-day-week brief (build
 * `32f06dd`, 2026-08-10): the board's HARD FLOOR ("Do not let CSAT drop below
 * 85%"), the ops lead's GUESS ("productivity will fall 10-15%") and the
 * Manchester PILOT RESULT ("a 4% rise") all report as
 * `kind=percent, verdict=prose_only`. Three different kinds of claim, one
 * indistinguishable row each. The invariant — that everything material is
 * retained and correctly CLASSIFIED — could not be stated, let alone met.
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────
 * `QuantityKind` is NOT replaced. It stays exactly as it was, byte for byte,
 * and remains the axis the deployed UI validates against. This is a SECOND,
 * ADDITIVE axis. See `stated_kinds` on the manifest for why that is not a
 * stylistic choice.
 */
export const STATED_KINDS = [
  "goal",
  "option",
  "constraint",
  "figure",
  "evidence",
  "assumption",
  "disagreement",
  "correction",
] as const;

export type StatedKind = (typeof STATED_KINDS)[number];

/**
 * ⛔ THE ADOPTION RULE, AND IT IS NOT OPTIONAL.
 *
 * The estate's named historical failure is meaning fields that shipped with no
 * producer and no consumer, and were therefore dark from birth. A kind may sit
 * in `sourced` ONLY if a LIVE producer supplies it and this map names that
 * producer at its bytes. Everything else is `unsourced` — declared, counted,
 * and visible as a known blind spot rather than an absence a reader mistakes
 * for "nothing of that kind was said".
 *
 * A kind moves out of this map only in the same change train as its producer.
 */
export const STATED_KIND_PRODUCERS: Readonly<Partial<Record<StatedKind, string>>> = {
  // Every quantity the scan finds is at minimum a stated figure — the scan
  // itself is the producer, and it is the one already shipping.
  figure: "extractStatedQuantities (this module) — quantities stated in the brief",
  // The drafting model's typed, provenance-bound constraint rows, carried on
  // the graph with the exact sentence they came from.
  constraint:
    "graph.goal_constraints[] with source_quote (draft/anthropic-graph-schema.ts:447-467)",
};

/**
 * Kinds with no live producer, stated explicitly rather than left absent.
 *
 * `option`, `disagreement` and `correction` are ALREADY named in
 * `NOT_TRACKED_CLASSES` below — the manifest has always known it cannot see
 * them. That honesty is the starting point, not a defect: a kind listed here is
 * a blind spot on the record, and a reader can tell it apart from a kind that
 * was looked for and not found.
 */
export const UNSOURCED_STATED_KINDS: readonly StatedKind[] = STATED_KINDS.filter(
  (k) => STATED_KIND_PRODUCERS[k] === undefined,
);

export const SOURCED_STATED_KINDS: readonly StatedKind[] = STATED_KINDS.filter(
  (k) => STATED_KIND_PRODUCERS[k] !== undefined,
);

export interface NotModelledItem {
  /** The exact bytes as the user wrote them. */
  readonly literal: string;
  readonly kind: QuantityKind;
  /** Character offset into `brief_text`. With `literal`, this is the item's
   *  IDENTITY — consumers must address items by it, never by value. */
  readonly char_offset: number;
  readonly verdict: QuantityVerdict;
  /** The modelled quantity this figure was matched to, when matched
   *  numerically. Null for a text match or no match. */
  readonly matched_node_id: string | null;
  /**
   * WHAT KIND OF THING this is — the second axis (see `StatedKind`).
   *
   * ⚠ SOURCED FROM PRODUCERS, NEVER RE-DERIVED FROM THE PROSE. `constraint`
   * means "a live `goal_constraints[]` row quotes the sentence this figure
   * stands in and corroborates its value"; everything else is `figure`. A
   * figure that IS a constraint in English but that no producer claimed stays
   * `figure` — that is the honest answer, and it is the loss made visible.
   * Guessing it back would be a fifth extractor over free text, which
   * ROADMAP 2.1051 forbids and which misclassification risk makes worse than
   * silence.
   */
  readonly stated_kind: StatedKind;
}

export interface NotModelledManifest {
  readonly schema: typeof NOT_MODELLED_SCHEMA;
  /** `derived` = we looked. `unavailable` = we could not look, and therefore
   *  know NOTHING about what was dropped. Never conflate the two. */
  readonly status: "derived" | "unavailable";
  readonly unavailable_reason: "no_brief_text" | "no_graph" | null;
  readonly scope: {
    readonly searched: string;
    readonly model_surface: readonly string[];
    readonly prose_surface: readonly string[];
    readonly excluded_from_search: readonly string[];
  };
  readonly quantities: {
    readonly total: number;
    readonly in_model: number;
    readonly prose_only: number;
    readonly absent: number;
    readonly truncated: boolean;
    readonly items: readonly NotModelledItem[];
  } | null;
  /**
   * What the DRAFTING MODEL ITSELF reported leaving out, in its own words.
   *
   * ⚠ `none_reported` DOES NOT MEAN NOTHING WAS EXCLUDED. Measured on the trace
   * corpus: brief B3 — the densest of the three, 16 of 26 atoms dropped — has an
   * EMPTY exclusion list, because its coaching pass produced zero output and
   * nothing distinguishes "found nothing" from "silently failed". The three
   * states are kept apart for exactly that reason.
   */
  readonly declared_exclusions: {
    readonly status: "reported" | "none_reported" | "not_recorded";
    /** VERBATIM. The model's own sentence, never re-worded or summarised. */
    readonly items: readonly string[];
  };
  /**
   * Factors carrying a figure the user never stated — i.e. WE supplied it.
   *
   * Derived from evidence, never from the `provenance`/`extractionType`
   * labels, which the 2026-08-08 trace measured as false precisely where they
   * matter. Carries the human LABEL, never the encoded value: the pipeline's
   * own `display_value` reads "0.31 to 0.93" with no unit and means nothing to
   * a user.
   */
  readonly inferred_factors: {
    readonly status: "derived" | "not_recorded";
    readonly items: readonly { readonly node_id: string; readonly label: string }[];
  };
  /**
   * THE KIND AXIS AND ITS ADOPTION STATE — shipped together, deliberately.
   *
   * A vocabulary without a statement of which of its words have producers is
   * how five of eight kinds ship dark and nobody notices for a month. This
   * block is that statement, ON THE WIRE, so a consumer can render "we do not
   * track disagreements yet" instead of implying none were stated.
   *
   * `sourced ∪ unsourced` is always the complete `STATED_KINDS` set and the two
   * are always disjoint — asserted in the spec, not merely intended.
   */
  readonly stated_kinds: {
    readonly status: "derived";
    /** Count of REPORTED items per kind. Sums to `quantities.items.length`. */
    readonly tally: Readonly<Record<StatedKind, number>>;
    /** Kinds a live producer supplies today. */
    readonly sourced: readonly StatedKind[];
    /** Kinds with no producer — declared blind spots, never silent absences. */
    readonly unsourced: readonly StatedKind[];
    /** The producer, named at its bytes, for each sourced kind. */
    readonly producers: Readonly<Partial<Record<StatedKind, string>>>;
  };
  /** Loss classes this derivation CANNOT observe. The anti-reassurance field. */
  readonly not_tracked: readonly string[];
}

/**
 * What this derivation is structurally blind to.
 *
 * Every entry was MEASURED as a real loss class by the 2026-08-08 trace and is
 * invisible to a quantity-containment check. This list is what stops a short
 * `absent` array reading as "nothing else was lost".
 */
export const NOT_TRACKED_CLASSES: readonly string[] = [
  // Trace loss class 3 — 0/2 named colleagues' competing proposals survived.
  "competing_or_dissenting_proposals",
  // Trace loss class 6 — 0/4 in-brief corrections survived (worst-served class).
  "corrections_and_second_thoughts",
  // Trace loss class 5 — every named source across all three briefs was stripped.
  "named_evidence_sources_and_their_pedigree",
  // Trace loss class 4 — rules like "max two changes in parallel" became
  // unparameterised factors; qualitative constraints carry no number to match on.
  "qualitative_constraints_and_rules",
  // Self-flagged weakness ("my gut", "pure guess", "treat accordingly").
  "stated_confidence_and_self_flagged_weakness",
  // Anything the drafting model declined to emit and never recorded dropping.
  "statements_the_drafting_model_did_not_report_discarding",
];

// ── extraction ──────────────────────────────────────────────────────────────

/**
 * ⚠ NO MAGNITUDE LIST LIVES HERE, AND THAT IS THE POINT.
 *
 * The first cut of this module hand-wrote one — a FIFTH copy in a service whose
 * `utils/magnitude-alphabet.ts` exists precisely because fifteen independent
 * copies had accumulated and EIGHT of them were measurably wrong, each by a
 * factor of 1,000 to 1,000,000,000,000, at full confidence.
 *
 * It was caught by that module's own union tripwire (ROADMAP 2.330), in CI, not
 * by review — and the tripwire was right: a lookup here would have drifted from
 * the canonical alphabet the moment either moved. The copy is deleted; the
 * alphabet is imported. `grand`, `mn`, `t` and the spelled-out words come free,
 * and cannot diverge.
 */

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

/**
 * Unit words that turn a bare number into a STATED QUANTITY.
 *
 * ⚠ HAND-WRITTEN, AND IT KNOWS IT (trap 12d). Deriving this from anything is
 * impossible — it is a fact about English, not about our data. The asymmetry is
 * therefore deliberate and runs ONE WAY: a unit word missing from this list
 * means a quantity is never examined and never reported, i.e. we UNDER-report
 * loss. A false entry could only ever cause us to examine something harmless.
 * We never manufacture a "you lost this" claim by omission from this list.
 */
const UNIT_WORDS =
  "months?|years?|weeks?|days?|quarters?|people|persons?|person|heads?|hires?|staff|employees?|engineers?|roles?|seats?|customers?|users?|aes?|fte";

/**
 * One ordered alternation. Branch order matters: money and percent must win
 * before the bare-number branches, or "£11.2m" degrades into "11.2".
 *
 * ⚠ BARE UNDECORATED INTEGERS ARE DELIBERATELY NOT MATCHED. Measured on the
 * trace corpus: matching them made "FY28" report the quantity `28`, and short
 * integers collide with everything. A quantity must carry a unit, a currency, a
 * percent sign, or a calendar/fiscal form to be examined at all. This is stated
 * in `scope.excluded_from_search` so the consumer knows the list is partial.
 */
const QUANTITY_RE = new RegExp(
  [
    // The sign is part of the user's literal. Without it "-£2m" was quoted
    // back to them as "£2m" — misreporting their own words, and inverting the
    // meaning of a figure that is very often a loss.
    `(?<money>(?<msign>-)?(?<mcur>[£€$])\\s?(?<mnum>\\d[\\d,]*(?:\\.\\d+)?)${magnitudeSuffixPattern("mmag")})(?![\\d])`,
    `(?<percent>(?<pnum>\\d[\\d,]*(?:\\.\\d+)?)\\s?%)`,
    `(?<date>(?:\\d{1,2}\\s+)?(?:${MONTHS})\\s+\\d{4})`,
    `(?<period>(?:FY\\s?\\d{2,4}|Q[1-4]\\s?\\d{4}|Q[1-4]\\b))`,
    `(?<counted>(?<cnum>\\d[\\d,]*(?:\\.\\d+)?)(?:\\s+[a-z]+){0,2}\\s+(?:${UNIT_WORDS})\\b)`,
    `(?<hyph>(?<hnum>\\d[\\d,]*)-(?:${UNIT_WORDS}))`,
  ].join("|"),
  "gi",
);

interface Quantity {
  readonly literal: string;
  readonly at: number;
  readonly kind: QuantityKind;
  /** Fully expanded value (£11.2m -> 11_200_000). Null for dates/periods. */
  readonly value: number | null;
  /** As written (£11.2m -> 11.2). Models store either form; both count. */
  readonly mantissa: number | null;
  /** Currency symbol for money, "%" for percent, null otherwise. Load-bearing:
   *  it is what stops a count matching a currency-denominated carrier. */
  readonly unit: string | null;
}

const toNumber = (raw: string): number => Number(raw.replace(/,/g, ""));

/** The unit WORD a count was stated in ("8 people" -> "people"). Load-bearing:
 *  it is the only thing that can tell a headcount from a Trustpilot score. */
function countUnitWord(literal: string): string | null {
  const m = literal.match(new RegExp(`(${UNIT_WORDS})$`, "i"));
  return m ? m[1].toLowerCase() : null;
}

/**
 * The forms a unit word might be written in, so "month"/"months" and
 * "people"/"person" compare equal.
 *
 * ⚠ RETURNS A SET, NOT A SINGLE STEM. A single crude stem got this wrong in the
 * obvious direction: "hires" -> "hir" (the `es` branch) while "hire" -> "hire",
 * so a factor declared in `hires` never matched a brief written in `hire`.
 * Comparing candidate SETS removes the need for the stemmer to pick correctly.
 */
function unitForms(word: string): Set<string> {
  const w = word.toLowerCase().trim();
  const forms = new Set<string>([w]);
  if (w.endsWith("ies")) forms.add(`${w.slice(0, -3)}y`);
  if (w.endsWith("es")) forms.add(w.slice(0, -2));
  if (w.endsWith("s")) forms.add(w.slice(0, -1));
  forms.add(`${w}s`);
  if (w === "people" || w === "person") {
    forms.add("people");
    forms.add("person");
  }
  return forms;
}

/** Do two unit words name the same family? */
function sameUnitFamily(a: string, b: string): boolean {
  const fa = unitForms(a);
  for (const f of unitForms(b)) if (fa.has(f)) return true;
  return false;
}

export function extractStatedQuantities(text: string): Quantity[] {
  const out: Quantity[] = [];
  for (const m of text.matchAll(QUANTITY_RE)) {
    const g = m.groups ?? {};
    const at = m.index ?? 0;
    const literal = m[0];
    if (g.money !== undefined && g.mnum !== undefined) {
      const sign = g.msign === "-" ? -1 : 1;
      const base = toNumber(g.mnum) * sign;
      const mag = resolveMagnitude(g.mmag);
      out.push({ literal, at, kind: "money", value: base * mag, mantissa: base, unit: g.mcur ?? null });
    } else if (g.percent !== undefined && g.pnum !== undefined) {
      const v = toNumber(g.pnum);
      out.push({ literal, at, kind: "percent", value: v, mantissa: v, unit: "%" });
    } else if (g.date !== undefined) {
      out.push({ literal, at, kind: "date", value: null, mantissa: null, unit: null });
    } else if (g.period !== undefined) {
      out.push({ literal, at, kind: "period", value: null, mantissa: null, unit: null });
    } else if (g.counted !== undefined && g.cnum !== undefined) {
      const v = toNumber(g.cnum);
      out.push({ literal, at, kind: "count", value: v, mantissa: v, unit: countUnitWord(literal) });
    } else if (g.hyph !== undefined && g.hnum !== undefined) {
      const v = toNumber(g.hnum);
      out.push({ literal, at, kind: "count", value: v, mantissa: v, unit: countUnitWord(literal) });
    }
  }
  return out;
}

// ── the two surfaces ────────────────────────────────────────────────────────

/**
 * The THREE-WAY top-level classification, in ONE map.
 *
 * `prose` = commentary we still search, so a quantity found only there is
 * reported `prose_only` rather than `absent`. `skip` = diagnostics, timings and
 * quality scores, searched not at all. ABSENCE FROM THIS MAP MEANS MODEL.
 *
 * ⚠ ONE MAP BECAUSE TWO SETS ENCODED ONE CLASSIFICATION AND COULD DISAGREE.
 * This was `NON_MODEL_TOP_KEYS` + `PROSE_TOP_KEYS`, with all three prose keys
 * duplicated across both and consumed as `if (!nonModel) … else if (prose) …`.
 * That shape makes the second branch UNREACHABLE for any key added to the prose
 * set alone: it would be walked as MODEL content, and a figure quoted only in
 * commentary would be reported `in_model` — the confident-false-statement the
 * trace measured as loss class 7, arriving through a one-line edit that looks
 * obviously correct. A single map cannot express that state (trap 12: derive,
 * and where you cannot, make the drift impossible rather than merely unlikely).
 *
 * Coaching is deliberately `prose`: a figure QUOTED BACK in a coaching card was
 * noticed, but it parameterises nothing, and saying it is "in the model" is the
 * failure this module exists to prevent.
 */
type TopKeyClass = "prose" | "skip";

const TOP_KEY_CLASS: ReadonlyMap<string, TopKeyClass> = new Map<string, TopKeyClass>([
  ["trace", "skip"],
  ["_timings", "skip"],
  ["_pipeline_outcome", "skip"],
  ["quality", "skip"],
  ["analysis_ready", "skip"],
  ["schema_version", "skip"],
  ["coaching", "prose"],
  ["draft_warnings", "prose"],
  ["validation_warnings", "prose"],
]);

/**
 * Keys ANYWHERE whose subtree is internal prose rather than model content.
 *
 * ⚠ A DENY-LIST BY DESIGN, and the direction is the whole argument. A prose key
 * MISSING from this list gets treated as model content, so a quantity mentioned
 * there is reported as `in_model` — we UNDER-report loss. An ALLOW-list that
 * missed a value-bearing key would do the opposite and manufacture a false
 * "we dropped this". Under-reporting is recoverable; a false accusation about
 * the user's own words is not.
 */
const PROSE_KEYS: ReadonlySet<string> = new Set([
  "validation",
  "reasoning",
  "rationale",
  "explanation",
  "uncertainty_drivers",
  "notes",
  "description",
  "evidence_note",
  "fix_hint",
  "commentary",
]);

/**
 * The factors the product ESTIMATED — figures it supplied that the user never
 * stated. The trust-critical half: a user who cannot tell their own numbers
 * from ours cannot audit the model at all.
 *
 * ── DERIVED FROM EVIDENCE, NOT FROM THE PROVENANCE LABEL ───────────────────
 * This deliberately does NOT read `provenance` / `extractionType`. The
 * 2026-08-08 trace measured those labels as WRONG exactly where they matter:
 * `fac_nrr` carried `extractionType:"explicit", provenance:"from_brief"` while
 * holding zero brief information, and every option intervention value carried
 * `source:"brief_extraction", value_confidence:"high"` while being
 * model-invented. Building a trust surface on a label that is false where it
 * counts would launder the defect rather than expose it.
 *
 * So the test is the one thing that cannot lie: does any figure this factor
 * carries correspond to something the user actually wrote? If not, we supplied
 * it, whatever the label says.
 *
 * (Independent of the provenance-honesty work in `src/cee/provenance/` — that
 * corrects the labels at the source; this needs no label to be correct.)
 */
/**
 * ⚠ THE FIELD LIST IS THE WHOLE CORRECTNESS ARGUMENT, and its asymmetry runs
 * the DANGEROUS way — which is why it is pinned by a discrimination test rather
 * than trusted. A field MISSING here means a figure the user really stated goes
 * unseen, and we then tell them we invented their own number. (Measured:
 * `observed_state.cap` and `raw_value` were absent from the first version, and
 * B2's offshore-scale factor — carrying the brief's £2.9m cap — was wrongly
 * claimed as ours.)
 *
 * ⚠ AND IT IS DECLARED ONCE. Three functions walked this list independently
 * (`collectFactorNumbers`, `collectSuppressorNumbers`, `collectCandidates`), so
 * "the whole correctness argument" existed in triplicate and a field could be
 * added to one copy alone. The walk is now shared; only the per-function
 * `prior` policy differs, and each difference is argued at its own site.
 */
const VALUE_FIELDS = ["value", "raw", "raw_value", "cap"] as const;

/** The objects that may carry a (value…, unit) pair, in precedence order. */
const CARRIER_KEYS = ["observed_state", "data"] as const;

interface ValueCarrier {
  /** The carrier's OWN declared unit, verbatim. Taken from the same object as
   *  the values, so a value can never borrow a unit from elsewhere. */
  readonly unit: unknown;
  readonly values: readonly number[];
}

/**
 * Every (values…, unit) carrier on a node: the node itself, then
 * `observed_state`, then `data`.
 *
 * ⚠ THE ORDER IS OBSERVABLE and is preserved exactly as the three original
 * walks had it. `matchCandidate` returns the FIRST compatible candidate, so
 * candidate order reaches the user as `matched_node_id`.
 */
function valueCarriers(node: Record<string, unknown>): ValueCarrier[] {
  const out: ValueCarrier[] = [];
  const carriers: Array<Record<string, unknown>> = [node];
  for (const nested of CARRIER_KEYS) {
    const v = node[nested];
    if (v !== null && typeof v === "object") carriers.push(v as Record<string, unknown>);
  }
  for (const carrier of carriers) {
    const values: number[] = [];
    for (const field of VALUE_FIELDS) {
      const v = carrier[field];
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    out.push({ unit: carrier.unit, values });
  }
  return out;
}

/**
 * The real-world figures quoted in an encoding map's CAPTIONS.
 *
 * The map's KEYS are encoded levels, but its captions carry the figures the
 * model is claiming ("45 roles offshored (~40% saving)"), so a factor whose
 * caption quotes the brief is not ours. Declared once: this block was
 * byte-identical in two of the three walks.
 */
function encodingCaptionNumbers(node: Record<string, unknown>): number[] {
  const out: number[] = [];
  const encoding = node.encoding_map;
  if (encoding === null || typeof encoding !== "object") return out;
  for (const caption of Object.values(encoding as Record<string, unknown>)) {
    if (typeof caption !== "string") continue;
    for (const m of caption.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      out.push(Number(m[0].replace(/,/g, "")));
    }
  }
  return out;
}

function collectFactorNumbers(node: Record<string, unknown>): number[] {
  const out: number[] = [];
  const push = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  };
  // PRIOR POLICY (1 of 3): the DECLARED bounds and value, unconditionally.
  // This function answers "is there a figure here to own?", for which a
  // unitless prior counts — a prior IS a number we put on the world.
  const prior = node.prior;
  if (prior !== null && typeof prior === "object") {
    const p = prior as Record<string, unknown>;
    push(p.range_min);
    push(p.range_max);
    push(p.value);
  }
  for (const carrier of valueCarriers(node)) out.push(...carrier.values);
  out.push(...encodingCaptionNumbers(node));
  return out;
}

/**
 * Does this factor put a NUMBER on the world at all?
 *
 * ⚠ DELIBERATELY BROADER THAN THE MATCHING CORPUS, and the difference is the
 * whole point. `collectCandidates` answers *"could this be the user's
 * figure?"* and therefore demands a declared unit. This answers *"is there a
 * figure here to own?"* — for which a unitless prior counts, because a prior
 * IS a number we put on the world.
 *
 * Two different questions, named apart on purpose (trap 21). The previous
 * version of this module answered them with two different matchers and got
 * caught asserting and denying the same provenance in one panel.
 */
function carriesAFigure(node: Record<string, unknown>): boolean {
  return collectFactorNumbers(node).length > 0;
}

/**
 * The factor's own real-world figures — the ones that could plausibly BE a
 * number the user wrote.
 *
 * ⚠ MIRRORS `collectCandidates`, AND THE MIRRORING IS THE POINT. That function
 * deliberately excludes unitless `[0,1]` prior bounds, because matching against
 * them is exactly how a stated quantity gets "found" in a model that never
 * carried it. The suppressor used to re-admit precisely those numbers,
 * unit-blind — so an unrelated sentence could delete the trust-critical answer.
 * MEASURED on b1: appending "We have £1m in the bank." (mantissa 1, which is
 * every default `range_max`) dropped "what I estimated" from 9 to 6; "£0m"
 * dropped it to 5, and at zero the surface hides the section entirely.
 *
 * Each figure is offered in BOTH forms — as stored, and scaled by its declared
 * unit — because the brief may write either ("1.5 million pounds" vs
 * "1,500,000 pounds") and a coincidence in either form is a reason to keep
 * quiet.
 */
function collectSuppressorNumbers(node: Record<string, unknown>): number[] {
  const out: number[] = [];
  for (const carrier of valueCarriers(node)) {
    // The unit is read ONCE per carrier, by the repo's own reader.
    const { multiplier } = readUnit(typeof carrier.unit === "string" ? carrier.unit : null);
    for (const v of carrier.values) {
      out.push(v);
      if (multiplier !== 1) out.push(v * multiplier);
    }
  }
  // ── PRIOR BOUNDS: real-world magnitudes only ──────────────────────────
  //
  // ⚠ NOT A CARVE-OUT — it is the distinction this module already draws
  // everywhere else, applied here. A prior bound on [0,1] is the pipeline's
  // NORMALISED default (it emits them constantly; that is why
  // `collectCandidates` refuses them and why percent-as-fraction was
  // rejected). Admitting those made an unrelated sentence delete the answer:
  // "We have £1m in the bank" carries mantissa 1, which is every default
  // `range_max`, and dropped "what I estimated" from 9 to 6.
  //
  // A prior bound OUTSIDE the unit interval is a real-world figure, and a
  // coincidence with one is a genuine cannot-tell. Excluding those wholesale
  // would trade a recoverable silence for a false ASSERTION about the user's
  // own number — the harm this whole surface exists to prevent.
  //
  // PRIOR POLICY (2 of 3): ANY prior value outside the unit interval — a
  // different rule from `collectFactorNumbers`' declared-bounds walk above and
  // from `collectCandidates`, which admits no prior at all. The three run in
  // opposite safe directions and were each established by an earlier review
  // round; they are deliberately NOT unified.
  const prior = node.prior;
  if (prior !== null && typeof prior === "object") {
    for (const v of Object.values(prior as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v >= 0 && v <= 1) continue;
      out.push(v);
    }
  }

  out.push(...encodingCaptionNumbers(node));
  return out;
}

/**
 * Every numeric literal in the brief, however it is written.
 *
 * ⚠ DELIBERATELY EXTRACTION-INDEPENDENT, and that independence is the fix for a
 * real false claim. The suppressor used to consume only SUCCESSFULLY EXTRACTED
 * quantities — and `QUANTITY_RE` knows three currency symbols. So when
 * extraction missed a figure there was no "cannot tell" left to fire, and the
 * factor fell straight through to being claimed as ours.
 *
 * MEASURED on the real b1 graph, changing ONLY the notation of its own
 * sentence "marketing spend is capped at £1.5m": every one of
 * "1.5 million pounds", "GBP 1.5m", "USD 1.5m", "1.5 million dollars",
 * "¥1.5m", "₹1.5m", "CHF 1.5m" produced a figure absent from "what I used",
 * absent from "not modelled yet", AND present under "the numbers behind these
 * are mine, not yours" — against a carrier (`cap: 1.5, unit: "£m"`) that this
 * module's own matcher certifies as the user's figure in the £ notation.
 *
 * The graph's producer is an LLM that understands money written in words; its
 * auditor was a regex that knows three symbols — and the auditor overruled the
 * producer. Widening the regex would be another instance patch owing a fresh
 * breadth defence for every currency form. Reading raw numeric tokens needs no
 * vocabulary at all, and errs toward silence.
 */
const BRIEF_NUMBER_RE = new RegExp(
  `(\\d[\\d,]*(?:\\.\\d+)?)(?:\\s*(${MAGNITUDE_ALTERNATION})\\b)?`,
  "gi",
);

function numericTokensIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(BRIEF_NUMBER_RE)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    // BOTH forms, symmetrically with `collectSuppressorNumbers`: the brief may
    // write "£4m" where the model stores 4,000,000, or "1,500,000 pounds"
    // where it stores 1.5 under unit "£m". A coincidence in EITHER form is a
    // reason to keep quiet. Note the magnitude word is read from the canonical
    // alphabet, so this needs no currency vocabulary of its own.
    out.push(n);
    const scale = resolveMagnitude(m[2]);
    if (scale !== 1) out.push(n * scale);
  }
  return out;
}

/**
 * Could one of this factor's figures be the user's, even though we could not
 * CONFIRM it?
 *
 * ── WHY A THIRD STATE EXISTS ───────────────────────────────────────────────
 * The two sections have OPPOSITE safe directions:
 *
 *   · refusing a match in "what I used" sends the user's figure to "not
 *     modelled yet" — over-inviting, and recoverable;
 *   · refusing the same match in "what I estimated" CLAIMS THEIR NUMBER AS
 *     OURS — asserting something false about their own input.
 *
 * The temptation is a looser matcher for the second section. That is exactly
 * the two-authorities defect this module was caught shipping. The consistent
 * answer is that the question has THREE outcomes: theirs, ours, and CANNOT
 * TELL — and neither section may claim a "cannot tell".
 */
function magnitudeCoincidesWithSomethingWritten(
  node: Record<string, unknown>,
  briefNumbers: readonly number[],
): boolean {
  for (const n of collectSuppressorNumbers(node)) {
    for (const t of briefNumbers) if (numbersEqual(n, t)) return true;
  }
  return false;
}

/**
 * The factors whose figures are OURS.
 *
 * ── ONE AUTHORITY, CONSUMED TWICE ──────────────────────────────────────────
 * ⚠ THIS FUNCTION USED TO RUN ITS OWN MATCHER, and the bug that produced is
 * the sharpest one this module has had. `classify` was converted to
 * unit-aware candidates; this was not, and kept comparing raw values and
 * mantissas out of an unlabelled bag. It therefore fired whenever the user's
 * magnitude NOTATION disagreed with the carrier's declared unit scale —
 * measured on the real b1 graph, 5 of 9 ordinary notations:
 *
 *     "We can spend £1.5m ..."      -> used: fac_marketing_spend      (no clash)
 *     "We can spend £1,500,000 ..." -> used: fac_marketing_spend
 *                                   AND estimated: Marketing Spend    (CLASH)
 *
 * The panel asserted and denied the same node's provenance at once, and the
 * denial was contradicted by our own matcher, which had just certified the
 * figure as the user's.
 *
 * The fix is structural, not an exclusion list: this consumes the SAME
 * `matchCandidate` result `classify` does. A node that produced a match cannot
 * appear here, by construction rather than by suppression — so the two
 * sections can no longer drift apart, whatever notation the user writes in.
 *
 * (This block sat above `collectSuppressorNumbers` until 2026-08-09, so every
 * tool attached it to the wrong function and the rationale was invisible at the
 * line a tidy-up would delete.)
 */
function deriveInferredFactors(
  graph: Record<string, unknown>,
  matchedNodeIds: ReadonlySet<string>,
  briefNumbers: readonly number[],
): NotModelledManifest["inferred_factors"] {
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) return { status: "not_recorded", items: [] };

  const items: Array<{ node_id: string; label: string }> = [];
  for (const raw of nodes) {
    if (raw === null || typeof raw !== "object") continue;
    const node = raw as Record<string, unknown>;
    if (node.kind !== "factor") continue;
    const id = typeof node.id === "string" ? node.id : null;
    const label = typeof node.label === "string" ? node.label : null;
    // A factor with no label cannot be described to a user, and describing it
    // by its internal id would be pipeline vocabulary on screen.
    if (id === null || label === null) continue;

    // Nothing to own.
    if (!carriesAFigure(node)) continue;
    // The single provenance authority: anything the matcher certified as the
    // user's figure is theirs, full stop. This is what makes the two sections
    // structurally incapable of contradicting each other.
    //
    // ⚠ NO MEASURED NOTATION MAKES THIS BITE — BUT SIGNED MONEY DOES, AND THE
    // CLAIM THAT IT "CANNOT" WAS CORPUS-BOUNDED, NOT STRUCTURAL.
    //
    // What was measured: across 12 unsigned notations a numeric match compares
    // the same magnitudes the coincidence guard below does, so every matched
    // node was ALSO coincidence-suppressed and removing this line left 0
    // clashes. What that measurement could not see is that the two readers
    // disagree on SIGN:
    //
    //   · `extractStatedQuantities` carries one (`(?<msign>-)?`), so "-£2m"
    //     yields -2,000,000;
    //   · `BRIEF_NUMBER_RE` has NO sign group, so `numericTokensIn` yields the
    //     UNSIGNED 2 and 2,000,000.
    //
    // For a carrier holding -2 under "£m" the matcher therefore fires while the
    // coincidence guard does not, and this line is the ONLY thing preventing
    // the round-3 contradiction — a panel asserting and denying one node's
    // provenance at once. Pinned by the signed-money arms of
    // `not-modelled-manifest.unit-authority.test.ts`; before those it was
    // untested, which is why the old note here could drift unchallenged.
    if (matchedNodeIds.has(id)) continue;
    // CANNOT TELL — claimed by neither section. See the note above.
    if (magnitudeCoincidesWithSomethingWritten(node, briefNumbers)) continue;

    items.push({ node_id: id, label });
  }
  return { status: "derived", items };
}

/**
 * The drafting model's own record of what it considered and left out, at
 * `graph.coaching.widening_log.elements_considered_but_excluded`.
 *
 * ── THIS REFUTED THE PREMISE THIS MODULE STARTED FROM ──────────────────────
 * The brief for this work assumed the pipeline "discards without recording".
 * For the sharpest loss class it does not. The 2026-08-08 trace graded B2 atom
 * A21 — a named colleague's competing proposal — as SEVERE with the note
 * `"Dana" 0 hits`, scoped to the TURN RESPONSE. The PERSISTED graph carries:
 *
 *   "Dana's across-the-board RIF option — excluded because the brief frames it
 *    as ruled out by the redundancy constraint and CEO position, so it does not
 *    add decision value"
 *
 * The model said what it dropped, and why, in the user's own terms. Nothing
 * ever read it. That is a plumbing failure, not a knowledge failure — and it is
 * the single highest-value thing this manifest can carry, because it is the one
 * loss class a quantity-containment check is structurally blind to.
 *
 * It is NOT part of either search surface: a figure appearing only inside an
 * exclusion record is definitively NOT in the model, and grading it
 * `prose_only` ("mentioned in the explanation") would understate that.
 */
function readDeclaredExclusions(
  graph: Record<string, unknown>,
): NotModelledManifest["declared_exclusions"] {
  const coaching = graph.coaching;
  if (coaching === null || typeof coaching !== "object") {
    return { status: "not_recorded", items: [] };
  }
  const wideningLog = (coaching as Record<string, unknown>).widening_log;
  if (wideningLog === null || typeof wideningLog !== "object") {
    return { status: "not_recorded", items: [] };
  }
  const raw = (wideningLog as Record<string, unknown>)
    .elements_considered_but_excluded;
  if (!Array.isArray(raw)) return { status: "not_recorded", items: [] };

  const items = raw.filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  // An empty list is "the drafting step reported none", NOT "none exist".
  return { status: items.length > 0 ? "reported" : "none_reported", items };
}

/**
 * A NAMED, UNITED quantity the model actually carries.
 *
 * ⚠ THIS TYPE IS THE FIX FOR A REAL DEFECT. The first version matched a stated
 * quantity against every number anywhere in the model subtree, unit-blind.
 * Measured on all three real graphs, that made ordinary input false:
 *
 *     "We need to decide within 1 year."   -> reported as USED
 *     "It has 1 month of runway left."     -> reported as USED
 *     "We can spend £0.75m on marketing."  -> reported as USED
 *
 * The `1` came from 46x `edges[].strength.mean` and 46x
 * `edges[].exists_probability` — topology metadata that is not a user-facing
 * quantity at all — and `0.75` from a unitless prior bound. 59/38/32 money
 * mantissas had a collision target per graph.
 *
 * It is the SAME mechanism already rejected for percentages ("every stated
 * percentage finds a coincidental match against some prior bound"); it was
 * closed there and left open for money and counts. It is now closed generally:
 * a match must NAME the modelled quantity it matched, in compatible units.
 * A bag of numbers cannot do that, so the corpus is a list of named candidates.
 */
interface Candidate {
  readonly nodeId: string;
  readonly label: string;
  /** Real-world value, already scaled by its declared unit (1.5 "£m" -> 1.5e6). */
  readonly value: number;
  /** `currency` / `percent` / `plain`, as `readUnit` classifies it. */
  readonly unitKind: AmountKind;
  /** ISO code for currency candidates, so EUR never matches GBP. */
  readonly currencyCode: string | null;
  /** The unit string the model declared, verbatim. A count can only match a
   *  carrier that declares the same unit family. */
  readonly declaredUnit: string | null;
}

/**
 * ⚠ NO CURRENCY VOCABULARY LIVES HERE EITHER, AND FOR THE SAME REASON THE
 * MAGNITUDE LIST DOES NOT (see the note above `MONTHS`).
 *
 * This module shipped with `CURRENCY_SYMBOLS = ["£","€","$"]` and a private
 * `parseUnit`, re-deriving two facts the repo already owned canonically:
 *
 *   · `cee/extraction/numeric-parser.ts` `CURRENCY_SYMBOL_TO_CODE` — ten
 *     entries, exported under ROADMAP 2.972 with a header saying in terms that
 *     "a second hand-written currency vocabulary is exactly the mirror trap 12
 *     describes";
 *   · `cee/provenance/stated-amounts.ts` `readUnit()` — which returns
 *     `{kind, currencyCode, multiplier}`, a strict SUPERSET of `parseUnit`'s
 *     `{unitClass, symbol, scale}`, and landed in `db985bbe` — the base commit
 *     of the very diff that added the copy.
 *
 * The copy carried two live defects, both now pinned by
 * `not-modelled-manifest.unit-authority.test.ts`:
 *
 *   1. `unit: "GBP"` was UNMATCHABLE. It read as `unitClass: "other"`, so
 *      `unitCompatible` was false for every money quantity and a figure the
 *      model genuinely carries was reported to the user as "Not modelled yet".
 *      GBP is producer vocabulary, not a synthetic edge: `cqe/rules.ts`
 *      `normaliseCurrencyUnit` returns it and `schemas/cee-v3.ts` documents the
 *      field as "e.g. 'GBP', 'USD'".
 *   2. `A$m` MIS-SCALED. `CURRENCY_SYMBOLS.find((c) => u.includes(c))` is
 *      unordered, so `A$` matched on `$`, left the suffix `Am`, and yielded
 *      scale 1 under the wrong currency — certifying a bare "$2" statement as
 *      the source of an A$2,000,000 carrier. `alternationOf`
 *      (`stated-amounts.ts:111`) sorts longest-first precisely to prevent this.
 *
 * What stays here is what is genuinely this module's own and belongs nowhere
 * else: the `kind` classification, dates and periods, the count-unit family
 * logic, `char_offset` identity, and the three-state verdict.
 */
const briefCurrencyCode = (symbol: string | null): string | null =>
  symbol === null ? null : CURRENCY_SYMBOL_TO_CODE[symbol] ?? null;

/**
 * Numeric candidates come ONLY from node/option value carriers that declare a
 * unit alongside them. Everything else numeric in the graph — prior bounds
 * (unitless [0,1]), intervention encodings (unitless 0..1), and the entire
 * `edges` subtree (strength, exists_probability, validation passes) — is
 * DELIBERATELY EXCLUDED. Those numbers are how the model computes, not what it
 * is claiming about the world, and matching against them is how a stated
 * quantity gets "found" in a model that never carried it.
 *
 * ⚠ THE `edges` SUBTREE IS EXCLUDED AND `SCOPE.model_surface` IS DERIVED FROM
 * THIS CONSTANT so the user-facing sentence cannot claim otherwise. It did:
 * it advertised "node, edge and option values" while this walked only nodes and
 * options. Edge LABELS are still text-searched (they are strings under a
 * non-skip top-level key); edge VALUES are not.
 */
const CANDIDATE_COLLECTIONS = ["nodes", "options"] as const;
function collectCandidates(graph: Record<string, unknown>): Candidate[] {
  const out: Candidate[] = [];
  for (const key of CANDIDATE_COLLECTIONS) {
    const entries = graph[key];
    if (!Array.isArray(entries)) continue;
    for (const raw of entries) {
      if (raw === null || typeof raw !== "object") continue;
      const node = raw as Record<string, unknown>;
      const nodeId = typeof node.id === "string" ? node.id : null;
      const label = typeof node.label === "string" ? node.label : null;
      if (nodeId === null || label === null) continue;

      // PRIOR POLICY (3 of 3): none at all. This asks "could this be the
      // user's figure?", and a unitless prior bound is exactly how a stated
      // quantity gets "found" in a model that never carried it.
      for (const carrier of valueCarriers(node)) {
        const declaredUnit = typeof carrier.unit === "string" ? carrier.unit : null;
        const { kind, currencyCode, multiplier } = readUnit(declaredUnit);
        for (const v of carrier.values) {
          out.push({
            nodeId,
            label,
            value: v * multiplier,
            unitKind: kind,
            currencyCode: currencyCode ?? null,
            declaredUnit,
          });
        }
      }
    }
  }
  return out;
}

const MONTH_CANON: Readonly<Record<string, string>> = {
  january: "jan",
  february: "feb",
  march: "mar",
  april: "apr",
  june: "jun",
  july: "jul",
  august: "aug",
  september: "sep",
  sept: "sep",
  october: "oct",
  november: "nov",
  december: "dec",
};

/**
 * So a brief's "January 2027" matches a model label reading "(Jan 2027)".
 *
 * Idempotent: every value in `MONTH_CANON` is either absent from its key set or
 * maps to itself, so canonicalising twice equals canonicalising once. That is
 * what lets the graph surface be canonicalised ONCE at build time (below)
 * instead of per quantity.
 */
const canonicaliseMonths = (s: string): string =>
  s.replace(/\b([a-z]+)\b/gi, (w) => MONTH_CANON[w.toLowerCase()] ?? w);

interface Surfaces {
  readonly candidates: readonly Candidate[];
  /** ⚠ ALREADY MONTH-CANONICAL. See `splitSurfaces`. */
  readonly modelStrings: readonly string[];
  /** ⚠ ALREADY MONTH-CANONICAL. See `splitSurfaces`. */
  readonly proseStrings: readonly string[];
}

/**
 * ⚠ THE SURFACES ARE CANONICALISED HERE, ONCE — NOT PER QUANTITY.
 *
 * `appearsInStrings` used to call `canonicaliseMonths(s)` inside its own
 * `strings.some(...)`, i.e. once per (quantity x string): it re-canonicalised
 * the ENTIRE graph surface Q times, and a profile put 87.1% of all self time in
 * that one call and its callback. The graph surface does not depend on the
 * quantity, so the work is hoisted to where it is done once. Measured on the
 * three real cold-read captures, and on the 8,000-char `brief_text` DB ceiling,
 * in the PR that made this change.
 *
 * The transform is idempotent (see `canonicaliseMonths`), so canonical strings
 * stored here read identically to the per-call form they replace.
 */
function splitSurfaces(graph: Record<string, unknown>): Surfaces {
  const modelStrings: string[] = [];
  const proseStrings: string[] = [];

  const walkText = (node: unknown, inProse: boolean): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      (inProse ? proseStrings : modelStrings).push(canonicaliseMonths(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) walkText(v, inProse);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === "widening_log") continue;
        walkText(v, inProse || PROSE_KEYS.has(k));
      }
    }
  };

  for (const [k, v] of Object.entries(graph)) {
    // Absence from the map means MODEL. `prose` is searched and reported as
    // commentary; `skip` is not searched at all.
    const cls = TOP_KEY_CLASS.get(k);
    if (cls === undefined) walkText(v, false);
    else if (cls === "prose") walkText(v, true);
  }

  return { candidates: collectCandidates(graph), modelStrings, proseStrings };
}

// ── matching ────────────────────────────────────────────────────────────────

const numbersEqual = (a: number, b: number): boolean =>
  a === b || Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-9;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does this quantity appear, as written, in one of these strings?
 *
 * ⚠ `strings` MUST ALREADY BE MONTH-CANONICAL — `splitSurfaces` does that once
 * for the whole graph. Only the quantity's own literal is canonicalised here,
 * which is O(1) per call rather than O(graph).
 */
function appearsInStrings(q: Quantity, strings: readonly string[]): boolean {
  const literal = canonicaliseMonths(q.literal.trim());
  // Boundary-guarded so "9%" does not match inside "129%", and the leading
  // `.` guard stops "3" matching the tail of "1.3".
  const re = new RegExp(
    `(?<![\\w.])${escapeRe(literal).replace(/\\?\s+/g, "\\s+")}(?![\\w])`,
    "i",
  );
  return strings.some((s) => re.test(s));
}

/**
 * Is this modelled quantity a plausible carrier of what the user stated?
 *
 * ⚠ MEASURED AND REJECTED for percentages, 2026-08-08: accepting a FRACTION
 * form (34% ~ 0.34). This pipeline emits unitless priors on [0,1] constantly,
 * so every stated percentage found a coincidental match. On brief B3 it
 * flipped EIGHT quantities from `absent` to `in_model` against an independent
 * oracle of ONE.
 *
 * ⚠ AND THE SAME MECHANISM, GENERALISED, 2026-08-09: magnitude agreement alone
 * is not evidence for ANY class. `fac_headcount_budget` carries `cap: 8` under
 * unit `"£m"`, so "8 people" and "£8m" are indistinguishable by magnitude and
 * mean completely different things.
 */
function unitCompatible(q: Quantity, c: Candidate): boolean {
  switch (q.kind) {
    case "money": {
      // Same currency, or it is not the user's figure. The trace measured a
      // real €900k -> £1.6m swap; a matcher blind to the currency would have
      // reported that swap as the user's own number.
      //
      // Compared as ISO CODES on both sides, via the canonical map: the brief
      // states a SYMBOL ("£") and the model may declare either form ("£m" or
      // "GBP"). Comparing symbols made the code form unmatchable; comparing
      // codes makes the two spellings of one currency agree and still keeps
      // different currencies apart.
      if (c.unitKind !== "currency" || c.currencyCode === null) return false;
      const stated = briefCurrencyCode(q.unit);
      return stated !== null && stated === c.currencyCode;
    }
    case "percent":
      return c.unitKind === "percent";
    case "count": {
      // ⚠ A COUNT MUST NAME ITS UNIT, AND THE CARRIER MUST DECLARE THE SAME
      // ONE. Measured 2026-08-09 against the real graphs: allowing a count to
      // match any non-money carrier made "5 people on the team" match
      // `out_csat`'s cap of 5 — declared unit "Trustpilot score" — and "1
      // year" / "1 month" / "1 engineer" all match `fac_automation_scale`'s
      // cap of 1, declared unit "scale". Those are not the user's figures.
      // Requiring the unit family to agree makes counts match rarely and
      // honestly; a count that cannot be verified falls to "not modelled yet",
      // which invites the user to add it rather than claiming we used it.
      if (q.unit === null || c.declaredUnit === null) return false;
      return sameUnitFamily(q.unit, c.declaredUnit);
    }
    default:
      // Dates and periods carry no magnitude; they match on text only.
      return false;
  }
}

/** The candidate this quantity matches, or null — NAMED, so a match can always
 *  say WHICH modelled quantity it is claiming. */
function matchCandidate(q: Quantity, candidates: readonly Candidate[]): Candidate | null {
  if (q.value === null) return null;
  for (const c of candidates) {
    if (!unitCompatible(q, c)) continue;
    if (numbersEqual(c.value, q.value)) return c;
  }
  return null;
}

function classify(
  q: Quantity,
  s: Surfaces,
): { verdict: QuantityVerdict; matched: Candidate | null } {
  const matched = matchCandidate(q, s.candidates);
  if (matched !== null) return { verdict: "in_model", matched };
  // Text is the second route: a figure written into a label, a unit string or
  // an encoding-map caption ("45 roles offshored (~40% saving)", "(Jan 2027)")
  // is genuinely carried by the model even though it is not a numeric field.
  if (appearsInStrings(q, s.modelStrings)) return { verdict: "in_model", matched: null };
  if (appearsInStrings(q, s.proseStrings)) return { verdict: "prose_only", matched: null };
  return { verdict: "absent", matched: null };
}

// ── the derivation ──────────────────────────────────────────────────────────

// ── the KIND axis: sourced from producers, never re-derived from prose ──────

/**
 * A span of the brief that a live `goal_constraints[]` row quotes.
 *
 * The row is the ORACLE. It carries `source_quote` — "the exact phrase from the
 * brief that implies this constraint" — plus `value` and `unit`, all emitted by
 * the drafting model and validated on the way in. We locate that quote in the
 * brief and remember WHERE it is. Nothing here parses the brief for constraint
 * language; the producer already decided, and this only asks *where*.
 */
interface ConstraintSpan {
  readonly start: number;
  readonly end: number;
  readonly value: number | null;
  readonly unit: string | null;
}

/**
 * Locate each constraint row's quoted sentence inside the brief.
 *
 * ⚠ A QUOTE THAT DOES NOT LOCATE IS DISCARDED, NOT APPROXIMATED. `source_quote`
 * is model-produced, and a model quote is a claim about the brief, not proof of
 * one: the estate has measured a hallucinated figure receiving `from_brief`
 * provenance identically to a quoted one. Substring verification against the
 * submitted text is the fabrication gate, and an unlocatable quote simply
 * classifies nothing — it can never invent a `constraint`.
 */
function constraintSpans(
  graph: Record<string, unknown>,
  briefText: string,
): ConstraintSpan[] {
  const rows = graph.goal_constraints;
  if (!Array.isArray(rows)) return [];

  const spans: ConstraintSpan[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const quote = r.source_quote;
    if (typeof quote !== "string" || quote.trim().length === 0) continue;

    // Verbatim first — the common case and the only one that needs no
    // judgement. Whitespace-normalised second, because a brief can carry a
    // newline where the model wrote a space.
    let start = briefText.indexOf(quote);
    let matched = quote;
    if (start < 0) {
      const loose = new RegExp(
        quote.trim().split(/\s+/).map(escapeRe).join("\\s+"),
      );
      const m = loose.exec(briefText);
      if (m === null) continue; // unlocatable ⇒ classifies nothing
      start = m.index;
      matched = m[0];
    }

    spans.push({
      start,
      end: start + matched.length,
      value: typeof r.value === "number" ? r.value : null,
      unit: typeof r.unit === "string" ? r.unit : null,
    });
  }
  return spans;
}

/**
 * The kind of one stated quantity.
 *
 * `constraint` requires BOTH halves, and the conjunction is the point:
 *   1. the figure sits INSIDE a span the producer quoted, and
 *   2. the producer's own `value` corroborates the figure.
 *
 * Position alone would sweep up every number that happens to share a sentence
 * with a limit ("CSAT is 87%. Do not let it drop below 85%" — one sentence, two
 * very different claims). Value alone would sweep up every restatement of the
 * same number elsewhere in the brief. Requiring both binds the classification
 * to the OCCURRENCE the producer actually claimed, which is identity binding,
 * not a value predicate another object could satisfy.
 *
 * Everything the producers do not claim is `figure`. That is not a fallback —
 * it is the honest answer, and it is what makes a lost constraint VISIBLE
 * instead of invented back.
 */
function classifyStatedKind(q: Quantity, spans: readonly ConstraintSpan[]): StatedKind {
  const end = q.at + q.literal.length;
  for (const span of spans) {
    if (q.at < span.start || end > span.end) continue;
    if (span.value === null) continue;
    // The magnitude as written (85) or fully expanded (0.85 → 85%, £11.2m →
    // 11_200_000); the producer may hold either form.
    if (
      (q.value !== null && numbersEqual(q.value, span.value)) ||
      (q.mantissa !== null && numbersEqual(q.mantissa, span.value))
    ) {
      return "constraint";
    }
  }
  return "figure";
}

const SCOPE = {
  searched:
    "quantities stated in the brief that carry a unit: money, percentages, counts with a unit word, calendar dates and fiscal periods",
  // ⚠ DERIVED FROM `CANDIDATE_COLLECTIONS`, NOT RESTATED. This sentence is
  // USER-VISIBLE COPY describing what we searched, and it was WRONG: it read
  // "node, edge and option values" while `collectCandidates` walks only
  // `nodes` and `options` — excluding the `edges` subtree deliberately, and
  // saying so in its own docstring. Telling a user we searched edge values
  // while reporting their figure "not modelled" is the confident-false
  // statement this whole module exists to prevent, so the noun list is now
  // generated from the constant that decides it and cannot drift again.
  model_surface: [
    `${CANDIDATE_COLLECTIONS.map((c) => c.replace(/s$/, "")).join(" and ")} values, caps, units, labels and encoding maps`,
  ],
  prose_surface: ["coaching cards", "draft warnings", "validation warnings"],
  excluded_from_search: [
    "bare numbers carrying no unit, currency or percent sign",
    "everything in not_tracked",
  ],
} as const;

const UNAVAILABLE = (
  reason: "no_brief_text" | "no_graph",
): NotModelledManifest => ({
  schema: NOT_MODELLED_SCHEMA,
  status: "unavailable",
  unavailable_reason: reason,
  scope: SCOPE,
  // NOT an empty tally. We did not look, so we know nothing — and a zero here
  // would be read as "nothing was dropped".
  quantities: null,
  // The VOCABULARY is a property of this derivation, not of any one scenario,
  // so it is stated even when we could not look — a consumer must be able to
  // render "we do not track disagreements" without a successful derivation.
  // The TALLY is all zeros here for the same reason `quantities` is null: we
  // counted nothing because we looked at nothing, and the zeros are only
  // readable alongside `status: "unavailable"`.
  stated_kinds: {
    status: "derived",
    tally: Object.fromEntries(STATED_KINDS.map((k) => [k, 0])) as Record<
      StatedKind,
      number
    >,
    sourced: SOURCED_STATED_KINDS,
    unsourced: UNSOURCED_STATED_KINDS,
    producers: STATED_KIND_PRODUCERS,
  },
  declared_exclusions: { status: "not_recorded", items: [] },
  inferred_factors: { status: "not_recorded", items: [] },
  not_tracked: NOT_TRACKED_CLASSES,
});

/**
 * Derive the manifest for one scenario.
 *
 * Pure. No I/O, no clock, no randomness — the same (brief, graph) always yields
 * the same manifest, which is what lets a consumer cache it against the graph
 * identity hash.
 */
export function deriveNotModelledManifest(
  briefText: string | null | undefined,
  graph: unknown,
): NotModelledManifest {
  if (typeof briefText !== "string" || briefText.trim().length === 0) {
    return UNAVAILABLE("no_brief_text");
  }
  if (graph === null || graph === undefined || typeof graph !== "object") {
    return UNAVAILABLE("no_graph");
  }

  const surfaces = splitSurfaces(graph as Record<string, unknown>);
  const quantities = extractStatedQuantities(briefText);
  const spans = constraintSpans(graph as Record<string, unknown>, briefText);

  const items: NotModelledItem[] = [];
  const matchedNodeIds = new Set<string>();
  const tally = Object.fromEntries(
    STATED_KINDS.map((k) => [k, 0]),
  ) as Record<StatedKind, number>;
  let inModel = 0;
  let proseOnly = 0;
  let absent = 0;

  for (const q of quantities) {
    const { verdict, matched } = classify(q, surfaces);
    if (matched !== null) matchedNodeIds.add(matched.nodeId);
    if (verdict === "in_model") inModel += 1;
    else if (verdict === "prose_only") proseOnly += 1;
    else absent += 1;
    if (items.length < MAX_ITEMS) {
      const statedKind = classifyStatedKind(q, spans);
      tally[statedKind] += 1;
      items.push({
        literal: q.literal,
        kind: q.kind,
        char_offset: q.at,
        verdict,
        // Which modelled quantity this figure was matched to. Null for a text
        // match. A numeric match that cannot name its carrier is not a match.
        matched_node_id: matched?.nodeId ?? null,
        stated_kind: statedKind,
      });
    }
  }

  return {
    schema: NOT_MODELLED_SCHEMA,
    status: "derived",
    unavailable_reason: null,
    scope: SCOPE,
    quantities: {
      // Tallies count EVERY quantity found, not just the reported slice.
      total: quantities.length,
      in_model: inModel,
      prose_only: proseOnly,
      absent,
      truncated: quantities.length > items.length,
      items,
    },
    stated_kinds: {
      status: "derived",
      tally,
      sourced: SOURCED_STATED_KINDS,
      unsourced: UNSOURCED_STATED_KINDS,
      producers: STATED_KIND_PRODUCERS,
    },
    declared_exclusions: readDeclaredExclusions(graph as Record<string, unknown>),
    inferred_factors: deriveInferredFactors(
      graph as Record<string, unknown>,
      matchedNodeIds,
      numericTokensIn(briefText),
    ),
    not_tracked: NOT_TRACKED_CLASSES,
  };
}
