/**
 * Tier 0 S1 — Decision Data Spine proof slice.
 *
 * Read-side, CEE-local, unwired-from-production. Reads the live
 * `blocks[0].enrichment` shape, narrows it into a typed scientific view, and
 * classifies each field for provenance + claim-safety (re-derived on read,
 * never persisted). See the module headers for the full design / scientific /
 * proof-slice boundaries.
 *
 * This barrel is the single public surface; nothing in production imports it
 * (proven by the no-production-import test in `__tests__/spine-isolation.test.ts`).
 */

export {
  extractBlock0Enrichment,
  narrowScientificEnrichment,
} from './enrichment-scientific-view.js';
export type {
  ScientificEnrichmentView,
  FactorSensitivityView,
  FactorStabilityView,
  OptionOutcomeView,
  OptionComparisonView,
  FragileEdgeView,
  NearTieView,
  RobustnessView,
  FlipThresholdView,
  IdentifiabilityView,
  EvidenceGapView,
} from './enrichment-scientific-view.js';

export {
  classifyEnrichment,
  classifyEnrichmentByField,
  ENRICHMENT_REGISTRY,
  KNOWN_ENRICHMENT_KEYS,
} from './claim-safety.js';
export type {
  ClaimSafetyStatus,
  ScientificCategory,
  Provenance,
  DisputeSignal,
  RegistryEntry,
  FieldClassification,
} from './claim-safety.js';
