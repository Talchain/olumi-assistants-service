/**
 * Deterministic source-binding validation over (brief text, RichDecisionModel).
 *
 * THE HYPOTHESIS THIS FILE EXISTS TO DISPROVE (PLAN-v2 principle 2):
 *   "A quote + a declared transformation is enough to bind a user-derived value
 *    to the brief — no bespoke quantity parser is needed."
 * The cheapest disproof is a run of this validator over the corpus: a quote that
 * is not in the brief, or a value that disagrees with its quote and declares no
 * transformation, is a FAIL and is COUNTED. If the failure rate is material, the
 * hypothesis is dead and a deterministic span extractor is warranted.
 *
 * WHAT THIS IS NOT. It is not a scorer and not a judge. Every gate is a boolean
 * over text the model itself emitted, checked against the brief bytes. Nothing
 * here reads a model's intent or asks another model anything.
 *
 * GATE SCOPE — stated precisely so an "ok" cannot be read as wider than it is:
 *   SB1  every user_facts.source_quote is a contiguous substring of the brief
 *        (exact first, then whitespace/punctuation-normalised; the level used is
 *        RECORDED in observations, and a normalised-only match is NOT a failure)
 *   SB2  a non-null user fact value agrees with a numeric token in its quote, or
 *        with its declared `transformation`
 *   SB3  every provenance:"user" item carries a source_fact_id that EXISTS
 *   SB4  kind compatibility, on the subset where the fact taxonomy actually
 *        discriminates (see KIND_COMPATIBILITY below — factors and outcomes are
 *        deliberately unrestricted, with the evidence recorded there)
 *   SB5  a cited fact's value must equal the citing item's value when both are
 *        non-null
 *   SB6  an ai_proposed/ai_hypothesis item may cite a fact only if its own value
 *        is actually in that fact — this is the anti-laundering gate
 */

import type {
  RichDecisionModel,
  RichUserFact,
  ValidationFailure,
  ValidationResult,
} from "./rich-model.js";
import { ANCHOR_REQUIRING_EPISTEMIC_STATES } from "./rich-model.js";

// =============================================================================
// Text normalisation
// =============================================================================

/**
 * Normalise for the SECOND-CHANCE substring match only.
 *
 * Collapses whitespace runs, maps NBSP/thin spaces to a plain space, curly
 * quotes to straight, and en/em dashes to a hyphen. Case is NOT folded — a
 * quote that differs in case is a paraphrase risk we want visible.
 */
export function normaliseForMatch(s: string): string {
  return s
    .replace(/[     ]/g, " ")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export type QuoteMatchLevel = "exact" | "normalised" | "none";

export function matchQuote(brief: string, quote: string): QuoteMatchLevel {
  if (quote.length === 0) return "none";
  if (brief.includes(quote)) return "exact";
  if (normaliseForMatch(brief).includes(normaliseForMatch(quote))) return "normalised";
  return "none";
}

// =============================================================================
// Number reading
// =============================================================================

const NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
});

const SUFFIX_MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze({
  k: 1_000,
  m: 1_000_000,
  bn: 1_000_000_000,
  b: 1_000_000_000,
});

/**
 * Every number a span could reasonably be read as, at NATIVE magnitude.
 *
 * "£20k" yields both 20 and 20000 (the literal digits and the suffix-expanded
 * value) — the caller decides which it needed and whether a transformation had
 * to declare it. "4%" yields 4 (native), never 0.04: normalising a percent to a
 * fraction is exactly the silent magnitude change the rubric exists to catch.
 * "20,000" yields 20000. Number words one–twenty are included.
 */
export function readNumbersFromSpan(span: string): number[] {
  const out: number[] = [];
  const normalised = normaliseForMatch(span);

  const numeric = /(-?\d[\d,]*(?:\.\d+)?)\s*(bn|k|m|b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = numeric.exec(normalised)) !== null) {
    const literal = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(literal)) continue;
    out.push(literal);
    const suffix = m[2]?.toLowerCase();
    if (suffix != null) {
      const mult = SUFFIX_MULTIPLIERS[suffix];
      if (mult != null) out.push(literal * mult);
    }
  }

  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(normalised)) out.push(value);
  }

  return out;
}

