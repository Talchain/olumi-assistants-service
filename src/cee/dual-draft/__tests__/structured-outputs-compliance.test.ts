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
import {
  UNSUPPORTED_KEYWORDS,
  MIN_ITEMS_ALLOWED_VALUES,
} from '../../../adapters/llm/anthropic-schema-compliance.js';

// IMPORTED, not re-listed. This file previously carried its own 6-keyword copy
// of the policy that still banned `minItems` outright — and because it lives
// under `src/`, not `tests/`, the sweep that corrected the other copies missed
// it. It was not a silent green but a FALSE RED waiting to happen: applying
// #529's live-proven `minItems: 1` fix to PROPOSALS_JSON_SCHEMA would have
// failed here with "API rejects minItems", a claim #529 disproved by probe,
// and the natural response is to back the working fix out.

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

/** Collect every `minItems` value in the tree with its path. */
function collectMinItemsValues(
  value: unknown,
  trail = '$',
  out: { path: string; value: unknown }[] = [],
): { path: string; value: unknown }[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectMinItemsValues(v, `${trail}[${i}]`, out));
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'minItems') out.push({ path: trail, value: v });
    collectMinItemsValues(v, `${trail}.${k}`, out);
  }
  return out;
}

/**
 * KNOWN GAP, recorded rather than hidden.
 *
 * `PROPOSALS_JSON_SCHEMA` is passed to the Anthropic API RAW — `anthropic.ts`
 * states "Schema is compliant by construction — no runtime normalisation
 * needed" and assigns `normalisedOutputSchema = args.outputSchema`. It is NOT
 * put through `enforceAnthropicSchemaCompliance`, so anything the canonical
 * policy strips would reach the API unstripped.
 *
 * It currently carries `minLength` (1 site) and `maxLength` (7 sites), both of
 * which ARE in the canonical UNSUPPORTED_KEYWORDS. Whether that is a live
 * defect in M2 review or an over-broad entry in the policy has NOT been
 * probed, and resolving it is a correctness question outside this cleanup.
 *
 * These two are therefore TOLERATED here — named, with a reason — and the
 * tolerance is SELF-CHECKING: if either keyword disappears from the schema
 * (or is probed and removed from the policy), the stale-gap assertion below
 * goes red and forces the exemption out. A gap nobody can forget is the point.
 */
const KNOWN_UNENFORCED_KEYWORDS = new Set(['minLength', 'maxLength']);

const ENFORCED_KEYWORDS = [...UNSUPPORTED_KEYWORDS].filter(
  (k) => !KNOWN_UNENFORCED_KEYWORDS.has(k),
);

describe('PROPOSALS_JSON_SCHEMA structured-outputs compliance', () => {
  it('the known-gap list is still real (no stale exemptions)', () => {
    // Positive control for the tolerance above: prove each exempted keyword is
    // BOTH in the canonical policy AND actually present in the schema. An
    // exemption that no longer describes reality must not survive quietly.
    for (const keyword of KNOWN_UNENFORCED_KEYWORDS) {
      expect([...UNSUPPORTED_KEYWORDS], `"${keyword}" is no longer in the canonical policy — drop the exemption`)
        .toContain(keyword);
      const hits: string[] = [];
      collectKeywordPaths(PROPOSALS_JSON_SCHEMA, keyword, '$', hits);
      expect(hits.length, `"${keyword}" is no longer in PROPOSALS_JSON_SCHEMA — drop the exemption`)
        .toBeGreaterThan(0);
    }
  });

  for (const keyword of ENFORCED_KEYWORDS) {
    it(`contains no API-rejected keyword "${keyword}"`, () => {
      const hits: string[] = [];
      collectKeywordPaths(PROPOSALS_JSON_SCHEMA, keyword, '$', hits);
      expect(hits, `API rejects "${keyword}" — found at: ${hits.join(', ')}`).toEqual([]);
    });
  }

  it('permits minItems, but only with an API-accepted value', () => {
    // `minItems` is deliberately absent from UNSUPPORTED_KEYWORDS: the grammar
    // compiler accepts 0 and 1 and rejects everything else (live-probed
    // 2026-07-19). `minItems: 1` is the only grammar-level lever that stops the
    // model satisfying a `required` array with `[]` — the OPTIONS_IDENTICAL
    // outage. So the policy here is a VALUE check, not a ban.
    for (const { path, value } of collectMinItemsValues(PROPOSALS_JSON_SCHEMA)) {
      expect(
        [...MIN_ITEMS_ALLOWED_VALUES],
        `${path}.minItems = ${String(value)} — the API accepts only 0 or 1`,
      ).toContain(value);
    }
  });

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
