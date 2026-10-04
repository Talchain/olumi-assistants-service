/**
 * ⛔ EVALUATION BRIEFS NEVER REACH A PROMPT — fingerprints and the scanner (shared by the guard and its controls).
 *
 * WHY. #2558 (4 Oct) shipped the records drafting instruction with the SEALED evaluation brief's own figures as worked
 * examples ("each 1% price rise adds £1,200 a month to MRR", "each subscriber costs £6 a month", "do not derive £12,000
 * from £120,000 and 10%"). A model shown the answers makes that brief's draft look right for the wrong reason, and every
 * measurement of it is void.
 *
 * WHAT IS FINGERPRINTED (never the text: a held-out brief must stay unseen by anyone building against this repo). After
 * canonicalising figures ("£ 1,200", "£1 200", "£1,200.00", "£1.2k" are all "£1200"):
 *   · NGRAM   every 6-token window (a reused sentence or clause);
 *   · BIGRAM  a currency amount of 3+ digits with the token before it, and with the token after it ("adds £1200");
 *   · PAIR    two of the brief's figures (currency, percentages, counts of 3+ digits) within 16 tokens of each other
 *             ("£120000 … 10%", "1% … £1200");
 *   · CONTEXT a figure with the content words within 6 tokens of it; ONE use of a figure that shares THREE such words
 *             with the brief's uses of it is the brief's figure ("subscriber costs £6 a month"); fewer is not ("400 pro
 *             customers with a 3% monthly churn rate", "costs about £6 a week").
 * Each feature is a truncated sha256 of normalised tokens, so the fixture carries no brief text.
 *
 * WHAT IS SCANNED is decided by the guard; this module turns a source into the texts a model could read: every string
 * and template literal of a TypeScript file, with `+` chains, string arrays and template substitutions folded into one
 * text (a literal split in two still reads as one prompt), and comments skipped (they never reach a model).
 */
import { createHash } from 'node:crypto';
import ts from 'typescript';

export interface BriefFingerprint {
  readonly id: string;
  readonly source: string;
  readonly ngrams: readonly string[];
  readonly bigrams: readonly string[];
  readonly pairs: readonly string[];
  readonly contexts: readonly string[];
}

export type HitKind = 'ngram' | 'bigram' | 'pair' | 'context';
export interface FingerprintHit { readonly brief: string; readonly kind: HitKind }

const WINDOW = 6;
const PAIR_SPAN = 16;
const CONTEXT_SPAN = 6;
const CONTEXT_MIN_SHARED = 3;
const hash = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 20);

/** "£ 1,200" / "£1 200" / "£1,200.00" / "£1.2k" → "£1200"; "10 %" → "10%". */
function canonicalFigures(text: string): string {
  return text
    .replace(/([£$€])\s+(?=\d)/g, '$1')
    .replace(/(\d)\s+%/g, '$1%')
    .replace(/(\d)[,\u00a0\u2009\u202f ](?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d)\.0+(?!\d)/g, '$1')
    .replace(/(\d+(?:\.\d+)?)\s?([km])\b/gi, (_m, n: string, k: string) => String(Math.round(Number(n) * (k.toLowerCase() === 'k' ? 1e3 : 1e6))));
}

