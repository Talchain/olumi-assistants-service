/**
 * P1 HONESTY — the redaction-marker egress net.
 *
 * `[REDACTED]` reached a real user's chat (2026-08-16, Paul's manual test;
 * server logs showed the producing scrubber firing with `replacement_count: 2`).
 * The producing rule is fixed at source in
 * `orchestrator/shared/repair-vocabulary-denylist.ts`; this is the net under
 * that fix, because FOUR other modules in this repo legitimately emit the same
 * marker into LOGS and DROPPED ENRICHMENT FIELDS, and the thing that must never
 * happen is one of those values crossing into `assistant_text`.
 *
 * The net is deliberately asymmetric — THROW in test, STRIP in production —
 * so a regression is a RED in CI rather than a warning nobody reads, while a
 * live turn degrades to a slightly-clipped sentence instead of dying.
 */
import { describe, expect, it } from 'vitest';

import { FORBIDDEN_USER_FACING_REDACTION_MARKER } from '../../../orchestrator/shared/repair-vocabulary-denylist.js';
import {
  assertNoRedactionMarkerInAssistantText,
  stripRedactionMarker,
} from '../output-safety.js';

const OPTS = { requestId: 'req_test', exitPath: 'test' } as const;

describe('assertNoRedactionMarkerInAssistantText — fails loud under test', () => {
  it('throws when the marker is present, naming the marker and the exit path', () => {
    expect(() =>
      assertNoRedactionMarkerInAssistantText('We hit [REDACTED] here.', OPTS),
    ).toThrow(/\[REDACTED\]/);
    expect(() =>
      assertNoRedactionMarkerInAssistantText('We hit [REDACTED] here.', OPTS),
    ).toThrow(/exit_path=test/);
  });

  it('PRECONDITION PIN — the input under test genuinely carries the marker', () => {
    // Without this the throw assertion above could pass for the wrong reason
    // (any thrown error), and a fixture drift would silently hollow it out.
    expect('We hit [REDACTED] here.').toContain(FORBIDDEN_USER_FACING_REDACTION_MARKER);
  });

  it('CONTRAST CONTROL — clean prose passes through byte-identical and does NOT throw', () => {
    const clean = 'I set the hiring ceiling to £200,000 and left inbound volume alone.';
    expect(assertNoRedactionMarkerInAssistantText(clean, OPTS)).toBe(clean);
  });

  it('does not fire on a merely similar token — the test is exact-substring', () => {
    const near = 'The [REDACTION] policy is documented separately.';
    expect(assertNoRedactionMarkerInAssistantText(near, OPTS)).toBe(near);
  });
});

describe('stripRedactionMarker — the production degradation', () => {
  it('removes the marker and closes the whitespace it leaves behind', () => {
    expect(stripRedactionMarker('We hit [REDACTED] here.')).toBe('We hit here.');
  });

  it('does not leave a space stranded before punctuation', () => {
    expect(stripRedactionMarker('The value was [REDACTED].')).toBe('The value was.');
  });

  it('removes EVERY occurrence, not just the first', () => {
    const out = stripRedactionMarker('First [REDACTED] then [REDACTED] again.');
    expect(out).not.toContain(FORBIDDEN_USER_FACING_REDACTION_MARKER);
  });

  it('is a no-op on clean prose (identity, not a rewrite)', () => {
    const clean = 'Inbound  spacing   is preserved exactly as written.';
    expect(stripRedactionMarker(clean)).toBe(clean);
  });

  it('is idempotent — the egress chokepoint re-enters up to 4x per response', () => {
    const once = stripRedactionMarker('We hit [REDACTED] here.');
    expect(stripRedactionMarker(once)).toBe(once);
  });
});
