import type { CqePatternMatch } from './rules.js';

// Post-match exclusion filters per CQE Design v1.1 §4.4. Applied after all
// rules (including compromise) emit. Drops:
//  - versions: "v2", "V2", "Q4", "#5", "version 2"
//  - ordinals: "1st", "2nd", "3rd", "4th"
//  - times: "4pm", "9:30"
//  - phone-number-shaped runs (3+ adjacent numeric tokens with whitespace)
//  - numbers whose raw span exceeds 12 chars
//  - "option N" UI references
//  - hyphenated descriptors ("double-digit", "mid-single-digit")

const VERSION_CHAR_PREFIX = /(?:^|\s)[vVqQ#]$/;
const VERSION_WORD_PREFIX = /\b(?:version|v|q|quarter)\s+$/i;
const ORDINAL_SUFFIX = /^(?:st|nd|rd|th)\b/i;
const TIME_SUFFIX = /^(?:am|pm)\b/i;
const OPTION_PREFIX = /\boption\s+$/i;
const HYPHEN_DIGIT_SUFFIX = /^-\s*digit/i;
const HYPHEN_WORD_PREFIX = /-\s*$/;

export function applyPostFilters(
  matches: readonly CqePatternMatch[],
  text: string,
): CqePatternMatch[] {
  const afterPhoneFilter = dropPhoneRuns(matches, text);
  return afterPhoneFilter.filter((m) => !shouldExclude(m, text));
}

function shouldExclude(match: CqePatternMatch, text: string): boolean {
  const raw = match.raw;
  if (raw.length > 12 && /^\d[\d.,\s]*\d$/.test(raw.trim())) return true;

  const before = text.slice(Math.max(0, match.spanStart - 12), match.spanStart);
  const after = text.slice(match.spanEnd, match.spanEnd + 8);

  if (VERSION_CHAR_PREFIX.test(before) && /^\d/.test(raw)) return true;
  if (VERSION_WORD_PREFIX.test(before) && /^\d/.test(raw)) return true;
  if (ORDINAL_SUFFIX.test(after)) return true;
  if (TIME_SUFFIX.test(after)) return true;
  if (/:/.test(raw)) return true;
  if (OPTION_PREFIX.test(before) && /^\d+$/.test(raw.trim())) return true;

  // Exclude multiplier verbs / numbers that sit inside a hyphenated compound
  // like "double-digit" or "mid-single-digit" where the descriptor is not
  // a quantity.
  if (HYPHEN_DIGIT_SUFFIX.test(after)) return true;
  if (HYPHEN_WORD_PREFIX.test(before) && /^(?:double|triple|quadruple)/i.test(raw)) return true;

  return false;
}

// Phone-number detector: if a match is a bare compromise number and is
// directly adjacent (whitespace-only separator) to at least one other numeric
// match, treat the whole run as a phone number / long identifier and drop all
// members of the run. Conservative: only engages when the run has >= 3 total
// digits and contains >= 2 whitespace-separated numeric spans.
function dropPhoneRuns(
  matches: readonly CqePatternMatch[],
  text: string,
): CqePatternMatch[] {
  if (matches.length < 2) return [...matches];
  const compromiseMatches = matches.filter((m) => m.result.source === 'compromise');
  if (compromiseMatches.length < 2) return [...matches];
  const toDrop = new Set<CqePatternMatch>();
  for (let i = 0; i < compromiseMatches.length; i++) {
    const a = compromiseMatches[i]!;
    let runTotalDigits = stripNonDigits(a.raw).length;
    const run: CqePatternMatch[] = [a];
    for (let j = i + 1; j < compromiseMatches.length; j++) {
      const b = compromiseMatches[j]!;
      const gap = text.slice(run[run.length - 1]!.spanEnd, b.spanStart);
      if (!/^\s+$/.test(gap)) break;
      run.push(b);
      runTotalDigits += stripNonDigits(b.raw).length;
    }
    if (run.length >= 2 && runTotalDigits >= 7) {
      for (const m of run) toDrop.add(m);
    }
  }
  return matches.filter((m) => !toDrop.has(m));
}

function stripNonDigits(s: string): string {
  return s.replace(/\D+/g, '');
}
