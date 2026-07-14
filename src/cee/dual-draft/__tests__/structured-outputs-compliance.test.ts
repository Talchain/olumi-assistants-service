/**
 * PROPOSALS_JSON_SCHEMA — Anthropic structured-outputs API compliance pin.
 *
 * The adapter passes outputSchema through VERBATIM ("compliant by
 * construction — no runtime normalisation", anthropic.ts). Live probes
 * against the GA output_config endpoint (2026-07-14, claude-sonnet-5 and
 * claude-sonnet-4-6) show the API REJECTS with a 400:
 *   - `maxItems` on arrays        ("property 'maxItems' is not supported")
 *   - `minimum`/`maximum`/`exclusiveMinimum` on numbers
 * while ACCEPTING `enum`, `minLength`, `maxLength` on strings and
 * `additionalProperties`/`required` on objects.
 *
 * The shipped M2 schema used maxItems (proposals, uncertainty_drivers) and
 * numeric bounds (strength.mean/std, exists_probability), so EVERY
 * structured-outputs M2 call would have 400'd once and then FALLEN BACK to
 * prompt-only JSON (isStructuredOutputsRejection matches the message via its
 * 'output_config' / 'not supported' substrings): a wasted round trip plus a
 * structured_outputs_fell_back telemetry event on every M2 turn, and no
 * schema guarantee — defeating the stage's structured-outputs-only design
 * (D2). Never caught live because M2 has never been live (fail-closed
 * sentinel).
 *
 * The schema is a FIRST FENCE only: G5 (PROPOSAL_CAP), G10 (numeric sanity)
 * and G-size caps remain authoritatively enforced by the deterministic merge,
 * so dropping the unsupported keywords loses no enforcement — only an
 * advisory hint the API refuses to compile anyway.
 */
import { describe, it, expect } from 'vitest';
import { PROPOSALS_JSON_SCHEMA } from '../proposal-json-schema.js';

/** Keywords the Anthropic structured-outputs compiler rejects (live-probed). */
const UNSUPPORTED_KEYWORDS = ['maxItems', 'minItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'] as const;

function collectKeywordPaths(
  value: unknown,
  keyword: string,
  trail: string,
  hits: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectKeywordPaths(v, keyword, `${trail}[${i}]`, hits));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === keyword) hits.push(`${trail}.${k}`);
    collectKeywordPaths(v, keyword, `${trail}.${k}`, hits);
  }
}

describe('PROPOSALS_JSON_SCHEMA structured-outputs compliance', () => {
  for (const keyword of UNSUPPORTED_KEYWORDS) {
    it(`contains no API-rejected keyword "${keyword}"`, () => {
      const hits: string[] = [];
      collectKeywordPaths(PROPOSALS_JSON_SCHEMA, keyword, '$', hits);
      expect(hits, `API rejects "${keyword}" — found at: ${hits.join(', ')}`).toEqual([]);
    });
  }

  it('still closes every object (additionalProperties: false) — the supported part of the fence', () => {
    const opens: string[] = [];
    const walk = (value: unknown, trail: string): void => {
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${trail}[${i}]`));
        return;
      }
      if (value === null || typeof value !== 'object') return;
      const obj = value as Record<string, unknown>;
      if (obj.type === 'object' && obj.additionalProperties !== false) opens.push(trail);
      for (const [k, v] of Object.entries(obj)) walk(v, `${trail}.${k}`);
    };
    walk(PROPOSALS_JSON_SCHEMA, '$');
    expect(opens).toEqual([]);
  });
});
