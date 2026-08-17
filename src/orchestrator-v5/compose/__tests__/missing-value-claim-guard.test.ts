/**
 * ⭐⭐ ROADMAP 2.1265 (D2) — the RECOGNISER and the READ, driven by the WIRE
 * BYTES of the defect they exist to kill.
 *
 * Division of labour between this file and its sibling, stated because it is the
 * whole point of the escalation:
 *
 *   - `model-contents-claim.structural.test.ts` pins the **PERMISSION**: it
 *     RESTORES the fabricated claim on a blocker-bearing authoritative read and
 *     asserts the seam refuses it, with no override and no escape key. That is
 *     the "IMPOSSIBLE, not merely discouraged" half of Paul's ruling (P5).
 *   - THIS file pins the **INPUTS** to that seam: what counts as a contents
 *     claim, which numbers a sentence asserts, and — the part that nearly went
 *     wrong three separate times — what the authoritative read actually reads.
 *
 * ⚠ NOTHING HERE IS A FIXTURE I WROTE (trap 16 — *a fixture you wrote yourself
 * is not evidence about the wire*). The assistant text, the readiness blockers
 * and the graph all come out of
 * `olumi-docs/witness-acceptance-2026-08-17/captures/`, copied verbatim into
 * `../../__tests__/fixtures/witness-2026-08-17/`:
 *
 *   · `j4-wire-strings.json` — the reply and readiness from
 *     `j4-t2-event-final.json`, the user message from `j4-t2-request.json`.
 *   · `j4-draft-graph.json`  — the `draft_graph` from `j4-t1-event-final.json`,
 *     i.e. the model that existed WHEN the fabrication was composed.
 *
 * ⚠ THESE FIXTURES ARE A HISTORIC RECORD, NOT COPY TO KEEP CURRENT (trap 14b).
 * They pin sentences a dated build actually emitted. Append; never edit.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import {
  ALREADY_HOLDS_VERBS,
  MODEL_CONTENTS_CLAIM_KNOWN_DROPPED,
  classifyModelContentsClaim,
  collectModelValueNumbers,
  composeModelContentsRefusal,
  extractAssertedNumbers,
  projectMissingValuePairs,
  readAuthoritativeModelState,
  splitSentencesPreservingDecimals,
} from '../missing-value-claim-guard.js';
import type { AuthoritativeModelRead } from '../model-contents-claim.js';
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

const OPTION_ID = '21ea9b80';
const FACTOR_ID = '49a2b80b';
const OPTION_LABEL = 'subcontracting inner-city deliveries to a green courier';
const FACTOR_LABEL = 'Subcontractor cost as share of affected-route revenue';

function mkRead(graph: unknown, readiness: unknown): AuthoritativeModelRead {
  const read = readAuthoritativeModelState({ persistedGraph: graph, readiness });
  if (read === null) throw new Error('precondition: read must exist');
  return read;
}

describe('preconditions — the witness bytes really carry the defect', () => {
  it('the captured reply asserts the model ALREADY holds 12%', () => {
    expect(WIRE.j4_t2_assistant_text).toContain('already reflects');
    expect(WIRE.j4_t2_assistant_text).toContain('12%');
  });

  it('the SAME payload carries a live MISSING_OPTION_VALUE blocker (WIRE shape)', () => {
    const pairs = projectMissingValuePairs(WIRE.j4_t2_readiness);
    expect(pairs.length).toBeGreaterThan(0);
    // By identity, not by position — #1008 reorders/shortens this list.
    expect(pairs).toContainEqual({ optionLabel: OPTION_LABEL, factorLabel: FACTOR_LABEL });
  });

  it('⚠ NEAR-MISS (c): the CANONICAL in-process payload spells it DIFFERENTLY — both must be read', () => {
    // The executor threads `buildCanonicalAnalysisReadyFromGraph`'s payload,
    // which carries `blocker_type: "missing_value"` and NO `code` field. A guard
    // reading only the wire's `code` is fully green in unit and DEAD in
    // production — measured, not hypothesised.
    const canonical = buildCanonicalAnalysisReadyFromGraph(DRAFT_GRAPH) as unknown as {
      blockers?: Array<Record<string, unknown>>;
    };
    // ⚠⚠ BOUND BY IDENTITY, NEVER BY POSITION (trap 19) — a REAL fragility, not a
    // stylistic one. This asserted `blockers?.[0]` until #1008 (2.1266,
    // "system-inferred edges no longer manufacture mandatory user repair work")
    // was measured to SHORTEN this array from 10 blockers to 1, so `[0]` is a
    // different blocker before and after it. This guard's entire precondition is
    // "a live missing-value blocker for THIS pair; absent ⇒ no opinion" — exactly
    // what #1008 removes for synthetic edges — so index-binding made the
    // precondition depend on an ordering #1008 changes. It survived only because
    // the decisive pair is an `origin:"ai"` edge #1008 keeps: luck of ordering,
    // not construction.
    const blockers = canonical.blockers ?? [];
    const mine = blockers.find((b) => b.option_id === OPTION_ID && b.factor_id === FACTOR_ID);
    expect(mine, 'the witnessed blocked pair must be present BY IDENTITY').toBeDefined();
    expect(mine?.blocker_type).toBe('missing_value');
    expect(mine?.code).toBeUndefined();
    const pairs = projectMissingValuePairs(canonical);
    expect(pairs).toContainEqual({ optionLabel: OPTION_LABEL, factorLabel: FACTOR_LABEL });
  });

  it('⚠ NEAR-MISS (b): the persisted draft holds NO 0.12 and NO 12 in any claimable slot', () => {
    const held = collectModelValueNumbers(DRAFT_GRAPH);
    // POSITIVE CONTROL — the sweep is not blind: it sees the 0.5 defaults and the
    // two cee_hypothesis intervention values the draft really carries.
    expect(held.has(0.5)).toBe(true);
    expect(held.has(0.95)).toBe(true);
    expect(held.has(0.96)).toBe(true);
    // THE ABSENCE the fabrication contradicted.
    expect(held.has(0.12)).toBe(false);
    expect(held.has(12)).toBe(false);
  });

  it('⚠ NEAR-MISS (b), the other half: a WHOLE-OBJECT sweep would have GRANTED the permission', () => {
    // Recorded because it was MEASURED (trap 14). Hex node ids contribute digit
    // runs (`21ea9b80` → `21`, `80`) and twelve edges carry
    // `strength.std = 0.11999999999999998`, which matches 0.12 inside any sane
    // tolerance. A grounded set built that way permits the exact fabrication, and
    // its "value present" reading looks like an ordinary grounded result.
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
    expect([...naive].some((v) => Math.abs(v - 0.12) <= 1e-9)).toBe(true);
    expect(naive.has(12)).toBe(true);
  });
});

describe('the recogniser — what counts as a claim about model contents', () => {
  it('the witnessed fabrication is recognised and refused (canonical read, the production shape)', () => {
    const decision = classifyModelContentsClaim({
      assistantText: WIRE.j4_t2_assistant_text,
      read: mkRead(DRAFT_GRAPH, buildCanonicalAnalysisReadyFromGraph(DRAFT_GRAPH)),
    });
    expect(decision.verdict).toBe('swap');
    if (decision.verdict !== 'swap') return;
    expect(decision.reason).toBe('blocker_says_missing');
    expect(decision.assertedValues).toContain('12%');
    // DERIVED from the composer, not transcribed.
    expect(decision.text).toBe(composeModelContentsRefusal(decision.pairs, decision.reason));
  });

  it('holding verbs only — nothing that merely says the factor EXISTS', () => {
    for (const excluded of ['knows', 'mentions', 'names', 'lists', 'shows']) {
      expect(ALREADY_HOLDS_VERBS).not.toContain(excluded);
    }
  });

  it('a bare `already` with no holding verb and no number claims nothing', () => {
    const decision = classifyModelContentsClaim({
      assistantText: `You already told me about ${FACTOR_LABEL}.`,
      read: mkRead(DRAFT_GRAPH, WIRE.j4_t2_readiness),
    });
    expect(decision.verdict).toBe('stand_down');
  });

  it('the honest-gap set stands down, and has not silently shrunk (trap 22f)', () => {
    const read = mkRead(DRAFT_GRAPH, WIRE.j4_t2_readiness);
    for (const text of MODEL_CONTENTS_CLAIM_KNOWN_DROPPED) {
      expect(
        classifyModelContentsClaim({ assistantText: text, read }).verdict,
        `KNOWN_DROPPED must not be claimed: ${text}`,
      ).toBe('stand_down');
    }
    expect(MODEL_CONTENTS_CLAIM_KNOWN_DROPPED).toHaveLength(4);
  });
});

describe('the decimal-safe splitter (the £1.5 million shape, trap 22)', () => {
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

describe('the read', () => {
  it('is null without a persisted graph — there is no way to synthesise one', () => {
    expect(
      readAuthoritativeModelState({ persistedGraph: null, readiness: WIRE.j4_t2_readiness }),
    ).toBeNull();
    expect(
      readAuthoritativeModelState({ persistedGraph: undefined, readiness: WIRE.j4_t2_readiness }),
    ).toBeNull();
  });

  it('a readiness payload with other blocker codes yields no blocked slots', () => {
    const read = mkRead(DRAFT_GRAPH, { blockers: [{ code: 'NO_OPTIONS', option_label: 'x' }] });
    expect(read.blockedSlots).toEqual([]);
  });
});
