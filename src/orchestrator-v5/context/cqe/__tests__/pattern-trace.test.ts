import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable mock config -- controls CQE_VERBOSE_TRACE flag
const mockConfig = {
  cee: {
    cqeVerboseTrace: false,
  },
};

vi.mock('../../../../config/index.js', () => ({ config: mockConfig }));

const { tracePattern } = await import('../pattern-trace.js');

describe('tracePattern', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockConfig.cee.cqeVerboseTrace = false;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('does not write to stderr when CQE_VERBOSE_TRACE is false (Gate 4)', () => {
    mockConfig.cee.cqeVerboseTrace = false;
    tracePattern('P1', true, '0:5', 12);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('writes a structured JSON line to stderr when enabled -- matched with span', () => {
    mockConfig.cee.cqeVerboseTrace = true;
    tracePattern('P3', true, '12:19', 5);
    expect(stderrSpy).toHaveBeenCalledOnce();
    const written = String(stderrSpy.mock.calls[0][0]);
    const parsed = JSON.parse(written.trim());
    expect(parsed).toStrictEqual({
      event: 'cqe.pattern_trace',
      pattern_id: 'P3',
      matched: true,
      match_span: '12:19',
      duration_ms: 5,
    });
  });

  it('emits match_span null when pattern did not match', () => {
    mockConfig.cee.cqeVerboseTrace = true;
    tracePattern('P5', false, null, 3);
    const written = String(stderrSpy.mock.calls[0][0]);
    const parsed = JSON.parse(written.trim());
    expect(parsed).toStrictEqual({
      event: 'cqe.pattern_trace',
      pattern_id: 'P5',
      matched: false,
      match_span: null,
      duration_ms: 3,
    });
  });

  it('payload contains exactly the five specified keys', () => {
    mockConfig.cee.cqeVerboseTrace = true;
    tracePattern('P9', true, '0:3', 7);
    const written = String(stderrSpy.mock.calls[0][0]);
    const parsed = JSON.parse(written.trim());
    expect(Object.keys(parsed).sort()).toStrictEqual([
      'duration_ms',
      'event',
      'match_span',
      'matched',
      'pattern_id',
    ]);
  });

  it('output line is terminated with a newline', () => {
    mockConfig.cee.cqeVerboseTrace = true;
    tracePattern('P7', true, '1:4', 3);
    const written = String(stderrSpy.mock.calls[0][0]);
    expect(written).toMatch(/\n$/);
  });

  it('emits one line per call', () => {
    mockConfig.cee.cqeVerboseTrace = true;
    tracePattern('P1', true, '0:2', 10);
    tracePattern('P2', false, null, 8);
    tracePattern('P3', true, '5:9', 15);
    expect(stderrSpy).toHaveBeenCalledTimes(3);
  });

  it('never throws regardless of pattern_id value', () => {
    mockConfig.cee.cqeVerboseTrace = true;
    expect(() => tracePattern('', false, null, 0)).not.toThrow();
    expect(() => tracePattern('special-<>&', true, '0:1', 99)).not.toThrow();
  });
});
