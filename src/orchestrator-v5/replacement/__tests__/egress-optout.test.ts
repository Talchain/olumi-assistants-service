/**
 * The scoped opt-out on the shared egress sanitiser.
 *
 * Four cases, and the FIRST one is the important one: it pins the CURRENT,
 * WRONG behaviour. Without it, the opt-out could be a no-op — the flag would
 * look like it worked because the text happened to survive anyway.
 */

import { describe, expect, it } from 'vitest';

import type { OlumiResponse } from '@talchain/schemas/boundary';
import { sanitiseOlumiResponseForEgress } from '../../compose/output-safety.js';

const MANGLED = 'Improve the decision-making-process across teams.';

function res(text: string, over: Partial<OlumiResponse> = {}): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: text,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
    ...over,
  } as OlumiResponse;
}

const OPTS = {
  graph: null,
  requestId: 'req-1',
  exitPath: 'test' as never,
  userMessage: 'hello',
  mayNameLeadingOption: true,
};

describe('the pattern arm rewrites ordinary English — pinned so the opt-out is provably doing work', () => {
  it('BY DEFAULT, this sentence is changed', () => {
    const out = sanitiseOlumiResponseForEgress(res(MANGLED), OPTS);
    expect(out.assistant_text).not.toBe(MANGLED);
    // Recording what it becomes, so a future change to the shared scrub shows
    // up here as a diff rather than passing silently.
    expect(out.assistant_text).toContain('the relevant');
  });
});

describe('the opt-out, scoped to assistant_text only', () => {
  it('leaves the assistant text exactly as written', () => {
    const out = sanitiseOlumiResponseForEgress(res(MANGLED), {
      ...OPTS,
      assistantTextAlreadyIdentifierSafe: true,
    });
    expect(out.assistant_text).toBe(MANGLED);
  });

  /**
   * ⛔ THIS TEST WAS VACUOUS, and it was the one pinning the PR's central
   * scope claim. It asserted `if (label !== undefined) expect(label)...` —
   * and the chip finalizer DROPS that chip, so `label` was always undefined
   * and the assertion never ran. A test that cannot fail, guarding the claim
   * that mattered most. Found by adversarial review, not by the suite.
   *
   * The replacement asserts the scope claim DIRECTLY and unconditionally:
   * turning the opt-out on changes `assistant_text` and NOTHING ELSE. That
   * is exactly what "scoped to assistant_text only" means, it cannot pass
   * vacuously, and it fails if the opt-out ever becomes a blanket disable.
   */
  it('changes assistant_text and NOTHING else — the scope claim, asserted directly', () => {
    const withChip = res(MANGLED, {
      suggested_actions: [
        { id: 'a1', label: MANGLED, kind: 'chip' },
      ] as unknown as OlumiResponse['suggested_actions'],
    });
    const on = sanitiseOlumiResponseForEgress(withChip, {
      ...OPTS,
      assistantTextAlreadyIdentifierSafe: true,
    });
    const off = sanitiseOlumiResponseForEgress(withChip, OPTS);

    // Every other field identical...
    expect({ ...on, assistant_text: '' }).toEqual({ ...off, assistant_text: '' });
    // ...and that one field genuinely differs, so this cannot pass on a
    // sanitiser that simply stopped touching anything.
    expect(on.assistant_text).toBe(MANGLED);
    expect(off.assistant_text).not.toBe(MANGLED);
  });

  it('is undefined for existing callers, so their behaviour is unchanged', () => {
    const a = sanitiseOlumiResponseForEgress(res(MANGLED), OPTS);
    const b = sanitiseOlumiResponseForEgress(res(MANGLED), {
      ...OPTS,
      assistantTextAlreadyIdentifierSafe: undefined,
    });
    expect(b.assistant_text).toBe(a.assistant_text);
  });

  it('does not disable the redaction-marker net over the assistant text', () => {
    // The marker check must still see the text. Whichever way it is
    // configured, the opt-out must not be the thing that lets a marker through.
    const marked = res('A sentence with [REDACTED] in it.');
    const run = (): OlumiResponse =>
      sanitiseOlumiResponseForEgress(marked, { ...OPTS, assistantTextAlreadyIdentifierSafe: true });
    let text: string | null = null;
    try { text = run().assistant_text; } catch { text = null; }
    // Either it threw (test posture) or it stripped — never passed through.
    expect(text).not.toBe('A sentence with [REDACTED] in it.');
  });
});
