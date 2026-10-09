/** Source-only ratchet; no doubles or provider calls. Target: ONE assembler.
 * Two guards, both scoped so unrelated PRs never trip them: (1) the explicit manifest may only shrink (≤ census n);
 * (2) a NEW file that sends a model request must be classified. Known census gap (fixture): widen-draft.ts and
 * open-frame-intake.ts send model requests but are not yet mapped to a manifest assembler.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const base = 'src/orchestrator-v5/';
export const ASSEMBLERS = [
  { file: `${base}agent-lane/runtime/agent-capabilities.ts`, symbol: 'projectModelContext' },
  { file: `${base}agent-lane/runtime/agent-capabilities.ts`, symbol: 'createAgentCapabilities', local: 'withSavedRunCertainty' },
  { file: `${base}agent-lane/saved-run-context-facts.ts`, symbol: 'savedRunContextFacts' },
  { file: `${base}agent-lane/decision-sensitivity.ts`, symbol: 'analysisResultForAgent' },
  { file: `${base}agent-lane/selected-run-delta-for-model.ts`, symbol: 'selectedRunDeltaForModel' },
  { file: `${base}agent-lane/licensed-run-view.ts`, symbol: 'licensedRunBlockForModel' },
  { file: `${base}context/analysis-fallback.ts`, symbol: 'buildAnalysisFromPriorFacts' },
  { file: `${base}context/context-pack-assembler.ts`, symbol: 'assembleContextPackWithSummary' },
  { file: `${base}context/context-pack-assembler.ts`, symbol: 'projectAnalysis' },
  { file: `${base}context/model-facing-context-pack.ts`, symbol: 'projectModelFacingContextPack' },
  { file: 'src/orchestrator/tools/edit-graph.ts', symbol: 'handleEditGraph' },
  { file: `${base}replacement/turn-context-view.ts`, symbol: 'projectTurnContext' },
  { file: `${base}replacement/read-tools.ts`, symbol: 'createReadResultsTool' },
  { file: `${base}coaching/decision-review-enricher.ts`, symbol: 'buildInvokeInputForTests', local: 'buildInvokeInput' },
  { file: 'src/cee/decision-review/invoke.ts', symbol: 'buildDecisionReviewUserMessage' },
  { file: 'src/cee/decision-review/decompose.ts', symbol: 'buildSlices' },
  { file: 'src/cee/validation-pipeline/validate-graph.ts', symbol: 'callValidateGraph' },
  { file: 'src/cee/dual-draft/m2-review.ts', symbol: 'reviewDraftGraph' },
  { file: 'src/cee/unified-pipeline/stages/coaching-pass.ts', symbol: 'runStageCoachingPass' },
  { file: 'src/cee/draft-quality/judge.ts', symbol: 'judgeDraftCoverage' },
  { file: `${base}agent-lane/runtime/build-model.ts`, symbol: 'buildModelFromBrief' },
] as const;
// 17 → 22: added build/draft specialists A18–A22; 22 → 21: #2900 removed A6. Target: 1.
// #2900's opt-in getCanonicalState section remains A1 (its fact projection remains A3).
const BASELINE_N = 21;
const known = JSON.parse(readFileSync(new URL('./fixtures/source-inventory.json', import.meta.url), 'utf8')) as {
  transport_files: string[]; infrastructure: string[]; unclassified_census_gap: string[];
};
/** LLM provider transport only (never generic HTTP fetch): a file matching this sends a model request. */
const LLM_TRANSPORT = /\.(?:chat|chatWithTools)\s*\(|\bcallModelFor\s*\(|\bcallStructured\s*\(|api\.openai\.com|\/v1\/responses|api\.anthropic\.com/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.(?:test|spec)\./.test(path) ? [path] : [];
  });
}
export function hasLlmTransport(source: string): boolean {
  return source.split('\n').some(line => LLM_TRANSPORT.test(line) && !/^\s*(?:\/\/|\*|\/\*)/.test(line));
}

describe('assembler count may only fall toward 1', () => {
  it('checks every explicit file/export/local owner against source and counts <= census n', () => {
    const found = ASSEMBLERS.filter(entry => {
      const source = readFileSync(join(root, entry.file), 'utf8');
      expect(source, `${entry.file} exported ${entry.symbol}`).toMatch(new RegExp(`export\\s+(?:async\\s+)?function\\s+${entry.symbol}\\b`));
      if ('local' in entry) expect(source).toMatch(new RegExp(`\\b${entry.local}\\b`));
      return true;
    });
    expect(new Set(found.map(e => `${e.file}#${'local' in e ? e.local : e.symbol}`)).size).toBe(found.length);
    expect(found.length).toBeLessThanOrEqual(BASELINE_N);
  });
  it('fails when a NEW file sends a model request without classification (scoped to LLM transport, not every callable)', () => {
    const actual = sourceFiles(join(root, 'src')).map(p => relative(root, p))
      .filter(file => hasLlmTransport(readFileSync(join(root, file), 'utf8'))).sort();
    const additions = actual.filter(file => !known.transport_files.includes(file));
    expect(additions, 'a new LLM transport file must be classified against ASSEMBLERS (or as infrastructure)').toEqual([]);
    // Every manifest assembler's file that builds a provider body directly is a known transport file or calls one.
    expect(actual.length, 'the inventory saw transport files (contrast: not a blind scan)').toBeGreaterThanOrEqual(known.infrastructure.length + 1);
  }, 30_000);
  it('discovery contrast: a model call is recognised, a plain HTTP fetch and a comment are not', () => {
    expect(hasLlmTransport('const r = await adapter.chat(messages);')).toBe(true);
    expect(hasLlmTransport("await fetch('https://api.openai.com/v1/responses', init);")).toBe(true);
    expect(hasLlmTransport("await fetch(plotUrl, { body });")).toBe(false);
    expect(hasLlmTransport('// adapter.chat(messages)')).toBe(false);
  });
});
