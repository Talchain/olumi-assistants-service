/**
 * The legacy path-B converter (`candidate-to-graph.ts`, retired 21 Oct 2026: no runtime importer after the thin-core flip)
 * as the tests that still feed its output to LIVE seams (registration, the Run request, the licence, approval) recorded it:
 * each conversion's graph and loss ledger (the only fields they read), keyed by its exact input and statement carry, recorded
 * at staging 9e113412. An input the record does not hold fails loudly; it never converts anything.
 */
import { createHash } from 'node:crypto';
import frozen from './fixtures/candidate-to-graph-frozen.json';

type Rec = Record<string, any>;
const RECORDED: Readonly<Record<string, Rec>> = frozen as Record<string, Rec>;

export function frozenCandidateGraph(input: unknown, carry?: { readonly words: string; readonly recorded_at: string }): Rec {
  const key = createHash('sha256').update(JSON.stringify({ input, carry: carry ?? null })).digest('hex');
  const out = RECORDED[key];
  if (out === undefined) throw new Error(`no recorded conversion for this draft (${key}): the converter is retired; record a frozen graph instead`);
  return structuredClone(out);
}
