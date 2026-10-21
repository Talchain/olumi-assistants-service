/**
 * Raw robustness wiring: the kept version-result binding must thread the
 * selected Run facts through `pickLatestRawRobustness` into canonical analysis
 * state. The helper's own behaviour is covered by pick-raw-robustness.test.ts;
 * the advice gate these contract rows once drove has been deleted.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// =========================================================================
// Turn-executor call-site wiring assertion.
//
// The helper's unit tests do NOT catch a regression where someone
// removes the `rawRobustness: pickLatestRawRobustness(context.prior_facts)`
// line from `turn-executor.ts`. This source-level assertion does. It is
// deliberately literal — a future formatting change that splits the
// expression across lines or renames the parameter would also break it,
// at which point the maintainer must either restore the literal form or
// update this assertion (a one-line, deliberate change, never silent).
// =========================================================================
// C1 deleted the executor integration; the kept version-result binding carries this raw signal into canonical state.
describe('version-result binding call-site — rawRobustness wiring', () => {
  it('threads the selected Run facts through pickLatestRawRobustness into canonical state', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = await readFile(path.resolve(here, '../../model-management/version-result-binding.ts'), 'utf8');
    const activeLines = source.split('\n').map(line => line.trim()).filter(line => !line.startsWith('//'));
    expect(activeLines.find(line => /import\s*\{\s*pickLatestRawRobustness\s*\}\s*from\s*['"]\.\.\/coaching\/pick-raw-robustness\.js['"]/.test(line))).toBeDefined();
    expect(activeLines.find(line => /rawRobustness\s*:\s*pickLatestRawRobustness\s*\(\s*facts\s*\)/.test(line))).toBeDefined();
  });
});
