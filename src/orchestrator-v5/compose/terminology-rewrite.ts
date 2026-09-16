/**
 * RC4 proportionate remedies (2026-07-15 session RCA) — deterministic,
 * content-preserving rewriters used REWRITE-FIRST by the output gates.
 *
 * Background: the output gates' only remedy used to be block/response
 * nuking. In one live session that destroyed 12+ generated coaching blocks —
 * a review card killed for containing the word "recommendation", drafted
 * coaching killed for one em dash. The honesty machinery was eating the
 * value it exists to protect. The ruling: a gate's remedy must be
 * proportionate to the offence, and the safest CONTENT-PRESERVING remedy
 * that removes the violation wins.
 *
 * Two rewriters live here:
 *
 *   - {@link applyTerminologyRewrite} — the prescriptive-lexicon
 *     substitution map, mirroring the served routing prompt's TERMINOLOGY
 *     rules (data/prompts.json): default to "leading option"; never
 *     "winner"; "recommended" only when explicitly advising. It maps ONLY
 *     the rewritable prescriptive-language class. It must NEVER contain a
 *     substitution for a fatal-class phrase (mutation denial, false
 *     success, staleness, internal jargon) — consumers enforce that
 *     structurally by RE-SCANNING the rewritten text with
 *     `findForbiddenPhraseHit` and keeping the fatal remedy for any
 *     residual hit. There is deliberately no second "which phrases are
 *     rewritable" list to drift out of sync: the map is the authority, the
 *     re-scan is the guarantee (derive-don't-mirror).
 *
 *   - {@link rewriteEmDashes} — the style rewriter for em/en dashes. The
 *     prompt bans them in user-facing copy ("use commas, colons, full
 *     stops, or restructure"); a style offence is never worth a whole
 *     coaching candidate.
 *
 * Consumers:
 *   - `forbidden-user-facing-phrases.ts` (`applyEgressForbiddenPhraseGuard`)
 *     — rewrite-first before the whole-response fallback replacement.
 *   - `phase3-blocks.ts` (`validateProseAndSchemaOrDrop`) — rewrite-first
 *     before the block drop.
 *   - `coaching/copy-quality-gate.ts` — em-dash style rewrite in place of
 *     the previous `em_dash` candidate rejection.
 *
 * Pure: no I/O, no logging, no side effects. Both rewriters are
 * deterministic and idempotent.
 */

/**
 * One prescriptive-lexicon substitution. `pattern` must be a global,
 * case-insensitive regex; `replacement` is lowercase (leading-case is
 * restored per match by {@link preserveLeadingCase}). `$1`-style capture
 * references are supported.
 */
interface TerminologyRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * The rewritable prescriptive-language class, mirroring the prompt
 * TERMINOLOGY map. Order matters only for readability — patterns are
 * mutually exclusive on any given token.
 *
 * DO NOT add fatal-class phrases here (denial, false success, staleness,
 * internal jargon): a mapping here is what converts a fatal remedy into a
 * content-preserving one, and those classes have no safe rewrite by
 * definition. The terminology-rewrite unit tests pin this invariant.
 */
const TERMINOLOGY_RULES: readonly TerminologyRule[] = [
  // "recommendation(s)" → "leading option(s)" — the noun names a result;
  // the map's prescribed neutral result term is "leading option".
  { pattern: /\brecommendations\b/gi, replacement: 'leading options' },
  { pattern: /\brecommendation\b/gi, replacement: 'leading option' },
  // "recommended" (adjective/participle) → "suggested" — neutral, keeps
  // both adjectival ("the suggested option") and verbal ("suggested next
  // step") readings grammatical.
  { pattern: /\brecommended\b/gi, replacement: 'suggested' },
  // "the winner(s)" → "the leading option(s)" — the map bans "winner"
  // outright.
  { pattern: /\bthe\s+winners\b/gi, replacement: 'the leading options' },
  { pattern: /\bthe\s+winner\b/gi, replacement: 'the leading option' },
  // "winning probability" → "win probability" (the neutral wire term);
  // other "winning X" prescriptions → "leading X".
  { pattern: /\bwinning\s+probability\b/gi, replacement: 'win probability' },
  {
    pattern: /\bwinning\s+(option|side|choice|outcome)(s)?\b/gi,
    replacement: 'leading $1$2',
  },
  // ⭐ THE SUPERLATIVE CROWNING — the broadest prescriptive pattern in the
  // fatal list, and until now the ONLY one with no rewrite, so it fell
  // straight through to whole-answer deletion.
  //
  // MEASURED on a fresh-session journey against staging `a81f741`, 16 Sep:
  // the user asked "So what would you actually recommend I do?" on a turn where
  // naming the leader was PERMITTED (`may_name_leading_option: true`, options
  // separated at 92%). The model produced 648 output tokens in 24.5s; the user
  // received 71 characters — `EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT` — because
  // `applyTerminologyRewrite` returned `applied: []` and the guard fell to
  // `fallback_replacement`. Telemetry: `v5.egress.forbidden_phrase_detected`,
  // `phrase: "is the strongest option"`, `dispatch_path: turn_executor_finalise`.
  //
  // The ban itself is correct and stays: the served prompt bans this vocabulary
  // too, and the estate's terminology ruling replaces prescriptive crowning with
  // "leading option". What was wrong is the REMEDY. This module's own docstring
  // states the design — rewrite the prescriptive-lexicon class, re-scan, and
  // reserve deletion for residual fatal-class phrases — and pattern 1 of
  // DOCTRINE_FATAL_PATTERNS was not covered by it.
  //
  // ⚠⚠ THIS ALSO CLOSES A DETECTION HOLE, which is the stronger reason to do it
  // here rather than by exempting permitted turns. Measured: the original
  // wording is INVISIBLE to `textAssertsLeadingOption` (false), while the
  // rewritten wording is VISIBLE (true). So on a WITHHELD turn the crowning
  // previously reached the permission guard unrecognised and could only be
  // stopped by deleting the whole answer; after the rewrite the permission guard
  // sees a leader claim and removes it as a leader claim. The two guards now
  // compose — vocabulary here, permission there — instead of one masking the
  // other.
  //
  // ⚠⚠ BOTH ARMS CANONICALISE ONTO "leading option", NOT ONTO THE NOUN THEY
  // CAME FROM — and that is a correction, not a preference. Review CX198
  // demonstrated the escape and it reproduces exactly:
  //     "… is the strongest choice" -> "… is the leading choice"
  //        textAssertsLeadingOption -> FALSE   (escapes the permission guard)
  //     "… is the strongest option" -> "… is the leading option"
  //        textAssertsLeadingOption -> TRUE    (caught, as intended)
  // The wire guard's vocabulary knows "leading option" and does NOT know
  // "leading choice", so preserving the source noun would have produced a
  // rewrite that slips a leader claim past the permission guard on a WITHHELD
  // turn — the precise opposite of this rule's purpose. Emitting the one
  // recognised result term makes the two guards compose in BOTH arms, and
  // "leading option" is the term the terminology ruling sanctions anyway.
  //
  // ⚠ NARROWED TO `choice|option` ON PURPOSE. The fatal pattern also covers
  // `bet|path|route`, and those are NOT rewritten: "your best bet" and "the way
  // to go" are idiomatic PRESCRIPTION, not a result term, and the terminology
  // ruling maps neither onto "leading option". Rewriting them would produce
  // "your leading bet", which is both ungrammatical and a weaker ban. They keep
  // the fatal remedy. Pinned in-test in both directions.
  //
  // The negation lookahead of the fatal pattern is mirrored here so a
  // DE-recommendation is untouched: "the status quo is not always the safest
  // choice" must survive, and does.
  {
    pattern:
      /\b(is|are|was|were|remains?|looks?\s+like|seems?|appears?\s+to\s+be)(\s+)(?!not\b|never\b|no\b|rarely\b|seldom\b)((?:\w+\s+){0,2})(?:best|better|optimal|right|obvious|clear|clearest|smartest|safest|sensible|superior|preferable|strongest|most\s+promising)(\s+)(choice|option)\b/gi,
    replacement: '$1$2$3leading$4option',
  },
];

