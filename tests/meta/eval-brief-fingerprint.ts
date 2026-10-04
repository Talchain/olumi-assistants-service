/**
 * ⛔ EVALUATION BRIEFS NEVER REACH A PROMPT — fingerprints and the scanner (shared by the guard and its controls).
 *
 * WHY. #2558 (4 Oct) shipped the records drafting instruction with the SEALED evaluation brief's own figures as worked
 * examples ("each 1% price rise adds £1,200 a month to MRR", "each subscriber costs £6 a month", "do not derive £12,000
 * from £120,000 and 10%"). A model shown the answers makes that brief's draft look right for the wrong reason, and every
 * measurement of it is void.
 *
 * THREAT MODEL: ACCIDENTAL REUSE — a worked example lifted from a brief, a figure restated in other words or units, a
 * prompt assembled from parts. A text guard cannot stop an author set on hiding a brief; blind-written held-out briefs,
 * refreshed per measurement, are the backstop for that.
 *
 * WHAT IS FINGERPRINTED (never the text: a held-out brief must stay unseen by anyone building against this repo). After
 * normalising figures and units ("£ 1,200", "£1 200", "£1,200.00", "£1.2k", "GBP 1200", "1200 pounds" are "£1200";
 * "10 percent" is "10%"; "monthly", "/mo", "pcm" are "per month"):
 *   · NGRAM   every 6-token window (a reused sentence or clause). A shared window counts when it carries a figure; a
 *             figure-free run counts only at 10+ shared tokens in a row ("We are a B2B software company" is common prose);
 *   · BIGRAM  a currency amount of 3+ digits with the token before it, and with the token after it ("adds £1200");
 *   · PAIR    two of the brief's figures (currency, percentages, counts of 3+ digits) within 16 tokens of each other
 *             ("£120000 … 10%"). A pair carrying a currency amount of 4+ digits counts alone; a pair of common figures
 *             ("£49 … 10%") counts only when one of them also shares a content word with the brief's use of it;
 *   · CONTEXT a figure with the content words within 6 tokens of it; ONE use of a figure sharing THREE such words with
 *             the brief's uses of it is the brief's figure ("subscriber costs £6 a month"), unless its own rate ("per",
 *             "a", "each" + a time unit after it) is a different time unit than every use in the brief ("£6 per year";
 *             an incidental "month-end" nearby is not its rate).
 * An ambiguous run of space-separated digits ("£6 150") is read both merged and apart. Each feature is a truncated sha256
 * of normalised tokens, so the fixture carries no brief text.
 *
 * WHAT IS SCANNED is decided by the guard; this module turns a source into the texts a model could read: every string
 * and template literal of a script source, with `+` chains, `.concat()`, joined string arrays, template substitutions,
 * object members and the source's own unchanged bindings (a `const`, a never-reassigned `let`, an array built by `.push`)
 * folded into one text, each name resolved in its own lexical scope (a prompt assembled from parts still reads as one
 * prompt), and comments skipped (they never reach a model).
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
/** A figure-free shared run counts from this many tokens (5 consecutive 6-token windows). */
const NGRAM_PROSE_RUN = 10;
const TIME_UNITS = ['hour', 'day', 'week', 'month', 'quarter', 'year'] as const;
const hash = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 20);

const CURRENCY_WORD: Record<string, string> = { gbp: '£', usd: '$', eur: '€', pound: '£', pounds: '£', sterling: '£', quid: '£',
  dollar: '$', dollars: '$', euro: '€', euros: '€' };
/**
 * Units and currency words in one spelling: "monthly" / "/mo" / "pcm" → "per month"; "GBP 6" / "GBP  6" / "6 GBP" /
 * "6 pounds" → "£6"; "10 percent" → "10%".
 */
