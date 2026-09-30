/** Byte-pinned selected M2 request for the branch-only Lab call and offline checks. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertPinnedSource, currentM2Input } from './m2-runner.mjs';

export const SELECTED_M2_SOURCE = Object.freeze({
  commit: '9b441fcf99ba5dfee1da0b92aa1341e61c4c9c58',
  request_path: 'openai/ai-experience/2026-09-30/mm-1-run/m2-q1/raw/MM1-MM-A-astra_high-r1.request.json',
  request_sha256: '39b202cc48274c283206dee1e5504d5886178348ea6a6d59b9cf2587b13065c3',
  prompt_path: 'openai/prompts/olumi-poc/21-m2-polymath.v0_2.candidate.md',
  prompt_sha256: '079cb1808160561e14085d691322470c6982927ddb728015d81f78ebfec62e13',
  status: 'selected_for_branch_lab',
});

function pinnedText(path, expected) {
  const raw = readFileSync(new URL(path, import.meta.url));
  if (createHash('sha256').update(raw).digest('hex') !== expected) {
    throw new Error(`selected_m2_source_changed:${path}`);
  }
  return raw.toString('utf8');
}

/** Preserve the benchmark transport; replace only input and the explicitly superseding v0.2 instructions. */
export function prepareSelectedM2Request(snapshot) {
  assertPinnedSource();
  const current = currentM2Input(snapshot);
  const request = JSON.parse(pinnedText('./selected-m2/benchmark-request.json', SELECTED_M2_SOURCE.request_sha256));
  request.instructions = pinnedText('./selected-m2/prompt-v0_2.txt', SELECTED_M2_SOURCE.prompt_sha256);
  request.input = JSON.stringify(current.providerInput);
  return { request, current, source: SELECTED_M2_SOURCE };
}
