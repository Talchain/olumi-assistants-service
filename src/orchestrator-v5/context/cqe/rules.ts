import type {
  CqeParameterOperator,
  QuantityExtractionResult,
} from './schema-types.js';
import {
  overlapsWordNumberReplacement,
  type WordNumberReplacement,
} from './word-numbers.js';

// CQE pattern rules P1-P13 per CQE Design v1.1 §4.2.
//
// Construction principles:
//  - Each rule owns a bounded regex plus a parse function mapping a match to
//    Partial<QuantityExtractionResult>. Rules are authored to avoid
//    catastrophic backtracking by construction (no unbounded nested
//    quantifiers, no overlapping alternations without anchors). The 50ms
//    timeout in extract-quantities.ts is defence-in-depth, not control flow.
//  - P11 (from_to) is implemented as two anchored sub-patterns and merged in
//    code per cqe-investigation-proposal.md §3.3 Gate 3.
//  - All rules use the `i` flag for case-insensitive matching; the
//    normalisation layer preserves case so raw_text stays faithful.

// ---- shared token fragments -------------------------------------------------

const NUM = String.raw`(?:-|minus\s+)?\d+(?:\.\d+)?`;
const APPROX = String.raw`roughly|about|approximately|around|nearly|circa`;
const DIRECTION_UP_VERB = String.raw`increas(?:e|ing|es|ed)|rais(?:e|ing|es|ed)|grow(?:ing|s)?|grew|boost(?:ing|s|ed)?|add(?:ing|s|ed)?`;
const DIRECTION_DOWN_VERB = String.raw`reduc(?:e|ing|es|ed)|cut(?:ting|s)?|lower(?:ing|s|ed)?|decreas(?:e|ing|es|ed)|drop(?:ping|s|ped)?|bring(?:ing|s)?(?:\s+(?:down|it\s+down))?`;
const DIRECTION_SET_VERB = String.raw`set(?:ting|s)?|change(?:s|d)?|changing|updat(?:e|ing|es|ed)|mak(?:e|ing|es)|made`;
const DIRECTION_VERB = `(?:${DIRECTION_UP_VERB}|${DIRECTION_DOWN_VERB}|${DIRECTION_SET_VERB})`;
// Exported as `CURRENCY_SYMBOL_SOURCE` so consumers outside CQE (e.g.
// the V5 routing `FROM_TO_NUMERIC_ANCHOR_PATTERN`) can share the exact
// same grammar without re-implementing it. PR #192 review feedback
// (round 4, 2026-05-22) identified a ¥ accept bug in the local copy of
// this grammar — same drift class as the bare-`b` suffix bug closed in
// round 3. Sharing the source eliminates this class of bug.
export const CURRENCY_SYMBOL_SOURCE = String.raw`£|\$|€`;
const CURRENCY_SYMBOL = CURRENCY_SYMBOL_SOURCE;
const CURRENCY_CODE = String.raw`GBP|USD|EUR`;
const CURRENCY_COLLOQUIAL = String.raw`grand|quid`;
const TIME_UNIT = String.raw`months?|weeks?|days?|years?|hours?|minutes?`;
const METRIC_UNIT = String.raw`kg|km|miles?`;
// Suffix tokens MUST be followed by a non-letter (word boundary via
// negative lookahead). Otherwise "4 months" would parse the "m" in
// "months" as a million suffix.
//
// Exported as `NUMERIC_SUFFIX_SOURCE` so consumers outside CQE (e.g.
// the V5 routing `FROM_TO_NUMERIC_ANCHOR_PATTERN`) can share the exact
// same grammar without re-implementing it. PR #192 review feedback
// (2026-05-22) identified a bare-`b` accept bug caused by a divergent
// suffix pattern (`bn?`) that accepted "1b" / "2b" while CQE rejected
// them — the deterministic branch then attributed CQE's bare-number
// extraction as the target, silently mis-mutating the graph. Sharing
// the source string eliminates that drift class.
export const NUMERIC_SUFFIX_SOURCE = String.raw`(?:k|m|bn|million|billion|thousand)(?![a-z])`;
const SUFFIX = NUMERIC_SUFFIX_SOURCE;

// UNIT token for patterns that accept a trailing unit.
const UNIT = `(?:%|pp|percentage\\s+points?|${TIME_UNIT}|${METRIC_UNIT}|${CURRENCY_SYMBOL}|${CURRENCY_CODE}|${CURRENCY_COLLOQUIAL})`;

// Word fractions (handled by P5; values from §4.3 cross-cutting modifiers).
// Order matters: longer phrases must precede shorter ones so the alternation
// picks up "two thirds" before "third".
const WORD_FRACTIONS: ReadonlyArray<{ phrase: string; value: number }> = [
  { phrase: 'two thirds', value: 0.667 },
  { phrase: 'two-thirds', value: 0.667 },
  { phrase: 'three quarters', value: 0.75 },
  { phrase: 'three-quarters', value: 0.75 },
  { phrase: 'one third', value: 0.333 },
  { phrase: 'one-third', value: 0.333 },
  { phrase: 'a third', value: 0.333 },
  { phrase: 'a quarter', value: 0.25 },
  { phrase: 'a half', value: 0.5 },
  { phrase: 'third', value: 0.333 },
  { phrase: 'quarter', value: 0.25 },
  { phrase: 'half', value: 0.5 },
];

