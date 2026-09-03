/**
 * THE COMPLETENESS CHECK FOR `coaching-chip-registry.ts`, AND IT COMES FROM
 * OUTSIDE THE LIST ON PURPOSE.
 *
 * `CHIP_ID_INTENT` is a hand-written map. Any guard DERIVED from it could only
 * ever prove that its consumers agree with it — it is structurally incapable
 * of noticing the map is SHORT (CLAUDE.md trap 12d, measured on this estate
 * when a derived per-key guard stayed green with `thousand` missing from the
 * magnitude alphabet). The thing that catches a short list is a check whose
 * evidence comes from somewhere else.
 *
 * So this guard scans the SOURCE TREE. For every chip-id literal whose slug
 * names a routed coaching method, the registry must resolve it. A composer
 * that hand-rolls a new coaching chip — the exact way the pre-mortem chip came
 * to exist at four sites under two id spellings — goes RED the day it lands.
 *
 * ── ⚠⚠ "NAMES A ROUTED METHOD" IS TWO VOCABULARIES, NOT ONE ────────────────
 * An earlier version of this guard classified on the CEE INTENT TOKEN alone
 * and then claimed, one sentence later, that ANY hand-rolled coaching chip
 * would RED. **That was false for four of the seven methods**, and the review
 * that caught it was right: the product affordance and the CEE intent are
 * DIFFERENT STRINGS, and a chip id is minted from the affordance name.
 *
 * Derived at the DGAI bytes rather than inherited — `Talchain/DecisionGuideAI`
 * `staging` `158a593c`, `src/canvas/components/pre-analysis-v3/constants.ts`
 * (blob `db9d7503`), reading each spark's `id` and its declared `intent`:
 *
 *   pressure_test_frame → challenge_frame        ⚠ differs
 *   widen_options       → elicit_options         ⚠ differs
 *   reflect_bias        → challenge_assumption   ⚠ differs
 *   risks_upside        → elicit_risks           ⚠ differs
 *   define_success      → define_success
 *   outside_view        → outside_view
 *   pre_mortem          → pre_mortem
 *   (calibrate_estimates → estimate_help is NOT routed — see
 *    `typed-intent-directive.ts` on why, and it is correctly absent here.)
 *
 * So `promptChip('widen_options', …)` mints `chip_prompt_widen_options`, which
 * the token-only classifier scored as NOT-a-coaching-chip and passed in
 * silence. Four of the six chips this PR's FINDING 2 invites are exactly those
 * four spellings, so the blind spot pointed straight at the follow-on work.
 *
 * ── WHAT IS DERIVED, WHAT IS MIRRORED, AND WHERE THE MIRROR FAILS LOUD ──────
 * The INTENT vocabulary is derived from `ROUTED_COACHING_INTENTS` and never
 * restated. The AFFORDANCE spellings cannot be: they live in another repo and
 * there is nothing importable, so `AFFORDANCE_ALIASES` below is a hand-written
 * mirror and this comment says so rather than dressing it up.
 *
 * It is a FAIL-LOUD mirror on the dimension that actually grows. Its keys are
 * asserted EQUAL to `ROUTED_COACHING_INTENTS`, derived — so an eighth routed
 * method REDs this file until someone states its affordance spelling (or
 * states that it has none, with an empty array). What it cannot catch is a
 * RENAME of an existing spark in DGAI, which would silently re-open the blind
 * spot for that one method. That residual is stated, not closed.
 *
 * ⚠ SCOPE OF THE GREEN, stated so it cannot be generalised again: a clean
 * sheet here means **no chip id in `src/` spells a routed intent token or one
 * of the four recorded affordance names and goes unresolved**. It is not a
 * proof that no unroutable coaching affordance exists.
 *
 * ── WHY THE TOKENS ARE DERIVED AND THE PATTERN IS NOT ──────────────────────
 * The intent vocabulary comes from `ROUTED_COACHING_INTENTS`, never restated
 * here. The chip-id SHAPE (`chip_action_*` / `chip_prompt_*`) is restated,
 * because it is minted by `chipId()` in `compose/chip-generator.ts` as a
 * template and there is nothing importable to derive it from. That residual
 * mirror is guarded by this file's own non-vacuity control: if the shape ever
 * changes, the scan finds zero known ids and REDs before it can report a
 * clean sheet.
 *
 * ── THE CONTROLS ───────────────────────────────────────────────────────────
 * An absence claim with no positive control is vacuous, and a control that
 * merely fires can still be too lossy to support the claim (traps 13, 13e).
 * Two run here:
 *
 *   NON-VACUITY  the scan must find EVERY id the registry claims, in the real
 *                tree. A scan that found nothing would report "no unregistered
 *                coaching chips" while looking at an empty set.
 *   CONTRAST     the same scan, same run, must ALSO find a same-family chip id
 *                that is NOT a coaching method (`chip_action_explain_results`).
 *                Target-zero is only evidence when the contrast reads non-zero
 *                in the SAME sweep.
 *
 * Matching runs on the COMMENT-STRIPPED view: this very docblock names
 * `chip_action_run_pre_mortem`, and a raw-text scan would score a design note
 * as a producer (the source-scanning-guard footgun, positive-controlled across
 * sixteen CEE guards on 2026-07-20).
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { stripCommentsFile } from '../../scripts/ci/strip-source-comments.mjs';
import {
  REGISTERED_COACHING_CHIP_IDS,
  coachingIntentForChipId,
} from '../../src/orchestrator-v5/coaching/coaching-chip-registry.js';
import {
  ROUTED_COACHING_INTENTS,
  type RoutedCoachingIntent,
} from '../../src/orchestrator-v5/coaching/typed-intent-directive.js';

const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url));

/** The registry's own module is excluded — it is the list, not a producer. */
const REGISTRY_FILE = 'orchestrator-v5/coaching/coaching-chip-registry.ts';

