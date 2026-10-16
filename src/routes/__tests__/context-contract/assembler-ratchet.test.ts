/** Source-only ratchet; no doubles or provider calls. Target: ONE assembler.
 * Two guards, both scoped so unrelated PRs never trip them: (1) the explicit manifest may only shrink (≤ census n);
 * (2) a NEW file that sends a model request must be classified. The transport census is classified completely.
 */
import { readdirSync,readFileSync } from 'node:fs';
import { join,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe,expect,it } from 'vitest';

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
  { file: `${base}coaching/decision-review-enricher.ts`, symbol: 'buildInvokeInputForTests', local: 'buildInvokeInput' },
  { file: 'src/cee/decision-review/invoke.ts', symbol: 'buildDecisionReviewUserMessage' },
  { file: 'src/cee/decision-review/decompose.ts', symbol: 'buildSlices' },
  { file: 'src/cee/validation-pipeline/validate-graph.ts', symbol: 'callValidateGraph' },
  { file: 'src/cee/unified-pipeline/stages/coaching-pass.ts', symbol: 'runStageCoachingPass' },
  { file: 'src/cee/draft-quality/judge.ts', symbol: 'judgeDraftCoverage' },
  { file: `${base}agent-lane/runtime/build-model.ts`, symbol: 'buildModelFromBrief' },
] as const;
// 17 → 22: added build/draft specialists A18–A22; 22 → 21: #2900 removed A6. Target: 1.
// 21 → 19: C1 deleted the replacement projection and read-results assembler.
// #2900's opt-in getCanonicalState section remains A1 (its fact projection remains A3).
// C1 group 2 removed the unreachable dual-draft review assembler.
const BASELINE_N = 18;
interface MappedTransport { assembler?: string; kind?: string; via?: string; reason: string }
const known = JSON.parse(readFileSync(new URL('./fixtures/source-inventory.json', import.meta.url), 'utf8')) as {
  transport_files: string[]; infrastructure: string[]; unclassified_census_gap: string[]; mapped: Record<string, MappedTransport>;
};
/** Transport files that are neither provider infrastructure nor mapped to an assembler / a classified kind. Pure, so it can be mutated. */
export function unmappedTransport(files: readonly string[], infrastructure: readonly string[], mapped: Record<string, MappedTransport>): string[] {
  return files.filter(file => !infrastructure.includes(file) && mapped[file] === undefined).sort();
}
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
  it('closes the census gap: every non-infrastructure transport file is mapped to a manifest assembler or a classified kind', () => {
    expect(known.unclassified_census_gap, 'the census gap is closed and stays closed').toEqual([]);
    expect(unmappedTransport(known.transport_files, known.infrastructure, known.mapped)).toEqual([]);
    const symbols = new Set<string>(ASSEMBLERS.map(entry => ('local' in entry ? entry.local : entry.symbol)));
    for (const [file, entry] of Object.entries(known.mapped)) {
      expect(known.transport_files, `${file} is a listed transport file`).toContain(file);
      expect(entry.reason.trim().length, `${file}: a stated reason`).toBeGreaterThan(20);
      expect(Boolean(entry.assembler) !== Boolean(entry.kind), `${file}: exactly one of assembler / kind`).toBe(true);
      for (const named of [entry.assembler, entry.via]) {
        if (named !== undefined) expect(symbols.has(named), `${file} -> ${named} is a manifest assembler`).toBe(true);
      }
    }
  });
  it('mutant: a NEW transport file with no mapping is reported; a mapped one and infrastructure are not', () => {
    const files = [...known.transport_files, 'src/orchestrator-v5/agent-lane/new-model-call.ts'];
    expect(unmappedTransport(files, known.infrastructure, known.mapped)).toEqual(['src/orchestrator-v5/agent-lane/new-model-call.ts']);
    expect(unmappedTransport(known.transport_files, known.infrastructure, known.mapped)).toEqual([]);
  });
  it('discovery contrast: a model call is recognised, a plain HTTP fetch and a comment are not', () => {
    expect(hasLlmTransport('const r = await adapter.chat(messages);')).toBe(true);
    expect(hasLlmTransport("await fetch('https://api.openai.com/v1/responses', init);")).toBe(true);
    expect(hasLlmTransport("await fetch(plotUrl, { body });")).toBe(false);
    expect(hasLlmTransport('// adapter.chat(messages)')).toBe(false);
  });
});
