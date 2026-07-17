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

/** Real (awaited) `*.plotClient.run(` call sites — excludes comments / JSDoc references. */
function plotRunCallSites(): string[] {
  const hits: string[] = [];
  for (const file of walkSrc(V5_ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const isCaller = lines.some((l) => /plotClient\.run\s*\(/.test(l) && /\bawait\b/.test(l));
    if (isCaller) hits.push(file.slice(V5_ROOT.length + 1));
  }
  return hits.sort();
}

describe('EP2 §11 — V5 graph→PLoT no-bypass', () => {
  it('the ONLY V5 plotClient.run call site is the run_analysis handler (single graph→PLoT seam)', () => {
    expect(plotRunCallSites()).toEqual(['tools/handlers/run-analysis.ts']);
  });

  it('the production run_analysis ScenarioReader IS the guarded seam (loadScenarioSnapshotForRunAnalysis)', () => {
    const registry = readFileSync(join(V5_ROOT, 'tools', 'registry.ts'), 'utf8');
    expect(registry).toContain('loadScenarioSnapshotForRunAnalysis');
    expect(/createRunAnalysisHandler\(\s*\{[\s\S]*?scenarioReader/.test(registry)).toBe(true);
  });

  it('chip-click run routes through the SAME guarded seam (loadScenarioSnapshotForRunAnalysis)', () => {
    const chip = readFileSync(join(V5_ROOT, 'handlers', 'chip-click-dispatch.ts'), 'utf8');
    expect(chip).toContain('loadScenarioSnapshotForRunAnalysis');
  });

  it('the EP2 guard is invoked INSIDE that seam (assessAnalysisReadiness, behind analysisReadyGuardEnabled)', () => {
    const seam = readFileSync(join(V5_ROOT, 'build-turn-context.ts'), 'utf8');
    expect(seam).toContain('assessAnalysisReadiness');
    expect(seam).toContain('analysisReadyGuardEnabled');
    // Ordering inside the seam: EP2 guard → sigma floor → GraphV3 parse.
    // The guard must wrap the run payload's graph BEFORE GraphV3.safeParse
    // strips node.data, and the W2E-2 round-4 sigma floor must sit BEFORE the
    // parse too — a post-parse floor is unreachable for the std<=0 class the
    // parse rejects (the round-3 dead-code regression this ordering pins out).
    const guardIdx = seam.indexOf('assessAnalysisReadiness');
    const floorIdx = seam.indexOf('floorGraphSigmaForCompute(graphForSnapshot)');
    const parseIdx = seam.indexOf('GraphV3.safeParse(sigmaFloor.graph)');
    expect(guardIdx).toBeGreaterThan(0);
    expect(floorIdx).toBeGreaterThan(guardIdx);
    expect(parseIdx).toBeGreaterThan(floorIdx);
  });
});
