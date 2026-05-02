/**
 * Defence-in-depth prose sanitiser for V5 LLM-generated `assistant_text`
 * (Track 2A, brief brief-v5-response-distributed-matsumoto).
 *
 * Two classes of leak survive prompt-level guidance and reach users:
 *   1. Raw decimal probabilities ("0.862 probability") that should
 *      render as percentages.
 *   2. Structural edge-strength language ("carries a strength of 0.55")
 *      and raw sensitivity values ("sensitivity of 1.0") that expose
 *      internal model wiring rather than user-readable signal.
 *
 * This module supplies pure, idempotent transforms that the post-compose
 * sanitisation hook in turn-executor STEP 6.4 invokes once per turn.
 * The sanitiser is deliberately conservative: token-anchored regex,
 * a contextual guard for the bare `strength N` rule, and a grammar
 * post-check that reverts a structural replacement if it would emit
 * broken prose. None of the transforms cross sentence boundaries.
 *
 * Telemetry counters are returned to the caller (turn-executor) so the
 * single integration site can emit V5ResponseProseSanitised without
 * re-scanning the text.
 */

import { formatProbability } from './format-analysis-value.js';

// ---------------------------------------------------------------
// Numeric prose (raw decimal → percentage)
// ---------------------------------------------------------------

/**
 * Token-anchored whitelist of probability-prose patterns. Each pattern
 * captures the decimal as a numbered group; the rewriter substitutes
 * `formatProbability(value, 'display')` (e.g. "0.862" → "86%").
 *
 * Rules:
 *   - "{0?.dd[dd]} {probability|likelihood|chance}"
 *   - "{probability|likelihood|chance} {of|is} {0?.dd[dd]}"
 *   - "{probability|likelihood|chance} : {0?.dd[dd]}" or "= {0?.dd[dd]}"
 *   - "{goal|win|outcome} probability {of|is|:|=} {0?.dd[dd]}"
 *
 * The decimal must have ≥2 fractional digits, anchoring on values that
 * the LLM is plausibly using as a probability rather than something
 * versionish like "0.10.0" (caught by version-context tests).
 */
interface ProbRule {
  readonly pattern: RegExp;
  /** Given the regex match groups, return the rebuilt string (with the
   *  decimal converted to a percentage), or null to leave the match
   *  intact. The handler is responsible for preserving capitalisation
   *  and whitespace from the original match. */
  readonly rebuild: (
    match: string,
    groups: ReadonlyArray<string | undefined>,
    pct: string,
  ) => string | null;
  /** Index of the decimal capture in the match-groups array. */
  readonly decimalIndex: number;
}

const PROB_RULES: readonly ProbRule[] = [
  // "0.862 probability"
  {
    pattern: /\b(0?\.\d{2,4})\s+(probability|likelihood|chance)\b/gi,
    decimalIndex: 0,
    rebuild: (_m, g, pct) => `${pct} ${g[1]}`,
  },
  // "probability of 0.862" / "likelihood is 0.862"
  {
    pattern: /\b(probability|likelihood|chance)\s+(of|is)\s+(0?\.\d{2,4})\b/gi,
    decimalIndex: 2,
    rebuild: (_m, g, pct) => `${g[0]} ${g[1]} ${pct}`,
  },
  // "probability: 0.862" / "likelihood = 0.862"
  {
    pattern: /\b(probability|likelihood|chance)\s*[:=]\s*(0?\.\d{2,4})\b/gi,
    decimalIndex: 1,
    rebuild: (_m, g, pct) => `${g[0]} ${pct}`,
  },
  // "goal probability of 0.862" / "win probability: 0.862" / "outcome probability = 0.862"
  {
    pattern: /\b(goal|win|outcome)\s+probability\s+(of|is|[:=])\s*(0?\.\d{2,4})\b/gi,
    decimalIndex: 2,
    rebuild: (_m, g, pct) => {
      const connector = g[1];
      if (connector === 'of' || connector === 'is') {
        return `${g[0]} probability ${connector} ${pct}`;
      }
      return `${g[0]} probability ${pct}`;
    },
  },
  // Relaxed: "{token} of/is {1-7 intervening word-tokens} {decimal}".
  // Lazy quantifier so the engine binds to the FIRST decimal it can
  // reach, not the last in the sentence. The intervening run is
  // \w+-only, so periods, commas, and other sentence-terminators
  // naturally stop the match — preventing cross-sentence binding.
  // Only the decimal is replaced; the surrounding clause is preserved.
  //
  // Delta-context guard: refuse the rewrite when the intervening
  // tokens contain delta verbs / nouns ("changed", "moved",
  // "shifted", "delta", "drop", "rise", "increase", "decrease",
  // "by"-as-modifier). In that case the decimal is a magnitude of
  // change, not a probability value, and converting to a percentage
  // would mislead the user. Implemented in `rebuild`: returns null to
  // leave the match intact.
  {
    pattern:
      /\b(?:probability|likelihood|chance)\b(?:\s+\w+){1,7}?\s+(0?\.\d{2,4})\b/gi,
    decimalIndex: 0,
    rebuild: (match, g, pct) => {
      if (DELTA_CONTEXT_RE.test(match)) return null;
      const decimal = g[0] as string;
      return match.slice(0, match.length - decimal.length) + pct;
    },
  },
];

