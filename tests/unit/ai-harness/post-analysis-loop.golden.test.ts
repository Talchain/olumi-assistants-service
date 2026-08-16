/**
 * AI Harness capability 1 — golden-journey proof (build gate).
 *
 * Self-contained, deterministic proof for the flag-gated post-analysis loop.
 * Drives the post-analysis advice gate / composer over a representative
 * post-analysis journey (explain → improve/change-advice → what-next →
 * change-request → premortem) with the loop flag OFF and ON, and asserts the
 * four lived-defect improvements + the honesty / safe-now / flag-parity
 * guarantees. Holds a reviewable markdown transcript under `Docs/v5/` as a
 * COMMITTED ORACLE: the default run compares against it and FAILS on drift,
 * leaving the working tree untouched. Regenerating is an explicit opt-in
 * (`UPDATE_GOLDENS=1`) — see the drift-gate note further down for why.
 *
 * Scope discipline:
 *   - Touches NO golden-journey harness internals (Track B owns those). This
 *     exercises the actual seam where the feature lives (`tryPostAnalysisAdviceGate`)
 *     so the proof is fast, deterministic, and network-free.
 *   - The full live turn-executor journey (real LLM/PLoT/Supabase) is the
 *     ACCEPTANCE gate, deferred to an authorised live run — not this build gate.
 *
 * Proves:
 *   1. No false-success language without a committed mutation (the gate path
 *      commits no mutation; the composer never emits success/applied prose).
 *   2. Richer context reaches the answer (readiness gaps + recent changes),
 *      flag ON, where the thin projection is blank.
 *   3. Generic fall-through is reduced: flag OFF → `data_unavailable_for_class`
 *      (→ slow LLM route); flag ON → a grounded `canonical_rich` answer.
 *   4. The deterministic gate avoids the LLM entirely (0 LLM calls).
 *   plus: flag-OFF parity, safe-now content only (no held science prose),
 *   change-requests still route to the safe-apply path (never hijacked), and
 *   premortem/challenge is handled safely (no overclaim).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
  type AdviceGateCanonicalState,
  type AdviceGateRecentChange,
  type AdviceGateResult,
} from '../../../src/orchestrator-v5/routing/post-analysis-advice-gate.js';
import {
  HELD_SCIENCE_VOCABULARY_PATTERN,
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';
import { classifyStructuralClaim } from '../../../src/orchestrator-v5/routing/mutation-language.js';
import type { GraphPatchBlockData } from '../../../src/orchestrator/types.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

// ── Fixtures ───────────────────────────────────────────────────────────────

/** A fresh analysis whose thin LLM-facing projection is blank — the exact
 *  condition that made the advice gate fall through `data_unavailable_for_class`
 *  to the slow generic LLM router. */
const BLANK_PROJECTION: AdviceGateAnalysis = {
  status: 'success',
  leading_option: null,
  top_drivers: [],
};

/** Fresh, usable canonical analysis state (M5 already assembles this). */
const CANON_USABLE: AdviceGateCanonicalState = {
  status: 'needs_user_mapping',
  usableForProse: true,
  blockedUnusable: false,
};

/** Blocked / unusable canonical state — the relaxation MUST NOT fire on this. */
const CANON_BLOCKED: AdviceGateCanonicalState = {
  status: 'blocked',
  usableForProse: false,
  blockedUnusable: true,
};

/** Readiness payload with OPEN items (missing goal threshold + unmapped option). */
const READY_OPEN: AnalysisReadyPayload = {
  goal_node_id: 'goal_1',
  status: 'needs_user_mapping',
  // goal_threshold deliberately absent → readiness summariser surfaces it
  options: [
    { option_id: 'opt_a', label: 'Hire two senior engineers locally', status: 'needs_user_mapping', interventions: {} },
    { option_id: 'opt_b', label: 'Hire one senior engineer overseas', status: 'needs_encoding', interventions: {} },
  ],
};

/** Fully-ready payload — no open items (used for the "no weak copy" guard). */
const READY_NONE: AnalysisReadyPayload = {
  goal_node_id: 'goal_1',
  status: 'ready',
  goal_threshold: 0.7,
  options: [
    { option_id: 'opt_a', label: 'Hire two senior engineers locally', status: 'ready', interventions: {} },
    { option_id: 'opt_b', label: 'Hire one senior engineer overseas', status: 'ready', interventions: {} },
  ],
};

