/**
 * THE DRAFT PRODUCT-QUALITY RUBRIC — what a human strategist would care about,
 * computed mechanically from a projected draft.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `DRAFT_RECORDS_INSTRUCTION` (`src/cee/draft/records/instruction.ts`) owns the
 * draft output contract, ships as a CODE CONSTANT, and therefore sits outside
 * the prompt-management system: there is no `/admin/prompts` row for it, no
 * candidate version, and — until this module — no non-serving way to ask
 * whether a change to it made the product better. That is why v3 and v6 shipped
 * with their own pins recording "UNMEASURED".
 *
 * The estate's existing draft harnesses answer a DIFFERENT question:
 *   · `tests/integration/adversarial.test.ts` — HTTP status codes.
 *   · `tests/validation/golden-briefs-runner.test.ts` — the 200 rate, twice.
 *   · `tools/graph-evaluator`'s legacy rubric — scores the SUPERSEDED graph
 *     grammar, nulls `overall_score` whenever `legacy_structural_valid` is
 *     false (9 of 14 baseline cases), and its own README concedes 30% of the
 *     score is constant.
 * None of them can say whether a draft is a good MODEL. This one is only about
 * that.
 *
 * ── EVERY BAR IS DERIVED FROM A PRODUCER, NOT CHOSEN HERE (P7) ─────────────
 * A rubric whose thresholds come from its author's taste is a guard agreeing
 * with itself. Each check below names the artefact that states the bar:
 *   · goal / decision / option / factor label rules  → `MODEL-QUALITY-BAR.md`
 *     §1 Q1, Q1b, Q3, Q4 (and the projector line each cites).
 *   · unit + range honesty                           → §1 Q5, plus the graph
 *     schema's own semantics for `value` / `raw_value` / `unit`
 *     (`src/schemas/graph.ts:122-134,203-229`): `value` is the model 0-1 scale
 *     by construction, so "value is in [0,1]" is NOT a defect — a value with
 *     NEITHER a unit NOR a display-scale `raw_value` is, because nothing tells
 *     the reader what the number means.
 *   · "at least one risk"                            → the SERVED draft prompt
 *     itself, pinned on disk at
 *     `tools/graph-evaluator/governed/draft-graph-v5/baseline/pms-draft-graph-v195.txt`
 *     :99 ("≥1 outcome and ≥1 risk") and :109 ("include at least one risk that
 *     could materially weaken or overturn an option's attractiveness.
 *     Decorative risk does not count.").
 *   · Status Quo label + `is_baseline`               → same file, :279 ("Label
 *     MUST contain \"Status Quo\"") and :283 (`is_baseline: true` mandatory).
 *   · option budget                                  → `MAX_OPTIONS = 6`,
 *     `src/validators/graph-validator.types.ts:287` (CEE diverges from the
 *     platform's 10 deliberately).
 *   · connectivity + repair burden                   → `validateGraph`, the
 *     enforcement gate's own predicate. Its codes are read, never restated.
 *   · `expect_status_quo` / `has_numeric_target`     → the brief corpus's OWN
 *     front-matter (`tools/graph-evaluator/briefs/*.md`), an oracle written
 *     with the briefs and not by this lane.
 *
 * ── ⚠ THERE IS NO COMPOSITE SCORE, DELIBERATELY ────────────────────────────
 * Rolling eight dimensions into one number requires weights, and weights here
 * would be invented. What this emits instead is:
 *   · CHECKS — boolean, each traceable to a producer-stated bar. The headline
 *     is `checksPassed / checksApplicable`, which cannot drift with mood.
 *   · MEASURES — counts and lists that a human reads directly (graph size,
 *     repair-ask counts, the actual offending labels).
 * A dimension that genuinely needs judgement emits its EVIDENCE, never a
 * fabricated number. `evaluable: false` is a first-class answer and is never
 * silently scored as a pass.
 *
 * ── WHAT THIS CANNOT MEASURE ───────────────────────────────────────────────
 * Stated on the module rather than in a README nobody opens:
 *   · whether the model's causal claims are TRUE, or the options wise;
 *   · anything about prose the user reads (coaching, summaries) — this scores
 *     the MODEL only;
 *   · anything downstream of the draft (analysis, EVPI, the panel's rendering);
 *   · goal-label QUALITY beyond "is it a verbatim fragment / a compound join /
 *     over-long". "Is this a good objective?" is JUDGEMENT and is emitted as
 *     evidence (the labels themselves) for a human sheet.
 *   · brief conservation (Q9) — extraction over prose cannot be a gate; the
 *     numeral check below is deliberately the narrow HONESTY half of it.
 */
