/**
 * ⭐⭐⭐ MANDATORY REGRESSION 2 — NATURAL UNIT EQUIVALENCE.
 *
 * Paul's ruling, 21 Sep 2026: normal user expressions — **£59** for a
 * `£/month` factor, **50%** for a bounded unit-interval factor — must not be
 * rejected because internal unit strings differ.
 *
 * ── WHAT THIS PINS TODAY, AND WHY IT IS NOT YET THE FULL CLAUSE ──────────
 * ⛔ THE CLAUSE IS **NOT MET** ON THIS PATH, AND THE REASON IS DEEPER THAN THE
 * STRING COMPARISON EVERYONE LOOKS AT.
 *
 * `set_option_effect` accepts `value: number` documented as *"Normalised effect
 * in [0, 1]. The conversation is responsible for having"* converted it. But the
 * model's view of a factor — assembled in `read-tools.ts` — carries its CURRENT
 * VALUE and UNIT (`value 49 £/month`) and **NOT its range**. So the model is
 * asked to express £59 as a share of a range IT CANNOT SEE.
 *
 * That is not a strictness bug. It is structurally impossible to do correctly:
 * the only way to produce a number is to guess the range, and a guessed range
 * produces a confidently wrong intervention with a receipt attached — strictly
 * worse than the refusal the legacy path gives.
 *
 * ── WHY A PINNED GAP RATHER THAN A PERMANENTLY-RED TEST ──────────────────
 * A red test nobody can make green gets skipped, and a gap invisible to the
 * suite is how surprises ship. So the gap is pinned EXACTLY (CLAUDE.md trap
 * 22f): these assertions describe the state as MEASURED, and they RED when the
 * range is exposed — which is precisely when someone must come back here and
 * write the real equivalence clause.
 *
 * ⭐ WHAT CLOSING IT REQUIRES, so the next reader does not re-derive it:
 *   1. `read-tools.ts` must show the factor's RANGE beside its value and unit.
 *   2. Only then can the conversation convert £59 → a share, and 50% → 0.5.
 *   3. The conversion must be CONFIRMED, never silent — a wrong range is a
 *      wrong model with a receipt, which is the harm the whole consent layer
 *      exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const READ_TOOLS = readFileSync(join(HERE, '..', 'read-tools.ts'), 'utf8');
const SET_OPTION_EFFECT = readFileSync(join(HERE, '..', 'set-option-effect.ts'), 'utf8');

describe('MANDATORY REGRESSION 2 — natural unit equivalence', () => {
  it('the tool demands a normalised share and says the conversation must supply it', () => {
    // The precondition for everything below. If this stops being true, the
    // clause has changed shape and this whole file needs rewriting.
    expect(SET_OPTION_EFFECT).toContain('Normalised effect in [0, 1]');
  });

  it('the model IS shown each factor’s value and unit', () => {
    // POSITIVE CONTROL for the gap assertion below: the probe can see what the
    // model is given, so a zero from it is a real absence, not a blind read.
    expect(READ_TOOLS).toContain('the factors with their values and units');
    expect(READ_TOOLS).toMatch(/value \$\{num\(value\)\}/);
  });

  it('⛔ PINNED GAP: the model is NOT shown the range it would need to convert', () => {
    // Measured 21 Sep 2026. `range_min` / `range_max` — the fields a factor's
    // prior actually carries in the captured graph — never reach the model's
    // view of the workspace, so £59 cannot be expressed as a share of it.
    //
    // ⭐ WHEN THIS REDS, THAT IS THE GOOD OUTCOME. It means someone exposed the
    // range. Do NOT relax the assertion: replace this whole case with the real
    // equivalence clause — user says "£59" on a £/month factor, the proposed
    // share is confirmed with the user, and the committed intervention matches.
    expect(
      READ_TOOLS.includes('range_min') || READ_TOOLS.includes('range_max'),
      'read-tools does not expose a factor range; if it now does, write the real clause',
    ).toBe(false);
  });

  it('the captured graph DOES carry the range, so the data exists upstream', () => {
    // The gap is in what is SHOWN, not in what is known — which is what makes
    // it cheap to close and worth pinning rather than redesigning.
    const graph = JSON.parse(
      readFileSync(join(HERE, 'captures', 'journey-witness-20260921-graph.json'), 'utf8'),
    ) as { nodes: Array<Record<string, unknown>> };
    const withPrior = graph.nodes.filter(
      (n) => n.kind === 'factor' && (n.prior as Record<string, unknown> | undefined)?.range_min !== undefined,
    );
    expect(withPrior.length, 'the capture must carry factor ranges, or this argument fails').toBeGreaterThan(0);
  });
});
