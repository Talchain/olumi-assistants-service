/**
 * SENDABLE trust defect — the analysis surface contradicted itself on screen.
 *
 * WITNESSED (UX-gate re-run 2026-08-19T22:01–22:38Z, deployed UI `ad79b344`
 * / CEE `cbc3ea3` / PLoT `fb63b03` / ISL `28fe0c9`, fresh guest, real brief,
 * real draft, real analysis). Rendered directly above one another:
 *
 *   "Option 'hold the line on cloud-only for another year' does not currently
 *    affect the goal. Check that intervention targets are connected to the
 *    goal with non-zero edge strengths."
 *   "hold the line on cloud-only for another year is slightly ahead"
 *
 * Two harms in one strip, and BOTH are deterministic and owned here:
 *
 *   H1 — THE FALSE ASSERTION. `S_BUCKET_REPLACEMENTS.DEGENERATE_OPTION_ZERO_-
 *   VARIANCE` renders the engine condition `std < ZERO_VARIANCE_TOLERANCE`
 *   (ISL `services/robustness_analyzer_v2.py:2305-2312`) as "does not
 *   currently affect the goal". That is not what the producer said and not
 *   what the run proved. ISL's own template hedges — "intervention MAY have
 *   no causal path to goal" (`models/critique.py:337-339`) — and the run has
 *   ALREADY REFUTED the unhedged reading, because every disconnection code is
 *   severity `blocker`:
 *
 *     EMPTY_INTERVENTIONS          blocker  models/critique.py:107-113
 *     INVALID_INTERVENTION_TARGET  blocker  models/critique.py:115-121
 *     NO_EFFECTIVE_PATH_TO_GOAL    blocker  models/critique.py:123-132
 *     INTERVENTION_VALUE_INVALID   blocker  (validated at request_validator.py:325)
 *
 *   and `has_blockers` returns HTTP 422 with no results at all
 *   (`api/robustness.py:818-834`). `NO_EFFECTIVE_PATH_TO_GOAL` is decided on
 *   `effective_adjacency`, built with `check_strength=True` against
 *   `DEFAULT_STRENGTH_THRESHOLD = 1e-6` (`validation/path_validator.py:54`,
 *   `constants/__init__.py:20`) — i.e. LITERALLY "connected to the goal with
 *   non-zero edge strengths". So on any run a user can see, ISL has already
 *   checked exactly the thing the copy tells the user to go and check, and
 *   found it satisfied. The assertion and its remedy are false TOGETHER, and
 *   they are false on every reachable run — not only when the option leads.
 *
 *   SCOPE OF THAT DERIVATION (trap 20 — state the scope, not the
 *   generalisation): it is derived at ISL `28fe0c95` for the `/v2/robustness`
 *   endpoint, the path CEE→PLoT→ISL uses. It is not a claim about every
 *   conceivable producer of this code. The re-authored copy below does not
 *   depend on it holding: it states the engine condition itself, which is
 *   true under EVERY cause of zero variance.
 *
 *   H2 — THE VOCABULARY LEAK. `projectCritiquesForTransport` replaces an
 *   S-bucket row's `message` from the approved catalogue and then forwards
 *   the PRODUCER's own `suggestion` beside it, scrubbed for hard-bans only.
 *   `intervention targets` is a WARNING pattern, not a hard ban
 *   (`orchestrator/shared/forbidden-tokens.ts:189-190`), so it ships. The
 *   whole premise of bucket S is that the producer's wording is unsafe for
 *   users; replacing one field and forwarding the other is that premise
 *   violated at the same seam. It is systemic, not one string — the other S
 *   codes carry "node IDs", "causal edges", "intervention mappings" in the
 *   same field.
 *
 * CONVERGENCE (Paul's binding rule). Canonical owner named:
 * `S_BUCKET_REPLACEMENTS` owns EVERY user-facing string on an S row, remedy
 * included. Competitor superseded: the producer's `suggestion` is dropped for
 * S rows. Claim ownership is likewise separated — `NO_EFFECTIVE_PATH_TO_GOAL`
 * owns "does not connect to your goal"; `DEGENERATE_OPTION_ZERO_VARIANCE`
 * owns "the outcome does not move". No parallel rule is added.
 *
 * OPPOSITE-DIRECTION TWINS. Each guard below is paired with the case that
 * fails if the fix is applied too WIDELY — a suppression that hides a genuine
 * disconnection, and a re-authoring that leaves the user at a dead end. The
 * warning exists for a real harm; both directions are asserted.
 *
 * Trap-19 identity binding: every projection assertion locates its row by the
 * unique `id` it was given, never by a value predicate another row satisfies.
 */
