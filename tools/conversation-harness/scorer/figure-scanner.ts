/**
 * figure-scanner.ts — numeric-literal scanner for %-anchored figures in prose
 * (conversation-harness, Wave1-L3 round 4).
 *
 * WHY A SCANNER AND NOT A REGEX
 * -----------------------------
 * G4 (canonical-state use) is the promotion-gate dimension that blocks a coach
 * prompt from shipping when it states figures that do not exist in the
 * canonical analysis payload. Its extraction step has now been through two
 * rounds of "fix the regex":
 *
 *   round 2: /(\d{1,3})\s?%/ captured the digits abutting '%', so a decimal
 *            figure surfaced as its FRACTION ('62.5%' -> 5) — inverting the
 *            gate in both directions.
 *   round 3: fixed decimals/thousands, and review found the SAME regex still
 *            inverted on NEGATIVE figures (sign dropped: a sign-flipped
 *            "you LOSE 20%" vs canonical +20 scored a perfect 1.000) and on
 *            HYPHENATED RANGES ('60-70%': only the upper bound anchored, so a
 *            fabricated lower bound never entered the denominator).
 *
 * Two rounds, same regex, new holes. An anchored regex is structurally the
 * wrong tool: every syntactic form it does not enumerate is silently DROPPED,
 * and a dropped figure cannot block — so every gap fails OPEN. This module
 * replaces it with an explicit left-to-right scanner over numeric literals
 * (sign, decimals, thousands grouping, ranges, conjunction lists,
 * currency-adjacent forms) plus a FAIL-CLOSED policy:
 *
 *   ANY %-ANCHORED FIGURE THE SCANNER CANNOT PARSE UNAMBIGUOUSLY IS REPORTED
 *   AS `unparseable` — the caller must count it as an UNTRACEABLE figure
 *   (gate-relevant), NEVER as absent.
 *
 * That flips the failure direction: a syntactic form nobody anticipated now
 * BLOCKS a candidate instead of waving it through, and the block is visible in
 * the details (someone investigates), where a silent drop was invisible.
 *
 * WHAT COUNTS AS A FIGURE
 * -----------------------
 * A figure must be ANCHORED to '%' or the word 'percent' / 'per cent' (word
 * boundary: 'percentile'/'percentage' do not anchor). Bare numbers are
 * ambiguous (dates, counts, the user's own figures) and a false positive here
 * degrades a real candidate, so '1,250' with no anchor yields nothing.
 * Currency-marked literals ('$1,250', '£62.5') are consumed as complete tokens
 * and are never percent figures: they cannot inherit an anchor from a
 * neighbour, and a directly-anchored currency ('$5%') is malformed ⇒
 * unparseable.
 *
 * SIGN — literal and directional
 * ------------------------------
 * An explicit sign character immediately adjacent to the literal is honoured:
 * '-20%', '−20%' (U+2212), '+20%', '±5%' (both values). A hyphen with
 * whitespace before the digits is NOT a sign ('- 20%' is a bullet, '60 - 70%'
 * is a range). Additionally, a directional cue in the 3 words immediately
 * before the figure (lose / down / fell / drop / decline / minus / negative …)
 * applies a negative sign, so the sign-flipped "you LOSE 20%" is extracted as
 * -20 and cannot trace to a canonical +20. Contradictions (an explicit sign
 * against an opposite cue, or both cue directions in the window) are
 * unparseable, not guessed. The hedge bigram 'up to' is neutralised before cue
 * matching so "fell by up to 20%" stays negative.
 *
 * HONEST LIMIT: the cue window looks BACKWARD only. A post-noun form like
 * "a 20% drop" is extracted as +20 — post-nouns more often name the metric
 * ("21% downside probability") than sign the value, and signing them would
 * false-block faithful restatements. So the sign handling is a floor on
 * directional fabrication, not a proof of its absence.
 *
 * RANGES AND LISTS
 * ----------------
 * '60-70%' (and '60 – 70%', '60 to 70%', '60%-70%') expands to BOTH bounds:
 * each bound enters the caller's denominator and must trace independently.
 * A conjunction list sharing one anchor ('10, 20 and 30%') distributes the
 * anchor across the listed literals — the same shared-anchor hole as ranges,
 * closed the same way. Malformed range-like forms — descending bounds
 * ('70-60%'), a sign inside a range, three-bound chains ('10-20-30%'),
 * asymmetric dash spacing ('60- 70%') — are unparseable.
 *
 * PII: this module returns numbers and counts only — never text fragments.
 * Callers must not emit scanned prose into details/notes.
 *
 * PURE — no src/ imports, no I/O.
 */

