/**
 * PREDICATE CORPUS COMPLETENESS HARNESS (standalone, deterministic, no vitest).
 *
 * WHY AST AND NOT REGEX. The prior lane's extractor was wrong twice - a name
 * regex dropped lowercase-named arrays, and its matcher missed the
 * `expect(fn(m), 'msg').toBe(...)` two-argument form. Both are impossible to
 * miss when the source is parsed rather than scraped.
 *
 * WHAT MAKES IT FAIL LOUD. Every syntactic reference to either predicate, in
 * every file that mentions it, must be RESOLVED into concrete (input, expected)
 * cases or classified into a named non-case bucket. Anything left over is
 * UNRESOLVED and the harness exits non-zero. A corpus that cannot account for a
 * reference cannot certify the code over it.
 *
 * ITS OWN TWO BUGS, BOTH CAUGHT BY THE ASSERTIONS AND NOT BY INSPECTION:
 *   1. a FLAT name->array map let a file-level `CANDIDATES` shadow the
 *      `CANDIDATES` declared inside an `it()` body, so 11 cases were scored
 *      against the wrong expectation list. Fixed by proper LEXICAL scoping.
 *   2. `it.each([...])` and destructuring `for (const [msg, why] of MATRIX)`
 *      were not recognised, so 2 real assertion sites read as unresolved.
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// Defaults to the repo root so a reviewer can reproduce the figure with a
// bare `npx tsx tools/predicate-corpus/check-predicate-corpus.mts` from the
// checkout, with no arguments to get wrong.
const REPO = process.argv[2] ?? process.cwd();

const PREDICATES = ['looksLikeExplicitAnalysisRequest', 'looksLikeImperativeRerun'] as const;
type PredName = (typeof PREDICATES)[number];
const isPred = (s: string): s is PredName => (PREDICATES as readonly string[]).includes(s);

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.mts')) out.push(p);
  }
  return out;
}

interface Case {
  file: string;
  line: number;
  predicate: PredName;
  input: string;
  expected: boolean;
  form: 'literal' | 'loop' | 'each' | 'set_filter';
  arrayName: string | null;
}
interface Ref {
  file: string;
  line: number;
  text: string;
  reason: string;
}

const cases: Case[] = [];
const unresolved: Ref[] = [];
const productionCallSites: Ref[] = [];
const nonCases: Ref[] = [];

const allFiles = walkFiles(join(REPO, 'src')).concat(walkFiles(join(REPO, 'tests')));
const candidateFiles = allFiles.filter((f) => {
  const src = readFileSync(f, 'utf8');
  return PREDICATES.some((p) => src.includes(p));
});
const isTestFile = (f: string) =>
  f.includes('__tests__') || /\.(test|spec)\.[cm]?ts$/.test(f);

for (const file of candidateFiles) {
  const rel = relative(REPO, file);
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const snippet = (n: ts.Node) => n.getText(sf).replace(/\s+/g, ' ').slice(0, 200);

  // ---------------------------------------------------------------------
  // LEXICAL SCOPE. All array-valued declarations, each kept with its node so
  // an identifier can be resolved against the NEAREST enclosing declaration
  // rather than whichever one happened to be parsed last.
  // ---------------------------------------------------------------------
  const decls: { name: string; node: ts.VariableDeclaration; depth: number }[] = [];
  const depthOf = (n: ts.Node): number => {
    let d = 0;
    let cur: ts.Node | undefined = n.parent;
    while (cur) {
      d += 1;
      cur = cur.parent;
    }
    return d;
  };
  const collectDecls = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      decls.push({ name: node.name.text, node, depth: depthOf(node) });
    }
    ts.forEachChild(node, collectDecls);
  };
  collectDecls(sf);

  const ancestorsOf = (n: ts.Node): Set<ts.Node> => {
    const s = new Set<ts.Node>();
    let cur: ts.Node | undefined = n;
    while (cur) {
      s.add(cur);
      cur = cur.parent;
    }
    return s;
  };

  /** Nearest lexically-visible declaration of `name` as seen from `from`. */
  const lookup = (name: string, from: ts.Node): ts.VariableDeclaration | null => {
    const anc = ancestorsOf(from);
    let best: { node: ts.VariableDeclaration; depth: number } | null = null;
    for (const d of decls) {
      if (d.name !== name) continue;
      // The declaration is visible if its own statement sits inside a scope
      // that also contains the use site.
      let container: ts.Node | undefined = d.node.parent?.parent?.parent; // decl -> list -> stmt -> block
      if (container === undefined) container = sf;
      if (!anc.has(container)) continue;
      if (best === null || d.depth > best.depth) best = { node: d.node, depth: d.depth };
    }
    return best?.node ?? null;
  };

  /** Resolve an expression to a flat list of strings, honouring lexical scope. */
  const resolveStrings = (node: ts.Node, from: ts.Node, depth = 0): string[] | null => {
    if (depth > 8) return null;
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
      return resolveStrings(node.expression, from, depth + 1);
    }
    if (ts.isIdentifier(node)) {
      const d = lookup(node.text, from);
      return d?.initializer ? resolveStrings(d.initializer, d, depth + 1) : null;
    }
    if (!ts.isArrayLiteralExpression(node)) return null;
    const out: string[] = [];
    for (const el of node.elements) {
      if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) out.push(el.text);
      else if (ts.isSpreadElement(el)) {
        const inner = resolveStrings(el.expression, from, depth + 1);
        if (inner === null) return null;
        out.push(...inner);
      } else return null;
    }
    return out;
  };

  /**
   * Resolve a table: each row is either a bare string or a tuple of literals.
   * Returns rows as string arrays so a destructured `[msg, why]` binding or an
   * `it.each` parameter can be indexed.
   */
  const resolveRows = (node: ts.Node, from: ts.Node, depth = 0): string[][] | null => {
    if (depth > 8) return null;
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
      return resolveRows(node.expression, from, depth + 1);
    }
    if (ts.isIdentifier(node)) {
      const d = lookup(node.text, from);
      return d?.initializer ? resolveRows(d.initializer, d, depth + 1) : null;
    }
    if (!ts.isArrayLiteralExpression(node)) return null;
    const out: string[][] = [];
    for (const el of node.elements) {
      if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) out.push([el.text]);
      else if (ts.isArrayLiteralExpression(el)) {
        const row: string[] = [];
        for (const c of el.elements) {
          if (ts.isStringLiteral(c) || ts.isNoSubstitutionTemplateLiteral(c)) row.push(c.text);
          else row.push('[non-string]');
        }
        out.push(row);
      } else if (ts.isSpreadElement(el)) {
        const inner = resolveRows(el.expression, from, depth + 1);
        if (inner === null) return null;
        out.push(...inner);
      } else return null;
    }
    return out;
  };

  // ---------------------------------------------------------------------
  // BINDINGS: for-of loops (identifier or array-destructuring) and it.each
  // ---------------------------------------------------------------------
  interface Binding {
    /** parameter name -> the list of values it takes across the table */
    readonly vars: ReadonlyMap<string, readonly string[]>;
    readonly arrayName: string;
    readonly form: 'loop' | 'each';
  }
  const bindings = new Map<ts.Node, Binding>();

  const addTableBinding = (
    owner: ts.Node,
    names: (string | null)[],
    rows: string[][],
    arrayName: string,
    form: 'loop' | 'each',
  ) => {
    const vars = new Map<string, string[]>();
    names.forEach((n, i) => {
      if (n === null) return;
      vars.set(
        n,
        rows.map((r) => r[i] ?? '[missing]'),
      );
    });
    bindings.set(owner, { vars, arrayName, form });
  };

  const collectBindings = (node: ts.Node): void => {
    if (ts.isForOfStatement(node)) {
      const decl = node.initializer;
      if (ts.isVariableDeclarationList(decl) && decl.declarations.length === 1) {
        const name = decl.declarations[0]!.name;
        const expr = node.expression;
        const arrayName = ts.isIdentifier(expr) ? expr.text : '<inline>';
        const rows = resolveRows(expr, node);
        if (rows !== null) {
          if (ts.isIdentifier(name)) {
            addTableBinding(node, [name.text], rows, arrayName, 'loop');
          } else if (ts.isArrayBindingPattern(name)) {
            const names = name.elements.map((e) =>
              ts.isBindingElement(e) && ts.isIdentifier(e.name) ? e.name.text : null,
            );
            addTableBinding(node, names, rows, arrayName, 'loop');
          }
        }
      }
    }
    // it.each([...])('name', (param) => { ... })  /  test.each / describe.each
    if (
      ts.isCallExpression(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'each' &&
      node.expression.arguments.length === 1 &&
      node.arguments.length >= 2
    ) {
      const tableExpr = node.expression.arguments[0]!;
      const arrayName = ts.isIdentifier(tableExpr) ? tableExpr.text : '<inline>';
      const rows = resolveRows(tableExpr, node);
      const body = node.arguments[1]!;
      if (rows !== null && (ts.isArrowFunction(body) || ts.isFunctionExpression(body))) {
        const names = body.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
        addTableBinding(body, names, rows, arrayName, 'each');
      }
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(sf);

  const enclosingBinding = (n: ts.Node, varName: string): Binding | null => {
    let cur: ts.Node | undefined = n;
    while (cur) {
      const b = bindings.get(cur);
      if (b && b.vars.has(varName)) return b;
      cur = cur.parent;
    }
    return null;
  };

  const handled = new Set<ts.Node>();

  // ---------------------------------------------------------------------
  // FORM A: set-filter floors.
  //   const dropped = ARR.filter((m) => !pred(m)).sort();
  //   expect(dropped).toEqual([...LIST].sort());
  // ---------------------------------------------------------------------
  // ⚠ KEYED BY THE DECLARATION NODE, NOT BY NAME. Two `const dropped = ...`
  // declarations live in this file, in different `it()` bodies. A name-keyed
  // map let the second overwrite the first, so one floor was scored against
  // the OTHER floor's expectation list - 11 false mismatches. Caught by the
  // mismatch count, never by inspection.
  const setFilterVar = new Map<
    ts.VariableDeclaration,
    { predicate: PredName; values: string[]; negated: boolean; arrayName: string; call: ts.Node; name: string }
  >();
  const collectFilters = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      let expr: ts.Expression = node.initializer;
      if (
        ts.isCallExpression(expr) &&
        ts.isPropertyAccessExpression(expr.expression) &&
        expr.expression.name.text === 'sort'
      ) {
        expr = expr.expression.expression;
      }
      if (
        ts.isCallExpression(expr) &&
        ts.isPropertyAccessExpression(expr.expression) &&
        expr.expression.name.text === 'filter' &&
        expr.arguments.length === 1
      ) {
        const arrExpr = expr.expression.expression;
        const vals = resolveStrings(arrExpr, node);
        const arrow = expr.arguments[0]!;
        if (vals !== null && ts.isArrowFunction(arrow) && !ts.isBlock(arrow.body)) {
          let negated = false;
          let inner: ts.Expression = arrow.body;
          if (ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.ExclamationToken) {
            negated = true;
            inner = inner.operand;
          }
          if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && isPred(inner.expression.text)) {
            setFilterVar.set(node, {
              predicate: inner.expression.text,
              values: vals,
              negated,
              arrayName: ts.isIdentifier(arrExpr) ? arrExpr.text : '<inline>',
              call: inner,
              name: node.name.text,
            });
            handled.add(inner.expression);
          }
        }
      }
    }
    ts.forEachChild(node, collectFilters);
  };
  collectFilters(sf);

  const collectSetAssertions = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'toEqual' &&
      ts.isCallExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === 'expect' &&
      node.expression.expression.arguments.length >= 1
    ) {
      const subject = node.expression.expression.arguments[0]!;
      const subjectDecl = ts.isIdentifier(subject) ? lookup(subject.text, node) : null;
      if (subjectDecl !== null && setFilterVar.has(subjectDecl)) {
        const f = setFilterVar.get(subjectDecl)!;
        let rhs: ts.Expression = node.arguments[0]!;
        if (
          ts.isCallExpression(rhs) &&
          ts.isPropertyAccessExpression(rhs.expression) &&
          rhs.expression.name.text === 'sort'
        ) {
          rhs = rhs.expression.expression;
        }
        const expectedSet = resolveStrings(rhs, node);
        if (expectedSet === null) {
          unresolved.push({
            file: rel,
            line: lineOf(node),
            text: snippet(node),
            reason: 'set-filter expectation array could not be resolved',
          });
          return;
        }
        const inSet = new Set(expectedSet);
        for (const v of f.values) {
          cases.push({
            file: rel,
            line: lineOf(node),
            predicate: f.predicate,
            input: v,
            expected: f.negated ? !inSet.has(v) : inSet.has(v),
            form: 'set_filter',
            arrayName: f.arrayName,
          });
        }
        setFilterVar.delete(subjectDecl);
      }
    }
    ts.forEachChild(node, collectSetAssertions);
  };
  collectSetAssertions(sf);
  for (const [, f] of setFilterVar) {
    unresolved.push({
      file: rel,
      line: lineOf(f.call),
      text: `filter var '${f.name}' on ${f.predicate} has no matching toEqual assertion`,
      reason: 'set-filter with no expectation',
    });
  }

  // ---------------------------------------------------------------------
  // FORM B: expect(pred(X), msg?).toBe(bool) - both argument arities, and
  // `.not.toBe`.
  // ---------------------------------------------------------------------
  const collectExpects = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'toBe' &&
      node.arguments.length === 1
    ) {
      let subjectCall: ts.Node = node.expression.expression;
      let negated = false;
      if (ts.isPropertyAccessExpression(subjectCall) && subjectCall.name.text === 'not') {
        negated = true;
        subjectCall = subjectCall.expression;
      }
      if (
        ts.isCallExpression(subjectCall) &&
        ts.isIdentifier(subjectCall.expression) &&
        subjectCall.expression.text === 'expect' &&
        subjectCall.arguments.length >= 1
      ) {
        const arg0 = subjectCall.arguments[0]!;
        if (
          ts.isCallExpression(arg0) &&
          ts.isIdentifier(arg0.expression) &&
          isPred(arg0.expression.text) &&
          arg0.arguments.length === 1
        ) {
          const pred = arg0.expression.text;
          const lit = node.arguments[0]!;
          let expected: boolean | null = null;
          if (lit.kind === ts.SyntaxKind.TrueKeyword) expected = true;
          else if (lit.kind === ts.SyntaxKind.FalseKeyword) expected = false;
          handled.add(arg0.expression);
          if (expected === null) {
            unresolved.push({
              file: rel,
              line: lineOf(node),
              text: snippet(node),
              reason: 'toBe() argument is not a boolean literal',
            });
            return;
          }
          if (negated) expected = !expected;
          const inner = arg0.arguments[0]!;
          if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
            cases.push({
              file: rel,
              line: lineOf(node),
              predicate: pred,
              input: inner.text,
              expected,
              form: 'literal',
              arrayName: null,
            });
          } else if (ts.isIdentifier(inner)) {
            const b = enclosingBinding(node, inner.text);
            if (b !== null) {
              for (const v of b.vars.get(inner.text)!) {
                cases.push({
                  file: rel,
                  line: lineOf(node),
                  predicate: pred,
                  input: v,
                  expected,
                  form: b.form,
                  arrayName: b.arrayName,
                });
              }
            } else {
              unresolved.push({
                file: rel,
                line: lineOf(node),
                text: snippet(node),
                reason: `identifier '${inner.text}' is not bound by an enclosing resolvable table`,
              });
            }
          } else {
            unresolved.push({
              file: rel,
              line: lineOf(node),
              text: snippet(node),
              reason: 'predicate argument is neither a string literal nor a table-bound identifier',
            });
          }
        }
      }
    }
    ts.forEachChild(node, collectExpects);
  };
  collectExpects(sf);

  // ---------------------------------------------------------------------
  // COMPLETENESS SWEEP. Every remaining reference must be classified.
  // ---------------------------------------------------------------------
  const sweepRefs = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isPred(node.text) && !handled.has(node)) {
      const p = node.parent;
      const isImport = p !== undefined && (ts.isImportSpecifier(p) || ts.isImportClause(p));
      const isDecl =
        p !== undefined &&
        (ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p)) &&
        (p as { name?: ts.Node }).name === node;
      const isPropertyName = p !== undefined && ts.isPropertyAccessExpression(p) && p.name === node;
      if (isImport || isDecl || isPropertyName) {
        nonCases.push({
          file: rel,
          line: lineOf(node),
          text: snippet(node),
          reason: isImport ? 'import binding' : isDecl ? 'declaration' : 'property name',
        });
        return;
      }
      if (p !== undefined && ts.isCallExpression(p) && p.expression === node) {
        const entry = {
          file: rel,
          line: lineOf(node),
          text: snippet(p.parent ?? p),
          reason: isTestFile(rel)
            ? 'predicate CALL in a TEST file not consumed by any recognised assertion form'
            : 'production call site (not a corpus case)',
        };
        if (isTestFile(rel)) unresolved.push(entry);
        else productionCallSites.push(entry);
        return;
      }
      nonCases.push({
        file: rel,
        line: lineOf(node),
        text: snippet(node),
        reason: 'non-call reference (comment/type/JSDoc link)',
      });
    }
    ts.forEachChild(node, sweepRefs);
  };
  sweepRefs(sf);
}

