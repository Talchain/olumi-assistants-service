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

const MAGNITUDE: Readonly<Record<string, number>> = {
  k: 1e3,
  m: 1e6,
  bn: 1e9,
  b: 1e9,
};

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
    `(?<money>(?<mcur>[£€$])\\s?(?<mnum>\\d[\\d,]*(?:\\.\\d+)?)\\s?(?<mmag>bn|[kmb])?)(?![\\d])`,
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
}

const toNumber = (raw: string): number => Number(raw.replace(/,/g, ""));

export function extractStatedQuantities(text: string): Quantity[] {
  const out: Quantity[] = [];
  for (const m of text.matchAll(QUANTITY_RE)) {
    const g = m.groups ?? {};
    const at = m.index ?? 0;
    const literal = m[0];
    if (g.money !== undefined && g.mnum !== undefined) {
      const base = toNumber(g.mnum);
      const mag = g.mmag ? (MAGNITUDE[g.mmag.toLowerCase()] ?? 1) : 1;
      out.push({ literal, at, kind: "money", value: base * mag, mantissa: base });
    } else if (g.percent !== undefined && g.pnum !== undefined) {
      const v = toNumber(g.pnum);
      out.push({ literal, at, kind: "percent", value: v, mantissa: v });
    } else if (g.date !== undefined) {
      out.push({ literal, at, kind: "date", value: null, mantissa: null });
    } else if (g.period !== undefined) {
      out.push({ literal, at, kind: "period", value: null, mantissa: null });
    } else if (g.counted !== undefined && g.cnum !== undefined) {
      const v = toNumber(g.cnum);
      out.push({ literal, at, kind: "count", value: v, mantissa: v });
    } else if (g.hyph !== undefined && g.hnum !== undefined) {
      const v = toNumber(g.hnum);
      out.push({ literal, at, kind: "count", value: v, mantissa: v });
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

function deriveInferredFactors(
  graph: Record<string, unknown>,
  stated: readonly Quantity[],
): NotModelledManifest["inferred_factors"] {
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) return { status: "not_recorded", items: [] };

  const statedForms: number[] = [];
  for (const q of stated) {
    if (q.value !== null) statedForms.push(q.value);
    if (q.mantissa !== null) statedForms.push(q.mantissa);
  }

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

    const numbers = collectFactorNumbers(node);
    // A factor carrying no figure at all is not something we "estimated" — it
    // is structural. Only claim an estimate where there is a number to own.
    if (numbers.length === 0) continue;

    const matchesSomethingStated = numbers.some((n) =>
      statedForms.some((f) => numbersEqual(n, f)),
    );
    if (!matchesSomethingStated) items.push({ node_id: id, label });
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

interface Surfaces {
  readonly modelNumbers: ReadonlySet<number>;
  readonly modelStrings: readonly string[];
  readonly proseNumbers: ReadonlySet<number>;
  readonly proseStrings: readonly string[];
}

function splitSurfaces(graph: Record<string, unknown>): Surfaces {
  const modelNumbers = new Set<number>();
  const proseNumbers = new Set<number>();
  const modelStrings: string[] = [];
  const proseStrings: string[] = [];

  const walk = (node: unknown, inProse: boolean): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "number") {
      (inProse ? proseNumbers : modelNumbers).add(node);
      return;
    }
    if (typeof node === "string") {
      (inProse ? proseStrings : modelStrings).push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) walk(v, inProse);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        // The exclusion record is reported separately and verbatim; a figure
        // that appears ONLY there is absent from the model, not "mentioned in
        // the explanation", so it must not be scored against either surface.
        if (k === "widening_log") continue;
        walk(v, inProse || PROSE_KEYS.has(k));
      }
    }
  };

  for (const [k, v] of Object.entries(graph)) {
    if (!NON_MODEL_TOP_KEYS.has(k)) walk(v, false);
    else if (PROSE_TOP_KEYS.has(k)) walk(v, true);
  }

  return { modelNumbers, modelStrings, proseNumbers, proseStrings };
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
 * ⚠ MEASURED AND REJECTED, 2026-08-08: accepting a FRACTION form for a
 * percentage (34% ~ 0.34).
 *
 * It looks like the safe, generous reading. It is not. This pipeline emits
 * unitless priors on [0,1] constantly, so every stated percentage finds a
 * coincidental match against some prior bound. On brief B3 the rule flipped
 * EIGHT quantities from `absent` to `in_model` against an independent oracle of
 * ONE — turning the manifest into precisely the reassuring falsehood it exists
 * to prevent. A percentage counts as retained only if the model carries it AS a
 * percentage: the number 34, or the literal "34%" in a label or unit.
 */
function classify(q: Quantity, s: Surfaces): QuantityVerdict {
  if (q.value !== null && q.mantissa !== null) {
    for (const n of s.modelNumbers) {
      if (numbersEqual(n, q.value) || numbersEqual(n, q.mantissa)) return "in_model";
    }
  }
  if (appearsInStrings(q, s.modelStrings)) return "in_model";
  if (q.value !== null && q.mantissa !== null) {
    for (const n of s.proseNumbers) {
      if (numbersEqual(n, q.value) || numbersEqual(n, q.mantissa)) return "prose_only";
    }
  }
  if (appearsInStrings(q, s.proseStrings)) return "prose_only";
  return "absent";
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
  let inModel = 0;
  let proseOnly = 0;
  let absent = 0;

  for (const q of quantities) {
    const verdict = classify(q, surfaces);
    if (verdict === "in_model") inModel += 1;
    else if (verdict === "prose_only") proseOnly += 1;
    else absent += 1;
    if (items.length < MAX_ITEMS) {
      items.push({
        literal: q.literal,
        kind: q.kind,
        char_offset: q.at,
        verdict,
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
      quantities,
    ),
    not_tracked: NOT_TRACKED_CLASSES,
  };
}