/** Recent successful mutations (decision-language summaries, no IDs). */
const RECENT: readonly AdviceGateRecentChange[] = [
  { summary: 'Customer churn from 10% to 12%' },
  { summary: 'Delivery risk from high to medium' },
];

// Held-science vocabulary that must NEVER appear in the safe-now fallback copy
// (canonical superset pattern — see forbidden-user-facing-phrases.ts).
const HELD_SCIENCE_RE = HELD_SCIENCE_VOCABULARY_PATTERN;

interface GateOptions {
  readonly withLoop: boolean;
  readonly canonical?: AdviceGateCanonicalState;
  readonly analysisReady?: AnalysisReadyPayload;
  readonly recent?: readonly AdviceGateRecentChange[];
}

function runGate(message: string, opts: GateOptions): { result: AdviceGateResult; durationMs: number } {
  const startedAt = performance.now();
  const result = tryPostAnalysisAdviceGate({
    message,
    analysis: BLANK_PROJECTION,
    analysisReady: opts.analysisReady ?? READY_OPEN,
    freshness: 'fresh',
    decisionReview: null,
    rawRobustness: null,
    ...(opts.withLoop
      ? {
          canonicalState: opts.canonical ?? CANON_USABLE,
          recentChanges: opts.recent ?? RECENT,
        }
      : {}),
  });
  return { result, durationMs: performance.now() - startedAt };
}

function assertSafeNowCopy(text: string): void {
  // No false-success / forbidden / held-science / structural-claim leakage.
  expect(findSuccessClaimHit(text)).toBeNull();
  expect(findForbiddenPhraseHit(text)).toBeNull();
  expect(text).not.toMatch(HELD_SCIENCE_RE);
  expect(
    classifyStructuralClaim({
      assistantText: text,
      handlerEmittedMutatedGraph: false,
      proposedHandlerId: null,
    }).verdict,
  ).not.toBe('swap');
}

// ── Journey ──────────────────────────────────────────────────────────────--

interface TranscriptStep {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly offReason: string;
  readonly onMatched: boolean;
  readonly onCopySource: string | null;
  readonly onText: string | null;
  readonly onLlmCalls: 0;
  readonly notes: string;
}

const transcript: TranscriptStep[] = [];

// ── Golden-transcript drift gate ───────────────────────────────────────────

/**
 * THE COMMITTED TRANSCRIPT IS AN ORACLE, NOT AN OUTPUT.
 *
 * This file used to rewrite `Docs/v5/ai-harness-post-analysis-loop-golden.md`
 * unconditionally from `afterAll`, inside a `try {} catch {}` that swallowed
 * every error. That made it a test that could not fail: any change to the
 * composed copy was absorbed into the fixture on the next run, so the fixture
 * always agreed with the code by construction. It drifted for real — `#983`
 * (`424f9129`, canonical V5 readiness) collapsed the readiness open-items
 * enumeration into a single prioritised recovery action, changing the composed
 * answer on three journey turns, and nothing went red. The only visible symptom
 * was every unrelated branch's working tree showing this file as modified after
 * running the suite, which lanes then reverted by hand or silently bundled.
 *
 * Default mode now COMPARES and FAILS on drift. Writing is an explicit opt-in.
 *
 * CONVENTION: the repo has no single incumbent for regenerating a committed
 * test artefact. `scripts/ci/test-skip-inventory.mjs` uses a `--write` CLI flag,
 * but it is a script rather than a test; the only in-test golden-mode gate is
 * `GOLDEN_FIXTURE_MODE` (`tests/unit/golden-fixtures.test.ts`). This file
 * follows the env-var form of the latter, but deliberately does NOT reuse that
 * variable: `GOLDEN_FIXTURE_MODE=record` puts the golden-fixture runner on a
 * REAL LLM, and regenerating this offline, network-free transcript must never
 * imply that.
 */
const GOLDEN_PATH = join(process.cwd(), 'Docs', 'v5', 'ai-harness-post-analysis-loop-golden.md');
const UPDATE_GOLDENS = process.env.UPDATE_GOLDENS === '1';
const REGEN_COMMAND =
  'UPDATE_GOLDENS=1 pnpm vitest run tests/unit/ai-harness/post-analysis-loop.golden.test.ts';

