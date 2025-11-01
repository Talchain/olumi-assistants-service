export type ParsedBrief = {
  goal?: string;
  constraints?: string[];
  audience?: string;
  metrics?: string[];
  timeline?: string;
  contradictions?: string[];
};

export function calcConfidence(b: ParsedBrief): number {
  let c = 0.5;
  if (b.goal && b.goal.length > 10) c += 0.2;
  if (b.constraints && b.constraints.length) c += 0.15;
  if (b.audience) c += 0.15;
  if (b.metrics && b.metrics.length) c += 0.15;
  if (b.timeline) c += 0.1;
  if (!b.contradictions || b.contradictions.length === 0) c += 0.15;
  return Math.min(c, 1);
}

export const shouldClarify = (c: number, rounds: number) => c < 0.8 && rounds < 3;