const EPSILON = 1e-9;
function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Does a declared `transformation` explain `value` from `quote`?
 *
 * Accepted form: "<source> → <target>" (also "->"), where <source> must appear
 * in the quote and <target> must read as `value`. A transformation that names a
 * source NOT in the quote is worse than none — it is a fabricated derivation —
 * so it returns false and SB2 fails.
 */
export function transformationExplains(
  quote: string,
  transformation: string | null,
  value: number,
): boolean {
  if (transformation == null || transformation.trim().length === 0) return false;
  const parts = transformation.split(/→|->/);
  if (parts.length >= 2) {
    const src = normaliseForMatch(parts[0]);
    const dst = parts.slice(1).join("→");
    const srcInQuote = src.length > 0 && normaliseForMatch(quote).includes(src);
    const dstValues = readNumbersFromSpan(dst);
    if (srcInQuote && dstValues.some((v) => numbersEqual(v, value))) return true;
  }
  // Fallback: a free-text transformation that at least states the resulting value
  // AND whose own numbers are all findable in the quote (e.g. "15% of £49 → £56.35").
  const declared = readNumbersFromSpan(transformation);
  if (!declared.some((v) => numbersEqual(v, value))) return false;
  const quoteNumbers = readNumbersFromSpan(quote);
  const supporting = declared.filter((v) => !numbersEqual(v, value));
  return (
    supporting.length > 0 && supporting.every((v) => quoteNumbers.some((q) => numbersEqual(q, v)))
  );
}

// =============================================================================
// Kind compatibility
// =============================================================================

/**
 * Which user_fact kinds an item type may legitimately cite.
 *
 * ⚠ FACTORS AND OUTCOMES ARE DELIBERATELY ABSENT, and that is a measured
 * decision, not an oversight. In the banked WP0 builder output
 * (`output/model-gen-20260921/CONTRACT-v0/example-pricing-builder-output.json`)
 * factor `f2` ("Next Pro feature release") correctly cites `uf4`, a fact of kind
 * `option`, because the phrase that evidences the factor lives inside the option
 * span. The fact taxonomy separates SPANS, not roles-in-the-graph, so any kind
 * restriction on factors/outcomes manufactures false failures on correct output.
 * The load-bearing checks for those items are SB3 (the anchor exists) and SB5/SB6
 * (the numbers agree), which DO discriminate.
 */
const KIND_COMPATIBILITY: Readonly<Record<string, readonly string[]>> = Object.freeze({
  option: ["option"],
  constraint: ["limit", "goal"],
  horizon: ["horizon"],
});

// =============================================================================
// The validator
// =============================================================================

interface Ctx {
  brief: string;
  facts: Map<string, RichUserFact>;
  failures: ValidationFailure[];
  observations: string[];
}

function fail(ctx: Ctx, gate: string, itemId: string, detail: string): void {
  ctx.failures.push({ gate, item_id: itemId, detail });
}

/**
 * Check one citation from a non-fact item to a user fact.
 *
 * `declaredValue` is the citing item's own value (null when it has none).
 * `isUserAuthority` distinguishes an item claiming user provenance (must have an
 * anchor) from an AI item (may have one, but only an honest one — SB6).
 */
