/**
 * decision_review — SERVED-CONTRACT DRIFT GUARD.
 *
 * Five of the pack's dimensions are DERIVED from the served prompt text rather
 * than retyped from it, because a retyped list is a hand-maintained mirror and
 * mirrors here drift silently (trap 12; `tools/graph-evaluator`'s `BANNED_TERMS`
 * and `TONE_RULES` are the worked example, unchanged since 2026-03-06).
 *
 * But a purely-derived control has the opposite failure (trap 12b): pinned to
 * "whatever is current", it decays into a tautology the first time current
 * changes. If a prompt revision quietly dropped "recommendation" from its
 * banned list, the derived dimension would stop checking it and keep reporting
 * green — the control would pass by testing nothing.
 *
 * This file is the pairing that closes both holes:
 *   - the DERIVED set is what the scorer uses (tracks live);
 *   - the FROZEN v14 floor is what this file asserts against (pinned to a
 *     historical artefact, permanently).
 *
 * A term the current prompt no longer bans turns this RED. That is the point:
 * the retirement may well be intended, and a human then records it as a dated
 * exception in `served-contract.ts`. What must never happen is the retirement
 * passing unnoticed.
 */

import { describe, expect, it } from 'vitest';
import {
  diffAgainstV14Floor,
  parseServedTerminologyContract,
  parseToneTable,
  promptHash16,
  readServedPromptText,
  resolveToneRow,
  STALENESS_TOKENS_OWNED_BY_R_CONT,
  V14_BANNED_LEXICON_FLOOR,
  V14_INTERNAL_VOCABULARY_FLOOR,
  V14_SERVED_HASH_16,
} from '../src/decision-review/served-contract.js';
import { FABRICATED_CONTINUITY_PATTERNS } from '../../../src/cee/decision-review/contract-gate.js';

const promptText = readServedPromptText();
const contract = parseServedTerminologyContract(promptText);

