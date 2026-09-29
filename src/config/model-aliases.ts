/** Explicit provider aliases accepted by every model-resolution surface. */
export const EXPLICIT_MODEL_ALIASES = {
  'gpt-4.1': 'gpt-4.1-2025-04-14',
  'gpt-4.1-mini': 'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano': 'gpt-4.1-nano-2025-04-14',
} as const;

export type ExplicitModelAlias = keyof typeof EXPLICIT_MODEL_ALIASES;