// ---- types ------------------------------------------------------------------

export interface RuleContext {
  readonly wordNumberReplacements: readonly WordNumberReplacement[];
}

export interface CqePatternMatch {
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly raw: string;
  readonly result: Partial<QuantityExtractionResult>;
  readonly patternId: string;
}

export interface PatternRule {
  readonly id: string;
  readonly priority: number;
  readonly apply: (text: string, ctx: RuleContext) => CqePatternMatch[];
}

// ---- helpers ----------------------------------------------------------------

function parseNum(raw: string): number {
  const trimmed = raw.trim().replace(/^minus\s+/i, '-');
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

function applySuffix(base: number, suffix: string | undefined): number {
  if (!suffix) return base;
  const s = suffix.toLowerCase();
  if (s === 'k' || s === 'thousand') return base * 1_000;
  if (s === 'm' || s === 'million') return base * 1_000_000;
  if (s === 'bn' || s === 'billion') return base * 1_000_000_000;
  return base;
}

function normaliseCurrencyUnit(token: string): string {
  const t = token.toLowerCase();
  if (t === '£' || t === 'gbp' || t === 'grand' || t === 'quid') return 'GBP';
  if (t === '$' || t === 'usd') return 'USD';
  if (t === '€' || t === 'eur') return 'EUR';
  return t;
}

function normaliseUnit(token: string | undefined): string | null {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  if (!t) return null;
  if (t === '%') return 'percentage';
  if (t === 'pp' || /^percentage\s+points?$/.test(t)) return 'percentage_points';
  if (/^(£|\$|€|gbp|usd|eur|grand|quid)$/.test(t)) return normaliseCurrencyUnit(t);
  // Collapse plurals for duration/metric units (months -> month, etc).
  return t.replace(/s$/u, '');
}

function directionFromVerb(verb: string): 'up' | 'down' | 'set' {
  const v = verb.toLowerCase();
  if (new RegExp(`^(?:${DIRECTION_UP_VERB})$`, 'i').test(v)) return 'up';
  if (new RegExp(`^(?:${DIRECTION_DOWN_VERB})$`, 'i').test(v)) return 'down';
  return 'set';
}

function isApproximatelyPrefixed(text: string, spanStart: number): boolean {
  const windowStart = Math.max(0, spanStart - 40);
  const before = text.slice(windowStart, spanStart);
  return new RegExp(`(?:\\b(?:${APPROX})\\b)\\s*\\S*\\s*$`, 'i').test(before);
}

function matchContainsApprox(raw: string): boolean {
  return new RegExp(`\\b(?:${APPROX})\\b`, 'i').test(raw);
}

function makeResult(
  raw: string,
  result: Partial<QuantityExtractionResult>,
): Partial<QuantityExtractionResult> {
  return {
    raw_text: raw,
    value: null,
    unit: null,
    direction: null,
    multiplier: null,
    operator: null,
    comparator: null,
    range_min: null,
    range_max: null,
    approximate: false,
    source: 'cqe',
    ...result,
  };
}

function emit(
  match: RegExpExecArray,
  text: string,
  result: Partial<QuantityExtractionResult>,
  ctx: RuleContext,
): CqePatternMatch {
  const spanStart = match.index;
  const spanEnd = match.index + match[0].length;
  const raw = match[0];
  const approximate =
    result.approximate === true ||
    isApproximatelyPrefixed(text, spanStart) ||
    matchContainsApprox(raw);
  const merged = makeResult(raw, { ...result, approximate });
  const originIsWord = overlapsWordNumberReplacement(
    ctx.wordNumberReplacements,
    spanStart,
    spanEnd,
  );
  if (originIsWord && merged.value_origin === undefined) {
    merged.value_origin = 'word_number';
  }
  return {
    spanStart,
    spanEnd,
    raw,
    result: merged,
    patternId: '',
  };
}

function scanAll(
  text: string,
  regex: RegExp,
  onMatch: (m: RegExpExecArray) => CqePatternMatch | null,
): CqePatternMatch[] {
  const out: CqePatternMatch[] = [];
  let m: RegExpExecArray | null;
  const cloned = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  while ((m = cloned.exec(text)) !== null) {
    const res = onMatch(m);
    if (res) out.push(res);
    if (m.index === cloned.lastIndex) cloned.lastIndex++;
  }
  return out;
}

// ---- P1 range_between ------------------------------------------------------

const P1_REGEX = new RegExp(
  `\\bbetween\\s+(${NUM})\\s*(${UNIT})?\\s+and\\s+(${NUM})\\s*(${UNIT})?`,
  'gi',
);

const rule_P1: PatternRule = {
  id: 'P1',
  priority: 1,
  apply: (text, ctx) =>
    scanAll(text, P1_REGEX, (m) => {
      const rangeMin = parseNum(m[1]);
      const perSideUnitA = m[2];
      const rangeMax = parseNum(m[3]);
      const perSideUnitB = m[4];
      if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) return null;
      const unitA = normaliseUnit(perSideUnitA);
      const unitB = normaliseUnit(perSideUnitB);
      const unit = unitB ?? unitA;
      if (perSideUnitA && perSideUnitB && unitA !== unitB) return null;
      const isPercentUnit = unit === 'percentage';
      return emit(
        m,
        text,
        {
          range_min: isPercentUnit ? rangeMin / 100 : rangeMin,
          range_max: isPercentUnit ? rangeMax / 100 : rangeMax,
          comparator: 'between',
          unit,
          value_origin: 'literal',
        },
        ctx,
      );
    }),
};