/**
 * Tokens that signal the matched decimal is a delta / magnitude of
 * change rather than a raw probability. Tested against the full
 * relaxed-pattern match (case-insensitive). When ANY of these appears
 * inside the match the rebuilder declines and the decimal stays raw.
 */
const DELTA_CONTEXT_RE =
  /\b(?:changed|moved|shifted|shifts?|drops?|dropped|rises?|rose|increased?|decreased?|delta|by\s+\d?\.|±)\b/i;

/**
 * Returns true if the match position sits inside an unbalanced
 * parenthetical within the same sentence — used to skip over phrases
 * like "(0.95 confidence interval)" which are likely deliberate.
 *
 * Sentence boundary is approximated as the nearest preceding `.`, `!`,
 * `?`, or start-of-string. We count `(` and `)` between that boundary
 * and the match start; a positive net `(` count means we are inside an
 * open paren.
 */
function insideOpenParen(text: string, matchStart: number): boolean {
  let i = matchStart - 1;
  let sentenceStart = 0;
  while (i >= 0) {
    const ch = text.charAt(i);
    if (ch === '.' || ch === '!' || ch === '?') {
      sentenceStart = i + 1;
      break;
    }
    i--;
  }
  let depth = 0;
  for (let j = sentenceStart; j < matchStart; j++) {
    const ch = text.charAt(j);
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
  }
  return depth > 0;
}

/**
 * Convert a captured decimal string into the display-percentage form.
 * Falls back to the original string if `formatProbability` declines
 * (NaN / out-of-range), which leaves the regex match intact rather than
 * substituting "Not available" into the user prose.
 */
function safeDisplay(decimalStr: string): string | null {
  const value = Number(decimalStr);
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return formatProbability(value, 'display');
}

export interface NumericProseResult {
  readonly text: string;
  readonly rewrites: number;
}

/**
 * Rewrite raw decimal probabilities in the four whitelisted phrasings
 * to integer percentages. Pure, idempotent, never throws.
 *
 * Skips matches inside an unbalanced opening paren in the same
 * sentence so that "(0.95 CI)" survives untouched.
 */
export function formatNumericProse(text: string): NumericProseResult {
  if (!text) return { text: text ?? '', rewrites: 0 };

  let out = text;
  let rewrites = 0;

  for (const rule of PROB_RULES) {
    // Re-create per-iteration since we mutate `out` between rules and
    // a stateful regex (g flag) holds lastIndex.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    out = out.replace(pattern, (match, ...rest) => {
      // rest = [...captures, offset, fullText]
      const fullText = rest[rest.length - 1] as string;
      const offset = rest[rest.length - 2] as number;
      const captures = rest.slice(0, rest.length - 2) as ReadonlyArray<
        string | undefined
      >;

      if (insideOpenParen(fullText, offset)) return match;

      const decimal = captures[rule.decimalIndex];
      if (typeof decimal !== 'string') return match;
      const pct = safeDisplay(decimal);
      if (pct === null) return match;

      const rebuilt = rule.rebuild(match, captures, pct);
      if (rebuilt === null) return match;
      rewrites++;
      return rebuilt;
    });
  }

  return { text: out, rewrites };
}

// ---------------------------------------------------------------
// Sensitivity translation (raw value → banded language)
// ---------------------------------------------------------------

/**
 * Translate raw sensitivity values into banded human language. Bands
 * are by absolute value:
 *   |v| < 0.3        → "weak"
 *   |v| in [0.3, 0.7) → "moderate"
 *   |v| in [0.7, 0.95) → "strong"
 *   |v| ≥ 0.95       → "very strong"
 *
 * Sign rule (per brief example "-0.40 → negative sensitivity signal"):
 * negative values prepend "negative" and DROP the band qualifier;
 * positive values use the band qualifier alone, except that |v| ≥ 0.95
 * uses "very strong" regardless of sign (matches brief example
 * "1.0 → very strong sensitivity signal").
 */
