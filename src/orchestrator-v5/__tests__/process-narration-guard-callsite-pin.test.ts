/** C1: the chip dispatcher retains narration-before-egress ordering; the legacy edit finaliser was deleted. */
import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const CHIP_CLICK = readFileSync(new URL('../handlers/chip-click-dispatch.ts', import.meta.url), 'utf8');
describe('surviving dispatcher narration guards', () => {
  it.each([
    ['chip-click-dispatch', CHIP_CLICK],
  ])(
    '6 · %s runs the narration guard BEFORE its forbidden-phrase guard',
    (_name, source) => {
      // C1: the retained chip finaliser must still judge narration before
      // the forbidden-phrase guard can replace its text.
      const narration = source.indexOf('applyProcessNarrationGuard(');
      const forbidden = source.indexOf('applyEgressForbiddenPhraseGuard(');
      expect(narration).toBeGreaterThan(-1);
      expect(forbidden).toBeGreaterThan(-1);
      expect(narration).toBeLessThan(forbidden);
    },
  );
});