describe('the canonical export IS the served prompt', () => {
  it('hashes to the manifest\'s live-observed served hash', () => {
    // `Prompts/canonical/manifest.json` records
    // live_served_hash_observed = b4f15305c2bb32e9 for decision_review_default
    // v14 with served_hash_verified: true. Parsing the export therefore derives
    // the contract staging actually serves — not a proxy for it.
    //
    // NOTE this is deliberately NOT a hard equality assertion on a moving
    // target: when the rewrite lane bumps the prompt, this test reports the new
    // hash and the drift assertions below decide whether anything was LOST.
    const hash = promptHash16(promptText);
    if (hash !== V14_SERVED_HASH_16) {
      console.warn(
        `served decision_review prompt has moved: ${V14_SERVED_HASH_16} -> ${hash}. ` +
          'The derived dimensions follow it automatically; the floor assertions below are what decide whether the move LOST a rule.',
      );
    }
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('derived vs frozen v14 floor', () => {
  const drift = diffAgainstV14Floor(contract);

  it('no banned term has been silently RETIRED', () => {
    expect(
      drift.lexiconRetired,
      'the served prompt no longer bans these v14 terms — if that retirement is intended, record it as a dated exception in served-contract.ts',
    ).toEqual([]);
  });

  it('no internal-vocabulary term has been silently RETIRED', () => {
    expect(drift.vocabularyRetired).toEqual([]);
  });

  it('reports (does not fail on) tightenings', () => {
    // A prompt banning MORE than v14 did is a contract tightening. The derived
    // set picks it up for free, so it is informational — but it is printed,
    // because a silent tightening is still a change to what the eval measures.
    if (drift.lexiconAdded.length > 0 || drift.vocabularyAdded.length > 0) {
      console.warn(
        `served prompt now bans MORE than v14: lexicon +[${drift.lexiconAdded.join(', ')}] vocabulary +[${drift.vocabularyAdded.join(', ')}]`,
      );
    }
    expect(Array.isArray(drift.lexiconAdded)).toBe(true);
  });

  it('at v14 exactly, derived === frozen in BOTH directions', () => {
    // The strongest statement available while the served prompt is still v14:
    // the parser reproduces the frozen floor with nothing extra and nothing
    // missing. If it did not, one of the two would be wrong and there would be
    // no way to tell which.
    if (promptHash16(promptText) === V14_SERVED_HASH_16) {
      expect([...contract.bannedTerms].sort()).toEqual([...V14_BANNED_LEXICON_FLOOR].sort());
      expect([...contract.internalVocabulary].sort()).toEqual(
        [...V14_INTERNAL_VOCABULARY_FLOOR].sort(),
      );
    }
  });
});

describe('the parser refuses to be vacuous', () => {
  it('throws rather than returning an empty lexicon when the block is gone', () => {
    // The failure this prevents: a prompt rewrite that renames the banned block
    // would otherwise leave every lexicon dimension passing on an empty term
    // list — nineteen green dimensions, five of them testing nothing.
    const mangled = promptText.replace('BANNED in every output string, no exceptions:', 'Style notes:');
    expect(() => parseServedTerminologyContract(mangled)).toThrow(/no "BANNED in every output string/);
  });

  it('throws when the block has no terminator', () => {
    const mangled = promptText.replace('</TERMINOLOGY>', '');
    expect(() => parseServedTerminologyContract(mangled)).toThrow(/terminator/);
  });

  it('throws rather than returning an empty tone table', () => {
    const mangled = promptText.replace(
      '| readiness | headline_type | Tone | Forbidden phrasing |',
      '(tone guidance removed)',
    );
    expect(() => parseToneTable(mangled)).toThrow(/TONE ALIGNMENT table header/);
  });
});

describe('the parse is clean, not merely non-empty', () => {
  it('carries no punctuation-only or clause-length artefacts', () => {
    // Both were REAL defects in the first draft of this parser: a per-line quote
    // scan mis-paired quotes across a wrapped phrase and emitted a bare `","` as
    // a banned term (which would have matched every review ever written), and
    // the prompt's prescribed replacements were being read as bans.
    for (const term of contract.bannedTerms) {
      expect(term).toMatch(/[a-z]/);
      expect(term.split(/\s+/).length, `"${term}" looks like a clause, not a term`).toBeLessThanOrEqual(4);
    }
  });

  it('excludes the prompt\'s PRESCRIBED replacements', () => {
    // `say "the latest available run"` and `write "62%"` are the forms the
    // prompt WANTS. Banning them would invert the rule.
    expect(contract.bannedTerms).not.toContain('the latest available run');
    expect(contract.bannedTerms).not.toContain('62%');
    expect(contract.bannedTerms.some((t) => t.startsWith('how strongly'))).toBe(false);
  });

  it('hands the staleness phrases to R-CONT, and R-CONT still covers them', () => {
    // One source of truth per rule: these three are excluded from the lexicon
    // because the RUNTIME already enforces them. That exclusion is only safe
    // while the runtime patterns actually match them — asserted here, so the
    // check can never be lost in the handover between the two.
    for (const phrase of STALENESS_TOKENS_OWNED_BY_R_CONT) {
      expect(contract.bannedTerms).not.toContain(phrase);
      const covered = FABRICATED_CONTINUITY_PATTERNS.some((re) => re.test(phrase));
      expect(covered, `"${phrase}" is excluded from the lexicon but R-CONT does not match it`).toBe(true);
    }
  });
});

describe('tone table semantics', () => {
  const rows = parseToneTable(promptText);

  it('parses every row with a caution rank', () => {
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.map((r) => r.cautionRank)).toEqual(rows.map((_, i) => i));
  });

  it('resolves the MORE CAUTIOUS of readiness and headline_type', () => {
    // The table header says to follow the more cautious signal; the table is
    // written least-cautious first, so "more cautious" is "later row". A
    // resolver that took the FIRST match would score a needs_evidence run
    // against the confident row and never fire.
    const lenient = resolveToneRow(rows, 'ready', 'clear_winner');
    const mixed = resolveToneRow(rows, 'ready', 'needs_evidence');
    expect(lenient?.cautionRank).toBe(0);
    expect(mixed?.cautionRank).toBeGreaterThan(lenient!.cautionRank);
    expect(mixed?.forbidden.length).toBeGreaterThan(0);
  });

  it('the confident row genuinely forbids nothing (why tone is a PACK-LEVEL corpus check)', () => {
    expect(resolveToneRow(rows, 'ready', 'clear_winner')?.forbidden).toEqual([]);
  });

  it('returns null on unknown vocabulary rather than inventing a verdict', () => {
    expect(resolveToneRow(rows, 'not_a_readiness', 'not_a_headline')).toBeNull();
  });

  it('the `any` headline cell is reachable only via its readiness value', () => {
    // `| needs_framing | any | …` must not match every run that has any
    // headline_type — that would apply the strictest row universally.
    expect(resolveToneRow(rows, 'ready', 'clear_winner')?.cautionRank).toBe(0);
    expect(resolveToneRow(rows, 'needs_framing', 'clear_winner')?.tone).toContain('structural');
  });
});
