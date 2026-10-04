/**
 * ⛔ NO EVALUATION BRIEF IN ANY PROMPT (DL 0df0e1, 4 Oct: the records drafting instruction carried the sealed brief's
 * figures as worked examples since #2558, so the demo brief's draft looked right for the wrong reason).
 *
 * Every string and template literal of non-test `src/` TypeScript, and every prompt text file, is scanned against
 * fingerprints of the SEALED brief and both blind-written HELD-OUT briefs (`./eval-brief-fingerprint.ts`): no 6-token
 * window, no 4+ digit currency figure, and no distinctive figure with its neighbouring word may reappear. The held-out
 * briefs are fingerprinted, never committed, so they stay unseen by anyone building against this repo.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DRAFT_RECORDS_INSTRUCTION } from '../../src/cee/draft/records/instruction.js';
import { briefConstantOf, fingerprintBrief, literalsOf, scanText, type BriefFingerprint } from './eval-brief-fingerprint.js';

const ROOT = join(__dirname, '..', '..');
const FIXTURE = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'eval-brief-fingerprints.json'), 'utf8')) as { briefs: BriefFingerprint[] };
const BRIEFS = FIXTURE.briefs;
const SEALED_SOURCE = 'src/cee/draft/records/__tests__/stated-natural-effects.test.ts';
const SEALED = briefConstantOf(SEALED_SOURCE, readFileSync(join(ROOT, SEALED_SOURCE), 'utf8'))!;

/** What a model can read: literals of non-test src TypeScript, and prompt text files. Tracked files only. */
const TRACKED = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
const TS_SOURCES = TRACKED.filter((f) => /^src\/.*\.ts$/.test(f) && !/\.d\.ts$/.test(f) && !/(^|\/)__tests__\//.test(f)
  && !/\.(test|spec)\.ts$/.test(f) && !/^src\/generated\//.test(f));
const PROMPT_FILES = TRACKED.filter((f) => /^(Prompts\/|src\/prompts\/|tools\/prompts\/|tools\/graph-evaluator\/prompts\/|tools\/conversation-harness\/prompt-estate\/candidates\/).*\.(txt|md|json|ya?ml)$/.test(f));

describe('evaluation-brief fingerprints', () => {
  it('reproduce from the sealed brief in the repo (the scanner and the fixture use one tokenizer)', () => {
    expect(SEALED.length).toBeGreaterThan(500);
    const sealed = BRIEFS.find((b) => b.id === 'sealed')!;
    const again = fingerprintBrief('sealed', sealed.source, SEALED);
    expect(again.ngrams).toEqual(sealed.ngrams);
    expect(again.bigrams).toEqual(sealed.bigrams);
    expect(again.trigrams).toEqual(sealed.trigrams);
  });

  it('cover the sealed brief and both held-out briefs, each non-trivially', () => {
    expect(BRIEFS.map((b) => b.id)).toEqual(['sealed', 'heldout-1', 'heldout-2']);
    for (const b of BRIEFS) {
      expect(b.ngrams.length, b.id).toBeGreaterThanOrEqual(100);
      expect(b.bigrams.length + b.trigrams.length, b.id).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('the scanner (positive controls and the generic contrast)', () => {
  it('catches a sealed sentence, a large sealed figure beside its word, and a small one between its words', () => {
    // #2558's served examples, each caught on its own.
    expect(scanText('each 1% price rise adds £1,200 a month to MRR', BRIEFS)).toContainEqual({ brief: 'sealed', kind: 'ngram' });
    expect(scanText('a rise that adds £1,200 to revenue', BRIEFS)).toContainEqual({ brief: 'sealed', kind: 'bigram' });
    expect(scanText('a business on £120,000 monthly takings', BRIEFS)).toContainEqual({ brief: 'sealed', kind: 'bigram' });
    expect(scanText('a seat costs about £6 a month', BRIEFS)).toContainEqual({ brief: 'sealed', kind: 'trigram' });
    expect(scanText('or raise prices by 10%, launch a new tier', BRIEFS)).toContainEqual({ brief: 'sealed', kind: 'trigram' });
  });

  it('contrast: a bare round figure, or one beside different words, is not a brief', () => {
    expect(scanText('for example "our MRR is £12,000 today"', BRIEFS)).toEqual([]);
    expect(scanText('a number to reach, such as "grow by 10%"', BRIEFS)).toEqual([]);
    expect(scanText('Keep at £49 (Status Quo)', BRIEFS)).toEqual([]);
  });

  it('reads string and template literals, never comments', () => {
    const src = [
      '// each 1% price rise adds £1,200 a month to monthly recurring revenue',
      'const a = `Example: ${x} each 1% price rise adds £1,200 a month`;',
      "const b = 'nothing here';",
    ].join('\n');
    const lits = literalsOf('probe.ts', src);
    expect(lits.map((l) => l.line)).toEqual([2, 3]);
    expect(scanText(lits[0]!.text, BRIEFS)).toContainEqual({ brief: 'sealed', kind: 'ngram' });
    expect(scanText(lits[1]!.text, BRIEFS)).toEqual([]);
  });

  it('contrast: generic worked examples pass, and so does the whole served records instruction', () => {
    expect(scanText('each 1% fee rise adds $800 a week to revenue, or "each extra seat costs $4 a week"', BRIEFS)).toEqual([]);
    expect(scanText('do not derive $8,000 from $80,000 and 10%', BRIEFS)).toEqual([]);
    expect(scanText(DRAFT_RECORDS_INSTRUCTION, BRIEFS)).toEqual([]);
  });
});

describe('no evaluation brief in any prompt source', () => {
  it('every literal of non-test src TypeScript and every prompt file is clean', () => {
    // Magnitude: an enumeration that read nothing would pass vacuously.
    expect(TS_SOURCES.length).toBeGreaterThan(1000);
    expect(PROMPT_FILES.length).toBeGreaterThan(50);
    expect(TS_SOURCES).toContain('src/cee/draft/records/instruction.ts');
    let literals = 0;
    const hits: string[] = [];
    for (const f of TS_SOURCES) {
      for (const lit of literalsOf(f, readFileSync(join(ROOT, f), 'utf8'))) {
        literals += 1;
        for (const h of scanText(lit.text, BRIEFS)) hits.push(`${f}:${lit.line} ${h.brief} ${h.kind}`);
      }
    }
    for (const f of PROMPT_FILES) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        // A window can straddle a line break: scan each line with the next one.
        for (const h of scanText(`${line}\n${lines[i + 1] ?? ''}`, BRIEFS)) hits.push(`${f}:${i + 1} ${h.brief} ${h.kind}`);
      });
    }
    expect(literals).toBeGreaterThan(10000);
    expect([...new Set(hits)]).toEqual([]);
  }, 180_000); // a whole-repo parse: ~10 s alone, far longer on a loaded shard
});
