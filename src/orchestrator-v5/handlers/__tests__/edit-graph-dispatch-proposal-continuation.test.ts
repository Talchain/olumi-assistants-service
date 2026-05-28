import { describe, expect, it } from 'vitest';

import { decideNoOpRecovery } from '../edit-graph-dispatch.js';
import {
  buildProposalPendingAction,
  extractProposedConcept,
  findProposedConceptAction,
} from '../../coaching/proposal-continuation.js';
import { parsePendingAction } from '../../session/pending-action.js';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { PendingAction } from '../../session/pending-action.js';

const NO_FACTS: readonly HandlerFact[] = [];

const PENDING_TEAM_MORALE = {
  concept: 'team morale or cultural fit',
  preferred_kind: 'factor' as const,
};

describe('decideNoOpRecovery — proposal-continuation branches', () => {
  it('emits proposal_stage_one on agreement when pending is present', () => {
    const r = decideNoOpRecovery({
      message: "That's a good idea. Let's involve the team in the hiring process.",
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING_TEAM_MORALE,
    });
    expect(r.branch).toBe('proposal_stage_one');
    expect(r.assistantText).not.toBeNull();
    expect(r.assistantText).toContain('team morale or cultural fit');
    expect(r.suggestedActions).toHaveLength(3);
    expect(r.suggestedActions.map((a) => a.label)).toEqual([
      'Add as risk',
      'Add as factor',
      'Keep as note',
    ]);
    expect(r.assistantText).not.toContain('factor or edge');
  });

  it('emits proposal_stage_two on add-as-factor intent when pending is present', () => {
    const r = decideNoOpRecovery({
      message: 'Add team morale as a factor.',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING_TEAM_MORALE,
      nodes: [
        { label: 'Delivery speed' },
        { label: 'Code quality' },
      ],
    });
    expect(r.branch).toBe('proposal_stage_two');
    expect(r.assistantText).toContain('Before I add team morale or cultural fit');
    expect(r.suggestedActions).toHaveLength(2);
    expect(r.suggestedActions[0]?.message).toContain('Delivery speed');
  });

  it('falls back to free-text prompt when graph has no usable labels', () => {
    const r = decideNoOpRecovery({
      message: 'Add team morale as a factor.',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING_TEAM_MORALE,
      nodes: [],
    });
    expect(r.branch).toBe('proposal_stage_two');
    expect(r.suggestedActions).toHaveLength(0);
    expect(r.assistantText).toContain('Tell me which outcome or factor');
  });

  it('stage_two takes precedence over stage_one when both match', () => {
    const r = decideNoOpRecovery({
      message: "Yes, let's add team morale as a factor.",
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING_TEAM_MORALE,
      nodes: [{ label: 'Delivery speed' }],
    });
    expect(r.branch).toBe('proposal_stage_two');
  });

  it('falls back to vague_edit when pending is null and message is a vague edit', () => {
    const r = decideNoOpRecovery({
      message: 'Let me change it.',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: null,
    });
    expect(r.branch).toBe('vague_edit');
  });

  it('falls back to vague_edit when pending is present but message is neither agreement nor add-as-factor', () => {
    const r = decideNoOpRecovery({
      message: 'Adjust it.',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING_TEAM_MORALE,
    });
    expect(r.branch).toBe('vague_edit');
  });

  it('does NOT override analytical/explore branches when message is not agreement or add-as-factor', () => {
    // Analytical phrasing does not match agreement or add-as-factor, so
    // the proposal ladder must not take precedence here. The branch
    // taken depends on freshness + prior facts, but it MUST NOT be
    // proposal_stage_one / _two.
    const r = decideNoOpRecovery({
      message: 'Walk me through the analysis.',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING_TEAM_MORALE,
    });
    expect(r.branch).not.toBe('proposal_stage_one');
    expect(r.branch).not.toBe('proposal_stage_two');
  });

  it('does not emit forbidden user-facing vocabulary in stage_one copy', () => {
    const r = decideNoOpRecovery({
      message: 'Yes.',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING_TEAM_MORALE,
    });
    expect(r.branch).toBe('proposal_stage_one');
    const text = r.assistantText ?? '';
    expect(text).not.toMatch(/factor or edge/i);
    expect(text).not.toMatch(/\bnode\b/i);
    expect(text).not.toMatch(/\bedge\b/i);
    expect(text).not.toMatch(/\bgraph\b/i);
    expect(text).not.toMatch(/\bschema\b/i);
    expect(text).not.toMatch(/\bvalidator\b/i);
    expect(text).not.toMatch(/\bpatch\b/i);
  });

  it('does not emit forbidden user-facing vocabulary in stage_two copy', () => {
    const r = decideNoOpRecovery({
      message: 'Add team morale as a factor.',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING_TEAM_MORALE,
      nodes: [{ label: 'Delivery speed' }],
    });
    expect(r.branch).toBe('proposal_stage_two');
    const text = r.assistantText ?? '';
    expect(text).not.toMatch(/factor or edge/i);
    expect(text).not.toMatch(/\bnode\b/i);
    expect(text).not.toMatch(/\bedge\b/i);
    expect(text).not.toMatch(/\bgraph\b/i);
    expect(text).not.toMatch(/\bschema\b/i);
    expect(text).not.toMatch(/\bvalidator\b/i);
    expect(text).not.toMatch(/\bpatch\b/i);
  });

  it('does not intercept already-disambiguated "as a factor affecting X" messages', () => {
    const r = decideNoOpRecovery({
      message: 'Add team morale as a factor affecting delivery speed.',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING_TEAM_MORALE,
    });
    // The message has a concrete mutation signal (delivery speed) so
    // it should NOT be intercepted by Stage 2; it falls through to the
    // existing edit_graph routing. The closest deterministic branch
    // here is ambiguous (mutation signal present + no analytical intent).
    expect(r.branch).not.toBe('proposal_stage_two');
    expect(r.branch).not.toBe('proposal_stage_one');
  });

  it('exact failing transcript: proposal-then-agreement emits stage_one with team morale concept', () => {
    // Transcript from the failing staging smoke:
    //   prior assistant: "...add team morale or cultural fit as a
    //                    factor… Would you like me to add that?"
    //   current user:    "That's a good idea. Let's involve the team
    //                    in the hiring process. For that risk, how
    //                    should we update the decision model?"
    // Expected: deterministic 3-chip stage_one continuation, NOT vague_edit.
    const r = decideNoOpRecovery({
      message:
        "That's a good idea. Let's involve the team in the hiring process. "
        + 'For that risk, how should we update the decision model?',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: PENDING_TEAM_MORALE,
    });
    expect(r.branch).toBe('proposal_stage_one');
    expect(r.suggestedActions).toHaveLength(3);
    expect(r.assistantText).not.toContain('factor or edge');
    expect(r.assistantText).toContain('team morale or cultural fit');
  });
});

