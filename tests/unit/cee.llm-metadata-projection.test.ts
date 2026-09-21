/**
 * `trace.pipeline.llm_metadata` — ONE projection, not two hand-maintained lists.
 *
 * WHY THIS EXISTS. `runaway_abort_count` has been populated on the Anthropic
 * adapter's result meta since 2026-07-23. It was absent from **all 60 response
 * bodies** captured on 2026-07-24, because the wire projection was written out
 * BY HAND in two places — 15 keys on the success surface (`stages/package.ts`),
 * 6 on the error surface (`unified-pipeline/index.ts`) — and neither list
 * included it. The error list also omitted `max_tokens`, so a truncation's cap
 * (the single most diagnostic number on a truncation) had to be INFERRED from
 * `completion_tokens`.
 *
 * The mirror is the defect. These tests pin that both surfaces are derived from
 * one function, and that the runaway diagnostics actually survive to the wire.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildLlmMetadataProjection } from '../../src/cee/unified-pipeline/llm-metadata-projection.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A realistic adapter meta for a TRUNCATED draft after two runaway aborts. */
const truncatedMeta = {
  model: 'claude-sonnet-4-6',
  prompt_version: 'draft_graph_default@v195',
  prompt_hash: 'abc123',
  temperature: 0,
  provider_latency_ms: 89_748,
  finish_reason: 'max_tokens',
  max_tokens: 3_150,
  streamed: true,
  runaway_abort_count: 2,
  time_to_edges_ms: null,
  token_usage: { prompt_tokens: 1_000, completion_tokens: 3_148, total_tokens: 4_148 },
};

describe('buildLlmMetadataProjection — the runaway diagnostics reach the wire', () => {
  it('carries runaway_abort_count — the field that was silently stripped from all 60 captures', () => {
    const projected = buildLlmMetadataProjection(truncatedMeta, 'fallback-model');
    expect(projected.runaway_abort_count).toBe(2);
  });

  it('carries max_tokens on a FAILED draft, so the cap no longer has to be inferred from completion_tokens', () => {
    const projected = buildLlmMetadataProjection(truncatedMeta, 'fallback-model');
    expect(projected.max_tokens).toBe(3_150);
    expect(projected.finish_reason).toBe('max_tokens');
    // The inference the 2026-07-24 probe was forced into: cap == completion_tokens.
    // With the cap present, the two are independently observable and can DISAGREE
    // (3,150 vs 3,148) — which is exactly the signal that was being lost.
    expect(projected.max_tokens).not.toBe(
      (truncatedMeta.token_usage as { completion_tokens: number }).completion_tokens,
    );
  });

  it('carries the rest of the streaming diagnostics', () => {
    const projected = buildLlmMetadataProjection(truncatedMeta, 'fallback-model');
    expect(projected.streamed).toBe(true);
    expect(projected.time_to_edges_ms).toBeNull();
  });

  it('falls back to the adapter model when no meta is present (unchanged contract)', () => {
    expect(buildLlmMetadataProjection(undefined, 'fallback-model')).toEqual({
      model: 'fallback-model',
    });
  });

  it('does NOT leak raw LLM text or parsed JSON onto the wire', () => {
    const projected = buildLlmMetadataProjection(
      { ...truncatedMeta, raw_llm_text: 'x'.repeat(50), raw_llm_json: { nodes: [] } },
      'fallback-model',
    );
    expect(projected).not.toHaveProperty('raw_llm_text');
    expect(projected).not.toHaveProperty('raw_llm_json');
    // Only the LENGTH is projected — the existing contract, preserved.
    expect(projected.response_chars).toBe(50);
  });
});

describe('DRIFT PIN — neither surface may hand-write its own keep-list again', () => {
  const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

  it('the success surface (stages/package.ts) delegates to the shared projection', () => {
    const src = read('src/cee/unified-pipeline/stages/package.ts');
    expect(src).toContain('llm_metadata: buildLlmMetadataProjection(');
  });

  it('the error surface (unified-pipeline/index.ts) delegates to the SAME projection', () => {
    const src = read('src/cee/unified-pipeline/index.ts');
    expect(src).toContain('llm_metadata: buildLlmMetadataProjection(');
  });

  it('the Anthropic draft path attaches ONE shared `_llm_meta` object, not per-throw copies', () => {
    // ⚠ FOUND LIVE, 2026-07-25, minutes after the projection fix deployed. The
    // adapter had a THIRD hand-built `_llm_meta` at the schema-validation throw:
    // a field-for-field duplicate of `failedCallLlmMeta` MINUS `max_tokens`,
    // `runaway_abort_count` and `time_to_edges_ms`. And that is the LIVE
    // truncation path — a generation cut at max_tokens usually still yields text
    // the extractor turns into a partial object, which fails schema validation
    // there, not at the parse throw. So every truncation-400 on staging 65813b6
    // STILL shipped without the cap or the abort count. Same mirror, one file
    // downstream of the one that was just closed.
    //
    // Exactly ONE inline `_llm_meta: {` literal is permitted: the final-attempt
    // SKIP-GATE, which throws BEFORE any provider response exists and therefore
    // genuinely cannot share the response-derived object.
    const src = read('src/adapters/llm/anthropic.ts');
    // ⭐ TIGHTENED 1 -> 0 (2026-07-25). The one remaining inline literal was the
    // `skipped_unaffordable_final` throw — a FOURTH hand-built copy of this shape,
    // authored ~400 lines from the commit that deleted the third, and two keys
    // short of the canonical meta (`time_to_edges_ms`, `token_usage`). It now
    // derives from `buildFailedCallLlmMeta` like every other site, so the honest
    // count is ZERO and this pin can finally forbid the pattern outright instead
    // of tolerating one instance of it.
    const inlineLiterals = src.match(/_llm_meta:\s*\{/g) ?? [];
    expect(inlineLiterals, 'a hand-built `_llm_meta: { ... }` literal has reappeared — use buildFailedCallLlmMeta (draft-budget.ts) so a key added to the canonical meta reaches EVERY failure route').toHaveLength(0);
    // …and the shared object is what the response-path throws carry.
    expect(src).toContain('_llm_meta: failedCallLlmMeta');
  });

  it('exactly one module builds the projection — a third call site is fine, a second BUILDER is not', () => {
    // The builder is identified by the literal key list it owns. If a surface
    // starts writing `llm_metadata: {` with an inline object again, this fails.
    for (const rel of [
      'src/cee/unified-pipeline/stages/package.ts',
      'src/cee/unified-pipeline/index.ts',
    ]) {
      expect(read(rel)).not.toMatch(/llm_metadata:\s*\{/);
      expect(read(rel)).not.toMatch(/llm_metadata:\s*ctx\.llmMeta\s*\n?\s*\?/);
    }
  });
});
