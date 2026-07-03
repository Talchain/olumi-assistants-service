/**
 * Adversarial pins — prompt-injection-shaped text must be INERT DATA.
 *
 * PINS that hostile instruction-like text in proposal fields is carried
 * byte-for-byte as data (never interpreted, never interpolated, never
 * executed) through the live merge, and documents where that raw text then
 * SURFACES (merged graph labels → canvas; serialise-graph-for-review → a
 * hypothetical second M2 round's user message) as FINDINGs.
 */
import { describe, it, expect } from 'vitest';
import { mergeProposals } from '../../dual-draft/merge.js';
import { serialiseGraphForReview } from '../../dual-draft/serialise-graph-for-review.js';
import { baseGraph, riskProposal, INJECTION_STRINGS } from './adversarial-fixtures.js';

describe('injection strings in node labels merge as byte-identical inert data', () => {
  INJECTION_STRINGS.forEach((hostile, i) => {
    it(`label #${i} survives byte-identical and is never interpreted`, () => {
      const out = mergeProposals(baseGraph(), [riskProposal(`risk_inj_${i}`, hostile)]);
      expect(out.report.applied).toBe(1);
      const merged = out.merged.nodes.find((n) => n.id === `risk_inj_${i}`);
      expect(merged?.label).toBe(hostile);
    });
  });

  it('template-literal syntax is never interpolated (stays the literal ${...} string)', () => {
    const tpl = INJECTION_STRINGS[INJECTION_STRINGS.length - 1];
    expect(tpl.startsWith('${')).toBe(true);
    const out = mergeProposals(baseGraph(), [riskProposal('risk_tpl', tpl)]);
    const merged = out.merged.nodes.find((n) => n.id === 'risk_tpl');
    expect(merged?.label).toBe(tpl);
    expect(merged?.label).toContain('process.env.ANTHROPIC_API_KEY');
  });
});

describe('injection strings in artifact channels are preserved as data', () => {
  it('artifact rationale carries hostile text byte-identical', () => {
    const hostile = INJECTION_STRINGS[0];
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_evidence_gap',
        delta: { question: 'Is there churn data?' },
        evidence_pointer: 'draft: churn unquantified',
        rationale: hostile,
      },
    ]);
    expect(out.report.artifacts).toBe(1);
    expect(out.artifacts[0].rationale).toBe(hostile);
  });

  it('FINDING: a deferred option label embeds hostile text inside the artifact question', () => {
    // Non-claim injection text in an added_option label is NOT rejected — it
    // defers (D1), and the raw text is wrapped into the human-readable defer
    // question. Any future surface rendering defer artifacts must treat the
    // question as untrusted content.
    const hostile = INJECTION_STRINGS[1];
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_option',
        delta: { node: { id: 'opt_inj', kind: 'option', label: hostile } },
        evidence_pointer: 'brief: alternative mentioned',
      },
    ]);
    expect(out.report.artifacts).toBe(1);
    expect(out.artifacts[0].type).toBe('added_option');
    expect(out.artifacts[0].question).toBe(`Consider an additional option: "${hostile}"`);
  });
});

describe('FINDING: serialise-graph-for-review re-emits merged hostile labels unescaped', () => {
  it('FINDING: a merged hostile label appears raw inside the next review serialisation', () => {
    // The MVP makes exactly one M2 call per turn, so today this text only
    // ever flows M2→merge. But serialiseGraphForReview has no
    // escaping/framing: if a merged graph is ever re-serialised for a second
    // review round (or any future LLM consumer), the injected instruction
    // text appears INLINE in the user message.
    const hostile = INJECTION_STRINGS[0];
    const out = mergeProposals(baseGraph(), [riskProposal('risk_reser', hostile)]);
    expect(out.report.applied).toBe(1);
    const serialised = serialiseGraphForReview(out.merged);
    expect(serialised).toContain(hostile);
    expect(serialised).toContain(`- risk_reser | risk | ${hostile}`);
  });
});

describe('FINDING: control / bidi characters are accepted by the bare-string label schema', () => {
  it('FINDING: NUL, BEL, RTL-override and zero-width characters merge into canvas-visible labels', () => {
    const nul = INJECTION_STRINGS[5]; // contains \u0000 and \u0007
    const rtl = INJECTION_STRINGS[3]; // contains \u202E / \u202C
    const zw = INJECTION_STRINGS[4]; // contains \u200B / \u200D
    const out = mergeProposals(baseGraph(), [
      riskProposal('risk_ctl_nul', nul),
      riskProposal('risk_ctl_rtl', rtl),
      riskProposal('risk_ctl_zw', zw),
    ]);
    expect(out.report.applied).toBe(3);
    expect(out.merged.nodes.find((n) => n.id === 'risk_ctl_nul')?.label).toContain('\u0000');
    expect(out.merged.nodes.find((n) => n.id === 'risk_ctl_rtl')?.label).toContain('\u202E');
    expect(out.merged.nodes.find((n) => n.id === 'risk_ctl_zw')?.label).toContain('\u200B');
    expect(out.report.post_merge_valid).toBe(true);
  });
});
