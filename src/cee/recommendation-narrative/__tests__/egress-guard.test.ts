/**
 * Unit tests for the narrative-route forbidden-phrase egress guard.
 *
 * The helper wraps `applyEgressForbiddenPhraseGuard` (single source of
 * truth for FORBIDDEN_USER_FACING_PHRASES) for use by the active V1
 * narrative routes. These tests verify:
 *
 *   1. Single-string slot rewrites land in place
 *   2. Array-of-strings slots rewrite per element
 *   3. Non-string fields (numbers, nested objects, traces) pass through
 *      untouched — the response *shape* is invariant
 *   4. The result tuple exposes per-slot rewrite paths + the matched hit
 *      so the caller can emit one aggregated telemetry event
 *   5. No-op invocations report `rewritten: false` and don't allocate
 */

import { describe, expect, it } from 'vitest';
import {
  applyNarrativeEgressGuard,
  EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
} from '../egress-guard.js';

interface MockResponse {
  headline: string;
  body: string | undefined;
  evidence: string[];
  // Shape-invariance witnesses
  quality: { overall: number; structure: number };
  trace: { request_id: string };
}

function makeResponse(): MockResponse {
  return {
    headline: 'Hire two senior engineers locally is currently ahead.',
    body: 'The leading option carries the analysis.',
    evidence: [
      'Cost is the dominant factor.',
      'Delivery risk is well-mitigated.',
    ],
    quality: { overall: 85, structure: 90 },
    trace: { request_id: 'req-test-1' },
  };
}

describe('applyNarrativeEgressGuard — single string slots', () => {
  it('rewrites a slot containing a banned phrase to the neutral fallback', () => {
    const resp = makeResponse();
    resp.headline = 'Hire two senior engineers locally is recommended.';
    const out = applyNarrativeEgressGuard(
      resp,
      [
        { path: 'headline', get: (r) => r.headline, set: (r, v) => { r.headline = v; } },
      ],
    );
    expect(out.rewritten).toBe(true);
    expect(out.rewrites).toEqual([
      { path: 'headline', hit: expect.stringMatching(/recommended/i) },
    ]);
    expect(resp.headline).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
  });

  it('preserves a clean slot verbatim', () => {
    const resp = makeResponse();
    const before = resp.headline;
    const out = applyNarrativeEgressGuard(
      resp,
      [
        { path: 'headline', get: (r) => r.headline, set: (r, v) => { r.headline = v; } },
      ],
    );
    expect(out.rewritten).toBe(false);
    expect(out.rewrites).toEqual([]);
    expect(resp.headline).toBe(before);
  });

  it('skips undefined and empty slots without firing', () => {
    const resp = makeResponse();
    resp.body = undefined;
    const out = applyNarrativeEgressGuard(
      resp,
      [
        { path: 'body', get: (r) => r.body, set: (r, v) => { r.body = v; } },
      ],
    );
    expect(out.rewritten).toBe(false);
    expect(resp.body).toBeUndefined();
  });

  it('records every rewrite when multiple slots fire', () => {
    const resp = makeResponse();
    resp.headline = 'Hire two senior engineers locally is recommended.';
    resp.body = 'This recommendation is supported by the analysis.';
    const out = applyNarrativeEgressGuard(
      resp,
      [
        { path: 'headline', get: (r) => r.headline, set: (r, v) => { r.headline = v; } },
        { path: 'body', get: (r) => r.body, set: (r, v) => { r.body = v; } },
      ],
    );
    expect(out.rewritten).toBe(true);
    expect(out.rewrites.length).toBe(2);
    expect(out.rewrites.map((r) => r.path).sort()).toEqual(['body', 'headline']);
  });
});

describe('applyNarrativeEgressGuard — array slots', () => {
  it('rewrites individual array elements that contain banned phrases', () => {
    const resp = makeResponse();
    resp.evidence = [
      'Cost is the dominant factor.',
      'This recommendation has high confidence.',
      'The winner stands out clearly.',
    ];
    const out = applyNarrativeEgressGuard(
      resp,
      [],
      [
        {
          path: 'evidence',
          get: (r) => r.evidence,
          set: (r, v) => { r.evidence = [...v]; },
        },
      ],
    );
    expect(out.rewritten).toBe(true);
    expect(out.rewrites.length).toBe(2);
    expect(out.rewrites[0].path).toBe('evidence[1]');
    expect(out.rewrites[1].path).toBe('evidence[2]');
    expect(resp.evidence[0]).toBe('Cost is the dominant factor.');
    expect(resp.evidence[1]).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
    expect(resp.evidence[2]).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
  });

  it('preserves arrays whose elements are all clean', () => {
    const resp = makeResponse();
    const before = [...resp.evidence];
    const out = applyNarrativeEgressGuard(
      resp,
      [],
      [
        {
          path: 'evidence',
          get: (r) => r.evidence,
          set: (r, v) => { r.evidence = [...v]; },
        },
      ],
    );
    expect(out.rewritten).toBe(false);
    expect(resp.evidence).toEqual(before);
  });
});

