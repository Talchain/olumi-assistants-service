/**
 * ⭐⭐ THE `chip_prompt_option_effect_bind_*` ID HAS EXACTLY ONE OWNER.
 *
 * ⚠⚠ WHY THIS FILE EXISTS, stated as the defect it closes rather than as a
 * feature it covers (CLAUDE.md trap 12 — the hand-maintained mirror). The id
 * was minted at TWO sites: `compose/option-effect-ask-response.ts`'s template,
 * and a bare literal `'chip_prompt_option_effect_bind_1'` in
 * `turn-executor.ts`'s `dispatch === 'clarify'` outstanding-ask redirect. Two
 * spellings of one id, and the LITERAL is the copy that rots: had the template
 * changed format, the literal would have kept emitting the old id SILENTLY.
 *
 * ⭐ WHY THAT IS NOT COSMETIC. A chip id is a JOIN KEY. It is copied verbatim
 * into `PendingAction.chip_id` (`compose/derive-pending-actions.ts`), matched
 * by the two-turn chip-suppression window (`last_chip_ids_shown` /
 * `chip_ids_shown_prev_turn` / `chip_ids_clicked` in
 * `orchestrator/deterministic/session-state.ts`), read back as
 * `recentlyOfferedChipIds()` in `turn-executor.ts`, and carried as the
 * `proposal_ref === chip_id` identity bridge in `session/pending-action.ts`.
 * Every one of those matches on the EMITTED STRING, so a divergence between the
 * two emit paths is invisible until a user's click does nothing.
 *
 * ⚠ WHAT THIS GUARD IS AND IS NOT. `SINGLE_OWNER` is an ABSENCE claim, so it
 * carries a positive control and a magnitude check — a probe that scans nothing
 * returns the same clean output as a probe that looked (trap 13 / 13e). And an
 * absence-of-literal check cannot see an id ASSEMBLED by concatenation, so the
 * structural check on the second emit site is NOT redundant with it: derivation
 * proves the copies agree, and only a direct check proves the second site is
 * fed by the owner at all (trap 12d — ship both, neither supersedes the other).
 *
 * ⚠ NO HAND-COPIED EXPECTATION ANYWHERE IN THIS FILE. Every assertion about the
 * id calls `buildOptionEffectBindChipId`. A test comparing two literals to a
 * third literal is the same defect one level up: it would pin TODAY'S STRING
 * rather than the RELATIONSHIP, and a legitimate format change would RED it
 * while both emit paths moved together perfectly correctly.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MAX_OPTION_EFFECT_ASK_CHIPS,
  buildOptionEffectBindChipId,
  composeOptionEffectAskResponse,
} from '../option-effect-ask-response.js';
import type { OptionEffectCandidate } from '../../routing/option-effect-write.js';

/** Repo `src/` root, resolved from this file rather than from a cwd guess. */
const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const OWNER_REL = 'orchestrator-v5/compose/option-effect-ask-response.ts';
const SECOND_EMIT_SITE_REL = 'orchestrator-v5/turn-executor.ts';

/**
 * The id written as a QUOTED LITERAL — single, double or backtick. This is the
 * shape the defect took, and the shape a future hand-copy would take.
 */
const LITERAL_MINT = /['"`]chip_prompt_option_effect_bind/;

/** Every `.ts` under `src/`, excluding test files. Product modules only. */
function productModules(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      if (entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
      out.push(full.slice(SRC_ROOT.length));
    }
  };
  walk(SRC_ROOT);
  return out;
}

function candidates(n: number): OptionEffectCandidate[] {
  return Array.from({ length: n }, (_unused, i) => ({
    optionId: `opt_${i}`,
    optionLabel: `Option ${i}`,
    factorId: `fac_${i}`,
    factorLabel: `Factor ${i}`,
  })) as unknown as OptionEffectCandidate[];
}

