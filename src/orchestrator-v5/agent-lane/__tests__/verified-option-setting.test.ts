import { describe, it } from 'vitest';
import { censusRows, probeRows, integrityRows, seamRows, rawRows, registrationRows } from './fixtures/r5-verified-cases.js';

for (const [name, rows] of [
  ['census: five required credits, two known under-credits, eight refusals', censusRows],
  ['all 44 probes and 12 witness inputs: including each of the 28 FALSE-CREDIT IDs', probeRows],
  ['E/F evidence integrity', integrityRows], ['construction seam and hash controls', seamRows],
  ['unchanged raw outputs and strict-schema compatibility', rawRows], ['registration witnesses', registrationRows],
] as const) {
  describe(name, () => { for (const row of rows) it(row.name, row.run); });
}