// ---- P2 range_dash ---------------------------------------------------------
// Hyphen/en-dash variant AND "X to Y unit" variant. Guards: must NOT be
// preceded by `from` (P11 territory) or by a directional verb (P12 territory).

const P2_HYPHEN_REGEX = new RegExp(
  `(${NUM})\\s*[-–]\\s*(${NUM})(?:\\s*(${UNIT}))?`,
  'gi',
);
const P2_TO_REGEX = new RegExp(
  `\\b(${NUM})\\s+to\\s+(${NUM})(?:\\s*(${UNIT}))?`,
  'gi',
);

function p2GuardsPass(text: string, matchIndex: number): boolean {
  const windowStart = Math.max(0, matchIndex - 40);
  const before = text.slice(windowStart, matchIndex);
  if (/\bfrom\s+$/i.test(before)) return false;
  if (new RegExp(`\\b(?:${DIRECTION_VERB})\\b[^\\n]*?\\s+$`, 'i').test(before)) return false;
  return true;
}

const rule_P2: PatternRule = {
  id: 'P2',
  priority: 2,
  apply: (text, ctx) => {
    const out: CqePatternMatch[] = [];
    const process = (regex: RegExp): void => {
      for (const m of scanAllExec(text, regex)) {
        if (!p2GuardsPass(text, m.index)) continue;
        const rangeMin = parseNum(m[1]);
        const rangeMax = parseNum(m[2]);
        const rawUnit = m[3];
        if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) continue;
        const unit = normaliseUnit(rawUnit);
        const isPercentUnit = unit === 'percentage';
        out.push(
          emit(
            m,
            text,
            {
              range_min: isPercentUnit ? rangeMin / 100 : rangeMin,
              range_max: isPercentUnit ? rangeMax / 100 : rangeMax,
              comparator: 'between',
              unit,
              value_origin: 'literal',
            },
            ctx,
          ),
        );
      }
    };
    process(P2_HYPHEN_REGEX);
    process(P2_TO_REGEX);
    return out;
  },
};

// Typed filter guard. Lets parse callbacks return `CqePatternMatch | null`
// without resorting to `as unknown` bypasses (brief §13).
function isMatch(x: CqePatternMatch | null | undefined): x is CqePatternMatch {
  return x !== null && x !== undefined;
}

function scanAllExec(text: string, regex: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const cloned = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = cloned.exec(text)) !== null) {
    out.push(m);
    if (m.index === cloned.lastIndex) cloned.lastIndex++;
  }
  return out;
}

// ---- P3 comparator_value ---------------------------------------------------

const COMPARATOR_ATMOST = String.raw`at\s+most|no\s+more\s+than|up\s+to|under|less\s+than|maximum(?:\s+of)?|max(?:\s+of)?`;
const COMPARATOR_ATLEAST = String.raw`at\s+least|no\s+less\s+than|over|more\s+than|minimum(?:\s+of)?|min(?:\s+of)?`;
const P3_REGEX = new RegExp(
  `\\b(?<cmp>${COMPARATOR_ATMOST}|${COMPARATOR_ATLEAST})\\s+(?<currSym>${CURRENCY_SYMBOL})?(?<num>${NUM})(?:\\s*(?<suffix>${SUFFIX}))?(?:\\s*(?<unit>${UNIT}))?`,
  'gi',
);

const rule_P3: PatternRule = {
  id: 'P3',
  priority: 3,
  apply: (text, ctx) =>
    scanAllExec(text, P3_REGEX).map((m) => {
      const cmpRaw = m.groups?.cmp?.toLowerCase() ?? '';
      const currSym = m.groups?.currSym;
      const num = parseNum(m.groups?.num ?? '');
      const suffix = m.groups?.suffix;
      const rawUnit = m.groups?.unit;
      if (!Number.isFinite(num)) return null;
      const comparator: 'at_least' | 'at_most' = new RegExp(`^(?:${COMPARATOR_ATLEAST})$`, 'i').test(cmpRaw)
        ? 'at_least'
        : 'at_most';
      let unit = normaliseUnit(rawUnit);
      let value = applySuffix(num, suffix);
      const hasSuffix = Boolean(suffix);
      if (currSym) {
        unit = normaliseCurrencyUnit(currSym);
      }
      if (unit === 'percentage') value = value / 100;
      return emit(
        m,
        text,
        {
          value,
          comparator,
          unit,
          value_origin: hasSuffix ? 'suffix_expansion' : 'literal',
        },
        ctx,
      );
    }).filter(isMatch),
};

