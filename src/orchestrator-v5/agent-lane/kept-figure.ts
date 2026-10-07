import { normaliseFactorValue } from '../tools/handlers/d1-shared/normalise-factor-value.js';
import { isPercentScaledUnit } from '../../cee/draft/records/projector.js';

/**
 * ⛔ THE FIGURE A KEEP SENDS IS THE ONE THE WRITER STORES AS *EXACTLY* WHAT THE MODEL HOLDS NOW (CODEX CEE BUDDY 5925977983).
 * `nativeStartingValue` reads `observed_state` only: on a factor framed by its node `scale_frame` (value 0.1, frame 40, no
 * raw) it gave 0.1, the card said "0.1 hours/week", and the writer stored 0.0025 — the "unchanged" figure moved fortyfold.
 * So the candidates (raw; value × cap; value × scale_frame; value × 100 on a percent unit; the bare value) are each run
 * through the WRITER'S OWN normaliser with the inputs the writer gives it, and the first that reproduces the stored value
 * (and raw, when one is stored) is the figure. None → `undefined`, and nothing is offered: never an inverse done by hand.
 */
export function keptFigureFor(node: { scale_frame?: unknown; observed_state?: unknown }, unit: string): number | undefined {
  const os = (node.observed_state ?? undefined) as { value?: unknown; raw_value?: unknown; cap?: unknown; unit?: unknown } | undefined;
  if (typeof os?.value !== 'number' || !Number.isFinite(os.value)) return undefined;
  const value = os.value;
  const raw = typeof os.raw_value === 'number' ? os.raw_value : undefined;
  const cap = typeof os.cap === 'number' && os.cap > 0 ? os.cap : undefined;
  const frame = typeof node.scale_frame === 'number' ? node.scale_frame : undefined;
  const candidates = [raw, cap !== undefined ? value * cap : undefined, frame !== undefined ? value * frame : undefined,
    isPercentScaledUnit(unit) && Math.abs(value) <= 1 ? value * 100 : undefined, value]
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  for (const c of candidates) {
    try {
      const n = normaliseFactorValue({
        rawInput: c, ...(unit !== '' ? { unit } : {}),
        ...(cap !== undefined ? { factorCap: cap } : {}), ...(typeof os.unit === 'string' ? { factorUnit: os.unit } : {}),
        factorObservedValue: value, ...(raw !== undefined ? { factorObservedRawValue: raw } : {}),
        ...(frame !== undefined ? { factorScaleFrame: frame } : {}), inputHasUnit: unit !== '',
      });
      if (n.value === value && (raw === undefined || n.raw_value === raw)) return c;
    } catch { /* a figure the writer would refuse is no figure to keep */ }
  }
  return undefined;
}