describe('decideNoOpRecovery — emit-to-resume round-trip', () => {
  it('round-trips: Sonnet emit → parsePendingAction → decideNoOpRecovery resume on the failing transcript', () => {
    // Step 1 — Sonnet emits proposal text. Emit-time extractor captures
    // the concept noun-phrase (mirrors what turn-executor.ts does).
    const sonnetText =
      'The most useful next step would be to add team morale or '
      + 'cultural fit as a factor. Would you like me to add that?';
    const proposed = extractProposedConcept(sonnetText);
    expect(proposed).not.toBeNull();
    expect(proposed!.concept).toBe('team morale or cultural fit');
    expect(proposed!.preferred_kind).toBe('factor');

    // Step 2 — emit-time hook builds a PendingAction; the same value
    // would be persisted as JSONB on v5_conversation_turns.pending_actions.
    const persisted = buildProposalPendingAction({
      concept: proposed!.concept,
      preferred_kind: proposed!.preferred_kind,
      scenario_id: '11111111-1111-1111-1111-111111111111',
      emitted_at_iso: '2026-05-28T10:00:00.000Z',
      graph_hash: 'h_at_emit',
    });

    // Step 3 — next-turn read goes through parsePendingAction (drops
    // entries that fail validation). The well-formed entry survives.
    const parsedRaw = parsePendingAction(persisted as unknown);
    expect(parsedRaw).not.toBeNull();
    const reread = parsedRaw as PendingAction;

    // Step 4 — resume hook looks up the proposed concept from the
    // most-recent pending actions and feeds it into decideNoOpRecovery.
    const pending = findProposedConceptAction([reread]);
    expect(pending).not.toBeNull();

    const r = decideNoOpRecovery({
      message:
        "That's a good idea. Let's involve the team in the hiring process. "
        + 'For that risk, how should we update the decision model?',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: pending,
    });
    expect(r.branch).toBe('proposal_stage_one');
    expect(r.assistantText).toContain('team morale or cultural fit');
    expect(r.suggestedActions.map((a) => a.label)).toEqual([
      'Add as risk',
      'Add as factor',
      'Keep as note',
    ]);
  });

  it('round-trips: agreement → Stage 1 → "Add as factor" chip click → Stage 2 with affect chips', () => {
    // Walk the user through the full three-stage flow.
    const persisted = buildProposalPendingAction({
      concept: 'team morale or cultural fit',
      preferred_kind: 'factor',
      scenario_id: '11111111-1111-1111-1111-111111111111',
      emitted_at_iso: '2026-05-28T10:00:00.000Z',
      graph_hash: 'h1',
    });

    // Stage 1 — user agrees.
    const stage1 = decideNoOpRecovery({
      message: 'Yes.',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: findProposedConceptAction([persisted]),
    });
    expect(stage1.branch).toBe('proposal_stage_one');

    // Stage 2 — user clicks "Add as factor" chip (or types it).
    const stage2 = decideNoOpRecovery({
      message: 'Add team morale or cultural fit as a factor.',
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
      pendingProposedConcept: findProposedConceptAction([persisted]),
      nodes: [
        { label: 'Delivery speed', kind: 'goal' },
        { label: 'Code quality', kind: 'goal' },
        { label: 'Cost', kind: 'outcome' },
      ],
    });
    expect(stage2.branch).toBe('proposal_stage_two');
    expect(stage2.suggestedActions).toHaveLength(3);
    expect(stage2.suggestedActions[0]?.message).toContain('Delivery speed');
  });
});
