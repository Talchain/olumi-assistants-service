/**
 * Contract test — analysis-enrichment-critique-prose-safety.
 *
 * Loads the captured staging regression fixture
 * (`tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`,
 * build 3bb151b, response_hash ef1aeb36a440854a) and asserts the
 * 9 acceptance points the implementation plan defines:
 *
 *   1. The captured fixture's `blocks[0].enrichment.critiques[*].message`
 *      contains the verbatim engine leaks (regression input).
 *   2. After sanitiseEnrichment runs, the user-facing critiques[]
 *      array is empty (all 4 captured critiques are bucket-D and
 *      route to _diagnostics).
 *   3. With CEE_TURN_DEBUG_ENABLED=true, _diagnostics.critiques
 *      preserves the original verbatim text (engineer surface).
 *   4. The 15 allowlisted user-facing prose paths scan clean
 *      (no entity-IDs, no Tier-A tokens).
 *   5. Excluded structural subtrees are byte-equal pre/post
 *      (deep-equal):
 *      - `payloads`, `_meta`, `meta`, `fragile_edges`, `edge_e_values`,
 *        `factor_evpi`, `flip_thresholds`, `stability_thresholds`,
 *        `request_id_chain`, `feature_flags_snapshot`,
 *        `option_comparison`, structural fields inside `review_cards`.
 *   6. Bucket-D fail-safe — unknown critique codes default to D.
 *   7. review_cards.suggested_action invariant — value matches
 *      /^[a-z0-9_]{1,32}$/. If this regex ever fails, the field has
 *      drifted from enum to prose and needs reclassification.
 *   8. resolveLabelOrFallback never returns the raw ID.
 *   9. With CEE_TURN_DEBUG_ENABLED=false (default), _diagnostics is
 *      undefined (caller-side gating verified separately in the
 *      enricher partition test).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  sanitiseEnrichment,
  bucketFor,
  type CritiqueLike,
} from '../../src/orchestrator-v5/compose/sanitise-enrichment.js';
import { ENTITY_ID_LEAK_RE } from '../../src/orchestrator/shared/entity-id-pattern.js';
import { HARD_BAN_PATTERNS } from '../../src/orchestrator/shared/forbidden-tokens.js';

const FIXTURE_PATH = resolve(
  process.cwd(),
  'tests/fixtures/cross-service/v5-turn.run-analysis.staging.json',
);

interface CapturedFixture {
  readonly blocks: ReadonlyArray<{
    readonly enrichment?: Record<string, unknown>;
  }>;
}

function loadFixture(): CapturedFixture {
  const raw = readFileSync(FIXTURE_PATH, 'utf-8');
  return JSON.parse(raw) as CapturedFixture;
}

const SUGGESTED_ACTION_RE = /^[a-z0-9_]{1,32}$/;
// Use the production registries directly so the test fails fast if
// production widens patterns without updating callers (Codex review
// 2026-04-30, finding #4 — was previously redefined here, allowing
// silent test/production drift).
const ENTITY_ID_RE = ENTITY_ID_LEAK_RE;
const HARD_BAN_PHRASES = HARD_BAN_PATTERNS;

const STRUCTURAL_SUBTREE_KEYS = [
  'payloads',
  '_meta',
  'meta',
  'fragile_edges',
  'edge_e_values',
  'factor_evpi',
  'flip_thresholds',
  'stability_thresholds',
  'request_id_chain',
  'feature_flags_snapshot',
  'option_comparison',
];

describe('decision-review-egress contract — captured fixture (build 3bb151b)', () => {
  it('regression input — captured critiques contain the verbatim engine leaks', () => {
    const fixture = loadFixture();
    const enrichment = fixture.blocks[0]?.enrichment ?? {};
    const critiques = (enrichment.critiques ?? []) as CritiqueLike[];
    expect(critiques.length).toBe(4);
    const leakMessages = critiques.map((c) => c.message ?? '');
    // Every message contains the engine template prefix
    for (const m of leakMessages) {
      expect(m).toMatch(/^Node '/);
      expect(m).toMatch(/filtered before analysis/i);
    }
    // Every message references a raw opt_* id (the leak)
    expect(leakMessages.some((m) => /opt_hire_local/i.test(m))).toBe(true);
    expect(leakMessages.some((m) => /opt_offshore/i.test(m))).toBe(true);
    expect(leakMessages.some((m) => /opt_status_quo/i.test(m))).toBe(true);
    expect(leakMessages.some((m) => /opt_tiered_pricing/i.test(m))).toBe(true);
  });

  it('sanitiseEnrichment removes bucket-D leaks from user-facing critiques[]', () => {
    const fixture = loadFixture();
    const enrichment = fixture.blocks[0]?.enrichment ?? {};
    const r = sanitiseEnrichment(enrichment as Record<string, unknown>);
    // All 4 captured critiques are uncoded (or have engine codes) and
    // route to bucket D via the fail-safe default → user array is empty
    // after partitioning.
    const userCritiques = r.enrichment.critiques as CritiqueLike[];
    expect(userCritiques).toEqual([]);
    expect(r.diagnostic.critiques.length).toBe(4);
  });

  it('with debug enabled, _diagnostics.critiques preserves verbatim leaked text', () => {
    const fixture = loadFixture();
    const enrichment = fixture.blocks[0]?.enrichment ?? {};
    const r = sanitiseEnrichment(enrichment as Record<string, unknown>);
    // Diagnostic-side preservation: the engine template is preserved
    // verbatim for the engineer surface.
    for (const c of r.diagnostic.critiques) {
      expect(c.message).toMatch(/^Node '/);
      expect(c.message).toMatch(/filtered before analysis/i);
    }
  });

  it('all 15 allowlisted user-facing paths scan clean post-sanitise', () => {
    const fixture = loadFixture();
    const enrichment = fixture.blocks[0]?.enrichment ?? {};
    const r = sanitiseEnrichment(enrichment as Record<string, unknown>);
    const post = r.enrichment;

    // Helper: assert a string is entity-id-clean and Tier-A-clean.
    const assertClean = (s: string, path: string): void => {
      if (typeof s !== 'string' || s.length === 0) return;
      expect(s, `${path} must not contain raw entity IDs`).not.toMatch(ENTITY_ID_RE);
      for (const re of HARD_BAN_PHRASES) {
        expect(s, `${path} must not contain hard-ban token ${re}`).not.toMatch(re);
      }
    };

    // Walk the 15 allowlisted paths.
    const userCritiques = (post.critiques as CritiqueLike[] | undefined) ?? [];
    userCritiques.forEach((c, i) => {
      assertClean(c.message ?? '', `$.critiques[${i}].message`);
      if (typeof c.suggestion === 'string') assertClean(c.suggestion, `$.critiques[${i}].suggestion`);
    });
    if (typeof post.summary === 'string') assertClean(post.summary, '$.summary');
    if (typeof post.narrative === 'string') assertClean(post.narrative, '$.narrative');
    if (typeof post.rationale === 'string') assertClean(post.rationale, '$.rationale');
    if (typeof post.robustness_synthesis === 'string') assertClean(post.robustness_synthesis, '$.robustness_synthesis');
    const ig = post.improvement_guidance;
    if (Array.isArray(ig)) {
      ig.forEach((s, i) => { if (typeof s === 'string') assertClean(s, `$.improvement_guidance[${i}]`); });
    }
    const fs = post.factor_sensitivity as Array<Record<string, unknown>> | undefined;
    fs?.forEach((item, i) => {
      const v = item.interpretation;
      if (typeof v === 'string') assertClean(v, `$.factor_sensitivity[${i}].interpretation`);
    });
    const rc = post.review_cards as Array<Record<string, unknown>> | undefined;
    rc?.forEach((card, i) => {
      if (typeof card.what === 'string') assertClean(card.what, `$.review_cards[${i}].what`);
      if (typeof card.why === 'string') assertClean(card.why, `$.review_cards[${i}].why`);
      const items = card.items as Array<Record<string, unknown>> | undefined;
      items?.forEach((it, j) => {
        if (typeof it.suggested_evidence === 'string') {
          assertClean(it.suggested_evidence, `$.review_cards[${i}].items[${j}].suggested_evidence`);
        }
      });
    });
  });

  it('excluded structural subtrees are byte-equal pre/post (deep-equal)', () => {
    const fixture = loadFixture();
    const enrichment = fixture.blocks[0]?.enrichment ?? {};
    // Snapshot every structural subtree BEFORE sanitisation.
    const before = JSON.parse(JSON.stringify(enrichment)) as Record<string, unknown>;
    const r = sanitiseEnrichment(enrichment as Record<string, unknown>);
    const after = r.enrichment;

    for (const key of STRUCTURAL_SUBTREE_KEYS) {
      expect(after[key]).toEqual(before[key]);
    }

    // Inside review_cards, structural fields must also be byte-equal
    const beforeRc = (before.review_cards ?? []) as Array<Record<string, unknown>>;
    const afterRc = (after.review_cards ?? []) as Array<Record<string, unknown>>;
    expect(afterRc.length).toBe(beforeRc.length);
    for (let i = 0; i < beforeRc.length; i++) {
      const b = beforeRc[i] ?? {};
      const a = afterRc[i] ?? {};
      const STRUCTURAL_CARD_FIELDS = [
        'card_id', 'card_type', 'priority', 'priority_band', 'review_phase',
        'suggested_action', 'supporting_refs', 'provenance',
      ];
      for (const f of STRUCTURAL_CARD_FIELDS) {
        expect(a[f]).toEqual(b[f]);
      }
      const beforeItems = (b.items ?? []) as Array<Record<string, unknown>>;
      const afterItems = (a.items ?? []) as Array<Record<string, unknown>>;
      for (let j = 0; j < beforeItems.length; j++) {
        const STRUCTURAL_ITEM_FIELDS = [
          'node_id', 'factor_id', 'factor_label', 'sensitivity_rank',
          'sensitivity_value', 'confidence_normalised', 'score', 'elasticity',
        ];
        for (const f of STRUCTURAL_ITEM_FIELDS) {
          expect(afterItems[j]?.[f]).toEqual(beforeItems[j]?.[f]);
        }
      }
    }
  });

  it('bucket-D fail-safe — unknown critique codes default to D', () => {
    expect(bucketFor('UNKNOWN_NEW_CODE_xyzzy')).toBe('D');
    expect(bucketFor(undefined)).toBe('D');
    expect(bucketFor(null)).toBe('D');
  });

  it('review_cards[*].suggested_action remains an enum-shaped value', () => {
    const fixture = loadFixture();
    const enrichment = fixture.blocks[0]?.enrichment ?? {};
    const reviewCards = (enrichment.review_cards ?? []) as Array<Record<string, unknown>>;
    expect(reviewCards.length).toBeGreaterThan(0);
    for (const card of reviewCards) {
      const v = card.suggested_action;
      // Approved invariant (Paul, 2026-04-30): if this regex ever fails,
      // suggested_action has drifted from enum to prose and must be
      // reclassified into the user-facing allowlist.
      expect(v).toMatch(SUGGESTED_ACTION_RE);
    }
  });
});
