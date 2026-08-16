/**
 * EP2 §11 — V5 graph→PLoT NO-BYPASS guard (architectural CI test).
 *
 * EP2 is the universal read-boundary net ONLY if every V5 graph→PLoT analysis
 * path flows through the guarded seam `loadScenarioSnapshotForRunAnalysis`
 * (where the analysis-ready guard runs). This test fails if a new V5 call site
 * introduces a graph→PLoT payload path that bypasses EP2.
 *
 * Scope: V5 `/orchestrate/v2/turn` only (src/orchestrator-v5). The V4
 * `/orchestrate/v1/turn` seam (src/orchestrator/tools/run-analysis.ts) is a
 * DOCUMENTED RESIDUAL and intentionally OUT OF SCOPE here (see PR description).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  stripComments,
  stripCommentsFile,
  GUARD_WALK_TIMEOUT_MS,
} from '../../../../../scripts/ci/strip-source-comments.mjs';

// HERE = .../src/orchestrator-v5/tools/handlers/__tests__/  →  V5 root is three up.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const V5_ROOT = join(HERE, '..', '..', '..');

function walkSrc(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkSrc(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Real (awaited) `*.plotClient.run(` call sites. Comments are excluded BY
 * MECHANISM: matching runs on the comment-stripped view of each file
 * (scripts/ci/strip-source-comments.mjs, the shared literal-aware
 * tokeniser), so a design note like "never await plotClient.run( here" can
 * never register as a call site. (The raw-line scan this replaces claimed
 * comment-exclusion but had none — a positive control on exactly that
 * comment turned this gate red on 2026-07-20.)
 */
function plotRunCallSites(): string[] {
  const hits: string[] = [];
  for (const file of walkSrc(V5_ROOT)) {
    const lines = stripCommentsFile(file).split('\n');
    const isCaller = lines.some((l) => /plotClient\.run\s*\(/.test(l) && /\bawait\b/.test(l));
    if (isCaller) hits.push(file.slice(V5_ROOT.length + 1));
  }
  return hits.sort();
}

describe('EP2 §11 — V5 graph→PLoT no-bypass', () => {
  it('the ONLY V5 plotClient.run call site is the run_analysis handler (single graph→PLoT seam)', () => {
    expect(plotRunCallSites()).toEqual(['tools/handlers/run-analysis.ts']);
  }, GUARD_WALK_TIMEOUT_MS); // V5-subtree walk; explicit timeout absorbs parallel-load CPU contention

  // The positive assertions below also read the STRIPPED view: a comment
  // merely naming the seam must not vacuously satisfy an "is wired" check,
  // and the ordering indexOf checks must anchor on code, not on a doc
  // comment that happens to mention the symbol first. (stripComments is
  // length-preserving, so the ordering offsets stay comparable.)
  it('the production run_analysis ScenarioReader IS the guarded seam (loadScenarioSnapshotForRunAnalysis)', () => {
    const registry = stripComments(readFileSync(join(V5_ROOT, 'tools', 'registry.ts'), 'utf8'));
    expect(registry).toContain('loadScenarioSnapshotForRunAnalysis');
    expect(/createRunAnalysisHandler\(\s*\{[\s\S]*?scenarioReader/.test(registry)).toBe(true);
  });

  it('chip-click run routes through the SAME guarded seam (loadScenarioSnapshotForRunAnalysis)', () => {
    const chip = stripComments(readFileSync(join(V5_ROOT, 'handlers', 'chip-click-dispatch.ts'), 'utf8'));
    expect(chip).toContain('loadScenarioSnapshotForRunAnalysis');
  });

  it('the EP2 guard is invoked UNCONDITIONALLY inside that seam', () => {
    const seam = stripComments(readFileSync(join(V5_ROOT, 'build-turn-context.ts'), 'utf8'));
    expect(seam).toContain('assessAnalysisReadiness');
    // The legacy config input is quarantined in config only. Its name in this
    // executable seam would mean a deployment value can still disable Run
    // admission, which is precisely the authority regression this gate owns.
    expect(seam).not.toContain('analysisReadyGuardEnabled');
    // Ordering inside the exact serving seam:
    //   sigma floor → compute-only schema validation → canonical readiness
    //   → canonical GraphV3 parse.
    // The first parse decides schema/numeric integrity only; its output is not
    // fed to readiness. The guard must inspect the carrier-preserving floored
    // graph before the canonical projection is parsed, otherwise GraphV3 can
    // strip the option/readiness carriers that the sole admission authority
    // needs. Scoping the search to this function also prevents an unrelated
    // earlier GraphV3 parse in the file from satisfying the ordering ratchet.
    const seamStart = seam.indexOf('export async function loadScenarioSnapshotForRunAnalysis');
    expect(seamStart).toBeGreaterThan(0);
    // Bound the ownership assertion at the next top-level function. Slicing to
    // EOF would let a dead helper appended later donate the expected tokens
    // after this serving function had removed its real guard.
    const seamEnd = seam.indexOf('\nfunction mergeOptionInterventionObjects(', seamStart);
    expect(seamEnd).toBeGreaterThan(seamStart);
    const servingSeam = seam.slice(seamStart, seamEnd);
    const floorIdx = servingSeam.indexOf('floorGraphSigmaForCompute(persistedGraph)');
    const computeParseIdx = servingSeam.indexOf('GraphV3.safeParse(sigmaFloor.graph)');
    const guardIdx = servingSeam.indexOf('assessAnalysisReadiness(sigmaFloor.graph)');
    const canonicalParseIdx = servingSeam.indexOf('GraphV3.safeParse(graphForSnapshot)');
    expect(floorIdx).toBeGreaterThan(0);
    expect(computeParseIdx).toBeGreaterThan(floorIdx);
    expect(guardIdx).toBeGreaterThan(computeParseIdx);
    expect(canonicalParseIdx).toBeGreaterThan(guardIdx);
  });

  it('no V5 production source reads the quarantined flag-off input', () => {
    const consumers = walkSrc(V5_ROOT)
      .filter((file) => stripCommentsFile(file).includes('analysisReadyGuardEnabled'))
      .map((file) => file.slice(V5_ROOT.length + 1))
      .sort();
    expect(consumers).toEqual([]);
  }, GUARD_WALK_TIMEOUT_MS);
});
