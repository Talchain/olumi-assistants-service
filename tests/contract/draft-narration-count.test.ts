/**
 * V5 draft narration count guard — contract tests.
 *
 * Brief brief-display-safe-analysis A2 tightened the contract: users
 * don't think in graph terms, so any node/edge-count wording in the
 * narration — matched OR mismatched — is replaced by the
 * decision-language fallback.
 *
 * Telemetry stays split:
 *   - `DraftNarrationCountMismatch` fires only on real mismatches
 *     (preserves the original ops-dashboard semantic).
 *   - `DraftNarrationCountSuppressed` fires when the counts match but
 *     the wording itself is being scrubbed.
 * No turn fires both.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkDraftNarrationCounts,
  type NarrationCountCheckResult,
} from '../../src/orchestrator-v5/handlers/narration-count-guard.js';
import { setTestSink } from '../../src/utils/telemetry.js';

type Event = { event: string; data: Record<string, unknown> };

let events: Event[] = [];
beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});
afterEach(() => {
  setTestSink(null);
});

function mismatchEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.draft_narration.count_mismatch');
}

function suppressedEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.draft_narration.count_suppressed');
}

// Brief A2: the fallback the dispatcher passes is now the
// decision-language summary. The guard does not introspect it; these
// tests use a representative decision-language fallback so failure
// messages read meaningfully.
const FALLBACK = 'Your decision model is ready with 7 options and 8 factors to explore.';

function check(narration: string | undefined, finalNodeCount = 7, finalEdgeCount = 8): NarrationCountCheckResult {
  return checkDraftNarrationCounts({
    narration,
    finalNodeCount,
    finalEdgeCount,
    fallback: FALLBACK,
    requestId: 'req-test',
  });
}

describe('checkDraftNarrationCounts — pass-through cases', () => {
  it('uses fallback when narration is undefined', () => {
    const res = check(undefined);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.mismatchDetected).toBe(false);
    expect(res.wordingSuppressed).toBe(false);
    expect(mismatchEvent()).toBeUndefined();
    expect(suppressedEvent()).toBeUndefined();
  });

  it('uses fallback when narration is empty', () => {
    const res = check('');
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.mismatchDetected).toBe(false);
    expect(res.wordingSuppressed).toBe(false);
  });

  it('preserves narration with no explicit counts (qualitative prose)', () => {
    const narration = 'Drafted a decision graph capturing your hiring options.';
    const res = check(narration);
    expect(res.chosenText).toBe(narration);
    expect(res.mismatchDetected).toBe(false);
    expect(res.wordingSuppressed).toBe(false);
    expect(mismatchEvent()).toBeUndefined();
    expect(suppressedEvent()).toBeUndefined();
  });
});

describe('checkDraftNarrationCounts — count wording always suppressed (brief A2)', () => {
  it('matched counts: narration agreeing with final graph is REPLACED by fallback, fires Suppressed event only', () => {
    const narration = 'Drafted a decision graph with 7 nodes and 8 edges.';
    const res = check(narration, 7, 8);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.mismatchDetected).toBe(false);
    expect(res.wordingSuppressed).toBe(true);
    expect(mismatchEvent()).toBeUndefined();
    const ev = suppressedEvent();
    expect(ev).toBeDefined();
    expect(ev!.data).toMatchObject({
      request_id: 'req-test',
      final_node_count: 7,
      final_edge_count: 8,
      narration_node_count: 7,
      narration_edge_count: 8,
    });
  });

  it('singular forms with matched counts are still suppressed', () => {
    const narration = 'Drafted a single 1 node and 1 edge starter graph.';
    const res = check(narration, 1, 1);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.wordingSuppressed).toBe(true);
    expect(suppressedEvent()).toBeDefined();
    expect(mismatchEvent()).toBeUndefined();
  });

  it('markdown-bolded matched counts are still suppressed', () => {
    const narration = 'Drafted a decision graph with **7** nodes and **8** edges.';
    const res = check(narration, 7, 8);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.wordingSuppressed).toBe(true);
    expect(suppressedEvent()).toBeDefined();
    expect(mismatchEvent()).toBeUndefined();
  });

  it('single-asterisk emphasis (*N*) on matched counts is still suppressed', () => {
    const narration = 'Drafted a decision graph with *7* nodes and *8* edges.';
    const res = check(narration, 7, 8);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.wordingSuppressed).toBe(true);
    expect(suppressedEvent()).toBeDefined();
    expect(mismatchEvent()).toBeUndefined();
  });
});

describe('checkDraftNarrationCounts — mismatch detection', () => {
  it('the brief reproduction: narration says 3 nodes / 2 edges, graph has 7 / 8 → fallback + mismatch event', () => {
    const narration = 'Drafted a decision graph with 3 nodes and 2 edges.';
    const res = check(narration, 7, 8);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.mismatchDetected).toBe(true);
    expect(res.wordingSuppressed).toBe(true);
    const ev = mismatchEvent();
    expect(ev).toBeDefined();
    expect(ev!.data).toMatchObject({
      request_id: 'req-test',
      final_node_count: 7,
      final_edge_count: 8,
      narration_node_count: 3,
      narration_edge_count: 2,
    });
    // Must NOT also fire the suppressed event — they are mutually
    // exclusive so ops dashboards stay clean.
    expect(suppressedEvent()).toBeUndefined();
  });

  it('detects edge mismatch alone (node count agrees)', () => {
    const narration = 'Drafted a decision graph with 7 nodes and 12 edges.';
    const res = check(narration, 7, 8);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.mismatchDetected).toBe(true);
    expect(mismatchEvent()!.data).toMatchObject({
      narration_node_count: 7,
      narration_edge_count: 12,
    });
    expect(suppressedEvent()).toBeUndefined();
  });

  it('detects node mismatch alone (edge count agrees)', () => {
    const narration = 'Drafted a decision graph with 12 nodes and 8 edges.';
    const res = check(narration, 7, 8);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.mismatchDetected).toBe(true);
    expect(suppressedEvent()).toBeUndefined();
  });

  it('mismatch when narration mentions node count but final has more', () => {
    const narration = 'A small graph with 2 nodes captures the gist.';
    const res = check(narration, 7, 8);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.mismatchDetected).toBe(true);
    expect(mismatchEvent()!.data).toMatchObject({
      narration_node_count: 2,
      narration_edge_count: null,
    });
    expect(suppressedEvent()).toBeUndefined();
  });
});

describe('checkDraftNarrationCounts — keyword-based suppression (brief A2)', () => {
  it('suppresses word-numeral count wording ("seven nodes and eight edges")', () => {
    const narration = 'Drafted a graph with seven nodes and eight edges.';
    const res = check(narration, 7, 8);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.wordingSuppressed).toBe(true);
    // No digit counts parseable → mismatchDetected stays false → only
    // the Suppressed event fires.
    expect(res.mismatchDetected).toBe(false);
    const ev = suppressedEvent();
    expect(ev).toBeDefined();
    expect(ev!.data).toMatchObject({
      narration_node_count: null,
      narration_edge_count: null,
    });
    expect(mismatchEvent()).toBeUndefined();
  });

  it('suppresses K-suffixed count wording ("5K nodes")', () => {
    const narration = 'A graph with 5K nodes — far too dense.';
    const res = check(narration, 7, 8);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.wordingSuppressed).toBe(true);
    expect(res.mismatchDetected).toBe(false);
    expect(suppressedEvent()).toBeDefined();
    expect(mismatchEvent()).toBeUndefined();
  });

  it('suppresses bare keyword wording with no number ("the nodes capture each step")', () => {
    const narration = 'The nodes capture each step of the decision.';
    const res = check(narration, 7, 8);
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.wordingSuppressed).toBe(true);
    expect(res.mismatchDetected).toBe(false);
    expect(suppressedEvent()).toBeDefined();
  });

  it('matches first digit occurrence for mismatch classification', () => {
    const narration = 'Initially 3 nodes, but the final graph has 7 nodes and 8 edges.';
    const res = check(narration, 7, 8);
    // First "3 nodes" disagrees with final 7 → mismatch event fires
    // (not the suppressed event), text replaced.
    expect(res.chosenText).toBe(FALLBACK);
    expect(res.mismatchDetected).toBe(true);
    expect(res.wordingSuppressed).toBe(true);
    expect(mismatchEvent()!.data).toMatchObject({
      narration_node_count: 3,
    });
    expect(suppressedEvent()).toBeUndefined();
  });
});
