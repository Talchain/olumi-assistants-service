/**
 * ⭐⭐ T7 — v1 HAS NO COMPUTE EFFECT. Proven, not asserted.
 *
 * ROADMAP 2.688 slice 1, design §0.1 / §4.3 / §4.4.
 *
 * THE CLAIM, stated precisely, because "no compute effect" is three different
 * claims and only one of them is provable here (CLAUDE.md — an absence claim
 * needs a COMPLETE MANIFEST, an EXPLICIT SCOPE, and a PRECISE CLAIM TYPE):
 *
 *   CLAIM (no-reachability, both directions, at this SHA):
 *     (a) NO module under `src/orchestrator-v5/belief-elicitation/` loads any
 *         module on the compute boundary — the ISL adapter, the PLoT client,
 *         the analysis handlers, or the ISL contracts; AND
 *     (b) the COMPLETE set of modules in `src/` that load anything from
 *         `belief-elicitation/` is exactly the three named consumers below,
 *         none of which is on the compute path for the reference-class data.
 *
 *   NOT CLAIMED: that the analysis payload is byte-identical under some
 *   runtime experiment. That is a weaker instrument, not a stronger one —
 *   it samples one input where this samples the whole edge set. And the
 *   REASON no payload can differ is structural: there is no edge.
 *
 * ⭐ THE MANIFEST IS DERIVED FROM THE FILESYSTEM AND THE IMPORT GRAPH, not
 * from a hand-kept list (trap 12). A new file added to this module is
 * covered automatically; a new consumer added anywhere in `src/` REDs this
 * suite until it is named and justified. That failure direction is the point:
 * the guard fails LOUD when the wall it describes moves.
 *
 * ⭐ M7 (delete the whole feature) leaves this suite GREEN — correctly. It
 * asserts NON-application, so its evidence of life is the reverse-edge
 * assertion, which pins that the consumers exist and are exactly these.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_SRC = resolve(import.meta.dirname, '../../..');
const MODULE_DIR = resolve(import.meta.dirname, '..');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...listSourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Every `from '...'` / `import('...')` specifier in a TypeScript source file. */
function importSpecifiers(file: string): string[] {
  // `-a`-equivalent: read as utf8 regardless of any NUL sentinel a source
  // file may carry (CLAUDE.md trap 17 — plain grep is blind to those, and an
  // absence claim derived from a blind read is worthless).
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) specifiers.push(match[1]!);
  return specifiers;
}

/**
 * The COMPUTE BOUNDARY, derived by naming the real modules rather than a
 * concept: the ISL adapter and its types, the PLoT client and contracts, and
 * the analysis handlers that build a run request. Each path is asserted to
 * EXIST below, so a rename cannot silently empty this set.
 */
const COMPUTE_BOUNDARY_PATHS: readonly string[] = [
  'src/adapters/isl',
  'src/contracts/plot',
  'src/orchestrator/plot-client.ts',
  'src/orchestrator-v5/tools/handlers/run-analysis.ts',
];

/**
 * Resolve every import edge into this feature, RELATIVE SPECIFIERS INCLUDED.
 *
 * ⚠ The turn-executor imports `'./belief-elicitation/index.js'`. A substring
 * match on the full module path misses that edge entirely and reports zero
 * consumers — an absence claim that passes because the instrument is blind.
 * Resolving each specifier against its importer's directory is what makes
 * the manifest real; the positive control below asserts it.
 */
function consumersRaw(): { file: string; specifier: string }[] {
  const edges: { file: string; specifier: string }[] = [];
  for (const file of listSourceFiles(REPO_SRC)) {
    const rel = relative(REPO_SRC, file);
    if (rel.startsWith('orchestrator-v5/belief-elicitation')) continue;
    for (const specifier of importSpecifiers(file)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolve(file, '..', specifier);
      if (resolved.startsWith(MODULE_DIR)) edges.push({ file: rel, specifier });
    }
  }
  return edges;
}

function deriveConsumers(): string[] {
  return [...new Set(consumersRaw().map((e) => e.file))].sort();
}

/**
 * The COMPLETE set of `src/` modules permitted to load this feature, each
 * with the reason it is not a compute path.
 */
const PERMITTED_CONSUMERS: Readonly<Record<string, string>> = {
  'orchestrator-v5/turn-executor.ts':
    'the pre-route: composes a direct answer, commits with handler_facts: [] and pending_actions: []',
  'cee/belief-elicitation/index.ts':
    'the 2.722 guard: imports the grammar predicate only, to ASK instead of collapsing',
};

describe('T7 — the compute boundary exists and is named', () => {
  it('every compute-boundary path this suite guards against actually exists', () => {
    // Without this, a rename would empty the forbidden set and the suite
    // would pass by testing nothing (trap 12b: a control that decayed).
    for (const path of COMPUTE_BOUNDARY_PATHS) {
      expect(() => statSync(resolve(REPO_SRC, '..', path)), path).not.toThrow();
    }
  });

  it('the module manifest is non-empty and complete', () => {
    const files = listSourceFiles(MODULE_DIR);
    expect(files.length).toBeGreaterThanOrEqual(5);
    const names = files.map((f) => relative(MODULE_DIR, f)).sort();
    // Named so a file ADDED to this module is visible in the diff of this
    // test, not silently absorbed.
    expect(names).toEqual([
      'beta-posterior.ts',
      'index.ts',
      'reference-class-block.ts',
      'reference-class-disclosure.ts',
      'reference-class-elicitation.ts',
      'reference-class-grammar.ts',
    ]);
  });
});

