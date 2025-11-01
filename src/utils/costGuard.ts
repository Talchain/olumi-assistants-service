export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function allowedCostUSD(tokensIn: number, tokensOut: number, usdPer1k = 0.003): boolean {
  const cost = ((tokensIn + tokensOut) / 1000) * usdPer1k;
  const cap = Number(process.env.COST_MAX_USD || "1.0");
  return Number.isFinite(cost) && cost <= cap;
}
