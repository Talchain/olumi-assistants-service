/**
 * ⛔ EVALUATION BRIEFS NEVER REACH A PROMPT — fingerprints and the scanner (shared by the guard and its controls).
 *
 * WHY. #2558 (4 Oct) shipped the records drafting instruction with the SEALED evaluation brief's own figures as worked
 * examples ("each 1% price rise adds £1,200 a month to MRR", "£6 a month", "£12,000 from £120,000 and 10%"). A model
 * shown the answers makes that brief's draft look right for the wrong reason, and every measurement of it is void.
 *
 * WHAT IS FINGERPRINTED (never the text: a held-out brief must stay unseen by anyone building against this repo):
 *   · every 6-token window of the brief (a reused sentence or clause);
 *   · every figure of 3+ digits (currency or count) with the token before it, and with the token after it
 *     ("adds £1,200", "£120,000 monthly", "400 customers");
 *   · every other figure (any currency amount, any percentage, a count of 10+) with BOTH neighbours ("about £6 a",
 *     "by 10% launch").
 * A bare round figure is not evidence on its own: "£12,000" and "by 10%" recur in generic examples written before a
 * brief existed. Each feature is a truncated sha256 of the normalised tokens, so the fixture carries no brief text.
 *
 * WHAT IS SCANNED: the text a model can read — every string and template literal of non-test TypeScript under `src/`
 * (comments never reach a model, so they are not read) and every prompt text file (`Prompts/`, `src/prompts/`,
 * `tools/prompts/`, `tools/graph-evaluator/prompts/`, the conversation-harness prompt candidates).
 */
import { createHash } from 'node:crypto';
import ts from 'typescript';

export interface BriefFingerprint {
  readonly id: string;
  readonly source: string;
  readonly ngrams: readonly string[];
  readonly bigrams: readonly string[];
  readonly trigrams: readonly string[];
}

export interface FingerprintHit { readonly brief: string; readonly kind: 'ngram' | 'bigram' | 'trigram' }

const WINDOW = 6;
const hash = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 20);

/** Lowercase words and figures; "£1,200" → "£1200", "10 %" stays two tokens, dashes and quotes folded. */
export function tokensOf(text: string): string[] {
  return text.normalize('NFKC').toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[‐-―]/g, '-')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .match(/[£$€]?\d+(?:\.\d+)?%?|[a-z]+(?:'[a-z]+)?/g) ?? [];
}

const isFigure = (t: string): boolean => /^[£$€]?\d+(?:\.\d+)?%?$/.test(t);
const isCurrency = (t: string): boolean => /^[£$€]/.test(t);
const digits = (t: string): number => (t.replace(/\..*$/, '').match(/\d/g) ?? []).length;
/** Distinctive with ONE neighbour: a currency amount or a count of 3+ digits (never a percentage). */
const isLargeFigure = (t: string): boolean => isFigure(t) && !t.endsWith('%') && digits(t) >= 3;
/** Distinctive with BOTH neighbours: any currency amount, any percentage, a count of 10+. */
const isFigureInContext = (t: string): boolean => isFigure(t) && (isCurrency(t) || t.endsWith('%') || digits(t) >= 2);

function featuresOf(text: string): { ngrams: string[]; bigrams: string[]; trigrams: string[] } {
  const t = tokensOf(text);
  const ngrams: string[] = [];
  for (let i = 0; i + WINDOW <= t.length; i += 1) ngrams.push(hash(t.slice(i, i + WINDOW).join(' ')));
  const bigrams: string[] = [];
  const trigrams: string[] = [];
  t.forEach((tok, i) => {
    if (isLargeFigure(tok)) {
      if (i > 0) bigrams.push(hash(`${t[i - 1]} ${tok}`));
      if (i + 1 < t.length) bigrams.push(hash(`${tok} ${t[i + 1]}`));
    }
    if (isFigureInContext(tok) && i > 0 && i + 1 < t.length) trigrams.push(hash(`${t[i - 1]} ${tok} ${t[i + 1]}`));
  });
  return { ngrams, bigrams, trigrams };
}

export function fingerprintBrief(id: string, source: string, text: string): BriefFingerprint {
  const f = featuresOf(text);
  const uniq = (xs: string[]): string[] => [...new Set(xs)].sort();
  return { id, source, ngrams: uniq(f.ngrams), bigrams: uniq(f.bigrams), trigrams: uniq(f.trigrams) };
}

/** Every way `text` reuses one of the briefs (empty when it reuses none). */
export function scanText(text: string, briefs: readonly BriefFingerprint[]): FingerprintHit[] {
  const f = featuresOf(text);
  const hits: FingerprintHit[] = [];
  for (const b of briefs) {
    const has = (set: readonly string[], xs: string[]): boolean => { const s = new Set(set); return xs.some((x) => s.has(x)); };
    if (has(b.ngrams, f.ngrams)) hits.push({ brief: b.id, kind: 'ngram' });
    if (has(b.bigrams, f.bigrams)) hits.push({ brief: b.id, kind: 'bigram' });
    if (has(b.trigrams, f.trigrams)) hits.push({ brief: b.id, kind: 'trigram' });
  }
  return hits;
}

/** The text of every string and template literal in a TypeScript source, with its 1-based line. Comments are skipped. */
export function literalsOf(fileName: string, source: string): { line: number; text: string }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const at = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push({ line: at(n), text: n.text });
    else if (ts.isTemplateExpression(n)) {
      out.push({ line: at(n), text: [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ') });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The BRIEF constant's text from a TypeScript source (the sealed brief is a test constant, deliberately unexported). */
export function briefConstantOf(fileName: string, source: string, name = 'BRIEF'): string | undefined {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  let found: string | undefined;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer !== undefined) {
      const parts: string[] = [];
      const collect = (e: ts.Node): void => {
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) parts.push(e.text);
        else ts.forEachChild(e, collect);
      };
      collect(n.initializer);
      found = parts.join('');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}
