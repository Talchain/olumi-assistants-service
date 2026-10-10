/**
 * S4 TIME, the repo guard: every site that can issue a time-bearing card or let a chance stand at a held month is either routed
 * through the supported time class (`timeClassOf` / `identityReadingWithinTimeClass`) or named here with the reason it need not be.
 * A NEW caller of one of these issuers that is in neither list fails this file, so a new route cannot skip the boundary silently.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../../', import.meta.url));
const ISSUERS = ['proposeCeilingStock', 'recogniseCeilingStock', 'admitAccumulationIdentities', 'admitStructuralGoalAccumulation',
  'withholdGoalFiguresForUntestedHorizon'] as const;
const BOUNDARY = /\b(?:timeClassOf|identityReadingWithinTimeClass)\b/;

/** Files that call an issuer AND route it through the time class. */
const COVERED: Readonly<Record<string, string>> = {
  'orchestrator-v5/agent-lane/ceiling-stock.ts': 'recogniseCeilingStock returns null outside the class, which covers propose, the postimage and the pending-offerable read.',
  'orchestrator-v5/agent-lane/identity-reading.ts': 'The one place the two card readers are combined; null outside the class.',
  'orchestrator-v5/agent-lane/runtime/build-model.ts': 'The accumulation admission (declared and structural) is skipped outside the class.',
};
/** The Run gate: it takes the stored brief itself (the row below checks the call), so it names no boundary function. */
const BRIEF_PASSED: Readonly<Record<string, string>> = {
  'orchestrator-v5/tools/handlers/run-analysis.ts': 'A computed chance outside the class is withheld and said, because the stored brief is handed to the gate.',
};
/** Files that call an issuer WITHOUT the boundary, each with the reason it cannot license or offer anything the boundary withholds. */
const EXEMPT: Readonly<Record<string, string>> = {
  'orchestrator-v5/system-events/identity-confirm-edit.ts': 'Re-reads the reading at the user\'s Yes through recogniseCeilingStock, which is null outside the class: a confirm for a refused brief can only refuse.',
  'orchestrator-v5/goal-target/goal-horizon-write.ts': 'Writes a carrier when the user confirms a deadline; it computes no chance, and the Run gate (brief passed) still withholds the at-H chance outside the class.',
};
// Definition-only files are not callers and need no entry: accumulation-identity.ts (the admitters) and goal-horizon-verdict.ts (the Run
// gate, plus the read-time gate, which only re-withholds: a stored withheld warning returns unchanged, so it can never unlock).

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : walk(path);
    return entry.name.endsWith('.ts') && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  });
}
/** Code lines only (comments stripped), so a doc mention is not a call. */
const codeOf = (text: string): string => text.split('\n').filter(line => !/^\s*(?:\/\/|\*|\/\*)/.test(line)).join('\n');
/** Names CALLED in this source (a definition `function name(` and an import are not calls). */
const issuerCallsIn = (text: string): string[] => {
  const code = codeOf(text);
  return ISSUERS.filter(name => [...code.matchAll(new RegExp(`\\b${name}\\(`, 'g'))]
    .some(m => !/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))));
};

