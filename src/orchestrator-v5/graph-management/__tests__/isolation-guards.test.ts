import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyProposal } from '../classify-proposal.js';
import { currentAnalysisHash } from '../base-hash-gate.js';
import { buildReadyGraph } from './fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(here, '..'); // src/orchestrator-v5/graph-management

/** Recursively collect every non-test .ts file in the module (subdirectories included). */
function collectModuleTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (ent.name === '__tests__') continue;
      out.push(...collectModuleTsFiles(join(dir, ent.name)));
    } else if (ent.name.endsWith('.ts')) {
      out.push(join(dir, ent.name));
    }
  }
  return out;
}
const moduleFiles = collectModuleTsFiles(moduleDir); // absolute paths

/**
 * Import enforcement (resolved-path based, so it is location-independent and not
 * bypassable by aliases, barrels, side-effect imports, dynamic imports, `./../../`
 * escapes, subdirectory files, or template-literal/comment text). Every import
 * must resolve WITHIN the module dir, or to one of these exact cross-boundary seam
 * targets. Any V4 patch/apply, persistence, route, or write module fails.
 */
const ALLOWED_RESOLVED = new Set(
  [
    '../tools/handlers/d1-shared/apply-graph-mutation.js',
    '../tools/handlers/d1-shared/errors.js',
    '../tools/handlers/analysis-ready-core.js',
    '../context/graph-hash.js',
    '../../schemas/cee-v3.js',
  ].map((s) => resolve(moduleDir, s)),
);

/** Strip block/line comments AND template literals so prose like `from "x"` is not mis-parsed as an import. */
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

/** All import specifiers: static `from`, side-effect `import '…'`, dynamic `import(…)`, `require(…)`. */
function allImportSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

function importAllowed(fileDir: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false; // bare/external specifier — never allowed
  const resolved = resolve(fileDir, spec);
  if (resolved === moduleDir || resolved.startsWith(moduleDir + sep)) return true; // local
  return ALLOWED_RESOLVED.has(resolved); // cross-boundary seam
}

describe('isolation guards (import enforcement / no-persistence / off-path)', () => {
  it('scans every non-test module file, including any subdirectories', () => {
    expect(moduleFiles.length).toBeGreaterThan(1);
  });

  it('every import resolves within the module dir or to an allowlisted seam target', () => {
    for (const file of moduleFiles) {
      const src = stripNonCode(readFileSync(file, 'utf8'));
      const fileDir = dirname(file);
      for (const spec of allImportSpecifiers(src)) {
        expect(importAllowed(fileDir, spec), `${file} imports disallowed module '${spec}'`).toBe(true);
      }
    }
  });

  it('no module file uses a dynamic import() or require() (no dynamic bypass)', () => {
    for (const file of moduleFiles) {
      const src = stripNonCode(readFileSync(file, 'utf8'));
      expect(/\bimport\s*\(/.test(src), `${file} must not use dynamic import()`).toBe(false);
      expect(/\brequire\s*\(/.test(src), `${file} must not use require()`).toBe(false);
    }
  });

  it('the import enforcer itself rejects escapes, bare specifiers, and off-list seams (meta-check)', () => {
    expect(importAllowed(moduleDir, './proposal-types.js')).toBe(true);
    expect(importAllowed(moduleDir, '../tools/handlers/analysis-ready-core.js')).toBe(true);
    expect(importAllowed(moduleDir, '../bad.js')).toBe(false);
    expect(importAllowed(moduleDir, './../../escape.js')).toBe(false);
    expect(importAllowed(moduleDir, '../tools/edit-graph.js')).toBe(false);
    expect(importAllowed(moduleDir, 'zod')).toBe(false);
    // a hypothetical subdirectory file reaching a forbidden module is rejected too
    expect(importAllowed(join(moduleDir, 'lib'), '../../tools/edit-graph.js')).toBe(false);
  });

  it('zero persistence: the input graph is never mutated and the candidate is a distinct object', () => {
    const graph = buildReadyGraph();
    const snapshot = structuredClone(graph);
    const r = classifyProposal(
      {
        kind: 'rename_node',
        base_graph_hash: currentAnalysisHash(graph),
        node_id: 'g-profit',
        new_label: 'Renamed',
      },
      graph,
    );
    expect(graph).toEqual(snapshot);
    expect(r.candidate).toBeDefined();
    expect(r.candidate).not.toBe(graph);
  });
});