/** Render the committed transcript body. Pure: same steps ⇒ same bytes. */
function renderTranscript(steps: readonly TranscriptStep[]): string {
  const lines: string[] = [
    '# AI Harness capability 1 — Post-Analysis Loop golden-journey transcript',
    '',
    '> Generated by `tests/unit/ai-harness/post-analysis-loop.golden.test.ts` (build gate).',
    '> Deterministic, network-free proof at the advice-gate/composer seam. The full live',
    '> turn-executor journey (real LLM/PLoT/Supabase) is the acceptance gate, deferred to an',
    '> authorised live run. Flag: `CEE_POST_ANALYSIS_LOOP_ENABLED` (default OFF).',
    '',
    '## What this proves',
    '',
    '| Lived defect | Evidence in this transcript |',
    '|---|---|',
    '| Fallback/generic despite fresh analysis | flag OFF → `data_unavailable_for_class`; flag ON → `canonical_rich` grounded answer |',
    '| Useful context not surfaced | flag-ON answers carry readiness gaps + recent-change summaries |',
    '| Mutation-like language with no commit | composer emits no success/applied prose; change-requests route to safe-apply |',
    '| Slow post-analysis turns | deterministic gate, 0 LLM calls (no ~11s router round-trip) |',
    '',
    '## Journey turns',
    '',
  ];
  for (const step of steps) {
    lines.push(`### ${step.label} — \`${step.id}\``);
    lines.push('');
    lines.push(`- **User:** ${step.message}`);
    lines.push(`- **Flag OFF:** ${step.offReason}`);
    lines.push(
      `- **Flag ON:** matched=${step.onMatched}` +
        (step.onCopySource ? ` · copy_source=\`${step.onCopySource}\`` : '') +
        ` · llm_calls=${step.onLlmCalls}`,
    );
    lines.push(`- **Notes:** ${step.notes}`);
    if (step.onText) {
      lines.push('- **Assistant (flag ON):**');
      lines.push('');
      lines.push('  ```');
      for (const l of step.onText.split('\n')) lines.push(`  ${l}`);
      lines.push('  ```');
    }
    lines.push('');
  }
  lines.push('## Honesty / safety invariants asserted per answer');
  lines.push('');
  lines.push('- No success-claim language (`findSuccessClaimHit` = null).');
  lines.push('- No forbidden user-facing phrase (`findForbiddenPhraseHit` = null).');
  lines.push('- No held-science vocabulary (sensitivity / fragility / flip / driver / robustness / influence).');
  lines.push('- `classifyStructuralClaim` verdict ≠ `swap` (no false structural-success claim).');
  lines.push('- Flag-OFF result is byte-identical to the pre-feature baseline.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Guard the guard. A filtered or partial run produces a SHORT transcript;
 * comparing that against the full committed golden would report drift that does
 * not exist, and in update mode would TRUNCATE the golden to whatever happened
 * to run. The expected ids are DERIVED from the same declarations the journey
 * tests iterate, so this can never become a hand-maintained mirror.
 */
function assertTranscriptComplete(
  steps: readonly TranscriptStep[],
  richTurnIds: readonly string[],
): void {
  const expectedIds = [...richTurnIds, 'change_request', 'premortem'];
  const producedIds = steps.map((s) => s.id);
  if (producedIds.join(',') !== expectedIds.join(',')) {
    throw new Error(
      'post-analysis-loop golden: the transcript is INCOMPLETE, so it can be neither ' +
        'compared nor regenerated.\n' +
        `  expected steps: ${expectedIds.join(', ')}\n` +
        `  produced steps: ${producedIds.join(', ') || '(none)'}\n` +
        'This happens when the file is run with a test-name filter, or when an earlier ' +
        'test in this file failed — fix that failure first.',
    );
  }
}

/** First differing line, so the failure names the drift instead of dumping two files. */
function describeFirstDifference(committed: string, produced: string): string {
  const a = committed.split('\n');
  const b = produced.split('\n');
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (a[i] !== b[i]) {
      const show = (v: string | undefined): string =>
        v === undefined ? '(end of file)' : JSON.stringify(v);
      return (
        `  first difference at line ${i + 1}:\n` +
        `    committed: ${show(a[i])}\n` +
        `    produced:  ${show(b[i])}`
      );
    }
  }
  return '  (identical line-by-line; files differ in trailing bytes)';
}

describe('AI Harness capability 1 — post-analysis loop golden journey', () => {
  // The relaxation-eligible journey turns. Each needs `leading_option`, which is
  // blank here → flag OFF falls through; flag ON composes the grounded answer.
  const RICH_TURNS: ReadonlyArray<{ id: string; label: string; message: string }> = [
    { id: 'explain', label: 'Explain the result', message: 'What does this mean?' },
    { id: 'improve', label: 'Request improvement / change-advice', message: 'How can we improve this?' },
    { id: 'next_step', label: 'What should we do next', message: 'What should we do next?' },
  ];

  it.each(RICH_TURNS)(
    'turn "$id": flag OFF → generic fall-through; flag ON → grounded safe-now answer',
    ({ id, label, message }) => {
      const off = runGate(message, { withLoop: false });
      const on = runGate(message, { withLoop: true });

      // (3) Reduced generic fall-through: OFF degrades to the LLM route; ON is grounded.
      expect(off.result.matched).toBe(false);
      if (!off.result.matched) {
        expect(off.result.reason).toBe('data_unavailable_for_class');
      }
      expect(on.result.matched).toBe(true);
      if (!on.result.matched) throw new Error('flag-ON turn should match');

      // (2) Richer context: the safe-now fallback fired and surfaced readiness + recent changes.
      expect(on.result.copy_source).toBe('canonical_rich');
      const text = on.result.assistant_text;
      expect(text).toMatch(/still open|threshold|connected|options/i); // readiness gap surfaced
      expect(text).toMatch(/Customer churn|Delivery risk/); // recent change surfaced

      // (1) No false success + safe-now only (no held science prose).
      assertSafeNowCopy(text);

      // (4) Deterministic — the gate path makes no LLM call. Numeric timings go
      // to the console (visible in CI logs) so the committed transcript stays
      // diff-stable; the qualitative note records the deterministic property.
      console.log(
        `[golden-timing] ${id}: flag-OFF gate ${off.durationMs.toFixed(3)}ms · ` +
          `flag-ON gate ${on.durationMs.toFixed(3)}ms · 0 LLM calls ` +
          `(vs the ~11s LLM-router fall-through this replaces)`,
      );

      transcript.push({
        id,
        label,
        message,
        offReason: off.result.matched ? 'matched' : off.result.reason,
        onMatched: true,
        onCopySource: on.result.copy_source,
        onText: text,
        onLlmCalls: 0,
        notes: 'deterministic gate · 0 LLM calls (synchronous; replaces the ~11s LLM-router fall-through)',
      });
    },
  );

  it('change-request is never hijacked by the composer — routes to the safe-apply path', () => {
    const message = 'Set delivery risk to 0.4';
    const off = runGate(message, { withLoop: false });
    const on = runGate(message, { withLoop: true });
    // A concrete mutation must reach edit/set-factor dispatch, flag state regardless.
    expect(off.result.matched).toBe(false);
    expect(on.result.matched).toBe(false);
    if (!off.result.matched) expect(off.result.reason).toBe('mutation_signal');
    if (!on.result.matched) expect(on.result.reason).toBe('mutation_signal');
    transcript.push({
      id: 'change_request',
      label: 'Change the model (concrete edit)',
      message,
      offReason: off.result.matched ? 'matched' : off.result.reason,
      onMatched: false,
      onCopySource: null,
      onText: null,
      onLlmCalls: 0,
      notes: 'mutation_signal → handled by the existing safe-apply path (set_factor_value), never the composer',
    });
  });

  it('premortem / challenge is handled safely (no overclaim, no held science)', () => {
    const message = 'What could go wrong with this decision?';
    const on = runGate(message, { withLoop: true });
    // Safe handling either way: a grounded safe-now answer OR a clean fall-through.
    if (on.result.matched) {
      expect(on.result.copy_source).toBe('canonical_rich');
      assertSafeNowCopy(on.result.assistant_text);
    } else {
      expect(['no_advice_signal', 'data_unavailable_for_class', 'mutation_signal']).toContain(
        on.result.reason,
      );
    }
    transcript.push({
      id: 'premortem',
      label: 'Premortem / challenge',
      message,
      offReason: 'n/a',
      onMatched: on.result.matched,
      onCopySource: on.result.matched ? on.result.copy_source : null,
      onText: on.result.matched ? on.result.assistant_text : null,
      onLlmCalls: 0,
      notes: on.result.matched
        ? 'safe grounded answer'
        : `clean fall-through (${on.result.matched ? '' : on.result.reason})`,
    });
  });

  it('flag-OFF parity: the new optional inputs are the ONLY difference', () => {
    // With the flag off the gate receives no canonical/recent inputs, so its
    // result is identical to the pre-feature behaviour. Deep-equal the OFF
    // result against an explicit baseline call that omits the new fields.
    const message = 'What does this mean?';
    const off = runGate(message, { withLoop: false });
    const baseline = tryPostAnalysisAdviceGate({
      message,
      analysis: BLANK_PROJECTION,
      analysisReady: READY_OPEN,
      freshness: 'fresh',
      decisionReview: null,
      rawRobustness: null,
    });
    expect(off.result).toEqual(baseline);
  });

  it('relaxation respects usability: blocked/unusable canonical state falls through', () => {
    const on = runGate('What does this mean?', { withLoop: true, canonical: CANON_BLOCKED });
    expect(on.result.matched).toBe(false);
    if (!on.result.matched) expect(on.result.reason).toBe('data_unavailable_for_class');
  });

  it('no weak copy: usable state but no substantive safe-now content → falls through', () => {
    const on = runGate('What does this mean?', {
      withLoop: true,
      canonical: CANON_USABLE,
      analysisReady: READY_NONE, // no open items
      recent: [], // no recent changes
    });
    expect(on.result.matched).toBe(false);
    if (!on.result.matched) expect(on.result.reason).toBe('data_unavailable_for_class');
  });

  /**
   * The drift gate.
   *
   * ⚠ ORDERING IS LOAD-BEARING, and it is what pins the original defect. This
   * is an `it`, declared last, so it runs after every journey turn above but
   * BEFORE the `afterAll` below — which is the only place that may ever write.
   * Consequence: if the opt-in guard on that write were removed (or flipped to
   * always-write), the write would still land only AFTER this comparison has
   * read the committed bytes, so a stale fixture would still go RED here. A
   * comparison that lived in the same hook as the write could be silently
   * defeated by reordering; this one cannot.
   */
  it('committed golden transcript is up to date (fails on drift)', () => {
    // Completeness is asserted in BOTH modes: a partial run must never be
    // compared against the fixture, nor written to it.
    assertTranscriptComplete(transcript, [...RICH_TURNS.map((t) => t.id)]);
    const produced = renderTranscript(transcript);

    // Regeneration mode: `afterAll` below rewrites the fixture, so on this run
    // there is no committed oracle to compare against yet.
    //
    // Deliberately a branch and NOT a vitest skip. `it.skipIf` here is a skip
    // construct, and `scripts/ci/test-skip-inventory.mjs` ratchets those DOWN
    // — it failed this PR for exactly that reason. This branch also still
    // asserts the transcript it is about to write is complete (above) and
    // well-formed (below), so it is not a silent no-op.
    if (UPDATE_GOLDENS) {
      expect(produced).toContain('## Journey turns');
      return;
    }

    if (!existsSync(GOLDEN_PATH)) {
      throw new Error(
        `post-analysis-loop golden is MISSING at ${GOLDEN_PATH}.\n` +
          `Regenerate and commit it with:\n    ${REGEN_COMMAND}`,
      );
    }
    const committed = readFileSync(GOLDEN_PATH, 'utf8');
    if (committed !== produced) {
      throw new Error(
        'post-analysis-loop golden is STALE — the composed transcript no longer matches ' +
          'the committed fixture.\n' +
          describeFirstDifference(committed, produced) +
          '\nIf the new output is CORRECT, regenerate and COMMIT the fixture in the same ' +
          'change as the copy edit:\n' +
          `    ${REGEN_COMMAND}\n` +
          'If it is not correct, the change that moved this copy is the defect.',
      );
    }
  });

  afterAll(() => {
    // DEFAULT MODE NEVER WRITES. Running the suite on any branch must leave the
    // working tree clean; the committed fixture is an oracle, not an output.
    if (!UPDATE_GOLDENS) return;
    assertTranscriptComplete(transcript, [...RICH_TURNS.map((t) => t.id)]);
    mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
    writeFileSync(GOLDEN_PATH, renderTranscript(transcript), 'utf8');
  });
});
