/**
 * ⭐⭐⭐ THE CONTRACT GUARD — and A2 is the whole reason it exists.
 *
 * For the life of the feature the reviewing model received
 * `<GRAPH>\n\n{}\n\n</GRAPH>` on 6 of 6 captured reviews: 21 characters
 * against a 43,100 budget. It coached about a model it had never seen.
 *
 * ⚠ `v5.context_budget` logged `graph_json: 21` on every one of those turns.
 * The number was there. It survived because 21 is only recognisable as `{}` by
 * ARITHMETIC — we logged the SHAPE of the payload and never its SUBSTANCE.
 *
 * A2 reconstructs that exact input and asserts the auditor calls it degenerate.
 * That is the RED-first proof: this guard would have caught it on day one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildInvokeInputForTests } from '../../../orchestrator-v5/coaching/decision-review-enricher.js';
import { buildDecisionReviewUserMessage } from '../invoke.js';
import { auditAssembledPrompt, degenerateSections } from '../assembled-prompt-audit.js';

const CAPTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'live-decision-review-2026-09-03.json'), 'utf8'),
) as { enrichment: Record<string, unknown> };

const liveEnrichment = () => ({
  ...(JSON.parse(JSON.stringify(CAPTURE.enrichment)) as Record<string, unknown>),
  results: [
    { option_id: 'opt_a', option_label: 'Continue With Founder-Led Sales', win_probability: 0.62 },
    { option_id: 'opt_b', option_label: 'Hire a Dedicated Sales Team', win_probability: 0.37 },
  ],
});

const REAL_GRAPH = {
  nodes: [
    { id: 'fac_lead', kind: 'factor', label: 'Team Leadership Coverage' },
    { id: 'out_ship', kind: 'outcome', label: 'Ship On Time' },
  ],
  edges: [
    {
      from: 'fac_lead',
      to: 'out_ship',
      strength: { mean: 0.7, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

const assemble = (runGraph?: unknown) => {
  const input = buildInvokeInputForTests(
    'Assess our sales strategy.',
    liveEnrichment(),
    'opt_a',
    undefined,
    true,
    runGraph,
  );
  expect(input, 'precondition: the input builds').not.toBeNull();
  return buildDecisionReviewUserMessage(input!, 0.25);
};

describe('A1 — the auditor reads the sections the assembler really emits', () => {
  it('A1a it finds the live section set, derived not hand-listed', () => {
    const audit = auditAssembledPrompt(assemble(REAL_GRAPH));
    const names = audit.map((s) => s.section);
    expect(names).toContain('BRIEF');
    expect(names).toContain('GRAPH');
    expect(names).toContain('ISL_RESULTS');
    expect(names.length, 'a real message emits several sections').toBeGreaterThan(3);
  });
});

describe('A2 — ⭐ THE HISTORICAL DEFECT: an empty graph is DEGENERATE, not small', () => {
  it('A2a with no graph anywhere, GRAPH is flagged', () => {
    const audit = auditAssembledPrompt(assemble(undefined));
    const graph = audit.find((s) => s.section === 'GRAPH');
    expect(graph?.verdict, 'this is the 21-character failure').toBe('degenerate');
  });

  it('A2b PRECONDITION: it really is the shipped shape — tiny, and `{}`', () => {
    const graph = auditAssembledPrompt(assemble(undefined)).find((s) => s.section === 'GRAPH');
    expect(graph?.chars, 'the body is a couple of characters, as it was live').toBeLessThan(10);
    expect(graph?.found).toContain('{}');
  });

  it('A2c and with the graph threaded, the SAME section is substantive', () => {
    // The discriminating twin. Without it, A2a passes if the auditor simply
    // calls every GRAPH degenerate.
    const graph = auditAssembledPrompt(assemble(REAL_GRAPH)).find((s) => s.section === 'GRAPH');
    expect(graph?.verdict).toBe('substantive');
  });
});

describe('A3 — honest absence is ALLOWED; only dishonest emptiness fails', () => {
  it('A3a "Not available" is explicitly absent, never degenerate', () => {
    const audit = auditAssembledPrompt(assemble(REAL_GRAPH));
    const flip = audit.find((s) => s.section === 'FLIP_THRESHOLD_DATA');
    expect(flip, 'the fixture emits this section').toBeDefined();
    expect(['explicitly_absent', 'substantive']).toContain(flip!.verdict);
  });

  it('A3b ⭐ the rule is NOT "non-empty" — that would ban the honest form and keep `{}`', () => {
    // `{}` is two characters and not empty. "Not available" is thirteen and is
    // the safe one. A length rule gets this exactly backwards.
    const audit = auditAssembledPrompt(
      '<A>\n{}\n</A>\n\n<B>\nNot available\n</B>',
    );
    expect(audit.find((s) => s.section === 'A')?.verdict).toBe('degenerate');
    expect(audit.find((s) => s.section === 'B')?.verdict).toBe('explicitly_absent');
  });
});

describe('A4 — emptiness is judged structurally, not by string match', () => {
  it('A4a a pretty-printed all-empty-collections object is degenerate', () => {
    // 40+ characters, passes any length check, carries nothing.
    const body = JSON.stringify({ nodes: [], edges: [], _node_count: 0, _edge_count: 0 }, null, 2);
    expect(body.length).toBeGreaterThan(40);
    const audit = auditAssembledPrompt(`<GRAPH>\n${body}\n</GRAPH>`);
    expect(audit[0]?.verdict).toBe('degenerate');
  });

  it('A4b one real node makes the same shape substantive', () => {
    const body = JSON.stringify({ nodes: [{ id: 'a' }], edges: [], _node_count: 1 }, null, 2);
    expect(auditAssembledPrompt(`<GRAPH>\n${body}\n</GRAPH>`)[0]?.verdict).toBe('substantive');
  });

  it('A4c a truncation marker alone does not rescue an empty body', () => {
    const audit = auditAssembledPrompt('<X>\n{}\n[TRUNCATED: 3 entries omitted]\n</X>');
    expect(audit[0]?.verdict).toBe('degenerate');
  });

  it('A4d prose is substantive even when it mentions absence in passing', () => {
    const audit = auditAssembledPrompt(
      '<BRIEF>\nWe have no data on churn yet, but the budget is fixed at 200000.\n</BRIEF>',
    );
    expect(audit[0]?.verdict, 'matched whole-body, never as a substring').toBe('substantive');
  });
});

describe('A5 — THE LIVE CONTRACT: a real assembled prompt has no degenerate section', () => {
  it('A5a zero degenerate sections on a real captured input with a real graph', () => {
    const bad = degenerateSections(assemble(REAL_GRAPH));
    expect(
      bad.map((s) => `${s.section}=${s.found}`),
      'every section the model receives must carry content or say it has none',
    ).toEqual([]);
  });

  it('A5b CONTRAST CONTROL: the auditor discriminates — it does not pass everything', () => {
    // Without this, A5a passes if `degenerateSections` always returns [].
    expect(degenerateSections('<GRAPH>\n{}\n</GRAPH>')).toHaveLength(1);
  });
});
