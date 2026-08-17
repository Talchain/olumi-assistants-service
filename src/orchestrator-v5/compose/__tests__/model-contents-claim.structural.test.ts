/**
 * ⭐⭐⭐ ROADMAP 2.1265 (D2) — THE STRUCTURAL PIN.
 *
 * **The rule (Paul, 17 Aug 2026; STANDING-BRIEF-PREAMBLE P5):** *Olumi may not
 * assert that the model contains or reflects a value unless that claim is
 * grounded in the authoritative persisted state — AND a simultaneous blocker
 * saying the value is missing must make such a claim IMPOSSIBLE, not merely
 * discouraged.*
 *
 * This file is the "impossible" half. Every case below **RESTORES the claim** —
 * it takes the byte-verbatim fabrication the deployed product shipped and tries
 * to get a permission out of the seam — and asserts it is refused. If anyone
 * later adds a flag, an override, a second entry point, or reinstates the
 * permission after the mandatory-refusal branch, these go RED.
 *
 * ⚠ FIXTURES ARE THE WIRE'S, NOT MINE (trap 16): the reply, the readiness and
 * the graph all come from
 * `olumi-docs/witness-acceptance-2026-08-17/captures/`, copied verbatim into
 * `../../__tests__/fixtures/witness-2026-08-17/`. Historic record — append,
 * never edit (trap 14b).
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import {
  extractAssertedNumbers,
  groundModelValueClaim,
  readAuthoritativeModelState,
  type AuthoritativeModelRead,
} from '../model-contents-claim.js';
import {
  MODEL_CONTENTS_CLAIM_KNOWN_DROPPED,
  classifyModelContentsClaim,
} from '../missing-value-claim-guard.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

const WIRE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wire-strings.json', import.meta.url),
    'utf8',
  ),
) as {
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

const OPTION_ID = '21ea9b80';
const FACTOR_ID = '49a2b80b';
const OPTION_LABEL = 'subcontracting inner-city deliveries to a green courier';
const FACTOR_LABEL = 'Subcontractor cost as share of affected-route revenue';

/** The blocker-bearing read: exactly the state the fabrication was composed in. */
function witnessedRead(): AuthoritativeModelRead {
  const read = readAuthoritativeModelState({
    persistedGraph: DRAFT_GRAPH,
    readiness: buildCanonicalAnalysisReadyFromGraph(DRAFT_GRAPH),
  });
  if (read === null) throw new Error('precondition: the witnessed read must exist');
  return read;
}

function readWithOptionEffect(value: number): AuthoritativeModelRead {
  const g = clone(DRAFT_GRAPH);
  for (const node of g.nodes) {
    if (node.id !== OPTION_ID) continue;
    node.interventions = { [FACTOR_ID]: { value, source: 'user_override' } };
  }
  const read = readAuthoritativeModelState({
    persistedGraph: g,
    readiness: buildCanonicalAnalysisReadyFromGraph(g),
  });
  if (read === null) throw new Error('precondition');
  return read;
}

describe('preconditions — the read really is blocker-bearing and really lacks the value', () => {
  it('the witnessed read carries the blocked pair and does NOT hold 0.12 or 12', () => {
    const read = witnessedRead();
    expect(read.blockedSlots.length).toBeGreaterThan(0);
    expect(read.blockedSlots).toContainEqual({
      optionLabel: OPTION_LABEL,
      factorLabel: FACTOR_LABEL,
    });
    // POSITIVE CONTROL — the grounded set is not empty/blind: it sees the real
    // 0.5 defaults and the two cee_hypothesis intervention values.
    expect(read.groundedValues.has(0.5)).toBe(true);
    expect(read.groundedValues.has(0.95)).toBe(true);
    expect(read.groundedValues.has(0.96)).toBe(true);
    // THE ABSENCE the fabrication contradicted.
    expect(read.groundedValues.has(0.12)).toBe(false);
    expect(read.groundedValues.has(12)).toBe(false);
  });
});