export interface FigureScan {
  /** Fully-resolved signed values, in text order (range/list forms expanded so
   * every bound/member is its own figure). */
  values: number[];
  /** Count of %-anchored figures that could NOT be parsed unambiguously.
   * FAIL-CLOSED CONTRACT: the caller MUST count each as an untraceable figure
   * (it can never trace), NEVER treat it as absent. */
  unparseable: number;
}

// ---------- character classes ----------

const CURRENCY = new Set(['$', '£', '€']);
/** Explicit sign characters. NOTE: en dash '–' and em dash '—' are range
 * separators, never signs; U+2212 minus is a sign, never a separator. */
const SIGN_CHARS = new Set(['-', '−', '+', '±']);
const SENTENCE_STOP = new Set(['.', '!', '?', ';', ':', '\n']);

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

// ---------- directional cues (backward window only — see module doc) ----------

const NEG_CUES = new Set([
  'lose', 'loses', 'losing', 'lost', 'loss', 'losses',
  'minus', 'negative', 'down',
  'drop', 'drops', 'dropped', 'dropping',
  'decline', 'declines', 'declined', 'declining',
  'decrease', 'decreases', 'decreased', 'decreasing',
  'fall', 'falls', 'fell', 'fallen', 'falling',
  'shrink', 'shrinks', 'shrinking', 'shrank', 'shrunk',
  'worse', 'worsen', 'worsens', 'worsened', 'deficit',
]);

const POS_CUES = new Set([
  'gain', 'gains', 'gained', 'gaining',
  'grow', 'grows', 'grew', 'growing', 'growth',
  'rise', 'rises', 'rose', 'risen', 'rising',
  'increase', 'increases', 'increased', 'increasing',
  'improve', 'improves', 'improved', 'improving',
  'plus', 'positive', 'up',
]);

// ---------- literal token ----------

interface Literal {
  /** Index of the first char of the token (sign/currency prefix included). */
  start: number;
  /** Index just past the last numeric char (before any released punctuation). */
  end: number;
  /** Index just past the anchor when anchored, else === end. */
  anchorEnd: number;
  value: number;
  valid: boolean;
  sign: '' | '-' | '+' | '±';
  currency: boolean;
  anchored: boolean;
  /** True when the anchor sits on the far side of released trailing
   * punctuation ('62.%') — malformed typography around an anchor. */
  anchorAfterReleasedPunct: boolean;
  /** Repeated sign/currency prefix chars ('--5%', '$$5%'). */
  malformedPrefix: boolean;
}

/** Validate and evaluate a digits/commas/dots run (prefix already stripped,
 * trailing punctuation already released). Strict thousands grouping: the first
 * group 1–3 digits, every later group exactly 3; at most one dot; no commas in
 * the fraction. '1,25' and '62.5.3' are invalid, not reinterpreted. */
function parseRaw(raw: string): { valid: boolean; value: number } {
  if (raw.length === 0 || !/[0-9]/.test(raw)) return { valid: false, value: NaN };
  if ((raw.match(/\./g) ?? []).length > 1) return { valid: false, value: NaN };
  const [intPart, fracPart] = raw.split('.') as [string, string | undefined];
  if (fracPart !== undefined && !/^\d+$/.test(fracPart)) return { valid: false, value: NaN };
  if (intPart.includes(',')) {
    const groups = intPart.split(',');
    if (groups[0].length < 1 || groups[0].length > 3 || !/^\d+$/.test(groups[0])) {
      return { valid: false, value: NaN };
    }
    for (const g of groups.slice(1)) {
      if (!/^\d{3}$/.test(g)) return { valid: false, value: NaN };
    }
  } else if (intPart !== '' && !/^\d+$/.test(intPart)) {
    return { valid: false, value: NaN };
  }
  const value = Number(raw.replace(/,/g, ''));
  return { valid: Number.isFinite(value), value };
}

/** Match an anchor ('%' | 'percent' | 'per cent', word-bounded) at/after `pos`,
 * skipping horizontal whitespace. Returns the index just past the anchor, or
 * -1. 'percentile' / 'percentage' do not anchor (letter follows the word). */
function matchAnchor(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  if (text[i] === '%') return i + 1;
  const rest = text.slice(i, i + 9).toLowerCase();
  for (const word of ['per cent', 'percent']) {
    if (rest.startsWith(word)) {
      const after = text[i + word.length] ?? '';
      if (!/[a-z]/i.test(after)) return i + word.length;
    }
  }
  return -1;
}

