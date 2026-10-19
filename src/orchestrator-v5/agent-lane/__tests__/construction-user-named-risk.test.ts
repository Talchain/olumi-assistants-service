/**
 * ⭐ K3 (R3 #75 5925627855; F5 share-build residual R3 #85 5931851041): Paul's funding brief says "we'll run out of money
 * soon", and the drafted model leaves that risk out (0/4 drafts with A4b, 1/4 before). A downside the USER names is
 * theirs to weigh, so the drafter draws EVERY risk the user names as its own risk node (DL 380e54 5932372585: generalised, never
 * money-specific), even beside a risk of Olumi's own. Prompt-only: the served
 * A/B (4 drafts per arm, R3's K3 row) is the proof of behaviour; these rows prove the rule is the one the drafter is sent,
 * that it reads as a rule about what the user SAID (never a word list), and that it leaves the keep-a-risk rule intact.
 */
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS } from '../runtime/build-model.js';
import { COMPACT_MARKER, servedControlInstructions } from './compact-benchmark-control.js';

// AIE risk-mechanism consolidation (0e20eb33): the user-risk obligation now opens the single MATERIAL RISKS paragraph.
const K3 = 'MATERIAL RISKS AND THEIR CAUSES. Preserve every risk or concern the user names as its own visible item, with its complete attributed source, conditions, uncertainty and dissent. ';
const MATERIAL_END = 'or silently remove an operative human or adopted risk. ';

const K3_PRECEDENCE = 'A RISK THE USER NAMED OUTRANKS THE ENVELOPE: when the risks the user named do not all fit beside your own, leave out your own risks and outcomes first; never leave out or merge a risk the user named, even when that takes the model past 6 outcomes and risks. ';

describe('K3 (DL 5932372585, generalised): every risk the user names is drawn as a risk node', () => {
  it('RED: the construction instructions carry the rule, verbatim, once', () => {
    const text = String(BUILD_INSTRUCTIONS);
    expect(text.split(K3).length - 1).toBe(1);
  });

  it('the rule sits inside the risk envelope: after the 4-to-6 envelope, before the widening limit; the old quota and duplicate clause are gone', () => {
    const text = String(BUILD_INSTRUCTIONS);
    const envelope = text.indexOf('and up to 4 to 6 outcomes and risks between them');
    const k3 = text.indexOf(K3);
    const widen = text.indexOf('Do NOT widen beyond it on this turn');
    expect(envelope).toBeGreaterThan(-1);
    expect(widen).toBeGreaterThan(-1);
    expect(envelope < k3 && k3 < widen).toBe(true);
    expect(text).not.toContain('ALWAYS KEEP AT LEAST ONE RISK');
    expect(text).not.toContain('EVERY RISK THE USER NAMES IS DRAWN AS A RISK NODE');
  });

  it('RED: user-named risks outrank the 4-to-6 envelope, stated once, directly after the MATERIAL RISKS paragraph and before the widening limit', () => {
    const text = String(BUILD_INSTRUCTIONS);
    expect(text.split(K3_PRECEDENCE).length - 1).toBe(1);
    expect(text.split(MATERIAL_END).length - 1).toBe(1);
    expect(text.indexOf(K3) < text.indexOf(MATERIAL_END)).toBe(true);
    expect(text.indexOf(K3_PRECEDENCE)).toBe(text.indexOf(MATERIAL_END) + MATERIAL_END.length);
    expect(text.indexOf(K3_PRECEDENCE) < text.indexOf('Do NOT widen beyond it on this turn')).toBe(true);
  });

  it('RED: the node/link budget yields to the user\'s own material, stated once, in the same sentence block as the budget', () => {
    const text = String(BUILD_INSTRUCTIONS);
    const EXCEPTION = "THE ONE EXCEPTION IS THE USER'S OWN MATERIAL: when what the user stated (their options, figures, relationships and the risks they named) cannot fit this budget, keep all of it and leave out your own additions; that model is admitted, not refused.";
    expect(text.split(EXCEPTION).length - 1).toBe(1);
    const budget = text.indexOf('Stay within ');
    const refused = text.indexOf('an oversized first model is refused before it reaches the canvas. ');
    expect(budget).toBeGreaterThan(-1);
    expect(refused).toBeGreaterThan(budget);
    expect(text.indexOf(EXCEPTION)).toBe(refused + 'an oversized first model is refused before it reaches the canvas. '.length);
  });

  it('the live benchmark\'s served control drops the whole compact clause: no budget and no budget exception left behind', () => {
    const control = servedControlInstructions(String(BUILD_INSTRUCTIONS));
    expect(control).toContain('Then widen');
    expect(control).not.toContain(COMPACT_MARKER);
    expect(control).not.toContain('Stay within ');
    expect(control).not.toContain("THE ONE EXCEPTION IS THE USER'S OWN MATERIAL");
    expect(control).not.toContain('cannot fit this budget');
  });

  it('CONTROL: the envelope still forbids decorative risks (the rule adds the user\'s risk; it never widens the model)', () => {
    expect(String(BUILD_INSTRUCTIONS)).toContain('no speculative options, secondary factors, or decorative risks and outcomes');
  });
});