function canonicalUnits(text: string): string {
  return text
    .replace(/\b(gbp|usd|eur)\s*(?=\d)/gi, (_m, c: string) => CURRENCY_WORD[c.toLowerCase()]!)
    .replace(/(\d[\d,.]*)\s*(gbp|usd|eur|pounds?(?:\s+sterling)?|sterling|quid|dollars?|euros?)\b/gi,
      (_m, n: string, c: string) => `${CURRENCY_WORD[c.toLowerCase().split(/\s+/)[0]!]!}${n}`)
    .replace(/(\d)\s*(?:per\s?cent|pct)\b/gi, '$1%')
    .replace(/\s*\/\s*(?:mo|mth|month)\b|\b(?:monthly|pcm|p\/m)\b/gi, ' per month')
    .replace(/\s*\/\s*(?:yr|year)\b|\b(?:yearly|annually|p\.a\.)/gi, ' per year')
    .replace(/\s*\/\s*(?:wk|week)\b|\bweekly\b/gi, ' per week')
    .replace(/\s*\/\s*day\b|\bdaily\b/gi, ' per day');
}

/** "£ 1,200" / "£1,200.00" / "£1.2k" → "£1200"; "10 %" → "10%". `mergeSpaced` also reads "£1 200" as one figure. */
function canonicalFigures(text: string, mergeSpaced: boolean): string {
  const grouped = mergeSpaced ? /(\d)[,\u00a0\u2009\u202f ](?=\d{3}(?!\d))/g : /(\d)[,\u00a0\u2009\u202f](?=\d{3}(?!\d))/g;
  return text
    .replace(/([£$€])\s+(?=\d)/g, '$1')
    .replace(/(\d)\s+%/g, '$1%')
    .replace(grouped, '$1')
    .replace(/(\d)\.0+(?!\d)/g, '$1')
    // A magnitude suffix only on a currency amount, attached ("£1.2k", "£3m", "$2bn"); "6 m of cable" is a length.
    .replace(/([£$€])(\d+(?:\.\d+)?)(k|m|bn)\b/gi, (_m, c: string, n: string, k: string) =>
      `${c}${Math.round(Number(n) * ({ k: 1e3, m: 1e6, bn: 1e9 } as Record<string, number>)[k.toLowerCase()]!)}`);
}

