import { describe, expect, it } from 'vitest';
import { authoredBanAfterMasking, PremortemWorksheetV1Schema, premortemProducerDirective, premortemWorksheetDiagnosticsFor, premortemWorksheetFor } from '../premortem.js';
import { diagnosticsCases, maskingCases, riskCases, riskStories } from './premortem-diagnostics-cases.js';

describe('pre-mortem story completeness and coded diagnostics', () => {
  it.each([...diagnosticsCases, ...maskingCases, ...riskCases])('$name', row => {
    const result = premortemWorksheetDiagnosticsFor(row.make());
    expect(result.worksheet !== undefined).toBe(row.emitted);
    expect(result.rows).toBe(row.rows);
    expect(result.stories).toBe(row.name.startsWith('two ') ? 2 : 1);
    if (row.reason) expect(result.dropped).toContainEqual(expect.objectContaining({ story_index: row.storyIndex, reason: row.reason }));
    else expect(result.dropped).toEqual([]);
    if (result.worksheet) {
      expect(PremortemWorksheetV1Schema.safeParse(result.worksheet).success).toBe(true);
      expect(result.worksheet.rows).toHaveLength(row.rows);
      for (const optionId of row.stressTested ?? []) {
        expect(result.worksheet.coverage.find(c => c.option_id === optionId)?.status).toBe('stress_tested');
      }
    }
    // Fresh inputs are necessary for the adversarial label-drift case.
    expect(premortemWorksheetFor(row.make()) !== undefined).toBe(row.emitted);
  });

  it('allows supplied risks in the producer grammar and eligible items, leaving limits for a follow-up', () => {
    const input = riskStories();
    const turn = { ...input.turn!, context: { ...input.turn!.context, supplied_items: [...input.turn!.context.supplied_items, { id: 'limit-follow-up', kind: 'limit' as const, labels: ['Limit'], card: 'propose_new_risk' as const }] } };
    const directive = premortemProducerDirective(turn, input.final.graph);
    expect(directive).toContain('Each row: {option_id,story_index,failure_way,early_warning,mitigation?,grounding:{kind:"factor"|"link"|"risk",ids:[supplied ids]}|{kind:"not_in_model"},risk:{label,affected_node_id,direction:"positive"|"negative"}}.');
    expect(directive).toContain(JSON.stringify({ id: 'customers_lost_to_price_rise_churn', kind: 'risk', labels: ['Customers lost to price-rise churn'] }));
    expect(directive).not.toContain('limit-follow-up');
  });

  it('accepts a risk envelope and rejects empty risk labels', () => {
    const worksheet = premortemWorksheetFor(riskStories());
    expect(worksheet).toBeDefined();
    expect(worksheet?.rows[0].grounding).toEqual({ kind: 'risk', ids: ['customers_lost_to_price_rise_churn'], labels: ['Customers lost to price-rise churn'] });
    expect(PremortemWorksheetV1Schema.safeParse(worksheet).success).toBe(true);
    const emptyLabels = structuredClone(worksheet!);
    if (emptyLabels.rows[0].grounding.kind === 'not_in_model') throw new Error('must be risk grounded');
    emptyLabels.rows[0].grounding.labels = [];
    expect(PremortemWorksheetV1Schema.safeParse(emptyLabels).success).toBe(false);
  });

  it('masks exact folded labels longest first with the existing word boundaries', () => {
    expect(authoredBanAfterMasking('Raise prices 10%', ['Raise prices', 'Raise prices 10%'])).toBe(false);
    expect(authoredBanAfterMasking('BEST-of-breed CRM and Best-of-breed CRM', ['Best-of-breed CRM'])).toBe(false);
    expect(authoredBanAfterMasking('‘Lead   with price’', ['Lead with price'])).toBe(false);
    expect(authoredBanAfterMasking('Best-of-breed CRMs', ['Best-of-breed CRM'])).toBe(true);
    expect(authoredBanAfterMasking('Raise prices 10%, then 10%', ['Raise prices 10%'])).toBe(true);
  });

  it('masks 20k characters with 50 labels in under 50 ms', () => {
    const labels = Array.from({ length: 50 }, (_, index) => `Best CRM ${index}`);
    const unit = labels.join('; ') + '; ';
    const field = unit.repeat(Math.floor(20_000 / unit.length)).padEnd(20_000, '.');
    const start = performance.now();
    const banned = authoredBanAfterMasking(field, labels);
    const elapsed = performance.now() - start;
    expect(banned).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });

  it('keeps missing-appendix and failed-egress diagnostics available without rows', () => {
    for (const override of [{ candidates: undefined }, { passed: false }, { initial: undefined }, { turnId: undefined }]) {
      const result = premortemWorksheetDiagnosticsFor({ ...diagnosticsCases[1].make(), ...override });
      expect(result).toEqual({ worksheet: undefined, dropped: [], stories: 2, rows: 0 });
    }
  });

  it('redacts malformed candidate fields to validated ids and indices', () => {
    const result = premortemWorksheetDiagnosticsFor({ ...diagnosticsCases[1].make(), candidates: [{
      option_id: { user_text: 'private' }, story_index: 'private', failure_way: 'private',
    }] });
    expect(result.dropped[0]).toEqual({ story_index: null, option_id: null, reason: 'schema' });
    expect(JSON.stringify(result.dropped)).not.toContain('private');
  });
});
