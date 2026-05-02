/**
 * V5 D1 — `adjust_edge_strength` handler.
 *
 * Mutates an edge's `strength.mean` (and optionally `strength.std`) on a
 * graph identified by composite `from→to` (the V3 schema has no stable
 * edge.id — edges are keyed by the (from, to) tuple).
 *
 * Per correction #4: accepts both Unicode arrow `from→to` and ASCII
 * `from->to`. Falls back to PARAMETER_INVALID with user guidance when
 * the format is unrecognised.
 *
 * Operators: set, increase, decrease, multiply. All results clamped to
 * [-1, +1]. After clamp, `effect_direction` is recomputed to match the
 * sign of the new mean (positive when ≥ 0, negative when < 0).
 *
 * Confirmation language uses `bandFromMagnitude` so the user-visible
 * text says "moderate to strong" (not "0.4 to 0.7"). Sign reversal is
 * surfaced explicitly.
 */

import { z } from 'zod';

import { AdjustEdgeStrengthHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { AdjustEdgeStrengthHandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import type { HandlerFn, HandlerInvocation, HandlerOutcome } from '../registry.js';
import { HandlerInvocationFailedError, HandlerResultInvalidError } from '../handler-errors.js';
import { applyAndValidateMutation } from './d1-shared/apply-graph-mutation.js';
import { runD1Handler } from './d1-shared/error-boundary.js';
import { D1HandlerError } from './d1-shared/errors.js';
import { formatEdgeAdjustment } from './d1-shared/format-confirmation.js';

export const AdjustEdgeStrengthSchema = z.number().min(-1).max(1);
export const AdjustEdgeStrengthStdSchema = z.number().min(0).max(0.5);

const STRENGTH_CLAMP_MIN = -1;
const STRENGTH_CLAMP_MAX = 1;

/**
 * Parse `from→to` or `from->to` into `{ from, to }`. Trims whitespace
 * around each side. Returns null on malformed input.
 */
export function parseEdgeId(id: string): { from: string; to: string } | null {
  const arrow = id.includes('→') ? '→' : id.includes('->') ? '->' : null;
  if (!arrow) return null;
  const parts = id.split(arrow);
  if (parts.length !== 2) return null;
  const from = parts[0].trim();
  const to = parts[1].trim();
  if (!from || !to) return null;
  return { from, to };
}

function clamp(n: number): number {
  if (n > STRENGTH_CLAMP_MAX) return STRENGTH_CLAMP_MAX;
  if (n < STRENGTH_CLAMP_MIN) return STRENGTH_CLAMP_MIN;
  return n;
}

function applyOperator(
  current: number,
  operator: 'set' | 'increase' | 'decrease' | 'multiply' | undefined,
  rhs: number,
): number {
  switch (operator) {
    case undefined:
    case 'set':
      return rhs;
    case 'increase':
      return current + rhs;
    case 'decrease':
      return current - rhs;
    case 'multiply':
      return current * rhs;
  }
}

export function createAdjustEdgeStrengthHandler(): HandlerFn {
  return async function adjustEdgeStrengthHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    return runD1Handler('adjust_edge_strength', async () => {
      const proposal = invocation.proposal;
      if (!proposal) {
        throw new HandlerInvocationFailedError(
          'adjust_edge_strength invoked without a proposal',
          {
            cause_kind: 'parameter_invalid_at_execute',
            retryable: false,
            details: { handler_id: 'adjust_edge_strength' },
          },
        );
      }

      const rawGraph = invocation.graphForTurn ?? invocation.context.persistedGraph ?? null;
      if (!rawGraph) {
        throw new D1HandlerError(
          'PRECONDITION_UNMET',
          'adjust_edge_strength requires a graph — none was supplied for this turn.',
          { details: { handler_id: 'adjust_edge_strength' } },
        );
      }
      const graphParse = GraphV3.safeParse(rawGraph);
      if (!graphParse.success) {
        throw new D1HandlerError(
          'GRAPH_INVARIANT_VIOLATED',
          'adjust_edge_strength: ingress graph failed schema validation.',
          {
            details: {
              handler_id: 'adjust_edge_strength',
              first_issue: graphParse.error.issues[0]?.message,
            },
          },
        );
      }
      const graph = graphParse.data;

      // Parse the edge id. The wire schema accepts opaque strings so we
      // do this at execute-time. Both `→` (canonical) and `->` (ASCII
      // fallback for environments that drop Unicode) are accepted.
      const parsed = parseEdgeId(proposal.entity.id);
      if (!parsed) {
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          `Edge id "${proposal.entity.id}" is malformed.`,
          {
            details: {
              handler_id: 'adjust_edge_strength',
              entity_id: proposal.entity.id,
            },
            userGuidance: 'Edge ID should be in format "source→target" (or "source->target").',
          },
        );
      }

      const targetEdge = graph.edges.find(
        (e) => e.from === parsed.from && e.to === parsed.to,
      );
      if (!targetEdge) {
        throw new D1HandlerError(
          'ENTITY_NOT_FOUND',
          `No edge from "${parsed.from}" to "${parsed.to}" in the graph.`,
          {
            details: {
              handler_id: 'adjust_edge_strength',
              from: parsed.from,
              to: parsed.to,
            },
          },
        );
      }

      // Resolve labels for confirmation text.
      const fromLabel = graph.nodes.find((n) => n.id === parsed.from)?.label ?? parsed.from;
      const toLabel = graph.nodes.find((n) => n.id === parsed.to)?.label ?? parsed.to;

      const strengthParam = proposal.parameters.find((p) => p.name === 'strength');
      if (!strengthParam) {
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          'adjust_edge_strength requires a "strength" parameter.',
          { details: { handler_id: 'adjust_edge_strength' } },
        );
      }
      const strengthParse = AdjustEdgeStrengthSchema.safeParse(strengthParam.value);
      if (!strengthParse.success) {
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          'adjust_edge_strength: strength must be a number in [-1, 1].',
          {
            details: {
              handler_id: 'adjust_edge_strength',
              received: strengthParam.value,
            },
          },
        );
      }
      const operator = strengthParam.operator ?? 'set';
      const beforeMean = targetEdge.strength.mean;
      const newMean = clamp(applyOperator(beforeMean, operator, strengthParse.data));

      // Optional std parameter — set only.
      const stdParam = proposal.parameters.find((p) => p.name === 'std');
      let newStd: number | undefined;
      if (stdParam) {
        const stdParse = AdjustEdgeStrengthStdSchema.safeParse(stdParam.value);
        if (!stdParse.success) {
          throw new D1HandlerError(
            'PARAMETER_INVALID',
            'adjust_edge_strength: std must be a number in [0, 0.5].',
            {
              details: { handler_id: 'adjust_edge_strength', received: stdParam.value },
            },
          );
        }
        newStd = stdParse.data;
      }

      const beforeSnapshot = {
        from: targetEdge.from,
        to: targetEdge.to,
        strength: { ...targetEdge.strength },
        effect_direction: targetEdge.effect_direction,
      };
      const newDirection: 'positive' | 'negative' = newMean < 0 ? 'negative' : 'positive';
      // EdgeStrengthV3 requires std > 0 (positive). When the existing
      // edge has std and we don't have a fresh one, preserve it.
      const finalStd = newStd ?? targetEdge.strength.std;
      const afterSnapshot = {
        from: targetEdge.from,
        to: targetEdge.to,
        strength: { mean: newMean, std: finalStd },
        effect_direction: newDirection,
      };

      const result = applyAndValidateMutation(graph, (clone) => {
        const edge = clone.edges.find(
          (e) => e.from === parsed.from && e.to === parsed.to,
        );
        if (!edge) {
          throw new D1HandlerError(
            'ENTITY_NOT_FOUND',
            `Edge ${parsed.from}→${parsed.to} disappeared during clone.`,
          );
        }
        edge.strength = { mean: newMean, std: finalStd };
        edge.effect_direction = newDirection;
        return {
          before: beforeSnapshot as Record<string, unknown>,
          after: afterSnapshot as Record<string, unknown>,
        };
      });

      const noop =
        beforeSnapshot.strength.mean === afterSnapshot.strength.mean &&
        beforeSnapshot.strength.std === afterSnapshot.strength.std &&
        beforeSnapshot.effect_direction === afterSnapshot.effect_direction;

      const targetIdNormal = `${parsed.from}→${parsed.to}`;
      const fact: AdjustEdgeStrengthHandlerFact = {
        fact_type: 'adjust_edge_strength',
        fact_version: 1,
        noop,
        result: {
          target_id: targetIdNormal,
          status: noop ? 'noop' : 'applied',
          before: beforeSnapshot as Record<string, unknown>,
          after: afterSnapshot as Record<string, unknown>,
        },
      };

      const factCheck = AdjustEdgeStrengthHandlerFactSchema.safeParse(fact);
      if (!factCheck.success) {
        throw new HandlerResultInvalidError(
          'AdjustEdgeStrengthHandlerFact failed schema validation',
          factCheck.error,
        );
      }

      const assistantText = formatEdgeAdjustment({
        fromLabel,
        toLabel,
        beforeMean,
        afterMean: newMean,
      });

      return {
        assistant_text: assistantText,
        handler_facts: [factCheck.data],
        llm_calls_used: 0,
        mutated_graph: result.mutatedGraph,
      };
    });
  };
}
