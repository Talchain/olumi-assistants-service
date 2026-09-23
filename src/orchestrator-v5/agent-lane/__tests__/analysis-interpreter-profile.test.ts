import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ANALYSIS_INTERPRETER_V02, composeAnalysisInterpreterV02 } from '../prompt-profiles/analysis-interpreter-v02.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('banked Interpreter profile and consumed-instruction identity', () => {
  it('retains the exact instruction block recovered from the banked v0.2 profile', () => {
    // Independently captured before this module was written; includes final LF.
    expect(sha256(ANALYSIS_INTERPRETER_V02.instructions))
      .toBe('3d979e8406693be42d3b340fd245d76a501c4b1c191d5ffaa1353f2f0380ba32');
  });

  it('preserves the caller-owned baseline verbatim and appends the banked profile', () => {
    const base = '  Current Agent instructions.\nKeep existing grounding.\n';
    const request = composeAnalysisInterpreterV02(base);
    expect(request.instructions).toBe(base + '\n\n' + ANALYSIS_INTERPRETER_V02.instructions);
    expect(request.identity.instructions_sha256).toBe(sha256(request.instructions));
    expect(request.identity.base_sha256).toBe(sha256(base));
  });

  it('changes the consumed identity when the baseline changes under the same profile version', () => {
    const before = composeAnalysisInterpreterV02('Original Agent instructions');
    const after = composeAnalysisInterpreterV02('Changed Agent instructions');
    expect(before.identity.profile_sha256).toBe(after.identity.profile_sha256);
    expect(before.identity.profile_version).toBe(after.identity.profile_version);
    expect(before.identity.instructions_sha256).not.toBe(after.identity.instructions_sha256);
    expect(before.identity.base_sha256).not.toBe(after.identity.base_sha256);
  });

  it('rejects silent standalone use, which was not the screened configuration', () => {
    expect(() => composeAnalysisInterpreterV02('')).toThrow(/base instructions/);
    expect(() => composeAnalysisInterpreterV02(' \n\t')).toThrow(/base instructions/);
  });

  it('returns stable frozen prompt metadata for repeated identical requests', () => {
    const a = composeAnalysisInterpreterV02('Same base');
    expect(composeAnalysisInterpreterV02('Same base')).toEqual(a);
    expect(Object.isFrozen(ANALYSIS_INTERPRETER_V02)).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.identity)).toBe(true);
  });
});
