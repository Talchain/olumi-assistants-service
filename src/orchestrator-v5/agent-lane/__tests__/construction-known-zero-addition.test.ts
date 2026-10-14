import { describe, it } from 'vitest';
import { class1Rows } from './fixtures/class1-known-zero-cases.js';

describe('Class 1 — a stated addition to known zero remains the user\'s figure', () => {
  for (const row of class1Rows) it(row.name, row.check);
});
