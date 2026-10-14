import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

/** Press the actual offered control; never manufacture a current Run or its identity. */
export async function explainRun(app: FastifyInstance, scenarioId: string, first: { statusCode: number; json(): unknown }): Promise<LightMyRequestResponse> {
  expect(first.statusCode).toBe(200);
  const body = first.json() as { suggested_actions: { id: string; message: string }[]; _agent: { session_id: string; turn_id?: string } };
  const chip = body.suggested_actions.find((c) => c.id.startsWith('agent-explain-run:'));
  expect(chip, JSON.stringify(body)).toBeDefined();
  return app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    scenario_id: scenarioId, agent_session_id: body._agent.session_id,
    // Named-turn fixtures provide the real claim/readback store. Their follow-up must
    // have its own named row too; legacy unnamed fixtures do not exercise persistence.
    ...(body._agent.turn_id !== undefined ? { turn_id: randomUUID() } : {}),
    message: chip!.message, chip: { id: chip!.id },
  } });
}

/** Inspect the captured provider request's explicit context, not earlier tool outputs. */
export function explanationContext(input: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(input)) return undefined;
  for (const item of [...input].reverse()) {
    if (item?.role !== 'user' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part.type !== 'input_text' || typeof part.text !== 'string') continue;
      try {
        const value = JSON.parse(part.text);
        if (value?.request === 'Explain this result') return value;
      } catch { /* Ordinary conversation is not the structured Run context. */ }
    }
  }
  return undefined;
}
import { randomUUID } from 'node:crypto';