function scanLiterals(text: string): Literal[] {
  const lits: Literal[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const startsLiteral = isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? ''));
    if (!startsLiteral) {
      i++;
      continue;
    }
    // Attached prefix (sign/currency immediately adjacent, any order).
    let p = i - 1;
    let sign: Literal['sign'] = '';
    let currency = false;
    let malformedPrefix = false;
    while (p >= 0 && (SIGN_CHARS.has(text[p]) || CURRENCY.has(text[p]))) {
      if (SIGN_CHARS.has(text[p])) {
        if (sign !== '') malformedPrefix = true;
        sign = text[p] === '+' ? '+' : text[p] === '±' ? '±' : '-';
      } else {
        if (currency) malformedPrefix = true;
        currency = true;
      }
      p--;
    }
    // A consumed sign whose left neighbour is a digit or an anchor is not a
    // sign at all — it is the separator INSIDE '60-70%' / '60%-70%'. Surrender
    // it to the glue classifier (which owns range-vs-ambiguous), and start
    // this literal at its digits.
    if ((sign !== '' || currency) && p >= 0 && (isDigit(text[p]) || text[p] === '%')) {
      sign = '';
      currency = false;
      malformedPrefix = false;
      p = i - 1;
    }
    // Identifier guard: 'v2', 'utf8', 'CAGR20%' are fragments, not figures.
    if (p >= 0 && /[A-Za-z0-9_]/.test(text[p])) {
      while (i < n && /[0-9.,]/.test(text[i])) i++;
      continue;
    }
    const start = p + 1;
    // Maximal digits/commas/dots run, then release trailing punctuation
    // (sentence periods / list commas are not part of the number).
    let j = i;
    while (j < n && /[0-9.,]/.test(text[j])) j++;
    let raw = text.slice(i, j);
    let released = false;
    while (raw.length > 0 && /[.,]$/.test(raw)) {
      raw = raw.slice(0, -1);
      released = true;
    }
    const end = i + raw.length;
    const { valid, value } = parseRaw(raw);
    let anchored = false;
    let anchorEnd = end;
    let anchorAfterReleasedPunct = false;
    const a1 = matchAnchor(text, end);
    if (a1 >= 0) {
      // Normal case: anchor directly (modulo spaces) after the number. When
      // punctuation was released, matchAnchor(end) sees the punctuation char
      // and fails — handled below.
      anchored = true;
      anchorEnd = a1;
    } else if (released) {
      const a2 = matchAnchor(text, j);
      if (a2 >= 0) {
        // '62.%' — an anchor on the far side of released punctuation.
        anchored = true;
        anchorEnd = a2;
        anchorAfterReleasedPunct = true;
      }
    }
    lits.push({
      start,
      end,
      anchorEnd,
      value,
      valid,
      sign,
      currency,
      anchored,
      anchorAfterReleasedPunct,
      malformedPrefix,
    });
    i = Math.max(anchorEnd, j);
  }
  return lits;
}

// ---------- glue between consecutive literals ----------

type Glue = 'range' | 'list' | 'to' | 'ambiguous' | 'break';

function glueKind(s: string): Glue {
  if (/^\s*$/.test(s)) return 'break';
  if (/^[\s\-–—−]+$/.test(s)) {
    // Dash-and-space only. A clean range separator is exactly ONE dash with
    // SYMMETRIC spacing ('60-70%', '60 - 70%'). Everything else dash-like
    // ('60- 70%', '60--70%', a lone U+2212 used as a separator) is ambiguous
    // typography around figures — fail closed, never guess.
    const m = /^(\s*)([-–—])(\s*)$/.exec(s);
    if (m && (m[1].length === 0) === (m[3].length === 0)) return 'range';
    return 'ambiguous';
  }
  if (/^\s*,\s*(?:(?:and|or)\s+)?$/i.test(s)) return 'list';
  if (/^\s+(?:and|or)\s+$/i.test(s)) return 'list';
  if (/^\s+to\s+$/i.test(s)) return 'to';
  return 'break';
}

// ---------- directional-cue window ----------

/** Sign implied by the words immediately before the cluster. Backward window
 * only (see module doc), 3 words, not crossing a sentence stop; the hedge
 * bigram 'up to' is neutral. */
