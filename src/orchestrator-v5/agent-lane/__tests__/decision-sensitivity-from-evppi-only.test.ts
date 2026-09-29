/**
 * ⛔ THE AGENT READS DECISION SENSITIVITY FROM EVPPI ONLY (Canonical #70 5847574837). Fixture: the served
 * `levelless-reason-PIN2` turn-3 `analysis_result` block, verbatim — every `factor_evppi` row `below_resolution`,
 * while `factor_sensitivity` / `top_drivers` rank "Paid AI add-on revenue" (acted on only by the EXCLUDED option) "biggest".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { analysisResultForAgent, NO_SINGLE_ASSUMPTION, withoutStrongestDriverClause } from '../decision-sensitivity.js';

const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-levelless-pin2-turn3-result.json', import.meta.url), 'utf8')) as { analysis_result: Record<string, unknown> }).analysis_result;
const ctx = { scenario_id: '3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', authenticated_user_id: 'user-a', request_id: 'r' };
type Enr = { factor_sensitivity?: unknown; decision_brief?: { top_drivers?: unknown }; factor_evppi?: unknown };

describe('the run result the Agent reads (served levelless-reason-PIN2 turn 3)', () => {
  it('PRECONDITION: the served block really ranks the excluded option\'s factor "biggest" while every EVPPI is below resolution', () => {
    const e = SERVED.enrichment as Enr;
    expect((e.decision_brief?.top_drivers as { factor_label: string }[])[0]!.factor_label).toBe('Paid AI add-on revenue');
    expect((e.factor_evppi as { status: string }[]).every((r) => r.status === 'below_resolution')).toBe(true);
  });

  it('RED: structural sensitivity is not handed to the Agent, and the true sentence is: no single assumption measurably changes which option leads', () => {
    const out = analysisResultForAgent(SERVED) as { enrichment: Enr; decision_sensitivity: unknown };
    expect(out.enrichment.factor_sensitivity).toBeUndefined();
    expect(out.enrichment.decision_brief?.top_drivers).toBeUndefined();
    expect(out.decision_sensitivity).toEqual({ status: 'none_measurable', say: NO_SINGLE_ASSUMPTION });
    expect(JSON.stringify(out)).not.toContain('"driver_label":"biggest"');
    // EVPPI itself — the decision measure — is still there to read.
    expect(Array.isArray(out.enrichment.factor_evppi)).toBe(true);
    // The input is never mutated (the user-facing blocks share it).
    expect(((SERVED.enrichment as Enr).decision_brief?.top_drivers as unknown[]).length).toBeGreaterThan(0);
  });

  it('a factor whose EVPPI clears resolution IS named, with its label', () => {
    const e = SERVED.enrichment as Record<string, unknown>;
    const rows = (e.factor_evppi as Record<string, unknown>[]).map((r, i) => (i === 0 ? { ...r, status: 'resolved', evppi: 0.04 } : r));
    const out = analysisResultForAgent({ ...SERVED, enrichment: { ...e, factor_evppi: rows } }) as { decision_sensitivity: { status: string; most_sensitive?: { factor_id: string; label: string } } };
    expect(out.decision_sensitivity.status).toBe('measured');
    expect(out.decision_sensitivity.most_sensitive!.factor_id).toBe(String(rows[0]!.factor_id));
  });

  it('no EVPPI at all → no claim either way', () => {
    const { factor_evppi: _gone, ...e } = SERVED.enrichment as Record<string, unknown>;
    expect((analysisResultForAgent({ ...SERVED, enrichment: e }) as { decision_sensitivity: unknown }).decision_sensitivity).toEqual({ status: 'not_measured' });
  });

  it('the summary\'s structural "strongest driver" clause is dropped; the rest of the sentence stays', () => {
    expect(withoutStrongestDriverClause('Raise to £59 leads because Paid AI add-on revenue is the strongest driver. It rests on four estimates.'))
      .toBe('Raise to £59 leads. It rests on four estimates.');
  });

  it('N1 (Canonical, measured): a factor label with a dot in it is still dropped', () => {
    expect(withoutStrongestDriverClause('Launch leads because Pro plan v2.0 adoption is the strongest driver. It rests on two estimates.'))
      .toBe('Launch leads. It rests on two estimates.');
    expect(withoutStrongestDriverClause('Raise leads because Price (£49.00) is the strongest driver.')).toBe('Raise leads.');
  });
});

describe('the real runAnalysis hands the Agent the projection; the user-facing blocks are untouched', () => {
  it('RED: the tool result carries decision_sensitivity and no structural ranking; onAnalysis still receives the served block', async () => {
    let seen: unknown[] = [];
    const dispatch: InternalDispatch = async () => ({ status: 200, json: { analysis_ready: { status: 'ready', options: [], blockers: [] }, blocks: [SERVED] } });
    const caps = createAgentCapabilities(dispatch, new ProposalStore(), undefined, 'full', (p) => { seen = p.blocks ?? []; });
    const r = await caps.runAnalysis(ctx, { reason: 'compare the options' });
    const result = r.result as { enrichment: Enr; decision_sensitivity: unknown };
    expect(result.decision_sensitivity).toEqual({ status: 'none_measurable', say: NO_SINGLE_ASSUMPTION });
    expect(result.enrichment.factor_sensitivity).toBeUndefined();
    // CONTRAST: the block the product renders is the served one, unchanged.
    expect(((seen[0] as { enrichment: Enr }).enrichment.factor_sensitivity as unknown[]).length).toBeGreaterThan(0);
  });
});