import { describe, expect, it } from 'vitest';

import {
  S_BUCKET_REPLACEMENTS,
  CRITIQUE_BUCKETS,
  projectCritiquesForTransport,
} from '../sanitise-enrichment.js';
import type { LabelResolverContext } from '../resolve-label.js';

const CTX: LabelResolverContext = {
  enrichment: {
    option_comparison: [
      { id: 'opt_hold', label: 'hold the line on cloud-only for another year' },
      { id: 'opt_build', label: 'build self-hosting this year' },
    ],
  },
};

/** The witnessed ISL row, verbatim from `models/critique.py:333-343`. */
const WITNESSED_DEGENERATE_ROW = {
  id: 'crit_witnessed_degenerate',
  code: 'DEGENERATE_OPTION_ZERO_VARIANCE',
  severity: 'warning',
  source: 'analysis',
  message:
    "Option 'hold the line on cloud-only for another year' has zero variance — " +
    'intervention may have no causal path to goal',
  affected_option_ids: ['opt_hold'],
  suggestion:
    'Check that intervention targets are connected to the goal with non-zero edge strengths',
};

function rowById(
  rows: ReadonlyArray<Record<string, unknown>> | undefined,
  id: string,
): Record<string, unknown> {
  expect(Array.isArray(rows), 'projection returned no array').toBe(true);
  const row = (rows as ReadonlyArray<Record<string, unknown>>).find((r) => r.id === id);
  expect(row, `expected a projected row with id=${id}`).toBeDefined();
  return row as Record<string, unknown>;
}

// =============================================================================
// H1 — the false assertion, and its opposite-direction twin
// =============================================================================

