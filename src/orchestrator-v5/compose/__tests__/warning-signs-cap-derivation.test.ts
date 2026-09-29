/**
 * FAIL-LOUD DERIVATION GUARD for `WARNING_SIGNS_MAX` (CEE #770 review F1).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS.
 *
 * `phase3-blocks.ts` caps `pre_mortem.warning_signs` at 3. The authority for
 * that number is the decision_review prompt's own declared bound
 * (`decompose-prompts.ts` — `"warning_signs": ["string"],   // up to 3,
 * observable and actionable`), but the composer holds it as a BARE LITERAL.
 *
 * The first version of that code said the cap was "READ FROM the producer's
 * contract". It was not. Nothing read the prompt; the number was a hand
 * duplicate with two occurrences repo-wide, both in the same file. That is the
 * hand-maintained-mirror class (CLAUDE.md trap 12) wearing a derivation's
 * label — the drift would have read as green in BOTH directions:
 *
 *   - prompt moves to "up to 5" → the composer keeps truncating at 3, silently
 *     dropping two warning signs a conforming producer legitimately returned,
 *     AND fires `v5.capability.lens_companion_truncated` at a producer that did
 *     nothing wrong. A drift alarm pointed at the innocent party.
 *   - prompt moves to "up to 2" → the composer over-admits, and the bound the
 *     prompt declares stops being the bound the wire enforces.
 *
 * WHY A GUARD AND NOT AN ACTUAL DERIVATION. Parsing a number out of a prompt
 * STRING inside the production composer would mean a prompt reword silently
 * changes how much user content ships, with no review and no test. A guarded
 * constant is the safer shape: the value is reviewed code, and the guard makes
 * the mirror fail LOUD instead of rotting quietly. Same pattern as
 * `scripts/ci/assert-pnpm-overrides-readable.mjs` — derive the check, not the
 * behaviour.
 *
 * THE ANCHOR IS ITSELF ASSERTED. A parser that silently finds nothing is a
 * guard that passes by testing nothing (trap 13), and a `str.replace` that
 * no-ops against a drifted file is trap 15. So the extraction must find
 * EXACTLY ONE match, and the "no match" case is a LOUD failure with the
 * remedy in the message — never a skip.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WARNING_SIGNS_MAX } from '../phase3-blocks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_SOURCE = resolve(HERE, '../../../cee/decision-review/decompose-prompts.ts');

/**
 * The authority line, by shape rather than by line number (a line number is its
 * own little mirror). Matches the `warning_signs` key followed, on the same
 * line, by a `// up to <N>` bound.
 */
const WARNING_SIGNS_BOUND_RE = /"warning_signs"\s*:\s*\[[^\]]*\]\s*,?\s*\/\/\s*up to (\d+)/g;

describe('WARNING_SIGNS_MAX — fail-loud mirror of the prompt’s declared bound (F1)', () => {
  it('reads the prompt source at all (the anchor exists)', () => {
    // If this ever fails, the guard is not "broken" — it is telling you the
    // file it derives from has moved, which is exactly when a silent mirror
    // starts rotting.
    const src = readFileSync(PROMPT_SOURCE, 'utf8');
    expect(src.length, `prompt source unreadable or empty at ${PROMPT_SOURCE}`).toBeGreaterThan(0);
    expect(
      src.includes('"warning_signs"'),
      `the decision_review prompt at ${PROMPT_SOURCE} no longer declares a "warning_signs" key — ` +
        'WARNING_SIGNS_MAX now mirrors nothing. Re-anchor this guard or delete the cap.',
    ).toBe(true);
  });

  it('finds EXACTLY ONE declared bound — never zero (a silent no-match is a vacuous guard)', () => {
    const src = readFileSync(PROMPT_SOURCE, 'utf8');
    const matches = [...src.matchAll(WARNING_SIGNS_BOUND_RE)];
    expect(
      matches.length,
      'expected exactly one `"warning_signs": [...] // up to <N>` declaration in ' +
        `${PROMPT_SOURCE}; found ${matches.length}. Zero means the bound's WORDING changed and ` +
        'this guard silently stopped checking anything (CLAUDE.md trap 13); more than one means ' +
        'there are competing authorities and the composer mirrors an ambiguous source.',
    ).toBe(1);
  });

  it('the composer’s cap EQUALS the prompt’s declared bound', () => {
    const src = readFileSync(PROMPT_SOURCE, 'utf8');
    const matches = [...src.matchAll(WARNING_SIGNS_BOUND_RE)];
    const declared = Number(matches[0]?.[1]);
    expect(Number.isInteger(declared) && declared > 0).toBe(true);
    expect(
      WARNING_SIGNS_MAX,
      `The decision_review prompt declares "up to ${declared}" warning_signs, but the composer ` +
        `caps at ${WARNING_SIGNS_MAX} (phase3-blocks.ts WARNING_SIGNS_MAX). They have DRIFTED. ` +
        'Left un-fixed the composer either drops content a conforming producer returned and ' +
        'fires v5.capability.lens_companion_truncated at the innocent party, or admits more ' +
        'than the contract declares. Change the constant to match the prompt (or change both, ' +
        'deliberately).',
    ).toBe(declared);
  });
});