// Patterns optionally consume a preceding article ("a", "an", "the")
// so the splice doesn't produce a doubled article when the band label
// itself starts with "a" — e.g. "with a sensitivity value of 1.0"
// must rewrite to "with a very strong sensitivity signal", not
// "with a a very strong sensitivity signal".
const SENSITIVITY_PATTERNS: RegExp[] = [
  /(\b(?:a|an|the)\s+)?\bsensitivity\s+(?:value\s+)?(?:of|is)\s+(-?\d?\.\d+)\b/gi,
  /(\b(?:a|an|the)\s+)?\bsensitivity\s*[:=]\s*(-?\d?\.\d+)\b/gi,
];

function bandLabel(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 0.95) return value < 0 ? 'a very strong negative sensitivity signal' : 'a very strong sensitivity signal';
  if (value < 0) return 'a negative sensitivity signal';
  if (abs >= 0.7) return 'a strong sensitivity signal';
  if (abs >= 0.3) return 'a moderate sensitivity signal';
  return 'a weak sensitivity signal';
}

export interface SensitivityResult {
  readonly text: string;
  readonly rewrites: number;
}

export function translateSensitivityLanguage(text: string): SensitivityResult {
  if (!text) return { text: text ?? '', rewrites: 0 };

  let out = text;
  let rewrites = 0;

  // Pattern 0: with "of"/"is" connector. Captures: [optional article, decimal].
  out = out.replace(SENSITIVITY_PATTERNS[0], (match, article, decStr) => {
    const value = Number(decStr);
    if (!Number.isFinite(value)) return match;
    rewrites++;
    return spliceWithArticle(article as string | undefined, bandLabel(value));
  });

  // Pattern 1: with `:` or `=` connector. Captures: [optional article, decimal].
  out = out.replace(SENSITIVITY_PATTERNS[1], (match, article, decStr) => {
    const value = Number(decStr);
    if (!Number.isFinite(value)) return match;
    rewrites++;
    return spliceWithArticle(article as string | undefined, bandLabel(value));
  });

  return { text: out, rewrites };
}

/**
 * Compose a sensitivity replacement with the matched preceding article,
 * preserving its original whitespace and capitalisation. The bandLabel
 * always starts with "a"; when the captured article is "a" we drop the
 * label's leading "a " to avoid duplication. When the captured article
 * is "an" / "the" we keep the original article and drop the label's
 * leading "a ", deferring to the surrounding-clause's chosen
 * determiner. When no article was captured the label is used as-is.
 */
function spliceWithArticle(article: string | undefined, label: string): string {
  if (!article) return label;
  // Strip leading "a " from the band label since the matched article
  // already supplies a determiner. Capitalisation: if the matched
  // article was capitalised ("A sensitivity …" at sentence start) the
  // result preserves it via the article slice itself.
  const stripped = label.replace(/^a\s+/i, '');
  return article + stripped;
}

// ---------------------------------------------------------------
// Structural edge-language suppression
// ---------------------------------------------------------------

interface StructuralRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly replacement: string;
  /** Optional context-token guard: only match if any of these tokens
   *  appears within `tokenWindow` whitespace-separated tokens of the
   *  match (either side). Used to disambiguate bare "strength N". */
  readonly contextTokens?: readonly string[];
  readonly tokenWindow?: number;
}

// Each pattern optionally consumes a preceding article ("the", "a",
// "an") so the replacement splice doesn't produce a determiner pileup
// like "The this causal link is small." When the article is consumed,
// `applyStructuralReplacement` capitalises the replacement if the
// original article sat at the start of a sentence.
const STRUCTURAL_RULES: readonly StructuralRule[] = [
  {
    id: 'carries_strength',
    pattern: /\bcarries?\s+a\s+strength\s+of\s+\d?\.\d+\b/gi,
    replacement: 'is causally linked',
  },
  {
    id: 'edge_strength_weight',
    pattern: /(?:\b(?:the|a|an)\s+)?\bedge\s+(?:strength|weight)\s+(?:of\s+)?\d?\.\d+\b/gi,
    replacement: 'this causal link',
  },
  {
    id: 'causal_strength_value',
    pattern: /(?:\b(?:the|a|an)\s+)?\b(?:causal\s+)?strength\s+(?:value\s+)?(?:of\s+)?\d?\.\d+\b/gi,
    replacement: 'this causal relationship',
  },
  {
    id: 'bare_strength_int',
    pattern: /(?:\b(?:the|a|an)\s+)?\bstrength\s+\d+(?:\.\d+)?\b/gi,
    replacement: 'this relationship',
    contextTokens: ['edge', 'causal', 'relationship', 'factor', 'path', 'driver'],
    tokenWindow: 5,
  },
];

