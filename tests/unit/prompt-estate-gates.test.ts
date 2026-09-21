/**
 * PROMPT ESTATE — GATE STATE IS MEASURED, NOT RECORDED
 *
 * ## The defect this file exists for
 *
 * The first version of the estate stored a gate as an env var NAME. The drift
 * check asserted the name appeared in the config schema — its *referential*
 * integrity — and nothing whatsoever asserted its TRUTH.
 *
 * The adversarial review of PR #753 ran the constructed case and it passed:
 *
 *     CEE_VALIDATION_PIPELINE_ENABLED=true CEE_V6_DUAL_DRAFT_ENABLED=true \
 *       vitest run prompt-estate-drift prompt-estate-inventory
 *     → 33/33 GREEN
 *
 * while `/admin/prompts/inventory` reported `pms_live: 6`,
 * `live_llm_call_prompts: 10`, and `validate_graph` with `disposition: 'gated'`
 * — on a deployment where `validate_graph` was serving its PMS row
 * (`45073b566184e4e8`, which DIFFERS from the code default) on live draft
 * turns. Silently false, indefinitely, with no RED anywhere.
 *
 * The hand-maintained mirror had not died. It had moved into the subtraction
 * terms of the derivation.
 *
 * ## What is asserted here
 *
 * 1. **The reviewer's constructed case, verbatim** — both flags ON, the gated
 *    prompts must report LIVE, in the estate and in the inventory totals.
 * 2. **Each gate's reader is BOUND to the env var it NAMES.** Stub the declared
 *    name; the reader must flip. This is what makes the declaration honest
 *    rather than decorative — a reader wired to the wrong config field passes a
 *    substring check and fails this.
 * 3. **Each gate's default is asserted BY MEASUREMENT**, not by matching source
 *    text: unset every env var, read `isActive()`, compare with `defaultsTo`.
 *    A code-level default flip is therefore loud.
 *
 * ## What this file CANNOT catch — stated, not implied
 *
 * A deployment-level env flip on Render. CI has no view of that environment.
 * That is exactly why `gate_active` is REPORTED at runtime on `/status` and
 * `/inventory`: the test guards the mechanism, the endpoint reports the state.
 * Neither alone is sufficient and neither pretends to be.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CODE_CONSTANT_PROMPTS,
  GATED_PMS_TASKS,
  activeGateTasks,
  allGateDeclarations,
  deriveLiveEstate,
  dispositionOf,
  gateActiveOf,
  isCodeConstantLiveNow,
  LIVE_PMS_TASKS_AT_DEFAULT_GATES,
  REPORTED_PMS_TASKS,
} from '../../src/prompts/estate.js';
import { buildPromptEstateInventory } from '../../src/prompts/inventory.js';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import { _resetConfigCache } from '../../src/config/index.js';

registerAllDefaultPrompts();

/** Set an env var and force config to re-parse, the repo's established pattern. */
function setEnv(name: string, value: string): void {
  vi.stubEnv(name, value);
  _resetConfigCache();
}

beforeEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

// ---------------------------------------------------------------------------
// 1. The reviewer's constructed case
// ---------------------------------------------------------------------------