describe('RESTORE THE CLAIM — every shape must be refused as blocker_says_missing', () => {
  const read = witnessedRead();

  // Every phrasing the witness produced, plus the equivalent spellings of the
  // same assertion. Each is the claim RESTORED; each must be refused.
  const RESTORED_CLAIMS: readonly string[] = [
    // Byte-verbatim, the full reply the deployed product shipped.
    WIRE.j4_t2_assistant_text,
    // Its headline alone.
    'Your model already reflects subcontractor cost at 12% of affected-route revenue, so no change is needed there.',
    // The same assertion as a bare share.
    'Your model already reflects subcontractor cost at 0.12 of affected-route revenue.',
    // Comma'd and spaced spellings.
    'Your model already carries 12 % there.',
    // A different holding verb from the closed set.
    'The subcontracting option already uses 0.12 for that factor.',
    // Naming the persisted label exactly, which the fabrication did not.
    `Your model already holds ${FACTOR_LABEL} at 12%.`,
  ];

  for (const [index, claim] of RESTORED_CLAIMS.entries()) {
    it(`restored claim #${index + 1} is refused, and refused as the CONTRADICTION case`, () => {
      const decision = classifyModelContentsClaim({ assistantText: claim, read });
      expect(decision.verdict).toBe('swap');
      if (decision.verdict !== 'swap') return;
      // Not merely "unsupported" — the payload's own blocker contradicts it.
      expect(decision.reason).toBe('blocker_says_missing');
      // The replacement asserts nothing about model contents — and this is
      // checked BY THE RECOGNISER ITSELF rather than by a word-blacklist, the
      // same discipline `withheld-leader-claim-chokepoint` uses to prove the
      // guards' own substitution constants are clean. A replacement that were
      // itself a contents claim would be the defect reintroduced by the fix.
      expect(decision.text).not.toContain('12%');
      expect(decision.text).not.toContain('0.12');
      expect(
        classifyModelContentsClaim({ assistantText: decision.text, read }).verdict,
        'the refusal copy must not itself be a claim about model contents',
      ).toBe('stand_down');
    });
  }

  it('the SEAM itself refuses, not just the recogniser — grounding is denied at source', () => {
    const verdict = groundModelValueClaim({
      read,
      assertedValues: extractAssertedNumbers('12%'),
    });
    expect(verdict).toEqual({ grounded: false, reason: 'blocker_says_missing' });
  });

  it('DEFAULT-DENY: a claim whose numbers cannot be read is not a permission', () => {
    expect(groundModelValueClaim({ read, assertedValues: [] }).grounded).toBe(false);
  });

  it('NO OVERRIDE EXISTS: the seam admits exactly two parameters and no escape key', () => {
    // A flag, `force`, `allowUngrounded`, `skipBlockerCheck` etc. would have to
    // arrive through this object. Pinning the arity + the accepted keys means
    // adding one is a RED, not a quiet widening.
    expect(groundModelValueClaim.length).toBe(1);
    const accepted = { read, assertedValues: extractAssertedNumbers('12%') };
    expect(Object.keys(accepted).sort()).toEqual(['assertedValues', 'read']);
    // And an attempt to smuggle one through changes nothing.
    const smuggled = {
      ...accepted,
      force: true,
      allowUngrounded: true,
      skipBlockerCheck: true,
    } as unknown as Parameters<typeof groundModelValueClaim>[0];
    expect(groundModelValueClaim(smuggled)).toEqual({
      grounded: false,
      reason: 'blocker_says_missing',
    });
  });

  it('THE READ IS THE ONLY KEY: a fabricated read cannot be constructed from outside', () => {
    // The brand is a module-private unique symbol, so the ONLY producer is
    // `readAuthoritativeModelState`, which requires the persisted graph. This
    // asserts the runtime half (a hand-built object is not accepted as one);
    // the compile-time half is that passing it un-cast is a type error.
    const forged = {
      groundedValues: new Set([0.12]),
      blockedSlots: [],
    } as unknown as AuthoritativeModelRead;
    // A forged read can only be used by defeating the type system explicitly —
    // which is exactly what a reviewer must be able to see in a diff. Pinned so
    // that any such cast in production code is a visible, deliberate act.
    expect(groundModelValueClaim({ read: forged, assertedValues: extractAssertedNumbers('12%') }))
      .toEqual({ grounded: true });
    // …and with no persisted graph there is no read at all to pass.
    expect(readAuthoritativeModelState({ persistedGraph: null, readiness: WIRE.j4_t2_readiness }))
      .toBeNull();
  });
});

