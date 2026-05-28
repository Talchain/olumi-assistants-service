/**
 * Unit tests for Phase 1.5 run_analysis precondition.
 *
 * After review P0-1, the precondition is WIRE-CHECKABLE ONLY — it asserts
 * "at least one option node exists in graph.nodes". Intervention-readiness
 * (status === 'ready' + non-empty interventions) lives in the scenario
 * store, which only the handler has async access to; the handler produces
 * typed HANDLER_INVOCATION_FAILED when options lack configuration. A prior
 * revision attempted to check readiness at the validator layer and would
 * have failed every production run_analysis turn because the real wire
 * does not carry the canonical options array.
 */
import { describe, it, expect } from 'vitest';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import type { ProposalAction } from '../types.js';
import { buildGraphLookup } from '../graph-lookup-adapter.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { validateToolCall, type GraphLookup } from '../validator.js';

function mkGraph(
  nodes: Array<{ id: string; kind: string; label: string }>,
  options?: Array<Record<string, unknown>>,
): GraphStateIngress {
  const g: Record<string, unknown> = { nodes, edges: [] };
  if (options) g.options = options;
  return g as GraphStateIngress;
}

function lookupFor(graph: GraphStateIngress): GraphLookup {
  const r = buildGraphLookup(graph);
  if (r.kind !== 'ok') throw new Error(`expected ok adapter result, got ${r.kind}`);
  return r.lookup;
}

