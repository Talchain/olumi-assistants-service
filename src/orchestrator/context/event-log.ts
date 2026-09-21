/**
 * Event Log Summary Generator
 *
 * Deterministic template-based event log summary for LLM context.
 * Fills from OrchestratorEvent[] entries.
 * Omits sections for events that haven't occurred.
 *
 * Template:
 * "Framing confirmed: [goal]. Graph drafted with [N] nodes, [M] edges.
 *  Analysis run: [winner] at [probability]%, robustness [level].
 *  [N] patches accepted, [M] dismissed. Brief [generated/not generated]."
 */

import type { OrchestratorEvent } from "../types.js";

// ============================================================================
// Event Counters
// ============================================================================

interface EventCounts {
  framingGoal: string | null;
  graphDrafted: boolean;
  nodeCount: number;
  edgeCount: number;
  analysisRun: boolean;
  winner: string | null;
  winProbability: number | null;
  robustnessLevel: string | null;
  patchesAccepted: number;
  patchesDismissed: number;
  briefGenerated: boolean;
}

function countEvents(events: OrchestratorEvent[]): EventCounts {
  const counts: EventCounts = {
    framingGoal: null,
    graphDrafted: false,
    nodeCount: 0,
    edgeCount: 0,
    analysisRun: false,
    winner: null,
    winProbability: null,
    robustnessLevel: null,
    patchesAccepted: 0,
    patchesDismissed: 0,
    briefGenerated: false,
  };

  for (const event of events) {
    switch (event.event_type) {
      case 'framing_confirmed':
        counts.framingGoal = (event.payload.goal as string) ?? null;
        break;
      case 'graph_drafted':
        counts.graphDrafted = true;
        counts.nodeCount = (event.payload.node_count as number) ?? 0;
        counts.edgeCount = (event.payload.edge_count as number) ?? 0;
        break;
      case 'analysis_run':
        counts.analysisRun = true;
        counts.winner = (event.payload.winner as string) ?? null;
        counts.winProbability = (event.payload.win_probability as number) ?? null;
        counts.robustnessLevel = (event.payload.robustness_level as string) ?? null;
        break;
      case 'patch_accepted':
        counts.patchesAccepted++;
        break;
      case 'patch_dismissed':
        counts.patchesDismissed++;
        break;
      case 'brief_generated':
        counts.briefGenerated = true;
        break;
    }
  }

  return counts;
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Generate a deterministic event log summary from orchestrator events.
 * Omits sections for events that haven't occurred.
 */
export function generateEventLogSummary(events: OrchestratorEvent[]): string {
  if (events.length === 0) return '';

  const counts = countEvents(events);
  const parts: string[] = [];

  if (counts.framingGoal) {
    parts.push(`Framing confirmed: ${counts.framingGoal}.`);
  }

  if (counts.graphDrafted) {
    parts.push(`Graph drafted with ${counts.nodeCount} nodes, ${counts.edgeCount} edges.`);
  }

  if (counts.analysisRun) {
    const winPart = counts.winner
      ? `${counts.winner} at ${counts.winProbability !== null ? `${(counts.winProbability * 100).toFixed(0)}%` : 'unknown'}`
      : 'completed';
    const robustPart = counts.robustnessLevel ? `, robustness ${counts.robustnessLevel}` : '';
    parts.push(`Analysis run: ${winPart}${robustPart}.`);
  }

  if (counts.patchesAccepted > 0 || counts.patchesDismissed > 0) {
    const patchParts: string[] = [];
    if (counts.patchesAccepted > 0) patchParts.push(`${counts.patchesAccepted} patches accepted`);
    if (counts.patchesDismissed > 0) patchParts.push(`${counts.patchesDismissed} dismissed`);
    parts.push(`${patchParts.join(', ')}.`);
  }

  if (counts.briefGenerated) {
    parts.push('Brief generated.');
  }

  return parts.join(' ');
}
