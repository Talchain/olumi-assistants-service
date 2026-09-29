import type { ModelBuildingNoticeKind, ModelBuildingNotices } from '@talchain/schemas/boundary';

// Describe the producer's categories, not a guessed list of omitted user ideas.
// Consolidation and unbound targets are not synonymous with deletion.
const DESCRIPTION: Record<ModelBuildingNoticeKind, readonly [string, string]> = {
  detail_not_connected: ['detail not connected', 'details not connected'],
  relationship_not_used: ['relationship not used', 'relationships not used'],
  alternative_consolidated: ['alternative consolidated', 'alternatives consolidated'],
  conflict_resolved_conservatively: ['conflict resolved conservatively', 'conflicts resolved conservatively'],
  target_not_modelled_as_threshold: ['target not modelled as a threshold', 'targets not modelled as thresholds'],
  other: ['other model-building notice', 'other model-building notices'],
};

/**
 * Public, bounded receipt of the notices shipped beside the draft. Persisted
 * through the existing assistant-message carrier so the next turn can discuss
 * what was reported. No raw disclosures, new storage, or extra model call.
 * Absence means no attestation, not proof that nothing was left out.
 */
export function draftModelBuildingReceipt(notices: ModelBuildingNotices | undefined): string {
  if (!notices) return '';
  const categories = notices.groups.map(({ kind, count }) => `${count} ${DESCRIPTION[kind][count === 1 ? 0 : 1]}`);
  return `Draft notice: ${categories.join('; ')}. ` +
    'This notice records category counts, not the individual items.';
}