// ---- P4 multiplier_verb ----------------------------------------------------

const MULTIPLIER_LEXICON: ReadonlyArray<{ phrase: string; multiplier: number; direction: 'up' | 'down' }> = [
  { phrase: 'quadruple', multiplier: 4, direction: 'up' },
  { phrase: 'quadrupling', multiplier: 4, direction: 'up' },
  { phrase: 'triple', multiplier: 3, direction: 'up' },
  { phrase: 'tripling', multiplier: 3, direction: 'up' },
  { phrase: 'double', multiplier: 2, direction: 'up' },
  { phrase: 'doubling', multiplier: 2, direction: 'up' },
  { phrase: 'halve', multiplier: 0.5, direction: 'down' },
  { phrase: 'halving', multiplier: 0.5, direction: 'down' },
];
const P4_REGEX = new RegExp(
  `\\b(${MULTIPLIER_LEXICON.map((e) => e.phrase).join('|')})\\b`,
  'gi',
);

const rule_P4: PatternRule = {
  id: 'P4',
  priority: 4,
  apply: (text, ctx) =>
    scanAllExec(text, P4_REGEX).map((m) => {
      const word = m[1].toLowerCase();
      const entry = MULTIPLIER_LEXICON.find((e) => e.phrase === word)!;
      return emit(
        m,
        text,
        {
          multiplier: entry.multiplier,
          operator: 'multiply',
          direction: entry.direction,
          value_origin: 'literal',
        },
        ctx,
      );
    }),
};

// ---- P5 word_fraction ------------------------------------------------------

const P5_REGEX = new RegExp(
  `\\b(${DIRECTION_UP_VERB}|${DIRECTION_DOWN_VERB})\\s+by\\s+(?:(?:${APPROX})\\s+)?(${WORD_FRACTIONS.map((e) => e.phrase.replace(/\s+/g, '\\s+')).join('|')})\\b`,
  'gi',
);

const rule_P5: PatternRule = {
  id: 'P5',
  priority: 5,
  apply: (text, ctx) =>
    scanAllExec(text, P5_REGEX).map((m) => {
      const verb = m[1];
      const phraseRaw = m[2];
      const direction = directionFromVerb(verb) === 'up' ? 'up' : 'down';
      const entry = WORD_FRACTIONS.find((e) =>
        new RegExp(`^${e.phrase.replace(/\s+/g, '\\s+')}$`, 'i').test(phraseRaw),
      );
      if (!entry) return null;
      return emit(
        m,
        text,
        {
          value: entry.value,
          operator: direction === 'up' ? 'increment' : 'decrement',
          direction,
          value_origin: 'word_fraction',
        },
        ctx,
      );
    }).filter(isMatch),
};

// ---- P6 directional_percent -------------------------------------------------

const P6_REGEX = new RegExp(
  `\\b(${DIRECTION_UP_VERB}|${DIRECTION_DOWN_VERB})(?:\\s+[a-z][a-z\\s-]{0,30}?)?\\s+by\\s+(?:(?:${APPROX})\\s+)?(${NUM})\\s*%`,
  'gi',
);

const rule_P6: PatternRule = {
  id: 'P6',
  priority: 6,
  apply: (text, ctx) =>
    scanAllExec(text, P6_REGEX).map((m) => {
      const verb = m[1];
      const num = parseNum(m[2]);
      if (!Number.isFinite(num)) return null;
      const direction = directionFromVerb(verb) === 'up' ? 'up' : 'down';
      return emit(
        m,
        text,
        {
          value: num / 100,
          direction,
          operator: direction === 'up' ? 'increment' : 'decrement',
          unit: 'percentage',
          value_origin: 'literal',
        },
        ctx,
      );
    }).filter(isMatch),
};

// ---- P6b directional_absolute ----------------------------------------------

const P6B_REGEX = new RegExp(
  `\\b(${DIRECTION_UP_VERB}|${DIRECTION_DOWN_VERB})(?:\\s+[a-z][a-z\\s-]{0,30}?)?\\s+(?:by\\s+)?(?:(?:${APPROX})\\s+)?(?:(${CURRENCY_SYMBOL}))?(${NUM})\\s*(${SUFFIX})?(?:\\s*(${UNIT}))?(?!\\s*%)`,
  'gi',
);

const rule_P6b: PatternRule = {
  id: 'P6b',
  priority: 7,
  apply: (text, ctx) =>
    scanAllExec(text, P6B_REGEX).map((m) => {
      const verb = m[1];
      const currSym = m[2];
      const num = parseNum(m[3]);
      const suffix = m[4];
      const rawUnit = m[5];
      if (!Number.isFinite(num)) return null;
      const direction = directionFromVerb(verb);
      if (direction === 'set') return null;
      let unit = normaliseUnit(rawUnit);
      if (currSym) unit = normaliseCurrencyUnit(currSym);
      const value = applySuffix(num, suffix);
      const isCut = direction === 'down';
      const verbLower = verb.toLowerCase();
      const isAddVerb = /^add/i.test(verbLower);
      const operator: CqeParameterOperator = isAddVerb
        ? 'add'
        : isCut
        ? 'decrement'
        : 'increment';
      const valueOrigin: QuantityExtractionResult['value_origin'] = suffix
        ? 'suffix_expansion'
        : 'literal';
      return emit(
        m,
        text,
        {
          value,
          direction,
          operator,
          unit,
          value_origin: valueOrigin,
        },
        ctx,
      );
    }).filter(isMatch),
};