/**
 * Returns true if the candidate match begins with an article ("The ",
 * "A ", "An " — case-insensitive). Used by the splicer to decide
 * whether to capitalise the replacement (preserving sentence-initial
 * capitalisation) when the matched article was at sentence start.
 */
function startsWithArticle(matchText: string): boolean {
  return /^(?:the|a|an)\s+/i.test(matchText);
}

/**
 * Returns true if any of `tokens` appears within `windowSize`
 * whitespace-separated tokens of the match (either side, same
 * sentence). Tokenisation is whitespace-only — punctuation stays
 * attached, which is fine because the model-term comparison is
 * lower-case substring on the raw token.
 */
function hasContextToken(
  fullText: string,
  matchStart: number,
  matchEnd: number,
  tokens: readonly string[],
  windowSize: number,
): boolean {
  // Sentence boundary detection mirrors insideOpenParen.
  let leftBoundary = 0;
  for (let i = matchStart - 1; i >= 0; i--) {
    const ch = fullText.charAt(i);
    if (ch === '.' || ch === '!' || ch === '?') {
      leftBoundary = i + 1;
      break;
    }
  }
  let rightBoundary = fullText.length;
  for (let i = matchEnd; i < fullText.length; i++) {
    const ch = fullText.charAt(i);
    if (ch === '.' || ch === '!' || ch === '?') {
      rightBoundary = i;
      break;
    }
  }
  const before = fullText.slice(leftBoundary, matchStart).trim();
  const after = fullText.slice(matchEnd, rightBoundary).trim();
  const beforeTokens = before.length > 0 ? before.split(/\s+/) : [];
  const afterTokens = after.length > 0 ? after.split(/\s+/) : [];
  const window = [
    ...beforeTokens.slice(-windowSize),
    ...afterTokens.slice(0, windowSize),
  ].map((t) => t.toLowerCase().replace(/[^a-z]/g, ''));
  return tokens.some((needle) => window.includes(needle));
}

/**
 * Cheap grammar guard: returns true if the candidate text after a
 * replacement looks visibly broken. Any single failure causes the
 * caller to revert that one replacement and increment the
 * `missed_grammar` counter.
 *
 * Patterns guarded:
 *   - double whitespace (`\s{2,}`)
 *   - orphan article with no following word (`the .`, `an !`)
 *   - article-followed-by-article (`a the`)
 *   - article-followed-by-demonstrative (`the this`, `a this`) — fires
 *     when a structural replacement starting with `this …` lands after
 *     an existing determiner from the surrounding clause
 *   - demonstrative-followed-by-demonstrative (`this this`)
 *   - doubled punctuation
 *
 * Note: a fuller grammar guard for verb-initial sentences (e.g. a
 * structural replacement of `is causally linked` landing at the start
 * of a sentence with no subject) is handled at the call site rather
 * than here, because we need the replacement-start offset relative to
 * the sentence boundary to detect it.
 */
function looksBroken(text: string): boolean {
  if (/\s{2,}/.test(text)) return true;
  if (/\b(?:the|a|an)\s+[.,;:!?]/i.test(text)) return true;
  if (/\b(?:a|an|the)\s+(?:a|an|the)\b/i.test(text)) return true;
  if (/\b(?:a|an|the)\s+(?:this|that|these|those)\b/i.test(text)) return true;
  if (/\b(?:this|that|these|those)\s+(?:this|that|these|those)\b/i.test(text)) return true;
  if (/[.,!?;:]{2,}/.test(text)) return true;
  return false;
}

/**
 * Returns true if the splice starting at `replacementStart` in
 * `candidate` produces a verb-initial sentence — i.e. the structural
 * replacement begins with a verb-form like `is causally linked` and
 * sits at the start of a sentence (no preceding subject in the same
 * clause). Used to revert replacements like
 * `Carries a strength of 0.55.` → `is causally linked.`
 * which read as ungrammatical fragments.
 */
function isVerbInitialAtSentenceStart(
  candidate: string,
  replacementStart: number,
  replacementText: string,
): boolean {
  // Verb-form replacements that need a subject. The other structural
  // replacements ("this causal link", "this causal relationship",
  // "this relationship") read as noun phrases and are fine at clause
  // boundaries.
  if (!/^is\b/i.test(replacementText)) return false;
  // Walk back through whitespace; if we hit start-of-string or a
  // sentence-terminator immediately before the replacement, this is a
  // sentence-initial verb fragment.
  let i = replacementStart - 1;
  while (i >= 0 && /\s/.test(candidate.charAt(i))) i--;
  if (i < 0) return true;
  const ch = candidate.charAt(i);
  return ch === '.' || ch === '!' || ch === '?';
}

