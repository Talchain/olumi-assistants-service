/**
 * ⛔ THE DRAFTER WRITES A PRICE'S ITEM (DL 5887489508; AIQ 5887464051; MG owner ruling 5887574242: money only).
 *
 * Served CEE `0497e52`, Paul's brief ×5: 0/5 drafts wrote the price per subscriber ("GBP/month"), so #2286's dimensional
 * proof never held and 4/5 read "£85k not met under any option". Measured in-process (the real drafter call, registered
 * graph, POOL=1): with this text, 5/5 carry MRR = price × subscribers (declared or minted) against 2/5 and 2/5 without it (two paired rounds);
 * churn stays "%" 5/5 and its "below 5%" limit is kept 5/5. A first wording that did not say "money only" wrote "% per
 * month" churn 2/5, which `readUnit` reads as plain, not percent.
 *
 * The row pins the EXACT text that was measured: a different text is a different experiment.
 */
import { describe, it, expect } from 'vitest';
import { buildCandidateSchema } from '../runtime/build-model.js';

const MEASURED = 'The unit of baseline_value, as the brief writes it ("%", a count such as "subscribers", "<currency>/<period>"). '
  + 'ONLY a money amount charged, paid or earned PER ITEM names that item: "<currency> per <item> per <period>", where <item> is what another factor counts.';

describe('the drafter\'s factor unit names a price\'s item, and only a price\'s', () => {
  it('the factor `unit` description is the measured text, byte for byte', () => {
    const schema = buildCandidateSchema() as { properties: { factors: { items: { properties: { unit: { description?: string } } } } } };
    expect(schema.properties.factors.items.properties.unit.description).toBe(MEASURED);
  });
});
