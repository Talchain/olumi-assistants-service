/**
 * The control list is derived where the product exports it and cross-checked against the
 * route source where it does not — so a renamed chip fails here, not silently in a baseline.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTE_CHIP_LABELS, knownChipLabels } from '../src/controls.js';

const here = dirname(fileURLToPath(import.meta.url));
const route = readFileSync(join(here, '..', '..', '..', 'src', 'routes', 'agent-v1-turn.ts'), 'utf8');

describe('known controls', () => {
  it('every route-owned chip label is still defined in the route source', () => {
    for (const label of ROUTE_CHIP_LABELS) expect([label, route.includes(`label: '${label}'`)]).toEqual([label, true]);
  });
  it('the contrast: a label the route does not define is not found by the same probe', () => {
    expect(route.includes(`label: 'Press here to win'`)).toBe(false);
  });
  it('includes the approval chips derived from approvalChipsFor and the amend chip', () => {
    const labels = knownChipLabels();
    for (const l of ['Use as starting assumptions', 'Use as starting option levels', 'Make this change', 'Add this option', 'Change something first']) {
      expect(labels).toContain(l);
    }
  });
});
