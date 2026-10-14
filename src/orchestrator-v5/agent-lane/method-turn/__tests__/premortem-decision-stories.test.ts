import { describe, expect, it } from 'vitest';
import { rows } from './helpers/w9c-rows.js';

describe('W9c: a near-tie Run pre-mortem tells decision-level failure stories', () => {
  for (const [name, check] of Object.entries(rows)) {
    it(name, () => {
      expect(check).not.toThrow();
    });
  }
});
