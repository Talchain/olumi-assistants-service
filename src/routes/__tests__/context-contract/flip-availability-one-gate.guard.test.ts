/**
 * ONE gate for "did the producer say its flip analysis ran?" (core system 2, context management).
 *
 * `flipThresholdsAvailable` (context/flip-threshold-rows.ts) is the only place `flip_thresholds_status` is read. Every
 * runtime reader that turns `readTopLevelFlipRows` into a claim asks it in the same function, so a threshold that rides
 * beside `flip_thresholds_status: 'unavailable'` reaches neither the Agent's `tipping_point`, the lens selector, nor the
 * decision review. Source-only AST scan: no typecheck, filesystem writes or network. In-memory mutants (m-a..m-d) run the
 * same scan over the real sources with the gate removed, so the guard cannot go green by looking at nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
// Each scan reads the real runtime sources; the runner is slower than a laptop (the first CI run timed out at 5 s).
vi.setConfig({ testTimeout: 60_000 });
const OWNER = 'src/orchestrator-v5/context/flip-threshold-rows.ts';
const GATE = 'flipThresholdsAvailable';
const READER = 'readTopLevelFlipRows';
const STATUS = 'flip_thresholds_status';
type Sources = Map<string, string>;

function runtimeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__' || entry.name === 'fixtures' || entry.name === 'generated') return [];
    const file = join(dir, entry.name);
    return entry.isDirectory() ? runtimeFiles(file) : entry.name.endsWith('.ts')
      && !/\.(?:d|test|spec)\.ts$/.test(entry.name) ? [file] : [];
  });
}
const real: Sources = new Map(runtimeFiles(join(root, 'src')).map(file => [relative(root, file), readFileSync(file, 'utf8')]));

function enclosingFunction(n: ts.Node): ts.Node | undefined {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) return p;
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent)) return p.parent;
  }
  return undefined;
}
function nameOf(fn: ts.Node | undefined, source: ts.SourceFile): string {
  if (fn === undefined) return '<module>';
  if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) return fn.name?.getText(source) ?? '<anonymous>';
  return ts.isVariableDeclaration(fn) ? fn.name.getText(source) : '<anonymous>';
}
function callsGate(scope: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === GATE) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return found;
}

interface Scan { statusReads: string[]; ungated: string[] }
function scan(input: Sources): Scan {
  const statusReads: string[] = [];
  const ungated: string[] = [];
  for (const [file, text] of input) {
    if (file === OWNER) continue;
    // Text prefilter: only a file naming the parser or the status word can hold a violation, so parse only those.
    if (!text.includes(READER) && !text.includes(STATUS)) continue;
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isTypeNode(n)) return;
      let member: string | undefined;
      if (ts.isPropertyAccessExpression(n)) member = n.name.text;
      else if (ts.isElementAccessExpression(n) && n.argumentExpression && ts.isStringLiteralLike(n.argumentExpression)) member = n.argumentExpression.text;
      else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
        const key = n.propertyName ?? n.name;
        member = ts.isStringLiteralLike(key) ? key.text : key.getText(ast);
      }
      const assignment = n.parent !== undefined && ts.isBinaryExpression(n.parent) && n.parent.left === n
        && n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      if (member === STATUS && !assignment) statusReads.push(`${file}|${nameOf(enclosingFunction(n), ast)}`);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === READER) {
        const fn = enclosingFunction(n);
        if (fn === undefined || !callsGate(fn)) ungated.push(`${file}|${nameOf(fn, ast)}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(ast);
  }
  return { statusReads: [...new Set(statusReads)].sort(), ungated: [...new Set(ungated)].sort() };
}

// Exact-site exemptions, shrink-only: each reads row IDENTITY or COUNT, never a threshold or any figure, so the
// producer's status word cannot change what it claims. A stale entry fails (the list must equal what the scan finds).
const EXEMPT_UNGATED = new Map<string, string>([
  ['src/orchestrator-v5/compose/phase3-blocks.ts|readAttestedFlipWinners', 'option identity the producer attested per factor; no threshold or figure'],
  ['src/orchestrator-v5/coaching/analysis-result-headline.ts|isNoFlipAttestationVacuous', 'structural factor-id membership; no threshold or figure'],
]);
const diff = (found: readonly string[], allowed: ReadonlySet<string>) => ({
  unexpected: found.filter(s => !allowed.has(s)),
  stale: [...allowed].filter(s => !found.includes(s)),
});
const mutate = (file: string, from: string, to: string): Sources => {
  const text = real.get(file);
  if (text === undefined || !text.includes(from)) throw new Error(`mutant anchor missing in ${file}`);
  return new Map(real).set(file, text.replace(from, to));
};

describe('flip availability has one gate', () => {
  const ALLOWED_UNGATED = new Set(EXEMPT_UNGATED.keys());

  it('POSITIVE CONTROL: the scan sees the real readers and the owner (it is not looking at nothing)', () => {
    expect(real.has(OWNER)).toBe(true);
    const readers = [...real].filter(([file, text]) => file !== OWNER && text.includes(READER + '('));
    // tippingPointOf, hasMeasuredFlipThresholdFor, the licensed leaf, plus the two identity/count readers.
    expect(readers.map(([file]) => file).sort()).toEqual([
      'src/orchestrator-v5/agent-lane/decision-sensitivity.ts',
      'src/orchestrator-v5/coaching/analysis-result-headline.ts',
      'src/orchestrator-v5/compose/lens-selector.ts',
      'src/orchestrator-v5/compose/phase3-blocks.ts',
      'src/orchestrator-v5/context/licensed-run-facts.ts',
    ]);
  });

  it('no runtime file reads flip_thresholds_status outside the owner', () => {
    expect(scan(real).statusReads).toEqual([]);
  });

  it('every reader of the flip rows asks the gate in the same function, or is an exact identity/count exemption', () => {
    const { unexpected, stale } = diff(scan(real).ungated, ALLOWED_UNGATED);
    expect(unexpected).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('m-a: tippingPointOf without the gate is reported', () => {
    const mutant = mutate('src/orchestrator-v5/agent-lane/decision-sensitivity.ts',
      "if (!flipThresholdsAvailable(e)) return { status: 'not_evaluated' };", '');
    expect(diff(scan(mutant).ungated, ALLOWED_UNGATED).unexpected)
      .toEqual(['src/orchestrator-v5/agent-lane/decision-sensitivity.ts|tippingPointOf']);
  });

  it('m-b: the lens selector reading the status word inline is reported twice (a second authority, and no gate)', () => {
    const mutant = mutate('src/orchestrator-v5/compose/lens-selector.ts',
      'flipThresholdsAvailable(enrichment) &&', "enrichment.flip_thresholds_status !== 'unavailable' &&");
    const found = scan(mutant);
    expect(found.statusReads).toEqual(['src/orchestrator-v5/compose/lens-selector.ts|hasMeasuredFlipThresholdFor']);
    expect(diff(found.ungated, ALLOWED_UNGATED).unexpected)
      .toEqual(['src/orchestrator-v5/compose/lens-selector.ts|hasMeasuredFlipThresholdFor']);
  });

  it('m-c: a NEW reader of the rows that never asks the gate is reported', () => {
    const mutant = new Map(real).set('src/orchestrator-v5/agent-lane/new-flip-reader.ts',
      "import { readTopLevelFlipRows } from '../context/flip-threshold-rows.js';\n"
      + 'export const firstThreshold = (e: Record<string, unknown>) => readTopLevelFlipRows(e)[0]?.flip_value;\n');
    expect(diff(scan(mutant).ungated, ALLOWED_UNGATED).unexpected)
      .toEqual(['src/orchestrator-v5/agent-lane/new-flip-reader.ts|firstThreshold']);
  });

  it('m-d: an exemption whose site no longer exists is reported as stale (the list only shrinks)', () => {
    const allowed = new Set([...ALLOWED_UNGATED, 'src/orchestrator-v5/agent-lane/gone.ts|nothing']);
    expect(diff(scan(real).ungated, allowed).stale).toEqual(['src/orchestrator-v5/agent-lane/gone.ts|nothing']);
  });
});
