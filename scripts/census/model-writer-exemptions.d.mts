export interface GraphWriterSite {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly callee: string;
}

export interface GraphWriterCensus {
  readonly outside_door: number;
  readonly sites: readonly GraphWriterSite[];
}

export const BASELINE: 0;
export const BYPASS_EXEMPTIONS: readonly string[];
export function requireOnlyExemptedWrites(census: GraphWriterCensus): void;
