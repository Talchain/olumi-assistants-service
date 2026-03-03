/**
 * Event Log Summary Builder
 *
 * Deterministic template-based summary from Supabase scenario event log.
 * No LLM call. Uses ScenarioEvent[] from scenarios.events JSONB column.
 *
 * Template (each line only if relevant events exist, concatenated with space):
 * "Framing confirmed: [goal]. Graph drafted with [N] nodes, [M] edges.
 *  [A] patches accepted, [D] dismissed.
 *  Analysis run: [winner] at [probability]%, robustness [level].
 *  Brief [generated / not yet generated]."
 *
 * Always uses the latest event of each type (highest seq).
 * Rounds probability to nearest integer.
 * Returns "" for null/empty input.
 */

// ============================================================================
// Event Interface (from Supabase scenarios.events JSONB)
// ============================================================================

export interface ScenarioEvent {
  event_id: string;
  event_type: string;
  seq: number;
  timestamp: string;
  details: Record<string, unknown>;
  turn_id?: string;
  hashes?: Record<string, string>;
}

// ============================================================================
// Internal State
// ============================================================================

interface EventState {
  latestByType: Map<string, ScenarioEvent>;
  patchAcceptedCount: number;
  patchDismissedCount: number;
}

function buildEventState(events: ScenarioEvent[]): EventState {
  const latestByType = new Map<string, ScenarioEvent>();
  let patchAcceptedCount = 0;
  let patchDismissedCount = 0;

  for (const event of events) {
    // Track latest (highest seq) for each event type
    const existing = latestByType.get(event.event_type);
    if (!existing || event.seq > existing.seq) {
      latestByType.set(event.event_type, event);
    }

    // Count patch events
    if (event.event_type === 'patch_accepted') {
      patchAcceptedCount++;
    } else if (event.event_type === 'patch_dismissed') {
      patchDismissedCount++;
    }
  }

  return { latestByType, patchAcceptedCount, patchDismissedCount };
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Build a deterministic event log summary string from scenario events.
 *
 * Returns "" if events is null, undefined, or empty.
 * Same events array → identical string output.
 */
export function buildEventLogSummary(events: ScenarioEvent[] | null | undefined): string {
  if (!events || events.length === 0) return '';

  const state = buildEventState(events);
  const parts: string[] = [];

  // 1. Framing confirmed
  const framingEvent = state.latestByType.get('framing_confirmed');
  if (framingEvent) {
    const goal = typeof framingEvent.details.goal === 'string'
      ? framingEvent.details.goal
      : null;
    if (goal) {
      parts.push(`Framing confirmed: ${goal}.`);
    }
  }

  // 2. Graph drafted
  const graphEvent = state.latestByType.get('graph_drafted');
  if (graphEvent) {
    const nodeCount = typeof graphEvent.details.node_count === 'number'
      ? graphEvent.details.node_count
      : 0;
    const edgeCount = typeof graphEvent.details.edge_count === 'number'
      ? graphEvent.details.edge_count
      : 0;
    parts.push(`Graph drafted with ${nodeCount} nodes, ${edgeCount} edges.`);
  }

  // 3. Patch counts
  if (state.patchAcceptedCount > 0 || state.patchDismissedCount > 0) {
    const patchParts: string[] = [];
    if (state.patchAcceptedCount > 0) {
      patchParts.push(`${state.patchAcceptedCount} patches accepted`);
    }
    if (state.patchDismissedCount > 0) {
      patchParts.push(`${state.patchDismissedCount} dismissed`);
    }
    parts.push(`${patchParts.join(', ')}.`);
  }

  // 4. Analysis run
  const analysisEvent = state.latestByType.get('analysis_run');
  if (analysisEvent) {
    const winner = typeof analysisEvent.details.winner === 'string'
      ? analysisEvent.details.winner
      : null;
    const winProbability = typeof analysisEvent.details.win_probability === 'number'
      ? analysisEvent.details.win_probability
      : null;
    const robustness = typeof analysisEvent.details.robustness_level === 'string'
      ? analysisEvent.details.robustness_level
      : null;

    const winnerPart = winner
      ? `${winner} at ${winProbability !== null ? `${Math.round(winProbability * 100)}%` : 'unknown'}`
      : 'completed';
    const robustPart = robustness ? `, robustness ${robustness}` : '';
    parts.push(`Analysis run: ${winnerPart}${robustPart}.`);
  }

  // 5. Brief generated / not yet generated
  const briefEvent = state.latestByType.get('brief_generated');
  if (briefEvent) {
    parts.push('Brief generated.');
  } else if (analysisEvent) {
    parts.push('Brief not yet generated.');
  }

  return parts.join(' ');
}
