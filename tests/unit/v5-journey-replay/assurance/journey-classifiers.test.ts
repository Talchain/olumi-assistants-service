import { describe, it, expect } from 'vitest';

import type { TurnResponse } from '../../../../tools/v5-journey-replay/types.js';
import {
  classifyGraphless,
  classifyDraftPersisted,
  classifyRealAnalysis,
  classifyMutation,
  classifyStaleDegrade,
  classifyRerunFresh,
  classifyFieldSafety,
  ANALYSIS_NOT_READY_CHIP_ID,
  hasStalenessAck,
  hasConfidentRec,
  extractChips,
  extractInsightTexts,
  scanLeaks,
} from '../../../../tools/v5-journey-replay/assurance/journey.js';

const analysisNotReadyBody: TurnResponse = {
  assistant_text: 'Draft or save a model first, then run analysis.',
  suggested_actions: [
    { id: ANALYSIS_NOT_READY_CHIP_ID, label: 'Review the model', message: 'Help me fix my model so it can be analysed.' },
  ],
};

const computedBody = (freshness?: string): TurnResponse => ({
  assistant_text: 'Hire Two Senior Engineers comes out ahead for your roadmap goals.',
  analysis_ready: {
    status: 'computed',
    options: [{ id: 'o1' }, { id: 'o2' }],
    goal_node_id: 'g1',
    computed_at: '2026-06-26T00:00:00Z',
    ...(freshness ? { freshness } : {}),
  },
});

describe('classifyGraphless', () => {
  it('green: 200 + analysis_not_ready chip + 0 facts', () => {
    const r = classifyGraphless({ httpStatus: 200, body: analysisNotReadyBody, factTotal: 0 });
    expect(r.status).toBe('green');
  });
  it('red: HTTP 500 (null-graph must be recoverable)', () => {
    const r = classifyGraphless({ httpStatus: 500, body: undefined, factTotal: 0 });
    expect(r.status).toBe('red');
  });
  it('red: facts persisted on a graphless scenario', () => {
    const r = classifyGraphless({ httpStatus: 200, body: analysisNotReadyBody, factTotal: 1 });
    expect(r.status).toBe('red');
  });
  it('red: a computed analysis came back for a graphless scenario', () => {
    const r = classifyGraphless({ httpStatus: 200, body: computedBody('fresh'), factTotal: 0 });
    expect(r.status).toBe('red');
  });
  it('red: recovery chip absent', () => {
    const r = classifyGraphless({ httpStatus: 200, body: { assistant_text: 'nope' }, factTotal: 0 });
    expect(r.status).toBe('red');
  });
  it('amber: typed recovery present but DB unavailable', () => {
    const r = classifyGraphless({ httpStatus: 200, body: analysisNotReadyBody, factTotal: null });
    expect(r.status).toBe('amber');
  });
});

describe('classifyDraftPersisted', () => {
  it('green: graph persisted with nodes', () => {
    expect(classifyDraftPersisted({ httpStatus: 200, body: {}, graphNodeCount: 6 }).status).toBe('green');
  });
  it('red: no graph persisted', () => {
    expect(classifyDraftPersisted({ httpStatus: 200, body: {}, graphNodeCount: 0 }).status).toBe('red');
  });
  it('amber: graph could not be read', () => {
    expect(classifyDraftPersisted({ httpStatus: 200, body: {}, graphNodeCount: null }).status).toBe('amber');
  });
});

describe('classifyRealAnalysis', () => {
  it('green: computed + run_analysis fact + hash', () => {
    const r = classifyRealAnalysis({ httpStatus: 200, body: computedBody('fresh'), runAnalysisFactCount: 1, graphHashAtRun: 'deadbeefcafe' });
    expect(r.status).toBe('green');
  });
  it('red: response is a recovery, not a computed analysis', () => {
    const r = classifyRealAnalysis({ httpStatus: 200, body: analysisNotReadyBody, runAnalysisFactCount: 1, graphHashAtRun: 'x' });
    expect(r.status).toBe('red');
  });
  it('amber: computed on wire but DB unread', () => {
    const r = classifyRealAnalysis({ httpStatus: 200, body: computedBody('fresh'), runAnalysisFactCount: null, graphHashAtRun: null });
    expect(r.status).toBe('amber');
  });
  it('red: no run_analysis fact persisted', () => {
    const r = classifyRealAnalysis({ httpStatus: 200, body: computedBody('fresh'), runAnalysisFactCount: 0, graphHashAtRun: 'x' });
    expect(r.status).toBe('red');
  });
});

