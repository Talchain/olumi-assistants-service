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
const THIN_CORE_ROOTS = ['schemas/living-model.ts', 'orchestrator-v5/path-b/living-model'];

/** The legacy meaning/admission layer (module basenames). */
const FORBIDDEN = [
  'admit-model', 'admit-candidate', 'build-model', 'statements', 'subject', 'provenance-of', 'stated-by-user',
  'user-statements', 'agent-capabilities', 'candidate-to-graph', 'quote-confirmation',
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

/** Each runtime import of a forbidden module, as "<module>: <names>". Type-only imports are skipped. */
export function forbiddenImports(source: string): string[] {
  const out: string[] = [];
  const importRe = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(importRe)) {
    if (m[1] !== undefined) continue;
    const base = m[3]!.split('/').pop()!.replace(/\.js$/, '');
    if (!FORBIDDEN.includes(base)) continue;
    const names = (m[2]!.match(/\{([\s\S]*)\}/)?.[1] ?? m[2]!)
      .split(',').map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith('type '));
    const runtime = names.filter((n) => !(ALLOWED_BY_NAME[base] ?? []).includes(n.split(/\s+as\s+/)[0]!));
    if (runtime.length > 0) out.push(`${base}: ${runtime.join(', ')}`);
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
    expect(forbiddenImports(`import { type CallStructuredModel, constructionOperationId } from '../runtime/build-model.js';`)).toEqual([]);
  });
});