function cueSign(text: string, clusterStart: number): 'neg' | 'pos' | 'none' | 'ambiguous' {
  let boundary = 0;
  for (let k = clusterStart - 1; k >= 0; k--) {
    if (SENTENCE_STOP.has(text[k])) {
      boundary = k + 1;
      break;
    }
  }
  let words = text
    .slice(boundary, clusterStart)
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter(Boolean);
  // Neutralise 'up to' so the hedge cannot read as a positive cue.
  const dropped: string[] = [];
  for (let k = 0; k < words.length; k++) {
    if (words[k] === 'up' && words[k + 1] === 'to') {
      k++;
      continue;
    }
    dropped.push(words[k]);
  }
  words = dropped.slice(-3);
  const neg = words.some((w) => NEG_CUES.has(w));
  const pos = words.some((w) => POS_CUES.has(w));
  if (neg && pos) return 'ambiguous';
  if (neg) return 'neg';
  if (pos) return 'pos';
  return 'none';
}

// ---------- cluster classification ----------

const LIST_MEMBER_CAP = 5;

/**
 * Scan prose for %-anchored figures. See the module doc for the grammar and
 * the fail-closed contract on `unparseable`.
 */
export function scanProseFigures(text: string): FigureScan {
  const src = text ?? '';
  const values: number[] = [];
  let unparseable = 0;

  const lits = scanLiterals(src);

  // Group consecutive literals into clusters. Currency literals never chain
  // (they cannot inherit or donate an anchor), so glue into/out of one breaks.
  let k = 0;
  while (k < lits.length) {
    const members: Literal[] = [lits[k]];
    const glues: Glue[] = [];
    while (k + 1 < lits.length) {
      const g = glueKind(src.slice(members[members.length - 1].anchorEnd, lits[k + 1].start));
      if (g === 'break') break;
      if (members[members.length - 1].currency || lits[k + 1].currency) break;
      members.push(lits[k + 1]);
      glues.push(g);
      k++;
    }
    k++;

    // Trailing unanchored members of a LIST get no anchor to inherit — they
    // are bare and drop off the cluster ("wins 10%, 20, and 9 times…"). Range
    // glue keeps both sides: '60%-70' inherits across the dash.
    while (
      members.length > 1 &&
      !members[members.length - 1].anchored &&
      glues[glues.length - 1] === 'list'
    ) {
      members.pop();
      glues.pop();
    }

    const anchoredAny = members.some((m) => m.anchored);
    if (!anchoredAny) continue; // bare numbers / currency amounts: not figures

    // From here on, this cluster IS a stated figure (or several). Every
    // malformation below counts as unparseable — never a silent drop.
    const malformed =
      glues.includes('ambiguous') ||
      members.some(
        (m) => !m.valid || m.malformedPrefix || m.anchorAfterReleasedPunct || (m.currency && m.anchored),
      );
    if (malformed) {
      unparseable++;
      continue;
    }

    const kinds = new Set(glues);
    const isRange = kinds.has('range') || kinds.has('to');
    if (isRange && (kinds.size > 1 || members.length !== 2)) {
      // Mixed glue ('10, 20-30%') or a many-bound chain ('10-20-30%').
      unparseable++;
      continue;
    }
    if (!isRange && members.length > LIST_MEMBER_CAP) {
      unparseable++;
      continue;
    }

    const cue = cueSign(src, members[0].start);
    if (cue === 'ambiguous') {
      unparseable++;
      continue;
    }

    if (isRange) {
      // A range is one figure-form with two bounds. Explicit signs inside a
      // range ('-20-30%') and descending bounds ('70-60%') are ambiguous.
      const [lo, hi] = members;
      if (lo.sign !== '' || hi.sign !== '' || lo.value > hi.value) {
        unparseable++;
        continue;
      }
      const s = cue === 'neg' ? -1 : 1;
      values.push(s * lo.value, s * hi.value);
      continue;
    }

    // Single literal or conjunction list: resolve each member independently.
    let clusterBad = false;
    const resolved: number[] = [];
    for (const m of members) {
      if (m.sign === '±') {
        if (cue !== 'none') {
          clusterBad = true; // '±' against a directional cue: contradiction
          break;
        }
        resolved.push(m.value, -m.value);
        continue;
      }
      if ((m.sign === '-' && cue === 'pos') || (m.sign === '+' && cue === 'neg')) {
        clusterBad = true; // explicit sign contradicts the directional cue
        break;
      }
      const negative = m.sign === '-' || (m.sign === '' && cue === 'neg');
      resolved.push(negative ? -m.value : m.value);
    }
    if (clusterBad) {
      unparseable++;
      continue;
    }
    values.push(...resolved);
  }

  return { values, unparseable };
}
