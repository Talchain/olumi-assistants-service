import { describe, it, expect } from 'vitest';
import { rows } from './fixtures/b1-two-state/rows.js';

describe('B1: two-state factor levels are switches', () => {
  for (const row of rows) it(row.name, () => expect(row.check).not.toThrow());
});
