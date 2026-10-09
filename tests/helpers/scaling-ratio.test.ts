import { expect, it } from 'vitest';
import { scalingRatio } from './scaling-ratio.js';

it('distinguishes linear from deliberately quadratic work on an 8× input step', () => {
  // Retain the result so the loops do observable work without allocation or I/O in the timed calls.
  let sink = 0;
  const linear = (n: number): number => {
    let value = 0;
    for (let i = 0; i < n; i += 1) value = (value + Math.imul(i, i + 1)) | 0;
    return (sink = value);
  };
  const quadratic = (n: number): number => {
    let value = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) value = (value + Math.imul(i + 1, j + 1)) | 0;
    }
    return (sink = value);
  };
  const linearResult = scalingRatio(() => linear(20_000), () => linear(160_000));
  const quadraticResult = scalingRatio(() => quadratic(512), () => quadratic(4_096));
  console.log(`Linear control: ${linearResult.detail}`);
  console.log(`Quadratic control: ${quadraticResult.detail}`);
  expect(linearResult.ratio, linearResult.detail).toBeLessThan(22);
  expect(quadraticResult.ratio, quadraticResult.detail).toBeGreaterThan(30);
  expect(Number.isFinite(sink)).toBe(true);
}, 20_000);