/** Restore the leading capital of the matched text onto the replacement. */
function preserveLeadingCase(matched: string, replaced: string): string {
  if (matched.length === 0 || replaced.length === 0) return replaced;
  const first = matched.charAt(0);
  if (first !== first.toLowerCase()) {
    return replaced.charAt(0).toUpperCase() + replaced.slice(1);
  }
  return replaced;
}

export interface TerminologyRewriteResult {
  /** The rewritten text (=== input when nothing matched). */
  readonly text: string;
  /**
   * The matched terms that were substituted, verbatim, in match order —
   * generic banned vocabulary only, safe for telemetry.
   */
  readonly applied: readonly string[];
}

/**
 * Apply the prescriptive-lexicon substitution map. Pure, deterministic,
 * idempotent (no replacement re-matches any rule). Case is preserved on
 * the leading character of each match ("Recommendation" → "Leading
 * option").
 */
export function applyTerminologyRewrite(text: string): TerminologyRewriteResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: typeof text === 'string' ? text : '', applied: [] };
  }
  const applied: string[] = [];
  let out = text;
  for (const rule of TERMINOLOGY_RULES) {
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, (...args) => {
      const matched = args[0] as string;
      applied.push(matched);
      // Resolve $1/$2 capture references against this match's groups.
      const groups = args.slice(1, -2) as ReadonlyArray<string | undefined>;
      const substituted = rule.replacement.replace(
        /\$(\d)/g,
        (_, d: string) => groups[Number(d) - 1] ?? '',
      );
      return preserveLeadingCase(matched, substituted);
    });
  }
  return { text: out, applied };
}

export interface EmDashRewriteResult {
  /** The rewritten text — contains no em/en dash. */
  readonly text: string;
  /** True when the input contained at least one em/en dash. */
  readonly rewritten: boolean;
}

/**
 * Deterministic style rewrite for em (—) and en (–) dashes, per the prompt
 * rule ("No em dashes anywhere. Use commas, colons, full stops, or
 * restructure."). Rules, in order:
 *
 *   1. digit–digit ranges become "digit to digit" ("20–30%" → "20 to 30%");
 *   2. leading/trailing dashes are dropped;
 *   3. a dash following sentence punctuation is dropped (the punctuation
 *      already separates the clauses);
 *   4. any interior dash becomes a comma join (", ").
 *
 * Guarantees: the output contains no U+2013/U+2014; pure; idempotent.
 */
export function rewriteEmDashes(text: string): EmDashRewriteResult {
  if (typeof text !== 'string' || !/[–—]/.test(text)) {
    return { text: typeof text === 'string' ? text : '', rewritten: false };
  }
  let out = text;
  // 1. Numeric ranges read as "to".
  out = out.replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2');
  // 2. Leading / trailing dashes carry no content — drop them.
  out = out.replace(/^\s*[–—]+\s*/, '').replace(/\s*[–—]+\s*$/, '');
  // 3. After sentence punctuation the dash is redundant.
  out = out.replace(/([.,;:!?])\s*[–—]+\s*/g, '$1 ');
  // 4. Interior dashes become a comma join.
  out = out.replace(/\s*[–—]+\s*/g, ', ');
  // Collapse any double spaces the rules may have produced.
  out = out.replace(/ {2,}/g, ' ');
  return { text: out, rewritten: true };
}
