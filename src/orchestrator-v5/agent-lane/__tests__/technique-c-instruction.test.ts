/**
 * Technique (c) (AIE #94 6131186479, DL 12 Oct): the selected method's instruction ends with the AIE's two sentences, byte
 * for byte, replacing "Olumi supplies the Why? disclosure; do not write it." (which blocked an answer to a user who asks
 * about the method). The fixture is the AIE's quoted sentence as posted.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ELIGIBLE_INTERVENTION_INSTRUCTION } from '../turn-context/guidance-wire.js';

const AIE = readFileSync(new URL('./fixtures/aie-technique-c-6131186479.txt', import.meta.url), 'utf8');

describe('technique (c): the method instruction, in the AIE\'s words', () => {
  it('ends with the AIE\'s sentences exactly; the old prohibition is gone; the method rules before it are unchanged', () => {
    expect(AIE.startsWith("Olumi shows the method's Why? with its guidance row;")).toBe(true);
    expect(ELIGIBLE_INTERVENTION_INSTRUCTION.endsWith(` ${AIE}`)).toBe(true);
    expect(ELIGIBLE_INTERVENTION_INSTRUCTION).not.toContain('do not write it');
    expect(ELIGIBLE_INTERVENTION_INSTRUCTION.slice(0, -AIE.length - 1)).toBe('Only name the scientific method in CURRENT MODEL STATE.eligible_intervention. '
      + 'If absent, give a direct grounded answer without a named method. Write next moves as plain action bullets of at most eight words each. '
      + 'Keep useful questions and user figures.');
  });
});
