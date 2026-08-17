/**
 * ⭐⭐ ROADMAP 2.1265 (D2) — the fabricated-model-state guard, driven by the
 * WIRE BYTES of the defect it exists to kill.
 *
 * ⚠ NOTHING IN THIS FILE IS A FIXTURE I WROTE (CLAUDE.md trap 16 — *a fixture
 * you wrote yourself is not evidence about the wire*). The assistant text, the
 * readiness blockers and the graph all come out of
 * `olumi-docs/witness-acceptance-2026-08-17/captures/`, copied verbatim into
 * `../../__tests__/fixtures/witness-2026-08-17/`:
 *
 *   · `j4-wire-strings.json` — the reply and readiness from
 *     `j4-t2-event-final.json`, the user message from `j4-t2-request.json`.
 *   · `j4-draft-graph.json`  — the `draft_graph` from `j4-t1-event-final.json`,
 *     i.e. the model that existed WHEN the fabrication was composed.
 *
 * ⚠ THESE FIXTURES ARE A HISTORIC RECORD, NOT COPY TO KEEP CURRENT (trap 14b).
 * They pin sentences a dated build actually emitted. Append to them; never edit
 * them to match a later product.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import {
  ALREADY_HOLDS_VERBS,
  MISSING_VALUE_CLAIM_KNOWN_DROPPED,
  classifyMissingValueClaim,
  collectModelValueNumbers,
  composeMissingValueClaimCorrection,
  extractAssertedNumbers,
  projectMissingValuePairs,
  splitSentencesPreservingDecimals,
} from '../missing-value-claim-guard.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

const WIRE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wire-strings.json', import.meta.url),
    'utf8',
  ),
) as {
  j4_t2_user_message: string;
  j4_t2_assistant_text: string;
  j4_t4_assistant_text: string;
  j4_t2_readiness: { status: string; blockers: unknown[] };
};

const DRAFT_GRAPH = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-draft-graph.json', import.meta.url),
    'utf8',
  ),
) as { nodes: Array<Record<string, unknown>>; edges: unknown[] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The blocked pair the fabrication was about. Ids from the wire's own blocker. */
const OPTION_ID = '21ea9b80';
const FACTOR_ID = '49a2b80b';
const OPTION_LABEL = 'subcontracting inner-city deliveries to a green courier';
const FACTOR_LABEL = 'Subcontractor cost as share of affected-route revenue';

/** The witnessed post-t5 state: the factor baseline rewritten to 0.12. */
function graphWithFactorBaseline(value: number): typeof DRAFT_GRAPH {
  const g = clone(DRAFT_GRAPH);
  for (const node of g.nodes) {
    if (node.id !== FACTOR_ID) continue;
    node.observed_state = { value, source: 'user_override' };
    node.display_value = String(value);
  }
  return g;
}

/** The state the user actually asked for: the OPTION carries the effect value. */
function graphWithOptionEffect(value: number): typeof DRAFT_GRAPH {
  const g = clone(DRAFT_GRAPH);
  for (const node of g.nodes) {
    if (node.id !== OPTION_ID) continue;
    node.interventions = { [FACTOR_ID]: { value, source: 'user_override' } };
  }
  return g;
}

