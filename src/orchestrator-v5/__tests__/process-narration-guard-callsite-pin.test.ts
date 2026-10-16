/** C1: retain the ordering guard for both surviving dispatchers; the conventional finaliser was deleted. */
import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const EDIT_GRAPH = readFileSync(new URL('../handlers/edit-graph-dispatch.ts', import.meta.url), 'utf8');
const CHIP_CLICK = readFileSync(new URL('../handlers/chip-click-dispatch.ts', import.meta.url), 'utf8');
describe('surviving dispatcher narration guards', () => {
  it.each([
    ['edit-graph-dispatch', EDIT_GRAPH],
    ['chip-click-dispatch', CHIP_CLICK],
  ])(
    '6 · %s runs the guard BEFORE its forbidden-phrase guard, matching the executor',
    (_name, source) => {
      // Same ordering argument, pinned at the two sites the review found
      // unpinned. Both dispatchers apply the forbidden-phrase guard at their
      // own finaliser; the narration guard must precede it there too.
      const narration = source.indexOf('applyProcessNarrationGuard(');
      const forbidden = source.indexOf('applyEgressForbiddenPhraseGuard(');
      expect(narration).toBeGreaterThan(-1);
      expect(forbidden).toBeGreaterThan(-1);
      expect(narration).toBeLessThan(forbidden);
    },
  );
});
