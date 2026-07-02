/**
 * T4 Slice 2 — `projectRecentChangesToFrame` shape-adaptation tests.
 *
 * The projection is the ONE `RecentMutation` → `FrameChanges` mapping site
 * (types.ts `ProjectRecentChangesToFrame` contract). It must be a pure
 * field-for-field adaptation: no filtering, no truncation, no re-capping —
 * the input is already the capped, identifier-free pack projection.
 */
import { describe, expect, it } from 'vitest';

import { projectRecentChangesToFrame } from '../project-recent-changes.js';
import type { RecentMutation } from '../../recent-changes.js';

const MUTATIONS: readonly RecentMutation[] = [
  {
    action: 'constraint_added',
    summary: 'Added a constraint on Total cost.',
    target_label: 'Total cost',
  },
  {
    action: 'graph_edited',
    summary: 'Edited the graph.',
    target_label: '',
  },
];

describe('projectRecentChangesToFrame (T4 Slice 2)', () => {
  it('maps every entry field-for-field (snake_case target_label → camelCase targetLabel)', () => {
    const projected = projectRecentChangesToFrame(MUTATIONS);
    expect(projected).toEqual([
      {
        action: 'constraint_added',
        summary: 'Added a constraint on Total cost.',
        targetLabel: 'Total cost',
      },
      { action: 'graph_edited', summary: 'Edited the graph.', targetLabel: '' },
    ]);
  });

  it('preserves order and length — no filtering, no re-capping', () => {
    const projected = projectRecentChangesToFrame(MUTATIONS);
    expect(projected).toHaveLength(MUTATIONS.length);
    expect(projected.map((c) => c.action)).toEqual(MUTATIONS.map((m) => m.action));
  });

  it('empty input → frozen empty array', () => {
    const projected = projectRecentChangesToFrame([]);
    expect(projected).toEqual([]);
    expect(Object.isFrozen(projected)).toBe(true);
  });

  it('output is deeply frozen (array AND elements) and input is not mutated (pure)', () => {
    const before = JSON.stringify(MUTATIONS);
    const projected = projectRecentChangesToFrame(MUTATIONS);
    expect(Object.isFrozen(projected)).toBe(true);
    // Element-level freeze: the one frame instance is shared across a turn's
    // consumers, so runtime mutation of a change entry must throw (strict
    // mode), not silently poison later consumers.
    for (const entry of projected) expect(Object.isFrozen(entry)).toBe(true);
    expect(JSON.stringify(MUTATIONS)).toBe(before);
  });

  it('source-scan guard: project-recent-changes.ts imports ONLY type-level modules (allowlist)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../project-recent-changes.ts', import.meta.url)),
      'utf8',
    );
    // Same allowlist-beats-denylist rule as the build-frame source-scan guard:
    // the projection may see the recent-changes TYPES and the frame types —
    // never a derivation authority (it must not be able to re-project from
    // prior_facts or re-derive anything).
    const ALLOWED = new Set(['../recent-changes.js', './types.js']);
    const specifiers = [...src.matchAll(/import[\s\S]*?'([^']+)'\s*;/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(ALLOWED.has(spec), `non-allowlisted import: ${spec}`).toBe(true);
    }
    // Type-only imports from recent-changes: the runtime projection function
    // (projectRecentChanges) must NOT be imported — this module adapts shapes,
    // it never re-runs the authority projection.
    expect(src).not.toContain('projectRecentChanges,');
    expect(src).not.toMatch(/import\s+\{[^}]*\bprojectRecentChanges\b[^}]*\}\s+from/);
    expect(src, 'no namespace import').not.toMatch(/import\s+\*\s+as\s/);
    expect(src, 'no dynamic import()').not.toMatch(/\bimport\s*\(/);
    expect(src, 'no require()').not.toMatch(/\brequire\s*\(/);
  });
});
