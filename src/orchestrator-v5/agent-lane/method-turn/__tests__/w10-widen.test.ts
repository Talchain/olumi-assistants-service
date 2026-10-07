import { describe, it } from 'vitest';
import { w10Rows } from './helpers/w10-widen-rows.js';

describe('W10: captured scout widen admission and safe diagnostics', () => {
  for (const [name, row] of Object.entries(w10Rows)) it(name, row);
});