import { canonicalText } from "../../src/cee/draft/records/projector.js";
import { MAX_OPTIONS } from "../../src/validators/graph-validator.types.js";
import { DEFAULT_GOAL_LABEL } from "../../src/cee/structure/goal-inference.js";

/** Minimum viable spine: decision + goal + two options + a factor + a result. */
export const MIN_VIABLE_NODE_COUNT = 6;

/** The producer's floor, from the served prompt (v195:99). */
export const MIN_AUTHORED_RISKS = 1;

/** The producer's floor for a decision to be a decision at all. */
export const MIN_OPTIONS = 2;

/**
 * Validator codes that mean "this model does not join up". Read from
 * `validateGraph`'s own vocabulary — never re-derived structurally here, so the
 * rubric cannot disagree with the gate the product actually enforces.
 */
export const CONNECTIVITY_ERROR_CODES = [
  "MISSING_GOAL",
  "NO_PATH_TO_GOAL",
  "NO_EFFECT_PATH",
  "UNREACHABLE_FROM_DECISION",
  "UNREACHABLE_CONTROLLABLE_FACTOR",
] as const;

/**
 * Validator codes that become a "supply this value" ask to the user. These are
 * the repair burden the draft manufactures.
 */
export const MISSING_VALUE_ERROR_CODES = [
  "CONTROLLABLE_MISSING_DATA",
  "OBSERVABLE_MISSING_DATA",
  "MISSING_OPTION_VALUE",
] as const;

export interface RubricCheck {
  readonly id: string;
  readonly dimension: string;
  /** The producer artefact that states this bar. */
  readonly authority: string;
  readonly passed: boolean | null;
  /** `null` pass ⇒ not evaluable on this input; `reason` says why. */
  readonly reason: string;
}

export interface DraftQualityMeasures {
  // ── D1 goal framing
  readonly goalNodeCount: number;
  readonly goalLabels: readonly string[];
  readonly goalLabelsVerbatimQuote: readonly string[];
  readonly goalLabelsCompoundPrefixed: readonly string[];
  readonly goalLabelsOverNineWords: readonly string[];
  readonly goalLabelsEndingInQuestionMark: readonly string[];
  readonly decisionLabel: string | null;

  // ── D2 unit discipline
  readonly factorCount: number;
  readonly factorsWithValue: number;
  readonly factorsInterpretable: number;
  readonly factorsBareUnitInterval: number;
  readonly bareUnitIntervalLabels: readonly string[];

  // ── D3 risk coverage
  readonly riskCount: number;
  readonly authoredRiskCount: number;
  readonly riskLabels: readonly string[];

  // ── D4 option coverage
  readonly optionCount: number;
  readonly optionLabels: readonly string[];
  readonly optionLabelsVerbatimQuote: readonly string[];
  readonly distinctOptionLabelCount: number;
  readonly statusQuoOptionCount: number;
  readonly statusQuoLabelCompliant: boolean;
  readonly expectStatusQuo: boolean | null;

  // ── D5 connectivity
  readonly orphanNodeIds: readonly string[];
  readonly connectivityErrorCodes: readonly string[];
  readonly connectivityErrorCount: number;

  // ── D6 size
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodesByKind: Readonly<Record<string, number>>;

  // ── D7 repair burden
  readonly blockingErrorCount: number;
  readonly blockingErrorCodes: readonly string[];
  readonly missingValueAskCount: number;
  readonly missingValueAsksOverSystemInferredStructure: number;

