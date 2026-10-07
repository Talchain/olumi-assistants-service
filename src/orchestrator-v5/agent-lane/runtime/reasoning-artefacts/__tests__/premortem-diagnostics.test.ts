import { describe, expect, it } from 'vitest';
import { authoredBanAfterMasking, PremortemWorksheetV1Schema, premortemProducerDirective, premortemWorksheetDiagnosticsFor, premortemWorksheetFor } from '../premortem.js';
import { boldCases, diagnosticsCases, maskingCases, riskCases, riskStories } from './premortem-diagnostics-cases.js';
import { performance } from 'node:perf_hooks';

describe('pre-mortem story completeness and coded diagnostics', () => {
  it.each([...diagnosticsCases, ...maskingCases, ...riskCases, ...boldCases])('$name', row => {
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

// DL (7 Oct): the story, story-parts and blindspot parsers took 0.35–3.1 s on 20k whitespace (pre-existing); now bounded / linear.
describe('pre-mortem parsing stays linear on long whitespace', () => {
  const base = diagnosticsCases[1].make();
  it.each([
    // Spaces INSIDE the story (a trailing run is trimmed away), plus a blindspot line so the parts parser is reached.
    ['story with 20k spaces after Watch for:', '1. x Watch for:' + ' '.repeat(20_000) + 'y\nOutside the model: what could blindside this?'],
    ['story with 20k newlines', '1. x' + '\n'.repeat(20_000)],
    ['blindspot with 20k spaces', 'Outside the model:' + ' '.repeat(20_000) + 'x'],
    ['20k newline-space pairs', '\n '.repeat(10_000)],
  ])('%s parses in under 50 ms', (_name, reply) => {
    const start = performance.now();
    premortemWorksheetDiagnosticsFor({ ...base, reply });
    expect(performance.now() - start).toBeLessThan(50);
  });
});