// ⚠ AMENDED 2026-08-03 (ROADMAP 2.146 activation), AND THE AMENDMENT IS THE
// INTERESTING PART. `CEE_VALIDATION_PIPELINE_ENABLED` now ships ON, so its gate
// is a KILL-SWITCH, not an enable. The reviewer's constructed case was
// "off-by-default gate flipped ON must reclassify to live" — pinning that to
// `validate_graph` would now be pinning it to a gate that is ALREADY on, i.e.
// asserting nothing (CLAUDE.md trap 12b: a control pinned to "current" decays
// into a tautology the first time "current" changes).
//
// So the case is split, and BOTH directions are now covered where only one was:
//   * `m2_graph_review` — still off-by-default, carries the ORIGINAL case
//     verbatim (OFF → flipped ON → reclassifies live, totals rise);
//   * `validate_graph` — carries the NEW inverse (ON at default → killed →
//     reclassifies GATED, totals fall). A default-ON capability whose
//     kill-switch silently failed to reclassify would be the same defect
//     wearing the opposite sign, and nothing tested it before today.
describe('the constructed drift case — an off-by-default gate flipped ON', () => {
  const M2_ON = () => setEnv('CEE_V6_DUAL_DRAFT_ENABLED', 'true');

  it('reports the gated PMS prompt as LIVE, not gated', () => {
    // Baseline first, so this cannot pass by always answering "live".
    expect(dispositionOf('m2_graph_review')).toBe('gated');

    M2_ON();

    expect(
      dispositionOf('m2_graph_review'),
      'with CEE_V6_DUAL_DRAFT_ENABLED=true this prompt serves on live draft turns',
    ).toBe('live');
  });

  it('moves it into the derived live set', () => {
    const before = deriveLiveEstate().live;
    expect(before).not.toContain('m2_graph_review');

    M2_ON();

    const after = deriveLiveEstate().live;
    expect(after).toContain('m2_graph_review');
    expect(after.length).toBe(before.length + 1);
  });

  it('raises the inventory totals — the number a human reads', async () => {
    const before = await buildPromptEstateInventory();
    expect(before.totals.pms_live).toBe(LIVE_PMS_TASKS_AT_DEFAULT_GATES.length);
    // DERIVED, not a literal: gates are heterogeneous — `m2_graph_review`
    // defaults off, `validate_graph` and DRAFT_COMPLIANCE_REMINDER default ON.
    // Writing a number here would have been a small mirror of exactly the kind
    // this suite exists to kill (and it duly went red on the first run).
    expect(before.totals.gated_active).toBe(
      allGateDeclarations().filter((g) => g.gate.defaultsTo).length,
    );

    M2_ON();

    const after = await buildPromptEstateInventory();
    expect(
      after.totals.pms_live,
      'the endpoint claims to MEASURE rather than record; gate state is the fact it used to record',
    ).toBe(before.totals.pms_live + 1);
    expect(after.totals.live_llm_call_prompts).toBe(before.totals.live_llm_call_prompts + 1);
    expect(after.totals.gated_active).toBe(before.totals.gated_active + 1);
    expect(after.totals.gated_inactive).toBe(before.totals.gated_inactive - 1);
  });

  it('flips gate_active on the per-row status', async () => {
    const before = await buildPromptEstateInventory();
    const mBefore = before.pms.find((p) => p.key === 'm2_graph_review')!;
    expect(mBefore.gate).toBe('CEE_V6_DUAL_DRAFT_ENABLED');
    expect(mBefore.gate_active).toBe(false);
    expect(mBefore.disposition).toBe('gated');

    M2_ON();

    const after = await buildPromptEstateInventory();
    const mAfter = after.pms.find((p) => p.key === 'm2_graph_review')!;
    expect(mAfter.gate_active).toBe(true);
    expect(mAfter.disposition).toBe('live');
  });
});

