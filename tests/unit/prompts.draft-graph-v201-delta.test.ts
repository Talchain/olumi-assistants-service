/**
 * draft_graph_default v201 — "ACTION TEST" candidate: delta integrity.
 *
 * ── WHAT THIS FILE CAN AND CANNOT PROVE ────────────────────────────────────
 * The defect being fixed is BEHAVIOURAL — an LLM turning attributed
 * explanations into option nodes — and no unit test can settle that. The
 * acceptance evidence is real draws against the deployed model, recorded in
 * `Prompts/candidates/draft_graph-v201-action-test/EVIDENCE.md`. This file
 * guards the three things that ARE settleable statically, each of which has
 * silently broken a prompt change in this estate before:
 *
 *   1. The candidate is DERIVED from the bytes staging actually serves, not
 *      hand-copied beside them. A 59 KB second copy drifts, and drift reads as
 *      green.
 *   2. The delta is EXACTLY the three declared regions. A bulk edit that also
 *      rewrites something else elsewhere in a 61 KB file is invisible to review.
 *   3. The anti-overfire carve-out is still present. This is the whole risk of
 *      the change: a rule that fixes diagnostic briefs by breaking briefs whose
 *      named alternatives are genuine options is WORSE than the defect, and it
 *      would not show up in any corpus of diagnostic briefs. If a later tidy-up
 *      deletes that one bullet, the rule silently becomes the dangerous version
 *      and every diagnostic test still passes. So it is pinned by name.
 *
 * `delta.json` is the single source of truth for the edits: `build.py` and this
 * test both read it, so neither is a mirror of the other.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..');
const CAND = join(REPO, 'Prompts', 'candidates', 'draft_graph-v201-action-test');

const delta = JSON.parse(readFileSync(join(CAND, 'delta.json'), 'utf-8')) as {
  base_sha256: string;
  base_version: number;
  candidate_version: number;
  load_bearing_clause: string;
  edits: { find: string; replace: string }[];
};

const base = readFileSync(join(REPO, 'Prompts', 'canonical', 'draft_graph.txt'), 'utf-8');
const candidate = readFileSync(join(CAND, 'draft_graph_v201.txt'), 'utf-8');

const sha = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');

describe('draft_graph v201 candidate delta', () => {
  it('is built on the exact bytes cee-staging serves as v195', () => {
    // Cross-checked at build time against GET /admin/prompts/status
    // content_hash `152998b447819c2e` and cee_prompt_versions.content_hash.
    expect(sha(base)).toBe(delta.base_sha256);
  });

  it('each anchor matches the base exactly once', () => {
    for (const [i, e] of delta.edits.entries()) {
      const n = base.split(e.find).length - 1;
      expect(n, `anchor ${i + 1} occurrences: ${e.find.slice(0, 50)}`).toBe(1);
    }
  });

  it('the committed candidate is exactly the base plus the declared edits', () => {
    let out = base;
    for (const e of delta.edits) out = out.split(e.find).join(e.replace);
    // Derived, not mirrored: if either file moves without the other, this REDs.
    expect(sha(candidate)).toBe(sha(out));
  });

  it('changes nothing outside the three declared regions', () => {
    // Reverse the edits; what is left must be byte-identical to the base. A
    // stray edit anywhere else in the 61 KB file survives the reversal and REDs.
    let back = candidate;
    for (const e of delta.edits) back = back.split(e.replace).join(e.find);
    expect(back).toBe(base);
  });

  it('keeps the anti-overfire carve-out that protects genuine options', () => {
    // Acceptance arm (b): a brief whose named alternatives ARE real options must
    // still produce options, even when the brief attributes them to people.
    expect(candidate).toContain(delta.load_bearing_clause);
    expect(candidate).toContain('Never key this test on who said something');
  });

  it('the base does not already contain the rule (the change is not a no-op)', () => {
    expect(base).not.toContain('ACTION TEST');
    expect(candidate).toContain('ACTION TEST — OPTIONS ARE MOVES, NOT DIAGNOSES');
  });
});
