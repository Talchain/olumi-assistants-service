import { describe, it } from 'vitest';
import { r2Rows } from './helpers/w9c-r2-rows.js';

describe('W9c R2: exact independent-review corrections', () => {
  for (const [name, check] of Object.entries(r2Rows)) it(name, check);
});