function runAnalysisProposal(entityId: string, entityKind: 'option' | 'goal'): ProposalAction {
  return {
    handler_id: 'run_analysis',
    entity: {
      id: entityId,
      kind: entityKind,
      label: entityId,
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: [],
  };
}

describe('run_analysis precondition', () => {
  it('rejects with no_options_defined when graph has neither option-nodes nor options[]', () => {
    const graph = mkGraph([{ id: 'g1', kind: 'goal', label: 'Profit' }]);
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('g1', 'goal'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('PRECONDITION_UNMET');
      expect(result.error.details?.reason).toBe('no_options_defined');
    }
  });

  it('passes when at least one option node exists — even without canonical options[] on wire (P0-1)', () => {
    // This is the real-wire happy path: UI sends graph_state with an option
    // node but no top-level options[] array. The validator PASSES this; the
    // handler reads scenario data async and enforces intervention readiness.
    const graph = mkGraph([
      { id: 'g1', kind: 'goal', label: 'Profit' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
    ]);
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'option'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });

  it('passes regardless of options[] readiness — that check moved to handler', () => {
    // Whether options[] has status='ready' or status='needs_user_mapping',
    // the validator is agnostic. The wire doesn't carry canonical options,
    // so this layer cannot judge readiness without breaking every real turn.
    const graph = mkGraph(
      [{ id: 'opt_a', kind: 'option', label: 'A' }],
      [{ id: 'opt_a', status: 'needs_user_mapping', interventions: {} }],
    );
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'option'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });

  it('P0-1: rejects ENTITY_KIND_MISMATCH when proposal.kind differs from graph kind', () => {
    // LLM hallucination guard: if Sonnet proposes kind='option' but the id
    // resolves to a factor, validator must reject with ENTITY_KIND_MISMATCH.
    // (Here we use a 'goal' proposed kind with an option id, to hit the cross-
    // check without accepted_entity_kinds also rejecting it — run_analysis
    // accepts both option and goal.)
    const graph = mkGraph([{ id: 'opt_a', kind: 'option', label: 'A' }]);
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'goal'), // proposed goal, graph says option
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
      expect(result.error.details?.proposed_kind).toBe('goal');
      expect(result.error.details?.resolved_kind).toBe('option');
    }
  });

  it('precondition does not run when no graph lookup is available (frame stage)', () => {
    // Without a graph, graph-dependent checks + preconditions both skip.
    // Structural checks still happen — this proposal passes them all.
    const result = validateToolCall(
      runAnalysisProposal('opt_a', 'option'),
      undefined,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });

  it('precondition failure produces the stable machine-readable reason', () => {
    // Regression guard: the reason string is stable so the compose layer
    // can route it to actionable fix-path copy. After review round 2, the
    // validator layer only emits `no_options_defined` — intervention
    // readiness is the handler's responsibility (async scenario read).
    const graph = mkGraph([{ id: 'g1', kind: 'goal', label: 'Profit' }]);
    const lookup = lookupFor(graph);
    const result = validateToolCall(
      runAnalysisProposal('g1', 'goal'),
      lookup,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.details?.reason).toBe('no_options_defined');
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// run_analysis confirmation_template forwarder — defence-in-depth
// against an outcome.assistant_text that doesn't match the locked
// templates or the deterministic headline grammar. The forwarder must
// substitute the safe fallback literal rather than letting improvised
// prose through. Reviewer-blocking gap from the PR #210 round-2
// review (the prior regex was a loose " currently leads" substring
// match that any prose containing the phrase would have passed).
// ────────────────────────────────────────────────────────────────────

describe('run_analysis confirmation_template forwarder', () => {
  const FALLBACK = 'Ran analysis on your current scenario.';
  const template = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;

  function fwd(outcome: unknown): string {
    if (typeof template === 'function') return template(outcome);
    throw new Error('expected function-form confirmation_template');
  }

  it('forwards each locked RUN_ANALYSIS_ASSISTANT_TEMPLATES literal verbatim', () => {
    const locked = [
      'Ran analysis on your current scenario.',
      'Ran analysis on your current scenario. No options were compared.',
      'Ran analysis on your current scenario. Some results may be incomplete — treat with caution.',
      'Ran analysis on your current scenario. The analysis engine reported an unfamiliar status — treat the result with caution.',
      'Ran analysis on your current scenario. The engine flagged the run as partial and produced no option comparisons — treat with caution.',
    ];
    for (const literal of locked) {
      expect(fwd({ assistant_text: literal })).toBe(literal);
    }
  });

  it('forwards a well-shaped deterministic headline verbatim', () => {
    const headline =
      'Hire One Senior Technical Lead currently leads because Technical Leadership in Place is the strongest driver, but the result is sensitive to Hiring and Salary Cost.';
    expect(fwd({ assistant_text: headline })).toBe(headline);
  });

  it('forwards each Case A/B/C/D shape and each status suffix verbatim', () => {
    // Exact grammar alternatives (post-round-3 tightening). The
    // forwarder must accept every shape `buildAnalysisResultHeadline`
    // can emit and every status-suffix combination so a partial /
    // unknown PLoT run is not silently downgraded to the fallback.
    const acceptedShapes = [
      // Case A — winner + driver + fragility
      'Hire A currently leads because Cost is the strongest driver, but the result is sensitive to Quality.',
      'Hire A currently leads because Cost is the strongest driver, but the result is sensitive to Quality. The run was flagged as partial — treat as provisional.',
      'Hire A currently leads because Cost is the strongest driver, but the result is sensitive to Quality. The analysis engine reported an unfamiliar status — treat the result with caution.',
      // Case B — winner + driver
      'Hire A currently leads because Cost is the strongest driver.',
      'Hire A currently leads because Cost is the strongest driver. The run was flagged as partial — treat as provisional.',
      'Hire A currently leads because Cost is the strongest driver. The analysis engine reported an unfamiliar status — treat the result with caution.',
      // Case C — winner + fragility
      'Hire A currently leads, but the result is sensitive to Quality.',
      'Hire A currently leads, but the result is sensitive to Quality. The run was flagged as partial — treat as provisional.',
      'Hire A currently leads, but the result is sensitive to Quality. The analysis engine reported an unfamiliar status — treat the result with caution.',
      // Case D — winner + probability
      'Hire A currently leads with 62% probability. Run the follow-up checks before treating this as final.',
      'Hire A currently leads with 62% probability. Run the follow-up checks before treating this as final. The run was flagged as partial — treat as provisional.',
      'Hire A currently leads with 62% probability. Run the follow-up checks before treating this as final. The analysis engine reported an unfamiliar status — treat the result with caution.',
    ];
    for (const text of acceptedShapes) {
      expect(fwd({ assistant_text: text })).toBe(text);
    }
  });

  it('falls back when text contains the anchor but does NOT match the Case A/B/C/D grammar (round-3 reviewer example)', () => {
    // The round-2 predicate (anchor + blacklist) would have ACCEPTED
    // this string because it contains " currently leads", ends with
    // ".", is under 220 chars, has no forbidden vocab, no IDs, no
    // raw decimals. The round-3 grammar predicate REJECTS it
    // because it lacks the surrounding tokens of every case:
    //   - no "because X is the strongest driver" (Case A/B)
    //   - no ", but the result is sensitive to Y" (Case A/C)
    //   - no "with N% probability. Run the follow-up checks…" (Case D)
    const adversarial =
      'Hire A currently leads for reasons outside the deterministic headline grammar.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when text passes the blacklist + length + anchor checks but is structurally arbitrary', () => {
    // Additional anchor-shaped-but-non-grammar variants.
    const adversaries = [
      'Option A currently leads strongly in this analysis.',
      'Option A currently leads as the primary path forward.',
      'Looking at the data, Option A currently leads on every metric.',
      'In this scenario, Option A currently leads despite the noise.',
    ];
    for (const adv of adversaries) {
      expect(fwd({ assistant_text: adv })).toBe(FALLBACK);
    }
  });

  it('falls back when text is Case A shape but missing the " is the strongest driver" clause', () => {
    // Specific grammar gap — typo / partial emission. Must reject.
    const adversarial =
      'Hire A currently leads because Cost is the dominant factor, but the result is sensitive to Quality.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when text is Case D shape with the wrong follow-up phrase', () => {
    const adversarial =
      'Hire A currently leads with 62% probability. Please run more tests before deciding.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when text is Case D shape with a non-integer percentage (raw decimal)', () => {
    const adversarial =
      'Hire A currently leads with 62.5% probability. Run the follow-up checks before treating this as final.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when assistant_text contains "currently leads" mid-sentence with extra prose', () => {
    // The pre-fix forwarder accepted any string containing the
    // substring " currently leads". This regression test pins the
    // tighter allowlist — improvised prose around the anchor is now
    // rejected, even when the anchor itself is present.
    const adversarial =
      'Recommend Hire One Senior Technical Lead. Option B currently leads but the model is unreliable.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when assistant_text starts with the locked-template prefix but adds improvised tail prose', () => {
    // The pre-fix forwarder accepted anything starting with
    // "Ran analysis on your current scenario". This regression test
    // pins the exact-match-only contract.
    const adversarial =
      'Ran analysis on your current scenario plus we now recommend Hire X immediately.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when assistant_text leaks a recommendation token', () => {
    const adversarial = 'Hire A currently leads. We recommend you proceed.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when assistant_text leaks a winner token', () => {
    const adversarial = 'Hire A currently leads. The winner is clear.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when assistant_text leaks an ID-shaped token (opt_a)', () => {
    const adversarial = 'Hire opt_a currently leads in this run.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when assistant_text contains a raw decimal (e.g. 0.62)', () => {
    const adversarial = 'Hire A currently leads with 0.62 probability.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when assistant_text contains a newline (multi-line prose)', () => {
    const adversarial = 'Hire A currently leads.\nAlso, consider these alternatives.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when assistant_text exceeds the 220-char headline cap', () => {
    const longTail = 'X'.repeat(220);
    const adversarial = `Hire A currently leads ${longTail}.`;
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when assistant_text does not end with a period', () => {
    const adversarial = 'Hire A currently leads in this analysis';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when assistant_text is missing the "currently leads" anchor', () => {
    const adversarial = 'Hire A is the strongest option in this run.';
    expect(fwd({ assistant_text: adversarial })).toBe(FALLBACK);
  });

  it('falls back when outcome is null', () => {
    expect(fwd(null)).toBe(FALLBACK);
  });

  it('falls back when outcome has no assistant_text field', () => {
    expect(fwd({})).toBe(FALLBACK);
  });

  it('falls back when assistant_text is a non-string', () => {
    expect(fwd({ assistant_text: 42 })).toBe(FALLBACK);
    expect(fwd({ assistant_text: null })).toBe(FALLBACK);
    expect(fwd({ assistant_text: undefined })).toBe(FALLBACK);
    expect(fwd({ assistant_text: ['not', 'a', 'string'] })).toBe(FALLBACK);
  });

  it('falls back when assistant_text is the empty string', () => {
    expect(fwd({ assistant_text: '' })).toBe(FALLBACK);
  });
});