// ---- P7 set_verb_value -----------------------------------------------------

const P7_REGEX = new RegExp(
  `\\b(${DIRECTION_SET_VERB})\\b(?:\\s+(?:the\\s+)?[a-z][a-z\\s-]{0,40}?)?\\s+to\\s+(?:(?:${APPROX})\\s+)?(?:(${CURRENCY_SYMBOL}))?(${NUM})\\s*(${SUFFIX})?(?:\\s*(${UNIT}))?`,
  'gi',
);

// Continuation pattern: "... and X to N [unit]" where the preceding text is
// mostly whitespace (indicating an earlier P7 match was masked). Treats the
// continuation as an implicit set operation inheriting from the prior verb.
const P7_CONTINUATION_REGEX = new RegExp(
  `\\band\\s+(?:the\\s+)?[a-z][a-z\\s-]{0,30}?\\s+to\\s+(?:(${CURRENCY_SYMBOL}))?(${NUM})\\s*(${SUFFIX})?(?:\\s*(${UNIT}))?`,
  'gi',
);

const rule_P7: PatternRule = {
  id: 'P7',
  priority: 8,
  apply: (text, ctx) =>
    scanAllExec(text, P7_REGEX).map((m) => {
      const currSym = m[2];
      const num = parseNum(m[3]);
      const suffix = m[4];
      const rawUnit = m[5];
      if (!Number.isFinite(num)) return null;
      let unit = normaliseUnit(rawUnit);
      if (currSym) unit = normaliseCurrencyUnit(currSym);
      let value = applySuffix(num, suffix);
      if (unit === 'percentage') value = value / 100;
      const valueOrigin: QuantityExtractionResult['value_origin'] = suffix
        ? 'suffix_expansion'
        : 'literal';
      return emit(
        m,
        text,
        {
          value,
          operator: 'set',
          direction: 'set',
          unit,
          value_origin: valueOrigin,
        },
        ctx,
      );
    }).filter(isMatch),
};

// P7 continuation: "and X to N" after a preceding masked P7 clause.
const rule_P7_continuation: PatternRule = {
  id: 'P7c',
  priority: 8,
  apply: (text, ctx) =>
    scanAllExec(text, P7_CONTINUATION_REGEX).map((m) => {
      const windowStart = Math.max(0, m.index - 40);
      const before = text.slice(windowStart, m.index);
      const whitespaceRun = before.match(/\s{8,}$/);
      if (!whitespaceRun) return null;
      const currSym = m[1];
      const num = parseNum(m[2]);
      const suffix = m[3];
      const rawUnit = m[4];
      if (!Number.isFinite(num)) return null;
      let unit = normaliseUnit(rawUnit);
      if (currSym) unit = normaliseCurrencyUnit(currSym);
      let value = applySuffix(num, suffix);
      if (unit === 'percentage') value = value / 100;
      const valueOrigin: QuantityExtractionResult['value_origin'] = suffix
        ? 'suffix_expansion'
        : 'literal';
      return emit(
        m,
        text,
        {
          value,
          operator: 'set',
          direction: 'set',
          unit,
          value_origin: valueOrigin,
        },
        ctx,
      );
    }).filter(isMatch),
};

// ---- P8 currency -----------------------------------------------------------

const P8_SYMBOL_REGEX = new RegExp(
  `(${CURRENCY_SYMBOL})\\s?(${NUM})\\s*(${SUFFIX})?`,
  'gi',
);
const P8_CODE_REGEX = new RegExp(
  `\\b(${CURRENCY_CODE})\\s+(${NUM})\\s*(${SUFFIX})?`,
  'gi',
);
const P8_CODE_SUFFIX_REGEX = new RegExp(
  `(${NUM})\\s*(${SUFFIX})?\\s+(${CURRENCY_CODE})\\b`,
  'gi',
);
const P8_COLLOQUIAL_REGEX = new RegExp(
  `\\b(${NUM})\\s+(${CURRENCY_COLLOQUIAL})\\b`,
  'gi',
);