function checkCitation(
  ctx: Ctx,
  opts: {
    itemId: string;
    sourceFactId: string | null;
    declaredValue: number | null;
    isUserAuthority: boolean;
    compatibilityKey?: keyof typeof KIND_COMPATIBILITY;
    anchorRequired: boolean;
  },
): void {
  const { itemId, sourceFactId, declaredValue, isUserAuthority, anchorRequired } = opts;

  if (sourceFactId == null) {
    if (anchorRequired) {
      fail(
        ctx,
        "SB3_user_item_without_anchor",
        itemId,
        isUserAuthority
          ? "provenance is 'user' but source_fact_id is null — user authority with no anchor"
          : "epistemic_state asserts a known/observed/user_estimate origin but source_fact_id is null",
      );
    }
    return;
  }

  const fact = ctx.facts.get(sourceFactId);
  if (fact == null) {
    fail(
      ctx,
      "SB3_dangling_source_fact_id",
      itemId,
      `source_fact_id '${sourceFactId}' does not exist in user_facts`,
    );
    return;
  }

  const compat = opts.compatibilityKey != null ? KIND_COMPATIBILITY[opts.compatibilityKey] : undefined;
  if (compat != null && !compat.includes(fact.kind)) {
    fail(
      ctx,
      "SB4_kind_incompatible",
      itemId,
      `cites fact '${fact.id}' of kind '${fact.kind}'; expected one of [${compat.join(", ")}]`,
    );
  }

  if (declaredValue == null) return;

  if (fact.value != null) {
    if (!numbersEqual(fact.value, declaredValue)) {
      fail(
        ctx,
        isUserAuthority ? "SB5_value_disagrees_with_cited_fact" : "SB6_ai_value_not_in_cited_fact",
        itemId,
        `declares ${declaredValue} but cited fact '${fact.id}' carries ${fact.value}`,
      );
    }
    return;
  }

  // The cited fact has no value of its own: the number must at least be in its span.
  const inQuote = readNumbersFromSpan(fact.source_quote).some((v) => numbersEqual(v, declaredValue));
  if (!inQuote) {
    fail(
      ctx,
      isUserAuthority ? "SB5_value_absent_from_cited_quote" : "SB6_ai_value_not_in_cited_fact",
      itemId,
      `declares ${declaredValue}, which is not present in cited fact '${fact.id}' (value null, quote "${fact.source_quote}")`,
    );
  }
}

