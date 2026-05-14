import { describe, expect, it } from 'vitest';

import { formatTimingsEvidence } from '../../../tools/v5-journey-replay/format-timings.js';

describe('formatTimingsEvidence', () => {
  it('returns empty string when body is undefined', () => {
    expect(formatTimingsEvidence(undefined)).toBe('');
  });

  it('returns empty string when body has no _timings field', () => {
    // The server returned a normal OlumiResponse without V5_TIMING_DEBUG.
    expect(formatTimingsEvidence({ assistant_text: 'hello' } as never)).toBe('');
  });

  it('returns empty string when _timings is present but empty', () => {
    expect(formatTimingsEvidence({ _timings: {} } as never)).toBe('');
  });

  it('renders the turn block when present', () => {
    const out = formatTimingsEvidence({
      _timings: {
        turn: {
          total_ms: 6123,
          build_turn_context_ms: 84,
          context_pack_assembly_ms: 12,
          routing_llm_ms: 5230,
          handler_execute_ms: 104,
          commit_ms: 642,
          routing_cache: 'hit',
          llm_calls_used: 1,
          handler_id: 'explain_results',
        },
      },
    } as never);
    expect(out).toContain('timings={');
    expect(out).toContain('total:6123');
    expect(out).toContain('routing:5230');
    expect(out).toContain('commit:642');
    expect(out).toContain('cache:hit');
    expect(out).toContain('handler_id:explain_results');
    expect(out).toContain('llm_calls:1');
  });

  it('renders the run_analysis (plot) block when present', () => {
    const out = formatTimingsEvidence({
      _timings: {
        run_analysis: {
          handler_total_ms: 7820,
          plot_request_ms: 7805,
          plot_status: 'computed',
          plot_cold_likely: false,
        },
      },
    } as never);
    expect(out).toContain('plot={');
    expect(out).toContain('handler_total:7820');
    expect(out).toContain('req:7805');
    expect(out).toContain('status:computed');
    expect(out).toContain('cold:false');
  });

  it('renders the draft_graph block when present', () => {
    const out = formatTimingsEvidence({
      _timings: {
        draft_graph: {
          total_ms: 51812,
          parse_ms: 32144,
          parse_llm_ms: 31870,
          enrich_ms: 1023,
          repair_ms: 6311,
          repair_fired: true,
          repair_attempts: 1,
          boundary_ms: 84,
        },
      },
    } as never);
    expect(out).toContain('draft={');
    expect(out).toContain('total:51812');
    expect(out).toContain('parse:32144');
    expect(out).toContain('parse_llm:31870');
    expect(out).toContain('repair:6311');
    expect(out).toContain('repair_fired:true');
    expect(out).toContain('repair_attempts:1');
  });

  it('renders multiple blocks separated by spaces', () => {
    const out = formatTimingsEvidence({
      _timings: {
        turn: { total_ms: 6123, routing_llm_ms: 5230 },
        run_analysis: { plot_request_ms: 7805 },
      },
    } as never);
    expect(out.split(' ').filter((p) => p.includes('={')).length).toBe(2);
    expect(out).toContain('timings={');
    expect(out).toContain('plot={');
  });

  it('skips non-finite numeric values', () => {
    const out = formatTimingsEvidence({
      _timings: {
        turn: {
          total_ms: NaN,
          routing_llm_ms: Infinity,
          build_turn_context_ms: 12,
        },
      },
    } as never);
    // Only the finite value should appear.
    expect(out).toContain('ctx:12');
    expect(out).not.toContain('total:');
    expect(out).not.toContain('routing:');
  });
});
