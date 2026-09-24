/** Offline preparation only. No provider client, credentials or network calls. */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANALYSIS_INTERPRETER_V02, composeAnalysisInterpreterV02 } from '../../src/orchestrator-v5/agent-lane/prompt-profiles/analysis-interpreter-v02.js';
import { composeAnalysisInterpreterV03 } from '../../src/orchestrator-v5/agent-lane/prompt-profiles/analysis-interpreter-v03.js';

interface Capture {
  case_id: string;
  request: {
    instructions: string;
    input: unknown[];
    tool_choice: string;
    [key: string]: unknown;
  };
  expected: string[];
}
interface Fixtures {
  source_head: string;
  evidence: 'synthetic upstream; real FP3 request serialisation';
  captures: Capture[];
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Keep scoring guidance and provenance out of each model request. */
export function prepareComparison(fixtures: Fixtures) {
  if (!/^[a-f0-9]{40}$/.test(fixtures.source_head) || fixtures.captures.length === 0) {
    throw new Error('A source head and captured cases are required');
  }
  const ids = new Set<string>();
  const samples: { sample_id: string; request: Capture['request'] }[] = [];
  const scoring: { sample_id: string; question_and_context: unknown[]; expected: string[] }[] = [];
  const manifest: Record<string, unknown>[] = [];
  for (const [index, capture] of fixtures.captures.entries()) {
    if (!capture.case_id || ids.has(capture.case_id) || !capture.expected?.length) {
      throw new Error('Each case needs a unique ID and external scoring guidance');
    }
    ids.add(capture.case_id);
    if (capture.request.tool_choice !== 'none' || !Array.isArray(capture.request.input)) {
      throw new Error('Only captured answer-only FP3 requests are supported');
    }
    const suffix = `\n\n${ANALYSIS_INTERPRETER_V02.instructions}`;
    if (!capture.request.instructions.endsWith(suffix)) {
      throw new Error('Captured instructions must end with the exact banked v0.2 profile');
    }
    const baseline = capture.request.instructions.slice(0, -suffix.length);
    const arms = [composeAnalysisInterpreterV02(baseline), composeAnalysisInterpreterV03(baseline)];
    // Counterbalance presentation order; record the key separately from scoring.
    if (index % 2 === 1) arms.reverse();
    for (const arm of arms) {
      const sampleId = `sample-${String(samples.length + 1).padStart(3, '0')}`;
      const request = structuredClone(capture.request);
      request.instructions = arm.instructions;
      samples.push({ sample_id: sampleId, request });
      scoring.push({ sample_id: sampleId, question_and_context: structuredClone(request.input), expected: [...capture.expected] });
      manifest.push({ sample_id: sampleId, case_id: capture.case_id, source_head: fixtures.source_head,
        input_sha256: hash(request.input), request_sha256: hash(request), ...arm.identity });
    }
  }
  return { samples, scoring, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('Usage: tsx tools/interpreter-eval/prepare-comparison.ts <captured-fixtures.json> <output-directory>');
  const fixtures = JSON.parse(readFileSync(inputPath, 'utf8')) as Fixtures;
  const result = prepareComparison(fixtures);
  mkdirSync(outputPath, { recursive: true });
  for (const [name, content] of Object.entries(result)) {
    writeFileSync(resolve(outputPath, `${name}.json`), JSON.stringify(content, null, 2) + '\n');
  }
  writeFileSync(resolve(outputPath, 'STATUS.txt'), 'Prepared only: no model calls, model-answer evaluation, latency measurement or release approval.\nKeep manifest.json hidden from the scorer.\n');
  process.stdout.write(`Prepared ${result.samples.length} requests; zero model calls.\n`);
}
