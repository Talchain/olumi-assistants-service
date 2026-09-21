/**
 * ROADMAP 2.692 — THE CLAIM-SHAPE GUARD for the uncertainty lens's copy.
 *
 * ⛔ STATUS: the copy this guards is PARKED and RENDERED NOWHERE. Its lens was
 * removed before merge because ISL's user-facing-language ban is live and its
 * gating condition is unmet. The guard stays green and stays running so the copy
 * cannot rot while it waits — see `coaching/uncertainty-priority.ts` for the
 * gate, and what would lift it.
 *
 * ⚠ WHY A SEPARATE GUARD, WHEN THE ORACLE WAS ALREADY CORRECT. The producer
 * prohibitions were derived correctly from ISL's own bytes and written into
 * `lens-selector.ts`'s copy comment — and the shipped copy then violated them
 * IN SUBSTANCE while avoiding the banned WORDS. An adversarial review caught it:
 * *"the picture steadies more than it would from anything else you could look
 * into"* carries no banned token and is nonetheless a comparative
 * value-of-information claim, which is precisely what ISL disclaims. That is
 * CLAUDE.md trap 13c one level up: a correct oracle, and an expectation that
 * slipped past it because nothing mechanical was checking.
 *
 * A comment is not a guard. This file is the guard.
 *
 * ── WHAT IT CAN AND CANNOT DO, STATED SO IT IS NOT OVER-READ ────────────────
 * It is a PHRASE-SHAPE denylist over a hand-written corpus of the constructions
 * that already went wrong, plus the producer's own disclaimed vocabulary. It
 * therefore CANNOT prove the copy is right — a corpus from the author's head
 * cannot see the class the author did not imagine (trap 22), and this corpus is
 * exactly that. What it CAN do is make the KNOWN-wrong shapes unshippable, so a
 * future edit that reintroduces one REDs instead of being caught by a human who
 * happens to look. The real guard for breadth remains review.
 *
 * ── THE PRODUCER'S PROHIBITIONS, AT THE BYTES (ISL `staging` @ 28fe0c95) ────
 * ⚠ These citations resolve on ISL's `staging` branch, NOT `main`.
 *   `src/models/response_v2.py:1766-1771` — "This is NOT value-of-information:
 *     holding the decision fixed, it structurally cannot capture
 *     option-switching … For decision value use `decision_evpi` (whole
 *     decision) and `factor_evppi` (per-factor), both in outcome units."
 *   `src/services/robustness_analyzer_v2.py:7473-7485` — "calling it EVPI was a
 *     mislabel."
 *   `docs/science-validation/REPORT.md:362-364` — "`evpi_status = 'resolved'`
 *     is a 95% claim … treat `resolved` as 'distinguishable from noise at 95%',
 *     not 'real'."
 *   `docs/science-validation/REPORT.md:370-374` — common-mode factors are
 *     structurally zero under p_win; "doctrine should preclude narrating such
 *     values."
 * Plus the SCOPE fact, derived from the sweep's own input: it ranks only
 * `request.parameter_uncertainties`. Edge and structural uncertainty run in
 * BOTH arms and are never ranked — so any "everything uncertain" phrasing is
 * false scope, not loose wording.
 */

import { describe, expect, it } from 'vitest';

import {
  UNCERTAINTY_PRIORITY_BODY_PENDING_DOCTRINE,
  UNCERTAINTY_PRIORITY_TITLE_PENDING_DOCTRINE,
} from '../../coaching/uncertainty-priority.js';

// ⛔ THE COPY IS PARKED, NOT WIRED — the lens that rendered it was removed before
// merge on a live ISL science ban (see `coaching/uncertainty-priority.ts`). This
// guard deliberately still runs: parked copy that nothing checks is copy that
// rots quietly, and the whole point of parking it is that the re-add is short
// and mechanical rather than a rebuild. It binds to the constants directly, so
// it neither depends on nor resurrects the lens.
const BODY = UNCERTAINTY_PRIORITY_BODY_PENDING_DOCTRINE;
const TITLE = UNCERTAINTY_PRIORITY_TITLE_PENDING_DOCTRINE;
const COPY = `${TITLE} ${BODY}`.toLowerCase();

/**
 * Each row is a construction that was SHIPPED or is directly disclaimed by the
 * producer — never a shape invented to pad the list. The `why` is the citation
 * that makes it prohibited, so a future reader can judge the rule rather than
 * obey it.
 */
const PROHIBITED: readonly { readonly shape: RegExp; readonly why: string }[] = [
  // ── comparative value-of-information ──────────────────────────────────────
  {
    shape: /anything else|any other (?:thing|question|avenue)|more than anything/,
    why: 'comparative VoI — the exact phrasing that shipped and was caught in review',
  },
  {
    shape: /value of information|worth (?:more|most|checking|knowing)|highest[- ]value|most valuable/,
    why: 'VoI vocabulary — ISL: "This is NOT value-of-information"',
  },
  {
    shape: /\bevpi\b|value of perfect information/,
    why: 'ISL: "calling it EVPI was a mislabel"',
  },
  // ── option-switching / decision-change ────────────────────────────────────
  {
    shape: /which option|comes out ahead|change (?:the|your) (?:decision|choice|answer)|the winner|would win|what to choose|change the outcome/,
    why: 'ISL: "structurally cannot capture option-switching"',
  },
  // ── false scope ───────────────────────────────────────────────────────────
  {
    shape: /of everything|everything (?:still )?uncertain|all (?:your|the) uncertaint|every uncertainty/,
    why: 'the sweep ranks only request.parameter_uncertainties; edge + structural uncertainty are never ranked',
  },
  // ── misattributed noise floor ─────────────────────────────────────────────
  {
    shape: /its own (?:measurement )?noise|the factor's own noise/,
    why: 'the floor is 1.96*sqrt(0.5/n) — identical for every factor in the run, so it is the RUN\'s floor',
  },
  // ── magnitude leak ────────────────────────────────────────────────────────
  {
    shape: /\d/,
    why: 'the licensed surface is a ranking with NO magnitudes (enrichment-manifest R_VOI_NOT_COACH_NARRATED)',
  },
];

describe('uncertainty lens copy — prohibited claim shapes', () => {
  it('CONTROL: the guard can SEE a violation (an absence test with no positive control is vacuous)', () => {
    // trap 13. Without this the whole file could pass by matching nothing at all.
    const violating =
      'Resolving this is worth more than anything else you could look into, and it would change the decision.';
    const hits = PROHIBITED.filter((p) => p.shape.test(violating));
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it.each(PROHIBITED.map((p) => [p.why, p.shape] as const))(
    'does not make this claim: %s',
    (_why, shape) => {
      expect(COPY).not.toMatch(shape);
    },
  );

  it('KEEPS the producer\'s own 95% hedge — the honesty is not optional', () => {
    // ISL: treat `resolved` as "distinguishable from noise at 95%", not "real".
    expect(COPY).toMatch(/strong hint|not a settled fact/);
  });

  it('names the SCOPE it actually ranks', () => {
    // The positive counterpart to the false-scope prohibition above: the copy
    // must say what it measured, not merely avoid saying what it did not.
    expect(COPY).toMatch(/this run measured|the run measured|parameter/);
  });

  it('fits the block caps, so no gate can truncate a qualifier off the end', () => {
    // A hedge that truncation eats is a hedge that never shipped — the same
    // failure mode the fragile-edge naming sentence was reordered to avoid.
    expect(TITLE.length).toBeLessThanOrEqual(80);
    expect(BODY.length).toBeLessThanOrEqual(300);
  });
});