export interface StructuralResult {
  readonly text: string;
  readonly matched: number;
  readonly suppressed: number;
  readonly missed_grammar: number;
  readonly rule_ids: string[];
}

export function suppressStructuralEdgeLanguage(text: string): StructuralResult {
  if (!text) {
    return { text: text ?? '', matched: 0, suppressed: 0, missed_grammar: 0, rule_ids: [] };
  }

  let working = text;
  let matched = 0;
  let suppressed = 0;
  let missedGrammar = 0;
  const ruleIds = new Set<string>();

  for (const rule of STRUCTURAL_RULES) {
    // Re-create per-iteration since exec() mutates lastIndex.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let result: RegExpExecArray | null;
    // We perform non-mutating scan first, capturing all candidate
    // ranges, then apply replacements right-to-left so earlier offsets
    // remain valid after substitution.
    const candidates: { start: number; end: number; match: string }[] = [];
    while ((result = pattern.exec(working)) !== null) {
      // Apply context-guard if specified.
      if (rule.contextTokens && rule.tokenWindow) {
        if (
          !hasContextToken(
            working,
            result.index,
            result.index + result[0].length,
            rule.contextTokens,
            rule.tokenWindow,
          )
        ) {
          continue;
        }
      }
      candidates.push({
        start: result.index,
        end: result.index + result[0].length,
        match: result[0],
      });
    }
    if (candidates.length === 0) continue;

    matched += candidates.length;
    // Apply right-to-left.
    for (let i = candidates.length - 1; i >= 0; i--) {
      const { start, end, match: matchedText } = candidates[i];

      // If the rule consumed a leading article, decide whether to
      // capitalise the replacement to preserve sentence-initial case.
      // We capitalise when the captured article was the start of the
      // sentence (start-of-string or preceded by `.`/`!`/`?` + space).
      let replacement = rule.replacement;
      if (startsWithArticle(matchedText)) {
        let walker = start - 1;
        while (walker >= 0 && /\s/.test(working.charAt(walker))) walker--;
        const atSentenceStart =
          walker < 0 ||
          working.charAt(walker) === '.' ||
          working.charAt(walker) === '!' ||
          working.charAt(walker) === '?';
        if (atSentenceStart) {
          replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
      }

      const candidate = working.slice(0, start) + replacement + working.slice(end);
      // Verb-initial guard: revert if the replacement produces a
      // sentence-initial verb fragment (e.g. `is causally linked.`
      // with no subject).
      if (isVerbInitialAtSentenceStart(candidate, start, replacement)) {
        missedGrammar++;
        continue;
      }
      // Look at a small window around the splice for the grammar guard.
      const guardStart = Math.max(0, start - 8);
      const guardEnd = Math.min(candidate.length, start + replacement.length + 8);
      const guardWindow = candidate.slice(guardStart, guardEnd);
      if (looksBroken(guardWindow)) {
        missedGrammar++;
        continue;
      }
      working = candidate;
      suppressed++;
      ruleIds.add(rule.id);
    }
  }

  return {
    text: working,
    matched,
    suppressed,
    missed_grammar: missedGrammar,
    rule_ids: Array.from(ruleIds),
  };
}

// ---------------------------------------------------------------
// Combined sanitiser
// ---------------------------------------------------------------

export interface SanitiseAssistantTextResult {
  readonly text: string;
  readonly probability_rewrites: number;
  readonly sensitivity_rewrites: number;
  readonly structural_matches: number;
  readonly structural_suppressed: number;
  readonly structural_missed_grammar: number;
  readonly structural_rule_ids: string[];
}

/**
 * Run all three sanitisers in the order: structural → sensitivity →
 * numeric. Order matters: structural suppression first removes phrases
 * that would otherwise look like legitimate numerics (e.g. "strength
 * of 0.55" disappears before the numeric rule tries to interpret 0.55
 * as a probability).
 */
export function sanitiseAssistantTextProse(text: string): SanitiseAssistantTextResult {
  const safeInput = text ?? '';
  const structural = suppressStructuralEdgeLanguage(safeInput);
  const sensitivity = translateSensitivityLanguage(structural.text);
  const numeric = formatNumericProse(sensitivity.text);
  return {
    text: numeric.text,
    probability_rewrites: numeric.rewrites,
    sensitivity_rewrites: sensitivity.rewrites,
    structural_matches: structural.matched,
    structural_suppressed: structural.suppressed,
    structural_missed_grammar: structural.missed_grammar,
    structural_rule_ids: structural.rule_ids,
  };
}