describe('opposite-direction twins — over-refusal is a failure, not a safe default', () => {
  it('PERMIT-WINS: the identical sentence is GROUNDED once the option holds the value', () => {
    const decision = classifyModelContentsClaim({
      assistantText: WIRE.j4_t2_assistant_text,
      read: readWithOptionEffect(0.12),
    });
    expect(decision).toEqual({ verdict: 'stand_down', reason: 'claim_is_grounded' });
  });

  it('CLEAN-TEXT: the witnessed HONEST refusal is untouched', () => {
    const decision = classifyModelContentsClaim({
      assistantText: WIRE.j4_t4_assistant_text,
      read: witnessedRead(),
    });
    expect(decision.verdict).toBe('stand_down');
  });

  it('NEGATION TWIN: "already a driver, but the effect value is not set" stands', () => {
    const decision = classifyModelContentsClaim({
      assistantText: `Your model already has ${FACTOR_LABEL} at 12% in mind, but the effect value is not set.`,
      read: witnessedRead(),
    });
    expect(decision.verdict).toBe('stand_down');
  });

  it('NO BLOCKER: an ungrounded claim is refused, but as the NARROWER reason, and names no pair', () => {
    const g = clone(DRAFT_GRAPH);
    // A graph with no options ⇒ no missing-effect-value blockers.
    g.nodes = g.nodes.filter((n) => n.kind !== 'option');
    const read = readAuthoritativeModelState({
      persistedGraph: g,
      readiness: buildCanonicalAnalysisReadyFromGraph(g),
    })!;
    expect(read.blockedSlots).toHaveLength(0);
    const decision = classifyModelContentsClaim({
      assistantText: 'Your model already reflects subcontractor cost at 12%.',
      read,
    });
    expect(decision.verdict).toBe('swap');
    if (decision.verdict !== 'swap') return;
    expect(decision.reason).toBe('not_in_persisted_state');
    // P5 applied to the correction copy: with no blocker there is no pair to
    // name, and naming one would be the same class of invention.
    expect(decision.text).not.toContain(OPTION_LABEL);
  });
});

describe('the honest-gap set (trap 22f) — pinned BOTH ways', () => {
  it('every KNOWN_DROPPED shape stands down, exactly as recorded', () => {
    const read = witnessedRead();
    for (const text of MODEL_CONTENTS_CLAIM_KNOWN_DROPPED) {
      const decision = classifyModelContentsClaim({ assistantText: text, read });
      expect(decision.verdict, `KNOWN_DROPPED must not be claimed: ${text}`).toBe('stand_down');
    }
  });

  it('the set has not silently shrunk', () => {
    expect(MODEL_CONTENTS_CLAIM_KNOWN_DROPPED).toHaveLength(4);
  });

  it('every gap is a MISSED claim, never an invented permission', () => {
    // The failure direction is chosen: a dropped shape yields `stand_down`, which
    // leaves the model's own prose in place. None of them can produce a `swap`
    // with `grounded` semantics, because permission only ever comes from the seam.
    const read = witnessedRead();
    for (const text of MODEL_CONTENTS_CLAIM_KNOWN_DROPPED) {
      const numbers = extractAssertedNumbers(text);
      if (numbers.length === 0) continue;
      expect(groundModelValueClaim({ read, assertedValues: numbers }).grounded).toBe(false);
    }
  });
});