describe('T7 (a) — NO module in this feature loads the compute boundary', () => {
  it('holds for every file in the derived manifest', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(MODULE_DIR)) {
      for (const specifier of importSpecifiers(file)) {
        const forbidden =
          /adapters\/isl|contracts\/plot|plot-client|run-analysis|isl-client|\/isl\//.test(
            specifier,
          );
        if (forbidden) offenders.push(`${relative(REPO_SRC, file)} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('POSITIVE CONTROL — the detector CAN see a compute import when one is present', () => {
    // Trap 13: an absence assertion must first prove it can see a presence.
    // `run-analysis.ts` is on the compute path by construction.
    const runAnalysis = resolve(REPO_SRC, 'orchestrator-v5/tools/handlers/run-analysis.ts');
    const specifiers = importSpecifiers(runAnalysis);
    expect(specifiers.length).toBeGreaterThan(0);
    const seesCompute = specifiers.some((s) =>
      /adapters\/isl|contracts\/plot|plot-client|\/isl\//.test(s),
    );
    expect(seesCompute).toBe(true);
  });
});

describe('T7 (b) — the COMPLETE set of consumers, derived from the import graph', () => {
  it('exactly the permitted consumers load this feature, and nothing else in src/ does', () => {
    const consumers = deriveConsumers();
    expect(consumers).toEqual(Object.keys(PERMITTED_CONSUMERS).sort());
  });

  it('POSITIVE CONTROL — the consumer detector CAN see a real edge (it resolves relative imports)', () => {
    // The turn-executor imports this feature as `'./belief-elicitation/
    // index.js'` — a RELATIVE specifier that a naive substring match on the
    // full module path would MISS entirely, silently reporting zero
    // consumers and passing. Resolving to an absolute path is what makes
    // the manifest real; this control is what proves the resolution works.
    expect(consumersRaw()).toContainEqual(
      expect.objectContaining({ file: 'orchestrator-v5/turn-executor.ts' }),
    );
    expect(deriveConsumers().length).toBeGreaterThan(0);
  });

  it('no compute-boundary module is among them', () => {
    for (const consumer of Object.keys(PERMITTED_CONSUMERS)) {
      expect(consumer).not.toMatch(/adapters\/isl|contracts\/plot|plot-client|run-analysis/);
    }
  });

  it('the 2.722 guard consumer imports the GRAMMAR PREDICATE ONLY — no arithmetic, no object', () => {
    // A narrow edge stated narrowly: the point-parser must not gain the
    // ability to construct a reference class or compute a posterior.
    const guardFile = resolve(REPO_SRC, 'cee/belief-elicitation/index.ts');
    const source = readFileSync(guardFile, 'utf8');
    expect(source).toContain('isReferenceClassCollapseHazard');
    expect(source).not.toContain('createConfirmedReferenceClass');
    expect(source).not.toContain('deriveReferenceClassPosterior');
    expect(source).not.toContain('buildOutsideViewExerciseBlock');
  });
});

describe('T7 — the pre-route commits nothing to the model', () => {
  it('the executor pre-route passes EMPTY handler_facts and pending_actions', () => {
    const executor = readFileSync(resolve(REPO_SRC, 'orchestrator-v5/turn-executor.ts'), 'utf8');
    // Anchored on CODE, not on prose: an end-anchor inside a comment can be
    // matched by the pre-route's own docstring (it happened while writing
    // this test, and the region came back as pure prose).
    const start = executor.indexOf('const referenceClass = recogniseReferenceClass(');
    expect(start).toBeGreaterThan(-1);
    const end = executor.indexOf('const calibrationOnly = classifyCalibrationMessage(', start);
    expect(end).toBeGreaterThan(start);
    const region = executor.slice(start, end);
    expect(region).toContain('handler_facts: []');
    expect(region).toContain('pending_actions: []');
    expect(region).toContain('llm_calls_used: 0');
    // No graph is written on this path — `commitTurn` is called without one.
    expect(region).not.toMatch(/\bgraph:\s/);
  });

  it('the pre-route runs BEFORE the calibration pre-route (I6 ordering)', () => {
    const executor = readFileSync(resolve(REPO_SRC, 'orchestrator-v5/turn-executor.ts'), 'utf8');
    const referenceClass = executor.indexOf('const referenceClass = recogniseReferenceClass(');
    const calibration = executor.indexOf('const calibrationOnly = classifyCalibrationMessage(');
    expect(referenceClass).toBeGreaterThan(-1);
    expect(calibration).toBeGreaterThan(-1);
    expect(referenceClass).toBeLessThan(calibration);
  });
});