// ---- evaluate the REAL predicates at this tip ----
const mod = await import(join(REPO, 'src/orchestrator-v5/routing/analytical-intent.ts'));
const fns: Record<PredName, (m: string) => boolean> = {
  looksLikeExplicitAnalysisRequest: mod.looksLikeExplicitAnalysisRequest,
  looksLikeImperativeRerun: mod.looksLikeImperativeRerun,
};

// POSITIVE CONTROL (trap 13): the comparison must be able to REPORT a
// disagreement. A deliberately wrong expectation must come back wrong.
const controlDiscriminates = fns.looksLikeExplicitAnalysisRequest('Run the analysis.') !== false;
// CONTRAST CONTROL: and it must be able to report an AGREEMENT too, or it is
// a check that cannot pass (memory: `feedback_control_that_cannot_pass`).
const contrastAgrees = fns.looksLikeExplicitAnalysisRequest('Run the analysis.') === true;

const mismatches = cases.filter((c) => fns[c.predicate](c.input) !== c.expected);
const uniqueInputs = new Set(cases.map((c) => JSON.stringify([c.predicate, c.input])));
const files = new Set(cases.map((c) => c.file));
const arrayKeys = new Set(
  cases.filter((c) => c.arrayName !== null).map((c) => `${c.file}:${c.arrayName}`),
);