/** Lowercase words and canonical figures; dashes and quotes folded. */
export function tokensOf(text: string): string[] {
  return canonicalFigures(text.normalize('NFKC'))
    .toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[‐-―]/g, '-')
    // A word may carry digits ("b2b", "mp3"); a figure is digits alone.
    .match(/[£$€]?\d+(?:\.\d+)?%?(?![a-z])|[a-z0-9]*[a-z][a-z0-9]*(?:'[a-z]+)?/g) ?? [];
}

const isFigure = (t: string): boolean => /^[£$€]?\d+(?:\.\d+)?%?$/.test(t);
const isCurrency = (t: string): boolean => /^[£$€]/.test(t);
const digits = (t: string): number => (t.replace(/\..*$/, '').match(/\d/g) ?? []).length;
/** A figure worth fingerprinting in context: any currency amount, any percentage, a count of 10+. */
const isDistinctive = (t: string): boolean => isFigure(t) && (isCurrency(t) || t.endsWith('%') || digits(t) >= 2);
/** A figure that identifies a brief beside another: any currency amount, any percentage, a count of 3+ digits. */
const isPairable = (t: string): boolean => isFigure(t) && (isCurrency(t) || t.endsWith('%') || digits(t) >= 3);
const STOP = new Set(('a an the of to in on at by for from with and or nor but is are was were be been being it its as that this these '
  + 'those each every per about would will could should can may might than then there their they them we our you your he she his her '
  + 'not no do does did done has have had if so such into onto over under up down out off any all some more most less few very just '
  + 'also only what which who whom whose when where why how one two').split(' '));
const isContentWord = (t: string): boolean => !isFigure(t) && t.length >= 3 && !STOP.has(t);

/** Each feature with the candidate's own words beside it (for a failure message; never the brief's). */
interface Feature { readonly hash: string; readonly said: string }
interface Features { ngrams: Feature[]; bigrams: Feature[]; pairs: Feature[]; uses: { fig: string; words: string[] }[] }

function featuresOf(text: string): Features {
  const t = tokensOf(text);
  const ngrams: Feature[] = [];
  for (let i = 0; i + WINDOW <= t.length; i += 1) {
    const said = t.slice(i, i + WINDOW).join(' ');
    ngrams.push({ hash: hash(said), said });
  }
  const bigrams: Feature[] = [];
  const pairs: Feature[] = [];
  const uses: { fig: string; words: string[] }[] = [];
  t.forEach((tok, i) => {
    if (isCurrency(tok) && digits(tok) >= 3) {
      if (i > 0) bigrams.push({ hash: hash(`${t[i - 1]} ${tok}`), said: `${t[i - 1]} ${tok}` });
      if (i + 1 < t.length) bigrams.push({ hash: hash(`${tok} ${t[i + 1]}`), said: `${tok} ${t[i + 1]}` });
    }
    if (isPairable(tok)) {
      for (let j = i + 1; j < t.length && j <= i + PAIR_SPAN; j += 1) {
        if (isPairable(t[j]!) && t[j] !== tok) {
          const said = [tok, t[j]!].sort().join(' | ');
          pairs.push({ hash: hash(said), said });
        }
      }
    }
    if (!isDistinctive(tok)) return;
    const words = new Set<string>();
    for (let j = Math.max(0, i - CONTEXT_SPAN); j < Math.min(t.length, i + CONTEXT_SPAN + 1); j += 1) {
      if (j !== i && isContentWord(t[j]!)) words.add(t[j]!);
    }
    uses.push({ fig: tok, words: [...words] });
  });
  return { ngrams, bigrams, pairs, uses };
}

const contextHash = (fig: string, word: string): string => hash(`${fig} ~ ${word}`);

export function fingerprintBrief(id: string, source: string, text: string): BriefFingerprint {
  const f = featuresOf(text);
  const uniq = (xs: string[]): string[] => [...new Set(xs)].sort();
  return { id, source, ngrams: uniq(f.ngrams.map((x) => x.hash)), bigrams: uniq(f.bigrams.map((x) => x.hash)),
    pairs: uniq(f.pairs.map((x) => x.hash)), contexts: uniq(f.uses.flatMap((u) => u.words.map((w) => contextHash(u.fig, w)))) };
}

/** Every way `text` reuses one of the briefs (empty when it reuses none), with the text's own matching words. */
export function scanText(text: string, briefs: readonly BriefFingerprint[]): FingerprintHit[] {
  return explainText(text, briefs).map(({ brief, kind }) => ({ brief, kind }));
}

export function explainText(text: string, briefs: readonly BriefFingerprint[]): (FingerprintHit & { said: string })[] {
  const f = featuresOf(text);
  const hits: (FingerprintHit & { said: string })[] = [];
  for (const b of briefs) {
    const first = (set: readonly string[], xs: Feature[]): Feature | undefined => { const s = new Set(set); return xs.find((x) => s.has(x.hash)); };
    const ngram = first(b.ngrams, f.ngrams);
    if (ngram !== undefined) hits.push({ brief: b.id, kind: 'ngram', said: ngram.said });
    const bigram = first(b.bigrams, f.bigrams);
    if (bigram !== undefined) hits.push({ brief: b.id, kind: 'bigram', said: bigram.said });
    const pair = first(b.pairs, f.pairs);
    if (pair !== undefined) hits.push({ brief: b.id, kind: 'pair', said: pair.said });
    const known = new Set(b.contexts);
    for (const u of f.uses) {
      const shared = u.words.filter((w) => known.has(contextHash(u.fig, w)));
      if (shared.length >= CONTEXT_MIN_SHARED) { hits.push({ brief: b.id, kind: 'context', said: `${u.fig}: ${shared.join(', ')}` }); break; }
    }
  }
  return hits;
}

/** The static text of an expression a prompt can be assembled from (literals, `+` chains, templates, string arrays). */
function staticTextOf(e: ts.Expression): string | undefined {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return e.text;
  if (ts.isParenthesizedExpression(e)) return staticTextOf(e.expression);
  if (ts.isTemplateExpression(e)) {
    // A substitution that is itself static (a number, a literal) is folded in; anything else is a word break.
    return [e.head.text, ...e.templateSpans.map((s) => `${staticTextOf(s.expression) ?? ' '}${s.literal.text}`)].join('');
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = staticTextOf(e.left);
    const r = staticTextOf(e.right);
    return l === undefined && r === undefined ? undefined : `${l ?? ' '}${r ?? ' '}`;
  }
  // [..].join(sep): an array of static parts joined into one prompt.
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === 'join'
    && ts.isArrayLiteralExpression(e.expression.expression)) {
    const sep = e.arguments[0] !== undefined ? staticTextOf(e.arguments[0]) ?? ' ' : ',';
    const parts = e.expression.expression.elements.map((x) => staticTextOf(x as ts.Expression));
    return parts.some((p) => p !== undefined) ? parts.map((p) => p ?? ' ').join(sep) : undefined;
  }
  return undefined;
}

/**
 * The texts a model could read from a TypeScript source, with 1-based lines: each literal, and each assembled
 * expression (a `+` chain, a template, a joined string array) as one text. Comments are never read.
 */
export function literalsOf(fileName: string, source: string): { line: number; text: string }[] {
  // Parent links on: a `+` chain is read once, at its top.
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const at = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const assembled = (n: ts.Node): boolean => ts.isTemplateExpression(n)
    || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken
      && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken))
    || (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'join'
      && ts.isArrayLiteralExpression(n.expression.expression));
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push({ line: at(n), text: n.text });
    else if (assembled(n)) {
      const text = staticTextOf(n as ts.Expression);
      if (text !== undefined) out.push({ line: at(n), text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every string value in a JSON document (a structured prompt store), as one text per value. */
export function jsonStringsOf(source: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(JSON.parse(source));
  return out;
}

/** The BRIEF constant's text from a TypeScript source (the sealed brief is a test constant, deliberately unexported). */
export function briefConstantOf(fileName: string, source: string, name = 'BRIEF'): string | undefined {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  let found: string | undefined;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer !== undefined) {
      found = staticTextOf(n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}
