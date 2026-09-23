/**
 * ⭐ The Agent can ask Olumi's deterministic method gate which reasoning technique the
 * latest analysis calls for, and why (applicable-method.ts).
 *
 * ⛔ NOT HAND-WRITTEN FACTS. `served-run-analysis-fact.json` is the newest completed
 * `run_analysis` fact persisted in `v5_handler_facts` for a served OpenAI-route witness
 * scenario (74f8c4cb, 23 Sep 09:03Z, the witness user's own); `-refused.json` is the
 * refused run on served 553254d (d99f3ca9, the #1710 goal regression). Both are read
 * back exactly as the store returns them; neither carries an email or user id.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applicableMethod } from '../runtime/applicable-method.js';
import { AGENT_TOOLS, MUTATION_TOOLS, dispatchTool, toolsFor } from '../runtime/agent-tools.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
const SERVED = fixture('served-run-analysis-fact.json');
const REFUSED = fixture('served-run-analysis-fact-refused.json');

describe('the method gate, over real served facts', () => {
  it('vacuity: the fixtures are the served facts they claim to be', () => {
    expect(SERVED.fact_type).toBe('run_analysis');
    expect((SERVED.result as { enrichment?: { analysis_status?: string } }).enrichment?.analysis_status).not.toBe('refused');
    expect((REFUSED.result as { enrichment?: { analysis_status?: string } }).enrichment?.analysis_status).toBe('refused');
  });

  it('RED: a completed served analysis yields the gate’s own method, title and reason', async () => {
    const r = await applicableMethod(async () => SERVED as never, 'scenario');
    expect(r.ok).toBe(true);
    expect(r.mutated).toBe(false);
    const m = r.method as { id: string; title: string; why: string; science: unknown };
    expect(m.id).toBe('pre_mortem');
    expect(m.title).toBe('Strengthen your model: run a quick pre-mortem');
    expect(m.why).toMatch(/assuming it went wrong and asking why/);
    // ⛔ The pre-mortem LENS predates the DSK bundle and carries no provenance —
    // it is never handed a protocol label it does not have.
    expect(m.science).toBeNull();
  });

  it('a refused analysis gives the gate nothing to select from → no method, and says not to invent one', async () => {
    const r = await applicableMethod(async () => REFUSED as never, 'scenario');
    expect(r.method).toBeNull();
    expect(String(r.why_none)).toMatch(/Do not propose one/);
  });

  it('no analysis yet → no method, and why', async () => {
    const r = await applicableMethod(async () => null, 'scenario');
    expect(r.method).toBeNull();
    expect(String(r.why_none)).toMatch(/No analysis has run/);
  });

  it('no reader wired → the tool refuses rather than guessing', async () => {
    const r = await applicableMethod(undefined, 'scenario');
    expect(r).toEqual({ ok: false, mutated: false, refusal: 'method_gate_unavailable' });
  });
});

describe('a DSK-linked choice carries the published protocol, from the verified bundle', () => {
  it('consider-the-opposite → DSK-P-003 with its literal steps and evidence strength', async () => {
    vi.resetModules();
    vi.doMock('../../compose/lens-selector.js', async (orig) => {
      const actual = await orig<typeof import('../../compose/lens-selector.js')>();
      return {
        ...actual,
        // Only the CHOICE is stubbed; the provenance map, bundle and steps are real.
        rankInterventions: () => ({
          chosen: { lens: 'consider_opposite', rationaleCode: 'consider_opposite', title: 'Consider the opposite', body: 'Ask what would make the leading option wrong.', groundingField: 'x' },
          candidates: [], ineligible: [],
        }),
      };
    });
    const { applicableMethod: fresh } = await import('../runtime/applicable-method.js');
    const r = await fresh(async () => SERVED as never, 'scenario');
    const s = (r.method as { science: { protocol_id: string; evidence_strength: unknown; steps: string[] } | null }).science;
    expect(s?.protocol_id).toBe('DSK-P-003');
    expect(s?.evidence_strength).toBeDefined();
    expect(s!.steps.length).toBeGreaterThan(0);
    vi.doUnmock('../../compose/lens-selector.js');
  });
});

describe('the tool surface', () => {
  it('is declared, read-only, and available in preview', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toContain('get_applicable_method');
    expect(MUTATION_TOOLS).not.toContain('get_applicable_method');
    expect(toolsFor('preview').map((t) => t.name)).toContain('get_applicable_method');
  });

  it('RED: dispatch reaches the gate through the real capabilities, with the store reader the route injects', async () => {
    const dispatch = async () => ({ status: 200, json: {} });
    const caps = createAgentCapabilities(dispatch as never, new ProposalStore(), undefined, 'preview', undefined, async () => SERVED as never);
    const r = await dispatchTool('get_applicable_method', JSON.stringify({ reason: 'after the analysis' }), { scenario_id: 's', authenticated_user_id: null, request_id: 'r' } as never, caps, 'preview');
    expect((r.method as { id: string }).id).toBe('pre_mortem');
  });
});