describe('the INVERSE case — an on-by-default capability killed (ROADMAP 2.146)', () => {
  const VALIDATION_OFF = () => setEnv('CEE_VALIDATION_PIPELINE_ENABLED', 'false');

  it('validate_graph is LIVE at defaults, and the kill-switch reclassifies it to GATED', () => {
    // Baseline first, so this cannot pass by always answering "gated".
    expect(
      dispositionOf('validate_graph'),
      'CEE_VALIDATION_PIPELINE_ENABLED ships ON since 2026-08-03 — this prompt serves by default',
    ).toBe('live');

    VALIDATION_OFF();

    expect(dispositionOf('validate_graph')).toBe('gated');
  });

  it('removes it from the derived live set and lowers the totals', async () => {
    const before = await buildPromptEstateInventory();
    expect(deriveLiveEstate().live).toContain('validate_graph');

    VALIDATION_OFF();

    const after = await buildPromptEstateInventory();
    expect(deriveLiveEstate().live).not.toContain('validate_graph');
    expect(after.totals.pms_live).toBe(before.totals.pms_live - 1);
    expect(after.totals.gated_active).toBe(before.totals.gated_active - 1);
    expect(after.pms.find((p) => p.key === 'validate_graph')!.gate_active).toBe(false);
  });

  it('keeps the gated prompts REPORTED in EVERY gate state (the invariant that held)', async () => {
    // This is what the original design got right and must not regress: a gate
    // flip could never serve an UNMONITORED prompt. Only the label was wrong.
    // Now swept across all four combinations rather than one, because with one
    // gate default-ON and one default-OFF, "either way" is no longer one axis.
    expect(REPORTED_PMS_TASKS as readonly string[]).toContain('validate_graph');
    expect(REPORTED_PMS_TASKS as readonly string[]).toContain('m2_graph_review');
    for (const validation of ['true', 'false']) {
      for (const dualDraft of ['true', 'false']) {
        setEnv('CEE_VALIDATION_PIPELINE_ENABLED', validation);
        setEnv('CEE_V6_DUAL_DRAFT_ENABLED', dualDraft);
        const inv = await buildPromptEstateInventory();
        const keys = inv.pms.map((p) => p.key);
        expect(keys, `validation=${validation} dualDraft=${dualDraft}`).toContain('validate_graph');
        expect(keys, `validation=${validation} dualDraft=${dualDraft}`).toContain('m2_graph_review');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Each gate's reader is bound to the env var it names
// ---------------------------------------------------------------------------

describe('every gate reader tracks the env var it declares', () => {
  it('flipping the DECLARED name flips isActive() — for every gate in the estate', () => {
    // A reader wired to the wrong config field passes the source-substring
    // check and fails here. This is the assertion that makes the declaration
    // load-bearing rather than decorative.
    for (const { owner, gate } of allGateDeclarations()) {
      vi.unstubAllEnvs();
      _resetConfigCache();
      const atDefault = gate.isActive();

      setEnv(gate.env, atDefault ? 'false' : 'true');
      expect(
        gate.isActive(),
        `gate '${gate.env}' declared for '${owner}': setting it to ${!atDefault} did not change ` +
          'isActive() — the reader is not wired to the env var this declaration names',
      ).toBe(!atDefault);

      setEnv(gate.env, atDefault ? 'true' : 'false');
      expect(gate.isActive()).toBe(atDefault);
    }
    vi.unstubAllEnvs();
    _resetConfigCache();
  });

  it('declares at least one gate on each half of the estate (positive control)', () => {
    // An "every gate…" assertion over an empty list proves nothing.
    const owners = allGateDeclarations().map((g) => g.owner);
    expect(owners.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(GATED_PMS_TASKS).length).toBeGreaterThan(0);
    expect(CODE_CONSTANT_PROMPTS.filter((p) => p.gate).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Defaults are measured, so a code-level flip is loud
// ---------------------------------------------------------------------------

describe('gate defaults are asserted by measurement', () => {
  it('every declared defaultsTo matches what config yields with the env unset', () => {
    vi.unstubAllEnvs();
    _resetConfigCache();
    for (const { owner, gate } of allGateDeclarations()) {
      expect(
        gate.isActive(),
        `gate '${gate.env}' (${owner}) is declared to default to ${gate.defaultsTo} but config ` +
          `yields ${gate.isActive()} with the env var unset. If the code-level default was ` +
          'changed deliberately, update `defaultsTo` — that edit is the point of this assertion.',
      ).toBe(gate.defaultsTo);
    }
  });

  // ⚠ THIS ASSERTION WAS 'every PMS gate defaults OFF' UNTIL 2026-08-03, AND IT
  // WAS A HIDDEN MIRROR. It read as a safety property but was really a census of
  // which gates happened to exist — and it went RED, correctly, the moment
  // `CEE_VALIDATION_PIPELINE_ENABLED` shipped ON (ROADMAP 2.146). The real
  // property, which is what it was reaching for, is the one below: whatever a
  // gate DECLARES it defaults to, the reported classification must AGREE at the
  // shipped default. A capability that ships ON is then legitimate, and a
  // capability that ships ON while still being labelled `gated` is caught.
  it("every PMS gate's reported state agrees with its DECLARED default", () => {
    vi.unstubAllEnvs();
    _resetConfigCache();
    for (const [task, gate] of Object.entries(GATED_PMS_TASKS)) {
      expect(
        gateActiveOf(task),
        `'${task}' declares defaultsTo=${gate.defaultsTo}, but the reported gate state disagrees ` +
          'at the shipped default — the label and the code have drifted apart',
      ).toBe(gate.defaultsTo);
      expect(
        dispositionOf(task),
        `'${task}' defaults ${gate.defaultsTo ? 'ON' : 'OFF'}, so its disposition must say so`,
      ).toBe(gate.defaultsTo ? 'live' : 'gated');
    }
  });

  it('POSITIVE CONTROL: the gate set spans BOTH defaults (neither branch above is vacuous)', () => {
    // Without this, the assertion above could pass over a set that is uniformly
    // one way and never exercise the other branch — which is exactly how the
    // 'every PMS gate defaults OFF' version stayed green while meaning nothing.
    const defaults = Object.values(GATED_PMS_TASKS).map((g) => g.defaultsTo);
    expect(defaults).toContain(true);
    expect(defaults).toContain(false);
  });

  it('a code constant whose gate defaults ON counts as live (DRAFT_COMPLIANCE_REMINDER)', () => {
    // The direction matters and is easy to get backwards: this gate defaults
    // TRUE, so the prompt is live by default, unlike every PMS gate.
    const p = CODE_CONSTANT_PROMPTS.find((c) => c.id === 'DRAFT_COMPLIANCE_REMINDER')!;
    expect(p.gate?.defaultsTo).toBe(true);
    expect(isCodeConstantLiveNow(p)).toBe(true);

    setEnv('CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED', 'false');
    expect(isCodeConstantLiveNow(p)).toBe(false);
  });

  it('activeGateTasks() at defaults is exactly the DERIVED default-ON set, and moves both ways', () => {
    // DERIVED from the declarations, not a literal list — the literal `[]` this
    // replaces was true only while every gate defaulted off, and became false
    // on 2026-08-03 without anything about the mechanism changing.
    const defaultOn = Object.entries(GATED_PMS_TASKS)
      .filter(([, g]) => g.defaultsTo)
      .map(([task]) => task)
      .sort();
    expect(activeGateTasks().sort()).toEqual(defaultOn);

    // UP: flipping an off-by-default gate ON adds exactly it.
    setEnv('CEE_V6_DUAL_DRAFT_ENABLED', 'true');
    expect(activeGateTasks().sort()).toEqual([...defaultOn, 'm2_graph_review'].sort());

    // DOWN: killing an on-by-default gate removes exactly it.
    setEnv('CEE_VALIDATION_PIPELINE_ENABLED', 'false');
    expect(activeGateTasks().sort()).toEqual(['m2_graph_review']);
  });
});

// ---------------------------------------------------------------------------
// 4. The code-constant half is gate-aware too
// ---------------------------------------------------------------------------

describe('gated code constants', () => {
  it('the four decompose prompts are declared and gated by ONE flag', () => {
    // The review's sharpest point: one flag flip served FOUR prompts the
    // inventory had never heard of.
    const decompose = CODE_CONSTANT_PROMPTS.filter((p) => p.id.startsWith('DECOMPOSE_R'));
    expect(decompose).toHaveLength(4);
    for (const p of decompose) {
      expect(p.gate?.env).toBe('CEE_DECISION_REVIEW_DECOMPOSE');
      expect(isCodeConstantLiveNow(p)).toBe(false);
    }
  });

  it('flipping the decompose flag makes all four live at once', async () => {
    const before = await buildPromptEstateInventory();
    setEnv('CEE_DECISION_REVIEW_DECOMPOSE', 'true');
    const after = await buildPromptEstateInventory();

    expect(after.totals.code_constants_live).toBe(before.totals.code_constants_live + 4);
    expect(after.totals.live_llm_call_prompts).toBe(before.totals.live_llm_call_prompts + 4);
    for (const row of after.code_constants.filter((c) => c.id.startsWith('DECOMPOSE_R'))) {
      expect(row.gate_active).toBe(true);
      expect(row.live_now).toBe(true);
    }
  });

  it('the fallback-only prompt is declared but never counted live', async () => {
    const p = CODE_CONSTANT_PROMPTS.find((c) => c.id === '_DRAFT_SYSTEM_PROMPT')!;
    expect(p.disposition).toBe('fallback');
    expect(isCodeConstantLiveNow(p)).toBe(false);
    const inv = await buildPromptEstateInventory();
    expect(inv.code_constants.find((c) => c.id === '_DRAFT_SYSTEM_PROMPT')!.live_now).toBe(false);
  });

  it('carries the scope of the guarantee in the payload', async () => {
    // So the caveat travels with any number quoted from this endpoint.
    const inv = await buildPromptEstateInventory();
    expect(inv.derivation.pms_half).toMatch(/DERIVED/);
    expect(inv.derivation.code_constant_half).toMatch(/DECLARED/);
    expect(inv.derivation.code_constant_half).toMatch(/reviewed, not derived/i);
  });

  it('reports every measured gate with its env var and state', async () => {
    const inv = await buildPromptEstateInventory();
    expect(inv.gates.length).toBe(allGateDeclarations().length);
    // Each reported state must equal that gate's own declared default — which
    // is NOT uniformly false. A blanket `toBe(false)` would pass only by
    // accident of which gates exist today.
    const declared = new Map(allGateDeclarations().map((g) => [g.gate.env, g.gate.defaultsTo]));
    for (const g of inv.gates) expect(g.active, `gate ${g.env}`).toBe(declared.get(g.env));
    // Flip AWAY from the shipped default so the second read is a real change.
    // Setting it to `true` — which it already is since 2026-08-03 — would have
    // asserted nothing at all.
    setEnv('CEE_VALIDATION_PIPELINE_ENABLED', 'false');
    const after = await buildPromptEstateInventory();
    expect(after.gates.find((g) => g.owner === 'validate_graph')!.active).toBe(false);
  });
});
