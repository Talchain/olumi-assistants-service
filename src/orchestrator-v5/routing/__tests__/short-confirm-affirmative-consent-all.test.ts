/**
 * POC-BOARD 5d — NL multi-hold "confirm all" commits nothing (Step-0
 * trust-spine evidence 2026-07-17, capture T11): with TWO proposals held,
 * "Yes, all of them." matched neither SHORT_CONFIRM_PATTERN (the second
 * token "all…" is not in its alternation) nor CONSENT_RESOLVE_ALL_PATTERN
 * (which, unlike SHORT_CONFIRM's P1a fix, had no leading-affirmative
 * prefix), fell to the LLM router, and minted a false "that covers both
 * changes I'm holding" acknowledgement while the committed graph stayed
 * byte-unchanged. Chip-confirm (T11b) and single-pending bare "yes" (T4)
 * worked — only the affirmative-prefixed collective form was dead.
 *
 * Fix pinned here: CONSENT_RESOLVE_ALL_PATTERN accepts the SAME optional
 * leading affirmative SHORT_CONFIRM_PATTERN gained in P1a ("Yes, all of
 * them." / "yeah, apply both"), so the resumer returns `consent_all` and
 * the executor's honest paths own the turn (GM-live atomic apply via
 * commitGmHeldResumeAll, else the numbered one-at-a-time listing — never
 * an unfounded success claim).
 *
 * The ratified exclusions HOLD: bare "both" / "all" stay unbound (they
 * routinely answer unrelated questions), and any substantive trailing
 * content disqualifies the match.
 */
import { describe, it, expect } from 'vitest';

import {
  CONSENT_RESOLVE_ALL_PATTERN,
  tryShortConfirmResume,
} from '../deterministic-short-confirm.js';
import type { PendingAction } from '../../session/pending-action.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW_MS = Date.parse('2026-07-20T12:00:00.000Z');

function makeApplyProposedPending(n: number): PendingAction {
  const ref = `prop_bbbbbbbbbbb${n}`;
  return {
    id: `pa-apply-${n}`,
    scenario_id: SCENARIO_ID,
    chip_id: ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: 'set_factor_value',
        params: { value: n },
        target_entity_ids: [`fac-${n}`],
      },
      public_label: `Held change ${n}`,
      public_message: `Apply held change ${n}.`,
    },
    preconditions: { graph_hash: 'h_base' },
    expires_at_turn_count: 2,
    expires_at_iso: '2026-07-20T12:10:00.000Z',
    emitted_at_iso: `2026-07-20T11:5${n}:00.000Z`,
  } as PendingAction;
}

function resume(message: string, pendingActions: readonly PendingAction[]) {
  return tryShortConfirmResume({
    message,
    pendingActions,
    currentTurnIndex: 5,
    nowMs: NOW_MS,
  });
}

describe('CONSENT_RESOLVE_ALL_PATTERN — affirmative-prefixed collective confirms (5d / T11)', () => {
  it.each([
    'Yes, all of them.', // the exact Step-0 T11 capture
    'yes all of them',
    'Yeah, apply both.',
    'Yes, both of them.',
    'ok, all of those please',
    'Sure, apply them all.',
  ])('matches %j', (message) => {
    expect(CONSENT_RESOLVE_ALL_PATTERN.test(message)).toBe(true);
  });

  it.each([
    'both', // ratified exclusion: bare collective stays unbound
    'all',
    'do all',
    'Yes, all of the numbers.', // substantive content disqualifies
    'Yes, all of them, and add a new risk.', // trailing request disqualifies
    'Yes.', // a bare confirm is SHORT_CONFIRM territory, not consent-all
  ])('does NOT match %j', (message) => {
    expect(CONSENT_RESOLVE_ALL_PATTERN.test(message)).toBe(false);
  });
});

describe('tryShortConfirmResume — "Yes, all of them." with live holds (5d / T11)', () => {
  it('two live holds → consent_all carrying BOTH candidates (never the LLM)', () => {
    const holds = [makeApplyProposedPending(1), makeApplyProposedPending(2)];
    const dispatch = resume('Yes, all of them.', holds);
    expect(dispatch.matched).toBe(true);
    if (!dispatch.matched) return;
    expect(dispatch.dispatch).toBe('consent_all');
    if (dispatch.dispatch !== 'consent_all') return;
    expect(dispatch.candidates).toHaveLength(2);
  });

  it('one live hold → resolves that hold directly', () => {
    const dispatch = resume('Yes, all of them.', [makeApplyProposedPending(1)]);
    expect(dispatch.matched).toBe(true);
    if (!dispatch.matched) return;
    expect(dispatch.dispatch).toBe('pending_action');
  });

  it('no pendings → falls through untouched (no phantom consent)', () => {
    const dispatch = resume('Yes, all of them.', []);
    expect(dispatch.matched).toBe(false);
  });

  it('regression pin: bare "both" with two live holds still falls through to the LLM', () => {
    const holds = [makeApplyProposedPending(1), makeApplyProposedPending(2)];
    const dispatch = resume('both', holds);
    expect(dispatch.matched).toBe(false);
  });
});
