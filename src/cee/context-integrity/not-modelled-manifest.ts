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
 * Top-level graph keys that are NOT the model: diagnostics, timings, coaching
 * commentary, warnings, quality scores. Coaching is deliberately here — a
 * figure QUOTED BACK in a coaching card was noticed, but it does not
 * parameterise anything, and telling the user it is "in the model" when it
 * parameterises nothing is the confident-false-statement failure the trace
 * measured as loss class 7.
 */
const NON_MODEL_TOP_KEYS: ReadonlySet<string> = new Set([
  "trace",
  "_timings",
  "_pipeline_outcome",
  "coaching",
  "draft_warnings",
  "validation_warnings",
  "quality",
  "analysis_ready",
  "schema_version",
]);

/** Top-level keys that are commentary we still want to search, so a quantity
 *  found only there can be reported as `prose_only` rather than `absent`. */
const PROSE_TOP_KEYS: ReadonlySet<string> = new Set([
  "coaching",
  "draft_warnings",
  "validation_warnings",
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
function collectFactorNumbers(node: Record<string, unknown>): number[] {
  const out: number[] = [];
  const push = (v: unknown): void => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  };
  const prior = node.prior;
  if (prior !== null && typeof prior === "object") {
    const p = prior as Record<string, unknown>;
    push(p.range_min);
    push(p.range_max);
    push(p.value);
  }
  // ⚠ THE FIELD LIST IS THE WHOLE CORRECTNESS ARGUMENT, and its asymmetry runs
  // the DANGEROUS way — which is why it is pinned by a discrimination test
  // rather than trusted. A field MISSING here means a figure the user really
  // stated goes unseen, and we then tell them we invented their own number.
  // (Measured: `observed_state.cap` and `raw_value` were absent from the first
  // version, and B2's offshore-scale factor — carrying the brief's £2.9m cap —
  // was wrongly claimed as ours.)
  const observed = node.observed_state;
  if (observed !== null && typeof observed === "object") {
    const o = observed as Record<string, unknown>;
    push(o.value);
    push(o.raw);
    push(o.raw_value);
    push(o.cap);
  }
  push(node.value);
  push(node.raw);
  push(node.raw_value);
  push(node.cap);
  const data = node.data;
  if (data !== null && typeof data === "object") {
    const d = data as Record<string, unknown>;
    push(d.value);
    push(d.raw);
    push(d.raw_value);
    push(d.cap);
  }
  // The encoding map's KEYS are encoded levels, but its captions carry the
  // real-world figures the model is claiming ("45 roles offshored (~40%
  // saving)"), so a factor whose caption quotes the brief is not ours.
  const encoding = node.encoding_map;
  if (encoding !== null && typeof encoding === "object") {
    for (const caption of Object.values(encoding as Record<string, unknown>)) {
      if (typeof caption !== "string") continue;
      for (const m of caption.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
        push(Number(m[0].replace(/,/g, "")));
      }
    }
  }
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
 */
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
  const carriers: Array<Record<string, unknown>> = [node];
  for (const nested of ["observed_state", "data"] as const) {
    const v = node[nested];
    if (v !== null && typeof v === "object") carriers.push(v as Record<string, unknown>);
  }
  for (const carrier of carriers) {
    const { scale } = parseUnit(carrier.unit);
    for (const field of ["value", "raw", "raw_value", "cap"] as const) {
      const v = carrier[field];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      out.push(v);
      if (scale !== 1) out.push(v * scale);
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
  const prior = node.prior;
  if (prior !== null && typeof prior === "object") {
    for (const v of Object.values(prior as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v >= 0 && v <= 1) continue;
      out.push(v);
    }
  }

  // Encoding-map captions carry real-world figures ("45 roles offshored").
  const encoding = node.encoding_map;
  if (encoding !== null && typeof encoding === "object") {
    for (const caption of Object.values(encoding as Record<string, unknown>)) {
      if (typeof caption !== "string") continue;
      for (const m of caption.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
        out.push(Number(m[0].replace(/,/g, "")));
      }
    }
  }
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
    // ⚠ IT CANNOT CURRENTLY BITE, AND THAT IS DELIBERATE — DEMONSTRATED, not
    // assumed. A numeric match compares the same underlying magnitudes the
    // coincidence guard below does, so today every matched node is ALSO
    // coincidence-suppressed: removing this line leaves 0 clashes across 12
    // notations. It stays because the no-contradiction property must rest on
    // the AUTHORITY, not on a heuristic that happens to subsume it — narrow the
    // guard below (as B3-2 rightly did) and this becomes load-bearing
    // immediately. Same shape as the topology exclusion: a second line of
    // defence against a configuration today's code does not produce.
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
  readonly unitClass: "money" | "percent" | "other";
  /** Currency symbol for money candidates, so € never matches £. */
  readonly symbol: string | null;
  /** The unit string the model declared, verbatim. A count can only match a
   *  carrier that declares the same unit family. */
  readonly declaredUnit: string | null;
}

const CURRENCY_SYMBOLS = ["£", "€", "$"] as const;

/** Parse a declared unit string into a class, a currency symbol and a scale. */
function parseUnit(unit: unknown): {
  unitClass: Candidate["unitClass"];
  symbol: string | null;
  scale: number;
} {
  if (typeof unit !== "string" || unit.trim().length === 0) {
    return { unitClass: "other", symbol: null, scale: 1 };
  }
  const u = unit.trim();
  if (u === "%" || /percent/i.test(u)) return { unitClass: "percent", symbol: null, scale: 1 };
  const symbol = CURRENCY_SYMBOLS.find((c) => u.includes(c)) ?? null;
  if (symbol !== null) {
    const suffix = u.replace(symbol, "").trim();
    return { unitClass: "money", symbol, scale: resolveMagnitude(suffix) };
  }
  return { unitClass: "other", symbol: null, scale: 1 };
}

/**
 * Numeric candidates come ONLY from node/option value carriers that declare a
 * unit alongside them. Everything else numeric in the graph — prior bounds
 * (unitless [0,1]), intervention encodings (unitless 0..1), and the entire
 * `edges` subtree (strength, exists_probability, validation passes) — is
 * DELIBERATELY EXCLUDED. Those numbers are how the model computes, not what it
 * is claiming about the world, and matching against them is how a stated
 * quantity gets "found" in a model that never carried it.
 */
function collectCandidates(graph: Record<string, unknown>): Candidate[] {
  const out: Candidate[] = [];
  const collections = ["nodes", "options"] as const;
  for (const key of collections) {
    const entries = graph[key];
    if (!Array.isArray(entries)) continue;
    for (const raw of entries) {
      if (raw === null || typeof raw !== "object") continue;
      const node = raw as Record<string, unknown>;
      const nodeId = typeof node.id === "string" ? node.id : null;
      const label = typeof node.label === "string" ? node.label : null;
      if (nodeId === null || label === null) continue;

      // Each carrier is (values..., unit) taken from the SAME object, so a
      // value can never borrow a unit from elsewhere.
      const carriers: Array<Record<string, unknown>> = [node];
      for (const nested of ["observed_state", "data"] as const) {
        const v = node[nested];
        if (v !== null && typeof v === "object") carriers.push(v as Record<string, unknown>);
      }
      for (const carrier of carriers) {
        const { unitClass, symbol, scale } = parseUnit(carrier.unit);
        for (const field of ["value", "raw", "raw_value", "cap"] as const) {
          const v = carrier[field];
          if (typeof v !== "number" || !Number.isFinite(v)) continue;
          out.push({
            nodeId,
            label,
            value: v * scale,
            unitClass,
            symbol,
            declaredUnit: typeof carrier.unit === "string" ? carrier.unit : null,
          });
        }
      }
    }
  }
  return out;
}

interface Surfaces {
  readonly candidates: readonly Candidate[];
  readonly modelStrings: readonly string[];
  readonly proseStrings: readonly string[];
}

function splitSurfaces(graph: Record<string, unknown>): Surfaces {
  const modelStrings: string[] = [];
  const proseStrings: string[] = [];

  const walkText = (node: unknown, inProse: boolean): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      (inProse ? proseStrings : modelStrings).push(node);
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
    if (!NON_MODEL_TOP_KEYS.has(k)) walkText(v, false);
    else if (PROSE_TOP_KEYS.has(k)) walkText(v, true);
  }

  return { candidates: collectCandidates(graph), modelStrings, proseStrings };
}

// ── matching ────────────────────────────────────────────────────────────────

const numbersEqual = (a: number, b: number): boolean =>
  a === b || Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-9;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

/** So a brief's "January 2027" matches a model label reading "(Jan 2027)". */
const canonicaliseMonths = (s: string): string =>
  s.replace(/\b([a-z]+)\b/gi, (w) => MONTH_CANON[w.toLowerCase()] ?? w);

function appearsInStrings(q: Quantity, strings: readonly string[]): boolean {
  const literal = canonicaliseMonths(q.literal.trim());
  // Boundary-guarded so "9%" does not match inside "129%", and the leading
  // `.` guard stops "3" matching the tail of "1.3".
  const re = new RegExp(
    `(?<![\\w.])${escapeRe(literal).replace(/\\?\s+/g, "\\s+")}(?![\\w])`,
    "i",
  );
  return strings.some((s) => re.test(canonicaliseMonths(s)));
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
    case "money":
      // Same currency, or it is not the user's figure. The trace measured a
      // real €900k -> £1.6m swap; a matcher blind to the symbol would have
      // reported that swap as the user's own number.
      return c.unitClass === "money" && c.symbol === q.unit;
    case "percent":
      return c.unitClass === "percent";
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

const SCOPE = {
  searched:
    "quantities stated in the brief that carry a unit: money, percentages, counts with a unit word, calendar dates and fiscal periods",
  model_surface: [
    "node, edge and option values, caps, units, labels and encoding maps",
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

  const items: NotModelledItem[] = [];
  const matchedNodeIds = new Set<string>();
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
      items.push({
        literal: q.literal,
        kind: q.kind,
        char_offset: q.at,
        verdict,
        // Which modelled quantity this figure was matched to. Null for a text
        // match. A numeric match that cannot name its carrier is not a match.
        matched_node_id: matched?.nodeId ?? null,
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
    declared_exclusions: readDeclaredExclusions(graph as Record<string, unknown>),
    inferred_factors: deriveInferredFactors(
      graph as Record<string, unknown>,
      matchedNodeIds,
      numericTokensIn(briefText),
    ),
    not_tracked: NOT_TRACKED_CLASSES,
  };
}
