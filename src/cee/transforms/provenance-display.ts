/**
 * Provenance display mappers — NOW A RE-EXPORT of the ONE provenance authority (`cee/provenance/provenance-of.ts`).
 *
 * Every table, literal set and rule that lived here moved there verbatim (Recovery Batch C, "one provenance authority",
 * DL 12 Oct); this path stays so its importers keep their imports. `observedValueAuthorship` is now TOTAL for any
 * `observed_state` record (the extraction type and the recognised stamps decide where the person's own stamps do not;
 * an unestablished origin says `unverified_brief`, never `ai_inferred`), and `nodeProvenanceDisplay` says a held figure's
 * provenance by that same rule.
 */
export {
  type ProvenanceDisplay,
  type ValueSourceDisplay,
  type ValueAuthorshipDisplay,
  isUnverifiedUserMaterial,
  nodeProvenanceDisplay,
  edgeProvenanceDisplay,
  FORGEABLE_USER_AUTHORSHIP_LITERALS,
  UNVERIFIED_USER_AUTHORSHIP_LITERALS,
  valueSourceAuthorship,
  isAcceptedOlumiEstimate,
  observedValueAuthorship,
  SOURCE_AUTHORSHIP_TABLE,
} from '../provenance/provenance-of.js';