describe('every issuer of a time-bearing card or held-month chance is behind the supported time class', () => {
  const files = walk(SRC);
  const callers = new Map(files.map(f => [relative(SRC, f), issuerCallsIn(readFileSync(f, 'utf8'))] as const).filter(([, calls]) => calls.length > 0));

  it('the walk is real (a vacuous walk would pass): hundreds of files, and the known callers are found (positive control)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(callers.get('orchestrator-v5/agent-lane/runtime/build-model.ts')).toContain('admitAccumulationIdentities');
    expect(callers.get('orchestrator-v5/tools/handlers/run-analysis.ts')).toContain('withholdGoalFiguresForUntestedHorizon');
  });

  it('the scanner sees a planted new route (contrast control) and ignores a definition and a comment', () => {
    expect(issuerCallsIn('const c = proposeCeilingStock(graph, brief);')).toEqual(['proposeCeilingStock']);
    expect(issuerCallsIn('export function proposeCeilingStock(graph: unknown) {')).toEqual([]);
    expect(issuerCallsIn('// proposeCeilingStock(graph, brief) is documented here\n * recogniseCeilingStock(x)')).toEqual([]);
  });

  it('the set of caller files is exactly the three lists: a NEW caller in none fails here', () => {
    expect([...callers.keys()].sort()).toEqual([...Object.keys(COVERED), ...Object.keys(BRIEF_PASSED), ...Object.keys(EXEMPT)].sort());
  });

  it.each(Object.keys(COVERED))('%s routes through the time class', file => {
    expect(readFileSync(join(SRC, file), 'utf8'), file).toMatch(BOUNDARY);
  });

  it.each(Object.entries(EXEMPT))('%s is exempt with a stated reason', (_file, reason) => {
    expect(reason.length).toBeGreaterThan(40);
  });

  it('the Run gate is handed the stored brief, never called without it', () => {
    const run = readFileSync(join(SRC, 'orchestrator-v5/tools/handlers/run-analysis.ts'), 'utf8');
    const calls = [...codeOf(run).matchAll(/withholdGoalFiguresForUntestedHorizon\(([^;]*)\);/g)];
    expect(calls.length).toBe(1);
    expect(calls[0]![1]).toMatch(/briefText\s*$/);
  });

  it('the Agent capabilities reach the ceiling card only through the combined reader (no direct proposeCeilingStock call)', () => {
    const caps = codeOf(readFileSync(join(SRC, 'orchestrator-v5/agent-lane/runtime/agent-capabilities.ts'), 'utf8'));
    expect(caps).not.toMatch(/\bproposeCeilingStock\(/);
    expect(caps.match(/\bidentityReadingWithinTimeClass\(/g)?.length).toBe(2);
  });

  it('the ceiling-stock recogniser and the build admission read the boundary before they recognise or admit anything', () => {
    const ceiling = codeOf(readFileSync(join(SRC, 'orchestrator-v5/agent-lane/ceiling-stock.ts'), 'utf8'));
    const recogniser = ceiling.slice(ceiling.indexOf('export function recogniseCeilingStock'));
    expect(recogniser.indexOf('timeClassOf(brief)')).toBeGreaterThan(0);
    expect(recogniser.indexOf('timeClassOf(brief)')).toBeLessThan(recogniser.indexOf('goal.nonlinear_identity'));
    const build = codeOf(readFileSync(join(SRC, 'orchestrator-v5/agent-lane/runtime/build-model.ts'), 'utf8'));
    expect(build).toMatch(/const inTimeClass\s*=\s*timeClassOf\(brief\)\.supported;/);
    expect(build).toMatch(/inTimeClass\s*\?\s*candidate\.identities\s*:\s*undefined/);
    expect(build).toMatch(/inTimeClass\s*\?\s*admitStructuralGoalAccumulation\(/);
  });
});

describe('the boundary module is a pure leaf that can only describe, never decide', () => {
  const text = readFileSync(join(SRC, 'orchestrator-v5/goal-target/time-class.ts'), 'utf8');
  it('states the invariant in code and imports nothing (so the verdict module can import it with no cycle)', () => {
    expect(text).toContain('A DETECTION CAN ONLY WITHHOLD AND SAY SO');
    expect(codeOf(text)).not.toMatch(/^\s*import\s/m);
  });
  it('exports a reader and a sentence, and nothing that sizes, credits or licenses', () => {
    const exported = [...codeOf(text).matchAll(/^export\s+(?:function|const|interface|type)\s+(\w+)/gm)].map(m => m[1]);
    expect(exported.sort()).toEqual(['TimeClass', 'UnsupportedTimeKind', 'UnsupportedTimeShape', 'timeClassOf', 'unsupportedTimeSentence']);
  });
});
