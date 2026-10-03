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

const K3 = 'EVERY RISK THE USER NAMES IS DRAWN AS A RISK NODE: each downside the user states in their own words (for example that they will run out of money, lose a key customer, or miss a deadline) is its own risk, linked to what it threatens, even when you also draw a risk of your own. ';

const K3_PRECEDENCE = 'A RISK THE USER NAMED OUTRANKS THE ENVELOPE: when the risks the user named do not all fit beside your own, leave out your own risks and outcomes first; never leave out or merge a risk the user named, even when that takes the model past 6 outcomes and risks. ';

describe('K3 (DL 5932372585, generalised): every risk the user names is drawn as a risk node', () => {
  it('RED: the construction instructions carry the rule, verbatim, once', () => {
    const text = String(BUILD_INSTRUCTIONS);
    expect(text.split(K3).length - 1).toBe(1);
  });

  it('the rule sits inside the risk envelope: after "ALWAYS KEEP AT LEAST ONE RISK", before the widening limit', () => {
    const text = String(BUILD_INSTRUCTIONS);
    const keep = text.indexOf('ALWAYS KEEP AT LEAST ONE RISK');
    const k3 = text.indexOf(K3);
    const widen = text.indexOf('Do NOT widen beyond it on this turn');
    expect(keep).toBeGreaterThan(-1);
    expect(widen).toBeGreaterThan(-1);
    expect(keep < k3 && k3 < widen).toBe(true);
  });

  it('RED: user-named risks outrank the 4-to-6 envelope, stated once, directly after K3 and before the widening limit', () => {
    const text = String(BUILD_INSTRUCTIONS);
    expect(text.split(K3_PRECEDENCE).length - 1).toBe(1);
    expect(text.indexOf(K3_PRECEDENCE)).toBe(text.indexOf(K3) + K3.length);
    expect(text.indexOf(K3_PRECEDENCE) < text.indexOf('Do NOT widen beyond it on this turn')).toBe(true);
  });

  it('CONTROL: the envelope still forbids decorative risks (the rule adds the user\'s risk; it never widens the model)', () => {
    expect(String(BUILD_INSTRUCTIONS)).toContain('no speculative options, secondary factors, or decorative risks and outcomes');
  });
});