  // ── D8 invented quantity
  readonly statedNumeralsChecked: number;
  readonly statedNumeralsNotFoundInBrief: readonly string[];
  readonly briefTextAvailable: boolean;

  // ── outcomes, kept because the 14 Aug outage was an outcome-layer outage
  readonly outcomeCount: number;
  readonly scaffoldedOutcomeCount: number;
}

export interface DraftQualityScore {
  readonly briefId: string;
  readonly checks: readonly RubricCheck[];
  readonly checksPassed: number;
  readonly checksApplicable: number;
  readonly checksUnevaluable: number;
  readonly measures: DraftQualityMeasures;
}

/**
 * The validator verdict this rubric reads. Supplied by the caller so the rubric
 * stays a pure function and the caller owns the (async) chain.
 *
 * `path` is carried, not just `code`, because P6 needs to know WHICH node an ask
 * is over: an ask over structure the SYSTEM invented may be offered but never
 * demanded, and a bare code cannot tell you that.
 */
export interface ValidatorIssue {
  readonly code: string;
  /** `nodesById.<id>` — `validatorNodePath`, src/validators/violation-paths.ts:58. */
  readonly path?: string;
}

export interface ValidatorVerdict {
  readonly errors: readonly ValidatorIssue[];
  readonly warnings: readonly ValidatorIssue[];
}

/** `nodesById.<id>` → `<id>`. Returns undefined for any other path shape. */
export function nodeIdFromValidatorPath(path: string | undefined): string | undefined {
  if (typeof path !== "string") return undefined;
  const m = /^nodesById\.(.+)$/.exec(path);
  return m ? m[1] : undefined;
}

export interface ScoreInput {
  readonly briefId: string;
  /** The projected draft graph. */
  readonly graph: unknown;
  /** The verbatim brief. Absent ⇒ the numeral-honesty check is UNEVALUABLE. */
  readonly briefText?: string;
  /** From the brief's own front-matter. Absent ⇒ the status-quo check is UNEVALUABLE. */
  readonly expectStatusQuo?: boolean;
  /** `validateGraph`'s verdict. Absent ⇒ connectivity + repair are UNEVALUABLE. */
  readonly verdict?: ValidatorVerdict;
}

interface GNode {
  id?: string;
  kind?: string;
  label?: string;
  is_baseline?: boolean;
  data?: Record<string, unknown>;
  provenance?: unknown;
}

const PROJECTOR_STRUCTURAL = "projector_structural";

function nodesOf(graph: unknown): GNode[] {
  const n = (graph as { nodes?: unknown })?.nodes;
  return Array.isArray(n) ? (n as GNode[]) : [];
}

function edgesOf(graph: unknown): { from?: string; to?: string }[] {
  const e = (graph as { edges?: unknown })?.edges;
  return Array.isArray(e) ? (e as { from?: string; to?: string }[]) : [];
}

/**
 * The projector emits node provenance as an OBJECT
 * (`{provenance_class, source_quote, ...}`); the persisted GraphV3 wire carries
 * a STRING enum. Both shapes are read, and an unrecognised shape returns
 * `undefined` rather than a default — a default here would silently classify
 * every node as authored-by-someone and make the structural counts lie.
 */