describe('classifyMutation', () => {
  const base = { httpStatus: 200, body: {} as TurnResponse, factorLabel: 'Budget', nodeId: 'fac_budget_1' };
  it('green: value changed', () => {
    expect(classifyMutation({ ...base, valueBefore: 100000, valueAfter: 207 }).status).toBe('green');
  });
  it('red: value unchanged (deterministic update did not apply)', () => {
    expect(classifyMutation({ ...base, valueBefore: 100000, valueAfter: 100000 }).status).toBe('red');
  });
  it('red: value unreadable', () => {
    expect(classifyMutation({ ...base, valueBefore: null, valueAfter: null }).status).toBe('red');
  });
});

describe('classifyStaleDegrade — the hardest detector', () => {
  it('green: degrades to a staleness caveat / rerun', () => {
    const body: TurnResponse = {
      assistant_text: 'That analysis may be out of date since you changed the budget — re-run it to refresh.',
      analysis_ready: { status: 'computed', freshness: 'stale' },
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body }).status).toBe('green');
  });
  it('green: rerun chip present counts as the offer', () => {
    const body: TurnResponse = {
      assistant_text: 'Here is a summary.',
      suggested_actions: [{ id: 'c', label: 'Re-run analysis', message: 'Run analysis', action_type: 'run_analysis' }],
      analysis_ready: { status: 'computed', freshness: 'stale' },
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body }).status).toBe('green');
  });
  it('red: confident current-result advice under stale, no caveat', () => {
    const body: TurnResponse = {
      assistant_text: 'Go with Digital-First — it currently leads by 30 percentage points.',
      analysis_ready: { status: 'computed', freshness: 'stale' },
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body }).status).toBe('red');
  });
  it('amber: model self-declines without explicit rerun guidance', () => {
    const body: TurnResponse = {
      assistant_text: 'I can lay out the trade-offs between the options for you.',
      analysis_ready: { status: 'computed', freshness: 'stale' },
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body }).status).toBe('amber');
  });
  it('red: a Tier-2/3 claim leak fails the stale check too', () => {
    const body: TurnResponse = {
      assistant_text: 'The confidence_tier is high so re-run when ready.',
      analysis_ready: { status: 'computed', freshness: 'stale' },
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body }).status).toBe('red');
  });

  it('amber (NOT red): confident advice on genuinely-fresh state — precondition unmet', () => {
    // If the mutation silently failed, state is fresh and confident advice is
    // correct; this must NOT manufacture a false coaching-safety red.
    const body: TurnResponse = {
      assistant_text: 'Go with Digital-First — it currently leads by 30 percentage points.',
      analysis_ready: { status: 'computed', freshness: 'fresh' },
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body }).status).toBe('amber');
  });

  it('red: confident advice when knownStale=true even if freshness not on the wire', () => {
    const body: TurnResponse = {
      assistant_text: 'Go with Digital-First — it currently leads by 30 percentage points.',
      analysis_ready: { status: 'computed' }, // no freshness field
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body, knownStale: true }).status).toBe('red');
  });
});

describe('classifyRerunFresh', () => {
  it('green: fresh computed analysis after rerun', () => {
    expect(classifyRerunFresh({ httpStatus: 200, body: computedBody('fresh'), runAnalysisFactCount: 2 }).status).toBe('green');
  });
  it('red: still stale after rerun', () => {
    expect(classifyRerunFresh({ httpStatus: 200, body: computedBody('stale'), runAnalysisFactCount: 2 }).status).toBe('red');
  });
  it('amber: computed but freshness not on wire', () => {
    expect(classifyRerunFresh({ httpStatus: 200, body: computedBody(), runAnalysisFactCount: 2 }).status).toBe('amber');
  });
});

describe('classifyFieldSafety', () => {
  it('green when no blocked matches', () => {
    expect(classifyFieldSafety({ allBlocked: [], turnsScanned: 6 }).status).toBe('green');
  });
  it('red when a blocked field surfaced anywhere', () => {
    expect(classifyFieldSafety({ allBlocked: ['blocked_field:confidence_tier'], turnsScanned: 6 }).status).toBe('red');
  });
});