const tokenize = (text: string): string[] => text.toLowerCase()
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u2010-\u2015]/g, '-')
  // A word may carry digits ("b2b", "mp3"); a figure is digits alone.
  .match(/[£$€]?\d+(?:\.\d+)?%?(?![a-z])|[a-z0-9]*[a-z][a-z0-9]*(?:'[a-z]+)?/g) ?? [];

/** The token readings of a text: one, or two when space-separated digits could be one figure or two. */
export function tokenReadings(text: string): string[][] {
  const base = canonicalUnits(text.normalize('NFKC'));
  const merged = tokenize(canonicalFigures(base, true));
  const apart = tokenize(canonicalFigures(base, false));
  return merged.join(' ') === apart.join(' ') ? [merged] : [merged, apart];
}
export const tokensOf = (text: string): string[] => tokenReadings(text)[0]!;

const isFigure = (t: string): boolean => /^[£$€]?\d+(?:\.\d+)?%?$/.test(t);
const isCurrency = (t: string): boolean => /^[£$€]/.test(t);
const digits = (t: string): number => (t.replace(/\..*$/, '').match(/\d/g) ?? []).length;
/** A figure worth fingerprinting in context: any currency amount, any percentage, a count of 10+. */
const isDistinctive = (t: string): boolean => isFigure(t) && (isCurrency(t) || t.endsWith('%') || digits(t) >= 2);
/** A figure that identifies a brief beside another: any currency amount, any percentage, a count of 3+ digits. */
const isPairable = (t: string): boolean => isFigure(t) && (isCurrency(t) || t.endsWith('%') || digits(t) >= 3);
/** A figure distinctive enough that a pair carrying it counts on its own. */
const isStrong = (t: string): boolean => isCurrency(t) && digits(t) >= 4;
const STOP = new Set(('a an the of to in on at by for from with and or nor but is are was were be been being it its as that this these '
  + 'those each every per about would will could should can may might than then there their they them we our you your he she his her '
  + 'not no do does did done has have had if so such into onto over under up down out off any all some more most less few very just '
  + 'also only what which who whom whose when where why how one two').split(' '));
const isContentWord = (t: string): boolean => !isFigure(t) && t.length >= 3 && !STOP.has(t);
const RATE_MARKERS = new Set(['per', 'a', 'an', 'each', 'every']);

/** Each feature with the candidate's own words beside it (for a failure message; never the brief's). */
interface Feature { readonly hash: string; readonly said: string }
interface Window extends Feature { readonly figure: boolean }
/** A figure with the content words around it and the time units it is stated per ("£6 a month" → month). */
interface Use { readonly fig: string; readonly words: string[]; readonly rates: string[] }
interface Features { ngrams: Window[]; bigrams: Feature[]; pairs: { hash: string; said: string; a: Use; b: Use }[]; uses: Use[] }

function featuresOfTokens(t: string[]): Features {
  const ngrams: Window[] = [];
  for (let i = 0; i + WINDOW <= t.length; i += 1) {
    const said = t.slice(i, i + WINDOW).join(' ');
    ngrams.push({ hash: hash(said), said, figure: t.slice(i, i + WINDOW).some(isFigure) });
  }
  const bigrams: Feature[] = [];
  const useAt = new Map<number, Use>();
  t.forEach((tok, i) => {
    if (isCurrency(tok) && digits(tok) >= 3) {
      if (i > 0) bigrams.push({ hash: hash(`${t[i - 1]} ${tok}`), said: `${t[i - 1]} ${tok}` });
      if (i + 1 < t.length) bigrams.push({ hash: hash(`${tok} ${t[i + 1]}`), said: `${tok} ${t[i + 1]}` });
    }
    if (!isDistinctive(tok)) return;
    const words = new Set<string>();
    for (let j = Math.max(0, i - CONTEXT_SPAN); j < Math.min(t.length, i + CONTEXT_SPAN + 1); j += 1) {
      if (j !== i && isContentWord(t[j]!)) words.add(t[j]!);
    }
    // Its rate: a time unit right after it, introduced as one ("£6 a month", "£6 per subscriber per month").
    const rates: string[] = [];
    for (let j = i + 1; j < Math.min(t.length, i + CONTEXT_SPAN); j += 1) {
      if (isFigure(t[j]!)) break;
      if ((TIME_UNITS as readonly string[]).includes(t[j]!) && RATE_MARKERS.has(t[j - 1]!)) rates.push(t[j]!);
    }
    useAt.set(i, { fig: tok, words: [...words], rates });
  });
  const pairs: Features['pairs'] = [];
  t.forEach((tok, i) => {
    if (!isPairable(tok)) return;
    for (let j = i + 1; j < t.length && j <= i + PAIR_SPAN; j += 1) {
      if (isPairable(t[j]!) && t[j] !== tok) {
        const said = [tok, t[j]!].sort().join(' | ');
        pairs.push({ hash: hash(said), said, a: useAt.get(i)!, b: useAt.get(j)! });
      }
    }
  });
  return { ngrams, bigrams, pairs, uses: [...useAt.values()] };
}

const contextHash = (fig: string, word: string): string => hash(`${fig} ~ ${word}`);

export function fingerprintBrief(id: string, source: string, text: string): BriefFingerprint {
  const all = tokenReadings(text).map(featuresOfTokens);
  const uniq = (xs: string[]): string[] => [...new Set(xs)].sort();
  return {
    id, source,
    ngrams: uniq(all.flatMap((f) => f.ngrams.map((x) => x.hash))),
    bigrams: uniq(all.flatMap((f) => f.bigrams.map((x) => x.hash))),
    pairs: uniq(all.flatMap((f) => f.pairs.map((x) => x.hash))),
    contexts: uniq(all.flatMap((f) => f.uses.flatMap((u) => u.words.map((w) => contextHash(u.fig, w))))),
  };
}

/** Every way `text` reuses one of the briefs (empty when it reuses none). */
export function scanText(text: string, briefs: readonly BriefFingerprint[]): FingerprintHit[] {
  return explainText(text, briefs).map(({ brief, kind }) => ({ brief, kind }));
}

/** As `scanText`, with the text's OWN matching words (never the brief's) for a failure message. */
export function explainText(text: string, briefs: readonly BriefFingerprint[]): (FingerprintHit & { said: string })[] {
  const hits: (FingerprintHit & { said: string })[] = [];
  const readings = tokenReadings(text).map(featuresOfTokens);
  for (const b of briefs) {
    const known = new Set(b.contexts);
    const shared = (u: Use): string[] => u.words.filter((w) => known.has(contextHash(u.fig, w)));
    /** The time units the brief states this figure per (read from its context hashes over the unit vocabulary). */
    const briefUnits = (fig: string): string[] => TIME_UNITS.filter((w) => known.has(contextHash(fig, w)));
    const unitsAgree = (u: Use): boolean => {
      const theirs = briefUnits(u.fig);
      return u.rates.length === 0 || theirs.length === 0 || u.rates.some((w) => theirs.includes(w));
    };
    const found = new Map<HitKind, string>();
    for (const f of readings) {
      const first = (set: readonly string[], xs: Feature[]): Feature | undefined => { const s = new Set(set); return xs.find((x) => s.has(x.hash)); };
      const ngramSet = new Set(b.ngrams);
      const shares = f.ngrams.map((w) => ngramSet.has(w.hash));
      const proseRun = (i: number): boolean => shares.slice(i, i + NGRAM_PROSE_RUN - WINDOW + 1).length === NGRAM_PROSE_RUN - WINDOW + 1
        && shares.slice(i, i + NGRAM_PROSE_RUN - WINDOW + 1).every(Boolean);
      const ngram = f.ngrams.find((w, i) => shares[i] && (w.figure || proseRun(i)));
      if (ngram !== undefined && !found.has('ngram')) found.set('ngram', ngram.said);
      const bigram = first(b.bigrams, f.bigrams);
      if (bigram !== undefined && !found.has('bigram')) found.set('bigram', bigram.said);
      const pairSet = new Set(b.pairs);
      const pair = f.pairs.find((p) => pairSet.has(p.hash)
        && (isStrong(p.a.fig) || isStrong(p.b.fig) || shared(p.a).length >= 1 || shared(p.b).length >= 1));
      if (pair !== undefined && !found.has('pair')) found.set('pair', pair.said);
      const use = f.uses.find((u) => shared(u).length >= CONTEXT_MIN_SHARED && unitsAgree(u));
      if (use !== undefined && !found.has('context')) found.set('context', `${use.fig}: ${shared(use).join(', ')}`);
    }
    for (const [kind, said] of found) hits.push({ brief: b.id, kind, said });
  }
  return hits;
}

type Static = { readonly kind: 'str'; readonly value: string } | { readonly kind: 'num'; readonly value: number }
  | { readonly kind: 'arr'; readonly value: readonly string[] } | { readonly kind: 'obj'; readonly value: ReadonlyMap<string, Static> };
const asText = (v: Static | undefined): string | undefined =>
  v === undefined || v.kind === 'obj' ? undefined : v.kind === 'arr' ? v.value.join(',') : String(v.value);

/** One name bound in one scope: its initializer, whether it stays unchanged, and what `.push` adds to it. */
interface Binding { readonly init: ts.Expression | undefined; readonly opaque: boolean; reassigned: boolean; readonly pushes: ts.Expression[] }

const isScope = (n: ts.Node): boolean => ts.isSourceFile(n) || ts.isBlock(n) || ts.isModuleBlock(n) || ts.isCaseBlock(n)
  || ts.isFunctionLike(n) || ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isCatchClause(n)
  || ts.isClassLike(n);
const scopeOf = (n: ts.Node): ts.Node => {
  let p: ts.Node | undefined = n.parent;
  while (p !== undefined && !isScope(p)) p = p.parent;
  return p ?? n.getSourceFile();
};
const ASSIGNMENTS = new Set([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken]);

/**
 * The static values of a source's bindings, each name resolved in its own lexical scope: a `const`, or a `let` never
 * reassigned, with the arguments of every `.push` on it appended in source order. Parameters, `var`s and reassigned
 * bindings are opaque, and still shadow an outer name of the same spelling.
 */
class Bindings {
  private readonly scopes = new Map<ts.Node, Map<string, Binding>>();
  private readonly values = new Map<Binding, Static | undefined>();
  private readonly evaluating = new Set<Binding>();

  constructor(sf: ts.SourceFile) {
    const declare = (name: ts.BindingName, scope: ts.Node, b: Binding): void => {
      if (!ts.isIdentifier(name)) return; // destructuring: nothing static to fold
      const names = this.scopes.get(scope) ?? new Map<string, Binding>();
      this.scopes.set(scope, names);
      if (!names.has(name.text)) names.set(name.text, b);
    };
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n)) {
        const flags = ts.isVariableDeclarationList(n.parent) ? n.parent.flags : 0;
        const immutable = (flags & ts.NodeFlags.Const) !== 0 || (flags & ts.NodeFlags.Let) !== 0;
        declare(n.name, scopeOf(n), { init: n.initializer, opaque: !immutable, reassigned: false, pushes: [] });
      } else if (ts.isParameter(n)) {
        declare(n.name, n.parent, { init: undefined, opaque: true, reassigned: false, pushes: [] });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    const mark = (n: ts.Node): void => {
      if (ts.isBinaryExpression(n) && ASSIGNMENTS.has(n.operatorToken.kind) && ts.isIdentifier(n.left)) {
        const b = this.bindingOf(n.left);
        if (b !== undefined) b.reassigned = true;
      } else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && ts.isIdentifier(n.operand)
        && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) {
        const b = this.bindingOf(n.operand);
        if (b !== undefined) b.reassigned = true;
      } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'push'
        && ts.isIdentifier(n.expression.expression)) {
        this.bindingOf(n.expression.expression)?.pushes.push(...n.arguments);
      }
      ts.forEachChild(n, mark);
    };
    mark(sf);
  }

  /** The binding a name refers to: the nearest enclosing scope that declares it. */
  bindingOf(id: ts.Identifier): Binding | undefined {
    for (let n: ts.Node | undefined = id.parent; n !== undefined; n = n.parent) {
      const b = this.scopes.get(n)?.get(id.text);
      if (b !== undefined) return b;
    }
    return undefined;
  }

  valueOf(id: ts.Identifier): Static | undefined {
    const b = this.bindingOf(id);
    if (b === undefined || b.opaque || b.reassigned || b.init === undefined || this.evaluating.has(b)) return undefined;
    if (this.values.has(b)) return this.values.get(b);
    this.evaluating.add(b);
    let v = staticOf(b.init, this);
    if (b.pushes.length > 0) {
      v = v?.kind === 'arr' ? { kind: 'arr', value: [...v.value, ...b.pushes.map((a) => asText(staticOf(a, this)) ?? ' ')] } : undefined;
    }
    this.evaluating.delete(b);
    this.values.set(b, v);
    return v;
  }

  /** The value of the first binding of `name` anywhere in the source (the BRIEF constant of a test file). */
  valueOfName(sf: ts.SourceFile, name: string): Static | undefined {
    let found: ts.Identifier | undefined;
    const visit = (n: ts.Node): void => {
      if (found === undefined && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) found = n.name;
      if (found === undefined) ts.forEachChild(n, visit);
    };
    visit(sf);
    return found === undefined ? undefined : this.valueOf(found);
  }
}

