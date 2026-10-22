/**
 * THIN CORE DEPENDENCY BOUNDARY (20 Oct 2026). Every earlier "the AI does the work" path re-grew the legacy meaning
 * layer by importing it back (PATH-B's converter ran through `admit-model` "after four red rounds"). The thin core's
 * files may not import that layer at runtime. Type-only imports carry no behaviour and are allowed; the two named
 * protocol helpers that still live in `build-model.ts` are allowed by name.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../..');

/** The thin core's own files. A file joins this list in the commit that moves it onto the living model. */
const THIN_CORE_ROOTS = ['schemas/living-model.ts', 'orchestrator-v5/path-b/living-model', 'orchestrator-v5/path-b/tools/draft-tool.ts',
  'orchestrator-v5/path-b/tools/core-write.ts', 'orchestrator-v5/core-route'];

/** The legacy meaning/admission layer (module basenames). */
const FORBIDDEN = [
  'admit-model', 'admit-candidate', 'build-model', 'statements', 'subject', 'provenance-of', 'stated-by-user',
  'user-statements', 'agent-capabilities', 'candidate-to-graph', 'quote-confirmation',
  // The core route builds nothing from the legacy route (DL, 22 Oct): what both need lives in `core-route/`.
  'agent-v1-turn',
];

/** Protocol helpers that live in a forbidden module but carry no meaning. */
const ALLOWED_BY_NAME: Record<string, readonly string[]> = {
  'build-model': ['constructionOperationId', 'findConstructionVersion'],
};

function filesUnder(rel: string): string[] {
  const abs = join(SRC, rel);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
    .map((f) => join(abs, f));
}

/**
 * Each runtime dependency on a forbidden module, as "<module>: <names>" (or the form, when it binds no names). EVERY module
 * specifier counts (Codex BLOCK on #3647 r1: only `import … from` was seen): `import … from`, `export … from`, `import('…')`,
 * a side-effect `import '…'` and `require('…')`. Type-only imports and re-exports are skipped.
 */
export function forbiddenImports(source: string): string[] {
  const out: string[] = [];
  const baseOf = (spec: string): string => spec.split('/').pop()!.replace(/\.js$/, '');
  // `import X from`, `import { a } from`, `import * as n from`, `export { a } from`, `export * from` (one statement: no `;`).
  const fromRe = /\b(import|export)\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(fromRe)) {
    if (m[2] !== undefined) continue;
    const base = baseOf(m[4]!);
    if (!FORBIDDEN.includes(base)) continue;
    const clause = m[3]!;
    const braced = clause.match(/\{([\s\S]*)\}/)?.[1];
    const names = [...(braced ?? '').split(','), ...clause.replace(/\{[\s\S]*\}/, '').split(',')]
      .map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith('type '));
    const runtime = names.filter((n) => !(ALLOWED_BY_NAME[base] ?? []).includes(n.split(/\s+as\s+/)[0]!));
    if (runtime.length > 0) out.push(`${base}: ${runtime.join(', ')}`);
  }
  // Forms that bind no names: the whole module is loaded at runtime.
  const unnamed: readonly [RegExp, string][] = [
    [/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 'import()'],
    [/^\s*import\s+['"]([^'"]+)['"]/gm, 'side-effect import'],
    [/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 'require()'],
  ];
  for (const [re, form] of unnamed) {
    for (const m of source.matchAll(re)) if (FORBIDDEN.includes(baseOf(m[1]!))) out.push(`${baseOf(m[1]!)}: ${form}`);
  }
  return out;
}

describe('thin core dependency boundary', () => {
  it('no thin-core file imports the legacy meaning layer at runtime', () => {
    const violations = THIN_CORE_ROOTS.flatMap(filesUnder).flatMap((file) =>
      forbiddenImports(readFileSync(file, 'utf8')).map((v) => `${relative(SRC, file)} → ${v}`));
    expect(violations).toEqual([]);
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

  it('POSITIVE CONTROL: every other form that loads a module is seen too (Codex BLOCK on #3647 r1)', () => {
    const route = '../../routes/agent-v1-turn.js';
    expect(forbiddenImports(`void import('${route}');`)).toEqual(['agent-v1-turn: import()']);
    expect(forbiddenImports(`import '${route}';`)).toEqual(['agent-v1-turn: side-effect import']);
    expect(forbiddenImports(`const r = require('${route}');`)).toEqual(['agent-v1-turn: require()']);
    expect(forbiddenImports(`export { readBackState } from '${route}';`)).toEqual(['agent-v1-turn: readBackState']);
    expect(forbiddenImports(`export * from '${route}';`)).toEqual(['agent-v1-turn: *']);
    expect(forbiddenImports(`import route, { readBackState } from '${route}';`)).toEqual(['agent-v1-turn: readBackState, route']);
    // Type-only forms load nothing.
    expect(forbiddenImports(`export type { CallStructuredModel } from '../runtime/build-model.js';`)).toEqual([]);
    expect(forbiddenImports(`import type * as T from '${route}';`)).toEqual([]);
    // CONTRAST: a module outside the list is never flagged, in any form.
    expect(forbiddenImports(`void import('./deps.js'); import './instructions.js'; export * from './turn-request.js';`)).toEqual([]);
  });
});
