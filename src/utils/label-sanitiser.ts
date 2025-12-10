/**
 * Label Sanitiser Module
 *
 * Cleans node labels for use in prose generation.
 * Removes question marks, question prefixes, and normalises case
 * so labels read naturally in sentences.
 *
 * @example
 * sanitiseLabel("Implement time-tracking software?") → "implement time-tracking software"
 * sanitiseLabel("Should we increase prices") → "increase prices"
 * labelForSentence("hire more staff?", "subject") → "Hiring more staff"
 */

// Question prefixes to strip (case-insensitive)
const QUESTION_PREFIXES = [
  /^should\s+we\s+/i,
  /^do\s+we\s+/i,
  /^can\s+we\s+/i,
  /^will\s+we\s+/i,
  /^would\s+we\s+/i,
  /^could\s+we\s+/i,
  /^shall\s+we\s+/i,
  /^are\s+we\s+/i,
  /^is\s+it\s+/i,
  /^is\s+there\s+/i,
  /^does\s+it\s+/i,
  /^what\s+if\s+we\s+/i,
  /^how\s+about\s+/i,
  /^why\s+not\s+/i,
  /^yes,?\s+/i,
  /^no,?\s+/i,
];

// Response prefixes that sometimes appear
const RESPONSE_PREFIXES = [
  /^yes,?\s*/i,
  /^no,?\s*/i,
  /^maybe,?\s*/i,
];

/**
 * Core sanitisation: strips punctuation and question prefixes.
 * Returns lowercase label suitable for mid-sentence use.
 *
 * @example
 * sanitiseLabel("Implement time-tracking software?") → "implement time-tracking software"
 * sanitiseLabel("Should we hire more staff") → "hire more staff"
 * sanitiseLabel("Yes, implement software") → "implement software"
 */
export function sanitiseLabel(label: string): string {
  if (!label || typeof label !== "string") {
    return "";
  }

  let result = label.trim();

  // Remove trailing punctuation (? ! .)
  result = result.replace(/[?!.]+$/, "").trim();

  // Remove question prefixes
  for (const prefix of QUESTION_PREFIXES) {
    result = result.replace(prefix, "");
  }

  // Remove response prefixes
  for (const prefix of RESPONSE_PREFIXES) {
    result = result.replace(prefix, "");
  }

  // Normalise whitespace
  result = result.replace(/\s+/g, " ").trim();

  // Lowercase for mid-sentence use
  return result.toLowerCase();
}

/**
 * Formats a label for use in a sentence with proper capitalisation.
 *
 * @param label - The raw label to sanitise
 * @param position - Where in the sentence: 'subject' (start) or 'object' (mid-sentence)
 *
 * @example
 * labelForSentence("hire more staff?", "subject") → "Hiring more staff"
 * labelForSentence("hire more staff?", "object") → "hiring more staff"
 */
export function labelForSentence(
  label: string,
  position: "subject" | "object"
): string {
  const clean = sanitiseLabel(label);

  if (!clean) {
    return "";
  }

  // Convert to gerund form for more natural reading
  const gerund = toGerund(clean);

  if (position === "subject") {
    // Capitalise first letter for sentence start
    return gerund.charAt(0).toUpperCase() + gerund.slice(1);
  }

  return gerund;
}

/**
 * Converts a label to noun form (gerund) for use as a subject.
 *
 * @example
 * labelToNoun("implement software") → "implementing software"
 * labelToNoun("hire staff") → "hiring staff"
 * labelToNoun("increase prices") → "increasing prices"
 */
export function labelToNoun(label: string): string {
  const clean = sanitiseLabel(label);
  return toGerund(clean);
}

// Words that should NOT be converted to gerund (non-verbs that might start a label)
const NON_VERB_WORDS = new Set([
  "only",
  "option",
  "the",
  "a",
  "an",
  "our",
  "their",
  "this",
  "that",
  "my",
  "your",
  "new",
  "current",
  "existing",
  "first",
  "second",
  "third",
  "best",
  "better",
  "alternative",
  "primary",
  "main",
  "final",
]);

/**
 * Converts an imperative verb phrase to gerund form.
 * Simple heuristic: adds -ing to first word if it looks like a verb.
 *
 * @example
 * toGerund("implement software") → "implementing software"
 * toGerund("hire staff") → "hiring staff"
 * toGerund("running tests") → "running tests" (already gerund)
 * toGerund("only option") → "only option" (not a verb phrase)
 */
