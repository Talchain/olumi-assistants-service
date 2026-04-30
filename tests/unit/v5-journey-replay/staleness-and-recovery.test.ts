import { describe, expect, it } from 'vitest';

import {
  STALENESS_PREFIX,
  assertAssistDraftGraph,
  assertExplainLeaderRecovery,
  assertStaleExplanation,
  type CapturedRerunChip,
} from '../../../tools/v5-journey-replay/assertions.js';
import type { FetchResult } from '../../../tools/v5-journey-replay/client.js';

function ok(body: unknown, status = 200): FetchResult {
  return { status, body: body as never, elapsed_ms: 10 };
}

const SUBSTANTIVE_STALE_TEXT =
  STALENESS_PREFIX +
  ' Option A leads with 0.62 likelihood, driven primarily by the runway-extension factor. The ' +
  'runner-up is option B at 0.31, hampered by hiring lag.';

const RERUN_CHIP = {
  id: 'chip_action_rerun_analysis',
  label: 'Run the analysis',
  message: 'Run the analysis',
  action_type: 'run_analysis',
};

describe('assertStaleExplanation — step 7', () => {
  it('passes when text starts with staleness prefix and exactly one rerun chip is present', () => {
    const result = assertStaleExplanation(
      ok({ assistant_text: SUBSTANTIVE_STALE_TEXT, suggested_actions: [RERUN_CHIP] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.captured?.rerunChip).toEqual<CapturedRerunChip>({
        id: RERUN_CHIP.id,
        label: RERUN_CHIP.label,
        message: RERUN_CHIP.message,
        action_type: 'run_analysis',
      });
      expect(result.features_observed).toContain('staleness_prefix');
      expect(result.features_observed).toContain('rerun_chip');
    }
  });

  it('passes when chip label differs from "Rerun analysis" — action_type is the contract', () => {
    const altLabel = { ...RERUN_CHIP, label: 'Rerun analysis' };
    const result = assertStaleExplanation(
      ok({ assistant_text: SUBSTANTIVE_STALE_TEXT, suggested_actions: [altLabel] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.captured?.rerunChip).toMatchObject({ label: 'Rerun analysis' });
    }
  });

  it('fails when staleness prefix is absent', () => {
    const result = assertStaleExplanation(
      ok({ assistant_text: 'Option A leads with 0.62.', suggested_actions: [RERUN_CHIP] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toBe('step_7_missing_staleness_prefix');
  });

  it('fails when zero rerun chips are present', () => {
    const result = assertStaleExplanation(
      ok({ assistant_text: SUBSTANTIVE_STALE_TEXT, suggested_actions: [] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toBe('step_7_missing_rerun_chip');
  });

  it('fails when more than one rerun chip is present', () => {
    const result = assertStaleExplanation(
      ok({ assistant_text: SUBSTANTIVE_STALE_TEXT, suggested_actions: [RERUN_CHIP, RERUN_CHIP] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toBe('step_7_duplicate_rerun_chips');
  });

  it('fails when stale text is too short (substance gate still applies)', () => {
    const shortText = STALENESS_PREFIX + ' A wins.';
    const result = assertStaleExplanation(
      ok({ assistant_text: shortText, suggested_actions: [RERUN_CHIP] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toBe('step_7_text_too_short');
  });

  it('fails when entity ids leak into stale text (caught by legacy or path-aware scanner)', () => {
    const text = STALENESS_PREFIX + ' opt_hire_local leads with 0.62 over the runner-up at 0.31. The driver factor analysis indicates persistence beyond the trial period.';
    const result = assertStaleExplanation(
      ok({ assistant_text: text, suggested_actions: [RERUN_CHIP] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Legacy `coreAssertions` (forbidden-terms.ts) fires first on
      // `opt_hire` so the failing_contract is the legacy one. Both
      // contract names are acceptable — the spirit is "leak detected".
      expect(
        result.failing_contract === 'step_7_entity_id_leak' ||
          result.failing_contract.startsWith('forbidden terms in assistant_text'),
      ).toBe(true);
    }
  });

  it('flags entity-id leaks via the path-aware scanner when legacy regex misses (factor_/decision_ form)', () => {
    // The legacy forbidden-terms.ts regex covers only short prefixes
    // (`opt|fac|goal|risk|out`). The path-aware scanner additionally
    // catches the full-word forms (factor_/option_/decision_/...).
    const text = STALENESS_PREFIX + ' constraint_budget_cap shapes the runway story heavily, and constraint_team_size further bounds the option set during the next eight weeks.';
    const result = assertStaleExplanation(
      ok({ assistant_text: text, suggested_actions: [RERUN_CHIP] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failing_contract).toBe('step_7_entity_id_leak');
    }
  });
});

describe('assertExplainLeaderRecovery', () => {
  it('passes on canonical LLM_TIMEOUT recovery shape', () => {
    const body = {
      assistant_text: 'That took longer than usual.',
      blocks: [{ type: 'error', error_code: 'UPSTREAM_TIMEOUT', severity: 'error' }],
      suggested_actions: [{ id: 'chip_prompt_retry', label: 'Try again', message: 'Why does the leading option win?' }],
    };
    const result = assertExplainLeaderRecovery(ok(body, 500));
    expect(result.ok).toBe(true);
  });

  it('passes on BoundaryError shape with chip and friendly text', () => {
    const body = {
      error: 'INTERNAL_ERROR',
      boundary: 'commit',
      validator: 'turn_commit',
      details: { retryable: true, reason: 'chip_click_run_analysis_handler_threw' },
      assistant_text: "I couldn't complete that just now.",
      suggested_actions: [{ id: 'chip_prompt_retry', label: 'Try again', message: 'X' }],
    };
    const result = assertExplainLeaderRecovery(ok(body, 500));
    expect(result.ok).toBe(true);
  });

  it('fails when internal terminology leaks into assistant_text', () => {
    const body = {
      assistant_text: 'The handler encountered an error in the AI service',
      blocks: [{ type: 'error', error_code: 'UPSTREAM_TIMEOUT' }],
      suggested_actions: [{ id: 'chip_prompt_retry', label: 'Try again', message: 'X' }],
    };
    const result = assertExplainLeaderRecovery(ok(body, 500));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toBe('recovery_response_internal_terms');
  });

  it('fails when too few recovery signals are present', () => {
    const body = { assistant_text: '' }; // nothing useful
    const result = assertExplainLeaderRecovery(ok(body, 500));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toBe('recovery_signals_insufficient');
  });
});

describe('assertAssistDraftGraph', () => {
  const validBody = {
    status: 'ok',
    graph: {
      nodes: [
        { id: 'n1', label: 'Hire locally', kind: 'option', provenance: 'from_brief' },
        { id: 'n2', label: 'Offshore partner', kind: 'option', provenance: 'ai_inferred' },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2', provenance_display: 'ai_inferred' },
      ],
    },
    coaching: {
      summary: 'Consider runway impact more carefully.',
      strengthen_items: [],
    },
  };

  it('passes on a valid response with coaching present', () => {
    const result = assertAssistDraftGraph(ok(validBody));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.features_observed).toContain('coaching');
      expect(result.features_observed).toContain('node_provenance');
      expect(result.features_observed).toContain('edge_provenance_display');
    }
  });

  it('passes with a warning when coaching is absent', () => {
    const body = { ...validBody, coaching: undefined };
    const result = assertAssistDraftGraph(ok(body));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const warnings = result.warnings ?? [];
      expect(warnings.some((w) => w.includes('coaching_absent'))).toBe(true);
    }
  });

  it('fails when a node is missing provenance', () => {
    const body = {
      ...validBody,
      graph: {
        ...validBody.graph,
        nodes: [{ id: 'n1', label: 'X', kind: 'option' }],
        edges: [],
      },
    };
    const result = assertAssistDraftGraph(ok(body));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toBe('assist_draft_graph node missing provenance');
  });

  it('fails when a node provenance is not in the enum', () => {
    const body = {
      ...validBody,
      graph: {
        ...validBody.graph,
        nodes: [{ id: 'n1', label: 'X', kind: 'option', provenance: 'invalid' }],
        edges: [],
      },
    };
    const result = assertAssistDraftGraph(ok(body));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toBe('assist_draft_graph node provenance not in enum');
  });

  it('fails when an edge is missing provenance_display', () => {
    const body = {
      ...validBody,
      graph: {
        ...validBody.graph,
        edges: [{ id: 'e1', from: 'n1', to: 'n2' }],
      },
    };
    const result = assertAssistDraftGraph(ok(body));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toBe('assist_draft_graph edge missing provenance_display');
  });

  it('fails when coaching has bad shape', () => {
    const body = {
      ...validBody,
      coaching: { summary: 42, strengthen_items: [] },
    };
    const result = assertAssistDraftGraph(ok(body));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toBe('coaching.summary not string|null');
  });

  it('fails on HTTP non-200', () => {
    const result = assertAssistDraftGraph(ok({ schema: 'cee.error.v1', code: 'BAD_INPUT' }, 400));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failing_contract).toContain('http 400');
  });
});
