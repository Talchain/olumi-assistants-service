/**
 * FAIL-LOUD GUARD for the one unavoidable mirror of runtime state.
 *
 * `countDescriptiveNumbers` (scorer.ts) has to reproduce three constants that
 * are MODULE-PRIVATE in `src/cee/decision-review/shape-check.ts`:
 * `DESCRIPTIVE_FIELD_KEYS`, `NUMBER_PATTERN` and `PERCENTAGE_PATTERN`. It has to
 * because `checkNumberGrounding` returns only warnings — a clean result is
 * indistinguishable from "there were no numbers here", which is exactly the
 * vacuity the `scanned` instrument exists to expose.
 *
 * That makes it a hand-maintained mirror sitting INSIDE the anti-vacuity
 * machinery — trap 12 in the last place it should appear, and with no guard it
 * would be the quietest kind: if the runtime widened its descriptive-field list,
 * the counter would keep returning a plausible non-zero number for a corpus the
 * runtime no longer scans, and every anti-vacuity assertion would stay green
 * while measuring the wrong thing.
 *
 * The clean fix is to export the three constants and import them. That is a
 * `src/` change, which this lane's file-set boundary forbids — so the mirror is
 * made LOUD instead: this file reads `shape-check.ts` as TEXT at test time and
 * asserts the copies match the source bytes. Drift turns it RED with both
 * versions printed.
 *
 * Reading source as text is deliberately crude, and that is a feature: it cannot
 * be satisfied by a type that merely compiles, and it keeps working across a
 * refactor that renames the exports.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RUNTIME_DESCRIPTIVE_FIELDS,
  RUNTIME_NUMBER_PATTERN_SOURCE,
  RUNTIME_PERCENTAGE_PATTERN_SOURCE,
} from '../src/decision-review/scorer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHAPE_CHECK_PATH = join(HERE, '..', '..', '..', 'src', 'cee', 'decision-review', 'shape-check.ts');

// `grep -a` discipline: read as text and never assume the file is clean ASCII —
// CEE carries deliberate NUL sentinels in at least one source file, and a
// plain read that silently mis-decodes would make every assertion below vacuous.
const source = readFileSync(SHAPE_CHECK_PATH, 'utf-8');

describe('the runtime file is actually readable (anti-vacuity for this guard itself)', () => {
  it('reads a non-trivial source file', () => {
    // Without this, a path typo would make every assertion below pass against
    // an empty string.
    expect(source.length).toBeGreaterThan(5000);
    expect(source).toContain('export function checkNumberGrounding');
  });
});

describe('DESCRIPTIVE_FIELD_KEYS mirror', () => {
  it('the runtime still declares the constant we mirror', () => {
    expect(
      source,
      'shape-check.ts no longer declares DESCRIPTIVE_FIELD_KEYS — the mirror has nothing to track',
    ).toContain('const DESCRIPTIVE_FIELD_KEYS');
  });

  it('our copy matches the runtime list EXACTLY, in order', () => {
    const block = source.slice(source.indexOf('const DESCRIPTIVE_FIELD_KEYS'));
    const literal = block.slice(block.indexOf('['), block.indexOf(']') + 1);
    const runtimeKeys = [...literal.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(runtimeKeys.length, 'parsed no keys out of the runtime literal').toBeGreaterThan(0);
    expect(
      runtimeKeys,
      'the runtime descriptive-field list has DRIFTED from the eval mirror in scorer.ts — ' +
        'update RUNTIME_DESCRIPTIVE_FIELDS to match, and re-check what the scanned counter now measures',
    ).toEqual([...RUNTIME_DESCRIPTIVE_FIELDS]);
  });

  it('the runtime still applies it to bias_findings[].description as well', () => {
    // The counter reproduces this second pass too; if the runtime dropped it,
    // our count would overstate the corpus.
    expect(source).toContain('bias_findings[].description');
  });
});

describe('number-pattern mirrors', () => {
  it('NUMBER_PATTERN matches the runtime source bytes', () => {
    const line = source.split('\n').find((l) => l.includes('const NUMBER_PATTERN'));
    expect(line, 'shape-check.ts no longer declares NUMBER_PATTERN').toBeDefined();
    const body = line!.slice(line!.indexOf('/') + 1, line!.lastIndexOf('/'));
    expect(
      body,
      'the runtime number regex has DRIFTED from the eval mirror — the scanned counter is now ' +
        'counting a different set of numbers than the grounding rule inspects',
    ).toBe(RUNTIME_NUMBER_PATTERN_SOURCE);
  });

  it('PERCENTAGE_PATTERN matches the runtime source bytes', () => {
    const line = source.split('\n').find((l) => l.includes('const PERCENTAGE_PATTERN'));
    expect(line, 'shape-check.ts no longer declares PERCENTAGE_PATTERN').toBeDefined();
    const body = line!.slice(line!.indexOf('/') + 1, line!.lastIndexOf('/'));
    expect(body).toBe(RUNTIME_PERCENTAGE_PATTERN_SOURCE);
  });

  it('the mirrored patterns are boundary-anchored, not bare number regexes', () => {
    // The first draft of the counter used /-?\d+(?:\.\d+)?/g, which counts
    // digits inside ids (`opt_3`) and every percentage twice — overstating the
    // corpus in exactly the direction that makes a vacuous dimension look
    // well-fed. This pins that the mirror is the anchored form.
    expect(RUNTIME_NUMBER_PATTERN_SOURCE).toContain('(?<!');
    expect(RUNTIME_NUMBER_PATTERN_SOURCE).toContain('(?!');
    expect(RUNTIME_PERCENTAGE_PATTERN_SOURCE).toContain('(?<!');
  });
});