const report = {
  files_scanned: candidateFiles.map((f) => relative(REPO, f)).sort(),
  files_with_cases: [...files].sort(),
  arrays_resolved: [...arrayKeys].sort(),
  arrays_resolved_count: arrayKeys.size,
  total_cases: cases.length,
  unique_inputs: uniqueInputs.size,
  by_form: {
    literal: cases.filter((c) => c.form === 'literal').length,
    loop: cases.filter((c) => c.form === 'loop').length,
    each: cases.filter((c) => c.form === 'each').length,
    set_filter: cases.filter((c) => c.form === 'set_filter').length,
  },
  by_predicate: {
    looksLikeExplicitAnalysisRequest: cases.filter(
      (c) => c.predicate === 'looksLikeExplicitAnalysisRequest',
    ).length,
    looksLikeImperativeRerun: cases.filter((c) => c.predicate === 'looksLikeImperativeRerun').length,
  },
  non_cases: nonCases.length,
  production_call_sites: productionCallSites,
  unresolved_count: unresolved.length,
  unresolved,
  mismatch_count: mismatches.length,
  mismatches,
  control_discriminates: controlDiscriminates,
  contrast_agrees: contrastAgrees,
};
console.log(JSON.stringify(report, null, 2));

if (process.env.DUMP_CASES === '1') {
  const sorted = [...cases].sort((a, b) =>
    `${a.predicate}${a.input}`.localeCompare(`${b.predicate}${b.input}`),
  );
  for (const c of sorted) {
    console.log(
      `CASE\t${c.predicate}\t${c.expected}\t${JSON.stringify(c.input)}\t${c.file}:${c.line}\t${c.form}`,
    );
  }
}

if (cases.length === 0) {
  console.error('HARNESS FAILURE: corpus is EMPTY - the extractor saw nothing.');
  process.exit(3);
}
if (!controlDiscriminates || !contrastAgrees) {
  console.error('HARNESS FAILURE: controls did not both fire - the comparison is vacuous.');
  process.exit(4);
}
if (unresolved.length > 0) {
  console.error(
    `HARNESS FAILURE: ${unresolved.length} UNRESOLVED predicate reference(s). A corpus that cannot account for a reference cannot certify the code over it.`,
  );
  process.exit(2);
}
if (mismatches.length > 0) {
  console.error(`HARNESS: ${mismatches.length} case(s) disagree with the repo at this tip.`);
  process.exit(1);
}
console.error(
  `HARNESS OK: ${cases.length} cases, ${arrayKeys.size} arrays, 0 unresolved, 0 mismatches.`,
);
