import { describe, it, expect } from 'vitest';

import {
  countRag,
  renderReport,
  consoleSummary,
  type CheckResult,
  type ReportHeader,
} from '../../../../tools/v5-journey-replay/assurance/report.js';

const checks: CheckResult[] = [
  { id: 'a', title: 'A', status: 'green', detail: 'ok' },
  { id: 'b', title: 'B', status: 'amber', detail: 'soft' },
  { id: 'c', title: 'C', status: 'red', detail: 'boom', scenario_id: 'sB', request_id: 'req-1' },
];

const header: ReportHeader = {
  command: 'pnpm assurance:v5:staging',
  runId: 'assurance-123',
  startedAt: '2026-06-26T00:00:00Z',
  finishedAt: '2026-06-26T00:05:00Z',
  baseUrl: 'https://cee-staging.onrender.com',
  environment: 'cee-staging',
  servingSha: 'abc1234',
  healthzOk: true,
  degraded: false,
  version: 'v1.12.0',
  flags: [
    { name: 'CEE_COACHING_CONTEXT_PROMPT_ENABLED', value: 'not wire-exposed', source: 'deploy-config' },
  ],
  scenarioIds: ['sA', 'sB'],
};

describe('report', () => {
  it('countRag tallies statuses', () => {
    expect(countRag(checks)).toEqual({ green: 1, amber: 1, red: 1 });
  });

  it('consoleSummary reports RED when any red present', () => {
    expect(consoleSummary(checks)).toMatch(/^RED/);
    expect(consoleSummary([{ id: 'x', title: 'x', status: 'green', detail: '' }])).toMatch(/^GREEN/);
    expect(consoleSummary([{ id: 'x', title: 'x', status: 'amber', detail: '' }])).toMatch(/^AMBER/);
  });

  it('renderReport: overall RED, icons, header, flags, scenario ids, cleanup', () => {
    const md = renderReport(header, checks, ['scenarios: deleted 5'], ['scenarios: residual 0']);
    expect(md).toContain('🔴 RED');
    expect(md).toContain('1 green · 1 amber · 1 red');
    expect(md).toContain('abc1234'); // serving sha
    expect(md).toContain('CEE_COACHING_CONTEXT_PROMPT_ENABLED');
    expect(md).toContain('sA');
    expect(md).toContain('sB');
    expect(md).toContain('request_id: `req-1`');
    expect(md).toContain('residual 0');
  });

  it('renderReport: overall GREEN when no amber/red', () => {
    const md = renderReport(header, [{ id: 'x', title: 'x', status: 'green', detail: 'ok' }], [], []);
    expect(md).toContain('🟢 GREEN');
  });
});