const rule_P8: PatternRule = {
  id: 'P8',
  priority: 9,
  apply: (text, ctx) => {
    const out: CqePatternMatch[] = [];

    for (const m of scanAllExec(text, P8_SYMBOL_REGEX)) {
      const unit = normaliseCurrencyUnit(m[1]);
      const num = parseNum(m[2]);
      const suffix = m[3];
      if (!Number.isFinite(num)) continue;
      const value = applySuffix(num, suffix);
      out.push(
        emit(
          m,
          text,
          {
            value,
            unit,
            value_origin: suffix ? 'suffix_expansion' : 'literal',
          },
          ctx,
        ),
      );
    }

    for (const m of scanAllExec(text, P8_CODE_REGEX)) {
      const unit = normaliseCurrencyUnit(m[1]);
      const num = parseNum(m[2]);
      const suffix = m[3];
      if (!Number.isFinite(num)) continue;
      const value = applySuffix(num, suffix);
      out.push(
        emit(
          m,
          text,
          {
            value,
            unit,
            value_origin: suffix ? 'suffix_expansion' : 'literal',
          },
          ctx,
        ),
      );
    }

    for (const m of scanAllExec(text, P8_CODE_SUFFIX_REGEX)) {
      const num = parseNum(m[1]);
      const suffix = m[2];
      const unit = normaliseCurrencyUnit(m[3]);
      if (!Number.isFinite(num)) continue;
      const value = applySuffix(num, suffix);
      out.push(
        emit(
          m,
          text,
          {
            value,
            unit,
            value_origin: suffix ? 'suffix_expansion' : 'literal',
          },
          ctx,
        ),
      );
    }

    for (const m of scanAllExec(text, P8_COLLOQUIAL_REGEX)) {
      const num = parseNum(m[1]);
      const colloquial = m[2].toLowerCase();
      if (!Number.isFinite(num)) continue;
      const value = colloquial === 'grand' ? num * 1000 : num;
      const unit = 'GBP';
      out.push(
        emit(
          m,
          text,
          {
            value,
            unit,
            value_origin: 'suffix_expansion',
          },
          ctx,
        ),
      );
    }

    return out;
  },
};

// ---- P9 bare_percentage ----------------------------------------------------

const P9_REGEX = new RegExp(`(${NUM})\\s*%`, 'gi');

const rule_P9: PatternRule = {
  id: 'P9',
  priority: 10,
  apply: (text, ctx) =>
    scanAllExec(text, P9_REGEX).map((m) => {
      const spanStart = m.index;
      const windowStart = Math.max(0, spanStart - 20);
      const before = text.slice(windowStart, spanStart);
      if (new RegExp(`\\b(?:${DIRECTION_VERB})\\b[^%]*$`, 'i').test(before)) {
        return null;
      }
      const num = parseNum(m[1]);
      if (!Number.isFinite(num)) return null;
      return emit(
        m,
        text,
        {
          value: num / 100,
          unit: 'percentage',
          value_origin: 'literal',
        },
        ctx,
      );
    }).filter(isMatch),
};

// ---- P10 vague_quantifier --------------------------------------------------

const VAGUE_QUANTIFIERS: ReadonlyArray<{ phrase: string; value: number | null }> = [
  { phrase: 'a couple of', value: 2 },
  { phrase: 'a couple', value: 2 },
  { phrase: 'a few', value: null },
  { phrase: 'several', value: null },
  { phrase: 'many', value: null },
  { phrase: 'a handful of', value: null },
  { phrase: 'a handful', value: null },
];
const P10_REGEX = new RegExp(
  `\\b(${VAGUE_QUANTIFIERS.map((e) => e.phrase.replace(/\s+/g, '\\s+')).join('|')})\\b(?:\\s+(?:percent|%))?`,
  'gi',
);

const rule_P10: PatternRule = {
  id: 'P10',
  priority: 11,
  apply: (text, ctx) =>
    scanAllExec(text, P10_REGEX).map((m) => {
      const raw = m[0];
      const phraseRaw = m[1].toLowerCase();
      const entry = VAGUE_QUANTIFIERS.find((e) => e.phrase === phraseRaw);
      if (!entry) return null;
      const hasPercent = /\bpercent|%$/i.test(raw);
      return emit(
        m,
        text,
        {
          value: entry.value,
          approximate: true,
          value_origin: 'lexical_quantifier',
          ...(hasPercent ? { unit: 'percentage' } : {}),
        },
        ctx,
      );
    }).filter(isMatch),
};

// ---- P11 from_to (split per Gate 3) ----------------------------------------