describe('H1 — a zero-variance option is never told it fails to affect the goal', () => {
  it('DEGENERATE_OPTION_ZERO_VARIANCE does not assert the option leaves the goal untouched', () => {
    const out = S_BUCKET_REPLACEMENTS.DEGENERATE_OPTION_ZERO_VARIANCE!(CTX, {
      affected_option_ids: ['opt_hold'],
    });
    // The run reached the user, so ISL's blockers all passed: the option's
    // targets DO reach the goal through above-threshold links. Any wording
    // that denies an effect on the goal contradicts the run that produced it.
    expect(out).not.toMatch(/does not currently affect the goal/i);
    expect(out).not.toMatch(/(?:does not|doesn't|no)\b[^.]*\baffect\b[^.]*\bgoal\b/i);
  });

  it('DEGENERATE_OPTION_ZERO_VARIANCE states the producer condition — the outcome does not move', () => {
    const out = S_BUCKET_REPLACEMENTS.DEGENERATE_OPTION_ZERO_VARIANCE!(CTX, {
      affected_option_ids: ['opt_hold'],
    });
    expect(out).toContain("Option 'hold the line on cloud-only for another year'");
    expect(out).toMatch(/same result in every simulation/i);
  });

  it('DEGENERATE_OPTION_ZERO_VARIANCE cannot contradict a leading-option claim in the same run', () => {
    // The witnessed pairing. A statement about CONSTANCY is compatible with a
    // statement about RANK; a statement about having no effect is not. This is
    // the assertion the screenshot would have failed.
    const out = S_BUCKET_REPLACEMENTS.DEGENERATE_OPTION_ZERO_VARIANCE!(CTX, {
      affected_option_ids: ['opt_hold'],
    });
    const heroClaimInTheSameRun =
      'hold the line on cloud-only for another year is slightly ahead.';
    const bothOnScreen = `${out} ${heroClaimInTheSameRun}`;
    // A single surface may not both deny an effect on the goal and rank the
    // same option ahead.
    const deniesEffect = /\baffect(?:s|ing)?\b[^.]*\bgoal\b/i.test(out);
    const ranksIt = /\b(?:ahead|leads?|leading)\b/i.test(heroClaimInTheSameRun);
    expect(
      deniesEffect && ranksIt,
      `self-contradicting strip: ${JSON.stringify(bothOnScreen)}`,
    ).toBe(false);
  });

  // ── OPPOSITE-DIRECTION TWIN ────────────────────────────────────────────
  // The warning exists to tell a user their model is disconnected, which is
  // real and useful. Re-authoring the zero-variance copy must NOT cost the
  // estate that sentence. It is owned by a different code, and it stays.
  it('TWIN — a genuinely disconnected option is still told so, by its own code', () => {
    const out = S_BUCKET_REPLACEMENTS.NO_EFFECTIVE_PATH_TO_GOAL!(CTX, {
      affected_option_ids: ['opt_hold'],
    });
    expect(out).toMatch(/does not currently connect to your goal/i);
    expect(CRITIQUE_BUCKETS.NO_EFFECTIVE_PATH_TO_GOAL).toBe('S');
  });

  it('TWIN — the disconnected-model warning for the whole graph is still told', () => {
    const out = S_BUCKET_REPLACEMENTS.GRAPH_DISCONNECTED!(CTX, {});
    expect(out).toMatch(/not connected to your goal/i);
  });
});

// =============================================================================
// H2 — the producer's remedy never reaches a user on an S row
// =============================================================================

describe('H2 — S rows ship the catalogue remedy, never the producer wording', () => {
  it('the witnessed engine remedy does not reach the wire', () => {
    const rows = projectCritiquesForTransport([WITNESSED_DEGENERATE_ROW], CTX);
    const row = rowById(rows, 'crit_witnessed_degenerate');
    expect(JSON.stringify(row)).not.toMatch(/intervention/i);
    expect(JSON.stringify(row)).not.toMatch(/edge strength/i);
    expect(row.suggestion).toBeUndefined();
  });

  it('no S row forwards a producer suggestion, whatever it says', () => {
    const sCodes = Object.entries(CRITIQUE_BUCKETS)
      .filter(([, bucket]) => bucket === 'S')
      .map(([code]) => code);
    // Non-vacuity: the S bucket is not empty, so the loop below tests something.
    expect(sCodes.length).toBeGreaterThan(0);
    const raw = sCodes.map((code, i) => ({
      id: `crit_s_${i}`,
      code,
      severity: 'warning',
      source: 'analysis',
      message: `internal wording for ${code}`,
      affected_option_ids: ['opt_hold', 'opt_build'],
      suggestion: 'Check that intervention targets reference valid node IDs',
    }));
    const rows = projectCritiquesForTransport(raw, CTX);
    expect(rows).toHaveLength(sCodes.length);
    for (let i = 0; i < sCodes.length; i++) {
      const row = rowById(rows, `crit_s_${i}`);
      expect(
        row.suggestion,
        `S row ${sCodes[i]} forwarded the producer suggestion`,
      ).not.toBe('Check that intervention targets reference valid node IDs');
    }
  });

  // ── OPPOSITE-DIRECTION TWIN ────────────────────────────────────────────
  // "Olumi must always give the user a useful next route, not merely an honest
  // dead end." Dropping the producer remedy must not leave the user without
  // one where the producer previously supplied it.
  it('TWIN — every S row that reports a fixable model problem still carries a route', () => {
    // The codes whose message names something WRONG with the user's model, as
    // opposed to a property of the run the user cannot act on. Derived from
    // the catalogue, not from the producer.
    const MUST_ROUTE = [
      'EMPTY_INTERVENTIONS',
      'INVALID_INTERVENTION_TARGET',
      'NO_EFFECTIVE_PATH_TO_GOAL',
      'IDENTICAL_OPTIONS',
      'GRAPH_DISCONNECTED',
      'DEGENERATE_OPTION_ZERO_VARIANCE',
    ] as const;
    for (const code of MUST_ROUTE) {
      const fn = S_BUCKET_REPLACEMENTS[code];
      expect(fn, `${code} has no catalogue entry`).toBeDefined();
      const out = fn!(CTX, { affected_option_ids: ['opt_hold', 'opt_build'] });
      // A route is a second sentence telling the user what to do next. One
      // bare sentence of diagnosis is the dead end this twin exists to catch.
      const sentences = out.split(/(?<=\.)\s+/).filter((s) => s.trim().length > 0);
      expect(
        sentences.length,
        `${code} is a dead end — one sentence, no next route: ${JSON.stringify(out)}`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  // ── OPPOSITE-DIRECTION TWIN ────────────────────────────────────────────
  // The drop is scoped to bucket S. Bucket U's declared contract is that the
  // producer's own prose is kept after scrubbing — widening the drop to U
  // would silently delete honest remediation the estate deliberately keeps.
  it('TWIN — a U row still forwards its producer suggestion', () => {
    const rows = projectCritiquesForTransport(
      [
        {
          id: 'crit_u_keep',
          code: 'DEGENERATE_OUTCOMES',
          severity: 'warning',
          source: 'engine',
          message: 'internal wording',
          user_message: 'The options produce the same outcome.',
          affected_option_ids: ['opt_hold'],
          suggestion: 'Gather more evidence before relying on this comparison.',
        },
      ],
      CTX,
    );
    const row = rowById(rows, 'crit_u_keep');
    expect(CRITIQUE_BUCKETS.DEGENERATE_OUTCOMES).toBe('U');
    expect(row.suggestion).toBe('Gather more evidence before relying on this comparison.');
  });
});