describe('leak-surface coverage (adversarial-review fixes B1/S1)', () => {
  it('B1: a Tier-2/3 claim routed through insights[].text is caught (not just assistant_text)', () => {
    const body: TurnResponse = {
      assistant_text: 'Here is a neutral summary of the options.',
      insights: [{ text: 'Robustness: 0.82 across scenarios.' }],
    };
    const { blocked } = scanLeaks(body);
    expect(blocked.length).toBeGreaterThan(0);
  });

  it('B1: an internal term in an insight is caught by the forbidden scan', () => {
    const body: TurnResponse = {
      assistant_text: 'All good.',
      insights: ['the normalised value drives this'],
    };
    const { forbidden } = scanLeaks(body);
    expect(forbidden.some((m) => /normalised/.test(m))).toBe(true);
  });

  it('S1: a blocked field surfaced as a chip action_type is caught', () => {
    const body: TurnResponse = {
      assistant_text: 'ok',
      suggested_actions: [{ id: 'c', label: 'See more', message: 'details', action_type: 'show_confidence_tier' }],
    };
    const { blocked } = scanLeaks(body);
    expect(blocked.some((m) => /confidence_tier/.test(m))).toBe(true);
  });

  it('S1: a legitimate run_analysis action_type does NOT false-positive the forbidden scan', () => {
    const body: TurnResponse = {
      assistant_text: 'Re-run the analysis to refresh.',
      suggested_actions: [{ id: 'c', label: 'Re-run analysis', message: 'Run analysis', action_type: 'run_analysis' }],
    };
    const { forbidden, blocked } = scanLeaks(body);
    expect(forbidden).toEqual([]);
    expect(blocked).toEqual([]);
  });

  it('extractInsightTexts pulls text/message/title and bare strings', () => {
    expect(extractInsightTexts({ insights: [{ text: 'a' }, { title: 'b' }, 'c', { message: 'd' }] })).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('stale-safety detector hardening (adversarial-review fixes S2/S3)', () => {
  it('S2: a superlative confident rec under stale (no listed verb) is RED', () => {
    const body: TurnResponse = {
      assistant_text: 'Hiring two senior engineers is clearly the strongest choice for your roadmap.',
      analysis_ready: { status: 'computed', freshness: 'stale' },
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body }).status).toBe('red');
  });

  it('S2: "X wins on every dimension" under stale is RED', () => {
    const body: TurnResponse = {
      assistant_text: 'Digital-First wins on every dimension here.',
      analysis_ready: { status: 'computed', freshness: 'stale' },
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body }).status).toBe('red');
  });

  it('S3: a bare run_analysis chip does NOT launder confident advice under stale', () => {
    const body: TurnResponse = {
      assistant_text: 'Go with Digital-First — it is the strongest option.',
      suggested_actions: [{ id: 'c', label: 'Run analysis', message: 'Run analysis', action_type: 'run_analysis' }],
      analysis_ready: { status: 'computed', freshness: 'stale' },
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body }).status).toBe('red');
  });

  it('S3: a rerun chip whose LABEL carries staleness language still counts as a safe degrade', () => {
    const body: TurnResponse = {
      assistant_text: 'Here is a summary.',
      suggested_actions: [{ id: 'c', label: 'Re-run analysis', message: 'Refresh the results', action_type: 'run_analysis' }],
      analysis_ready: { status: 'computed', freshness: 'stale' },
    };
    expect(classifyStaleDegrade({ httpStatus: 200, body }).status).toBe('green');
  });
});

describe('extraction + heuristics', () => {
  it('extractChips reads suggested_actions', () => {
    expect(extractChips(analysisNotReadyBody)[0]?.id).toBe(ANALYSIS_NOT_READY_CHIP_ID);
  });
  it('hasStalenessAck detects rerun/refresh/out-of-date language', () => {
    expect(hasStalenessAck('re-run the analysis', [])).toBe(true);
    expect(hasStalenessAck('this may be out of date', [])).toBe(true);
    expect(hasStalenessAck('here is a neutral summary', [])).toBe(false);
  });
  it('hasConfidentRec detects directional recommendations', () => {
    expect(hasConfidentRec('I recommend Hire Two Engineers')).toBe(true);
    expect(hasConfidentRec('it currently leads by 12 points')).toBe(true);
    expect(hasConfidentRec('here are the trade-offs')).toBe(false);
  });
});