// P11 is structurally split into two anchored sub-patterns per brief §6
// Gate 3 and investigation proposal §3.3 (avoid one mega-regex with optional
// per-side unit alternation, which carries high backtracking risk).
//
//   P11_WITH_UNITS:    each side must carry a unit. Top-level alternation
//                      per side: currency-symbol form OR trailing UNIT form.
//                      Mandatory one-of-two, NOT optional. Bounded
//                      backtracking: at most two branches per side.
//                      Covers "from 50 to 70" with implicit currency
//                      symbols, "from 3% to 5%", and "from 5 months to
//                      10 months".
//
//   P11_WITHOUT_UNITS: neither side carries a unit. Numbers plus optional
//                      multiplier suffix only; optional trailing UNIT at
//                      the end applies to both bounds. Covers "from 200k
//                      to 150k" and "from 3 to 5 months".
//
// The apply() function runs both, masks matched spans from the shared
// working text, and merges results in code. Neither regex contains an
// optional per-side UNIT group; SUFFIX (the k/m/bn multiplier marker) is
// allowed optional because it does not define the unit.
//
// Group numbering in P11_WITH_UNITS:
//   Side A currency branch: 1=SYM, 2=NUM, 3=SUFFIX?
//   Side A unit branch:     4=NUM, 5=SUFFIX?, 6=UNIT
//   Side B currency branch: 7=SYM, 8=NUM, 9=SUFFIX?
//   Side B unit branch:     10=NUM, 11=SUFFIX?, 12=UNIT
// Side X matched the currency branch iff group (6X-5) is defined.
const P11_WITH_UNITS_REGEX = new RegExp(
  `\\bfrom\\s+(?:` +
    `(${CURRENCY_SYMBOL})(${NUM})(?:\\s*(${SUFFIX}))?` +
    `|` +
    `(${NUM})(?:\\s*(${SUFFIX}))?\\s*(${UNIT})` +
  `)\\s+to\\s+(?:` +
    `(${CURRENCY_SYMBOL})(${NUM})(?:\\s*(${SUFFIX}))?` +
    `|` +
    `(${NUM})(?:\\s*(${SUFFIX}))?\\s*(${UNIT})` +
  `)`,
  'gi',
);

const P11_WITHOUT_UNITS_REGEX = new RegExp(
  `\\bfrom\\s+(${NUM})(?:\\s*(${SUFFIX}))?\\s+to\\s+(${NUM})(?:\\s*(${SUFFIX}))?(?:\\s*(${UNIT}))?`,
  'gi',
);

interface P11Parsed {
  numA: number;
  numB: number;
  suffixA: string | undefined;
  suffixB: string | undefined;
  unit: string | null;
}

function emitP11(
  m: RegExpExecArray,
  text: string,
  parsed: P11Parsed,
  ctx: RuleContext,
): CqePatternMatch {
  const { numA, numB, suffixA, suffixB, unit } = parsed;
  const valueA = applySuffix(numA, suffixA);
  const valueB = applySuffix(numB, suffixB);
  const isPercentUnit = unit === 'percentage';

  const windowStart = Math.max(0, m.index - 40);
  const before = text.slice(windowStart, m.index);
  const verbMatch = before.match(
    new RegExp(`\\b(${DIRECTION_VERB})\\b(?=[^\\n]*$)`, 'i'),
  );
  const verbDirection = verbMatch ? directionFromVerb(verbMatch[1]) : null;
  const trajectoryDirection: 'up' | 'down' | 'set' =
    valueB > valueA ? 'up' : valueB < valueA ? 'down' : 'set';
  const direction = verbDirection ?? trajectoryDirection;

  const hasSuffix = Boolean(suffixA || suffixB);
  return emit(
    m,
    text,
    {
      value: isPercentUnit ? valueB / 100 : valueB,
      range_min: isPercentUnit ? valueA / 100 : valueA,
      range_max: isPercentUnit ? valueB / 100 : valueB,
      operator: 'set',
      direction,
      unit,
      value_origin: hasSuffix ? 'suffix_expansion' : 'literal',
    },
    ctx,
  );
}

const rule_P11: PatternRule = {
  id: 'P11',
  priority: 12,
  apply: (text, ctx) => {
    const out: CqePatternMatch[] = [];
    const masked = new Set<string>();
    const addMatch = (m: RegExpExecArray, parsed: P11Parsed): void => {
      const span = `${m.index}:${m.index + m[0].length}`;
      if (masked.has(span)) return;
      // Also skip if the current span overlaps any prior span.
      for (const prev of masked) {
        const [ps, pe] = prev.split(':').map(Number) as [number, number];
        if (ps < m.index + m[0].length && pe > m.index) return;
      }
      masked.add(span);
      out.push(emitP11(m, text, parsed, ctx));
    };

    // Sub-pattern 1 (WITH-UNITS): each side carries a unit via one of two
    // branches. Pick the branch that matched based on which capture group
    // is defined; reject mixed currency-vs-unit-suffix pairings by
    // requiring both normalised units to match.
    for (const m of scanAllExec(text, P11_WITH_UNITS_REGEX)) {
      const currA = m[1];
      const numACurr = m[2];
      const suffixACurr = m[3];
      const numAUnit = m[4];
      const suffixAUnit = m[5];
      const unitA = m[6];

      const currB = m[7];
      const numBCurr = m[8];
      const suffixBCurr = m[9];
      const numBUnit = m[10];
      const suffixBUnit = m[11];
      const unitB = m[12];

      const sideANum = parseNum((currA ? numACurr : numAUnit) ?? '');
      const sideASuffix = currA ? suffixACurr : suffixAUnit;
      const sideAUnit = currA
        ? normaliseCurrencyUnit(currA)
        : unitA
          ? normaliseUnit(unitA)
          : null;

      const sideBNum = parseNum((currB ? numBCurr : numBUnit) ?? '');
      const sideBSuffix = currB ? suffixBCurr : suffixBUnit;
      const sideBUnit = currB
        ? normaliseCurrencyUnit(currB)
        : unitB
          ? normaliseUnit(unitB)
          : null;

      if (!Number.isFinite(sideANum) || !Number.isFinite(sideBNum)) continue;
      if (!sideAUnit || !sideBUnit || sideAUnit !== sideBUnit) continue;

      addMatch(m, {
        numA: sideANum,
        numB: sideBNum,
        suffixA: sideASuffix,
        suffixB: sideBSuffix,
        unit: sideAUnit,
      });
    }

    // Sub-pattern 2 (WITHOUT-UNITS): no per-side unit on either side;
    // optional trailing unit applies to both.
    for (const m of scanAllExec(text, P11_WITHOUT_UNITS_REGEX)) {
      const numA = parseNum(m[1] ?? '');
      const suffixA = m[2];
      const numB = parseNum(m[3] ?? '');
      const suffixB = m[4];
      const trailingUnit = m[5];
      if (!Number.isFinite(numA) || !Number.isFinite(numB)) continue;
      const unit = trailingUnit ? normaliseUnit(trailingUnit) : null;
      addMatch(m, { numA, numB, suffixA, suffixB, unit });
    }

    return out;
  },
};

