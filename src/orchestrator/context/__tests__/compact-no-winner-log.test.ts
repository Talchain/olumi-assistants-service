/**
 * Track 3, 22 Oct: every graph read of 80a77832 logged "compactAnalysis: no valid options found" (result_count 4) while its
 * Run had four computed options. Its Runs withheld the win figures (an unsized link on every path), so no option is crowned
 * (NO WINNER FROM ABSENT FIGURES) and every option is kept: that is not "no valid options". The warning stays for the case
 * it names: no option the comparison can use.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../../utils/telemetry.js';
import type { V2RunResponseEnvelope } from '../../types.js';
import { compactAnalysis } from '../analysis-compact.js';

const NO_VALID = 'compactAnalysis: no valid options found';
const env = (rows: unknown[]) => ({ analysis_status: 'computed', option_comparison: rows }) as unknown as V2RunResponseEnvelope;
const row = (option_id: string, status = 'computed', win?: number) => ({ option_id, option_label: option_id, status,
  outcome: { mean: 0.65, p10: 0.39, p50: 0.63, p90: 0.94 }, ...(win === undefined ? {} : { win_probability: win }) });
const warned = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.filter((c: unknown[]) => c[1] === NO_VALID).length;

describe('"no valid options" is said only when there is none', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('80a77832: four computed options whose Run withheld the win figures: all kept, no winner, no warning', () => {
    const warn = vi.spyOn(log, 'warn');
    const summary = compactAnalysis(env(['current', 'warm', 'direct', 'balanced'].map((id) => row(id))));
    expect(summary!.options.map((o) => o.option_id).sort()).toEqual(['balanced', 'current', 'direct', 'warm']);
    expect(summary!.winner.option_id).toBe('');
    expect(warned(warn)).toBe(0);
  });

  it('CONTRAST: no option the comparison can use (every one failed) still warns', () => {
    const warn = vi.spyOn(log, 'warn');
    compactAnalysis(env([row('a', 'failed', 0.5), row('b', 'failed', 0.5)]));
    expect(warned(warn)).toBe(1);
  });
});