const memberName = (n: ts.PropertyName): string | undefined =>
  ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isPrivateIdentifier(n) ? n.text : undefined;

/** The static value of an expression a prompt can be assembled from, resolving names through the source's bindings. */
function staticOf(e: ts.Expression, bindings: Bindings, depth = 0): Static | undefined {
  if (depth > 50) return undefined;
  const of = (x: ts.Expression): Static | undefined => staticOf(x, bindings, depth + 1);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { kind: 'str', value: e.text };
  if (ts.isNumericLiteral(e)) return { kind: 'num', value: Number(e.text) };
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) return of(e.expression);
  if (ts.isIdentifier(e)) return bindings.valueOf(e);
  if (ts.isArrayLiteralExpression(e)) {
    const parts = e.elements.map((x) => asText(of(x as ts.Expression)));
    // An empty array is static too: `.push` fills it.
    return parts.length === 0 || parts.some((p) => p !== undefined) ? { kind: 'arr', value: parts.map((p) => p ?? ' ') } : undefined;
  }
  if (ts.isObjectLiteralExpression(e)) {
    const members = new Map<string, Static>();
    for (const p of e.properties) {
      const name = p.name === undefined ? undefined : memberName(p.name);
      const v = ts.isPropertyAssignment(p) ? of(p.initializer) : ts.isShorthandPropertyAssignment(p) ? bindings.valueOf(p.name) : undefined;
      if (name !== undefined && v !== undefined) members.set(name, v);
    }
    return members.size > 0 ? { kind: 'obj', value: members } : undefined;
  }
  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
    const target = of(e.expression);
    const name = ts.isPropertyAccessExpression(e) ? e.name.text
      : ts.isStringLiteral(e.argumentExpression) || ts.isNumericLiteral(e.argumentExpression) ? e.argumentExpression.text : undefined;
    if (target?.kind === 'obj' && name !== undefined) return target.value.get(name);
    if (target?.kind === 'arr' && name !== undefined && /^\d+$/.test(name)) {
      const v = target.value[Number(name)];
      return v === undefined ? undefined : { kind: 'str', value: v };
    }
    return undefined;
  }
  if (ts.isTemplateExpression(e)) {
    // A substitution that is itself static (a number, a constant) is folded in; anything else is a word break.
    return { kind: 'str', value: [e.head.text, ...e.templateSpans.map((s) => `${asText(of(s.expression)) ?? ' '}${s.literal.text}`)].join('') };
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = of(e.left);
    const r = of(e.right);
    if (l?.kind === 'num' && r?.kind === 'num') return { kind: 'num', value: l.value + r.value };
    return l === undefined && r === undefined ? undefined : { kind: 'str', value: `${asText(l) ?? ' '}${asText(r) ?? ' '}` };
  }
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const target = of(e.expression.expression);
    const name = e.expression.name.text;
    const args = e.arguments.map((a) => of(a));
    if (name === 'join' && target?.kind === 'arr') {
      const sep = e.arguments.length > 0 ? asText(args[0]) ?? ' ' : ',';
      return { kind: 'str', value: target.value.join(sep) };
    }
    if (name === 'concat' && target !== undefined && target.kind !== 'obj') {
      if (target.kind === 'arr') return { kind: 'arr', value: [...target.value, ...args.flatMap((a) => (a?.kind === 'arr' ? a.value : [asText(a) ?? ' ']))] };
      return { kind: 'str', value: [asText(target) ?? ' ', ...args.map((a) => asText(a) ?? ' ')].join('') };
    }
  }
  return undefined;
}

/**
 * The texts a model could read from a script source, with 1-based lines: each literal, and each assembled expression
 * (a `+` chain, a template, `.join`/`.concat`, a member read off an assembled object) as one text. Comments are never
 * read.
 */
export function literalsOf(fileName: string, source: string): { line: number; text: string }[] {
  // Parent links on: a `+` chain is read once, at its top, and names resolve through their enclosing scopes.
  const kind = /\.(m|c)?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const bindings = new Bindings(sf);
  const out: { line: number; text: string }[] = [];
  const at = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const isPlus = (n: ts.Node): boolean => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken;
  const assembled = (n: ts.Node): boolean => ts.isTemplateExpression(n)
    || (isPlus(n) && !isPlus(n.parent))
    || (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['join', 'concat'].includes(n.expression.name.text));
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push({ line: at(n), text: n.text });
    else if (assembled(n)) {
      const text = asText(staticOf(n as ts.Expression, bindings));
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
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return asText(new Bindings(sf).valueOfName(sf, name));
}