export function validateSourceBinding(brief: string, model: RichDecisionModel): ValidationResult {
  const ctx: Ctx = { brief, facts: new Map(), failures: [], observations: [] };

  // --- user_facts: ids, quotes, values -------------------------------------
  for (const fact of model.user_facts) {
    if (ctx.facts.has(fact.id)) {
      fail(ctx, "SB0_duplicate_fact_id", fact.id, "user_facts contains this id more than once");
    }
    ctx.facts.set(fact.id, fact);
  }

  for (const fact of model.user_facts) {
    const level = matchQuote(brief, fact.source_quote);
    if (level === "none") {
      fail(
        ctx,
        "SB1_quote_not_in_brief",
        fact.id,
        `source_quote is not a contiguous span of the brief (exact and whitespace-normalised both failed): "${fact.source_quote}"`,
      );
    } else if (level === "normalised") {
      ctx.observations.push(
        `SB1 ${fact.id}: quote matched only after whitespace/punctuation normalisation`,
      );
    }

    if (fact.value == null) continue;

    const literal = readNumbersFromSpan(fact.source_quote);
    const agrees = literal.some((v) => numbersEqual(v, fact.value as number));
    if (agrees) continue;
    if (transformationExplains(fact.source_quote, fact.transformation, fact.value)) {
      ctx.observations.push(
        `SB2 ${fact.id}: value ${fact.value} explained by declared transformation "${fact.transformation}"`,
      );
      continue;
    }
    fail(
      ctx,
      "SB2_value_disagrees_with_quote",
      fact.id,
      `value ${fact.value} is not readable from quote "${fact.source_quote}" (numbers found: [${literal.join(
        ", ",
      )}]) and transformation ${
        fact.transformation == null ? "is null" : `"${fact.transformation}" does not explain it`
      }`,
    );
  }

  // --- decision.horizon -----------------------------------------------------
  const horizon = model.decision.horizon;
  checkCitation(ctx, {
    itemId: "decision.horizon",
    sourceFactId: horizon.source_fact_id,
    declaredValue: horizon.value,
    isUserAuthority: true,
    compatibilityKey: "horizon",
    // A horizon the user never stated is legitimately unanchored, but then it
    // must not carry a value either.
    anchorRequired: horizon.value != null,
  });

  // --- options and their lever settings ------------------------------------
  for (const option of model.options) {
    const isUser = option.provenance === "user";
    checkCitation(ctx, {
      itemId: option.id,
      sourceFactId: option.source_fact_id,
      declaredValue: null,
      isUserAuthority: isUser,
      compatibilityKey: "option",
      anchorRequired: isUser,
    });

    for (const lever of option.lever_settings) {
      const anchorRequired = ANCHOR_REQUIRING_EPISTEMIC_STATES.includes(lever.epistemic_state);
      checkCitation(ctx, {
        itemId: `${option.id}.lever_settings[${lever.factor_id}]`,
        sourceFactId: lever.source_fact_id,
        declaredValue: lever.value,
        // A lever asserting known/observed/user_estimate claims user-grade
        // authority even inside an ai_proposed option, so it is held to SB5.
        isUserAuthority: anchorRequired,
        anchorRequired,
      });
    }
  }

  // --- factors --------------------------------------------------------------
  for (const factor of model.factors) {
    const isUser = factor.provenance === "user";
    checkCitation(ctx, {
      itemId: factor.id,
      sourceFactId: factor.source_fact_id,
      declaredValue: factor.current_value,
      isUserAuthority: isUser,
      anchorRequired: isUser,
    });
    if (!isUser && factor.current_value != null && factor.source_fact_id == null) {
      // An AI factor may hold a value only from named external evidence.
      if (factor.epistemic_state !== "external_evidence") {
        fail(
          ctx,
          "SB6_ai_value_without_source",
          factor.id,
          `ai_proposed factor carries current_value ${factor.current_value} with no source_fact_id and epistemic_state '${factor.epistemic_state}' (expected 'external_evidence')`,
        );
      }
    }
  }

  // --- outcomes -------------------------------------------------------------
  for (const outcome of model.outcomes) {
    const isUser = outcome.provenance === "user";
    checkCitation(ctx, {
      itemId: outcome.id,
      sourceFactId: outcome.source_fact_id,
      declaredValue: null,
      isUserAuthority: isUser,
      anchorRequired: isUser,
    });
  }

  // --- constraints ----------------------------------------------------------
  for (const constraint of model.constraints) {
    const isUser = constraint.provenance === "user";
    checkCitation(ctx, {
      itemId: constraint.id,
      sourceFactId: constraint.source_fact_id,
      declaredValue: constraint.value,
      isUserAuthority: isUser,
      compatibilityKey: "constraint",
      anchorRequired: isUser,
    });
  }

  // --- causal links ---------------------------------------------------------
  for (const link of model.causal_links) {
    const isUser = link.provenance === "user";
    checkCitation(ctx, {
      itemId: link.id,
      sourceFactId: link.source_fact_id,
      declaredValue: null,
      isUserAuthority: isUser,
      anchorRequired: isUser,
    });
    if (link.provenance === "ai_hypothesis" && link.magnitude.kind === "user_estimate") {
      fail(
        ctx,
        "SB6_ai_link_claims_user_estimate",
        link.id,
        "provenance is ai_hypothesis but magnitude.kind is user_estimate — AI content labelled user",
      );
    }
  }

  return { ok: ctx.failures.length === 0, failures: ctx.failures, observations: ctx.observations };
}

// =============================================================================
// Widener immutability
// =============================================================================

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).sort(([x], [y]) =>
      x < y ? -1 : x > y ? 1 : 0,
    );
    return entries.map(([k, val]) => [k, canonical(val)]);
  }
  return v;
}

/**
 * The widener may ADD. It may never change, rephrase, renumber or drop anything
 * the person said.
 *
 * ORDER IS PART OF THE CONTRACT for user_facts: the widener prompt forbids
 * renumbering, and a re-ordered array is how a renumbering hides from an
 * id-keyed comparison.
 */
