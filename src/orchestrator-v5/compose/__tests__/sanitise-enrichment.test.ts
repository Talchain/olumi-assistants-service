import { describe, expect, it } from 'vitest';

import {
  CRITIQUE_BUCKETS,
  S_BUCKET_REPLACEMENTS,
  SUPPRESSED_PROSE_FALLBACK,
  bucketFor,
  isAllowlistedPath,
  partitionCritiques,
  sanitiseEnrichment,
  sanitiseEnrichmentText,
  type CritiqueLike,
} from '../sanitise-enrichment.js';
import type { LabelResolverContext } from '../resolve-label.js';

const GRAPH = {
  nodes: [
    { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally', kind: 'option' },
    { id: 'opt_offshore', label: 'Engage Offshore Partner', kind: 'option' },
    { id: 'fac_hiring_cost', label: 'Hiring and Staffing Cost', kind: 'factor' },
  ],
  edges: [],
} as unknown as LabelResolverContext['graph'];

const CTX: LabelResolverContext = { graph: GRAPH };

// =============================================================================
// bucketFor — fail-safe rule + classification table coverage
// =============================================================================

describe('bucketFor — bucket classification', () => {
  it('every U-bucket entry maps to U', () => {
    const expectedU = ['NO_OPTIONS', 'INSUFFICIENT_OPTIONS', 'DEGENERATE_OUTCOMES'];
    for (const code of expectedU) {
      expect(bucketFor(code)).toBe('U');
      expect(CRITIQUE_BUCKETS[code]).toBe('U');
    }
  });

  it('every S-bucket entry maps to S', () => {
    const expectedS = [
      'EMPTY_INTERVENTIONS', 'INVALID_INTERVENTION_TARGET',
      'NO_EFFECTIVE_PATH_TO_GOAL', 'IDENTICAL_OPTIONS', 'GRAPH_DISCONNECTED',
      'OPTION_NO_INTERVENTIONS', 'LOW_EFFECTIVE_SAMPLES',
      'DEGENERATE_OPTION_ZERO_VARIANCE', 'HIGH_TIE_RATE',
      'SAMPLES_REDUCED_FOR_COMPLEXITY',
    ];
    for (const code of expectedS) {
      expect(bucketFor(code)).toBe('S');
    }
  });

  it('every D-bucket entry maps to D', () => {
    const expectedD = [
      'MISSING_GOAL_NODE', 'GRAPH_CYCLE_DETECTED', 'GRAPH_EMPTY',
      'INVALID_NODE_ID', 'DUPLICATE_NODE_ID', 'EDGE_STRENGTH_OUT_OF_RANGE',
      'EDGE_STD_INVALID', 'EDGE_ENDPOINT_MISSING', 'NEGLIGIBLE_EDGE_STRENGTH',
      'DUPLICATE_OPTION_ID', 'INTERVENTION_VALUE_INVALID', 'MONTE_CARLO_FAILED',
      'BASELINE_NEAR_ZERO', 'INFERENCE_TIMEOUT', 'SEED_INVALID',
      'NUMERICAL_INSTABILITY', 'IDENTIFIABILITY_ISSUE',
      'CONSTRAINT_NODE_DEFAULT_BASE', 'INTERNAL_ERROR',
    ];
    for (const code of expectedD) {
      expect(bucketFor(code)).toBe('D');
    }
  });

  it('classification totals match the plan: D=22 explicit, U=3, S=10 (seam item 3 added SAMPLES_REDUCED_FOR_COMPLEXITY to S)', () => {
    const counts = { D: 0, U: 0, S: 0 };
    for (const b of Object.values(CRITIQUE_BUCKETS)) counts[b]++;
    expect(counts.U).toBe(3);
    // Was 9 in the original 31-ISL-code plan; SAMPLES_REDUCED_FOR_COMPLEXITY
    // (PLoT-authored degraded-success disclosure, #212/#209) was consciously
    // promoted to S per the CRITIQUE_BUCKETS honest-surfacing ruling.
    expect(counts.S).toBe(10);
    // 19 original explicit D entries + 3 added by lane 3 Car 3 (2026-08-04:
    // GOAL_ANCESTOR_DATA_GAP, STRUCTURAL_INFLUENCE_TRUNCATED,
    // MARGINAL_SWITCH_TRUNCATED — previously suppressed by the fail-safe
    // with no recorded decision). The captured uncoded leak still hits the
    // fail-safe default (no entry in the map → bucketFor returns 'D').
    // Completeness vs the ISL corpus is pinned separately in
    // critique-buckets-completeness.test.ts.
    expect(counts.D).toBe(22);
  });

  it('FAIL-SAFE — unknown codes default to D', () => {
    expect(bucketFor('UNKNOWN_NEW_CODE_xyzzy')).toBe('D');
    expect(bucketFor(undefined)).toBe('D');
    expect(bucketFor(null)).toBe('D');
    expect(bucketFor('')).toBe('D');
  });
});

// =============================================================================
// S_BUCKET_REPLACEMENTS — Paul-approved copy verbatim
// =============================================================================

describe('S_BUCKET_REPLACEMENTS — pinned approved copy (Paul, 2026-04-30)', () => {
  it('EMPTY_INTERVENTIONS', () => {
    const out = S_BUCKET_REPLACEMENTS.EMPTY_INTERVENTIONS!(CTX, {
      affected_option_ids: ['opt_hire_local'],
    });
    expect(out).toBe(
      "Option 'Hire Two Senior Engineers Locally' does not change anything yet. Specify what makes this option different.",
    );
  });

  it('INVALID_INTERVENTION_TARGET', () => {
    const out = S_BUCKET_REPLACEMENTS.INVALID_INTERVENTION_TARGET!(CTX, {
      affected_option_ids: ['opt_offshore'],
    });
    expect(out).toBe(
      "Option 'Engage Offshore Partner' refers to something that is not currently in the model.",
    );
  });

  it('NO_EFFECTIVE_PATH_TO_GOAL', () => {
    const out = S_BUCKET_REPLACEMENTS.NO_EFFECTIVE_PATH_TO_GOAL!(CTX, {
      affected_option_ids: ['opt_hire_local'],
    });
    expect(out).toBe(
      "Option 'Hire Two Senior Engineers Locally' does not currently connect to your goal.",
    );
  });

  it('IDENTICAL_OPTIONS', () => {
    const out = S_BUCKET_REPLACEMENTS.IDENTICAL_OPTIONS!(CTX, {
      affected_option_ids: ['opt_hire_local', 'opt_offshore'],
    });
    expect(out).toBe(
      "Options 'Hire Two Senior Engineers Locally' and 'Engage Offshore Partner' currently make the same changes, so the analysis treats them as equivalent.",
    );
  });

  it('GRAPH_DISCONNECTED', () => {
    const out = S_BUCKET_REPLACEMENTS.GRAPH_DISCONNECTED!(CTX, {});
    expect(out).toBe('Some parts of the model are not connected to your goal.');
  });

  it('OPTION_NO_INTERVENTIONS', () => {
    const out = S_BUCKET_REPLACEMENTS.OPTION_NO_INTERVENTIONS!(CTX, {
      affected_option_ids: ['opt_offshore'],
    });
    // V5 stale-aware explain recovery: wording avoids the brief's
    // forbidden "no changes" token AND the legacy "interventions"
    // jargon ban. "Makes no adjustments" carries the same semantic.
    expect(out).toBe(
      "Option 'Engage Offshore Partner' represents the status quo and makes no adjustments to the model.",
    );
  });

  it('LOW_EFFECTIVE_SAMPLES', () => {
    const out = S_BUCKET_REPLACEMENTS.LOW_EFFECTIVE_SAMPLES!(CTX, {});
    expect(out).toBe(
      'This analysis is less reliable than usual, so treat the result as a signal to check rather than a settled answer.',
    );
  });

  it('SAMPLES_REDUCED_FOR_COMPLEXITY (seam item 3 — PLoT degraded-success disclosure)', () => {
    const out = S_BUCKET_REPLACEMENTS.SAMPLES_REDUCED_FOR_COMPLEXITY!(CTX, {});
    expect(out).toBe(
      'Because this model is complex, the analysis ran fewer simulations than usual, so results may be less precise.',
    );
  });

  it('DEGENERATE_OPTION_ZERO_VARIANCE', () => {
    const out = S_BUCKET_REPLACEMENTS.DEGENERATE_OPTION_ZERO_VARIANCE!(CTX, {
      affected_option_ids: ['opt_hire_local'],
    });
    expect(out).toBe("Option 'Hire Two Senior Engineers Locally' does not currently affect the goal.");
  });

  it('HIGH_TIE_RATE', () => {
    const out = S_BUCKET_REPLACEMENTS.HIGH_TIE_RATE!(CTX, {});
    expect(out).toBe(
      'The options are very close in this analysis. Treat the current lead as finely balanced.',
    );
  });

  it('falls back to "the relevant option" when no graph context is available', () => {
    const out = S_BUCKET_REPLACEMENTS.EMPTY_INTERVENTIONS!({}, {
      affected_option_ids: ['opt_unknown'],
    });
    expect(out).toBe(
      "Option 'the relevant option' does not change anything yet. Specify what makes this option different.",
    );
  });

  it('all 9 replacements are free of the forbidden vocabulary set', () => {
    const FORBIDDEN = [
      /\binterventions?\b/i, /\bnode\b/i, /\bsamples?\b/i,
      /\bmonte\s+carlo\b/i, /\bcausal\s+paths?\b/i, /\bbootstrap\b/i,
      /\bvariance\b/i, /\bsimulated\s+futures?\b/i, /\bwin\s+probabilit/i,
    ];
    const checkAgainstForbidden = (s: string) => {
      for (const re of FORBIDDEN) {
        expect(s).not.toMatch(re);
      }
    };
    for (const fn of Object.values(S_BUCKET_REPLACEMENTS)) {
      const out = fn(CTX, { affected_option_ids: ['opt_hire_local', 'opt_offshore'] });
      checkAgainstForbidden(out);
    }
  });

  // V5 stale-aware explain recovery — drift guard.
  // Every replacement template must also be free of the brief's
  // "hard-fail prose" list (FORBIDDEN_USER_FACING_PHRASES). Without
  // this check, a future template addition could re-introduce a
  // contradiction phrase that the finaliser-level egress guard would
  // then have to rewrite — which both loses the informative prose AND
  // emits a noisy `v5.egress.forbidden_phrase_detected` event on
  // every analysis turn. The drift guard catches it at unit-test
  // time, where the fix is to change the template.
  it('no replacement contains any FORBIDDEN_USER_FACING_PHRASES entry', async () => {
    const { findForbiddenPhraseHit } = await import(
      '../forbidden-user-facing-phrases.js'
    );
    for (const [code, fn] of Object.entries(S_BUCKET_REPLACEMENTS)) {
      const out = fn(CTX, { affected_option_ids: ['opt_hire_local', 'opt_offshore'] });
      const hit = findForbiddenPhraseHit(out);
      if (hit !== null) {
        throw new Error(
          `S_BUCKET_REPLACEMENTS.${code} contains forbidden phrase ` +
            `${JSON.stringify(hit)}: ${JSON.stringify(out)}`,
        );
      }
      expect(hit).toBeNull();
    }
  });
});

// =============================================================================
// sanitiseEnrichmentText — per-string scrubber
// =============================================================================

describe('sanitiseEnrichmentText — per-string scrubber', () => {
  it('resolves a known entity ID to its label', () => {
    const r = sanitiseEnrichmentText("Option 'opt_hire_local' looks weak.", CTX);
    expect(r.text).toBe("Option 'Hire Two Senior Engineers Locally' looks weak.");
    expect(r.resolved).toEqual([
      { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally' },
    ]);
    expect(r.hardBans).toEqual([]);
  });

  it('falls back to prefix-aware generic when label is unknown', () => {
    const r = sanitiseEnrichmentText('opt_mystery is risky.', CTX);
    expect(r.text).toBe('the relevant option is risky.');
    expect(r.hardBans).toEqual([]);
  });

  it('flags HARD_BAN tokens (Tier A) — captured staging leak', () => {
    const r = sanitiseEnrichmentText(
      "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.",
      CTX,
    );
    expect(r.text).toContain('Hire Two Senior Engineers Locally');
    expect(r.hardBans.length).toBeGreaterThan(0);
    // Each hard-ban hit is a real engine token
    expect(r.hardBans.some((h) => /^Node '/.test(h))).toBe(true);
    expect(r.hardBans.some((h) => /filtered before analysis/i.test(h))).toBe(true);
  });

  it('flags WARNING tokens (Tier B) — does not modify text', () => {
    const r = sanitiseEnrichmentText(
      'The interventions are causal paths through the model.',
      CTX,
    );
    expect(r.warnings.length).toBeGreaterThan(0);
    // Tier B never goes into hard-bans
    expect(r.hardBans).toEqual([]);
  });

  it('returns clean text unchanged with empty resolved/hardBans/warnings', () => {
    const r = sanitiseEnrichmentText('Decision quality looks good.', CTX);
    expect(r.text).toBe('Decision quality looks good.');
    expect(r.resolved).toEqual([]);
    expect(r.hardBans).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('handles empty / null input safely', () => {
    expect(sanitiseEnrichmentText('', CTX)).toEqual({
      text: '',
      hardBans: [],
      warnings: [],
      resolved: [],
      suppress: false,
    });
  });
});

// =============================================================================
// Fail-shut behaviour (Codex review 2026-04-30, findings #1–#3)
// =============================================================================

describe('fail-shut behaviour — hard-ban hits suppress the field, not just record', () => {
  it('sanitiseEnrichmentText sets suppress=true when ANY hard-ban pattern matches', () => {
    const r = sanitiseEnrichmentText(
      "Node 'opt_hire_local' has kind='option'.",
      CTX,
    );
    expect(r.suppress).toBe(true);
    expect(r.hardBans.length).toBeGreaterThan(0);
  });

  it('sanitiseEnrichmentText sets suppress=false on clean prose', () => {
    const r = sanitiseEnrichmentText('Option opt_hire_local leads.', CTX);
    expect(r.suppress).toBe(false);
    expect(r.text).toBe('Option Hire Two Senior Engineers Locally leads.');
  });

  it('U-bucket critique routes to D when message tripped a hard-ban after ID resolution', () => {
    const c: CritiqueLike = {
      id: 'c1',
      code: 'NO_OPTIONS', // U-bucket
      severity: 'blocker',
      message: "Node 'opt_hire_local' is an option.",
    };
    const r = partitionCritiques([c], CTX);
    expect(r.user).toHaveLength(0);
    expect(r.diagnostic).toHaveLength(1);
    expect(r.diagnostic[0]?.id).toBe('c1');
    // Structural fields preserved on the routed critique
    expect(r.diagnostic[0]?.code).toBe('NO_OPTIONS');
  });

  it('U-bucket critique routes to D when SUGGESTION tripped a hard-ban (message clean)', () => {
    const c: CritiqueLike = {
      id: 'c1',
      code: 'NO_OPTIONS',
      severity: 'blocker',
      message: 'No options provided for comparison.',
      suggestion: "Add an option. Option nodes are filtered before analysis.",
    };
    const r = partitionCritiques([c], CTX);
    expect(r.user).toHaveLength(0);
    expect(r.diagnostic).toHaveLength(1);
  });

  it('S-bucket critique routes to D if the replacement itself trips a hard-ban', () => {
    // Construct a label that:
    //  1. Passes the unsafe-label check (no `ENTITY_ID_LEAK_RE` token)
    //     so the resolver returns it.
    //  2. Contains a HARD_BAN token so the post-resolution scan trips
    //     the sanitiser's fail-shut.
    // "Filtered before analysis result" matches the case-insensitive
    // "filtered before analysis" hard-ban pattern but contains no
    // entity-id-shaped tokens.
    const poisonedCtx = {
      analysisReady: {
        options: [
          { option_id: 'opt_h', label: 'Filtered before analysis result' },
        ],
      },
    };
    const c: CritiqueLike = {
      id: 'c1',
      code: 'IDENTICAL_OPTIONS',
      severity: 'blocker',
      affected_option_ids: ['opt_h', 'opt_h'],
      message: 'engine wording',
    };
    const r = partitionCritiques([c], poisonedCtx);
    expect(r.user).toHaveLength(0);
    expect(r.diagnostic).toHaveLength(1);
  });

  it('flat string leaf is REPLACED with the suppression marker (not shipped verbatim)', () => {
    const enrichment: Record<string, unknown> = {
      summary: "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.",
    };
    const r = sanitiseEnrichment(enrichment, GRAPH);
    expect(r.enrichment.summary).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(typeof r.enrichment.summary).toBe('string');
    expect(r.hardBans.length).toBeGreaterThan(0);
  });

  it('improvement_guidance entry is REPLACED with the marker; array length preserved', () => {
    const enrichment: Record<string, unknown> = {
      improvement_guidance: [
        'Clean entry one.',
        "Node 'opt_x' has kind='option'.",  // hard-ban
        'Clean entry two.',
      ],
    };
    const r = sanitiseEnrichment(enrichment, GRAPH);
    const out = r.enrichment.improvement_guidance as string[];
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('Clean entry one.');
    expect(out[1]).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(out[2]).toBe('Clean entry two.');
  });

  it('factor_sensitivity[*].interpretation is REPLACED with the marker; structural fields preserved', () => {
    const enrichment: Record<string, unknown> = {
      factor_sensitivity: [
        {
          node_id: 'fac_hiring_cost',
          sensitivity_value: 0.7,
          interpretation: "Node 'opt_hire_local' has kind='option'.",
        },
      ],
    };
    const r = sanitiseEnrichment(enrichment, GRAPH);
    const fs = (r.enrichment.factor_sensitivity as Array<Record<string, unknown>>);
    expect(fs[0]?.interpretation).toBe(SUPPRESSED_PROSE_FALLBACK);
    // Structural fields preserved
    expect(fs[0]?.node_id).toBe('fac_hiring_cost');
    expect(fs[0]?.sensitivity_value).toBe(0.7);
  });

  it('review_cards[*].what is REPLACED with the marker; structural fields preserved', () => {
    const enrichment: Record<string, unknown> = {
      review_cards: [
        {
          card_id: 'ep_x',
          card_type: 'evidence_priority',
          what: "Node 'opt_hire_local' has kind='option'.",
          why: 'Clean why text.',
        },
      ],
    };
    const r = sanitiseEnrichment(enrichment, GRAPH);
    const rc = (r.enrichment.review_cards as Array<Record<string, unknown>>);
    expect(rc[0]?.what).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(rc[0]?.why).toBe('Clean why text.');
    expect(rc[0]?.card_id).toBe('ep_x');
    expect(rc[0]?.card_type).toBe('evidence_priority');
  });

  it('review_cards[*].items[*].suggested_evidence is REPLACED with the marker', () => {
    const enrichment: Record<string, unknown> = {
      review_cards: [
        {
          card_id: 'ep_x',
          items: [
            {
              node_id: 'fac_hiring_cost',
              factor_label: 'Hiring',
              suggested_evidence: "Option nodes are filtered before analysis.",
            },
          ],
        },
      ],
    };
    const r = sanitiseEnrichment(enrichment, GRAPH);
    const items = ((r.enrichment.review_cards as Array<Record<string, unknown>>)[0]
      ?.items as Array<Record<string, unknown>>);
    expect(items[0]?.suggested_evidence).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(items[0]?.node_id).toBe('fac_hiring_cost');
    expect(items[0]?.factor_label).toBe('Hiring');
  });

  it('SUPPRESSED_PROSE_FALLBACK is a non-empty string typed compatibly with prose fields', () => {
    expect(typeof SUPPRESSED_PROSE_FALLBACK).toBe('string');
    expect(SUPPRESSED_PROSE_FALLBACK.length).toBeGreaterThan(0);
    // Marker contains no entity-id-shaped tokens and no hard-ban substrings.
    expect(SUPPRESSED_PROSE_FALLBACK).not.toMatch(/\b(?:fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-]/);
    expect(SUPPRESSED_PROSE_FALLBACK).not.toMatch(/Node '/);
  });
});

// =============================================================================
// isAllowlistedPath
// =============================================================================

describe('isAllowlistedPath — 15 paths', () => {
  it.each([
    '$.critiques[0].message',
    '$.critiques[3].suggestion',
    '$.gaps[0].description',
    '$.robustness[0].caveat',
    '$.summary',
    '$.narrative',
    '$.improvement_guidance[0]',
    '$.factor_sensitivity[2].interpretation',
    '$.m1_review[0].text',
    '$.rationale',
    '$.robustness_synthesis',
    '$.review_cards[0].what',
    '$.review_cards[0].why',
    '$.review_cards[0].items[2].suggested_evidence',
  ])('allowlists %s', (path) => {
    expect(isAllowlistedPath(path)).toBe(true);
  });

  it.each([
    '$.critiques[0].id',
    '$.critiques[0].code',
    '$.critiques[0].severity',
    '$.critiques[0].affected_option_ids',
    '$.payloads',
    '$._meta',
    '$.review_cards[0].card_id',
    '$.review_cards[0].suggested_action',
    '$.review_cards[0].items[0].factor_id',
    '$.review_cards[0].items[0].factor_label',
    '$.fragile_edges[0]',
    // Tier-3 claim-safety cage (Brief 5): m1_coaching prose is no longer
    // an allow-listed scrub-and-keep leaf — the walker suppresses it
    // outright (see the dedicated Tier-3 suppression cases below and
    // tests/contract/tier3-leak-guard.runtime.test.ts).
    '$.m1_coaching[0].text',
  ])('rejects structural path %s', (path) => {
    expect(isAllowlistedPath(path)).toBe(false);
  });
});

// =============================================================================
// partitionCritiques — bucket routing
// =============================================================================

describe('partitionCritiques — bucket routing + structural preservation', () => {
  it('routes bucket-D codes to diagnostic, bucket-U/S to user', () => {
    const critiques: CritiqueLike[] = [
      { id: 'c1', code: 'NO_OPTIONS', severity: 'blocker', message: 'No options provided for comparison' },
      { id: 'c2', code: 'IDENTICAL_OPTIONS', severity: 'blocker', message: "Options 'A' and 'B' have identical interventions", affected_option_ids: ['opt_hire_local', 'opt_offshore'] },
      { id: 'c3', code: 'MISSING_GOAL_NODE', severity: 'blocker', message: 'Goal node not found in graph' },
    ];
    const r = partitionCritiques(critiques, CTX);
    expect(r.user).toHaveLength(2);
    expect(r.diagnostic).toHaveLength(1);
    expect(r.diagnostic[0]?.code).toBe('MISSING_GOAL_NODE');
  });

  it('replaces bucket-S messages with the approved copy', () => {
    const critiques: CritiqueLike[] = [
      { id: 'c1', code: 'IDENTICAL_OPTIONS', severity: 'blocker', message: 'engine vocabulary message', affected_option_ids: ['opt_hire_local', 'opt_offshore'] },
    ];
    const r = partitionCritiques(critiques, CTX);
    expect(r.user[0]?.message).toBe(
      "Options 'Hire Two Senior Engineers Locally' and 'Engage Offshore Partner' currently make the same changes, so the analysis treats them as equivalent.",
    );
  });

  it('preserves structural fields verbatim (id, code, severity, source, affected_*)', () => {
    const c: CritiqueLike = {
      id: 'c1',
      code: 'IDENTICAL_OPTIONS',
      severity: 'blocker',
      source: 'validation',
      affected_option_ids: ['opt_hire_local', 'opt_offshore'],
      affected_node_ids: ['opt_hire_local', 'opt_offshore'],
      message: 'original',
    };
    const r = partitionCritiques([c], CTX);
    const out = r.user[0]!;
    expect(out.id).toBe('c1');
    expect(out.code).toBe('IDENTICAL_OPTIONS');
    expect(out.severity).toBe('blocker');
    expect(out.source).toBe('validation');
    expect(out.affected_option_ids).toEqual(['opt_hire_local', 'opt_offshore']);
    expect(out.affected_node_ids).toEqual(['opt_hire_local', 'opt_offshore']);
    // Only `message` changed.
    expect(out.message).not.toBe('original');
  });

  it('routes the captured staging leak (uncoded) to diagnostic via fail-safe default', () => {
    const c: CritiqueLike = {
      id: 'c1',
      // no code field — uncoded captured leak
      severity: 'info',
      source: 'preprocessing',
      message: "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.",
    };
    const r = partitionCritiques([c], CTX);
    expect(r.user).toHaveLength(0);
    expect(r.diagnostic).toHaveLength(1);
    // Diagnostic message preserved verbatim
    expect(r.diagnostic[0]?.message).toBe(
      "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.",
    );
  });
});

// =============================================================================
// sanitiseEnrichment — full subtree walker
// =============================================================================

describe('sanitiseEnrichment — full subtree walker', () => {
  it('partitions critiques + scrubs allowlisted leaves + preserves structural fields', () => {
    const enrichment: Record<string, unknown> = {
      critiques: [
        { id: 'c1', code: 'IDENTICAL_OPTIONS', message: 'engine wording', affected_option_ids: ['opt_hire_local', 'opt_offshore'] },
        { id: 'c2', code: 'MISSING_GOAL_NODE', message: 'engine validation' },
      ],
      summary: 'Option opt_hire_local leads.',
      narrative: 'fac_hiring_cost is the strongest driver.',
      payloads: { isl_request: { secret: 'preserved verbatim' } },
      _meta: { response_hash: 'abc123', payloads: 'should not change' },
      factor_sensitivity: [
        { node_id: 'fac_hiring_cost', interpretation: 'Decision is sensitive to fac_hiring_cost' },
      ],
      review_cards: [
        {
          card_id: 'ep_xxx',
          card_type: 'evidence_priority',
          what: 'Evidence on opt_hire_local could change the recommendation.',
          why: 'Reasons.',
          items: [
            { node_id: 'fac_hiring_cost', factor_label: 'Hiring and Staffing Cost', suggested_evidence: 'Gather data on opt_offshore.' },
          ],
        },
      ],
    };
    const before = globalThis.structuredClone(enrichment);
    const r = sanitiseEnrichment(enrichment, GRAPH);

    // Diagnostic critiques routed
    expect(r.diagnostic.critiques).toHaveLength(1);
    expect(r.diagnostic.critiques[0]?.code).toBe('MISSING_GOAL_NODE');
    // User critiques have S-bucket replacement
    expect((r.enrichment.critiques as CritiqueLike[])[0]?.message).toContain(
      "Hire Two Senior Engineers Locally",
    );
    // Summary/narrative had IDs resolved
    expect(r.enrichment.summary).toBe('Option Hire Two Senior Engineers Locally leads.');
    expect(r.enrichment.narrative).toBe('Hiring and Staffing Cost is the strongest driver.');
    // Factor sensitivity interpretation scrubbed
    const fs = (r.enrichment.factor_sensitivity as Array<Record<string, unknown>>);
    expect(fs[0]?.interpretation).toBe('Decision is sensitive to Hiring and Staffing Cost');
    expect(fs[0]?.node_id).toBe('fac_hiring_cost'); // structural preserved
    // Review-card prose scrubbed
    const rc = (r.enrichment.review_cards as Array<Record<string, unknown>>);
    expect(rc[0]?.what).toBe('Evidence on Hire Two Senior Engineers Locally could change the recommendation.');
    // Structural fields byte-equal
    expect(rc[0]?.card_id).toBe('ep_xxx');
    expect(rc[0]?.card_type).toBe('evidence_priority');
    const rcItems = (rc[0]?.items as Array<Record<string, unknown>>);
    expect(rcItems[0]?.node_id).toBe('fac_hiring_cost');
    expect(rcItems[0]?.factor_label).toBe('Hiring and Staffing Cost');
    expect(rcItems[0]?.suggested_evidence).toBe('Gather data on Engage Offshore Partner.');

    // Payloads + _meta byte-equal
    expect(r.enrichment.payloads).toEqual(before.payloads);
    expect(r.enrichment._meta).toEqual(before._meta);
  });

  it('reports hard-ban hits when an enrichment leaf carries Tier-A tokens', () => {
    const enrichment: Record<string, unknown> = {
      critiques: [],
      summary: "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.",
    };
    const r = sanitiseEnrichment(enrichment, GRAPH);
    expect(r.hardBans.length).toBeGreaterThan(0);
    expect(r.hardBans.some((h) => h.path === '$.summary')).toBe(true);
  });

  it('returns clean (no hard-bans, no warnings) on a captured-fixture-clean enrichment', () => {
    const enrichment: Record<string, unknown> = {
      critiques: [
        { id: 'c1', code: 'NO_OPTIONS', message: 'No options provided for comparison' },
      ],
      summary: 'Decision quality looks good.',
    };
    const r = sanitiseEnrichment(enrichment, GRAPH);
    expect(r.hardBans).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

// =============================================================================
// Codex review fixes (2026-04-30)
// =============================================================================

describe('HARD_BAN_PATTERNS — flat-token coverage', () => {
  it('catches kind=option without quotes (the unquoted variant)', () => {
    const enrichment: Record<string, unknown> = {
      summary: 'Engine reported kind=option for the filtered nodes.',
    };
    const r = sanitiseEnrichment(enrichment, GRAPH);
    expect(r.hardBans.some((h) => h.path === '$.summary')).toBe(true);
    // Codex review 2026-04-30 P2: replaced with the suppression marker
    // rather than deleted (was previously toBeUndefined).
    expect(r.enrichment['summary']).toBe(SUPPRESSED_PROSE_FALLBACK);
  });

  it('catches lowercase "option nodes" and singular "option node"', () => {
    for (const text of [
      'option nodes are skipped here',
      'Option Nodes Are skipped here',
      'we skip the option node before sampling',
    ]) {
      const r = sanitiseEnrichment({ summary: text }, GRAPH);
      expect(
        r.hardBans.some((h) => h.path === '$.summary'),
        `failed for: ${text}`,
      ).toBe(true);
    }
  });

  it('every entry in INTERNAL_TEMPLATE_TOKENS is reachable via at least one HARD_BAN_PATTERN or WARNING_PATTERN', async () => {
    // Coverage rule: the flat token registry must not have an entry that
    // no regex pattern matches. Drift between the two surfaces is the
    // exact bug Codex flagged.
    const { INTERNAL_TEMPLATE_TOKENS, HARD_BAN_PATTERNS, WARNING_PATTERNS } =
      await import('../../../orchestrator/shared/forbidden-tokens.js');
    const allPatterns: ReadonlyArray<RegExp> = [...HARD_BAN_PATTERNS, ...WARNING_PATTERNS];
    const orphans: string[] = [];
    for (const token of INTERNAL_TEMPLATE_TOKENS) {
      // Use the token as-is in a representative carrier sentence so the
      // pattern's word-boundaries / anchors fire correctly.
      const carrier = `prefix ${token} suffix`;
      const matched = allPatterns.some((re) => re.test(carrier));
      if (!matched) orphans.push(token);
    }
    expect(
      orphans,
      `tokens without matching pattern: ${JSON.stringify(orphans)}`,
    ).toEqual([]);
  });
});

describe('_diagnostics stripping — caller cannot leave a stale debug field', () => {
  it('strips a pre-existing _diagnostics on the input regardless of debug flag', () => {
    const enrichment: Record<string, unknown> = {
      _diagnostics: { critiques: [{ id: 'cached_diag', message: 'cached engine detail' }] },
      critiques: [],
      summary: 'Clean copy.',
    };
    const r = sanitiseEnrichment(enrichment, GRAPH);
    // Sanitiser-side guarantee: the output never has _diagnostics.
    // Callers (decision-review-enricher.ts, response-finaliser.ts) attach
    // it back ONLY when CEE_TURN_DEBUG_ENABLED=true. With the flag off,
    // _diagnostics is absent from the wire by sanitiser construction —
    // not by accident of the input shape.
    expect((r.enrichment as Record<string, unknown>)._diagnostics).toBeUndefined();
  });

  it('strips _diagnostics even when the rest of the enrichment is empty', () => {
    const r = sanitiseEnrichment(
      { _diagnostics: { critiques: [{ id: 'leak' }] } } as Record<string, unknown>,
      GRAPH,
    );
    expect((r.enrichment as Record<string, unknown>)._diagnostics).toBeUndefined();
  });
});

// =============================================================================
// P2 — fail-shut policy: every allowlisted prose path is REPLACED with the
// suppression marker on contamination, NOT silently deleted.
// =============================================================================
//
// Pins the contract for the remaining six allowlisted prose paths
// (Codex review 2026-04-30, P2). The earlier "fail-shut behaviour"
// describe already covers `summary`, `improvement_guidance[*]`,
// `factor_sensitivity[*].interpretation`, `review_cards[*].what`,
// `review_cards[*].items[*].suggested_evidence`, and the marker shape.
// This block adds the rest so every one of the 15 paths in
// `ALLOWLISTED_LEAF_PATHS` is explicitly proven to:
//   - keep the field present (no deletion)
//   - render the marker as a plain string
//   - contain no hard-ban tokens after sanitisation

describe('P2 fail-shut coverage — every allowlisted prose path replaces, never deletes', () => {
  const HARD_BAN_LEAK = "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis.";

  it('narrative (flat leaf)', () => {
    const r = sanitiseEnrichment({ narrative: HARD_BAN_LEAK }, GRAPH);
    expect(r.enrichment.narrative).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(typeof r.enrichment.narrative).toBe('string');
  });

  it('rationale (flat leaf)', () => {
    const r = sanitiseEnrichment({ rationale: HARD_BAN_LEAK }, GRAPH);
    expect(r.enrichment.rationale).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(typeof r.enrichment.rationale).toBe('string');
  });

  it('robustness_synthesis (flat leaf)', () => {
    const r = sanitiseEnrichment({ robustness_synthesis: HARD_BAN_LEAK }, GRAPH);
    expect(r.enrichment.robustness_synthesis).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(typeof r.enrichment.robustness_synthesis).toBe('string');
  });

  it('m1_review[*].text', () => {
    const r = sanitiseEnrichment({
      m1_review: [
        { reviewer: 'm1', text: HARD_BAN_LEAK },
        { reviewer: 'm1', text: 'Clean review text.' },
      ],
    }, GRAPH);
    const arr = r.enrichment.m1_review as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(2);
    expect(arr[0]?.text).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(arr[0]?.reviewer).toBe('m1'); // structural preserved
    expect(arr[1]?.text).toBe('Clean review text.');
  });

  it('m1_coaching[*].text', () => {
    const r = sanitiseEnrichment({
      m1_coaching: [
        { play: 'priority_1', text: HARD_BAN_LEAK },
      ],
    }, GRAPH);
    const arr = r.enrichment.m1_coaching as Array<Record<string, unknown>>;
    expect(arr[0]?.text).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(arr[0]?.play).toBe('priority_1');
  });

  it('gaps[*].description', () => {
    const r = sanitiseEnrichment({
      gaps: [
        { id: 'gap_1', description: HARD_BAN_LEAK },
      ],
    }, GRAPH);
    const arr = r.enrichment.gaps as Array<Record<string, unknown>>;
    expect(arr[0]?.description).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(arr[0]?.id).toBe('gap_1');
  });

  it('robustness[*].caveat', () => {
    const r = sanitiseEnrichment({
      robustness: [
        { id: 'r_1', caveat: HARD_BAN_LEAK },
      ],
    }, GRAPH);
    const arr = r.enrichment.robustness as Array<Record<string, unknown>>;
    expect(arr[0]?.caveat).toBe(SUPPRESSED_PROSE_FALLBACK);
    expect(arr[0]?.id).toBe('r_1');
  });

  it('critiques[*].suggestion (allowlisted under critique partition)', () => {
    // suggestion field on a U-bucket critique should also fail-shut on
    // contamination — the U-bucket means we surface the critique, but
    // the suggestion text is allowlisted prose and gets the same
    // fail-shut treatment.
    const r = sanitiseEnrichment({
      critiques: [
        {
          id: 'c1',
          code: 'NO_OPTIONS',
          message: 'No options provided for comparison',
          suggestion: HARD_BAN_LEAK,
        },
      ],
    }, GRAPH);
    const c = (r.enrichment.critiques as Array<Record<string, unknown>>)[0]!;
    // U-bucket: critique surfaces, but the contaminated suggestion field
    // is replaced with the marker. partitionCritiques routes the whole
    // critique to D when the suggestion fails — so we expect the
    // critique to be diagnostic-bucketed in this case.
    expect(c).toBeUndefined();
    expect(r.diagnostic.critiques).toHaveLength(1);
  });

  it('every fail-shut output passes the entity-ID + hard-ban regression scan', () => {
    // Belt-and-braces: scan the entire post-sanitise enrichment for any
    // residual entity-ID-shaped substring or "Node '" prefix. This is
    // the same wire-egress shape the contract test asserts.
    const dirty: Record<string, unknown> = {
      summary: HARD_BAN_LEAK,
      narrative: HARD_BAN_LEAK,
      rationale: HARD_BAN_LEAK,
      robustness_synthesis: HARD_BAN_LEAK,
      improvement_guidance: [HARD_BAN_LEAK],
      factor_sensitivity: [{ node_id: 'fac_x', interpretation: HARD_BAN_LEAK }],
      m1_review: [{ text: HARD_BAN_LEAK }],
      m1_coaching: [{ text: HARD_BAN_LEAK }],
      gaps: [{ description: HARD_BAN_LEAK }],
      robustness: [{ caveat: HARD_BAN_LEAK }],
      review_cards: [{
        card_id: 'rc_1',
        what: HARD_BAN_LEAK,
        why: HARD_BAN_LEAK,
        items: [{ node_id: 'fac_x', suggested_evidence: HARD_BAN_LEAK }],
      }],
    };
    const r = sanitiseEnrichment(dirty, GRAPH);
    const post = JSON.stringify(r.enrichment);
    // Whole stringification: no entity-id leak, no Node template,
    // no kind= leak.
    expect(post).not.toMatch(/\bopt_hire_local\b/);
    expect(post).not.toMatch(/Node '/);
    expect(post).not.toMatch(/\bkind\s*=/);
    expect(post).not.toMatch(/filtered before analysis/i);
  });
});

// =============================================================================
// Idempotency — running the sanitiser twice must be a no-op
// =============================================================================
//
// The enricher (Commit 5) and the response-finaliser backstop (Commit 6)
// both call sanitiseEnrichment on overlapping data. If sanitisation is
// not idempotent, two passes could mangle clean output (e.g. resolve
// the suppression marker as a token, replace it again). Pin the
// invariant directly.

describe('idempotency — running sanitiseEnrichment twice is a no-op', () => {
  it('clean enrichment passes through unchanged on second pass', () => {
    const enrichment: Record<string, unknown> = {
      critiques: [
        { id: 'c1', code: 'NO_OPTIONS', message: 'No options provided for comparison.' },
      ],
      summary: 'Decision quality is high. Option Hire Two Senior Engineers Locally leads.',
      payloads: { isl_request: { secret: 'preserved' } },
      review_cards: [
        { card_id: 'rc_1', what: 'Clean review-card prose with no leaks.' },
      ],
    };
    const first = sanitiseEnrichment(enrichment, GRAPH);
    const second = sanitiseEnrichment(first.enrichment, GRAPH);
    expect(second.enrichment).toEqual(first.enrichment);
    expect(second.hardBans).toEqual([]);
    // Second pass produces no new diagnostic entries either.
    expect(second.diagnostic.critiques).toEqual([]);
  });

  it('post-suppression output stays stable on second pass', () => {
    const dirty: Record<string, unknown> = {
      summary: "Node 'opt_hire_local' has kind='option'.",
      improvement_guidance: ["Node 'opt_x' has kind='option'.", 'Clean entry.'],
      review_cards: [{ card_id: 'rc_1', what: "Node 'opt_y' has kind='option'." }],
    };
    const first = sanitiseEnrichment(dirty, GRAPH);
    const second = sanitiseEnrichment(first.enrichment, GRAPH);
    // Marker stays a marker; second pass MUST NOT trip a hard-ban on its
    // own output, MUST NOT replace the marker with anything else.
    expect(second.enrichment).toEqual(first.enrichment);
    expect(second.hardBans).toEqual([]);
  });

  it('SUPPRESSED_PROSE_FALLBACK itself produces no hard-ban hits when scanned', () => {
    // Sanity check: the marker copy must be safe to write through any
    // future enrichment producer that re-scans.
    const r = sanitiseEnrichmentText(SUPPRESSED_PROSE_FALLBACK, CTX);
    expect(r.suppress).toBe(false);
    expect(r.hardBans).toEqual([]);
    expect(r.text).toBe(SUPPRESSED_PROSE_FALLBACK);
  });
});