/**
 * Chip ids reach the wire two ways, and a scan that sees only the first is
 * blind to the majority of them. This guard's own NON-VACUITY control caught
 * exactly that on its first run: the literal-only pattern found 40 ids and
 * MISSED `chip_prompt_run_pre_mortem`, the very chip the lane was built for,
 * because `compose/chip-generator.ts` never spells it — `promptChip()` mints
 * it from a discriminator through `chipId()`'s template.
 *
 *   1. WRITTEN OUT   `id: 'chip_action_run_pre_mortem'` — a literal.
 *   2. MINTED        `promptChip('run_pre_mortem', …)` /
 *                    `chipId('prompt', 'run_pre_mortem')` — reconstructed here
 *                    with the same expression `chipId()` uses.
 *
 * The minting helper NAMES are restated, which is a residual mirror. It is a
 * fail-loud one: rename `promptChip` and the non-vacuity control immediately
 * stops finding the registry's ids and REDs, rather than reporting a clean
 * sheet over a tree it can no longer read.
 */
const CHIP_ID_LITERAL = /\bchip_(?:action|prompt)_[a-z0-9_]+/g;
const CHIP_ID_PROMPT_MINT = /\bpromptChip\(\s*'([a-z0-9_]+)'/g;
const CHIP_ID_EXPLICIT_MINT = /\bchipId\(\s*'(action|prompt)'\s*,\s*'([a-z0-9_]+)'/g;

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walkTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface FoundChipId {
  readonly id: string;
  readonly file: string;
}

const found: FoundChipId[] = [];
for (const abs of walkTsFiles(SRC_ROOT)) {
  const rel = relative(SRC_ROOT, abs).split('\\').join('/');
  if (rel === REGISTRY_FILE) continue;
  const source = stripCommentsFile(abs);
  for (const match of source.matchAll(CHIP_ID_LITERAL)) {
    found.push({ id: match[0], file: rel });
  }
  for (const match of source.matchAll(CHIP_ID_PROMPT_MINT)) {
    found.push({ id: `chip_prompt_${match[1]}`, file: rel });
  }
  for (const match of source.matchAll(CHIP_ID_EXPLICIT_MINT)) {
    found.push({ id: `chip_${match[1]}_${match[2]}`, file: rel });
  }
}

const allIds = [...new Set(found.map((f) => f.id))].sort();

/**
 * The DGAI affordance spelling for each routed intent, where it DIFFERS from
 * the intent token. See the header for the derivation and for why this list is
 * a hand-written mirror that fails loud rather than a derivable one.
 *
 * `Record<RoutedCoachingIntent, …>` is deliberate: an eighth member of
 * `ROUTED_COACHING_INTENTS` breaks this at COMPILE time as well as at the
 * runtime assertion below, because `tsconfig.build.json` excludes tests and a
 * type alone would not be checked by the required gate.
 *
 * An empty array means "the affordance and the intent are spelled the same" —
 * an explicit statement, so a method cannot be omitted by silence.
 */
const AFFORDANCE_ALIASES: Readonly<Record<RoutedCoachingIntent, readonly string[]>> = {
  challenge_frame: ['pressure_test_frame'],
  define_success: [],
  elicit_options: ['widen_options'],
  challenge_assumption: ['reflect_bias'],
  outside_view: [],
  pre_mortem: [],
  elicit_risks: ['risks_upside'],
};

/**
 * Every slug token that names a routed coaching method — the intent tokens
 * (derived) plus the affordance spellings (mirrored, fail-loud).
 */
const COACHING_METHOD_TOKENS: readonly string[] = [
  ...(ROUTED_COACHING_INTENTS as readonly string[]),
  ...Object.values(AFFORDANCE_ALIASES).flat(),
];

/**
 * A chip id whose slug names a routed coaching method, in EITHER vocabulary.
 * Substring containment is deliberate, because the live ids spell the method
 * with a verb prefix (`run_pre_mortem` contains `pre_mortem`).
 */
function namesACoachingMethod(chipId: string): boolean {
  return COACHING_METHOD_TOKENS.some((token) => chipId.includes(token));
}

describe('coaching chip registry — completeness, checked from outside the list', () => {
  it('NON-VACUITY: the scan finds every id the registry claims', () => {
    for (const id of REGISTERED_COACHING_CHIP_IDS) {
      expect(allIds, `registry claims ${id}; the tree scan did not find it`).toContain(id);
    }
  });

  it('CONTRAST: the same sweep finds a non-coaching chip id too', () => {
    // Proves the scan sees the general population, not just the ids it was
    // pointed at. Without this, an over-narrow pattern would make the guard
    // below pass by seeing almost nothing.
    expect(allIds).toContain('chip_action_explain_results');
    expect(allIds.length).toBeGreaterThan(10);
  });

  it('every coaching-method chip id in src/ resolves to a routed intent', () => {
    const unregistered = found
      .filter((f) => namesACoachingMethod(f.id))
      .filter((f) => coachingIntentForChipId(f.id) === undefined);

    expect(
      unregistered.map((f) => `${f.id} (${f.file})`),
      'a composer mints a coaching-method chip the registry does not resolve — '
        + 'add it to CHIP_ID_INTENT, or the click will reach the model with no method',
    ).toEqual([]);
  });

  it('FAIL-LOUD MIRROR: the alias table states every routed intent, or REDs', () => {
    // Derived from the arm, so an eighth routed method cannot land while this
    // file quietly keeps classifying on seven. The remedy when this REDs is to
    // state that method's DGAI affordance spelling — or `[]` if it is spelled
    // the same. Silence is not an option the shape allows.
    expect(Object.keys(AFFORDANCE_ALIASES).sort()).toEqual(
      [...ROUTED_COACHING_INTENTS].sort(),
    );
  });

  it('FROZEN RECORD: the alias set is exactly what was derived, and cannot shrink', () => {
    // ⭐ THE ASSERTION WITHOUT WHICH EVERYTHING BELOW IS VACUOUS. The
    // discriminating cases are generated FROM this table, so emptying an entry
    // would delete its own coverage in silence — the corpus would shrink and
    // the suite would stay green, which is the failure mode the review just
    // caught one level up.
    //
    // So the set is pinned EXACTLY, and REDs if it grows OR shrinks
    // (CLAUDE.md trap 22f's prescription for a known gap set). This is a
    // RECORD OF A DERIVATION, not a live read: taken at
    // `Talchain/DecisionGuideAI` `staging` `158a593c`, blob `db9d7503`, by
    // pairing each spark's `id` with its declared `intent`. Editing it without
    // re-deriving at DGAI is the drift it exists to stop — and note what it
    // still cannot see: a RENAME in DGAI leaves this green while re-opening
    // the blind spot for that one method.
    expect(AFFORDANCE_ALIASES).toEqual({
      challenge_frame: ['pressure_test_frame'],
      define_success: [],
      elicit_options: ['widen_options'],
      challenge_assumption: ['reflect_bias'],
      outside_view: [],
      pre_mortem: [],
      elicit_risks: ['risks_upside'],
    });
  });

  it.each(
    Object.entries(AFFORDANCE_ALIASES).flatMap(([intent, aliases]) =>
      aliases.map((alias) => [alias, intent] as const),
    ),
  )(
    'DISCRIMINATING: a chip minted as %s would be SEEN as a coaching chip (intent %s)',
    (alias, _intent) => {
      // The exact blind spot the review found. Before the alias table these
      // four read as ordinary chips and the guard reported a clean sheet over
      // them. `promptChip('widen_options', …)` mints this id shape verbatim.
      const wouldBeMinted = `chip_prompt_${alias}`;
      expect(
        namesACoachingMethod(wouldBeMinted),
        `${wouldBeMinted} is invisible to the classifier — the blind spot is back`,
      ).toBe(true);
      // …and it is genuinely unresolved today, so the presence half is real
      // rather than an assertion about an id the registry already carries.
      expect(coachingIntentForChipId(wouldBeMinted)).toBeUndefined();
    },
  );

  it('the affordance widening did not make the classifier match everything', () => {
    // A wider token set is only useful if it still discriminates. These are
    // live, same-family chip ids from the same composers, none of which names
    // a coaching method.
    for (const notCoaching of [
      'chip_action_rerun_analysis',
      'chip_action_explain_results',
      'chip_action_rerun_analysis_after_mutation',
    ]) {
      expect(namesACoachingMethod(notCoaching), `${notCoaching} misclassified`).toBe(false);
    }
  });

  it('the guard would SEE an unregistered coaching chip (discriminating control)', () => {
    // The assertion above is an absence claim. This is the presence half: an
    // id shaped exactly like a real one, for a routed method, that the registry
    // does not carry — it must be classified as a coaching chip AND unresolved.
    // If either half stopped holding, the guard above would pass by being
    // unable to discriminate rather than by finding nothing.
    const wouldBeCaught = 'chip_prompt_run_outside_view';
    expect(namesACoachingMethod(wouldBeCaught)).toBe(true);
    expect(coachingIntentForChipId(wouldBeCaught)).toBeUndefined();

    // And the negative half, so "classified as coaching" is not simply true of
    // everything: a real, live chip id from the same composers must NOT be.
    expect(namesACoachingMethod('chip_action_rerun_analysis')).toBe(false);
  });
});