describe('preconditions — the witness bytes really carry the defect', () => {
  it('the captured reply asserts the model ALREADY holds 12%', () => {
    expect(WIRE.j4_t2_assistant_text).toContain('already reflects');
    expect(WIRE.j4_t2_assistant_text).toContain('12%');
  });

  it('the SAME payload carries a live MISSING_OPTION_VALUE blocker for that pair (WIRE shape)', () => {
    const pairs = projectMissingValuePairs(WIRE.j4_t2_readiness);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0]).toEqual({ optionLabel: OPTION_LABEL, factorLabel: FACTOR_LABEL });
  });

  it('⚠ and the CANONICAL in-process payload spells it differently — both must be read', () => {
    // The near-miss this pins: the executor threads
    // `buildCanonicalAnalysisReadyFromGraph`'s payload, which carries
    // `blocker_type: "missing_value"` and NO `code` field. A guard reading only
    // the wire's `code` is fully green here and DEAD in production.
    const canonical = buildCanonicalAnalysisReadyFromGraph(DRAFT_GRAPH) as unknown as {
      blockers?: Array<Record<string, unknown>>;
    };
    expect(canonical.blockers?.[0]?.blocker_type).toBe('missing_value');
    expect(canonical.blockers?.[0]?.code).toBeUndefined();
    const pairs = projectMissingValuePairs(canonical);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs).toContainEqual({ optionLabel: OPTION_LABEL, factorLabel: FACTOR_LABEL });
  });

  it('the witnessed fabrication SWAPS against the CANONICAL payload too (the shape production holds)', () => {
    const canonical = buildCanonicalAnalysisReadyFromGraph(DRAFT_GRAPH);
    const decision = classifyMissingValueClaim({
      assistantText: WIRE.j4_t2_assistant_text,
      readiness: canonical,
      persistedGraph: DRAFT_GRAPH,
    });
    expect(decision.verdict).toBe('swap');
  });

  it('the persisted draft carried NO 0.12 and NO 12 in any value slot (the absence, with its positive control)', () => {
    const held = collectModelValueNumbers(DRAFT_GRAPH);
    // POSITIVE CONTROL — the sweep is not blind: it sees the 0.5 defaults and
    // the two cee_hypothesis intervention values the draft really carries.
    expect(held.has(0.5)).toBe(true);
    expect(held.has(0.95)).toBe(true);
    expect(held.has(0.96)).toBe(true);
    // THE ABSENCE the fabrication contradicts.
    expect(held.has(0.12)).toBe(false);
    expect(held.has(12)).toBe(false);
  });

  it('⚠ a WHOLE-OBJECT numeric sweep would have reported 0.12 PRESENT — why the scope is the claim’s domain', () => {
    // Recorded because it was MEASURED, not assumed (trap 14). Hex node ids
    // contribute digit runs and twelve edges carry strength.std
    // 0.11999999999999998, which matches 0.12 inside any sane tolerance. A guard
    // built on that sweep stands down on the exact fabrication it exists to
    // catch — and its "no match" reading looks like a clean absence result.
    const naive = new Set<number>();
    const visit = (node: unknown): void => {
      if (typeof node === 'number') {
        naive.add(node);
        return;
      }
      if (typeof node === 'string') {
        for (const m of node.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)) {
          naive.add(Number(m[1]!.replace(/,/g, '')));
        }
        return;
      }
      if (node !== null && typeof node === 'object') {
        for (const v of Object.values(node as Record<string, unknown>)) visit(v);
      }
    };
    visit(DRAFT_GRAPH);
    const nearZeroPointOneTwo = [...naive].some((v) => Math.abs(v - 0.12) <= 1e-9);
    expect(nearZeroPointOneTwo).toBe(true);
    expect(naive.has(12)).toBe(true);
  });
});

describe('RED→GREEN — the witnessed fabrication is refused', () => {
  it('the captured J4 t2 reply, its own readiness and its own graph → SWAP', () => {
    const decision = classifyMissingValueClaim({
      assistantText: WIRE.j4_t2_assistant_text,
      readiness: WIRE.j4_t2_readiness,
      persistedGraph: DRAFT_GRAPH,
    });
    expect(decision.verdict).toBe('swap');
    if (decision.verdict !== 'swap') return;
    expect(decision.assertedValues).toContain('12%');
    expect(decision.pairs[0]).toEqual({ optionLabel: OPTION_LABEL, factorLabel: FACTOR_LABEL });
    // The replacement makes no claim the payload cannot support…
    expect(decision.text).not.toContain('already reflects');
    expect(decision.text).not.toContain('12%');
    expect(decision.text).not.toContain('0.12');
    // …and names the pair the blocker names.
    expect(decision.text).toContain(OPTION_LABEL);
    expect(decision.text).toContain(FACTOR_LABEL);
  });

  it('the replacement is DERIVED from the composer, not transcribed', () => {
    const decision = classifyMissingValueClaim({
      assistantText: WIRE.j4_t2_assistant_text,
      readiness: WIRE.j4_t2_readiness,
      persistedGraph: DRAFT_GRAPH,
    });
    if (decision.verdict !== 'swap') throw new Error('precondition: expected a swap');
    expect(decision.text).toBe(composeMissingValueClaimCorrection(decision.pairs));
  });
});