export function checkWidenerImmutability(
  builderModel: RichDecisionModel,
  widenerModel: RichDecisionModel,
): ValidationResult {
  const failures: ValidationFailure[] = [];
  const observations: string[] = [];

  if (!deepEqual(builderModel.user_facts, widenerModel.user_facts)) {
    const before = builderModel.user_facts.map((f) => f.id).join(",");
    const after = widenerModel.user_facts.map((f) => f.id).join(",");
    if (before !== after) {
      failures.push({
        gate: "IMM1_user_facts_reordered_or_renumbered",
        item_id: "user_facts",
        detail: `builder ids [${before}] became [${after}]`,
      });
    }
    for (const fact of builderModel.user_facts) {
      const after2 = widenerModel.user_facts.find((f) => f.id === fact.id);
      if (after2 == null) {
        failures.push({
          gate: "IMM1_user_fact_dropped",
          item_id: fact.id,
          detail: "present in builder output, absent from widener output",
        });
        continue;
      }
      if (!deepEqual(fact, after2)) {
        failures.push({
          gate: "IMM1_user_fact_modified",
          item_id: fact.id,
          detail: `builder ${JSON.stringify(fact)} != widener ${JSON.stringify(after2)}`,
        });
      }
    }
    if (failures.length === 0) {
      failures.push({
        gate: "IMM1_user_facts_changed",
        item_id: "user_facts",
        detail: "arrays differ but no per-id difference was isolated (extra facts added?)",
      });
    }
  }

  // Every provenance:"user" item in the builder output must survive unchanged.
  const userItemGroups: Array<[string, Array<{ id: string; provenance: string }>, Array<{ id: string; provenance: string }>]> = [
    ["options", builderModel.options, widenerModel.options],
    ["factors", builderModel.factors, widenerModel.factors],
    ["outcomes", builderModel.outcomes, widenerModel.outcomes],
    ["constraints", builderModel.constraints, widenerModel.constraints],
    ["causal_links", builderModel.causal_links, widenerModel.causal_links],
  ];

  for (const [group, before, after] of userItemGroups) {
    for (const item of before) {
      if (item.provenance !== "user") continue;
      const match = after.find((x) => x.id === item.id);
      if (match == null) {
        failures.push({
          gate: "IMM2_user_item_dropped",
          item_id: `${group}.${item.id}`,
          detail: "provenance:user item present in builder output, absent from widener output",
        });
        continue;
      }
      if (!deepEqual(item, match)) {
        failures.push({
          gate: "IMM2_user_item_modified",
          item_id: `${group}.${item.id}`,
          detail: `builder ${JSON.stringify(item)} != widener ${JSON.stringify(match)}`,
        });
      }
    }
  }

  // Constraint operators are frozen for EVERY constraint, including ai_proposed
  // ones — a silent `<`→`<=` is the exact failure the strictness rule exists for.
  for (const constraint of builderModel.constraints) {
    const after = widenerModel.constraints.find((c) => c.id === constraint.id);
    if (after == null) {
      failures.push({
        gate: "IMM3_constraint_dropped",
        item_id: constraint.id,
        detail: "constraint present in builder output, absent from widener output",
      });
      continue;
    }
    if (after.operator !== constraint.operator) {
      failures.push({
        gate: "IMM3_constraint_operator_changed",
        item_id: constraint.id,
        detail: `operator '${constraint.operator}' became '${after.operator}'`,
      });
    }
    if (!numbersEqual(after.value, constraint.value)) {
      failures.push({
        gate: "IMM3_constraint_value_changed",
        item_id: constraint.id,
        detail: `value ${constraint.value} became ${after.value}`,
      });
    }
  }

  const added =
    widenerModel.options.length -
    builderModel.options.length +
    (widenerModel.factors.length - builderModel.factors.length) +
    (widenerModel.outcomes.length - builderModel.outcomes.length) +
    (widenerModel.causal_links.length - builderModel.causal_links.length);
  observations.push(`IMM: net items added by widener = ${added}`);

  return { ok: failures.length === 0, failures, observations };
}