describe('applyNarrativeEgressGuard — response shape invariance', () => {
  it('never touches non-string fields (numbers, nested objects, traces)', () => {
    const resp = makeResponse();
    resp.headline = 'Hire two senior engineers locally is recommended.';
    const before = {
      quality: { ...resp.quality },
      trace: { ...resp.trace },
    };
    applyNarrativeEgressGuard(
      resp,
      [
        { path: 'headline', get: (r) => r.headline, set: (r, v) => { r.headline = v; } },
      ],
    );
    expect(resp.quality).toEqual(before.quality);
    expect(resp.trace).toEqual(before.trace);
  });

  it('idempotent: a second pass on rewritten output is a no-op', () => {
    const resp = makeResponse();
    resp.headline = 'Hire two senior engineers locally is recommended.';
    applyNarrativeEgressGuard(
      resp,
      [
        { path: 'headline', get: (r) => r.headline, set: (r, v) => { r.headline = v; } },
      ],
    );
    const passTwo = applyNarrativeEgressGuard(
      resp,
      [
        { path: 'headline', get: (r) => r.headline, set: (r, v) => { r.headline = v; } },
      ],
    );
    expect(passTwo.rewritten).toBe(false);
  });
});

describe('applyNarrativeEgressGuard — slot-ownership contract', () => {
  // Codex review follow-up: document at the test layer that the
  // helper is schema-agnostic. Route-level slot definitions own
  // nested-shape assumptions; the helper only iterates them. If a
  // `get` returns a non-string (undefined / null / wrong type), the
  // helper skips silently rather than throwing — so a route that
  // builds a malformed response cannot crash the guard.
  it('skips a slot whose `get` returns a number (non-string)', () => {
    // Round-3 type-guard coverage: numbers are now caught by the
    // `typeof original !== 'string'` check rather than relying on
    // regex coercion accidentally producing no match. The companion
    // object-with-banned-toString test below proves the guard is
    // load-bearing (without it, an object that stringifies to a
    // banned phrase would crash the `set` callback).
    const resp = makeResponse();
    const out = applyNarrativeEgressGuard(
      resp,
      [
        {
          path: 'quality.overall',
          get: (r) => r.quality.overall as unknown as string,
          set: () => { throw new Error('set should never run for non-string get'); },
        },
      ],
    );
    expect(out.rewritten).toBe(false);
    expect(resp.quality.overall).toBe(85);
  });

  it('skips a slot whose `get` returns an object containing a banned token in its string form', () => {
    // Round-3 Codex follow-up: the previous "non-string number" test
    // passed by accident — coercion of a number to a string produces
    // digits that never match a banned-phrase regex, so the helper
    // looked safe even without a real type guard. An object whose
    // `String(obj)` includes "recommendation" exercises the actual
    // typeof guard: without it, the regex would match the coerced
    // string and trigger a rewrite that would crash `set` (since
    // `set` was given an object-shaped fixture). With the guard, the
    // helper skips silently and `set` never runs.
    const resp = makeResponse();
    const malformed: object = { toString: () => 'this is a recommendation object' };
    const setSpy = (): never => {
      throw new Error('set should never run for non-string get');
    };
    const out = applyNarrativeEgressGuard(
      resp,
      [
        {
          path: 'malformed_slot',
          get: () => malformed as unknown as string,
          set: setSpy,
        },
      ],
    );
    expect(out.rewritten).toBe(false);
    expect(out.rewrites).toEqual([]);
  });

  it('skips an array slot whose `get` returns undefined', () => {
    const resp = makeResponse();
    const before = [...resp.evidence];
    const out = applyNarrativeEgressGuard(
      resp,
      [],
      [
        {
          path: 'evidence.optional',
          get: () => undefined,
          set: () => { throw new Error('set should never run for undefined get'); },
        },
      ],
    );
    expect(out.rewritten).toBe(false);
    expect(resp.evidence).toEqual(before);
  });
});

describe('applyNarrativeEgressGuard — coverage of banned phrase set', () => {
  it.each([
    ['headline', 'The recommendation is to expand.', /recommendation/i],
    ['headline', 'X is recommended.', /recommended/i],
    ['headline', 'The winner is X.', /the\s+winner/i],
    ['headline', 'Winning option is X.', /winning\s+option/i],
  ])('rewrites %s containing banned phrase: %s', (path, raw, hitRe) => {
    const resp = makeResponse();
    resp.headline = raw;
    const out = applyNarrativeEgressGuard(
      resp,
      [
        { path, get: (r) => r.headline, set: (r, v) => { r.headline = v; } },
      ],
    );
    expect(out.rewritten).toBe(true);
    expect(out.rewrites[0].hit).toMatch(hitRe);
    expect(resp.headline).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
  });
});
