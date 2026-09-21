/**
 * Model Management v1 — copy-state tests.
 *
 * Pins that every state has copy, that per-error-code copy is COMPLETE (driven
 * off the contract enum — the runtime source of codes), that the sign-in copy
 * agrees with the canonical SIGN_IN_REQUIRED_MESSAGE, and that the PROVISIONAL
 * Branch-A guest wording is pinned so a flip to an Option-C preview posture is
 * a deliberate, reviewed edit rather than an accidental string change.
 */
import { describe, it, expect } from 'vitest';

import { MODEL_MANAGEMENT_COPY, MODEL_MANAGEMENT_ERROR_COPY } from '../copy.js';
import { ModelManagementErrorResponseSchema } from '../contracts.js';
import { SIGN_IN_REQUIRED_MESSAGE } from '../types.js';

const nonEmpty = (s: string) => typeof s === 'string' && s.trim().length > 0;

describe('model-management copy — completeness', () => {
  it('every copy block has a non-empty headline and body', () => {
    for (const [key, block] of Object.entries(MODEL_MANAGEMENT_COPY)) {
      expect(nonEmpty(block.headline), `${key}.headline`).toBe(true);
      expect(nonEmpty(block.body), `${key}.body`).toBe(true);
    }
  });

  it('every error code (from the contract enum) has copy — no code can ship copy-less', () => {
    // The contract enum is the runtime source of truth for the code set; if a
    // new code is added there, this fails until copy is provided.
    const codes = ModelManagementErrorResponseSchema.shape.code.options;
    for (const code of codes) {
      const block = MODEL_MANAGEMENT_ERROR_COPY[code];
      expect(block, `error copy missing for '${code}'`).toBeDefined();
      expect(nonEmpty(block.headline) && nonEmpty(block.body), `error copy empty for '${code}'`).toBe(true);
    }
    // And no stray codes without a matching enum entry.
    expect(Object.keys(MODEL_MANAGEMENT_ERROR_COPY).sort()).toEqual([...codes].sort());
  });
});

describe('model-management copy — alignment + provisional guest wording', () => {
  it('sign-in copy agrees with the canonical terse SIGN_IN_REQUIRED_MESSAGE (both are about signing in)', () => {
    expect(SIGN_IN_REQUIRED_MESSAGE).toBe('Version history requires sign-in.');
    expect(MODEL_MANAGEMENT_ERROR_COPY.sign_in_required).toBe(MODEL_MANAGEMENT_COPY.signInRequired);
    expect(MODEL_MANAGEMENT_COPY.signInRequired.headline.toLowerCase()).toContain('sign in');
    expect(MODEL_MANAGEMENT_COPY.signInRequired.body.toLowerCase()).toContain('sign');
  });

  it('PROVISIONAL Branch-A guest wording is pinned (a flip to Option-C preview must be deliberate)', () => {
    // If the login/demo tripwire forces a non-durable preview, these strings
    // change to "preview only — not saved". That is a reviewed product decision;
    // this pin makes an accidental change fail loudly.
    expect(MODEL_MANAGEMENT_COPY.signInRequired.headline).toBe('Sign in to save versions');
    expect(MODEL_MANAGEMENT_COPY.signInRequired.body).toBe(
      'Version history is available when you are signed in. Sign in to save and restore versions of your model.',
    );
  });

  it('empty state is distinct from an error (no "went wrong" language)', () => {
    expect(MODEL_MANAGEMENT_COPY.empty.headline.toLowerCase()).not.toContain('wrong');
    expect(MODEL_MANAGEMENT_COPY.empty.body.toLowerCase()).not.toContain('error');
  });
});
