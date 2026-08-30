/** The selector owns materiality and scale; the estimator may not redefine either. */
export interface QuantificationGap {
  readonly factor_id: string;
  readonly label: string;
  readonly reason: string;
  readonly unit?: string;
  readonly category?: string;
  readonly scale?: unknown;
  readonly relationships?: readonly unknown[];
  readonly requested_by?: readonly string[];
  readonly priority?: number;
}

interface EstimateBasis {
  readonly factor_id: string;
  readonly reasoning: string;
  /** References to supplied context, not model-invented evidence. Validated by adoption. */
  readonly basis: readonly string[];
}

export type FactorEstimate =
  | (EstimateBasis & {
      readonly estimate_type: 'estimated';
      readonly value: number;
      readonly std: number;
      readonly distribution?: never;
      readonly range_min?: never;
      readonly range_max?: never;
    })
  | (EstimateBasis & {
      readonly estimate_type: 'estimated';
      readonly distribution: 'uniform';
      readonly range_min: number;
      readonly range_max: number;
      readonly value?: never;
      readonly std?: never;
    })
  | (EstimateBasis & {
      readonly estimate_type: 'unknown';
      readonly value?: never;
      readonly std?: never;
      readonly distribution?: never;
      readonly range_min?: never;
      readonly range_max?: never;
    });

export interface FactorQuantificationPromptInput {
  readonly brief: string;
  readonly gaps: readonly QuantificationGap[];
  readonly context: unknown;
}
