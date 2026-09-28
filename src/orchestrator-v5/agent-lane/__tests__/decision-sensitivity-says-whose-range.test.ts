/**
 * ⛔ A DECISION-SENSITIVE FACTOR SAYS WHOSE RANGE MADE IT SO (AIQ ruling #72 5867782904; Core Stabilisation Plan §7).
 *
 * ISL #198 (served on ISL `e24c88c`) echoes each `factor_evppi` row's `spread_source`: `template` when the factor's
 * uncertainty range is Olumi's own assumption, `user` when it is the user's. AIQ's ruling: a template spread is not
 * silenced, it is attributed: "Within the range Olumi assumed for X, X could change which option leads. Do you know X
 * more precisely?" (words ACK 5870069785). A user's spread is said plainly.
 *
 * The Agent's `decision_sensitivity: measured` named the factor with no provenance for its range, so an assumption of
 * Olumi's could be read back to the user as a finding about their business.
 *
 * The rule (`decision-sensitivity.ts`): the SELECTED factor's own row decides, bound by `factor_id`. `template` gives
 * `range: 'olumi_assumed'` and the ruled sentence. `user` gives `range: 'yours'` and no sentence. Anything else, or no
 * field (PLoT does not send it yet), makes no claim, so the shape is exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { analysisResultForAgent, decisionSensitivityOf, NO_SINGLE_ASSUMPTION } from '../decision-sensitivity.js';

const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-levelless-pin2-turn3-result.json', import.meta.url), 'utf8')) as { analysis_result: Record<string, unknown> }).analysis_result;
const ENR = SERVED.enrichment as Record<string, unknown>;
const ROWS = ENR.factor_evppi as Record<string, unknown>[];
const ctx = { scenario_id: '3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', authenticated_user_id: 'user-a', request_id: 'r' };

type Measured = { status: string; most_sensitive?: { factor_id: string; label: string; range?: string }; say?: string };
/** The served block with row `i` resolved, and `extra` merged into the rows named by index. */
function withRows(i: number, extra: Record<number, Record<string, unknown>> = {}): Record<string, unknown> {
  const rows = ROWS.map((r, k) => ({ ...r, ...(k === i ? { status: 'resolved', evppi: 0.04 } : {}), ...(extra[k] ?? {}) }));
  return { ...SERVED, enrichment: { ...ENR, factor_evppi: rows } };
}
const measuredOf = (block: Record<string, unknown>) => (analysisResultForAgent(block) as { decision_sensitivity: Measured }).decision_sensitivity;
const labelOf = (block: Record<string, unknown>) => measuredOf(block).most_sensitive!.label;

describe('⛔ the Agent says whose range makes a factor decision-sensitive (AIQ 5867782904)', () => {
  it('PRECONDITION: the served fixture has ≥2 EVPPI rows, none carrying spread_source yet (PLoT does not send it)', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(2);
    expect(ROWS.some((r) => 'spread_source' in r)).toBe(false);
  });

  it('RED: a template spread on the selected factor → range "olumi_assumed" and the ruled sentence, naming the factor', () => {
    const block = withRows(0, { 0: { spread_source: 'template' } });
    const ds = measuredOf(block);
    const label = labelOf(block);
    expect(ds.status).toBe('measured');
    expect(ds.most_sensitive!.factor_id).toBe(String(ROWS[0]!.factor_id));
    expect(ds.most_sensitive!.range).toBe('olumi_assumed');
    expect(ds.say).toBe(`Within the range Olumi assumed for ${label}, ${label} could change which option leads. Do you know ${label} more precisely?`);
  });

  it('a user spread → range "yours", said plainly (no attribution sentence)', () => {
    const ds = measuredOf(withRows(0, { 0: { spread_source: 'user' } }));
    expect(ds.most_sensitive!.range).toBe('yours');
    expect(ds).not.toHaveProperty('say');
  });

  it('IDENTITY: a template spread on a DIFFERENT row is never read as the selected factor’s', () => {
    const ds = measuredOf(withRows(0, { 1: { spread_source: 'template' } }));
    expect(ds.status).toBe('measured');
    expect(ds.most_sensitive).not.toHaveProperty('range');
    expect(ds).not.toHaveProperty('say');
    // The selected factor need not be the first row: a template on the row ABOVE it is not its range.
    const second = measuredOf(withRows(1, { 0: { spread_source: 'template' } }));
    expect(second.most_sensitive!.factor_id).toBe(String(ROWS[1]!.factor_id));
    expect(second.most_sensitive).not.toHaveProperty('range');
    // …and the selected one's own user spread wins over another row's template.
    expect(measuredOf(withRows(0, { 0: { spread_source: 'user' }, 1: { spread_source: 'template' } })).most_sensitive!.range).toBe('yours');
  });

  it('CONTROL (inert until PLoT sends it): no field, or an unknown value, makes no claim, exactly as before', () => {
    for (const extra of [{}, { 0: { spread_source: 'default' } }, { 0: { spread_source: null } }] as Record<number, Record<string, unknown>>[]) {
      const ds = measuredOf(withRows(0, extra));
      expect(ds, JSON.stringify(extra)).toEqual({ status: 'measured', most_sensitive: { factor_id: String(ROWS[0]!.factor_id), label: labelOf(withRows(0)) } });
    }
  });

  it('CONTROL (AIQ precondition 5870069785): "could change which option leads" is a DECISION claim, so a template row below resolution ("decision_gain_not_significant") says nothing of the kind', () => {
    const rows = ROWS.map((r, k) => ({ ...r, status: 'below_resolution', ...(k === 0 ? { status_reason: 'decision_gain_not_significant', spread_source: 'template' } : {}) }));
    expect(decisionSensitivityOf({ ...ENR, factor_evppi: rows })).toEqual({ status: 'none_measurable', say: NO_SINGLE_ASSUMPTION });
  });

  it('RED (through the real runAnalysis): the Agent’s tool result carries the attribution', async () => {
    const block = withRows(0, { 0: { spread_source: 'template' } });
    const dispatch: InternalDispatch = async () => ({ status: 200, json: { analysis_ready: { status: 'ready', options: [], blockers: [] }, blocks: [block] } });
    const caps = createAgentCapabilities(dispatch, new ProposalStore(), undefined, 'full', () => {});
    const r = await caps.runAnalysis(ctx, { reason: 'compare the options' });
    const ds = (r.result as { decision_sensitivity: Measured }).decision_sensitivity;
    expect(ds.most_sensitive!.range).toBe('olumi_assumed');
    expect(ds.say).toContain('Within the range Olumi assumed for');
  });
});
