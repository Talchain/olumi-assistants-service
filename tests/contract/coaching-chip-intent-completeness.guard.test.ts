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
 * contains a routed coaching-intent token, the registry must resolve it. A
 * composer that hand-rolls a new coaching chip — the exact way the pre-mortem
 * chip came to exist at four sites under two id spellings — goes RED the day
 * it lands, with no human remembering anything.
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
import { ROUTED_COACHING_INTENTS } from '../../src/orchestrator-v5/coaching/typed-intent-directive.js';

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
 * A chip id whose slug names a routed coaching method. Token set DERIVED from
 * the arm; substring containment is deliberate, because the live ids spell the
 * method with a verb prefix (`run_pre_mortem` contains `pre_mortem`).
 */
function namesACoachingMethod(chipId: string): boolean {
  return (ROUTED_COACHING_INTENTS as readonly string[]).some((intent) =>
    chipId.includes(intent),
  );
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
