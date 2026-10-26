/**
 * THIN CORE DEPENDENCY BOUNDARY (20 Oct 2026). Every earlier "the AI does the work" path re-grew the legacy meaning
 * layer by importing it back (PATH-B's converter ran through `admit-model` "after four red rounds"). The thin core's
 * files may not import that layer at runtime. Type-only imports carry no behaviour and are allowed; the two named
 * protocol helpers that still live in `build-model.ts` are allowed by name.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../..');

/** The thin core's own files. A file joins this list in the commit that moves it onto the living model. */
const THIN_CORE_ROOTS = ['schemas/living-model.ts', 'orchestrator-v5/path-b/living-model', 'orchestrator-v5/path-b/tools/draft-tool.ts',
  'orchestrator-v5/path-b/tools/core-write.ts', 'orchestrator-v5/core-route', 'routes/core-turn.ts'];

/** The legacy meaning/admission layer (module basenames). */
const FORBIDDEN = [
  'admit-model', 'admit-candidate', 'build-model', 'statements', 'subject', 'provenance-of', 'stated-by-user',
  'user-statements', 'agent-capabilities', 'candidate-to-graph', 'quote-confirmation',
  // The core route builds nothing from the legacy route (DL, 22 Oct): what both need lives in `core-route/`.
  'agent-v1-turn',
];

/**
 * ⭐ THE CORE ROUTE IS PROGRAM-ONLY (inventory F1b, 26 Oct): the route and its dependencies load none of the Living Model's turn
 * machinery: the held-approval writer, the action ranker's bar, the Run restore, the timing carry, the legacy readiness builder
 * and the note tool.
 */
const CORE_ROUTE_FILES = ['routes/core-turn.ts', 'orchestrator-v5/core-route/deps.ts'];
const CORE_ROUTE_FORBIDDEN = ['approve-held-proposal', 'action-bar', 'run-operation', 'carried-effects-timing', 'analysis-ready-helper', 'note-on-item'];

/** Protocol helpers that live in a forbidden module but carry no meaning. */
const ALLOWED_BY_NAME: Record<string, readonly string[]> = {
  'build-model': ['constructionOperationId', 'findConstructionVersion'],
  // Whether the request's words were typed: the one authority's predicate over the request shape, no meaning.
  'provenance-of': ['requestWasTyped'],
};

function filesUnder(rel: string): string[] {
  const abs = join(SRC, rel);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
    .map((f) => join(abs, f));
}

/**
 * Each runtime dependency on a forbidden module, as "<module>: <names>", or "<module>: loaded" when the form binds no names.
 * EVERY module reference counts, from the compiler's own scanner (`ts.preProcessFile`; DL on #3647 r2, after Codex found
 * regex escapes): `import … from`, `export … from`, `import()` (a template literal too), a side-effect import, `require()`.
 * The declarations that bind names are read from the compiler's own tree, so a type-only import or re-export, or a type-only
 * name inside one, loads nothing and is skipped.
 */
export function forbiddenImports(source: string, list: readonly string[] = FORBIDDEN): string[] {
  const out: string[] = [];
  const baseOf = (spec: string): string => spec.split('/').pop()!.replace(/\.js$/, '');
  const forbidden = (spec: string): boolean => list.includes(baseOf(spec));
  const referenced = ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName).filter(forbidden);
  const declared: string[] = [];
  for (const s of ts.createSourceFile('boundary.ts', source, ts.ScriptTarget.Latest, true).statements) {
    if (!ts.isImportDeclaration(s) && !ts.isExportDeclaration(s)) continue;
    if (s.moduleSpecifier === undefined || !ts.isStringLiteral(s.moduleSpecifier) || !forbidden(s.moduleSpecifier.text)) continue;
    // A side-effect import binds nothing: it stays a reference the scanner reports below.
    if (ts.isImportDeclaration(s) && s.importClause === undefined) continue;
    declared.push(s.moduleSpecifier.text);
    let names: string[];
    if (ts.isImportDeclaration(s)) {
      const clause = s.importClause!;
      if (clause.isTypeOnly) continue;
      const bound = clause.namedBindings;
      names = [...(clause.name !== undefined ? [clause.name.text] : []), ...(bound === undefined ? []
        : ts.isNamespaceImport(bound) ? ['*'] : bound.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text))];
    } else {
      if (s.isTypeOnly) continue;
      const clause = s.exportClause;
      names = clause === undefined || ts.isNamespaceExport(clause) ? ['*']
        : clause.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text);
    }
    const base = baseOf(s.moduleSpecifier.text);
    const runtime = names.filter((n) => !(ALLOWED_BY_NAME[base] ?? []).includes(n));
    if (runtime.length > 0) out.push(`${base}: ${runtime.join(', ')}`);
  }
  // Every other reference (`import()`, `require()`, a side-effect import) loads the whole module at runtime.
  for (const spec of declared) { const i = referenced.indexOf(spec); if (i >= 0) referenced.splice(i, 1); }
  for (const spec of referenced) out.push(`${baseOf(spec)}: loaded`);
  return out;
}