// ---- P12 to_value ----------------------------------------------------------

const P12_REGEX = new RegExp(
  `\\b(${DIRECTION_UP_VERB}|${DIRECTION_DOWN_VERB}|${DIRECTION_SET_VERB})(?:\\s+(?:it|them|[a-z][a-z\\s-]{0,30}?))?\\s+(?:down\\s+)?to\\s+(?:(?:${APPROX})\\s+)?(?:(${CURRENCY_SYMBOL}))?(${NUM})\\s*(${SUFFIX})?(?:\\s*(${UNIT}))?`,
  'gi',
);

const rule_P12: PatternRule = {
  id: 'P12',
  priority: 13,
  apply: (text, ctx) =>
    scanAllExec(text, P12_REGEX).map((m) => {
      const verb = m[1];
      const currSym = m[2];
      const num = parseNum(m[3]);
      const suffix = m[4];
      const rawUnit = m[5];
      if (!Number.isFinite(num)) return null;
      const direction = directionFromVerb(verb);
      let unit = normaliseUnit(rawUnit);
      if (currSym) unit = normaliseCurrencyUnit(currSym);
      let value = applySuffix(num, suffix);
      if (unit === 'percentage') value = value / 100;
      const hasSuffix = Boolean(suffix);
      return emit(
        m,
        text,
        {
          value,
          operator: 'set',
          direction,
          unit,
          value_origin: hasSuffix ? 'suffix_expansion' : 'literal',
        },
        ctx,
      );
    }).filter(isMatch),
};

// ---- P13 percentage_points -------------------------------------------------

const P13_REGEX = new RegExp(
  `\\b(?:(${DIRECTION_UP_VERB}|${DIRECTION_DOWN_VERB})\\s+by\\s+)?(${NUM})\\s*(?:pp|percentage\\s+points?)\\b`,
  'gi',
);

const rule_P13: PatternRule = {
  id: 'P13',
  priority: 14,
  apply: (text, ctx) =>
    scanAllExec(text, P13_REGEX).map((m) => {
      const verb = m[1];
      const num = parseNum(m[2]);
      if (!Number.isFinite(num)) return null;
      const direction = verb ? directionFromVerb(verb) : null;
      const operator: CqeParameterOperator | null = verb
        ? direction === 'up'
          ? 'increment'
          : direction === 'down'
          ? 'decrement'
          : null
        : null;
      return emit(
        m,
        text,
        {
          value: num,
          unit: 'percentage_points',
          direction: direction === 'set' ? null : direction,
          operator,
          value_origin: 'literal',
        },
        ctx,
      );
    }).filter(isMatch),
};

// ---- rule ordering ---------------------------------------------------------

// Execution order prioritises most-specific rules first so masking claims
// territory before less-specific rules run. This differs from the priority
// numbers in CQE Design v1.1 §4.2 (which describe decision precedence for
// overlapping surface forms). Both produce the same deterministic outcome;
// execution order is chosen to minimise false matches from the catch-all
// rules (P2, P9) after specific ones have consumed their text.
export const PATTERN_RULES: readonly PatternRule[] = Object.freeze([
  rule_P13, // "N pp" / "N percentage points" (most specific suffix)
  rule_P11, // "from X to Y" (requires leading `from`)
  rule_P12, // "(verb) to N" (requires directional verb)
  rule_P1, // "between X and Y"
  rule_P5, // word fractions with directional verb
  rule_P7, // "set X to N"
  rule_P7_continuation, // "...and X to N" after masked P7 clause
  rule_P6, // "(verb) by N%"
  rule_P3, // "at least/most N". Must precede P8 so "under £50k" gets at_most
  rule_P6b, // "(verb) by N [unit]" (no %)
  rule_P8, // currency (£/$/€/GBP/USD/EUR/grand/quid)
  rule_P4, // double/triple/halve
  rule_P2, // generic "X-Y" / "X to Y" range
  rule_P10, // vague quantifiers
  rule_P9, // bare N% (catch-all)
]);