describe('opposite-direction twins — over-suppression is a failure, not a safe default', () => {
  it('PERMIT-WINS: the identical sentence stands when the OPTION really holds the effect value', () => {
    const decision = classifyMissingValueClaim({
      assistantText: WIRE.j4_t2_assistant_text,
      readiness: WIRE.j4_t2_readiness,
      persistedGraph: graphWithOptionEffect(0.12),
    });
    expect(decision).toEqual({ verdict: 'stand_down', reason: 'value_present_in_graph' });
  });

  it('PERMIT-WINS: it also stands when the FACTOR BASELINE holds it (the witnessed post-t5 state)', () => {
    const decision = classifyMissingValueClaim({
      assistantText: WIRE.j4_t2_assistant_text,
      readiness: WIRE.j4_t2_readiness,
      persistedGraph: graphWithFactorBaseline(0.12),
    });
    expect(decision).toEqual({ verdict: 'stand_down', reason: 'value_present_in_graph' });
  });

  it('CLEAN-TEXT: the witnessed HONEST refusal (J4 t4) is untouched', () => {
    const decision = classifyMissingValueClaim({
      assistantText: WIRE.j4_t4_assistant_text,
      readiness: WIRE.j4_t2_readiness,
      persistedGraph: DRAFT_GRAPH,
    });
    expect(decision.verdict).toBe('stand_down');
  });

  it('NEGATION TWIN: "already a driver, but the effect value is not set" is the TRUE claim and stands', () => {
    const decision = classifyMissingValueClaim({
      assistantText: `Your model already has ${FACTOR_LABEL} at 12% in mind, but the effect value is not set.`,
      readiness: WIRE.j4_t2_readiness,
      persistedGraph: DRAFT_GRAPH,
    });
    expect(decision.verdict).toBe('stand_down');
  });

  it('NO-BLOCKER TWIN: the same fabrication stands down when nothing is missing (no repair context)', () => {
    const decision = classifyMissingValueClaim({
      assistantText: WIRE.j4_t2_assistant_text,
      readiness: { status: 'ready', blockers: [] },
      persistedGraph: DRAFT_GRAPH,
    });
    expect(decision).toEqual({ verdict: 'stand_down', reason: 'no_missing_value_blocker' });
  });

  it('NO-GRAPH TWIN: unanswerable ⇒ stand down (never swap a claim we cannot check)', () => {
    const decision = classifyMissingValueClaim({
      assistantText: WIRE.j4_t2_assistant_text,
      readiness: WIRE.j4_t2_readiness,
      persistedGraph: null,
    });
    expect(decision).toEqual({ verdict: 'stand_down', reason: 'no_graph' });
  });

  it('NON-BLOCKER BLOCKERS: a readiness payload with other codes yields no pairs', () => {
    expect(
      projectMissingValuePairs({ blockers: [{ code: 'NO_OPTIONS', option_label: 'x' }] }),
    ).toEqual([]);
  });
});

describe('the honest-gap set (trap 22f) — pinned BOTH ways', () => {
  it('every KNOWN_DROPPED shape stands down, exactly as recorded', () => {
    for (const text of MISSING_VALUE_CLAIM_KNOWN_DROPPED) {
      const decision = classifyMissingValueClaim({
        assistantText: text,
        readiness: WIRE.j4_t2_readiness,
        persistedGraph: DRAFT_GRAPH,
      });
      expect(decision.verdict, `KNOWN_DROPPED must not be claimed: ${text}`).toBe('stand_down');
    }
  });

  it('the set has not silently shrunk', () => {
    expect(MISSING_VALUE_CLAIM_KNOWN_DROPPED).toHaveLength(4);
  });
});

describe('the decimal-safe splitter (the £1.5 million shape)', () => {
  it('does not cut a decimal', () => {
    expect(splitSentencesPreservingDecimals('Set it to 0.12. Then run.')).toEqual([
      'Set it to 0.12.',
      'Then run.',
    ]);
    expect(splitSentencesPreservingDecimals('Capex is £1.5 million here.')).toEqual([
      'Capex is £1.5 million here.',
    ]);
  });

  it('a claim carrying £1.5 million is still seen whole', () => {
    const asserted = extractAssertedNumbers('Your model already carries £1.5 million there.');
    expect(asserted.map((a) => a.asWritten)).toContain('1.5');
  });
});

describe('percent/share equivalence', () => {
  it('12% and 0.12 are the same assertion', () => {
    const pct = extractAssertedNumbers('already at 12%')[0]!;
    expect(pct.candidates).toContain(12);
    expect(pct.candidates).toContain(0.12);
    const share = extractAssertedNumbers('already at 0.12')[0]!;
    expect(share.candidates).toContain(0.12);
    expect(share.candidates).toContain(12);
  });
});

describe('the closed verb set has not drifted open', () => {
  it('holding verbs only — nothing that merely says the factor EXISTS', () => {
    for (const excluded of ['knows', 'mentions', 'names', 'lists', 'shows']) {
      expect(ALREADY_HOLDS_VERBS).not.toContain(excluded);
    }
  });

  it('a bare `already` with no holding verb and no number claims nothing', () => {
    const decision = classifyMissingValueClaim({
      assistantText: `You already told me about ${FACTOR_LABEL}.`,
      readiness: WIRE.j4_t2_readiness,
      persistedGraph: DRAFT_GRAPH,
    });
    expect(decision.verdict).toBe('stand_down');
  });
});