function toGerund(phrase: string): string {
  if (!phrase) {
    return "";
  }

  const words = phrase.split(" ");
  const firstWord = words[0];

  // Already a gerund
  if (firstWord.endsWith("ing")) {
    return phrase;
  }

  // Don't convert non-verb words
  if (NON_VERB_WORDS.has(firstWord.toLowerCase())) {
    return phrase;
  }

  // Common verb transformations
  const gerundForm = verbToGerund(firstWord);
  words[0] = gerundForm;

  return words.join(" ");
}

/**
 * Converts a single verb to gerund form.
 * Handles common English spelling rules.
 */
function verbToGerund(verb: string): string {
  if (!verb) {
    return "";
  }

  const lower = verb.toLowerCase();

  // Already gerund
  if (lower.endsWith("ing")) {
    return verb;
  }

  // Silent 'e' rule: remove 'e' before adding 'ing'
  // e.g., "make" → "making", "hire" → "hiring"
  if (lower.endsWith("e") && !lower.endsWith("ee") && !lower.endsWith("ie")) {
    return lower.slice(0, -1) + "ing";
  }

  // 'ie' becomes 'ying': "die" → "dying", "lie" → "lying"
  if (lower.endsWith("ie")) {
    return lower.slice(0, -2) + "ying";
  }

  // Double consonant rule for short vowel + single consonant
  // e.g., "run" → "running", "stop" → "stopping"
  if (shouldDoubleConsonant(lower)) {
    return lower + lower.slice(-1) + "ing";
  }

  // Default: just add 'ing'
  return lower + "ing";
}

/**
 * Determines if a word needs consonant doubling before -ing.
 * Rule: CVC pattern (consonant-vowel-consonant) with stress on last syllable.
 * Simplified heuristic for common short verbs.
 */
function shouldDoubleConsonant(word: string): boolean {
  if (word.length < 2) {
    return false;
  }

  const vowels = "aeiou";
  const lastChar = word.slice(-1);
  const secondLast = word.slice(-2, -1);

  // Don't double w, x, y
  if (["w", "x", "y"].includes(lastChar)) {
    return false;
  }

  // Check for CVC pattern in short words (1 syllable)
  if (word.length <= 4) {
    const isLastConsonant = !vowels.includes(lastChar);
    const isSecondLastVowel = vowels.includes(secondLast);

    if (isLastConsonant && isSecondLastVowel) {
      // Common short verbs that double
      const commonDoublers = [
        "run",
        "stop",
        "plan",
        "cut",
        "get",
        "set",
        "put",
        "sit",
        "hit",
        "bet",
        "fit",
        "let",
        "win",
        "begin",
        "swim",
        "trim",
        "ship",
        "drop",
        "shop",
        "crop",
        "chop",
        "hop",
        "pop",
        "top",
        "mop",
        "rob",
        "sob",
        "job",
        "rub",
        "scrub",
        "grab",
        "stab",
        "jab",
        "dab",
        "nab",
        "drag",
        "flag",
        "bag",
        "tag",
        "wag",
        "sag",
        "rag",
        "nag",
        "lag",
        "dig",
        "rig",
        "jig",
        "pig",
        "wig",
        "tug",
        "hug",
        "bug",
        "mug",
        "jug",
        "dug",
        "plug",
        "shrug",
        "slug",
        "drug",
        "snug",
      ];
      return commonDoublers.includes(word);
    }
  }

  return false;
}

/**
 * Sanitises a label specifically for use in comparison prose.
 * Returns a clean form suitable for "X vs Y" style comparisons.
 * Does NOT convert to gerund - just sanitises.
 *
 * @example
 * labelForComparison("Implement software?") → "implement software"
 * labelForComparison("Option B") → "option b"
 */
export function labelForComparison(label: string): string {
  return sanitiseLabel(label);
}

/**
 * Creates a display-friendly version of a label.
 * Capitalises appropriately for standalone display (e.g., in tables, lists).
 *
 * @example
 * labelForDisplay("implement time-tracking software") → "Implement time-tracking software"
 */
export function labelForDisplay(label: string): string {
  const clean = sanitiseLabel(label);

  if (!clean) {
    return "";
  }

  // Capitalise first letter only
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
