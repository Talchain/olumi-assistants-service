/**
 * ⛔ NO EVALUATION BRIEF IN ANY PROMPT (DL 0df0e1, 4 Oct: the records drafting instruction carried the sealed brief's
 * figures as worked examples since #2558, so the demo brief's draft looked right for the wrong reason).
 *
 * Every text a model can read from this repo is scanned against fingerprints of the SEALED brief and both blind-written
 * HELD-OUT briefs (`./eval-brief-fingerprint.ts`): string and template literals of non-test TypeScript under `src/` and
 * `tools/` (assembled `+` chains, templates and joined string arrays read as one text), whole prompt text files, and
 * every string of a JSON prompt store. The held-out briefs are fingerprinted, never committed, so they stay unseen by
 * anyone building against this repo. Prompt versions held in a DATABASE prompt store (`src/prompts/stores/{supabase,
 * postgres}.ts`) are outside this offline guard.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DRAFT_RECORDS_INSTRUCTION } from '../../src/cee/draft/records/instruction.js';
import { briefConstantOf, fingerprintBrief, jsonStringsOf, literalsOf, scanText, type BriefFingerprint } from './eval-brief-fingerprint.js';

const ROOT = join(__dirname, '..', '..');
const FIXTURE = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'eval-brief-fingerprints.json'), 'utf8')) as { briefs: BriefFingerprint[] };
const BRIEFS = FIXTURE.briefs;
const SEALED_SOURCE = 'src/cee/draft/records/__tests__/stated-natural-effects.test.ts';
const SEALED = briefConstantOf(SEALED_SOURCE, readFileSync(join(ROOT, SEALED_SOURCE), 'utf8'))!;

/** What a model can read. Tracked files only. */
const TRACKED = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
const NOT_A_TEST = (f: string): boolean => !/(^|\/)(__tests__|tests?|__fixtures__)\//.test(f) && !/\.(test|spec)\.ts$/.test(f) && !/\.d\.ts$/.test(f);
const TS_SOURCES = TRACKED.filter((f) => /^(src|tools)\/.*\.ts$/.test(f) && NOT_A_TEST(f) && !/^src\/generated\//.test(f));
const PROMPT_FILES = TRACKED.filter((f) => /\.(txt|md|json|ya?ml)$/.test(f) && (
  /^(Prompts|src\/prompts|tools\/prompts)\//.test(f)
  || /^tools\/.*\/prompts?\//.test(f)
  || /^tools\/conversation-harness\/prompt-estate\/candidates\//.test(f)
  // A prompt or instruction stored as data anywhere else (never a doc: Docs/ and .md outside the prompt dirs are prose).
  || (/(^|\/)[^/]*(prompt|instruction)[^/]*\.(txt|json|ya?ml)$/i.test(f) && !/^Docs\//.test(f))));

/** The scannable texts of one prompt file: the whole text, and every string of a JSON store. */
const textsOfPromptFile = (f: string): string[] => {
  const raw = readFileSync(join(ROOT, f), 'utf8');
  if (!f.endsWith('.json')) return [raw];
  try { return [...jsonStringsOf(raw), raw]; } catch { return [raw]; }
};

describe('evaluation-brief fingerprints', () => {
  it('reproduce from the sealed brief in the repo (the scanner and the fixture use one tokenizer)', () => {
    expect(SEALED.length).toBeGreaterThan(500);
    const sealed = BRIEFS.find((b) => b.id === 'sealed')!;
    expect(fingerprintBrief('sealed', sealed.source, SEALED)).toEqual(sealed);
  });

  it('cover the sealed brief and both held-out briefs, each non-trivially', () => {
    expect(BRIEFS.map((b) => b.id)).toEqual(['sealed', 'heldout-1', 'heldout-2']);
    for (const b of BRIEFS) {
      expect(b.ngrams.length, b.id).toBeGreaterThanOrEqual(100);
      expect(b.pairs.length, b.id).toBeGreaterThanOrEqual(3);
      expect(b.contexts.length, b.id).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('the scanner (positive controls, formats, splits, and the generic contrast)', () => {
  const hit = (text: string): boolean => scanText(text, BRIEFS).some((h) => h.brief === 'sealed');

  it.each([
    // #2558's three served examples, each on its own.
    'each 1% price rise adds £1,200 a month to MRR',
    'each subscriber costs £6 a month',
    'do not derive £12,000 from £120,000 and 10%',
    // A paraphrase carrying the same figures in their own context.
    'For every 1% price increase, monthly revenue grows £1,200; support is £6 per subscriber per month',
    'or raise prices by 10%, launch a new tier',
    'a business on £120,000 monthly takings',
  ])('catches the sealed brief in: %s', (text) => {
    expect(hit(text)).toBe(true);
  });

  it.each([
    'a rise that adds £ 1,200 to revenue',
    'a rise that adds £1 200 to revenue',
    'a rise that adds £1\u202f200 to revenue',
    'a rise that adds £1,200.00 to revenue',
    'a rise that adds £1.2k to revenue',
    'A RISE THAT ADDS £1200 TO REVENUE',
  ])('catches a figure however it is formatted: %s', (text) => {
    expect(hit(text)).toBe(true);
  });

  it('reads string and template literals as one text when split, and never reads comments', () => {
    const src = [
      '// each 1% price rise adds £1,200 a month to monthly recurring revenue',
      'const a = "each subscriber costs about " + "£6 a month in support";',
      'const b = `each 1% price rise adds £${1200} a month`;',
      "const c = ['each starter subscriber adds', '£49 a month to monthly recurring revenue'].join(' ');",
      "const d = 'nothing here';",
    ].join('\n');
    const lits = literalsOf('probe.ts', src);
    expect(lits.some((l) => l.line === 1)).toBe(false);
    for (const line of [2, 3, 4]) expect(lits.filter((l) => l.line === line).some((l) => hit(l.text)), `line ${line}`).toBe(true);
    expect(lits.filter((l) => l.line === 5).some((l) => hit(l.text))).toBe(false);
  });

  it('reads a prompt file whole, so a sentence broken across lines is still caught', () => {
    expect(hit('Facts: each 1% price rise adds £1,200 a month to monthly recurring\nrevenue before\nchurn.')).toBe(true);
  });

  it.each([
    'each 1% fee rise adds $800 a week to revenue, or "each extra seat costs $4 a week"',
    'do not derive $8,000 from $80,000 and 10%',
    'for example "our MRR is £12,000 today"',
    'a number to reach, such as "grow by 10%"',
    'Keep at £49 (Status Quo)',
    'Assume 400 customers for this example',
    'For example, a subscription costs about £6 a week',
  ])('contrast: a generic example is not a brief: %s', (text) => {
    expect(scanText(text, BRIEFS)).toEqual([]);
  });

  it('contrast: the whole served records instruction is clean', () => {
    expect(scanText(DRAFT_RECORDS_INSTRUCTION, BRIEFS)).toEqual([]);
  });
});

describe('no evaluation brief in any prompt source', () => {
  it('enumerates every place prompt text lives (named sources asserted, magnitude floors)', () => {
    expect(TS_SOURCES.length).toBeGreaterThan(1200);
    expect(PROMPT_FILES.length).toBeGreaterThan(90);
    for (const f of ['src/cee/draft/records/instruction.ts', 'src/orchestrator-v5/agent-lane/runtime/build-model.ts',
      'tools/conversation-harness/scorer/llm-judge.ts', 'tools/graph-evaluator/src/adapters/decision-review.ts']) {
      expect(TS_SOURCES, f).toContain(f);
    }
    for (const f of ['data/prompts.json', 'Prompts/canonical/draft_graph.txt',
      'tools/conversation-harness/fixtures/coaching-baseline-instruction-0828a530.txt']) {
      expect(PROMPT_FILES, f).toContain(f);
    }
  });

  it('every text a model can read from this repo is clean', () => {
    let texts = 0;
    const hits: string[] = [];
    for (const f of TS_SOURCES) {
      for (const lit of literalsOf(f, readFileSync(join(ROOT, f), 'utf8'))) {
        texts += 1;
        for (const h of scanText(lit.text, BRIEFS)) hits.push(`${f}:${lit.line} ${h.brief} ${h.kind}`);
      }
    }
    for (const f of PROMPT_FILES) {
      for (const text of textsOfPromptFile(f)) {
        texts += 1;
        for (const h of scanText(text, BRIEFS)) hits.push(`${f} ${h.brief} ${h.kind}`);
      }
    }
    expect(texts).toBeGreaterThan(10000);
    expect([...new Set(hits)]).toEqual([]);
  }, 300_000); // a whole-repo parse: ~10 s alone, far longer on a loaded shard
});