describe('chip_prompt_option_effect_bind — single owner', () => {
  it('EMIT PATH A (compose): every offered chip id is the builder output at its own index', () => {
    // Bound BY IDENTITY to the ordinal position, never by a value predicate
    // another chip could satisfy (trap 19): chip[i].id must be builder(i).
    const response = composeOptionEffectAskResponse({
      ambiguity: 'option',
      optionSource: 'named_in_message',
      value: 0.8,
      candidates: candidates(MAX_OPTION_EFFECT_ASK_CHIPS),
      optionLabels: ['Option 0', 'Option 1', 'Option 2'],
      stage: 'evaluate' as never,
    });

    const ids = (response.suggested_actions ?? []).map((a) => (a as { id: string }).id);

    // Precondition pinned in-test (trap 13b): a composer that returned no chips
    // would satisfy a `toEqual` against an empty derived list vacuously.
    expect(ids.length).toBe(MAX_OPTION_EFFECT_ASK_CHIPS);
    expect(ids).toEqual(
      Array.from({ length: MAX_OPTION_EFFECT_ASK_CHIPS }, (_u, i) => buildOptionEffectBindChipId(i)),
    );
  });

  it('EMIT PATH B (turn-executor): the outstanding-ask redirect mints through the owner', () => {
    // An absence-of-literal check cannot see an id built by concatenation, so
    // the second emit site is checked DIRECTLY: it must import the owner and
    // call it. Read at the bytes — never inferred from the import graph.
    const source = readFileSync(join(SRC_ROOT, SECOND_EMIT_SITE_REL), 'utf-8');

    expect(source).toContain(
      "import { buildOptionEffectBindChipId } from './compose/option-effect-ask-response.js';",
    );
    // The redirect branch offers exactly one chip, so offer index 0.
    expect(source).toContain('id: buildOptionEffectBindChipId(0),');
  });

  it('BOTH PATHS agree byte-for-byte on the first offered id', () => {
    // The relationship, not the string. Path A's first chip and Path B's sole
    // chip are the SAME offer position, so they must be the same bytes — and
    // both are read from the owner, so this holds through a format change.
    const response = composeOptionEffectAskResponse({
      ambiguity: 'option',
      optionSource: 'outstanding_ask',
      value: 0.8,
      candidates: candidates(1),
      optionLabels: ['Option 0'],
      stage: 'evaluate' as never,
    });
    const pathAFirst = (response.suggested_actions ?? []).map((a) => (a as { id: string }).id)[0];

    // Path B's index, named by the same builder the executor calls.
    const pathBOnly = buildOptionEffectBindChipId(0);

    expect(pathAFirst).toBe(pathBOnly);
    // Non-empty, so the equality above cannot pass on two undefineds.
    expect(typeof pathAFirst).toBe('string');
    expect(pathAFirst!.length).toBeGreaterThan(0);
  });

  it('SINGLE OWNER: no product module outside the owner mints the id as a literal', () => {
    const modules = productModules();

    // ── MAGNITUDE (trap 13e): a walk that reached almost nothing returns the
    //    same clean zero as a walk that looked. 911 non-test `.ts` files at
    //    a7ee21e9; the floor is deliberately well below that so file churn
    //    does not RED this, while a collapsed walk still does.
    expect(modules.length).toBeGreaterThan(500);

    // ── POSITIVE CONTROL: the probe must be able to SEE a presence. The owner
    //    itself contains the literal-shaped template, so a regex that has
    //    stopped matching cannot fake this.
    const ownerSource = readFileSync(join(SRC_ROOT, OWNER_REL), 'utf-8');
    expect(LITERAL_MINT.test(ownerSource)).toBe(true);

    // ── CONTRAST CONTROL: a same-family id that IS present across product
    //    modules. Absence of the target is credible only when a sibling the
    //    same walk should find reads non-zero in the SAME run.
    const contrast = modules.filter((rel) =>
      /['"`]chip_prompt_/.test(readFileSync(join(SRC_ROOT, rel), 'utf-8')),
    );
    expect(contrast.length).toBeGreaterThan(0);

    // ── THE CLAIM.
    const offenders = modules.filter(
      (rel) => rel !== OWNER_REL && LITERAL_MINT.test(readFileSync(join(SRC_ROOT, rel), 'utf-8')),
    );
    expect(offenders).toEqual([]);
  });
});
