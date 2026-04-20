import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable mock config — controls CQE_VERBOSE_TRACE flag
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
    tracePattern('P1', true, 2, 12);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('writes a structured JSON line to stderr when enabled', () => {
    mockConfig.cee.cqeVerboseTrace = true;
    tracePattern('P3', false, 0, 5);
    expect(stderrSpy).toHaveBeenCalledOnce();
    const written = String(stderrSpy.mock.calls[0][0]);
    const parsed = JSON.parse(written.trim());
    expect(parsed).toMatchObject({
      event: 'cqe.pattern_trace',
      pattern_id: 'P3',
      matched: false,
      match_count: 0,
      duration_ms: 5,
    });
  });

  it('output line is terminated with a newline', () => {
    mockConfig.cee.cqeVerboseTrace = true;
    tracePattern('P7', true, 1, 3);
    const written = String(stderrSpy.mock.calls[0][0]);
    expect(written).toMatch(/\n$/);
  });

  it('emits one line per call', () => {
    mockConfig.cee.cqeVerboseTrace = true;
    tracePattern('P1', true, 1, 10);
    tracePattern('P2', false, 0, 8);
    tracePattern('P3', true, 3, 15);
    expect(stderrSpy).toHaveBeenCalledTimes(3);
  });

  it('never throws regardless of pattern_id value', () => {
    mockConfig.cee.cqeVerboseTrace = true;
    expect(() => tracePattern('', false, 0, 0)).not.toThrow();
    expect(() => tracePattern('special-<>&', true, 999, 99)).not.toThrow();
  });
});
