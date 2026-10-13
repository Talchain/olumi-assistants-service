import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

/** Press the actual offered control; never manufacture a current Run or its identity. */
export async function explainRun(app: FastifyInstance, scenarioId: string, first: { statusCode: number; json(): unknown }): Promise<LightMyRequestResponse> {
  expect(first.statusCode).toBe(200);
  return first as LightMyRequestResponse;
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
        if (value?.canonical_state !== undefined) return value;
      } catch { /* Ordinary conversation is not the structured Run context. */ }
    }
  }
  return undefined;
}
import { randomUUID } from 'node:crypto';
