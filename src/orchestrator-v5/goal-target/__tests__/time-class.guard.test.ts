/**
 * S4 TIME, the repo guard: every site that can issue a time-bearing card or let a chance stand at a held month is either routed
 * through the supported time class (`timeClassOf` / `identityReadingWithinTimeClass`), handed the stored brief, or named here with
 * the EXACT calls it makes and the reason those calls cannot offer or license anything the boundary withholds. A NEW caller of an
 * issuer in none of the three lists fails, and so does a changed use of an exempt one (its recorded calls no longer match), so a
 * new route cannot skip the boundary silently. The scan reads the AST (import aliases, namespace calls, split lines and comments
 * are handled), not text lines.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const SRC = fileURLToPath(new URL('../../../', import.meta.url));
const ISSUERS: ReadonlySet<string> = new Set(['proposeCeilingStock', 'recogniseCeilingStock', 'proposeProductIdentity', 'admitAccumulationIdentities',
  'admitStructuralGoalAccumulation', 'withholdGoalFiguresForUntestedHorizon', 'steadyHorizonCard']);
const BOUNDARY: ReadonlySet<string> = new Set(['timeClassOf', 'identityReadingWithinTimeClass']);

interface Scan { readonly calls: string[]; readonly boundary: boolean }
/** Issuer calls (by imported name, through any alias or namespace) and whether a boundary identifier occurs as CODE. */
function scan(text: string): Scan {
  const file = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true);
  const alias = new Map<string, string>();
  const calls: string[] = [];
  let boundary = false;
  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) && ISSUERS.has((node.propertyName ?? node.name).text)) alias.set(node.name.text, (node.propertyName ?? node.name).text);
    if (ts.isIdentifier(node) && BOUNDARY.has(node.text)) boundary = true;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? alias.get(callee.text) ?? (ISSUERS.has(callee.text) ? callee.text : undefined)
        : ts.isPropertyAccessExpression(callee) && ISSUERS.has(callee.name.text) ? callee.name.text : undefined;
      if (name !== undefined) calls.push(`${name}(${node.arguments.map(a => a.getText(file).replace(/\s+/g, ' ')).join(', ')})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { calls, boundary };
}

/** Callers that route through the time class: the file names a boundary function in code. */
const COVERED: Readonly<Record<string, string>> = {
  'orchestrator-v5/agent-lane/ceiling-stock.ts': 'recogniseCeilingStock returns null outside the class, which covers propose, the postimage and the pending-offerable read.',
  'orchestrator-v5/agent-lane/identity-reading.ts': 'The one place the two card readers are combined; null outside the class.',
  'orchestrator-v5/agent-lane/runtime/build-model.ts': 'The accumulation admission (declared and structural) is skipped outside the class.',
  'orchestrator-v5/agent-lane/runtime/agent-capabilities.ts': 'Both card issuing sites use identityReadingWithinTimeClass; the level ask is gated by timeClassOf.',
};
/** Callers handed the stored brief, which their callee checks against the class (the row below checks the argument). */
const BRIEF_PASSED: Readonly<Record<string, { callee: string; shape: RegExp }>> = {
  'orchestrator-v5/tools/handlers/run-analysis.ts': { callee: 'withholdGoalFiguresForUntestedHorizon', shape: /^withholdGoalFiguresForUntestedHorizon\(response, .*, snapshot\.briefText\)$/ },
  'routes/agent-v1-turn.ts': { callee: 'steadyHorizonCard', shape: /^steadyHorizonCard\(\{.*\bbrief: identityOfferBrief\b.*\}\)$/ },
};
/** Callers outside the boundary: the reason none can offer or license what the boundary withholds. The calls they make are pinned too. */
const EXEMPT: Readonly<Record<string, string>> = {
  'orchestrator-v5/system-events/identity-confirm-edit.ts': 'Re-reads the reading at the user\'s Yes; recogniseCeilingStock is null outside the class, so a confirm for a refused brief can only refuse.',
  'orchestrator-v5/goal-target/goal-horizon-write.ts': 'Writes a carrier when the user confirms a deadline; it computes no chance, and the Run gate (brief passed) still withholds the at-H chance outside the class.',
  'orchestrator-v5/agent-lane/actions/state.ts': 'Offers the product-identity chip with no brief in scope; a product identity is not a time mechanism and the Run gate still withholds the chance.',
  'orchestrator-v5/agent-lane/identity-card.ts': 'Reads the stored reading to say which part level is missing; it offers no new card and licenses nothing.',
  'orchestrator-v5/agent-lane/goal-coherence.ts': 'Read-only coherence check of the stored reading; offers and licenses nothing.',
  'orchestrator-v5/tools/handlers/unconfirmed-goal-product.ts': 'Carries the stored product reading on the wire as unconfirmed; offers no card and licenses nothing.',
};
/** The exact calls each exempt file makes today. A change here is a changed use and must be re-reviewed against its reason above. */
const EXEMPT_CALLS: Readonly<Record<string, readonly string[]>> = {
  'orchestrator-v5/system-events/identity-confirm-edit.ts': ['proposeCeilingStock(storedGraph, brief)', 'proposeCeilingStock(storedGraph, brief)',
    'proposeProductIdentity(storedGraph)', 'proposeProductIdentity(params.persistedGraph)'],
  'orchestrator-v5/goal-target/goal-horizon-write.ts': ['admitStructuralGoalAccumulation(graph.nodes as Array<Rec & { id: string }>, graph.edges as Array<Rec & { from: string; to: string }>)'],
  'orchestrator-v5/agent-lane/actions/state.ts': ['proposeProductIdentity(raw)'],
  'orchestrator-v5/agent-lane/identity-card.ts': ['proposeProductIdentity(p.graph)'],
  'orchestrator-v5/agent-lane/goal-coherence.ts': ['proposeProductIdentity(graph)'],
  'orchestrator-v5/tools/handlers/unconfirmed-goal-product.ts': ['proposeProductIdentity(storedGraph)'],
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : walk(path);
    return entry.name.endsWith('.ts') && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  });
}

describe('the scanner sees every way of calling an issuer (planted controls), and ignores what is not a call', () => {
  it.each([
    ['plain', 'proposeCeilingStock(graph, brief);', ['proposeCeilingStock(graph, brief)']],
    ['space before the paren', 'proposeCeilingStock (graph, brief);', ['proposeCeilingStock(graph, brief)']],
    ['split over lines', 'recogniseCeilingStock\n(graph,\n brief);', ['recogniseCeilingStock(graph, brief)']],
    ['aliased import', "import { proposeCeilingStock as pc } from './x.js';\npc(graph, brief);", ['proposeCeilingStock(graph, brief)']],
    ['namespace call', 'ns.proposeProductIdentity(graph);', ['proposeProductIdentity(graph)']],
    ['the steady card', 'steadyHorizonCard({ graph, brief });', ['steadyHorizonCard({ graph, brief })']],
  ])('%s', (_name, source, expected) => { expect(scan(source).calls).toEqual(expected); });
  it('a definition, an import, a re-export and a comment are not calls; a boundary name in a comment is not the boundary', () => {
    const source = "import { proposeCeilingStock } from './x.js';\nexport { withholdGoalFiguresForUntestedHorizon } from './y.js';\n"
      + 'export function recogniseCeilingStock(g: unknown) { return g; }\n// proposeCeilingStock(graph, brief) and timeClassOf are documented here\n/* identityReadingWithinTimeClass */';
    expect(scan(source)).toEqual({ calls: [], boundary: false });
    expect(scan('const t = timeClassOf(brief);').boundary).toBe(true);
  });
});

describe('every issuer of a time-bearing card or held-month chance is behind the supported time class', () => {
  const files = walk(SRC);
  const scans = new Map(files.map(f => [relative(SRC, f), scan(readFileSync(f, 'utf8'))] as const).filter(([, s]) => s.calls.length > 0));

  it('the walk is real (a vacuous walk would pass): hundreds of files, and the known callers are found (positive control)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(scans.get('orchestrator-v5/agent-lane/runtime/build-model.ts')!.calls.join(' ')).toContain('admitAccumulationIdentities(');
    expect(scans.get('orchestrator-v5/tools/handlers/run-analysis.ts')!.calls.join(' ')).toContain('withholdGoalFiguresForUntestedHorizon(');
  });

  it('the set of caller files is exactly the three lists: a NEW caller in none fails here', () => {
    expect([...scans.keys()].sort()).toEqual([...Object.keys(COVERED), ...Object.keys(BRIEF_PASSED), ...Object.keys(EXEMPT)].sort());
  });

  it.each(Object.keys(COVERED))('%s names a boundary function in code', file => {
    expect(scans.get(file)!.boundary, file).toBe(true);
  });

  it.each(Object.entries(BRIEF_PASSED))('%s hands the stored brief to every call of its issuer', (file, { callee, shape }) => {
    const calls = scans.get(file)!.calls.filter(c => c.startsWith(`${callee}(`));
    expect(calls.length, file).toBeGreaterThan(0);
    for (const call of calls) expect(call, file).toMatch(shape);
  });

  it.each(Object.entries(EXEMPT))('%s: reason stated, and it makes exactly the recorded calls (a changed use must be re-reviewed)', (file, reason) => {
    expect(reason.length).toBeGreaterThan(40);
    expect(EXEMPT_CALLS[file], file).toBeDefined();
    expect([...scans.get(file)!.calls].sort(), file).toEqual([...EXEMPT_CALLS[file]!].sort());
  });

  it('the Agent capabilities reach the ceiling card only through the combined reader', () => {
    const calls = scans.get('orchestrator-v5/agent-lane/runtime/agent-capabilities.ts')!.calls;
    expect(calls.filter(c => c.startsWith('proposeCeilingStock('))).toEqual([]);
    expect(readFileSync(join(SRC, 'orchestrator-v5/agent-lane/runtime/agent-capabilities.ts'), 'utf8').match(/\bidentityReadingWithinTimeClass\(/g)?.length).toBe(2);
  });

  it('the ceiling-stock recogniser and the build admission read the boundary before they recognise or admit anything', () => {
    const ceiling = readFileSync(join(SRC, 'orchestrator-v5/agent-lane/ceiling-stock.ts'), 'utf8');
    const recogniser = ceiling.slice(ceiling.indexOf('export function recogniseCeilingStock'));
    expect(recogniser.indexOf('timeClassOf(brief)')).toBeGreaterThan(0);
    expect(recogniser.indexOf('timeClassOf(brief)')).toBeLessThan(recogniser.indexOf('goal.nonlinear_identity'));
    const build = readFileSync(join(SRC, 'orchestrator-v5/agent-lane/runtime/build-model.ts'), 'utf8');
    expect(build).toMatch(/const inTimeClass\s*=\s*timeClassOf\(brief\)\.supported;/);
    expect(build).toMatch(/inTimeClass\s*\?\s*candidate\.identities\s*:\s*undefined/);
    expect(build).toMatch(/inTimeClass\s*\?\s*admitStructuralGoalAccumulation\(/);
  });

  it('the steady card refuses a brief outside the class before it reads anything else', () => {
    const card = readFileSync(join(SRC, 'orchestrator-v5/agent-lane/steady-horizon-card.ts'), 'utf8');
    expect(card).toMatch(/!timeClassOf\(input\.brief\)\.supported/);
  });
});

describe('the boundary module is a pure leaf that can only describe, never decide', () => {
  const text = readFileSync(join(SRC, 'orchestrator-v5/goal-target/time-class.ts'), 'utf8');
  const file = ts.createSourceFile('t.ts', text, ts.ScriptTarget.Latest, true);
  it('states the invariant in code and imports nothing (so the verdict module can import it with no cycle)', () => {
    expect(text).toContain('A DETECTION CAN ONLY WITHHOLD AND SAY SO');
    expect(file.statements.some(ts.isImportDeclaration)).toBe(false);
  });
  it('exports a reader and a sentence, and nothing that sizes, credits or licenses', () => {
    const exported = file.statements.flatMap(st => {
      if (!ts.canHaveModifiers(st) || !ts.getModifiers(st)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) return [];
      if (ts.isVariableStatement(st)) return st.declarationList.declarations.map(d => d.name.getText(file));
      return [(st as ts.NamedDeclaration).name?.getText(file) ?? ''];
    });
    expect(exported.sort()).toEqual(['TimeClass', 'UnsupportedTimeKind', 'UnsupportedTimeShape', 'timeClassOf', 'unsupportedTimeSentence']);
  });
});
