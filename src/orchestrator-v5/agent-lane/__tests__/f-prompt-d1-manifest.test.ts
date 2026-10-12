/**
 * Batch F prompt, D1 (DL 12 Oct; AIE 6129749753): the builder's decision_question rules are the AIE's words, byte for byte.
 * The benchmark (recovery/s3/T6-prompt/RESULT.md) read D1 back IMPROVED, 2/2 against 0/2: decision_question is the
 * brief's whole governing sentence, verbatim, with every purpose ("boost productivity"), through the saved graph and the
 * read-back. D4's NO-CHANGE FORECAST paragraph did not improve (both arms failed), so it stays OUT of F.
 *
 * The fixture IS the AIE's request-override manifest, sha-pinned; each assertion reads its operation by index.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildCandidateSchema } from '../runtime/build-model.js';

const RAW = readFileSync(new URL('./fixtures/aie-f-prompt-overrides-20261012.json', import.meta.url));
const MANIFEST = JSON.parse(RAW.toString('utf8')) as { source_pin: string;
  operations: { kind: string; location: string; old?: string; replacement?: string; anchor?: string; insertion?: string }[] };
const [INSTRUCTION, DESCRIPTION, FORECAST] = MANIFEST.operations as [typeof MANIFEST.operations[0], typeof MANIFEST.operations[0], typeof MANIFEST.operations[0]];
const count = (text: string, part: string): number => text.split(part).length - 1;
const description = (): unknown => ((buildCandidateSchema().properties as Record<string, { description?: unknown }>).decision_question)?.description;

describe('IDENTITY: the AIE manifest, as handed back', () => {
  it('sha256 b34d6ebb…; pinned to a770ce49; operations: the instruction, the schema description, the D4 insertion', () => {
    expect(createHash('sha256').update(RAW).digest('hex')).toBe('b34d6ebbc86616496bf16724099659c53de07e384181610cfcdde25227ab1c28');
    expect(MANIFEST.source_pin).toBe('a770ce49fe29691b9e7f28982a100f01ab3b8eef');
    expect([INSTRUCTION.kind, DESCRIPTION.kind, FORECAST.kind]).toEqual(['replace_exact', 'replace_exact', 'insert_after_exact']);
    expect(INSTRUCTION.location).toBe('actual provider body.instructions');
    expect(DESCRIPTION.location).toMatch(/^actual provider body\.text\.format\.schema\.properties\.decision_question\.description/);
  });
});

describe('D1 in F: the source carries the AIE\'s words, byte for byte', () => {
  it('BUILD_INSTRUCTIONS: the replacement sentence, once; the old sentence gone', () => {
    expect(count(BUILD_INSTRUCTIONS, INSTRUCTION.replacement!)).toBe(1);
    expect(BUILD_INSTRUCTIONS).not.toContain(INSTRUCTION.old!);
  });
  it('the strict schema\'s decision_question description is the replacement, exactly', () => {
    expect(description()).toBe(DESCRIPTION.replacement);
  });
});

describe('D4 stays out of F (the benchmark did not improve it)', () => {
  it('no NO-CHANGE FORECAST paragraph; its anchor sentence unchanged, once', () => {
    expect(BUILD_INSTRUCTIONS).not.toContain('NO-CHANGE FORECAST');
    expect(BUILD_INSTRUCTIONS).not.toContain(FORECAST.insertion!.trim());
    expect(count(BUILD_INSTRUCTIONS, FORECAST.anchor!)).toBe(1);
  });
});