describe('thin core dependency boundary', () => {
  it('no thin-core file imports the legacy meaning layer at runtime', () => {
    const violations = THIN_CORE_ROOTS.flatMap(filesUnder).flatMap((file) =>
      forbiddenImports(readFileSync(file, 'utf8')).map((v) => `${relative(SRC, file)} → ${v}`));
    expect(violations).toEqual([]);
  });

  it('F1b: the core route and its dependencies load none of the Living Model turn machinery; CONTRAST: the program tools they do load are seen', () => {
    const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
    expect(CORE_ROUTE_FILES.flatMap((rel) => forbiddenImports(read(rel), CORE_ROUTE_FORBIDDEN).map((v) => `${rel} → ${v}`))).toEqual([]);
    expect(forbiddenImports(read('routes/core-turn.ts'), ['program-tools']), 'the probe sees a module the route imports').toEqual(['program-tools: applyCanvasFigure, PROGRAM_TURN_GUIDANCE, readProgramContext']);
  });

  it('POSITIVE CONTROL: the checker flags a runtime import and passes type-only and named protocol imports', () => {
    expect(forbiddenImports(`import { admitCandidateModel } from '../../agent-lane/admit-model.js';`))
      .toEqual(['admit-model: admitCandidateModel']);
    expect(forbiddenImports(`import {\n  BUILD_INSTRUCTIONS, constructionOperationId,\n} from '../../agent-lane/runtime/build-model.js';`))
      .toEqual(['build-model: BUILD_INSTRUCTIONS']);
    expect(forbiddenImports(`import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';`)).toEqual([]);
    expect(forbiddenImports(`import { readBackState } from '../../routes/agent-v1-turn.js';`)).toEqual(['agent-v1-turn: readBackState']);
    expect(forbiddenImports(`import { type CallStructuredModel, constructionOperationId } from '../runtime/build-model.js';`)).toEqual([]);
  });

  it('POSITIVE CONTROL: every other form that loads a module is seen too (Codex on #3647 r1 and r2)', () => {
    const route = '../../routes/agent-v1-turn.js';
    expect(forbiddenImports(`void import('${route}');`)).toEqual(['agent-v1-turn: loaded']);
    expect(forbiddenImports(`void import(\`${route}\`);`), 'a template-literal import()').toEqual(['agent-v1-turn: loaded']);
    expect(forbiddenImports(`import '${route}';`)).toEqual(['agent-v1-turn: loaded']);
    expect(forbiddenImports(`export {}; import "${route}";`), 'a side-effect import after another statement on its line').toEqual(['agent-v1-turn: loaded']);
    expect(forbiddenImports(`const r = require('${route}');`)).toEqual(['agent-v1-turn: loaded']);
    expect(forbiddenImports(`export { readBackState } from '${route}';`)).toEqual(['agent-v1-turn: readBackState']);
    expect(forbiddenImports(`export * from '${route}';`)).toEqual(['agent-v1-turn: *']);
    expect(forbiddenImports(`import route, { readBackState } from '${route}';`)).toEqual(['agent-v1-turn: route, readBackState']);
    // A named import AND a load of the same module: both are seen.
    expect(forbiddenImports(`import { readBackState } from '${route}';\nvoid import('${route}');`))
      .toEqual(['agent-v1-turn: readBackState', 'agent-v1-turn: loaded']);
    // Type-only forms load nothing, however they are laid out.
    expect(forbiddenImports(`export type { CallStructuredModel } from '../runtime/build-model.js';`)).toEqual([]);
    expect(forbiddenImports(`import type * as T from '${route}';`)).toEqual([]);
    expect(forbiddenImports(`import {\n  type\n  CallStructuredModel,\n} from '../runtime/build-model.js';`), 'an inline type-only name across lines').toEqual([]);
    // CONTRAST: a module outside the list is never flagged, in any form.
    expect(forbiddenImports(`void import('./deps.js'); import './instructions.js'; export * from './turn-request.js';`)).toEqual([]);
  });
});