function provenanceClassOf(node: GNode): string | undefined {
  const p = node.provenance;
  if (typeof p === "string") return p;
  if (p && typeof p === "object") {
    const c = (p as { provenance_class?: unknown }).provenance_class;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

function sourceQuoteOf(node: GNode): string | undefined {
  const p = node.provenance;
  if (p && typeof p === "object") {
    const q = (p as { source_quote?: unknown }).source_quote;
    if (typeof q === "string") return q;
  }
  return undefined;
}

/** Word count over the canonicalised label. */
function wordCount(label: string): number {
  const t = canonicalText(label);
  return t.length === 0 ? 0 : t.split(" ").length;
}

/**
 * A factor's number is INTERPRETABLE when the reader can tell what it means:
 * a `unit`, or a display-scale `raw_value`. Derived from the schema's own
 * doc comments, not from a preference — `value` alone is the model 0-1 scale
 * and carries no meaning on its own.
 */
function isInterpretableFactorValue(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  return data.unit !== undefined || typeof data.raw_value === "number";
}

/**
 * Numerals a draft asserts the USER stated. Only these can be "invented" — an
 * `ai_inferred` number is a hypothesis the product is entitled to hold, and
 * flagging it would penalise honesty (Q6's TWIN).
 */
function statedNumeralsOf(nodes: readonly GNode[]): { nodeLabel: string; numeral: number }[] {
  const out: { nodeLabel: string; numeral: number }[] = [];
  for (const n of nodes) {
    const stated =
      provenanceClassOf(n) === "stated" ||
      provenanceClassOf(n) === "from_brief" ||
      n.data?.extractionType === "explicit";
    if (!stated) continue;
    const raw = n.data?.raw_value;
    if (typeof raw === "number") out.push({ nodeLabel: n.label ?? n.id ?? "?", numeral: raw });
    const cap = n.data?.cap;
    if (typeof cap === "number") out.push({ nodeLabel: n.label ?? n.id ?? "?", numeral: cap });
  }
  return out;
}

/**
 * Does a numeral appear in the brief? Deliberately GENEROUS — a false "invented"
 * claim is far worse than a missed one, so every ordinary written form of the
 * number counts as present (thousands separators, the `4M` / `250k` shorthands,
 * a percentage written as `20%` for `0.2`, and a trailing `.0`).
 *
 * ⚠ This is the one predicate here that runs over prose, so it is scoped to the
 * narrowest possible claim: it only ever fires on a numeral the draft has
 * ALREADY badged as the user's own.
 */
export function numeralAppearsInBrief(numeral: number, brief: string): boolean {
  const haystack = brief.replace(/,/g, "").toLowerCase();
  const forms = new Set<string>();
  const add = (s: string) => { if (s.length > 0) forms.add(s.toLowerCase()); };

  const abs = Math.abs(numeral);
  add(String(numeral));
  add(String(abs));
  if (Number.isInteger(abs)) {
    add(abs.toFixed(0));
    if (abs >= 1_000 && abs % 1_000 === 0) add(`${abs / 1_000}k`);
    if (abs >= 1_000_000 && abs % 1_000_000 === 0) add(`${abs / 1_000_000}m`);
    if (abs >= 1_000_000_000 && abs % 1_000_000_000 === 0) add(`${abs / 1_000_000_000}bn`);
  } else {
    add(abs.toString());
    // A proportion written as a percentage, and vice versa.
    const asPct = abs * 100;
    if (Number.isFinite(asPct)) {
      add(String(Number(asPct.toFixed(6))));
      add(`${Number(asPct.toFixed(6))}%`);
    }
    add(abs.toFixed(1));
    add(abs.toFixed(2));
  }

  for (const f of forms) if (haystack.includes(f)) return true;
  return false;
}

export function scoreDraft(input: ScoreInput): DraftQualityScore {
  const nodes = nodesOf(input.graph);
  const edges = edgesOf(input.graph);
  const checks: RubricCheck[] = [];
  const check = (
    id: string,
    dimension: string,
    authority: string,
    passed: boolean | null,
    reason: string,
  ) => checks.push({ id, dimension, authority, passed, reason });

  // ── D1 · GOAL FRAMING ─────────────────────────────────────────────────────
  const goals = nodes.filter((n) => n.kind === "goal");
  const goalLabels = goals.map((g) => g.label ?? "");
  const goalVerbatim = goals
    .filter((g) => {
      const q = sourceQuoteOf(g);
      return q !== undefined && canonicalText(g.label ?? "") === canonicalText(q);
    })
    .map((g) => g.label ?? "");
  const goalCompound = goalLabels.filter((l) => /^compound goal:/i.test(l.trim()));
  const goalLong = goalLabels.filter((l) => wordCount(l) > 9);
  const goalQuestion = goalLabels.filter((l) => /\?\s*$/.test(l));
  const decision = nodes.find((n) => n.kind === "decision");
  const decisionLabel = decision?.label ?? null;

  check(
    "D1.1-exactly-one-goal",
    "goal_framing",
    "MODEL-QUALITY-BAR §1 Q1b (two goals are two visible goal nodes or a coaching card, never a string join) + validateGraph MISSING_GOAL",
    goals.length === 1,
    `${goals.length} goal node(s)`,
  );
  // ⚠ A label-vs-quote check is VACUOUS on a graph that carries no quote — and
  // it passes silently, which is the worst way for it to be vacuous. The
  // projector emits an object provenance carrying `source_quote`; the persisted
  // GraphV3 wire flattens provenance to a bare string enum and the quote is
  // gone. On the flattened shape this check must report UNEVALUABLE, never a
  // pass: "there is nothing to compare" and "the label is authored" are
  // different findings and must not share an answer.
  const goalsWithQuote = goals.filter((g) => sourceQuoteOf(g) !== undefined);
  check(
    "D1.2-goal-label-not-verbatim-quote",
    "goal_framing",
    "MODEL-QUALITY-BAR §1 Q1 HARD: label MUST NOT equal canonicalText(source_quote)",
    goals.length === 0 || goalsWithQuote.length === 0 ? null : goalVerbatim.length === 0,
    goals.length === 0
      ? "no goal node"
      : goalsWithQuote.length === 0
        ? "no goal node carries a source_quote (provenance flattened to the wire enum) — nothing to compare"
        : goalVerbatim.length === 0
          ? `0/${goalsWithQuote.length} quoted goal labels are verbatim fragments`
          : `${goalVerbatim.length} verbatim: ${JSON.stringify(goalVerbatim)}`,
  );
  check(
    "D1.3-no-compound-goal-prefix",
    "goal_framing",
    "MODEL-QUALITY-BAR §1 Q1 HARD on the `Compound Goal:` literal",
    goalCompound.length === 0,
    goalCompound.length === 0 ? "absent" : JSON.stringify(goalCompound),
  );
  // ⚠ THE STAGE MATTERS HERE AND THE MEASUREMENT WOULD LIE WITHOUT THIS CHECK.
  // On a brief that never states an objective in words, the drafted record set
  // carries no `goal` stated_item, so the PROJECTED graph has none — and the
  // deterministic repair sweep then mints one labelled with `DEFAULT_GOAL_LABEL`
  // ("Achieve the best outcome for this decision"). Scoring only the projector's
  // output would report "no goal"; scoring only the post-repair graph would
  // report "one goal, fine". Neither is what the user gets, which is a model
  // whose single most important node is a machine platitude about their
  // decision. Bound to the product's exported constant
  // (`src/cee/structure/goal-inference.ts:47`), never to the string, so a
  // reworded placeholder cannot slip past.
  const placeholderGoals = goalLabels.filter((l) => canonicalText(l) === canonicalText(DEFAULT_GOAL_LABEL));
  check(
    "D1.5-goal-label-is-not-the-machine-placeholder",
    "goal_framing",
    "src/cee/structure/goal-inference.ts:47 DEFAULT_GOAL_LABEL — the label the repair sweep mints when the draft produced no goal",
    goals.length === 0 ? null : placeholderGoals.length === 0,
    goals.length === 0
      ? "no goal node (pre-repair stage: the sweep has not run yet)"
      : placeholderGoals.length === 0
        ? "no goal carries the placeholder label"
        : `${placeholderGoals.length} placeholder goal label(s)`,
  );
  check(
    "D1.4-decision-label-authored",
    "goal_framing",
    'MODEL-QUALITY-BAR §1 Q3 HARD: decision.label !== "Decision"',
    decisionLabel === null ? null : decisionLabel !== "Decision",
    decisionLabel === null ? "no decision node in this graph" : `label=${JSON.stringify(decisionLabel)}`,
  );

  // ── D2 · UNIT / RANGE DISCIPLINE ──────────────────────────────────────────
  const factors = nodes.filter((n) => n.kind === "factor");
  const factorsWithValue = factors.filter((f) => typeof f.data?.value === "number");
  const interpretable = factorsWithValue.filter((f) => isInterpretableFactorValue(f.data));
  const bare = factorsWithValue.filter((f) => !isInterpretableFactorValue(f.data));

  check(
    "D2.1-every-valued-factor-is-interpretable",
    "unit_discipline",
    "MODEL-QUALITY-BAR §1 Q5 (no placeholder presented as information) + src/schemas/graph.ts:122-134 (`value` is the model 0-1 scale; `unit`/`raw_value` carry the meaning)",
    factorsWithValue.length === 0 ? null : bare.length === 0,
    factorsWithValue.length === 0
      ? "no factor carries a value"
      : `${interpretable.length}/${factorsWithValue.length} interpretable; ${bare.length} bare unit-interval`,
  );

  // ── D3 · RISK COVERAGE ────────────────────────────────────────────────────
  const risks = nodes.filter((n) => n.kind === "risk");
  const authoredRisks = risks.filter((r) => provenanceClassOf(r) !== PROJECTOR_STRUCTURAL);
  check(
    "D3.1-at-least-one-authored-risk",
    "risk_coverage",
    "the SERVED draft prompt, pinned at governed/draft-graph-v5/baseline/pms-draft-graph-v195.txt:99,:109",
    authoredRisks.length >= MIN_AUTHORED_RISKS,
    `${authoredRisks.length} authored risk(s) of ${risks.length} risk node(s)`,
  );

  // ── D4 · OPTION COVERAGE ──────────────────────────────────────────────────
  const options = nodes.filter((n) => n.kind === "option");
  const optionLabels = options.map((o) => o.label ?? "");
  const optionVerbatim = options
    .filter((o) => {
      const q = sourceQuoteOf(o);
      return q !== undefined && canonicalText(o.label ?? "") === canonicalText(q);
    })
    .map((o) => o.label ?? "");
  const distinctLabels = new Set(optionLabels.map((l) => canonicalText(l).toLowerCase())).size;
  const statusQuo = options.filter((o) => o.is_baseline === true);
  const sqLabelOk = statusQuo.length > 0 && statusQuo.every((o) => /status quo/i.test(o.label ?? ""));

  check(
    "D4.1-option-count-within-budget",
    "option_coverage",
    `MIN_OPTIONS=${MIN_OPTIONS} (a decision needs alternatives) + MAX_OPTIONS=${MAX_OPTIONS} (src/validators/graph-validator.types.ts:287)`,
    options.length >= MIN_OPTIONS && options.length <= MAX_OPTIONS,
    `${options.length} option(s)`,
  );
  // Same vacuity guard as D1.2 — see the note there.
  const optionsWithQuote = options.filter((o) => sourceQuoteOf(o) !== undefined);
  check(
    "D4.2-option-labels-authored",
    "option_coverage",
    "MODEL-QUALITY-BAR §1 Q4 HARD: no stated-item label is a verbatim brief fragment",
    options.length === 0 || optionsWithQuote.length === 0 ? null : optionVerbatim.length === 0,
    options.length === 0
      ? "no options"
      : optionsWithQuote.length === 0
        ? "no option carries a source_quote (provenance flattened to the wire enum) — nothing to compare"
        : `${optionVerbatim.length}/${optionsWithQuote.length} quoted option labels are verbatim: ${JSON.stringify(optionVerbatim.slice(0, 6))}`,
  );
  check(
    "D4.3-option-labels-distinct",
    "option_coverage",
    "MODEL-QUALITY-BAR §1 Q4 HARD: option labels pairwise distinct after canonicalText",
    options.length === 0 ? null : distinctLabels === options.length,
    `${distinctLabels} distinct of ${options.length}`,
  );
  check(
    "D4.4-status-quo-matches-the-brief",
    "option_coverage",
    "the brief corpus's own `expect_status_quo` front-matter + served prompt :278-283",
    input.expectStatusQuo === undefined ? null : (statusQuo.length > 0) === input.expectStatusQuo,
    input.expectStatusQuo === undefined
      ? "brief front-matter not supplied"
      : `expected=${input.expectStatusQuo}, found=${statusQuo.length}`,
  );
  check(
    "D4.5-status-quo-label-compliant",
    "option_coverage",
    'served prompt :279 — Label MUST contain "Status Quo"',
    statusQuo.length === 0 ? null : sqLabelOk,
    statusQuo.length === 0
      ? "no is_baseline option to judge"
      : `labels=${JSON.stringify(statusQuo.map((o) => o.label))}`,
  );

  // ── D5 · CONNECTIVITY ─────────────────────────────────────────────────────
  const withIn = new Set(edges.map((e) => e.to).filter((x): x is string => typeof x === "string"));
  const withOut = new Set(edges.map((e) => e.from).filter((x): x is string => typeof x === "string"));
  const orphans = nodes
    .filter((n) => typeof n.id === "string" && !withIn.has(n.id) && !withOut.has(n.id))
    .map((n) => n.id as string);
  const verdictErrors = input.verdict?.errors ?? [];
  const connErrors = verdictErrors
    .map((e) => e.code)
    .filter((c) => (CONNECTIVITY_ERROR_CODES as readonly string[]).includes(c));

  check(
    "D5.1-no-orphan-nodes",
    "connectivity",
    "structural: a node with neither an incoming nor an outgoing edge is not part of the decision (instruction.ts CONNECT section, final line)",
    orphans.length === 0,
    orphans.length === 0 ? "none" : `${orphans.length}: ${JSON.stringify(orphans.slice(0, 8))}`,
  );
  check(
    "D5.2-no-connectivity-errors",
    "connectivity",
    "validateGraph's own codes (NO_PATH_TO_GOAL :620, NO_EFFECT_PATH :822, UNREACHABLE_FROM_DECISION :576, MISSING_GOAL)",
    input.verdict === undefined ? null : connErrors.length === 0,
    input.verdict === undefined
      ? "no validator verdict supplied"
      : connErrors.length === 0
        ? "none"
        : `${connErrors.length}: ${JSON.stringify([...new Set(connErrors)])}`,
  );

  // ── D6 · SIZE ─────────────────────────────────────────────────────────────
  const byKind: Record<string, number> = {};
  for (const n of nodes) byKind[n.kind ?? "(none)"] = (byKind[n.kind ?? "(none)"] ?? 0) + 1;
  check(
    "D6.1-graph-reaches-a-viable-spine",
    "graph_size",
    `floor only: decision + goal + ${MIN_OPTIONS} options + a factor + a result = ${MIN_VIABLE_NODE_COUNT} nodes. NO upper bound is asserted — "too big" is judgement and is emitted as evidence instead.`,
    nodes.length >= MIN_VIABLE_NODE_COUNT,
    `${nodes.length} nodes / ${edges.length} edges`,
  );

  // ── D7 · REPAIR BURDEN ────────────────────────────────────────────────────
  const errorCodes = verdictErrors.map((e) => e.code);
  const missingValueAsks = verdictErrors.filter((e) =>
    (MISSING_VALUE_ERROR_CODES as readonly string[]).includes(e.code),
  );
  // P6: an ask over structure the SYSTEM invented must never be a demand. The
  // system-authored structure visible on a projected draft is exactly the
  // `projector_structural` class, so an ask whose `path` names one of those
  // nodes is an obligation the product manufactured for itself. Attributed via
  // the validator's own path format — never guessed from the code alone.
  const structuralIds = new Set(
    nodes
      .filter((n) => provenanceClassOf(n) === PROJECTOR_STRUCTURAL)
      .map((n) => n.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const asksOverStructural = missingValueAsks.filter((e) => {
    const id = nodeIdFromValidatorPath(e.path);
    return id !== undefined && structuralIds.has(id);
  }).length;

  check(
    "D7.1-draft-creates-no-blocking-repair",
    "repair_burden",
    "validateGraph blocking errors — the verdict the enforcement gate reads",
    input.verdict === undefined ? null : errorCodes.length === 0,
    input.verdict === undefined
      ? "no validator verdict supplied"
      : `${errorCodes.length} blocking error(s); ${missingValueAsks.length} are "supply a value" asks`,
  );
  check(
    "D7.2-no-mandatory-ask-over-system-inferred-structure",
    "repair_burden",
    "STANDING-BRIEF-PREAMBLE P6 + MODEL-QUALITY-BAR §1 Q7 / §3 (system-inferred structure must not manufacture a user obligation)",
    input.verdict === undefined ? null : asksOverStructural === 0,
    input.verdict === undefined
      ? "no validator verdict supplied"
      : `${asksOverStructural} of ${missingValueAsks.length} value asks are over projector_structural nodes`,
  );

  // ── D8 · INVENTED QUANTITY ────────────────────────────────────────────────
  const statedNumerals = statedNumeralsOf(nodes);
  const unsupported = input.briefText
    ? statedNumerals
        .filter((s) => !numeralAppearsInBrief(s.numeral, input.briefText as string))
        .map((s) => `${s.nodeLabel}=${s.numeral}`)
    : [];
  check(
    "D8.1-no-numeral-badged-as-the-users-is-absent-from-the-brief",
    "invented_quantity",
    "MODEL-QUALITY-BAR §1 Q6 (never quote an invented number back as fact) — scoped to numerals the draft has ALREADY badged `stated`/`explicit`",
    input.briefText === undefined ? null : unsupported.length === 0,
    input.briefText === undefined
      ? "brief text not supplied"
      : `${statedNumerals.length} stated numeral(s) checked; ${unsupported.length} unsupported${unsupported.length ? `: ${JSON.stringify(unsupported)}` : ""}`,
  );

  const outcomes = nodes.filter((n) => n.kind === "outcome");
  const scaffoldedOutcomes = outcomes.filter((o) => provenanceClassOf(o) === PROJECTOR_STRUCTURAL);

  const applicable = checks.filter((c) => c.passed !== null);
  return {
    briefId: input.briefId,
    checks,
    checksPassed: applicable.filter((c) => c.passed === true).length,
    checksApplicable: applicable.length,
    checksUnevaluable: checks.length - applicable.length,
    measures: {
      goalNodeCount: goals.length,
      goalLabels,
      goalLabelsVerbatimQuote: goalVerbatim,
      goalLabelsCompoundPrefixed: goalCompound,
      goalLabelsOverNineWords: goalLong,
      goalLabelsEndingInQuestionMark: goalQuestion,
      decisionLabel,
      factorCount: factors.length,
      factorsWithValue: factorsWithValue.length,
      factorsInterpretable: interpretable.length,
      factorsBareUnitInterval: bare.length,
      bareUnitIntervalLabels: bare.map((f) => f.label ?? f.id ?? "?"),
      riskCount: risks.length,
      authoredRiskCount: authoredRisks.length,
      riskLabels: risks.map((r) => r.label ?? r.id ?? "?"),
      optionCount: options.length,
      optionLabels,
      optionLabelsVerbatimQuote: optionVerbatim,
      distinctOptionLabelCount: distinctLabels,
      statusQuoOptionCount: statusQuo.length,
      statusQuoLabelCompliant: sqLabelOk,
      expectStatusQuo: input.expectStatusQuo ?? null,
      orphanNodeIds: orphans,
      connectivityErrorCodes: [...new Set(connErrors)],
      connectivityErrorCount: connErrors.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesByKind: byKind,
      blockingErrorCount: errorCodes.length,
      blockingErrorCodes: [...new Set(errorCodes)],
      missingValueAskCount: missingValueAsks.length,
      missingValueAsksOverSystemInferredStructure: asksOverStructural,
      statedNumeralsChecked: statedNumerals.length,
      statedNumeralsNotFoundInBrief: unsupported,
      briefTextAvailable: input.briefText !== undefined,
      outcomeCount: outcomes.length,
      scaffoldedOutcomeCount: scaffoldedOutcomes.length,
    },
  };
}
