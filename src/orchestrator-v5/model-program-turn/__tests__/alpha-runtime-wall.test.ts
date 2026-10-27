/**
 * W5 (alpha wall, Paul 26 Oct): at runtime, the model-program path loads none of the legacy analysis, PLoT or ISL code.
 * The lint rule (#3847) reads one file's own imports; this walks every VALUE import transitively from each non-test file
 * under `model-program/` and `model-program-turn/`, so a chain through a module outside those folders is seen too.
 * `import type`, `export type` and an import whose every name is `type` load nothing and are skipped; everything else
 * that loads a module (`import … from`, `export … from`, a side-effect import, `import()`, `require()`) is followed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../..');
const ROOTS = ['orchestrator-v5/model-program', 'orchestrator-v5/model-program-turn'];

/** The legacy modules the alpha path may not load (paths under `src/`; a trailing `/` is a whole folder). */
const FORBIDDEN = [
  'orchestrator/tools/analysis-ready-helper.ts', 'orchestrator-v5/context/graph-identity.ts', 'orchestrator-v5/context/graph-hash.ts',
  'orchestrator/plot-client.ts', 'adapters/isl/', 'routes/canonical-analysis-view.ts', 'routes/selected-run-figures.ts',
  'routes/delivered-record-licence.ts', 'routes/analysis-admission-projection.ts',
];

function filesUnder(rel: string): string[] {
  return readdirSync(join(SRC, rel), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.includes('__tests__') && !f.endsWith('.test.ts'))
    .map((f) => join(SRC, rel, f));
}

/** A declaration that binds only types: erased at build, so it loads nothing. */
function typeOnly(s: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(s)) {
    const clause = s.importClause;
    if (clause === undefined) return false;
    const bound = clause.namedBindings;
    return clause.isTypeOnly || (clause.name === undefined && bound !== undefined && ts.isNamedImports(bound)
      && bound.elements.length > 0 && bound.elements.every((e) => e.isTypeOnly));
  }
  const clause = s.exportClause;
  return s.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0
    && clause.elements.every((e) => e.isTypeOnly));
}

/** The module specifiers a source file loads at runtime. A type position's `import('…').T` is not a load. */
function valueSpecifiers(file: string): string[] {
  const out = new Set<string>();
  const literal = (n: ts.Node | undefined): string | undefined =>
    n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && !typeOnly(n)) {
      const spec = literal(n.moduleSpecifier);
      if (spec !== undefined) out.add(spec);
    } else if (ts.isImportEqualsDeclaration(n) && !n.isTypeOnly && ts.isExternalModuleReference(n.moduleReference)) {
      const spec = literal(n.moduleReference.expression);
      if (spec !== undefined) out.add(spec);
    } else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
      const spec = literal(n.arguments[0]);
      if (spec !== undefined) out.add(spec);
    }
    ts.forEachChild(n, visit);
  };
  visit(ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true));
  return [...out];
}

/** A relative specifier as its `.ts` file under `src/`; a package resolves to null (outside the walk). */
function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const rel = (abs: string): string => relative(SRC, abs);
const forbidden = (file: string): boolean => FORBIDDEN.some((f) => (f.endsWith('/') ? rel(file).startsWith(f) : rel(file) === f));

/** No edge is exempt: the save's receipt check no longer computes the legacy analysis hash (W5, 27 Oct). */
const OPEN: readonly (readonly [string, string])[] = [];

const loads = new Map<string, string[]>();
/** The files `file` loads at runtime, less an OPEN edge. */
function loadsOf(file: string, open = OPEN): string[] {
  const all = loads.get(file) ?? valueSpecifiers(file).map((spec) => resolveSpec(file, spec)).filter((f): f is string => f !== null);
  loads.set(file, all);
  return all.filter((next) => !open.some(([from, to]) => rel(file) === from && rel(next) === to));
}

/** Every file loaded from `starts`, each with the file that first loaded it. */
function walk(starts: readonly string[], parent = new Map(starts.map((f): [string, string | null] => [f, null]))): Map<string, string | null> {
  const queue = [...starts];
  for (let i = 0; i < queue.length; i++) {
    for (const next of loadsOf(queue[i]!)) {
      if (parent.has(next)) continue;
      parent.set(next, queue[i]!);
      queue.push(next);
    }
  }
  return parent;
}

function chainOf(parent: Map<string, string | null>, file: string): string {
  const chain: string[] = [];
  for (let at: string | null | undefined = file; at != null; at = parent.get(at)) chain.unshift(rel(at));
  return chain.join(' -> ');
}

/** For each import from a program file into a module outside the program folders, the first chain to each legacy module. */
function legacyChains(): string[] {
  const roots = ROOTS.flatMap(filesUnder);
  const inRoots = new Set(roots);
  const chains = new Set<string>();
  for (const root of roots) {
    for (const gateway of loadsOf(root).filter((f) => !inRoots.has(f))) {
      const parent = walk([gateway], new Map<string, string | null>([[root, null], [gateway, root]]));
      for (const file of parent.keys()) if (forbidden(file)) chains.add(chainOf(parent, file));
    }
  }
  return [...chains].sort();
}

describe('W5 alpha runtime wall', () => {
  const reached = [...walk(ROOTS.flatMap(filesUnder)).keys()].map(rel);

  it('POSITIVE CONTROL: the walk starts at the program roots and follows imports outside them', () => {
    expect(reached).toContain('orchestrator-v5/model-program/canonical.ts');
    // Reached only through saved-read.ts, so the walk crosses a folder boundary.
    expect(reached).toContain('orchestrator-v5/context/graph-identity-normalise.ts');
    expect(reached).toContain('orchestrator/context/stable-stringify.ts');
    expect(reached.length, 'the walk reaches well beyond the two roots').toBeGreaterThan(ROOTS.flatMap(filesUnder).length + 20);
  });

  it('CONTRAST: every legacy module exists, and the same walk from the Living Model card record reaches the PLoT and ISL clients', () => {
    for (const f of FORBIDDEN) expect(existsSync(join(SRC, f)), f).toBe(true);
    const fromRecord = [...walk([join(SRC, 'orchestrator-v5/agent-lane/proposal-object/record.ts')]).keys()].filter(forbidden).map(rel);
    expect(fromRecord).toContain('orchestrator/plot-client.ts');
    expect(fromRecord).toContain('adapters/isl/counterfactual-client.ts');
  });

  it('no model-program file loads legacy analysis, PLoT or ISL code, by any chain', () => {
    expect(legacyChains()).toEqual([]);
  });

  it('no edge is exempt from the wall', () => {
    expect(OPEN).toEqual([]);
  });
});
