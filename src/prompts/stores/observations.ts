/**
 * Narrow prompt-observation capability.
 *
 * Observations are a Supabase-only side channel. They deliberately do not
 * belong to IPromptStore: exposing the underlying store here would also expose
 * prompt mutation methods and bypass GovernedPromptStore. Backends may publish
 * this facet to the governance wrapper through the private-by-convention
 * symbol; routes can consume it only through the governed accessor.
 */

export type ObservationType = 'note' | 'rating' | 'failure' | 'success';

export interface PromptObservation {
  id?: string;
  promptId: string;
  version: number;
  observationType: ObservationType;
  content?: string;
  rating?: number;
  payloadHash?: string;
  createdBy?: string;
  createdAt?: string;
}

export interface ObservationsResult {
  observations: PromptObservation[];
  averageRating: number | null;
  totalCount: number;
}

/** The complete and intentionally small capability used by admin routes. */
export interface PromptObservationCapability {
  listObservations(promptId: string): Promise<ObservationsResult>;
  getObservationVersion(
    promptId: string,
    version: number,
  ): Promise<ObservationsResult>;
  addObservation(
    observation: Omit<PromptObservation, 'id' | 'createdAt'>,
  ): Promise<PromptObservation>;
  deleteObservation(id: string): Promise<void>;
}

/** Backend-to-governance hand-off. Never use this from a route. */
export const PROMPT_OBSERVATION_CAPABILITY = Symbol(
  'prompt-observation-capability',
);

export interface ProvidesPromptObservationCapability {
  readonly [PROMPT_OBSERVATION_CAPABILITY]: PromptObservationCapability;
}

export function providesPromptObservationCapability(
  value: unknown,
): value is ProvidesPromptObservationCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    PROMPT_OBSERVATION_CAPABILITY in value
  );
}
